# 时序数据库查询：如何高效地「按时间问问题」

学会了时序数据的写入，下一步就是查询。

但很多人写时序查询时，容易踩坑：同样的需求，查询写错了，性能差 100 倍。

今天，我们来彻底搞懂时序数据库的查询技巧。

---

## 时序查询的核心概念

### 时间窗口

时序数据最常见的操作就是**按时间窗口聚合**：

```java
// 场景：计算每台服务器每 5 分钟的平均 CPU
// InfluxDB InfluxQL
SELECT MEAN(cpu) FROM server_metrics
WHERE time > now() - 7d
GROUP BY time(5m), host

// 等价 SQL（TimescaleDB/TDengine）
SELECT date_trunc('minute', time) / 5 * 5 as window,
       AVG(cpu) as avg_cpu
FROM server_metrics
WHERE time > NOW() - INTERVAL '7 day'
GROUP BY window, host
```

### 窗口类型

```
滚动窗口（Rolling Window）
─────────────────────────────────────────────────
|█ █ █ █|█ █ █ █|█ █ █ █|█ █ █ █|   ← 固定大小，不重叠
[5m]  [5m]  [5m]  [5m]

跳跃窗口（Hopping Window）
─────────────────────────────────────────────────
    |█ █ █ █|  |█ █ █ █|  |█ █ █ █|  ← 固定大小，可重叠
      [5m]      [5m]      [5m]

会话窗口（Session Window）
─────────────────────────────────────────────────
|███ █████ ███|  |██ ███|  |████████|   ← 按活动划分
      gap=5m        gap=5m       gap=5m
```

---

## 常用聚合函数

### 基础聚合

```java
// 计算平均值、最大值、最小值
SELECT MEAN(cpu), MAX(cpu), MIN(cpu) FROM metrics
WHERE time > now() - 1h GROUP BY host

// 计算百分位数（监控告警常用）
SELECT PERCENTILE(cpu, 95) FROM metrics  // InfluxDB
SELECT percentile_agg(cpu, 0.95) FROM metrics  // TimescaleDB
```

### 统计聚合

```java
// 计算标准差（判断数据波动）
SELECT STDDEV(cpu) FROM metrics WHERE time > now() - 1h GROUP BY host

// 计算计数、去重计数
SELECT COUNT(*), COUNT(DISTINCT user_id) FROM events
WHERE time > now() - 1d
```

### 特殊聚合

```java
// 首次/最后一次值（查找最新状态）
SELECT FIRST(price), LAST(price) FROM stock
WHERE symbol = 'AAPL' GROUP BY symbol

// 导数（计算变化率）
SELECT DERIVATIVE(cpu, 1s) FROM metrics  // 每秒 CPU 变化率

// 移动平均（平滑曲线）
SELECT MOVING_AVERAGE(cpu, 5) FROM metrics
```

---

## 降采样（Downsampling）

数据量太大时，需要降采样：

```
原始数据：100万点/秒（一个月 = 2.5TB）
降采样后：1万点/5分钟（一个月 = 25GB）
```

### InfluxDB 连续查询

```sql
-- 创建连续查询：每 5 分钟计算一次平均值
CREATE CONTINUOUS QUERY "cq_cpu_avg"
ON monitoring
BEGIN
  SELECT MEAN(cpu) AS cpu_avg
  INTO "cpu_5m_avg"
  FROM "server_metrics"
  GROUP BY time(5m), host
END
```

### TimescaleDB 自动压缩

```sql
-- 启用自动压缩
ALTER TABLE metrics SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'host'
);

-- 添加压缩策略：1小时前的数据自动压缩
SELECT add_compression_policy('metrics', INTERVAL '1 hour');
```

---

## 查询优化技巧

### 1. 善用 tag 过滤

```java
// 错误：在 field 上过滤（慢）
SELECT * FROM metrics WHERE cpu > 80  // 全表扫描

// 正确：在 tag 上过滤（快）
SELECT * FROM metrics WHERE host = 'server01' AND cpu > 80  // 索引扫描
```

### 2. 限制时间范围

```java
// 错误：查询全部数据
SELECT MEAN(cpu) FROM metrics  // 可能返回几亿条

// 正确：明确时间范围
SELECT MEAN(cpu) FROM metrics
WHERE time > now() - INTERVAL '1 day'  // 只查一天
```

### 3. 先过滤，后聚合

```java
// 错误：先聚合再过滤
SELECT MEAN(cpu) FROM metrics
GROUP BY host
HAVING host = 'server01'

// 正确：先过滤再聚合
SELECT MEAN(cpu) FROM metrics
WHERE host = 'server01'
GROUP BY host
```

### 4. 使用预聚合

```sql
-- 原始数据：每秒一条
-- 5 分钟聚合：保持高分辨率
-- 1 小时聚合：保留长期趋势
-- 1 天聚合：归档

-- 查询时优先用低分辨率数据
SELECT * FROM metrics_1h
WHERE time > now() - INTERVAL '30 day'
UNION ALL
SELECT * FROM metrics_5m
WHERE time > now() - INTERVAL '1 day'
```

---

## 常用查询模式

### 模式一：实时监控大屏

```java
// 查询最近 5 分钟的数据，每 10 秒刷新
String query = """
    SELECT LAST(cpu), LAST(memory), LAST(disk)
    FROM server_metrics
    WHERE host =~ /server.*/
    GROUP BY host
    """;

// 对应 InfluxQL
// SELECT LAST(cpu), LAST(memory), LAST(disk)
// FROM server_metrics
// WHERE time > now() - 5m
// GROUP BY host
```

### 模式二：趋势分析

```java
// 查询 7 天趋势，每天一个点
String query = """
    SELECT MEAN(cpu) as avg_cpu
    FROM metrics
    WHERE time > now() - 7d
    GROUP BY time(1d), host
    ORDER BY time
    """;
```

### 模式三：告警查询

```java
// 查询 5 分钟窗口内，CPU 超过 80% 的服务器
String alertQuery = """
    SELECT MAX(cpu) as max_cpu
    FROM metrics
    WHERE time > now() - 5m
    GROUP BY host
    HAVING MAX(cpu) > 80
    """;
```

### 模式四：环比分析

```java
// 查询今天 vs 昨天的数据对比
String compareQuery = """
    SELECT MEAN(cpu) as today_avg,
           MEAN(cpu) - LAG(MEAN(cpu), 1) OVER (ORDER BY date) as diff
    FROM (
        SELECT date_trunc('day', time) as date,
               AVG(cpu) as cpu
        FROM metrics
        WHERE time > NOW() - INTERVAL '2 day'
        GROUP BY date
    ) t
    GROUP BY date
    """;
```

---

## PromQL 特殊语法

Prometheus 的 PromQL 有独特的查询方式：

```java
// 即时查询：返回当前值
// rate(http_requests_total[5m]) = 5m 时间窗口内的平均增长率

// 区间查询：返回时间序列
// http_requests_total[5m] = 5 分钟内的所有数据点

// 常用函数
rate(cpu_usage_total[5m])        // 平均增长率
increase(cpu_usage_total[5m])   // 总增长量
irate(cpu_usage_total[5m])      // 瞬时增长率

// 聚合操作
sum(rate(http_requests_total[5m])) by (service)
```

---

## 面试追问方向

- 时序数据库的查询为什么比普通数据库快？
- 如何处理跨时区的时间序列数据？

下一节，我们来深入了解 InfluxDB。
