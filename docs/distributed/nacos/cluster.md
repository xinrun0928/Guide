# Nacos 集群模式与一致性协议

你有没有想过这个问题：

Nacos 单机模式用的是嵌入式数据库 Derby，数据存在本地。

如果 Nacos 宕机了，服务发现和配置管理不就全挂了吗？

生产环境必须用集群模式。但集群模式下，多个 Nacos 节点如何保证数据一致性？

这就涉及到 Nacos 的集群一致性协议了。

## Nacos 集群部署

### 最小集群规模

Nacos 官方建议：

```
生产环境：至少 3 个节点
节点数：3、5、7（奇数）
原因：奇数节点容忍 N/2-1 个节点故障
```

### 集群配置文件

```yaml
# cluster.conf
192.168.1.1:8848
192.168.1.2:8848
192.168.1.3:8848
```

### 集群部署架构

```
                    ┌─────────────────┐
                    │  VIP / LB       │
                    │  (统一入口)      │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐    ┌───────▼───────┐    ┌───────▼───────┐
│   Nacos-1     │    │   Nacos-2     │    │   Nacos-3     │
│   Leader      │◄──►│   Follower    │◄──►│   Follower    │
│  (读写)        │    │  (只读)        │    │  (只读)        │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                    ┌────────▼────────┐
                    │    MySQL        │
                    │  (共享存储)      │
                    └─────────────────┘
```

## 一致性协议

Nacos 2.0 使用了自研的一致性协议：

### CP 模式：Raft 协议

用于配置管理场景，配置需要强一致性。

```java
// Raft Leader 选举
public class RaftConsistency {

    // 1. 发起选举
    public void startElection() {
        currentTerm++;
        votedFor = selfId;
        // 发送投票请求给其他节点
        for (Node node : otherNodes) {
            sendVoteRequest(node, new VoteRequest(currentTerm, lastLogIndex));
        }
    }

    // 2. 处理投票响应
    public void handleVoteResponse(VoteResponse response) {
        if (response.isGranted()) {
            votesCount++;
            if (votesCount > totalNodes / 2) {
                becomeLeader();
            }
        }
    }

    // 3. 复制日志
    public void replicateLog(LogEntry entry) {
        for (Node node : otherNodes) {
            sendAppendEntries(node, entry);
        }
    }
}
```

### AP 模式：Distro 协议

用于服务注册发现场景，允许短暂不一致。

```java
// Distro 协议
public class DistroConsistency {

    // 1. 数据分片
    // 每个节点负责一部分服务的数据
    public String getResponsibleKey(String serviceName) {
        int hash = serviceName.hashCode() % nodes.size();
        return nodes.get(hash);
    }

    // 2. 异步同步
    // 配置变更后，异步同步到其他节点
    public void asyncSync(String key, Config config) {
        // 异步发送同步任务
        executor.submit(() -> syncToOtherNodes(key, config));
    }

    // 3. 定期同步
    // 定期从其他节点拉取数据
    public void periodicSync() {
        executor.scheduleAtFixedRate(() -> pullFromOtherNodes(), 10, 10, TimeUnit.SECONDS);
    }
}
```

## 读写分离

### 写请求

```
客户端写请求 → 任意 Nacos 节点 → Raft 协议同步 → Leader 处理
```

所有写请求都通过 Raft 协议同步，写操作必须经过 Leader。

### 读请求

```
客户端读请求 → 任意 Nacos 节点 → 本地读取 → 返回
```

读请求可以直接在任意节点读取，实现**读写分离**。

```java
// Nacos 的读写分离策略
public class ReadWriteSplitting {

    // 写操作：必须通过 Leader
    public void write(Config config) {
        RaftCluster cluster = RaftCluster.getInstance();
        cluster.write(config);  // Leader 处理
    }

    // 读操作：任意节点
    public Config read(String key) {
        return localCache.get(key);  // 本地读取
    }
}
```

## 集群健康检查

### 节点间心跳

Nacos 集群节点之间会互相发送心跳，检测节点存活。

```java
// 节点健康检查
public class NodeHealthCheck {

    // 定时发送心跳
    @Scheduled(fixedRate = 5000)
    public void sendHeartbeat() {
        for (Node node : clusterNodes) {
            try {
                httpClient.post(node.getUrl() + "/v1/console/health",
                    "I'm alive");
            } catch (Exception e) {
                // 节点不可达
                markNodeUnhealthy(node);
            }
        }
    }

    // 超过阈值，标记为死亡
    public void markNodeUnhealthy(Node node) {
        node.setHealthy(false);
        // 从集群中移除
        clusterNodes.remove(node);
        // 触发 Leader 重新选举（如果 Leader 挂了）
    }
}
```

### 故障自动转移

```
1. Leader 节点宕机
2. Follower 节点检测到心跳超时
3. 发起新的选举
4. 新的 Leader 产生
5. 客户端自动重定向到新 Leader
```

## 生产部署注意事项

### 1. VIP / 域名访问

```
建议通过 VIP 或域名访问 Nacos 集群：

- 隐藏内部节点细节
- 方便节点扩缩容
- 故障自动转移对客户端透明
```

### 2. MySQL 高可用

```yaml
# MySQL 主从复制
spring:
  datasource:
    url: jdbc:mysql://mysql-master:3306/nacos?useUnicode=true

    # 或者使用 MySQL 双主 + Keepalived
```

### 3. 客户端重试

```yaml
# 客户端配置
spring:
  cloud:
    nacos:
      discovery:
        server-addr: nacos-cluster:8848  # VIP 地址
        # 或多个地址
        # server-addr: 192.168.1.1:8848,192.168.1.2:8848,192.168.1.3:8848
```

## Nacos 集群 vs ZooKeeper

| 维度 | Nacos 集群 | ZooKeeper |
|------|-----------|-----------|
| 一致性协议 | Raft + Distro | ZAB |
| 协议自研 | 是 | 否 |
| 读写分离 | 支持 | 不支持 |
| 故障转移 | 自动 | 自动 |
| 运维复杂度 | 中 | 高 |

## 总结

Nacos 集群模式提供了生产级别的高可用：

- **Raft 协议**：保证配置数据的强一致性
- **Distro 协议**：保证服务数据的最终一致性
- **读写分离**：提升读性能
- **故障自动转移**：保证服务可用性

理解 Nacos 的集群机制，才能在生产环境中正确部署。

**面试追问方向：**
- Nacos 的 Raft 协议和 ZooKeeper 的 ZAB 有什么区别？
- Distro 协议是什么？为什么服务发现要用 AP 模式？
- Nacos 集群模式下如何保证数据一致性？
- 如果 Nacos Leader 节点挂了，会发生什么？