# TDengine 查询与降采样

查询速度是时序数据库的核心指标之一。

TDengine 的查询性能为什么快？答案在于它的查询引擎和**超级表设计**。

## 查询执行流程

```
查询执行流程：
┌──────────────────────────────────────────────────────────────────┐
│                                                                   │
│  SELECT AVG(power) FROM meter_data                              │
│  WHERE location_id = 110100                                     │
│  AND ts > NOW() - 1h                                            │
│  GROUP BY meter_id                                               │
│                                                                   │
│  ↓                                                               │
│                                                                   │
│  1. 元数据查询：location_id=110100 → 找到对应子表列表            │
│  2. 扫描计划生成：为每个子表生成扫描计划                         │
│  3. 并行执行：各 VNode 扫描本地数据                              │
│  4. 结果合并：聚合各子表结果                                     │
│  5. 返回结果                                                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## 常用查询示例

### 时间窗口聚合

```sql
-- 按时间窗口聚合（每小时）
SELECT AVG(voltage) AS avg_voltage,
       MAX(current) AS max_current,
       MIN(power) AS min_power
FROM meter_001
WHERE ts > NOW() - 24h
GROUP BY ts(1h)
ORDER BY ts;

-- 滑动窗口（每 30 分钟统计一次）
SELECT AVG(poltage)
FROM meter_001
WHERE ts > NOW() - 12h
GROUP BY ts(1h, 30m);  -- 窗口 1h，滑动步长 30m

-- 按自然时间对齐（每天 0 点开始）
SELECT DATE(ts) AS day,
       SUM(power) AS daily_energy
FROM meter_001
WHERE ts > NOW() - 30d
GROUP BY DATE(ts);
```

### 超级表聚合查询

```sql
-- 查询所有电表的平均功率
SELECT AVG(power) FROM meter_data;

-- 按地区聚合
SELECT location_name,
       COUNT(*) AS meter_count,
       AVG(voltage) AS avg_voltage,
       SUM(power) AS total_power
FROM meter_data
WHERE ts > NOW() - 1h
GROUP BY location_name;

-- 按电表类型聚合
SELECT meter_type,
       AVG(current) AS avg_current,
       MAX(power) AS max_power
FROM meter_data
WHERE ts > NOW() - 1d
GROUP BY meter_type;

-- 多维度聚合
SELECT location_name,
       meter_type,
       AVG(power) AS avg_power
FROM meter_data
WHERE ts > NOW() - 7d
GROUP BY location_name, meter_type
ORDER BY avg_power DESC;
```

### 标签过滤查询

```sql
-- 精确匹配
SELECT * FROM meter_data WHERE meter_id = 'meter_00001';

-- 模糊匹配（前缀）
SELECT * FROM meter_data WHERE meter_id LIKE 'meter_000%';

-- 范围查询
SELECT * FROM meter_data WHERE meter_id IN ('meter_00001', 'meter_00002');

-- 多条件过滤
SELECT AVG(power)
FROM meter_data
WHERE meter_type = 1          -- 居民电表
  AND location_id BETWEEN 110100 AND 110999  -- 北京地区
  AND ts > NOW() - 1h;
```

### 时间序列函数

```sql
-- 获取第一条和最后一条记录
SELECT FIRST(ts), LAST(ts), FIRST(voltage), LAST(voltage)
FROM meter_001
WHERE ts > NOW() - 24h;

-- 差值计算
SELECT ts,
       voltage,
       voltage - LAG(voltage, 1) AS voltage_diff
FROM meter_001
WHERE ts > NOW() - 1h;

-- 移动平均（最近 5 个点）
SELECT ts,
       AVG(voltage) OVER (ORDER BY ts ROWS BETWEEN 4 PRECEDING AND CURRENT ROW) AS ma5
FROM meter_001
WHERE ts > NOW() - 1h;
```

## 降采样

降采样是时序数据库的核心功能之一，用于减少数据量、加速查询。

### 预降采样（连续查询）

```sql
-- 创建小时级降采样
CREATE TABLE IF NOT EXISTS meter_hourly (
    ts TIMESTAMP,
    meter_id BINARY(64),
    location_name BINARY(50),
    avg_voltage DOUBLE,
    max_current DOUBLE,
    min_power DOUBLE,
    total_energy DOUBLE
);

-- 插入降采样数据
INSERT INTO meter_hourly
SELECT ts(1h) AS ts,
       meter_id,
       location_name,
       AVG(voltage) AS avg_voltage,
       MAX(current) AS max_current,
       MIN(power) AS min_power,
       SUM(power) / 3600 AS total_energy  -- 功率转电能
FROM meter_data
WHERE ts > NOW() - 7d
GROUP BY ts(1h), meter_id, location_name;
```

### 查询时降采样

```sql
-- 查询原始数据（最近 24 小时）
SELECT * FROM meter_data
WHERE ts > NOW() - 24h;

-- 查询时降采样（7 天以上）
SELECT ts(1h) AS ts,
       AVG(voltage) AS avg_voltage,
       AVG(current) AS avg_current
FROM meter_data
WHERE ts > NOW() - 7d
GROUP BY ts(1h);

-- 查询时降采样（30 天以上）
SELECT ts(1d) AS day,
       AVG(voltage) AS avg_voltage
FROM meter_data
WHERE ts > NOW() - 30d
GROUP BY ts(1d);
```

### 多级降采样策略

```sql
-- 1. 创建多级降采样表
CREATE STABLE meter_hourly (
    ts TIMESTAMP,
    avg_voltage DOUBLE,
    max_current DOUBLE,
    min_power DOUBLE
) TAGS (meter_id BINARY(64));

CREATE STABLE meter_daily (
    ts TIMESTAMP,
    avg_voltage DOUBLE,
    max_current DOUBLE,
    min_power DOUBLE
) TAGS (meter_id BINARY(64));

-- 2. 原始数据 → 小时级（定时任务）
INSERT INTO meter_hourly
SELECT ts(1h), meter_id,
       AVG(voltage), MAX(current), MIN(power)
FROM meter_data
WHERE ts > NOW() - 3d
GROUP BY ts(1h), meter_id;

-- 3. 小时级 → 天级（定时任务）
INSERT INTO meter_daily
SELECT ts(1d), meter_id,
       AVG(avg_voltage), MAX(max_current), MIN(min_power)
FROM meter_hourly
WHERE ts > NOW() - 90d
GROUP BY ts(1d), meter_id;
```

## 聚合函数

### 基础聚合

```sql
SELECT COUNT(*) FROM meter_data WHERE ts > NOW() - 1h;
SELECT SUM(power) FROM meter_data WHERE ts > NOW() - 1h;
SELECT AVG(voltage) FROM meter_data WHERE ts > NOW() - 1h;
SELECT MIN(current) FROM meter_data WHERE ts > NOW() - 1h;
SELECT MAX(power) FROM meter_data WHERE ts > NOW() - 1h;
```

### 统计函数

```sql
-- 标准差
SELECT STDDEV(power) FROM meter_data WHERE ts > NOW() - 1h;

-- 百分位数
SELECT PERCENTILE(power, 50) AS p50,
       PERCENTILE(power, 90) AS p90,
       PERCENTILE(power, 99) AS p99
FROM meter_data WHERE ts > NOW() - 1h;

-- 变异系数
SELECT STDDEV(power) / AVG(power) * 100 AS cv_percent
FROM meter_data WHERE ts > NOW() - 1h;
```

### 时间序列专用函数

```sql
-- 差分
SELECT ts, voltage,
       voltage - LAG(voltage, 1) AS diff_1,  -- 1 步差分
       voltage - LAG(voltage, 24) AS diff_24  -- 24 步差分
FROM meter_001 WHERE ts > NOW() - 24h;

-- 累积和
SELECT ts, power,
       SUM(power) OVER (ORDER BY ts) AS cum_power
FROM meter_001 WHERE ts > NOW() - 24h;

-- 变化率
SELECT ts, power,
       (power - LAG(power, 1)) / LAG(power, 1) * 100 AS change_rate
FROM meter_001 WHERE ts > NOW() - 24h;
```

## 查询优化技巧

### 1. 善用标签过滤

```sql
-- 慢：查询所有电表再过滤
SELECT * FROM meter_data WHERE ts > NOW() - 1h AND meter_id = 'meter_00001';

-- 快：利用标签索引定位
SELECT * FROM meter_00001 WHERE ts > NOW() - 1h;
```

### 2. 选择合适的降采样间隔

```sql
-- 查询最近 1 小时：用原始数据
SELECT * FROM meter_data WHERE ts > NOW() - 1h;

-- 查询最近 7 天：降采样到 5 分钟
SELECT ts(5m), AVG(voltage) FROM meter_data
WHERE ts > NOW() - 7d GROUP BY ts(5m);

-- 查询最近 30 天：降采样到 1 小时
SELECT ts(1h), AVG(voltage) FROM meter_data
WHERE ts > NOW() - 30d GROUP BY ts(1h);

-- 查询最近 1 年：降采样到 1 天
SELECT ts(1d), AVG(voltage) FROM meter_data
WHERE ts > NOW() - 365d GROUP BY ts(1d);
```

### 3. 利用超级表查询代替 UNION

```sql
-- 低效：UNION 多个子表
SELECT * FROM meter_00001 WHERE ts > NOW() - 1h
UNION ALL
SELECT * FROM meter_00002 WHERE ts > NOW() - 1h
UNION ALL
SELECT * FROM meter_00003 WHERE ts > NOW() - 1h;

-- 高效：直接查询超级表
SELECT * FROM meter_data WHERE ts > NOW() - 1h;
```

### 4. 设置查询时间范围

```sql
-- 低效：没有时间范围，全表扫描
SELECT AVG(power) FROM meter_data;

-- 高效：限定时间范围
SELECT AVG(power) FROM meter_data WHERE ts > NOW() - 1h;
```

## 常见查询场景

### 场景 1：实时监控大屏

```sql
-- 每 10 秒刷新一次
SELECT LAST(voltage), LAST(current), LAST(power)
FROM meter_data
WHERE meter_id IN ('meter_00001', 'meter_00002', 'meter_00003');
```

### 场景 2：日报表

```sql
-- 每天自动生成
SELECT DATE(ts) AS report_date,
       location_name,
       COUNT(DISTINCT meter_id) AS meter_count,
       ROUND(SUM(power) / 3600, 2) AS daily_energy_kwh,
       ROUND(AVG(voltage), 2) AS avg_voltage,
       MAX(current) AS max_current
FROM meter_data
WHERE ts > '2024-01-01' AND ts < '2024-01-02'
GROUP BY DATE(ts), location_name;
```

### 场景 3：异常检测

```sql
-- 检测电压异常（超过 ±10% 范围）
SELECT ts, meter_id, voltage
FROM meter_data
WHERE ABS(voltage - 220) > 22
  AND ts > NOW() - 24h;

-- 检测用电突增（相比上一时刻增长 > 50%）
SELECT ts, meter_id, power,
       LAG(power, 1) AS prev_power,
       (power - LAG(power, 1)) / LAG(power, 1) * 100 AS increase_rate
FROM meter_data
WHERE ts > NOW() - 24h
  AND LAG(power, 1) > 0
HAVING increase_rate > 50;
```

## 面试追问方向

1. **TDengine 的查询为什么比 MySQL 快？** 列式存储减少 I/O 量；按时间分区避免全表扫描；超级表聚合利用标签索引。

2. **降采样的时机选择？** 预降采样（写入时）查询快但存储多；查询时降采样存储省但查询慢。建议热数据用原始精度，冷数据用预降采样。

3. **如何优化超大规模查询？** 利用 VNode 并行；设置合理的分区键；预计算常用聚合。

4. **超级表查询的执行计划？** 先根据标签定位子表列表，再并行扫描各子表，最后聚合结果。
