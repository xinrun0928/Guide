# Redis Cluster 故障转移与槽迁移

集群中某个节点宕机了，会发生什么？

数据会丢失吗？请求会失败吗？

今天来聊聊 **Redis Cluster 的故障转移和槽迁移机制**。

## 故障转移（Failover）

### 主节点故障

当主节点宕机时：

```
┌─────────────────────────────────────────────────────────────────┐
│                      故障检测                                    │
│                                                                 │
│   ┌─────────┐       ┌─────────┐       ┌─────────┐             │
│   │ Master1 │       │ Master2 │       │ Master3 │             │
│   └────┬────┘       └────┬────┘       └────┬────┘             │
│        │                 │                 │                    │
│        │                 │                 │                    │
│   [宕机]│                 │                 │                    │
│        │    PING 超时     │                 │                    │
│        │◀────────────────┼─────────────────│                    │
│        │    标记为疑似下线 │                 │                    │
│        │                 │                 │                    │
│        │    FAIL 消息广播 │                 │                    │
│        │─────────────────┼────────────────▶│                    │
│        │                 │                 │                    │
└────────┼─────────────────┼─────────────────┼────────────────────┘
         │                 │                 │
         ▼                 ▼                 ▼
```

### 从节点发起故障转移

当从节点发现主节点下线时，会发起**故障转移**：

```
Step 1: 从节点申请成为主节点
        ↓
Step 2: 向集群中的其他节点请求投票
        ↓
Step 3: 如果获得足够的票数（多数主节点同意）
        ↓
Step 4: 从节点晋升为新主节点
        ↓
Step 5: 广播新配置
```

### 故障转移投票

```java
/**
 * Redis Cluster 故障转移投票机制：
 * 
 * 1. 从节点向所有主节点发送 FAILOVER_AUTH_REQUEST
 * 2. 主节点检查条件：
 *    - 主节点本身在线
 *    - 从节点的配置版本（epoch）比自己的新
 *    - 在 lastvote_epoch 内没有投过票
 * 3. 如果满足条件，主节点返回 FAILOVER_AUTH_ACK
 * 4. 从节点收到多数主节点的投票后，晋升为新主节点
 */
```

### 故障转移的触发条件

| 条件 | 说明 |
|-----|------|
| 主节点宕机 | 所有从节点都发现主节点不可达 |
| 从节点发现主节点下线 | PING 超时 |
| 从节点数量足够 | 通常至少 1 个从节点 |

### 故障转移后的状态

```
故障转移前：
┌─────────┐                    ┌─────────┐
│ Master1 │ ◀─── 复制 ──────── │ Slave1  |
│ (宕机)   │                    │ (新主)   │ ←── 选举为新主
└─────────┘                    └─────────┘

故障转移后：
┌─────────┐                    ┌─────────┐
│ Master1 │ ◀─── 待恢复 ────── │ Slave1  │ ←── 主节点
│ (旧主)   │                    │ (新主)   │
└─────────┘                    └─────────┘
         │                            │
         │                            │
         └───────── SLAVEOF ──────────┘
                   (变成从节点)
```

## 槽迁移（Slot Migration）

### 为什么要迁移槽？

- 节点负载不均衡
- 扩容：添加新节点
- 缩容：移除节点
- 故障转移后的重新分配

### 槽迁移的过程

```
┌─────────────────────────────────────────────────────────────────┐
│                      槽迁移流程                                   │
│                                                                 │
│   源节点                              目标节点                    │
│   (Master1)                          (Master2)                  │
│                                                                 │
│   槽 5000:                                                    │
│   ┌──────────┐                        ┌──────────┐              │
│   │ key1     │                        │          │              │
│   │ key2     │                        │          │              │
│   │ key3     │                        │          │              │
│   └──────────┘                        └──────────┘              │
│        │                                    │                   │
│        │ 1. CLUSTER SETSLOT 5000 IMPORTING │                   │
│        │◀──────────────────────────────────│                   │
│        │                                    │                   │
│        │ 2. CLUSTER SETSLOT 5000 MIGRATING │                   │
│        │──────────────────────────────────▶│                   │
│        │                                    │                   │
│        │ 3. 迁移 key 数据                   │                   │
│        │──────────────────────────────────▶│                   │
│        │                                    │                   │
│        │ 4. 迁移完成，广播新配置             │                   │
│        │──────────────────────────────────▶│                   │
│        │                                    │                   │
└─────────────────────────────────────────────────────────────────┘
```

### 在线迁移示例

```bash
# 1. 将槽 5000 迁移到目标节点
redis-cli -p 7000 CLUSTER SETSLOT 5000 IMPORTING <target-node-id>
redis-cli -p 7001 CLUSTER SETSLOT 5000 MIGRATING <source-node-id>

# 2. 迁移具体 key
redis-cli -p 7000 MIGRATE 127.0.0.1 7001 6379 key1 0 5000
redis-cli -p 7000 MIGRATE 127.0.0.1 7001 6379 key2 0 5000

# 3. 或者使用 redis-cli --cluster 工具
redis-cli --cluster reshard 127.0.0.1:7000 \
    --cluster-from <source-node-id> \
    --cluster-to <target-node-id> \
    --cluster-slots 1000
```

### 迁移期间的请求处理

```
┌─────────────────────────────────────────────────────────────────┐
│                     迁移期间的请求处理                            │
│                                                                 │
│   客户端 ───▶ 源节点 ──── key 不存在 ──── 返回 ASK              │
│                                                 │                │
│                                                 ▼                │
│                                       ASK 重定向                  │
│                                       (请去目标节点)              │
│                                                 │                │
│                                                 ▼                │
│                                          客户端 ───▶ 目标节点    │
│                                                       │          │
│                                                       ▼          │
│                                                  继续处理         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**两种重定向**：

| 重定向 | 原因 | 客户端行为 |
|-------|------|-----------|
| MOVED | 槽已经迁移完成 | 更新本地映射，后续直接请求目标节点 |
| ASK | 槽正在迁移中 | 先请求源节点，再请求目标节点 |

### ASK vs MOVED

```java
/**
 * MOVED：槽已迁移，永久重定向
 * 
 * GET key
 * MOVED slot host:port
 * 
 * 客户端应该：
 * 1. 更新本地槽映射
 * 2. 后续请求直接发送到新节点
 */

/**
 * ASK：槽迁移中，临时重定向
 * 
 * GET key
 * ASK slot host:port
 * 
 * 客户端应该：
 * 1. 先发送 ASKING 命令
 * 2. 再发送原请求
 * 
 * 示例：
 * ASKING
 * GET key
 */
```

## 集群扩缩容

### 扩容：添加新节点

```bash
# 1. 启动新节点
redis-server --port 7006 --cluster-enabled yes \
    --cluster-config-file nodes-7006.conf

# 2. 添加为新主节点
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000

# 3. 迁移部分槽到新节点
redis-cli --cluster reshard 127.0.0.1:7000 \
    --cluster-from <node1-id>,<node2-id>,<node3-id> \
    --cluster-to <new-node-id> \
    --cluster-slots 5462
```

### 缩容：移除节点

```bash
# 1. 先迁移槽
redis-cli --cluster reshard 127.0.0.1:7000 \
    --cluster-to <target-node-id> \
    --cluster-slots <num-slots>

# 2. 删除节点
redis-cli --cluster del-node 127.0.0.1:7000 <node-id>
```

### 从节点添加

```bash
# 添加从节点
redis-cli --cluster add-node 127.0.0.1:7006 127.0.0.1:7000 \
    --cluster-slave --cluster-master-id <master-id>
```

## 故障模拟与测试

### 手动故障转移

```bash
# 在从节点上执行，强制切换为主节点
redis-cli -p 7003 CLUSTER FAILOVER
```

### 节点下线

```bash
# 让节点忘记其他节点
redis-cli -p 7000 CLUSTER FORGET <node-id>

# 或者直接关闭节点
redis-cli -p 7000 SHUTDOWN
```

### Java 测试代码

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.params.CLUSTER_FAILOVERParams;

public class ClusterFailoverTest {
    
    /**
     * 手动触发故障转移
     */
    public void manualFailover(String slaveHost, int slavePort) {
        try (Jedis jedis = new Jedis(slaveHost, slavePort)) {
            // 强制故障转移（忽略主节点状态）
            jedis.clusterFailover(CLUSTER_FAILOVERParams.FAILOVER_FORCE);
        }
    }
    
    /**
     * 观察集群状态
     */
    public void showClusterInfo(String host, int port) {
        try (Jedis jedis = new Jedis(host, port)) {
            // 获取集群节点信息
            String clusterNodes = jedis.clusterNodes();
            System.out.println("=== 集群节点 ===");
            System.out.println(clusterNodes);
            
            // 获取集群状态
            String clusterInfo = jedis.clusterInfo();
            System.out.println("=== 集群状态 ===");
            System.out.println(clusterInfo);
        }
    }
    
    /**
     * 检查槽分配
     */
    public void showSlots() {
        try (Jedis jedis = new Jedis("127.0.0.1", 7000)) {
            // 获取槽到节点的映射
            Map&lt;String, Connection&gt; slotToNode = new HashMap&lt;&gt;();
            String[] nodes = jedis.clusterNodes().split("\n");
            
            for (String node : nodes) {
                if (node.contains("master")) {
                    // 解析节点 ID 和槽范围
                    // ...
                }
            }
        }
    }
}
```

## 故障转移的常见问题

### 问题 1：从节点数量不足

```bash
# 如果主节点没有从节点，宕机后无法故障转移
# 该主节点的所有槽都不可用
cluster-require-full-coverage yes  # 默认开启，要求所有槽都可用
```

**解决**：确保每个主节点至少有 1 个从节点。

### 问题 2：脑裂问题

```
┌─────────────────────────────────────────────────────────────────┐
│                        脑裂场景                                   │
│                                                                 │
│                    网络分区                                      │
│                    ══════════                                   │
│                      │    │                                     │
│            ┌────────┘    └────────┐                             │
│            ▼                      ▼                             │
│      ┌──────────┐          ┌──────────┐                        │
│      │  Master  │          │  Master  │                        │
│      │  (少数)   │          │  (多数)   │                        │
│      └──────────┘          └──────────┘                        │
│                                                                 │
│   少数分区的 Master 可能被从节点选举为新主                        │
│   导致数据丢失或不一致                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**解决**：
- 使用奇数个节点
- 合理配置 `cluster-node-timeout`
- 启用 min-slaves 配置

### 问题 3：槽迁移卡住

**原因**：迁移过程中，如果源节点重启，会中断迁移。

**解决**：
```bash
# 检查迁移状态
redis-cli -p 7000 CLUSTER SETSLOT 5000 STATUS
```

## 总结

Redis Cluster 的故障转移和槽迁移：

- **故障转移**：从节点自动选举，投票机制保证一致性
- **槽迁移**：在线迁移，支持热更新
- **ASK vs MOVED**：处理不同阶段的请求重定向
- **扩缩容**：通过迁移槽实现节点增减

## 留给你的问题

在槽迁移过程中，源节点和目标节点都可能导致请求失败。

**问题：为了保证迁移期间的数据一致性，Redis Cluster 是如何处理迁移中的 key 的？ASK 和 MOVED 重定向的优先级是什么？**
