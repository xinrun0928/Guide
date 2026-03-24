# Apache Phoenix：让 HBase 支持 SQL

HBase 只能按 RowKey 查询，想用 SQL？

Phoenix 就是答案。

---

## Phoenix 是什么？

Phoenix 是 HBase 的 SQL 层，让 HBase 支持标准 SQL 查询。

```
┌─────────────────────────────────────────────────────────────┐
│                    Phoenix 架构                                │
│                                                             │
│                    SQL Client                                │
│                         │                                     │
│                         ↓                                     │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                  Phoenix Server                          │  │
│  │                                                      │  │
│  │  ┌───────────────────────────────────────────────┐  │  │
│  │  │  SQL Parser → Optimizer → Phoenix Executor   │  │  │
│  │  └───────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────┘  │
│                         │                                     │
│                         ↓                                     │
│              ┌───────────────────────┐                       │
│              │        HBase         │                       │
│              └───────────────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Phoenix 特性

| 特性 | 说明 |
|-----|------|
| **标准 SQL** | 支持 DDL、DML、JOIN、子查询 |
| **二级索引** | 索引表自动维护 |
| **函数** | 聚合、窗口函数、用户自定义函数 |
| **JDBC** | 标准 JDBC 接口 |
| **鹧优化** | 计算下推、并行执行 |

---

## 基本操作

### 1. 创建表

```sql
-- 创建表（会自动创建 HBase 表）
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR PRIMARY KEY,
    name VARCHAR NOT NULL,
    email VARCHAR,
    created_at TIMESTAMP,
    status TINYINT
);

-- 创建带约束的表
CREATE TABLE orders (
    order_id VARCHAR PRIMARY KEY,
    user_id VARCHAR NOT NULL,
    amount DECIMAL(10,2),
    created_at TIMESTAMP,
    CONSTRAINT pk_order PRIMARY KEY (order_id, created_at)
);

-- 创建索引表
CREATE INDEX idx_email ON users(email);
CREATE LOCAL INDEX idx_user_order ON orders(user_id);
```

### 2. CRUD 操作

```sql
-- 插入
INSERT INTO users (user_id, name, email, created_at, status)
VALUES ('u001', '张三', 'zhang@example.com', CURRENT_DATE(), 1);

-- 批量插入
UPSERT INTO users (user_id, name, email) VALUES
    ('u001', '张三', 'zhang@example.com'),
    ('u002', '李四', 'li@example.com');

-- 查询
SELECT * FROM users WHERE user_id = 'u001';

-- 带条件查询
SELECT user_id, name, email
FROM users
WHERE status = 1
ORDER BY created_at DESC
LIMIT 10;

-- 聚合查询
SELECT status, COUNT(*) as cnt
FROM users
GROUP BY status
HAVING COUNT(*) > 10;
```

### 3. JOIN 查询

```sql
-- JOIN 查询
SELECT
    u.user_id,
    u.name,
    COUNT(o.order_id) as order_count,
    SUM(o.amount) as total_amount
FROM users u
LEFT JOIN orders o ON u.user_id = o.user_id
WHERE u.created_at > DATEADD(NOW(), -30, 'DAY')
GROUP BY u.user_id, u.name
ORDER BY total_amount DESC;
```

---

## Java 代码

### JDBC 连接

```java
// Phoenix JDBC 连接
public class PhoenixClient {
    private static final String URL =
        "jdbc:phoenix:zk1,zk2,zk3:2181:/hbase";

    public Connection getConnection() throws SQLException {
        return DriverManager.getConnection(URL);
    }

    // 使用示例
    public User getUser(String userId) throws SQLException {
        String sql = "SELECT * FROM users WHERE user_id = ?";

        try (Connection conn = getConnection();
             PreparedStatement stmt = conn.prepareStatement(sql)) {

            stmt.setString(1, userId);

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    User user = new User();
                    user.setUserId(rs.getString("user_id"));
                    user.setName(rs.getString("name"));
                    user.setEmail(rs.getString("email"));
                    return user;
                }
            }
        }
        return null;
    }
}
```

### CRUD 操作

```java
// 批量写入
public void batchInsert(List<User> users) throws SQLException {
    String sql = "UPSERT INTO users (user_id, name, email, status) VALUES (?, ?, ?, ?)";

    try (Connection conn = getConnection();
         PreparedStatement stmt = conn.prepareStatement(sql)) {

        conn.setAutoCommit(false);

        for (User user : users) {
            stmt.setString(1, user.getUserId());
            stmt.setString(2, user.getName());
            stmt.setString(3, user.getEmail());
            stmt.setInt(4, user.getStatus());
            stmt.addBatch();
        }

        stmt.executeBatch();
        conn.commit();
    }
}

// 聚合查询
public Map<Integer, Long> getUserCountByStatus() throws SQLException {
    String sql = "SELECT status, COUNT(*) FROM users GROUP BY status";

    Map<Integer, Long> result = new HashMap<>();

    try (Connection conn = getConnection();
         Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery(sql)) {

        while (rs.next()) {
            result.put(
                rs.getInt("status"),
                rs.getLong("COUNT(1)")
            );
        }
    }
    return result;
}
```

---

## 二级索引

### 创建索引

```sql
-- 全局索引（适合高并发读取）
CREATE INDEX idx_email ON users(email);

-- 本地索引（适合写入多、读取少的场景）
CREATE LOCAL INDEX idx_status ON users(status);

-- 覆盖索引（包含额外列，避免回表）
CREATE INDEX idx_name_covering ON users(name)
    INCLUDE (email, status);

-- 函数索引
CREATE INDEX idx_lower_email ON users(UPPER(email));
```

### 索引查询

```sql
-- 查询会使用索引
SELECT * FROM users WHERE email = 'test@example.com';

-- 查看执行计划
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
```

---

## 性能优化

### 1. Salt Bucket

```sql
-- 使用 Salt 分散热点
CREATE TABLE orders (
    order_id VARCHAR NOT NULL,
    user_id VARCHAR,
    amount DECIMAL(10,2),
    created_at TIMESTAMP,
    CONSTRAINT pk PRIMARY KEY (order_id, created_at)
) SALT_BUCKETS = 10;  -- 分成 10 个 bucket
```

### 2. 分区表

```sql
-- 预分区
CREATE TABLE events (
    event_id VARCHAR NOT NULL,
    event_type VARCHAR,
    created_at TIMESTAMP,
    data VARCHAR,
    CONSTRAINT pk PRIMARY KEY (event_id, created_at)
) PARTITION BY (CREATED_AT DATE);

-- 查询分区
SELECT * FROM events WHERE CREATED_AT BETWEEN '2024-01-01' AND '2024-01-31';
```

### 3. 优化查询

```sql
-- 避免全表扫描
SELECT /*+ NO_CACHE */ * FROM users WHERE user_id = 'u001';

-- 限制返回行数
SELECT /*+ PARALLEL(4) */ * FROM orders LIMIT 1000;
```

---

## 与原生 HBase API 对比

| 方面 | Phoenix | 原生 HBase API |
|-----|--------|---------------|
| **查询语法** | SQL | Scan + Filter |
| **开发效率** | 高 | 低 |
| **性能** | 中等（计算下推）| 高（直接操作）|
| **二级索引** | 原生支持 | 需要自己实现 |
| **JOIN** | 支持 | 不支持 |
| **适用场景** | 简单查询、报表 | 复杂业务逻辑 |

---

## 面试追问方向

- Phoenix 的二级索引和 HBase 的协处理器索引有什么区别？
- Phoenix 如何实现查询下推？

下一节，我们来了解 HBase 与 Hive 的集成。
