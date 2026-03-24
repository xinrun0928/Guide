# 联合索引：多字段索引的正确打开方式

假设你有这样一张表：

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT,
    status VARCHAR(20),
    amount DECIMAL(10,2),
    created_at DATETIME
);
```

业务上经常有这样的查询：

```sql
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
```

你可能会想：给它加两个单列索引？

```sql
CREATE INDEX idx_user_id ON orders(user_id);
CREATE INDEX idx_status ON orders(status);
```

但 MySQL 只能选择一个索引。选了 `idx_user_id`，`status` 的过滤条件就浪费了。

怎么办？**联合索引**。

---

## 联合索引的原理

联合索引 `(a, b, c)` 的本质是：**按 a 排序，a 相同的情况下按 b 排序，b 相同的情况下按 c 排序**。

这就像一本按「省份-城市-区县」排序的电话本：

```
联合索引 (user_id, status, created_at) 结构：

第一层：user_id = 100 的所有记录
        ├── status = 'paid'，created_at = 2024-01-01
        ├── status = 'paid'，created_at = 2024-01-02
        ├── status = 'pending'，created_at = 2024-01-03
        └── status = 'cancelled'，created_at = 2024-01-04

第一层：user_id = 101 的所有记录
        └── ...

第二层：user_id = 200 的所有记录
        └── ...
```

---

## 最左前缀原则

这是联合索引最核心的规则：**查询必须从最左边的列开始，才能使用索引。**

| 查询条件 | 是否能用索引 (user_id, status, created_at) |
|----------|---------------------------------------------|
| `WHERE user_id = 100` | ✅ 能，只用了第一层 |
| `WHERE user_id = 100 AND status = 'paid'` | ✅ 能，用了两层 |
| `WHERE user_id = 100 AND status = 'paid' AND created_at > '2024-01-01'` | ✅ 能，用了三层 |
| `WHERE status = 'paid'` | ❌ 不能，跳过了 user_id |
| `WHERE user_id > 100` | ✅ 能，但只能用到第一层（范围查询阻断） |
| `WHERE user_id = 100 AND created_at > '2024-01-01'` | ⚠️ 部分能用，只能用到 user_id |

### 范围查询阻断

```java
// 范围查询为什么阻断？
// 例如：WHERE user_id = 100 AND status > 'paid' AND created_at = '2024-01-01'

public void queryRange() {
    // user_id = 100：精确定位到 user_id=100 的起始位置
    // status > 'paid'：这是一个范围，status 不再有序
    // created_at = '2024-01-01'：因为 status 是无序的，无法利用索引

    // 结论：只能用 user_id，status 和 created_at 无法走索引
}
```

---

## 字段顺序的艺术

联合索引的字段顺序是**最有讲究的地方**。

### 原则一：等值查询的字段放前面

```sql
-- 查询 1：WHERE user_id = 100 AND status = 'paid'
-- 查询 2：WHERE user_id = 100 AND status > 'paid'

-- 正确顺序：user_id（等值）在前，status（范围）在后
CREATE INDEX idx_user_status ON orders(user_id, status);
```

### 原则二：区分度高的字段放前面

区分度：字段值的种类数量 / 总行数。区分度越高，索引过滤效果越好。

```sql
-- status 只有 4 种值：pending, paid, shipped, cancelled
-- user_id 有上百万种值

-- user_id 区分度高，应该放前面
CREATE INDEX idx_user_status ON orders(user_id, status);
```

### 原则三：考虑查询的覆盖性

如果经常需要查询 `user_id + status + created_at`，可以把三个字段都包含在索引中：

```sql
-- 覆盖查询：SELECT user_id, status, created_at FROM orders WHERE user_id = ?
CREATE INDEX idx_user_status_time ON orders(user_id, status, created_at);
```

---

## 联合索引 vs 多个单列索引

| 对比项 | 联合索引 | 多个单列索引 |
|--------|----------|---------------|
| 查询效率 | 单次索引查找，多字段过滤 | 可能选择最优索引 |
| 索引存储 | 一个索引树，占用空间小 | 多个索引树，占用空间大 |
| 更新开销 | 插入/更新时维护一个索引 | 维护多个索引 |
| 覆盖查询 | 可能实现覆盖索引 | 只能覆盖单字段查询 |
| 适用场景 | 多条件固定组合查询 | 单字段等值/范围查询多 |

### 什么时候用联合索引？

1. **多个字段经常作为 WHERE 条件一起出现**
2. **需要支持 ORDER BY + WHERE 组合**
3. **需要实现覆盖索引减少回表**

### 什么时候用多个单列索引？

1. **字段是独立的查询条件，不经常组合**
2. **查询优化器能正确选择最优索引**

---

## 实战示例

### 场景：电商订单表

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    status VARCHAR(20) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    created_at DATETIME NOT NULL,
    INDEX idx_user_status (user_id, status),           -- 查询 1
    INDEX idx_user_created (user_id, created_at),       -- 查询 2
    INDEX idx_status_created (status, created_at)        -- 查询 3
);
```

查询模式分析：

```sql
-- 查询 1：用户的所有订单（按状态筛选）
SELECT * FROM orders WHERE user_id = ? AND status = ?;
-- ✅ idx_user_status 完全覆盖

-- 查询 2：用户的订单（按时间范围）
SELECT * FROM orders WHERE user_id = ? AND created_at BETWEEN ? AND ?;
-- ✅ idx_user_created 完全覆盖

-- 查询 3：某状态的所有订单（按时间排序）
SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 100;
-- ✅ idx_status_created 完全覆盖

-- 查询 4：查用户的所有订单
SELECT * FROM orders WHERE user_id = ?;
-- ✅ idx_user_status 可以使用（只用到 user_id）
```

---

## 面试追问方向

- `WHERE a = 1 AND b > 2 AND c = 3`，联合索引 (a, b, c) 能用到几个字段？
- 联合索引 `(a, b)` 和两个单列索引 `idx_a(a)` + `idx_b(b)` 有什么区别？
- 如果查询是 `WHERE b = 1`，联合索引 (a, b) 能不能用？

> 答案：范围查询（`>`、`<`、`LIKE`）会阻断后续字段使用索引，所以只能用到 a 和 b 两个字段。
