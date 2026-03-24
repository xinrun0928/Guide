# 一致性模型：强一致性、弱一致性、最终一致性、因果一致性

你和女朋友异地恋，你们共享一个 Google Docs 文档。

场景一：她写了「我想你了」，你立刻看到了。这是**强一致性**。

场景二：她写了「我想你了」，你过了一会儿才看到，但肯定会看到。这是**最终一致性**。

场景三：她写了「我想你了」，但如果她没告诉你，你不知道她写过。这是**弱一致性**。

分布式系统的一致性模型，就是定义「什么时候、什么条件下，你能读到写入的数据」。

## 为什么需要一致性模型？

因为在分布式系统中，「写入」和「读取」之间存在时间和空间的差异：

```
写入节点 A
     ↓ 网络传输
读取节点 B
     ↓ 时间差
数据可能不一样
```

**一致性模型本质上是一个契约**：系统告诉用户「在这种模型下，你一定能读到/可能读到某种数据」。

## 四种一致性模型

### 线性一致性（Linearizability）

**最严格的一致性：所有操作看起来好像是原子性的按时间顺序执行的。**

就像一个全局时钟，每个操作都在某个精确的时间点发生，读取总是能看到最新的写入。

```java
/**
 * 线性一致性示例
 */
public class LinearizableCounter {
    private int value = 0;
    private final Object lock = new Object();
    
    /**
     * 线性一致性的读写操作
     * 
     * 特点：
     * - 读操作要么读到最新的值，要么读到最近一次写入的值
     * - 不存在「读到旧数据」的情况
     * - 所有节点对操作顺序达成共识
     */
    
    public void write(int newValue) {
        synchronized (lock) {
            value = newValue;
        }
    }
    
    public int read() {
        synchronized (lock) {
            return value;
        }
    }
}

/**
 * 分布式场景下的线性一致性实现
 */
public class DistributedLinearizableService {
    
    /**
     * 线性一致性需要共识算法的支持
     * 
     * 流程：
     * 1. Proposer 提出值
     * 2. Acceptor 多数派确认
     * 3. 确认后，所有节点都看到这个值
     * 4. 后续读请求不会读到更旧的值
     */
    public void linearizableWrite(String key, String value) {
        // Paxos 或 Raft 协议实现
        consensusProtocol.propose(new Proposal(key, value));
    }
    
    public String linearizableRead(String key) {
        // 读取 Leader 或执行读 lease
        return consensusProtocol.read(key);
    }
}
```

**生活化理解**：你用微信转账，对方秒收。你转账的操作和对方收款的操作，在整个微信系统的视角下，是「瞬间完成的」，没有中间状态。

### 顺序一致性（Sequential Consistency）

**保证所有节点看到的操作顺序是一致的，但不保证这个顺序和真实时间一致。**

```java
/**
 * 顺序一致性 vs 线性一致性
 */
public class SequentialVsLinear {
    private int x = 0;
    private int y = 0;
    
    /**
     * 顺序一致性保证：
     * 所有进程看到的操作顺序是一样的
     * 但这个顺序不一定是「真实时间顺序」
     * 
     * 例如：
     * 进程 A：x=1
     * 进程 B：y=1
     * 进程 C：可能看到 x=1, y=0 或 x=0, y=1
     * 但不可能看到 y=1, x=0（顺序不一致）
     */
    
    /**
     * 场景：日志写入
     * 顺序一致性保证：所有节点看到的日志顺序是一样的
     * 但节点 A 看到的「时间线」和节点 B 可能不同
     * 
     * 这对于日志分析没问题，因为日志顺序是关键
     */
}
```

**生活化理解**：你和女朋友同时在微信群里发消息，群里的其他人都看到同样的消息顺序。但你发消息的时间和女朋友收到消息的时间，可能有延迟。

### 因果一致性（Causal Consistency）

**只保证因果相关的操作有顺序，不保证无关操作的顺序。**

```java
/**
 * 因果一致性示例
 */
public class SocialMediaCausalConsistency {
    
    /**
     * 因果关系的例子：
     * 
     * 1. 你发了一条朋友圈（操作 A）
     * 2. 女朋友点赞了你的朋友圈（操作 B，依赖于 A）
     * 
     * 因果一致性保证：
     * - 如果你看到点赞（B），那你一定能看到朋友圈（A）
     * - 但其他无关的评论顺序可能不一致
     */
    
    /**
     * 实现方式：向量时钟
     */
    public class VectorClock {
        Map&lt;String, Long&gt; clock = new ConcurrentHashMap&lt;&gt;();
        
        public VectorClock increment(String nodeId) {
            clock.compute(nodeId, (k, v) -&gt; v == null ? 1L : v + 1);
            return this;
        }
        
        /**
         * 判断因果关系
         * 如果 clock1 &lt; clock2，说明 clock1 先发生
         */
        public boolean happensBefore(VectorClock other) {
            boolean allLessOrEqual = true;
            boolean atLeastOneLess = false;
            
            for (String node : clock.keySet()) {
                Long thisTime = clock.get(node);
                Long otherTime = other.clock.get(node);
                
                if (thisTime == null || otherTime == null) {
                    continue;
                }
                
                if (thisTime &lt; otherTime) {
                    atLeastOneLess = true;
                } else if (thisTime &gt; otherTime) {
                    allLessOrEqual = false;
                }
            }
            
            return allLessOrEqual &amp;&amp; atLeastOneLess;
        }
    }
}
```

**生活化理解**：你和女朋友吵架，你说「我不理你了」，然后你女朋友说「好吧随便你」。她知道你说「不理你了」这个事实（因果），但她不知道你什么时候说的具体时间（不关心）。

### 最终一致性（Eventual Consistency）

**最弱的一致性：不做任何保证，但在「没有新写入」的情况下，系统最终会达到一致状态。**

```java
/**
 * 最终一致性示例
 */
public class EventuallyConsistentCache {
    
    /**
     * 读取操作：可能返回旧数据
     */
    public String get(String key) {
        return localCache.get(key);
    }
    
    /**
     * 写入操作：立即返回，异步同步
     */
    public void put(String key, String value) {
        // 1. 写入本地缓存
        localCache.put(key, value);
        
        // 2. 记录同步任务
        syncTaskQueue.add(new SyncTask(key, value));
        
        // 3. 异步同步到其他节点
        // 这个过程可能在几毫秒到几分钟之间
        backgroundThread.submit(() -&gt; {
            for (Node node : allNodes) {
                if (!node.isLocal()) {
                    node.sync(key, value);
                }
            }
        });
    }
    
    /**
     * 最终一致性保证：
     * - 写入会成功（可用性）
     * - 读取可能读到旧数据
     * - 但最终，所有节点会看到相同的值
     */
}
```

**生活化理解**：你在微博关注了一个大 V，刚关注时你看不到他的历史微博。过了一会儿（几秒到几分钟），他的微博出现在你的 feed 里——这就是最终一致性。

## 一致性级别对比

| 一致性级别 | 定义 | 实现难度 | 性能代价 | 适用场景 |
|---------|------|--------|--------|---------|
| 线性一致性 | 全局顺序 + 实时性 | 极高 | 最高 | 分布式锁、事务 |
| 顺序一致性 | 全局顺序 | 高 | 高 | 日志系统 |
| 因果一致性 | 因果顺序 | 中 | 中 | 社交系统、评论 |
| 最终一致性 | 无保证，但最终一致 | 低 | 低 | 缓存、CDN |

## 不同一致性下的读写行为

```java
/**
 * 不同一致性模型下的读写行为对比
 */
public class ConsistencyBehaviorDemo {
    
    // 假设有两个变量 x 和 y，初始值为 0
    private int x = 0;
    private int y = 0;
    
    /**
     * 线性一致性：最严格
     * 
     * 操作序列（进程A写x=1，进程B读，进程C写y=1）：
     * - 所有读操作必须看到之前的写入
     * - 如果读到了 y=1，那一定能看到 x=1（因为 x 先写入）
     */
    public void linearizableScenario() {
        Thread A = new Thread(() -&gt; x = 1);
        Thread B = new Thread(() -&gt; { /* 读取 x，必须是 1 */ });
        Thread C = new Thread(() -&gt; y = 1);
        
        // 线性一致性保证所有操作有全局顺序
    }
    
    /**
     * 顺序一致性：保证全局顺序，但不保证实时性
     * 
     * 可能序列（与时间无关，但顺序一致）：
     * - y=1 先于 x=1 被所有进程看到
     * - 这是可能的，因为 x=1 和 y=1 没有因果关系
     */
    public void sequentialScenario() {
        // 不关心真实时间，只关心全局顺序
    }
    
    /**
     * 因果一致性：只保证因果相关的顺序
     * 
     * 如果操作序列是：
     * 1. A: x = 1
     * 2. B: y = x + 1（依赖于 A 的写入）
     * 3. C: 读取 x 和 y
     * 
     * 因果一致性保证 C 看到的顺序：先看到 x=1，再看到 y=2
     */
    public void causalScenario() {
        // 关键：因果相关的操作必须有序
    }
    
    /**
     * 最终一致性：只保证最终会一致
     * 
     * 可能序列：
     * - A: x = 1（写入）
     * - C: 读取 x，得到 0（还在同步中）
     * - C: 再读一次，得到 1（同步完成）
     */
    public void eventualScenario() {
        // 不保证何时一致，只保证最终一致
    }
}
```

## 面试追问方向

**追问 1：为什么线性一致性在分布式系统中几乎不可实现？**

因为分布式系统中的时钟不同步。即使使用 NTP 同步，也存在毫秒级的误差。更根本的问题是：爱因斯坦的相对论告诉我们，不存在全局时间。所以线性一致性是一个理想模型，工程中通常用 Raft/Paxos 来「近似」实现。

**追问 2：MySQL 的事务隔离级别对应哪种一致性模型？**

- READ UNCOMMITTED：弱一致性
- READ COMMITTED：满足顺序一致性
- REPEATABLE READ：在事务内满足线性一致性（MySQL 的 MVCC 实现）
- SERIALIZABLE：满足线性一致性

**追问 3：Redis 的主从复制是什么一致性模型？**

默认是最终一致性。但如果开启 `WAIT` 命令，可以指定同步到多少个从节点，实现更强的（但不保证线性）一致性。

## 总结

一致性模型是分布式系统的「契约」：

1. **线性一致性**：最强，但代价最高，像一个全局时钟
2. **顺序一致性**：保证全局顺序，不保证实时性
3. **因果一致性**：只关心因果关系，忽略无关顺序
4. **最终一致性**：最弱，但性能最好，互联网应用的主流选择

> "理解一致性模型，就是理解分布式系统的本质：你永远无法同时拥有完美的一致性和完美的性能。知道在什么场景下妥协，是分布式工程师的核心能力。"
