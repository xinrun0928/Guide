# HTAP 实战：TiDB 的混合负载实践

你的业务正在快速增长。

白天，用户在下单、查询——这些是 OLTP 场景，延迟要低。

晚上，运营在做报表、分析——这些是 OLAP 场景，数据要全。

传统架构下，你需要两套系统：MySQL 处理 OLTP，数据同步到 ClickHouse/Hive 处理 OLAP。

但维护两套系统，代价不小。

**TiDB 的 HTAP 能力，让你一套系统搞定两种场景。**

## HTAP 场景分类

HTAP 不是万能药，不同场景有不同的最佳实践：

| 场景 | 数据量 | 查询特点 | 推荐存储 |
|-----|-------|---------|---------|
| 实时大屏 | 亿级 | 聚合、实时 | TiFlash |
| 报表分析 | 十亿级 | 复杂 JOIN、聚合 | TiFlash + MPP |
| 风控决策 | 亿级 | 实时分析、低延迟 | TiFlash |
| 历史归档 | 百亿级 | 聚合、只读 | TiFlash |
| 订单处理 | 千万级 | 点查、强一致 | TiKV |

## 实时大屏场景

### 场景特点

- 需要秒级甚至毫秒级的数据更新
- 查询以聚合为主（SUM、COUNT、AVG）
- 数据量可能很大（亿级）

### 解决方案

```sql
-- 1. 为大屏相关表创建 TiFlash 副本
ALTER TABLE orders SET TIFLASH REPLICA 1;
ALTER TABLE products SET TIFLASH REPLICA 1;

-- 2. 使用 TiFlash 查询
-- TiDB 优化器自动选择 TiFlash
SELECT
    DATE(created_at) as date,
    HOUR(created_at) as hour,
    COUNT(*) as order_count,
    SUM(amount) as total_amount,
    AVG(amount) as avg_amount
FROM orders
WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY DATE(created_at), HOUR(created_at)
ORDER BY date, hour;

-- 3. 如果延迟仍不够低，使用 TiKV 的聚合下推
-- TiKV 层先聚合，减少数据传输
```

```java
// 实时大屏服务
public class RealTimeDashboardService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;

    // 每 5 秒刷新一次数据
    @Scheduled(fixedRate = 5000)
    public void refreshDashboard() {
        // 使用 TiFlash 查询
        String sql = "SELECT /*+ read_from_storage(tiflash[orders]) */ " +
            "COUNT(*) as order_count, " +
            "SUM(amount) as total_amount " +
            "FROM orders " +
            "WHERE created_at >= DATE_SUB(NOW(), INTERVAL 5 MINUTE)";
        
        DashboardData data = jdbcTemplate.queryForObject(sql, 
            (rs, row) -> new DashboardData(
                rs.getLong("order_count"),
                rs.getBigDecimal("total_amount")
            ));
        
        // 推送更新到前端
        pushToWebSocket(data);
    }
}
```

## 报表分析场景

### 场景特点

- 查询复杂（多表 JOIN、嵌套子查询）
- 数据量大（可能涉及全表扫描）
- 延迟要求相对宽松（秒级到分钟级）

### 解决方案

```sql
-- 1. 使用 MPP 模式加速大表 JOIN
SET SESSION tidb_enforce_mpp = on;

-- 2. 分析查询示例
SELECT
    u.region,
    DATE(o.created_at) as date,
    COUNT(DISTINCT o.user_id) as buyer_count,
    COUNT(*) as order_count,
    SUM(o.amount) as gmv
FROM orders o
JOIN users u ON o.user_id = u.id
JOIN products p ON o.product_id = p.id
WHERE o.created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
  AND p.category = '电子产品'
GROUP BY u.region, DATE(o.created_at)
ORDER BY date DESC, gmv DESC;

-- 3. 查看执行计划
EXPLAIN ANALYZE SELECT ...;
-- 期望看到 "exchange" 和 "tiflash" 关键字
```

### MPP 查询调优

```java
// MPP 查询调优建议
public class MPPQueryTuning {
    // 1. 选择合适的 JOIN 顺序
    // 小表在前面，大表在后面
    // 让小表广播给大表节点
    
    // 2. 避免不必要的数据 shuffle
    // 如果数据已经按 JOIN Key 分区
    // 可以省去 Exchange 开销
    
    // 3. 合理使用 Hint
    // /*+ BROADCAST_JOIN(t small_table) */
    // 强制使用广播 JOIN
    // /*+ SHUFFLE_HASH_JOIN(t big_table) */
    // 强制使用哈希分片 JOIN
    
    // 4. 控制并发
    // 多个 MPP 查询同时运行会竞争资源
    // 使用资源组隔离不同查询
}
```

## 风控决策场景

### 场景特点

- 需要实时分析交易数据
- 延迟要求高（毫秒级）
- 误判代价高（需要最新数据）

### 解决方案

```sql
-- 风控分析查询
-- 实时性要求高，使用 TiFlash
SELECT
    account_id,
    COUNT(*) as tx_count,
    SUM(amount) as total_amount,
    MAX(amount) as max_amount,
    AVG(amount) as avg_amount,
    -- 检测异常模式
    CASE 
        WHEN COUNT(*) > 100 AND AVG(amount) > 10000 THEN 'HIGH_RISK'
        WHEN COUNT(*) > 50 AND MAX(amount) > 50000 THEN 'MEDIUM_RISK'
        ELSE 'LOW_RISK'
    END as risk_level
FROM transactions
WHERE account_id = ?
  AND tx_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)
GROUP BY account_id;
```

```java
// 风控服务
public class RiskControlService {
    
    @Autowired
    private JdbcTemplate jdbcTemplate;

    public RiskCheckResult checkTransaction(Transaction tx) {
        // 1. 查询账户历史交易
        String sql = "SELECT /*+ read_from_storage(tiflash[transactions]) */ " +
            "account_id, COUNT(*) as tx_count, SUM(amount) as total_amount " +
            "FROM transactions " +
            "WHERE account_id = ? " +
            "AND tx_time >= DATE_SUB(NOW(), INTERVAL 1 HOUR)";
        
        TxHistory history = jdbcTemplate.queryForObject(sql, 
            (rs, row) -> new TxHistory(
                rs.getLong("account_id"),
                rs.getInt("tx_count"),
                rs.getBigDecimal("total_amount")
            ), tx.getAccountId());
        
        // 2. 规则判断
        RiskLevel level = evaluateRules(tx, history);
        
        // 3. 返回结果
        return new RiskCheckResult(tx.getId(), level, history);
    }
}
```

## 历史数据归档场景

### 场景特点

- 历史数据量大（可能上百亿）
- 主要用于分析，很少修改
- 需要保留很长时间

### 解决方案

```sql
-- 1. 分区表设计
CREATE TABLE orders_archive (
    id BIGINT,
    user_id BIGINT,
    amount DECIMAL(10, 2),
    created_at DATETIME,
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (YEAR(created_at)) (
    PARTITION p2022 VALUES LESS THAN (2023),
    PARTITION p2023 VALUES LESS THAN (2024),
    PARTITION p2024 VALUES LESS THAN (2025),
    PARTITION p2025 VALUES LESS THAN (2026)
);

-- 2. 历史分区创建 TiFlash 副本
ALTER TABLE orders_archive PARTITION (p2022, p2023) SET TIFLASH REPLICA 1;

-- 3. 查询只访问历史分区
SELECT * FROM orders_archive PARTITION (p2022, p2023)
WHERE created_at >= '2022-01-01' AND created_at < '2024-01-01';
```

## HTAP 实践注意事项

### 资源隔离

```bash
# TiFlash 和 TiKV 分开部署
# 避免 OLAP 查询影响 OLTP 性能

# TiFlash 节点配置
tikv_servers:
- host: 192.168.1.10
  port: 9000  # TiFlash 端口
  status_port: 8090
  config:
    # TiFlash 专用配置
    flash.flash_service_dir: /data/tiflash/db
    flash.num_threads: 16
```

### 数据同步监控

```bash
# 监控 TiFlash 同步延迟
# Grafana → TiFlash → Sync
# 同步延迟应该 < 10s

# 查看同步状态
SELECT * FROM information_schema.tiflash_replica
WHERE table_name = 'orders';

# 同步状态：
# - Available: 副本可用
# - Unavailable: 副本不可用
# - Syncing: 正在同步
```

### 查询路由选择

```java
// TiDB 优化器自动选择引擎
public class QueryRouter {
    // 优化器根据查询特点自动选择
    // - 点查、强一致性 → TiKV
    // - 聚合分析、大数据量 → TiFlash

    // 手动干预场景：
    // 1. TiFlash 同步延迟高，需要实时数据 → 强制 TiKV
    // 2. TiKV 查询慢，需要分析能力 → 强制 TiFlash
    
    public void forceTiFlash(String sql) {
        return sql.replace("SELECT", 
            "SELECT /*+ read_from_storage(tiflash[t]) */".replace("t", getTableName(sql)));
    }
}
```

## 面试追问

**Q: HTAP 场景下如何保证 OLTP 性能不受 OLAP 影响？**

核心是资源隔离：
1. TiFlash 节点独立部署，不与 TiKV 共享 CPU/内存
2. TiDB 可以配置资源组，限制 OLAP 查询的资源使用
3. MPP 查询可以设置超时，避免长时间占用资源

**Q: TiFlash 的同步延迟会影响业务吗？**

对于大多数 OLAP 场景，秒级延迟完全可以接受。对于强实时要求的场景，可以使用 TiKV 的聚合下推，牺牲部分分析能力换取实时性。

**Q: 什么情况下不适合使用 HTAP？**

1. **超大规模 OLAP**：数据量超过百亿级，TiFlash 可能不够，可以考虑 ClickHouse 独立部署
2. **超低延迟 OLTP**：延迟要求微秒级，TiDB 的分布式架构可能不满足，需要 Redis + MySQL
3. **复杂 ETL**：需要大量数据清洗转换，TiFlash 不擅长，需要 Spark/Flink

---

## 总结

HTAP 是 TiDB 的核心竞争力之一。正确使用 TiFlash，可以让一套系统同时服务 OLTP 和 OLAP 场景，大幅降低运维复杂度。

记住实践原则：
- **实时大屏用 TiFlash**
- **复杂报表用 MPP**
- **强一致用 TiKV**
- **资源隔离要做好**
