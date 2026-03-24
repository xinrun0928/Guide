# TiDB 存储计算分离架构与 HTAP 能力

你可能听说过「存储计算分离」这个词。

在传统架构中，数据库的计算（CPU、内存）和存储（磁盘）往往绑定在同一台机器上。好处是数据访问快，坏处是——当存储不够时，你不能单独扩容存储；当计算不够时，你也不能单独扩容计算。

**这就像买电脑：CPU 和硬盘焊死在一起，想升级硬盘容量，就得换掉整个机器。**

而 TiDB 的设计，从一开始就走了一条不同的路。

## 存储计算分离：让扩展更自由

### 架构演进

```
传统架构：
┌─────────────────────┐
│   单机数据库          │
│  ┌─────┐  ┌─────┐  │
│  │计算 │  │存储 │  │
│  │CPU  │  │磁盘 │  │
│  └─────┘  └─────┘  │
└─────────────────────┘

TiDB 架构（存储计算分离）：
┌─────────────────┐    ┌─────────────────┐
│   TiDB Server   │    │     TiKV        │
│   （计算层）     │    │   （存储层）     │
│  ┌─────┐        │    │        ┌─────┐  │
│  │CPU  │        │◄──►│        │磁盘 │  │
│  │内存 │        │    │        │SSD  │  │
│  └─────┘        │    │        └─────┘  │
└─────────────────┘    └─────────────────┘
        │                      ▲
        │                      │
        ▼                      │
┌─────────────────┐            │
│       PD        │────────────┘
│   （调度层）     │
└─────────────────┘
```

### 计算层：TiDB Server

TiDB Server 专注于 SQL 处理：

- SQL 解析与编译
- 查询优化与执行
- 分布式查询协调

它不存储任何数据，只负责「动脑子」。

### 存储层：TiKV

TiKV 专注于数据持久化：

- RocksDB 底层存储
- Region 数据分片
- Raft 副本管理

它不处理 SQL，只负责「管数据」。

### 调度层：PD

PD 是连接计算层和存储层的「桥梁」：

- 维护数据分布拓扑
- 分配全局时间戳（TSO）
- 调度负载均衡

## HTAP：一份数据，两种处理方式

HTAP = **Hybrid Transactional/Analytical Processing**，混合事务分析处理。

这是 TiDB 最重要的能力之一：**一份数据，既能支持实时事务处理（OLTP），又能支持复杂分析查询（OLAP），无需 ETL 同步。**

### 传统方案 vs TiDB 方案

```
传统方案（数据仓库分离）：
┌─────────┐    ETL    ┌─────────┐
│  OLTP   │─────────►│  OLAP   │
│  MySQL  │  延迟数h  │ 数据仓库 │
└─────────┘          └─────────┘
         ▲ 数据延迟
         │ 分析结果不实时

TiDB 方案（HTAP）：
┌──────────────────────────────────┐
│           TiDB 集群               │
│  ┌─────────┐    ┌─────────────┐ │
│  │  TiKV   │───►│   TiFlash   │ │
│  │ 行存    │◄───│   列存      │ │
│  │ (OLTP)  │    │   (OLAP)    │ │
│  └─────────┘    └─────────────┘ │
└──────────────────────────────────┘
         ▲ 实时复制，延迟秒级
         ▲ 同一集群，无需 ETL
```

### TiFlash：列存的奥秘

TiFlash 是 TiDB 的 OLAP 引擎，它的核心技术来自 ClickHouse——目前最快的列式数据库之一。

列式存储的优势在哪里？

```java
// 行存 vs 列存的数据布局

// 行存：一行数据的所有列连续存储
// 适合点查：SELECT * FROM orders WHERE id = 12345
// 读取完整一行只需一次磁盘顺序读
Row[0]: [id=1,  name=Alice, amount=100, date=2024-01-01]
Row[1]: [id=2,  name=Bob,   amount=200, date=2024-01-02]

// 列存：同一列的所有数据连续存储
// 适合聚合：SELECT SUM(amount) FROM orders
// 只需读取 amount 列，跳过其他列
Column[id]:    [1, 2, 3, 4, 5, ...]
Column[name]:  [Alice, Bob, Carol, ...]
Column[amount]: [100, 200, 300, ...]  // 聚合查询只需这一列
Column[date]:  [2024-01-01, 2024-01-02, ...]
```

**列存的三大优势：**

1. **列压缩效率高**：同一列数据类型一致，压缩比可达 10:1
2. **向量执行快**：一次读取整列数据，CPU 缓存友好
3. **只读必要列**：分析查询往往只涉及部分列，减少 I/O

### 数据同步：Raft Learner 机制

你可能担心：TiFlash 和 TiKV 的数据如何保持一致？

答案是 **Raft Learner 异步复制**：

```java
// TiFlash 作为 Raft Learner 加入 Region
public class RaftLearner {
    // Learner 异步拉取 Leader 的日志
    // 不参与写入确认，不影响 OLTP 性能
    public void replicateFrom(Peer leader);
    
    // 只有确认日志已持久化后，才会应用到状态机
    public void applyLog(LogEntry entry);
}
```

关键点：**TiFlash 是只读的**。所有写入都走 TiKV，TiFlash 自动同步数据。这种设计保证了：

- OLTP 写入不受 OLAP 查询影响
- 分析查询可以放心使用最新数据
- 架构简单，无需复杂的数据同步机制

## 智能路由：自动选择最优引擎

TiDB 如何决定一条 SQL 应该走 TiKV 还是 TiFlash？

```java
// TiDB 优化器自动判断
public class SmartRouter {
    public ExecutionEngine selectEngine(PhysicalPlan plan) {
        // 点查、强事务要求 → TiKV
        if (plan.isPointQuery() || plan.requiresStrongConsistency()) {
            return ExecutionEngine.TiKV;
        }
        
        // 聚合分析、扫描大量行 → TiFlash
        if (plan.isAnalyticalQuery() && plan.estimatedRows() > 10000) {
            return ExecutionEngine.TiFlash;
        }
        
        // 默认：TiKV
        return ExecutionEngine.TiKV;
    }
}
```

实际使用中，你也可以手动指定：

```sql
-- 强制使用 TiFlash 执行
SELECT /*+ read_from_storage(tiflash[t]) */ SUM(amount)
FROM orders t
WHERE date >= '2024-01-01';

-- 强制使用 TiKV 执行
SELECT /*+ read_from_storage(tikv[t]) */ *
FROM orders t
WHERE id = 12345;
```

## HTAP 实战场景

| 场景 | 传统方案 | TiDB 方案 |
|-----|---------|----------|
| 实时大屏 | MySQL + 定时 ETL | TiDB 直接查询，延迟秒级 |
| 报表分析 | 夜间批处理 | 实时查询，不等待 |
| 风控决策 | 异步计算 + 缓存 | 实时计算，数据最新 |
| 历史数据归档 | 定期迁移到数据仓库 | TiFlash 长期存储，直接分析 |

## 面试追问

**Q: HTAP 的挑战是什么？**

HTAP 的核心挑战是 **资源隔离**。OLAP 查询往往是大扫描、高 CPU，如果和 OLTP 混在一起，可能影响在线业务。TiFlash 通过独立的存储节点和计算资源来解决这个问题。

**Q: TiFlash 和 TiKV 的数据一致性如何保证？**

TiFlash 使用 Raft Learner 异步复制，数据是**最终一致**的。对于强一致性要求的 OLTP 场景，使用 TiKV；对于分析场景，秒级延迟完全可以接受。

**Q: 为什么选择 ClickHouse 而不是其他列式引擎？**

ClickHouse 在单表聚合查询上性能领先，而且 PingCAP 和 ClickHouse 社区有深入合作。TiFlash 在 ClickHouse 基础上做了大量优化，如向量化执行、谓词下推等。

---

## 总结

TiDB 的存储计算分离架构，本质上是把「记性」和「脑子」分开。当「脑子」不够用时，加几个 TiDB Server；当「记性」不够时，加几个 TiKV 节点。

而 HTAP 能力，让你在同一份数据上既能快速记账（OLTP），又能深度分析（OLAP）。不需要等夜间 ETL，不需要维护两套系统。

这就是现代分布式数据库该有的样子。
