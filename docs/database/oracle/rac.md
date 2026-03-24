# Oracle RAC：集群架构让数据库「横向扩展」

你有没有遇到过这种情况：

单库性能瓶颈，升级硬件也无济于事。

应用想连接集群，但数据库只有单机。

Oracle RAC，就是来解决这个问题的。

今天，认识 Oracle 的集群数据库架构。

---

## RAC 是什么？

RAC（Real Application Clusters，真实应用集群）允许多个 Oracle 实例同时访问同一个数据库，提供横向扩展能力和高可用性。

```
Oracle RAC 架构：

        应用服务器
            │
            ▼
    ┌───────────────────┐
    │    客户端连接      │
    └───────────────────┘
            │
     ┌──────┴──────┐
     ▼              ▼
┌─────────┐    ┌─────────┐
│ Node 1  │    │ Node 2  │
│ Instance│    │ Instance│
│   SGA   │    │   SGA   │
│   PGA   │    │   PGA   │
└────┬────┘    └────┬────┘
     │              │
     └──────┬───────┘
            ▼
    ┌───────────────────┐
    │   共享存储         │
    │ (ASM / NFS / OCFS)│
    └───────────────────┘
            │
            ▼
    ┌───────────────────┐
    │   单一数据库        │
    │  (Data Files,     │
    │   Control Files,   │
    │   Redo Logs)      │
    └───────────────────┘
```

---

## RAC 的核心优势

| 优势 | 说明 |
|-----|------|
| 高可用性 | 单节点故障不影响服务 |
| 横向扩展 | 增加节点提升性能 |
| 负载均衡 | 多节点分担请求 |
| 高性能 | 多核 CPU 并行处理 |

---

## RAC 组件

### 集群组件

| 组件 | 说明 |
|-----|------|
| OCR（Oracle Cluster Registry） | 存储集群配置信息 |
| Voting Disk | 存储节点成员信息，用于节点心跳 |
| Clusterware | Oracle 集群管理软件 |
| VIP（Virtual IP） | 虚拟 IP，屏蔽节点故障 |

### 数据库组件

| 组件 | 说明 |
|-----|------|
| 实例 | 每个节点一个实例 |
| SGA | 共享内存区域 |
| PGA | 进程私有内存 |
| Cache Fusion | 节点间缓存同步 |

---

## Cache Fusion

### 什么是 Cache Fusion？

Cache Fusion 是 RAC 最核心的技术，实现节点间内存数据的直接传输：

```
Cache Fusion 原理：

Node 1 需要 Node 2 缓存中的数据块
         ↓
Node 1 通过高速互联向 Node 2 请求数据块
         ↓
Node 2 将数据块直接发送给 Node 1
         ↓
Node 1 获得数据块，无需磁盘 I/O
```

### 缓存一致性

```sql
-- 查看全局缓存服务统计
SELECT * FROM v$sysstat WHERE name LIKE '%cache fusion%';

-- 查看数据块传输统计
SELECT * FROM gv$gcscf_master_view;

-- 查看当前持有缓存资源的节点
SELECT * FROM gv$instance_feed;
```

---

## 客户端连接配置

### TNS 连接串配置

```sql
-- RAC 连接配置（负载均衡）
ORCL_RAC =
  (DESCRIPTION =
    (LOAD_BALANCE = yes)         -- 启用负载均衡
    (ADDRESS_LIST =
      (ADDRESS = (PROTOCOL = TCP)(HOST = rac01-vip)(PORT = 1521))
      (ADDRESS = (PROTOCOL = TCP)(HOST = rac02-vip)(PORT = 1521))
    )
    (CONNECT_DATA =
      (SERVER = DEDICATED)
      (SERVICE_NAME = orcl)
      (FAILOVER_MODE = (TYPE = SELECT)(METHOD = BASIC)(RETRIES = 20)(DELAY = 15))  -- TAO 故障切换
    )
  )
```

### SCAN（Single Client Access Name）

Oracle 11gR2+ 提供 SCAN，简化客户端配置：

```sql
-- SCAN 配置（在 DNS 中配置）
-- scan-cluster-scan.us.oracle.com -> 3 个 SCAN VIP

-- 客户端只需配置 SCAN
ORCL_RAC =
  (DESCRIPTION =
    (ADDRESS = (PROTOCOL = TCP)(HOST = scan-cluster-scan)(PORT = 1521))
    (CONNECT_DATA =
      (SERVICE_NAME = orcl)
    )
  )
```

---

## 负载均衡

### 连接级负载均衡

```sql
-- 服务级负载均衡配置
BEGIN
    DBMS_SERVICE.MODIFY_SERVICE(
        service_name => 'orcl',
        goal => DBMS_SERVICE.GOAL_THROUGHPUT,  -- 吞吐量优先
        clb_goal => DBMS_SERVICE.CLB_GOAL_SHORT  -- 连接时间短优先
    );
END;
/

-- 查看服务配置
SELECT service_id, name, clb_goal, goal 
FROM dba_services;
```

### 运行时负载均衡

```sql
-- 查看连接分布
SELECT inst_id, COUNT(*) AS connections
FROM gv$session
WHERE username IS NOT NULL
GROUP BY inst_id;

-- 查看 SQL 执行分布
SELECT inst_id, SUM(executions) AS total_executions
FROM gv$sql
GROUP BY inst_id;
```

---

## RAC 存储

### 共享存储要求

| 存储类型 | 要求 |
|---------|------|
| Data Files | 共享存储，所有节点可访问 |
| Control Files | 共享存储，多路复用 |
| Redo Logs | 共享存储，本地归档 |
| OCR/Voting | OCRFS 或裸设备 |

### ASM（Automatic Storage Management）

```sql
-- 查看 ASM 磁盘组
SELECT group_number, name, type, total_mb, free_mb
FROM v$asm_diskgroup;

-- 查看 ASM 磁盘
SELECT disk_number, name, path, total_mb, free_mb
FROM v$asm_disk;

-- 创建 ASM 磁盘组
CREATE DISKGROUP data EXTERNAL REDUNDANCY
DISK '/dev/oracleasm/disks/DISK1',
     '/dev/oracleasm/disks/DISK2';
```

---

## RAC 高可用机制

### 节点故障检测

```sql
-- 查看集群节点状态
SELECT inst_id, instance_name, host_name, status
FROM gv$instance;

-- 查看 CSS（Cluster Synchronization Services）
SELECT * FROM v$css_stats;
```

### VIP 故障切换

```
VIP 故障切换流程：

Node 1 故障
    ↓
CSS 检测到 Node 1 不可用
    ↓
Node 2 上的 Node 1 VIP 开始提供服务
    ↓
客户端请求自动路由到 Node 2
    ↓
应用无感知，继续服务
```

---

## RAC 监控

### 关键视图

```sql
-- 查看全局缓存统计
SELECT * FROM gv$cache_transfer;

-- 查看全局锁统计
SELECT * FROM gv$locks;

-- 查看实例间通信
SELECT * FROM gv$instance_cache_transfer;

-- 查看全局资源
SELECT * FROM gv$global_lock;
```

### 性能诊断

```sql
-- 查看 Cache Fusion 效率
SELECT name, value
FROM v$sysstat
WHERE name LIKE 'gc%' OR name LIKE 'global cache%';

-- 查看全局_enqueue 统计
SELECT * FROM gv$enqueue_stat;

-- 查看当前活动的全局事务
SELECT * FROM gv$global_transaction;
```

---

## RAC 安装与配置

### 安装前准备

```bash
# 1. 配置共享存储
# 2. 配置互信（SSH）
ssh-keygen -t rsa
ssh-copy-id oracle@node2

# 3. 配置内核参数
# /etc/sysctl.conf

# 4. 配置用户资源限制
# /etc/security/limits.conf

# 5. 安装 Clusterware
./runInstaller

# 6. 安装 RAC 数据库
dbca
```

### 常见问题处理

```sql
-- 节点无法加入集群
crsctl check cluster -all
crsctl start crs

-- OCR 损坏
ocrconfig -showfile
ocrcheck

-- Voting Disk 损坏
crsctl query css votedisk
```

---

## 面试高频问题

### Q1: RAC 和 Data Guard 的区别？

RAC 通过多节点共享存储实现高可用和负载均衡；Data Guard 通过主备库同步实现灾备。两者可以结合使用。

### Q2: 什么是 Cache Fusion？

Cache Fusion 是 RAC 的核心技术，实现节点间缓存数据的直接传输，无需磁盘 I/O，提高集群性能。

### Q3: RAC 对存储的要求是什么？

必须使用共享存储（ASM、OCFS、NFS 等），所有节点必须能访问相同的数据文件、控制文件和日志文件。

---

## 总结

RAC 是 Oracle 的集群解决方案：

| 特性 | 说明 |
|-----|------|
| 多实例 | 多个节点同时访问一个数据库 |
| 共享存储 | 所有节点共享数据文件 |
| Cache Fusion | 节点间缓存直接传输 |
| 负载均衡 | 多节点分担请求 |
| 高可用 | 节点故障自动切换 |

RAC 让数据库具备了横向扩展能力。

---

## 下一步

- [Oracle RAC 高可用](/database/oracle/rac-ha)：VIP、故障切换
- [Oracle ASM](/database/oracle/asm)：自动存储管理
