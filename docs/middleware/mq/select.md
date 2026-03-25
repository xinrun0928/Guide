# Kafka vs RabbitMQ vs RocketMQ 选型指南

「我们系统用 Kafka 好还是 RabbitMQ 好？」

这个问题，没有标准答案。但有**正确的问题**。

选型不是选「最好的」，而是选「最合适的」。今天我们聊聊这三个主流 MQ 的特点，以及如何做出选择。

---

## 先说结论：快速决策树

```
你的场景是什么？
│
├─ 日志采集、大数据、实时流处理
│  └─► Kafka（为大数据而生，吞吐量王者）
│
├─ 复杂路由（如多个消费者按规则订阅不同消息）
│  └─► RabbitMQ（灵活的 Exchange 路由）
│
├─ 事务消息、延迟消息、顺序消息（电商核心链路）
│  └─► RocketMQ（阿里双十一验证，功能最全面）
│
├─ 要求极低延迟（< 10ms）
│  └─► RabbitMQ（内存队列，延迟最低）
│
├─ 消息量极大（百万/秒以上）
│  └─► Kafka（横向扩展能力最强）
│
└─ 团队技术栈主要是 Java
   └─► RocketMQ / Kafka（都比 RabbitMQ 更容易运维）
```

---

## 三大 MQ 横向对比

### 核心参数对比

| 维度 | Kafka | RabbitMQ | RocketMQ |
|-----|-------|----------|----------|
| **吞吐量** | 百万级/秒 | 万级/秒 | 十万级/秒 |
| **延迟** | 毫秒级 | 微秒级（最低） | 毫秒级 |
| **消息持久化** | 支持 | 支持 | 支持 |
| **集群模式** | 原生分布式 | 普通集群/镜像集群 | 主从/DLedger |
| **消息顺序** | 单分区有序 | 队列有序 | 单分区有序/全局有序 |
| **事务消息** | 不支持（仅保证幂等） | 不支持 | 原生支持 |
| **延迟消息** | 需借助组件 | 插件支持 | 原生支持（延迟等级） |
| **消费模式** | Pull | Push/Pull | Pull |
| **死信队列** | 无（需手动实现） | 原生支持 | 原生支持 |
| **多租户** | 不支持 | 支持 | 支持 |
| **官方维护** | Apache | VMware/Pivotal | Alibaba/Apache |
| **社区活跃度** | 非常活跃 | 活跃 | 较活跃 |
| **Java 客户端** | 官方支持 | 官方支持 | 官方支持 |
| **其他语言客户端** | 多 | 多 | 较少 |

---

## Kafka：吞吐量王者

### 定位与特点

Kafka 最初是 LinkedIn 内部用来处理日志的系统，后来贡献给 Apache 成为顶级项目。它的设计目标就是**高吞吐量**，为此牺牲了一些「企业级特性」。

### 适用场景

```
✓ 日志收集与聚合
✓ 大数据实时流处理（Spark、Flink）
✓ 消息管道（ETL）
✓ 活动追踪（用户行为分析）
✓ 监控系统（Metrics 收集）

✗ 需要复杂路由的业务系统
✗ 对消息延迟极度敏感（< 5ms）
✗ 需要事务消息的场景
```

### 架构特点

```
Producer ──► Topic ──► Partition（分布在多个 Broker）
                    │
                    ├── Replication（副本机制）
                    │
                    └── Consumer Group（消费组）

核心设计：
• 顺序写磁盘 + Page Cache
• 零拷贝（sendfile）
• 批量发送 + 批量消费
• 长期存储（可配置保留时间）
```

### 典型配置

```java
// Kafka 生产者配置
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("acks", "all");                    // 最强可靠性
props.put("retries", 3);                     // 重试次数
props.put("batch.size", 16384);              // 批量大小
props.put("linger.ms", 10);                  // 等待时间
props.put("buffer.memory", 33554432);         // 32MB 缓冲

KafkaProducer&lt;String, String&gt; producer = new KafkaProducer&lt;&gt;(props);
```

---

## RabbitMQ：灵活路由的代表

### 定位与特点

RabbitMQ 基于 AMQP 协议，设计哲学是**灵活**。它用 Exchange + Binding + Queue 的模型，实现了非常复杂的消息路由。

### 适用场景

```
✓ 复杂路由规则（多个消费者按不同规则订阅）
✓ 任务队列（异步任务分发）
✓ 请求/响应模式
✓ 需要事务支持的场景（配合消息确认）
✓ 低延迟场景（内存队列）

✗ 超高吞吐量场景（Kafka 更擅长）
✗ 大数据场景（日志、埋点）
✗ 需要事务消息的场景
```

### 架构特点

```
Producer ──► Exchange ──► Binding ──► Queue ──► Consumer
                  │
                  ├── Direct（精确匹配）
                  ├── Fanout（广播）
                  ├── Topic（通配符匹配）
                  └── Headers（属性匹配）
```

### 灵活路由示例

```java
// 场景：订单系统需要根据订单类型分发到不同处理队列
// 普通订单 ──► 库存服务
// 预售订单 ──► 预售处理服务
// 团购订单 ──► 团购处理服务
// 所有订单 ──► 日志服务（都需要记录）

// 1. 定义 Exchange
channel.exchangeDeclare("order-exchange", BuiltinExchangeType.TOPIC);

// 2. 定义 Queue
channel.queueDeclare("inventory-queue", true, false, false, null);
channel.queueDeclare("presell-queue", true, false, false, null);
channel.queueDeclare("groupbuy-queue", true, false, false, null);
channel.queueDeclare("log-queue", true, false, false, null);

// 3. Binding 规则
channel.queueBind("inventory-queue", "order-exchange", "order.normal");
channel.queueBind("presell-queue", "order-exchange", "order.presell");
channel.queueBind("groupbuy-queue", "order-exchange", "order.groupbuy");
channel.queueBind("log-queue", "order-exchange", "order.*");  // 接收所有订单

// 4. 发送消息
channel.basicPublish("order-exchange", "order.normal",
    MessageProperties.PERSISTENT_TEXT_PLAIN,
    orderMessage.getBytes());
```

### 延迟消息实现

RabbitMQ 通过**死信队列 + 延迟插件**实现延迟消息：

```java
// 1. 设置消息的 x-delay 头（需要延迟插件）
AMQP.BasicProperties properties = new AMQP.BasicProperties.Builder()
    .deliveryMode(2)  // 持久化
    .expiration("60000")  // 60 秒后变为死信
    .build();

// 2. 消息进入延迟交换机，投递到死信队列时就是延迟后的时间
channel.basicPublish("delayed-exchange", routingKey, properties, message);
```

---

## RocketMQ：功能最全面的选择

### 定位与特点

RocketMQ 是阿里巴巴双十一的核心消息组件，专门为电商场景打造。它**弥补了 Kafka 在功能上的不足**，原生支持事务消息、延迟消息、顺序消息等电商核心场景需要的能力。

### 适用场景

```
✓ 电商核心链路（订单、库存、支付）
✓ 需要事务消息（本地事务 + 消息原子性）
✓ 需要延迟消息（订单超时取消）
✓ 需要顺序消息（同一订单的消息按顺序处理）
✓ 金融级可靠消息

✗ 大数据场景（Kafka 更专业）
✗ 简单任务队列（RabbitMQ 更轻量）
```

### 架构特点

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Producer  │────►│  NameServer │◄────│   Broker    │
│  (生产者)    │     │  (协调中心)   │     │  (存储中心)   │
└─────────────┘     └─────────────┘     └─────────────┘
                                                  │
                                                  ├── Master（主节点）
                                                  └── Slave（从节点）

NameServer：
• 轻量级注册中心
• 各 Broker 定期上报状态
• 无 Leader，无选举

Broker：
• 单个 Master 对应多个 Slave
• 通过 Dledger 实现自动切换
```

### 事务消息：电商场景的杀手锏

```java
// RocketMQ 事务消息：保证本地事务与消息发送的原子性
public class OrderService {

    private final TransactionMQProducer producer;

    /**
     * 下单并发送事务消息
     * 核心：先发送半消息，事务成功后确认，失败后回滚
     */
    public void createOrder(Order order) {
        // 1. 执行本地事务
        Transaction transaction = producer.beginTransaction();

        try {
            // 扣库存
            inventoryService.deduct(order.getItems());

            // 创建订单
            Order created = orderRepository.save(order);

            // 2. 发送事务消息
            // 如果这里成功，消息处于「待确认」状态
            // 如果这里失败，整个事务回滚
            Message message = new Message("order-topic",
                order.toJson().getBytes());
            producer.sendMessageInTransaction(message, transaction, created);

            // 3. 提交本地事务
            transaction.commit();

        } catch (Exception e) {
            // 4. 回滚本地事务
            transaction.rollback();
            throw e;
        }
    }
}

// 事务状态回查
public class TransactionListenerImpl implements TransactionListener {

    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        // 本地事务执行结果
        // 如果返回 UNKNOWN，RocketMQ 会定时回查这个接口
        return LocalTransactionState.COMMIT_MESSAGE;
    }

    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        // 回查逻辑：检查本地事务是否真的执行成功了
        String orderId = msg.getKeys();
        Order order = orderRepository.findById(orderId);

        if (order != null && order.isPaid()) {
            return LocalTransactionState.COMMIT_MESSAGE;  // 确认消息
        } else if (order != null) {
            return LocalTransactionState.ROLLBACK_MESSAGE;  // 回滚消息
        } else {
            return LocalTransactionState.UNKNOWN;  // 继续等待
        }
    }
}
```

### 延迟消息：订单超时取消

```java
// RocketMQ 延迟消息：下单后 15 分钟未支付自动取消
public class OrderService {

    private final RocketMQTemplate rocketMQTemplate;

    public void createOrder(Order order) {
        // 创建订单（待支付状态）
        Order created = orderRepository.save(order);

        // 发送延迟消息：15 分钟后检查支付状态
        // RocketMQ 支持 18 个延迟等级：1s, 5s, 10s, 30s, 1m, 2m, ...
        // 也可以自定义延迟时间
        Message&lt;Order&gt; message = MessageBuilder.withPayload(created)
            .setHeader("orderId", created.getId())
            .build();

        // 延迟等级 3 = 10 秒（测试用），生产环境用更长的延迟
        rocketMQTemplate.asyncSend("order-delay-topic", message,
            new SendCallback() {
                @Override
                public void onSuccess(SendResult result) {
                    log.info("延迟消息发送成功");
                }

                @Override
                public void onException(Throwable e) {
                    log.error("延迟消息发送失败", e);
                }
            }, 3000, 3);  // 超时 3 秒，延迟等级 3
    }
}

// 延迟消息消费者
@RocketMQMessageListener(
    topic = "order-delay-topic",
    consumerGroup = "order-cancel-group"
)
public class OrderCancelConsumer implements RocketMQListener&lt;Order&gt; {

    @Override
    public void onMessage(Order order) {
        // 检查订单是否已支付
        Order current = orderRepository.findById(order.getId());

        if (current.isPaid()) {
            log.info("订单已支付，无需取消: {}", order.getId());
            return;
        }

        // 未支付，取消订单
        current.setStatus(OrderStatus.CANCELLED);
        current.setCancelReason("超时未支付");
        orderRepository.save(current);

        // 恢复库存
        inventoryService.restore(order.getItems());

        log.info("订单超时取消: {}", order.getId());
    }
}
```

---

## 选型决策矩阵

| 你的优先级 | 推荐选择 | 原因 |
|-----------|---------|-----|
| **吞吐量 > 一切** | Kafka | 专为高吞吐设计，其他 MQ 无法比拟 |
| **延迟 < 10ms** | RabbitMQ | 内存队列，延迟最低 |
| **功能完整性** | RocketMQ | 事务、延迟、顺序全支持 |
| **运维简单** | RabbitMQ | 单节点即可运行，配置简单 |
| **大数据生态** | Kafka | 与 Spark、Flink 深度集成 |
| **Java 团队** | RocketMQ / Kafka | 文档、社区都以 Java 为主 |
| **多租户** | RocketMQ / RabbitMQ | 原生支持多租户隔离 |
| **消息可靠性** | RocketMQ | 事务消息保证原子性 |

---

## 面试追问

**面试官可能会问：**

1. 「既然 Kafka 吞吐量这么高，为什么 RabbitMQ 还能存活？」—— 因为不是所有场景都需要百万 QPS，RabbitMQ 的灵活路由和低延迟有自己的人群
2. 「RocketMQ 的事务消息是怎么实现的？」—— 半消息 + 本地事务 + 事务状态回查
3. 「如果让你设计一个 MQ，你会怎么设计？」—— 可以从持久化、路由、消费模式这几个角度展开

选型没有绝对的对错，但**必须有清晰的决策依据**。知道每个 MQ 的特点和适用场景，比记住配置参数更重要。
