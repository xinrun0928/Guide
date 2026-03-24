# InfluxDB 数据模型：从概念到实践

很多人学 InfluxDB，第一步就被数据模型搞懵了。

Measurement、Tag、Field、Timestamp……这些概念到底是什么意思？

今天，我们把这些概念彻底讲清楚。

---

## 核心概念：一条数据点

InfluxDB 的数据点（Point）由四部分组成：

```
┌─────────────────────────────────────────────────────────────────┐
│                           Point（数据点）                        │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   Measurement（测量）                       │ │
│  │                        cpu_monitor                        │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────┐  ┌───────────────────────────┐ │
│  │     Tags（标签）           │  │     Fields（字段）         │ │
│  │  host = server01         │  │  usage_user = 45.2        │ │
│  │  region = us-east         │  │  usage_system = 12.3      │ │
│  │  role = web               │  │  usage_idle = 42.5       │ │
│  │                           │  │                           │ │
│  │  ✅ 建索引，可过滤/分组     │  │  ❌ 不建索引，存数据值     │ │
│  │  ✅ 低基数，重复值多        │  │  ✅ 高基数，唯一值多        │ │
│  └───────────────────────────┘  └───────────────────────────┘ │
│                                                                 │
│  Timestamp: 2024-03-15 10:00:00.000000000                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 概念对比：与关系型数据库类比

| InfluxDB 概念 | 类比 SQL | 说明 |
|-------------|---------|------|
| Measurement | Table | 类似数据库的表 |
| Tag | Indexed Column | 有索引的列，用于过滤和分组 |
| Field | Non-Indexed Column | 没有索引的列，存储数据 |
| Timestamp | Primary Key | 主键，时间戳 |
| Point | Row | 一行数据 |

---

## Tag vs Field：核心区别

这是 InfluxDB 最重要的设计决策：

| 特性 | Tag | Field |
|-----|-----|-------|
| 索引 | ✅ 自动索引 | ❌ 不索引 |
| 存储 | 字符串 | 任意类型 |
| 适用场景 | 过滤、分组 | 存储数值 |
| 基数 | 低基数 | 高基数 |
| 查询性能 | 快 | 慢（全表扫描）|

### 错误示例：把数据存成 Tag

```influxql
# 错误：把 user_id 存成 Tag
# user_id 唯一值太多，会导致 Tag 膨胀
user_id=s User,value=123 1234567890000000000

# 错误：把 CPU 值存成 Tag
# CPU 是数值，应该存成 Field
cpu=45 host=server01 1234567890000000000
```

### 正确示例：合理分配 Tag 和 Field

```influxql
# 正确：host 是 Tag（过滤用），cpu 是 Field（数值）
cpu_monitor,host=server01,region=us-east cpu=45.2 1234567890000000000

# 正确：状态码是 Tag（分组用），延迟是 Field（数值）
api_latency,method=GET,path=/api,status=200 latency=45 1234567890000000000
```

---

## Line Protocol：数据写入格式

InfluxDB 使用 Line Protocol 作为数据写入格式：

```
measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp
```

### 完整示例

```java
// 完整格式
cpu_monitor,host=server01,region=us-east usage_user=45.2,usage_system=12.3,usage_idle=42.5 1709808000000000000

// 简化格式（时间戳可以省略，会自动生成）
cpu_monitor,host=server01 usage_user=45.2
```

### Java 代码示例

```java
import org.influxdb.dto.Point;

public class InfluxDBWrite {
    private final InfluxDB influxDB;

    public void writeCpuMetric(String host, double userCpu, double systemCpu) {
        Point point = Point.measurement("cpu_monitor")
            .tag("host", host)
            .tag("region", "us-east")
            .addField("usage_user", userCpu)
            .addField("usage_system", systemCpu)
            .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
            .build();

        influxDB.write(Point.measurement("cpu_monitor")
            .tag("host", host)
            .addField("usage_user", userCpu)
            .build());
    }

    // 使用 POJO 写入
    public void writeWithPOJO(CpuMetric metric) {
        influxDB.writeMeasirementAsPOJO(metric, "cpu_monitor");
    }

    // 使用批量写入
    public void batchWrite(List&lt;CpuMetric&gt; metrics) {
        BatchPoints batchPoints = BatchPoints.database("monitoring")
            .tag("async", "true")
            .build();

        metrics.forEach(m -> {
            Point point = Point.measurement("cpu_monitor")
                .tag("host", m.getHost())
                .addField("usage_user", m.getUserCpu())
                .addField("usage_system", m.getSystemCpu())
                .time(m.getTimestamp(), TimeUnit.MILLISECONDS)
                .build();
            batchPoints.add(point);
        });

        influxDB.write(batchPoints);
    }
}
```

---

## Series：数据的逻辑组织

Series = Measurement + Tag 组合

```
Measurement: cpu_monitor
Tag: host=server01
→ Series 1

Measurement: cpu_monitor
Tag: host=server02
→ Series 2

Measurement: cpu_monitor
Tag: host=server01, region=us-east
→ Series 3
```

**理解 Series 的重要性**：

- 每个 Series 独立存储
- Series 数量 = Card(measurement) × Card(tag1) × Card(tag2) × ...
- Series 数量过多会影响性能（InfluxDB 推荐 < 100 万个 Series）

---

## Database 和 Retention Policy

```
┌─────────────────────────────────────────────────────────────────┐
│                         Database                                  │
│                        monitoring                                 │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              Retention Policy (RP)                          ││
│  │                                                             ││
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        ││
│  │  │ autogen     │  │ 30d         │  │ 7d          │        ││
│  │  │ (永久)      │  │ (保留30天)  │  │ (保留7天)   │        ││
│  │  └─────────────┘  └─────────────┘  └─────────────┘        ││
│  │                                                             ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

```sql
-- 创建数据库
CREATE DATABASE monitoring

-- 创建保留策略
CREATE RETENTION POLICY "30d" ON monitoring
    DURATION 30d
    REPLICATION 1
    DEFAULT

CREATE RETENTION POLICY "7d" ON monitoring
    DURATION 7d
    REPLICATION 1
    SHARD DURATION 1d
```

---

## Telegraf：数据采集器

InfluxDB 通常配合 Telegraf 使用：

```toml
# /etc/telegraf/telegraf.conf

# 输入插件：收集 CPU 数据
[[inputs.cpu]]
  percpu = true
  totalcpu = false
  collect_cpu_time = false

# 输入插件：收集内存数据
[[inputs.mem]]
  # 无需配置，使用默认参数

# 输入插件：收集 MySQL 数据
[[inputs.mysql]]
  servers = ["tcp://localhost:3306"]
  username = "telegraf"
  password = "password"

# 输出插件：写入 InfluxDB
[[outputs.influxdb]]
  urls = ["http://localhost:8086"]
  database = "monitoring"
  retention_policy = "30d"
```

---

## 面试追问方向

- InfluxDB 的 Tag 为什么能提高查询性能？
- 如何避免 Series 数量膨胀？

下一节，我们来了解 InfluxDB 的 Line Protocol。
