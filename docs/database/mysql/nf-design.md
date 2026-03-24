# 数据库设计三范式与反范式设计

面试官问：「数据库设计要遵循什么原则？」

你说：「三范式...」

面试官追问：「为什么要反范式设计？什么时候用？」

你答不上来了。

三范式是基础，但反范式才是性能优化的开始。

今天，彻底搞清楚范式设计和反范式设计。

---

## 三范式

### 第一范式（1NF）

```sql
-- 原子性：每个字段不可再分

-- ❌ 违反 1NF
CREATE TABLE user (
    id INT,
    name VARCHAR(50),  -- 可以再分成姓和名
    phone VARCHAR(100)  -- 可能存储多个电话
);

-- ✅ 符合 1NF
CREATE TABLE user (
    id INT,
    first_name VARCHAR(25),
    last_name VARCHAR(25),
    phone VARCHAR(20)
);
```

### 第二范式（2NF）

```sql
-- 唯一性：非主键字段完全依赖主键

-- ❌ 违反 2NF
CREATE TABLE order_detail (
    order_id INT,
    product_id INT,
    product_name VARCHAR(100),  -- 只依赖 product_id，不完全依赖主键
    quantity INT,
    PRIMARY KEY (order_id, product_id)
);

-- ✅ 符合 2NF
CREATE TABLE order (
    order_id INT PRIMARY KEY,
    user_id INT,
    create_time DATETIME
);

CREATE TABLE product (
    product_id INT PRIMARY KEY,
    product_name VARCHAR(100)
);

CREATE TABLE order_detail (
    order_id INT,
    product_id INT,
    quantity INT,
    PRIMARY KEY (order_id, product_id),
    FOREIGN KEY (order_id) REFERENCES order(order_id),
    FOREIGN KEY (product_id) REFERENCES product(product_id)
);
```

### 第三范式（3NF）

```sql
-- 消除传递依赖：非主键字段之间不能有依赖关系

-- ❌ 违反 3NF
CREATE TABLE user (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    department_id INT,
    department_name VARCHAR(100)  -- 依赖 department_id，传递依赖
);

-- ✅ 符合 3NF
CREATE TABLE user (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    department_id INT
);

CREATE TABLE department (
    id INT PRIMARY KEY,
    department_name VARCHAR(100)
);
```

---

## 三范式优缺点

### 优点

```sql
-- 1. 数据无冗余
-- 2. 更新异常少
-- 3. 结构清晰
-- 4. 易于维护
```

### 缺点

```sql
-- 1. 查询需要 JOIN
-- 2. 多表查询性能差
-- 3. 关联查询复杂
```

---

## 反范式设计

### 为什么要反范式？

```sql
-- 场景：
-- 用户表有 1000 万数据
-- 订单表有 5000 万数据
-- 查询用户最近 10 笔订单需要 JOIN

-- 问题：
-- JOIN 操作耗时
-- 索引失效
-- 查询很慢
```

### 反范式实现

```sql
-- 方式一：冗余字段

-- 在 orders 表冗余用户名字段
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    user_id INT,
    user_name VARCHAR(50),  -- 冗余：避免 JOIN
    total_amount DECIMAL(10,2),
    create_time DATETIME
);

-- 查询用户订单不用 JOIN
SELECT * FROM orders WHERE user_id = ?;
```

```sql
-- 方式二：宽表

-- 把关联数据冗余到一张表
CREATE TABLE order_full (
    order_id BIGINT,
    user_id INT,
    user_name VARCHAR(50),
    user_phone VARCHAR(20),
    product_id BIGINT,
    product_name VARCHAR(100),
    product_price DECIMAL(10,2),
    quantity INT,
    ...
);
```

```sql
-- 方式三：汇总表

-- 定时计算汇总数据
CREATE TABLE user_order_summary (
    user_id INT PRIMARY KEY,
    order_count INT,  -- 订单总数
    total_amount DECIMAL(15,2),  -- 总金额
    last_order_time DATETIME,  -- 最后下单时间
    update_time DATETIME
);

-- 查询用户订单统计直接查汇总表
SELECT * FROM user_order_summary WHERE user_id = ?;
```

---

## 范式与反范式的权衡

### 何时用范式？

```sql
-- 1. 数据更新频繁
-- 2. 数据一致性要求高
-- 3. 存储空间有限

-- 示例：金融交易、库存管理
```

### 何时用反范式？

```sql
-- 1. 查询多、更新少
-- 2. 查询性能要求高
-- 3. 数据冗余可接受

-- 示例：报表系统、日志查询
```

---

## 面试高频追问

### Q1：三范式和反范式哪个好？

```sql
-- 没有绝对的好坏。

-- 范式设计：
-- 优点：数据一致性好，无冗余
-- 缺点：查询慢

-- 反范式设计：
-- 优点：查询快
-- 缺点：数据冗余，更新复杂

-- 建议：根据业务场景选择
```

### Q2：怎么判断是否违反范式？

```sql
-- 1NF：字段是否可再分？
-- 2NF：非主键是否完全依赖主键？
-- 3NF：非主键之间是否有传递依赖？
```

### Q3：反范式怎么保证数据一致性？

```sql
-- 方法：
-- 1. 触发器同步
-- 2. 异步任务同步
-- 3. 应用层双写
-- 4. 允许短暂不一致
```

---

## 总结

| 范式 | 原则 | 违反条件 |
|-----|-----|---------|
| 1NF | 原子性 | 字段可再分 |
| 2NF | 完全依赖主键 | 部分依赖主键 |
| 3NF | 无传递依赖 | 传递依赖 |

**记住：范式设计是基础，反范式是优化。没有绝对的好坏，只有合适的权衡。**