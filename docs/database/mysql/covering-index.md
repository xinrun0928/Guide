# 覆盖索引：让查询「一步到位」

你可能遇到过这种情况：

```sql
SELECT name FROM users WHERE id = 1;
```

这条 SQL 只查 `name` 和 `id` 两个字段，而 `id` 是主键，`name` 上有索引。

按理说应该很快对吧？但 EXPLAIN 显示，这条 SQL 走了全表扫描。

等等，为什么会这样？

今天，我们来聊一个能让查询效率翻倍的技术：**覆盖索引**。

---

## 什么是覆盖索引？

如果查询的所有字段都包含在某个索引中，MySQL 不需要回表，直接在索引中就能返回结果——这就是覆盖索引。

```
普通索引查询：
┌──────────────────────────────────────────────────────────┐
│ SELECT name FROM users WHERE id = 1                      │
│                                                          │
│ 非聚簇索引(name) → 返回主键 1 → 回表 → 聚簇索引(主键)    │
│                              ↓                           │
│                        取到 name 值                      │
└──────────────────────────────────────────────────────────┘

覆盖索引查询：
┌──────────────────────────────────────────────────────────┐
│ SELECT id, name FROM users WHERE name = '张三'           │
│                                                          │
│ 联合索引(id, name) → 直接返回 id 和 name                 │
│                      ↓                                   │
│                  无需回表！返回结果                       │
└──────────────────────────────────────────────────────────┘
```

覆盖索引的核心优势：**省去回表操作，减少磁盘 I/O**。

---

## 回表查询的性能代价

回表是 InnoDB 中比较「贵」的操作。

一次回表 = 一次索引查询 + 一次主键定位 + 一次叶子节点读取。

如果数据量小，这不算什么。但如果查询结果只有几条，却要回表几十次、上百次，性能差距就明显了。

```java
// 模拟回表的性能问题
public class IndexCoveringDemo {

    /**
     * 非覆盖查询：查询 100 条记录，可能需要多次回表
     */
    public List&lt;String&gt; queryWithoutCovering(List&lt;Long&gt; ids) {
        List&lt;String&gt; results = new ArrayList&lt;&gt;();

        for (Long id : ids) {
            // 1. 辅助索引查询，获取主键
            Long pk = secondaryIndex.get(id);

            // 2. 主键回表查询
            Row row = clusteredIndex.get(pk);

            // 3. 取字段
            results.add(row.getName());
        }

        // 100 条记录 = 100 次主键查询 = 100 次潜在磁盘 I/O
        return results;
    }

    /**
     * 覆盖查询：所有数据在索引中直接返回
     */
    public List&lt;String&gt; queryWithCovering(List&lt;Long&gt; ids) {
        // 假设联合索引覆盖了 id 和 name
        return coveringIndex.getByIds(ids);
        // 一次查询，所有数据都在索引中，无回表
    }
}
```

---

## 如何创建覆盖索引？

### 原则：查询什么字段，索引就包含什么字段

```sql
-- 普通查询
SELECT name, email FROM users WHERE name = '张三';
-- 需要：name 索引 + 回表取 email

-- 创建覆盖索引
CREATE INDEX idx_name_email ON users(name, email);
-- 现在：索引直接覆盖查询，无需回表
```

### 进阶：覆盖排序字段

```sql
-- 查询并按时间排序
SELECT id, title, created_at FROM articles
WHERE status = 'published'
ORDER BY created_at DESC;

-- 创建覆盖索引
CREATE INDEX idx_status_created ON articles(status, created_at, id, title);
-- 索引覆盖了 WHERE、ORDER BY、SELECT 的所有字段
```

---

## 覆盖索引的判断方法

使用 EXPLAIN 时，关注 `Extra` 列是否有 `Using index`：

```sql
EXPLAIN SELECT id, name FROM users WHERE name = '张三';
```

输出：

```
+----+-------------+-------+------------+------+---------------+----------+---------+-------+
| id | select_type| table | type       | key  | Extra         |
+----+-------------+-------+------------+------+---------------+----------+---------+-------+
|  1 | SIMPLE     | users | ref        | idx_name | Using index |
+----+-------------+-------+------------+------+---------------+----------+---------+-------+
```

- `Using index`：覆盖索引生效，无需回表
- `Using index condition`：需要回表，但索引能做部分过滤

---

## 联合索引的字段顺序与覆盖索引

联合索引 `(a, b, c)` 的字段顺序决定它能覆盖哪些查询：

| 查询条件 | 是否能用索引 (a, b, c) | 是否覆盖 |
|----------|----------------------|----------|
| WHERE a = 1 | 能 | 否（需要回表取 b, c） |
| WHERE a = 1 AND b = 2 | 能 | 否（需要回表取 c） |
| WHERE a = 1 AND b = 2 AND c = 3 | 能 | 能（索引完全覆盖） |
| WHERE b = 2 | 不能 | - |
| WHERE a = 1 AND c = 3 | 能（部分） | 否（b 未提供，索引中断） |

### 最佳实践：把需要查询的字段放在索引中

```sql
-- 原查询
SELECT id, name, email, phone FROM users WHERE name = '张三';

-- 如果 name 经常作为查询条件，且经常需要返回这些字段
CREATE INDEX idx_name_covering ON users(name, id, email, phone);

-- 注意：id 是主键，联合索引中通常包含主键以便于覆盖
```

---

## 覆盖索引 vs 全表扫描

什么情况下覆盖索引反而不如全表扫描？

1. **数据量极小时**：全表扫描可能只有几页，索引查询反而多一次 B+ 树定位
2. **索引选择性低时**：比如性别字段，只有男/女两种值，索引几乎无效
3. **查询覆盖字段多时**：索引太宽，遍历索引本身就很慢

覆盖索引是好东西，但也要用对场景。

---

## 面试场景

**面试官：** 什么情况下查询不会回表？

**你：** 有两种情况不需要回表：1. 查询聚簇索引（主键），因为叶子节点就是完整数据；2. 使用覆盖索引，查询的所有字段都在索引中。

**面试官：** 如何判断是否走了覆盖索引？

**你：** 看 EXPLAIN 的 Extra 列是否有 `Using index`。如果有，说明覆盖索引生效。

---

## 一句话总结

覆盖索引的本质是：**让查询「所见即所得」，索引里有什么，就查什么，绝不回表。**
