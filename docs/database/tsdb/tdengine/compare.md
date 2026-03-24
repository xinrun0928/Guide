# TDengine vs InfluxDB vs TimescaleDB 对比

三个时序数据库，摆在你面前。

选哪个？

这不是技术问题，是场景问题。

## 先看核心差异

| 维度 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| **开源协议** | AGPL + 商业闭源 | MIT + 商业闭源 | Timescale License + 商业 |
| **底层存储** | 自研 TDengineDB | 自研 TSM | PostgreSQL |
| **写入性能** | 100-200 万/s | 50-100 万/s | 10-20 万/s |
| **集群方案** | 开源 | 商业版 | 部分开源 |
| **SQL 支持** | 扩展 SQL | InfluxQL/Flux | 完整 SQL |
| **超级表/超表** | 支持 | 不支持 | Hypertable |
| **多表写入** | 支持 | 不支持 | 支持 |

## 性能对比

### 写入性能

> 以下数据来自官方 benchmark 和公开测试，实际性能因硬件和数据模式不同会有差异。

| 数据库 | 单节点写入 (万/s) | 集群写入 (万/s) | CPU 利用率 |
|---|---|---|---|
| TDengine | 150-200 | 500+ | 高 |
| InfluxDB | 50-100 | 200+ (商业版) | 中 |
| TimescaleDB | 10-20 | 50+ | 中 |

### 查询性能

| 查询类型 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| 单表时间范围查询 | 快 | 快 | 中 |
| 超级表聚合查询 | 快 | 慢 | 中 |
| 跨表 JOIN | 不支持 | 不支持 | 支持 |
| 复杂 SQL | 有限 | 有限 | 完整支持 |

## 场景对比

### 场景 1：IoT 传感器（100 万设备）

```
需求：
- 100 万台电表/水表/气表
- 每设备每秒上报 1 条
- 查询：单设备历史、特定区域聚合
```

**推荐：TDengine**

```sql
-- TDengine 超级表完美匹配
CREATE STABLE sensor_data (
    ts TIMESTAMP,
    value DOUBLE
) TAGS (device_id BINARY(64), location BINARY(50));

-- 单设备查询
SELECT * FROM sensor_data WHERE device_id = 'device_001';

-- 区域聚合（利用标签索引）
SELECT location, AVG(value)
FROM sensor_data
WHERE ts > NOW() - 1h
GROUP BY location;
```

**InfluxDB 对比**：
- 需要为每个设备创建 Measurement 或使用 tags
- 大量 tags 会导致高基数问题

**TimescaleDB 对比**：
- 性能不足，100 万设备并发写入可能瓶颈

### 场景 2：DevOps 监控（1000 台服务器）

```
需求：
- 1000 台服务器
- 每服务器每 10 秒上报 50 个指标
- 查询：服务监控、告警
```

**推荐：InfluxDB + Telegraf**

```bash
# Telegraf 配置
[[inputs.cpu]]
[[inputs.mem]]
[[inputs.disk]]
[[inputs.net]]

[[outputs.influxdb]]
  urls = ["http://localhost:8086"]
```

- Telegraf 生态完善，开箱即用
- InfluxDB + Grafana 可视化成熟
- 1000 台规模在 InfluxDB 单节点能力范围内

**TDengine 对比**：
- 需要额外适配
- 性能过剩

### 场景 3：金融时序数据（K 线数据）

```
需求：
- 股票/期货 Tick 数据
- 高频写入（毫秒级）
- 需要 JOIN 业务数据
```

**推荐：TimescaleDB**

```sql
-- TimescaleDB 完整 SQL 支持
SELECT t.ts, t.price, s.company_name, s.sector
FROM tick_data t
JOIN stock_info s ON t.stock_code = s.code
WHERE t.ts > NOW() - INTERVAL '1 day'
  AND t.stock_code IN ('AAPL', 'GOOGL');
```

- 完整 SQL 支持，JOIN 操作方便
- 与现有 BI 工具无缝集成
- PostgreSQL 生态丰富

**TDengine/InfluxDB 对比**：
- 不支持跨表 JOIN
- 需要额外的数据同步方案

## 功能对比

### 数据模型

| 特性 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| 超表/超级表 | ✅ 超级表 | ❌ | ✅ Hypertable |
| 标签索引 | ✅ 自动索引 | ✅ 需定义 | ✅ 自动分区索引 |
| 字段索引 | ✅ | ❌ | ✅ |
| Schema 灵活 | 部分 | 灵活 | 固定 |
| 数据类型 | 丰富 | 有限 | 完整 |

### 降采样与保留

| 特性 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| 连续查询 | ✅ | ✅ | ✅ |
| 内置降采样 | ✅ | ✅ | ✅ |
| 多保留策略 | ✅ | ✅ | ✅ |
| 自动数据过期 | ✅ | ✅ | ✅ |

### 生态集成

| 生态 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| Grafana | ✅ | ✅ 原生 | ✅ |
| Prometheus | ✅ | ✅ | ✅ |
| Kafka | ✅ | ✅ | ❌ |
| Tableau/BI | ❌ | ❌ | ✅ 原生 |
| Python/R | ✅ | ✅ | ✅ |
| JDBC/ODBC | ✅ | ✅ | ✅ 原生 |

## 运维对比

### 部署复杂度

| 维度 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| 单节点 | ⭐⭐⭐⭐⭐ 简单 | ⭐⭐⭐⭐⭐ 简单 | ⭐⭐⭐⭐⭐ 简单 |
| 集群 | ⭐⭐⭐ 中等 | ⭐⭐ 复杂（商业版）| ⭐⭐⭐⭐ 成熟 |
| Kubernetes | 支持 | 支持 | 原生支持 |
| 云服务 | TDengine Cloud | InfluxDB Cloud | Timescale Cloud |

### 运维成本

| 维度 | TDengine | InfluxDB | TimescaleDB |
|---|---|---|---|
| 文档完整性 | ⭐⭐⭐⭐ 中文好 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 社区活跃度 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 商业支持 | 涛思数据 | InfluxData | Timescale |
| 学习曲线 | 中等 | 中等 | 低 |

## 选型决策树

```
时序数据库选型：
│
├─ 需要完整 SQL + JOIN？
│   └─ 是 → TimescaleDB
│
├─ 数据量 > 10 亿条/天？
│   └─ 是 → TDengine（集群开源）
│
├─ Kubernetes + 云原生监控？
│   └─ 是 → InfluxDB + Prometheus
│
├─ IoT 场景 + 高并发写入？
│   └─ 是 → TDengine
│
└─ 团队熟悉 PostgreSQL？
    └─ 是 → TimescaleDB
    └─ 否 → InfluxDB（生态成熟）
```

## 迁移指南

### InfluxDB → TDengine

```sql
-- InfluxDB
SELECT MEAN(cpu_usage) FROM cpu
WHERE host = 'server01'
GROUP BY time(1h), host;

-- TDengine（超级表语法）
CREATE STABLE cpu (
    ts TIMESTAMP,
    cpu_usage DOUBLE
) TAGS (host BINARY(50));

SELECT ts(1h), AVG(cpu_usage)
FROM cpu
WHERE host = 'server01'
GROUP BY ts(1h), host;
```

### TimescaleDB → TDengine

```sql
-- TimescaleDB
SELECT time_bucket('1 hour', ts) AS hour,
       AVG(value)
FROM sensor_data
GROUP BY hour
ORDER BY hour;

-- TDengine
SELECT ts(1h), AVG(value)
FROM sensor_data
GROUP BY ts(1h);
```

## 面试追问方向

1. **为什么 TDengine 写入性能最高？** 无代理直连 VNode、超级表预聚合优化、列式存储 + 高效压缩。

2. **TimescaleDB 的 Hypertable 和 TDengine 的超级表区别？** Hypertable 基于 PostgreSQL 分区，自动创建子表；超级表有明确的标签schema，标签索引更高效。

3. **三个数据库的压缩算法对比？** TDengine 使用列式压缩；InfluxDB 使用 Gorilla 压缩；TimescaleDB 使用 PostgreSQL 原生压缩。

4. **什么时候不能选 TimescaleDB？** 高并发写入（> 20 万/s）、超大规模（> 1 亿时间线）、需要开源集群方案时。
