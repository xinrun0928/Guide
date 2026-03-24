# Oracle SGA 与 PGA：内存结构详解

想象一下：如果 Oracle 数据库没有了内存结构，就像一个图书馆没有了前台。

你每次借书都要自己去书库翻找——效率低下得难以想象。

Oracle 的内存结构，正是这个「前台」，它让数据库操作变得飞快。今天，我们来深入理解 Oracle 的两大内存区域：SGA 和 PGA。

---

## SGA vs PGA：一字之差，本质不同

在开始之前，先搞清楚这两个概念的区别：

| 维度 | SGA（System Global Area） | PGA（Program Global Area） |
|-----|------------------------|-------------------------|
| 共享性 | 所有进程共享 | 每个进程私有 |
| 存储内容 | 缓存数据、日志、SQL 解析结果 | 排序区、哈希区、会话信息 |
| 调整方式 | 动态调整（11g+） | 手动或自动配置 |
| 面试热度 | ★★★★★ | ★★★ |

---

## SGA 详解

### SGA 是什么？

SGA 是 Oracle 最重要的内存区域，被所有服务器进程和后台进程共享。它的大小直接影响数据库性能。

```
┌─────────────────────────────────────────────────────────┐
│                         SGA                              │
│  ┌───────────────┐ ┌───────────────┐ ┌────────────────┐ │
│  │  Database     │ │    Redo       │ │    Shared      │ │
│  │  Buffer       │ │    Log        │ │    Pool        │ │
│  │    Cache      │ │    Buffer     │ │                │ │
│  │  (数据缓存)    │ │  (日志缓存)    │ │  (共享池)      │ │
│  │               │ │               │ │  ┌──────────┐ │ │
│  │  ◄── 热数据 ──│ │  ◄── 新事务 ──│ │  │ Library  │ │ │
│  │               │ │               │ │  │  Cache   │ │ │
│  │               │ │               │ │  └──────────┘ │ │
│  │               │ │               │ │  ┌──────────┐ │ │
│  │               │ │               │ │  │ Dictionary│ │ │
│  │               │ │               │ │  │  Cache   │ │ │
│  │               │ │               │ │  └──────────┘ │ │
│  └───────────────┘ └───────────────┘ └────────────────┘ │
│  ┌───────────────┐ ┌───────────────┐                    │
│  │   Large       │ │    Java       │                    │
│  │    Pool       │ │    Pool       │                    │
│  └───────────────┘ └───────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

### SGA 的核心组件

#### 1. Database Buffer Cache（数据缓存）

这是 SGA 中最大的组件，缓存从磁盘读取的数据块。

```sql
-- 查看 Buffer Cache 大小
SQL> SELECT component, current_size/1024/1024 AS size_mb
FROM v$sga_dynamic_components
WHERE component = 'DEFAULT buffer cache';

COMPONENT                SIZE_MB
-------------------- ----------
DEFAULT buffer cache          256
```

**LRU 算法**：Oracle 使用改进的 LRU 链来管理缓存。当缓存满时，最久未使用的块被淘汰。

```sql
-- 查看 Buffer Cache 命中率
SQL> SELECT NAME, value,
       ROUND(value * 100 / (value + SUM(value) OVER()), 2) AS hit_ratio
FROM v$sysstat
WHERE name IN ('db block gets', 'consistent gets', 'physical reads');

NAME                      VALUE HIT_RATIO
-------------------- ---------- ----------
db block gets             12345
consistent gets           98765
physical reads            23456
```

**Buffer Cache 命中率**应该保持在 95% 以上。如果低于 90%，说明缓存太小或存在大量全表扫描。

#### 2. Shared Pool（共享池）

Shared Pool 是 Oracle 最复杂的组件之一，主要存储：

- **Library Cache**：已解析的 SQL 和 PL/SQL 代码
- **Data Dictionary Cache**：数据字典信息
- **Result Cache**：查询结果缓存

```sql
-- 查看 Shared Pool 大小
SQL> SELECT component, current_size/1024/1024 AS size_mb
FROM v$sga_dynamic_components
WHERE component = 'shared pool';

COMPONENT          SIZE_MB
--------------- ----------
shared pool             128
```

**绑定变量与 Shared Pool 的关系**：

```java
// 不使用绑定变量 - 每条 SQL 都硬解析
String sql1 = "SELECT * FROM employees WHERE department_id = 10";
String sql2 = "SELECT * FROM employees WHERE department_id = 20";
// 这两条 SQL 会被视为不同的 SQL，产生两次解析

// 使用绑定变量 - 共享执行计划
String sql = "SELECT * FROM employees WHERE department_id = ?";
PreparedStatement ps = conn.prepareStatement(sql);
ps.setInt(1, 10);  // 第一次执行
ps.setInt(1, 20);  // 第二次执行，共享第一次的解析结果
```

不使用绑定变量会导致 Shared Pool 中产生大量相似的 SQL，无法复用执行计划，最终导致性能下降。

#### 3. Redo Log Buffer（重做日志缓存）

记录所有事务的变更，用于恢复和复制。

```sql
-- 查看 Redo Log Buffer 大小
SQL> SELECT name, value/1024 AS size_kb
FROM v$parameter
WHERE name = 'log_buffer';

NAME            SIZE_KB
--------------- -------
log_buffer           6804
```

**为什么 LGWR 先于 DBWn 完成？** 因为事务提交时，必须先将 Redo 写入磁盘。如果 LGWR 失败，事务无法提交。

#### 4. Large Pool（大池）

Large Pool 是可选的内存区域，主要用于：

- RMAN 备份操作
- 共享服务器模式（Shared Server）的会话内存
- 批量加载操作

```sql
-- Large Pool 是可选的，查看是否存在
SQL> SELECT component, current_size/1024/1024 AS size_mb
FROM v$sga_dynamic_components
WHERE component = 'large pool';

COMPONENT                SIZE_MB
-------------------- ----------
large pool                     64
```

### SGA 自动管理（11g+）

Oracle 11g 引入了自动 SGA 管理，极大简化了内存配置：

```sql
-- 启用自动内存管理（ASMM）
ALTER SYSTEM SET sga_target = 4G;
ALTER SYSTEM SET sga_max_size = 4G;

-- 启用自动共享内存管理
ALTER SYSTEM SET shared_pool_size = 0;  -- 让 Oracle 自动调整
ALTER SYSTEM SET buffer_cache_size = 0; -- 让 Oracle 自动调整
```

---

## PGA 详解

### PGA 是什么？

PGA 是每个服务器进程私有的内存区域，不与其他进程共享。

```
┌─────────────────────────────────────────────────────────┐
│  Server Process 1                                       │
│  ┌───────────────────────────────┐                      │
│  │           PGA 1               │                      │
│  │  ┌─────────────────────────┐  │                      │
│  │  │   Sort Area (排序区)     │  │                      │
│  │  ├─────────────────────────┤  │                      │
│  │  │   Hash Area (哈希区)    │  │                      │
│  │  ├─────────────────────────┤  │                      │
│  │  │   Session Info (会话)   │  │                      │
│  │  └─────────────────────────┘  │                      │
│  └───────────────────────────────┘                      │
├─────────────────────────────────────────────────────────┤
│  Server Process 2                                       │
│  ┌───────────────────────────────┐                      │
│  │           PGA 2               │                      │
│  │  (同上)                        │                      │
│  └───────────────────────────────┘                      │
└─────────────────────────────────────────────────────────┘
```

### PGA 的核心组件

#### 1. Sort Area（排序区）

当 SQL 需要排序（如 ORDER BY、GROUP BY、DISTINCT）时，排序区用于存储排序中间结果。

```java
// 这类操作会在 PGA 中进行排序
String sql = "SELECT * FROM orders ORDER BY order_date DESC";
// 如果结果集太大，排序区放不下，Oracle 会使用 TEMP 表空间
```

#### 2. Hash Area（哈希区）

用于 hash join 时的哈希表构建。

```java
// Hash Join 示例
String sql = "SELECT * FROM orders o, customers c " +
              "WHERE o.customer_id = c.id";
// 大表与小表的连接，Oracle 可能选择 Hash Join
```

#### 3. Bitmap Merge Area

当使用位图索引时，合并多个位图结果。

### PGA 自动管理

```sql
-- 启用自动 PGA 管理
ALTER SYSTEM SET pga_aggregate_target = 1G;

-- 查看 PGA 使用情况
SQL> SELECT name, value/1024/1024 AS size_mb
FROM v$pgastat
WHERE name IN ('total PGA allocated', 'total PGA inuse');

NAME                          SIZE_MB
---------------------------- --------
total PGA allocated                 512
total PGA inuse                     380
```

---

## SGA 与 PGA 的协作

一个完整的查询请求，在内存中经历这样的流程：

```
1. 客户端发送 SQL
         ↓
2. Server Process 接收，解析 SQL（使用 PGA 内存）
         ↓
3. 检查 Shared Pool 中是否有缓存的执行计划（SGA）
         ↓
4. 没有则硬解析，生成执行计划（消耗 Shared Pool）
         ↓
5. 从 Buffer Cache 读取数据块（SGA）
         ↓
6. 如需排序，使用 Sort Area（PGA）
         ↓
7. 返回结果给客户端
```

---

## 内存调优实战

### 常见内存问题

| 问题现象 | 可能原因 | 解决方案 |
|---------|---------|---------|
| Buffer Cache 命中率低 | 缓存太小 | 增大 buffer_cache_size |
| 共享池碎片严重 | 大量硬解析 | 使用绑定变量 |
| ORA-04031 错误 | 共享池不足 | 增大 shared_pool_size |
| 排序溢出到磁盘 | PGA 太小 | 增大 pga_aggregate_target |

### ORA-04031 错误处理

```sql
-- 查看共享池空闲情况
SQL> SELECT * FROM v$sgastat WHERE name = 'free memory';

-- 诊断脚本
SQL> SELECT sql_id, substr(sql_text, 1, 50), executions
FROM v$sql
WHERE sql_text NOT LIKE '%v$sql%'
ORDER BY executions DESC
FETCH FIRST 20 ROWS ONLY;
```

这个错误通常由以下原因引起：
1. 共享池太小
2. 大量不使用绑定变量的 SQL
3. 共享池碎片化

### 智能建议

```sql
-- 使用 Oracle SQL Tuning Advisor
DECLARE
    my_task_name VARCHAR2(100);
    my_sqltext CLOB;
BEGIN
    my_sqltext := 'SELECT * FROM employees WHERE department_id = :1';
    my_task_name := DBMS_SQLTUNE.CREATE_TUNING_TASK(
        sql_text => my_sqltext,
        user_name => 'SCOTT',
        scope => 'COMPREHENSIVE',
        time_limit => 60,
        task_name => 'tune_emp_query'
    );
END;
/

-- 执行建议任务
EXEC DBMS_SQLTUNE.EXECUTE_TUNING_TASK('tune_emp_query');

-- 查看建议
SELECT DBMS_SQLTUNE.REPORT_TUNING_TASK('tune_emp_query') FROM dual;
```

---

## 面试高频问题

### Q1: SGA 和 PGA 的区别是什么？

SGA 是共享内存区域，所有进程共享；PGA 是进程私有内存，每个服务器进程有自己独立的 PGA。SGA 主要存储缓存数据，PGA 存储排序、哈希等进程私有数据。

### Q2: 什么情况下会导致 ORA-04031？

通常是共享池（Shared Pool）内存不足或碎片化。常见原因：
1. 共享池配置太小
2. 应用没有使用绑定变量，导致大量硬解析
3. 长时间运行的数据库，共享池碎片化

### Q3: 如何判断 Buffer Cache 是否足够大？

监控 `v$sysstat` 中的 `physical reads` 和 `buffer cache gets`，计算命中率。命中率应该在 95% 以上。如果低于 90%，需要增大 buffer cache。

---

## 总结

| 组件 | 作用 | 调优要点 |
|-----|------|---------|
| Database Buffer Cache | 缓存数据块 | 命中率 > 95% |
| Shared Pool | 缓存 SQL、字典信息 | 绑定变量、避免硬解析 |
| Redo Log Buffer | 缓存事务日志 | 不需太多，几十 MB 即可 |
| Large Pool | 大型操作专用 | RMAN 备份时需要 |
| PGA Sort Area | 排序操作 | 避免磁盘排序 |

合理的内存配置是 Oracle 性能的基础。下一节，我们来看看 SGA 和 PGA 中的数据是如何被后台进程管理的。

---

## 下一步

- [Oracle 后台进程](/database/oracle/background-process)：DBWn、LGWR 的工作原理
- [Oracle SQL 优化](/database/oracle/sql-tuning)：如何写出高效的 SQL
