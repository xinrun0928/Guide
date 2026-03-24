# 慢查询定位：slow_query_log 与 long_query_time

凌晨 3 点，监控大屏突然变红。

 DBA 发来消息：「线上有个 SQL 执行了 28 秒，用户已经炸了。」

 你打开后台日志，发现除了堆栈还是堆栈——根本不知道是哪条 SQL 拖垮了系统。

 问题出在哪？**你没有开启慢查询日志。**

---

## 为什么要关注慢查询？

MySQL 的慢查询日志（Slow Query Log）是性能优化的第一道门。它记录执行时间超过阈值的 SQL，让你能**精准定位问题**，而不是靠猜。

> 想象一下：用户说「系统很慢」，你能快速说出「是这条 SQL 用了 15 秒」，和只能说「可能是数据库的问题」，哪个更有说服力？

---

## 开启慢查询日志

慢查询日志默认关闭，需要手动开启。

### 查看当前配置

```sql
SHOW VARIABLES LIKE 'slow_query_log%';
SHOW VARIABLES LIKE 'long_query_time%';
```

执行后你会看到类似输出：

| 变量名 | 当前值 | 说明 |
|---|---|---|
| slow_query_log | OFF | 日志开关 |
| slow_query_log_file | /var/lib/mysql/slow.log | 日志文件路径 |
| long_query_time | 10.000000 | 阈值（秒） |

### 开启慢查询日志

```sql
-- 开启慢查询日志
SET GLOBAL slow_query_log = 'ON';

-- 设置慢查询阈值（精确到微秒）
SET GLOBAL long_query_time = 1;  -- 超过 1 秒就记录

-- 指定日志文件路径
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';
```

> 注意：生产环境建议在配置文件中设置，重启后依然生效。

### 配置文件方式

在 `my.cnf` 或 `my.ini` 中添加：

```ini
[mysqld]
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 1
log_queries_not_using_indexes = 1  -- 记录未使用索引的查询
```

---

## 解读慢查询日志

开启后，MySQL 会在日志文件中记录符合条件的 SQL。日志格式如下：

```sql
# Time: 2024-01-15T03:15:42.123456Z
# User@Host: app_user[app_user] @ localhost [127.0.0.1]
# Query_time: 12.543210  Lock_time: 0.000123 Rows_sent: 100  Rows_examined: 5000000
SET timestamp=1705295742;
SELECT * FROM orders WHERE status = 'pending' ORDER BY create_time DESC LIMIT 100;
```

重点字段解读：

| 字段 | 含义 |
|---|---|
| Query_time | 查询执行时间 |
| Lock_time | 锁等待时间 |
| Rows_sent | 返回行数 |
| Rows_examined | 扫描行数 |

**关键洞察**：如果 `Rows_examined` 远大于 `Rows_sent`，说明 SQL 在做大量无效扫描——这是优化的重点信号。

---

## 慢查询分析工具

光有日志不够，还需要分析工具。

### mysqldumpslow

MySQL 自带的慢查询分析工具。

```bash
# 分析最慢的 10 条 SQL
mysqldumpslow -t 10 /var/log/mysql/slow.log

# 按照查询时间排序，取前 5
mysqldumpslow -s t -t 5 /var/log/mysql/slow.log

# 按照平均查询时间排序
mysqldumpslow -s at -t 10 /var/log/mysql/slow.log
```

参数说明：
- `-s c`：按查询次数排序
- `-s t`：按查询时间排序
- `-s at`：按平均查询时间排序

### pt-query-digest（推荐）

Percona Toolkit 中的高级分析工具，功能更强大。

```bash
# 安装（macOS）
brew install percona-toolkit

# 分析慢查询日志
pt-query-digest /var/log/mysql/slow.log
```

输出示例：

```
# Profile
# Rank Query ID           Response time  Calls  R/Call
# ==== ================== ============== ====== =======
#    1 0xABC123...         156.2345 45.2%   1234  0.1267 SELECT orders
#    2 0xDEF456...         89.1234 25.8%     567  0.1572 SELECT users
```

> 建议：生产环境优先使用 pt-query-digest，它能自动聚合相似的 SQL 语句。

---

## 设置合理的阈值

阈值设置是个技术活——太低会产生大量噪音，太高会漏掉问题。

### 阈值设置原则

| 环境 | 建议阈值 | 说明 |
|---|---|---|
| 开发/测试 | 0.5 秒 | 尽早发现问题 |
| 准生产 | 1 秒 | 接近生产环境 |
| 生产 | 2-5 秒 | 减少噪音，但覆盖核心问题 |

### 动态调整阈值

```sql
-- 根据业务高峰期动态调整
SET GLOBAL long_query_time = 2;

-- 业务高峰期结束后调回
SET GLOBAL long_query_time = 5;
```

---

## 其他有用的配置

### 记录未使用索引的查询

```ini
[mysqld]
log_queries_not_using_indexes = 1
```

> 警告：这个选项可能产生大量日志，磁盘空间要监控好。

### 记录管理语句

```ini
[mysqld]
log_slow_admin_statements = 1    -- 记录 ALTER、OPTIMIZE 等管理语句
log_slow_slave_statements = 1   -- 记录从库执行的慢查询
```

---

## 实战案例

某电商系统数据库响应缓慢，排查步骤如下：

**第一步：开启慢查询日志**

```sql
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;
```

**第二步：等待一段时间后分析**

```bash
pt-query-digest /var/log/mysql/slow.log > /tmp/slow_analysis.txt
```

**第三步：发现元凶**

```
# 发现问题 SQL
SELECT * FROM orders WHERE user_id = ? AND status = 'paid'
ORDER BY create_time DESC LIMIT 20;

Query_time: 8.5s
Rows_examined: 5000000
```

**第四步：优化**

- 添加索引：`idx_user_status_time(user_id, status, create_time)`
- 验证：`EXPLAIN` 确认使用索引

**优化后**：`Query_time: 0.01s`，性能提升 850 倍。

---

## 总结与思考

慢查询日志是 MySQL 性能优化的起点。没有它，你是在黑暗中摸索；有了它，你就是拿着手术刀精准切除病灶。

---

## 留给你的问题

1. 你的项目中，慢查询阈值设置的是多少？是否有定期分析慢查询日志的习惯？

2. 如果一个 SQL 查询时间是 0.9 秒，但执行频率是每秒 1000 次，它比一个 10 秒但只执行一次的 SQL 危害更大吗？想想如何用慢查询日志发现这个问题。

3. `Rows_examined` 和 `Rows_sent` 的比值能告诉我们什么？这个比值在什么范围内算是健康的？
