# TiKV Region：数据分片的艺术

你的数据库有 10 亿条数据，分布在 10 台服务器上。

问题是：**你怎么知道哪条数据在哪台服务器上？**

传统的分库分表，用固定规则（比如 user_id % 4）决定数据位置。简单，但问题来了——某个用户数据量暴增，4 号库撑不住了，想迁移数据？对不起，改代码。

TiKV 的答案是：**让数据自己告诉你它在哪。**

这就是 Region——TiKV 的核心数据单元。

## Region 是什么？

Region 是 TiKV 中数据分片的基本单位。每一个 Region 管理一段 Key 范围的数据，默认大小约 96MB。

```java
// Region 的核心概念
public class Region {
    // Region 管理的 Key 范围 [startKey, endKey)
    // 理解这个范围是理解 TiKV 的关键
    private byte[] startKey;  // 包含
    private byte[] endKey;    // 不包含（开区间）

    // 这个 Region 有几个副本？
    private List<Peer> peers;  // 通常 3 个副本，Raft Group

    // 谁是老大？
    private Peer leader;       // 处理读写请求

    // Region 当前的版本，用于检测分裂/合并
    private long regionEpoch;
}
```

为什么用 Key 范围而不是 Hash 分片？

**因为 Key 范围分片天然支持有序遍历。** 当你执行 `WHERE id BETWEEN 100 AND 200` 这样的范围查询时，TiKV 只需要访问相关的几个 Region，而不是所有节点。

## Region 的生命周期

### 分裂（Split）

当 Region 数据量增长超过阈值（默认 96MB）时，会自动分裂成两个更小的 Region：

```
分裂前：
┌─────────────────────────────────────────────────┐
│  Region: [0, 1000000)          数据量: 96MB     │
└─────────────────────────────────────────────────┘

                    ↓ 分裂

┌─────────────────────────┬─────────────────────────┐
│  Region: [0, 500000)    │  Region: [500000, 1000000) │
│  数据量: 48MB           │  数据量: 48MB           │
└─────────────────────────┴─────────────────────────┘
```

这个过程对应用完全透明。PD 感知到分裂后，会更新元信息，后续请求自动路由到新 Region。

```java
// 分裂过程的关键步骤
public class RegionSplit {
    // 1. Region 达到阈值（96MB 或 1M 条记录）
    public boolean shouldSplit(Region region) {
        return region.size() > 96 * 1024 * 1024
            || region.keys() > 1_000_000;
    }

    // 2. Leader 发起分裂请求
    // 3. Raft 日志复制到所有 Follower
    // 4. 分裂后生成两个新 Region，各自选举新 Leader
}
```

### 合并（Merge）

当 Region 数据量过小时（默认 20MB），相邻的 Region 会尝试合并。这是为了避免大量小 Region 导致的元信息膨胀。

```java
// 合并的条件
public class RegionMerge {
    // 两个相邻 Region 都足够小（< 20MB）
    // 且空闲时间超过一定阈值（默认 10 分钟）
    public boolean shouldMerge(Region left, Region right) {
        return left.size() < 20 * 1024 * 1024
            && right.size() < 20 * 1024 * 1024
            && left.idleTime() > 10 * 60 * 1000;
    }
}
```

合并和分裂，保证了每个 Region 的大小始终在合理范围内。

## Region 调度：数据的智能分布

PD 是 TiKV 的调度中心，它决定 Region 应该在哪些 TiKV 节点上。

调度目标：
1. **负载均衡**：每个节点的 Region 数量大致相等
2. **副本分布**：同一 Region 的副本在不同机架/机房
3. **热点分散**：热点 Region 的 Leader 会迁移到负载低的节点

```java
// PD 的调度决策
public class RegionScheduler {
    // 负载均衡：Region 数量差距超过阈值时迁移
    public boolean shouldBalance(Store storeA, Store storeB) {
        int diff = Math.abs(storeA.regionCount() - storeB.regionCount());
        return diff > 10;  // 差值超过 10 个 Region
    }

    // 副本隔离：同一 Region 的副本应在不同拓扑
    public boolean canPlacePeer(Peer peer, Store store, Region region) {
        // 不在同一机架
        // 不在同一个 AZ
        // 不与 Region 其他副本同节点
        return store.getRack() != peer.getRack()
            && store.getAz() != region.getAz();
    }
}
```

## Region 与查询路由

当你执行一条 SQL 时，TiDB Server 是怎么知道数据在哪的？

```
1. SQL: SELECT * FROM orders WHERE id = 12345

2. TiDB Server 计算 Key: table:orders:r:12345
   （TiDB 内部将表行编码为 Key）

3. TiDB Server 问 PD：这个 Key 在哪个 Region？

4. PD 返回：Region {startKey: [table:orders:r:0], endKey: [table:orders:r:50000)}

5. TiDB Server 直接向对应 Region 的 Leader 发送请求

6. Leader 返回数据给 TiDB Server
```

整个过程对应用透明。应用只知道它连接的是 MySQL 兼容的数据库。

## 热点 Region：性能杀手

热点 Region 是 TiKV 运维中最常见的问题。

想象一下：你的主键是自增 ID，所有新数据都写入 [max, +∞) 这个 Region。它的 Leader 节点 CPU 100%，其他节点却很空闲。

**这就是写入热点。**

解决方案：

```sql
-- 方案一：使用 AUTO_RANDOM 代替自增主键
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,  -- 随机分配 ID，打散热点
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2)
);

-- 方案二：显式指定 Shard Row ID Bit
CREATE TABLE orders (
    id BIGINT PRIMARY KEY SHARD_ROW_ID_BITS(4),  -- 分成 2^4=16 个 Region
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2)
);
```

```java
// AUTO_RANDOM 的工作原理
public class AutoRandomGenerator {
    // TiDB 6.0+ 的 AUTO_RANDOM
    // ID 结构：| 保留位 (5bit) | 时间部分 (40bit) | 随机部分 (18bit) |
    // 写入热点时，自动扩展随机部分
    public long nextId() {
        long reserved = extractReservedBits();
        long timePart = System.currentTimeMillis() << 18;
        long randomPart = ThreadLocalRandom.current().nextLong(1 << 18);
        return reserved | timePart | randomPart;
    }
}
```

## 面试追问

**Q: Region 分裂会不会影响业务？**

不会。Region 分裂是异步进行的，旧 Region 在分裂期间继续提供服务，分裂完成后自然切换。分裂过程对应用完全透明。

**Q: Region 数量上限是多少？**

默认情况下，一个 TiKV 节点建议不超过 15000 个 Region。如果 Region 数量过多，会导致心跳流量大、元信息膨胀。可以通过增加 TiKV 节点来分散 Region 数量。

**Q: 为什么不把 Region 做得更大？**

Region 越小，负载均衡越灵活。但 Region 太小会导致元信息膨胀（PD 需要管理更多 Region）。96MB 是一个经验值，平衡了灵活性和元信息开销。

---

## 总结

Region 是 TiKV 数据分片的核心抽象。它用 Key 范围描述数据位置，支持自动分裂和合并，通过 PD 调度实现负载均衡。

理解 Region，就理解了 TiKV 分布式存储的一半奥秘。
