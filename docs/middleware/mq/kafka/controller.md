# Kafka 控制器（Controller）：Broker 选举与故障转移

Kafka 集群里，谁说了算？

Broker 那么多，分区 Leader 怎么选？谁来管理集群状态？

答案就是：**Controller**。

## 一、Controller 是什么？

Controller 是 Kafka 集群中的一个特殊角色。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Controller 角色示意                             │
│                                                                  │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐            │
│  │ Broker 1 │      │ Broker 2 │      │ Broker 3 │            │
│  │          │      │          │      │          │            │
│  │  Broker  │      │ Controller│ ←── 这台说了算              │
│  │          │      │  控制器   │                            │
│  └──────────┘      └──────────┘      └──────────┘            │
│                                                                  │
│  Controller 职责：                                               │
│  1. 管理 Broker 上下线                                           │
│  2. 管理分区 Leader 选举                                         │
│  3. 管理副本状态                                                 │
│  4. 同步集群元数据                                               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 Controller 的职责

```java
// Controller 核心职责
public class KafkaController {
    
    // 1. Broker 管理
    //    - Broker 上线/下线检测
    //    - Broker 注册/注销
    
    // 2. 分区 Leader 选举
    //    - Leader 宕机后选新 Leader
    //    - 维护 ISR
    
    // 3. 分区副本分配
    //    - 新建 Topic 的副本分配
    //    - Broker 扩缩容时的副本重分配
    
    // 4. 集群元数据管理
    //    - Topic 配置管理
    //    - 分区数量管理
}
```

### 1.2 为什么需要 Controller？

```
没有 Controller 的问题：

问题：谁来决定哪个 Broker 是分区 Leader？

- Broker 1 说：我应该是 Leader
- Broker 2 说：我才是
- Broker 3 说：我也要

结果：混乱！

解决方案：Controller
- 唯一 Broker 担任 Controller
- 统一决定分区 Leader
- 所有 Broker 服从 Controller 的决定
```

## 二、Controller 选举

### 2.1 选举机制

Kafka 使用 ZK（ZooKeeper）或 KRaft（Kafka 3.x+）进行 Controller 选举。

```
┌─────────────────────────────────────────────────────────────────┐
│                    Controller 选举机制                             │
│                                                                  │
│  基于 ZK 临时节点：                                              │
│                                                                  │
│  1. 所有 Broker 尝试创建 /controller 节点                        │
│  2. 第一个创建成功的成为 Controller                               │
│  3. 其他 Broker 监听节点变化                                     │
│                                                                  │
│  Broker 1 ──→ 创建 /controller 成功 ──→ 成为 Controller         │
│  Broker 2 ──→ 创建失败，监听变化                                  │
│  Broker 3 ──→ 创建失败，监听变化                                  │
│                                                                  │
│  Broker 1 挂了 ──→ 节点消失 ──→ Broker 2 或 3 抢注              │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 选举流程

```java
// Controller 选举流程
public class ControllerElection {
    
    public void startElection() {
        // 1. 尝试创建临时节点
        String controllerPath = "/kafka/controller";
        Stat stat = zkClient.create(controllerPath, 
            new byte[0], 
            CreateMode.EPHEMERAL);  // 临时节点
        
        if (stat != null) {
            // 2. 创建成功，成为 Controller
            becomeController();
        } else {
            // 3. 创建失败，监听节点变化
            zkClient.watchForChanges(controllerPath, 
                (event) -> {
                    // Controller 变化，重新选举
                    if (isControllerNodeDeleted()) {
                        startElection();
                    }
                });
        }
    }
}
```

### 2.3 Controller 标识

```java
// Controller 标识存储
public class ControllerIdentity {
    
    // ZK 中存储的信息
    String brokerId;           // Broker ID
    long epoch;               // Controller 任期
    long timestamp;           // 选举时间
    
    // 格式：
    // {"version": 1, "brokerid": 1, "timestamp": 1700000000000, "epoch": 1}
}
```

## 三、故障转移

### 3.1 Controller 故障转移流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    Controller 故障转移流程                         │
│                                                                  │
│  Broker 1 (Controller) 宕机                                      │
│  │                                                              │
│  ├─→ /controller 临时节点消失                                   │
│  │                                                              │
│  ├─→ Broker 2 收到通知                                          │
│  ├─→ Broker 2 尝试创建 /controller                             │
│  │                                                              │
│  ├─→ Broker 2 创建成功                                          │
│  │                                                              │
│  └─→ Broker 2 成为新 Controller                                 │
│       │                                                         │
│       ├─→ 从 ZK 加载集群元数据                                    │
│       ├─→ 更新 Broker 状态                                       │
│       └─→ 开始管理工作                                           │
│                                                                  │
│  故障转移时间：通常 < 1 秒                                         │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Broker 上线流程

```java
// Broker 上线流程
public class BrokerRegistration {
    
    public void onBrokerUp(int brokerId) {
        // 1. Controller 收到 Broker 上线通知
        // 2. 更新 Broker 状态为 Online
        // 3. 如果有分区需要 Leader，触发 Leader 选举
        // 4. 通知其他 Broker 更新元数据
        
        // 新 Broker 上线后：
        // - 可以成为分区的 Follower
        // - 可以参与 Leader 选举
        // - 可以接管其他 Broker 的分区
    }
}
```

### 3.3 Broker 下线处理

```java
// Broker 下线处理
public class BrokerOffline {
    
    public void onBrokerDown(int brokerId) {
        // 1. Controller 收到 Broker 下线通知
        // 2. 找出该 Broker 负责的所有分区
        
        // 3. 对每个分区执行 Leader 选举
        for (Partition partition : brokerPartitions.get(brokerId)) {
            // 3.1 检查 ISR
            // 3.2 选择新 Leader（优先从 ISR 选）
            // 3.3 更新 ZK 中的 Leader 信息
            // 3.4 通知 Broker 更新元数据
        }
        
        // 4. 更新 Broker 状态为 Offline
    }
}
```

## 四、分区 Leader 选举

### 4.1 Leader 选举策略

```java
// Leader 选举策略
public class LeaderElectionStrategy {
    
    // 1. 优先从 ISR 中选举
    //    - ISR 中的副本数据最新
    //    - 减少数据丢失风险
    
    // 2. 按 AR（Assigned Replicas）顺序选举
    //    - 如果 ISR 为空，从 AR 中选第一个
    //    - 可能丢失数据
    
    // 3. 可配置 unclean.leader.election
    //    - true：允许从非 ISR 选举
    //    - false：不允许（数据安全优先）
}
```

### 4.2 分区 Leader 选举流程

```
┌─────────────────────────────────────────────────────────────────┐
│                    分区 Leader 选举流程                            │
│                                                                  │
│  场景：Broker 1（P0 Leader）宕机                                 │
│                                                                  │
│  1. Controller 检测到 Broker 1 宕机                             │
│                                                                  │
│  2. Controller 获取 P0 的 AR 和 ISR                             │
│     - AR = [Broker 1, Broker 2, Broker 3]                     │
│     - ISR = [Broker 1, Broker 2]                               │
│                                                                  │
│  3. 尝试从 ISR 选举                                              │
│     - Broker 1 已宕机，从 ISR 中移除                             │
│     - ISR = [Broker 2]                                          │
│     - Broker 2 成为新 Leader                                    │
│                                                                  │
│  4. 更新元数据                                                    │
│     - ZK: /brokers/topics/topic/partitions/0/state             │
│     - {leader: 2, ISR: [2, 3]}                                │
│                                                                  │
│  5. 通知所有 Broker                                              │
│     - Broker 2：你是 P0 的新 Leader                             │
│     - Broker 3：P0 Leader 变为 Broker 2                         │
│     - Producer/Consumer：更新元数据                               │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 选举完成时间

| 阶段 | 时间 | 说明 |
|------|------|------|
| 故障检测 | ~30s | zookeeper.session.timeout.ms |
| Controller 选举 | <1s | ZK 节点变化 |
| 分区 Leader 选举 | <1s | Controller 处理 |
| 元数据同步 | <1s | RPC 调用 |
| **总时间** | **~30s** | 最坏情况 |

## 五、Controller 工作原理

### 5.1 Controller 内部组件

```java
// Controller 内部组件
public class KafkaControllerComponents {
    
    // 1. 控制器上下文
    //    保存集群状态
    ControllerContext context;
    
    // 2. 事件队列
    //    控制器事件处理器
    ControllerEventManager eventManager;
    
    // 3. ZK 客户端
    //    与 ZK 通信
    KafkaZkClient zkClient;
    
    // 4. 网络客户端
    //    与 Broker 通信
    KafkaNetworkClient networkClient;
    
    // 5. 分区状态机
    //    管理分区状态
    PartitionStateMachine partitionStateMachine;
    
    // 6. 副本状态机
    //    管理副本状态
    ReplicaStateMachine replicaStateMachine;
}
```

### 5.2 状态机

```
┌─────────────────────────────────────────────────────────────────┐
│                    分区状态机                                     │
│                                                                  │
│  ┌─────────┐                                                    │
│  │ NonExistent │  ← 分区不存在                                  │
│  └────┬────┘                                                    │
│       │ Create/NewPartition                                    │
│       ↓                                                         │
│  ┌─────────┐                                                    │
│  │  New    │  ← 分区刚创建，等待 Leader                          │
│  └────┬────┘                                                    │
│       │ Controller 选举 Leader                                   │
│       ↓                                                         │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                  │
│  │ Online  │ ←── │ Online  │ ←── │ Online  │                  │
│  │ 正常     │ 选举 │ 变化中   │ 完成 │ 正常     │                  │
│  └────┬────┘     └────┬────┘     └─────────┘                  │
│       │ Leader 宕机   │                                       │
│       ↓               ↓                                        │
│  ┌─────────┐     ┌─────────┐                                   │
│  │ Offline │ ←── │Offline  │                                   │
│  │ 下线中   │     │ 下线    │                                   │
│  └─────────┘     └─────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 Controller 事件处理

```java
// Controller 事件处理
public class ControllerEventProcess {
    
    // 事件类型
    public enum ControllerEvent {
        BrokerChange,       // Broker 状态变化
        TopicChange,        // Topic 变化
        PartitionMod,      // 分区变更
        ControllerChange,  // Controller 变化
        ReplicaChange,     // 副本变更
    }
    
    // 事件处理流程
    public void processEvent(ControllerEvent event) {
        // 1. 事件入队
        eventQueue.put(event);
        
        // 2. 事件处理器消费
        while (true) {
            ControllerEvent e = eventQueue.take();
            process(e);
        }
    }
    
    // 处理 Broker 上线
    private void process(BrokerChange event) {
        // 1. 获取上线的 Broker
        // 2. 更新 Broker 状态
        // 3. 如果需要，触发 Leader 选举
        // 4. 发送元数据更新
    }
}
```

## 六、Controller 扩展

### 6.1 Controller 链

```
┌─────────────────────────────────────────────────────────────────┐
│                    Controller 链（Kafka 2.6+）                    │
│                                                                  │
│  问题：单 Controller 压力大                                      │
│                                                                  │
│  解决：Controller 链                                              │
│                                                                  │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐            │
│  │ Broker 1 │      │ Broker 2 │      │ Broker 3 │            │
│  │ Active   │ ←── │ Standby  │ ←── │ Standby  │            │
│  │ Controller│     │ Controller│     │ Controller│            │
│  └──────────┘      └──────────┘      └──────────┘            │
│                                                                  │
│  Active Controller 挂了 ──→ Standby 接管                         │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 配置 Controller 链

```properties
# Kafka 2.6+ Controller 配置
controller.quorum voters=1@localhost:9092,2@localhost:9093,3@localhost:9094
controller.listener.names=CONTROLLER
```

### 6.3 KRaft 模式

```
┌─────────────────────────────────────────────────────────────────┐
│                    KRaft 模式（Kafka 3.x+）                      │
│                                                                  │
│  目标：移除对 ZK 的依赖                                           │
│                                                                  │
│  原来：                                                          │
│  Kafka ──→ ZK                                                    │
│           ↑                                                      │
│       Controller 信息                                             │
│                                                                  │
│  KRaft 模式：                                                    │
│  Kafka ──→ Kafka (Raft 协议)                                    │
│                                                                  │
│  优点：                                                          │
│  - 部署更简单                                                    │
│  - 元数据同步更快                                                │
│  - 不依赖 ZK                                                    │
│                                                                  │
│  配置：                                                          │
│  process.roles=broker,controller                                │
│  node.id=1                                                      │
└─────────────────────────────────────────────────────────────────┘
```

## 七、常见问题

### 7.1 Controller 频繁切换

```
问题：Controller 频繁切换

原因：
1. Broker 网络不稳定
2. ZK 性能问题
3. JVM GC 暂停

排查：
1. 检查 Broker 日志
2. 检查 ZK 延迟
3. 检查 GC 情况

解决：
1. 稳定网络环境
2. 优化 ZK 配置
3. 优化 JVM 参数
```

### 7.2 分区 Leader 不均衡

```
问题：分区 Leader 分布不均

原因：
1. Broker 性能差异
2. 新 Broker 上线后未均衡

解决：
1. 使用 kafka-reassign-partitions.sh 重分配
2. 开启自动均衡（可配置）
```

### 7.3 大规模集群的 Controller 压力

```
问题：Controller 成为瓶颈

原因：
1. Broker 数量多（> 100）
2. 分区数量多（> 10000）
3. Leader 选举频繁

解决：
1. 分区数量合理规划
2. 使用 Controller 链
3. 升级到 KRaft 模式
```

## 八、监控与运维

### 8.1 监控指标

```java
// Controller 监控指标
public class ControllerMetrics {
    
    // kafka.controller:type=KafkaController,name=ActiveControllerCount
    // 当前是否为 Controller（1 或 0）
    
    // kafka.controller:type=KafkaController,name=OfflinePartitionsCount
    // 离线分区数量
    
    // kafka.controller:type=KafkaController,name=LeaderElectionRateAndTimeMs
    // Leader 选举速率和耗时
    
    // kafka.controller:type=KafkaController,name=UncleanLeaderElectionsPerSec
    // 非 ISR Leader 选举次数
}
```

### 8.2 常用命令

```bash
# 查看 Controller 信息
kafka-topics.sh --describe --bootstrap-server localhost:9092

# 手动触发 Controller 选举
kafka-leader-election.sh --bootstrap-server localhost:9092 \
    --topic my-topic --partition 0 \
    --election-type PREFERRED

# 分区重分配
kafka-reassign-partitions.sh --generate \
    --bootstrap-server localhost:9092 \
    --topics-to-move-json-file topics.json \
    --broker-list "1,2,3" > reassignment.json

kafka-reassign-partitions.sh --execute \
    --bootstrap-server localhost:9092 \
    --reassignment-json-file reassignment.json
```

## 总结

Controller 核心要点：

| 要点 | 说明 |
|------|------|
| 唯一性 | 集群只有一个 Controller |
| 选举 | 基于 ZK 临时节点 |
| 职责 | Broker/分区管理、Leader 选举 |
| 故障转移 | Controller 挂了自动选举新 Controller |
| 新模式 | KRaft 模式移除 ZK 依赖 |

**Controller 是 Kafka 集群的大脑，理解它才能理解 Kafka 的高可用。**

---

## 留给你的问题

1. **Controller 选举的顺序**：3 个 Broker，Broker 1 刚成为 Controller 就挂了。Broker 2 和 Broker 3 同时收到通知，谁会成为新 Controller？

2. **分区数量对 Controller 的影响**：一个 Topic 有 10000 个分区，Leader 全部在一台 Broker 上。这台 Broker 挂了，Controller 需要做多少次 Leader 选举？

3. **非 ISR 选举的风险**：`unclean.leader.election.enable=true` 时选举的 Leader 可能数据不完整。Consumer 读到不完整数据会怎样？

4. **KRaft vs ZK**：KRaft 模式用 Raft 协议替代 ZK，有什么优势和劣势？迁移需要注意什么？

思考这些问题，能帮你理解 Controller 的设计细节。
