# 达梦数据库隔离级别：并发与一致性的博弈

隔离级别，可能是数据库最容易被误解的概念之一。

很多人知道有四个隔离级别，也知道级别越高越安全，但很少有人能说清楚：**为什么要有隔离级别？不同级别到底隔离了什么？**

今天，我们来揭开隔离级别的神秘面纱。

## 三个读问题：脏读、不可重复读、幻读

在说隔离级别之前，先认识三个「妖魔鬼怪」。

### 脏读：读了别人的未提交数据

```
T1: UPDATE account SET balance = 0 WHERE id = 1
T2: SELECT balance FROM account WHERE id = 1  -- 读到 balance = 0
T1: ROLLBACK  -- T1 回滚了
结果：T2 读到的是一个「从未存在过的数据」
```

### 不可重复读：两次读到不同的值

```
T1: SELECT balance FROM account WHERE id = 1  -- 读到 balance = 1000
T2: UPDATE account SET balance = 2000 WHERE id = 1
T2: COMMIT
T1: SELECT balance FROM account WHERE id = 1  -- 读到 balance = 2000
同一事务内，两次读取结果不一致
```

### 幻读：多出来「幻影」行

```
T1: SELECT COUNT(*) FROM orders WHERE status = 'pending'  -- 读到 100 条
T2: INSERT INTO orders VALUES (...) WHERE status = 'pending'
T2: COMMIT
T1: SELECT COUNT(*) FROM orders WHERE status = 'pending'  -- 读到 101 条
同一事务内，符合条件的记录数量变了
```

## 四个隔离级别：从放任到严苛

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | 并发性能 |
|---------|------|-----------|------|---------|
| READ UNCOMMITTED | 可能 | 可能 | 可能 | 最高 |
| READ COMMITTED | 不可能 | 可能 | 可能 | 较高 |
| REPEATABLE READ | 不可能 | 不可能 | 可能 | 较低 |
| SERIALIZABLE | 不可能 | 不可能 | 不可能 | 最低 |

### READ UNCOMMITTED：裸奔模式

能读到其他事务未提交的数据。性能最高，风险也最高。

```sql
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
```

```java
// Java 中设置隔离级别
public void readUncommittedDemo() {
    connection.setTransactionIsolation(Connection.TRANSACTION_READ_UNCOMMITTED);
    // 不推荐在生产环境使用
}
```

**使用场景：** 只有在你**绝对确定不会有问题**的情况下才用，比如统计类查询（允许短暂的不一致）。

### READ COMMITTED：大多数数据库的默认级别

只能读到已提交的数据。但同一事务中，多次读取可能得到不同结果。

```sql
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- 达梦默认就是这个级别
```

**达梦实现方式：** 每次读取时，生成一个新的 ReadView，只读取已提交的数据。

```java
// READ COMMITTED 的问题演示
public class ReadCommittedIssue {

    public void nonRepeatableReadDemo() throws InterruptedException {
        // 线程1：开启事务，读取数据
        new Thread(() -> {
            jdbcTemplate.execute("BEGIN");
            Integer balance = jdbcTemplate.queryForObject(
                "SELECT balance FROM account WHERE id = 1", Integer.class);
            System.out.println("首次读取: " + balance);

            // 稍后再读
            try { Thread.sleep(2000); } catch (InterruptedException e) {}

            // 第二次读取
            Integer balance2 = jdbcTemplate.queryForObject(
                "SELECT balance FROM account WHERE id = 1", Integer.class);
            System.out.println("再次读取: " + balance2);
            jdbcTemplate.execute("COMMIT");
        }).start();

        // 线程2：另一个事务修改数据
        new Thread(() -> {
            try { Thread.sleep(500); } catch (InterruptedException e) {}
            jdbcTemplate.execute("BEGIN");
            jdbcTemplate.update("UPDATE account SET balance = 9999 WHERE id = 1");
            jdbcTemplate.execute("COMMIT");  // 修改被提交
        }).start();
    }
}
```

### REPEATABLE READ：达梦的默认隔离级别

同一事务中，多次读取结果相同。即使其他事务提交了修改，当前事务也看不到。

**达梦实现方式：** 通过 MVCC（多版本并发控制），每个事务开始时生成 ReadView，整个事务期间使用同一个 ReadView。

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
```

**注意：** 达梦的 REPEATABLE READ 级别通过间隙锁（Gap Lock）有效防止幻读。

### SERIALIZABLE：串行执行

最高隔离级别，事务看起来像是串行执行的。性能最差，但绝对安全。

```sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

```java
// Java 中设置最高隔离级别
public void serializableDemo() {
    connection.setTransactionIsolation(Connection.TRANSACTION_SERIALIZABLE);
    // 所有并发操作实际变成串行，性能较差
}
```

## 达梦的隔离级别配置

```sql
-- 查看当前隔离级别
SELECT @@TX_ISOLATION;
SELECT CURRENT_SETTING('transaction_isolation');

-- 设置会话级隔离级别
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 设置全局隔离级别（需要 DBA 权限）
ALTER SYSTEM SET TRANSACTION_ISOLATION = 'REPEATABLE READ';
```

## 隔离级别与锁的关系

隔离级别越高，需要的锁越多，性能越差。

| 隔离级别 | 锁策略 |
|---------|-------|
| READ UNCOMMITTED | 几乎不加锁 |
| READ COMMITTED | 读取时释放锁，可能重复获取 |
| REPEATABLE READ | 读取时持有快照，加间隙锁 |
| SERIALIZABLE | 全表锁或索引锁 |

```java
// 隔离级别对性能的影响实测
public class IsolationLevelBenchmark {

    public void benchmark() {
        // READ COMMITTED：每次读取快照不同
        measureTime(() -> {
            // 事务执行快，但可能有不可重复读
        });

        // REPEATABLE READ：事务期间快照不变
        measureTime(() -> {
            // 事务执行相对慢，但隔离性更好
        });

        // SERIALIZABLE：强制串行
        measureTime(() -> {
            // 事务执行最慢，但完全隔离
        });
    }
}
```

## 如何选择隔离级别

| 业务场景 | 推荐级别 | 原因 |
|---------|---------|------|
| 金融转账 | SERIALIZABLE 或 REPEATABLE READ | 绝对不能出错 |
| 订单查询 | READ COMMITTED | 偶尔的统计偏差可接受 |
| 日志记录 | READ COMMITTED | 插入为主，无更新 |
| 报表统计 | READ UNCOMMITTED | 允许短暂不一致，追求速度 |

## 面试追问方向

- 达梦默认是哪个隔离级别？MySQL 默认是哪个？
- 什么是 MVCC？它和隔离级别有什么关系？
- 什么情况下需要手动设置隔离级别？

---

## 一句话总结

隔离级别是「安全」与「速度」的权衡。不是越高越好，也不是越低越快。选对隔离级别，要看你的业务能容忍多少「不一致」。
