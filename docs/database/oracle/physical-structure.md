# Oracle 物理结构：数据文件、日志文件、控制文件

DBA 最怕什么？

凌晨 3 点电话响起："数据库起不来了，alert log 报错 control file lost。"

如果你了解 Oracle 的物理结构，就会知道：**这种灾难本可以避免**。Oracle 的物理结构设计，处处体现着对数据安全的极致追求。

今天，我们就来揭开 Oracle 物理结构的神秘面纱。

---

## Oracle 物理结构全景图

Oracle 数据库的物理结构由以下几类文件组成：

```
┌────────────────────────────────────────────────────────────────┐
│                     Oracle Physical Structure                   │
│                                                                │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐ │
│   │  控制文件     │  │   参数文件     │  │     密码文件          │ │
│   │ Control File │  │ Parameter File│  │    Password File    │ │
│   └──────────────┘  └──────────────┘  └──────────────────────┘ │
│                                                                │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │                    数据文件 (Data Files)                  │ │
│   │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐  │ │
│   │  │ SYSTEM     │  │ SYSAUX     │  │    USERS           │  │ │
│   │  │ 表空间     │  │ 表空间      │  │    表空间           │  │ │
│   │  └────────────┘  └────────────┘  └────────────────────┘  │ │
│   └──────────────────────────────────────────────────────────┘ │
│                                                                │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │              日志文件 (Redo Log Files)                     │ │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │ │
│   │  │ GROUP 1 │  │ GROUP 2 │  │ GROUP 3 │  (归档日志)        │ │
│   │  │ member  │  │ member  │  │ member  │  ───────────►     │ │
│   │  └─────────┘  └─────────┘  └─────────┘                  │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

---

## 控制文件（Control File）

### 什么是控制文件？

控制文件是 Oracle 数据库的"导航仪"，一个**很小的二进制文件**（通常几 MB），但记录了数据库的核心信息。

### 控制文件记录什么？

```sql
-- 查看控制文件位置
SQL> SELECT name FROM v$controlfile;

NAME
----------------------------------------
/u01/oradata/orcl/control01.ctl
/u01/oradata/orcl/control02.ctl
/u01/oradata/orcl/control03.ctl
```

控制文件记录的内容：

| 信息类型 | 说明 |
|--------|------|
| 数据库名称和创建时间 | 数据库的身份标识 |
| 数据文件位置 | 所有数据文件的路径和大小 |
| 日志文件位置 | 所有日志文件的信息 |
| 当前日志序列号 | 用于恢复的日志位置 |
| 检查点信息 | 用于实例恢复的起点 |
| 表空间信息 | 所有表空间的状态 |

### 为什么需要多份控制文件？

**防止单点故障**。Oracle 建议至少保留 3 份控制文件，放在不同磁盘上。

```sql
-- 查看控制文件的备份策略
-- 通过初始化参数 control_files 指定
-- 在 init.ora 或 spfile 中配置：
-- control_files = ('/u01/.../control01.ctl', '/u02/.../control02.ctl', '/u03/.../control03.ctl')
```

一旦控制文件损坏，数据库会立即崩溃。所以**生产环境一定要 multiplex 控制文件**。

### 面试追问

**Q: 控制文件丢失怎么办？**

1. 如果有备份：从备份恢复控制文件
2. 如果有多份副本：用其他副本恢复
3. 如果是最后手段：用 `CREATE CONTROLFILE` 重建

---

## 参数文件（Parameter File）

### 为什么需要参数文件？

Oracle 启动时需要知道：**内存怎么分配、哪些文件在哪、归档模式是什么**——这些配置信息都存在参数文件里。

### pfile vs spfile

Oracle 有两种参数文件：

| 类型 | 文件格式 | 特点 |
|-----|---------|------|
| pfile | 文本文件（init.ora） | 可用文本编辑器修改 |
| spfile | 二进制文件（spfile.ora） | 只能通过 ALTER SYSTEM 修改，可持久化 |

```sql
-- 从 spfile 创建 pfile
CREATE PFILE = '/u01/init_orcl.ora' FROM SPFILE;

-- 从 pfile 启动
STARTUP PFILE='/u01/init_orcl.ora';

-- 修改 spfile 参数（持久化）
ALTER SYSTEM SET memory_target = 4G SCOPE = SPFILE;

-- 修改 spfile 参数（只对当前实例生效）
ALTER SYSTEM SET memory_target = 4G SCOPE = MEMORY;

-- 同时修改当前实例和 spfile
ALTER SYSTEM SET memory_target = 4G SCOPE = BOTH;
```

### 常用初始化参数

```sql
-- 内存相关
memory_target        -- 自动内存管理（Oracle 11g+）
sga_target           -- SGA 大小
pga_aggregate_target -- PGA 大小目标

-- 进程相关
processes           -- 最大进程数
sessions            -- 最大会话数

-- 归档相关
log_archive_dest_1  -- 归档日志目标
log_archive_format  -- 归档日志格式

-- 其他
db_name             -- 数据库名称
db_unique_name      -- 数据库唯一名称（RAC 环境）
dispatchers         -- 共享服务器配置
```

---

## 数据文件（Data Files）

### 数据文件是什么？

数据文件是 Oracle 存储用户数据的地方。**每个表空间由一个或多个数据文件组成**。

```sql
-- 查看数据文件信息
SQL> SELECT tablespace_name, file_name, bytes/1024/1024 AS size_mb
     FROM dba_data_files;

TABLESPACE_NAME  FILE_NAME                                    SIZE_MB
---------------- ---------------------------------------- ----------
SYSTEM           /u01/oradata/orcl/system01.dbf                  700
SYSAUX           /u01/oradata/orcl/sysaux01.dbf                  600
USERS            /u01/oradata/orcl/users01.dbf                   50
EXAMPLE          /u01/oradata/orcl/example01.dbf               150
```

### 必读的表空间

Oracle 安装后会自动创建几个核心表空间：

| 表空间 | 用途 | 能否脱机 |
|-------|------|---------|
| SYSTEM | 存储数据字典 | 不能 |
| SYSAUX | 存储系统工具和组件 | 不能 |
| UNDOTBS1 | 存储撤销数据（Undo） | 可以 |
| TEMP | 存储临时数据（排序等） | 可以 |
| USERS | 用户默认表空间 | 可以 |

**SYSTEM 和 SYSAUX 表空间绝对不能脱机**，否则数据库会崩溃。

### 数据文件的状态

```sql
-- 查看数据文件状态
SQL> SELECT file#, status FROM v$datafile;

     FILE# STATUS
---------- -------
         1 SYSTEM
         2 ONLINE
         3 ONLINE
         4 ONLINE

-- 脱机/联机数据文件
ALTER DATABASE DATAFILE '/u01/.../users01.dbf' OFFLINE;
ALTER DATABASE DATAFILE '/u01/.../users01.dbf' ONLINE;
```

---

## 日志文件（Redo Log Files）

### 什么是重做日志？

重做日志是 Oracle 最核心的组件之一。它记录了**所有对数据库的修改操作**，用于：

1. **数据恢复**：实例崩溃后，从日志中恢复未写入磁盘的事务
2. **介质恢复**：数据文件损坏时，恢复到某个时间点
3. **逻辑备份**：用于逻辑导出（Data Pump）

### 重做日志的工作原理

Oracle 使用**日志组循环写**的方式工作：

```
┌──────────────────────────────────────────────────────────────┐
│                    Redo Log 工作原理                         │
│                                                              │
│  日志组 1 (ACTIVE) ◄──── 当前正在写入                        │
│  日志组 2 (INACTIVE)                                         │
│  日志组 3 (INACTIVE)                                         │
│                                                              │
│  当组 1 写满后，LGWR 切换到组 2，组 1 被归档（如果归档模式）  │
└──────────────────────────────────────────────────────────────┘
```

```sql
-- 查看日志文件信息
SQL> SELECT group#, sequence#, bytes, members, status
     FROM v$log;

    GROUP#  SEQUENCE#     BYTES    MEMBERS STATUS
---------- ---------- ---------- ---------- ----------------
         1          1   52428800          2 CURRENT
         2          0   52428800          2 INACTIVE
         3          0   52428800          2 INACTIVE

-- 查看日志成员
SQL> SELECT group#, member FROM v$logfile;

    GROUP# MEMBER
---------- -----------------------------------------
         1 /u01/oradata/orcl/redo01.log
         1 /u02/oradata/orcl/redo01.log
         2 /u01/oradata/orcl/redo02.log
         2 /u02/oradata/orcl/redo02.log
         3 /u01/oradata/orcl/redo03.log
         3 /u02/oradata/orcl/redo03.log
```

### 归档模式

Oracle 有两种日志模式：

| 模式 | 说明 | 用途 |
|-----|------|------|
| NOARCHIVELOG | 日志组循环覆盖，不保存 | 开发测试 |
| ARCHIVELOG | 日志组写满后归档保存 | 生产环境 |

```sql
-- 查看归档模式
SQL> SELECT log_mode FROM v$database;

LOG_MODE
------------
ARCHIVELOG

-- 切换归档日志
ALTER SYSTEM ARCHIVE LOG CURRENT;
```

**生产环境必须开启归档模式**，否则无法进行有效的备份和恢复。

### 面试高频问题

**Q: Redo Log 满了怎么办？**

这通常意味着归档进程（ARCn）出了问题，导致日志组无法归档复用。

1. 检查归档进程是否在运行
2. 检查归档目标磁盘空间
3. 如果是紧急情况：`ALTER SYSTEM SWITCH LOGFILE` 强制切换

**Q: LGWR 和 DBWn 谁更重要？**

都很重要，但职责不同：

- **DBWn**：将脏数据写入数据文件（慢，异步）
- **LGWR**：将日志写入重做日志（快，同步）

**LGWR 必须先完成**，否则事务无法提交。这就是为什么日志文件要放在高速磁盘上。

---

## 密码文件（Password File）

### 密码文件的作用

密码文件存储了**具有 SYSDBA、SYSOPER 权限的用户密码**，用于：

1. 远程 SYSDBA 认证
2. 关闭和启动数据库
3. 创建和删除数据库

```sql
-- 查看密码文件
-- 位置：$ORACLE_HOME/dbs/orapw$ORACLE_SID
-- Linux/Unix: orapworcl
-- Windows: PWDorcl.ora
```

### 密码文件权限

只有 Oracle 软件所有者和 DBA 组用户可以访问密码文件。这是操作系统层面的安全控制。

---

## 物理结构的最佳实践

### 1. 控制文件多份存储

```sql
-- 建议：至少 3 份控制文件，放在不同磁盘
control_files = ('/u01/.../control01.ctl',
                 '/u02/.../control02.ctl',
                 '/u03/.../control03.ctl')
```

### 2. 日志文件多成员

```sql
-- 每个日志组至少 2 个成员，放在不同磁盘
-- 防止单块磁盘故障导致日志丢失
```

### 3. 分离存储

| 文件类型 | 推荐磁盘 | 原因 |
|---------|---------|------|
| 控制文件 | 高速 raid | 必须可靠 |
| 重做日志 | 最高速 raid 0/10 | 写入频繁，影响性能 |
| 数据文件 | Raid 5/10 | 读多写少 |
| 归档日志 | 大容量 | 需要长期保存 |

### 4. 监控磁盘空间

```sql
-- 监控数据文件空间
SELECT tablespace_name, 
       ROUND(used_percent, 2) AS used_pct
FROM dba_tablespace_usage_metrics
ORDER BY used_percent DESC;

-- 监控日志切换频率
SELECT sequence#, 
       blocks * block_size / 1024 / 1024 AS size_mb,
       status
FROM v$log;
```

---

## 总结

| 组件 | 作用 | 关键点 |
|-----|------|-------|
| 控制文件 | 数据库元数据 | 多份存储，防止单点故障 |
| 参数文件 | 初始化配置 | pfile vs spfile |
| 数据文件 | 存储用户数据 | 按表空间组织 |
| 重做日志 | 记录事务变更 | 归档模式生产必开 |
| 密码文件 | SYSDBA 认证 | 操作系统安全 |

理解了物理结构，下一节我们来看 Oracle 的逻辑结构——表空间、段、区、块。

---

## 下一步

- [Oracle 逻辑结构](/database/oracle/logical-structure)：表空间、段、区、块
- [Oracle 后台进程](/database/oracle/background-process)：LGWR、DBWn 的工作原理
