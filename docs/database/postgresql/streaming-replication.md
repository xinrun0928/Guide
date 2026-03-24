# PostgreSQL 流复制（Streaming Replication）原理

想给 PostgreSQL 做主从复制？

想实现读写分离？

今天，我们来聊聊 PostgreSQL 的流复制。

## 复制基础

### 什么是流复制

流复制是 PostgreSQL 的异步主从复制机制：

```
┌─────────────────┐         ┌─────────────────┐
│    Primary      │ ────────→ │     Standby      │
│   (主节点)       │   WAL 流  │   (从节点)       │
│                  │         │                  │
│  接收写入         │ ────────→ │  只读副本        │
│  生成 WAL         │         │  应用 WAL        │
└─────────────────┘         └─────────────────┘
```

### 复制的优势

1. **读写分离**：从节点处理只读请求
2. **高可用**：主节点故障时从节点接管
3. **备份**：从节点可作为实时备份
4. **地理分布**：多地部署减少延迟

## 配置流复制

### 1. 主节点配置

```ini
# postgresql.conf

# 启用 WAL 归档
wal_level = replica  # 或 logical

# 允许复制的连接数
max_wal_senders = 10

# 保留的 WAL 文件数
wal_keep_size = 1GB

# 启用复制槽（推荐）
max_replication_slots = 10

# 归档配置
archive_mode = on
archive_command = 'test ! -f /wal_archive/%f && cp %p /wal_archive/%f'
```

### 2. 创建复制用户

```sql
-- 创建复制用户
CREATE USER replicator WITH REPLICATION ENCRYPTED PASSWORD 'your_password';

-- 在 pg_hba.conf 中添加权限
# 允许复制连接
host  replication  replicator  192.168.1.0/24  md5
```

### 3. pg_hba.conf 配置

```ini
# /etc/postgresql/15/main/pg_hba.conf

# 允许从节点复制
host  replication  replicator  192.168.1.0/24  md5

# 允许应用连接
host  all  all  192.168.1.0/24  md5
```

### 4. 从节点配置

```bash
# 从主节点拉取基础备份
pg_basebackup -h primary_host -U replicator -D /var/lib/postgresql/15/main -P -Xs -R

# 选项说明：
# -h: 主节点地址
# -U: 复制用户
# -D: 数据目录
# -P: 显示进度
# -Xs: 包含 WAL 文件
# -R: 创建 standby.signal 文件
```

### 5. 从节点 postgresql.conf

```ini
# postgresql.conf

# 连接主节点
primary_conninfo = 'host=primary_host port=5432 user=replicator password=your_password application_name=standby1'

# 复制槽（如果使用）
primary_slot_name = 'standby1_slot'

# 只读模式
hot_standby = on

# 最大复制延迟
max_standby_streaming_delay = 30s
```

### 6. 创建 standby.signal

```bash
# 在数据目录创建 standby.signal
touch /var/lib/postgresql/15/main/standby.signal
```

## 复制原理

### WAL 传输流程

```
主节点                           从节点
  │                               │
  │  ←─── 复制连接 ─────────────── │
  │                               │
  │  发送 WAL 位置请求              │
  │ ────────────────────────────────→ │
  │                               │
  │  ←─── WAL 数据流 ────────────── │
  │ ────────────────────────────────→ │
  │                               │
  │       应用 WAL                  │
  │                               │
  │       发送反馈                  │
  │ ←────────────────────────────── │
```

### 复制槽（Replication Slot）

复制槽确保主节点保留从节点尚未接收的 WAL：

```sql
-- 在主节点创建复制槽
SELECT * FROM pg_create_physical_replication_slot('standby1_slot');

-- 查看复制槽
SELECT * FROM pg_replication_slots;

-- 查看从节点状态
SELECT * FROM pg_stat_replication;
```

### 复制延迟

```sql
-- 查看复制延迟
SELECT 
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    (sent_lsn - replay_lsn) AS replication_delay
FROM pg_stat_replication;

-- sent_lsn: 已发送
-- write_lsn: 已写入
-- flush_lsn: 已刷新
-- replay_lsn: 已重放
```

## 监控复制

### 常用监控查询

```sql
-- 查看复制状态
SELECT 
    pid,
    usesysid,
    usename,
    application_name,
    client_addr,
    state,
    sent_lsn,
    write_lsn,
    flush_lsn,
    replay_lsn,
    sync_state
FROM pg_stat_replication;

-- sync_state: 同步状态
-- async: 异步复制
-- sync: 同步复制
-- potential: 潜在同步（当前异步，可以升级）

-- 查看复制槽
SELECT 
    slot_name,
    plugin,
    slot_type,
    datoid,
    database,
    active,
    restart_lsn,
    confirmed_flush_lsn
FROM pg_replication_slots;

-- 查看 WAL 发送进程
SELECT * FROM pg_stat_wal_sender;

-- 查看 WAL 接收进程
SELECT * FROM pg_stat_wal_receiver;
```

### 复制延迟监控

```sql
-- 创建延迟监控视图
CREATE VIEW replication_lag AS
SELECT 
    client_hostname,
    application_name,
    state,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) / 1024 / 1024 AS lag_mb,
    pg_wal_lsn_diff(sent_lsn, write_lsn) / 1024 / 1024 AS write_lag_mb,
    pg_wal_lsn_diff(write_lsn, flush_lsn) / 1024 / 1024 AS flush_lag_mb,
    pg_wal_lsn_diff(flush_lsn, replay_lsn) / 1024 / 1024 AS replay_lag_mb
FROM pg_stat_replication;

SELECT * FROM replication_lag ORDER BY lag_mb DESC;
```

## 同步复制

### 配置同步复制

```ini
# 主节点 postgresql.conf

# 同步复制级别
synchronous_commit = on  # 或 remote_apply

# 同步备用节点列表
synchronous_standby_names = 'standby1,standby2'
```

### 同步 vs 异步

| 模式 | 同步 | 异步 |
|------|------|------|
| 数据安全性 | 高（确认后才提交） | 低（可能丢失数据） |
| 性能 | 低（等待从节点） | 高 |
| 距离限制 | 近（网络延迟影响大） | 远 |

### 同步级别

```ini
# synchronous_commit 参数

# on: 等待 WAL 写入本地磁盘
# remote_apply: 等待从节点应用 WAL 并提交
# remote_write: 等待从节点写入磁盘
# local: 只等待本地写入
# off: 不等待
```

## 故障转移

### 主节点故障

```
故障前：
┌─────────────────┐         ┌─────────────────┐
│    Primary     │ ────────→ │     Standby      │
│  (主节点)       │         │   (从节点)       │
└─────────────────┘         └─────────────────┘

故障后（提升从节点）：
┌─────────────────┐         ┌─────────────────┐
│   (已故障)       │         │  ┌───────────┐ │
│                  │         │  │Promote!   │ │
└─────────────────┘         └────│  Standby   │ │
                                 └───────────┘ │
                                            │
                                 ┌───────────┴┐
                                 │ 新主节点    │
                                 └─────────────┘
```

### 手动故障转移

```bash
# 在从节点执行
pg_ctl promote -D /var/lib/postgresql/15/main

# 或使用触发文件
touch /var/lib/postgresql/15/main/promote
```

### 自动故障转移（Patroni）

```yaml
# patroni.yml
scope: postgres-cluster
name: standby1
restapi:
  listen: 0.0.0.0:8008
  connect_address: standby1:8008
etcd:
  hosts: etcd:2379
postgresql:
  listen: 0.0.0.0:5432
  data_dir: /data/postgresql
  parameters:
    wal_level: replica
    max_wal_senders: 10
    wal_keep_size: 1GB
  replication:
    username: replicator
    password: your_password
    slots:
      standby1:
        type: physical
  tags:
    nofailover: false
    noloadbalance: false
    clonefrom: false
```

## 级联复制

### 配置级联复制

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│    Primary      │ ────────→ │   Standby 1      │ ────────→ │   Standby 2      │
│  (主节点)       │         │   (同步从节点)     │         │   (异步从节点)     │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

```ini
# Standby 1 配置
primary_conninfo = 'host=primary_host port=5432 user=replicator'
recovery_target_timeline = 'latest'

# Standby 2 配置
primary_conninfo = 'host=standby1_host port=5432 user=replicator'
```

## 常见问题

### 问题一：复制延迟过大

```sql
-- 查看延迟原因
SELECT 
    application_name,
    state,
    pg_wal_lsn_diff(sent_lsn, replay_lsn) AS pending_bytes,
    (SELECT COUNT(*) FROM pg_locks WHERE granted = false) AS waiting_locks
FROM pg_stat_replication;

-- 可能原因：
-- 1. 网络带宽不足
-- 2. 从节点负载过高
-- 3. 大事务导致
-- 4. 磁盘 I/O 瓶颈
```

### 问题二：复制中断

```sql
-- 检查 WAL 是否连续
SELECT 
    slot_name,
    restart_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) / 1024 / 1024 AS lag_mb
FROM pg_replication_slots;

-- 检查从节点状态
SELECT 
    state,
    last_msg_send_time,
    last_msg_receipt_time,
    latest_end_lsn,
    latest_end_time
FROM pg_stat_replication;
```

### 问题三：复制槽未清理

```sql
-- 查看复制槽保留的 WAL
SELECT 
    slot_name,
    restart_lsn,
    pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) / 1024 / 1024 AS wal_to_keep_mb
FROM pg_replication_slots;

-- 删除不活跃的复制槽
SELECT pg_drop_replication_slot('inactive_slot');
```

## 面试高频问题

### Q1: PostgreSQL 流复制是什么原理？

**考察点**：复制原理

**参考答案**：
- 主节点发送 WAL（预写日志）到从节点
- 从节点接收并应用 WAL
- 支持异步和同步两种模式
- 使用复制槽确保不丢失 WAL

### Q2: 同步复制和异步复制的区别？

**考察点**：复制模式

**参考答案**：
- 异步：主节点提交后立即返回，不等待从节点
- 同步：主节点等待从节点确认后才提交
- 同步更安全但性能更低
- 异步可能丢失数据

### Q3: 复制延迟怎么监控？

**考察点**：运维能力

**参考答案**：
- `pg_stat_replication` 查看各阶段 LSN
- sent_lsn、write_lsn、flush_lsn、replay_lsn
- 延迟 = sent_lsn - replay_lsn

### Q4: 复制槽的作用是什么？

**考察点**：复制机制

**参考答案**：
- 确保主节点保留从节点尚未接收的 WAL
- 防止 WAL 被删除导致复制中断
- 需要手动清理不活跃的槽

## 总结

PostgreSQL 流复制配置：

| 组件 | 说明 |
|------|------|
| 主节点 | 启用 wal_level=replica |
| 从节点 | 使用 pg_basebackup 创建 |
| 复制槽 | 确保 WAL 不丢失 |
| 监控 | pg_stat_replication |

复制模式：
| 模式 | 特点 |
|------|------|
| 异步 | 性能高，可能丢数据 |
| 同步 | 数据安全，性能较低 |
| 级联 | 减轻主节点压力 |
