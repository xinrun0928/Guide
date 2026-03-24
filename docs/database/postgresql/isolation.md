# PostgreSQL 事务隔离级别：Read Committed vs Repeatable Read vs Serializable

MySQL 默认是 Repeatable Read，PostgreSQL 默认是 Read Committed。

这个差异，让多少人在面试时翻车。

今天，我们来彻底搞清楚 PostgreSQL 的事务隔离级别。

## 事务隔离级别基础

ANSI SQL 定义了四种标准隔离级别：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| Read Uncommitted | 可能 | 可能 | 可能 |
| Read Committed | 不可能 | 可能 | 可能 |
| Repeatable Read | 不可能 | 不可能 | 可能 |
| Serializable | 不可能 | 不可能 | 不可能 |

PostgreSQL 的实际情况：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| Read Committed | ✅ 不可能 | 可能 | 可能 |
| Repeatable Read | ✅ 不可能 | ✅ 不可能 | ✅ 不可能* |
| Serializable | ✅ 不可能 | ✅ 不可能 | ✅ 不可能 |

> * PostgreSQL 的 Repeatable Read 通过「序列化快照隔离」防止幻读，而不是像标准 RR 那样通过间隙锁。

## Read Committed（默认级别）

### 工作原理

Read Committed 是 PostgreSQL 的默认隔离级别，也是 MySQL 用户最容易混淆的点。

在 Read Committed 下，每个语句看到的是**该语句开始时已提交**的事务所做的修改。

```sql
-- 会话 1
BEGIN;
UPDATE accounts SET balance = balance + 100 WHERE id = 1;
-- 不提交

-- 会话 2（在会话 1 提交前）
BEGIN;
SELECT balance FROM accounts WHERE id = 1;
-- 结果：还是 1000（旧值）

-- 会话 1
COMMIT;

-- 会话 2
SELECT balance FROM accounts WHERE id = 1;
-- 结果：1100（新值，T1 的修改已提交）
```

### 写倾斜问题（Write Skew）

Read Committed 下存在「写倾斜」问题：

```sql
-- 场景：医院值班系统
-- 规则：每个班次至少有一名医生在岗

CREATE TABLE doctors (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    on_call BOOLEAN
);

INSERT INTO doctors VALUES (1, 'Alice', true), (2, 'Bob', true);

-- 会话 1：Alice 离开
BEGIN;
SELECT * FROM doctors WHERE on_call = true;
-- 看到两个医生在岗

-- 会话 2：Bob 离开
BEGIN;
SELECT * FROM doctors WHERE on_call = true;
-- 也看到两个医生在岗

-- 会话 1：Alice 离开
UPDATE doctors SET on_call = false WHERE id = 1;
COMMIT;

-- 会话 2：Bob 离开
UPDATE doctors SET on_call = false WHERE id = 2;
COMMIT;

-- 结果：两个医生都离开了，但每个事务都没发现问题
SELECT * FROM doctors WHERE on_call = true;
-- 空结果！规则被违反了
```

这是 Read Committed 无法避免的问题——每个事务只看到已提交的数据，但无法防止两个事务「分别看到对方看不到」的情况。

## Repeatable Read

### 工作原理

Repeatable Read 下，事务看到的是**事务开始时已提交**的事务所做的修改。

```sql
-- 会话 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;
-- 结果：1000

-- 会话 2（在另一个会话）
BEGIN;
UPDATE accounts SET balance = 1500 WHERE id = 1;
COMMIT;

-- 会话 1
SELECT balance FROM accounts WHERE id = 1;
-- 结果：仍然是 1000（快照不变）
```

### 序列化失败

在 Repeatable Read 下，如果检测到序列化冲突，会抛出错误：

```sql
-- 会话 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;
-- 1000

-- 会话 2
BEGIN;
UPDATE accounts SET balance = 1500 WHERE id = 1;
COMMIT;

-- 会话 1
UPDATE accounts SET balance = 2000 WHERE id = 1;
-- ERROR: could not serialize access due to concurrent update
```

应用需要处理这个错误，通常的做法是重试事务。

### 防止幻读

Repeatable Read 使用「快照隔离」而非间隙锁来防止幻读：

```sql
-- 会话 1
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT * FROM orders WHERE created_at >= '2026-03-01';

-- 会话 2
INSERT INTO orders VALUES (100, '2026-03-15');

-- 会话 1
SELECT * FROM orders WHERE created_at >= '2026-03-01';
-- 结果：仍然看不到新插入的行（幻读被防止了）
-- 但如果用索引范围查询，可能会有不同的行为
```

## Serializable

### 工作原理

Serializable 是最严格的隔离级别，事务看起来是串行执行的。

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;

-- 第一次读
SELECT SUM(balance) FROM accounts;

-- 其他事务可能在同时修改数据

-- 写操作
UPDATE accounts SET balance = balance + 100 WHERE id = 1;
-- 如果有冲突，抛出序列化错误
```

### 检测序列化冲突

Serializable 使用 SSI（Serializable Snapshot Isolation）算法检测冲突：

1. **RW-Conflict 检测**：检测读写之间的冲突
2. **WW-Conflict 检测**：检测写写之间的冲突

```sql
-- 场景：账户转账
-- 账户 1：1000 元
-- 账户 2：1000 元

-- 会话 1：转 100 元
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT balance FROM accounts WHERE id = 1;  -- 1000
SELECT balance FROM accounts WHERE id = 2;  -- 1000

-- 会话 2：转 200 元
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT balance FROM accounts WHERE id = 1;  -- 1000
SELECT balance FROM accounts WHERE id = 2;  -- 1000

-- 会话 1：执行转账
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;  -- 成功

-- 会话 2：执行转账
UPDATE accounts SET balance = balance - 200 WHERE id = 1;  
-- 检测到与 T1 的冲突！
-- ERROR: could not serialize access
```

### 重试逻辑

Serializable 需要应用层重试机制：

```java
public void transfer(int fromAccount, int toAccount, BigDecimal amount) {
    int maxRetries = 3;
    for (int i = 0; i < maxRetries; i++) {
        try {
            executeTransfer(fromAccount, toAccount, amount);
            return;
        } catch (DataAccessException e) {
            if (isSerializationFailure(e)) {
                log.warn("Serialization failure, retrying...");
                continue;  // 重试
            }
            throw e;  // 其他错误，抛出
        }
    }
    throw new RuntimeException("Transfer failed after " + maxRetries + " retries");
}

private boolean isSerializationFailure(Exception e) {
    String message = e.getMessage();
    return message != null && message.contains("could not serialize");
}
```

## 隔离级别对比

| 特性 | Read Committed | Repeatable Read | Serializable |
|------|---------------|-----------------|--------------|
| 脏读 | ❌ 不可能 | ❌ 不可能 | ❌ 不可能 |
| 不可重复读 | ✅ 可能 | ❌ 不可能 | ❌ 不可能 |
| 幻读 | ✅ 可能 | ✅ 不可能* | ❌ 不可能 |
| 写倾斜 | ✅ 可能 | ✅ 可能 | ❌ 不可能 |
| 性能开销 | 最低 | 中等 | 最高 |
| 需要重试 | 不需要 | 仅 UPDATE 时 | 是 |

## 选择建议

### Read Committed

适用场景：
- 大多数 OLTP 业务
- 性能敏感的场景
- 可以容忍不可重复读

```sql
-- 设置默认隔离级别
SET default_transaction_isolation = 'read committed';
```

### Repeatable Read

适用场景：
- 需要一致性的读取
- 可以接受偶尔的重试
- 财务类、库存类操作

```sql
-- 设置 RR 级别
SET default_transaction_isolation = 'repeatable read';
BEGIN ISOLATION LEVEL REPEATABLE READ;
```

### Serializable

适用场景：
- 需要严格一致性的操作
- 可以接受重试开销
- 关键的财务操作

```sql
-- 设置 Serializable
SET default_transaction_isolation = 'serializable';
```

## Java 中的事务隔离

### Spring 配置

```java
// application.properties
spring.datasource.hikari.transaction-isolation=TRANSACTION_REPEATABLE_READ

// 或使用注解
@Transactional(isolation = Isolation.REPEATABLE_READ)
public void doSomething() {
    // ...
}
```

### JPA 配置

```java
// EntityManagerFactory 配置
@Bean
public LocalContainerEntityManagerFactoryBean entityManagerFactory() {
    LocalContainerEntityManagerFactoryBean em = new LocalContainerEntityManagerFactoryBean();
    em.setJpaProperties(properties -> {
        properties.setProperty("hibernate.connection.isolation", "2");  // RR
    });
    return em;
}

// 方法级别
@PersistenceContext
private EntityManager entityManager;

public void doSomething() {
    entityManager.createQuery("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    // ...
}
```

## 监控事务状态

```sql
-- 查看当前活动事务
SELECT 
    pid,
    usename,
    application_name,
    state,
    query_start,
    backend_xid::TEXT,
    query
FROM pg_stat_activity
WHERE state != 'idle'
ORDER BY query_start;

-- 查看事务等待的锁
SELECT 
    l.locktype,
    l.relation::REGCLASS,
    l.mode,
    l.granted,
    l.pid,
    a.usename,
    a.query
FROM pg_locks l
JOIN pg_stat_activity a ON l.pid = a.pid
WHERE NOT l.granted
ORDER BY l.pid;

-- 查看长事务
SELECT 
    pid,
    xmin,
    backend_xid,
    state,
    query_start,
    now() - query_start AS duration,
    query
FROM pg_stat_activity
WHERE state != 'idle'
AND backend_xid IS NOT NULL
AND now() - query_start > INTERVAL '5 minutes';
```

## 面试高频问题

### Q1: PostgreSQL 默认隔离级别是什么？与 MySQL 有什么区别？

**考察点**：基本知识

**参考答案**：
- PostgreSQL 默认是 Read Committed
- MySQL InnoDB 默认是 Repeatable Read
- 这是两者的重要区别，可能导致不同的并发行为

### Q2: PostgreSQL 的 Repeatable Read 和 Read Committed 有什么区别？

**考察点**：隔离级别理解

**参考答案**：
- Read Committed：每个语句看到的是该语句开始时已提交的修改
- Repeatable Read：整个事务看到的是事务开始时已提交的修改
- RR 下 UPDATE 可能有序列化冲突，RC 没有
- RR 比 RC 更严格，但需要重试逻辑

### Q3: 什么是写倾斜（Write Skew）？

**考察点**：并发控制理解

**参考答案**：
- 两个事务读取重叠的数据，基于读取的数据做修改
- 两个修改都基于「对方看不到我的修改」的前提
- 结果：两个事务都成功，但违反了业务约束
- RC 和 RR 都可能发生，Serializable 不会

### Q4: Serializable 需要应用层做什么？

**考察点**：工程实践

**参考答案**：
- Serializable 可能抛出序列化错误
- 应用需要捕获错误并重试事务
- 适合关键操作，不适合高频操作
- 重试次数有限，避免无限循环

## 总结

PostgreSQL 的事务隔离级别设计：

| 级别 | 特点 | 开销 | 适用场景 |
|------|------|------|---------|
| Read Committed | 每语句快照 | 最低 | 大多数 OLTP |
| Repeatable Read | 事务快照 | 中等 | 需要一致性读 |
| Serializable | 串行快照 | 最高 | 关键操作 |

选择正确的隔离级别，在一致性和性能之间找到平衡。
