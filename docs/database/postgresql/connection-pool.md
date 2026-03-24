# PostgreSQL 连接池：PgBouncer vs Pgpool-II

PostgreSQL 每个连接对应一个进程。

1000 个并发连接 = 1000 个进程。

服务器要炸了。

怎么办？连接池。

今天，我们来聊聊 PostgreSQL 的连接池方案。

## 连接池基础

### PostgreSQL 的连接模型

```
普通连接（无连接池）：

┌─────────────────────────────────────────────────────┐
│                 PostgreSQL Server                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ Process 1 (PID 1234) - 处理连接 1             │  │
│  │ Process 2 (PID 1235) - 处理连接 2             │  │
│  │ Process 3 (PID 1236) - 处理连接 3             │  │
│  │ ...                                           │  │
│  │ Process 1000 (PID 2233) - 处理连接 1000       │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  问题：每个进程占用 ~5-10MB 内存                     │
│  1000 连接 = 5-10GB 内存开销！                       │
└─────────────────────────────────────────────────────┘

使用连接池：

┌─────────────────────────────────────────────────────┐
│                 PostgreSQL Server                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ Process 1 (PID 1234) - 处理连接 1             │  │
│  │ Process 2 (PID 1235) - 处理连接 2             │  │
│  │ Process 3 (PID 1236) - 处理连接 3             │  │
│  │ Process 50 (PID 1237) - 处理连接 50          │  │
│  └──────────────────────────────────────────────┘  │
│                                                      │
│  1000 个应用连接 → 只有 50 个真实 PostgreSQL 连接    │
└─────────────────────────────────────────────────────┘
```

### 连接池的作用

1. **减少连接数**：复用连接，减少进程数
2. **降低资源消耗**：减少内存和 CPU 开销
3. **提升性能**：连接复用，避免频繁建立连接的开销
4. **限流保护**：控制最大连接数，保护数据库

## PgBouncer

### 特点

- 轻量级：用 C 语言编写
- 支持三种池化模式：会话级、事务级、语句级
- 配置简单，性能极高
- 不支持读写分离、查询缓存

### 安装与配置

```bash
# 安装
apt install pgbouncer
# 或
brew install pgbouncer
```

```ini
# pgbouncer.ini

[databases]
mydb = host=127.0.0.1 port=5432 dbname=mydb

[pgbouncer]
listen_addr = 127.0.0.1
listen_port = 6432
auth_type = md5
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
max_client_conn = 1000
default_pool_size = 50
reserve_pool_size = 10
reserve_pool_timeout = 5
server_idle_timeout = 600
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
```

### 池化模式

```ini
# 会话级模式（Session pooling）
pool_mode = session
-- 客户端连接后占用一个连接
-- 事务结束时释放
-- 适用于需要使用 SET、PREPARE 等会话级特性

# 事务级模式（Transaction pooling）
pool_mode = transaction
-- 事务开始获取连接，事务结束释放
-- 更高效，但有限制
-- 不能使用：SET、PREPARE、会话级函数

# 语句级模式（Statement pooling）
pool_mode = statement
-- 每个语句后释放连接
-- 最高效，但限制最多
-- 不支持多语句事务
```

### 事务级模式的限制

```sql
-- 在事务级模式下，以下操作不可用：

-- 1. SET 命令
SET work_mem = '256MB';  -- 不会生效

-- 2. PREPARE
PREPARE myplan AS SELECT * FROM users WHERE id = $1;  -- 不可用

-- 3. 会话级函数
SELECT set_config('work_mem', '256MB', false);  -- 不生效

-- 4. LISTEN/NOTIFY
LISTEN my_channel;  -- 断开后不再接收通知
```

### Java 配置

```java
// 使用 PgBouncer
String url = "jdbc:postgresql://127.0.0.1:6432/mydb";
// 代替原来的
// String url = "jdbc:postgresql://127.0.0.1:5432/mydb";
```

### 监控命令

```bash
# 连接 PgBouncer 管理界面
psql -h 127.0.0.1 -p 6432 pgbouncer

# 查看统计
SHOW STATS;

# 查看池信息
SHOW POOLS;

# 查看客户端
SHOW CLIENTS;

# 查看服务器
SHOW SERVERS;

# 查看配置
SHOW CONFIG;

# 查看版本
SHOW VERSION;
```

## Pgpool-II

### 特点

- 功能丰富：连接池 + 负载均衡 + 缓存 + HA
- 支持 PostgreSQL 主从复制
- 支持自动故障转移
- 配置复杂，资源消耗较高

### 安装与配置

```bash
# 安装
apt install pgpool2
# 或
brew install pgpool2
```

```ini
# pgpool.conf

# 连接池配置
listen_addresses = '*'
port = 9999
socket_dir = '/var/run/pgpool'
backend_hostname0 = 'primary_host'
backend_port0 = 5432
backend_weight0 = 1
backend_hostname1 = 'standby_host'
backend_port1 = 5432
backend_weight1 = 1

# 负载均衡
load_balance_mode = on

# 连接池
num_init_children = 100
max_pool = 25

# 健康检查
health_check_period = 5
health_check_timeout = 20
health_check_user = 'pgpool'
health_check_password = 'password'

# 自动故障转移
failover_command = '/etc/pgpool/failover.sh %H'
```

### 负载均衡

```ini
# 启用负载均衡
load_balance_mode = on

# 读写分离权重
backend_weight0 = 1  # 主库权重（写）
backend_weight1 = 3  # 从库权重（读）
```

```sql
-- SELECT 会自动分发到从库
SELECT * FROM users;  -- -> standby_host

-- INSERT/UPDATE/DELETE 发送到主库
INSERT INTO users ...;  -- -> primary_host
```

### 缓存功能

```ini
# 启用查询缓存
enable_query_cache = on

# 缓存表配置
cache_table = 'products'
cache_table = 'categories'
```

### PgBouncer vs Pgpool-II

| 特性 | PgBouncer | Pgpool-II |
|------|-----------|-----------|
| 资源消耗 | 极低 | 较高 |
| 连接池模式 | 3 种 | 1 种（会话级） |
| 负载均衡 | 不支持 | 支持 |
| 查询缓存 | 不支持 | 支持 |
| 故障转移 | 不支持 | 支持 |
| 复杂度 | 简单 | 复杂 |
| 性能 | 极高 | 中等 |
| 适用场景 | 纯连接池 | 连接池 + HA |

## 选择建议

### 选择 PgBouncer 的场景

```
✅ 只需要连接池
✅ 高并发短连接
✅ 资源有限
✅ 追求高性能
✅ 已有其他 HA 方案（Patroni + etcd）
```

### 选择 Pgpool-II 的场景

```
✅ 需要读写分离
✅ 需要查询缓存
✅ 需要自动故障转移
✅ 不想部署额外组件
✅ 小型项目，简化架构
```

### 不使用连接池的场景

```
✅ 少量长连接应用
✅ 连接数可控（< 100）
✅ 有应用层连接池（HikariCP、Druid）
```

## Java 应用最佳实践

### HikariCP 配置

```java
@Configuration
public class DataSourceConfig {
    
    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        
        // 连接 PgBouncer
        config.setJdbcUrl("jdbc:postgresql://127.0.0.1:6432/mydb");
        config.setUsername("user");
        config.setPassword("password");
        
        // 连接池大小（总连接数）
        config.setMaximumPoolSize(50);
        config.setMinimumIdle(10);
        
        // 连接超时
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);
        config.setMaxLifetime(1800000);
        
        // 性能优化
        config.addDataSourceProperty("cachePrepStmts", "true");
        config.addDataSourceProperty("prepStmtCacheSize", "250");
        config.addDataSourceProperty("prepStmtCacheSqlLimit", "2048");
        
        // 心跳检测
        config.setKeepaliveTime(30000);
        
        return new HikariDataSource(config);
    }
}
```

### 多数据源配置（读写分离）

```java
@Configuration
public class RoutingConfig {
    
    @Bean
    @Primary
    public DataSource writeDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://primary:5432/mydb");
        config.setUsername("user");
        config.setPassword("password");
        config.setMaximumPoolSize(20);
        return new HikariDataSource(config);
    }
    
    @Bean
    public DataSource readDataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://replica:5432/mydb");
        config.setUsername("user");
        config.setPassword("password");
        config.setMaximumPoolSize(30);
        return new HikariDataSource(config);
    }
}
```

## 监控与调优

### PgBouncer 监控

```sql
-- 连接管理界面
psql -h 127.0.0.1 -p 6432 pgbouncer

-- 查看等待连接的客户端
SHOW LISTS;
-- 输出：Clients, Servers, Free clients, Free servers, etc.

-- 查看连接等待时间
SHOW STATS;
-- avg_wait_time: 平均等待时间
-- avg_active_connections: 平均活动连接数
```

### Pgpool-II 监控

```bash
# 查看节点状态
pcp_node_info -h localhost -p 9898 -n 0

# 查看连接数
pcp_proc_count -h localhost -p 9898

# 查看负载
show pool_nodes;
```

## 面试高频问题

### Q1: PostgreSQL 为什么需要连接池？

**考察点**：架构理解

**参考答案**：
- PostgreSQL 是进程模型，每个连接一个进程
- 每个进程占用 5-10MB 内存
- 大量连接会耗尽内存和 CPU
- 连接池复用连接，减少资源消耗

### Q2: PgBouncer 和 Pgpool-II 的区别？

**考察点**：工具选型

**参考答案**：
- PgBouncer：轻量级纯连接池，性能高，功能少
- Pgpool-II：连接池 + 负载均衡 + 缓存 + HA，功能全但复杂

### Q3: 事务级连接池有什么限制？

**考察点**：工程实践

**参考答案**：
1. 不能使用 SET 命令
2. 不能使用 PREPARE
3. 不能使用会话级函数
4. 不能使用 LISTEN/NOTIFY
5. 长事务会占用连接

### Q4: 如何选择连接池大小？

**考察点**：性能调优

**参考答案**：
1. 考虑 PostgreSQL 的 `max_connections`
2. 考虑应用的并发需求
3. 考虑服务器资源
4. 建议：连接池大小 = CPU 核心数 * 2 + 磁盘数

## 总结

| 方案 | 特点 | 适用场景 |
|------|------|---------|
| 无连接池 | 简单，适合少量连接 | < 50 连接 |
| PgBouncer | 轻量高性能 | 高并发，纯连接池 |
| Pgpool-II | 功能丰富 | 读写分离 + HA |
| 应用层连接池 | 灵活可控 | 所有场景（推荐） |

最佳实践：
- 应用层 HikariCP/Druid 做第一层连接池
- PgBouncer 做第二层连接池
- 根据场景选择合适的池化模式
