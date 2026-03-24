# MariaDB MaxScale 读写分离中间件

你的应用需要读写分离，找了 DBA 配置。

DBA 翻了翻文档：「这个需求，MaxScale 帮你搞定。」

你半信半疑：「中间件？那不是很容易变成单点故障吗？」

DBA 笑了：「它自己就是集群。」

**MaxScale 是 MariaDB 官方出品的数据库中间件，支持读写分离、负载均衡、自动故障转移——而且本身就是高可用的。**

---

## MaxScale 概述

### 什么是 MaxScale？

MaxScale 是 MariaDB Corporation 开发的**数据库智能代理**，提供以下功能：

| 功能 | 说明 |
|------|------|
| 读写分离 | 自动将写请求路由到主库，读请求分散到从库 |
| 负载均衡 | 多个从库间均衡分配读请求 |
| 故障转移 | 后端节点故障时自动剔除 |
| 连接池 | 复用数据库连接 |
| 防火墙 | SQL 注入防护 |
| 查询路由 | 规则引擎自定义路由 |
| 日志审计 | 记录所有查询 |

```
┌─────────────────────────────────────────────────────────────┐
│                    MaxScale 架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    应用层                                    │
│                       │                                     │
│                       ▼                                     │
│            ┌─────────────────┐                             │
│            │    MaxScale     │                             │
│            │                 │                             │
│            │  ┌───────────┐ │                             │
│            │  │  Router   │ │                             │
│            │  │ (路由器)  │ │                             │
│            │  └───────────┘ │                             │
│            │  ┌───────────┐ │                             │
│            │  │  Filter   │ │                             │
│            │  │ (过滤器)  │ │                             │
│            │  └───────────┘ │                             │
│            └────────┬────────┘                             │
│                       │                                     │
│     ┌────────────────┼────────────────┐                   │
│     │                │                │                    │
│     ▼                ▼                ▼                    │
│  ┌────────┐      ┌────────┐       ┌────────┐              │
│  │ Master │      │ Slave1 │       │ Slave2 │              │
│  │ (写)   │      │  (读)  │       │  (读)  │              │
│  └────────┘      └────────┘       └────────┘              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### MaxScale vs 其他中间件

| 中间件 | MaxScale | MySQL Router | ProxySQL | ShardingSphere |
|--------|----------|--------------|----------|----------------|
| 开发方 | MariaDB | Oracle | MySQL | 开源社区 |
| 读写分离 | ✅ | ✅ | ✅ | ✅ |
| SQL 防火墙 | ✅ | ❌ | ✅ | ❌ |
| 高可用 | ✅ | ✅ | ✅ | ✅ |
| 配置管理 | 简单 | 简单 | 复杂 | 中等 |
| 学习成本 | 低 | 低 | 中 | 高 |

---

## 安装与配置

### 安装 MaxScale

```bash
# Ubuntu/Debian
apt update && apt install -y maxscale

# CentOS/RHEL
yum install -y maxscale
```

### 配置 MaxScale

```ini
# /etc/maxscale.cnf

[maxscale]
threads=auto
log Augmented_SQL_Status=ON
log_info=true
log_warning=true
log_error=true

# 监控模块
[Galera Monitor]
type=monitor
module=galeramon
servers=server1,server2,server3
user=maxscale
password=maxscale_pass
monitor_interval=10000

# 路由模块
[Read-Write Service]
type=service
router=readwritesplit
servers=server1,server2,server3
user=maxscale
password=maxscale_pass
max_slave_connections=100%
max_slave_replication_lag=5s

# 监听端口
[Read-Write Listener]
type=listener
service=Read-Write Service
protocol=MySQLClient
port=3306

# 后端服务器
[server1]
type=server
address=192.168.1.101
port=3306
protocol=MySQLBackend

[server2]
type=server
address=192.168.1.102
port=3306
protocol=MySQLBackend

[server3]
type=server
address=192.168.1.103
port=3306
protocol=MySQLBackend
```

### 创建 MaxScale 用户

```sql
-- 在 MariaDB 中创建 MaxScale 监控用户
CREATE USER 'maxscale'@'%' IDENTIFIED BY 'maxscale_pass';
GRANT SELECT ON mysql.* TO 'maxscale'@'%';
GRANT REPLICATION CLIENT ON *.* TO 'maxscale'@'%';

-- 如果使用 Galera
GRANT SELECT ON mysql.user TO 'maxscale'@'%';
```

### 启动 MaxScale

```bash
# 启动
systemctl start maxscale

# 查看状态
maxadm list

# 查看详细状态
maxadm show services
maxadm show servers
```

---

## 读写分离原理

### 自动路由规则

```
┌─────────────────────────────────────────────────────────────┐
│                    读写分离路由                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  SQL 语句分析                                                │
│       │                                                     │
│       ▼                                                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    是 SELECT?                       │   │
│  └──────────────────────┬────────────────────────────┘   │
│                         │                                   │
│              ┌──────────┴──────────┐                        │
│              │                     │                        │
│             是                    否                        │
│              │                     │                        │
│              ▼                     ▼                        │
│  ┌───────────────────┐   ┌───────────────────┐            │
│  │    路由到从库     │   │    路由到主库     │            │
│  │                   │   │                   │            │
│  │  ┌────┐ ┌────┐  │   │                   │            │
│  │  │Slave│ │Slave│ │   │      Master      │            │
│  │  │  1  │ │  2  │ │   │       写入       │            │
│  │  └──┬─┘ └──┬─┘  │   │                   │            │
│  │     │       │    │   └───────────────────┘            │
│  │     └───────┴────┘                                    │
│  │      负载均衡分配                                       │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 自动判断写操作

MaxScale 会识别以下为写操作：
- `INSERT`
- `UPDATE`
- `DELETE`
- `REPLACE`
- `CREATE`
- `ALTER`
- `DROP`
- `TRUNCATE`
- `LOAD DATA`
- `SELECT ... FOR UPDATE`
- `SET` 语句

### 负载均衡策略

```ini
# /etc/maxscale.cnf

[Read-Write Service]
type=service
router=readwritesplit
servers=server1,server2,server3

# 负载均衡策略
route_weight=server1:2,server2:1,server3:1  # server1 权重为 2

# 最大从库连接数
max_slave_connections=100%  # 使用所有从库

# 从库复制延迟容忍
max_slave_replication_lag=5s
```

---

## Java 客户端配置

### 连接 MaxScale

```java
public class MaxScaleDemo {
    
    // MaxScale 地址（只需要一个，MaxScale 自动处理故障转移）
    private static final String MAXSCALE_HOST = "192.168.1.100";
    private static final int MAXSCALE_PORT = 3306;
    
    public Connection getConnection() throws SQLException {
        // 连接 MaxScale，就像连接普通 MariaDB 一样
        String url = String.format(
            "jdbc:mariadb://%s:%d/mydb",
            MAXSCALE_HOST, MAXSCALE_PORT
        );
        
        return DriverManager.getConnection(url, "app_user", "app_password");
    }
    
    // HikariCP 连接池配置
    public HikariConfig createHikariConfig() {
        HikariConfig config = new HikariConfig();
        
        // 连接 MaxScale
        config.setJdbcUrl(String.format(
            "jdbc:mariadb://%s:%d/mydb",
            MAXSCALE_HOST, MAXSCALE_PORT
        ));
        config.setUsername("app_user");
        config.setPassword("app_password");
        
        // 连接池配置
        config.setMaximumPoolSize(30);
        config.setMinimumIdle(10);
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);
        
        // 健康检查
        config.setConnectionTestQuery("SELECT 1");
        
        return config;
    }
}
```

### 自动故障转移

```java
public class MaxScaleFailoverDemo {
    
    // 只需配置 MaxScale 地址，自动处理故障
    private static final String URL = "jdbc:mariadb://maxscale:3306/mydb";
    
    public void demonstrateFailover() {
        // 应用只需要连接 MaxScale
        // 如果当前连接的节点故障
        // MaxScale 会自动切换到其他健康节点
        // 应用无需感知
        
        try (Connection conn = DriverManager.getConnection(URL, "user", "pass")) {
            // 所有操作都通过 MaxScale
            String sql = "SELECT * FROM users LIMIT 1";
            conn.createStatement().executeQuery(sql);
        } catch (SQLException e) {
            // MaxScale 会自动重试
            System.out.println("发生异常: " + e.getMessage());
        }
    }
    
    // 读写分离验证
    public void verifyReadWriteSplit() throws SQLException {
        try (Connection conn = getConnection()) {
            Statement stmt = conn.createStatement();
            
            // 读操作 - 应该路由到从库
            ResultSet rs = stmt.executeQuery("SELECT @@hostname");
            if (rs.next()) {
                System.out.println("读操作路由到: " + rs.getString(1));
            }
            
            // 写操作 - 应该路由到主库
            stmt.execute("INSERT INTO test_table VALUES (1)");
            
            // 再次读
            rs = stmt.executeQuery("SELECT @@hostname");
            if (rs.next()) {
                System.out.println("再次读取路由到: " + rs.getString(1));
            }
        }
    }
}
```

---

## SQL 防火墙功能

### 配置 SQL 防火墙

```ini
# /etc/maxscale.cnf

[SQL Firewall Filter]
type=filter
module=sqlfirewall
rules=/etc/maxscale/sql_firewall.rules

[Read-Write Service]
type=service
router=readwritesplit
servers=server1,server2,server3
filters=SQL Firewall Filter
```

### 防火墙规则

```ini
# /etc/maxscale/sql_firewall.rules

# 允许所有 SELECT
^SELECT.*FROM users WHERE id=\?$

# 允许特定 INSERT
^INSERT INTO orders \(order_no, amount\) VALUES \(\?, \?\)$

# 禁止 TRUNCATE
^TRUNCATE TABLE.*$

# 禁止删除超过 1000 行
^DELETE FROM.*WHERE

# 禁止全表更新
^UPDATE.*WHERE 1=1$

# 禁止注释
--.*
/\*.*\*/
```

### 训练模式

```sql
-- MaxScale 支持训练模式
-- 自动学习应用的 SQL 模式

# 启用训练模式
maxsql --ssl=disable

# 连接到 MaxScale 执行应用的所有操作
# MaxScale 会记录所有 SQL 语句
# 训练完成后生成规则文件
```

---

## 监控与管理

### maxadm 命令

```bash
# 查看所有服务和监听器
maxadm list

# 查看服务详情
maxadm show services

# 查看服务器详情
maxadm show servers

# 查看统计信息
maxadm show sessions
maxadm show commands

# 查看连接数
maxadm show connections

# 启用/禁用服务器
maxadm disable server server2
maxadm enable server server2
```

### REST API

```bash
# MaxScale 提供 REST API
curl -u admin:admin http://localhost:8989/v1/servers

# 查看集群状态
curl -u admin:admin http://localhost:8989/v1/services

# 禁用节点
curl -u admin:admin -X PATCH \
  -d '{"data": {"attributes": {"state": "disabled"}}}' \
  http://localhost:8989/v1/servers/server2
```

### Prometheus 监控

```ini
# /etc/maxscale.cnf

[MaxScale REST API]
type=listener
service=Read-Write Service
protocol=MySQLClient
port=3306

[MaxScale HTTP]
type=listener
service=Read-Write Service
protocol=HTTP
address=0.0.0.0
port=8989
```

```bash
# 配置 Prometheus 抓取 MaxScale 指标
# prometheus.yml
scrape_configs:
  - job_name: 'maxscale'
    static_configs:
      - targets: ['maxscale:8989']
```

---

## 高可用配置

### MaxScale 双机热备

```
┌─────────────────────────────────────────────────────────────┐
│                 MaxScale 高可用架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│         ┌─────────────┐     ┌─────────────┐                │
│         │  MaxScale  │     │  MaxScale  │                │
│         │    主节点    │◄───►│   备节点    │                │
│         └──────┬──────┘     └──────┬──────┘                │
│                │                    │                        │
│                └────────┬──────────┘                        │
│                         │ VIP (Keepalived)                  │
│                         │                                    │
│                         ▼                                    │
│                    应用连接                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Keepalived 配置

```ini
# /etc/keepalived/keepalived.conf

vrrp_instance VI_1 {
    state BACKUP
    interface eth0
    virtual_router_id 51
    priority 100
    nopreempt

    virtual_ipaddress {
        192.168.1.200/24  # VIP 地址
    }

    track_script {
        check_maxscale
    }
}

script /usr/local/bin/check_maxscale.sh
```

---

## 常见问题与解决

### 问题一：连接不上 MaxScale

```bash
# 检查 MaxScale 是否运行
systemctl status maxscale

# 检查端口
netstat -tlnp | grep 3306

# 检查配置
maxadm show listeners
```

### 问题二：读写分离不生效

```sql
-- 检查路由
-- 查看 MaxScale 日志
tail -f /var/log/maxscale/maxscale.log

-- 检查 SQL 是否被识别为读操作
-- 使用 EXPLAIN 命令
```

### 问题三：节点被禁用

```bash
# 查看节点状态
maxadm show servers

# 如果被禁用，启用它
maxadm enable server server2

# 检查禁用原因
maxadm show server server2
```

---

## 面试追问

### 追问一：MaxScale 如何保证高可用？

1. **后端 HA**：监控多个后端节点，自动剔除故障节点
2. **自身 HA**：可以部署多台 MaxScale，使用 VIP 漂移
3. **连接池**：客户端连接保持，MaxScale 自动重路由

### 追问二：MaxScale 和应用直连数据库的区别？

| 维度 | 直连数据库 | 通过 MaxScale |
|------|------------|---------------|
| 读写分离 | 应用自己实现 | 自动 |
| 负载均衡 | 应用自己实现 | 自动 |
| 故障转移 | 应用重连 | 自动重路由 |
| SQL 防火墙 | 无 | 有 |
| 监控审计 | 无 | 有 |
| 额外延迟 | 无 | 有（微秒级） |

### 追问三：MaxScale 的性能如何？

- **开销极小**：通常 < 1ms 延迟
- **吞吐量高**：单台可处理上万 QPS
- **瓶颈在后端**：通常瓶颈在数据库，不在 MaxScale

---

## 总结

| 要点 | 说明 |
|------|------|
| **核心功能** | 读写分离、负载均衡、故障转移 |
| **配置方式** | ini 配置文件 + REST API |
| **监控** | maxadm 命令 + REST API |
| **SQL 防火墙** | 可选的 SQL 过滤功能 |
| **高可用** | 后端多节点 + MaxScale 双机热备 |
| **性能开销** | 微秒级延迟，几乎无感知 |

**MaxScale 让 MariaDB 的高可用架构变得简单可靠，是生产环境的推荐方案。**

---

## 下一步

- 想了解备份恢复？[MariaDB 备份与恢复：XtraBackup 集成](/database/mariadb/backup)
- 想了解 Galera Cluster？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
- 想了解更多集群知识？[MariaDB 面试高频问题汇总](/database/mariadb/interview-summary)
