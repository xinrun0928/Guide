# 慢查询：找出 SQL 的性能杀手

你的接口响应时间从 50 毫秒飙升到 5 秒。

运维说：「数据库 CPU 100% 了。」

DBA 甩来一个慢查询日志：「喏，就是这条 SQL。」

`SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;`

耗时 4.8 秒。

问题是：**为什么这条 SQL 变慢了？**

---

## 什么是慢查询？

MySQL 将执行时间超过 `long_query_time` 阈值的 SQL 记录到慢查询日志中。

```sql
-- 查看慢查询相关配置
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 慢查询日志默认不开启，开启方法：
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;  -- 超过 1 秒记录
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';
```

### 慢查询日志内容

```sql
-- 慢查询日志示例
# Time: 2024-01-15T10:30:00.123456Z
# User@Host: app[app] @ localhost [127.0.0.1]
# Query_time: 4.823456  Lock_time: 0.000123 Rows_sent: 100  Rows_examined: 1000000
SET timestamp=1705312200;
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;
```

关键字段：
- `Query_time`：查询耗时
- `Lock_time`：锁等待时间
- `Rows_sent`：返回行数
- `Rows_examined`：扫描行数

---

## 如何排查慢查询？

### 工具一：慢查询日志分析

```bash
# 使用 mysqldumpslow 分析慢查询日志
mysqldumpslow -s t -t 10 /var/log/mysql/slow.log
# -s t：按时间排序
# -t 10：显示前 10 条

# 输出示例：
# Count: 100  Time=5.23s (523s)  Lock=0.01s (1s)  Rows=100.0 (10000)
# SELECT * FROM orders WHERE status = 'pending'
```

### 工具二：performance_schema

MySQL 5.6+ 提供了更详细的性能监控：

```sql
-- 开启监控
UPDATE performance_schema.setup_consumers
SET ENABLED = 'YES' WHERE NAME LIKE '%statements%';

-- 查看最慢的 SQL
SELECT DIGEST_TEXT, COUNT_STAR, SUM_TIMER_WAIT/1000000000000 AS '耗时(秒)'
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 10;
```

### 工具三： EXPLAIN 分析

这是最重要的排查手段：

```sql
EXPLAIN SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC LIMIT 100;
```

---

## 慢查询的常见原因

### 原因一：没有索引

```sql
-- 查看表的索引
SHOW INDEX FROM orders;

-- EXPLAIN 分析
EXPLAIN SELECT * FROM orders WHERE status = 'pending';

-- 输出分析
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
| id | select_type| table  | type       | key  | key_len       | ref | rows    | Extra                        |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
|  1 | SIMPLE     | orders | ALL        | NULL | NULL          | NULL| 1000000 | Using filesort             |
+----+-------------+--------+------------+------+---------------+------+---------+------+--------+----------+-------------+
```

`type=ALL` 说明走了全表扫描，`key=NULL` 说明没有索引可用。

### 原因二：索引失效

明明有索引，但查询没有走索引。

```sql
-- status 有索引，但查询条件导致索引失效
SELECT * FROM orders WHERE status = 'pending' AND YEAR(created_at) = 2024;
-- YEAR() 函数导致索引失效

-- 正确写法
SELECT * FROM orders
WHERE status = 'pending'
AND created_at >= '2024-01-01' AND created_at < '2025-01-01';
```

### 原因三：回表太多

```sql
-- SELECT * 导致回表
SELECT * FROM orders WHERE status = 'pending';  -- 回表次数 = 扫描行数

-- 覆盖索引优化
SELECT id, status, created_at FROM orders WHERE status = 'pending';
-- 如果索引覆盖了这些字段，不需要回表
```

### 原因四：文件排序（filesort）

```sql
-- 没有索引支持排序
SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at DESC;

-- Extra: Using filesort 说明需要额外排序
-- 如果数据量大，排序是性能杀手
```

### 原因五：数据量太大

```sql
-- 分页查询偏移量大
SELECT * FROM orders ORDER BY id LIMIT 1000000, 100;
-- 扫描前 100 万行，只返回最后 100 行

-- 正确做法：使用游标分页
SELECT * FROM orders WHERE id > 1000000 ORDER BY id LIMIT 100;
```

---

## 慢查询优化步骤

```
┌────────────────────────────────────────────────────────────┐
│                  慢查询优化流程                             │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Step 1: 开启慢查询日志                                    │
│  └── 记录超过阈值的 SQL                                    │
│                                                            │
│  Step 2: 分析慢查询                                        │
│  └── mysqldumpslow / performance_schema                   │
│                                                            │
│  Step 3: EXPLAIN 分析                                      │
│  └── type、key、rows、Extra                               │
│                                                            │
│  Step 4: 针对优化                                          │
│  ├── 加索引                                               │
│  ├── 优化 SQL 写法                                        │
│  ├── 减少回表                                            │
│  └── 避免排序                                            │
│                                                            │
│  Step 5: 验证优化效果                                      │
│  └── 再次 EXPLAIN，对比耗时                               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## Java 代码示例

```java
@Service
public class SlowQueryAnalyzer {
    /**
     * 分析慢查询日志，找出最耗时的 SQL
     */
    public List&lt;SlowQueryInfo&gt; analyzeSlowQueries() {
        // 1. 从 performance_schema 获取慢 SQL
        String sql = "SELECT DIGEST_TEXT, COUNT_STAR, " +
                     "SUM_TIMER_WAIT/1000000000000 AS total_seconds " +
                     "FROM performance_schema.events_statements_summary_by_digest " +
                     "WHERE SUM_TIMER_WAIT > 0 " +
                     "ORDER BY SUM_TIMER_WAIT DESC LIMIT 10";

        // 2. 解析结果
        // ...

        // 3. 返回慢查询列表
        return slowQueries;
    }

    /**
     * 检查表是否有合适的索引
     */
    public void checkIndexes(String tableName) {
        // 查看表的索引
        String sql = "SHOW INDEX FROM " + tableName;
        // 解析索引信息
        // 检查高频查询是否有对应索引
    }
}
```

---

## 一句话总结

慢查询优化的核心是：**找出来、分析它、优化它、验证它**。EXPLAIN 是最重要的分析工具，慢查询日志是发现问题的基础。
