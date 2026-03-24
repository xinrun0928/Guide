# MariaDB Galera Cluster 节点加入与故障恢复

集群运行中，Node 3 突然挂了。

你正要去机房重启，同事说：「不用，它自己恢复了。」

你将信将疑地看着监控，果然，15 分钟后 Node 3 重新加入了集群。

**Galera Cluster 的节点管理是全自动的——新节点自动加入，故障节点自动剔除，网络恢复后自动同步。**

---

## 节点加入流程

### 新节点加入的三个阶段

```
┌─────────────────────────────────────────────────────────────┐
│                  新节点加入流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 节点发现 (Discovery)                                    │
│            │                                                │
│            ▼                                                │
│  ┌──────────────────┐                                      │
│  │ 节点启动，读取    │                                      │
│  │ gcomm:// 地址     │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│           ▼                                                 │
│  2. SST 全量同步 (State Snapshot Transfer)                   │
│            │                                                │
│  ┌─────────┴─────────┐                                      │
│  │                 │                                        │
│  ▼                 ▼                                       │
│ Donor Node    Joining Node                                  │
│  (供体)        (加入者)                                      │
│     │              │                                        │
│     │─── SST ──────►│  ← 全量数据同步                       │
│     │              │                                        │
│     │─── binlog ──►│  ← 复制期间的新事务                    │
│     │              │                                        │
│     └───────────────┘                                       │
│                                                             │
│  3. IST 增量同步 (Incremental State Transfer)                │
│            │                                                │
│            ▼                                                │
│  ┌──────────────────┐                                      │
│  │ 节点追上集群状态  │                                      │
│  │ 变为 Synced 状态 │                                      │
│  └──────────────────┘                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### SST 方法对比

| 方法 | 速度 | 锁 | 适用场景 |
|------|------|-----|----------|
| rsync | 较快 | 全局读锁 | 小数据量 |
| xtrabackup | 快 | 无锁 | 生产环境推荐 |
| mysqldump | 慢 | 无锁 | 仅小表 |

```ini
# 配置 SST 方法
# /etc/mysql/mariadb.conf.d/galera.cnf

[mysqld]
# rsync（默认，快速但需要锁）
wsrep_sst_method=rsync

# xtrabackup（推荐，无锁）
wsrep_sst_method=xtrabackup-v2

# mysqldump（最慢，但兼容性最好）
wsrep_sst_method=mysqldump

# SST 认证
wsrep_sst_auth=sstuser:sst_password
```

### 创建 SST 用户

```sql
-- 在 Donor 节点创建 SST 用户
CREATE USER 'sstuser'@'%' IDENTIFIED BY 'sst_password';
GRANT SELECT, RELOAD, PROCESS, LOCK TABLES, REPLICATION CLIENT, REPLICATION SLAVE ON *.* TO 'sstuser'@'%';
GRANT LOCK TABLES, SELECT ON *.* TO 'sstuser'@'%';

-- 如果使用 xtrabackup，还需要额外权限
GRANT BACKUP_ADMIN ON *.* TO 'sstuser'@'%';
```

### 查看加入状态

```sql
-- 在 Joining 节点查看
SHOW STATUS LIKE 'wsrep%';

-- 关键状态：
-- wsrep_local_state: 1-6 的状态值
-- wsrep_local_state_comment: 状态说明
-- wsrep_cluster_status: 应该是 Primary

-- wsrep_local_state 值：
-- 1: Joining (正在加入)
-- 2: Donor (同步中)
-- 3: Joined (已加入)
-- 4: Synced (已同步)

SHOW STATUS LIKE 'wsrep_local_state_comment';
-- 结果可能是：
-- Joining (need state transfer)
-- Donor/Desynced
-- Synced
```

---

## 节点状态管理

### 节点状态值

| State | 值 | 说明 |
|-------|---|------|
| Unknown | 0 | 节点刚启动 |
| Pre-Joining | 1 | 准备加入 |
| Joining | 2 | 正在加入 |
| Joined | 3 | 已加入集群 |
| Synced | 4 | 已同步 |
| Donor | 5 | 作为供体同步数据 |

### 查看集群状态

```sql
-- 查看集群成员
SHOW STATUS LIKE 'wsrep_cluster_size';

-- 查看每个节点状态
SHOW STATUS LIKE 'wsrep_incoming_addresses';

-- 查看节点角色
SHOW VARIABLES LIKE 'wsrep_node_name';

-- 查看详细状态
SHOW STATUS LIKE 'wsrep%';
```

### 节点状态监控

```java
public class GaleraMonitor {
    
    public void monitorCluster(Connection conn) throws SQLException {
        Map&lt;String, String&gt; status = new HashMap&lt;&gt;();
        
        // 获取集群大小
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SHOW STATUS LIKE 'wsrep_cluster_size'")) {
            if (rs.next()) {
                status.put("clusterSize", rs.getString(2));
            }
        }
        
        // 获取节点状态
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SHOW STATUS LIKE 'wsrep_local_state_comment'")) {
            if (rs.next()) {
                status.put("nodeState", rs.getString(2));
            }
        }
        
        // 获取 Flow Control 状态
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery("SHOW STATUS LIKE 'wsrep_flow_control_paused'")) {
            if (rs.next()) {
                double paused = Double.parseDouble(rs.getString(2));
                status.put("flowControlPaused", String.format("%.4f", paused));
                if (paused > 0.1) {
                    System.out.println("警告：Flow Control 暂停超过 10%");
                }
            }
        }
        
        System.out.println("集群状态：" + status);
    }
    
    // 异常告警
    public void checkClusterHealth() {
        // 如果节点状态不是 Synced，说明有问题
        // 如果 Flow Control 暂停率高，说明负载不均衡
        // 如果 wsrep_cluster_status 不是 Primary，说明发生了脑裂
    }
}
```

---

## 故障检测与恢复

### 故障检测机制

```
┌─────────────────────────────────────────────────────────────┐
│                   故障检测流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  节点 N3 故障                                              │
│            │                                                │
│            ▼                                                │
│  ┌──────────────────┐                                      │
│  │  存活节点检测    │                                      │
│  │  (evs_proto)    │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────┐                                      │
│  │  Quorum 计算     │                                      │
│  │  (多数节点投票) │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│     ┌─────┴─────┐                                          │
│     ▼           ▼                                           │
│  多数节点     少数节点                                       │
│     │           │                                           │
│     ▼           ▼                                           │
│  Primary      Non-Primary                                   │
│  继续服务      禁止写入                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Quorum 计算

```sql
-- Quorum = 多数节点 = floor(节点总数 / 2) + 1
-- 3 节点集群：Quorum = 2
-- 5 节点集群：Quorum = 3

-- 节点权重配置
-- 如果某节点是核心节点，可以增加权重
-- /etc/mysql/mariadb.conf.d/galera.cnf
pc.weight = 2  # 默认 1
```

### 网络分区处理

```sql
-- 查看集群状态
SHOW STATUS LIKE 'wsrep_cluster_status';

-- 结果：
-- Primary = 正常（多数节点）
-- Non-Primary = 异常（少数节点，被隔离）
-- Disconnected = 断开连接

-- Non-Primary 节点的处理
-- 1. 自动禁止写入
-- 2. 等待网络恢复
-- 3. 恢复后自动重新加入
```

### 手动故障恢复

```bash
# 如果节点长时间离线，需要手动处理

# 1. 检查节点状态
mysql -e "SHOW STATUS LIKE 'wsrep%';"

# 2. 如果是 Non-Primary 状态，可以尝试重启
systemctl restart mariadb

# 3. 如果数据差异太大，可能需要重建
# 删除数据目录，重新 SST
rm -rf /var/lib/mysql/*
systemctl start mariadb
```

---

## 节点增删操作

### 添加新节点

```bash
# 1. 在新服务器安装 MariaDB + Galera
apt install -y mariadb-server galera-4

# 2. 配置 Galera（修改 gcomm:// 地址）
# /etc/mysql/mariadb.conf.d/galera.cnf
wsrep_cluster_address="gcomm://192.168.1.101,192.168.1.102,192.168.1.103,192.168.1.104"
wsrep_node_address="192.168.1.104"

# 3. 启动新节点
systemctl start mariadb

# 4. 验证
mysql -e "SHOW STATUS LIKE 'wsrep_cluster_size';"
# 应该是 4
```

### 安全移除节点

```bash
# 方法一：在节点上执行关闭
systemctl stop mariadb

# 方法二：通过 SQL 优雅移除
mysql -e "SET GLOBAL wsrep_desync=ON; SET GLOBAL wsrep_cluster_address='gcomm://ignore';"
# 然后再停止服务

# 方法三：在其他节点执行
# 修改配置文件的 gcomm:// 地址，去掉要移除的节点
# 重启集群中的节点
```

### 滚动升级

```bash
# 滚动升级 MariaDB 版本（不影响服务）

# 1. 升级一个节点
systemctl stop mariadb
apt upgrade mariadb-server
systemctl start mariadb

# 2. 等待节点同步
mysql -e "SHOW STATUS LIKE 'wsrep_local_state_comment';"
# 确认显示 "Synced"

# 3. 重复其他节点
```

---

## 常见问题与解决

### 问题一：SST 失败

```bash
# 错误日志：WSREP: Failed to prepare for state snapshot transfer

# 解决：
# 1. 检查 SST 用户权限
mysql -e "SHOW GRANTS FOR 'sstuser'@'%';"

# 2. 检查网络连接
nc -v donor_ip 4444

# 3. 使用正确的 SST 方法
# my.cnf
wsrep_sst_method=xtrabackup-v2
```

### 问题二：节点无法加入

```sql
-- 查看错误日志
-- /var/log/mysql/error.log

-- 常见原因：
-- 1. gcomm:// 地址配置错误
-- 2. 防火墙阻止
-- 3. 数据版本不兼容

-- 解决：
# 1. 检查配置
SHOW VARIABLES LIKE 'wsrep%';

# 2. 检查防火墙
ufw status
iptables -L

# 3. 如果数据差异太大，清空数据目录重建
systemctl stop mariadb
rm -rf /var/lib/mysql/*
systemctl start mariadb
```

### 问题三：Flow Control 暂停率高

```sql
-- 症状：wsrep_flow_control_paused 长期 > 0.1

-- 原因：
-- 1. 节点负载过高
-- 2. 网络延迟
-- 3. 写入量过大

-- 解决：
# 1. 增加 wsrep_slave_threads
SET GLOBAL wsrep_slave_threads = 32;

# 2. 优化网络
# 3. 控制写入速度
```

### 问题四：脑裂（Non-Primary）

```sql
-- 症状：SHOW STATUS LIKE 'wsrep_cluster_status' 返回 Non-Primary

-- 解决：
-- 1. 确认多数节点
-- 2. 少数节点执行
SET GLOBAL wsrep_cluster_address='gcomm://ignore';
systemctl restart mariadb

-- 3. 确认恢复
SHOW STATUS LIKE 'wsrep_cluster_status';
-- 应该返回 Primary
```

---

## 最佳实践

### 集群规模选择

| 场景 | 推荐节点数 | 说明 |
|------|------------|------|
| 开发/测试 | 2 | 不保证高可用 |
| 小规模生产 | 3 | 最小生产配置 |
| 中等规模 | 3-5 | 平衡性能和高可用 |
| 大规模 | 5-7 | 需要网络优化 |
| 不要超过 | 9 | 复制延迟会增加 |

### 网络要求

```ini
# 网络优化配置
[mysqld]
# 增加网络缓冲区
wsrep_provider_options="gcs.recv_q_hard_limit=LLONG_MAX;gcs.recv_q_soft_limit=0.25;gcs.send_q_hard_limit=LLONG_MAX;gcs.send_q_soft_limit=0.25"

# 使用更好的压缩
wsrep_provider_options="gcs.fc_factor=0.8;gcs.fc_limit=16;gcs.fc_master_slave=YES"
```

### 监控告警

```java
public class GaleraAlert {
    
    public void checkAndAlert() {
        // 告警条件
        // 1. wsrep_cluster_size < 期望值
        // 2. wsrep_cluster_status != Primary
        // 3. wsrep_local_state != 4 (Synced)
        // 4. wsrep_flow_control_paused > 0.1
        
        // 发送告警（邮件、钉钉、飞书等）
    }
}
```

---

## 面试追问

### 追问一：Galera 如何保证不丢数据？

Galera 的同步机制：
1. 事务在所有节点提交后才算完成
2. 如果任一节点失败，整个事务回滚
3. 不会出现「主从数据不一致」的问题

**对比异步复制**：
- 异步：主库提交后，从库可能还没收到
- 主库挂了，从库可能丢数据
- Galera：不会

### 追问二：节点之间的数据同步是同步还是异步？

**表面上是同步的**（所有节点确认后才提交），但内部实现：
- 使用了「乐观」并发控制
- 不阻塞读操作
- 只在 certification 阶段检测冲突

所以 Galera 被称为「**同步多主**」，兼具同步一致性和高并发能力。

### 追问三：Galera 的性能瓶颈在哪里？

1. **写入放大**：每个事务都要复制到所有节点
2. **网络延迟**：节点间的网络是关键
3. **最慢节点**：木桶效应，最慢的节点决定整体性能

---

## 总结

| 要点 | 说明 |
|------|------|
| **加入流程** | 发现 → SST → IST → Synced |
| **SST 方法** | rsync、xtrabackup、mysqldump |
| **故障检测** | Quorum 多数投票机制 |
| **状态值** | 1-5（Unknown 到 Synced） |
| **常见问题** | SST 失败、无法加入、脑裂 |
| **最佳实践** | 3 节点起步、监控告警、网络优化 |

**Galera 的节点管理是全自动的，但运维人员仍然需要理解其原理，才能在异常情况下快速定位和解决问题。**

---

## 下一步

- 想了解 MariaDB 主从复制？[MariaDB 主从复制与 GTID](/database/mariadb/replication)
- 想了解读写分离？[MariaDB MaxScale 读写分离中间件](/database/mariadb/maxscale)
- 想了解备份恢复？[MariaDB 备份与恢复：XtraBackup 集成](/database/mariadb/backup)
