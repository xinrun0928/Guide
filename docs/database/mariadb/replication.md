# MariaDB 主从复制与 GTID

你的数据库从库数据延迟了 2 小时，老板问：「数据什么时候能同步完？」

你看了眼延迟原因——主库有个大事务，执行了 1 小时。

你叹了口气：「没办法，异步复制的通病。」

**MariaDB 的主从复制是 MySQL 复制的延续，支持 GTID 让复制管理更加简单可靠。**

---

## 主从复制概述

### 复制架构

```
┌─────────────────────────────────────────────────────────────┐
│                   MariaDB 主从复制架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  主库 (Master)                                              │
│  ┌────────────────┐                                         │
│  │  应用写入      │                                         │
│  └───────┬────────┘                                         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────┐    ┌────────────────┐                 │
│  │  binlog 文件   │───►│  binlog 转储线程 │ (Dump Thread)   │
│  │  (写入日志)    │    │  (发送日志)     │                 │
│  └────────────────┘    └───────┬────────┘                 │
│                                 │                           │
│                    网络传输     │                           │
│  从库 1 ◄──────────────────────┘                           │
│  ┌────────────────┐                                         │
│  │ IO Thread      │◄── 接收 binlog                        │
│  └───────┬────────┘                                         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────┐                                         │
│  │ relay-log 文件 │    (中继日志)                          │
│  └───────┬────────┘                                         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────┐                                         │
│  │ SQL Thread     │    执行 relay-log 中的事件             │
│  └───────┬────────┘                                         │
│          │                                                   │
│          ▼                                                   │
│  ┌────────────────┐                                         │
│  │ 从库数据       │                                         │
│  └────────────────┘                                         │
│                                                             │
│  从库 2 ◄─ 同样的流程                                       │
│  从库 N ◄─ 同样的流程                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 复制原理

1. **主库**：记录所有写操作到 binlog
2. **Dump 线程**：主库的_dump thread 读取 binlog，发送给从库
3. **IO 线程**：从库的_io thread 接收数据，写入 relay-log
4. **SQL 线程**：从库的_sql thread 读取 relay-log，执行 SQL

---

## 配置主从复制

### 主库配置

```ini
# /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 启用 binlog
log-bin=mysql-bin
server-id=1
binlog_format=row

# GTID 配置（MariaDB 10.0+）
gtid_domain_id=1
log_slave_updates=ON

# 复制相关
max_binlog_size=100M
binlog_expire_logs_seconds=604800
sync_binlog=1

# 只读（可选，从库配置）
# read_only=ON
# super_read_only=ON
```

```sql
-- 创建复制用户
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'repl_password';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';

-- 查看主库状态
SHOW MASTER STATUS;
-- +------------------+----------+--------------+------------------+
-- | File             | Position | Binlog_Do_DB | Binlog_Ignore_DB |
-- +------------------+----------+--------------+------------------+
-- | mysql-bin.000001 | 12345    |              |                  |
-- +------------------+----------+--------------+------------------+
```

### 从库配置

```ini
# /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 启用 relay-log
server-id=2
relay-log=mysql-relay-bin
relay_log_purge=ON

# GTID 配置（MariaDB 10.0+）
gtid_domain_id=2
log_slave_updates=ON

# 只读配置（生产环境建议开启）
read_only=ON
super_read_only=ON
```

### 启动复制

```sql
-- 方法一：传统方式（基于 binlog position）
CHANGE MASTER TO
    MASTER_HOST='192.168.1.101',
    MASTER_USER='repl_user',
    MASTER_PASSWORD='repl_password',
    MASTER_LOG_FILE='mysql-bin.000001',
    MASTER_LOG_POS=12345;

-- 方法二：GTID 方式（推荐）
CHANGE MASTER TO
    MASTER_HOST='192.168.1.101',
    MASTER_USER='repl_user',
    MASTER_PASSWORD='repl_password',
    MASTER_USE_GTID=current_pos;

-- 启动复制
START SLAVE;

-- 查看复制状态
SHOW SLAVE STATUS\G
```

---

## GTID（全局事务 ID）

### 什么是 GTID？

GTID 是**全局唯一的事务标识符**，由三部分组成：
- `server_id:sequence_number`
- 例如：`1-1-1234` 表示 server_id=1, domain_id=1, sequence=1234

```
GTID 结构：
┌─────────────────────────────────────────────────────────────┐
│                    GTID = domain_id:server_id:seq_no         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  domain_id:  域 ID，用于区分不同的复制流                     │
│  server_id:  服务器 ID，唯一标识节点                        │
│  seq_no:     序列号，递增的事务编号                         │
│                                                             │
│  示例：                                                     │
│  1-1-100   ← domain=1, server=1, 第100个事务                │
│  1-2-50    ← domain=1, server=2, 第50个事务                │
│  2-1-200   ← domain=2, server=1, 第200个事务               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### GTID 的优势

| 优势 | 说明 |
|------|------|
| **自动定位** | 不需要知道 binlog 位置，GTID 自动定位 |
| **一致性保证** | 事务只执行一次，不会重复执行 |
| **故障转移简单** | 切换时直接指定 GTID，无需 binlog 坐标 |
| **审计方便** | 每个事务有唯一 ID，便于追踪 |

### GTID 配置

```sql
-- 查看 GTID 状态
SHOW VARIABLES LIKE 'gtid%';

-- 查看 GTID 当前状态
SHOW MASTER STATUS;
SHOW SLAVE STATUS;
```

### GTID 复制命令

```sql
-- 启用 GTID 模式
SET GLOBAL gtid_domain_id = 1;

-- 查看已执行的事务
SELECT * FROM mysql.gtid_slave_pos;

-- 跳过错误的事务
SET gtid_slave_pos = '1-1-99';  -- 跳过 1-1-100
SET GLOBAL sql_slave_skip_counter = 1;

-- 故障转移
CHANGE MASTER TO
    MASTER_HOST='new_master_host',
    MASTER_USER='repl_user',
    MASTER_PASSWORD='repl_password',
    MASTER_USE_GTID=current_pos;
```

---

## 复制过滤

### 主库过滤

```ini
# /etc/mysql/mariadb.conf.d/50-server.cnf

[mysqld]
# 只复制指定数据库
binlog_do_db=mydb

# 或排除指定数据库
binlog_ignore_db=mysql
binlog_ignore_db=test
```

### 从库过滤

```sql
-- 只复制指定数据库
CHANGE MASTER TO REPLICATE_DO_DB=mydb;

-- 忽略指定数据库
CHANGE MASTER TO REPLICATE_IGNORE_DB=mysql;

-- 忽略指定表
CHANGE MASTER TO REPLICATE_DO_TABLE=mydb.users;
CHANGE MASTER TO REPLICATE_IGNORE_TABLE=mydb.logs;

-- 正则匹配（MariaDB 特有）
CHANGE MASTER TO REPLICATE_WILD_DO_TABLE='mydb.orders%';
```

### 过滤的最佳实践

```sql
-- 建议：尽量在主库做过滤，从库尽量不过滤
-- 因为从库过滤会导致 relay-log 堆积
-- 而且主从过滤规则不一致容易导致数据不一致

-- 正确做法：
-- 1. 主库使用 binlog_do_db
-- 2. 从库尽量不做过滤
-- 3. 过滤在应用层或中间件实现
```

---

## 并行复制

### MariaDB 并行复制

MariaDB 从 10.0 开始支持**并行复制**，提高复制效率。

```sql
-- 查看并行复制配置
SHOW VARIABLES LIKE 'slave_parallel_threads';
SHOW VARIABLES LIKE 'slave_parallel_mode';

-- 配置并行复制
SET GLOBAL slave_parallel_threads=16;
SET GLOBAL slave_parallel_mode= optimistic;

-- 配置文件永久生效
[mysqld]
slave_parallel_threads=16
slave_parallel_mode=optimistic
```

### 并行复制模式

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `database` | 按数据库并行 | 多数据库场景 |
| `optimistic` | 乐观并发 | 冲突少 |
| `conservative` | 保守并发 | 冲突可能多 |
| `minimal` | 单线程 | 追求一致性 |

```sql
-- 保守模式（推荐）
SET GLOBAL slave_parallel_mode=conservative;

-- 激进模式
SET GLOBAL slave_parallel_mode=optimistic;
```

### Java 监控复制延迟

```java
public class ReplicationMonitor {
    
    public void monitorReplicationLag(Connection conn) throws SQLException {
        String sql = "SHOW SLAVE STATUS";
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            if (rs.next()) {
                String ioRunning = rs.getString("Slave_IO_Running");
                String sqlRunning = rs.getString("Slave_SQL_Running");
                long lagSeconds = rs.getLong("Seconds_Behind_Master");
                String lastError = rs.getString("Last_Error");
                
                System.out.println("IO 线程: " + ioRunning);
                System.out.println("SQL 线程: " + sqlRunning);
                System.out.println("延迟: " + lagSeconds + " 秒");
                
                // 告警条件
                if ("No".equals(ioRunning) || "No".equals(sqlRunning)) {
                    System.out.println("错误：复制线程未运行！");
                    System.out.println("Last Error: " + lastError);
                }
                
                if (lagSeconds > 300) {  // 5 分钟
                    System.out.println("警告：复制延迟超过 5 分钟");
                }
            }
        }
    }
    
    // GTID 模式监控
    public void monitorGTID(Connection conn) throws SQLException {
        String sql = "SHOW SLAVE STATUS";
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            if (rs.next()) {
                String gtidIoPos = rs.getString("Executed_Gtid_Set");
                String gtidMasterPos = rs.getString("Gtid_IO_Position");
                
                System.out.println("已执行 GTID: " + gtidIoPos);
                System.out.println("主库 GTID: " + gtidMasterPos);
                
                // 比较是否一致
                if (gtidIoPos.equals(gtidMasterPos)) {
                    System.out.println("GTID 同步正常");
                } else {
                    System.out.println("警告：GTID 存在差异");
                }
            }
        }
    }
}
```

---

## 常见问题与解决

### 问题一：主从延迟

```sql
-- 查看延迟原因
SHOW SLAVE STATUS\G

-- 常见原因：
-- 1. 从库硬件性能差
-- 2. 网络延迟
-- 3. 大事务执行时间长
-- 4. 从库压力大

-- 解决方案：
-- 1. 升级从库硬件
-- 2. 优化网络
-- 3. 拆大事务为小事务
-- 4. 减少从库查询压力
-- 5. 开启并行复制
SET GLOBAL slave_parallel_threads=16;
```

### 问题二：复制中断

```sql
-- 查看错误
SHOW SLAVE STATUS\G
-- Last_Error: ...

-- 常见错误：
-- 1. 唯一键冲突
-- 2. 数据不存在
-- 3. 网络中断

-- 解决方案：
-- 1. 跳过错误（不推荐，可能丢数据）
SET GLOBAL sql_slave_skip_counter=1;
START SLAVE;

-- 2. GTID 模式跳过
SET gtid_slave_pos='1-1-99';  -- 跳过问题事务
START SLAVE;

-- 3. 重建从库（推荐）
-- 使用 mysqldump 或 XtraBackup
```

### 问题三：GTID 复制失败

```sql
-- GTID 空洞（Gap）
-- 原因：主库 Purge 了从库还没复制到的 binlog

-- 诊断
SELECT * FROM mysql.gtid_slave_pos;
SHOW MASTER STATUS;

-- 解决方案：
-- 1. 确保主库没有频繁 Purge
-- 2. 从库延迟要跟上
-- 3. 如果已经空洞，只能重建从库
```

---

## 半同步复制

### MariaDB 半同步插件

```bash
# 安装半同步插件
INSTALL SONAME ' semisync_master.so';
INSTALL SONAME ' semisync_slave.so';
```

```sql
-- 主库启用半同步
SET GLOBAL rpl_semi_sync_master_enabled = ON;
SET GLOBAL rpl_semi_sync_master_timeout = 10000;  -- 10秒

-- 从库启用半同步
SET GLOBAL rpl_semi_sync_slave_enabled = ON;
STOP SLAVE;
START SLAVE;

-- 查看半同步状态
SHOW STATUS LIKE 'rpl_semi%';
```

### 半同步 vs 全同步 vs 异步

| 模式 | 说明 | 延迟 | 数据安全 |
|------|------|------|----------|
| 异步 | 主库不等从库确认 | 低 | 可能丢数据 |
| 半同步 | 主库等至少一个从库确认 | 中 | 可能丢数据（超时后变异步） |
| 全同步 | 所有从库确认后才提交 | 高 | 不丢数据 |

---

## 面试追问

### 追问一：binlog 的三种格式是什么？

| 格式 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| STATEMENT | 记录 SQL 语句 | binlog 小 | 函数、存储过程可能不一致 |
| ROW | 记录行变化 | 一致性强 | binlog 大 |
| MIXED | 混用 | 平衡 | 可能复杂 |

**MariaDB 推荐使用 ROW 格式**，保证一致性。

### 追问二：主从复制延迟怎么优化？

1. **并行复制**：开启 `slave_parallel_threads`
2. **减少大事务**：拆分为小事务
3. **从库优化**：提升硬件，优化索引
4. **读写分离**：减少从库压力
5. **调整参数**：增加 `slave_net_timeout`

### 追问三：GTID 和传统复制哪个好？

| 维度 | GTID | 传统 |
|------|------|------|
| 配置复杂度 | 简单 | 复杂 |
| 故障转移 | 简单（自动定位） | 复杂（需要 binlog 坐标） |
| 审计追踪 | 强 | 弱 |
| 兼容性 | MariaDB 10.0+ | 所有版本 |
| 性能 | 略低 | 略高 |

**推荐使用 GTID**，现代部署几乎都用 GTID。

---

## 总结

| 要点 | 说明 |
|------|------|
| **复制流程** | binlog → dump → IO → relay-log → SQL |
| **GTID 结构** | domain_id:server_id:sequence_number |
| **GTID 优势** | 自动定位、不重复执行、便于审计 |
| **并行复制** | slave_parallel_threads 提高效率 |
| **半同步** | 主库等待至少一个从库确认 |
| **常见问题** | 延迟、复制中断、GTID 空洞 |

**MariaDB 的主从复制已经非常成熟，GTID 模式是现代部署的首选。**

---

## 下一步

- 想了解读写分离？[MariaDB MaxScale 读写分离中间件](/database/mariadb/maxscale)
- 想了解备份恢复？[MariaDB 备份与恢复：XtraBackup 集成](/database/mariadb/backup)
- 想了解更多集群知识？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
