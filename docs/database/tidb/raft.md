# Raft 协议：TiKV 的强一致性保证

你有没有想过这个问题：

TiKV 的数据有 3 个副本，分别在 3 台机器上。如果网络抖动，某个副本暂时不可用，客户端写入数据时会发生什么？

- 直接写入成功？不安全，万一那个副本是「脑裂」后独立的
- 等所有副本确认？太慢，一个节点慢就卡住
- 到底听谁的？

这个分布式系统的经典问题，Raft 协议给出了答案。

## 为什么是 Raft？

Raft 是 2014 年提出的分布式一致性算法，设计目标是**可理解性**——让工程师能真正搞懂这个协议。

相比 Paxos（分布式一致性的「鼻祖」），Raft 的核心设计决策是：**先选出一个 Leader，所有读写都经过 Leader。**

```
MySQL 主从复制：
Primary → Replica1
       → Replica2
（异步复制，可能丢数据）

TiKV Raft 复制：
┌─────────────────────────────────────────────┐
│              Raft Group                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐ │
│  │ Leader  │───►│Follower │───►│Follower │ │
│  └─────────┘◄───│         │◄───│         │ │
│                 └─────────┘    └─────────┘ │
│     ▲                                    ▲  │
│     │         日志复制                    │  │
└─────┴────────────────────────────────────┴──┘
（强同步，3 副本多数派确认）
```

## Raft 的核心概念

### 角色转换

Raft 集群中的每个节点有三种角色：

```java
public enum RaftRole {
    Leader,     // 领导者，处理所有读写请求
    Follower,   // 跟随者，被动响应 Leader 和候选人
    Candidate   // 候选人，参与 Leader 选举
}
```

角色转换图：

```
              选举超时
         ┌────────────────┐
         │                │
         ▼                │
    ┌─────────┐      ┌───────────┐
    │ Follower│─────►│ Candidate │
    └─────────┘◄─────└───────────┘
         ▲              │    ▲
         │              │    │ 获得多数票
         │              ▼    │
         │         ┌─────────┐
         │         │ Leader  │
         │         └─────────┘
         │              ▲
         └──────────────┘
           Leader 任期结束
```

### 任期（Term）

Raft 把时间划分为任期，每个任期以一次选举开始。任期是一个单调递增的整数。

```java
public class RaftNode {
    private long currentTerm = 0;  // 当前任期
    private String votedFor;       // 当前任期投票给谁
    private List<LogEntry> log;     // 操作日志

    // 任期有什么作用？
    // 1. 区分不同 Leader 的「朝代」
    // 2. 过期的 Leader 请求会被拒绝
    // 3. 判断日志是否过期
}
```

### 日志复制

**Raft 的核心是日志复制。** 所有写操作都先写入 Leader 的日志，然后复制到 Follower，只有复制到多数派节点后才 apply（应用到状态机）。

```java
public class RaftLogReplication {
    // 客户端发起写请求
    public void clientWrite(byte[] command) {
        // 1. Leader 将命令追加到本地日志
        LogEntry entry = new LogEntry(currentTerm, command);
        log.add(entry);

        // 2. 并行发送 AppendEntries 给所有 Follower
        List<Future<Boolean>> results = parallelSendToFollowers(entry);

        // 3. 等待多数派确认
        int count = countSuccess(results);
        if (count > totalNodes / 2) {
            // 多数派确认，可以 apply 了
            applyToStateMachine(entry);
        }
    }
}
```

**这就是 Raft 的「写入流程」——先落日志，再多数派确认，最后 apply。**

## Leader 选举

当 Follower 收不到 Leader 的心跳超过选举超时时间后，会变成 Candidate，发起新一轮选举。

```java
public class LeaderElection {
    // 选举超时时间：随机 150~300ms
    // 随机化是为了避免「平票大战」
    private int electionTimeout() {
        return 150 + ThreadLocalRandom.current().nextInt(150);
    }

    // 成为 Candidate 后
    public void startElection() {
        currentTerm++;           // 任期 +1
        votedFor = self;         // 投自己
        lastHeartbeat = now();   // 重置计时器

        // 并行发送 RequestVote 给所有节点
        for (Node peer : peers) {
            sendRequestVote(peer);
        }
    }

    // 投票规则
    public boolean canVoteFor(CandidateRequest request) {
        // 1. 任期必须 >= 当前任期
        // 2. 候选人的日志至少和自己一样新
        // 3. 一任期内只能投一票
        return request.getTerm() >= currentTerm
            && isLogUpToDate(request.getLastLogTerm(), request.getLastLogIndex())
            && (votedFor == null || votedFor.equals(request.getCandidateId()));
    }
}
```

**为什么日志要「足够新」才能当选？**

因为 Raft 的目标之一是**不丢数据**。如果一个节点的日志太旧，让它当选可能会导致已 committed 的数据丢失。

## 脑裂处理

网络分区是最容易引发脑裂的场景。Raft 是怎么处理的？

```
正常情况（5 节点，3 副本多数派）：
┌──────────────────────────────────┐
│  ┌───┐  ┌───┐  ┌───┐  ┌───┐  ┌───┐ │
│  │ L │  │ F │  │ F │  │ F │  │ F │ │
│  └───┘  └───┘  └───┘  └───┘  └───┘ │
└──────────────────────────────────┘
写入需要 3 节点确认（自己 + 2 Follower）

网络分区（2 节点 vs 3 节点）：
┌─────────────────────┐    ┌─────────────────────────┐
│  ┌───┐  ┌───┐      │    │  ┌───┐  ┌───┐  ┌───┐  │
│  │ L │  │ C │ (少数)│    │  │ L │  │ F │  │ F │  │
│  └───┘  └───┘      │    │  └───┘  └───┘  └───┘  │
└─────────────────────┘    └─────────────────────────┘
少数派：无法当选 Leader，无法写入
多数派：继续工作，成为新的 Leader
```

**Raft 的处理方式：少数派分区无法选举成功，无法写入。** 等待网络恢复后，少数派的 Leader 会发现自己的 term 落后，主动退位。

## Raft 在 TiKV 中的实现

TiKV 的 Raft 实现基于 etcd 的 raft crate，但做了大量定制：

```java
// TiKV 的 Raft 特性
public class TiKV raft {
    // 1. Multi-Raft：每个 Region 独立的 Raft Group
    // 不是整个集群一个 Raft，而是每个 Region 一个
    // 避免单点热点，提高并发度
    public class MultiRaft {
        public void propose(int regionId, byte[] command) {
            Region region = getRegion(regionId);
            RaftGroup raft = region.getRaftGroup();
            raft.propose(command);
        }
    }

    // 2. 异步写入：写入先到 WAL，不阻塞 Raft 复制
    // 3. 批量复制：多个日志批量发送，减少网络往返
    // 4. 快照：Follower 落后太多时，直接发送快照而非日志
}
```

**Multi-Raft 是 TiKV 的关键设计。** 想象一下，如果整个集群只有一个 Raft Group，所有写入都要经过一个 Leader，那不就是一个单点吗？

Multi-Raft 让每个 Region 独立选举 Leader，数据写入可以分散到不同节点，真正实现水平扩展。

## Raft 的性能考量

| 优化点 | 说明 | 效果 |
|-------|------|------|
| 批量复制 | 多个日志条目一次发送 | 减少网络往返 |
| Pipeline | 边发送边确认 | 流水线化 |
| 异步写入 | WAL 顺序写，数据异步刷盘 | 写入延迟降低 |
| 快照 | 跳过过期日志，直接发送状态 | 节点恢复加快 |

## 面试追问

**Q: Raft 和 Paxos 的区别是什么？**

核心区别在于「可理解性」和「领导权」：
- Paxos 是理论协议，Raft 是工程实现
- Raft 强制要有 Leader，Paxos 可以不要
- Raft 通过先选 Leader 再操作日志来简化问题

**Q: 为什么是奇数节点？2 副本行不行？**

不行。Raft 需要多数派（> 50%）确认才能写入。
- 2 节点：多数派 = 2，容错 0 节点（任何节点宕机就无法写入）
- 3 节点：多数派 = 2，容错 1 节点（允许 1 节点宕机）
- 5 节点：多数派 = 3，容错 2 节点

**Q: TiKV 的 Raft 如何保证线性一致性？**

通过 Raft 的日志顺序保证。所有读请求走 Leader，Leader 在确认自己还是有效 Leader 后（lease read 或 read index）返回数据，保证读到的是已提交的数据。

---

## 总结

Raft 协议是 TiKV 强一致性的基石。它通过 Leader 选举、日志复制和多数派确认，实现了分布式环境下数据的一致性。

而 Multi-Raft 设计，让 TiKV 在保证一致性的同时，实现了真正的水平扩展——不同 Region 可以有不同 Leader，负载分散到不同节点。

这就是 TiKV 能在「强一致性」和「高性能」之间取得平衡的关键。
