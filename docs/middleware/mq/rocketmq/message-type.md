# RocketMQ 消息类型：一条消息能玩出什么花样？

大多数时候，我们用消息队列就是「发一条，收一条」。

但业务场景远比这复杂：下单流程要求「先扣库存、再扣钱包」，必须按顺序执行；优惠券发放要在用户注册 24 小时后才生效；分布式事务要求「本地事务和消息发送要么同时成功，要么同时失败」。

**RocketMQ 的答案是：一条消息，四种玩法。**

---

## 普通消息：最基础的「发收」模式

这是最简单的一种消息类型，Producer 发，Consumer 收，没有任何特殊约束。

### 使用场景

- 日志收集：应用运行日志实时上传到日志系统
- 通知推送：用户行为触发后，向下游系统发送通知
- 异步处理：将同步调用拆分为异步消息，提高接口响应速度

### 代码示例

```java
// 定义 Topic 和消息内容
Message msg = new Message(
 "TopicTest",  // Topic
 "TagA",       // 标签，用于消息过滤
 "Hello RocketMQ".getBytes()  // 消息体
);

// 同步发送：最常用的方式
SendResult result = producer.send(msg);
System.out.println("发送状态: " + result.getSendStatus());
System.out.println("消息ID: " + result.getMsgId());

// 消费端
consumer.registerMessageListener(new MessageListenerConcurrently() {
 @Override
 public ConsumeConcurrentlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeConcurrentlyContext context) {
 for (MessageExt msg : msgs) {
 System.out.println("收到消息: " + new String(msg.getBody()));
 }
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
});
```

**普通消息的特点：**

| 特性 | 说明 |
|-----|------|
| 发送方式 | 支持同步、异步、单向发送 |
| 消费模式 | 集群消费（默认），消息均摊 |
| 顺序性 | 不保证消息顺序 |
| 事务性 | 不支持回滚 |

---

## 顺序消息：让消息「排队」执行

### 为什么要顺序消息？

来看一个经典场景：**秒杀订单处理**。

用户下单后，系统要依次处理：创建订单 → 扣减库存 → 扣减余额 → 发送通知。

如果这些操作的消息被不同的 Consumer 并行处理，会发生什么？

```
消息1: 创建订单（订单号 1001，库存 10）
消息2: 扣减库存（订单号 1001，库存 -1）
消息3: 扣减余额（订单号 1001，金额 -100）

理想情况（顺序消费）：
消息1 → 消息2 → 消息3（订单 1001 完整处理）

实际情况（并行消费）：
Consumer A 处理消息2（扣库存）
Consumer B 处理消息1（创建订单）
Consumer C 处理消息3（扣余额）

结果：余额扣了，但订单还没创建！
```

顺序消息，就是为了解决这种「乱序导致业务错误」的问题。

### 单 Queue 全局顺序 vs 分区顺序

RocketMQ 的顺序消息有两种模式，它们解决的是不同的问题：

| 模式 | 说明 | 实现方式 |
|-----|------|---------|
| **全局顺序** | 一个 Topic 所有消息严格按发送顺序消费 | Topic 只有 1 个 Queue，所有消息都往这一个 Queue 发 |
| **分区顺序** | 同一批次的消息按顺序消费，不同批次可并行 | 按消息的某个字段（如订单号）哈希到不同 Queue，同一批次在同一 Queue |

```
全局顺序（1 个 Queue）：
┌────────────────────────────────────┐
│  Queue 0                           │
│  Msg-1 → Msg-2 → Msg-3 → Msg-4 ... │
└────────────────────────────────────┘

分区顺序（多个 Queue，同一订单顺序）：
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Queue 0    │  │  Queue 1    │  │  Queue 2    │
│  订单-001    │  │  订单-002    │  │  订单-003    │
│  Msg-A→B→C  │  │  Msg-A→B→C  │  │  Msg-A→B→C  │
└──────────────┘  └──────────────┘  └──────────────┘
```

**什么时候用哪种？**

- **全局顺序**：适合低吞吐量场景，如数据库变更日志同步。全局顺序牺牲了并发能力，所有消息只能串行处理。
- **分区顺序**：适合高并发场景，如订单处理。同一个订单的消息顺序执行，不同订单的消息可以并行处理。

### 代码示例

```java
// 生产者：按订单 ID 哈希，保证同一订单的消息发到同一 Queue
Message msg = new Message("OrderTopic", orderId, "创建订单".getBytes());
// 使用 MessageQueueSelector 指定队列
producer.send(msg, new MessageQueueSelector() {
 @Override
 public MessageQueue select(List&lt;MessageQueue&gt; mqs, Message msg, Object arg) {
 // 按订单 ID 哈希选择队列，同一订单的消息永远在同一个 Queue
 String orderId = (String) arg;
 int hash = orderId.hashCode();
 return mqs.get(Math.abs(hash % mqs.size()));
 }
}, orderId);  // 第三个参数会传给 select 方法的 arg

// 消费者：使用 MessageListenerOrderly 确保顺序消费
consumer.registerMessageListener(new MessageListenerOrderly() {
 @Override
 public ConsumeOrderlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeOrderlyContext context) {
 // RocketMQ 保证同一 Queue 内的消息串行消费
 for (MessageExt msg : msgs) {
 System.out.println("消费: " + new String(msg.getBody()));
 }
 return ConsumeOrderlyStatus.SUCCESS;
 }
});
```

---

## 事务消息：分布式事务的「第三种选择」

这是 RocketMQ 最具特色的功能，也是它区别于 Kafka、RabbitMQ 的核心优势。

### 为什么需要事务消息？

看一个经典问题：**用户支付成功后，需要同时记录支付流水和发放优惠券**。

如果用普通消息，流程是这样的：

```
1. 开启本地事务（记录支付流水）
2. 提交本地事务 ✓
3. 发送消息（发放优惠券） ✗ 消息发送失败！

结果：钱扣了，优惠券没发
```

用事务消息，流程变成这样：

```
1. 发送「半消息」（准备发送，还不可消费）
2. 开启本地事务（记录支付流水）
3. 提交本地事务 ✓
4. 确认发送「半消息」→ 消息对 Consumer 可见 ✓

如果本地事务失败：
3. 回滚本地事务
4. 发送「回滚」指令 → 半消息被丢弃
```

**核心思想：本地事务和消息发送「原子化」**——要么都成功，要么都失败。

### 半消息的奥秘

「半消息」（Half Message）是理解事务消息的关键。

```
普通消息：Producer → Broker → Consumer 可立即消费

事务消息：Producer → Broker（半消息，不可见）→ 本地事务 → 确认/回滚 → Consumer 可消费/丢弃
```

半消息存在 Broker 里，但对 Consumer 不可见。只有等 Producer 确认「本地事务成功了」，Broker 才会让消息对 Consumer 可见。

### 事务消息的代码示例

```java
// 生产者配置
TransactionMQProducer producer = new TransactionMQProducer("transaction_producer");
producer.setTransactionListener(new TransactionListener() {
 @Override
 public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
 // 执行本地事务，这里是扣钱逻辑
 String topic = msg.getTopic();
 String body = new String(msg.getBody());
 String tags = msg.getTags();
 
 // 根据业务状态决定提交还是回滚
 if ("SUCCESS".equals(tags)) {
 return LocalTransactionState.COMMIT_MESSAGE;  // 本地成功，确认消息
 } else if ("ROLLBACK".equals(tags)) {
 return LocalTransactionState.ROLLBACK_MESSAGE;  // 本地失败，丢弃消息
 } else {
 return LocalTransactionState.UNKNOWN;  // 不确定，触发回查
 }
 }
 
 @Override
 public LocalTransactionState checkLocalTransaction(MessageExt msg) {
 // 事务回查：当 executeLocalTransaction 返回 UNKNOWN 时调用
 // 主动查询本地事务状态，决定消息命运
 return LocalTransactionState.COMMIT_MESSAGE;
 }
});

// 发送事务消息
Message msg = new Message("TransactionTopic", "SUCCESS", "扣款成功".getBytes());
TransactionSendResult result = producer.sendMessageInTransaction(msg, null);
```

### 事务消息的局限性

事务消息虽然强大，但不是万能的：

1. **不支持延迟消息**：事务消息和延迟消息不能同时使用
2. **单向事务**：Consumer 消费失败不能回滚 Producer 的本地事务
3. **回查机制依赖**：必须实现 `checkLocalTransaction` 方法，防止本地事务成功后确认消息失败

---

## 延迟消息：让消息「等一会儿」再执行

### 使用场景

- 订单超时未支付，自动取消
- 用户注册后，30 分钟后发送欢迎短信
- 缓存预热：活动开始前 10 分钟，提前加载数据

### RocketMQ 延迟消息的实现

RocketMQ 的延迟消息不走「定时器」路线，而是**延迟等级**。

```
延迟等级 1: 1s
延迟等级 2: 5s
延迟等级 3: 10s
延迟等级 4: 30s
延迟等级 5: 1m
延迟等级 6: 2m
延迟等级 7: 5m
延迟等级 8: 10m
...
延迟等级 18: 2h
```

当消息设置了延迟等级后，Broker 会把它放到对应的 **SCHEDULE_TOPIC_XXX** 队列里，等时间到了再投递给消费者。

### 代码示例

```java
// 设置延迟等级（这里设置为等级 3，即 10 秒后投递）
Message msg = new Message("DelayTopic", "取消订单".getBytes());
// 延迟等级 1-18 对应不同延迟时间
msg.setDelayTimeLevel(3);

producer.send(msg);

// 消费者：正常消费即可
consumer.registerMessageListener(new MessageListenerConcurrently() {
 @Override
 public ConsumeConcurrentlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeConcurrentlyContext context) {
 // 10 秒后才会收到这条消息
 for (MessageExt msg : msgs) {
 System.out.println("收到延迟消息: " + new String(msg.getBody()));
 }
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
});
```

### 延迟消息的「小秘密」

你可能注意到：RocketMQ 的延迟等级是固定的几档，不是任意时间。

这是因为 RocketMQ 把延迟消息存在 **SCHEDULE_TOPIC_XXX** 的特定队列里，通过「时间轮」机制来触发投递。固定档位简化了实现，也带来了局限性：**不支持任意时长的延迟**。

如果需要秒级精度的延迟，可能需要考虑其他方案，或者直接用定时任务 + 普通消息。

---

## 四种消息类型的对比

| 类型 | 核心特性 | 适用场景 | 实现复杂度 |
|-----|---------|---------|-----------|
| **普通消息** | 无特殊约束 | 日志、通知、异步解耦 | 低 |
| **顺序消息** | 同一 Queue 内有序 | 订单处理、数据同步 | 中 |
| **事务消息** | 本地事务与发送原子化 | 分布式事务 | 高 |
| **延迟消息** | 定时投递 | 超时处理、任务调度 | 中 |

---

## 留给你的问题

事务消息解决了「本地事务和消息发送原子化」的问题，但还有一个细节：Broker 怎么知道 Producer 的本地事务到底成功还是失败了？

如果 Producer 发送确认消息后突然宕机，Broker 怎么判断这条消息的命运？

这就是下一节要聊的——[事务消息的半消息与事务状态回查](/middleware/rocketmq/transaction)。
