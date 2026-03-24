# 分布式共识算法：Paxos、Raft、ZAB 对比

想象一个场景：

10 个人坐在会议室里，需要对「明天去杭州还是上海」达成一致。

**没有共识算法的混乱**：
```
A 说去杭州
B 说去上海
C 说去北京
D 同意 A
E 同意 B
...
吵了 3 小时，没结论。
```

**有共识算法的好处**：
```
有人提议（Proposer）：我觉得去杭州吧
大家投票（Acceptor）：多数人同意
达成共识（Learner）：好，去杭州
```

这就是分布式共识算法要解决的问题：**在多个节点中，如何就一个值达成一致。**

## 共识算法要解决的核心问题

分布式共识算法需要回答三个问题：

1. **谁来提议？**（Leader vs 多节点提议）
2. **谁来决定？**（多数派 vs 全部节点）
3. **如何保证正确性？**（Safety vs Liveness）

## 三种共识算法概览

### Paxos：理论奠基者

```
提出时间：1989 年（Lamport）
地位：分布式系统领域的「相对论」
特点：理论完备，但难以实现
变体：Basic Paxos、Multi-Paxos、Cheap Paxos
```

### Raft：「可理解的」共识算法

```
提出时间：2014 年（Diego Ongaro、John Ousterhout）
目标：比 Paxos 更容易理解
特点：分解为三个子问题（日志复制、Leader 选举、安全性）
代表系统：etcd、Consul、CockroachDB、TiKV
```

### ZAB：ZooKeeper 的共识协议

```
提出时间：2007 年（Hunt、Krishnan）
目标：支持 ZooKeeper 的主备切换
特点：专门为 ZooKeeper 设计，支持两种模式（广播、恢复）
代表系统：Apache ZooKeeper
```

## 三者横向对比

| 维度 | Paxos | Raft | ZAB |
|-----|-------|------|-----|
| 提出背景 | 理论研究 | 工程实践 | ZooKeeper 专用 |
| 理论 vs 工程 | 纯理论 | 工程化 | 面向 ZooKeeper |
| 领导人机制 | 可选（Multi-Paxos） | 必需 | 必需 |
| 日志复制 | 基于提案号 | 基于索引 | 基于 ZXID |
| 选主依据 | 多数派投票 | Term + 随机超时 | ZXID 最大 |
| 写确认 | 多数派 | 多数派 | 多数派 |
| 实现难度 | 极高 | 中等 | 中等 |
| 社区生态 | 理论参考 | 广泛应用 | ZooKeeper 专用 |

## 核心概念对比

### 提案编号

| 算法 | 提案号格式 | 特点 |
|-----|-----------|------|
| Paxos | 提案号 N | 全局递增，可能很大 |
| Raft | (Term, 日志索引) | Term + 日志位置双重定位 |
| ZAB | ZXID = (epoch, counter) | epoch = 选举轮次，counter = 事务序号 |

### Leader 选举

**Paxos**：
- Basic Paxos 没有 Leader，Multi-Paxos 可以选出一个 Leader 优化
- 选举方式：没有固定规则，谁先提议谁可能被选中

**Raft**：
- 必须有 Leader
- 选举方式：Term + 随机超时 + 多数派投票
- 安全性保证：只有包含所有已提交日志的 Candidate 才能成为 Leader

**ZAB**：
- 必须有 Leader
- 选举方式：ZXID 最大者胜出
- 选举轮次 epoch 递增

### 日志复制

**Paxos**：
```
Proposer 提出值 v
Acceptor 收到 Prepare(N) → 返回 Promise
Proposer 收到多数派 Promise → 发送 Accept(N, v)
Acceptor 收到 Accept → 写入日志，回复 Accepted
Learner 收到多数派 Accepted → 应用到状态机
```

**Raft**：
```
Client 发送写请求给 Leader
Leader 追加日志条目，不提交
Leader 并行发送 AppendEntries 给所有 Follower
Follower 写入日志，回复成功
Leader 收到多数派成功 → 提交日志
Leader 通知 Follower 提交
Leader 返回 Client 成功
```

**ZAB**：
```
Leader 收到写请求
Leader 生成 ZXID，写入本地日志
Leader 并行发送 PROPOSAL 给所有 Follower
Follower 写入 PROPOSAL，回复 ACK
Leader 收到多数派 ACK → 发送 COMMIT
所有节点应用事务到状态机
```

## Safety vs Liveness

这是共识算法的两个核心属性：

### Safety（安全性）

> 「永远不会发生错误的事情」

```
Paxos Safety：
- 最多只有一个值被选中
- 只有被选中的值才能被学习
- 节点只学习已经被选中的值

Raft Safety：
- 只有一个 Leader
- Leader 不会覆盖已提交的日志
- 日志 index 小的永远比 index 大的先提交
```

### Liveness（活性）

> 「正确的事情最终一定会发生」

```
Paxos Liveness：
- FLP 定理证明了纯异步下 Liveness 不可能
- 工程上通过随机化超时实现「概率性」Liveness

Raft Liveness：
- 由于随机超时，选票瓜分概率极低
- 最终总有一个节点会成为 Leader
```

## 实际选型建议

### 选 Raft 的场景

```
适合 Raft 的情况：
- 你需要一个生产级别的共识算法
- 你的系统需要 Leader（简化决策）
- 你希望算法易于理解和实现
- 你需要和 etcd、Consul 等系统集成

代表场景：
- 分布式配置中心（etcd）
- 服务发现（Consul）
- 分布式数据库（TiKV、CockroachDB）
- 分布式协调（各种需要分布式锁的场景）
```

### 选 ZAB 的场景

```
适合 ZAB 的情况：
- 你已经在使用 ZooKeeper
- 你需要一个成熟的分布式协调服务
- 你需要临时节点、监视点等功能

代表场景：
- Leader 选举
- 分布式锁
- 配置管理
- 服务注册与发现
```

### Paxos 的地位

```
Paxos 适合：
- 理解分布式共识的理论基础
- 面试准备
- 需要深度定制的场景

不适合：
- 生产环境直接使用（Paxos 论文缺乏实现细节）
- 需要快速落地的项目

实际工程：
- Chubby（Google）：基于 Paxos
- Spanner（Google）：基于 Paxos
- Azure Cosmos DB：基于 Paxos 变体
```

## 代码对比：提案提议

### Paxos 风格

```java
/**
 * Paxos 提议过程
 */
public class PaxosProposer {
    
    private int proposalNumber = 0;
    private String proposedValue;
    
    public void propose(String value) throws Exception {
        proposalNumber++;
        proposedValue = value;
        
        // Phase 1: Prepare
        int prepareNumber = proposalNumber;
        List&lt;Promise&gt; promises = new ArrayList&lt;&gt;();
        
        for (Acceptor acceptor : acceptors) {
            Promise promise = acceptor.receivePrepare(prepareNumber);
            if (promise != null) {
                promises.add(promise);
            }
        }
        
        // 如果有 acceptor 已经接受过值，使用已接受的值
        for (Promise promise : promises) {
            if (promise.hasAcceptedValue()) {
                proposedValue = promise.getAcceptedValue();
                break;
            }
        }
        
        // Phase 2: Accept
        if (promises.size() &gt; acceptors.size() / 2) {
            for (Acceptor acceptor : acceptors) {
                acceptor.receiveAccept(prepareNumber, proposedValue);
            }
        }
    }
}
```

### Raft 风格

```java
/**
 * Raft 日志追加过程
 */
public class RaftLogReplication {
    
    public void replicateLog(String command) {
        // 1. Leader 追加日志
        long newLogIndex = appendEntry(command);
        
        // 2. 并行发送给所有 Follower
        List&lt;Future&lt;AppendEntriesResponse&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (Peer peer : peers) {
            futures.add(sendAppendEntries(peer, newLogIndex));
        }
        
        // 3. 等待多数派确认
        int successCount = 1; // 包含 Leader 自己
        for (Future&lt;AppendEntriesResponse&gt; future : futures) {
            AppendEntriesResponse response = future.get();
            if (response.success) {
                successCount++;
            }
        }
        
        // 4. 多数派成功，提交日志
        if (successCount &gt; peers.size() / 2) {
            commitToIndex(newLogIndex);
            applyToStateMachine(command);
        }
    }
    
    private long appendEntry(String command) {
        LogEntry entry = new LogEntry();
        entry.setTerm(currentTerm);
        entry.setCommand(command);
        entry.setIndex(nextLogIndex++);
        log.add(entry);
        return entry.getIndex();
    }
}
```

### ZAB 风格

```java
/**
 * ZAB 广播过程
 */
public class ZABBroadcast {
    
    private final BlockingQueue&lt;Proposal&gt; proposalQueue = new LinkedBlockingQueue&lt;&gt;();
    
    public void broadcast(String transaction) {
        // 1. Leader 生成 ZXID
        ZXID zxid = generateZXID();
        
        // 2. 创建 Proposal
        Proposal proposal = new Proposal(zxid, transaction);
        
        // 3. 写入本地日志
        writeToLog(proposal);
        
        // 4. 发送给所有 Follower
        for (Peer peer : peers) {
            peer.sendProposal(proposal);
        }
        
        // 5. 等待多数派 ACK
        int ackCount = 1;
        synchronized (proposal) {
            while (ackCount &lt;= peers.size() / 2) {
                proposal.wait();
                ackCount++;
            }
        }
        
        // 6. 提交
        commit(proposal);
    }
    
    private ZXID generateZXID() {
        long epoch = currentEpoch;
        long counter = nextCounter++;
        return new ZXID(epoch, counter);
    }
}
```

## 面试高频问题

### Q1：Raft 和 Paxos 的核心区别是什么？

**表面区别**：

- Paxos 是理论，Paxos 是工程实现
- Paxos 可以没有 Leader，Raft 必须有 Leader

**深层区别**：

- Raft 将问题分解为三个独立子问题（日志复制、Leader 选举、安全性）
- Paxos 是一个统一的算法，难以理解和实现
- Raft 通过 Leader 简化了决策过程，提高了效率

### Q2：为什么 Raft 更适合工程实现？

1. **分解问题**：Raft 将复杂的共识问题分解为三个相对独立的问题
2. **更强的约束**：Raft 对 Leader 和日志有更强的约束，减少了不确定性
3. **明确的流程**：Raft 的流程更明确，易于实现和调试
4. **可视化工具**：Raft 有在线可视化工具（The Secret Lives of Data）

### Q3：ZAB 和 Raft 的区别是什么？

| 区别 | ZAB | Raft |
|-----|-----|------|
| Leader 确认 | ZXID 最大 | 多数派投票 |
| 日志复制 | PROPOSAL-ACK-COMMIT | AppendEntries |
| 读操作 | 可以在 Follower 读 | 推荐从 Leader 读 |
| 适用场景 | ZooKeeper 专用 | 通用 |

## 总结

三种共识算法，各有特点：

1. **Paxos**：理论完备，是分布式共识的「圣经」，但难以直接工程实现
2. **Raft**：目前最流行的共识算法，易于理解，适合大多数场景
3. **ZAB**：专为 ZooKeeper 设计，与 ZooKeeper 生态深度绑定

> "理解共识算法的核心是理解如何在不确定的环境中达成确定性共识。不同的算法，本质上是不同的权衡：Paxos 追求理论完美，Raft 追求工程实用，ZAB 追求与 ZooKeeper 的契合。"
