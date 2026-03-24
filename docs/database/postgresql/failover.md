# PostgreSQL 主从切换与故障转移

主节点挂了怎么办？

如何平滑切换到从节点？

今天，我们来聊聊 PostgreSQL 的主从切换与故障转移。

## 故障转移基础

### 什么是故障转移

故障转移（Failover）是指当主节点不可用时，自动或手动将服务切换到从节点的过程：

```
正常状态：
┌─────────────────┐         ┌─────────────────┐
│     Primary     │ ←─────── │     Standby      │
│   (处理写入)     │ 复制     │   (只读副本)     │
└─────────────────┘         └─────────────────┘

故障转移后：
┌─────────────────┐         ┌─────────────────┐
│   (已故障)       │         │     Standby      │
│                  │         │  (提升为主)       │
│                  │         │   (处理写入)     │
└─────────────────┘         └─────────────────┘
```

### 故障类型

| 类型 | 说明 | 处理方式 |
|------|------|---------|
| 主机故障 | 硬件、网络问题 | 自动/手动故障转移 |
| PostgreSQL 崩溃 | 进程崩溃 | 自动重启或故障转移 |
| 只读故障 | 从节点不可用 | 自动移除或重建 |
| 网络分区 | 节点间通信中断 | 多数派选举 |

## 手动故障转移

### 1. 检查主节点状态

```sql
-- 在主节点检查
SELECT pg_is_in_recovery();

-- 如果返回 false，表示是主节点
-- 如果返回 true，表示是从节点
```

### 2. 检查从节点状态

```sql
-- 在从节点检查复制状态
SELECT 
    pid,
    state,
    sent_lsn,
    replay_lsn,
    (sent_lsn - replay_lsn) AS lag_bytes
FROM pg_stat_replication;

-- 查看是否在接收 WAL
SELECT * FROM pg_stat_wal_receiver;
```

### 3. 确认故障

```bash
# 尝试连接主节点
psql -h primary_host -c "SELECT 1"

# 检查主节点进程
ps aux | grep postgres
```

### 4. 执行故障转移

```bash
# 在从节点执行提升

# 方式一：使用 pg_ctl
pg_ctl promote -D /var/lib/postgresql/15/main

# 方式二：创建 promote 文件
touch /var/lib/postgresql/15/main/promote

# 方式三：使用 pgcontroldata
pg_controldata /var/lib/postgresql/15/main | grep "Database cluster state"
```

### 5. 验证新主节点

```sql
-- 确认已提升为主节点
SELECT pg_is_in_recovery();
-- 应返回 false

-- 检查是否可以写入
CREATE TABLE test (id INT);
```

### 6. 重新配置其他从节点

```bash
# 在其他从节点上，更新连接信息指向新主节点

# 编辑 postgresql.conf
primary_conninfo = 'host=new_primary_host port=5432 user=replicator'

# 创建 standby.signal
touch /var/lib/postgresql/15/main/standby.signal

# 重启从节点
pg_ctl restart -D /var/lib/postgresql/15/main
```

## Patroni 自动故障转移

### Patroni 简介

Patroni 是一个成熟的 PostgreSQL 高可用解决方案，使用 etcd、Consul 或 ZooKeeper 进行分布式协调。

### Patroni 架构

```
┌─────────────────────────────────────────────────────────┐
│                    Patroni (协调层)                      │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐             │
│  │Node 1  │    │Node 2  │    │Node 3  │             │
│  │Patroni │    │Patroni │    │Patroni │             │
│  └────┬───┘    └────┬───┘    └────┬───┘             │
│       │             │             │                    │
└───────┼─────────────┼─────────────┼────────────────────┘
        │             │             │
        ▼             ▼             ▼
    ┌─────────────────────────────────────────────────┐
    │                   etcd / Consul                   │
    └─────────────────────────────────────────────────┘
```

### Patroni 配置

```yaml
# patroni.yml
scope: postgres-cluster
name: node1

namespace: /service/
name: ${scope}/${name}

restapi:
  listen: 0.0.0.0:8008
  connect_address: node1:8008
  certfile: /cert/cert.pem
  keyfile: /cert/key.pem
  authentication:
    username: patroni
    password: patroni_password

etcd:
  hosts: etcd1:2379,etcd2:2379,etcd3:2379
  username: etcd_username
  password: etcd_password
  certfile: /cert/etcd-cert.pem
  keyfile: /cert/etcd-key.pem
  cacert: /cert/ca.pem

postgresql:
  listen: 0.0.0.0:5432
  connect_address: node1:5432
  data_dir: /data/postgresql
  config_dir: /etc/postgresql/15/main
  bin_dir: /usr/lib/postgresql/15/bin
  
  authentication:
    superuser:
      username: postgres
      password: postgres_password
    replication:
      username: replicator
      password: replicator_password
  
  parameters:
    wal_level: replica
    max_wal_senders: 10
    wal_keep_size: 1GB
    max_replication_slots: 10
    hot_standby: on
  
  replication:
    username: replicator
    password: replicator_password
    sslmode: require
    sslcert: /cert/postgresql.crt
    sslkey: /cert/postgresql.key
    sslrootcert: /cert/ca.crt
    slots:
      physical_slots:
        - name: patroni_slot
          type: physical
  
  tags:
    nofailover: false
    noloadbalance: false
    clonefrom: false
    nosync: false

watchdog:
  mode: automatic
  device: /dev/watchdog
  safety_margin: 5

consul:
  register_service: true
  service_port: 5432
  service_name: postgresql
  service_tags:
    - primary
    - postgres
```

### Patroni 命令

```bash
# 查看集群状态
patronictl -c /etc/patroni.yml list

# 手动故障转移
patronictl -c /etc/patroni.yml failover

# 重新加载配置
patronictl -c /etc/patroni.yml reload

# 暂停节点
patronictl -c /etc/patroni.yml pause node2

# 恢复节点
patronictl -c /etc/patroni.yml resume node2
```

## Pgpool-II 故障转移

### Pgpool-II 配置

```ini
# pgpool.conf

# 后端节点配置
backend_hostname0 = 'node1'
backend_port0 = 5432
backend_weight0 = 1
backend_data_directory0 = '/data/postgresql'
backend_flag0 = 'ALLOW_TO_FAILOVER'

backend_hostname1 = 'node2'
backend_port1 = 5432
backend_weight1 = 1
backend_data_directory1 = '/data/postgresql'
backend_flag1 = 'ALLOW_TO_FAILOVER'

backend_hostname2 = 'node3'
backend_port2 = 5432
backend_weight2 = 1
backend_data_directory2 = '/data/postgresql'
backend_flag2 = 'ALLOW_TO_FAILOVER'

# 自动故障转移
failover_mode = automatic

# 健康检查
health_check_period = 10
health_check_timeout = 20
health_check_user = 'pgpool'
health_check_password = 'pgpool_password'
health_check_max_retries = 3

# 故障转移命令
failover_command = '/etc/pgpool/failover.sh %d %h %p %D %m %M %H %P %r %R'

# 恢复命令
recovery_2nd_stage_command = '/etc/pgpool/recovery_2nd_stage.sh %d %p %D %m %M %H %P %r %R'
```

### 故障转移脚本

```bash
#!/bin/bash
# /etc/pgpool/failover.sh

failed_host=$1
failed_port=$2
failed_db=$3
failed_node_id=$4

new_primary_host=$6
new_primary_port=$7

echo "Failover triggered! Failed node: $failed_host:$failed_port"

# 在从节点执行提升
if [ $failed_node_id -eq 0 ]; then
    ssh -T $new_primary_host "pg_ctl promote -D /data/postgresql"
fi
```

## 故障恢复

### 恢复旧主节点

```bash
# 1. 从新主节点获取备份
ssh new_primary "pg_basebackup -h new_primary -U replicator -D /data/postgresql -P -Xs -R"

# 2. 配置为从节点
# 编辑 postgresql.conf
primary_conninfo = 'host=new_primary port=5432 user=replicator'
recovery_target_timeline = 'latest'

# 3. 创建 standby.signal
touch /var/lib/postgresql/15/main/standby.signal

# 4. 启动节点
pg_ctl start -D /var/lib/postgresql/15/main
```

### Patroni 自动恢复

```bash
# Patroni 会自动检测并恢复旧主节点

# 查看恢复过程
patronictl -c /etc/patroni.yml list

# 手动同步
patronictl -c /etc/patroni.yml restart node1
```

## 监控告警

### 监控指标

```sql
-- 复制状态
SELECT 
    application_name,
    state,
    sent_lsn,
    replay_lsn,
    (sent_lsn - replay_lsn) AS lag_bytes,
    sync_state
FROM pg_stat_replication;

-- 故障转移历史
SELECT 
    event_time,
    database,
    pg_xlogfile_name定向(xid) AS xid,
    event_type,
    event_code,
    event_message
FROM pg_event_log
WHERE event_type IN ('failover', 'switchover');

-- 从节点状态
SELECT * FROM pg_stat_wal_receiver;
```

### 告警配置

```yaml
# Prometheus 告警规则
groups:
  - name: postgresql
    rules:
      - alert: PostgreSQLReplicationLag
        expr: pg_replication_lag_seconds > 30
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "PostgreSQL replication lag is high"
          
      - alert: PostgreSQLReplicationDown
        expr: pg_replication_is_active == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "PostgreSQL replication is down"
```

## 常见问题

### 问题一：故障转移后复制未恢复

```bash
# 检查复制槽
SELECT * FROM pg_replication_slots;

# 如果复制槽在新主节点不存在，需要重建
SELECT pg_create_physical_replication_slot('standby_slot');

# 重启从节点
pg_ctl restart -D /data/postgresql
```

### 问题二：数据不一致

```sql
-- 检查数据一致性
SELECT 
    COUNT(*) AS table_count,
    SUM(pg_column_size(*)) AS total_size
FROM my_table;

-- 在主从节点分别执行对比
```

### 问题三：VIP 漂移失败

```bash
# 检查 VIP 脚本日志
cat /var/log/vip-movement.log

# 手动执行 VIP 漂移
ip addr add 192.168.1.100/24 dev eth0 label eth0:vip
```

## 面试高频问题

### Q1: 如何进行 PostgreSQL 的故障转移？

**考察点**：故障转移操作

**参考答案**：
1. 确认主节点故障
2. 在从节点执行 `pg_ctl promote`
3. 更新应用连接
4. 重新配置其他从节点
5. 恢复旧主节点

### Q2: Patroni 是如何实现自动故障转移的？

**考察点**：HA 原理

**参考答案**：
1. Patroni 使用 etcd/Consul 存储集群状态
2. 每个节点运行 Patroni 进程监控健康状态
3. 主节点故障时，Patroni 自动提升一个从节点
4. 使用分布式锁确保只有一个节点被提升

### Q3: 故障转移后如何恢复旧主节点？

**考察点**：运维能力

**参考答案**：
1. 从新主节点创建基础备份
2. 配置为从节点
3. 指向新主节点
4. 创建 standby.signal
5. 启动并验证复制

### Q4: 如何监控 PostgreSQL 复制状态？

**考察点**：监控能力

**参考答案**：
1. `pg_stat_replication` 查看复制状态
2. `pg_stat_wal_receiver` 查看 WAL 接收
3. 监控 `sent_lsn - replay_lsn` 延迟
4. Prometheus + pg_exporter 采集指标

## 总结

故障转移方式：

| 方式 | 特点 |
|------|------|
| 手动 | 灵活但需要人工干预 |
| Patroni | 自动、成熟、生产可用 |
| Pgpool-II | 集成负载均衡和故障转移 |

故障转移流程：
```
检测故障 → 确认故障 → 提升从节点 → 更新连接 → 恢复旧节点
```

高可用关键：
1. 监控复制延迟
2. 定期演练故障转移
3. 验证数据一致性
4. 自动化恢复流程
