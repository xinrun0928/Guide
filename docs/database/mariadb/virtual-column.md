# MariaDB 虚拟列与序列（Sequence）

你需要在一个查询中频繁计算：`total_price = price * quantity - discount`

以前，你会在 Java 代码里算，或者建个视图。

现在，MariaDB 告诉你：「直接在表里定义一个计算列就行了。」

**虚拟列让 MariaDB 拥有了「计算字段」的能力，而序列则解决了「自增 ID 上限」的焦虑。**

---

## 虚拟列（Generated Columns）

### 什么是虚拟列？

虚拟列是表中由表达式计算得出的列，值不存储在磁盘上（除非指定为STORED）。

```sql
-- 创建带虚拟列的表
CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    unit_price DECIMAL(10, 2) NOT NULL,
    quantity INT NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    
    -- 虚拟列：计算总价（不存储）
    total_price DECIMAL(10, 2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    
    -- 虚拟列：计算最终价（存储）
    final_price DECIMAL(10, 2) GENERATED ALWAYS AS (unit_price * quantity - discount) VIRTUAL
);

-- 插入数据
INSERT INTO orders (unit_price, quantity, discount) VALUES (99.99, 2, 5.00);
INSERT INTO orders (unit_price, quantity) VALUES (49.99, 3);

-- 查询时自动计算
SELECT id, unit_price, quantity, discount, total_price, final_price FROM orders;
-- id=1, unit_price=99.99, quantity=2, discount=5.00, total_price=199.98, final_price=194.98
```

### VIRTUAL vs STORED

| 类型 | 存储方式 | 写入性能 | 读取性能 | 索引支持 |
|------|----------|----------|----------|----------|
| VIRTUAL | 不存储 | 快 | 每次计算 | 不支持 |
| STORED | 写入时计算存储 | 慢（写入时计算） | 快（直接读取） | 支持 |

```sql
-- VIRTUAL 虚拟列
-- - 不占用磁盘空间
-- - 读取时实时计算
-- - 不能建索引
-- - 适合简单计算

-- STORED 虚拟列
-- - 占用磁盘空间
-- - 写入时计算存储
-- - 可以建索引
-- - 适合复杂计算或需要索引的场景
```

### 虚拟列的应用场景

#### 1. 数据验证

```sql
-- 验证数据合法性
CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    email VARCHAR(255) NOT NULL,
    domain VARCHAR(100) GENERATED ALWAYS AS (SUBSTRING_INDEX(email, '@', -1)) STORED,
    
    -- 验证邮箱域名
    is_corporate BOOLEAN GENERATED ALWAYS AS (domain IN ('company.com', 'corp.com')) VIRTUAL
);

-- 查询公司邮箱用户
SELECT * FROM users WHERE is_corporate = TRUE;
```

#### 2. 复杂计算预存

```sql
-- 订单表：预存计算结果
CREATE TABLE order_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT,
    unit_price DECIMAL(10, 2),
    quantity INT,
    tax_rate DECIMAL(5, 4) DEFAULT 0.07,
    
    -- 小计（存储）
    subtotal DECIMAL(10, 2) GENERATED ALWAYS AS (unit_price * quantity) STORED,
    
    -- 税额（存储）
    tax DECIMAL(10, 2) GENERATED ALWAYS AS (subtotal * tax_rate) STORED,
    
    -- 总价（存储）
    total DECIMAL(10, 2) GENERATED ALWAYS AS (subtotal + tax) STORED
);

-- 直接查询总价，不需要再计算
SELECT id, subtotal, tax, total FROM order_items;
```

#### 3. 索引优化

```sql
-- 为计算结果建索引
CREATE TABLE logs (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    created_at DATETIME,
    level VARCHAR(10),
    message TEXT,
    
    -- 提取小时（存储）
    hour INT GENERATED ALWAYS AS (HOUR(created_at)) STORED,
    
    -- 索引
    INDEX idx_hour_level (hour, level)
);

-- 高效查询某小时某级别的日志
SELECT * FROM logs WHERE hour = 14 AND level = 'ERROR';
```

#### 4. JSON 数据提取

```sql
-- 从 JSON 字段提取值
CREATE TABLE api_responses (
    id INT PRIMARY KEY AUTO_INCREMENT,
    response_data JSON,
    
    -- 提取 JSON 中的字段
    user_id BIGINT GENERATED ALWAYS AS (response_data->>'$.user.id') STORED,
    user_name VARCHAR(100) GENERATED ALWAYS AS (response_data->>'$.user.name') STORED,
    status VARCHAR(20) GENERATED ALWAYS AS (response_data->>'$.status') STORED
);

-- 按状态查询
SELECT * FROM api_responses WHERE status = 'success';
```

### Java 中使用虚拟列

```java
public class VirtualColumnDemo {
    
    public void createTableWithVirtualColumns(Connection conn) throws SQLException {
        String createTable = """
            CREATE TABLE IF NOT EXISTS products (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name VARCHAR(100) NOT NULL,
                base_price DECIMAL(10, 2) NOT NULL,
                category VARCHAR(50),
                
                -- 普通列：折扣率
                discount_rate DECIMAL(5, 4) DEFAULT 0,
                
                -- 虚拟列：折扣金额
                discount_amount DECIMAL(10, 2) 
                    GENERATED ALWAYS AS (base_price * discount_rate) VIRTUAL,
                
                -- 存储列：折后价
                final_price DECIMAL(10, 2) 
                    GENERATED ALWAYS AS (base_price - (base_price * discount_rate)) STORED,
                
                -- 索引（只能对 STORED 列建索引）
                INDEX idx_final_price (final_price)
            ) ENGINE=InnoDB
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createTable);
        }
    }
    
    // 使用虚拟列查询
    public void queryWithVirtualColumns(Connection conn) throws SQLException {
        // 插入数据
        String insert = """
            INSERT INTO products (name, base_price, category, discount_rate)
            VALUES 
                ('手机', 2999.00, '电子产品', 0.10),
                ('电脑', 5999.00, '电子产品', 0.15),
                ('T恤', 199.00, '服装', 0.30)
            """;
        
        conn.createStatement().execute(insert);
        
        // 查询（虚拟列自动计算）
        String select = """
            SELECT 
                id,
                name,
                base_price,
                discount_rate,
                discount_amount,  -- 虚拟列
                final_price,       -- 存储列
                ROUND(discount_rate * 100) AS discount_percent
            FROM products
            ORDER BY final_price DESC
            """;
        
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(select)) {
            System.out.println("产品列表：");
            System.out.println("=".repeat(80));
            while (rs.next()) {
                System.out.printf("%s: 原价 %.2f, 折扣 %d%%, 折后价 %.2f%n",
                    rs.getString("name"),
                    rs.getBigDecimal("base_price"),
                    rs.getInt("discount_percent"),
                    rs.getBigDecimal("final_price"));
            }
        }
    }
    
    // 利用索引查询
    public void indexedQuery(Connection conn) throws SQLException {
        // 查询 2000-4000 价格区间的产品
        String sql = """
            SELECT id, name, final_price
            FROM products
            WHERE final_price BETWEEN 2000 AND 4000
            ORDER BY final_price
            """;
        
        // 这个查询会利用 idx_final_price 索引
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(sql)) {
            while (rs.next()) {
                System.out.printf("产品: %s, 价格: %.2f%n",
                    rs.getString("name"),
                    rs.getBigDecimal("final_price"));
            }
        }
    }
}
```

---

## 序列（Sequence）

### 什么是序列？

序列是一种生成连续整数值的数据库对象，解决了 AUTO_INCREMENT 的一些限制。

```sql
-- MariaDB 10.3+ 支持序列

-- 创建序列
CREATE SEQUENCE IF NOT EXISTS order_seq
START WITH 1000
INCREMENT BY 1
MINVALUE 1000
MAXVALUE 999999999
CACHE 100;

-- 使用序列
SELECT NEXT VALUE FOR order_seq;  -- 返回 1000
SELECT NEXT VALUE FOR order_seq;  -- 返回 1001
SELECT NEXT VALUE FOR order_seq;  -- 返回 1002

-- 在 INSERT 中使用
INSERT INTO orders (order_no, amount)
VALUES (CONCAT('ORD-', NEXT VALUE FOR order_seq), 199.99);
```

### 序列 vs AUTO_INCREMENT

| 特性 | AUTO_INCREMENT | 序列 |
|------|----------------|------|
| 范围控制 | 有限 | 完整（MIN/MAX） |
| 循环 | 不支持 | 支持（CYCLE） |
| 预分配 | 自动 | 可配置（CACHE） |
| 多表共享 | 不能 | 可以 |
| 手动设置 | 受限 | 完全支持 |
| 事务内 | 不可回滚 | 可回滚 |
| 间隙处理 | 自动补 | 可控制 |

### 序列的应用场景

#### 1. 多表共享序列

```sql
-- 创建共享序列
CREATE SEQUENCE global_id_seq;

-- 表1使用序列
CREATE TABLE customers (
    customer_id INT PRIMARY KEY DEFAULT (NEXT VALUE FOR global_id_seq),
    name VARCHAR(100)
);

-- 表2使用同一序列
CREATE TABLE orders (
    order_id INT PRIMARY KEY DEFAULT (NEXT VALUE FOR global_id_seq),
    customer_id INT,
    amount DECIMAL(10, 2)
);

-- 表3使用同一序列
CREATE TABLE products (
    product_id INT PRIMARY KEY DEFAULT (NEXT VALUE FOR global_id_seq),
    name VARCHAR(100)
);
```

#### 2. 自定义步长和方向

```sql
-- 负数序列（倒序）
CREATE SEQUENCE reverse_seq
START WITH 100
INCREMENT BY -1
MINVALUE 1
MAXVALUE 100;

SELECT NEXT VALUE FOR reverse_seq;  -- 100
SELECT NEXT VALUE FOR reverse_seq;  -- 99
SELECT NEXT VALUE FOR reverse_seq;  -- 98

-- 大步长序列
CREATE SEQUENCE batch_seq
START WITH 0
INCREMENT BY 1000;

SELECT NEXT VALUE FOR batch_seq;  -- 0
SELECT NEXT VALUE FOR batch_seq;  -- 1000
SELECT NEXT VALUE FOR batch_seq;  -- 2000
```

#### 3. 循环序列

```sql
-- 创建循环序列（用于批次号）
CREATE SEQUENCE cycle_seq
START WITH 1
INCREMENT BY 1
MINVALUE 1
MAXVALUE 100
CYCLE  -- 到达最大值后循环回 MINVALUE
CACHE 20;

-- 模拟批次处理
SELECT NEXT VALUE FOR cycle_seq AS batch_no;
-- 1, 2, 3, ... 100, 1, 2, ...
```

#### 4. 生成序列值

```sql
-- 生成 1-10 的序列
SELECT seq FROM seq_1_to_10;

-- 生成日期序列
SELECT DATE('2024-01-01') + INTERVAL seq DAY AS date_value
FROM seq_0_to_364;

-- 生成时间点序列（每小时）
SELECT DATE_FORMAT(DATE_ADD('2024-01-01 00:00:00', INTERVAL seq HOUR), '%Y-%m-%d %H:00:00') AS hour_value
FROM seq_0_to_23;
```

### Java 中使用序列

```java
public class SequenceDemo {
    
    public void useSequence(Connection conn) throws SQLException {
        // 创建序列
        String createSeq = """
            CREATE SEQUENCE IF NOT EXISTS order_id_seq
            START WITH 1
            INCREMENT BY 1
            MINVALUE 1
            MAXVALUE 999999999
            CACHE 100
            """;
        
        // 创建表使用序列
        String createTable = """
            CREATE TABLE IF NOT EXISTS orders (
                order_id INT PRIMARY KEY DEFAULT (NEXT VALUE FOR order_id_seq),
                customer_name VARCHAR(100),
                amount DECIMAL(10, 2),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
            """;
        
        try (Statement stmt = conn.createStatement()) {
            stmt.execute(createSeq);
            stmt.execute(createTable);
        }
        
        // 插入订单
        String insert = """
            INSERT INTO orders (customer_name, amount)
            VALUES ('张三', 199.99), ('李四', 299.99)
            """;
        conn.createStatement().execute(insert);
        
        // 查询订单
        String select = "SELECT order_id, customer_name, amount FROM orders";
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(select)) {
            System.out.println("订单列表：");
            while (rs.next()) {
                System.out.printf("订单号: %d, 客户: %s, 金额: %.2f%n",
                    rs.getInt("order_id"),
                    rs.getString("customer_name"),
                    rs.getBigDecimal("amount"));
            }
        }
    }
    
    // 获取序列当前值
    public void getSequenceValue(Connection conn) throws SQLException {
        String getCurrent = "SELECT LAST_VALUE(order_id_seq) AS current_value FROM DUAL";
        try (Statement stmt = conn.createStatement();
             ResultSet rs = stmt.executeQuery(getCurrent)) {
            if (rs.next()) {
                System.out.println("序列当前值: " + rs.getLong("current_value"));
            }
        }
    }
    
    // 重置序列
    public void resetSequence(Connection conn, long newValue) throws SQLException {
        String alterSeq = String.format(
            "ALTER SEQUENCE order_id_seq RESTART WITH %d", newValue);
        conn.createStatement().execute(alterSeq);
    }
}
```

---

## 虚拟列与序列的组合应用

### 高级示例：订单编号

```sql
-- 组合使用：自定义订单编号
CREATE SEQUENCE IF NOT EXISTS daily_order_seq
START WITH 1
INCREMENT BY 1
MINVALUE 1
MAXVALUE 99999;

CREATE TABLE orders (
    id INT PRIMARY KEY AUTO_INCREMENT,
    order_date DATE DEFAULT (CURRENT_DATE),
    
    -- 序列值
    seq_value INT DEFAULT (NEXT VALUE FOR daily_order_seq),
    
    -- 虚拟列：完整订单号（YYYYMMDD-序列）
    order_no VARCHAR(20) 
        GENERATED ALWAYS AS (
            CONCAT(
                DATE_FORMAT(order_date, '%Y%m%d'),
                '-',
                LPAD(CAST(seq_value AS CHAR), 5, '0')
            )
        ) STORED,
    
    customer_id INT,
    amount DECIMAL(10, 2),
    
    UNIQUE INDEX idx_order_no (order_no)
);

-- 插入数据
INSERT INTO orders (customer_id, amount) VALUES (1, 199.99);
INSERT INTO orders (customer_id, amount) VALUES (2, 299.99);

-- 查询结果
SELECT order_no, customer_id, amount FROM orders;
-- 20240115-00001, 1, 199.99
-- 20240115-00002, 2, 299.99
```

---

## 面试追问

### 追问一：虚拟列和普通列+视图有什么区别？

| 维度 | 虚拟列 | 普通列 | 视图 |
|------|--------|--------|------|
| 存储 | 可选 | 存储 | 不存储 |
| 索引 | 仅 STORED | ✅ | ❌ |
| 查询 | 自动计算 | 直接读取 | 需要 JOIN |
| 约束 | 可以添加约束 | 可以 | 不能 |
| 更新 | 自动同步 | 需要手动 | 不适用 |

### 追问二：序列的 CACHE 有什么作用？

CACHE 用于预分配序列值，提高性能：
- CACHE 100：一次性分配 100 个值到内存
- 减少序列生成的开销
- 注意：如果数据库崩溃，未使用的缓存值会丢失
- 生产环境建议 CACHE 1000+ 但要接受可能跳号

### 追问三：序列号用完了会怎样？

```sql
-- 序列达到 MAXVALUE 后
-- 如果没有 CYCLE：报错 "sequence values exhausted"
-- 如果有 CYCLE：循环回 MINVALUE

-- 查看序列状态
SHOW CREATE SEQUENCE order_seq;
SELECT * FROM information_schema.sequences WHERE sequence_name = 'order_seq';
```

---

## 总结

| 要点 | 虚拟列 | 序列 |
|------|--------|------|
| **定义** | 表达式计算得出的列 | 生成连续整数的对象 |
| **类型** | VIRTUAL（不存储）和 STORED（存储） | 可循环、可步长 |
| **索引** | 仅 STORED 可索引 | 不可索引 |
| **值** | 实时计算或预计算 | 顺序生成 |
| **用途** | 数据验证、计算预存、索引优化 | 多表共享、批次号 |

**虚拟列和序列是 MariaDB 的两个实用特性，让数据库能更好地表达业务规则，减少应用层代码的复杂性。**

---

## 下一步

- 想了解 MariaDB 的窗口函数？[MariaDB 窗口函数与 CT（Common Table Expression）](/database/mariadb/window-function)
- 想了解 MariaDB 的审计功能？[MariaDB 审计插件与安全增强](/database/mariadb/audit)
- 想了解 MariaDB 的集群方案？[MariaDB Galera Cluster 原理：同步多主复制](/database/mariadb/galera)
