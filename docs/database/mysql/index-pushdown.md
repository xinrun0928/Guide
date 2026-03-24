# 索引下推：MySQL 5.6 的性能黑科技

你有没有遇到过这种情况：

明明建了联合索引，查询条件也符合最左前缀，但 EXPLAIN 显示的性能却不理想。

```sql
SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
```

联合索引是 `(name, age)`，按理说应该能同时利用 `name` 和 `age` 做过滤。

但 MySQL 5.6 之前，这条 SQL 只会用 `name` 找到匹配记录，然后回表，再在 Server 层过滤 `age`。

**索引下推（Index Condition Pushdown，ICP）** 就是用来解决这个问题的。

---

## 没有索引下推时

MySQL 5.6 之前，查询流程是这样的：

```
查询：SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
索引：(name, age)

┌─────────────────────────────────────────────────────────────┐
│ 无 ICP 流程：                                               │
│                                                             │
│ 1. 存储引擎：使用 name 索引，找到所有 name LIKE '张%' 的记录│
│    └── 找到：('张三', 25)、('张三', 30)、('张小明', 28)...   │
│                                                             │
│ 2. 每条记录都回表，取完整行数据                             │
│    └── 100 条记录 = 100 次回表                              │
│                                                             │
│ 3. Server 层：过滤 age = 25                                 │
│    └── 只有 1 条满足                                        │
│                                                             │
│ 结果：100 次回表，只用到 1 条                               │
└─────────────────────────────────────────────────────────────┘
```

100 条记录全部回表，但最终只有 1 条满足条件。**大量无用的回表操作！**

---

## 有索引下推时

MySQL 5.6+ 引入了索引下推，回表之前先过滤：

```
查询：SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
索引：(name, age)

┌─────────────────────────────────────────────────────────────┐
│ ICP 流程：                                                  │
│                                                             │
│ 1. 存储引擎：使用 name 索引，找到所有 name LIKE '张%' 的记录│
│    └── 找到：('张三', 25)、('张三', 30)、('张小明', 28)...   │
│                                                             │
│ 2. 存储引擎：直接用 age 索引过滤（不需要回表）              │
│    └── 只有 ('张三', 25) 满足 age = 25                      │
│                                                             │
│ 3. 只对满足 age = 25 的记录回表                            │
│    └── 1 次回表，取完整行数据                               │
│                                                             │
│ 结果：1 次回表，准确命中                                    │
└─────────────────────────────────────────────────────────────┘
```

**索引下推的本质：将 Server 层的过滤条件下推到存储引擎，在回表之前先过滤。**

---

## 工作原理图解

```java
// MySQL 执行器伪代码
public class IndexConditionPushdownDemo {

    // 没有 ICP
    public List&lt;Row&gt; queryWithoutICP(Index idx, String namePattern, int age) {
        List&lt;Row&gt; results = new ArrayList&lt;&gt;();

        // 1. 存储引擎：找到所有 name 匹配的记录
        List&lt;Long&gt; primaryKeys = idx.rangeScan(namePattern);

        // 2. 逐条回表
        for (Long pk : primaryKeys) {
            Row row = fetchRowByPK(pk);  // 回表！

            // 3. Server 层过滤
            if (row.getAge() == age) {
                results.add(row);
            }
        }
        return results;
    }

    // 有 ICP
    public List&lt;Row&gt; queryWithICP(Index idx, String namePattern, int age) {
        List&lt;Row&gt; results = new ArrayList&lt;&gt;();

        // 1. 存储引擎：找到所有 name 匹配的记录
        // 2. 存储引擎：同时用 age 条件过滤（索引下推！）
        List&lt;Long&gt; primaryKeys = idx.rangeScanWithFilter(
            namePattern,
            record -> record.getAge() == age  // 下推的过滤条件
        );

        // 3. 只需要对过滤后的记录回表
        for (Long pk : primaryKeys) {
            Row row = fetchRowByPK(pk);  // 回表，但次数大大减少
            results.add(row);
        }
        return results;
    }
}
```

---

## ICP 的适用条件

不是所有查询都能用索引下推，需要满足以下条件：

1. **使用联合索引**：索引包含 WHERE 条件的部分或全部字段
2. **查询是 `SELECT *`**：需要回表取完整数据
3. **部分条件可以在索引中使用**：如 `=`、`>`、`<`、`LIKE`、`IN`、`BETWEEN` 等
4. **存储引擎支持**：InnoDB 和 MyISAM 都支持 ICP

### 不能使用 ICP 的场景

```sql
-- 条件不在索引中
SELECT * FROM users WHERE name = '张三' AND phone = '13800000000';
-- phone 不在索引 (name, age) 中，无法下推

-- 使用了函数
SELECT * FROM users WHERE UPPER(name) = 'ZHANGSAN' AND name LIKE '张%';
-- UPPER(name) 不是简单比较，无法使用索引

-- 存储引擎不支持的函数
SELECT * FROM users WHERE YEAR(created_at) = 2024;
-- YEAR() 函数无法下推到存储引擎
```

---

## 如何判断是否使用了 ICP？

```sql
EXPLAIN SELECT * FROM users WHERE name LIKE '张%' AND age = 25;
```

```
无 ICP 时：
+----+-------------+-------+-------+----------+--------+
| id | select_type| table | type  | key      | Extra  |
+----+-------------+-------+-------+----------+--------+
|  1 | SIMPLE     | users | range | idx_name | Using where |
+----+-------------+-------+-------+----------+--------+

有 ICP 时：
+----+-------------+-------+-------+----------+--------------------+
| id | select_type| table | type  | key      | Extra              |
+----+-------------+-------+-------+----------+--------------------+
|  1 | SIMPLE     | users | range | idx_name | Using index condition |
+----+-------------+-------+-------+----------+--------------------+
```

- `Using index condition`：使用了 ICP
- `Using where`：在 Server 层过滤

---

## ICP 的性能收益

| 场景 | 无 ICP | 有 ICP | 收益 |
|------|--------|--------|------|
| 100 条记录，10 条满足 age 条件 | 100 次回表 | 10 次回表 | **减少 90% 回表** |
| 10000 条记录，100 条满足条件 | 10000 次回表 | 100 次回表 | **减少 99% 回表** |
| 全是假阳性（无记录满足） | 全部回表后再过滤 | 直接返回空 | **节省所有回表** |

**数据量越大，假阳性记录越多，ICP 的收益越高。**

---

## 一句话总结

索引下推：**把能下推的条件尽量下推到存储引擎，在回表之前就过滤掉不需要的记录，减少无用的磁盘 I/O。**

这是一项「简单但有效」的优化，MySQL 5.6+ 默认开启。
