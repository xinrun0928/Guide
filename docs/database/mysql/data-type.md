# MySQL 数据类型选择与优化

字段类型选错，不只是「占空间大」这么简单——它会影响索引效率、查询性能，甚至导致数据溢出。

你可能觉得 VARCHAR(255) 是万能答案，但今天告诉你：**没有最好的类型，只有最合适的类型**。

---

## 数字类型：整数

### MySQL 整数类型一览

| 类型 | 字节 | 有符号范围 | 无符号范围 | 适用场景 |
|-----|-----|----------|-----------|---------|
| TINYINT | 1 | -128~127 | 0~255 | 状态码、性别 |
| SMALLINT | 2 | -32768~32767 | 0~65535 | 数量、年龄 |
| MEDIUMINT | 3 | -8388608~8388607 | 0~16777215 | 中等数量 |
| INT | 4 | -21亿~21亿 | 0~42亿 | 主键、订单号 |
| BIGINT | 8 | 极大 | 0~极大 | 金额、大ID |

### 选择原则

```java
// 反面教材：所有数字都用 INT
// 问题：TINYINT 能存的偏偏用 INT，浪费 3 字节/行
public class BadExample {
    // 用户状态：0禁用 1启用 2待审核
    int status;  // ❌ 浪费，用 TINYINT 就够了
    
    // 用户年龄：0-150
    int age;     // ❌ 浪费，用 TINYINT UNSIGNED
    
    // 订单金额（分）
    int amount;  // ❌ 可能溢出，用 DECIMAL
}

// 正确做法
public class GoodExample {
    // 状态码：0-2
    TINYINT status;  // ✅ 1 字节
    
    // 年龄
    TINYINT UNSIGNED age;  // ✅ 0-255
    
    // 金额（精确到分）
    DECIMAL(10, 2) amount;  // ✅ 精确存储
}
```

### 主键类型选择

| ID 类型 | 适用场景 | 注意事项 |
|-------|---------|---------|
| INT | 单表数据 < 20 亿 | 业务增长快慎用 |
| BIGINT | 超大数据量、安全 ID | 几乎无上限 |
| 自增主键 | 聚簇索引性能最优 | 分布式场景不友好 |
| UUID | 分布式 ID | 随机插入，索引性能差 |

> UUID 作为主键是大忌——插入时随机位置导致页分裂和随机 I/O，性能断崖式下降。

---

## 字符串类型：VARCHAR vs CHAR

### VARCHAR：可变长度

```sql
-- VARCHAR 特点：按实际长度存储
CREATE TABLE user1 (
    name VARCHAR(255)  -- 只存 "张三" 用 6 字节，不是 255 字节
);
```

**VARCHAR 存储规则**：

- 1~255 字节：1 字节存储长度
- 256~65535 字节：2 字节存储长度
- 最大 65535 字节（受行大小限制）

### CHAR：固定长度

```sql
-- CHAR 特点：不足部分用空格填充
CREATE TABLE user2 (
    code CHAR(6)  -- 存储 "001" 会补成 "001   "
);
```

### 选择场景

| 场景 | 推荐类型 | 原因 |
|-----|---------|-----|
| 用户名、手机号 | VARCHAR | 长度不固定 |
| 状态码（固定长度） | CHAR | 如 MD5 值、身份证号 |
| 性别 | CHAR(1) 或 TINYINT | 固定长度 |
| 邮政编码 | CHAR(6) | 固定 6 位 |

### VARCHAR 最大长度

很多人不知道：**VARCHAR(255) 不是最大 255 个字符**。

```sql
-- MySQL 5.7+
VARCHAR(255)  -- 最多 255 个字符（不是字节）

-- 但实际受字符集影响：
-- utf8mb4：每个字符最多 4 字节
-- 所以 VARCHAR(255) 在 utf8mb4 下最多存 255 * 4 = 1020 字节
-- 如果存中文，实际只能存 255 个中文

-- 如果要存更长的文本，用 TEXT
VARCHAR(65535)  -- ERROR: 行大小超限
TEXT  -- ✅ 可存 65535 字节
```

---

## 时间类型

### 常见时间类型对比

| 类型 | 范围 | 占用 | 精度 | 适用场景 |
|-----|-----|-----|-----|---------|
| DATE | '1000-01-01' ~ '9999-12-31' | 3 字节 | 天 | 生日 |
| DATETIME | '1000-01-01 00:00:00' ~ | 8 字节 | 秒 | 需要完整时间 |
| TIMESTAMP | '1970-01-01 00:00:01' UTC ~ | 4 字节 | 秒 | 跨时区 |
| BIGINT | 时间戳 | 8 字节 | 毫秒/微秒 | 高精度需求 |

### 时区问题

```java
// TIMESTAMP 的坑：自动时区转换
// 服务器在东八区，存储的是 UTC 时间
// 客户端读取时自动转成本地时间

// 如果你的业务需要跨时区，TIMESTAMP 是正确的选择
// 如果你的业务不需要跨时区，DATETIME 更简单

// Java 实体类建议
public class Order {
    // 创建时间：不需要跨时区，用 DATETIME
    private LocalDateTime createTime;
    
    // 修改时间：想记录最后一次变更时刻，用 TIMESTAMP
    private Timestamp updateTime;  // 数据库自动更新
}
```

### 时间戳 vs DATETIME

```sql
-- TIMESTAMP 自动更新（MySQL 5.6.5+）
CREATE TABLE log (
    id BIGINT,
    action VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 插入时不指定 created_at，自动取当前时间
-- 更新时不指定 created_at，自动更新为当前时间
```

---

## ENUM 和 SET

### ENUM：单选

```sql
-- ENUM 存储的是数字，但显示为字符串
CREATE TABLE order_status (
    status ENUM('pending', 'paid', 'shipped', 'delivered', 'cancelled')
);

-- 内部存储：
-- pending = 1
-- paid = 2
-- shipped = 3
-- ...

-- 优点：比 VARCHAR 更省空间，查询效率高
-- 缺点：修改需要 ALTER TABLE
```

### SET：多选

```sql
-- SET 存储多个选项
CREATE TABLE user_permissions (
    permissions SET('read', 'write', 'delete', 'admin')
);

-- 存储 "read,write" = 数字 3
-- 存储 "read,write,admin" = 数字 13
```

---

## NULL 的坑

### NULL 与空值的区别

```sql
-- 很多人搞不清楚 NULL 和空字符串的区别
CREATE TABLE test (
    col1 VARCHAR(10) DEFAULT NULL,   -- NULL：未知、未设置
    col2 VARCHAR(10) DEFAULT ''     -- 空字符串：有值，是空串
);

-- 统计时要注意：
SELECT COUNT(col1) FROM test;  -- 不计 NULL
SELECT COUNT(col2) FROM test;  -- 计空字符串
```

### NOT NULL 的重要性

```java
// 字段尽量 NOT NULL，原因：
// 1. 索引效率更高（NULL 值需要特殊处理）
// 2. 统计运算更简单
// 3. 减少程序 bug（空指针、类型转换异常）

// 反面例子
public class User {
    String name;      // ❌ 可能是 null
    Integer age;      // ❌ 可能是 null
    
    public int getAge() {
        return age != null ? age : 0;  // 到处要判空
    }
}

// 正面例子
public class User {
    String name;           // 初始化为空字符串
    Integer age = 0;      // 初始化为 0
}
```

---

## 字段类型选择 checklist

```
拿到一个新字段，应该问自己：

1. 取值范围多大？
   └→ 决定用 TINYINT 还是 BIGINT

2. 长度固定吗？
   ├→ 固定 → CHAR
   └→ 不固定 → VARCHAR

3. 需要精确小数吗？
   ├→ 金额/汇率 → DECIMAL
   └→ 科学计算 → FLOAT/DOUBLE

4. 跨时区吗？
   ├→ 是 → TIMESTAMP
   └→ 否 → DATETIME

5. 需要全文搜索吗？
   └→ 用 TEXT + 全文索引

6. 真的需要允许 NULL 吗？
   └→ 能 NOT NULL 就 NOT NULL
```

---

## 实战优化案例

### 案例 1：手机号存储

```sql
-- ❌ 错误：用 VARCHAR(255)
mobile VARCHAR(255)

-- ✅ 正确：用 CHAR(11) 或 VARCHAR(20)
mobile CHAR(11)      -- 国内手机号固定 11 位

-- 如果要存国际号码
mobile VARCHAR(20)   -- 最多 20 位字符
```

### 案例 2：IP地址存储

```sql
-- ❌ 错误：用 VARCHAR(45)
ip_address VARCHAR(45)

-- ✅ 正确：用 UNSIGNED INT 或 VARBINARY(16)
ip_address INT UNSIGNED

-- 查询时转换
SELECT INET_NTOA(ip_address) FROM users WHERE ip_address = INET_ATON('192.168.1.1');
```

### 案例 3：金额存储

```sql
-- ❌ 错误：用 DOUBLE
price DOUBLE  -- 精度问题：0.1 + 0.2 = 0.30000000000000004

-- ✅ 正确：用 DECIMAL
price DECIMAL(10, 2)  -- 总共 10 位，小数点后 2 位

-- Java 中用 BigDecimal
private BigDecimal price;  // 不要用 Double！
```

---

## 面试高频追问

### Q1：VARCHAR(255) 中的 255 是字节还是字符？

在 MySQL 中，VARCHAR 的长度指定的是**字符数**，不是字节数。

但实际存储受字符集影响：

```sql
-- utf8mb4 字符集
VARCHAR(255)  -- 最多 255 个字符
               -- 但如果都是中文，只能存 63 个（255 * 4 > 65535）

-- latin1 字符集
VARCHAR(255)  -- 最多 255 个字符，255 个字节（一一对应）
```

### Q2：为什么金额要用 DECIMAL 而不是 DOUBLE？

DOUBLE 是浮点数，存在精度丢失问题：

```java
// Java 示例
System.out.println(0.1 + 0.2);  // 0.30000000000000004
System.out.println(1.0 - 0.9);   // 0.09999999999999998

// DECIMAL 是定点数，精确存储
// 0.1 + 0.2 = 0.3 ✅
```

### Q3：TEXT 和 VARCHAR 怎么选？

| 类型 | 最大长度 | 存储位置 | 适用场景 |
|-----|--------|--------|---------|
| VARCHAR | 65535 字节 | 行内 | 短文本、可建索引 |
| TEXT | 65535 字节 | 行外 | 长文本、不建索引 |
| MEDIUMTEXT | 16MB | 行外 | 文章内容 |
| LONGTEXT | 4GB | 行外 | 大文本 |

---

## 总结

| 原则 | 说明 |
|-----|-----|
| 够用就好 | 选能容纳值的最小的类型 |
| 避免 NULL | 字段尽量 NOT NULL |
| 固定长度用 CHAR | 如 MD5、邮政编码 |
| 变长用 VARCHAR | 如用户名、地址 |
| 金额用 DECIMAL | 避免精度问题 |
| 时间看时区 | 跨时区用 TIMESTAMP |