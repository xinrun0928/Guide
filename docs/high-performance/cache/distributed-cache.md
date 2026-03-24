# 分布式缓存：Redis Cluster vs Memcache

凌晨 3 点，你的系统突然报警：Redis 集群故障，部分请求超时。

运维群里炸了锅：「Redis 挂了！」「切到 Memcache！」「不行，Memcache 没有 xxx 功能！」

这样的场景，你经历过吗？

分布式缓存的选择，从来不只是「用 Redis 还是 Memcache」这么简单。它关乎**数据一致性、集群可用性、开发效率**等多个维度。

---

## 为什么需要分布式缓存？

在说选型之前，我们先理解一个问题：**本地缓存已经很好了，为什么还需要分布式缓存？**

本地缓存的问题：
- **进程隔离**：每台机器的缓存独立，数据不一致
- **无法共享**：用户 Session 在 A 机器登录，换到 B 机器就丢失了
- **扩容失效**：新增机器时，本地缓存全部为空，瞬间打到数据库

分布式缓存的价值：
- **跨进程共享**：所有机器访问同一份数据
- **容量可扩展**：不够就加机器
- **高可用保障**：部分节点故障，不影响整体服务

---

## Redis vs Memcache：核心对比

| 维度 | Redis | Memcache |
|------|-------|----------|
| **数据类型** | 9 种（String、Hash、List、Set、ZSet、Geo、HyperLogLog、Stream、Bitmap） | 仅 String |
| **持久化** | 支持 RDB、AOF、混合持久化 | 不支持，纯内存 |
| **集群方案** | Redis Cluster、哨兵模式、主从复制 | 一致性哈希客户端分片 |
| **复制** | 支持主从复制，读写分离 | 不支持复制 |
| **事务** | 支持有限事务（MULTI/EXEC） | 不支持 |
| **Lua 脚本** | 支持，可保证原子性 | 不支持 |
| **过期策略** | 定期删除 + 惰性删除 | 惰性删除 |
| **淘汰策略** | 8 种（LRU/LFU/Random/TTL 等） | LRU |
| **内存效率** | 较高（但有内存碎片） | 极高（简单结构） |
| **单值大小** | 最大 512MB | 最大 1MB |
| **QPS（单实例）** | 约 10-15 万 | 约 20-30 万 |
| **延迟稳定性** | 受持久化影响，可能出现尖刺 | 更稳定 |
| **运维复杂度** | 较高 | 较低 |

---

## 深入对比：四大关键维度

### 1. 数据类型：Redis 的绝对优势

Memcache 只支持 String，而 Redis 支持 9 种数据类型。这意味着：

**Memcache 场景**：

```java
// 只能存 String，序列化反序列化开销大
Object cached = memcache.get("user:1001");
User user = (User) cached;  // 需要手动强转，不安全

memcache.set("user:1001", user, 3600);  // 存的是序列化后的字节数组
```

**Redis 场景**：

```java
// 直接存储复杂数据结构
// Hash：用户信息
redis.hset("user:1001", "name", "张三");
redis.hset("user:1001", "age", "25");
String name = redis.hget("user:1001", "name");

// ZSet：排行榜
redis.zadd("ranking:2024", 1000, "user:1001");
redis.zadd("ranking:2024", 2000, "user:1002");
List&lt;String&gt; top3 = redis.zrevrange("ranking:2024", 0, 2);  // 前 3 名

// Set：标签、兴趣
redis.sadd("user:1001:tags", "java", "redis", "分布式");
boolean hasTag = redis.sismember("user:1001:tags", "java");

// List：最新消息、Timeline
redis.lpush("user:1001:messages", "消息1", "消息2", "消息3");
List&lt;String&gt; recent = redis.lrange("user:1001:messages", 0, 9);
```

**结论**：如果你的业务需要复杂数据结构，Redis 是唯一选择。Memcache 只适合存储「纯粹的值」，比如：
- 页面级缓存（整个 HTML）
- 序列化后的对象
- 简单的计数器

### 2. 持久化：数据安全的关键

Memcache **不支持持久化**，重启即丢失。这在某些场景下是致命的：

```java
// Memcache：服务器重启，数据全丢
// 适用：完全把缓存当临时存储，重启后可接受数据丢失

// Redis：支持两种持久化方式
// 1. RDB：定时快照，文件小，恢复快，但可能丢数据
// 2. AOF：追加写日志，每条命令都记录，数据更安全
// 3. 混合持久化：RDB + AOF，推荐使用
```

**Redis 持久化配置**（推荐：混合持久化）：

```java
# redis.conf
# 混合持久化
aof-use-rdb-preamble yes

# AOF 刷盘策略
appendfsync everysec  # 每秒刷盘，最多丢 1 秒数据

# RDB 触发条件
save 900 1      # 900 秒内至少 1 个 key 变化
save 300 10     # 300 秒内至少 10 个 key 变化
save 60 10000   # 60 秒内至少 10000 个 key 变化
```

**适用场景**：
- 需要数据安全的场景（订单、用户信息）：选 **Redis**
- 纯缓存场景，重启可接受数据丢失：可以用 **Memcache**

### 3. 集群方案：高可用的保障

**Memcache 集群**：

Memcache 没有官方的集群方案，通常采用**一致性哈希客户端分片**：

```
客户端（一致性哈希）          Memcache 节点
        │                        │
   ┌────┴────┬────────┬───────────┴────┐
   ▼         ▼        ▼                ▼
 Node1    Node2     Node3            Node4
```

```java
// XMemcache 客户端的 ConsistentHashImplementor
// 特点：
// - 客户端实现分片逻辑
// - 每个节点独立，没有数据同步
// - 扩容时数据迁移量小
// - 但无法做读写分离
```

**Redis 集群**：

Redis 提供多种集群方案：

**方案 1：主从复制 + 哨兵**

```
         哨兵（监控 + 故障转移）
              │
    ┌─────────┼─────────┐
    │         │         │
  Master   Slave1    Slave2
    
读：可以从 Slave 读（读写分离）
写：只能写 Master
```

**方案 2：Redis Cluster**

```
         Redis Cluster (16384 槽)
              │
    ┌─────────┼─────────┐
    │         │         │
  Master1   Master2   Master3
    │         │         │
  Slave1    Slave2    Slave3
    (每个 Master 可选配从节点)
    
- 数据自动分片（按槽）
- 每个节点独立
- 部分节点故障不影响其他节点
```

**结论**：
- 需要**读写分离**：选 **Redis 哨兵/集群**
- 只需要简单分片：可以用 **Memcache 一致性哈希**
- 需要**数据安全**：选 **Redis**

### 4. 性能：谁更快？

这是很多人最关心的问题。

**理论性能**：

| 操作 | Redis (单实例) | Memcache (单实例) |
|------|--------------|-------------------|
| GET/SET | 10-15 万 QPS | 20-30 万 QPS |
| 延迟 (P50) | 0.2-0.5ms | 0.1-0.3ms |

Memcache 在**纯 String 场景**下性能更高，因为：
- 内部结构更简单
- 没有持久化开销
- 没有复杂数据类型处理

**但实际场景**：

```java
// 场景 1：简单的 String 缓存
// Memcache 可能更快（内存占用也更低）

// 场景 2：需要复杂数据类型
// Redis 更快（一次网络往返完成多次操作）

// 场景 3：高并发 + 需要持久化
// Redis 性能可能下降（需要权衡）

// 场景 4：追求稳定性（延迟尖刺）
// Memcache 更稳定（没有后台持久化线程干扰）
```

---

## 选型决策树

```
需要复杂数据结构？
    │
    ├── 否 → Memcache 可以考虑
    │         │
    │         └── 需要持久化或高可用？
    │               ├── 否 → Memcache OK
    │               └── 是 → Redis
    │
    └── 是 → Redis（唯一选择）
              │
              ├── 数据量小，需要原子操作？
              │     └── 是 → Redis 单实例
              │
              ├── 需要集群 + 读写分离？
              │     ├── 是 → Redis Cluster / 哨兵
              │     └── 否 → Redis 主从
              │
              └── 需要 Lua 脚本保证原子性？
                    └── 是 → Redis
```

---

## 实战：双写方案

很多公司采用「Redis + Memcache」双写方案，各取所长：

```java
public class DualCacheService {
    
    // 写操作：同时写入两个缓存
    public void set(String key, Object value, int ttlSeconds) {
        // 1. 先写 Redis（主缓存，支持复杂结构）
        redis.setex(key, ttlSeconds, value);
        
        // 2. 再写 Memcache（备缓存，简单加速）
        try {
            // 复杂对象序列化为 String
            String serialized = serialize(value);
            memcacheClient.set(key, serialized, ttlSeconds);
        } catch (Exception e) {
            // Memcache 写入失败不影响主流程
            log.warn("Memcache set failed for key: {}", key, e);
        }
    }
    
    // 读操作：先读 Redis，失败再读 Memcache
    public Object get(String key) {
        // 1. 先读 Redis
        Object value = redis.get(key);
        if (value != null) {
            return value;
        }
        
        // 2. Redis 未命中，读 Memcache
        try {
            String cached = memcacheClient.get(key);
            if (cached != null) {
                // 反序列化并回填 Redis
                value = deserialize(cached);
                redis.setex(key, 3600, value);
                return value;
            }
        } catch (Exception e) {
            log.warn("Memcache get failed for key: {}", key, e);
        }
        
        return null;
    }
}
```

### 双写方案的优势

1. **性能互补**：Memcache 简单场景更快
2. **容灾备份**：Redis 挂了还有 Memcache 撑着
3. **隔离热数据**：热点数据放 Memcache，减少 Redis 压力

### 双写方案的风险

1. **数据一致性**：两套缓存需要同步失效
2. **运维复杂度**：两套系统需要同时维护
3. **成本增加**：内存占用翻倍

---

## 总结

**选 Memcache 的场景**：
- 纯 String 缓存，不需要复杂数据类型
- 追求极致性能，内存效率优先
- 纯缓存场景，可以接受数据丢失
- 简单 Session 存储

**选 Redis 的场景**：
- 需要复杂数据结构（Hash、ZSet、List 等）
- 需要持久化或高可用
- 需要 Lua 脚本保证原子性
- 需要集群、读写分离
- 需要缓存中间件的高级特性（发布订阅、Stream 等）

**选双写方案的场景**：
- 对性能有极高要求，同时需要 Redis 的功能
- 关键业务需要双保险
- 团队有能力维护两套缓存

---

## 留给你的问题

假设这样一个场景：你的电商系统需要实现一个**分布式锁**，用于控制库存扣减。

基于 Redis 实现分布式锁，业界有一个经典的「Redlock 算法」。

你知道 Redlock 的核心思想是什么吗？它解决了什么问题，又有什么争议？

提示：Redlock 试图解决「单机 Redis + 从库切换」时的锁丢失问题。
