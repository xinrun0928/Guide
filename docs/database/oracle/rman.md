# Oracle RMAN：备份恢复全攻略

你有没有这种担忧：

数据库崩溃，数据全部丢失。

误删了关键表，想恢复却束手无策。

没有有效的备份策略，彻夜难眠。

RMAN，就是来解决这个问题的。

今天，掌握 Oracle 备份恢复的利器。

---

## RMAN 是什么？

RMAN（Recovery Manager）是 Oracle 自带的备份恢复工具，提供高效、可靠的数据库备份和恢复功能。

```
RMAN 架构：

┌─────────────────────────────────────────────────────────────┐
│                       RMAN 客户端                           │
│  发送备份/恢复命令                                           │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    目标数据库                                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              RMAN 通道进程                           │   │
│  │  执行备份/恢复操作，直接读取数据文件                    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                       备份介质                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │  磁盘备份   │  │  磁带备份   │  │  云备份     │       │
│  └─────────────┘  └─────────────┘  └─────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

---

## 备份类型

### 完整备份 vs 增量备份

| 类型 | 说明 | 备份时间 | 恢复时间 | 存储空间 |
|-----|------|---------|---------|---------|
| 完整备份 | 备份所有数据块 | 长 | 短 | 多 |
| 增量备份 | 只备份变化的数据块 | 短 | 长 | 少 |

```bash
# 完整备份
RMAN> BACKUP DATABASE;

# 一级增量备份（备份自上次完整或增量备份以来的变化）
RMAN> BACKUP INCREMENTAL LEVEL 1 DATABASE;

# 二级增量备份
RMAN> BACKUP INCREMENTAL LEVEL 2 DATABASE;
```

### 镜像备份 vs 备份集

| 类型 | 说明 |
|-----|------|
| 备份集 | RMAN 专有格式，可压缩、加密、可跳过空块 |
| 镜像备份 | 数据文件的精确副本，与 OS COPY 类似 |

```bash
# 备份集（默认）
RMAN> BACKUP AS BACKUPSET DATABASE;

# 镜像备份
RMAN> BACKUP AS COPY DATABASE;

# 压缩备份集
RMAN> BACKUP AS COMPRESSED BACKUPSET DATABASE;
```

---

## 常用备份命令

### 数据库完整备份

```bash
# 备份整个数据库
RMAN> BACKUP DATABASE;

# 备份数据库并包含归档日志
RMAN> BACKUP DATABASE PLUS ARCHIVELOG;

# 备份指定表空间
RMAN> BACKUP TABLESPACE users;

# 备份指定数据文件
RMAN> BACKUP DATAFILE '/u01/oradata/orcl/users01.dbf';
```

### 控制文件和归档日志备份

```bash
# 备份控制文件（强烈建议）
RMAN> BACKUP CURRENT CONTROLFILE;

# 备份归档日志
RMAN> BACKUP ARCHIVELOG ALL;

# 备份归档日志并删除已备份的日志
RMAN> BACKUP ARCHIVELOG ALL DELETE INPUT;

# 备份所有归档日志（包括未备份的）
RMAN> BACKUP ARCHIVELOG ALL NOT BACKED UP 2 TIMES;
```

### 备份优化

```bash
# 设置备份优化
RMAN> CONFIGURE BACKUP OPTIMIZATION ON;

# 跳过脱机数据文件
RMAN> BACKUP DATABASE SKIP OFFLINE;

# 跳过只读表空间
RMAN> BACKUP DATABASE SKIP READONLY;

# 跳过不可访问的文件
RMAN> BACKUP DATABASE SKIP INACCESSIBLE;
```

---

## 恢复操作

### 完全恢复

```bash
# 恢复整个数据库（需要 MOUNT 状态）
RMAN> SHUTDOWN IMMEDIATE;
RMAN> STARTUP MOUNT;
RMAN> RESTORE DATABASE;
RMAN> RECOVER DATABASE;
RMAN> ALTER DATABASE OPEN;

# 恢复表空间（可在 OPEN 状态进行）
RMAN> SQL 'ALTER TABLESPACE users OFFLINE';
RMAN> RESTORE TABLESPACE users;
RMAN> RECOVER TABLESPACE users;
RMAN> SQL 'ALTER TABLESPACE users ONLINE';
```

### 不完全恢复

```bash
# 基于时间的不完全恢复
RMAN> SHUTDOWN IMMEDIATE;
RMAN> STARTUP MOUNT;
RMAN> RESTORE DATABASE;
RMAN> RECOVER DATABASE UNTIL TIME "TO_DATE('2024-01-15 10:00:00','YYYY-MM-DD HH24:MI:SS')";
RMAN> ALTER DATABASE OPEN RESETLOGS;
```

### 数据文件恢复

```bash
# 查看数据文件状态
RMAN> SELECT FILE#, STATUS FROM V$DATAFILE;

# 恢复损坏的数据文件
RMAN> SQL 'ALTER DATABASE DATAFILE 4 OFFLINE';
RMAN> RESTORE DATAFILE 4;
RMAN> RECOVER DATAFILE 4;
RMAN> SQL 'ALTER DATABASE DATAFILE 4 ONLINE';
```

---

## RMAN 配置

### 查看配置

```bash
# 查看所有 RMAN 配置
RMAN> SHOW ALL;
```

### 常用配置

```bash
# 配置备份保留策略
RMAN> CONFIGURE RETENTION POLICY TO REDUNDANCY 2;  -- 保留 2 份
RMAN> CONFIGURE RETENTION POLICY TO RECOVERY WINDOW OF 7 DAYS;  -- 保留 7 天

# 配置默认备份类型
RMAN> CONFIGURE DEFAULT DEVICE TYPE TO DISK;
RMAN> CONFIGURE DEFAULT DEVICE TYPE TO SBT_TAPE;

# 配置通道数
RMAN> CONFIGURE DEVICE TYPE DISK PARALLELISM 4;

# 配置备份优化
RMAN> CONFIGURE BACKUP OPTIMIZATION ON;

# 配置控制文件备份
RMAN> CONFIGURE CONTROLFILE AUTOBACKUP ON;
RMAN> CONFIGURE CONTROLFILE AUTOBACKUP FORMAT FOR DEVICE TYPE DISK TO '/u01/backup/ctl_%F';
```

---

## 增量备份策略

### 备份策略设计

```
增量备份策略示例：

周日：完整备份（Level 0）
周一：增量 Level 1
周二：增量 Level 1
周三：增量 Level 1
周四：增量 Level 1
周五：增量 Level 1
周六：增量 Level 1

恢复时：
1. 恢复最近的 Level 0
2. 按顺序应用所有 Level 1
```

### 增量备份脚本

```bash
#!/bin/bash
# increment_backup.sh

rman target / <<EOF
RUN {
    # 如果是周日，做完整备份
    IF [ $(date +%w) = 0 ]; THEN
        BACKUP INCREMENTAL LEVEL 0 DATABASE;
    ELSE
        # 否则做增量备份
        BACKUP INCREMENTAL LEVEL 1 CUMULATIVE DATABASE;
    FI;
    
    # 备份归档日志并删除
    BACKUP ARCHIVELOG ALL DELETE INPUT;
    
    # 删除过期备份
    DELETE OBSOLETE;
}
EOF
```

---

## 验证与检查

### 验证备份

```bash
# 验证数据库是否可恢复
RMAN> RESTORE DATABASE VALIDATE;

# 验证备份集
RMAN> VALIDATE BACKUPSET 1;

# 检查数据库
RMAN> CHECK DATABASE;
```

### 列出备份

```bash
# 列出所有备份
RMAN> LIST BACKUP;

# 列出过期备份
RMAN> LIST EXPIRED BACKUP;

# 列出特定表空间的备份
RMAN> LIST BACKUP OF TABLESPACE users;

# 列出归档日志备份
RMAN> LIST ARCHIVELOG ALL;
```

---

## 恢复目录（Recovery Catalog）

### 创建恢复目录

```sql
-- 1. 创建恢复目录表空间
CREATE TABLESPACE rman_catalog
DATAFILE '/u01/oradata/rman/rman_catalog.dbf' SIZE 100M;

-- 2. 创建恢复目录用户
CREATE USER rman IDENTIFIED BY rman
DEFAULT TABLESPACE rman_catalog
QUOTA UNLIMITED ON rman_catalog;

GRANT CONNECT, RESOURCE TO rman;
GRANT RECOVERY_CATALOG_OWNER TO rman;

-- 3. 创建恢复目录
$ rman CATALOG rman/rman@rcat
RMAN> CREATE CATALOG;
```

### 使用恢复目录

```bash
# 连接到恢复目录
rman target / catalog rman/rman@rcat

# 同步恢复目录
RMAN> RESYNC CATALOG;
```

---

## 面试高频问题

### Q1: 完整备份和增量备份的区别？

完整备份备份所有数据块，恢复快但备份慢、占空间大；增量备份只备份自上次备份以来变化的数据块，备份快、占空间小，但恢复需要先恢复完整备份再应用增量。

### Q2: 如何设置 RMAN 备份保留策略？

使用 `CONFIGURE RETENTION POLICY`，可以设置为冗余数（如保留 2 份）或恢复窗口（如保留 7 天）。

### Q3: 备份集和镜像备份的区别？

备份集是 RMAN 专有格式，可以压缩、跳过空块、支持加密；镜像备份是数据文件的精确副本，与 OS COPY 类似。

---

## 总结

RMAN 是 Oracle 备份恢复的核心工具：

| 备份类型 | 说明 |
|---------|------|
| 完整备份 | 备份所有数据块 |
| 增量备份 | 备份变化的数据块 |
| 控制文件备份 | 备份控制文件 |
| 归档日志备份 | 备份归档日志 |

制定合理的备份策略，是保护数据安全的根本。

---

## 下一步

- [Oracle Data Guard](/database/oracle/data-guard)：灾备方案
- [Oracle 物理结构](/database/oracle/physical-structure)：数据文件管理
