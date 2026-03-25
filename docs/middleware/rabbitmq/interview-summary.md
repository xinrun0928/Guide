# RabbitMQ 面试高频问题汇总

面试官：「你们的项目里用了 RabbitMQ，那 RabbitMQ 怎么保证消息不丢？」

你张口就来：「开启持久化，消息就不会丢。」

面试官微微一笑：「那生产者和消费者分别怎么处理？」

你：「......」

今天这篇文章，帮你把 RabbitMQ 面试常考的知识点一网打尽。

## 一、消息可靠性相关

### Q1：RabbitMQ 怎么保证消息不丢？

这是 RabbitMQ 面试中出现频率最高的问题。

消息从生产到消费，要经过三个环节，每个环节都可能丢消息：

```
┌─────────────────────────────────────────────────────────────────┐
│                      消息可靠性保障                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. 生产者 ───▶ Broker：Confirm 机制                            │
│                                                                  │
│  2. Broker 内部：持久化（Exchange + Queue + Message）           │
│                                                                  │
│  3. Broker ───▶ 消费者：手动 ACK                                │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

| 环节 | 丢消息原因 | 解决方案 |
|------|-----------|---------|
| 生产者 → Broker | 网络抖动、Broker 故障 | Confirm 机制 |
| Broker 内部 | Broker 重启、磁盘故障 | 持久化 |
| Broker → 消费者 | 消费者处理失败、宕机 | 手动 ACK |

**参考回答**：

> RabbitMQ 的消息可靠性需要从三个环节保障：
>
> 1. **生产者确认**：开启 Confirm 模式，消息发送后等待 Broker 确认。如果没收到确认，说明发送失败，需要重试。
>
> 2. **持久化配置**：Exchange、Queue、Message 三个都要设置持久化。交换机和队列要设置 `durable=true`，消息要设置 `deliveryMode=2`。
>
> 3. **消费端确认**：关闭自动 ACK（`autoAck=false`），消费者处理完业务逻辑后手动发送 ACK。如果处理失败，可以选择重新入队或进入死信队列。

### Q2：Confirm 和事务有什么区别？

| 特性 | Confirm | 事务 |
|------|---------|------|
| 机制 | 异步确认 | 同步阻塞 |
| 性能 | 高（万级 TPS） | 低（百级 TPS） |
| 范围 | 单条消息 | 整个 Channel |
| 推荐 | 生产环境 | 不推荐 |

**参考回答**：

> RabbitMQ 的事务机制性能很差，每发一条消息都要同步等待 Broker 确认，性能损耗在 10 倍以上。生产环境几乎不用事务，都是用 Confirm 机制。
>
> Confirm 机制是异步的，发送消息后不需要等待确认，Broker 会异步回调通知发送结果。Confirm 的性能可以达到每秒几万条消息。

### Q3：消费者怎么保证消息不重复消费？

**核心**：保证幂等性。

消息重复的原因：

1. 消费者处理成功，但 ACK 时网络断开
2. Broker 重新投递消息

**解决方案**：

```java
// 1. 数据库唯一索引
public void processOrder(String orderId) {
    try {
        orderMapper.insert(new Order(orderId));
    } catch (DuplicateKeyException e) {
        // 重复消息，忽略
    }
}

// 2. Redis 去重
public void processOrder(String orderId) {
    String key = "order:processed:" + orderId;
    if (redis.setIfAbsent(key, "1", 24, TimeUnit.HOURS)) {
        // 首次处理
        doProcess(orderId);
    }
}
```

**参考回答**：

> 消息重复是 RabbitMQ 的正常行为，不是 bug。Broker 会在消息被消费者拒收或 ACK 超时后重新投递。
>
> 保证不重复消费的关键是**幂等处理**：无论消息被投递几次，业务结果都一样。常见做法是用订单 ID 作为唯一键插入数据库，或者用 Redis 做去重标记。

### Q4：RabbitMQ 有哪些消息可靠性保障机制？

| 机制 | 说明 |
|------|------|
| Publisher Confirms | 生产者发送确认 |
| Publisher Returns | 无法路由确认 |
| 持久化 | Exchange、Queue、Message 持久化 |
| Consumer Acknowledgements | 消费者手动确认 |
| 死信队列 | 处理失败的消息专门处理 |
| 消息追踪 | 开启 Tracing 插件追踪消息 |

## 二、交换机与路由相关

### Q5：RabbitMQ 有哪些交换机类型？

| 类型 | 路由规则 | 特点 |
|------|---------|------|
| Direct | 精确匹配路由键 | 一对一 |
| Fanout | 忽略路由键，广播 | 一对多 |
| Topic | 通配符匹配 | 灵活路由 |
| Headers | 匹配消息头 | 不常用 |

**参考回答**：

> RabbitMQ 有四种交换机类型：
>
> - **Direct**：精确匹配，路由键和绑定键完全相等才投递。适合一对一的消息路由。
>
> - **Fanout**：广播，忽略路由键，所有绑定的队列都收到消息。适合通知类场景。
>
> - **Topic**：模糊匹配，支持 `*` 匹配一个词，`#` 匹配零个或多个词。适合灵活的消息分类。
>
> - **Headers**：根据消息头匹配，实际很少用。

### Q6：消息无法路由到队列会怎样？

默认情况下，消息会**直接丢弃**。

如果设置了 `mandatory=true`，会触发 `ReturnListener` 回调：

```java
channel.addReturnListener((replyCode, replyText, exchange,
                            routingKey, properties, body) -> {
    // 消息无法路由，在这里做补救处理
    log.warn("消息无法路由: {}", routingKey);
});

channel.basicPublish("exchange", "no-match", true, null, message.getBytes());
// 第二个参数 true 表示开启 mandatory
```

### Q7：Fanout 和 Topic 都能实现广播，有什么区别？

| 类型 | 广播能力 | 灵活性 |
|------|---------|--------|
| Fanout | 无条件广播 | 低 |
| Topic | 有条件广播 | 高 |

Topic 更灵活，可以选择性地接收消息。

## 三、队列与消息相关

### Q8：消息堆积怎么办？

消息堆积的常见原因：

1. 消费者挂了
2. 消费者处理速度慢
3. 生产速度 > 消费速度

**解决方案**：

```java
// 1. 增加消费者
@Bean
public SimpleRabbitListenerContainerFactory factory() {
    SimpleRabbitListenerContainerFactory factory = new SimpleRabbitListenerContainerFactory();
    factory.setConnectionFactory(connectionFactory);
    factory.setConcurrentConsumers(5);  // 增加并发
    factory.setMaxConcurrentConsumers(10);
    return factory;
}

// 2. 使用 Lazy Queue（消息直接落盘）
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-queue-type", "lazy");
channel.queueDeclare("queue", true, false, false, args);

// 3. 配置队列最大长度
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-max-length", 100000);  // 超过后丢弃旧消息
channel.queueDeclare("queue", true, false, false, args);
```

### Q9：如何实现延迟队列？

两种方案：

**方案一：TTL + 死信队列**

```java
// 延迟队列设置 TTL，消息过期后进入死信队列
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-message-ttl", 30000);  // 30 秒
args.put("x-dead-letter-exchange", "dlx.exchange");
channel.queueDeclare("delay.queue", true, false, false, args);
```

**方案二：延迟交换机插件（推荐）**

```bash
rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

```java
// 声明延迟交换机
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-delayed-type", "direct");
channel.exchangeDeclare("delay.exchange", "x-delayed-message", true, false, args);

// 发送消息时设置延迟时间
AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
    .headers(Map.of("x-delay", 30000))  // 30 秒
    .build();
channel.basicPublish("delay.exchange", "routingKey", properties, message.getBytes());
```

### Q10：如何设计消息重试机制？

**不推荐无限重试**，会导致消息循环。

**推荐方案**：有限次数重试 + 死信队列

```java
@RabbitListener(queues = "order.queue")
public void processOrder(Message message, Channel channel) throws IOException {
    int retryCount = getRetryCount(message);

    try {
        doProcess(new String(message.getBody()));
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    } catch (Exception e) {
        if (retryCount < 3) {
            // 重试，重新入队
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), false, true);
        } else {
            // 超过重试次数，进入死信队列
            channel.basicNack(message.getMessageProperties().getDeliveryTag(), false, false);
        }
    }
}
```

## 四、集群与高可用相关

### Q11：RabbitMQ 集群有哪些模式？

| 模式 | 说明 | 特点 |
|------|------|------|
| 普通集群 | 队列只在一个节点 | 不保证高可用 |
| 镜像集群 | 队列在所有节点有副本 | 保证高可用，但有脑裂风险 |
| 仲裁队列 | Raft 共识算法实现 | 强一致，推荐使用 |

**参考回答**：

> RabbitMQ 有三种集群模式：
>
> - **普通集群**：队列只存在于一个节点，其他节点只保存元数据。优点是开销小，缺点是节点挂了队列就不可用。
>
> - **镜像集群**：队列在所有节点都有副本，通过策略配置。优点是高可用，缺点是网络分区时可能丢消息。
>
> - **仲裁队列**（推荐）：用 Raft 共识算法实现，强一致性，不会有脑裂问题。RabbitMQ 3.8+ 推荐使用。

### Q12：仲裁队列为什么需要至少 3 个节点？

仲裁队列使用 Raft 共识算法，需要**多数节点**（过半数）确认才能写入。

- 2 节点：容忍 0 节点故障（1 节点挂了就没法确认了）
- 3 节点：容忍 1 节点故障（多数 = 2）
- 5 节点：容忍 2 节点故障（多数 = 3）

所以 Raft 要求**奇数个节点**，最少 3 个。

### Q13：Kafka 和 RabbitMQ 怎么选？

| 维度 | RabbitMQ | Kafka |
|------|----------|-------|
| 核心定位 | 消息代理 | 流平台 |
| 吞吐量 | 中（万级） | 高（百万级） |
| 路由能力 | 强大 | 弱 |
| 消息回溯 | 不支持 | 支持 |
| 适用场景 | 业务消息 | 日志、大数据 |

**参考回答**：

> 两者定位不同：
>
> - **RabbitMQ**：智能的消息代理，适合业务消息场景。核心优势是灵活的路由、死信队列、事务消息等。
>
> - **Kafka**：高性能的流平台，适合大数据场景。核心优势是超高吞吐、日志持久化、事件回溯。
>
> 选型建议：
>
> - 业务系统（订单、支付、通知）→ RabbitMQ
> - 数据系统（日志、分析、CDC）→ Kafka

## 五、进阶问题

### Q14：RabbitMQ 的内存和磁盘是怎么管理的？

RabbitMQ 使用**分段存储**管理消息：

1. 消息先写入内存缓冲区
2. 缓冲区满了或定时触发，写入磁盘
3. 读取时从磁盘加载

当内存或磁盘不足时：

| 情况 | 处理方式 |
|------|---------|
| 内存不足 | 阻塞生产者、触发 GC |
| 磁盘不足 | 拒绝新消息、发送告警 |

### Q15：RabbitMQ 的 prefetch 是干什么的？

Prefetch 控制消费者**预取**的消息数量：

```java
// 设置 prefetch = 10
channel.basicQos(10);
```

- prefetch = 1：公平分发，消费者处理完一条才能拿下一条
- prefetch = 10：允许预取 10 条，处理中也可以继续拿
- prefetch = 0：不限制，可能导致消费者负载不均

### Q16：如何排查 RabbitMQ 问题？

常用命令：

```bash
# 查看集群状态
rabbitmqctl cluster_status

# 查看队列信息
rabbitmqctl list_queues name messages consumers

# 查看连接
rabbitmqctl list_connections user peer_host state

# 查看内存使用
rabbitmqctl status | grep memory

# 查看磁盘空间
rabbitmqctl status | grep disk

# 查看消息堆积
rabbitmqctl list_queues name messages

# 重启应用（不重启 Erlang VM）
rabbitmqctl stop_app && rabbitmqctl start_app

# 同步队列（镜像队列）
rabbitmqctl sync_queue queue_name
```

## 六、面试总结

RabbitMQ 面试的核心知识点：

```
┌─────────────────────────────────────────────────────────────────┐
│                    RabbitMQ 面试知识图谱                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  可靠性保障                                                        │
│  ├── Confirm 机制（生产者确认）                                     │
│  ├── Return 机制（路由确认）                                       │
│  ├── 持久化（Exchange + Queue + Message）                        │
│  ├── 手动 ACK（消费者确认）                                        │
│  └── 幂等处理（防止重复消费）                                      │
│                                                                  │
│  核心组件                                                          │
│  ├── Exchange（交换机）：Direct/Fanout/Topic/Headers              │
│  ├── Queue（队列）：持久化、TTL、死信                              │
│  ├── Binding（绑定）：路由规则                                    │
│  └── Message（消息）：属性、持久化、优先级                          │
│                                                                  │
│  高级特性                                                          │
│  ├── 死信队列（DLX）：处理失败消息                                 │
│  ├── 延迟队列：定时任务、消息延迟                                   │
│  ├── Prefetch：消费限流                                           │
│  └── 消息补偿：定时扫描未确认消息                                   │
│                                                                  │
│  高可用                                                            │
│  ├── 普通集群：元数据同步                                          │
│  ├── 镜像集群：主从同步（有脑裂风险）                               │
│  ├── 仲裁队列：Raft 共识（推荐）                                   │
│  └── 负载均衡：HAProxy + Keepalived                               │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

记住一个核心原则：

> **RabbitMQ 是「智能路由中心」，Kafka 是「高速日志总线」。**
>
> 理解这个定位，很多选择和问题都能推导出来。

---

文档到这里就全部完成了。如果你想继续学习，可以：

- 查看 [Kafka 文档](/middleware/kafka/high-performance) 了解 Kafka 的高性能设计
- 查看 [分布式消息队列](/distributed/mq) 了解消息队列的通用设计原则

祝你面试顺利！
