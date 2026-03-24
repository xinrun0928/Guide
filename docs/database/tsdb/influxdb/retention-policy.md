# InfluxDB 数据保留策略：数据的生命周期管理

你的监控数据已经存了 5 年，磁盘满了。

老板问：「能不能删掉旧数据？」

你说：「能，但删了就没法做年度对比了。」

老板说：「那就保留 2 年的吧。」

这就是**保留策略（Retention Policy）** 要解决的问题。

---

## 保留策略是什么？

保留策略定义了数据的**生命周期**：

```
┌─────────────────────────────────────────────────────────────┐
│                    Database: monitoring                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  Retention Policy: autogen                           │  │
│  │  Duration: INF (永久)                                │  │
│  │  Replication: 1                                      │  │
│  │                                                      │  │
│  │  ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐       │  │
│  │  │ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │ │ 6 │ │ 7 │ ...   │  │
│  │  └───┘ └───┘ └───┘ └───┘ └───┘ └───┘ └───┘       │  │
│  │  2024-03  2024-04  2024-05  2024-06  ...           │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

InfluxDB 会自动删除超过保留期限的数据。

---

## 保留策略参数

```sql
CREATE RETENTION POLICY <rp_name> ON <database>
    DURATION <duration>
    REPLICATION <n>
    [SHARD DURATION <duration>]
    [DEFAULT]
```

| 参数 | 说明 | 示例 |
|-----|------|------|
| DURATION | 数据保留时间 | 30d, 2h, 1w |
| REPLICATION | 副本数量（集群用）| 1, 2 |
| SHARD DURATION | 分片时长 | 1h, 1d, 1w |
| DEFAULT | 设为默认 RP | - |

---

## 创建保留策略

### 1. 30 天保留（短期）

```sql
CREATE RETENTION POLICY "30d" ON "monitoring"
    DURATION 30d
    REPLICATION 1
    SHARD DURATION 1d
    DEFAULT
```

### 2. 90 天保留（中期）

```sql
CREATE RETENTION POLICY "90d" ON "monitoring"
    DURATION 90d
    REPLICATION 1
    SHARD DURATION 7d
```

### 3. 1 年保留（长期）

```sql
CREATE RETENTION POLICY "1y" ON "monitoring"
    DURATION 365d
    REPLICATION 1
    SHARD DURATION 1w
```

---

## 多级保留策略

生产环境通常配置多个 RP：

```
短期 RP (30d)      ────→  高精度数据，用于实时监控
中期 RP (90d)      ────→  中等精度，用于趋势分析
长期 RP (1y)       ────→  低精度数据，用于年度对比
归档 RP (INF)       ────→  原始精度，按需启用
```

### 配置示例

```sql
-- 创建三个级别的 RP
CREATE RETENTION POLICY "30d" ON "monitoring"
    DURATION 30d REPLICATION 1 SHARD DURATION 1d DEFAULT;

CREATE RETENTION POLICY "90d" ON "monitoring"
    DURATION 90d REPLICATION 1 SHARD DURATION 7d;

CREATE RETENTION POLICY "1y" ON "monitoring"
    DURATION 365d REPLICATION 1 SHARD DURATION 1w;
```

---

## 数据写入指定 RP

### 1. 通过 Line Protocol

```bash
# 写入指定 RP
# 格式：database/rp:measurement
monitoring.30d:cpu,host=server01 cpu=45.2
```

### 2. 通过连续查询

```sql
-- 原始数据写入 autogen
-- 连续查询聚合后写入 30d RP
CREATE CONTINUOUS QUERY "cq_30d" ON "monitoring"
BEGIN
    SELECT MEAN(*) INTO "monitoring"."30d"."cpu_1m"
    FROM "monitoring"."autogen"."cpu"
    GROUP BY time(1m), *
END
```

### 3. Java 代码

```java
import org.influxdb.dto.Point;
import org.influxdb.InfluxDB;
import java.util.concurrent.TimeUnit;

public class RPWriteExample {
    private final InfluxDB influxDB;

    // 写入默认 RP
    public void writeToDefaultRP() {
        Point point = Point.measurement("cpu")
            .tag("host", "server01")
            .addField("value", 45.2)
            .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
            .build();

        influxDB.write("monitoring", "autogen", point);
    }

    // 写入指定 RP
    public void writeToSpecificRP() {
        Point point = Point.measurement("cpu")
            .tag("host", "server01")
            .addField("value", 45.2)
            .time(System.currentTimeMillis(), TimeUnit.MILLISECONDS)
            .build();

        // 写入 30d RP
        influxDB.write("monitoring", "30d", point);
    }
}
```

---

## RP 与 Shard 的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    Retention Policy                          │
│                    Duration: 30d                            │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Shard 0  │ │ Shard 1  │ │ Shard 2  │ │ Shard 3  │ ... │
│  │ Duration │ │ Duration │ │ Duration │ │ Duration │      │
│  │  1d      │ │  1d      │ │  1d      │ │  1d      │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│  03-01     03-02     03-03     03-04      (时间轴)         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键点**：

- Shard 是数据存储的物理单元
- 每个 Shard 属于一个 RP
- Shard Duration 决定每个 Shard 覆盖的时间范围

### Shard Duration 建议

| RP Duration | Shard Duration |
|------------|----------------|
| < 2 天 | 1h |
| >= 2 天，< 6 个月 | 1d |
| >= 6 个月，< 3 年 | 7d（1w）|
| >= 3 年 | 30d（1mo）|

---

## 修改和删除 RP

```sql
-- 修改 RP 的保留时间
ALTER RETENTION POLICY "30d" ON "monitoring"
    DURATION 60d

-- 设置默认 RP
ALTER RETENTION POLICY "30d" ON "monitoring" DEFAULT

-- 删除 RP（会删除所有数据！）
DROP RETENTION POLICY "old_rp" ON "monitoring"
```

---

## Java RP 管理

```java
import org.influxdb.dto.Query;
import org.influxdb.InfluxDB;

public class RetentionPolicyManager {
    private final InfluxDB influxDB;

    // 创建 RP
    public void createRP(String db, String rpName, String duration, boolean isDefault) {
        String sql = String.format(
            "CREATE RETENTION POLICY \"%s\" ON \"%s\" DURATION %s REPLICATION 1",
            rpName, db, duration);

        if (isDefault) {
            sql += " DEFAULT";
        }

        influxDB.query(new Query(sql, db));
    }

    // 查看所有 RP
    public void showRPs(String db) {
        Query query = new Query("SHOW RETENTION POLICIES ON \"" + db + "\"", db);
        influxDB.query(query, (consumer, result) -> {
            System.out.println(result);
        });
    }

    // 修改 RP
    public void alterRP(String db, String rpName, String newDuration) {
        String sql = String.format(
            "ALTER RETENTION POLICY \"%s\" ON \"%s\" DURATION %s",
            rpName, db, newDuration);
        influxDB.query(new Query(sql, db));
    }

    // 删除 RP
    public void dropRP(String db, String rpName) {
        String sql = String.format(
            "DROP RETENTION POLICY \"%s\" ON \"%s\"",
            rpName, db);
        influxDB.query(new Query(sql, db));
    }
}
```

---

## 数据过期机制

InfluxDB 的数据过期是**自动的**，基于 Shard：

```
当 Shard 的时间范围完全超出 RP Duration 时：
1. InfluxDB 标记该 Shard 为可删除
2. 后台任务定期清理过期的 Shard
3. 磁盘空间被释放
```

**注意**：
- 清理是按 Shard 进行的，不是按数据点
- 如果 Shard Duration = 1d，那么 1 天的数据要么全在，要么全删
- 实际删除时间可能略晚于 Duration

---

## 面试追问方向

- RP 和 Shard 有什么关系？
- 如果想保留特定数据超过 RP 期限怎么办？（提示：CQ + 另一个 RP）

下一节，我们来了解 InfluxDB 的 TSM 存储引擎。
