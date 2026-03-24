# 达梦数据库事务：ACID 的工程实践

什么是事务？

很多人会说：「事务就是一组 SQL 语句，要么全成功，要么全失败。」

这话没错，但不完整。事务真正的价值在于：**它在混乱的并发世界里，给你一个确定性的承诺。**

今天，我们就来聊聊达梦数据库事务的内部机制，以及如何用好它。

## ACID：数据库的四大美德

### 原子性（Atomicity）：全有或全无

原子性意味着事务是最小执行单位，不可分割。要么全部提交，要么全部回滚。

```java
// Java 中事务的原子性示例
public class TransactionAtomicity {

    private JdbcTemplate jdbcTemplate;

    public void transfer(Long fromAccount, Long toAccount, BigDecimal amount) {
        // 整个转账操作在一个事务中，要么成功，要么失败
        String sql = "UPDATE account SET balance = balance - ? WHERE id = ?";
        jdbcTemplate.update(sql, amount, fromAccount);

        // 如果这一步抛出异常，整个事务回滚
        // 前面扣的钱会自动恢复
        sql = "UPDATE account SET balance = balance + ? WHERE id = ?";
        jdbcTemplate.update(sql, amount, toAccount);
        // 提交：两笔更新同时生效
    }
}
```

**达梦的实现：**

- 事务日志记录所有修改操作
- 回滚段保存修改前的数据镜像
- 异常时通过日志恢复原始状态

### 一致性（Consistency）：从一个正确状态到另一个正确状态

一致性容易被误解。数据库不会「创造」一致性，而是**维护**一致性。

```sql
-- 一致性约束：余额不能为负
CREATE TABLE account (
    id BIGINT PRIMARY KEY,
    name VARCHAR(50),
    balance DECIMAL(10,2) CHECK (balance >= 0)  -- 一致性约束
);
-- 如果约束被触发，事务会回滚
UPDATE account SET balance = balance - 1000 WHERE id = 1;
-- ERROR: CHECK 约束 violation，事务失败
```

### 隔离性（Isolation）：并发执行与串行执行等价

隔离性是最复杂的属性——它直接影响并发性能。

达梦通过锁机制和 MVCC 来实现不同级别的隔离，这部分会在后续章节详细展开。

### 持久性（Durability）：写入磁盘才算数

事务提交后，数据必须永久保存。

```java
// 持久性的 Java 演示
public class TransactionDurability {

    public void persistOrder(Order order) {
        // 1. 开启事务
        jdbcTemplate.execute("BEGIN");

        // 2. 插入订单数据
        String insertSql = "INSERT INTO orders (...) VALUES (...)";
        jdbcTemplate.update(insertSql);

        // 3. 提交事务
        // 达梦会确保事务日志写入磁盘后才返回成功
        jdbcTemplate.execute("COMMIT");
        // 此时，即使数据库崩溃，订单数据也不会丢失
    }
}
```

## 达梦事务的基本操作

```sql
-- 开启事务（隐式开启）
BEGIN;
-- 或者
START TRANSACTION;

-- 提交事务
COMMIT;

-- 回滚事务
ROLLBACK;

-- 保存点：事务内的部分回滚
SAVEPOINT sp1;
UPDATE account SET balance = balance - 100;
ROLLBACK TO SAVEPOINT sp1;  -- 只回滚到保存点
COMMIT;  -- 提交时，sp1 之后的 UPDATE 会被保留
```

## 事务的分类

### 自动提交事务

达梦默认是自动提交模式——每条 SQL 语句都是独立的事务。

```sql
-- 自动提交模式（默认）
SET AUTOCOMMIT = ON;

UPDATE account SET balance = 1000 WHERE id = 1;  -- 自动提交
DELETE FROM log WHERE create_time < '2023-01-01';  -- 自动提交

-- 关闭自动提交
SET AUTOCOMMIT = OFF;
```

```java
// Java JDBC 中的事务控制
public class JdbcTransactionDemo {

    public void batchTransfer() {
        // 默认情况下，每条 update 都会自动提交
        // 需要手动管理事务
        connection.setAutoCommit(false);  // 关闭自动提交
        try {
            statement.executeUpdate("UPDATE account SET balance = balance - 1000 WHERE id = 1");
            statement.executeUpdate("UPDATE account SET balance = balance + 1000 WHERE id = 2");
            connection.commit();  // 手动提交
        } catch (Exception e) {
            connection.rollback();  // 出错回滚
            throw e;
        }
    }
}
```

### 分布式事务

跨多个数据库实例的事务，需要 XA 协议支持。

```java
// Java 中使用 XA 事务
public class DistributedTransactionDemo {

    public void transferAcrossDatabases(
            DataSource dmDataSource,  // 达梦数据库
            DataSource oracleDataSource  // Oracle 数据库
    ) {
        // XA 事务管理器自动处理两阶段提交
        transactionManager.execute(status -> {
            jdbcTemplateDm.update("UPDATE account SET balance = balance - 1000 WHERE id = 1");
            jdbcTemplateOracle.update("UPDATE account SET balance = balance + 1000 WHERE id = 2");
            return null;
        });
    }
}
```

## 事务隔离级别

达梦支持标准 SQL 定义的四个隔离级别：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 |
|---------|------|-----------|------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 |
| READ COMMITTED | 不可能 | 可能 | 可能 |
| REPEATABLE READ | 不可能 | 不可能 | 可能 |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 |

```sql
-- 设置会话级隔离级别
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
```

关于隔离级别的详细讨论，请参阅 [达梦隔离级别详解](/database/dameng/isolation)。

## 面试追问方向

- 事务结束后，锁是立即释放还是等事务结束？
- savepoint 和嵌套事务有什么区别？
- 长事务有什么危害？如何避免？

---

## 一句话总结

事务是数据库的承诺书：ACID 不是空洞的口号，而是通过日志、锁、MVCC 等一系列机制实实在在实现的工程哲学。
