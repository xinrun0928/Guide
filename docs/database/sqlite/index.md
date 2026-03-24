# SQLite 索引与查询优化

你可能听过这句话：「SQLite 没有查询优化器，索引就是摆设。」

这话对了一半。

SQLite 的优化器确实比 MySQL 简单得多，但这不意味着索引没用。**用对了索引，SQLite 可以快 1000 倍；用错了，SQLite 依然会优雅地全表扫描。**

---

## SQLite 索引的原理

和 MySQL 一样，SQLite 的索引也是 B-Tree 结构。区别在于：MySQL 用的是 B+Tree，SQLite 用的是经典 B-Tree。

**B-Tree vs B+Tree 的核心区别：**

```
B-Tree（SQLite）：
     [10 | 20 | 30]          <-- 节点本身就存数据
        /    \    \
      [5]   [15]  [25|35]   <-- 叶子节点没有链表

B+Tree（MySQL）：
     [10 | 20 | 30]          <-- 只存索引，不存数据
        /    \    \
      ...    ...    ...     <-- 非叶子节点不连成链表
      ↓      ↓      ↓
   数据链表 ←———→  ←———→     <-- 叶子节点连成链表，范围查询快
```

**B-Tree 的优势**：深度更浅，查询可能更快到达叶子节点

**B+Tree 的优势**：叶子节点链表，范围查询只需遍历链表，不用回树

**结论**：两者各有千秋，别被 MySQL 限制了思维。

---

## 何时创建索引？

这是 SQLite 中最容易被忽视的问题。

### 常见误区

**误区一：查询慢就加索引**

```sql
-- 这条查询，如果没有合适的索引，全表扫描很慢
SELECT * FROM orders WHERE status = 'completed' AND amount > 100;

-- 加了索引就好了吗？
CREATE INDEX idx_status ON orders(status);  -- 可能还不够
CREATE INDEX idx_amount ON orders(amount); -- 两个单列索引？
CREATE INDEX idx_composite ON orders(status, amount); -- 这个更好
```

**关键点**：如果是范围查询 + 过滤条件的组合查询，复合索引比单列索引更有效。

**误区二：索引越多越好**

索引是有代价的：

- 每次 INSERT/UPDATE/DELETE，索引也需要更新
- 索引占用磁盘空间
- SQLite 没有在线创建索引的能力（建索引会锁表）

### 索引创建原则

| 场景 | 建议 |
|-----|------|
| 主键、唯一约束 | 自动创建，无需手动 |
| WHERE 条件中频繁出现的列 | 考虑索引 |
| JOIN 的连接列 | 必须有索引 |
| ORDER BY/GROUP BY 列 | 考虑索引 |
| 高基数字段（唯一值多） | 效果好 |
| 低基数字段（重复值多） | 效果差，可能不需要 |

---

## 复合索引与最左前缀原则

这是最容易踩坑的地方。

```sql
-- 创建复合索引（注意顺序！）
CREATE INDEX idx_user_status ON users(status, age);

-- 这些查询能命中索引：
SELECT * FROM users WHERE status = 'active';                    -- ✅
SELECT * FROM users WHERE status = 'active' AND age = 25;       -- ✅
SELECT * FROM users WHERE status = 'active' AND age > 18;       -- ✅

-- 这些查询不能命中索引（或只能部分命中）：
SELECT * FROM users WHERE age = 25;                              -- ❌
SELECT * FROM users WHERE age > 18;                              -- ❌
```

**原理**：复合索引就像一本按「姓氏 + 名字」排序的电话簿。你必须先按姓氏查找，才能在同名的人群中按名字筛选。如果你只给名字，没有姓氏，根本查不了。

---

## EXPLAIN QUERY PLAN：索引诊断神器

SQLite 提供了 `EXPLAIN QUERY PLAN`，帮你看清查询是否用到了索引。

```sql
-- 查看查询计划
EXPLAIN QUERY PLAN
SELECT * FROM users WHERE email = 'test@example.com';

-- 输出：
-- SCAN TABLE users              <-- 全表扫描，不好
-- USING INDEX idx_email         <-- 使用了索引，好

-- 复合查询计划
EXPLAIN QUERY PLAN
SELECT * FROM orders
WHERE customer_id = 100 AND order_date > '2024-01-01';

-- 输出：
-- SEARCH TABLE orders USING INDEX idx_customer (customer_id=?)  <-- 先用 customer_id 索引定位
--   WHERE order_date > '2024-01-01'                              <-- 再过滤日期
```

### 常见的查询计划类型

| 关键词 | 含义 |
|-------|------|
| SCAN TABLE | 全表扫描，O(n) |
| SEARCH TABLE USING INDEX | 索引查找，O(log n) |
| USING INDEX | 使用了索引 |
| USING ROWID | 使用了隐式 Rowid |
| USING CONSTRAINT | 满足索引约束 |

---

## SQLite 查询优化的实用技巧

### 1. 使用 EXPLAIN 诊断

```java
public void diagnoseQuery(Connection conn) throws SQLException {
    String sql = "SELECT * FROM users WHERE email = ?";

    try (Statement stmt = conn.createStatement();
         ResultSet rs = stmt.executeQuery("EXPLAIN QUERY PLAN " + sql)) {

        while (rs.next()) {
            System.out.println("Detail: " + rs.getString("detail"));
        }
    }
}
```

### 2. ANALYZE 命令：更新统计信息

SQLite 的优化器依赖统计信息来决定使用哪个索引。如果数据变化很大，记得重新分析：

```sql
-- 重新分析表，更新统计信息
ANALYZE users;

-- 整个数据库
PRAGMA analysis_limit = 0;  -- 0 表示不限分析行数
ANALYZE;
```

### 3. 批量写入优化

```java
// 错误的做法：每条记录一个事务
public void badBatchInsert(Connection conn) throws SQLException {
    for (User user : users) {
        conn.setAutoCommit(true);  // 每条自动提交
        stmt.executeUpdate("INSERT INTO users VALUES (...)");
    }
}

// 正确的做法：批量事务
public void goodBatchInsert(Connection conn) throws SQLException {
    conn.setAutoCommit(false);  // 一个事务
    try {
        for (User user : users) {
            stmt.executeUpdate("INSERT INTO users VALUES (...)");
        }
        conn.commit();  // 统一提交
    } catch (Exception e) {
        conn.rollback();  // 失败回滚
    }
}
```

批量插入时，开启事务可以快 **10-100 倍**。

### 4. PRAGMA 调优

```sql
-- 开启同步模式（平衡性能和安全）
PRAGMA synchronous = NORMAL;  -- 0=OFF, 1=NORMAL, 2=FULL

-- 设置缓存大小（负数表示 KB，正数表示页数）
PRAGMA cache_size = -64000;  -- 64 MB 缓存

-- 开启内存映射（减少 I/O）
PRAGMA mmap_size = 268435456;  -- 256 MB 内存映射
```

---

## 面试追问方向

- SQLite 和 MySQL 的索引实现有什么本质区别？
- 为什么 SQLite 的查询优化器比 MySQL 简单？（提示：单文件、无并发、架构设计哲学）

下一节，我们来聊聊 SQLite 最常被吐槽的问题：并发限制。
