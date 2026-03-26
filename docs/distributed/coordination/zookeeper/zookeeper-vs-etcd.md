# ZooKeeper 与 etcd 对比

你有没有想过这个问题：

分布式协调服务领域，ZooKeeper 几乎是「上古」的存在（2007 年诞生）。而 etcd 是后起之秀（2013 年诞生），却成了 Kubernetes 的存储后端。

一个新，一个老，技术选型时到底选哪个？

今天，我们来一场正面对比。

## 横向对比表

| 维度 | ZooKeeper | etcd |
|------|-----------|------|
| 一致性协议 | ZAB (Paxos 变种) | Raft |
| 数据模型 | ZNode 树形结构 | key-value（按目录组织） |
| API 风格 | 专用协议（ZooKeeper Wire Format） | gRPC + HTTP/JSON |
| 客户端语言 | Java (Curator)、C、Python | Go (官方)、Java、Python |
| Watch 机制 | 一次性触发 | 持续监听（支持从历史版本） |
| 事务支持 | 原子操作（multi-op） | 事务（Twig 事务） |
| 认证 | ACL (digest, ip, world) | mTLS + RBAC |
| 性能 | 单机 ~10万 QPS | 单机 ~10万 QPS |
| 成熟度 | 12+ 年生产验证 | 8+ 年生产验证 |
| 生态 | Kafka、Hadoop、Dubbo | Kubernetes、CoreOS |

## 一致性协议：ZAB vs Raft

ZooKeeper 使用 **ZAB 协议**（ZooKeeper Atomic Broadcast），是 Paxos 的变种。

etcd 使用 **Raft 协议**，是 Diego Ongaro 在 2014 年设计的。

### 两者都是过半选举

核心原理相同：**获得过半票数的节点成为 Leader**。

```java
// ZooKeeper ZAB
if (votes.size() > totalNodes / 2) {
    becomeLeader();
}

// etcd Raft
if (votes.Granted() > totalPeers/2) {
    becomeLeader();
}
```

### 关键区别

1. **ZAB 有 Epoch，Raft 有 Term**

两者都是逻辑时钟，用于区分不同「任期」，防止「穿越」。

2. **ZAB 优化了写的顺序性**

ZAB 保证同一个 Leader 内的提案按 FIFO 顺序处理，Raft 只保证日志连续。

3. **Raft 更易于理解和实现**

Raft 的设计目标就是「易于理解」，它的论文比 Paxos 清晰得多。

## 数据模型：ZNode vs Key-Value

### ZooKeeper 的 ZNode

```text
/config
├── /config/database
│   ├── host = "localhost"
│   ├── port = "3306"
│   └── username = "root"
└── /config/redis
    └── host = "localhost"
```

每个 ZNode 有数据、有 ACL、有版本号。

### etcd 的 Key-Value

```json
{
    "/config/database/host": "localhost",
    "/config/database/port": "3306",
    "/config/database/username": "root"
}
```

etcd 的 key 按 `/` 组织，看起来像目录，但实际上是扁平的 key。

```bash
# etcdctl 操作
etcdctl put /config/database/host "localhost"
etcdctl get /config/database/host
etcdctl get /config/database/ --prefix  # 按前缀查询
```

## Watch 机制：一次性 vs 持续性

这是两者最大的使用差异。

### ZooKeeper：一次性触发

```java
// Watch 触发后失效
byte[] data = client.getData()
    .usingWatcher(watcher -> {
        // 只触发一次
    })
    .forPath("/config");

// 想继续监听？需要重新注册
```

### etcd：支持从任意版本监听

```java
// etcd 支持持续监听
Watch watch = client.watch("/config/database/host");
watch.listen(event -> {
    System.out.println("Key: " + event.key());
    System.out.println("Value: " + event.value());
    // 持续监听，不需要重新注册
});
```

**etcd 的优势**：可以回溯历史版本，Watch 从指定 revision 开始。

## API 风格：专用协议 vs gRPC

### ZooKeeper：专用协议

ZooKeeper 使用自己的 Wire Protocol，基于 TCP 的二进制协议。

```java
// 必须使用 ZooKeeper 客户端
CuratorFramework client = CuratorFrameworkFactory.newClient(
    "localhost:2181", new ExponentialBackoffRetry(1000, 3)
);
client.start();
```

### etcd：gRPC + HTTP

etcd 同时提供 HTTP 和 gRPC API。

```bash
# HTTP API
curl http://localhost:2379/v3/kv/put -X POST \
    -d '{"key": "a2V5", "value": "dmFsdWU="}'

# gRPC（更高效）
grpcurl -d '{"key": "a2V5", "value": "dmFsdWU="} \
    localhost:2379 etcdserverpb.KV.Put
```

## 生态对比

### ZooKeeper 的生态

```
Kafka → ZooKeeper（Controller 选举）
Hadoop → ZooKeeper（NameNode 高可用）
Dubbo → ZooKeeper（注册中心，2.6 及之前）
HBase → ZooKeeper（Master 选举）
Solr → ZooKeeper（配置管理）
```

### etcd 的生态

```
Kubernetes → etcd（API Server 存储后端）
CoreOS → etcd（分布式配置）
Cloud Foundry → etcd（服务发现）
```

## 选型决策

### 选择 ZooKeeper 的场景

- **金融、交易系统**：需要极高可靠性，ZooKeeper 久经验证
- **需要成熟生态**：Kafka、Hadoop 等组件深度集成
- **Curator 库**：丰富的 Recipes 实现（锁、选举、队列）
- **Java 技术栈**：Curator 是目前最好的 ZooKeeper 客户端

### 选择 etcd 的场景

- **Kubernetes 生态**：别想了，必须用 etcd
- **需要 gRPC/HTTP API**：多语言支持更好
- **需要持续监听**：etcd 的 Watch 更强大
- **运维简单**：etcd 部署和运维更友好

### 性能对比

两者在**小数据量**场景下性能相当（都是 ~10万 QPS）。

但 etcd 在**读多写少**场景下通过 Read Index 优化，延迟更低。

## 总结

ZooKeeper 和 etcd 是分布式协调领域的两大基石：

- **ZooKeeper**：老牌劲旅，生态成熟，Java 友好
- **etcd**：后起之秀，K8s 加持，API 友好

没有绝对的好坏，只有场景的匹配。

**面试追问方向：**
- ZAB 和 Raft 的本质区别是什么？
- 为什么 Kubernetes 选择 etcd 而不是 ZooKeeper？
- ZooKeeper 的 Watch 机制有什么局限？
- 如果 etcd 集群不可用，Kubernetes 会怎样？