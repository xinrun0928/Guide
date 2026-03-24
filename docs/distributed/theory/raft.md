# Raft 算法：Leader 选举、日志复制、安全性

2013 年，Diego Ongaro 和 John Ousterhout 在斯坦福大学做研究。

他们发现：学生们在考试时，Paxos 是最难的题目。

但更让他们困惑的是：为什么一个如此重要的算法，却如此难以理解？

于是他们决定：设计一个更容易理解的共识算法，名字叫 Raft。

**「In Search of an Understandable Consensus Algorithm」**

这就是 Raft 论文的标题。他们的目标达成了——Raft 确实比 Paxos 容易理解得多。

## Raft 的设计目标

Raft 的设计者总结了 Paxos 难理解的原因：

1. **多个角色耦合**：Paxos 的 Proposer、Acceptor、Learner 没有明确区分
2. **条件分支多**：各种边界情况混在一起
3. **数学推导晦涩**：证明正确性但不直观

Raft 的解决方案：

```
分解为三个独立子问题：
1. Leader 选举（Leader Election）
2. 日志复制（Log Replication）
3. 安全性（Safety）
```

## Leader 选举

### 三种角色

```
Raft 节点有三种角色：

1. Follower（跟随者）：
   - 被动响应请求
   - 如果超时没收到心跳，成为 Candidate

2. Candidate（候选人）：
   - 发起选举
   - 获得多数票成为 Leader

3. Leader（领导者）：
   - 处理所有客户端请求
   - 定期发送心跳给 Follower
```

### 选举流程

```java
/**
 * Raft Leader 选举
 */
public class RaftNode {
    
    // 持久化状态（需要在磁盘保存）
    private long currentTerm = 0;      // 当前任期
    private int votedFor = -1;          // 投票给了谁
    private List&lt;LogEntry&gt; log = new ArrayList&lt;&gt;();  // 日志条目
    
    // 易失性状态
    private NodeState state = NodeState.FOLLOWER;
    private int commitIndex = -1;
    private int lastApplied = -1;
    
    // 选举相关
    private int electionTimeout;         // 选举超时时间（随机）
    private long lastHeartbeatTime = 0;
    
    /**
     * 选举超时检测
     * 
     * 如果 Follower 在 electionTimeout 时间内没有收到心跳
     * 就转变为 Candidate，发起选举
     */
    public void checkElectionTimeout() {
        if (state != NodeState.FOLLOWER) {
            return;
        }
        
        long now = System.currentTimeMillis();
        if (now - lastHeartbeatTime &gt; electionTimeout) {
            startElection();
        }
    }
    
    /**
     * 开始选举
     */
    public void startElection() {
        state = NodeState.CANDIDATE;
        currentTerm++;
        votedFor = nodeId;  // 给自己投票
        
        int votesReceived = 1;  // 自己的票
        
        // 向所有节点发送 RequestVote
        for (RaftNode peer : peers) {
            RequestVoteRequest request = new RequestVoteRequest();
            request.setTerm(currentTerm);
            request.setCandidateId(nodeId);
            request.setLastLogIndex(log.size() - 1);
            request.setLastLogTerm(log.isEmpty() ? 0 : log.get(log.size() - 1).getTerm());
            
            RequestVoteResponse response = peer.requestVote(request);
            
            if (response.getTerm() &gt; currentTerm) {
                // 发现更大的 Term，回归 Follower
                becomeFollower(response.getTerm());
                return;
            }
            
            if (response.isVoteGranted()) {
                votesReceived++;
            }
        }
        
        // 赢得选举
        if (votesReceived &gt; peers.size() / 2) {
            becomeLeader();
        }
        // 选举失败，继续作为 Candidate，等待下一个选举超时
    }
    
    /**
     * 成为 Leader
     */
    private void becomeLeader() {
        state = NodeState.LEADER;
        System.out.println("节点 " + nodeId + " 成为 Term " + currentTerm + " 的 Leader");
        
        // 立即发送心跳，防止其他节点发起新的选举
        sendHeartbeats();
        
        // 启动心跳定时器
        startHeartbeatTimer();
    }
    
    /**
     * 处理 RequestVote 请求
     */
    public RequestVoteResponse requestVote(RequestVoteRequest request) {
        // 1. 如果请求的 Term 小于当前 Term，拒绝
        if (request.getTerm() &lt; currentTerm) {
            return new RequestVoteResponse(currentTerm, false);
        }
        
        // 2. 如果请求的 Term 大于当前 Term，更新 Term，回归 Follower
        if (request.getTerm() &gt; currentTerm) {
            becomeFollower(request.getTerm());
        }
        
        // 3. 如果当前节点已经投过票，且不是投给请求者，拒绝
        if (votedFor != -1 &amp;&amp; votedFor != request.getCandidateId()) {
            return new RequestVoteResponse(currentTerm, false);
        }
        
        // 4. 检查候选人的日志是否比自己的日志新
        if (!isLogUpToDate(request)) {
            return new RequestVoteResponse(currentTerm, false);
        }
        
        // 5. 投票给候选人
        votedFor = request.getCandidateId();
        lastHeartbeatTime = System.currentTimeMillis();
        
        return new RequestVoteResponse(currentTerm, true);
    }
    
    /**
     * 判断候选人的日志是否比自己的日志新
     * 
     * 规则：
     * 1. 比较最后一条日志的 Term，Term 大的更新
     * 2. Term 相同，index 大的更新
     */
    private boolean isLogUpToDate(RequestVoteRequest request) {
        int lastIndex = log.size() - 1;
        long lastTerm = lastIndex &gt;= 0 ? log.get(lastIndex).getTerm() : 0;
        
        long requestLastTerm = request.getLastLogTerm();
        int requestLastIndex = request.getLastLogIndex();
        
        if (requestLastTerm != lastTerm) {
            return requestLastTerm &gt; lastTerm;
        }
        return requestLastIndex &gt;= lastIndex;
    }
    
    /**
     * 选举超时：随机化设计
     * 
     * 这是 Raft 最重要的设计之一
     * 用于避免所有节点同时发起选举
     */
    public int generateElectionTimeout() {
        Random random = new Random();
        return 150 + random.nextInt(150);  // 150-300ms
    }
}
```

### 随机超时：避免选票瓜分

这是 Raft 最聪明的设计之一：

```
问题：如果所有节点的选举超时相同

T=0ms：Leader 挂了
T=0ms：所有 Follower 同时检测到超时
T=0ms：所有节点同时成为 Candidate
T=150ms：所有节点同时超时
结果：没人能拿到多数派，选举失败
T=150ms：重新选举...
无限循环！

解决：随机超时

T=0ms：Leader 挂了
T=150ms：节点 A 超时，发起选举
T=160ms：节点 B 超时，发起选举
T=180ms：节点 A 获得多数派，成为 Leader
T=190ms：节点 B 收到心跳，回归 Follower
```

## 日志复制

### 日志结构

```
Raft 日志由有序的 LogEntry 组成：

Index  Term    Command
1      1       set x = 5
2      1       set y = 3
3      2       set x = 10
4      2       set y = 7
5      3       set z = 20

每个 LogEntry 包含：
- index：日志索引
- term：创建这条日志时的 Term
- command：客户端请求
```

### 复制流程

```java
/**
 * Raft 日志复制
 */
public class RaftLogReplication {
    
    // Leader 的状态
    private Map&lt;Integer, Integer&gt; nextIndex;      // 下一个要发送的日志索引
    private Map&lt;Integer, Integer&gt; matchIndex;      // 已匹配的日志索引
    
    /**
     * Leader 处理客户端请求
     */
    public void handleClientRequest(Command command) {
        if (state != NodeState.LEADER) {
            // 重定向到 Leader
            throw new RedirectException(currentLeaderId);
        }
        
        // 1. 追加到本地日志
        LogEntry entry = new LogEntry();
        entry.setIndex(log.size());
        entry.setTerm(currentTerm);
        entry.setCommand(command);
        log.add(entry);
        
        // 2. 并行发送 AppendEntries 给所有 Follower
        for (RaftNode peer : peers) {
            sendAppendEntries(peer);
        }
        
        // 3. 如果收到多数派成功，提交日志
        if (countMatchingReplicas() &gt; peers.size() / 2) {
            commitIndex = entry.getIndex();
            applyToStateMachine(entry);
            
            // 4. 通知 Follower 提交
            broadcastCommit(entry.getIndex());
        }
    }
    
    /**
     * 发送 AppendEntries RPC
     * 
     * 用于：
     * 1. 心跳（entries 为空）
     * 2. 日志复制（entries 不为空）
     */
    public void sendAppendEntries(RaftNode peer) {
        int prevLogIndex = nextIndex.get(peer.getId()) - 1;
        long prevLogTerm = prevLogIndex &gt;= 0 ? log.get(prevLogIndex).getTerm() : 0;
        
        AppendEntriesRequest request = new AppendEntriesRequest();
        request.setTerm(currentTerm);
        request.setLeaderId(nodeId);
        request.setPrevLogIndex(prevLogIndex);
        request.setPrevLogTerm(prevLogTerm);
        request.setEntries(log.subList(nextIndex.get(peer.getId()), log.size()));
        request.setLeaderCommit(commitIndex);
        
        AppendEntriesResponse response = peer.appendEntries(request);
        
        if (response.isSuccess()) {
            // 更新 matchIndex 和 nextIndex
            matchIndex.put(peer.getId(), prevLogIndex + request.getEntries().size());
            nextIndex.put(peer.getId(), matchIndex.get(peer.getId()) + 1);
        } else {
            // 如果失败（日志不一致），回退 nextIndex
            if (response.getTerm() &gt; currentTerm) {
                becomeFollower(response.getTerm());
            } else {
                nextIndex.put(peer.getId(), nextIndex.get(peer.getId()) - 1);
                // 重试
                sendAppendEntries(peer);
            }
        }
    }
    
    /**
     * Follower 处理 AppendEntries
     */
    public AppendEntriesResponse appendEntries(AppendEntriesRequest request) {
        // 1. Term 检查
        if (request.getTerm() &lt; currentTerm) {
            return new AppendEntriesResponse(currentTerm, false);
        }
        
        // 更新为 Follower
        if (request.getTerm() &gt; currentTerm) {
            becomeFollower(request.getTerm());
        }
        
        // 2. 日志一致性检查
        if (request.getPrevLogIndex() &gt;= 0) {
            if (request.getPrevLogIndex() &gt;= log.size()) {
                return new AppendEntriesResponse(currentTerm, false);
            }
            if (log.get(request.getPrevLogIndex()).getTerm() != request.getPrevLogTerm()) {
                // 日志冲突，删除冲突条目
                log = log.subList(0, request.getPrevLogIndex());
                return new AppendEntriesResponse(currentTerm, false);
            }
        }
        
        // 3. 追加新条目
        int i = 0;
        for (LogEntry entry : request.getEntries()) {
            int index = request.getPrevLogIndex() + 1 + i;
            if (index &lt; log.size()) {
                // 覆盖已存在的日志（保持一致性）
                if (log.get(index).getTerm() != entry.getTerm()) {
                    log = log.subList(0, index);
                    log.add(entry);
                }
            } else {
                log.add(entry);
            }
            i++;
        }
        
        // 4. 更新 commitIndex
        if (request.getLeaderCommit() &gt; commitIndex) {
            commitIndex = Math.min(request.getLeaderCommit(), log.size() - 1);
        }
        
        return new AppendEntriesResponse(currentTerm, true);
    }
}
```

### 日志一致性保证

```
Raft 的日志复制保证了以下属性：

1. 如果两条日志的 index 和 term 相同，则内容相同
2. 如果两条日志的 index 和 term 相同，则之前的所有日志也相同

这是通过 AppendEntries 的一致性检查实现的：

Leader 发送 AppendEntries(prevLogIndex, prevLogTerm)
Follower 检查：
  - 如果 prevLogIndex 位置的 term != prevLogTerm
  - 拒绝
  - Leader 回退 nextIndex 重试

最终：Follower 的日志会被 Leader 强制同步
```

## 安全性

### 选举限制

Raft 的安全性通过选举限制保证：**只有包含所有已提交日志的节点才能成为 Leader。**

```java
/**
 * 选举安全性保证
 * 
 * Leader 必须包含所有已提交的日志
 * 这是通过 RequestVote 时的日志检查实现的
 */
public class ElectionSafety {
    
    /**
     * isLogUpToDate 检查
     * 
     * 只有当 Candidate 的日志比 Follower 的日志「新」时
     * Follower 才会投票给 Candidate
     * 
     * 「新」的定义：
     * 1. 最后一条日志的 Term 更大
     * 2. Term 相同，索引更大
     */
    public boolean isLogUpToDate(LogEntry candidateLastEntry, LogEntry followerLastEntry) {
        if (candidateLastEntry.getTerm() != followerLastEntry.getTerm()) {
            return candidateLastEntry.getTerm() &gt; followerLastEntry.getTerm();
        }
        return candidateLastEntry.getIndex() &gt;= followerLastEntry.getIndex();
    }
}
```

### 为什么这样设计是安全的？

```
场景：

假设有 5 个节点：S1, S2, S3, S4, S5

1. S1 是 Leader，Term=2，正在复制日志 index=3 到 S3
2. S1 收到客户端提交 index=3 的请求
3. S1 宕机，S2 成为 Leader（Term=3）

问题：index=3 的日志是否被提交？

答案：没有。因为 S1 只复制到 S3（2/5 节点），没有达到多数派。

S2 成为 Leader 后，S2 可以接受新的日志，index=3 的日志会被覆盖。

这就是 Raft 的「领导人完整」属性：
新 Leader 的 commitIndex 只能包含前任 Leader 已经提交的日志
```

## 成员变更

Raft 使用 Joint Consensus 方法处理成员变更：

```
问题：如何在不停机的情况下添加或移除节点？

方案：Joint Consensus
1. 配置分为两个阶段：Cold + Cnew
2. 任何操作需要两个配置都多数派同意
3. 第二阶段完成后，应用新配置

流程：
1. Leader 收到成员变更请求
2. 生成 Cold∪Cnew 配置日志，广播给所有节点
3. 新配置日志提交后，生成 Cnew 配置日志
4. Cnew 配置日志提交后，变更完成
```

## Raft vs Paxos

| 维度 | Raft | Paxos |
|-----|------|-------|
| 可理解性 | 高 | 低 |
| Leader | 必须有 | 可选 |
| 日志复制 | 基于索引 | 基于提案号 |
| 成员变更 | Joint Consensus | 需要额外设计 |
| 实现难度 | 中等 | 极高 |

## 可视化工具

推荐一个在线 Raft 可视化工具：**The Secret Lives of Data**

网址：`https://thesecretlivesofdata.com/raft/`

这个网站用动画展示了 Raft 的 Leader 选举和日志复制过程，非常直观。

## 总结

Raft 算法通过分解问题，实现了比 Paxos 更好的可理解性：

1. **Leader 选举**：Term + 随机超时 + 多数派投票
2. **日志复制**：Leader 追加日志 + 并行复制 + 多数派提交
3. **安全性**：选举限制保证新 Leader 包含所有已提交日志

> "Raft 成功的关键不是它比 Paxos 更『正确』，而是它更容易让人理解。工程实践中，能被正确实现的算法才是好算法。"
