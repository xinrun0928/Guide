# RocketMQ 延迟消息实现原理：延迟等级

想象这个场景：

**用户下单后，如果 30 分钟内没付款，系统要自动取消订单。**

你会怎么做？

- **方案一**：写一个定时任务，每分钟扫描一次未支付的订单
- **方案二**：下订单时，直接发送一条延迟消息，30 分钟后投递，消费者收到后检查并取消

方案一的问题：定时任务有延迟，最坏情况要等 1 分钟才能检测到超时。

方案二的优势：**精确延迟**，30 分钟零延迟检测。

这就是延迟消息的价值。

---

## 为什么需要延迟消息？

### 传统方案的痛点

**定时任务方案**：

```
定时任务每分钟执行：
├─ 扫描所有未支付订单
├─ 检查订单创建时间
└─ 超过 30 分钟 → 执行取消逻辑

问题：
- 定时任务本身有延迟（轮询间隔决定，最少 1 分钟）
- 数据库压力大（全表扫描）
- 扩展性差（多实例需要分布式调度）
```

**延迟消息方案**：

```
用户下单时：
├─ 创建订单（待支付）
└─ 发送延迟消息（30 分钟后投递）

30 分钟后，消息自动投递：
├─ 消费者收到消息
├─ 检查订单状态
└─ 如果还是「待支付」→ 取消订单
```

延迟消息的优势：**精准投递、无轮询、无延迟**。

---

## RocketMQ 延迟消息的实现

### 不是「定时器」，而是「延迟等级」

RocketMQ 的延迟消息不走「定时器」路线，而是**延迟等级**（Delay Level）。

为什么？定时器需要维护大量定时任务，资源消耗大。RocketMQ 选择了一种更巧妙的方式。

### 延迟等级一览

```
延迟等级 1:  1s
延迟等级 2:  5s
延迟等级 3: 10s
延迟等级 4: 30s
延迟等级 5:  1m
延迟等级 6:  2m
延迟等级 7:  5m
延迟等级 8: 10m
延迟等级 9: 30m
延迟等级 10:  1h
延迟等级 11:  2h
延迟等级 12:  6h
延迟等级 13: 12h
延迟等级 14:  1d
延迟等级 15:  2d
延迟等级 16:  3d
延迟等级 17:  4d
延迟等级 18:  5d
延迟等级 19:  6d
延迟等级 20:  7d
```

**问题来了**：如果我想要 3 分钟的延迟，没有对应等级怎么办？

答案是：**没有就用最接近的**。RocketMQ 只支持这些固定档位，不支持任意时长。

### 实现原理：Schedule Topic

RocketMQ 内部有一个特殊的 Topic：**SCHEDULE_TOPIC_XXX**。

```
普通消息流程：
Producer → Topic-A → Consumer

延迟消息流程：
Producer → SCHEDULE_TOPIC_XXX（延迟队列）→ Broker 定时投递 → 原 Topic → Consumer
```

### 投递流程

```
1. Producer 发送延迟消息，设置 delayTimeLevel = 3（10秒）
2. Broker 收到消息，计算投递时间：当前时间 + 10秒
3. Broker 把消息存入 SCHEDULE_TOPIC_XXX 的对应队列
4. Broker 启动定时任务，定期检查消息是否到期
5. 到期后，把消息从 SCHEDULE_TOPIC_XXX 取出，投递到真正的 Topic
6. Consumer 收到消息，正常消费
```

```
┌─────────────────────────────────────────────────────────┐
│                     Broker                              │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │           SCHEDULE_TOPIC_XXX                     │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │  │
│  │  │等级 1  │ │等级 2  │ │等级 3  │ │等级 4  │    │  │
│  │  │队列0  │ │队列1  │ │队列2  │ │队列3  │    │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘    │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
│                    定时任务检测                          │
│                         │                               │
│                         ▼                               │
│  ┌──────────────────────────────────────────────────┐  │
│  │                 原 Topic（如 OrderTopic）          │  │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │  │
│  │  │Queue 0 │ │Queue 1 │ │Queue 2 │ │Queue 3 │    │  │
│  │  └────────┘ └────────┘ └────────┘ └────────┘    │  │
│  └──────────────────────────────────────────────────┘  │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
                    Consumer 消费
```

### 时间轮机制

Broker 内部使用**时间轮**（Timing Wheel）来管理延迟消息：

```
时间轮示意：
        │
  1s ───┼───► 定时触发，检查等级1队列
  5s ───┼───► 定时触发，检查等级2队列
 10s ───┼───► 定时触发，检查等级3队列
        │
  ...   │
        │
```

时间轮的好处：**高效、精准、资源占用低**。不需要为每条消息创建定时器，只需要按等级轮询。

---

## 代码示例

### 发送延迟消息

```java
// 创建消息，设置延迟等级
Message msg = new Message(
 "OrderTopic",  // 真正的 Topic
 "Tag",         // 标签
 "取消订单".getBytes()  // 消息体
);

// 设置延迟等级（这里设置为 3，即 10 秒后投递）
// 可选值：1-18，对应不同延迟时间
msg.setDelayTimeLevel(3);

// 发送消息
producer.send(msg);

// 消费者：正常消费，收到时已过了延迟时间
consumer.registerMessageListener(new MessageListenerConcurrently() {
 @Override
 public ConsumeConcurrentlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeConcurrentlyContext context) {
 for (MessageExt msg : msgs) {
 String orderId = msg.getKeys();
 long createTime = msg.getBornTimestamp();
 long now = System.currentTimeMillis();
 
 // 检查订单是否仍然未支付
 Order order = orderService.getOrder(orderId);
 if ("待支付".equals(order.getStatus())
 && (now - createTime) > 30 * 60 * 1000) {
 // 超时未支付，取消订单
 orderService.cancel(orderId);
 System.out.println("订单已超时，自动取消: " + orderId);
 }
 }
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
});
```

### 延迟等级配置

Broker 端可以自定义延迟等级：

```properties
# broker.conf
messageDelayLevel=1s;5s;10s;30s;1m;2m;5m;10m;30m;1h;2h;6h;12h;24h;48h;72h;168h;504h
```

格式：`level1时间;level2时间;level3时间...`，最多支持 18 个等级。

---

## 延迟消息的局限性

### 局限性一：固定档位

RocketMQ 只支持 18 个固定档位，不支持任意时长的延迟。

```
不支持：3分钟、25分钟、1小时15分钟
只支持：1s、5s、10s、30s、1m、2m、5m、10m、30m、1h...
```

如果需要秒级精度的任意延迟，考虑：
- 时间轮库：HashedWheelTimer
- 分布式定时任务：XXL-JOB、ElasticJob
- 数据库 + 轮询

### 局限性二：延迟时间受消息大小影响

如果 CommitLog 写入压力大，延迟消息的投递时间可能不准确——**实际投递时间可能晚于预期**。

```
问题：
1. 消息进入 SCHEDULE_TOPIC_XXX
2. 定时任务检测到消息到期
3. 把消息移到真正的 Topic
4. 但如果 Broker 负载高，移到 Topic 的动作可能被延迟

结果：消息投递时间 > 延迟时间
```

### 局限性三：事务消息不兼容

**RocketMQ 的延迟消息和事务消息不能同时使用**。

原因：事务消息本身有「回查」机制，需要Broker 跟踪消息状态。延迟消息也会被 Broker 管理。两者叠加会导致状态冲突。

解决方案：先发普通消息（可延迟），再用事务消息机制处理业务。

---

## 实战场景：订单超时取消

来看一个完整的订单超时取消方案：

### 业务逻辑

```
1. 用户下单 → 创建订单（待支付）→ 发送延迟消息（30分钟）
2. 30分钟后，消费者收到消息
3. 检查订单状态：
   - 如果是「已支付」→ 忽略（用户已付款，无需处理）
   - 如果是「待支付」→ 取消订单，返还库存
```

### 代码实现

```java
public class OrderCancelService {
 
 // 下单时调用
 public void createOrderAndSendDelayMessage(Order order) {
 // 1. 创建订单
 order.setStatus("待支付");
 order.setCreateTime(System.currentTimeMillis());
 orderService.create(order);
 
 // 2. 发送延迟消息（30分钟后投递）
 Message msg = new Message(
 "OrderCancelTopic",  // 取消订单专用 Topic
 order.getId(),       // 订单 ID 作为消息 key
 ("cancel:" + order.getId()).getBytes()
 );
 // 等级 9 = 30 分钟
 msg.setDelayTimeLevel(9);
 
 producer.send(msg);
 System.out.println("订单已创建，延迟取消消息已发送: " + order.getId());
 }
 
 // 消费延迟消息
 public void handleCancelMessage(List&lt;MessageExt&gt; msgs) {
 for (MessageExt msg : msgs) {
 String body = new String(msg.getBody());
 String orderId = msg.getKeys();
 
 Order order = orderService.getOrder(orderId);
 if (order == null) {
 continue;
 }
 
 // 只有「待支付」状态才需要取消
 if ("待支付".equals(order.getStatus())) {
 // 取消订单
 order.setStatus("已取消");
 order.setCancelTime(System.currentTimeMillis());
 orderService.update(order);
 
 // 返还库存
 inventoryService.release(order.getProductId(), order.getQuantity());
 
 System.out.println("订单超时已取消: " + orderId);
 } else {
 System.out.println("订单无需取消（已支付）: " + orderId);
 }
 }
 }
}
```

---

## 与 Kafka 的对比

| 特性 | RocketMQ | Kafka |
|-----|----------|-------|
| **延迟消息** | 原生支持（延迟等级） | 不支持，需要插件或外部实现 |
| **最大延迟时间** | 7 天（可配置） | 无限制（取决于配置） |
| **精度** | 秒级（固定档位） | 毫秒级（可配置） |

RocketMQ 的延迟消息开箱即用，Kafka 则需要借助 `kafka-durable-scheduler` 或外部定时任务。

---

## 留给你的问题

延迟消息解决了「精准定时投递」的问题，但还有一个问题：**Broker 本身挂了怎么办？**

如果消息还没来得及投递，Broker 就重启了，数据会丢失吗？

下一节，我们来聊聊 RocketMQ 的[高可用机制](/middleware/rocketmq/ha)，看看它是怎么保证消息不丢失的。
