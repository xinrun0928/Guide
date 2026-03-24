# PostgreSQL 高可用方案：Patroni + etcd、PAF、Corosync

PostgreSQL 主节点挂了怎么办？

如何实现自动故障转移？

今天，我们来聊聊 PostgreSQL 的高可用方案。

## 高可用基础

### 什么是高可用

高可用（High Availability）是指系统在长时间运行中，保持服务的可用性：

```
可用性等级：

99.9% (三个9)：年停机 ~8.7 小时
99.99% (四个9)：年停机 ~52 分钟
99.999% (五个9)：年停机 ~5 分钟
```

### PostgreSQL HA 组件

```
┌─────────────────────────────────────────────────────────┐
│                    高可用架构                             │
│                                                          │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │  连接池      │    │  连接池      │    │  连接池      │ │
│  │ PgBouncer   │    │ PgBouncer   │    │ PgBouncer   │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│         │                 │                 │            │
│         └────────────────┼─────────────────┘            │
│                          │                              │
│  ┌───────────────────────┼───────────────────────┐    │
│  │                   HAProxy                      │    │
│  └───────────────────────┬───────────────────────┘    │
│                        │                              │
│  ┌─────────────────────┼─────────────────────┐      │
│  │              Patroni Cluster                 │      │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐       │      │
│  │  │ Node 1  │ │ Node 2  │ │ Node 3  │       │      │
│  │  │Primary │ │ Standby │ │ Standby │       │      │
│  │  └─────────┘ └─────────┘ └─────────┘       │      │
│  └─────────────────────────────────────────────┘      │
│                          │                              │
│  ┌───────────────────────┴───────────────────────┐      │
│  │                    etcd                       │      │
│  └─────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
```

## Patroni + etcd

### Patroni 简介

Patroni 是 PostgreSQL 高可用解决方案的核心：

```
Patroni 职责：
1. 管理 PostgreSQL 实例
2. 自动故障检测
3. 自动故障转移
4. 分布式锁
5. 配置管理
```

### Patroni 架构

```
┌─────────────────────────────────────────────────────────┐
│                    Patroni Cluster                       │
│                                                          │
│  ┌────────────┐   ┌────────────┐   ┌────────────┐      │
│  │  Patroni   │   │  Patroni   │   │  Patroni   │      │
│  │  Node 1    │   │  Node 2    │   │  Node 3    │      │
│  └────────────┘   └────────────┘   └────────────┘      │
│        │               │               │                 │
│        └───────────────┴───────────────┘                 │
│                          │                               │
│        ┌─────────────────┴─────────────────┐           │
│        │              etcd                   │           │
│        │  - 集群状态                         │           │
│        │  - 分布式锁                        │           │
│        │  - 配置存储                        │           │
│        └───────────────────────────────────┘           │
└──────────────────────────────────────────────────────┘
```

### Patroni 安装

```bash
# Ubuntu/Debian
apt install patroni

# 或者使用 pip
pip install patroni[etcd]
```

### Patroni 配置

```yaml
# /etc/patroni.yml

scope: postgres-cluster
name: node1

namespace: /service/
name: ${scope}/${name}

restapi:
  listen: 0.0.0.0:8008
  connect_address: node1:8008
  authentication:
    username: patroni
    password: patroni_password

etcd:
  hosts: etcd1:2379,etcd2:2379,etcd3:2379
  username: etcd_username
  password: etcd_password
  certfile: /etc/ssl/certs/etcd-cert.pem
  keyfile: /etc/ssl/private/etcd-key.pem
  cacert: /etc/ssl/certs/ca.pem

bootstrap:
  dcs:
    get_last_checkpoint: true
    check_slots: true
  postgresql:
    use_pg_rewind: true
    use_slots: true
    parameters:
      wal_level: replica
      max_wal_senders: 10
      wal_keep_size: 1GB
      max_replication_slots: 10
      hot_standby: on
      synchronous_commit: on
      synchronous_standby_names: '*'

  initdb:
    - encoding: UTF8
    - locale: en_US.UTF-8
    - data-checksums: true

  pg_hba:
    - host replication replicator 0.0.0.0/0 md5
    - host all all 0.0.0.0/0 md5

postgresql:
  listen: 0.0.0.0:5432
  connect_address: node1:5432
  data_dir: /data/postgresql
  bin_dir: /usr/lib/postgresql/15/bin
  
  authentication:
    replication:
      username: replicator
      password: replicator_password
    superuser:
      username: postgres
      password: postgres_password
  
  create_replica_methods:
    - basebackup
  
  basebackup:
    - max-rate: '1000M'
    - checkpoint: fast
  
  parameters:
    unix_socket_directories: '/var/run/postgresql'

watchdog:
  mode: automatic
  device: /dev/watchdog
  safety_margin: 5
```

### Patroni 命令

```bash
# 查看集群状态
patronictl -c /etc/patroni.yml list

# 手动故障转移
patronictl -c /etc/patroni.yml switchover

# 重新加载配置
patronictl -c /etc/patroni.yml reload

# 暂停节点
patronictl -c /etc/patroni.yml pause node1

# 恢复节点
patronictl -c /etc/patroni.yml resume node1

# 成员管理
patronictl -c /etc/patroni.yml remove postgres-cluster

# 启动/停止 Patroni
systemctl start patroni
systemctl stop patroni
```

## PAF（PostgreSQL Automatic Failover）

### PAF 简介

PAF（PostgreSQL Automatic Failover）是 Pacemaker 的 PostgreSQL 资源代理：

```
Pacemaker + PAF 架构：

┌─────────────────────────────────────────────────┐
│                   Pacemaker CRM                   │
│                                                  │
│  ┌─────────────┐  ┌─────────────┐                │
│  │  Resource   │  │  Resource   │                │
│  │  Agent 1    │  │  Agent 2    │                │
│  └──────┬──────┘  └──────┬──────┘                │
│         │                │                        │
│  ┌──────┴────────────────┴──────┐               │
│  │         PAF Resource Agent     │               │
│  └──────┬────────────────┬───────┘               │
│         │                │                       │
│  ┌──────┴────┐    ┌──────┴────┐               │
│  │ PostgreSQL │    │ PostgreSQL │               │
│  │   Node 1   │    │   Node 2   │               │
│  └───────────┘    └───────────┘               │
└─────────────────────────────────────────────────┘
```

### PAF 安装配置

```bash
# 安装 PAF
apt install pacemaker resource-agents-postgresql

# 创建 PCS 集群
pcs cluster setup --name pg_cluster node1 node2 node3

# 启用集群
pcs cluster start --all
pcs cluster enable --all

# 创建 PAF 资源
pcs resource create pg-primary \
    ocf:heartbeat:pgsqlms \
    pgdata="/var/lib/postgresql/15/main" \
    datadir="/var/lib/postgresql/15/main" \
    superuser="postgres" \
    replicationuser="replicator" \
   Replication slot name=pgslot \
    op method=reload \
    op monitor interval=30s timeout=10s \
    meta migration-threshold=3 failure-timeout=30s

# 创建克隆资源（多个副本）
pcs resource clone pg-primary meta globally-unique="true" clone-max=3 clone-node-max=1

# 配置约束
pcs constraint colocation add pg-primary-clone with master pg-primary

# 查看资源状态
pcs resource show
pcs resource status
```

## Corosync + Pacemaker

### Corosync 配置

```ini
# /etc/corosync/corosync.conf

totem {
    version: 2
    cluster_name: postgres_cluster
    transport: udpu
    interface {
        ringnumber: 0
        bindnetaddr: 192.168.1.0
        broadcast: yes
        mcastport: 5405
    }
}

nodelist {
    node {
        ring0_addr: node1
        nodeid: 1
    }
    node {
        ring0_addr: node2
        nodeid: 2
    }
    node {
        ring0_addr: node3
        nodeid: 3
    }
}

quorum {
    provider: corosync_votequorum
    two_node: 0
}
```

### 集群资源管理

```bash
# 查看集群状态
crm_mon -1

# 创建资源
crm configure primitive pg_primary ocf:heartbeat:pgsqlms \
    params pgdata="/var/lib/postgresql/15/main" \
    op monitor interval=30s

# 创建 VIP 资源
crm configure primitive pg_vip ocf:heartbeat:IPaddr2 \
    params ip="192.168.1.100" \
    op monitor interval=30s

# 配置约束
crm configure colocation pg_vip_with_primary inf: pg_vip pg_primary
crm configure order pg_start_after_vip mandatory: pg_vip pg_primary

# 迁移资源
crm resource migrate pg_primary node2
```

## HAProxy 配置

### HAProxy 配置

```ini
# /etc/haproxy/haproxy.cfg

global
    log /dev/log local0
    log /dev/log local1 notice
    maxconn 4096
    user haproxy
    group haproxy

defaults
    log global
    retries 2
    timeout connect 5000ms
    timeout client  50000ms
    timeout server  50000ms

listen postgres
    bind *:5432
    mode tcp
    balance roundrobin
    
    option tcp-check
    tcp-check connect
    tcp-check send pg_is_in_recovery
    tcp-check expect string recovery
    tcp-check send Quit\r\n
    tcp-check expect string 7
    
    server node1 node1:5432 check port 8008 inter 2000 rise 2 fall 3
    server node2 node2:5432 check port 8008 inter 2000 rise 2 fall 3 backup
    server node3 node3:5432 check port 8008 inter 2000 rise 2 fall 3 backup

listen stats
    bind *:8400
    mode http
    stats enable
    stats uri /stats
    stats refresh 30s
```

## 故障转移流程

### Patroni 故障转移

```
1. Patroni 检测到主节点不可达
         ↓
2. 获取 etcd 分布式锁
         ↓
3. 验证其他节点健康状态
         ↓
4. 选择最佳从节点
         ↓
5. 执行故障转移（promote）
         ↓
6. 更新 etcd 集群状态
         ↓
7. 通知其他节点新主节点
         ↓
8. 应用层重连到新主节点
```

### VIP 漂移

```bash
# Patroni 自动处理 VIP 漂移
# 使用 AWS Route53、DNS、或者系统自带 VIP

# 或者使用 conntrackd 实现 VIP 漂移
apt install conntrackd
```

## 监控告警

### Prometheus 监控

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'patroni'
    static_configs:
      - targets: ['node1:8008', 'node2:8008', 'node3:8008']
```

### AlertManager 告警

```yaml
# alertmanager.yml
route:
  group_by: ['cluster']
  receiver: 'email'

receivers:
  - name: 'email'
    email_configs:
      - to: 'dba@example.com'
        from: 'alert@example.com'
        smarthost: 'smtp.example.com:587'
```

### 健康检查

```bash
# Patroni API 健康检查
curl http://node1:8008/health

# Patroni 集群状态
curl http://node1:8008/cluster

# 模拟故障
patronictl -c /etc/patroni.yml pause node1
```

## 常见问题

### 问题一：脑裂（Split Brain）

```sql
-- Patroni 使用 etcd 分布式锁防止脑裂
-- 只有一个节点能获取锁成为主节点

-- 如果 etcd 不可用：
-- Patroni 会保持当前状态，等待 etcd 恢复
-- 不会产生多个主节点
```

### 问题二：故障转移后复制未恢复

```bash
# Patroni 自动处理
# 如果使用复制槽，自动同步

# 手动检查
patronictl -c /etc/patroni.yml list
```

### 问题三：VIP 漂移失败

```bash
# 检查 VIP 脚本权限
ls -la /usr/local/bin/kemove_ip
ls -la /usr/local/bin/manage_ip

# 检查 conntrack 服务
systemctl status conntrackd
```

## 面试高频问题

### Q1: PostgreSQL 高可用方案有哪些？

**考察点**：HA 方案

**参考答案**：
- Patroni + etcd：最流行的开源方案
- PAF + Pacemaker + Corosync：企业级方案
- Pgpool-II：集成 HA 的连接池
- 云数据库托管：Aurora、RDS

### Q2: Patroni 的工作原理？

**考察点**：Patroni 原理

**参考答案**：
1. 每个节点运行 Patroni 进程
2. Patroni 通过 etcd 协调状态
3. 主节点故障时，获取锁的节点成为新主
4. 使用 watchdog 防止脑裂

### Q3: 如何实现零停机故障转移？

**考察点**：零停机

**参考答案**：
1. 使用 Patroni 自动故障转移
2. 使用复制槽确保不丢 WAL
3. 配置 HAProxy 或类似负载均衡
4. 应用层使用连接池和重连机制
5. 使用同步复制提高数据安全性

### Q4: 如何监控 HA 集群？

**考察点**：监控能力

**参考答案**：
1. Patroni API 监控
2. etcd 健康检查
3. 复制延迟监控
4. VIP 漂移监控
5. Prometheus + AlertManager

## 总结

PostgreSQL 高可用方案对比：

| 方案 | 复杂度 | 成熟度 | 社区 | 推荐场景 |
|------|--------|--------|------|---------|
| Patroni + etcd | 中 | 高 | 活跃 | 生产推荐 |
| PAF + Pacemaker | 高 | 高 | 稳定 | 企业级 |
| Pgpool-II | 低 | 高 | 一般 | 简单场景 |
| 云托管 | 低 | 高 | - | 云环境 |

HA 关键指标：
- RTO（Recovery Time Objective）：恢复时间目标
- RPO（Recovery Point Objective）：恢复点目标
- 可用性：99.9% ~ 99.999%

选择建议：
- 小团队：Patroni + etcd
- 大企业：PAF + Pacemaker
- 云环境：使用云托管服务
