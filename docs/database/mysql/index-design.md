# 索引设计原则：写出高性能 SQL 的诀窍

很多人以为索引就是「加个索引」这么简单。

但同样是加索引，有人加完之后查询从 10 秒变成 50 毫秒，有人加完之后表反而更慢了。

区别在哪？**索引设计是一门艺术。**

---

## 索引设计的核心原则

### 原则一：区分度高的字段优先

区分度 = 字段值种类数 / 总行数。区分度越高，索引过滤效果越好。

```sql
-- 性别字段：只有男/女两种值，区分度 ≈ 0.0001（假设100万用户）
-- 给性别加索引，基本没用

-- user_id：有100万个不同值，区分度 ≈ 1
-- 给 user_id 加索引，效果极好
```

### 原则二：短索引优先

索引越小，每个页能存的索引越多，树高越低，查询越快。

```sql
-- 不推荐：VARCHAR(255) 全字段索引
CREATE INDEX idx_email ON users(email);

-- 推荐：前缀索引（根据数据分布选择合适长度）
CREATE INDEX idx_email ON users(email(20));

-- 更推荐：用整数类型代替字符串
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    email VARCHAR(255),
    email_id INT UNSIGNED  -- email 的哈希值或映射 ID
);
```

### 原则三：覆盖优先

如果查询只需要索引中的字段，优先设计覆盖索引。

```sql
-- 常见查询
SELECT user_id, status, created_at FROM orders WHERE user_id = ?;

-- 设计覆盖索引
CREATE INDEX idx_user_status_time ON orders(user_id, status, created_at);
```

---

## 业务场景索引设计实战

### 场景一：用户表

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    phone VARCHAR(11) NOT NULL,          -- 登录/手机号查询
    email VARCHAR(100),                  -- 邮箱查询
    nickname VARCHAR(50),                -- 昵称搜索（模糊匹配）
    status TINYINT DEFAULT 1,            -- 状态过滤
    created_at DATETIME NOT NULL,
    UNIQUE KEY uk_phone (phone),
    INDEX idx_status (status),
    INDEX idx_created (created_at)
);
```

索引分析：
- `uk_phone`：唯一索引，用于手机号登录
- `idx_status`：过滤状态（可能需要覆盖 `status, created_at`）
- `idx_created`：按时间排序查询

### 场景二：订单表

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL,       -- 订单号查询
    user_id BIGINT NOT NULL,              -- 用户查询
    status VARCHAR(20) NOT NULL,         -- 状态筛选
    amount DECIMAL(10,2) NOT NULL,        -- 金额筛选
    created_at DATETIME NOT NULL,
    UNIQUE KEY uk_order_no (order_no),
    INDEX idx_user_status (user_id, status),           -- 场景 1
    INDEX idx_user_created (user_id, created_at),       -- 场景 2
    INDEX idx_status_created (status, created_at)        -- 场景 3
);
```

常见查询及索引匹配：

```sql
-- 查询 1：用户的所有订单
SELECT * FROM orders WHERE user_id = ?;
-- ✅ idx_user_status / idx_user_created 都能用

-- 查询 2：用户的待支付订单
SELECT * FROM orders WHERE user_id = ? AND status = 'pending';
-- ✅ idx_user_status 完全覆盖

-- 查询 3：用户的订单（按时间排序）
SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 20;
-- ✅ idx_user_created 完全覆盖

-- 查询 4：统计各状态订单数
SELECT status, COUNT(*) FROM orders GROUP BY status;
-- ✅ idx_status_created 加速排序和聚合
```

---

## 索引设计的反模式

### 反模式一：索引越多越好

```sql
-- 错误做法
CREATE TABLE orders (
    ...
    INDEX idx_1 (user_id),
    INDEX idx_2 (status),
    INDEX idx_3 (amount),
    INDEX idx_4 (created_at),
    INDEX idx_5 (user_id, status),
    INDEX idx_6 (user_id, amount),
    INDEX idx_7 (status, amount),
    ...
);
```

**问题**：
- 写入变慢：每次 INSERT/UPDATE/DELETE 需要维护所有索引
- 占用空间：索引可能比数据本身还大
- 优化器困惑：索引太多，优化器可能选错

### 反模式二：建了索引但从不使用

```sql
-- 业务上几乎不用 status 过滤，但建了索引
INDEX idx_status (status);

-- 查询从来不按 amount 排序，但建了索引
INDEX idx_amount (amount);
```

**定期检查慢查询日志，把没用的索引删掉。**

### 反模式三：联合索引顺序混乱

```sql
-- 实际查询：WHERE user_id = ? AND status = ?
-- 但索引顺序是 (status, user_id)，不满足最左前缀

CREATE INDEX idx_wrong ON orders(status, user_id);  -- 错

CREATE INDEX idx_right ON orders(user_id, status);  -- 对
```

---

## 索引设计流程

```
┌────────────────────────────────────────────────────────────┐
│                    索引设计流程                             │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Step 1: 分析业务查询                                       │
│  ├── 列出所有高频查询                                       │
│  ├── 统计查询频率                                           │
│  └── 确定查询优先级                                         │
│                                                            │
│  Step 2: 确定索引列                                         │
│  ├── WHERE 条件列（等值优先，范围靠后）                     │
│  ├── ORDER BY 列（需要和 WHERE 一起考虑）                   │
│  └── SELECT 列（尽量覆盖）                                 │
│                                                            │
│  Step 3: 确定索引顺序                                       │
│  ├── 区分度高的列优先                                       │
│  ├── 等值查询列优先于范围查询列                             │
│  └── 考虑最左前缀原则                                       │
│                                                            │
│  Step 4: 评估和优化                                         │
│  ├── EXPLAIN 分析执行计划                                   │
│  ├── 观察查询性能                                           │
│  └── 调整索引                                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 维护与监控

索引不是一劳永逸的，需要持续维护：

```java
// 定期检查索引使用情况
public class IndexMaintenance {

    /**
     * 查找未使用的索引
     * 在 MySQL 中查看：
     * SELECT * FROM performance_schema.table_io_waits_summary_by_index_usage
     * WHERE index_name IS NOT NULL AND count_star = 0;
     */
    public void findUnusedIndexes() {
        // 删除长期未使用的索引，减少写入开销
    }

    /**
     * 检查索引的选择性
     */
    public double calculateSelectivity(String table, String column) {
        // SELECT COUNT(DISTINCT column) / COUNT(*) FROM table;
        // 选择性低于 0.1 的索引通常意义不大
        return 0.0;
    }
}
```

---

## 一句话总结

索引设计的核心：**按业务查询设计索引，让查询尽量走索引、走覆盖、减少回表。**

索引不是越多越好，够用就行。
