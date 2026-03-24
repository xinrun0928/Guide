# Redo Log 与事务提交：MySQL 的持久性保证

MySQL 是怎么保证数据不丢失的？

事务提交后，即使数据库崩溃，重启后数据仍然完整。

答案就在 **Redo Log** 里。

---

## Redo Log 的前世今生

### 没有 Redo Log 的时代

```
用户提交事务 → 写入数据文件 → 返回成功
                        ↓
              此时如果数据库崩溃...
                        ↓
              数据文件可能只写了一半
                        ↓
              数据丢失！
```

直接写入数据文件是随机 I/O，效率低，而且可能写一半就崩溃。

### 有 Redo Log 之后

```
用户提交事务 → 写入 Redo Log → 写入数据文件 → 返回成功
                        ↓
              此时如果数据库崩溃...
                        ↓
              重启时读取 Redo Log
                        ↓
              重做未完成的变更
                        ↓
              数据完整恢复！
```

---

## Redo Log 的结构

### 日志缓冲区

```java
public class LogBuffer {
    // 内存中的日志缓冲区
    // 大小由 innodb_log_buffer_size 控制，默认 16MB
    
    // 事务执行时，先写缓冲区
    // 满足条件后刷新到磁盘
}
```

### 日志文件

```
┌─────────────────────────────────────────────────────────────┐
│                    Redo Log 文件组                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ib_logfile0  ┌──────────────────────────────┐            │
│               │                              │            │
│   ib_logfile1  │      日志内容                 │            │
│               │                              │            │
│   ib_logfile2  │   checkpoint ←───────────────│─← write pointer │
│               │         ↑                       │            │
│               │   读取范围                      │            │
│               └──────────────────────────────┘            │
│                                                             │
│   写入是循环的，当 write pointer 追上 read pointer，        │
│   新的日志会覆盖旧的日志                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Redo Log 的写入机制

### 写入时机

```ini
# innodb_flush_log_at_trx_commit 参数控制
# 
# 0：每秒刷新，不保证事务提交时刷新
# 1：每次事务提交都刷新（默认，最安全）
# 2：刷新到操作系统缓存，不保证落盘
```

| 值 | 说明 | 安全性 | 性能 |
|----|------|--------|------|
| 0 | 每秒刷新 | 低 | 高 |
| 1 | 每次提交刷新 | 高 | 低 |
| 2 | 刷新到 OS 缓存 | 中 | 中 |

### 最安全的配置

```ini
[mysqld]
innodb_flush_log_at_trx_commit = 1  # 每次提交都刷新
sync_binlog = 1                      # Binlog 也每次提交刷新
```

这会导致性能下降 10-20%，但数据安全性最高。

---

## Redo Log 与崩溃恢复

### 恢复流程

```
数据库崩溃
      │
      ↓
读取 Redo Log（从 checkpoint 开始）
      │
      ↓
遍历日志，识别未提交的事务
      │
      ↓
重做已提交事务的变更
      │
      ↓
回滚未提交事务的变更（Undo Log）
      │
      ↓
恢复完成
```

### 恢复过程图解

```
┌─────────────────────────────────────────────────────────────┐
│                      崩溃恢复流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Redo Log 内容：                                              │
│ ┌─────────────────────────────────────────────────────┐    │
│ │ T1 commit   │ T2 prepare │ T2 commit │ T3 prepare │    │
│ │ 已提交     │ 未提交      │ 已提交    │ 未提交     │    │
│ └─────────────────────────────────────────────────────┘    │
│                              ↑                              │
│                         checkpoint                          │
│                                                             │
│ 恢复结果：                                                   │
│ - T1：重做（已提交）                                        │
│ - T2：重做 + 回滚（prepare 但 commit 了）                    │
│ - T3：回滚（prepare 且未 commit）                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 两阶段提交

Redo Log 和 Binlog 需要保持一致，所以有了两阶段提交。

### 为什么需要两阶段提交？

```sql
-- 场景：事务提交
-- 1. 写 Redo Log（标记为 prepare）
-- 2. 写 Binlog
-- 3. 写 Redo Log（标记为 commit）
```

### 两阶段提交的四种情况

| 情况 | Redo Log (prepare) | Binlog | Redo Log (commit) | 处理 |
|------|-------------------|--------|-------------------|------|
| 1 | ✓ | ✓ | ✓ | 正常，已提交 |
| 2 | ✓ | ✓ | ✗ | 重做 Redo Log |
| 3 | ✓ | ✗ | ✗ | 回滚 |
| 4 | ✗ | ✗ | ✗ | 无操作 |

```java
// 崩溃恢复时
if (redo.prepare && binlog.exists) {
    // Binlog 存在，说明事务已提交，重做
    redo.commit();
} else if (redo.prepare && !binlog.exists) {
    // Binlog 不存在，说明未提交，回滚
    redo.rollback();
}
```

---

## Redo Log 参数调优

### 日志文件大小

```ini
[mysqld]
innodb_log_file_size = 256M
innodb_log_files_in_group = 3
```

- 日志文件太小：频繁 checkpoint，性能下降
- 日志文件太大：崩溃恢复时间长

### 日志缓冲区

```ini
[mysqld]
innodb_log_buffer_size = 64M  # 大事务时增大
```

### 检查点

```sql
-- 查看 checkpoint 信息
SHOW ENGINE INNODB STATUS\G
-- 输出：
-- Log sequence number: 123456789
-- Log flushed up to: 123456789
-- Pages flushed up to: 123456789
```

---

## Redo Log 与性能

### Redo Log 的性能影响

```java
// 写 Redo Log 的流程
public void writeRedoLog(byte[] data) {
    // 1. 写入日志缓冲区（内存操作，很快）
    logBuffer.append(data);
    
    // 2. 满足条件后，刷新到磁盘（磁盘操作，较慢）
    if (shouldFlush()) {
        logBuffer.flushToDisk();  // fsync
    }
}
```

### 优化建议

| 场景 | 建议 |
|------|------|
| 写入压力大 | 增大 innodb_log_buffer_size |
| 大事务多 | 增大 innodb_log_file_size |
| 数据安全优先 | innodb_flush_log_at_trx_commit = 1 |
| 性能优先 | innodb_flush_log_at_trx_commit = 2 |

---

## Java 代码：监控 Redo Log

```java
@Service
public class RedoLogMonitor {
    /**
     * 监控 Redo Log 使用情况
     */
    public RedoLogStatus getStatus() {
        try (Connection conn = dataSource.getConnection()) {
            ResultSet rs = conn.createStatement()
                .executeQuery("SHOW ENGINE INNODB STATUS");
            
            if (rs.next()) {
                String status = rs.getString("Status");
                return parseStatus(status);
            }
            return null;
        }
    }
    
    /**
     * 检查是否需要增大日志文件
     */
    public void checkAndAlert() {
        RedoLogStatus status = getStatus();
        
        // 如果 checkpoint 间隔小，说明日志文件可能太小
        if (status.getCheckpointAge() > 0.8) {
            alertService.alert("Redo Log 使用率超过 80%，建议增大日志文件");
        }
    }
}
```

---

## 一句话总结

Redo Log 是 MySQL 持久性的保障：事务提交时先写 Redo Log，再写数据文件；崩溃时通过 Redo Log 恢复数据。两阶段提交保证 Redo Log 和 Binlog 的一致性。
