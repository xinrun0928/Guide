# 事务日志：数据安全的最后防线

凌晨 3 点，数据库突然断电。

来电后重启，你最担心什么？**数据丢没丢。**

MySQL 靠 redo log，SQL Server 靠**事务日志（Transaction Log）**。它是数据库崩溃恢复能力的基石，是数据安全的最后防线。

今天，我们来深入理解 SQL Server 的事务日志。

## 事务日志是什么？

你可以把事务日志理解为一个**操作的「剧本」**。每次修改数据时，SQL Server 先把「要做什么」记录到日志，再真正修改数据页。

```
┌─────────────────────────────────────────────────────────┐
│                   事务执行流程                            │
│                                                         │
│  BEGIN TRANSACTION                                      │
│      │                                                  │
│      ↓                                                  │
│  ┌─────────────────────────────────┐                    │
│  │ 写入日志（物理操作已记录）        │ ← 最先执行         │
│  └─────────────────────────────────┘                    │
│      │                                                  │
│      ↓                                                  │
│  ┌─────────────────────────────────┐                    │
│  │ 修改数据页（内存中的数据）        │                    │
│  └─────────────────────────────────┘                    │
│      │                                                  │
│      ↓                                                  │
│  COMMIT TRANSACTION                                     │
│      │                                                  │
│      ↓                                                  │
│  ┌─────────────────────────────────┐                    │
│  │ 日志标记为已提交                 │                    │
│  └─────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
```

**关键点**：日志写入是顺序 I/O，比随机 I/O 快很多。而数据页可以稍后批量刷新到磁盘。

## 日志的物理结构

### 虚拟日志文件（VLF）

事务日志在物理上由多个**虚拟日志文件（Virtual Log File，VLF）** 组成。SQL Server 动态管理 VLF 的数量。

```sql
-- 查看日志文件的 VLF 信息
DBCC LOGINFO('YourDatabase');
```

返回的 `Status` 列很重要：

- **0** — VLF 可以重用（日志截断后）
- **2** — VLF 正在使用中，不能重用

### 日志序列号（LSN）

每个日志记录都有一个**日志序列号（Log Sequence Number，LSN）**，格式为 `VLF序号:偏移量`，用来保证：

1. **连续性** — LSN 严格递增，日志不会交叉
2. **可恢复性** — 通过 LSN 定位恢复点
3. **顺序恢复** — 按 LSN 顺序重做或回滚

```
日志记录结构：
┌─────────┬──────────┬──────────┬─────────────────────────┐
│ LSN     │ 事务ID   │ 操作类型 │ 修改的数据                │
├─────────┼──────────┼──────────┼─────────────────────────┤
│ 0001... │ T001     │ INSERT   │ (1, '商品A', 100)        │
│ 0002... │ T001     │ UPDATE   │ (1, '商品A', 200)        │
│ 0003... │ T002     │ DELETE   │ (2, '商品B', 50)         │
└─────────┴──────────┴──────────┴─────────────────────────┘
```

## 日志的工作模式

SQL Server 支持三种恢复模式，影响日志的行为：

### 简单恢复模式（SIMPLE）

日志只记录操作，不保留历史。**日志可以立即重用**，不需要备份日志。

```sql
-- 查看当前恢复模式
SELECT name, recovery_model_desc 
FROM sys.databases 
WHERE name = 'YourDatabase';

-- 切换到简单恢复模式
ALTER DATABASE YourDatabase
SET RECOVERY SIMPLE;
```

**特点**：
- 最小化日志管理
- 只能恢复到最近完整备份
- 适用于开发测试环境

### 完整恢复模式（FULL）

日志完整保留，直到备份。**这是生产环境的推荐模式**。

```sql
ALTER DATABASE YourDatabase
SET RECOVERY FULL;
```

**特点**：
- 所有操作都记录在日志
- 可以恢复到任意时间点
- 需要定期备份日志

### 大容量日志恢复模式（BULK_LOGGED）

对 `SELECT INTO`、`BULK INSERT`、`CREATE INDEX` 等操作使用最小日志记录，减少日志量。

```sql
ALTER DATABASE YourDatabase
SET RECOVERY BULK_LOGGED;
```

**特点**：
- 日志量更小
- 但某些操作不支持时间点恢复
- 通常与完整恢复模式配合使用

## 日志链：备份的连续性

在完整恢复模式下，日志形成一条**日志链（Log Chain）**：

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ 完整备份 │ →  │ 日志备份 │ →  │ 日志备份 │ →  │ 日志备份 │
│  (Full) │    │  (Log1) │    │  (Log2) │    │  (Log3) │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
     │                                          │
     └────────────────┐                         │
                      ↓                         │
                 ┌─────────┐                     │
                 │  恢复到 │ ←───────────────────┘
                 │  任意点  │
                 └─────────┘
```

**重要**：日志链不能断。如果某次日志备份失败，后续的日志备份就无法使用。恢复时必须从完整的日志链开始。

## 日志备份策略

```java
/**
 * 日志备份策略配置
 * 
 * 关键参数：
 * - 备份频率：根据业务允许的最大数据丢失量（RPO）决定
 * - 备份保留：根据业务允许的最大恢复时间（RTO）决定
 * - 备份位置：必须与数据文件在不同磁盘
 */
public class LogBackupStrategy {
    
    private static final int RPO_MINUTES = 15;  // 允许丢失 15 分钟数据
    private static final int LOG_BACKUP_INTERVAL_MINUTES = 15;
    
    /**
     * 计算日志备份频率
     * 
     * 假设：
     * - 每分钟产生约 500MB 日志
     * - 单个日志文件最大 100GB
     * 
     * @return 建议的备份间隔（分钟）
     */
    public int calculateBackupInterval() {
        // RPO 就是备份间隔
        return RPO_MINUTES;
    }
    
    /**
     * T-SQL 生成日志备份命令
     */
    public String generateBackupCommand(String dbName, String backupPath) {
        return String.format(
            "BACKUP LOG [%s] TO DISK = N'%s%s_backup_%%date%%.trn' " +
            "WITH NOFORMAT, NOINIT, NAME = N'%s-事务日志备份', SKIP, NOREWIND, NOUNLOAD",
            dbName, backupPath, dbName, dbName
        );
    }
}
```

## 日志管理与监控

### 查看日志使用情况

```sql
-- 查看事务日志使用情况
SELECT 
    DB_NAME(database_id) AS DatabaseName,
    total_log_size_in_bytes / 1024.0 / 1024 AS TotalLogMB,
    used_log_space_in_bytes / 1024.0 / 1024 AS UsedLogMB,
    used_log_space_in_percent AS UsedPercent,
    log_space_in_bytes_since_last_backup / 1024.0 / 1024 AS SinceLastBackupMB
FROM sys.dm_db_log_space_usage;
```

### 查看日志等待事件

```sql
-- 查看日志相关的等待
SELECT 
    wait_type,
    waiting_tasks_count,
    wait_time_ms,
    signal_wait_time_ms
FROM sys.dm_os_wait_stats
WHERE wait_type LIKE '%LOG%'
ORDER BY wait_time_ms DESC;
```

常见的日志等待类型：

| 等待类型 | 含义 |
|---------|------|
| LOGMGR | 等待日志写入完成 |
| LOGMGR_FLUSH | 日志缓冲区需要刷新 |
| LOGBUFFER | 等待日志缓冲区空间 |
| WRITELOG | 等待日志写入磁盘 |

### 日志截断与收缩

日志截断（Truncate）不是删除日志内容，而是**标记 VLF 为可重用**：

```sql
-- 简单恢复模式：检查点自动截断
-- 完整恢复模式：需要备份日志后才会截断

-- 强制截断日志（在备份日志后）
CHECKPOINT;

-- 收缩日志文件
DBCC SHRINKFILE(2, 100);  -- 收缩到 100MB
```

**警告**：永远不要在生产环境随意收缩日志文件，这可能导致日志链断裂。

## 崩溃恢复机制

当 SQL Server 启动时，会自动执行**崩溃恢复（Crash Recovery）**：

```
┌─────────────────────────────────────────────────────────┐
│                   崩溃恢复流程                            │
│                                                         │
│  1. 分析阶段（Analysis）                                 │
│     读取日志，确定哪些事务需要重做，哪些需要回滚           │
│                                                         │
│  2. 重做阶段（Redo）                                     │
│     按 LSN 顺序重做已提交但未写入磁盘的操作              │
│     从检查点开始向前扫描                                 │
│                                                         │
│  3. 回滚阶段（Undo）                                     │
│     回滚未提交事务的所有操作                             │
│     按 LSN 逆序执行                                     │
└─────────────────────────────────────────────────────────┘
```

这就是为什么 SQL Server 重启后，数据库需要「recovery」一段时间。如果日志文件损坏或丢失，数据库可能无法恢复。

## 日志的 I/O 优化

日志写入是**纯顺序 I/O**，这是它的优势。但配置不当也会成为瓶颈：

```java
/**
 * 日志文件配置最佳实践
 */
public class LogOptimization {
    
    /**
     * 日志文件配置建议
     * 
     * 关键点：
     * 1. 日志文件应该预先分配，避免自动增长
     * 2. 日志文件放在高速磁盘（与数据文件分离）
     * 3. 多个日志文件不会提升性能（只在文件损坏时备份）
     * 4. 增长量要适中（建议 64MB-1GB）
     */
    public void printBestPractices() {
        System.out.println("=== 事务日志配置最佳实践 ===");
        System.out.println();
        System.out.println("1. 位置选择：");
        System.out.println("   - 日志文件应与数据文件在不同磁盘");
        System.out.println("   - 优先选择写入性能高的存储");
        System.out.println();
        System.out.println("2. 预分配大小：");
        System.out.println("   - 根据业务量预估日志大小");
        System.out.println("   - 避免频繁的日志增长");
        System.out.println();
        System.out.println("3. 增长设置：");
        System.out.println("   - 建议固定大小增长（64MB-1GB）");
        System.out.println("   - 禁用百分比增长");
        System.out.println();
        System.out.println("4. VLF 数量：");
        System.out.println("   - 日志过小会导致 VLF 过多");
        System.out.println("   - 日志增长量决定 VLF 大小");
        System.out.println("   - 建议每个 VLF 至少 64MB");
    }
}
```

## 总结

事务日志是 SQL Server 数据安全的基石。理解它，需要记住三个核心点：

1. **日志是剧本** — 记录所有修改操作，保证可恢复性
2. **日志链不能断** — 完整恢复模式需要连续的日志备份
3. **日志需要管理** — 定期备份、及时截断、避免过度增长

---

**面试追问方向：**

- 如果日志文件所在的磁盘满了，会发生什么？
- 简单恢复模式和完整恢复模式，日志有什么本质区别？
- 如何判断日志链是否完整？日志备份失败后怎么处理？

这些问题，会在[备份与恢复](/database/sqlserver/backup)章节继续探讨。
