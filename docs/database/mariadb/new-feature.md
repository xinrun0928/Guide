# MariaDB 新增特性：系统版本表、Galera Cluster、Spider 存储引擎

MySQL 有的功能，MariaDB 都有。

但 MariaDB 有的功能，MySQL 不一定有。

**这就是 MariaDB 的价值所在——在 MySQL 基础上增加的开源特性。**

---

## 系统版本表（System-Versioned Tables）

### 什么是系统版本表？

系统版本表是 MariaDB 10.2.1 引入的功能，**自动保存表的历史数据**，就像一个内置的「时光机」。

```sql
-- 创建一个带版本历史的表
CREATE TABLE accounts (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    balance DECIMAL(15,2),
    status VARCHAR(20) DEFAULT 'active'
) WITH SYSTEM VERSIONING;

-- 插入数据
INSERT INTO accounts VALUES (1, '张三', 1000.00, 'active');

-- 更新数据（自动保存旧版本）
UPDATE accounts SET balance = 1500.00 WHERE id = 1;

-- 再更新
UPDATE accounts SET balance = 2000.00 WHERE id = 1;

-- 查看当前数据
SELECT * FROM accounts;
-- id=1, name=张三, balance=2000.00, status=active

-- 查看历史数据（某个时间点）
SELECT * FROM accounts FOR SYSTEM_TIME AS OF TIMESTAMP '2024-01-01 10:00:00';
-- 返回该时间点的快照

-- 查看所有历史版本
SELECT * FROM accounts FOR SYSTEM_TIME BETWEEN '2024-01-01' AND '2024-01-02';

-- 查看某个时间范围的所有版本
SELECT 
    id, name, balance,
    ROW_START, ROW_END
FROM accounts FOR SYSTEM_TIME ALL
ORDER BY ROW_START;
```

### 历史记录结构

```
时间线：

T1: INSERT (id=1, balance=1000)
    │
T2: UPDATE (balance=1500)
    │   └──► 历史记录：id=1, balance=1000, ROW_START=T1, ROW_END=T2
    │
T3: UPDATE (balance=2000)
        └──► 历史记录：id=1, balance=1500, ROW_START=T2, ROW_END=T3

当前表：id=1, balance=2000
```

### ROW_START 和 ROW_END

这两个隐藏列记录版本的时间范围：

```sql
-- 查看表的完整结构（包括隐藏列）
SHOW CREATE TABLE accounts\G

-- 手动查询版本信息
SELECT 
    id, name, balance,
    ROW_START,
    ROW_END,
    TIMESTAMPDIFF(SECOND, ROW_START, ROW_END) AS version_duration
FROM accounts FOR SYSTEM_TIME ALL;
```

### Java 中的系统版本表

```java
public class SystemVersioningDemo {
    
    public void demonstrateVersioning(Connection conn) throws SQLException {
        // 1. 创建带版本的表
        String createTable = """
            CREATE TABLE IF NOT EXISTS product_prices (
                product_id INT NOT NULL,
                price DECIMAL(10,2) NOT NULL,
                valid_from DATETIME NOT NULL,
                PRIMARY KEY (product_id, valid_from)
            ) WITH SYSTEM VERSIONING
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTable);
        }
        
        // 2. 插入初始价格
        String insert1 = """
            INSERT INTO product_prices (product_id, price, valid_from) 
            VALUES (1, 99.99, '2024-01-01 00:00:00')
            """;
        
        // 3. 更新价格
        String update1 = """
            INSERT INTO product_prices (product_id, price, valid_from) 
            VALUES (1, 89.99, '2024-06-01 00:00:00')
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(insert1);
            stmt.execute(update1);
        }
        
        // 4. 查询某个时间点的价格
        String queryHistory = """
            SELECT * FROM product_prices 
            FOR SYSTEM_TIME AS OF TIMESTAMP '2024-03-15 12:00:00'
            WHERE product_id = 1
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(queryHistory)) {
            if (rs.next()) {
                System.out.println("2024年3月15日的价格: " + rs.getBigDecimal("price"));
            }
        }
    }
    
    // 审计日志应用
    public void auditDemo(Connection conn) throws SQLException {
        // 创建用户表，自动记录所有变更
        String createUserTable = """
            CREATE TABLE IF NOT EXISTS user_audit (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_name VARCHAR(100),
                email VARCHAR(255),
                status VARCHAR(20),
                changed_by VARCHAR(100),
                operation_type VARCHAR(10)
            ) WITH SYSTEM VERSIONING
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createUserTable);
        }
        
        // 插入
        String insert = "INSERT INTO user_audit (user_name, email, status) VALUES ('张三', 'zhang@example.com', 'active')";
        conn.createStatement().execute(insert);
        
        // 更新
        String update = "UPDATE user_audit SET status = 'inactive' WHERE user_name = '张三'";
        conn.createStatement().execute(update);
        
        // 查看变更历史
        String historyQuery = """
            SELECT 
                user_name, email, status,
                ROW_START, ROW_END
            FROM user_audit FOR SYSTEM_TIME ALL
            ORDER BY ROW_START
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(historyQuery)) {
            while (rs.next()) {
                System.out.printf("用户: %s, 状态: %s, 开始: %s, 结束: %s%n",
                    rs.getString("user_name"),
                    rs.getString("status"),
                    rs.getTimestamp("ROW_START"),
                    rs.getTimestamp("ROW_END"));
            }
        }
    }
}
```

### 系统版本表的限制

```sql
-- 不支持的功能
-- 1. 不能有外键
-- 2. 不能是临时表
-- 3. 主键必须包含分区键（如果是分区表）
-- 4. 不支持 MERGE 表

-- 查看历史数据的限制
-- 不能在有系统版本的表上直接执行 DELETE
-- 历史数据需要通过 ALTER TABLE ... REMOVE HISTORY 清理
ALTER TABLE accounts REMOVE HISTORY;
```

---

## Galera Cluster

### 概述

Galera Cluster 是 MariaDB 的**同步多主集群解决方案**，实现真正的多主写入和高可用。

**MySQL 没有内置的同步多主集群——这是 MariaDB 的核心优势之一。**

### Galera Cluster 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Galera Cluster 架构                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │   Node 1    │  │   Node 2    │  │   Node 3    │        │
│   │  (MariaDB)  │◄─┤  (MariaDB)  │◄─┤  (MariaDB)  │        │
│   │     ↑       │  │     ↑       │  │     ↑       │        │
│   │     │       │  │     │       │  │     │       │        │
│   │     └───────┼──┴─────┴───────┼──┴─────┘       │        │
│   │              │               │                 │        │
│   └──────────────┴───────────────┴─────────────────┘        │
│                          │                                  │
│                    ┌─────┴─────┐                          │
│                    │  Galera    │                          │
│                    │  复制层    │                          │
│                    └───────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘

工作原理：
1. 写入任何节点
2. 事务在本地执行
3. 写集合复制到其他节点
4. 所有节点验证通过后，事务提交
```

### Galera vs 传统主从复制

| 特性 | 传统主从复制 | Galera Cluster |
|------|-------------|----------------|
| 复制类型 | 异步 | 同步 |
| 写入节点 | 单主 | 多主 |
| 数据一致性 | 最终一致 | 强一致 |
| 故障切换 | 需要手动/脚本 | 自动 |
| 脑裂风险 | 存在 | 无 |
| 延迟影响 | 主延迟导致从延迟 | 同步等待 |

### 安装配置 Galera Cluster

```bash
# 安装 Galera 包（Ubuntu/Debian）
apt install -y mariadb-server galera-4

# 配置第一个节点 /etc/mysql/mariadb.conf.d/galera.cnf
```

```ini
[mysqld]
# Galera 配置
binlog_format=row
default-storage-engine=InnoDB
innodb_autoinc_lock_mode=2
bind-address=0.0.0.0

# Galera 集群配置
wsrep_on=ON
wsrep_provider=/usr/lib/galera/libgalera_ssm.so
wsrep_cluster_name="my_cluster"
wsrep_cluster_address="gcomm://node1,node2,node3"
wsrep_node_name="node1"
wsrep_node_address="192.168.1.101"

# SST (State Snapshot Transfer)
wsrep_sst_method=rsync
wsrep_sst_auth=root:password

# 避免脑裂
pc.wait_prim_timeout=PT30S
```

```bash
# 启动第一个节点（引导集群）
galera_new_cluster

# 启动其他节点
systemctl start mariadb
```

### Galera 状态查看

```sql
-- 查看集群状态
SHOW STATUS LIKE 'wsrep%';

-- 查看集群成员
SHOW VARIABLES LIKE 'wsrep_cluster_size';
SHOW VARIABLES LIKE 'wsrep_cluster_status';

-- 查看复制延迟
SHOW STATUS LIKE 'wsrep_flow_control_paused%';

-- 典型输出
-- wsrep_cluster_size = 3
-- wsrep_cluster_status = Primary
-- wsrep_connected = ON
-- wsrep_ready = ON
```

### Java 中的 Galera Cluster

```java
public class GaleraClusterDemo {
    
    // 可以连接到任意节点
    private static final String[] NODES = {
        "jdbc:mariadb://node1:3306/mydb",
        "jdbc:mariadb://node2:3306/mydb",
        "jdbc:mariadb://node3:3306/mydb"
    };
    
    public Connection getConnection() throws SQLException {
        // 负载均衡策略：尝试连接第一个可用节点
        for (String url : NODES) {
            try {
                Connection conn = DriverManager.getConnection(url, "user", "password");
                System.out.println("连接到: " + url);
                return conn;
            } catch (SQLException e) {
                System.out.println("节点不可用: " + url + ", 尝试下一个");
            }
        }
        throw new SQLException("所有节点都不可用");
    }
    
    // 故障转移示例
    public void failoverDemo() {
        int maxRetries = 3;
        
        for (int i = 0; i < maxRetries; i++) {
            try (Connection conn = getConnection()) {
                // 执行查询
                String sql = "SELECT * FROM users LIMIT 10";
                ResultSet rs = conn.createStatement().executeQuery(sql);
                // 处理结果
                return;
            } catch (SQLException e) {
                System.out.println("查询失败，尝试重连: " + e.getMessage());
                if (i < maxRetries - 1) {
                    try {
                        Thread.sleep(1000 * (i + 1));  // 指数退避
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                    }
                }
            }
        }
    }
}
```

---

## Spider 存储引擎

### 概述

Spider 是 MariaDB 的**分片存储引擎**，可以让你像访问本地表一样访问远程数据库。

```
┌─────────────────────────────────────────────────────────────┐
│                     Spider 架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   应用服务器                                                │
│       │                                                     │
│       ▼                                                     │
│   ┌─────────────────────────────────────────────────┐       │
│   │              Spider Engine                       │       │
│   │                                                │       │
│   │   SELECT * FROM orders ──────────────────────┐ │       │
│   │                                               │ │       │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐    │ │       │
│   │   │ shard_0 │  │ shard_1 │  │ shard_2 │    │ │       │
│   │   │(server_1)│  │(server_2)│  │(server_3)│   │ │       │
│   │   └─────────┘  └─────────┘  └─────────┘    │ │       │
│   │      │            │            │           │ │       │
│   └──────┼────────────┼────────────┼───────────┘ │       │
│          │            │            │             │       │
│          ▼            ▼            ▼             │       │
│      ┌───────┐   ┌───────┐   ┌───────┐          │       │
│      │Server 1│   │Server 2│   │Server 3│          │       │
│      │(MariaDB)│   │(MariaDB)│   │(MariaDB)│          │       │
│      └───────┘   └───────┘   └───────┘          │       │
│                                                     │       │
└─────────────────────────────────────────────────────┘       │
```

### Spider vs 分库分表中间件

| 特性 | Spider | ShardingSphere/Mycat |
|------|--------|---------------------|
| 部署位置 | 数据库内部 | 独立中间件 |
| SQL 支持 | 原生 SQL | 需要兼容层 |
| 性能开销 | 较低 | 较高 |
| 功能完整性 | 基础分片 | 更完善 |
| 维护成本 | 低 | 高 |
| 使用场景 | 简单分片 | 复杂分片 |

### Spider 配置

```sql
-- 1. 安装 Spider 插件
INSTALL SONAME 'ha_spider';

-- 2. 注册远程服务器
CREATE SERVER shard_server_1
FOREIGN DATA WRAPPER mysql
OPTIONS (
    HOST '192.168.1.101',
    DATABASE 'orders_db',
    USER 'spider_user',
    PASSWORD 'password',
    PORT 3306
);

CREATE SERVER shard_server_2
FOREIGN DATA WRAPPER mysql
OPTIONS (
    HOST '192.168.1.102',
    DATABASE 'orders_db',
    USER 'spider_user',
    PASSWORD 'password',
    PORT 3306
);

-- 3. 创建 Spider 表（分片表）
CREATE TABLE orders (
    id BIGINT NOT NULL,
    customer_id BIGINT,
    total_amount DECIMAL(15,2),
    created_at DATETIME,
    PRIMARY KEY (id)
) ENGINE=Spider
PARTITION BY KEY(id) (
    PARTITION p1 CONNECTION 'shard_server_1',
    PARTITION p2 CONNECTION 'shard_server_2'
);

-- 4. 查看 Spider 状态
SHOW STATUS LIKE 'spider%';
```

### Spider 分片策略

```sql
-- KEY 分片（按主键）
CREATE TABLE t1 (
    id BIGINT PRIMARY KEY,
    data TEXT
) ENGINE=Spider
PARTITION BY KEY(id) (
    PARTITION p1 CONNECTION 'server1',
    PARTITION p2 CONNECTION 'server2',
    PARTITION p3 CONNECTION 'server3',
    PARTITION p4 CONNECTION 'server4'
);

-- HASH 分片
CREATE TABLE t2 (
    id BIGINT PRIMARY KEY,
    data TEXT
) ENGINE=Spider
PARTITION BY HASH(id) (
    PARTITION p1 CONNECTION 'server1',
    PARTITION p2 CONNECTION 'server2'
);

-- LIST 分片
CREATE TABLE t3 (
    region_id INT,
    data TEXT
) ENGINE=Spider
PARTITION BY LIST(region_id) (
    PARTITION p_east CONNECTION 'server_east',
    PARTITION p_west CONNECTION 'server_west',
    PARTITION p_central CONNECTION 'server_central'
);
```

### Java 中的 Spider 表

```java
public class SpiderDemo {
    
    public void useSpiderTable(Connection conn) throws SQLException {
        // Spider 表对应用透明，就像普通表一样使用
        String insert = """
            INSERT INTO orders (id, customer_id, total_amount, created_at) 
            VALUES (?, ?, ?, NOW())
            """;
        
        try (PreparedStatement pstmt = conn.prepareStatement(insert)) {
            for (long i = 1; i <= 1000; i++) {
                pstmt.setLong(1, i);
                pstmt.setLong(2, i % 100);
                pstmt.setBigDecimal(3, new BigDecimal(Math.random() * 1000));
                pstmt.executeUpdate();
            }
        }
        
        // 查询（Spider 会自动路由到正确的分片）
        String select = """
            SELECT customer_id, SUM(total_amount) as total 
            FROM orders 
            GROUP BY customer_id
            ORDER BY total DESC
            LIMIT 10
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(select)) {
            System.out.println("Top 10 消费客户:");
            while (rs.next()) {
                System.out.printf("客户 %d: 总额 %.2f%n",
                    rs.getLong("customer_id"),
                    rs.getBigDecimal("total"));
            }
        }
    }
}
```

---

## 特性对比总结

| 特性 | MySQL | MariaDB | 说明 |
|------|-------|---------|------|
| 系统版本表 | ❌ | ✅ 10.2+ | 自动历史记录 |
| Galera Cluster | ❌ | ✅ 10.1+ | 同步多主集群 |
| Spider 引擎 | ❌ | ✅ 10.0+ | 分片存储 |
| 线程池 | 企业版 | ✅ 开源 | 高并发连接 |
| 窗口函数 | 8.0+ | ✅ 10.2+ | 分析函数 |
| CTEs | 8.0+ | ✅ 10.2+ | 递归查询 |
| 虚拟列 | ❌ | ✅ 5.2+ | 计算列 |
| 序列 | ❌ | ✅ 10.3+ | 自动序列 |

---

## 面试追问

### 追问一：系统版本表和触发器实现的审计日志有什么区别？

| 维度 | 系统版本表 | 触发器审计 |
|------|-----------|-----------|
| 实现复杂度 | 低（一行 SQL） | 高（多个触发器） |
| 性能影响 | 较小 | 较大（每次 DML 都触发） |
| 查询历史 | 内置语法 | 需要自定义查询 |
| 清理历史 | 自动或手动 | 需要手动维护 |
| 存储成本 | 与数据共存 | 可以分离 |

### 追问二：Galera Cluster 的缺点是什么？

1. **写入延迟**：同步复制比异步慢
2. **网络依赖**：网络不稳定时性能下降
3. **DDL 问题**：某些 DDL 可能锁表
4. **存储要求**：所有节点存储相同数据
5. **规模限制**：节点过多时性能下降（建议 ≤ 9 节点）

### 追问三：什么场景下用 Spider 而不是 ShardingSphere？

| 场景 | 推荐 |
|------|------|
| 不想引入中间件 | Spider |
| SQL 兼容性要求高 | Spider |
| 跨数据库分片（MySQL + MariaDB） | Spider |
| 需要完整的分片管理功能 | ShardingSphere |
| 动态扩容 | ShardingSphere |
| 复杂查询优化 | ShardingSphere |

---

## 总结

MariaDB 的三大新增特性：

1. **系统版本表**：内置时光机，自动保存历史数据
2. **Galera Cluster**：真正的同步多主集群
3. **Spider 存储引擎**：分布式分片存储

这些特性在 MySQL 中要么没有，要么需要企业版付费。MariaDB 选择了开源路线，让每个开发者都能用上这些强大的功能。

---

## 下一步

- 想深入了解 Galera Cluster？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
- 想了解 MariaDB 的线程池？[MariaDB 线程池（Thread Pool）插件](/database/mariadb/thread-pool)
- 想了解 MariaDB 的高可用方案？[MariaDB MaxScale 读写分离中间件](/database/mariadb/maxscale)
