# etcd 架构：Raft 共识 + MVCC + BoltDB

你有没有想过这个问题：

Kubernetes 是怎么保证「声明式 API」的？当你执行 `kubectl apply -f deployment.yaml` 时，Deployment 的期望状态被写入 etcd。如果此时一个 etcd 节点宕机，Kubernetes 还能正常运行吗？

答案是：**能，但有代价**。

etcd 就是 Kubernetes 的「记忆」。理解 etcd 的架构，是理解 Kubernetes 可靠性的关键。

## etcd 的三层架构

etcd 采用了清晰的分层架构：

```
┌─────────────────────────────────────────────────────┐
│                   HTTP/gRPC API                     │
│                  (etcd Server Layer)                 │
├─────────────────────────────────────────────────────┤
│                    Raft Layer                        │
│            (一致性协议，日志复制)                     │
├─────────────────────────────────────────────────────┤
│              MVCC + BoltDB                          │
│           (多版本并发控制 + 存储)                    │
└─────────────────────────────────────────────────────┘
```

每一层都有明确的职责，层与层之间通过接口通信。

## Raft 共识层

### Raft 是什么？

Raft 是一种共识算法（Consensus Algorithm），目的是让一群节点对「数据」达成一致。

它的设计哲学是：**可理解性优先**。Diego Ongaro 在论文中直言不讳：「Raft 比 Paxos 好理解」。

### Raft 的核心概念

```java
// Raft 节点的三种角色
public enum NodeRole {
    Follower,   // 追随者，被动同步
    Candidate,  // 候选者，发起选举
    Leader      // 领导者，处理所有写请求
}

// Raft 的核心数据结构
public class RaftNode {
    long currentTerm;    // 当前任期
    String votedFor;     // 给谁投了票
    LogEntry[] log;       // 操作日志
    int commitIndex;     // 已提交的日志索引
    int lastApplied;     // 已应用的日志索引
}
```

### Leader 选举

```
1. 集群启动，所有节点都是 Follower
2. 节点收不到 Leader 心跳 → 变成 Candidate
3. Candidate 自增 Term，发起投票
4. 获得过半票数 → 成为 Leader
5. Leader 定期发送心跳维持统治
```

### 日志复制

```java
// Leader 处理写请求
public void handleClientRequest(Command cmd) {
    // 1. 将命令追加到本地日志
    int index = appendToLog(cmd);

    // 2. 并行发送 AppendEntries 给所有 Follower
    for (Follower follower : followers) {
        sendAppendEntries(follower, index);
    }

    // 3. 等待过半节点确认
    if (countAck >= majority) {
        // 4. 提交日志
        commit(index);
        // 5. 通知 Follower 应用
        notifyFollowersToApply(index);
    }
}
```

## MVCC（多版本并发控制）

### 为什么要 MVCC？

传统数据库的 UPDATE 是「覆盖」：

```
key = "name"
UPDATE users SET name = "Bob" WHERE id = 1
-- 原来的 "Alice" 被覆盖了
```

etcd 的 UPDATE 是「追加」：

```
key = "name"
rev = 3  // 第三次修改

revision 1: name = "Alice"
revision 2: name = "Bob"
revision 3: name = "Charlie"  // 旧版本保留！
```

**MVCC 的好处**：

1. **读写不阻塞**：读操作不需要加锁，可以读历史版本
2. **支持 Watch 历史**：客户端可以从任意版本开始监听
3. **事务支持**：读不加锁，写时检测冲突

### etcd 的 MVCC 实现

```java
// etcd 的 key 存储结构
public class KeyValue {
    byte[] key;          // 实际的 key
    byte[] value;        // 值
    int revision;        // 修改版本号（全局递增）
    long version;        // key 的版本号（key 内递增）
}

// 内部实际存储的 key 是编码后的
// encodeKey("name", 3) = "\x00name\x00\x00\x00\x00\x00\x00\x03"
// 包含前缀 + revision，实现按版本查询
```

### Watch 机制

etcd 的 Watch 非常强大：

```java
// 监听某个 key 的变化
client.watch("/config/database")
    .start();

client.addWatchResponseListener(response -> {
    for (WatchEvent event : response.getEvents()) {
        System.out.println("Key: " + event.getKey());
        System.out.println("Type: " + event.getEventType());
        System.out.println("Value: " + event.getValue());
    }
});
```

**与 ZooKeeper 的区别**：

| 特性 | ZooKeeper | etcd |
|------|-----------|------|
| Watch 触发次数 | 一次性 | 持续（直到取消） |
| 历史版本 | 不支持 | 支持（从指定 revision 开始） |
| 过滤条件 | 无 | 支持 key 前缀、事件类型过滤 |

## BoltDB：嵌入式 KV 数据库

### BoltDB 是什么？

BoltDB 是一个嵌入式、纯 Go 实现的 KV 数据库，基于 **B+ 树**。

```java
// BoltDB 的简单操作
db.update(tx -> {
    tx.put("config".getBytes(), "mysql://localhost".getBytes());
});

db.view(tx -> {
    byte[] value = tx.get("config".getBytes());
    System.out.println(new String(value));
});
```

**BoltDB 的特点**：

- **嵌入式**：和应用程序运行在同一个进程，不需要独立部署
- **B+ 树**：支持范围查询，顺序遍历
- **只读快照**：读操作不会阻塞写操作
- **持久化**：数据写入磁盘，机器重启不丢失

### etcd 如何使用 BoltDB

```
写入流程：

1. Raft 层达成共识
2. 数据写入 BoltDB（同时写入数据桶和 wal 桶）
3. 定期做快照，清理历史日志
```

## etcd 为什么适合 Kubernetes？

### 需求匹配

Kubernetes 需要什么？

```
1. 高可靠：状态不能丢 ✅（Raft 过半写入）
2. 强一致：多个组件看到的状态必须一样 ✅（Raft 线性一致性）
3. Watch 通知：状态变更需要及时感知 ✅（MVCC + Watch）
4. 高性能：API Server 每秒处理数千请求 ✅（BoltDB + 内存缓存）
5. 运维简单：不需要额外部署服务 ✅（嵌入式）
```

### 为什么不选 ZooKeeper？

```
ZooKeeper 的局限：
1. 运维复杂：需要额外部署 Java 服务
2. API 不友好：需要 ZooKeeper 专属客户端
3. Watch 一次性：不适合 Kubernetes 的 watch-reconnect 模式
4. 数据量限制：不适合大量资源对象
```

## 总结

etcd 的架构，是一场精心设计的「技术选型」：

- **Raft 层**：保证分布式一致性
- **MVCC 层**：支持高效 Watch 和历史回溯
- **BoltDB 层**：提供可靠的持久化存储

理解 etcd 的架构，就理解了 Kubernetes「声明式」的本质。

**面试追问方向：**
- Raft 和 Paxos 的核心区别是什么？
- etcd 的 MVCC 是怎么实现的？
- BoltDB 为什么用 B+ 树而不是 LSM 树？
- 如果 etcd 集群多数节点同时宕机会怎样？
- etcd 如何做数据备份和恢复？