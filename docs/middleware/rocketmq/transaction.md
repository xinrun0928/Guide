# RocketMQ 事务消息：半消息与事务状态回查

上一节我们提到了事务消息的核心思想：本地事务和消息发送「原子化」。但有一个关键问题还没解决：

**如果本地事务成功了，确认消息的指令却没发出去怎么办？**

Broker 不知道本地事务到底成功了没，这条半消息就这么「卡」在那——对 Consumer 不可见，永远等下去。

RocketMQ 的答案是：**事务状态回查**。

---

## 从一个生活中的类比说起

想象你在网上买了一件商品，选择了「货到付款」。

1. 你下了订单（相当于发送半消息）
2. 卖家发货，商品在路上（相当于本地事务执行中）
3. 你收到货，确认收货（相当于提交/回滚消息）

但如果商品送到时你恰好不在家，快递员怎么办？

他会打电话问你：「货到了，你到底要不要？」

这就是「回查」的精髓——**主动确认，而不是干等**。

---

## 事务消息的完整流程

先来看一张完整的时序图：

```
Producer                          Broker                          Consumer
   │                                │                               │
   │──── 发送半消息 ───────────────▶│                               │
   │◀─── 半消息发送成功 ────────────│                               │
   │                                │                               │
   │     执行本地事务                 │                               │
   │     （扣款、写库）              │                               │
   │                                │                               │
   │──── 提交/回滚 ───────────────▶│                               │
   │                                │                               │
   │                        ┌───────┴───────┐                       │
   │                        │  事务状态未知？│                       │
   │                        │  定时回查Producer│                      │
   │                        └───────┬───────┘                       │
   │                                │                               │
   │◀─────── 回查请求 ─────────────│                               │
   │─────── 返回事务状态 ──────────▶│                               │
   │                                │                               │
   │                        ┌───────┴───────┐                       │
   │                        │ 确认/回滚半消息 │                       │
   │                        └───────┬───────┘                       │
   │                                │                               │
   │                                │─────── 消息可见 ──────────────▶│
```

### 三种事务状态

Producer 返回给 Broker 的事务状态有三种：

1. **COMMIT_MESSAGE**：本地事务成功，提交半消息，Consumer 可以消费
2. **ROLLBACK_MESSAGE**：本地事务失败，回滚半消息，消息被丢弃
3. **UNKNOWN**：不确定发生了什么，需要 Broker 回查

---

## 为什么需要 UNKNOWN 状态？

想象这个场景：

```
1. 本地事务执行成功
2. Producer 发送 COMMIT_MESSAGE 给 Broker
3. 网络抖动！Broker 没收到 COMMIT_MESSAGE
4. Broker 不知道本地事务成功了
5. 这条消息永远卡在半消息状态
```

这时，UNKNOWN 就派上用场了。当 Broker 长时间没收到确认，它会主动问 Producer：「你那边到底怎么样了？」

Broker 的回查机制：

```
Broker                        Producer
   │                              │
   │──── 定时任务：扫描半消息 ────▶│
   │                              │
   │◀─── checkLocalTransaction ───│
   │     （查询本地事务状态）        │
   │                              │
   │    本地事务已提交？            │
   │    └─ COMMIT_MESSAGE ────────│
   │    本地事务已回滚？            │
   │    └─ ROLLBACK_MESSAGE ──────│
   │    本地事务状态未知？          │
   │    └─ UNKNOWN + 延迟回查      │
```

---

## 回查机制的实现细节

### Broker 端：定时扫描半消息

Broker 启动时，会启动一个定时任务，定期扫描「状态未知的半消息」：

- 扫描间隔：由 `transactionCheckInterval` 配置，默认 6 秒
- 检查时间：由 `transactionTimeOut` 配置，默认 6 秒——半消息超过这个时间没收到确认，就触发回查
- 最大回查次数：由 `transactionCheckMax` 配置，默认 15 次

### Producer 端：实现事务状态查询

```java
public class TransactionListenerImpl implements TransactionListener {
 // 执行本地事务
 @Override
 public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
 try {
 // 开启数据库事务
 connection.setAutoCommit(false);
 
 // 1. 扣减账户余额
 accountMapper.deductBalance((String) arg, 100);
 
 // 2. 记录流水
 transactionLogMapper.insert((String) arg, "扣款");
 
 // 3. 提交事务
 connection.commit();
 return LocalTransactionState.COMMIT_MESSAGE;
 } catch (Exception e) {
 // 失败则回滚
 connection.rollback();
 return LocalTransactionState.ROLLBACK_MESSAGE;
 }
 }
 
 // 事务回查
 @Override
 public LocalTransactionState checkLocalTransaction(MessageExt msg) {
 // 主动查询本地事务状态表
 TransactionLog log = transactionLogMapper.selectById(msg.getTransactionId());
 if (log != null) {
 // 事务日志存在，说明本地事务已提交
 return LocalTransactionState.COMMIT_MESSAGE;
 } else {
 // 事务日志不存在，可能本地事务失败了
 return LocalTransactionState.ROLLBACK_MESSAGE;
 }
 }
}
```

**关键点**：回查时，Producer 要能「重新查询」本地事务状态。这通常需要一张「事务状态表」，记录每笔事务的执行结果。

### 回查失败怎么办？

Broker 会不断回查，直到：

1. Producer 返回确定状态（COMMIT 或 ROLLBACK）
2. 回查次数超过 `transactionCheckMax`（默认 15 次）

超过最大次数后，半消息会被**自动回滚**，不会无限重试。

---

## 幂等性：Consumer 的必修课

事务消息还有一个特点：**Consumer 可能会收到重复消息**。

为什么？考虑这个场景：

```
1. 本地事务成功
2. Producer 发送 COMMIT_MESSAGE 给 Broker
3. Broker 提交半消息，通知 Consumer
4. Consumer 消费成功
5. Consumer 发送 ACK 给 Broker
6. 网络抖动！Broker 没收到 ACK
7. Broker 重新投递消息
8. Consumer 又收到同一条消息
```

所以，Consumer 端**必须实现幂等性**。

### 幂等性实现方案

**方案一：业务表唯一键**

```java
consumer.registerMessageListener(new MessageListenerConcurrently() {
 @Override
 public ConsumeConcurrentlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeConcurrentlyContext context) {
 for (MessageExt msg : msgs) {
 String transactionId = msg.getTransactionId();
 String body = new String(msg.getBody());
 
 // 检查是否已处理过（幂等性保证）
 TransactionLog existing = transactionLogMapper.selectByTransactionId(transactionId);
 if (existing != null) {
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
 
 // 执行业务逻辑：发放优惠券
 couponService.grantCoupon(body);
 
 // 记录处理日志
 transactionLogMapper.insert(transactionId, body);
 }
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
});
```

**方案二：数据库唯一索引**

把 `transactionId` 作为唯一索引，插入重复记录时会抛异常，捕获即可。

**方案三：分布式锁**

用 Redis 或 Zookeeper 加锁，保证同一笔消息只处理一次。性能较差，适合对数据一致性要求极高的场景。

---

## 与 Kafka/RabbitMQ 的对比

| 特性 | RocketMQ | Kafka | RabbitMQ |
|-----|----------|-------|----------|
| **事务消息** | 原生支持（半消息 + 回查） | 0.11+ 支持，但只是「事务幂等性」 | 需要插件或手动实现 |
| **本地事务与消息原子化** | 支持 | 不支持（只保证不丢，不保证原子） | 需要手动补偿 |
| **回查机制** | Broker 主动回查 | 无 | 无 |

### Kafka 的「伪事务」

Kafka 0.11 引入了事务 API，但它的设计目标是「 Exactly Once 语义」，不是「本地事务与消息发送原子化」。

Kafka 事务的工作方式：

```
1. 开启事务
2. 发送消息到多个 Topic
3. 提交事务（要么全成功，要么全失败）
```

这解决的是「多 Topic 之间的原子性」，而不是「本地数据库事务与消息发送的原子性」。

---

## 配置建议

生产环境使用事务消息，以下参数需要调整：

```java
// Broker 配置
// transactionCheckInterval: 回查间隔，默认 6 秒
// transactionTimeOut: 超时时间，默认 6 秒
// transactionCheckMax: 最大回查次数，默认 15 次

// Producer 配置
// checkThreadPoolMinSize: 最小回查线程，默认 1
// checkThreadPoolMaxSize: 最大回查线程，默认 1
// checkRequestHoldMax: 单机待回查请求上限，默认 2000
```

如果回查压力大，可以适当增加 `checkThreadPoolMaxSize`。

---

## 留给你的问题

事务消息保证了「本地事务和消息发送的原子性」，但它没有解决另一个问题：**Consumer 消费失败怎么办？**

RocketMQ 会自动重试消费失败的消息，但如果消费始终失败（如业务异常），消息会进入「重试队列」。重试队列也失败了呢？

下一节，我们来聊聊 RocketMQ 的[顺序消息](/middleware/rocketmq/ordered-message)，看看它是怎么保证消息按顺序消费的。
