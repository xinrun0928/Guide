# 分片算法：数据如何分布的艺术

分库分表后，数据如何分布到不同的库/表中？

取模？范围？还是一致性哈希？

不同的分片算法，适用于不同的场景。

---

## 分片算法的核心问题

1. **数据分布均匀**：每台服务器存储的数据量差不多
2. **查询支持**：大部分查询能路由到单个分片
3. **扩容友好**：扩容时数据迁移量最小

---

## 算法一：取模算法（Mod）

### 原理

```sql
shard_key = user_id % 4

-- user_id = 1 → shard_1
-- user_id = 2 → shard_2
-- user_id = 3 → shard_3
-- user_id = 4 → shard_0
```

### Java 实现

```java
public class ModSharding {
    private final int shardingCount;

    public ModSharding(int shardingCount) {
        this.shardingCount = shardingCount;
    }

    public int sharding(long userId) {
        return (int) (userId % shardingCount);
    }

    public String getTableName(String tableName, long userId) {
        int shardingValue = sharding(userId);
        return tableName + "_" + shardingValue;
    }
}
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 实现简单 | 扩容困难 |
| 数据分布均匀 | 基数变化时需要迁移大量数据 |

### 扩容问题

```sql
-- 从 4 个分片扩到 8 个
-- 原来：user_id % 4
-- 现在：user_id % 8

-- user_id = 4：原来在 shard_0，现在在 shard_4（变化了！）
-- 几乎所有数据都需要迁移
```

---

## 算法二：范围算法（Range）

### 原理

```sql
-- 按 ID 范围分片
shard_key = user_id / 1000000

-- user_id = 1          → shard_0 (0-999999)
-- user_id = 1000000    → shard_1 (1000000-1999999)
-- user_id = 2000000    → shard_2 (2000000-2999999)
```

### Java 实现

```java
public class RangeSharding {
    private final long rangeSize;

    public RangeSharding(long rangeSize) {
        this.rangeSize = rangeSize;
    }

    public int sharding(long userId) {
        return (int) (userId / rangeSize);
    }
}
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 扩容方便，只需增加新分片 | 数据分布可能不均匀 |
| 范围查询性能好 | 热点数据可能集中在一个分片 |

---

## 算法三：一致性哈希（Consistent Hashing）

### 原理

将服务器节点和数据的哈希值映射到一个哈希环上，数据顺时针找最近的节点。

```
┌─────────────────────────────────────────────────────────────┐
│                      哈希环                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         Node C                               │
│                          △                                  │
│                         / \                                 │
│                        /   \                                │
│                       /     \                               │
│              Node A   /   顺时针  \   Node B               │
│               ▽       \     ↓      /      ▽               │
│                        \           /                        │
│                         \         /                         │
│                          \       /                          │
│                           \     /                           │
│                            \   /                            │
│                             ▽                               │
│                         Node D                              │
│                                                             │
│   数据 K 的路由：计算 hash(K)，顺时针找到最近的节点         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Java 实现

```java
public class ConsistentHashSharding {
    private final TreeMap&lt;Long, String&gt; nodes = new TreeMap&lt;&gt;();
    private final int virtualNodes;

    public ConsistentHashSharding(List&lt;String&gt; nodeList, int virtualNodes) {
        this.virtualNodes = virtualNodes;
        // 添加虚拟节点
        for (String node : nodeList) {
            addNode(node);
        }
    }

    public void addNode(String node) {
        for (int i = 0; i < virtualNodes; i++) {
            long hash = hash(node + ":" + i);
            nodes.put(hash, node);
        }
    }

    public void removeNode(String node) {
        for (int i = 0; i < virtualNodes; i++) {
            long hash = hash(node + ":" + i);
            nodes.remove(hash);
        }
    }

    public String route(String key) {
        long hash = hash(key);
        Map.Entry&lt;Long, String&gt; entry = nodes.ceilingEntry(hash);
        if (entry == null) {
            entry = nodes.firstEntry();  // 环的起点
        }
        return entry.getValue();
    }

    private long hash(String key) {
        // MurmurHash 等算法
        return Math.abs(key.hashCode());
    }
}
```

### 虚拟节点

虚拟节点解决数据分布不均匀的问题。

```java
// 没有虚拟节点（不均匀）：
// Node A、B、C 各占 1/3，但实际数据可能集中在某个区间

// 有虚拟节点（更均匀）：
// 每个物理节点有 100 个虚拟节点
// 虚拟节点均匀分布在环上，数据分布更均匀
```

### 优缺点

| 优点 | 缺点 |
|------|------|
| 扩容时只需迁移部分数据 | 实现复杂 |
| 数据分布相对均匀 | 查询时需要计算哈希 |

---

## 算法四：一致性哈希 + 虚拟桶

### 原理

结合一致性哈希和虚拟桶的优点。

```
┌─────────────────────────────────────────────────────────────┐
│                      虚拟桶                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  整个哈希空间被划分为 2^32 个桶                              │
│  每个物理节点负责一定范围的桶                                │
│                                                             │
│  ┌────────────────────────────────────────────┐             │
│  │  桶 0-1000  → Node A                       │             │
│  │  桶 1001-2000 → Node B                      │             │
│  │  桶 2001-3000 → Node C                      │             │
│  └────────────────────────────────────────────┘             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 算法对比

| 算法 | 数据均匀性 | 扩容代价 | 查询性能 | 实现复杂度 |
|------|------------|----------|----------|------------|
| 取模 | 均匀 | 高（需迁移） | 好 | 简单 |
| 范围 | 不均匀 | 低 | 好 | 简单 |
| 一致性哈希 | 较均匀 | 低（部分迁移） | 好 | 复杂 |

---

## 实际应用：ShardingSphere 的分片策略

ShardingSphere 是成熟的开源分库分表中间件。

### 内置分片策略

```yaml
spring:
  shardingsphere:
    rules:
      sharding:
        tables:
          orders:
            actual-data-nodes: ds_${0..1}.orders_${0..3}
            table-strategy:
              standard:
                sharding-column: user_id
                sharding-algorithm-name: orders_mod
            key-generate-strategy:
              column: order_id
              key-generator-name: snowflake
        sharding-algorithms:
          orders_mod:
            type: MOD
            props:
              sharding-count: 4
```

### 自定义分片策略

```java
public class MyShardingAlgorithm implements PreciseShardingAlgorithm&lt;Long&gt; {
    private int shardingCount;

    @Override
    public String doSharding(Collection&lt;String&gt; availableTargetNames,
                              PreciseShardingValue&lt;Long&gt; shardingValue) {
        long userId = shardingValue.getValue();
        int shardingIndex = (int) (userId % shardingCount);
        for (String targetName : availableTargetNames) {
            if (targetName.endsWith(String.valueOf(shardingIndex))) {
                return targetName;
            }
        }
        throw new IllegalArgumentException("No target found");
    }
}
```

---

## 面试追问方向

- 一致性哈希是如何解决数据倾斜问题的？
- 取模分片扩容时怎么办？
- 范围分片有什么优缺点？
- 分片键选择要注意什么？

> 一致性哈希的核心思想是构建一个哈希环，数据和节点都映射到环上，查询时顺时针找到最近的节点。扩容时，只需迁移相邻节点之间的数据，避免了取模分片的全量迁移问题。
