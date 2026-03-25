# Nacos 集群一致性

你已经知道 ZooKeeper 用「过半机制」保证一致性。

但 ZooKeeper 是用 **Leader + 同步** 的方式实现的。这要求写操作必须经过 Leader，所有数据都要同步给 Follower。

**问题来了：如果你的服务实例有 1 万个，每个实例每 5 秒发一次心跳，ZooKeeper 能扛住吗？**

答案是：**扛不住。** ZooKeeper 的写吞吐受限于单节点的 Leader。

Nacos 换了一种思路——**Distro 协议**。它不追求强一致，而是追求「最终一致 + 高可用」。

## 为什么不选 ZooKeeper 的方案？

**ZooKeeper 的问题：**

1. **写瓶颈**：所有写请求必须经过 Leader，Leader 是瓶颈
2. **心跳风暴**：每个实例都要和 ZooKeeper 保持长连接，1 万实例 = 1 万连接
3. **运维复杂**：需要维护 ZooKeeper 集群，了解 ZAB 协议

**Nacos 的设计目标：**

- 支持 10 万级服务实例
- 写操作可以分布到多个节点
- 运维简单，像 MySQL 一样部署

## Distro 协议：分片 + 同步

Distro（Distributed Table Replication）协议的核心思想是：**数据分片 + 异步同步**。

### 数据分片

```
假设有 3 台 Nacos Server：192.168.1.100、192.168.1.101、192.168.1.102

服务注册时，根据服务名 hash 决定存储在哪台服务器：
hash("order-service") = 12345
hash("inventory-service") = 67890

然后根据一致性 hash 或取模，决定存储到哪台服务器。

比如：
- 192.168.1.100 负责：服务名 hash 范围 [0, 4000)
- 192.168.1.101 负责：服务名 hash 范围 [4000, 8000)
- 192.168.1.102 负责：服务名 hash 范围 [8000, 12000)
```

**每个节点只负责一部分数据，而不是全部数据。**

```java
// 简化的分片逻辑
public String getResponsibleServer(String serviceName) {
    int hash = Math.abs(serviceName.hashCode());
    int index = hash % serverCount;
    return servers[index];
}
```

### 数据同步

每个节点除了存储自己的数据，还会同步数据给其他节点。

```
初始状态：
Server 1: [order-service]        ← 负责 order-service
Server 2: [inventory-service]   ← 负责 inventory-service
Server 3: [payment-service]     ← 负责 payment-service

同步后（每个节点都有全量数据）：
Server 1: [order, inventory, payment]
Server 2: [order, inventory, payment]
Server 3: [order, inventory, payment]
```

**同步方式：**

1. **启动时同步**：新节点启动时，从其他节点拉取全量数据
2. **运行时同步**：注册/变更时，异步同步给其他节点
3. **健康检查同步**：节点故障时，触发数据迁移

## 一致性模型：最终一致

Distro 协议保证的是**最终一致性**，而不是强一致性。

**这意味着：**

- 写操作直接返回成功（不需要等所有节点确认）
- 其他节点异步同步数据
- 在同步窗口期内，不同节点可能看到不同的数据

```java
// 客户端写操作
public void registerInstance(String serviceName, Instance instance) {
    // 1. 找到负责这个服务的节点
    String responsibleServer = findResponsibleServer(serviceName);

    // 2. 如果请求打到的是负责节点，直接写入
    if (isResponsibleServer(responsibleServer)) {
        saveToLocal(instance);
        // 3. 异步同步给其他节点
        syncToOthers(instance);
        return true;
    } else {
        // 4. 如果不是，重定向到负责节点
        redirectToServer(responsibleServer, instance);
        return true;
    }
}
```

### 读取的容错处理

```java
public List&lt;Instance&gt; getInstances(String serviceName) {
    // 1. 先从本地缓存读取（快速路径）
    List&lt;Instance&gt; localInstances = getFromLocal(serviceName);

    // 2. 如果本地有数据，直接返回
    if (localInstances != null && !localInstances.isEmpty()) {
        return localInstances;
    }

    // 3. 如果本地没有，查询负责节点
    String responsibleServer = findResponsibleServer(serviceName);
    return queryFromServer(responsibleServer, serviceName);
}
```

## Leader 的角色

你可能注意到，Distro 协议中，每个节点都可能成为「负责节点」。

**那集群中的 Leader 是干什么用的？**

```java
// Nacos 集群的 Leader 主要负责：
// 1. 配置变更的协调
// 2. 元数据的统一管理
// 3. 故障转移的决策

// 但对于服务注册这种高频操作
// Leader 只做负载均衡，不做数据同步
```

**Nacos 的 Leader 选举：**

```
选举算法：Raft 协议（类似 Kafka 的 Controller 选举）

1. 节点启动时，状态为 Follower
2. 等待 Leader 心跳超时后，变成 Candidate
3. Candidate 发起投票，获得过半票数后变成 Leader
4. Leader 负责处理写请求，同时同步给 Follower
```

```yaml
# Nacos 集群配置
# 1. nginx.conf 配置负载均衡
upstream nacos-cluster {
    server 192.168.1.100:8848;
    server 192.168.1.101:8848;
    server 192.168.1.102:8848;
}

# 2. application.yml 配置集群地址
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.100:8848,192.168.1.101:8848,192.168.1.102:8848
```

## 故障处理

### 单节点故障

```
Server 1 宕机
         ↓
服务注册请求自动路由到 Server 2、3
         ↓
Server 2、3 中的数据通过同步保持一致
         ↓
服务发现不受影响
         ↓
Server 1 恢复后，重新加入集群，同步最新数据
```

### 网络分区

```
网络分区：Server 1 和 Server 2、3 断开连接

分区 1（Server 1）：独立运行，继续服务
分区 2（Server 2、3）：继续服务

Nacos 的处理：
- 分区 1 可能产生「孤立数据」
- 分区 2 正常运行
- 网络恢复后，以多数派（Server 2、3）的数据为准
```

### 数据冲突

如果两个分区同时修改了同一数据，恢复后如何处理？

```java
// Nacos 的策略：以时间戳为准，保留最新修改
// 如果两个修改时间相同，保留节点 ID 更大的

public void resolveConflict(DataWrapper local, DataWrapper remote) {
    // 比较修改时间
    if (remote.getTimestamp() > local.getTimestamp()) {
        // 远程数据更新，采用远程数据
        return remote;
    } else if (remote.getTimestamp() == local.getTimestamp()) {
        // 时间相同，比较节点 ID
        if (remote.getNodeId() > local.getNodeId()) {
            return remote;
        }
    }
    return local;
}
```

## 性能对比

| 指标 | ZooKeeper | Nacos（单机） | Nacos（集群 + Distro） |
|-----|-----------|--------------|---------------------|
| 写吞吐 | ~1000 QPS | ~10000 QPS | ~50000 QPS |
| 读吞吐 | ~10000 QPS | ~50000 QPS | ~50000 QPS |
| 服务实例上限 | ~10000 | ~50000 | ~100000 |
| 一致性模型 | 强一致 | 最终一致 | 最终一致 |

**为什么 Nacos 性能更高？**

1. **写操作分散**：不需要经过 Leader，每个节点都可以处理写请求
2. **连接复用**：心跳可以通过 HTTP 长轮询，不需要维持大量 TCP 连接
3. **异步同步**：写操作直接返回，不阻塞等待同步完成

## 总结

Distro 协议的核心设计：

```
数据分片 → 负责节点处理写请求 → 异步同步 → 最终一致
```

**Distro vs ZAB（ZooKeeper）：**

| 特性 | Distro | ZAB |
|-----|--------|-----|
| 一致性模型 | 最终一致 | 强一致 |
| 写操作 | 可在任意节点 | 必须经过 Leader |
| 同步方式 | 异步 | 同步 |
| 适用场景 | 大规模服务注册 | 强一致协调 |

**什么时候选 Distro？**

- 服务数量 > 10000
- 需要高可用 > 强一致
- 读多写少的场景

**什么时候选 ZAB？**

- 数据一致性要求极高
- 配置变更、选举等核心协调
- 服务数量 < 5000

---

**留给你的问题：**

假设 Nacos 集群有 3 台机器，正在运行。突然有一台机器因为网络抖动，短暂和另外两台断开了 10 秒连接，然后又恢复了。

在这 10 秒内：
- 服务实例的心跳会失败吗？
- 新实例能注册成功吗？
- 恢复后，数据会自动同步吗？

这涉及到网络分区容错的设计，你是怎么理解的？
