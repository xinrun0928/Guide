# Oracle 后台进程：数据库的「幕后英雄」

你有没有好奇过：

当你执行一条 SQL 时，Oracle 是如何在后台「默默」完成这一切的？

DBWn 什么时候把数据写回磁盘？LGWR 什么时候切换日志？SMON 什么时候在收拾「烂摊子」？

今天，我们来认识 Oracle 的后台进程——这些默默工作的「幕后英雄」。

---

## Oracle 进程架构

在了解后台进程之前，先看一下 Oracle 的完整进程架构：

```
┌─────────────────────────────────────────────────────────────┐
│                      User Process                           │
│                    (客户端进程)                              │
└────────────────────────────┬────────────────────────────────┘
                             │ 连接请求
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                   Server Process                            │
│                  (服务器进程)                                │
│  • 接收用户请求                                             │
│  • 执行 SQL                                                 │
│  • 返回结果                                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
     ┌────────────────────────┼────────────────────────┐
     ▼                        ▼                        ▼
┌─────────┐            ┌─────────┐            ┌─────────┐
│  SMON   │            │  PMON   │            │  DBWn   │
│系统监控  │            │进程监控  │            │数据库写入│
└─────────┘            └─────────┘            └─────────┘
     │                        │                        │
     └────────────────────────┼────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    SGA (Shared Memory)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Disk (Physical Files)                     │
└─────────────────────────────────────────────────────────────┘
```

后台进程是 Oracle 实例的核心组件，它们在数据库运行时持续工作，确保数据一致性、完整性和性能。

---

## 核心后台进程

### 1. DBWn（Database Writer）- 数据库写入进程

#### 它是干什么的？

DBWn 负责将 **脏数据（dirty buffers）** 从 Buffer Cache 写入数据文件。

**脏数据**：已修改但尚未写入磁盘的数据块。

```sql
-- 查看 DBWn 进程（Linux 环境）
[oracle@server ~]$ ps -ef | grep dbw
oracle   12345     1  ...  ora_dbw0_orcl
oracle   12346     1  ...  ora_dbw1_orcl
```

#### 为什么 DBWn 叫「懒惰的写」？

DBWn 采用了**延迟写入（lazy write）**策略——它不会每次数据修改都立即写盘，而是：

1. **检查点（CKPT）触发**：LGWR 记录检查点位置后通知 DBWn
2. **缓存空间不足**：需要腾出空间加载新数据
3. **表空间检查点**：特定表空间的检查点
4. **实例关闭**：正常关闭数据库时

```sql
-- 手动触发 DBWn（很少用）
ALTER SYSTEM CHECKPOINT;

-- 查看 DBWn 的检查点工作
SQL> SELECT checkpoint_process, write_requests, checkpoints
FROM v$instance_recovery;

CHECKPOINT_ WRITE_REQUESTS   CHECKPOINTS
----------- -------------- -----------
ENABLED                1256           34
```

#### 多DBWn进程（DBW0-DBW9）

Oracle 允许多个 DBWn 进程并行工作，提高写入效率：

```sql
-- 配置多个 DBWn 进程
-- 在 init.ora 或 spfile 中配置
-- DB_WRITER_PROCESSES = 4
```

在多核 CPU 或 RAID 阵列环境中，配置多个 DBWn 可以显著提升写入性能。

---

### 2. LGWR（Log Writer）- 日志写入进程

#### 它是干什么的？

LGWR 负责将 **Redo Log Buffer** 中的内容写入在线重做日志文件。

这是 Oracle 事务提交的核心环节。

```sql
-- 查看 LGWR 进程
[oracle@server ~]$ ps -ef | grep lgw
oracle   12340     1  ...  ora_lgwr_orcl
```

#### LGWR 的写入时机

| 触发条件 | 说明 |
|---------|------|
| 用户提交事务 | COMMIT 时必须写入 |
| 日志缓冲区 1/3 满 | 缓冲区快满时 |
| 日志缓冲区超过 1MB | 超过阈值时 |
| 每3秒 | 定时写入 |
| DBWn 写入前 | 检查点同步 |

**关键点**：LGWR 是**同步写入**的。事务提交时，必须等 LGWR 完成才能返回成功。这就是为什么日志文件要放在高性能磁盘上。

```sql
-- 查看 LGWR 的 I/O 统计
SQL> SELECT name, gets, waits, time_waited
FROM v$latch WHERE name LIKE '%log%';

NAME                           GETS     WAITS TIME_WAITED
------------------------------ ----- ---------- -----------
redo allocation                     5          0            0
redo copy                           2          0            0
```

---

### 3. CKPT（Checkpoint Process）- 检查点进程

#### 它是干什么的？

CKPT 负责**更新控制文件和数据文件头**，记录检查点位置。

检查点告诉系统：「在这一点之前的所有修改都已经写入磁盘了，如果系统崩溃，恢复只需从这个位置开始。」

```sql
-- 查看检查点信息
SQL> SELECT checkpoint_change#, checkpoint_time
FROM v$database;

CHECKPOINT_CHANGE# CHECKPOINT_TIME
------------------ -------------------
            9876543 24-MAR-2026 10:30:45

-- 查看当前日志序列
SQL> SELECT sequence#, status FROM v$log WHERE status = 'CURRENT';

 SEQUENCE# STATUS
---------- --------
        89 CURRENT
```

#### 检查点类型

| 类型 | 触发条件 | 影响范围 |
|-----|---------|---------|
| 完全检查点 | 实例关闭 | 所有数据文件 |
| 表空间检查点 | 表空间脱机 | 特定数据文件 |
| 增量检查点 | 定期触发 | 部分脏块 |
| 文件检查点 | 数据文件操作 | 特定文件 |

---

### 4. SMON（System Monitor）- 系统监控进程

#### 它是干什么的？

SMON 是 Oracle 的**清洁工**，负责各种系统级的清理工作：

1. **实例恢复**：数据库崩溃后，自动进行实例恢复
2. **清理临时段**：清理使用完毕的临时段
3. **合并空闲空间**：合并表空间中的碎片空间
4. **维护UNDO表空间**：清理过期的 UNDO 数据

```sql
-- 查看 SMON 的工作
SQL> SELECT name, value FROM v$sysstat
WHERE name LIKE '%smon%' OR name LIKE '%SMON%';

NAME                                     VALUE
---------------------------------------- ----------
background timeouts                      15234
recovery array reads off end              12
```

**SMON 的实例恢复过程**：
```
崩溃发生
    ↓
SMON 读取控制文件，找到检查点位置
    ↓
读取检查点之后的在线日志
    ↓
应用 redo， redo
    ↓
打开数据库，正常运行
```

---

### 5. PMON（Process Monitor）- 进程监控进程

#### 它是干什么的？

PMON 是 Oracle 的**救生员**，负责清理失败的进程：

1. **回滚未提交事务**：释放异常终止的进程持有的锁
2. **释放资源**：释放 PGA 内存、解除锁定的资源
3. **注册服务**：向监听器注册数据库服务

```sql
-- PMON 负责清理断开的连接
-- 查看被 PMON 清理的进程
SQL> SELECT name, value FROM v$sysstat
WHERE name = 'user commits';

NAME                      VALUE
-------------------- ----------
user commits                   5678
```

**典型场景**：应用异常退出，连接断开，PMON 会自动回滚未提交的事务。

---

### 6. ARCn（Archiver Process）- 归档进程

#### 它是干什么的？

ARCn 负责将**已写满的日志组复制到归档日志文件**。

这是 Data Guard 和介质恢复的基础。

```sql
-- 查看归档进程
[oracle@server ~]$ ps -ef | grep arc
oracle   12350     1  ...  ora_arc0_orcl
oracle   12351     1  ...  ora_arc1_orcl

-- 查看归档模式
SQL> SELECT log_mode FROM v$database;

LOG_MODE
------------
ARCHIVELOG
```

#### ARCn 的工作时机

1. 日志切换时（LGWR 切换到下一个日志组）
2. 归档日志目标磁盘有空间
3. 归档进程可用

```sql
-- 手动归档
ALTER SYSTEM ARCHIVE LOG CURRENT;

-- 查看归档日志
SQL> SELECT sequence#, name, first_time, archived
FROM v$log_history
ORDER BY sequence# DESC
FETCH FIRST 10 ROWS;

 SEQUENCE# NAME                           FIRST_TIME              ARC
---------- ------------------------------ ----------------------- ---
        89 /u01/arch/1_89_123456789.dbf   24-MAR-2026 10:30:45    YES
        88 /u01/arch/1_88_123456789.dbf   24-MAR-2026 10:00:12    YES
```

---

### 7. MMON/MMNL/RECO - 其他重要进程

| 进程 | 全称 | 作用 |
|-----|-----|------|
| MMON | Manageability Monitor | 收集 AWR 统计信息 |
| MMNL | Manageability Monitor Lite | 收集轻量级统计 |
| RECO | Recoverer | 处理分布式事务恢复 |
| CJQ0 | Job Queue Coordinator | 调度后台作业 |
| QMNC | Queue Monitor Coordinator | 高级队列监控 |

```sql
-- 查看所有后台进程
SQL> SELECT program, background, pga_alloc_mem/1024/1024 AS pga_mb
FROM v$process
WHERE background = 1
ORDER BY program;

PROGRAM                    B    PGA_MB
------------------------ - -------
ARC0                       1       2.3
ARC1                       1       2.1
CKPT                       1       3.5
DBW0                       1       4.2
LGWR                       1       3.8
MMON                       1      25.6
PMON                       1       1.8
SMON                       1       5.2
```

---

## 进程协同工作示例

让我们追踪一条 `UPDATE` 语句的完整流程：

```
用户执行: UPDATE employees SET salary = 10000 WHERE id = 1;
         ↓
Server Process 接收请求，解析 SQL
         ↓
Server Process 在 Buffer Cache 中查找数据块
         ↓
找到数据块，加载到 Buffer Cache（如果没有在缓存中）
         ↓
修改数据块（内存中修改，标记为脏）
         ↓
生成 redo，写入 Redo Log Buffer
         ↓
用户执行 COMMIT
         ↓
LGWR 将 redo 从 Buffer 写入在线日志文件（同步）
         ↓
返回 "Commit complete" 给用户
         ↓
（稍后）CKPT 触发
         ↓
DBWn 将脏数据写入数据文件
         ↓
（如果归档模式）ARCn 复制日志到归档文件
```

---

## 面试高频问题

### Q1: LGWR 和 DBWn 有什么区别？

LGWR 将 redo 日志写入磁盘（同步，必须完成才能提交）；DBWn 将脏数据写入数据文件（异步延迟写入）。LGWR 必须先完成，DBWn 可以稍后执行。

### Q2: 什么情况下会触发实例恢复？

实例异常关闭（如断电、内核故障、SHUTDOWN ABORT）时，Oracle 下次启动会执行实例恢复。SMON 负责这个过程，读取 redo 日志重做未持久化的修改。

### Q3: SMON 和 PMON 的区别是什么？

SMON 负责系统级清理（临时段、空间合并、实例恢复）；PMON 负责进程级清理（回滚事务、释放锁、清理断开连接的进程）。

### Q4: ARCn 进程什么时候工作？

当日志切换发生且数据库处于 ARCHIVELOG 模式时，ARCn 将已满的日志组复制到归档目的地。

---

## 总结

| 进程 | 核心职责 | 面试关注点 |
|-----|---------|---------|
| DBWn | 脏数据写入磁盘 | 延迟写入、增量检查点 |
| LGWR | 日志写入磁盘 | 同步写入、提交保证 |
| CKPT | 检查点更新 | 恢复起点 |
| SMON | 系统监控恢复 | 实例恢复、空间清理 |
| PMON | 进程监控清理 | 事务回滚、资源释放 |
| ARCn | 归档日志 | 归档模式、恢复基础 |

理解这些后台进程，是理解 Oracle 如何保证数据一致性和持久性的关键。

---

## 下一步

- [Oracle 事务与并发](/database/oracle/transaction)：MVCC 和锁机制
- [Oracle 物理结构](/database/oracle/physical-structure)：日志和数据文件的工作原理
