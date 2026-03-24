# TiFlash：列式存储的实时分析引擎

你的报表查询跑了 30 分钟，老板在等。

同样的数据，你切到 TiFlash，30 秒搞定。

这就是列式存储的魅力。

TiFlash 是 TiDB 的 HTAP 能力的关键——它让 TiDB 在同一集群中同时支持 OLTP（行存）和 OLAP（列存），无需 ETL，无需数据同步。

## TiFlash 是什么？

TiFlash 是一个**列式存储引擎**，专为分析场景设计。

```
┌─────────────────────────────────────────────────────────┐
│                       TiDB 集群                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  TiKV（行存）                    │   │
│  │  - OLTP 主力存储                                │   │
│  │  - 强一致性事务                                 │   │
│  │  - 主键查询、点查                               │   │
│  └─────────────────────────────────────────────────┘   │
│                         ▲                              │
│           Raft Learner │ 异步复制                      │
│                         │                              │
│  ┌─────────────────────────────────────────────────┐   │
│  │                TiFlash（列存）                   │   │
│  │  - OLAP 分析存储                                 │   │
│  │  - 最终一致性                                    │   │
│  │  - 聚合查询、全表扫描                           │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**关键设计：TiFlash 通过 Raft Learner 异步复制 TiKV 的数据**，OLTP 写入不受 OLAP 查询影响。

## 列式存储的奥秘

### 行存 vs 列存

```java
// 行存：一行数据的所有列连续存储
// Row[0]: [id=1, name=Alice, amount=100, date=2024-01-01]
// Row[1]: [id=2, name=Bob, amount=200, date=2024-01-02]
// 适合点查：SELECT * FROM orders WHERE id = 12345
// 读取完整一行只需一次磁盘顺序读

// 列存：同一列的所有数据连续存储
// Column[id]:    [1, 2, 3, 4, 5, ...]
// Column[name]:  [Alice, Bob, Carol, ...]
// Column[amount]: [100, 200, 300, ...]
// Column[date]:  [2024-01-01, 2024-01-02, ...]
// 适合聚合：SELECT SUM(amount) FROM orders
// 只需读取 amount 列，跳过其他列
```

### 列存的三大优势

```java
// 1. 列压缩效率高
// 同一列数据类型一致，压缩比可达 10:1
// 例如：订单金额都是 DECIMAL(10,2)
// 列存可以识别这是重复模式，压缩更高效

// 2. 向量执行快
// 一次读取整列数据，CPU 缓存友好
// SIMD 指令一次处理多个值

// 3. 只读必要列
// SELECT SUM(amount) FROM orders
// 只读取 amount 列，其他列直接跳过
// 减少 I/O 扫描量
```

## TiFlash 架构

```java
// TiFlash 核心组件
public class TiFlashArchitecture {
    // 1. 列式存储引擎
    // 基于 ClickHouse 的 MergeTree 引擎
    // 支持高效的列式读取和压缩

    // 2. DeltaTree 索引
    // 列存也需要索引
    // DeltaTree 是 TiFlash 的主键索引

    // 3. Raft Learner
    // 异步接收 TiKV 的 Raft 日志
    // 转换为列式数据存储

    // 4. MPP 执行器
    // 分布式并行查询执行
    // 多个 TiFlash 节点协同计算
}
```

### 数据同步流程

```java
// TiFlash 数据同步流程
public class TiFlashDataSync {
    // 1. TiKV 写入数据
    public void onWrite(byte[] key, byte[] value) {
        // TiKV 执行 Raft 写入
        // 写入自己的行存引擎
    }

    // 2. Raft Learner 异步拉取
    public void onLearnerReceive(LogEntry entry) {
        // TiFlash 作为 Learner 异步接收日志
        // 不参与写入确认，不影响 TiKV 性能
    }

    // 3. 转换为列式数据
    // 4. 写入 DeltaTree

    // 延迟：通常秒级
    // 一致性：最终一致
}
```

## TiFlash 使用

### 启用 TiFlash

```bash
# 1. 添加 TiFlash 节点
tiup cluster scale-out tidb-cluster scale-out-tiflash.yaml

# 2. 为表创建副本
ALTER TABLE orders SET TIFLASH REPLICA 1;

# 3. 查看副本状态
SHOW TIFLASH REPLICA orders;
```

```sql
-- 查询自动路由到 TiFlash
-- TiDB 优化器自动判断：
-- - 点查、强一致性要求 → TiKV
-- - 聚合分析 → TiFlash

SELECT 
    DATE(created_at) as date,
    COUNT(*) as order_count,
    SUM(amount) as total_amount
FROM orders
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(created_at);

-- 执行计划中会显示 "tiflash"
EXPLAIN SELECT ...;
```

### 手动指定引擎

```sql
-- 强制使用 TiFlash
SELECT /*+ read_from_storage(tiflash[orders]) */ *
FROM orders
WHERE amount > 1000;

-- 强制使用 TiKV
SELECT /*+ read_from_storage(tikv[orders]) */ *
FROM orders
WHERE id = 12345;
```

## TiFlash 性能调优

```bash
# TiFlash 配置参数

# 1. 同步线程数
# 影响数据同步速度
# 默认：2
# 建议：CPU 核心数的 25%

# 2. 存储容量
# TiFlash 数据存储路径
# 建议：足够容纳热点分析数据

# 3. MaxThreads
# 查询并发数
# 默认：CPU 核心数

# 4. MaxMemoryUsage
# 单查询最大内存
# 默认：0（无限制）
```

```java
// TiFlash 性能调优建议
public class TiFlashTuning {
    // 1. 选择合适的副本数
    // 分析负载高 → 更多副本
    // 分析负载低 → 更少副本

    // 2. 合理使用 TIFLASH REPLICA
    // 不是所有表都需要 TiFlash 副本
    // 热点分析表添加副本

    // 3. 监控同步延迟
    // Grafana → TiFlash → Sync
    // 同步延迟 = 数据写入 TiKV 到同步到 TiFlash 的时间

    // 4. 注意资源隔离
    // TiFlash 和 TiKV 可以分开部署
    // 避免 OLAP 查询影响 OLTP 性能
}
```

## TiFlash vs TiKV

| 特性 | TiKV | TiFlash |
|-----|------|---------|
| 存储格式 | 行存 | 列存 |
| 一致性 | 强一致 | 最终一致 |
| 查询类型 | 点查、范围查 | 聚合、全表扫描 |
| 写入 | 同步写入 | 异步同步 |
| 适用场景 | OLTP | OLAP |

## 面试追问

**Q: TiFlash 和 ClickHouse 有什么区别？**

TiFlash 基于 ClickHouse 的列式存储技术，但不是简单的拿来主义。TiFlash 针对 TiDB 的生态做了大量定制：
- 与 TiKV 数据自动同步
- 与 TiDB SQL 引擎深度集成
- 支持 MPP 并行查询
- 支持强一致性（相对一致性）

**Q: TiFlash 同步延迟是多少？**

通常在秒级。TiFlash 通过 Raft Learner 异步同步，数据写入 TiKV 后几秒内即可在 TiFlash 中查询到。

**Q: 可以关闭 TiFlash 副本吗？**

可以。通过 `ALTER TABLE t SET TIFLASH REPLICA 0` 可以删除 TiFlash 副本。删除后，该表的分析查询会回退到 TiKV。

---

## 总结

TiFlash 是 TiDB HTAP 能力的核心支撑。它让 TiDB 在同一集群中同时处理 OLTP 和 OLAP，无需 ETL，无需数据同步。

列式存储、向量化执行、MPP 并行......这些都是 TiFlash 高性能的秘诀。
