# RabbitMQ 消息持久化：交换机、队列、消息

你的系统凌晨 2 点发生了一次计划外断电。

电源恢复后，你满怀希望地重启了 RabbitMQ，却发现——**消息全丢了**。

「我明明设置了持久化啊？」你翻出代码，确实设置了 `durable = true`。

但你还是丢了消息。

问题出在哪里？

## 一、持久化的三个层次

RabbitMQ 的持久化分为三个层次，**三者缺一不可**：

| 层次 | 配置项 | 说明 |
|------|-------|------|
| 交换机持久化 | durable = true | Exchange 重启后存在 |
| 队列持久化 | durable = true | Queue 重启后存在 |
| 消息持久化 | deliveryMode = 2 | Message 重启后存在 |

```
┌─────────────────────────────────────────────────────────────────┐
│                        持久化三要素                              │
│                                                                  │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐      │
│   │   Exchange  │ + │    Queue    │ + │     Message     │      │
│   │ durable=true│   │ durable=true│   │ deliveryMode=2  │      │
│   └─────────────┘   └─────────────┘   └─────────────────┘      │
│                            │                                    │
│                            ▼                                    │
│                  只有三者都为 true                              │
│                  消息才能真正持久化                              │
└─────────────────────────────────────────────────────────────────┘
```

很多人踩过的坑：**只持久化了队列，但没持久化消息**。

```java
// 错误示例：队列持久化了，但消息没有
channel.queueDeclare("order.queue", true, false, false, null);
channel.basicPublish("order.exchange", "order.created",
    null,  // 没有设置持久化！
    message.getBytes());

// 正确示例：三层都持久化
channel.exchangeDeclare("order.exchange", "direct", true);
channel.queueDeclare("order.queue", true, false, false, null);
channel.queueBind("order.queue", "order.exchange", "order.created");

// 消息设置持久化
channel.basicPublish("order.exchange", "order.created",
    MessageProperties.PERSISTENT_TEXT_PLAIN,  // 关键！
    message.getBytes());
```

## 二、交换机持久化

### 声明持久化交换机

```java
// durable = true：交换机在 RabbitMQ 重启后依然存在
channel.exchangeDeclare("order.exchange", "direct", true);
```

### 持久化 vs 非持久化对比

| 场景 | durable = false | durable = true |
|------|-----------------|----------------|
| Broker 重启 | 交换机丢失，绑定关系丢失 | 交换机和绑定关系保留 |
| 发送消息 | 消息被丢弃或报错 | 消息正常路由 |
| 配置复杂度 | 低 | 高（需要确保队列也存在） |

非持久化交换机适合**临时队列**场景，如临时通知、调试等。

## 三、队列持久化

### 声明持久化队列

```java
// durable = true：队列在 RabbitMQ 重启后依然存在
channel.queueDeclare("order.queue", true, false, false, null);
```

### 队列的其他属性

```java
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();

// exclusive = true：独占队列，只允许当前连接使用
// 适用场景：临时队列、测试环境
// 注意：独占队列会在连接断开时自动删除
args.put("x-expires", 3600000);  // 队列 1 小时后自动删除（单位：毫秒）

// autoDelete = true：所有消费者取消订阅时，队列自动删除
// 注意：如果 autoDelete = true 且 exclusive = true，队列会在连接断开时删除

channel.queueDeclare("temp.queue", true, false, false, args);
```

### 队列持久化参数表

| 参数 | 说明 | 推荐值 |
|------|------|-------|
| durable | 是否持久化 | true |
| exclusive | 是否独占 | false（除非临时队列） |
| autoDelete | 无消费者时是否删除 | false（除非临时队列） |
| x-expires | 队列过期自动删除时间 | 根据业务需求设置 |

## 四、消息持久化

### 设置消息持久化

```java
// 方式一：使用预定义属性
channel.basicPublish("exchange", "routingKey",
    MessageProperties.PERSISTENT_TEXT_PLAIN,  // 持久化消息
    message.getBytes());

// 方式二：构建自定义属性
AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)  // 2 = 持久化，1 = 非持久化
    .contentType("application/json")
    .priority(5)
    .build();

channel.basicPublish("exchange", "routingKey", properties, message.getBytes());
```

### Spring Boot 中的消息持久化

```yaml
spring:
  rabbitmq:
    # 生产者确认
    publisher-confirm-type: correlated
    publisher-returns: true
```

```java
// Spring Boot 发送持久化消息
@Component
public class OrderMessageProducer {

    @Autowired
    private RabbitTemplate rabbitTemplate;

    public void sendOrder(Order order) {
        rabbitTemplate.convertAndSend(
            "order.exchange",
            "order.created",
            order,
            message -> {
                // 设置消息持久化
                message.getMessageProperties().setDeliveryMode(
                    MessageDeliveryMode.PERSISTENT);
                return message;
            }
        );
    }
}
```

## 五、持久化原理：消息存储机制

RabbitMQ 的消息持久化是通过**写入磁盘**实现的，但并非每条消息立即写入：

```
                    ┌─────────────────────┐
                    │    消息到达队列      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    内存缓冲区        │
                    │  (Segment Buffer)   │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
              ▼                ▼                ▼
      ┌───────────┐    ┌───────────┐    ┌───────────┐
      │ 触发条件1 │    │ 触发条件2 │    │ 触发条件3 │
      │ 缓冲区满  │    │ 定时刷新  │    │ 收到 sync │
      └─────┬─────┘    └─────┬─────┘    └─────┬─────┘
            │                │                │
            └────────────────┼────────────────┘
                             │
                    ┌────────▼────────┐
                    │     磁盘文件     │
                    │  (msg_store)    │
                    └─────────────────┘
```

### 触发写入磁盘的条件

| 触发条件 | 说明 |
|---------|------|
| 缓冲区写满 | 默认约 16KB，写满后批量刷盘 |
| 定时刷新 | 默认每 500ms 检查一次 |
| 同步命令 | 收到 `rabbitmqctl sync_queue` 命令 |

### 持久化性能

持久化会增加 I/O 开销，影响吞吐量：

| 持久化配置 | 吞吐量 | 适用场景 |
|-----------|-------|---------|
| 完全异步刷盘 | ~50K msg/s | 高性能、对可靠性要求不高的场景 |
| 同步刷盘 | ~5K msg/s | 高可靠性场景 |
| 折中方案 | ~20K msg/s | 大多数生产环境 |

```java
// 声明队列时设置刷盘策略
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
// 持久化类型：
// - transient：异步刷盘，性能好
// - persistent：同步刷盘，可靠性高
args.put("x-queue-type", "persistent");

channel.queueDeclare("high-throughput.queue", true, false, false, args);
```

## 六、Lazy Queue：懒加载队列

对于消息堆积严重的场景，可以启用 Lazy Queue——消息直接写入磁盘，按需加载到内存。

```
普通队列 vs Lazy Queue：

普通队列：
  消息全部保存在内存 ───▶ 内存压力大

Lazy Queue：
  消息直接写入磁盘 ───▶ 按需加载 ───▶ 内存可控
```

```java
// 声明 Lazy Queue
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-queue-type", "lazy");
channel.queueDeclare("lazy.queue", true, false, false, args);
```

```yaml
# Spring Boot 配置 Lazy Queue
spring:
  rabbitmq:
    queue:
      type: lazy
```

### Lazy Queue 的特点

| 特性 | 普通队列 | Lazy Queue |
|------|---------|------------|
| 内存占用 | 高 | 低 |
| 磁盘占用 | 低 | 高 |
| 首次读取延迟 | 低 | 高 |
| 消息堆积时表现 | 内存暴涨 | 稳定 |

适合场景：

- 预期会有大量消息堆积
- 消费者偶尔离线
- 需要控制内存使用的场景

## 七、完整持久化配置示例

```java
public class ReliableQueueConfig {

    public void setupReliableQueue(Channel channel) throws Exception {
        // 1. 声明持久化交换机
        channel.exchangeDeclare(
            "reliable.exchange",
            "direct",
            true  // durable = true
        );

        // 2. 声明持久化队列（带死信队列配置）
        Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
        args.put("x-dead-letter-exchange", "dlx.exchange");
        args.put("x-dead-letter-routing-key", "dlx.message");
        args.put("x-message-ttl", 86400000);  // 消息 24 小时过期
        args.put("x-max-length", 100000);     // 队列最大长度

        channel.queueDeclare(
            "reliable.queue",
            true,    // durable = true
            false,   // exclusive = false
            false,   // autoDelete = false
            args
        );

        // 3. 绑定队列
        channel.queueBind(
            "reliable.queue",
            "reliable.exchange",
            "reliable.routing.key"
        );

        // 4. 声明死信交换机和队列
        channel.exchangeDeclare("dlx.exchange", "direct", true);
        channel.queueDeclare("dlx.queue", true, false, false, null);
        channel.queueBind("dlx.queue", "dlx.exchange", "dlx.message");
    }
}
```

```java
// 发送持久化消息
public class ReliableProducer {

    public void sendMessage(Channel channel, String message) throws Exception {
        AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
            .deliveryMode(2)           // 消息持久化
            .contentType("application/json")
            .messageId(UUID.randomUUID().toString())
            .timestamp(new Date())
            .build();

        channel.basicPublish(
            "reliable.exchange",
            "reliable.routing.key",
            true,  // mandatory = true（无法路由时触发 Return）
            properties,
            message.getBytes()
        );
    }
}
```

## 八、持久化检查清单

确保你的消息不会在断电后丢失：

```
┌─────────────────────────────────────────────────────────────────┐
│                    持久化检查清单                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  □ Exchange durable = true                                      │
│                                                                  │
│  □ Queue durable = true                                         │
│                                                                  │
│  □ Message deliveryMode = 2 (PERSISTENT)                        │
│                                                                  │
│  □ Binding 已重建（如果交换机非持久化，绑定会丢失）               │
│                                                                  │
│  □ 队列参数正确（TTL、死信队列等）                                │
│                                                                  │
│  □ 消费者已重新订阅（重启后需要）                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 九、面试追问

### 持久化和 Confirm 机制可以一起用吗？

当然可以，而且**应该一起用**：

- **持久化**：确保消息写入磁盘，Broker 重启后不丢失
- **Confirm**：确保消息到达 Broker，生产者知道发送结果

两者结合，实现端到端的消息可靠性：

```java
channel.confirmSelect();  // 开启 Confirm

channel.basicPublish(
    "exchange",
    "routingKey",
    MessageProperties.PERSISTENT_TEXT_PLAIN,  // 持久化
    message.getBytes()
);

// 等待确认
channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
```

### 如果消息堆积太多，磁盘满了怎么办？

RabbitMQ 会：

1. **阻止消息写入**：新消息被拒绝
2. **通知生产者**：发送 `channel.flow` 命令
3. **记录日志**：提示磁盘空间不足

建议配置监控和告警：

```bash
# 查看磁盘使用情况
rabbitmqctl status | grep disk

# 配置磁盘告警阈值
rabbitmqctl set_disk_free_limit 2GB
```

---

下一个问题留给你：

消息处理失败后，如果不想直接丢弃，可以怎么办？

比如订单超时未支付，消息应该进入「超时订单处理队列」；处理 3 次都失败的消息，不应该无限重试，应该进入专门的「异常消息队列」。

这些需求，都可以通过**死信队列（DLX）**来实现。下一节——[死信队列与延迟队列](/middleware/rabbitmq/dlx)会详细讲解。
