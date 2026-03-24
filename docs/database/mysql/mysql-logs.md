# MySQL 日志：Binlog、Redo Log、Undo Log

MySQL 能够保证数据不丢失、事务回滚，靠的就是这几本「日志」。

Binlog、Redo Log、Undo Log——三本日志，各司其职。

今天，我们彻底搞懂它们。

---

## 三种日志概览

| 日志 | 用途 | 写入时机 | 持久化 |
|------|------|----------|--------|
| Binlog | 主从复制、数据恢复 | 事务提交后 | 可配置 |
| Redo Log | 崩溃恢复、持久性 | 事务执行中 | 必须 |
| Undo Log | 回滚、MVCC | 事务执行中 | 必须 |

---

## Binlog（归档日志）

### 是什么？

Binlog（Binary Log）是 MySQL Server 层的日志，记录数据库的所有变更操作。

**用于**：主从复制、数据恢复。

### 记录内容

```sql
-- Binlog 记录的是变更的「逻辑」SQL
UPDATE orders SET status = 'paid' WHERE id = 1;
-- Binlog 记录：UPDATE orders SET status='paid' WHERE id=1
```

### Binlog 格式

| 格式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| STATEMENT | 记录 SQL 语句 | Binlog 小 | 某些函数结果不一致 |
| ROW | 记录行的变化 | 精确 | Binlog 大 |
| MIXED | 混合使用 | 平衡 | 复杂 |

```sql
-- 查看当前格式
SHOW VARIABLES LIKE 'binlog_format';

-- 设置格式
SET SESSION binlog_format = 'ROW';
```

### 开启 Binlog

```ini
[mysqld]
server-id = 1
log-bin = mysql-bin
binlog-format = ROW
sync-binlog = 1
```

---

## Redo Log（重做日志）

### 是什么？

Redo Log 是 InnoDB 引擎的日志，记录数据页的「物理变更」。

**用于**：崩溃恢复，保证持久性。

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                      Redo Log 原理                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  事务执行时：                                                │
│  1. 修改数据页                                               │
│  2. 同时写入 Redo Log（顺序写入）                            │
│  3. 返回客户端「执行成功」                                   │
│                                                             │
│  崩溃恢复时：                                                │
│  1. 读取 Redo Log                                            │
│  2. 重做未同步到数据文件的变更                               │
│  3. 恢复数据到一致状态                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 为什么需要 Redo Log？

直接修改数据文件是随机 I/O，效率低。

Redo Log 是顺序写入，效率高。

```
随机 I/O（直接修改数据文件）：
┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐
│ 1 │ │ 2 │ │ 3 │ │ 4 │ │ 5 │   磁头来回移动，效率低
└───┘ └───┘ └───┘ └───┘ └───┘

顺序 I/O（Redo Log）：
┌───┬───┬───┬───┬───┐
│ 1 │ 2 │ 3 │ 4 │ 5 │   磁头一直向前，效率高
└───┴───┴───┴───┴───┘
```

### Redo Log 的结构

```java
public class RedoLog {
    // Redo Log 文件组
    // ib_logfile0, ib_logfile1
    
    // 写入是循环的
    // checkpoint 之前的可以覆盖
}
```

### 配置

```ini
[mysqld]
innodb_log_file_size = 256M       # 单个日志文件大小
innodb_log_files_in_group = 3     # 日志文件数量
innodb_log_buffer_size = 16M      # 日志缓冲区大小
```

---

## Undo Log（回滚日志）

### 是什么？

Undo Log 是 InnoDB 引擎的日志，记录数据的「旧版本」。

**用于**：事务回滚、MVCC。

### 工作原理

```sql
-- 事务 A 执行
BEGIN;
UPDATE users SET age = 30 WHERE id = 1;
-- Undo Log 记录旧值：(id=1, age=25)

-- 事务 A 回滚
ROLLBACK;
-- 从 Undo Log 读取旧值，恢复数据
```

### MVCC 中的 Undo Log

```java
// 每行数据都有指向 Undo Log 的指针
public class Row {
    private Object[] columns;
    private long rollPtr;  // 指向 Undo Log 的指针
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                      MVCC 版本链                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  当前版本（最新事务修改）：                                   │
│  ┌──────┬───────┬──────────┐                              │
│  │ age  │ TX_ID │ ROLL_PTR │                              │
│  │ 30   │ 101   │    ↓     │                              │
│  └──────┴───────┴──────────┘                              │
│              │                                             │
│              │ ROLL_PTR                                    │
│              ↓                                             │
│  历史版本 1：                                               │
│  ┌──────┬───────┬──────────┐                              │
│  │ age  │ TX_ID │ ROLL_PTR │                              │
│  │ 25   │ 100   │    ↓     │                              │
│  └──────┴───────┴──────────┘                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 三种日志的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    事务执行过程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  事务开始                                                    │
│      │                                                       │
│      ├─→ 写入 Undo Log（记录旧值，用于回滚/MVCC）          │
│      │                                                       │
│      ├─→ 修改数据页（内存）                                   │
│      │                                                       │
│      └─→ 写入 Redo Log（记录变更，用于崩溃恢复）            │
│                                                             │
│  事务提交                                                    │
│      │                                                       │
│      ├─→ 写入 Binlog（记录变更，用于主从复制）               │
│      │                                                       │
│      └─→ 提交事务（Redo Log 标记为已提交）                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 两阶段提交

事务提交时，Redo Log 和 Binlog 需要保持一致。

```sql
-- 两阶段提交
BEGIN;

-- 1. 写入 Undo Log
-- 2. 修改数据页
-- 3. 写入 Redo Log（prepare 状态）

-- 事务提交
-- 4. 写入 Binlog
-- 5. 标记 Redo Log 为 commit 状态
```

如果写入 Binlog 后崩溃，Redo Log 是 prepare 状态，恢复时会检查 Binlog，决定是否重做。

---

## 日志参数配置

```ini
[mysqld]
# Binlog 配置
log-bin = mysql-bin
binlog-format = ROW
sync-binlog = 1
expire-logs-days = 7

# Redo Log 配置
innodb_log_file_size = 256M
innodb_log_buffer_size = 16M
innodb_flush_log_at_trx_commit = 1

# Undo Log 配置（MySQL 5.6+）
innodb_undo_tablespaces = 3
innodb_undo_log_truncate = ON
```

---

## 监控日志

```sql
-- 查看 Binlog 状态
SHOW MASTER STATUS;
SHOW BINARY LOGS;

-- 查看 Redo Log 状态
SHOW ENGINE INNODB STATUS\G
-- 输出中包含：
-- Log sequence number
-- Log flushed up to
-- Pages flushed up to

-- 查看 Undo Log 使用情况
SELECT * FROM information_schema.INNODB_TRX;
```

---

## 面试追问方向

- Binlog、Redo Log、Undo Log 的区别？
- 为什么需要 Redo Log？直接写数据文件不行吗？
- 两阶段提交是什么？为什么需要两阶段提交？
- Redo Log 和 Binlog 的一致性怎么保证？

> 三种日志各司其职：Binlog 用于主从复制，Redo Log 用于崩溃恢复，Undo Log 用于回滚和 MVCC。两阶段提交保证 Redo Log 和 Binlog 的一致性。
