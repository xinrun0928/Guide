# Paxos 算法：Basic Paxos 与 Multi-Paxos

1989 年，Leslie Lamport 发表了一篇论文，题目叫「The Part-Time Parliament」。

论文讲的是一个关于古希腊 Paxos 小岛上议会如何通过法令的故事。

编辑部拒绝了论文，理由是「太难理解」。

Lamport 坚持说「这个比喻让 Paxos 算法变得更容易理解」。

编辑部的回应是：「我们收到过很多用数学方法描述算法的论文，这篇用故事描述的论文让我们很为难。要不你用数学语言重新写一遍？」

Lamport 后来又写了一版，1998 年终于发表。

**这就是 Paxos 算法的故事——一个被埋没了近 10 年的分布式共识算法。**

## Paxos 要解决什么问题？

**在分布式系统中，多个节点如何就一个值达成一致？**

```
场景：5 个节点的分布式系统
节点 1 提出：值 = A
节点 3 提出：值 = B
节点 5 提出：值 = C

最终结果：所有节点必须接受同一个值
```

这个问题看起来简单，但 FLP 定理告诉我们：**在纯异步系统中，如果存在节点可能故障，没有任何算法能保证总是达成共识。**

Paxos 的贡献是：**它提供了一个在大多数情况下能工作的算法。**

## Basic Paxos：两阶段提交

Basic Paxos 有三个角色：

```
Proposer（提议者）：提出值
Acceptor（接受者）：投票决定接受哪个值
Learner（学习者）：学习最终结果
```

### 两个阶段

```
Phase 1：Prepare（准备阶段）

Proposer 选择一个提案号 N，向所有 Acceptor 发送 Prepare(N)
Acceptor 收到 Prepare(N)：
  - 如果 N > 任何已见过的提案号：承诺不再接受小于 N 的提案，返回 Promise
  - 如果 N <= 已见过的提案号：忽略或拒绝

Phase 2：Accept（接受阶段）

Proposer 收到多数派 Promise：
  - 如果有 Promise 包含已接受的值：使用已接受的值
  - 否则：使用自己的值
  向所有 Acceptor 发送 Accept(N, value)

Acceptor 收到 Accept(N, value)：
  - 如果 N >= 之前承诺的最小提案号：接受，返回 Accepted
  - 否则：忽略
```

### Java 实现：简化版 Basic Paxos

```java
/**
 * Basic Paxos 简化实现
 * 
 * 注意：这是一个概念性实现
 * 实际生产环境请使用成熟的库，如 Apache Curator
 */
public class BasicPaxos {
    
    // 提案号
    private long proposalNumber = 0;
    private final long nodeId;
    
    // 已接受的提案
    private long acceptedNumber = -1;
    private String acceptedValue = null;
    
    public BasicPaxos(long nodeId) {
        this.nodeId = nodeId;
    }
    
    /**
     * Proposer：提议一个值
     */
    public String propose(String value, List&lt;BasicPaxos&gt; acceptors) throws Exception {
        // ============ Phase 1: Prepare ============
        proposalNumber++;
        
        // 向所有 Acceptor 发送 Prepare
        List&lt;Promise&gt; promises = new ArrayList&lt;&gt;();
        for (BasicPaxos acceptor : acceptors) {
            Promise promise = acceptor.receivePrepare(proposalNumber);
            if (promise != null) {
                promises.add(promise);
            }
        }
        
        // 如果没有收到多数派 Promise，提议失败
        if (promises.size() &lt;= acceptors.size() / 2) {
            return null;
        }
        
        // ============ Phase 2: Accept ============
        // 找出 Promise 中已接受的最大值
        String valueToPropose = value;
        long highestAcceptedNumber = -1;
        
        for (Promise promise : promises) {
            if (promise.hasAcceptedValue() &amp;&amp; 
                promise.getAcceptedNumber() &gt; highestAcceptedNumber) {
                valueToPropose = promise.getAcceptedValue();
                highestAcceptedNumber = promise.getAcceptedNumber();
            }
        }
        
        // 向所有 Acceptor 发送 Accept
        List&lt;Accepted&gt; acceptedList = new ArrayList&lt;&gt;();
        for (BasicPaxos acceptor : acceptors) {
            Accepted accepted = acceptor.receiveAccept(proposalNumber, valueToPropose);
            if (accepted != null) {
                acceptedList.add(accepted);
            }
        }
        
        // 如果没有收到多数派 Accepted，提议失败
        if (acceptedList.size() &lt;= acceptors.size() / 2) {
            return null;
        }
        
        return valueToPropose;
    }
    
    /**
     * Acceptor：处理 Prepare 请求
     * 
     * 关键规则：
     * 1. 只承诺大于当前提案号的提案
     * 2. 返回已接受的最高提案号的值
     */
    public Promise receivePrepare(long n) {
        synchronized (this) {
            if (n &gt; proposalNumber) {
                proposalNumber = n;
                return new Promise(acceptedNumber, acceptedValue);
            }
            return null;
        }
    }
    
    /**
     * Acceptor：处理 Accept 请求
     */
    public Accepted receiveAccept(long n, String value) {
        synchronized (this) {
            // 只有当 n &gt;= 承诺的提案号时，才接受
            if (n &gt;= proposalNumber) {
                acceptedNumber = n;
                acceptedValue = value;
                return new Accepted(true);
            }
            return null;
        }
    }
    
    /**
     * 辅助类：Promise
     */
    static class Promise {
        private final long acceptedNumber;
        private final String acceptedValue;
        
        public Promise(long acceptedNumber, String acceptedValue) {
            this.acceptedNumber = acceptedNumber;
            this.acceptedValue = acceptedValue;
        }
        
        public boolean hasAcceptedValue() {
            return acceptedNumber != -1;
        }
        
        public long getAcceptedNumber() {
            return acceptedNumber;
        }
        
        public String getAcceptedValue() {
            return acceptedValue;
        }
    }
    
    /**
     * 辅助类：Accepted
     */
    static class Accepted {
        private final boolean success;
        
        public Accepted(boolean success) {
            this.success = success;
        }
        
        public boolean isSuccess() {
            return success;
        }
    }
}
```

### 为什么需要多数派（Quorum）？

```
问题：为什么 Paxos 要求多数派，而不是全部节点？

场景：5 节点系统

方案 A：全部同意（5/5）
- 优点：所有人都知道结果
- 缺点：任何一节点故障，系统就不可用

方案 B：多数派同意（3/5）
- 优点：允许 2 个节点故障
- 缺点：可能存在不一致的风险

为什么 Paxos 选择多数派？

Paxos 的核心是「两个多数派必然有交集」：
- 如果提案 A 被多数派接受
- 提案 B 要被多数派接受
- 这两个多数派至少有一个共同的 Acceptor

这个交集保证了：如果提案 A 被选中，后续的提案必须包含 A 的值。
```

## Multi-Paxos：连续值共识

Basic Paxos 只能就单个值达成共识。Multi-Paxos 是对 Basic Paxos 的扩展，用于就一系列值达成共识。

### 核心优化：选出一个 Leader

```
Basic Paxos 的问题：
- 每个提案都需要两轮 RPC
- Proposer 冲突可能导致活锁

Multi-Paxos 的优化：
- 选出一个 Leader
- Leader 连续提议时，可以跳过 Prepare 阶段
- 只需要 Accept 阶段
```

```java
/**
 * Multi-Paxos：使用 Leader 优化
 */
public class MultiPaxos {
    
    private final long nodeId;
    private volatile boolean isLeader = false;
    private long currentLeaderId = -1;
    
    // 日志条目
    private final List&lt;LogEntry&gt; log = new ArrayList&lt;&gt;();
    private long commitIndex = -1;
    
    /**
     * 连续的 Accept（跳过 Prepare）
     * 
     * 只有在以下情况需要重新 Prepare：
     * 1. 选举新 Leader 时
     * 2. 检测到提案冲突时
     */
    public boolean accept(LogEntry entry, List&lt;MultiPaxos&gt; acceptors) {
        if (!isLeader) {
            throw new IllegalStateException("我不是 Leader");
        }
        
        // 添加到本地日志
        entry.setIndex(log.size());
        entry.setTerm(currentLeaderId);
        log.add(entry);
        
        // 直接发送 Accept
        int acceptedCount = 1;
        for (MultiPaxos acceptor : acceptors) {
            if (acceptor != this &amp;&amp; acceptor.receiveAccept(entry)) {
                acceptedCount++;
            }
        }
        
        // 多数派确认
        if (acceptedCount &gt; acceptors.size() / 2) {
            commitIndex = entry.getIndex();
            return true;
        }
        
        return false;
    }
    
    public boolean receiveAccept(LogEntry entry) {
        synchronized (this) {
            // Multi-Paxos 中，Acceptor 只检查 Leader ID
            // 如果提案来自当前 Leader，接受
            if (entry.getTerm() == currentLeaderId) {
                log.add(entry);
                return true;
            }
            return false;
        }
    }
    
    /**
     * Leader 选举
     */
    public void leaderElection() {
        // 使用 Basic Paxos 选出一个 Leader
        BasicPaxos paxos = new BasicPaxos(nodeId);
        
        try {
            String leaderValue = paxos.propose("leader-" + nodeId, getAllNodes());
            if (leaderValue != null &amp;&amp; leaderValue.equals("leader-" + nodeId)) {
                isLeader = true;
                currentLeaderId = nodeId;
            }
        } catch (Exception e) {
            // 选举失败，重试
        }
    }
}
```

## Paxos 的工程难点

### 活锁问题

```java
/**
 * Paxos 活锁场景
 */
public class PaxosLivelock {
    
    /**
     * 场景：
     * 
     * T=0: P1 提出提案 1.1
     * T=1: A1 承诺接受 1.1
     * T=2: P2 提出提案 2.1（更高）
     * T=3: A1、A2 承诺接受 2.1（必须拒绝 1.1）
     * T=4: P1 被拒绝，用 1.2 重试
     * T=5: A1、A2 承诺接受 1.2（必须拒绝 2.1）
     * T=6: P2 被拒绝，用 2.2 重试
     * ...
     * 无限循环！
     */
}
```

**解决方案**：使用随机退避，或者 Multi-Paxos 中选出 Leader。

### 难以实现

Paxos 论文只描述了算法的大致框架，很多实现细节没有说明：

```
缺失的实现细节：
1. Leader 选举如何进行？
2. 客户端请求如何路由？
3. 如何处理 Proposer 故障？
4. 如何实现成员变更？
5. 快照和日志压缩如何做？
```

**实际生产系统通常基于 Multi-Paxos 的变体**：Chubby、Spanner、Azure Cosmos DB 等。

## 面试追问方向

### Q1：Paxos 和 Raft 的核心区别是什么？

**表面区别**：

- Paxos 是理论算法，Raft 是工程实现
- Paxos 可以没有 Leader，Raft 必须有 Leader
- Paxos 的提案号是单一数字，Raft 用 (Term, 索引) 定位

**核心区别**：

- Paxos 更通用但更难实现
- Raft 通过 Leader 简化了问题，提高了效率
- Raft 的日志复制有更强的约束

### Q2：为什么 Paxos 难以实现？

1. **论文表述晦涩**：原始论文用古希腊故事比喻，很多工程细节没有说明
2. **活锁问题**：Basic Paxos 在高并发下可能活锁
3. **Multi-Paxos 不完整**：原始论文只描述了 Basic Paxos，Multi-Paxos 的实现需要自己设计
4. **优化空间大**：标准 Paxos 效率不高，实际系统需要大量优化

### Q3：Google Chubby 是如何实现 Paxos 的？

Chubby 是 Google 内部的分布式锁服务，基于 Paxos 实现：

1. **使用 Paxos 做 Leader 选举**：选出 Master
2. **Master 处理所有写请求**：读请求可以在副本上读
3. **副本同步**：使用类似 Paxos 的协议同步状态
4. **租约机制**：Master 有租约，过期需要重新选举

## 总结

Paxos 算法是分布式共识的基石：

1. **Basic Paxos**：解决了单个值的共识问题，通过 Prepare-Accept 两阶段达成
2. **Multi-Paxos**：扩展到连续值，通过 Leader 优化效率
3. **核心思想**：多数派 + 提案号排序 = 共识

> "Paxos 教会我们的是：在不确定的世界中，通过精心设计的协议，可以在大多数情况下达成共识。虽然不是 100%，但这就是分布式系统的本质——接受不确定性，用概率换确定性。"
