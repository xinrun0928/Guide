# 文件排序与临时表：性能杀手详解

当 EXPLAIN 的 Extra 列出现 `Using filesort` 或 `Using temporary` 时，你要注意了——这两个家伙是 SQL 性能的重要杀手。

---

## Using filesort：文件排序

### 什么是文件排序？

Filesort 不是指「在文件中排序」，而是指 MySQL 无法利用索引的顺序，只能自己排序。

```sql
-- 触发文件排序的查询
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;

-- EXPLAIN 结果
-- Extra: Using filesort
```

### 文件排序的原理

MySQL 使用两种算法进行文件排序：

#### 算法一：两次扫描

1. 读取所有满足 WHERE 条件的行（回表取数据）
2. 将数据写入 sort_buffer
3. 在 sort_buffer 中排序
4. 返回结果

#### 算法二：一次扫描（MySQL 4.1+）

1. 读取所有满足 WHERE 条件的行（不回表，只取排序字段和主键）
2. 将 (排序字段, 主键) 写入 sort_buffer
3. 在 sort_buffer 中排序
4. 根据主键回表取完整数据
5. 返回结果

**算法二比算法一少了一次全表扫描**，只在无法覆盖排序时才使用算法一。

### 如何判断使用哪种算法？

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at;
```

```
Extra: Using filesort
```

但更详细的信息需要查看 optimizer_trace。

### filesort 的优化

#### 优化一：创建覆盖索引

如果 ORDER BY 的字段在索引中，就不需要文件排序：

```sql
-- 索引覆盖 ORDER BY 字段
CREATE INDEX idx_status_created ON orders(status, created_at);

-- 现在查询不需要文件排序
SELECT id, status, created_at FROM orders WHERE status = 'pending' ORDER BY created_at;
-- Extra: Using index
```

#### 优化二：减少排序数据量

```sql
-- 添加 LIMIT 限制
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;
-- 只对 100 条数据排序，性能好很多
```

#### 优化三：利用索引顺序

如果索引本身是有序的，直接按索引顺序返回即可：

```sql
-- 索引 idx_status_created 是 (status, created_at) 升序
-- 索引 idx_status_created_desc 是 (status, created_at) 降序
-- 对于 ORDER BY status, created_at DESC，优先使用降序索引
```

---

## Using temporary：临时表

### 什么是临时表？

当 MySQL 无法直接在内存中完成操作时，会使用临时表。

```sql
-- 触发临时表的查询
SELECT status, COUNT(*), SUM(amount)
FROM orders
GROUP BY status;

-- EXPLAIN 结果
-- Extra: Using temporary; Using filesort
```

### 临时表的产生场景

1. **GROUP BY 字段不在索引中**
2. **ORDER BY 和 GROUP BY 的字段不同**
3. **DISTINCT 配合复杂条件**
4. **UNION 查询**
5. **子查询**

### 临时表的优化

#### 优化一：确保 GROUP BY 有索引支持

```sql
-- 如果经常按 status 分组
CREATE INDEX idx_status ON orders(status);

-- 查询
SELECT status, COUNT(*) FROM orders GROUP BY status;
-- Extra: Using index
```

#### 优化二：让 GROUP BY 和 ORDER BY 一致

```sql
-- 错误：GROUP BY 和 ORDER BY 不同
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY created_at;
-- Extra: Using temporary; Using filesort

-- 正确：GROUP BY 和 ORDER BY 一致
SELECT status, COUNT(*) FROM orders GROUP BY status ORDER BY status;
-- Extra: Using index
```

#### 优化三：考虑用索引替代 DISTINCT

```sql
-- 原始查询
SELECT DISTINCT status FROM orders;
-- Extra: Using temporary

-- 用索引扫描替代
SELECT status FROM orders GROUP BY status;
-- Extra: Using index
```

---

## filesort 和 temporary 的关系

两者经常一起出现：

```
┌─────────────────────────────────────────────────────────────┐
│ filesort + temporary 流程                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 1. 全表扫描 orders 表                                       │
│ 2. 符合 WHERE 条件的行写入临时表                            │
│ 3. 对临时表按 ORDER BY 字段排序                             │
│ 4. 返回排序后的结果                                         │
│                                                             │
│ 性能很差，尽量避免                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 性能对比

| 场景 | Extra | 性能 |
|------|-------|------|
| 利用索引排序 | Using index | 最优 |
| filesort + 小数据量 | Using filesort | 较好（内存排序） |
| filesort + 大数据量 | Using filesort | 差（磁盘排序） |
| 临时表 + 文件排序 | Using temporary; Using filesort | 最差 |

---

## Java 代码示例

```java
@Service
public class QueryOptimizer {

    /**
     * 检查查询是否会触发文件排序或临时表
     */
    public QueryAnalysis analyzeQuery(String sql) {
        String explainSql = "EXPLAIN " + sql;
        // 执行 EXPLAIN 并解析结果

        String explainSql2 = "EXPLAIN FORMAT=JSON " + sql;
        // 解析 JSON 格式获取更详细的信息

        QueryAnalysis analysis = new QueryAnalysis();
        // 检查 Extra 列
        if (extra.contains("Using filesort")) {
            analysis.addIssue("使用文件排序，可能影响性能");
        }
        if (extra.contains("Using temporary")) {
            analysis.addIssue("使用临时表，可能影响性能");
        }
        return analysis;
    }

    /**
     * 建议创建索引来消除 filesort
     */
    public String suggestIndex(String table, String whereField, String orderField) {
        // 如果 ORDER BY 字段是 WHERE 字段的前缀，可以创建联合索引
        if (whereField.equals(orderField) || orderField.startsWith(whereField)) {
            return String.format("CREATE INDEX idx_%s_%s ON %s(%s, %s)",
                whereField, orderField, table, whereField, orderField);
        }
        return null;
    }
}
```

---

## 面试追问方向

- filesort 是在磁盘上排序吗？
- sort_buffer_size 参数的作用是什么？
- 如何判断 filesort 是用的哪种算法？
- 临时表是在内存还是磁盘？

> filesort 优先在内存（sort_buffer）中排序，只有数据量超过 sort_buffer_size 时才会使用磁盘。临时表也是优先内存，超过 tmp_table_size 后使用磁盘。
