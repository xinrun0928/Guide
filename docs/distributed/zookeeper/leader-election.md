# ZooKeeper Leader 选举：FastLeaderElection 算法

你有没有想过这个问题：

ZooKeeper 集群 5 台机器，突然 Leader 挂了。30 秒后，系统恢复正常。

这 30 秒里发生了什么？新 Leader 是怎么选出来的？

很多人只知道「过半选举」，但面试官追问下去：过半是超过一半，还是不少于一半？数据最新的节点一定被选中吗？Epoch 是什么，为什么重要？

今天，我们来揭开 ZooKeeper Leader 选举的神秘面纱。

## Leader 的作用

在说选举之前，先搞清楚 Leader 有什么用。

ZooKeeper 是一个**主从架构**的分布式系统：

- **Leader**：处理所有写请求，将事务同步给 Follower
- **Follower**：处理读请求，参与选主，参与事务同步
- **Observer**：只处理读请求，不参与选主（扩展读能力）

**写请求必须经过 Leader**，这是 ZooKeeper 保证顺序性的关键。

```java
// ZooKeeper 写请求流程
// 1. Client 发送写请求给任意节点
// 2. 该节点如果是 Follower，转发给 Leader
// 3. Leader 生成事务 Proposal，发给所有 Follower
// 4. 过半 Follower 回复 ACK
// 5. Leader 提交事务，通知所有 Follower 提交
```

## 什么时候触发选举？

两种情况会触发 Leader 选举：

1. **集群启动时**：所有节点都认为自己应该当 Leader，发起投票
2. **Leader 崩溃时**：Follower 检测到 Leader 不可用，发起投票

```java
// 节点状态
public enum ServerState {
    LOOKING,    // 正在寻找 Leader
    LEADING,    // 我是 Leader
    FOLLOWING,  // 我是 Follower
    OBSERVING   // 我是 Observer
}
```

## 选举的四个核心要素

选举不是简单比大小，而是四个维度综合比较：

### 1. Epoch（逻辑时钟）

也叫 **zxid 的高 32 位**，代表「任期」。

每次新 Leader 当选，Epoch +1。即使 Rawnode 重新加入，Epoch 也会继续增长。

```java
// Epoch 的含义
Epoch 1: 第一个 Leader 时代
Epoch 2: 第二个 Leader 时代
Epoch 3: 第三个 Leader 时代
```

为什么需要 Epoch？因为**不同任期的提案不能比较**。

### 2. zxid（事务 ID）

也叫 **Proposal ID**，是 ZooKeeper 事务的唯一标识。

```java
// zxid 结构
zxid = (Epoch << 32) | counter
// 高 32 位：Epoch
// 低 32 位：事务计数
```

zxid 越大，说明处理的事务越多，数据越新。

### 3. ServerID（服务器 ID）

也叫 **myid**，是节点启动时配置的静态 ID。

```properties
# zoo.cfg
server.1=192.168.1.1:2888:3888
server.2=192.168.1.2:2888:3888
server.3=192.168.1.3:2888:3888
```

**ServerID 只在 Epoch 和 zxid 都相同时作为最终裁决**，它不参与正常选举。

### 4. ServerState（服务器状态）

节点当前的状态，前面提到过：LOOKING / LEADING / FOLLOWING / OBSERVING。

## FastLeaderElection 算法：三步达成共识

FastLeaderElection 是 ZooKeeper 默认的选举算法。它的核心思想是：**用最短的轮次，让过半节点达成一致**。

### 第一步：自增 Epoch，发起投票

每个 LOOKING 状态的节点都会发起选举，投票给自己。

```java
// 每个节点投票给自己
Vote myVote = new Vote(
    serverId,     // 自己的 ServerID
    zxid,         // 自己的最新事务 ID
    logicalclock, // 自增的 Epoch
    ServerState.LOOKING
);
```

### 第二步：广播投票，交换信息

节点将自己的投票广播给所有其他节点。

```java
// 收到其他节点的投票
public void receiveVote(Vote vote) {
    if (vote.getState() == ServerState.LOOKING) {
        // 对方也在 LOOKING，比较优先级
        if (vote.getEpoch() > myVote.getEpoch()) {
            // Epoch 更大，信任对方的投票
            myVote.setEpoch(vote.getEpoch());
            myVote.setId(vote.getId());
            myVote.setZxid(vote.getZxid());
        } else if (vote.getEpoch() == myVote.getEpoch()) {
            // Epoch 相同，比较 zxid
            if (vote.getZxid() > myVote.getZxid()) {
                myVote.setZxid(vote.getZxid());
                myVote.setId(vote.getId());
            } else if (vote.getZxid() == myVote.getZxid()) {
                // zxid 也相同，比较 ServerID
                if (vote.getId() > myVote.getId()) {
                    myVote.setId(vote.getId());
                }
            }
        }
    }
}
```

### 第三步：过半认同，当选 Leader

当一个节点收到过半票数（包括自己），它就当选 Leader。

```java
// 票数统计
if (votesReceived.size() > (totalServerNum / 2)) {
    // 达成过半，选举成功
    if (myVote.getId() == myServerId) {
        // 我是 Leader
        setServerState(ServerState.LEADING);
    } else {
        // 我是 Follower
        setServerState(ServerState.FOLLOWING);
    }
}
```

## 为什么能选出「数据最新」的节点？

关键在于比较顺序：**Epoch → zxid → ServerID**。

```java
// 比较逻辑
if (Epoch 更大) → 信任对方，Epoch 更大意味着经历过更多 Leader
else if (zxid 更大) → zxid 更大意味着处理了更多事务
else if (ServerID 更大) → 作为最终裁决
```

这确保了：**新 Leader 一定是数据最新的节点**。

但问题是：zxid 大的节点一定能当选吗？

**不一定**。如果 zxid 大的节点只有 1 台，而其他 4 台都投给 zxid 小但 Epoch 大的节点，那么 zxid 小的节点当选（因为过半）。

这是 Paxos 算法的特性：**少数服从多数**。

## Curator LeaderLatch 使用

实际开发中，我们用 Curator 的 LeaderLatch 做 Leader 选举。

```java
LeaderLatch latch = new LeaderLatch(client, "/leader-election", "participant-1");

latch.addListener(new LeaderLatchListener() {
    @Override
    public void isLeader() {
        System.out.println("我当选为 Leader 了！");
        // 开始执行 Leader 职责
    }

    @Override
    public void notLeader() {
        System.out.println("我不是 Leader 了");
        // 降级为 Follower
    }
});

latch.start();

// 等待成为 Leader
latch.await();
```

## 总结

ZooKeeper 的 Leader 选举，是一个** Paxos 变种**的实现：

- **四要素**：Epoch、zxid、ServerID、ServerState
- **比较规则**：Epoch 优先 → zxid 其次 → ServerID 最后
- **过半原则**：N/2 + 1 票才能当选
- **数据一致性**：新 Leader 一定是数据最新的节点

理解选举机制，才能理解 ZooKeeper 如何保证分布式一致性。

**面试追问方向：**
- ZooKeeper 的过半原则是什么？为什么是 N/2+1 而不是 N/3+1？
- Epoch 一样但 zxid 不同时会发生什么？
- Leader 崩溃后，Follower 的数据如何恢复同步？
- Observer 不参与选举，有什么用？