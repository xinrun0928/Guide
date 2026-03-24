# 分布式选举算法：Bully、Raft、ZAB

一个团队需要一个 Leader。

没有 Leader，10 个人的会议可能吵成一锅粥。

有了 Leader，决策效率大幅提升。

分布式系统也一样——没有 Leader，多个节点对同一个值达成共识需要大量通信；有 Leader，所有请求都经过 Leader，决策简单高效。

**但问题是：谁来当 Leader？Leader 挂了怎么办？**

这就是分布式选举算法要解决的问题。

## 为什么分布式系统需要 Leader

### 没有 Leader 的困境

想象一个没有 Leader 的团队群聊：

```
A：我觉得应该选方案一
B：我觉得应该选方案二
C：我同意 A
D：我同意 B
E：我弃权
...
```

吵来吵去，30 分钟过去了，什么都没定。

**分布式系统也是一样**：如果所有节点都参与决策，每个写操作都需要多数派节点同意，延迟高、吞吐量低。

### 有 Leader 的优势

```
有 Leader：
1. 所有写请求发给 Leader
2. Leader 决策后，同步给 Follower
3. 读请求可以直接从 Follower 读（可能读到旧数据）
```

```
无 Leader：
1. 所有节点都参与投票
2. 每个写操作都需要多轮通信
3. Paxos 算法就是这样
```

**代价**：Leader 成为单点，如果 Leader 挂了，需要重新选举。

## Bully 算法：「最大者胜出」

Bully 算法是最简单的选举算法，核心思想是：**节点 ID 最大的获胜。**

### 工作流程

```
场景：5 个节点（ID 1,2,3,4,5），当前 Leader 是 5，但 5 挂了

选举过程：
1. 节点 4 检测到 Leader 5 挂了
2. 节点 4 向 ID 更大的节点（5）发送选举消息
3. 没有收到回复（5 已经挂了）
4. 节点 4 宣布自己是 Leader，向所有 ID 更小的节点发送消息
5. 其他节点收到消息，更新自己的 Leader 为 4
```

```java
/**
 * Bully 算法实现
 */
public class BullyElection {
    
    private final int nodeId;
    private final List&lt;Integer&gt; allNodeIds;
    private volatile int currentLeaderId;
    
    public BullyElection(int nodeId, List&lt;Integer&gt; allNodeIds) {
        this.nodeId = nodeId;
        this.allNodeIds = allNodeIds;
        this.currentLeaderId = Collections.max(allNodeIds);
    }
    
    /**
     * 检测 Leader 是否存活
     */
    public void startHeartbeat() {
        new Thread(() -&gt; {
            while (true) {
                if (!isLeaderAlive()) {
                    startElection();
                }
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }).start();
    }
    
    /**
     * 开始选举
     */
    public void startElection() {
        System.out.println("节点 " + nodeId + " 开始选举");
        
        // 1. 向所有 ID 更大的节点发送选举消息
        List&lt;Integer&gt; higherIds = allNodeIds.stream()
            .filter(id -&gt; id &gt; nodeId)
            .sorted()
            .collect(Collectors.toList());
        
        boolean receivedResponse = false;
        for (Integer higherId : higherIds) {
            // 2. 如果有更高 ID 的节点回复，说明还有更大的节点在
            if (sendElectionMessage(higherId)) {
                receivedResponse = true;
                break;
            }
        }
        
        // 3. 如果没有更高 ID 的节点响应，我就是新的 Leader
        if (!receivedResponse) {
            becomeLeader();
        }
    }
    
    /**
     * 成为 Leader
     */
    private void becomeLeader() {
        currentLeaderId = nodeId;
        System.out.println("节点 " + nodeId + " 成为新的 Leader");
        
        // 向所有节点广播新 Leader
        for (Integer lowerId : allNodeIds) {
            if (lowerId &lt; nodeId) {
                sendCoordinatorMessage(lowerId);
            }
        }
    }
    
    /**
     * 处理选举消息
     */
    public void onElectionMessage(int fromNodeId) {
        // Bully 算法规则：更高 ID 的节点会响应
        // 如果我收到了消息，说明有更高 ID 的节点存在，我退出选举
        sendElectionResponse(fromNodeId);
    }
    
    private boolean isLeaderAlive() {
        // 心跳检测
        return sendHeartbeat(currentLeaderId);
    }
    
    private boolean sendElectionMessage(int targetId) {
        // 模拟发送消息
        return false; // 如果目标节点不响应
    }
    
    private void sendCoordinatorMessage(int targetId) {
        // 广播新 Leader
    }
    
    private boolean sendHeartbeat(int targetId) {
        // 发送心跳
        return false;
    }
    
    private void sendElectionResponse(int targetId) {
        // 发送响应
    }
}
```

### Bully 算法的优缺点

**优点**：

- 实现简单，容易理解
- 选举速度快

**缺点**：

- 通信量大：每次选举需要向所有节点发送消息
- 不适合大规模系统
- 频繁选举：Leader 挂了，ID 次大的节点马上成为新 Leader，频繁切换

**适用场景**：小规模、稳定的系统。

## Raft 选举：「Term + 随机超时」

Raft 是目前最流行的选举算法，它通过两个关键设计解决了选举效率问题：

1. **Term（任期）机制**：将时间分成连续的任期，每个任期最多一个 Leader
2. **随机超时**：避免选票瓜分

### Term 机制

```java
/**
 * Raft 中的 Term（任期）
 */
public class RaftTerm {
    
    /**
     * Term 是一个递增的整数
     * 每次选举开始时，Term + 1
     */
    private volatile long currentTerm = 0;
    
    /**
     * 投票给谁
     */
    private volatile int votedFor = -1;
    
    /**
     * 角色：Follower、Candidate、Leader
     */
    private volatile NodeRole role = NodeRole.FOLLOWER;
    
    public void startNewTerm() {
        currentTerm++;
        votedFor = -1;
        role = NodeRole.CANDIDATE;
        System.out.println("节点进入新的 Term: " + currentTerm);
    }
    
    /**
     * Term 比较：用于判断消息是否过期
     */
    public boolean isStaleMessage(long messageTerm) {
        return messageTerm &lt; currentTerm;
    }
    
    public boolean hasNewerTerm(long messageTerm) {
        if (messageTerm &gt; currentTerm) {
            currentTerm = messageTerm;
            // 转换为 Follower
            role = NodeRole.FOLLOWER;
            votedFor = -1;
            return true;
        }
        return false;
    }
}
```

### 随机超时：避免选票瓜分

这是 Raft 最聪明的设计之一。

```
问题：如果所有节点的选举超时时间相同，会发生什么？

场景：5 个节点，固定超时 150ms
T=0ms：所有节点检测到 Leader 挂了
T=0ms：所有节点同时发起选举
T=150ms：所有节点同时超时
结果：没人能拿到多数派选票，选举失败
T=150ms：所有节点重新发起选举
...无限循环
```

**解决方案：随机超时**

```java
/**
 * Raft 选举超时：随机化设计
 */
public class RaftElectionTimeout {
    
    /**
     * 选举超时时间：150-300ms 之间的随机值
     * 
     * 为什么用区间而不是固定值？
     * - 避免所有节点同时发起选举
     * - 统计学上，总有一个节点会先超时
     */
    private static final int ELECTION_TIMEOUT_MIN = 150;
    private static final int ELECTION_TIMEOUT_MAX = 300;
    
    private final Random random = new Random();
    
    public int generateElectionTimeout() {
        return ELECTION_TIMEOUT_MIN + 
               random.nextInt(ELECTION_TIMEOUT_MAX - ELECTION_TIMEOUT_MIN);
    }
    
    /**
     * Leader 选举流程
     */
    public void runElection() {
        // 1. 增加 currentTerm
        raftTerm.startNewTerm();
        
        // 2. 给自己投票
        raftTerm.voteFor(nodeId);
        int votesReceived = 1;
        
        // 3. 向所有其他节点发送 RequestVote
        for (String peer : peers) {
            RequestVoteRequest request = new RequestVoteRequest(
                raftTerm.getCurrentTerm(),
                nodeId,
                getLastLogIndex(),
                getLastLogTerm()
            );
            
            RequestVoteResponse response = sendRequestVote(peer, request);
            
            if (response.voteGranted) {
                votesReceived++;
            }
        }
        
        // 4. 如果获得多数派选票，成为 Leader
        if (votesReceived &gt; peers.size() / 2) {
            becomeLeader();
        }
    }
    
    /**
     * 成为 Leader
     */
    private void becomeLeader() {
        raftTerm.setRole(NodeRole.LEADER);
        System.out.println("节点 " + nodeId + " 成为 Term " + 
                          raftTerm.getCurrentTerm() + " 的 Leader");
        
        // 发送心跳，防止其他节点发起新的选举
        startHeartbeats();
    }
}
```

### 选举动画（文字版）

```
初始状态：5 节点集群，节点 3 是 Leader

[节点1] [节点2] [节点3-Leader] [节点4] [节点5]
  ↓        ↓         ↓           ↓        ↓
 心跳正常，选举不发生

场景：节点 3（Leader）挂了

T=0ms：
  节点 1、2、4、5 检测到心跳超时
  它们各自启动选举计时器（随机超时 150-300ms）

T=150ms（假设节点 1 最快超时）：
  节点 1 成为 Candidate，开始选举
  节点 1 向所有节点发送 RequestVote

T=151ms（节点 1）：
  节点 2 收到 RequestVote，投票给节点 1

T=152ms（节点 1）：
  节点 4 收到 RequestVote，投票给节点 1

T=180ms（节点 1）：
  节点 1 获得 3 票（自己 + 2 + 4），成为新 Leader
  节点 1 向所有节点发送心跳

T=181ms（节点 1）：
  节点 2、4 收到心跳，承认节点 1 为新 Leader
  节点 5 收到心跳时（假设它的超时是 200ms），发现自己已经错过了选举
```

## ZAB 选举：ZXID 优先策略

ZAB（ZooKeeper Atomic Broadcast）是 ZooKeeper 使用的选举协议。

### ZAB 的独特设计：ZXID

```java
/**
 * ZAB 的事务 ID：ZXID
 * 
 * ZXID 由两部分组成：
 * - epoch：选举轮次
 * - counter：事务计数器
 * 
 * 设计目的：保证事务的全局顺序
 */
public class ZXID implements Comparable&lt;ZXID&gt; {
    
    private final long epoch;      // 选举轮次
    private final long counter;    // 事务计数器
    
    public ZXID(long epoch, long counter) {
        this.epoch = epoch;
        this.counter = counter;
    }
    
    /**
     * ZXID 比较规则：
     * 1. 先比较 epoch，epoch 大的更新
     * 2. epoch 相同，比较 counter，counter 大的更新
     * 
     * 这确保了：
     * - 更高 epoch 的事务一定更新
     * - 同一 epoch 内，事务按 counter 顺序执行
     */
    @Override
    public int compareTo(ZXID other) {
        if (this.epoch != other.epoch) {
            return Long.compare(this.epoch, other.epoch);
        }
        return Long.compare(this.counter, other.counter);
    }
    
    public static ZXID fromLong(long value) {
        long epoch = value &gt;&gt;&gt; 32;
        long counter = value &amp; 0xFFFFFFFFL;
        return new ZXID(epoch, counter);
    }
    
    public long toLong() {
        return (epoch &lt;&lt; 32) | counter;
    }
}
```

### ZAB 选举流程

```
选举原则：
1. 先比较 epoch，epoch 大的优先
2. epoch 相同，比较 ZXID，ZXID 大的优先
3. epoch 和 ZXID 都相同，比较 serverId，serverId 大的优先

为什么这样设计？

因为 ZooKeeper 要求：
- 新 Leader 必须包含所有已提交的事务
- ZXID 越大，说明包含的事务越多
- 所以 ZXID 最大的节点最适合成为新 Leader
```

```java
/**
 * ZAB 选举：简化版
 */
public class ZABElection {
    
    /**
     * 投票数据结构
     */
    static class Vote {
        long serverId;
        long epoch;           // ZXID 的 epoch 部分
        long zxid;            // 完整的 ZXID
        long peerEpoch;       // 选举轮次
        
        public Vote(long serverId, long epoch, long zxid) {
            this.serverId = serverId;
            this.epoch = epoch;
            this.zxid = zxid;
            this.peerEpoch = epoch;
        }
    }
    
    private volatile Vote currentVote;
    
    /**
     * 处理收到的投票
     */
    public void receiveVote(Vote incoming) {
        // 规则：优先选择 epoch 大、zxid 大、serverId 大的
        if (isVoteNewer(incoming, currentVote)) {
            currentVote = incoming;
            // 向其他节点广播新的投票
            broadcastVote(incoming);
        }
    }
    
    /**
     * 判断投票是否更新
     */
    private boolean isVoteNewer(Vote newVote, Vote currentVote) {
        // 1. 先比较 epoch
        if (newVote.epoch &gt; currentVote.epoch) {
            return true;
        }
        if (newVote.epoch &lt; currentVote.epoch) {
            return false;
        }
        
        // 2. epoch 相同，比较 ZXID
        if (newVote.zxid &gt; currentVote.zxid) {
            return true;
        }
        if (newVote.zxid &lt; currentVote.zxid) {
            return false;
        }
        
        // 3. 都相同，比较 serverId
        return newVote.serverId &gt; currentVote.serverId;
    }
}
```

## 三种算法对比

| 特性 | Bully | Raft | ZAB |
|-----|-------|------|-----|
| 选举依据 | 节点 ID 最大 | Term + 随机超时 | ZXID 最大 |
| 通信复杂度 | O(N) | O(N) | O(N) |
| 选举速度 | 快 | 较快 | 较快 |
| 单点故障 | 无 | 无 | 无 |
| 活锁风险 | 低 | 低（随机化解决） | 低 |
| 适用规模 | 小 | 中-大 | 中 |
| 代表系统 | 少数 | etcd、Consul、CockroachDB | ZooKeeper |

## 面试追问方向

**追问 1：Raft 为什么设计随机超时？**

如果使用固定超时，所有节点会在同一时间发起选举，导致选票瓜分。随机化打破了这种对称性，统计学上总有一个节点会先超时，从而大概率成为唯一的 Leader。

**追问 2：Raft 和 ZAB 的核心区别是什么？**

1. **Leader 确认方式不同**：Raft 通过多数派投票确认，ZAB 通过 ZXID 比较确认
2. **日志恢复策略不同**：Raft 通过比较日志长度和 Term，ZAB 通过比较 ZXID
3. **适用场景不同**：Raft 适合通用场景，ZAB 专为 ZooKeeper 设计

**追问 3：选举出来的 Leader 一定包含所有已提交的数据吗？**

Raft 保证是的。选举时，Candidate 需要包含所有已提交的日志（通过比较 lastLogTerm 和 lastLogIndex）。ZAB 也是如此，新 Leader 的 ZXID 一定最大，包含最多已提交事务。

## 总结

分布式选举算法的核心问题：**如何在没有全局时钟的情况下，选出一个大家都认可的 Leader。**

1. **Bully 算法**：简单粗暴，ID 最大者胜
2. **Raft 算法**：Term + 随机超时，适合通用场景
3. **ZAB 算法**：ZXID 优先，专为 ZooKeeper 设计

> "选举算法的设计哲学是：在不确定的环境中，通过某种机制达成确定性共识。随机性不是混乱，而是打破对称性的工具。"
