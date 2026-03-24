# MariaDB 存储引擎：InnoDB、Aria、XtraDB、TokuDB

你需要在 MariaDB 中存储三类数据：
- 用户订单（需要事务，高并发）—— 用什么引擎？
- 日志数据（写入量大，不需要事务）—— 用什么引擎？
- 历史报表（需要压缩，占用空间大）—— 用什么引擎？

**MariaDB 支持 10+ 种存储引擎，每个引擎都有它的适用场景。选对引擎，性能可能提升 10 倍。**

---

## 存储引擎概述

### MariaDB 支持的存储引擎

```
┌─────────────────────────────────────────────────────────────┐
│                    MariaDB 存储引擎体系                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐     ┌─────────────┐                       │
│  │   InnoDB    │     │    Aria     │     ┌─────────────┐   │
│  │ (事务型)    │     │ (替代MyISAM)│     │   XtraDB    │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │   TokuDB    │     │  CONNECT    │     │   Cassandra │   │
│  │ (写入密集型) │     │  (虚拟表)   │     │    (NoSQL)  │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                             │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐   │
│  │   MyISAM    │     │   Memory    │     │  ColumnStore│   │
│  │ (兼容性)    │     │  (内存表)   │     │  (分析型)   │   │
│  └─────────────┘     └─────────────┘     └─────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 查看可用的存储引擎

```sql
-- 查看所有存储引擎
SHOW ENGINES;

-- 查看当前默认引擎
SHOW VARIABLES LIKE 'default_storage_engine';

-- 查看表的引擎
SHOW TABLE STATUS FROM database_name;

-- 查看某个表的引擎
SHOW CREATE TABLE table_name;
```

---

## InnoDB 存储引擎

### 概述

InnoDB 是 MariaDB（和 MySQL）的默认事务型存储引擎，提供 ACID 事务支持和行级锁。

**MariaDB 的 InnoDB 实际上是 XtraDB 的延续**，从 MariaDB 10.2 开始使用 Percona XtraDB 作为 InnoDB 的基础。

### InnoDB 核心特性

| 特性 | 说明 |
|------|------|
| 事务支持 | ✅ ACID 完整支持 |
| 行级锁 | ✅ 支持并发更新 |
| 外键约束 | ✅ 支持 |
| MVCC | ✅ 支持 |
| 自动崩溃恢复 | ✅ 基于 redo log |
| 聚簇索引 | ✅ 主键索引 |
| 数据压缩 | ✅ 支持 |

### InnoDB 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      InnoDB 架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                  Buffer Pool                        │   │
│   │   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐    │   │
│   │   │ Page 1 │ │ Page 2 │ │ Page 3 │ │ Page 4 │    │   │
│   │   └────────┘ └────────┘ └────────┘ └────────┘    │   │
│   └─────────────────────────────────────────────────────┘   │
│                         │                                   │
│         ┌───────────────┼───────────────┐                   │
│         ▼               ▼               ▼                   │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐           │
│   │ Redo Log │     │Undo Log  │     │  System  │           │
│   │  (WAL)   │     │          │     │ Tablespace│          │
│   └──────────┘     └──────────┘     └──────────┘           │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │               表空间 (.ibd 文件)                     │   │
│   │   数据页 ──► 索引页 ──► 插入缓冲 ──► 锁信息          │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Java 中使用 InnoDB

```java
public class InnoDBDemo {
    
    public void createInnoDBTable(Connection conn) throws SQLException {
        // 显式指定 InnoDB 引擎
        String sql = """
            CREATE TABLE orders (
                id BIGINT PRIMARY KEY AUTO_INCREMENT,
                customer_id BIGINT NOT NULL,
                total_amount DECIMAL(10, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_customer (customer_id),
                INDEX idx_status (status),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        }
        
        System.out.println("InnoDB 表创建成功");
    }
    
    // 事务示例
    public void transferMoney(Connection conn, long fromId, long toId, BigDecimal amount) 
            throws SQLException {
        
        conn.setAutoCommit(false);
        
        try {
            // 扣款
            String debitSql = "UPDATE accounts SET balance = balance - ? WHERE id = ?";
            try (PreparedStatement pstmt = conn.prepareStatement(debitSql)) {
                pstmt.setBigDecimal(1, amount);
                pstmt.setLong(2, fromId);
                if (pstmt.executeUpdate() == 0) {
                    throw new SQLException("账户不存在: " + fromId);
                }
            }
            
            // 收款
            String creditSql = "UPDATE accounts SET balance = balance + ? WHERE id = ?";
            try (PreparedStatement pstmt = conn.prepareStatement(creditSql)) {
                pstmt.setBigDecimal(1, amount);
                pstmt.setLong(2, toId);
                if (pstmt.executeUpdate() == 0) {
                    throw new SQLException("账户不存在: " + toId);
                }
            }
            
            conn.commit();
            System.out.println("转账成功");
            
        } catch (SQLException e) {
            conn.rollback();
            throw e;
        } finally {
            conn.setAutoCommit(true);
        }
    }
}
```

---

## Aria 存储引擎

### 概述

Aria 是 MariaDB 开发的**崩溃安全的 MyISAM 替代品**，解决了 MyISAM 不支持崩溃安全的最大问题。

### Aria vs MyISAM

| 特性 | MyISAM | Aria |
|------|--------|------|
| 崩溃安全 | ❌ | ✅ |
| 事务支持 | ❌ | ❌ |
| 表级锁 | ✅ | ✅ |
| 全文索引 | ✅ | ✅ |
| 压缩支持 | ✅ | ✅ |
| 内存使用 | 低 | 中等 |
| 读性能 | 高 | 高 |

### Aria 特有功能

```sql
-- 创建 Aria 表
CREATE TABLE logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    level VARCHAR(20),
    message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=Aria;

-- Aria 表修复（崩溃恢复）
REPAIR TABLE logs QUICK;

-- Aria 转换为压缩格式
ALTER TABLE logs ENGINE=Aria ROW_FORMAT=COMPRESSED;
```

### 适用场景

- **日志表**：写入密集，不需要事务
- **历史数据表**：只读或很少修改
- **临时表**：不需要崩溃安全（可以用 MEMORY）
- **只读缓存**：需要快速读取

```java
public class AriaDemo {
    
    public void createLogTable(Connection conn) throws SQLException {
        // 日志表适合使用 Aria
        String sql = """
            CREATE TABLE application_logs (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                level VARCHAR(10) NOT NULL,
                logger VARCHAR(100),
                message TEXT,
                exception TEXT,
                thread_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                KEY idx_level (level),
                KEY idx_created (created_at)
            ) ENGINE=Aria 
            ROW_FORMAT=PAGE 
            DEFAULT CHARSET=utf8mb4
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        }
    }
}
```

---

## XtraDB 存储引擎

### 概述

XtraDB 是 Percona 开发的 **InnoDB 的增强版**，MariaDB 从 10.2 开始将 XtraDB 作为 InnoDB 的基础实现。

### XtraDB 增强特性

| 特性 | 标准 InnoDB | XtraDB |
|------|-------------|--------|
| 页面压缩 | 受限 | 更好的支持 |
| 更改缓冲 | 索引缓冲 | 扩展的更改缓冲 |
| 压缩 InnoDB | 需要特殊编译 | 内置支持 |
| 恢复性能 | 中等 | 更快 |
| 扩展性 | 一般 | 更好 |
| 监控接口 | 基础 | 增强 |

### XtraDB 特有的系统变量

```sql
-- XtraDB 特有的配置
SHOW VARIABLES LIKE 'innodb%';

-- XtraDB 页面压缩
SET GLOBAL innodb_compression_algorithm = 'lz4';

-- XtraDB 更改缓冲大小
SET GLOBAL innodb_change_buffering = 'all';

-- XtraDB 扩展缓冲池
SET GLOBAL innodb_buffer_pool_instances = 8;
```

### 使用场景

XtraDB 对应用透明——你不需要显式指定，MariaDB 默认就使用它：

```java
// 这实际上使用的是 XtraDB
String sql = """
    CREATE TABLE user_sessions (
        session_id VARCHAR(64) PRIMARY KEY,
        user_id BIGINT,
        data JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        INDEX idx_user (user_id),
        INDEX idx_expires (expires_at)
    ) ENGINE=InnoDB
    """;
// MariaDB 内部使用 XtraDB 实现
```

---

## TokuDB 存储引擎

### 概述

TokuDB 使用 **Fractal Tree 索引**，而非传统的 B-Tree，在写入密集型场景下性能显著优于 InnoDB。

### Fractal Tree vs B-Tree

```
B-Tree (InnoDB)：
        ┌───────┐
        │   50   │
       ┌┴───────┴┐
       ▼         ▼
    ┌─────┐   ┌─────┐
    │ 25  │   │ 75  │
    └─────┘   └─────┘
    
    写入：O(log n) 次 I/O（可能需要页分裂）
    读取：O(log n)

Fractal Tree (TokuDB)：
        ┌───────┐
        │   50   │
       ┌┴───────┴┐
       ▼         ▼
    ┌─────┐   ┌─────┐
    │ 25  │   │ 75  │
    │[buf]│   │[buf]│  ← 每个节点有消息缓冲区
    └─────┘   └─────┘
    
    写入：消息在缓冲区异步合并，I/O 次数更少
    读取：O(log n)
    压缩：内置，压缩比高
```

### TokuDB 特性

| 特性 | 说明 |
|------|------|
| Fractal Tree 索引 | 写入优化 |
| 高压缩比 | 通常 5-15x |
| 事务支持 | ✅ |
| MVCC | ✅ |
| 索引覆盖 | ✅ |
| 分区支持 | ✅ |
| 在线 DDL | ✅ |

### TokuDB 配置

```sql
-- TokuDB 需要安装插件
INSTALL SONAME 'ha_tokudb';

-- 创建 TokuDB 表
CREATE TABLE big_data (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_time TIMESTAMP,
    metric_name VARCHAR(100),
    metric_value DOUBLE,
    tags JSON
) ENGINE=TokuDB
ROW_FORMAT=tokuzstd;  -- TokuDB 特有的压缩格式

-- TokuDB 特有的索引
CREATE INDEX idx_time ON big_data(event_time) USING tokudb;
```

### 适用场景

| 场景 | 推荐引擎 | 原因 |
|------|----------|------|
| 高写入量日志 | TokuDB | Fractal Tree 优化写入 |
| 历史数据归档 | TokuDB | 高压缩比 |
| 交易数据 | InnoDB/XtraDB | 事务安全 |
| 只读报表 | Aria/ColumnStore | 读取优化 |

```java
public class TokuDBDemo {
    
    public void createTimeSeriesTable(Connection conn) throws SQLException {
        // 时序数据适合 TokuDB
        String sql = """
            CREATE TABLE metrics (
                id BIGINT AUTO_INCREMENT,
                device_id VARCHAR(64) NOT NULL,
                timestamp DATETIME(3) NOT NULL,
                metric_name VARCHAR(100) NOT NULL,
                metric_value DOUBLE,
                PRIMARY KEY (id),
                UNIQUE KEY uk_device_time (device_id, timestamp, metric_name),
                KEY idx_timestamp (timestamp)
            ) ENGINE=TokuDB
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(sql);
        }
        
        System.out.println("TokuDB 时序表创建成功");
    }
    
    // 批量写入性能测试
    public void benchmarkWrite(Connection conn, int count) throws SQLException {
        conn.setAutoCommit(false);
        
        String sql = "INSERT INTO metrics (device_id, timestamp, metric_name, metric_value) VALUES (?, ?, ?, ?)";
        long start = System.currentTimeMillis();
        
        try (PreparedStatement pstmt = conn.prepareStatement(sql)) {
            for (int i = 0; i < count; i++) {
                pstmt.setString(1, "device_" + (i % 1000));
                pstmt.setTimestamp(2, new Timestamp(System.currentTimeMillis()));
                pstmt.setString(3, "cpu_usage");
                pstmt.setDouble(4, Math.random() * 100);
                pstmt.addBatch();
                
                if (i % 1000 == 0) {
                    pstmt.executeBatch();
                }
            }
            pstmt.executeBatch();
            conn.commit();
        }
        
        long elapsed = System.currentTimeMillis() - start;
        System.out.printf("写入 %d 条数据，耗时 %d ms，速率 %d 条/秒%n", 
            count, elapsed, count * 1000 / elapsed);
    }
}
```

---

## 其他存储引擎

### CONNECT 引擎

创建虚拟表，访问外部数据源：

```sql
-- 安装 CONNECT 引擎
INSTALL SONAME 'ha_connect';

-- 创建 CSV 虚拟表
CREATE TABLE csv_data (
    id INT,
    name VARCHAR(100),
    value DOUBLE
) ENGINE=CONNECT TABLE_TYPE=CSV
FILE_NAME='/tmp/data.csv';

-- 创建 ODBC 虚拟表
CREATE TABLE remote_mysql SELECT * FROM odbc('dsn_name', 'SELECT * FROM users');
```

### ColumnStore 引擎

列式存储，适合分析型查询：

```sql
-- 创建 ColumnStore 表
CREATE TABLE analytics (
    date DATE,
    product_id INT,
    category VARCHAR(50),
    revenue DECIMAL(12,2),
    quantity INT
) ENGINE=ColumnStore;
```

### MEMORY 引擎

内存表，极速访问：

```sql
-- 创建内存表
CREATE TABLE session_cache (
    session_id VARCHAR(64) PRIMARY KEY,
    user_id BIGINT,
    data JSON,
    expires_at TIMESTAMP
) ENGINE=MEMORY;

-- 注意：服务器重启数据会丢失
```

---

## 存储引擎选择指南

### 选择决策树

```
需要事务支持吗？
        │
    ┌───┴───┐
    │       │
   是       否
    │       │
    ▼       ▼
高并发写入？  需要崩溃安全？
    │       │
  ┌─┴─┐   ┌─┴─┐
  │   │   │   │
 是   否  是   否
  │   │   │   │
  ▼   ▼   ▼   ▼
TokuDB  InnoDB Aria  MyISAM
```

### 场景推荐

| 场景 | 推荐引擎 | 替代方案 |
|------|----------|----------|
| 普通业务表 | InnoDB | - |
| 高写入日志 | Aria | TokuDB |
| 时序数据 | TokuDB | ColumnStore |
| 历史归档 | TokuDB | Aria |
| 分析报表 | ColumnStore | InnoDB |
| 缓存表 | MEMORY | Redis |
| 外部数据 | CONNECT | - |
| 只读配置 | Aria | - |

---

## 面试追问

### 追问一：InnoDB 和 MyISAM 的核心区别是什么？

| 维度 | InnoDB | MyISAM |
|------|--------|--------|
| 事务 | ✅ 支持 | ❌ 不支持 |
| 锁粒度 | 行级锁 | 表级锁 |
| 崩溃恢复 | 自动 | 需要手动修复 |
| 外键 | ✅ 支持 | ❌ 不支持 |
| 并发写入 | 好 | 差 |
| 全文索引 | ✅ | ✅ (更早支持) |
| 索引缓存 | 独立缓冲池 | 键缓存 |

### 追问二：为什么 MariaDB 用 Aria 替代 MyISAM？

MyISAM 最大的问题是**不支持崩溃安全**——如果写入时数据库崩溃，数据可能损坏。

Aria 解决了这个问题：
- 使用日志（WAL）保证崩溃安全
- 事务性修复
- 保持 MyISAM 的高性能

### 追问三：TokuDB 的 Fractal Tree 为什么写入更快？

传统 B-Tree 在写入时可能需要：
1. 查找插入位置
2. 如果页面满了，需要页分裂
3. 可能触发级联分裂

Fractal Tree 使用消息缓冲区：
1. 写入先进入缓冲区
2. 缓冲区异步刷新到磁盘
3. 大量随机写入可以合并成顺序写入

结果：**写入 I/O 次数大幅减少**。

---

## 总结

| 引擎 | 事务 | 锁 | 崩溃安全 | 写入性能 | 适用场景 |
|------|------|-----|----------|----------|----------|
| InnoDB/XtraDB | ✅ | 行级 | ✅ | 好 | 业务表（默认） |
| Aria | ❌ | 表级 | ✅ | 好 | 日志、只读表 |
| TokuDB | ✅ | 行级 | ✅ | 极好 | 时序数据、大数据 |
| MyISAM | ❌ | 表级 | ❌ | 好 | 临时/过渡表 |
| MEMORY | ❌ | 表级 | ❌ | 最快 | 缓存 |
| ColumnStore | ✅ | 列级 | ✅ | 读优化 | 分析报表 |

**核心原则**：
- 普通业务用 InnoDB（MariaDB 默认）
- 写入密集型用 TokuDB
- 只读/归档用 Aria
- 分析型用 ColumnStore
- 临时缓存用 MEMORY

---

## 下一步

- 想了解 MariaDB 的新特性？[MariaDB 新增特性：系统版本表、Galera Cluster、Spider 存储引擎](/database/mariadb/new-feature)
- 想了解 MariaDB 的集群方案？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
- 想了解 MariaDB 的线程池？[MariaDB 线程池（Thread Pool）插件](/database/mariadb/thread-pool)
