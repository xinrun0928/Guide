# HBase 与 Hive 集成：让 Hive 读写 HBase

Hive 擅长离线分析，HBase 擅长实时查询。

两者结合，完美。

---

## Hive-HBase 集成架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Hive-HBase 集成架构                         │
│                                                             │
│  ┌─────────────────┐      ┌─────────────────┐           │
│  │  HiveQL         │      │  HBase API      │           │
│  │  (离线分析)     │      │  (实时查询)     │           │
│  └────────┬────────┘      └────────┬────────┘           │
│           │                          │                      │
│           ↓                          ↓                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 HBase Storage Handler              │   │
│  │  让 Hive 读写 HBase 作为数据源                   │   │
│  └─────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ↓                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │                    HBase                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  │   │
│  │  │ Region 1 │  │ Region 2 │  │ Region 3 │  │   │
│  │  └───────────┘  └───────────┘  └───────────┘  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 基本操作

### 1. 创建 HBase 表

```sql
-- 在 Hive 中创建映射到 HBase 的表
CREATE TABLE hive_hbase_users (
    user_id STRING,
    name STRING,
    email STRING,
    created_at TIMESTAMP
)
STORED BY 'org.apache.hadoop.hive.hbase.HBaseStorageHandler'
WITH SERDEPROPERTIES (
    "hbase.columns.mapping" =
        ":key,info:name,info:email,info:created_at"
)
TBLPROPERTIES ("hbase.table.name" = "users");
```

### 2. 插入数据

```sql
-- 从 Hive 表插入到 HBase
INSERT OVERWRITE TABLE hive_hbase_users
SELECT user_id, name, email, created_at
FROM staging_users;

-- 直接插入
INSERT INTO TABLE hive_hbase_users
VALUES ('u001', '张三', 'zhang@example.com', CURRENT_TIMESTAMP);
```

### 3. 查询数据

```sql
-- 查询 HBase 数据（使用 HiveQL）
SELECT user_id, name, email
FROM hive_hbase_users
WHERE user_id = 'u001';

-- 聚合查询
SELECT COUNT(*) as total,
       COUNT(DISTINCT user_id) as unique_users
FROM hive_hbase_users;
```

---

## Java 代码

### 通过 Hive 读写 HBase

```java
// Hive 连接
public class HiveHBaseIntegration {
    private static final String HIVE_URL =
        "jdbc:hive2://hive-server:10000";

    // 写入 HBase（通过 Hive）
    public void writeToHBase(List<User> users) throws Exception {
        String sql = "INSERT INTO TABLE hive_hbase_users VALUES (?, ?, ?, ?)";

        try (Connection conn = DriverManager.getConnection(HIVE_URL);
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            for (User user : users) {
                stmt.setString(1, user.getUserId());
                stmt.setString(2, user.getName());
                stmt.setString(3, user.getEmail());
                stmt.setTimestamp(4, Timestamp.valueOf(user.getCreatedAt()));
                stmt.addBatch();
            }

            stmt.executeBatch();
        }
    }

    // 读取 HBase（通过 Hive）
    public List<User> readFromHBase() throws Exception {
        String sql = "SELECT user_id, name, email, created_at FROM hive_hbase_users";

        List<User> users = new ArrayList<>();

        try (Connection conn = DriverManager.getConnection(HIVE_URL);
             Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {

            while (rs.next()) {
                User user = new User();
                user.setUserId(rs.getString("user_id"));
                user.setName(rs.getString("name"));
                user.setEmail(rs.getString("email"));
                user.setCreatedAt(rs.getTimestamp("created_at").toLocalDateTime());
                users.add(user);
            }
        }
        return users;
    }
}
```

---

## 高级特性

### 1. 列族映射

```sql
-- 多列族映射
CREATE TABLE hive_hbase_logs (
    log_id STRING,
    info_level STRING,
    info_message STRING,
    data_payload STRING,
    data_timestamp BIGINT
)
STORED BY 'org.apache.hadoop.hive.hbase.HBaseStorageHandler'
WITH SERDEPROPERTIES (
    "hbase.columns.mapping" =
        ":key,info:level,info:message,data:payload,data:timestamp"
)
TBLPROPERTIES ("hbase.table.name" = "logs");
```

### 2. 复合 RowKey

```sql
-- 复合 RowKey
CREATE TABLE hive_hbase_orders (
    order_user_id STRING,      -- RowKey 第一部分
    order_date STRING,          -- RowKey 第二部分
    amount DECIMAL(10,2),
    status STRING
)
STORED BY 'org.apache.hadoop.hive.hbase.HBaseStorageHandler'
WITH SERDEPROPERTIES (
    "hbase.columns.mapping" =
        ":key,info:amount,info:status"
)
TBLPROPERTIES ("hbase.table.name" = "orders");

-- 查询特定用户的所有订单
SELECT * FROM hive_hbase_orders
WHERE order_user_id = 'u001';
```

### 3. 时间序列数据

```sql
-- 时序数据存储
CREATE TABLE hive_hbase_metrics (
    metric_key STRING,
    metric_value DOUBLE,
    metric_timestamp BIGINT
)
STORED BY 'org.apache.hadoop.hive.hbase.HBaseStorageHandler'
WITH SERDEPROPERTIES (
    "hbase.columns.mapping" =
        ":key,data:value,data:timestamp"
)
TBLPROPERTIES (
    "hbase.table.name" = "metrics",
    "hbase.table.timestamp.type" = "USR_TIMESPEC"
);
```

---

## 数据同步

### HBase 到 Hive

```sql
-- 全量同步
INSERT OVERWRITE TABLE hive_users
SELECT * FROM hbase_users;

-- 增量同步（基于时间戳）
INSERT OVERWRITE TABLE hive_users
SELECT * FROM hbase_users
WHERE created_at > (SELECT MAX(created_at) FROM hive_users);
```

### Hive 到 HBase

```sql
-- 批量同步
INSERT OVERWRITE TABLE hive_hbase_users
SELECT user_id, name, email, created_at
FROM staging_users
WHERE created_at > CURRENT_DATE - 1;
```

---

## 性能优化

### 1. 使用 Tez 引擎

```sql
SET hive.execution.engine=tez;
SET tez.queue.name=default;
```

### 2. 调整并行度

```sql
SET hive.vectorized.execution.enabled=true;
SET hive.vectorized.execution.reduce.enabled=true;
```

### 3. 批量写入

```sql
SET hive.insert.into.multitable.buckets=true;
SET hive.optimize.sort.dynamic.partition=true;
```

---

## 使用场景

| 场景 | 方案 | 说明 |
|-----|------|------|
| **历史数据归档** | Hive → HBase | 冷数据存入 HBase |
| **实时+离线分析** | HBase + Hive | 实时查询 HBase，离线分析 Hive |
| **数据导出** | HBase → Hive → 外部系统 | 通过 Hive 导出数据 |
| **ETL Pipeline** | 多种数据源 → Hive → HBase | 数据清洗后存入 HBase |

---

## 面试追问方向

- Hive-HBase 集成的优势是什么？
- 如何实现 HBase 和 Hive 的增量数据同步？

下一节，我们来了解 HBase 的二级索引。
