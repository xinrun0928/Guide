# Redis Cluster：槽分片与集群通信

Sentinel 能保证高可用，但不能水平扩展。

主节点只有一台，读写能力有上限。

想要**存储更多数据、处理更高并发**？

**Redis Cluster** 来了。

## 什么是 Redis Cluster？

Redis Cluster 是 Redis 的**分布式集群解决方案**，支持：

- **数据分片**：将数据分散到多个节点
- **高可用**：每个分片可以配置从节点
- **自动故障转移**：节点宕机自动迁移
- **去中心化**：无中心节点，节点间直接通信

```
┌─────────────────────────────────────────────────────────────────┐
│                      Redis Cluster 架构                         │
│                                                                 │
│         ┌─────────┐  ┌─────────┐  ┌─────────┐                  │
│         │ Master1 │  │ Master2 │  │ Master3 │                  │
│         │ (槽0-5460)│  │(槽5461-10922)│ (槽10923-16383)│       │
│         └────┬────┘  └────┬────┘  └────┬────┘                  │
│              │            │            │                        │
│         ┌────▼────┐  ┌────▼────┐  ┌────▼────┐                  │
│         │ Slave1  │  │ Slave2  │  │ Slave3  │                  │
│         │ (副本)   │  │ (副本)   │  │ (副本)   │                  │
│         └─────────┘  └─────────┘  └─────────┘                  │
│                                                                 │
│   所有节点互联（PING-PONG 协议）                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 槽（Slot）分片机制

### 16384 个槽

Redis Cluster 将整个数据库划分为 **16384 个槽**，每个节点负责一部分槽。

| 节点数 | 每节点槽数 |
|-------|-----------|
| 1 | 16384 |
| 3 | 5461 |
| 6 | 2731 |
| 9 | 1820 |

### 槽分配示例

```
节点 1 (127.0.0.1:7000): 槽 0-5460
节点 2 (127.0.0.1:7001): 槽 5461-10922
节点 3 (127.0.0.1:7002): 槽 10923-16383
```

### 键（Key）的槽计算

```java
/**
 * Redis Cluster 计算键所属槽的公式：
 * 
 * slot = CRC16(key) % 16384
 * 
 * CRC16：16位循环冗余校验
 * 
 * 例如：
 * key = "user:1001"
 * CRC16("user:1001") = 12584
 * slot = 12584 % 16384 = 12584
 * 12584 在 0-5460 范围内，所以这个 key 应该在节点 1
 */
public class SlotCalculation {
    public static void main(String[] args) {
        String key = "user:1001";
        int slot = calculateSlot(key);
        System.out.println("Key '" + key + "' 属于槽: " + slot);
        
        // 验证
        System.out.println("槽范围判断: " + (slot >= 0 && slot <= 5460 ? "节点1" : 
            (slot <= 10922 ? "节点2" : "节点3")));
    }
    
    // CRC16 实现
    private static int calculateSlot(String key) {
        int crc = crc16(key.getBytes());
        return crc & 0x3FFF;  // % 16384
    }
    
    private static int crc16(byte[] bytes) {
        int crc = 0xFFFF;
        for (byte b : bytes) {
            crc = (crc >>> 8) ^ crc16Table[(crc ^ b) & 0xFF];
        }
        return crc;
    }
    
    private static int[] crc16Table = new int[256];
    // ... CRC16 表格初始化代码
}
```

### 槽迁移

当需要重新分配槽时，Redis 支持**在线槽迁移**：

```
┌─────────────────────────────────────────────────────────────────┐
│                       槽迁移过程                                  │
│                                                                 │
│   源节点（Master1）                    目标节点（Master2）       │
│                                                                 │
│   槽 5000:                                                    │
│   ┌──────────┐                        ┌──────────┐              │
│   │ key1     │                        │          │              │
│   │ key2     │ ── MOVED ──────────▶  │          │              │
│   │ key3     │                        │          │              │
│   └──────────┘                        └──────────┘              │
│                                                                 │
│   迁移步骤：                                                    │
│   1. 源节点发送指令，开始迁移                                   │
│   2. 源节点向目标节点发送 key 数据                              │
│   3. 源节点处理迁移期间的请求                                    │
│   4. 完成后，槽映射更新                                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Cluster 节点通信

### Gossip 协议

Redis Cluster 节点间使用 **Gossip 协议**进行通信：

```
┌─────────────────────────────────────────────────────────────────┐
│                      Gossip 协议                                 │
│                                                                 │
│   每个节点定期随机选择几个节点交换信息                            │
│                                                                 │
│   ┌─────────┐                                                  │
│   │ 节点 A  │───Gossip──▶┌─────────┐                           │
│   └─────────┘             │ 节点 B  │───Gossip──▶ ...           │
│        │                  └─────────┘                           │
│        │                       │                                │
│        │◀───────Gossip─────────┘                                │
│        │                                                        │
│   交换的信息包括：                                               │
│   - 节点状态（在线/下线）                                       │
│   - 槽映射信息                                                 │
│   - 节点配置版本                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 消息类型

| 消息类型 | 说明 |
|---------|------|
| PING | 节点探活 |
| PONG | 响应 PING |
| MEET | 新节点加入集群 |
| FAIL | 节点下线通知 |
| PUBLISH | 发布/订阅消息 |
| FAILOVER_AUTH_REQUEST | 故障转移投票请求 |

### 故障检测

```
节点 A                           节点 B
  │                                │
  │──────── PING ─────────────────▶│
  │                                │ (B 宕机，无响应)
  │                                │
  │ (超时，标记 B 为疑似下线)        │
  │                                │
  │──────── FAIL ─────────────────▶│
  │         (通知其他节点 B 下线)    │
  │                                │
  │ (其他节点收到 FAIL 消息)         │
  │ (如果多个节点都认为 B 下线)      │
  │ (触发故障转移)                   │
```

## Cluster 配置

### 节点配置

```bash
# redis.conf

# 开启集群模式
cluster-enabled yes

# 节点配置文件
cluster-config-file nodes-6379.conf

# 节点超时时间
cluster-node-timeout 15000

# 故障转移时间
cluster-replica-validity-factor 10

# 迁移槽的并行数量
cluster-migration-barrier 1

# 是否接受所有槽（用于初始集群）
cluster-require-full-coverage yes
```

### 创建集群

```bash
# 启动 6 个 Redis 实例（3 主 3 从）
redis-server --port 7000 --cluster-enabled yes --cluster-config-file nodes-7000.conf
redis-server --port 7001 --cluster-enabled yes --cluster-config-file nodes-7001.conf
redis-server --port 7002 --cluster-enabled yes --cluster-config-file nodes-7002.conf
redis-server --port 7003 --cluster-enabled yes --cluster-config-file nodes-7003.conf
redis-server --port 7004 --cluster-enabled yes --cluster-config-file nodes-7004.conf
redis-server --port 7005 --cluster-enabled yes --cluster-config-file nodes-7005.conf

# 创建集群
redis-cli --cluster create 127.0.0.1:7000 127.0.0.1:7001 127.0.0.1:7002 \
    127.0.0.1:7003 127.0.0.1:7004 127.0.0.1:7005 \
    --cluster-replicas 1
```

### Java 客户端

```java
import redis.clients.jedis.HostAndPort;
import redis.clients.jedis.JedisCluster;
import redis.clients.jedis.JedisPoolConfig;
import java.util.HashSet;
import java.util.Set;

public class RedisClusterDemo {
    
    private JedisCluster cluster;
    
    public void init() {
        // 集群节点
        Set&lt;HostAndPort&gt; nodes = new HashSet&lt;&gt;();
        nodes.add(new HostAndPort("127.0.0.1", 7000));
        nodes.add(new HostAndPort("127.0.0.1", 7001));
        nodes.add(new HostAndPort("127.0.0.1", 7002));
        
        // 连接池配置
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(100);
        poolConfig.setMaxIdle(50);
        poolConfig.setMinIdle(10);
        
        // 初始化集群连接
        cluster = new JedisCluster(nodes, 2000, 2000, 3, poolConfig);
    }
    
    /**
     * 自动路由
     * 
     * JedisCluster 会根据 key 自动计算槽
     * 找到对应的节点执行操作
     */
    public void testOperations() {
        // 写入 - 自动路由到正确的节点
        cluster.set("user:1001", "张三");
        cluster.set("user:1002", "李四");
        
        // 读取 - 自动路由
        String value1 = cluster.get("user:1001");
        String value2 = cluster.get("user:1002");
        
        // 批量操作
        cluster.mset("name", "test", "age", "25");
        
        System.out.println("user:1001 = " + value1);
        System.out.println("user:1002 = " + value2);
    }
    
    /**
     * MOVED 重定向处理
     * 
     * 如果客户端缓存的槽映射过期
     * 会收到 MOVED 错误，客户端自动更新映射并重试
     */
    public void handleMovedRedirect() {
        try {
            cluster.get("key");
        } catch (Exception e) {
            // JedisCluster 会自动处理 MOVED 重定向
            // 不需要手动处理
        }
    }
    
    public static void main(String[] args) {
        RedisClusterDemo demo = new RedisClusterDemo();
        demo.init();
        demo.testOperations();
    }
}
```

## Cluster vs Sentinel

| 特性 | Sentinel | Cluster |
|-----|----------|---------|
| **数据分片** | 不支持 | 支持（16384 槽） |
| **水平扩展** | 受主节点限制 | 可扩展到更多节点 |
| **写入能力** | 受主节点限制 | 分片后提升 |
| **架构** | 中心化（需要 Sentinel） | 去中心化（节点互联） |
| **复杂度** | 较低 | 较高 |
| **适用场景** | 小规模高可用 | 大规模存储和高并发 |

## Cluster 的限制

| 限制 | 说明 |
|-----|------|
| **不支持多 key 操作** | 跨槽的多 key 操作（如 MGET）可能失败 |
| **不支持多 key 事务** | 同上 |
| **不支持 Lua 脚本的多 key 操作** | 涉及多个槽的脚本会报错 |
| **不支持数据库切换** | 只支持 db0 |

### 多 key 操作的处理

```java
/**
 * Redis Cluster 不支持跨槽的多 key 操作
 * 
 * 错误示例：
 * cluster.mget("key1", "key2", "key3")
 * 如果这三个 key 不在同一个槽，会报错
 * 
 * 解决方案 1：使用 Hash
 * 将多个 key 合并为一个 Hash
 * cluster.hget("user:1001", "name")
 * 
 * 解决方案 2：使用 Tag
 * 保证相关的 key 在同一个槽
 * Redis 计算槽时，会取第一个 { } 内的内容作为 tag
 * "user:{1001}:name" 和 "user:{1001}:age" → tag = 1001 → 同一槽
 */
```

## 总结

Redis Cluster 是分布式存储的解决方案：

- **槽分片**：16384 个槽自动分配
- **去中心化**：节点间 Gossip 协议通信
- **高可用**：每个主节点可配置从节点
- **在线迁移**：支持槽在线迁移

## 留给你的问题

Redis Cluster 使用 Gossip 协议进行节点通信。

**问题：Gossip 协议是最终一致性的，节点间可能出现信息不一致。这种不一致会影响集群的正常工作吗？Redis Cluster 是如何处理的？**
