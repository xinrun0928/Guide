# 查询优化器：TiDB 的智能执行计划

为什么同样一条 SQL，别人的查询只要 100 毫秒，你的要 10 秒？

大概率是**执行计划不同**。

MySQL 的优化器相对简单，基本靠规则和简单统计信息。TiDB 的优化器要复杂得多——它要在一个分布式环境中，决定数据从哪个节点取、怎么取、取多少。

**好的执行计划，是 TiDB 高性能的关键。**

## TiDB 优化器架构

TiDB 的查询优化分为两个阶段：

```java
// TiDB 优化器两阶段架构
public class TiDBOptimizer {
    // 阶段 1：逻辑优化（规则优化）
    public LogicalPlan logicalOptimize(AST ast) {
        LogicalPlan plan = buildInitPlan(ast);

        // 谓词下推：把过滤条件尽可能推到 TiKV 层
        plan = predicatePushdown(plan);

        // 列裁剪：只读取需要的列
        plan = columnPruning(plan);

        // 聚合下推：先在 TiKV 层聚合
        plan = aggregatePushdown(plan);

        // JOIN 重排：根据数据量选择最优顺序
        plan = joinReorder(plan);

        return plan;
    }

    // 阶段 2：物理优化（代价优化）
    public PhysicalPlan physicalOptimize(LogicalPlan logical) {
        // 枚举可能的物理计划
        List&lt;PhysicalPlan&gt; candidates = enumeratePhysicalPlans(logical);

        // 估算每个计划的代价
        for (PhysicalPlan p : candidates) {
            p.cost = estimateCost(p);
        }

        // 选择代价最低的计划
        return candidates.stream()
            .min(Comparator.comparing(p -> p.cost))
            .orElseThrow();
    }
}
```

## 统计信息：优化的基础

**优化器的决策依赖统计信息**——表的行数、列的基数、索引的选择性。

```java
// TiDB 的统计信息
public class TableStatistics {
    // 行数
    long rowCount;

    // 列统计
    Map&lt;String, ColumnStatistics&gt; columns;

    // 索引统计
    Map&lt;String, IndexStatistics&gt; indexes;
}

public class ColumnStatistics {
    // 列基数（有多少不同值）
    long ndv;  // Number of Distinct Values

    // 直方图：值的分布
    Histogram histogram;

    // NULL 值比例
    double nullCountRatio;

    // 频率统计：高频值
    List&lt;TopN&gt; topN;
}
```

TiDB 会定期自动收集统计信息（Auto Analyze），也可以手动触发：

```sql
-- 手动收集统计信息
ANALYZE TABLE orders;

-- 收集某个列的统计信息
ANALYZE TABLE orders UPDATE HISTOGRAM ON user_id, status;

-- 查看统计信息
SHOW STATS_META WHERE table_name = 'orders';
SHOW STATS_HISTOGRAM WHERE table_name = 'orders' AND column_name = 'status';
```

## 代价模型

优化器选择执行计划的依据是**代价估算**。

```java
// TiDB 代价模型
public class CostModel {
    // 代价因素
    public CostEstimate estimate(PhysicalPlan plan) {
        double cost = 0;

        // 1. CPU 代价：计算密集型操作
        cost += plan.getCPUCost();

        // 2. 网络代价：跨节点数据传输
        // TiKV → TiDB Server 的数据量
        cost += plan.getNetworkCost() * NETWORK_COST_FACTOR;

        // 3. 磁盘 I/O 代价：RocksDB 读取
        cost += plan.getDiskIOCost() * DISK_IO_COST_FACTOR;

        // 4. 内存代价：Hash Join、Sort 等操作的内存使用
        cost += plan.getMemoryCost() * MEMORY_COST_FACTOR;

        return new CostEstimate(cost);
    }
}
```

**TiDB 会估算每种物理算子的代价，选择总代价最低的执行计划。**

## 常见优化规则

### 谓词下推

把过滤条件尽可能推到靠近数据源的位置执行：

```sql
-- 原始 SQL
SELECT * FROM orders WHERE amount > 1000;

-- 优化后的执行计划
TableScan → Selection(amount > 1000)
    ↓
TableScan(amount > 1000)  -- 谓词下推到 TiKV 层
```

```java
// 谓词下推示例
public class PredicatePushdown {
    // 可以下推的谓词
    public boolean canPushDown(Expression pred) {
        return pred instanceof ComparisonExpr    // =, <>, <, >, <=, >=
            || pred instanceof InExpr          // IN
            || pred instanceof LikeExpr         // LIKE
            || pred instanceof IsNullExpr;       // IS NULL
    }

    // 不能下推的谓词
    // - 包含子查询
    // - 包含聚合函数
    // - 依赖 TiDB Server 端函数
}
```

### 索引选择

优化器会评估每个可用索引，选择代价最低的：

```java
// 索引选择
public class IndexSelector {
    public Index chooseBestIndex(Table table, List&lt;Expression&gt; conditions) {
        List&lt;CandidateIndex&gt; candidates = new ArrayList&lt;&gt;();

        for (Index idx : table.getIndexes()) {
            // 评估索引覆盖度
            double coverage = evaluateCoverage(idx, conditions);

            // 评估索引选择性
            double selectivity = statistics.getSelectivity(idx, conditions);

            // 估算回表代价
            double backtraceCost = estimateBacktraceCost(idx, conditions);

            candidates.add(new CandidateIndex(idx, coverage, selectivity, backtraceCost));
        }

        // 选择综合代价最低的索引
        return candidates.stream()
            .min(Comparator.comparing(CandidateIndex::getTotalCost))
            .get()
            .getIndex();
    }
}
```

### JOIN 类型选择

```java
// JOIN 类型选择
public class JoinTypeSelector {
    // TiDB 支持的 JOIN 类型

    // 1. Hash Join：适用于大表 JOIN
    // 代价 = 小表构建 Hash 表 + 大表探查
    public boolean useHashJoin(Table small, Table large) {
        return small.rowCount() * MEMORY_FIT_IN_HASH
            && large.rowCount() < HEURISTIC_LIMIT;
    }

    // 2. Merge Join：适用于已排序的数据
    // 代价 = 两个表各扫描一次
    public boolean useMergeJoin(Table a, Table b, JoinCondition cond) {
        return cond.getEquiCondition() != null
            && a.isSorted(cond.getJoinKey())
            && b.isSorted(cond.getJoinKey());
    }

    // 3. Index Look Up Join：适用于有索引的小表 JOIN 大表
    public boolean useIndexLookUpJoin(Table small, Table large, Index idx) {
        return small.rowCount() < INDEX_LOOKUP_THRESHOLD
            && large.hasIndex(idx);
    }
}
```

## 执行计划分析

学会看执行计划，是调优 TiDB SQL 的基础：

```sql
EXPLAIN ANALYZE SELECT *
FROM orders o
JOIN users u ON o.user_id = u.id
WHERE o.status = 'completed'
  AND o.amount > 1000;
```

```sql
+-------------------------------+-------------+---------+-----------+---------------+...
| id                            | estRows     | actRows | task      | access object|...
+-------------------------------+-------------+---------+-----------+---------------+...
| HashJoin_11                   | 98234.00    | 97654   | root      |               |
| ├─TableReader_25              | 1245678.00  | 1234567 | root      |               |
| │ └─TableScan_24             | 1245678.00  | 1234567 | cop[tikv] | table:users  |
| └─TableReader_21             | 876543.00   | 865432  | root      |               |
│   └─Selection_20             | 876543.00   | 865432  | cop[tikv] |               |
│     └─TableScan_22           | 987654.00   | 987654  | cop[tikv] | table:orders |
+-------------------------------+-------------+---------+-----------+---------------+...
```

关键列说明：

| 列名 | 含义 |
|-----|------|
| id | 算子标识 |
| estRows | 估算行数 |
| actRows | 实际行数 |
| task | 执行任务类型（root= TiDB Server, cop= TiKV） |
| access object | 访问对象（表、索引） |

**注意：如果 estRows 和 actRows 差距很大，说明统计信息不准确，需要重新 Analyze。**

## 常见问题与解决

| 问题 | 原因 | 解决 |
|-----|------|------|
| 全表扫描 | 统计信息过期、索引选择错误 | ANALYZE TABLE |
| 错误使用索引 | 索引列有函数、类型转换 | 修改 SQL |
| Hash Join 内存溢出 | 小表太大 | 增大 `tidb_mem_quota_query` |
| 子查询展开慢 | 子查询包含聚合 | 改写 SQL |

## 面试追问

**Q: TiDB 优化器和 MySQL 优化器有什么区别？**

最大的区别是**分布式执行**。MySQL 优化器只需要考虑单机执行，TiDB 需要考虑数据分布、跨节点传输、算子下推等因素，复杂度高得多。

**Q: 如何判断优化器选错了执行计划？**

看 `EXPLAIN ANALYZE` 的 `estRows` vs `actRows`。如果差距大，首先更新统计信息；其次检查 SQL 是否导致索引失效；最后考虑 Hint 干预。

**Q: TiDB 支持 Hint 干预执行计划吗？**

支持。例如 `/*+ USE_INDEX(t orders, idx_status) */` 强制使用某个索引，`/*+ HASH_JOIN(t1, t2) */` 强制使用 Hash Join。

---

## 总结

TiDB 的查询优化器是一个复杂的代价模型系统。它基于统计信息评估各种执行计划的代价，选择最优方案。

理解优化器的工作原理，学会分析执行计划，是 TiDB 调优的核心技能。
