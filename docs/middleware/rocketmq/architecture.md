# RocketMQ 架构：一套消息队列的「神经中枢」是怎么工作的？

你在电商下单后，订单系统告诉库存系统「减一件商品」，库存系统告诉物流系统「准备发货」——这套流程背后，消息在不停地流转。

但你有没有想过：**如果 NameServer 宕机了，消息还能发出去吗？Broker 挂了，Consumer 会丢消息吗？**

今天，我们来拆解 RocketMQ 的四大核心组件，看看它是怎么扛住双十一流量的。

---

## 为什么需要 NameServer？

在 Kafka 里，有一个叫「Controller」的概念，它是集群的大脑，负责选举和元数据管理。**Controller 是单点**——一旦它挂了，整个集群就危险了。

RocketMQ 走了另一条路：NameServer 集群是对等的，没有主从之分。

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  NameServer │     │  NameServer │     │  NameServer │
│   节点 1     │     │   节点 2     │     │   节点 3     │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                    ┌──────┴──────┐
                    │  Broker 集群 │
                    └─────────────┘
```

**NameServer 的职责很简单：**

1. **服务注册**：Broker 启动时，向所有 NameServer 注册自己的地址、端口、主题信息
2. **心跳检测**：Broker 每 30 秒向 NameServer 发送心跳，证明自己还活着
3. **路由查询**：Producer/Consumer 需要发消息或消费消息时，问 NameServer 「这个 Topic 在哪几个 Broker 上」

**一个关键问题**：如果某个 NameServer 节点挂了，会影响整个集群吗？

答案是：**不会**。因为 Broker 会向所有 NameServer 注册，而 Producer/Consumer 会从多个 NameServer 获取路由信息。这种「无中心」的设计，让 NameServer 集群天然具备高可用能力。

---

## Broker：消息的「存储中枢」

如果说 NameServer 是「路由表」，那 Broker 就是真正的「仓库」——所有消息都存在这里。

### Broker 的内部结构

```
┌─────────────────────────────────────────────────────┐
│                      Broker                         │
├─────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │   ConsumeQueue  │  │  CommitLog   │  │  IndexFile  │ │
│  │   (消费队列)    │  │   (commit)   │  │  (索引文件)  │ │
│  │               │  │             │  │             │ │
│  │  顺序写，快速   │  │  顺序写，真正 │  │  按 MessageKey│ │
│  │  定位消费位置   │  │  存储消息     │  │  快速查询     │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────┘
```

**三剑客各司其职：**

1. **CommitLog**：消息的「本体」，所有消息都顺序写入这个文件。一个 Broker 只有一份 CommitLog，这是 RocketMQ 实现高性能的关键——顺序写磁盘，顺序读内存。

2. **ConsumeQueue**：消息的「目录」，记录「某条消息在 CommitLog 的哪个位置」。Consumer 消费时，先读 ConsumeQueue 找到位置，再去 CommitLog 读消息。

3. **IndexFile**：消息的「索引」，按 MessageKey 建索引，方便按订单号等字段快速查找消息。

### 主从架构：Broker 的高可用

Broker 有两种部署模式：

1. **Master Broker**：处理读写请求，性能优先
2. **Slave Broker**：只接收 Master 同步过来的数据，灾备优先

**同步方式有两种：**

- **同步复制**：Master 写完，等 Slave 也写成功，才告诉客户端「写入成功」
- **异步复制**：Master 写完就返回，异步同步到 Slave，性能更高但有短暂的数据窗口

> 在金融场景，优先用同步复制；在高并发互联网场景，异步复制是常态。

---

## Producer：消息的「发源地」

Producer 负责把消息扔进 Broker。听起来简单，但这里有几个关键设计：

### 消息发送的三种模式

| 模式 | 说明 | 可靠性 | 性能 |
|-----|------|-------|-----|
| **同步发送** | 发一条，等回应，再发下一条 | 高 | 低 |
| **异步发送** | 发一条，不等回应，回调通知 | 中 | 中 |
| **单向发送** | 只管发，不管成功与否 | 低 | 高 |

```java
// 同步发送：最可靠，但最慢
Message msg = new Message("TopicTest", "Hello RocketMQ".getBytes());
SendResult result = producer.send(msg);

// 异步发送：适合对可靠性有要求但追求性能
producer.send(msg, new SendCallback() {
 @Override
 public void onSuccess(SendResult result) {
 System.out.println("发送成功");
 }

 @Override
 public void onException(Throwable e) {
 // 失败重试逻辑
 }
});

// 单向发送：只管发，Fire and Forget
producer.sendOneway(msg);
```

### Topic 和 Queue 的关系

```
Topic: OrderTopic
┌────────────┬────────────┬────────────┐
│  Queue 0   │  Queue 1   │  Queue 2   │
│            │            │            │
│  Msg-1     │  Msg-4     │  Msg-7     │
│  Msg-2     │  Msg-5     │  Msg-8     │
│  Msg-3     │  Msg-6     │  Msg-9     │
└────────────┴────────────┴────────────┘
```

**一个 Topic 可以有多个 Queue**，分布在不同的 Broker 上。Producer 发送消息时，会根据负载均衡策略选择一个 Queue 写入。

### Producer 的路由发现

Producer 启动后，会从 NameServer 获取 Topic 的路由信息（Topic 在哪些 Broker 上，每个 Broker 有几个 Queue）。但这里有个问题：**路由信息是缓存的，不是实时更新的**。

RocketMQ 默认每 30 秒更新一次路由缓存。如果 Broker 扩缩容，Producer 可能短暂地往「已下线的 Broker」发消息——这就是为什么生产环境需要配置重试机制。

---

## Consumer：消息的「终点站」

Consumer 负责从 Broker 拉取消息并处理。RocketMQ 支持两种消费模式：

### 集群消费 vs 广播消费

| 模式 | 说明 | 适用场景 |
|-----|------|---------|
| **集群消费** | 消息被一个 Consumer 消费，各 Consumer 均摊消息 | 大部分业务场景 |
| **广播消费** | 每个 Consumer 都收到全量消息 | 推送广告、配置同步等 |

### 消息拉取的两种方式

1. **Push 模式**（推荐）：Broker 主动「推」给 Consumer，底层是长轮询
2. **Pull 模式**：Consumer 自己来「拉」消息，更灵活但需要自己管理 offset

```java
// Push 模式：监听器方式，写起来像 Push，实际上是长轮询
consumer.registerMessageListener(new MessageListenerConcurrently() {
 @Override
 public ConsumeConcurrentlyStatus consumeMessage(
 List&lt;MessageExt&gt; msgs, ConsumeConcurrentlyContext context) {
 for (MessageExt msg : msgs) {
 String body = new String(msg.getBody());
 System.out.println("消费消息: " + body);
 }
 return ConsumeConcurrentlyStatus.CONSUME_SUCCESS;
 }
});
```

### 消费进度管理（Offset）

Consumer 消费完消息，需要告诉 Broker「我消费到哪了」，这就是 Offset。

**为什么要记录 Offset？** 因为 Consumer 可能会重启，如果不知道上次消费到哪，就会丢消息或重复消费。

RocketMQ 把消费进度存在两个地方：

1. **Broker 端**（默认）：Consumer 集群共享，适合高可用
2. **Consumer 端**：每个 Consumer 自己记，适合独立消费场景

---

## 组件协作：一次消息的一生

```
Producer                      NameServer                    Broker
   │                              │                          │
   │──── 查询路由信息 ───────────▶│                          │
   │◀─── 返回 Broker 地址 ────────│                          │
   │                              │                          │
   │──────────── 发送消息 ───────────────────────────────▶│
   │◀─────────── 写入成功 ───────────────────────────────│
   │                              │                          │
                                 (Consumer 向 NameServer 查询路由)
                                 (Consumer 向 Broker 拉取消息)
```

整个流程是**无中心的**：Producer 不需要知道 Consumer 在哪，Consumer 也不需要知道 Producer 在哪——它们都只跟 NameServer 和 Broker 打交道。

---

## 架构设计的核心思想

回顾一下 RocketMQ 的架构设计，有几个关键点值得学习：

1. **NameServer 无状态**：对等集群，无单点故障
2. **Broker 读写分离**：Master 处理写，Slave 处理读（可选）
3. **CommitLog 顺序写**：这是 RocketMQ 高性能的秘诀
4. **Topic/Queue 分离**：一个 Topic 可以分布在多个 Broker 上

---

## 留给你的问题

NameServer 的设计解决了一个问题——没有单点故障。但它也带来了新问题：**Broker 和 Consumer 之间的数据一致性**。

如果 Master Broker 写入了消息，但还没来得及同步给 Slave，Master 就挂了——Slave 上的消息会丢失吗？RocketMQ 是怎么解决这个问题的？

下一节，我们来聊聊 RocketMQ 的[高可用机制](/middleware/rocketmq/ha)。
