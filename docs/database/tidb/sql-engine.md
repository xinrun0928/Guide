# TiDB SQL 引擎：从 SQL 到 KV 的转换

当你执行一条 SQL，它在 TiDB 内部经历了什么？

很多人以为 TiDB 像 MySQL 一样简单——解析 SQL，执行计划，返回结果。但实际上，TiDB 的 SQL 处理要复杂得多，因为它要把 SQL 语句「翻译」成对分布式存储层的请求，然后协调多个节点返回最终结果。

**TiDB 的 SQL 引擎，是整个系统的「大脑」。**

## SQL 执行流程

TiDB Server 接收 SQL 后，需要经过以下步骤：

```java
// TiDB SQL 执行流程
public class TiDBSQLExecutor {
    public ResultSet execute(String sql) {
        // 1. 语法解析：文本 → AST
        AST ast = parser.parse(sql);

        // 2. 语义分析：解析表结构、类型检查、权限检查
        ResolveResult resolved = analyzer.resolve(ast);

        // 3. 逻辑优化：谓词下推、列裁剪、聚合下推
        LogicalPlan logicalPlan = optimizer.logicalOptimize(resolved);

        // 4. 物理优化：选择算法、实现算子、代价估算
        PhysicalPlan physicalPlan = optimizer.physicalOptimize(logicalPlan);

        // 5. 分布式执行：拆解计划，并行执行
        List&lt;Task&gt; tasks = executor.buildTasks(physicalPlan);
        List&lt;Result&gt; results = executor.executeParallel(tasks);

        // 6. 结果聚合：合并各节点结果
        return aggregator.merge(results);
    }
}
```

**重点在于第 5 步——分布式执行。** 这是 TiDB 和传统数据库最大的区别。

## SQL 到 KV 的映射

TiDB 将每张表映射为一段 Key 范围，每行数据编码为 Key-Value 对：

```java
// TiDB 的 Key 编码规则
public class TableKeyEncoder {
    // 表的 Key 结构：tablePrefix + tableId + _r + rowId
    // 即：t_{tableId}_r_{rowId}
    public byte[] encodeRowKey(long tableId, long rowId) {
        return Bytes.concat(
            TABLE_PREFIX,           // "t"
            encodeInt64(tableId),   // 表 ID
            ROW_PREFIX,              // "_r"
            encodeInt64(rowId)       // 行 ID
        );
    }

    // 索引的 Key 结构：tablePrefix + tableId + _i + indexId + indexedValue
    public byte[] encodeIndexKey(long tableId, long indexId, Object... indexValues) {
        return Bytes.concat(
            TABLE_PREFIX,
            encodeInt64(tableId),
            INDEX_PREFIX,           // "_i"
            encodeInt64(indexId),
            encodeValues(indexValues) // 索引列的值
        );
    }
}
```

为什么这样设计？

**因为 TiKV 只认 KV，不认表。** TiDB 把 SQL 转换为 KV 操作后，就可以利用 TiKV 的分布式能力并行查询。

## 分布式查询执行

假设有这样的 SQL：

```sql
SELECT name, SUM(amount)
FROM orders
WHERE status = 'completed'
GROUP BY name
HAVING SUM(amount) > 1000;
```

TiDB 的执行计划可能是这样的：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Aggregation                               │
│                    (在 TiDB Server 合并)                         │
└─────────────────────────────────────────────────────────────────┘
           ▲                     ▲                     ▲
    ┌──────┴──────┐       ┌──────┴──────┐       ┌──────┴──────┐
    │  Exchange   │       │  Exchange   │       │  Exchange   │
    │ (发送到A节点) │       │ (发送到B节点) │       │ (发送到C节点) │
    └─────────────┘       └─────────────┘       └─────────────┘
           ▲                     ▲                     ▲
    ┌──────┴──────┐       ┌──────┴──────┐       ┌──────┴──────┐
    │Selection(op)│       │Selection(op)│       │Selection(op)│
    │status='comp'│       │status='comp'│       │status='comp'│
    └─────────────┘       └─────────────┘       └─────────────┘
           ▲                     ▲                     ▲
    ┌──────┴──────┐       ┌──────┴──────┐       ┌──────┴──────┐
    │ TableScan   │       │ TableScan   │       │ TableScan   │
    │ (扫Region1) │       │ (扫Region2) │       │ (扫Region3) │
    └─────────────┘       └─────────────┘       └─────────────┘
           ▲                     ▲                     ▲
    ┌──────┴──────┐       ┌──────┴──────┐       ┌──────┴──────┐
    │   TiKV A    │       │   TiKV B    │       │   TiKV C    │
    │ (Region 1)  │       │ (Region 2)  │       │ (Region 3)  │
    └─────────────┘       └─────────────┘       └─────────────┘
```

**每个 Region 独立扫描、独立聚合，最后在 TiDB Server 端合并结果。** 这就是 TiDB 的并行查询能力。

## 算子下推：减少数据传输

TiDB 的一个核心优化是**算子下推**——把尽可能多的计算推到 TiKV 层执行，减少网络传输。

```java
// 算子下推的示例
public class PredicatePushdown {
    // 场景：SELECT * FROM orders WHERE amount > 1000

    // 下推前：TiKV 返回所有数据，TiDB Server 过滤
    // 下推后：TiKV 只返回满足条件的数据

    // TiDB 5.0+ 支持的谓词下推：
    // - =, <>, <, >, <=, >=, IN, BETWEEN, LIKE
    // - IS NULL, IS NOT NULL
    // - AND, OR, NOT

    // TiDB 支持的聚合下推：
    // - SUM, COUNT, AVG, MIN, MAX
    // - LIMIT, TOPN

    // TiDB 支持的索引下推（Index Condition Pushdown）：
    // - 先用索引过滤，再用主键回表
    public boolean canPushDown(IndexCondition condition) {
        // ICP：索引列上的条件在 TiKV 层就过滤
        // 减少回表次数
        return condition.getColumn().hasIndex()
            && condition.isSupportedByStorage();
    }
}
```

## 算子执行模型

TiDB 使用 **火山模型（Volcano Model）**：每个算子实现 `next()` 接口，逐行拉取数据。

```java
// 火山模型：算子逐行处理
public interface Executor {
    Row next();  // 返回下一行，没有更多行时返回 null
}

// TableScan 算子
public class TableScanExecutor implements Executor {
    private TiKVScanner scanner;

    public Row next() {
        // TiKV 返回的 kv pair 转成 Row
        KeyValue kv = scanner.next();
        if (kv == null) return null;
        return decodeRow(kv);
    }
}

// Selection 算子
public class SelectionExecutor implements Executor {
    private Executor child;
    private List&lt;Expression&gt; conditions;

    public Row next() {
        while (true) {
            Row row = child.next();
            if (row == null) return null;
            // 满足过滤条件才返回
            if (evaluate(conditions, row)) {
                return row;
            }
        }
    }
}

// Aggregation 算子
public class HashAggExecutor implements Executor {
    // 使用 Hash 表做聚合
    private Map&lt;GroupKey, Aggregator&gt; hashTable = new HashMap&lt;&gt;();

    public Row next() {
        // 先消费完所有子节点数据
        consumeAllInput();
        // 再逐个输出聚合结果
        return outputNext();
    }
}
```

**但 TiDB 5.0+ 引入了向量化执行和 MPP 模式，大幅提升了分析查询性能。** 这一点我们会在后续章节详细讲解。

## 事务执行

TiDB 的 SQL 引擎支持两种事务模式：

```java
// 乐观事务
public class OptimisticTransaction {
    public void execute() {
        begin();
        // 所有修改先缓存到内存
        buffer.add(mutations);
        // 提交时检查冲突
        try {
            commit();
        } catch (WriteConflictException e) {
            // 冲突了，重试
            retry();
        }
    }
}

// 悲观事务（TiDB 3.0+）
public class PessimisticTransaction {
    public void execute() {
        begin();
        // 读取时就加锁
        for (Mutation m : mutations) {
            // SELECT FOR UPDATE 自动加锁
            lockManager.lock(m.key(), txnId);
        }
        // 修改完成后释放锁
        commit();
    }
}
```

**悲观事务适合高并发写入场景**，因为乐观事务在高冲突场景下会频繁重试。

## 面试追问

**Q: TiDB 为什么能支持 JOIN？**

TiDB 支持多种 JOIN 算法：Hash Join、Merge Join、Index Look Up Join。TiDB 会根据数据量估算选择最优算法。大表 JOIN 会涉及跨 Region 的数据传输。

**Q: TiDB 的 SQL 引擎是单机的吗？**

是的，TiDB Server 是单机的，但它会生成分布式执行计划，协调多个 TiKV 节点并行执行。你可以通过增加 TiDB Server 节点来提高并发接入能力。

**Q: 什么情况下 TiDB 会退化成单机查询？**

当查询涉及跨 Region 的数据汇聚（如大表 JOIN、全局排序），或者执行计划不优时，TiDB 可能需要汇总大量数据到 TiDB Server 端处理，这时性能会下降。

---

## 总结

TiDB 的 SQL 引擎是连接用户和分布式存储的桥梁。它将 SQL 转换为 KV 操作，利用 TiKV 的分布式能力并行执行，并通过算子下推减少数据传输。

理解 SQL 引擎的执行流程，有助于你在写 SQL 时更好地利用 TiDB 的分布式特性——比如选择合适的分片键、合理使用索引、避免大表 JOIN。
