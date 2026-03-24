# MariaDB CONNECT 存储引擎：访问多种外部数据源

你的数据分散在 MySQL、PostgreSQL、CSV 文件、Excel、ODBC 数据源……

以前，你需要为每个数据源写独立的导入脚本或者 ETL 流程。

现在，MariaDB 告诉你：「不需要，一个 SQL 就能搞定。」

**CONNECT 存储引擎是 MariaDB 的瑞士军刀——用它可以像查询本地表一样查询几乎任何外部数据源。**

---

## CONNECT 引擎概述

### 什么是 CONNECT 引擎？

CONNECT 引擎是 MariaDB 10.0 引入的虚拟表存储引擎，可以直接访问外部数据源，而无需数据导入导出。

```
┌─────────────────────────────────────────────────────────────┐
│                 CONNECT 引擎架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   应用层                                                    │
│       │                                                    │
│       ▼                                                    │
│   ┌─────────────────────────────────────────────────┐      │
│   │          MariaDB (CONNECT 引擎)                   │      │
│   │                                                 │      │
│   │   CREATE TABLE t1 (...) ENGINE=CONNECT ...      │      │
│   │                                                 │      │
│   │   SELECT * FROM t1;  ◄── 查询虚拟表              │      │
│   │                                                 │      │
│   └─────────────────────────────────────────────────┘      │
│                           │                                │
│        ┌──────────────────┼──────────────────┐            │
│        │                  │                  │            │
│        ▼                  ▼                  ▼            │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐       │
│   │  CSV    │        │  ODBC   │        │  JSON   │       │
│   │  文件   │        │  数据源  │        │  API    │       │
│   └─────────┘        └─────────┘        └─────────┘       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 支持的数据源类型

| 类型 | 说明 | 典型用途 |
|------|------|----------|
| DOS | 固定宽度文本文件 | 遗留数据 |
| FIX | 定长字段文件 | 银行数据 |
| BIN | 二进制文件 | 程序数据 |
| CSV | CSV 格式文件 | Excel 导出数据 |
| FMT | 带格式描述的文本 | 格式化日志 |
| DBF | dBase 数据库文件 | 旧系统数据 |
| ODBC | ODBC 数据源 | SQL Server, Oracle |
| JDBC | JDBC 数据源 | 各类数据库 |
| MYSQL | MySQL/MariaDB | 远程数据库查询 |
| PGSQL | PostgreSQL | 远程数据库查询 |
| PROXY | 其他 CONNECT 表 | 表抽象 |
| VIR | 虚拟表 | 常量表 |
| JSON | JSON 数据 | REST API |
| XML | XML 数据 | SOAP API |
| XCOL | 交叉表 | 动态表 |
| OCCUR | 发生表 | 事件统计 |
| DOSAGE | 年龄计算 | 日期统计 |

---

## 安装 CONNECT 引擎

```sql
-- 安装 CONNECT 引擎
INSTALL SONAME 'ha_connect';

-- 验证安装
SHOW ENGINES;
-- 应该看到 CONNECT 引擎

-- 查看 CONNECT 引擎版本
SHOW VARIABLES LIKE 'connect_type_version';
```

---

## CSV 文件访问

### 创建 CSV 虚拟表

```sql
-- 假设存在 /data/users.csv 文件：
-- id,name,email,age
-- 1,张三,zhang@example.com,25
-- 2,李四,li@example.com,30

CREATE TABLE users_csv (
    id INT NOT NULL,
    name VARCHAR(100),
    email VARCHAR(255),
    age INT
) ENGINE=CONNECT TABLE_TYPE=CSV
FILE_NAME='/data/users.csv'
HEADERS=1
SEPARATOR=','
QUOTE='"';
```

### CSV 表的选项

```sql
-- 更多 CSV 选项
CREATE TABLE logs (
    id INT NOT NULL,
    timestamp DATETIME,
    level VARCHAR(10),
    message TEXT
) ENGINE=CONNECT TABLE_TYPE=CSV
FILE_NAME='/var/log/app.log'
HEADERS=1              -- 第1行是表头
SEPARATOR=';'           -- 分隔符
QUOTE='"'               -- 引号字符
ESCAPE='\\'             -- 转义字符
CHARSET=utf8mb4         -- 字符集
LENGTH=0                -- 忽略长度警告
```

### Java 中处理 CSV 数据

```java
public class CSVTableDemo {
    
    public void queryCSVAsTable(Connection conn) throws SQLException {
        // 创建 CSV 虚拟表
        String createTable = """
            CREATE TABLE IF NOT EXISTS csv_orders (
                order_id INT NOT NULL,
                customer_name VARCHAR(100),
                amount DECIMAL(10,2),
                order_date VARCHAR(20)
            ) ENGINE=CONNECT TABLE_TYPE=CSV
            FILE_NAME='/tmp/orders.csv'
            HEADERS=1
            SEPARATOR=','
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTable);
        }
        
        // 查询 CSV 数据（像普通表一样）
        String select = """
            SELECT order_id, customer_name, amount
            FROM csv_orders
            WHERE amount > 100
            ORDER BY amount DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(select)) {
            while (rs.next()) {
                System.out.printf("订单 %d: %s, 金额 %.2f%n",
                    rs.getInt("order_id"),
                    rs.getString("customer_name"),
                    rs.getBigDecimal("amount"));
            }
        }
    }
    
    // 导出查询结果为 CSV
    public void exportToCSV(Connection conn, String sql, String outputPath) throws SQLException {
        String createExportTable = String.format("""
            CREATE TABLE export_table (
                dummy_col VARCHAR(1)
            ) ENGINE=CONNECT TABLE_TYPE=CSV
            FILE_NAME='%s'
            SEPARATOR=','
            """, outputPath);
        
        try (Statement stmt = conn.createStatement()) {
            // 创建导出表
            stmt.execute(createExportTable);
            
            // 将查询结果写入 CSV（通过 INSERT SELECT）
            String exportSql = String.format(
                "INSERT INTO export_table SELECT ... FROM (%s) AS t", sql);
            // 注意：CONNECT 的 INSERT 导出需要特殊处理
        }
    }
}
```

---

## ODBC 数据源访问

### 配置 ODBC 数据源

```bash
# Linux 安装 ODBC 驱动管理器
apt install unixodbc unixodbc-dev

# 安装 MySQL ODBC 驱动
apt install myodbc

# 配置 /etc/odbc.ini
[sqlserver_dsn]
Description = SQL Server
Driver = ODBC Driver 17 for SQL Server
Server = localhost
Database = mydb
Port = 1433
```

### 创建 ODBC 虚拟表

```sql
-- 创建 ODBC 表
CREATE TABLE remote_users (
    id INT NOT NULL,
    name VARCHAR(100),
    email VARCHAR(255)
) ENGINE=CONNECT TABLE_TYPE=ODBC
CONNECTION='DSN=sqlserver_dsn;UID=username;PWD=password'
TABLE_NAME='users';
```

### ODBC 限制

```sql
-- ODBC 类型的一些限制
-- 1. 不支持某些数据类型
-- 2. 可能需要显式指定列映射
-- 3. 性能取决于 ODBC 驱动质量

-- 使用列定义明确映射
CREATE TABLE odbc_orders (
    id INT NOT NULL,
    order_no VARCHAR(50) NOT NULL,
    amount DOUBLE NOT NULL,
    order_date DATE NOT NULL
) ENGINE=CONNECT TABLE_TYPE=ODBC
CONNECTION='DSN=sap_dsn'
TABLE_NAME='orders'
COLNAME=YES;  -- 使用 ODBC 列名
```

---

## MySQL/MariaDB 远程表

### 创建远程 MySQL 表

```sql
-- 安装远程表支持
INSTALL SONAME 'ha_connect';

-- 直接查询另一个 MySQL/MariaDB 服务器
CREATE TABLE remote_customers (
    id INT NOT NULL,
    name VARCHAR(100),
    email VARCHAR(255),
    registered_at TIMESTAMP
) ENGINE=CONNECT TABLE_TYPE=MYSQL
CONNECTION='mysql://user:password@192.168.1.100:3306/customers_db'
TABLE_NAME='customers'
LOAD_PUSHDOWN=YES;  -- 条件下推
```

### 远程表的特点

```sql
-- 远程表的特性
-- 1. 只读访问（默认）
-- 2. 支持 WHERE 条件下推（LOAD_PUSHDOWN=YES）
-- 3. 可以 JOIN 本地表和远程表

-- 示例：关联本地和远程数据
SELECT 
    l.order_id,
    l.amount,
    r.customer_name,
    r.email
FROM orders l
JOIN remote_customers r ON l.customer_id = r.id
WHERE l.amount > 1000;
```

---

## JSON 数据访问

### 创建 JSON 表

```sql
-- 方式一：JSON 文件
CREATE TABLE api_data (
    id INT NOT NULL,
    data JSON
) ENGINE=CONNECT TABLE_TYPE=JSON
FILE_NAME='/data/api_response.json';

-- 方式二：直接指定 JSON 字符串
CREATE TABLE config_data (
    key_name VARCHAR(100),
    value_text TEXT
) ENGINE=CONNECT TABLE_TYPE=VIR
TABLE_TYPE=JSON
OPTIONS='{"timeout": 30, "retries": 3}';
```

### JSON 表查询

```sql
-- 查询 JSON 表
SELECT 
    JSON_EXTRACT(data, '$.name') as name,
    JSON_EXTRACT(data, '$.age') as age
FROM api_data
WHERE JSON_EXTRACT(data, '$.active') = true;
```

---

## 虚拟表（VIR 类型）

### 创建虚拟表

```sql
-- 创建常量虚拟表
CREATE TABLE weekday_names (
    day_num TINYINT,
    day_name VARCHAR(10)
) ENGINE=CONNECT TABLE_TYPE=VIR
TABLE_TYPE=JSON
OPTIONS='[{"day_num": 1, "day_name": "Monday"}, {"day_num": 2, "day_name": "Tuesday"}]';

-- 查询虚拟表
SELECT * FROM weekday_names;
-- +---------+-----------+
-- | day_num | day_name  |
-- +---------+-----------+
-- |       1 | Monday    |
-- |       2 | Tuesday   |
-- +---------+-----------+
```

---

## 跨数据源 JOIN

### 混合数据源查询

CONNECT 引擎最强大的功能之一是可以在同一个查询中 JOIN 不同数据源：

```sql
-- 场景：合并 CSV、本地表和远程 MySQL 的数据

-- 1. 本地表
CREATE TABLE local_products (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    local_price DECIMAL(10,2)
);

-- 2. CSV 文件
CREATE TABLE csv_discounts (
    product_id INT,
    discount_rate DECIMAL(5,2)
) ENGINE=CONNECT TABLE_TYPE=CSV
FILE_NAME='/data/discounts.csv'
HEADERS=1;

-- 3. 远程 MySQL
CREATE TABLE remote_suppliers (
    supplier_id INT,
    product_id INT,
    supplier_name VARCHAR(100)
) ENGINE=CONNECT TABLE_TYPE=MYSQL
CONNECTION='mysql://user:pass@192.168.1.100:3306/supply_db'
TABLE_NAME='suppliers';

-- 4. 混合查询
SELECT 
    p.id,
    p.name,
    p.local_price,
    c.discount_rate,
    r.supplier_name,
    p.local_price * (1 - COALESCE(c.discount_rate, 0)) AS final_price
FROM local_products p
LEFT JOIN csv_discounts c ON p.id = c.product_id
LEFT JOIN remote_suppliers r ON p.id = r.product_id
WHERE p.local_price > 100;
```

---

## 性能与限制

### 性能考虑

```sql
-- CONNECT 表的性能特点
-- 1. 每次查询都可能访问外部数据源
-- 2. 大数据量时可能很慢
-- 3. 网络表建议添加 WHERE 条件

-- 优化建议
-- 1. 对大文件/远程表添加索引
CREATE INDEX idx_product_id ON csv_discounts(product_id);

-- 2. 使用 LOAD_PUSHDOWN 减少数据传输
CREATE TABLE remote_orders (
    id INT,
    customer_id INT,
    total DECIMAL(10,2)
) ENGINE=CONNECT TABLE_TYPE=MYSQL
CONNECTION='mysql://user:pass@host/db'
TABLE_NAME='orders'
LOAD_PUSHDOWN=YES;  -- 条件下推到远程执行

-- 3. 定期将 CONNECT 表数据导入本地表
CREATE TABLE local_copy AS 
SELECT * FROM remote_customers;
```

### 限制与注意事项

```sql
-- CONNECT 表的限制
-- 1. 通常是只读的
-- 2. 不支持所有 SQL 特性
-- 3. 某些操作可能报错

-- 不支持的操作
-- 1. INSERT/UPDATE/DELETE（大多数类型）
-- 2. 某些聚合查询
-- 3. 子查询可能有限制

-- 解决方案：导入到本地表
CREATE TABLE local_table AS SELECT * FROM connect_table;
```

---

## Java 集成示例

```java
public class ConnectEngineDemo {
    
    public void multiSourceJoin(Connection conn) throws SQLException {
        // 场景：报表需要从多个数据源获取数据
        
        // 1. 创建本地汇总表
        String createLocal = """
            CREATE TABLE IF NOT EXISTS sales_summary (
                date DATE,
                product_id INT,
                total_amount DECIMAL(15,2)
            ) ENGINE=InnoDB
            """;
        
        // 2. 创建 CONNECT 表（外部数据源）
        String createExternal = """
            CREATE TABLE IF NOT EXISTS external_exchange_rates (
                currency VARCHAR(3),
                rate DECIMAL(10,4)
            ) ENGINE=CONNECT TABLE_TYPE=CSV
            FILE_NAME='/data/exchange_rates.csv'
            HEADERS=1
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createLocal);
            stmt.execute(createExternal);
        }
        
        // 3. 混合查询（本地 + 外部）
        String mixedQuery = """
            SELECT 
                s.date,
                s.product_id,
                s.total_amount,
                e.rate,
                s.total_amount * e.rate AS amount_usd
            FROM sales_summary s
            LEFT JOIN external_exchange_rates e ON 'USD' = e.currency
            WHERE s.date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ORDER BY s.date DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(mixedQuery)) {
            while (rs.next()) {
                System.out.printf("%s | 产品 %d | 金额: %.2f | 汇率: %.4f | USD: %.2f%n",
                    rs.getDate("date"),
                    rs.getInt("product_id"),
                    rs.getBigDecimal("total_amount"),
                    rs.getBigDecimal("rate"),
                    rs.getBigDecimal("amount_usd"));
            }
        }
    }
    
    // ETL 辅助：快速导入外部数据
    public void quickImport(Connection conn, String csvPath, String tableName) 
            throws SQLException {
        // 创建临时 CONNECT 表
        String createTemp = String.format("""
            CREATE TABLE temp_import (
                dummy INT
            ) ENGINE=CONNECT TABLE_TYPE=CSV
            FILE_NAME='%s'
            """, csvPath);
        
        // 导入到本地表
        String importSql = String.format("""
            CREATE TABLE %s AS
            SELECT * FROM temp_import
            """, tableName);
        
        String dropTemp = "DROP TABLE temp_import";
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTemp);
            stmt.execute(importSql);
            stmt.execute(dropTemp);
        }
        
        System.out.println("导入完成：" + tableName);
    }
}
```

---

## 面试追问

### 追问一：CONNECT 引擎和 Federated 引擎有什么区别？

| 维度 | CONNECT | Federated |
|------|---------|-----------|
| 数据源 | 多种（CSV, ODBC, JSON...） | 仅 MySQL/MariaDB |
| 查询能力 | 有限 | 更完整 |
| 性能 | 取决于数据源 | 网络依赖 |
| 写入支持 | 部分 | 仅追加 |
| 维护者 | MariaDB | MySQL |

### 追问二：什么时候用 CONNECT，什么时候用 ETL？

| 场景 | 推荐方案 |
|------|----------|
| 偶尔查询一次外部数据 | CONNECT |
| 定期报表（数据量大） | ETL + 本地表 |
| 需要 JOIN 多个数据源 | CONNECT |
| 高频实时查询 | 本地副本 |
| 数据转换复杂 | ETL |

### 追问三：CONNECT 引擎的性能如何优化？

1. **使用 WHERE 条件**：减少读取的数据量
2. **LOAD_PUSHDOWN**：将条件下推到远程执行
3. **定期同步**：将数据导入本地表
4. **添加索引**：CONNECT 表也支持索引
5. **选择合适的表类型**：BIN 比 CSV 快

---

## 总结

| 要点 | 说明 |
|------|------|
| **CONNECT 引擎** | 虚拟表存储引擎，访问外部数据源 |
| **支持类型** | CSV, ODBC, MySQL, JSON, XML 等 |
| **核心价值** | 一个 SQL 查询多个数据源 |
| **使用注意** | 性能取决于数据源，通常只读 |
| **最佳场景** | 数据集成、ETL 辅助、报表混合查询 |

**CONNECT 引擎让 MariaDB 成为了数据集成中心，用一个数据库就能连接你的整个数据世界。**

---

## 下一步

- 想了解更多 MariaDB 高级特性？[MariaDB 虚拟列与序列（Sequence）](/database/mariadb/virtual-column)
- 想了解 MariaDB 的窗口函数？[MariaDB 窗口函数与 CT（Common Table Expression）](/database/mariadb/window-function)
- 想了解 MariaDB 的审计功能？[MariaDB 审计插件与安全增强](/database/mariadb/audit)
