# MPP 模式：TiDB 的并行查询奥秘

你的数据分析 SQL 跑了 10 分钟，怨声载道。

同样的 SQL，在 TiDB 上只需要 30 秒。

为什么？因为 TiDB 5.0+ 引入了 **MPP（Massively Parallel Processing，大规模并行处理）模式**——让多个 TiFlash 节点像计算集群一样协同工作。

## 为什么需要 MPP？

传统 TiDB 查询的执行模式是这样的：

```
┌─────────────────────────────────────────────────┐
│                   TiDB Server                   │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │         聚合结果（单线程）                 │   │
│  └─────────────────────────────────────────┘   │
│                      ▲                         │
│          ┌───────────┴───────────┐              │
│          ▼                       ▼              │
│    ┌──────────┐            ┌──────────┐         │
│    │ TiKV 1   │            │ TiKV 2   │  ...   │
│    │ 扫描数据  │            │ 扫描数据  │         │
│    └──────────┘            └──────────┘         │
└─────────────────────────────────────────────────┘
```

TiDB Server 是单节点的，所有的聚合、JOIN 等操作都要在 TiDB Server 端完成。**这就是瓶颈。**

当数据量很大时，TiDB Server 的 CPU 和内存会成为限制因素。

MPP 模式的思路是：**把计算也分布式化。**

```
┌─────────────────────────────────────────────────────────────────┐
│                     TiFlash MPP Cluster                          │
│                                                                 │
│     ┌─────────┐      ┌─────────┐      ┌─────────┐                │
│     │Exchange │ ───► │Exchange │ ───► │Exchange │                │
│     │(数据重分布)│      │(数据重分布)│      │(数据重分布)│                │
│     └────┬────┘      └────┬────┘      └────┬────┘                │
│          ▼               ▼               ▼                     │
│    ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│    │Operator 1│    │Operator 1│    │Operator 1│                 │
│    │(本地聚合) │    │(本地聚合) │    │(本地聚合) │                 │
│    └────┬────┘    └────┬────┘    └────┬────┘                 │
│          ▼               ▼               ▼                     │
│    ┌──────────┐    ┌──────────┐    ┌──────────┐                 │
│    │ TiFlash1 │    │ TiFlash2 │    │ TiFlash3 │                 │
│    │  (节点1) │    │  (节点2) │    │  (节点3) │                 │
│    └──────────┘    └──────────┘    └──────────┘                 │
└─────────────────────────────────────────────────────────────────┘
```

**每个 TiFlash 节点独立计算，最后交换数据再聚合。** 这就是 MPP 的核心思想。

## MPP 的执行流程

```java
// MPP 查询执行流程
public class MPPExecutor {
    public void executeQuery(String sql) {
        // 1. TiDB Server 生成 MPP 执行计划
        MPPPlan plan = optimizer.createMPPPlan(sql);

        // 2. 计划被分成多个 Fragment（计算片段）
        List&lt;Fragment&gt; fragments = plan.getFragments();
        // Fragment 1: TiFlash1 扫描 + 本地聚合
        // Fragment 2: TiFlash2 扫描 + 本地聚合
        // Fragment 3: Exchange（数据重分布）
        // Fragment 4: TiFlash1/2/3 最终聚合

        // 3. TiFlash 节点并行执行各自的 Fragment
        Map&lt;Integer, Future&lt;Result&gt;&gt; futures = new HashMap&lt;&gt;();
        for (Fragment f : fragments) {
            futures.put(f.getId(), executor.submit(f));
        }

        // 4. Exchange 算子负责数据重分布
        // 5. 等待所有 Fragment 完成
        List&lt;Result&gt; results = waitForResults(futures);

        // 6. TiDB Server 接收最终结果
        return collectResults(results);
    }
}
```

## Exchange 算子：数据重分布

MPP 的关键在于 **Exchange 算子**——它负责在节点之间传输数据。

```java
// Exchange 的几种类型
public class ExchangeOperator {
    // 1. Broadcast Exchange：把小表广播到所有节点
    // 适合小表 JOIN 大表
    public void broadcast(Table smallTable) {
        for (Node node : allNodes) {
            sendToNode(node, smallTable);
        }
    }

    // 2. Hash Exchange：根据 Key 重新分区
    // 适合 JOIN 和聚合
    public void hashPartition(Object key, List&lt;Row&gt; rows) {
        Map&lt;int, List&lt;Row&gt;&gt; buckets = new HashMap&lt;&gt;();
        for (Row row : rows) {
            int bucket = hash(row.get(key)) % nodeCount;
            buckets.computeIfAbsent(bucket, k -> new ArrayList&lt;&gt;()).add(row);
        }
        // 发送到对应节点
        for (Map.Entry&lt;int, List&lt;Row&gt;&gt; e : buckets.entrySet()) {
            sendToNode(e.getKey(), e.getValue());
        }
    }

    // 3. Single Partition Exchange：汇聚到单节点
    // 适合 LIMIT、ORDER BY
    public void gatherToSingleNode(List&lt;Row&gt; rows) {
        // 所有数据发送到同一个节点
        sendToNode(coordinatorNode, rows);
    }
}
```

**为什么需要 Exchange？**

因为 JOIN 和聚合要求相同 Key 的数据在同一节点。例如 A JOIN B，如果 A 和 B 都按 `user_id` 分区，那么相同 `user_id` 的数据可能分布在不同节点，需要重新 shuffle。

## MPP 适用场景

MPP 模式最适合 **大表关联和聚合分析**：

```sql
-- 开启 MPP 模式
SET SESSION tidb_enforce_mpp = on;

-- 大表 JOIN（自动使用 MPP）
SELECT a.user_id, SUM(b.amount) as total
FROM users a
JOIN orders b ON a.user_id = b.user_id
WHERE b.created_at >= '2024-01-01'
GROUP BY a.user_id;

-- 复杂聚合（自动使用 MPP）
SELECT
    DATE(created_at) as date,
    product_id,
    COUNT(*) as order_count,
    SUM(amount) as total_amount
FROM orders
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(created_at), product_id;
```

### MPP vs 非 MPP

| 场景 | 非 MPP（TiKV） | MPP（TiFlash） |
|-----|---------------|----------------|
| 数据量 | 中小规模 | 大规模 |
| 查询类型 | 点查、范围查 | 聚合、JOIN |
| 并发能力 | TiDB Server 单机 | TiFlash 多机并行 |
| 延迟 | 较低 | 较高但可接受 |
| 资源消耗 | TiDB Server | TiFlash 节点群 |

**注意：MPP 不适合 OLTP 场景**，因为 Exchange 的数据 shuffle 有额外开销。

## MPP 的代价

MPP 不是银弹，它有自己的代价：

### 1. 数据传输开销

```java
// 数据 shuffle 的网络开销
public class NetworkCost {
    // 假设 3 个 TiFlash 节点，每个 1 亿条数据
    // 做 JOIN 时，数据可能需要 shuffle

    // 最好的情况：数据已经按 JOIN Key 分区
    // 网络开销 = 0

    // 最坏的情况：需要大量数据重分布
    // 网络开销 = O(n * shuffle_factor)
    // shuffle_factor 通常是 2~3 倍
}
```

### 2. 故障影响范围扩大

传统模式下，一个 TiKV 节点挂了，影响的是部分 Region。
MPP 模式下，一个 TiFlash 节点挂了，可能导致整个查询失败。

### 3. 资源竞争

多个 MPP 查询同时运行时，会竞争 TiFlash 资源。TiDB 5.0+ 引入了资源组（Resource Control）来隔离不同查询的资源使用。

## 面试追问

**Q: MPP 和 Spark 的区别是什么？**

两者都是分布式计算框架，但定位不同：
- **Spark**：通用计算引擎，需要自己管理数据源
- **MPP**：专用分析引擎，数据已经存在 TiFlash 中，执行计划由 TiDB 优化器生成

简单说：MPP 是数据库内置的「类 Spark」能力，不需要额外部署和维护。

**Q: 什么时候应该禁用 MPP？**

- 小表查询（TiFlash 启动开销反而更大）
- 对延迟敏感的 OLTP 查询
- 需要强一致性的事务查询

**Q: TiFlash 节点数量对 MPP 性能的影响？**

理论上，节点越多并行度越高。但实际受限于：
- 数据 shuffle 的网络开销
- 调度开销
- 节点间协调成本

通常 3~5 个 TiFlash 节点是性价比不错的选择。

---

## 总结

MPP 是 TiDB HTAP 能力的核心技术之一。它让 TiFlash 集群可以像计算集群一样并行处理复杂分析查询，大幅提升聚合和 JOIN 性能。

理解 MPP 的工作原理，有助于你在写分析 SQL 时更好地利用 TiFlash 的能力——选择合适的分析场景，避免不必要的 MPP 开销。
