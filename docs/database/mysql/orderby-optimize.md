# ORDER BY 优化：告别 Using filesort

ORDER BY 是 SQL 中最常用的子句之一，但也是最容易引发性能问题的。

当 EXPLAIN 的 Extra 列出现 `Using filesort` 时，你需要注意了。

---

## ORDER BY 的执行过程

### 无索引时的排序

```sql
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;
```

```
执行流程：
┌─────────────────────────────────────────────────────────────┐
│ 1. 全表扫描 orders 表                                       │
│ 2. 读取所有满足 WHERE 条件的行                              │
│ 3. 将行数据写入 sort_buffer                                  │
│ 4. 在 sort_buffer 中排序                                    │
│ 5. 返回排序后的结果                                          │
└─────────────────────────────────────────────────────────────┘
```

### 有索引时的排序

```sql
-- 假设有索引 idx_status_created (status, created_at)
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;
```

```
执行流程：
┌─────────────────────────────────────────────────────────────┐
│ 1. 扫描 idx_status_created 索引                             │
│ 2. 按索引顺序直接返回（天然有序）                            │
│ 3. 返回结果                                                  │
└─────────────────────────────────────────────────────────────┘
```

---

## Using filesort 的触发条件

### 条件一：ORDER BY 字段没有索引

```sql
-- created_at 没有索引
SELECT * FROM orders ORDER BY created_at;
-- Extra: Using filesort
```

### 条件二：ORDER BY 字段在索引中，但不是最左前缀

```sql
-- 索引：(status, created_at)
-- ORDER BY created_at 不是最左前缀
SELECT * FROM orders ORDER BY created_at;
-- Extra: Using filesort
```

### 条件三：ORDER BY 使用了表达式或函数

```sql
-- 使用函数
SELECT * FROM orders ORDER BY YEAR(created_at);
-- Extra: Using filesort
```

### 条件四：ORDER BY 和 WHERE 字段不匹配

```sql
-- 索引：(status, created_at)
-- WHERE status = 'pending'，但 ORDER BY user_id
SELECT * FROM orders WHERE status = 'pending' ORDER BY user_id;
-- Extra: Using filesort
```

---

## ORDER BY 优化方案

### 方案一：创建合适的索引

让 ORDER BY 的字段是索引的最左前缀。

```sql
-- 查询
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;

-- 创建索引（覆盖 WHERE + ORDER BY）
CREATE INDEX idx_status_created ON orders(status, created_at DESC);
```

### 方案二：覆盖索引避免回表

如果 SELECT 的字段也在索引中，不需要回表。

```sql
-- 只查需要的字段
SELECT id, status, created_at
FROM orders
WHERE status = 'pending'
ORDER BY created_at DESC;

-- 覆盖索引
CREATE INDEX idx_status_created_covering
ON orders(status, created_at DESC, id, status);
```

### 方案三：减少排序数据量

```sql
-- 加上 LIMIT
SELECT * FROM orders
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 100;  -- 只排序 100 条
```

---

## 多字段 ORDER BY

### 场景：ORDER BY a, b

```sql
SELECT * FROM orders
WHERE status = 'pending'
ORDER BY user_id, created_at DESC;
```

**索引设计**：`(status, user_id, created_at)`

### 多字段 ORDER BY 的坑

ORDER BY 的字段顺序必须和索引一致。

```sql
-- 索引：(a, b, c)
-- 有效：ORDER BY a, b
-- 有效：ORDER BY a, b, c
-- 无效：ORDER BY b, a  -- 顺序不对
-- 无效：ORDER BY a, c  -- 跳过 b
```

### ASC 和 DESC 混合

```sql
-- 混合排序
SELECT * FROM orders
ORDER BY user_id ASC, created_at DESC;
```

**索引设计**：`CREATE INDEX idx_user_created ON orders(user_id ASC, created_at DESC);`

---

## filesort 的排序算法

### 双路排序（MySQL 4.1 之前）

1. 读取所有行到 sort_buffer，保存排序字段和行指针
2. 在 sort_buffer 中排序
3. 根据行指针回表读取完整数据

**缺点**：大量随机 I/O

### 单路排序（MySQL 4.1+）

1. 读取所有需要的列到 sort_buffer（包括 SELECT 的列）
2. 在 sort_buffer 中排序
3. 直接返回结果

**缺点**：如果 SELECT 的列很多，sort_buffer 可能不够用

### 排序优化参数

```sql
-- 查看排序缓冲区大小
SHOW VARIABLES LIKE 'sort_buffer_size';
-- 默认 256KB

-- 增大排序缓冲区
SET sort_buffer_size = 1024 * 1024 * 4;  -- 4MB
```

---

## Java 代码：ORDER BY 动态构建

```java
@Service
public class QueryBuilder {

    /**
     * 构建动态 ORDER BY
     */
    public String buildOrderBy(String sortField, String sortOrder,
                              List&lt;String&gt; allowedFields) {
        // 校验排序字段，防止 SQL 注入
        if (!allowedFields.contains(sortField)) {
            throw new IllegalArgumentException("不允许的排序字段");
        }

        // 校验排序方向
        String order = "ASC".equalsIgnoreCase(sortOrder) ? "ASC" : "DESC";

        return sortField + " " + order;
    }

    /**
     * 示例用法
     */
    public List&lt;Order&gt; searchOrders(String sortField, String sortOrder) {
        String orderBy = buildOrderBy(sortField, sortOrder,
            Arrays.asList("id", "created_at", "amount"));

        String sql = String.format(
            "SELECT * FROM orders WHERE status = 'pending' ORDER BY %s",
            orderBy
        );

        return jdbcTemplate.queryForList(sql, Order.class);
    }
}
```

---

## ORDER BY 优化 checklist

| 检查项 | 说明 |
|--------|------|
| ORDER BY 字段有索引吗？ | 没有就加索引 |
| 是索引的最左前缀吗？ | 不是就调整索引顺序 |
| SELECT 的字段能在索引中吗？ | 能的话就是覆盖索引 |
| 排序数据量太大吗？ | 考虑加 LIMIT |
| 用了函数或表达式吗？ | 避免在 ORDER BY 中使用函数 |

---

## 面试追问方向

- filesort 是在内存还是磁盘排序？
- 双路排序和单路排序的区别？
- ORDER BY 的字段不在索引中，但加了 LIMIT 还需要排序吗？

> 当数据量超过 sort_buffer_size 时，会使用磁盘排序。MySQL 会优先使用单路排序，但如果 sort_buffer 不够用，会退化为双路排序。加了 LIMIT 仍然需要排序，只是排序的数据量减少了。
