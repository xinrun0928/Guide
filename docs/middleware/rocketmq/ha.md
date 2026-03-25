# RocketMQ 高可用：主从复制与 DLeger

先问一个灵魂拷问：

**如果 Broker 突然宕机了，消息会丢失吗？**

答案取决于你的配置。如果 Broker 是单节点，消息写入后还没同步到磁盘就宕机——会丢。如果配置了主从复制，Master 宕机后 Slave 接管——可能丢几条。如果用了 DLeger 模式——理论上零丢失。

这一节，我们来彻底搞清楚 RocketMQ 的高可用机制。

---

## 消息可靠性的几个级别

在高可用设计里，有一个经典的 CAP 权衡：

- **C（Consistency）**：一致性——写入后立刻能读到
- **A（Availability）**：可用性——服务始终可用
- **P（Partition Tolerance）**：分区容错——网络分区时仍能工作

消息队列的可靠性设计，本质上也是这个权衡。

### 四种刷盘策略

```
刷盘 = 把内存中的数据写到磁盘（持久化）

┌─────────────────────────────────────────┐
│              Producer 发送消息            │
└─────────────────┬───────────────────────┘
                  │
                  ▼
         ┌────────────────┐
         │    Broker      │
         │  ┌──────────┐  │
         │  │  内存     │  │
         │  └────┬─────┘  │
         │       │        │
         │  ┌────┴─────┐  │
         │  │  磁盘     │  │
         │  └──────────┘  │
         └────────────────┘
```

| 刷盘策略 | 说明 | 可靠性 | 性能 |
|---------|------|-------|-----|
| **同步刷盘** | 写入内存后，立即刷到磁盘，才返回成功 | 高 | 低 |
| **异步刷盘** | 写入内存后，立即返回，定时刷盘 | 中 | 高 |

**同步刷盘**保证消息已经落盘，但每次写入都要等磁盘 IO，性能差。

**异步刷盘**性能高，但如果 Broker 宕机，未刷盘的消息会丢失。

---

## 主从复制：数据冗余保障

单 Broker 的问题是：如果 Broker 挂了，消息就丢了。

解决方案：**Master-Slave 架构**。

```
Master Broker ──同步复制/异步复制──▶ Slave Broker

Producer ──写──▶ Master Broker ──同步/异步──▶ Slave Broker
```

### 两种复制模式

| 模式 | 说明 | 数据安全性 | 性能 | 延迟 |
|-----|------|-----------|-----|-----|
| **同步复制** | Master 写成功后，等 Slave 也写入成功，才返回成功 | 高 | 低 | 高（多一次网络） |
| **异步复制** | Master 写入成功就返回，异步同步到 Slave | 中 | 高 | 低 |

### 同步复制的流程

```
1. Producer 发送消息到 Master
2. Master 写入 CommitLog
3. Master 把数据复制给 Slave
4. Slave 写入 CommitLog
5. Slave 返回 ACK 给 Master
6. Master 返回 ACK 给 Producer
```

**优点**：Master 挂了，Slave 上有完整数据，不会丢消息。

**缺点**：每次写入都要等 Slave，延迟增加。

### 异步复制的流程

```
1. Producer 发送消息到 Master
2. Master 写入 CommitLog
3. Master 立即返回 ACK 给 Producer（异步同步给 Slave）
```

**优点**：性能高，延迟低。

**缺点**：如果 Master 宕机时数据还没同步到 Slave，会丢失几条消息。

---

## DLeger：真正的强一致性

主从复制解决了「数据冗余」的问题，但还有一个问题：

**如果 Master 挂了，Slave 能自动切换成 Master 吗？**

传统的 Master-Slave 架构做不到这一点——Slave 不会自动升级，需要手动运维介入。

DLeger 就是来解决这个问题的。

### DLeger 是什么？

DLeger 是基于 Raft 协议的 Leader 选举机制，实现了**自动故障转移**。

```
传统 Master-Slave：
Master 挂了 → 手动切换 Slave 为 Master → 服务恢复（可能需要几分钟）

DLeger 模式：
Leader 挂了 → 自动选举新 Leader → 服务恢复（秒级）
```

### Raft 协议的核心概念

```
Raft 把节点分为三种状态：
- Leader：处理所有读写请求
- Follower：被动接收 Leader 的数据
- Candidate：竞选 Leader 的节点
```

选举过程：

```
1. 初始状态：3 个节点都是 Follower
2. Follower 收不到 Leader 心跳 → 变成 Candidate
3. Candidate 发起投票
4. 获得多数票的节点成为 Leader
5. Leader 负责写入，Follower 同步数据
```

### DLeger 的写入流程

```
┌─────────────────────────────────────────────────────────┐
│                      DLeger Group                       │
│                                                          │
│   ┌─────────┐         ┌─────────┐         ┌─────────┐   │
│   │ Leader  │◀───────▶│Follower │◀───────▶│Follower │   │
│   │ (写入)   │  同步   │  (同步)  │  同步   │  (同步)  │   │
│   └─────────┘         └─────────┘         └─────────┘   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

1. Producer 发送消息到 Leader
2. Leader 写入本地日志
3. Leader 发送日志给所有 Follower
4. **多数 Follower 写入成功**后，Leader 才提交消息
5. Leader 返回成功给 Producer

**关键点**：不需要所有节点都同步成功，只需要**多数节点**（N/2 + 1）写入成功即可。

### 故障转移

```
场景：Leader 节点突然宕机

1. 剩余节点检测到 Leader 失联
2. 发起新一轮选举
3. 获得多数票的节点成为新 Leader
4. 新 Leader 处理读写请求
5. 原来的 Leader 恢复后，变成 Follower，接收新 Leader 的数据
```

整个过程自动完成，对客户端透明。

---

## 配置示例

### 传统 Master-Slave 配置

```properties
# Master Broker 配置
brokerClusterName=DefaultCluster
brokerName=broker-a
brokerRole=ASYNC_MASTER  # 或 SYNC_MASTER
flushDiskType=ASYNC_FLUSH

# Slave Broker 配置
brokerClusterName=DefaultCluster
brokerName=broker-a
brokerRole=SLAVE
brokerId=1
flushDiskType=ASYNC_FLUSH
```

### DLeger 配置

```properties
# DLeger Broker 配置
brokerClusterName=DefaultCluster
brokerName=broker-a
enableDLegerCommitLog=true
dLegerGroup=broker-a-group
dLegerPeers=n0-127.0.0.1:40911;n1-127.0.0.1:40912;n2-127.0.0.1:40913
dLegerSelfId=n0  # 节点 ID，每个 Broker 不同
sendMessageVersion=1  # 版本兼容
```

启动三个 Broker，分别配置 `dLegerSelfId` 为 `n0`、`n1`、`n2`，就形成了一个 DLeger 集群。

---

## 可靠性对比

| 模式 | 数据安全性 | 可用性 | 性能 | 适用场景 |
|-----|-----------|--------|-----|---------|
| **单 Master** | 低（可能丢消息） | 低（挂了就没了） | 高 | 测试环境 |
| **异步主从** | 中（可能丢 1 条） | 中（需手动切换） | 高 | 高并发场景 |
| **同步主从** | 高（几乎不丢） | 中（需手动切换） | 中 | 对可靠性有要求 |
| **DLeger** | 高（零丢失） | 高（自动切换） | 中 | 生产环境推荐 |

---

## Producer 端的高可用配置

Broker 做了高可用，Producer 端也要配合：

```java
// Producer 配置多个 NameServer
DefaultMQProducer producer = new DefaultMQProducer("producer-group");
producer.setNamesrvAddr("name-server-1:9876;name-server-2:9876;name-server-3:9876");
producer.start();

// 发送消息时，自动重试
SendResult result = producer.send(message, 3000);  // 超时 3 秒，自动重试
```

**关键配置**：

- `retryTimesWhenSendFailed`：同步发送失败重试次数，默认 2
- `retryAnotherBrokerWhenNotStoreOK`：Broker 不可用时重试另一个，默认 false

---

## Consumer 端的高可用配置

Consumer 端也有高可用设计——**Consumer Group**。

```
Consumer Group: order-consumer-group

┌─────────────────────────────────────────────────────┐
│                   Topic: OrderTopic                  │
│  Queue-0    Queue-1    Queue-2    Queue-3          │
└─────────────────────────────────────────────────────┘
       │          │          │          │
       ▼          ▼          ▼          ▼
┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│Consumer1│ │Consumer2│ │Consumer3│ │Consumer4│
└─────────┘ └─────────┘ └─────────┘ └─────────┘
       └──────────────┬──────────────┘
                      │
              同一个 Consumer Group
              消息均摊，failover 自动切换
```

如果某个 Consumer 挂了，同一 Group 的其他 Consumer 会自动接管它的 Queue，继续消费。

---

## 选型建议

| 场景 | 推荐配置 |
|-----|---------|
| **测试/开发环境** | 单 Master，无需高可用 |
| **高并发互联网场景** | 异步主从 + 异步刷盘，追求性能 |
| **金融/订单场景** | DLeger + 同步刷盘，追求可靠性 |
| **一般生产环境** | DLeger + 异步刷盘，平衡可靠性和性能 |

---

## 留给你的问题

DLeger 解决了「自动故障转移」的问题，让 Master/Slave 切换自动化。但 DLeger 有一个局限性：**它只能保证 CommitLog 的高可用，ConsumeQueue 等其他文件并不在其管辖范围内**。

另外，RocketMQ 的主从复制是异步的（即使 DLeger 模式下也是多数写），在极端情况下（如网络分区），可能出现数据不一致。

下一节，我们来对比一下 [RocketMQ vs Kafka vs RabbitMQ](/middleware/rocketmq/compare)，看看在不同场景下该怎么选型。
