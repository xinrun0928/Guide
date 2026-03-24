# Oracle ASM：自动存储管理的利器

你有没有觉得：

磁盘阵列配置太复杂。

数据文件管理太繁琐。

Oracle ASM，就是来解决这个问题的。

今天，认识 Oracle 的自动存储管理。

---

## ASM 是什么？

ASM（Automatic Storage Management，自动存储管理）是 Oracle 提供的存储管理解决方案，简化数据库存储管理，提高 I/O 性能。

```
ASM 架构：

┌─────────────────────────────────────────────────────┐
│                     ASM 实例                         │
│  ┌───────────────────────────────────────────────┐  │
│  │              ASM 磁盘组                        │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐         │  │
│  │  │ Disk 1  │ │ Disk 2  │ │ Disk 3  │         │  │
│  │  │ (Failure │ │ (Failure │ │ (Failure │         │  │
│  │  │  Group 1)│ │  Group 1)│ │  Group 2)│         │  │
│  │  └─────────┘ └─────────┘ └─────────┘         │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────┐
│           数据库实例使用 ASM 文件                      │
│  +DATA/orcl/controlfile/control01.ctl              │
│  +DATA/orcl/datafile/system01.dbf                  │
│  +DATA/orcl/onlinelog/redo01.log                   │
└─────────────────────────────────────────────────────┘
```

---

## ASM 的核心概念

### ASM 磁盘组

| 组件 | 说明 |
|-----|------|
| 磁盘组 | ASM 管理的存储单元 |
| 磁盘 | 物理磁盘或分区 |
| 文件 | ASM 管理的数据库文件 |
| 故障组 | 磁盘组内的冗余单元 |

### 冗余级别

| 冗余 | 说明 | 需要的磁盘数 |
|-----|------|-------------|
| EXTERNAL | 无冗余，依靠外部 RAID | 1+ |
| NORMAL | 双路镜像（默认） | 2+ |
| HIGH | 三路镜像 | 3+ |
| FLEX | 可配置的镜像 | 3+ |

---

## ASM 实例

### ASM 实例 vs 数据库实例

| 组件 | ASM 实例 | 数据库实例 |
|-----|---------|-----------|
| 内存 | SGA（较小） | SGA + PGA |
| 后台进程 | RBAL、ARBn 等 | DBWn、LGWR 等 |
| 访问 | 不解析 SQL | 解析和执行 SQL |
| 启动 | 先于数据库启动 | 依赖于 ASM |

### 初始化参数

```sql
-- ASM 实例关键参数
INSTANCE_TYPE = ASM
ASM_POWER_LIMIT = 11          -- 重新平衡功率
ASM_DISKSTRING = '/dev/oracleasm/disks/*'  -- 发现路径
ASM_DISKGROUPS = 'DATA', 'FRA'  -- 挂载的磁盘组
```

---

## 创建 ASM 磁盘组

### 发现磁盘

```sql
-- 查看发现的磁盘
SELECT path, header_status, mount_status, state
FROM v$asm_disk;

-- 查看磁盘组
SELECT group_number, name, type, total_mb, free_mb
FROM v$asm_diskgroup;
```

### 创建磁盘组

```sql
-- 创建外部冗余磁盘组
CREATE DISKGROUP data EXTERNAL REDUNDANCY
DISK '/dev/oracleasm/disks/DISK1';

-- 创建普通冗余磁盘组
CREATE DISKGROUP data_normal NORMAL REDUNDANCY
FAILGROUP failure_group_1 DISK '/dev/oracleasm/disks/DISK1'
FAILGROUP failure_group_2 DISK '/dev/oracleasm/disks/DISK2';

-- 创建高冗余磁盘组
CREATE DISKGROUP data_high HIGH REDUNDANCY
FAILGROUP fg1 DISK '/dev/oracleasm/disks/DISK1'
FAILGROUP fg2 DISK '/dev/oracleasm/disks/DISK2'
FAILGROUP fg3 DISK '/dev/oracleasm/disks/DISK3';
```

---

## ASM 文件管理

### ASM 文件命名

```
ASM 文件命名格式：
+磁盘组/数据库/文件类型/文件标签

示例：
+DATA/orcl/CONTROLFILE/Current.256.123456789
+DATA/orcl/DATAFILE/SYSTEM.256.123456789
+DATA/orcl/ONLINELOG/Group_1.256.123456789
+FRA/orcl/ARCHIVELOG/Thread_1_seq_1234.256.123456789
```

### 文件模板

| 模板 | 说明 | 条带化 |
|-----|------|--------|
| CONTROLFILE | 控制文件 | 细粒度 |
| DATAFILE | 数据文件 | 粗粒度 |
| ONLINELOG | 在线日志 | 细粒度 |
| ARCHIVELOG | 归档日志 | 粗粒度 |
| TEMPFILE | 临时文件 | 粗粒度 |
| BACKUPSET | 备份集 | 粗粒度 |

---

## 磁盘组操作

### 添加磁盘

```sql
-- 添加磁盘到磁盘组
ALTER DISKGROUP data ADD DISK 
    '/dev/oracleasm/disks/DISK4'
    NAME disk4
    SIZE 100G;

-- 添加故障组
ALTER DISKGROUP data ADD FAILGROUP fg2 DISK 
    '/dev/oracleasm/disks/DISK5',
    '/dev/oracleasm/disks/DISK6';
```

### 删除磁盘

```sql
-- 删除磁盘（重新平衡后生效）
ALTER DISKGROUP data DROP DISK disk4;

-- 放弃删除操作
ALTER DISKGROUP data UNDROP DISKS;
```

### 重新平衡

```sql
-- 手动重新平衡
ALTER DISKGROUP data REBALANCE POWER 8;

-- 查看重新平衡进度
SELECT group_number, operation, state, power, actual,sofar, est_work, est_rate
FROM v$asm_operation;

-- 修改重新平衡功率
ALTER DISKGROUP data REBALANCE POWER 11;
```

---

## ASM 特性

### 条带化

```sql
-- ASM 条带化有两种模式：
-- 1. 粗粒度条带化（默认）
--    条带单元 1MB，适合顺序 I/O
-- 2. 细粒度条带化
--    条带单元 128KB，适合随机 I/O

-- 控制文件使用细粒度条带化
-- 数据文件使用粗粒度条带化
```

### 镜像与故障恢复

```sql
-- 查看磁盘组冗余
SELECT group_number, name, type, total_mb, usable_file_mb
FROM v$asm_diskgroup;

-- 查看镜像状态
SELECT group_number, disk_number, failgroup, reads, writes, read_time, write_time
FROM v$asm_disk
ORDER BY group_number, disk_number;
```

### 热插拔

```sql
-- 在线添加磁盘
ALTER DISKGROUP data ADD DISK '/dev/oracleasm/disks/DISK7';

-- 在线删除磁盘
ALTER DISKGROUP data DROP DISK disk7;

-- 在线挂载/卸载磁盘组
ALTER DISKGROUP data DISMOUNT;
ALTER DISKGROUP data MOUNT;
```

---

## RAC 中的 ASM

### 共享存储

```
RAC + ASM 架构：

┌─────────────────────────────────────────────────────┐
│           共享存储（ASM Disk Group）                   │
│  ┌─────────────────────────────────────────────┐   │
│  │  +DATA (数据库文件)                          │   │
│  │  +FRA  (快速恢复区)                          │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
     ↑                ↑                ↑
┌─────────┐     ┌─────────┐     ┌─────────┐
│ Node 1  │     │ Node 2  │     │ Node 3  │
│ Instance│     │ Instance│     │ Instance│
└─────────┘     └─────────┘     └─────────┘
```

### OCR 和 Voting Disk

```sql
-- 使用 ASM 存储 OCR 和 Voting Disk
-- 在 Grid Infrastructure 安装时配置

-- 查看 OCR 位置
ocrcheck

-- 查看 Voting Disk 位置
crsctl query css votedisk
```

---

## 性能监控

### 关键视图

```sql
-- 查看磁盘 I/O 统计
SELECT group_number, disk_number, path,
       reads, writes, read_time, write_time,
       read_err, write_err
FROM v$asm_disk
ORDER BY reads DESC;

-- 查看磁盘组空间使用
SELECT name, type, sector_size, block_size,
       total_mb, free_mb, usable_file_mb,
       ROUND(free_mb/total_mb*100, 2) AS free_pct
FROM v$asm_diskgroup;

-- 查看 ASM 文件
SELECT group_number, file_number, type, striped, mirror, redundancy
FROM v$asm_file;
```

### 性能调优

```sql
-- 查看 I/O 延迟
SELECT disk_number, path, read_time, write_time,
       reads, writes,
       ROUND(read_time/NULLIF(reads,0)*1000, 2) AS avg_read_ms,
       ROUND(write_time/NULLIF(writes,0)*1000, 2) AS avg_write_ms
FROM v$asm_disk
WHERE reads + writes > 0;

-- 查看磁盘组性能
SELECT name, reads, writes, read_time, write_time
FROM v$asm_diskgroup;
```

---

## 面试高频问题

### Q1: ASM 的冗余级别有哪些？

EXTERNAL（外部冗余，无 ASM 镜像）、NORMAL（双向镜像）、HIGH（三向镜像）、FLEX（可配置）。

### Q2: ASM 文件和普通文件有什么区别？

ASM 文件由 ASM 实例管理，使用 +磁盘组/数据库/文件类型 的命名方式，支持在线条带化和镜像，自动负载均衡。

### Q3: ASM 重新平衡是什么？

当添加或删除磁盘时，ASM 会重新分配数据以保持负载均衡，可以通过 POWER 参数控制重新平衡的速度。

---

## 总结

ASM 简化了数据库存储管理：

| 特性 | 优势 |
|-----|------|
| 自动条带化 | 优化 I/O 性能 |
| 自动镜像 | 数据保护 |
| 在线操作 | 无停机维护 |
| 统一管理 | 简化存储管理 |

ASM 是 Oracle 数据库存储的标准方案。

---

## 下一步

- [Oracle RMAN](/database/oracle/rman)：备份恢复
- [Oracle RAC](/database/oracle/rac)：集群架构
