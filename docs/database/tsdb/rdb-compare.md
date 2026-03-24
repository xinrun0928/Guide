# 时序数据库选型：InfluxDB vs Prometheus vs TDengine vs TimescaleDB

面试官问你：「你们项目用的是哪个时序数据库？为什么选它？」

你该怎么回答？

今天我们横向对比四大主流时序数据库，帮你理清选型思路。

---

## 核心对比表

| 特性 | InfluxDB | Prometheus | TDengine | TimescaleDB |
|-----|----------|------------|----------|-------------|
| **定位** | 通用时序数据库 | 监控告警 | 物联网 | PostgreSQL 扩展 |
| **写入性能** | 100万点/秒 | 100万样本/秒 | 500万表/秒 | 10万行/秒 |
| **查询语言** | InfluxQL/Flux | PromQL | SQL | SQL |
| **数据模型** | Tag/Field | Label | Tag/Field | 标准关系型 |
| **存储引擎** | TSM | 自研 | 自研 | PostgreSQL |
| **集群** | 企业版 | 原生支持 | 开源 | 企业版 |
| **开源** | OSS版本可用 | 完全开源 | Apache 2.0 | Apache 2.0 |
| **生态** | 丰富 | 丰富 | 发展中 | 依赖 PG 生态 |

---

## InfluxDB：功能最全面

### 优点

- **功能完善**：数据保留策略（RP）、连续查询（CQ）、downsampling
- **生态丰富**：Telegraf 采集器支持 200+ 数据源
- **API 友好**：HTTP API、客户端库丰富
- **InfluxQL**：类 SQL，学习成本低

### 缺点

- **集群收费**：开源版只有单机，高可用需要企业版
- **性能一般**：相对其他 TSDB，写入性能不是最强
- **资源占用**：比其他方案占用更多内存

### 适用场景

- 需要完善的数据生命周期管理
- 多数据源聚合（Telegraf 生态）
- 需要灵活查询语言（Flux）

---

## Prometheus：云原生监控之王

### 优点

- **云原生**：Kubernetes 原生支持
- **pull 模式**：无需在采集端部署 agent
- **强大查询**：PromQL 功能强大
- **告警强大**：AlertManager 原生集成
- **社区活跃**：Exporter 生态极其丰富

### 缺点

- **数据模型限制**：Label 数量有限制
- **不适合存储原始数据**：主要是指标快照
- **单实例限制**：需要 Thanos/Cortex 等实现集群
- **长期存储弱**：需要联邦集群或远程存储

### 适用场景

- Kubernetes 监控
- 微服务应用监控
- 需要原生告警能力

---

## TDengine：物联网专精

### 优点

- **高性能**：独特的超级表设计，写入性能极强
- **集群开源**：高可用集群版本完全开源
- **存储效率高**：列式压缩，存储成本低
- **SQL 兼容**：使用标准 SQL，学习成本低
- **国产之光**：中文文档，国产支持

### 缺点

- **生态较弱**：采集器、工具链不如 InfluxDB
- **社区较小**：相比其他方案，社区较新
- **使用限制**：某些高级功能需要企业版

### 适用场景

- 工业物联网
- 车联网
- 需要高性能写入的边缘计算

---

## TimescaleDB：PostgreSQL 的力量

### 优点

- **SQL 完全兼容**：任何 PostgreSQL 客户端都能用
- **扩展丰富**：PostgreSQL 生态的所有扩展
- **迁移成本低**：从 PostgreSQL 迁移容易
- **Hypertable 设计**：自动分区，查询优化

### 缺点

- **基于 PostgreSQL**：底层是 PG，扩展性受限
- **写入性能**：相对其他 TSDB 较弱
- **压缩率**：不如专有 TSDB

### 适用场景

- 已使用 PostgreSQL 的团队
- 需要复杂 SQL 查询
- 数据需要和其他业务库关联

---

## 横向对比：性能测试

以下数据基于官方 benchmark，仅供参考：

### 写入性能

```
InfluxDB:    ████████░░  ~100万点/秒
Prometheus:  ████████░░  ~100万样本/秒
TDengine:    ██████████  ~500万表/秒
TimescaleDB: ████░░░░░░  ~10万行/秒
```

### 存储压缩率

```
InfluxDB:    ████████░░  ~5-10x
Prometheus:  ██████░░░░  ~3-5x
TDengine:    ██████████  ~10-20x
TimescaleDB: ████░░░░░░  ~2-3x
```

### 查询性能（时间范围聚合）

```
InfluxDB:    ████████░░  优秀
Prometheus:  █████████░  很好
TDengine:    █████████░  很好
TimescaleDB: ██████░░░░  良好
```

---

## 选型决策树

```
需要 Kubernetes 监控吗？
  │
  ├─ 是 → Prometheus（首选）
  │
  └─ 否 → 团队有 PostgreSQL 经验吗？
            │
            ├─ 是 → TimescaleDB（迁移成本低）
            │
            └─ 否 → 数据规模大吗？
                      │
                      ├─ < 100万点/秒 → InfluxDB（生态好）
                      │
                      └─ > 100万点/秒 → TDengine（高性能）
```

---

## 实际选型案例

### 案例一：电商监控系统

**需求**：监控 1000 台服务器的 CPU、内存、应用指标

**选型**：InfluxDB + Grafana

**理由**：
- 数据量中等（~100万点/秒）
- 需要和现有监控系统集成
- Telegraf 生态丰富

### 案例二：Kubernetes 微服务监控

**需求**：监控 100 个微服务的 QPS、延迟、错误率

**选型**：Prometheus + Thanos

**理由**：
- Kubernetes 原生
- pull 模式无需部署 agent
- AlertManager 告警方便

### 案例三：工业 IoT 平台

**需求**：接入 10 万个传感器，每秒上报 10 次

**选型**：TDengine

**理由**：
- 写入性能要求高
- 需要集群支持
- 存储成本敏感

---

## Java 客户端对比

```java
// InfluxDB
InfluxDB influxDB = InfluxDBFactory.connect("http://localhost:8086");
influxDB.write(Point.measurement("cpu")
    .tag("host", "server01")
    .addField("value", 45.2)
    .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
    .build());

// Prometheus
Retrofit retrofit = new Retrofit.Builder()
    .baseUrl("http://prometheus:9090/")
    .build();
PrometheusApi api = retrofit.create(PrometheusApi.class);
QueryResult result = api.query("rate(http_requests_total[5m])");

// TDengine
String sql = "INSERT INTO d1001 VALUES (NOW, 45.2)";
stmt.execute(sql);

// TimescaleDB
String sql = "INSERT INTO cpu (time, device_id, value) VALUES (NOW(), 'server01', 45.2)";
```

---

## 面试追问方向

- 你们项目用的时序数据库性能瓶颈在哪里？
- 如果数据量增长 10 倍，你会怎么扩容？

下一节，我们来了解时序数据库的查询优化。
