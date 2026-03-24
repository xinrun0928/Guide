# ZAB 协议：ZooKeeper 原子广播协议

ZooKeeper 是一个被广泛使用的分布式协调服务。

etcd 可以用它来实现分布式锁、配置管理、服务发现。

但 ZooKeeper 用的是什么共识算法？

答案是 ZAB——ZooKeeper Atomic Broadcast。

## ZAB 的设计目标

ZAB 是专门为 ZooKeeper 设计的原子广播协议，它要解决三个问题：

```
1. 主备切换：当 Leader 故障时，如何快速选出新 Leader
2. 数据同步：新 Leader 如何追上最新的数据
3. 事务顺序：如何保证所有节点看到的事务顺序一致
```

**ZooKeeper 的核心需求**：写请求必须在 Leader 上执行，且所有写请求必须全局有序。

## ZXID：事务的身份证

ZAB 的核心是 ZXID（ZooKeeper Transaction ID）。

```java
/**
 * ZXID 结构
 * 
 * ZXID 是一个 64 位整数，由两部分组成：
 * - epoch：高 32 位，选举轮次
 * - counter：低 32 位，事务计数器
 * 
 * 设计目的：
 * 1. 通过 epoch 区分不同选举轮次
 * 2. 通过 counter 保证同一轮次内的顺序
 */
public class ZXID implements Comparable&lt;ZXID&gt; {
    
    private final long epoch;      // 选举轮次（相当于 Raft 的 Term）
    private final long counter;     // 事务计数器
    
    public ZXID(long epoch, long counter) {
        this.epoch = epoch;
        this.counter = counter;
    }
    
    /**
     * 从 long 值解析 ZXID
     */
    public static ZXID fromLong(long value) {
        long epoch = value &gt;&gt;&gt; 32;
        long counter = value &amp; 0xFFFFFFFFL;
        return new ZXID(epoch, counter);
    }
    
    /**
     * 转为 long 值存储
     */
    public long toLong() {
        return (epoch &lt;&lt; 32) | counter;
    }
    
    /**
     * 生成新的 ZXID
     */
    public static ZXID next(ZXID current) {
        if (current == null) {
            return new ZXID(1, 0);
        }
        if (current.counter == 0xFFFFFFFFL) {
            // counter 溢出，epoch + 1
            return new ZXID(current.epoch + 1, 0);
        }
        return new ZXID(current.epoch, current.counter + 1);
    }
    
    @Override
    public int compareTo(ZXID other) {
        // 先比较 epoch
        if (this.epoch != other.epoch) {
            return Long.compare(this.epoch, other.epoch);
        }
        // epoch 相同，比较 counter
        return Long.compare(this.counter, other.counter);
    }
}
```

### ZXID 的比较规则

```
ZXID A: epoch=3, counter=100 → 0x300000064
ZXID B: epoch=3, counter=99  → 0x300000063
ZXID C: epoch=2, counter=200 → 0x2000000C8

比较结果：
A &gt; B &gt; C

原因：
1. 先比较 epoch，3 &gt; 2
2. epoch 相同，比较 counter，100 &gt; 99
```

## 两种运行模式

ZAB 有两种运行模式：

```
1. 广播模式（Broadcast）：正常工作时使用
2. 恢复模式（Recovery）：Leader 故障后，需要同步数据
```

### 广播模式

广播模式的工作流程类似两阶段提交，但做了优化：

```java
/**
 * ZAB 广播模式
 * 
 * 类似两阶段提交，但不需要等待所有节点确认
 * 只需要多数派节点确认即可
 */
public class ZABBroadcast {
    
    private volatile ZXID lastCommitedZxid;
    private final BlockingQueue&lt;Proposal&gt; pendingProposals = new LinkedBlockingQueue&lt;&gt;();
    
    /**
     * Leader 处理写请求
     */
    public void processWrite(String request) {
        // 1. 生成 ZXID
        ZXID zxid = ZXID.next(lastCommitedZxid);
        
        // 2. 创建 Proposal
        Proposal proposal = new Proposal(zxid, request);
        
        // 3. 写入本地日志（持久化）
        writeToLog(proposal);
        
        // 4. 发送给所有 Follower
        for (Follower follower : followers) {
            follower.sendProposal(proposal);
        }
        
        // 5. 等待多数派 ACK（不等待所有节点）
        synchronized (proposal) {
            while (proposal.getAckCount() &lt; majority) {
                try {
                    proposal.wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        
        // 6. 提交
        commit(proposal.getZxid());
    }
    
    /**
     * Follower 处理 Proposal
     */
    public void onProposal(Proposal proposal) {
        // 1. 写入日志
        writeToLog(proposal);
        
        // 2. 发送 ACK 给 Leader
        sendAck(proposal.getZxid());
    }
    
    /**
     * Leader 收到 ACK 后，发送 COMMIT
     */
    public void onAck(ZXID zxid) {
        Proposal proposal = findProposal(zxid);
        proposal.addAck();
        
        if (proposal.getAckCount() &gt;= majority) {
            // 多数派确认，发送 COMMIT
            broadcastCommit(zxid);
        }
    }
}
```

### 恢复模式

当 Leader 故障时，系统进入恢复模式：

```
恢复模式的目的：
1. 选出一个有最新数据的 Leader
2. 让新 Leader 同步数据到多数派
3. 保证不丢失已提交的事务
```

```java
/**
 * ZAB 恢复模式
 */
public class ZABRecovery {
    
    /**
     * Leader 选举
     * 
     * 选举规则：
     * 1. epoch 大的优先
     * 2. epoch 相同，ZXID 大的优先（数据最新）
     * 3. epoch 和 ZXID 都相同，serverId 大的优先
     */
    public void leaderElection() {
        Vote bestVote = null;
        
        for (Server server : allServers) {
            Vote vote = server.getVote();
            
            if (bestVote == null || isVoteBetter(vote, bestVote)) {
                bestVote = vote;
            }
        }
        
        // 宣布自己是 Leader
        announceLeader(bestVote);
    }
    
    /**
     * 比较两个投票
     */
    private boolean isVoteBetter(Vote newVote, Vote currentVote) {
        // 1. 先比较 epoch
        if (newVote.getEpoch() &gt; currentVote.getEpoch()) {
            return true;
        }
        if (newVote.getEpoch() &lt; currentVote.getEpoch()) {
            return false;
        }
        
        // 2. epoch 相同，比较 ZXID
        if (newVote.getZxid() &gt; currentVote.getZxid()) {
            return true;
        }
        if (newVote.getZxid() &lt; currentVote.getZxid()) {
            return false;
        }
        
        // 3. 都相同，比较 serverId
        return newVote.getServerId() &gt; currentVote.getServerId();
    }
    
    /**
     * 数据同步
     * 
     * 新 Leader 可能缺失一些已提交的事务
     * 需要从其他节点同步
     */
    public void syncData() {
        // 1. 获取所有 Follower 的最后一条日志
        Map&lt;Server, ZXID&gt; followerLastZxid = new HashMap&lt;&gt;();
        for (Follower follower : followers) {
            ZXID zxid = follower.getLastZxid();
            followerLastZxid.put(follower, zxid);
        }
        
        ZXID myLastZxid = getLastZxid();
        
        // 2. 找出缺失的事务
        List&lt;Proposal&gt; missingProposals = new ArrayList&lt;&gt;();
        for (ZXID zxid = myLastZxid.next(); zxid.compareTo(maxZxid) &lt;= 0; zxid = zxid.next()) {
            missingProposals.add(getProposal(zxid));
        }
        
        // 3. 发送缺失的事务给 Follower
        for (Follower follower : followers) {
            ZXID followerLast = followerLastZxid.get(follower);
            List&lt;Proposal&gt; toSync = filterMissing(followerLast, missingProposals);
            for (Proposal p : toSync) {
                follower.sendProposal(p);
            }
        }
    }
}
```

## ZAB vs Raft

| 维度 | ZAB | Raft |
|-----|-----|------|
| 选主依据 | ZXID 最大 | Term + 随机超时 |
| 日志同步 | 新 Leader 补发未提交的事务 | 通过日志比较 |
| 写确认 | 多数派 ACK + COMMIT | 多数派确认 |
| 读操作 | 可以在 Follower 读 | 推荐从 Leader 读 |
| 适用场景 | ZooKeeper 专用 | 通用 |

## 写请求的全局顺序保证

ZooKeeper 的核心特性之一是**写请求的全局顺序**。

```
这意味着：

1. 所有写请求必须经过 Leader
2. Leader 为每个写请求分配唯一的 ZXID
3. ZXID 严格递增，保证顺序
4. 即使并发请求，ZXID 也是连续的

场景：

客户端 A 发送写请求 W1
客户端 B 发送写请求 W2
客户端 C 发送写请求 W3

处理顺序：
- 三个请求都发给 Leader
- Leader 按顺序分配 ZXID：W1=1, W2=2, W3=3
- 按顺序广播：W1 → W2 → W3
- 所有节点看到的顺序都是：W1, W2, W3
```

```java
/**
 * 写请求全局顺序保证
 */
public class WriteOrdering {
    
    /**
     * Leader 处理写请求
     * 
     * 关键点：
     * 1. 写请求必须串行处理
     * 2. 每个写请求分配唯一的 ZXID
     * 3. 按 ZXID 顺序广播
     */
    public synchronized Proposal processRequest(Request request) {
        // 等待前面的请求处理完成
        while (pendingRequestCount &gt; 0) {
            wait();
        }
        
        // 分配 ZXID
        ZXID zxid = generateZxid();
        Proposal proposal = new Proposal(zxid, request);
        
        // 广播
        broadcast(proposal);
        
        // 等待提交
        waitForCommit(zxid);
        
        return proposal;
    }
    
    /**
     * 非 Leader 节点转发写请求
     */
    public void forwardToLeader(Request request) {
        // 只能转发给 Leader
        // 顺序由 Leader 保证
        leader.receiveRequest(request);
    }
}
```

## ZooKeeper 的 Watch 机制

ZooKeeper 的 Watch 机制与 ZAB 紧密相关：

```
Watch 通知的顺序保证：
1. Watch 事件和写操作使用相同的 ZXID
2. 如果写操作成功，对应的 Watch 一定会被触发
3. Watch 事件的顺序与写操作的顺序一致
```

```java
/**
 * ZooKeeper Watch 机制
 */
public class WatchManager {
    
    /**
     * 触发 Watch
     * 
     * Watch 事件与 ZXID 绑定
     * 保证事件的顺序与数据变更的顺序一致
     */
    public void triggerWatch(String path, EventType type, ZooKeeper client) {
        List&lt;Watcher&gt; watchers = watchTable.get(path);
        
        if (watchers != null) {
            WatchedEvent event = new WatchedEvent(type, KeeperState.SyncConnected, path);
            
            for (Watcher watcher : watchers) {
                // 异步触发，不阻塞主流程
                watcher.process(event);
            }
        }
    }
}
```

## 面试追问方向

### Q1：ZAB 和 Raft 的核心区别是什么？

1. **选主依据不同**：ZAB 用 ZXID（越大越好），Raft 用 Term + 随机超时
2. **数据同步策略不同**：ZAB 新 Leader 补发未提交的事务，Raft 通过日志比较同步
3. **适用场景不同**：ZAB 专为 ZooKeeper 设计，Raft 是通用算法

### Q2：ZooKeeper 如何保证「写请求的全局顺序」？

1. 所有写请求必须经过 Leader
2. Leader 为每个写请求分配唯一的 ZXID
3. ZXID 由 epoch + counter 组成，严格递增
4. 按 ZXID 顺序广播，所有节点看到相同的顺序

### Q3：ZooKeeper 的读请求是否需要经过 Leader？

不一定。ZooKeeper 支持客户端从 Follower 读取数据，但读到的可能是旧数据。

如果需要强一致性读，可以使用 `sync()` 命令强制从 Leader 读取。

## 总结

ZAB 是专为 ZooKeeper 设计的共识协议：

1. **ZXID**：通过 epoch + counter 保证事务的全局顺序
2. **广播模式**：类似两阶段提交，但只需多数派确认
3. **恢复模式**：新 Leader 通过 ZXID 同步数据
4. **Watch 机制**：与 ZAB 的顺序保证紧密结合

> "ZAB 教会我们的是：为特定场景设计的协议，往往比通用协议更高效。ZooKeeper 的成功，离不开 ZAB 协议的精心设计。"
