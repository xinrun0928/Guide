# RocketMQ 顺序消息：单 Queue 全局顺序 vs 分区顺序

先问一个问题：**「顺序消息」中的「顺序」，到底指什么？**

很多人会想当然地回答：「消息按发送顺序被消费」，这么简单。

但现实远比这复杂——**「按顺序发送」和「按顺序消费」是两回事**，而「顺序」在不同场景下的含义也完全不同。

这一节，我们来彻底搞清楚 RocketMQ 顺序消息的设计。

---

## 为什么要顺序消息？

先看一个没有顺序保障的场景：

**电商下单流程**

```
用户下单后，系统需要依次处理：
1. 创建订单（状态：待支付）
2. 扣减库存
3. 扣减余额（如果余额不足，订单应该被取消）
4. 发送通知
```

如果这些消息被并行消费，会发生什么？

```
Producer 发送顺序：
Msg-1: 创建订单（订单号 001，余额 100）
Msg-2: 扣减余额（订单号 001，扣 100，余额=0）
Msg-3: 检查库存（订单号 001）

Consumer 并行消费：
Consumer-A 处理 Msg-3：检查库存，有货！
Consumer-B 处理 Msg-1：创建订单成功
Consumer-C 处理 Msg-2：扣减余额，余额=0

最终结果：
订单创建成功，库存扣减成功，但余额已经归零——订单应该取消，却还是创建了！
```

问题的根源：**消息的处理有先后依赖，不能并行**。

---

## 两种顺序：全局顺序 vs 分区顺序

RocketMQ 提供了两种顺序模式，它们的设计目标完全不同。

### 全局顺序：最严格的「串行」

**定义**：一个 Topic 内的所有消息，严格按照发送顺序被消费。

```
Topic: OrderTopic（只有 1 个 Queue）

Producer 发送：  Msg-1 → Msg-2 → Msg-3 → Msg-4 → Msg-5
                                    ↓
Consumer 消费：  Msg-1 → Msg-2 → Msg-3 → Msg-4 → Msg-5
```

**特点**：

- Topic 必须只有 1 个 Queue
- 所有消息都串行处理，吞吐量极低
- 适用场景：数据库变更日志同步、需要严格保序的低吞吐场景

**缺点**：性能太差。如果 Topic 有 8 个 Queue，用全局顺序就等于只用 1 个。

### 分区顺序：业务维度的「有序」

**定义**：同一批次的的消息按顺序消费，不同批次可以并行。

这里的「同一批次」，通常指**同一个业务 ID**（如订单号）。

```
Topic: OrderTopic（4 个 Queue）

Queue-0:  订单-001 → 订单-001 → 订单-001 → ...
Queue-1:  订单-002 → 订单-002 → 订单-002 → ...
Queue-2:  订单-003 → 订单-003 → 订单-003 → ...
Queue-3:  订单-004 → 订单-004 → 订单-004 → ...

关键点：同一订单的消息一定在同一个 Queue 内，所以有序
不同订单的消息在不同 Queue，可以并行处理
```

**特点**：

- Topic 可以有多个 Queue
- 同一业务 ID 的消息有序，不同业务 ID 可并行
- 适用场景：订单处理、秒杀活动、同一用户的操作流水

---

## 分区顺序的实现原理

分区顺序的核心是**消息路由**：把同一业务 ID 的消息，发送到同一个 Queue。

### 消息路由策略

```java
// 生产者：自定义路由逻辑
Message msg = new Message("OrderTopic", orderId, "创建订单".getBytes());

producer.send(msg, new MessageQueueSelector() {
 @Override
 public MessageQueue select(List&lt;MessageQueue&gt; mqs, Message msg, Object arg) {
 // 按订单 ID 哈希，保证同一订单的消息落在同一个 Queue
 String orderId = (String) arg;
 int queueIndex = Math.abs(orderId.hashCode()) % mqs.size();
 return mqs.get(queueIndex);
 }
}, orderId);  // 传给 select 的参数
```

**为什么用哈希？** 哈希可以保证同一订单 ID 总是路由到同一个 Queue，同时不同订单 ID 能均匀分布到不同 Queue。

### 消费端的顺序保证

光发送端路由到同一个 Queue 还不够，消费端也必须保证**同一个 Queue 内的消息串行消费**。

```java
// 消费者：使用 MessageListenerOrderly（有序监听器）
consumer.registerMessageListener(new MessageListenerOrderly() {
 @Override
 public ConsumeOrderlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeOrderlyContext context) {
 // 关键：RocketMQ 保证同一 Queue 的消息串行处理
 // 不会出现并发消费同一个 Queue 的情况
 for (MessageExt msg : msgs) {
 String body = new String(msg.getBody());
 System.out.println("消费: " + body);
 }
 return ConsumeOrderlyStatus.SUCCESS;
 }
});
```

**MessageListenerOrderly 和 MessageListenerConcurrently 的区别**：

| 特性 | MessageListenerConcurrently | MessageListenerOrderly |
|-----|----------------------------|----------------------|
| 并发消费 | 支持，一个 Consumer 多个线程 | 不支持，同一 Queue 串行 |
| 消费速度 | 快 | 慢（因为串行） |
| 顺序保证 | 无 | 同一 Queue 内有序 |
| 适用场景 | 大部分业务（不需要顺序） | 需要顺序的场景 |

---

## 顺序消息的「坑」

分区顺序虽然高性能，但有几个容易踩的坑：

### 坑一：Queue 数量要合理

```
问题：如果只有 1 个 Queue，分区顺序 = 全局顺序，吞吐量暴跌
解决：Topic 创建时规划好 Queue 数量，建议是 Consumer 数量的整数倍
```

### 坑二：消息重复会破坏顺序

```
场景：Consumer 处理 Msg-1 成功，发送 ACK 失败，Broker 重发 Msg-1
结果：Consumer 又收到 Msg-1，可能出现重复处理

解决：Consumer 端必须实现幂等性，重复消息直接跳过
```

### 坑三：部分 Queue 负载过高

```
问题：如果某一业务 ID 的数据量特别大（如大 V 用户的操作），会导致 Queue 倾斜
解决：设计合理的路由 key，或者拆分为多个 Topic
```

---

## 实战：订单全流程顺序处理

来看一个完整的订单处理示例：

### 订单业务场景

```
用户下单后，系统需要依次处理：
1. 创建订单（扣库存）
2. 扣减余额
3. 记录流水
4. 发送通知

每个步骤都是一条消息，同一订单的消息必须有序处理。
```

### Producer 端

```java
public class OrderProducer {
 public void sendOrderSteps(String orderId, OrderStep step) {
 Message msg = new Message(
 "OrderTopic",
 orderId,  // 使用订单 ID 作为路由 key
 step.toString().getBytes()
 );
 
 // 按订单 ID 哈希路由，同一订单的所有消息落在同一 Queue
 producer.send(msg, new MessageQueueSelector() {
 @Override
 public MessageQueue select(List&lt;MessageQueue&gt; mqs, Message msg, Object arg) {
 String key = (String) arg;
 return mqs.get(Math.abs(key.hashCode()) % mqs.size());
 }
 }, orderId);
 }
 
 // 发送订单处理步骤
 public void processOrder(String orderId) {
 sendOrderSteps(orderId, OrderStep.CREATE);   // 创建订单
 sendOrderSteps(orderId, OrderStep.DEDUCT);    // 扣减余额
 sendOrderSteps(orderId, OrderStep.LOG);      // 记录流水
 sendOrderSteps(orderId, OrderStep.NOTIFY);   // 发送通知
 }
}
```

### Consumer 端

```java
public class OrderConsumer {
 consumer.registerMessageListener(new MessageListenerOrderly() {
 @Override
 public ConsumeOrderlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeOrderlyContext context) {
 // 从消息中解析订单 ID 和步骤类型
 for (MessageExt msg : msgs) {
 String body = new String(msg.getBody());
 String orderId = msg.getKeys();  // 消息 key = orderId
 OrderStep step = OrderStep.valueOf(body);
 
 // 执行业务逻辑（不同步骤不同处理）
 switch (step) {
 case CREATE:
 orderService.create(orderId);
 break;
 case DEDUCT:
 accountService.deduct(orderId);
 break;
 case LOG:
 logService.log(orderId);
 break;
 case NOTIFY:
 notificationService.notify(orderId);
 break;
 }
 }
 return ConsumeOrderlyStatus.SUCCESS;
 }
 });
}
```

### 顺序保证的流程图

```
Producer 按订单号哈希路由：

订单-001 ──┐
订单-001 ──┼──→ Queue-0 ──→ Consumer 处理（串行）
订单-001 ──┘           ↑
订单-002 ──────────────→ Queue-1 ──→ Consumer 处理（串行）
订单-003 ──────────────→ Queue-2 ──→ Consumer 处理（串行）

结果：同一订单的所有消息有序处理，不同订单可并行
```

---

## 全局顺序 vs 分区顺序：怎么选？

| 维度 | 全局顺序 | 分区顺序 |
|-----|---------|---------|
| **Queue 数量** | 只能 1 个 | 多个（推荐 4-16 个） |
| **吞吐量** | 低（等于单 Queue） | 高（等于多 Queue 并行） |
| **适用场景** | 数据库日志、低吞吐场景 | 高并发业务（订单、秒杀） |
| **实现难度** | 简单 | 中等（需要自定义路由） |

**经验法则**：

- 90% 的场景用**分区顺序**
- 只有低吞吐 + 严格全序的场景才用**全局顺序**

---

## 与 Kafka 的对比

| 特性 | RocketMQ | Kafka |
|-----|----------|-------|
| **分区顺序** | 同一分区有序 | 同一分区有序（同样的设计） |
| **全局顺序** | Topic 只有 1 个分区 | Topic 只有 1 个分区 |
| **有序监听器** | MessageListenerOrderly | 无，需要自己实现加锁 |

**本质上两者一样**：Kafka 通过 `Partition` 实现有序，RocketMQ 通过 `Queue` 实现有序。命名不同，原理相同。

---

## 留给你的问题

分区顺序解决了「同一业务 ID 消息的有序处理」，但还有一个问题：**如果某条消息消费失败了怎么办？**

顺序消息的特点是「串行处理」——一旦某条消息卡住，后面所有的消息都会被阻塞。

RocketMQ 怎么处理这种情况？重试机制会不会打乱顺序？

下一节，我们来聊聊 RocketMQ 的[延迟消息实现原理](/middleware/rocketmq/delay-message)，看看消息是怎么「等一会儿」再投递的。
