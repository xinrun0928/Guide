# TiDB 应用场景

你在选型数据库时，有没有遇到过这种纠结？

> OLTP 和 OLAP 的数据，要不要分开存？分开的话，实时性差、维护成本高；不分开的话，互相影响、性能差。

这是传统架构的困境：**一份数据，两种需求，鱼和熊掌不可兼得。**

但 TiDB 的 HTAP 架构，让「兼得」成为可能。

## TiDB 典型应用场景

### 场景一：OLTP 水平扩展

**场景描述：**

电商订单系统，单表数据量超过 5 亿条，峰值 QPS 超过 10 万。MySQL 单机已经到达瓶颈，分库分表改造成本巨大。

**为什么选 TiDB：**

- 原生 MySQL 协议，无需代码改造
- 水平扩展 TiKV 节点即可提升容量
- Raft 副本保证高可用
- 强一致性事务，数据不丢失

```sql
-- 分库分表 vs TiDB
-- 传统方案：先按 user_id 分 8 库 8 表
-- 查询跨分片数据，需要中间件 + 二次聚合
SELECT COUNT(*) FROM orders WHERE user_id IN (1, 2, 3, 4);  -- 复杂

-- TiDB 方案：单表直接查询，TiDB Server 自动分发
SELECT COUNT(*) FROM orders WHERE user_id IN (1, 2, 3, 4);  -- 简单
SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';  -- 全表扫描自动并行
```

**效果：**

| 指标 | 分库分表方案 | TiDB 方案 |
|-----|------------|----------|
| 改造成本 | 高（重写数据层） | 低（协议兼容） |
| 跨分片查询 | 复杂 | 简单 |
| 扩容复杂度 | 高 | 低（加节点即可） |
| 运维复杂度 | 高（多套实例） | 中（统一集群） |

### 场景二：实时数据分析

**场景描述：**

金融风控系统，需要实时分析交易数据，判断是否存在欺诈行为。分析延迟要求在秒级，数据量每天增量 1 亿条。

**为什么选 TiDB：**

- TiFlash 列式存储，聚合查询快
- 数据实时同步，无需 ETL
- 支持向量化和 SIMD 加速
- 与 TiKV 共用同一集群，数据一致

```java
// 实时风控查询示例
// TiFlash 执行分析，毫秒级返回
public class RiskControlService {
    
    public boolean checkTransaction(Transaction tx) {
        // 1. 点查验证账户状态 → TiKV（毫秒级）
        Account account = tidbMapper.getAccount(tx.getAccountId());
        if (!account.isActive()) {
            return false;
        }
        
        // 2. 实时分析最近 1 小时交易 → TiFlash（亚秒级）
        String sql = "SELECT /*+ read_from_storage(tiflash[t]) */ " +
            "COUNT(*) as tx_count, " +
            "SUM(amount) as total_amount, " +
            "AVG(amount) as avg_amount " +
            "FROM transactions t " +
            "WHERE account_id = ? " +
            "AND tx_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)";
        
        TxStats stats = jdbcTemplate.queryForObject(sql, 
            (rs, row) -> new TxStats(
                rs.getLong("tx_count"),
                rs.getBigDecimal("total_amount"),
                rs.getBigDecimal("avg_amount")
            ), tx.getAccountId());
        
        // 3. 风险规则判断
        return evaluateRisk(tx, stats);
    }
}
```

### 场景三：HTAP 混合负载

**场景描述：**

SaaS 业务平台，同时服务 C 端用户（高并发小查询）和 B 端管理员（复杂报表分析）。两类负载对数据库的需求差异巨大。

**为什么选 TiDB：**

- 同一集群同时处理 OLTP 和 OLAP
- 资源隔离，互不影响
- 智能路由，自动选择存储引擎
- 成本低于维护两套系统

```sql
-- C 端用户：点查询，走 TiKV
SELECT * FROM orders WHERE id = 12345;

-- B 端管理：聚合分析，自动走 TiFlash
SELECT 
    DATE(created_at) as date,
    COUNT(*) as order_count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount
FROM orders
WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
GROUP BY DATE(created_at)
ORDER BY date;

-- 管理员可以用 EXPLAIN 查看执行计划
EXPLAIN SELECT ...
-- 执行计划中会显示 "tiflash" 或 "tikv"
```

### 场景四：数据量大但查询简单

**场景描述：**

IoT 传感器数据存储，需要保存海量时序数据，但查询多为按设备 ID 或时间范围查询。

**为什么选 TiDB：**

- TiDB 的 Region 分片天然适合时序数据
- 按时间范围自动分裂和合并
- 支持二级索引，快速定位
- 水平扩展满足数据增长

```sql
-- 时序数据表设计
CREATE TABLE sensor_data (
    id BIGINT AUTO_RANDOM PRIMARY KEY,      -- TiDB 自动分配
    device_id BIGINT NOT NULL,
    timestamp DATETIME NOT NULL,
    temperature DECIMAL(5, 2),
    humidity DECIMAL(5, 2),
    pressure DECIMAL(6, 2),
    INDEX idx_device_time (device_id, timestamp)  -- 复合索引
) ENGINE = InnoDB;  -- TiKV 存储

-- 按设备查询最近 24 小时数据
SELECT * FROM sensor_data 
WHERE device_id = 10086 
  AND timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY timestamp;

-- 按时间聚合：每分钟平均温度
SELECT 
    DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i') as minute,
    AVG(temperature) as avg_temp,
    MAX(temperature) as max_temp,
    MIN(temperature) as min_temp
FROM sensor_data
WHERE device_id = 10086
  AND timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY minute;
```

### 场景五：MySQL 分库分表的替代

**场景描述：**

原有系统按用户 ID 分库分表，共 16 个库，每个库 16 张表。业务快速发展，查询复杂度增加，维护成本居高不下。

**痛点：**

- 跨库查询需要应用层二次聚合
- 分片键固定，新增分片代价大
- 热点数据无法动态迁移
- 全局操作（如统计所有用户）极慢

**TiDB 解决方案：**

```sql
-- 合并为单表，让 TiDB 处理分布式问题
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,  -- TiDB 自动分片
    user_id BIGINT NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
);

-- 应用层无需关心分片逻辑
-- TiDB 自动：
-- 1. 将数据分散到多个 TiKV 节点
-- 2. 根据 WHERE 条件智能路由
-- 3. 并行执行，聚合结果
```

## 场景选择决策树

```
数据库选型决策树

                    ┌─────────────────────┐
                    │ 数据量 < 1000万？    │
                    └──────────┬──────────┘
                               │
              ┌────────────────┴────────────────┐
              │                                 │
             YES                                NO
              │                                 │
              ▼                                 ▼
    ┌─────────────────┐               ┌─────────────────┐
    │ MySQL 单机足够   │               │ 并发 < 1万 QPS？ │
    └─────────────────┘               └────────┬────────┘
                                               │
                              ┌────────────────┴────────────────┐
                              │                                 │
                             YES                                NO
                              │                                 │
                              ▼                                 ▼
                    ┌─────────────────┐               ┌─────────────────┐
                    │ MySQL + 读写分离  │               │ 需要水平扩展？   │
                    └─────────────────┘               └────────┬────────┘
                                                               │
                                              ┌────────────────┴────────────────┐
                                              │                                 │
                                             YES                                NO
                                              │                                 │
                                              ▼                                 ▼
                                    ┌─────────────────┐               ┌─────────────────┐
                                    │ 需要 HTAP 能力？ │               │ 考虑 PostgreSQL │
                                    └────────┬────────┘               │   或其他方案    │
                                             │                       └─────────────────┘
                                ┌────────────┴────────────┐
                                │                         │
                               YES                        NO
                                │                         │
                                ▼                         ▼
                      ┌─────────────────┐       ┌─────────────────┐
                      │     TiDB        │       │  TiDB（OLTP）   │
                      │   (HTAP)        │       │  + ClickHouse   │
                      └─────────────────┘       │   (OLAP)       │
                                                └─────────────────┘
```

## 不适合 TiDB 的场景

TiDB 不是银弹，以下场景慎用：

| 场景 | 原因 | 替代方案 |
|-----|------|---------|
| 超高并发点查 | 延迟敏感场景，TiDB 网络开销大 | Redis + MySQL |
| 海量低价值数据 | 存储成本高，冷数据用对象存储 | 对象存储 + Presto |
| 强事务 + 超大数据量 | 分布式事务开销大 | 分库分表 + ShardingSphere |
| 复杂全文检索 | TiDB 不支持全文索引 | Elasticsearch |

## 面试追问

**Q: TiDB 和 CockroachDB 有什么区别？**

两者都是 NewSQL，但设计理念不同：
- **TiDB**：MySQL 兼容，架构清晰（SQL 层 + 存储层分离），HTAP 能力强
- **CockroachDB**：PostgreSQL 兼容，分布式事务更强，但 HTAP 能力弱

选择建议：已用 MySQL 选 TiDB，已用 PostgreSQL 选 CockroachDB。

**Q: TiDB 的扩展上限是多少？**

官方测试数据：100+ TiKV 节点，PB 级数据存储，百万级 QPS。实际取决于业务场景和数据分布。

**Q: TiDB 和 TiDB Cluster 是一个东西吗？**

TiDB 是产品名，TiDB Cluster 是 TiDB 的集群部署形态。一个完整的 TiDB 集群包含 TiDB Server、TiKV、PD、TiFlash（如需 HTAP）。

---

## 总结

TiDB 的最佳拍档：

1. **MySQL 遇到瓶颈，想平滑扩展**——协议兼容，改造成本低
2. **同时有 OLTP 和 OLAP 需求**——HTAP 能力，一份数据两套用法
3. **不想维护多套数据库**——统一平台降低运维复杂度

选对场景，TiDB 能给你带来远超单机数据库的能力；选错场景，你可能会为不需要的能力付出代价。
