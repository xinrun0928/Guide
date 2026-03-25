# Nacos 选举机制

你有没有想过这个问题：

Nacos 集群有 3 台机器，服务注册请求打到任意一台都能成功。但有一个问题——**如果某台机器宕机了，它负责的服务实例信息会丢失吗？**

答案是：**不会。**

因为 Nacos 会进行数据同步。但背后的选举机制是怎么工作的？

## Nacos 集群的两种模式

在深入选举之前，先理解 Nacos 的两种集群模式：

| 模式 | 说明 | 使用场景 |
|-----|-----|---------|
| AP 模式 | 遵循 CAP 定理中的 Availability + Partition tolerance | 服务发现（推荐） |
| CP 模式 | 遵循 CAP 定理中的 Consistency + Partition tolerance | 配置管理、分布式锁 |

```yaml
# AP 模式（默认，用于服务发现）
spring:
  cloud:
    nacos:
      discovery:
        # 不强制一致性，优先可用性
        heart-beat-interval: 5000

# CP 模式（用于配置管理、选举）
spring:
  cloud:
    nacos:
      config:
        # 启用 Raft 协议，强制一致性
        leader-lease-time: 5000
```

## Leader 选举：Raft 协议

Nacos 使用 **Raft 协议**进行 Leader 选举，这是分布式系统中最常用的共识算法之一。

### Raft 协议核心概念

```
Raft 协议中的三种角色：
- Leader（领导者）：处理所有写请求
- Follower（跟随者）：响应 Leader 的心跳，如果 Leader 故障可以参与选举
- Candidate（候选者）：试图成为 Leader 的 Follower
```

### 选举流程

**触发时机：**
- 集群启动时
- Leader 故障时
- Follower 心跳超时（默认 10 秒）

```
初始状态（3 台机器都认为没有 Leader）：
Server A: Follower（term=0）
Server B: Follower（term=0）
Server C: Follower（term=0）

时刻 1：心跳超时，Server A 先发起选举
Server A: Candidate（term=1），给自己投一票
         向 Server B、Server C 发送投票请求

时刻 2：Server B、Server C 响应投票
Server B: 投给 Server A（因为 Server A 的 term >= 自己的 term）
Server C: 投给 Server A

时刻 3：Server A 获得 3 票（包括自己），成为 Leader
Server A: Leader（term=1）
Server B: Follower（term=1）
Server C: Follower（term=1）

Leader 定期发送心跳给 Follower，保持领导地位
```

### Java 实现简化版

```java
public class RaftNode {
    private volatile State state = State.FOLLOWER;
    private volatile long currentTerm = 0;
    private volatile String votedFor;
    private volatile String leaderId;

    // 心跳超时（随机 150-300ms，避免同时发起选举）
    private int electionTimeout() {
        return 150 + new Random().nextInt(150);
    }

    // 发起选举
    public void startElection() {
        state = State.CANDIDATE;
        currentTerm++;
        votedFor = myId;
        int votes = 1;  // 给自己投一票

        // 向其他节点发送投票请求
        for (RaftNode peer : peers) {
            if (peer.requestVote(currentTerm, myId, lastLogIndex, lastLogTerm)) {
                votes++;
            }
        }

        // 获得过半票数，成为 Leader
        if (votes > (peers.size() + 1) / 2) {
            becomeLeader();
        }
    }

    // 处理投票请求
    public boolean requestVote(long term, String candidateId, long lastIndex, long lastTerm) {
        if (term > currentTerm) {
            // 发现更高的 term，转为 Follower
            currentTerm = term;
            state = State.FOLLOWER;
        }

        // 判断是否投票
        if (state == State.FOLLOWER &&
            (votedFor == null || votedFor.equals(candidateId)) &&
            isLogUpToDate(lastIndex, lastTerm)) {
            votedFor = candidateId;
            return true;  // 投票给 candidate
        }
        return false;
    }
}
```

## 临时实例与永久实例

这是理解 Nacos 选举的关键。

### 临时实例（ephemeral=true）

```java
// 临时实例的心跳依赖
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: true  # 默认值
```

**特点：**

- 需要心跳维持存在
- Nacos 宕机或心跳超时，实例自动删除
- 数据不持久化到磁盘
- **选举不影响**：因为临时实例本来就需要动态注册

```yaml
# 临时实例的生命周期
服务启动 → 注册到 Nacos → 心跳保活 → Nacos 重启 → 重新注册
```

### 永久实例（ephemeral=false）

```java
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: false
```

**特点：**

- 不依赖心跳，实例信息持久化
- Nacos 重启后实例信息仍在
- **需要 Raft 协议保证**：数据要同步到多数派节点

```yaml
# 永久实例的生命周期
服务启动 → 注册到 Nacos → 数据持久化到磁盘 → Nacos 重启 → 实例信息从磁盘恢复
```

### 选举对实例的影响

```
选举发生时（假设 Leader 宕机）：

临时实例：
- Leader 宕机 → 临时节点消失
- 新 Leader 选出 → 服务重新注册
- 服务发现短暂中断（秒级）

永久实例：
- Leader 宕机 → 数据未丢失（Raft 同步保证）
- 新 Leader 选出 → 继续服务
- 服务发现不受影响
```

## 故障转移

### Leader 故障

```
时刻 1：Leader（Server A）宕机
         ↓
时刻 2：Server B 和 Server C 心跳超时
         ↓
时刻 3：Server B 先发起选举（随机超时）
         ↓
时刻 4：Server B 成为新 Leader
         ↓
时刻 5：Server A 恢复后，作为 Follower 加入
```

### 数据同步保证

```
选举期间的数据不丢失：
- Raft 协议保证：只有写入过半节点的数据才会提交
- 新 Leader 一定包含所有已提交的数据
```

```java
// Raft 的日志复制保证
public class RaftLog {
    // 日志条目，只有被多数派节点写入才算提交
    static class Entry {
        long term;           // 任期号
        long index;          // 日志索引
        Object data;         // 数据
    }

    // 提交条件：被多数派节点写入
    public boolean isCommitted(Entry entry) {
        return entry.replicateCount > (nodes.size() / 2);
    }
}
```

## 实际配置

### 集群部署配置

```yaml
# application.yml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.100:8848,192.168.1.101:8848,192.168.1.102:8848
      config:
        server-addr: 192.168.1.100:8848,192.168.1.101:8848,192.168.1.102:8848

# cluster.conf
192.168.1.100:8848
192.168.1.101:8848
192.168.1.102:8848
```

### Raft 参数调优

```yaml
# 自定义 Raft 配置
nacos:
  raft:
    election-timeout: 5000       # 选举超时时间（毫秒）
    heartbeat-interval: 1000    # 心跳间隔（毫秒）
    snapshot-interval: 3600      # 快照间隔（秒）
    max-entries: 10000           # 单次同步的最大条目数
```

## 总结

Nacos 的选举机制：

```
集群启动/Leader 故障 → Follower 心跳超时 → Candidate 发起选举
→ 获得过半票数 → 成为 Leader → 处理写请求 → 同步给 Follower
```

**选举的核心保证：**

- **Raft 协议**：成熟的共识算法
- **过半机制**：类似 ZooKeeper，避免脑裂
- **持久化**：永久实例数据不丢失
- **临时实例**：心跳机制，自动注册/删除

**什么时候关注选举？**

- 部署 Nacos 集群时
- 排查 Nacos 不可用问题时
- 调优 Nacos 性能时

---

**留给你的问题：**

假设你有一个 5 台机器的 Nacos 集群，突然有 2 台机器同时宕机。剩下的 3 台还能正常工作吗？

如果是 ZooKeeper 集群，2 台宕机后还能工作（N=5，容忍 F=2）。

但 Nacos 呢？答案可能不一样。为什么？
