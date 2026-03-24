# MariaDB Galera Cluster 原理：同步多主复制

你的 MySQL 数据库正在跑着，突然 master 挂了。

运维同学手忙脚乱地切换到 slave，业务中断了 30 分钟。

隔壁用 MariaDB 的团队笑了：「我们不需要手动切换。」

**Galera Cluster 是 MariaDB 的杀手锏——真正的同步多主集群，让你的数据库永远在线。**

---

## Galera Cluster 概述

### 什么是 Galera Cluster？

Galera Cluster 是一种**同步多主（Multi-Master）复制**解决方案，多个 MariaDB 节点组成一个集群，任意节点都可以接收写入。

```
┌─────────────────────────────────────────────────────────────┐
│                   Galera Cluster 架构                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   客户端                                                    │
│       │                                                     │
│   ┌───┴───┐                                               │
│   │        │                                              │
│   ▼        ▼        ▼                                      │
│ ┌───┐  ┌───┐  ┌───┐                                     │
│ │写 │  │写 │  │写 │    ← 任意节点可写入                   │
│ └───┘  └───┘  └───┘                                      │
│   │        │        │                                      │
│   └────────┼────────┘                                      │
│            │                                               │
│            ▼                                               │
│   ┌─────────────────┐                                     │
│   │   Galera 复制层   │                                     │
│   │                   │                                     │
│   │ Certification     │ ← 证书验证                        │
│   │ Replication       │ ← 同步复制                         │
│   │ Flow Control      │ ← 流量控制                         │
│   └─────────────────┘                                     │
│            │                                               │
│   ┌────────┼────────┐                                     │
│   ▼        ▼        ▼                                      │
│ ┌───┐  ┌───┐  ┌───┐                                     │
│ │ N1 │◄─┤ N2 │◄─┤ N3 │  ← 节点间全量同步                 │
│ └───┘  └───┘  └───┘                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 核心特性

| 特性 | 说明 |
|------|------|
| 同步复制 | 所有节点数据一致 |
| 多主架构 | 任意节点可写入 |
| 自动故障转移 | 节点故障自动剔除 |
| 自动成员管理 | 新节点自动加入 |
| 强一致性 | 真正的 ACID |
| 无脑裂 | 不会出现数据分裂 |

### Galera vs MySQL 传统复制

| 维度 | MySQL 传统复制 | Galera Cluster |
|------|---------------|-----------------|
| 复制类型 | 异步 | 同步 |
| 写入点 | 单主 | 多主 |
| 数据一致性 | 最终一致 | 强一致 |
| 故障恢复 | 手动 | 自动 |
| 延迟影响 | 主延迟影响从 | 同步等待 |
| 切换时间 | 分钟级 | 秒级 |
| 脑裂风险 | 存在 | 无 |

---

## Galera 工作原理

### 复制流程

```
┌─────────────────────────────────────────────────────────────┐
│                    Galera 复制流程                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  节点 N1 收到事务 T                                         │
│            │                                                │
│            ▼                                                │
│  ┌──────────────────┐                                      │
│  │   本地执行 T     │                                      │
│  │  (生成 write set) │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────┐                                      │
│  │ Certification    │ ← 验证 write set 是否冲突            │
│  │ (证书验证)       │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│           ▼                                                 │
│  ┌──────────────────┐                                      │
│  │ 广播到所有节点  │                                      │
│  └────────┬─────────┘                                      │
│           │                                                 │
│     ┌─────┼─────┐                                         │
│     ▼     ▼     ▼                                          │
│    N2    N3    N4                                          │
│     │     │     │                                          │
│     └─────┼─────┘                                         │
│           ▼                                                 │
│  ┌──────────────────┐                                      │
│  │   同步执行 T    │                                      │
│  │  (所有节点应用)  │                                      │
│  └──────────────────┘                                      │
│           │                                                 │
│           ▼                                                │
│  ┌──────────────────┐                                      │
│  │   提交事务 T     │ ← 所有节点确认后提交                 │
│  └──────────────────┘                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Certification（证书验证）

Galera 使用乐观并发控制：
1. 每个事务生成一个 write set（包含修改的行信息）
2. Write set 广播到所有节点
3. 每个节点验证 write set 是否与其他事务冲突
4. 如果无冲突，事务提交；如果冲突，事务回滚

```sql
-- 冲突示例
-- 节点 N1 执行：UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- 节点 N2 执行：UPDATE accounts SET balance = balance - 200 WHERE id = 1;
-- 两个事务同时执行，write set 包含相同行的修改
-- Galera 会在 certification 阶段检测到冲突
-- 后提交的事务会被回滚（wsrep_caused_threads_count 增加）
```

### Flow Control（流量控制）

Galera 使用流量控制来保证集群同步：

```sql
-- 查看 Flow Control 状态
SHOW STATUS LIKE 'wsrep_flow_control%';

-- 典型输出：
-- wsrep_flow_control_paused: 0.001234    -- 暂停比例（越小越好）
-- wsrep_flow_control_paused_ns: 12345     -- 暂停总时间（纳秒）
-- wsrep_flow_control_recv: 12345           -- 收到的 FC 请求数
-- wsrep_flow_control_sent: 123            -- 发送的 FC 请求数
```

### 组件架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Galera 组件架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    MariaDB                           │  │
│  │  ┌─────────────────────────────────────────────┐   │  │
│  │  │              Galera Plugin                    │   │  │
│  │  │                                             │   │  │
│  │  │  ┌─────────┐  ┌──────────┐  ┌───────────┐ │   │  │
│  │  │  │  Cert   │  │ Replicator│  │   applier │ │   │  │
│  │  │  │ (验证)  │  │ (复制器) │  │  (应用器)  │ │   │  │
│  │  │  └─────────┘  └──────────┘  └───────────┘ │   │  │
│  │  │                                            │   │  │
│  │  │  ┌─────────┐  ┌──────────┐                │   │  │
│  │  │  │   gcs   │  │  ist/ SST │               │   │  │
│  │  │  │ (全局通信)│  │ (增量/全量同步)│               │   │  │
│  │  │  └─────────┘  └──────────┘                │   │  │
│  │  └─────────────────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────┘  │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │               wsrep API (Galera Provider)            │  │
│  └─────────────────────────────────────────────────────┘  │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │               Galera Replication Library              │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 集群配置

### 环境准备

```bash
# 三台服务器准备
# Node1: 192.168.1.101
# Node2: 192.168.1.102
# Node3: 192.168.1.103

# 安装 MariaDB + Galera
apt update && apt install -y mariadb-server galera-4
```

### 配置文件

```ini
# /etc/mysql/mariadb.conf.d/galera.cnf

[mysqld]
# Galera 基本配置
binlog_format=row
default_storage_engine=InnoDB
innodb_autoinc_lock_mode=2
bind-address=0.0.0.0

# Galera 集群配置
wsrep_on=ON
wsrep_provider=/usr/lib/galera/libgalera_sSM.so
wsrep_cluster_name="my_cluster"
wsrep_cluster_address="gcomm://192.168.1.101,192.168.1.102,192.168.1.103"

# 节点配置
wsrep_node_name="node1"
wsrep_node_address="192.168.1.101"

# SST (State Snapshot Transfer) 配置
wsrep_sst_method=rsync
wsrep_sst_auth=sstuser:password

# 避免脑裂
pc.weight=1

# 流控配置
wsrep_slave_threads=16
wsrep_retry_autocommit=3
```

### 启动集群

```bash
# Node1：引导集群（首次启动）
galera_new_cluster

# Node2 和 Node3：普通启动
systemctl start mariadb

# 验证集群状态
mysql -u root -p -e "SHOW STATUS LIKE 'wsrep_cluster%';"
```

### 集群状态查看

```sql
-- 查看集群成员数量
SHOW STATUS LIKE 'wsrep_cluster_size';
-- 结果：3

-- 查看集群状态
SHOW STATUS LIKE 'wsrep_cluster_status';
-- 结果：Primary（正常）或 Non-Primary（异常）

-- 查看同步状态
SHOW STATUS LIKE 'wsrep_flow_control_paused';
-- 结果：0.001234（接近0表示正常）

-- 查看节点状态
SHOW STATUS LIKE 'wsrep_%';
```

---

## 同步状态与性能

### 同步状态

```sql
-- 查看所有节点状态
SHOW STATUS LIKE 'wsrep_incoming_addresses';

-- 查看复制延迟
SHOW STATUS LIKE 'wsrep Replication latency';

-- 查看认证冲突
SHOW STATUS LIKE 'wsrep_cert%';

-- 查看本地队列
SHOW STATUS LIKE 'wsrep_local%';
```

### 性能监控

```sql
-- 复制性能指标
SHOW STATUS LIKE 'wsrep%';

-- 常用指标解释
-- wsrep_local_recv_queue_avg: 本地接收队列平均长度
-- wsrep_local_send_queue_avg: 本地发送队列平均长度
-- wsrep_local_bf_aborts: 本地事务因冲突回滚数
-- wsrep_cert_deps_distance: 认证依赖距离
-- wsrep_slave_threads: 复制线程数
```

### Java 客户端配置

```java
public class GaleraClusterDemo {
    
    // 集群节点列表
    private static final String[] NODES = {
        "192.168.1.101:3306",
        "192.168.1.102:3306",
        "192.168.1.103:3306"
    };
    
    public Connection getConnection() throws SQLException {
        // 方式一：连接指定节点
        String url = "jdbc:mariadb://192.168.1.101:3306/mydb";
        return DriverManager.getConnection(url, "user", "password");
        
        // 方式二：使用多个主机（MariaDB Connector 自动重试）
        // 需要配置允许重试的主机
    }
    
    // HA 连接池配置
    public HikariConfig createHikariConfig() {
        HikariConfig config = new HikariConfig();
        
        // 集群模式下，建议使用所有节点
        config.setJdbcUrl("jdbc:mariadb://192.168.1.101:3306,192.168.1.102:3306,192.168.1.103:3306/mydb");
        config.setUsername("user");
        config.setPassword("password");
        
        // 连接池配置
        config.setMaximumPoolSize(20);
        config.setMinimumIdle(5);
        config.setConnectionTimeout(30000);
        
        // 自动重试配置
        config.addDataSourceProperty("autoReconnect", "true");
        config.addDataSourceProperty("retriesAllDown", "3");
        
        return config;
    }
    
    // 故障转移处理
    public void failoverDemo() {
        int maxRetries = 3;
        SQLException lastException = null;
        
        for (int i = 0; i < maxRetries; i++) {
            try (Connection conn = getConnection()) {
                // 执行查询
                String sql = "SELECT * FROM users LIMIT 1";
                ResultSet rs = conn.createStatement().executeQuery(sql);
                return;
            } catch (SQLException e) {
                lastException = e;
                System.out.println("尝试 " + (i + 1) + " 失败: " + e.getMessage());
                if (i < maxRetries - 1) {
                    try {
                        Thread.sleep(1000 * (i + 1));
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }
        
        throw new RuntimeException("所有节点都不可用", lastException);
    }
}
```

---

## 写入冲突处理

### 乐观锁 vs 悲观锁

```sql
-- Galera 使用乐观锁
-- 写入时不会阻塞读

-- 示例：两个节点同时更新同一行
-- Node 1: UPDATE accounts SET balance = balance - 100 WHERE id = 1;
-- Node 2: UPDATE accounts SET balance = balance - 200 WHERE id = 1;

-- 结果：
-- 第一个提交的会成功
-- 第二个提交的事务会因 certification 失败而回滚
-- 应用会收到死锁错误（wsrep_last_committed = 上一个事务）
```

### 避免冲突的最佳实践

```sql
-- 1. 写入到同一节点（使用 Galera 路由器，如 MaxScale）
-- 2. 按主键分片写入
-- 3. 使用 SERIALIZABLE 隔离级别（会降低并发）
-- 4. 设计时避免同一行的并发写入

-- 示例：按用户 ID 路由写入
-- 奇数用户写入 Node1
-- 偶数用户写入 Node2
```

---

## Galera 的限制

### 不适合的场景

| 限制 | 说明 |
|------|------|
| 大事务 | Galera 复制整个事务，大事务会阻塞 |
| 长事务 | 长时间持有锁会影响集群同步 |
| WAN 延迟 | 跨地域延迟会导致性能下降 |
| 节点数量 | 建议 ≤ 9 节点 |
| DDL | 某些 DDL 可能锁表 |
| 存储引擎 | 必须是支持 Galera 的引擎（InnoDB/XtraDB） |

### 性能优化

```sql
-- 优化 wsrep_slave_threads
SET GLOBAL wsrep_slave_threads = 16;

-- 优化 flow control
SET GLOBAL wsrep_causal_reads = 'ON';

-- 优化认证批次
SET GLOBAL wsrep_cert_batch_size = 10000;

-- 监控并调整
SHOW STATUS LIKE 'wsrep%';
```

---

## 面试追问

### 追问一：Galera Cluster 和 MySQL MGR 有什么区别？

| 维度 | Galera | MGR |
|------|--------|-----|
| 开发方 | Codership（开源） | Oracle MySQL（官方） |
| 协议 | 乐观并发 + 证书验证 | Paxos 协议 |
| 写入节点 | 多主 | 可单主可多主 |
| 冲突检测 | Certification | 2PC + 冲突检测 |
| 性能 | 优化良好 | MySQL 8.0+ |
| 生态 | MariaDB, Percona | 仅 MySQL |
| 成熟度 | 更成熟 | 较新 |

### 追问二：Galera 的「脑裂」问题如何解决？

Galera 通过以下机制避免脑裂：
1. **Primary Component**：只有 Primary 状态的集群才能写入
2. **Quorum**：多数节点投票决定集群状态
3. **pc.weight**：可以设置节点权重

```sql
-- 当网络分区时，非多数节点会变成 non-Primary
-- 等待网络恢复后自动恢复

-- 强制恢复（谨慎使用）
SET GLOBAL wsrep_provider_options='pc.ignore_sandbox=true';
```

### 追问三：Galera 节点间的数据同步如何进行？

两种方式：
1. **SST (State Snapshot Transfer)**：全量同步
   - 新节点加入时使用
   - 方法：rsync, xtrabackup, mysqldump
2. **IST (Incremental State Transfer)**：增量同步
   - 节点短暂离开后重新加入
   - 只同步缺失的部分

---

## 总结

| 要点 | 说明 |
|------|------|
| **核心原理** | 同步多主复制，基于 write set 证书验证 |
| **主要优势** | 强一致性、自动故障转移、无脑裂 |
| **复制流程** | 本地执行 → 证书验证 → 广播 → 同步应用 → 提交 |
| **Flow Control** | 流量控制保证集群同步 |
| **性能指标** | wsrep_flow_control_paused（接近0为佳） |
| **限制** | 大事务、长事务、WAN 场景需注意 |

**Galera Cluster 让 MariaDB 拥有了企业级的高可用能力，是目前最成熟的 MySQL/MariaDB 同步多主解决方案。**

---

## 下一步

- 想了解 Galera 节点管理？[MariaDB Galera Cluster 节点加入与故障恢复](/database/mariadb/galera-node)
- 想了解 MariaDB 主从复制？[MariaDB 主从复制与 GTID](/database/mariadb/replication)
- 想了解读写分离？[MariaDB MaxScale 读写分离中间件](/database/mariadb/maxscale)
