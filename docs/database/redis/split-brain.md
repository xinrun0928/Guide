# Redis 脑裂问题与解决方案

什么是脑裂？

简单说：**一个集群被分割成两个或多个部分，每个部分都认为自己是主节点。**

```
┌─────────────────────────────────────────────────────────────────┐
│                        脑裂场景                                   │
│                                                                 │
│                    ═════════════════                           │
│                         网络分区                                 │
│                    ═════════════════                           │
│                      │         │                               │
│            ┌─────────┘         └─────────┐                     │
│            ▼                             ▼                     │
│   ┌─────────────────┐       ┌─────────────────┐                │
│   │    分区 A        │       │    分区 B        │                │
│   │                 │       │                 │                │
│   │  Master-A       │       │  Master-B       │                │
│   │  (原主节点)      │       │  (从节点晋升)    │                │
│   │                 │       │                 │                │
│   │  Slave-A        │       │  Slave-B        │                │
│   │                 │       │                 │                │
│   └─────────────────┘       └─────────────────┘                │
│                                                                 │
│   两个分区各有主节点，都能接受写入 → 脑裂！                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 为什么会发生脑裂？

### 场景一：网络抖动

```bash
# 网络设备故障，导致部分节点断开
# 断开的主节点仍然存活，但 Sentinel/Cluster 认为它宕机了
```

### 场景二：主节点负载过高

```bash
# 主节点 CPU 100%，无法响应 Sentinel 的 PING
# Sentinel 认为主节点宕机，触发故障转移
# 但主节点实际上还在运行
```

### 场景三：Sentinel 配置不当

```bash
# 3 个 Sentinel，quorum 设置为 1
sentinel monitor mymaster 127.0.0.1 6379 1
# 只要 1 个 Sentinel 认为宕机就触发故障转移
# 风险：单个 Sentinel 误判就可能脑裂
```

## 脑裂的危害

| 危害 | 说明 |
|-----|------|
| **数据丢失** | 分区期间写入的数据会丢失 |
| **数据不一致** | 两个主节点都写入，数据冲突 |
| **业务混乱** | 不同客户端连接不同主节点 |
| **雪崩** | 应用无法正确处理双主情况 |

### 脑裂期间的数据问题

```
分区前（正常）：
Master: count = 100

分区期间：
分区 A（多数）              分区 B（少数）
Master-A: count = 105       Master-B: count = 103
(继续处理请求)             (从节点晋升为主)

分区恢复：
原 Master 变成从节点，复制新主
Master-A: count = 105 → 被 Master-B: count = 108 覆盖
丢失 3 条写入
```

## 解决方案

### 方案一：正确配置 Sentinel Quorum

```bash
# Sentinel 配置
# 公式：quorum = (Sentinel数量 / 2) + 1

# 3 个 Sentinel → quorum = 2
sentinel monitor mymaster 127.0.0.1 6379 2

# 5 个 Sentinel → quorum = 3
sentinel monitor mymaster 127.0.0.1 6379 3
```

**原理**：需要多数 Sentinel 同意才能故障转移，避免少数 Sentinel 误判。

### 方案二：配置 min-slaves-to-write

```bash
# redis.conf

# 主节点至少要有 1 个从节点正常，否则拒绝写入
min-slaves-to-write 1

# 从节点延迟不超过 10 秒
min-slaves-max-lag 10
```

**原理**：如果从节点太少或延迟太大，主节点拒绝写入，避免写入到「孤岛」。

```java
/**
 * min-slaves-to-write 的作用：
 * 
 * 如果配置了 min-slaves-to-write 1
 * 当主节点只有 0 个可用从节点时
 * 写入操作会被拒绝
 * 
 * 效果：
 * - 脑裂期间，分区 A 可能只剩主节点
 * - 由于 min-slaves-to-write = 1
 * - 分区 A 的主节点会拒绝写入
 * - 避免数据写入孤岛
 */
```

### 方案三：调整节点超时时间

```bash
# redis.conf

# 节点超时时间（毫秒）
# 太短容易误判，太长恢复慢
cluster-node-timeout 15000  # 15 秒

# Sentinel 主观下线时间
sentinel down-after-milliseconds mymaster 30000  # 30 秒
```

**建议**：
- `down-after-milliseconds` 应该大于网络正常波动的最大延迟
- `cluster-node-timeout` 应该足够大，避免网络抖动触发故障转移

### 方案四：使用 Redis Cluster

Redis Cluster 本身也面临脑裂风险，但有以下优势：

```bash
# cluster-node-timeout
# 节点多久没响应认为宕机
cluster-node-timeout 15000

# 故障转移需要多数主节点投票
# 不可能出现单节点分裂
```

### 方案五：网络分区检测 + 自动处理

```java
/**
 * 应用层检测和处理脑裂：
 * 
 * 1. 监控主节点可用性
 * 2. 写入时检查响应时间
 * 3. 检测到异常时降级
 */
public class SplitBrainHandler {
    
    private JedisPool masterPool;
    private JedisPool backupPool;
    
    /**
     * 写入数据，带超时检测
     */
    public void writeWithTimeout(String key, String value) {
        try (Jedis jedis = masterPool.getResource()) {
            // 设置超时
            jedis.setTimeout(1000, TimeUnit.MILLISECONDS);
            jedis.set(key, value);
        } catch (JedisConnectionException e) {
            // 主节点超时，降级到备用节点
            fallbackWrite(key, value);
        }
    }
    
    /**
     * 降级写入
     */
    private void fallbackWrite(String key, String value) {
        // 写入本地缓存或消息队列
        // 记录日志，告警
        writeToLocalCache(key, value);
        sendAlert("Redis master unavailable, using fallback");
    }
}
```

## 完整的防脑裂配置

### Sentinel 配置

```bash
# sentinel.conf

# 主节点监控（正确的 quorum）
sentinel monitor mymaster 127.0.0.1 6379 2

# 主观下线时间（足够长）
sentinel down-after-milliseconds mymaster 30000

# 故障转移超时
sentinel failover-timeout mymaster 180000

# 需要至少 1 个正常从节点才能写入
sentinel min-slave-to-write 1
sentinel min-slave-max-lag 10
```

### Redis 配置

```bash
# redis.conf

# 从节点配置
replica-serve-stale-data no  # 从节点数据过期时不提供数据

# 持久化配置
appendonly yes
appendfsync everysec
```

## 脑裂的监控与告警

### 监控指标

```bash
# 监控 Sentinel 状态
redis-cli -p 26379 SENTINEL master mymaster

# 返回示例
# 1) "name" → "127.0.0.1:6379"
# 2) "flags" → "master"
# 3) "num-slaves" → "2"
# 4) "num-other-sentinels" → "2"
# ...
```

### Prometheus 告警规则

```yaml
groups:
  - name: redis_split_brain_alerts
    rules:
      # 告警：多个主节点
      - alert: RedisMultipleMasters
        expr: |
          count(
            redis_instance_info{role="master"} 
            by (cluster)
          ) > 1
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis 发现多个主节点，可能发生脑裂"
          
      # 告警：主从延迟过大
      - alert: RedisReplicationLag
        expr: redis_replication_lag_seconds > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis 复制延迟超过 10 秒"
```

### 日志分析

```bash
# 查看 Sentinel 日志中的故障转移记录
grep "FAILOVER" /var/log/redis/sentinel.log

# 查看 Redis 日志中的写入拒绝记录
grep "MIN_SLAVES" /var/log/redis/redis.log
```

## 脑裂后的恢复

### 步骤一：确认主节点

```bash
# 查看当前所有 Sentinel 认为的主节点
redis-cli -p 26379 SENTINEL get-master-addr-by-name mymaster
redis-cli -p 26380 SENTINEL get-master-addr-by-name mymaster
redis-cli -p 26381 SENTINEL get-master-addr-by-name mymaster
```

### 步骤二：确认数据完整性

```bash
# 检查各节点数据
redis-cli -p 6379 INFO replication
redis-cli -p 6380 INFO replication
redis-cli -p 6381 INFO replication
```

### 步骤三：手动处理（如果需要）

```bash
# 如果原主节点数据更新，需要将其恢复为主节点
# 1. 确保原主节点已经恢复
redis-cli -p 6379 PING

# 2. 让新主节点降为从节点
redis-cli -p 6380 SLAVEOF 127.0.0.1 6379

# 3. 等待数据同步
redis-cli -p 6380 INFO replication
```

## 面试场景模拟

**面试官**：Redis 脑裂是怎么发生的？

**候选人**：当网络分区发生时，集群被分成多个部分，每个部分各自选举出主节点。比如 3 个节点的主从集群，如果网络分区导致 1 个节点单独一组，其他 2 个节点一组，那么少数派这边的从节点可能晋升为主节点，形成双主情况。

**面试官**：怎么解决？

**候选人**：可以从多个层面解决……

1. **Sentinel 配置**：正确设置 quorum，比如 3 个 Sentinel 要设 quorum=2，这样需要多数 Sentinel 同意才能故障转移。
2. **Redis 配置**：开启 `min-slaves-to-write`，确保主节点至少有 1 个可用从节点时才接受写入。
3. **调整超时时间**：适当增大 `down-after-milliseconds`，避免网络抖动误判。
4. **监控告警**：监控多个主节点的情况，发现异常及时处理。

**面试官**：如果已经发生脑裂，怎么处理？

**候选人**：首先确认哪个是「正确」的主节点（通常是有最新数据的），然后把另一个节点降为从节点，让它复制正确的主节点，最后检查数据是否有丢失。

## 总结

脑裂是分布式系统的经典问题：

- **原因**：网络分区 + 不当配置
- **危害**：数据丢失、数据不一致
- **预防**：正确配置 quorum、min-slaves-to-write、合理超时时间
- **恢复**：确认主节点、手动处理、监控告警

## 留给你的问题

假设你配置了 `min-slaves-to-write 1`，主节点只有 1 个从节点。

**问题：如果主节点和从节点之间发生网络抖动，从节点短暂断开连接又恢复，这会导致主节点拒绝写入吗？`min-slaves-max-lag` 是如何处理这种情况的？**
