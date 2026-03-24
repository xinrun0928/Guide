# 索引失效：那些年我们踩过的坑

你给 `status` 字段加了索引，信心满满地跑了一条 SQL：

```sql
SELECT * FROM orders WHERE status = 'paid';
```

然后 EXPLAIN 告诉你：全表扫描。

为什么？索引不是万能的吗？

索引确实不是万能的。以下这些场景，索引会失效——而这些坑，80% 的开发者都踩过。

---

## 坑一：最左前缀原则

这是最容易犯的错误。

联合索引 `(user_id, status, created_at)`：

```sql
-- ✅ 能用索引：从最左边开始
SELECT * FROM orders WHERE user_id = 100;

-- ✅ 能用索引：连续的前缀列
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';

-- ❌ 索引失效：跳过最左列
SELECT * FROM orders WHERE status = 'paid';

-- ❌ 索引失效：跳跃了
SELECT * FROM orders WHERE user_id = 100 AND created_at = '2024-01-01';
```

**规则：从索引的最左列开始，连续使用，中间不能断开。**

---

## 坑二：范围查询阻断

范围查询（`>`、`<`、`>=`、`<=`、`BETWEEN`）会阻断其右边所有列使用索引。

```sql
联合索引：(user_id, status, created_at)

-- ✅ 索引生效：user_id + status
SELECT * FROM orders WHERE user_id = 100 AND status > 'paid';

-- ❌ 索引失效：status 的范围查询阻断 created_at
SELECT * FROM orders WHERE user_id = 100 AND status > 'paid' AND created_at > '2024-01-01';
-- 只能用 user_id 和部分 status

-- ✅ 改进：把范围查询放最后
SELECT * FROM orders WHERE user_id = 100 AND created_at > '2024-01-01' AND status = 'paid';
-- 三个字段都能用
```

**原则：等值查询放前面，范围查询放后面。**

---

## 坑三：索引列上使用函数或计算

```sql
-- ❌ 索引失效：在索引列上使用函数
SELECT * FROM users WHERE YEAR(created_at) = 2024;

-- ✅ 正确：不要在索引列上使用函数
SELECT * FROM users WHERE created_at >= '2024-01-01' AND created_at < '2025-01-01';

-- ❌ 索引失效：计算
SELECT * FROM orders WHERE amount / 2 > 100;

-- ✅ 正确：改写成等价形式
SELECT * FROM orders WHERE amount > 200;
```

**规则：索引列参与计算、函数、类型转换，索引都会失效。**

---

## 坑四：字段类型不匹配

```sql
-- 表结构：user_id 是 BIGINT
-- ❌ 索引失效：字符串和数字比较
SELECT * FROM orders WHERE user_id = '100';  -- 字符串 100

-- ✅ 正确：保持类型一致
SELECT * FROM orders WHERE user_id = 100;   -- 数字 100
```

隐式类型转换也可能导致索引失效：

```java
// Java 中的隐式转换问题
public void queryUser(long userId) {
    // 传进来的是 long 类型
    String sql = "SELECT * FROM orders WHERE user_id = " + userId;
    // 如果 JDBC 驱动做了隐式转换，可能导致索引失效
}
```

---

## 坑五：LIKE 左边有通配符

```sql
-- ❌ 索引失效：% 在左边
SELECT * FROM users WHERE name LIKE '%三';

-- ❌ 索引失效：% 在两边
SELECT * FROM users WHERE name LIKE '%三%';

-- ✅ 索引生效：% 在右边
SELECT * FROM users WHERE name LIKE '张%';

-- ✅ 正确：如果确实需要模糊搜索，考虑全文索引或 ES
SELECT * FROM users WHERE name LIKE '三';  -- 如果 name 有前缀索引，可以用
```

**原理：索引 B+ 树按从左到右排序，`%三` 不知道以什么开头，无法利用索引顺序。**

---

## 坑六：使用 OR 条件

```sql
-- ❌ 可能索引失效
SELECT * FROM orders WHERE user_id = 100 OR status = 'paid';

-- ✅ 正确：改成 UNION
SELECT * FROM orders WHERE user_id = 100
UNION ALL
SELECT * FROM orders WHERE status = 'paid' AND user_id != 100;

-- ✅ 或者：确保 OR 的每个条件都有索引
-- user_id 和 status 都有单独索引，优化器可能选择索引合并
```

---

## 坑七：SELECT * 太多时候不是最优解

```sql
-- 假设索引是 (user_id, status)
SELECT id, user_id, status FROM orders WHERE user_id = 100 AND status = 'paid';
-- 如果索引覆盖了所有查询字段，可以避免回表

-- SELECT * 会强制回表取所有字段
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';
```

---

## 坑八：数据量太小

当表数据量很小时，MySQL 优化器可能认为全表扫描更快。

```sql
-- 表只有 100 条记录，索引可能不会被使用
SELECT * FROM orders WHERE user_id = 100;
```

这是优化器的「明智判断」，不是索引失效。

---

## 索引失效检查清单

| 检查项 | 说明 |
|--------|------|
| 是否符合最左前缀原则 | 查询条件是否从索引最左列开始且连续 |
| 是否有范围查询阻断 | 范围查询（`>`、`<`、`BETWEEN`）右边的列能否使用索引 |
| 是否有函数或计算 | 索引列是否参与了计算或函数 |
| 类型是否匹配 | 字段类型和比较值类型是否一致 |
| LIKE 是否在左边加 % | `LIKE '%xxx'` 无法使用索引 |
| OR 条件是否合理 | OR 连接的条件是否都有索引 |

---

## 面试追问方向

- `WHERE a > 5 AND a < 10 AND b = 1`，索引 (a, b) 能用到哪些字段？
- 为什么 `SELECT *` 可能导致全表扫描？
- 如果业务必须用 `LIKE '%xxx'`，有什么替代方案？

> 提示：可以考虑全文索引、倒排索引、或者把模糊匹配换成前缀索引。
