# MVCC：达梦数据库的多版本并发控制

你有没有想过这个问题：

数据库是如何做到「读写不互斥」的？

传统的锁机制，读的时候不能写，写的时候不能读。高并发下，性能直接崩掉。

而现代数据库能在读写并发时保持高性能，靠的就是 **MVCC（Multi-Version Concurrency Control，多版本并发控制）**。

## MVCC 的核心思想

MVCC 的精髓在于：**每个事务看到的数据版本可以不同。**

```
时间线：
T1: [事务开始] ----[修改 x=1]----[事务提交]
T2:              [事务开始]  ----[读取 x]----[事务提交]

传统锁机制：
- T1 和 T2 不能同时运行

MVCC：
- T2 读取的是 T1 修改前的数据（x = 0）
- T1 和 T2 可以同时运行，性能提升
```

## 达梦 MVCC 的实现机制

### 隐藏列：版本号的生命周期

达梦通过隐藏列来管理数据的多个版本：

| 隐藏列 | 说明 |
|-------|------|
| ROWID | 物理行ID，唯一标识 |
| TXID | 事务ID，创建这行的事务 |
| BEGIN_ID | 记录版本开始的事务ID |
| END_ID | 记录版本结束的事务ID |

### ReadView：快照的核心

ReadView 是事务启动时生成的「快照视图」，包含以下信息：

```java
public class ReadView {
    // 当前活跃事务的最小ID
    long minActiveTxId;
    // 当前活跃事务的最大ID
    long maxTxId;
    // 当前事务自身的ID
    long currentTxId;
    // 活跃事务ID列表
    List&lt;Long&gt; activeTransactions;
}
```

**可见性判断规则：**

```
1. 如果记录的 END_ID > maxTxId，该记录对当前事务不可见
2. 如果记录的 BEGIN_ID 在 activeTransactions 中，说明有活跃事务正在修改，不可见
3. 如果记录的 TXID == currentTxId，是自己的修改，可见
4. 其他情况，可见
```

### 不同隔离级别下的 ReadView

| 隔离级别 | ReadView 生成时机 | ReadView 使用方式 |
|---------|------------------|------------------|
| READ UNCOMMITTED | 每次读取生成新 ReadView | 读取最新版本，包括未提交 |
| READ COMMITTED | 每次读取生成新 ReadView | 读取已提交版本 |
| REPEATABLE READ | 事务开始时生成 | 整个事务使用同一 ReadView |
| SERIALIZABLE | - | 直接加锁，不使用 MVCC |

```sql
-- 不同隔离级别下的 MVCC 行为差异
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT balance FROM account WHERE id = 1;  -- 生成 ReadView A

-- 其他事务修改并提交了数据

SELECT balance FROM account WHERE id = 1;  -- 生成新的 ReadView B，可能读到新值
```

```sql
SET TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM account WHERE id = 1;  -- 生成 ReadView A

-- 其他事务修改并提交了数据

SELECT balance FROM account WHERE id = 1;  -- 仍用 ReadView A，看不到新值
```

## MVCC 的写操作：最新版本优先

MVCC 的读操作是「快照读」，但写操作永远是「当前读」。

```sql
-- 快照读：读取快照版本
SELECT * FROM orders WHERE status = 'pending';  -- 读取快照

-- 当前读：读取最新版本，加锁
SELECT * FROM orders WHERE status = 'pending' FOR UPDATE;  -- 读取最新 + 加锁
UPDATE orders SET status = 'processing' WHERE status = 'pending';  -- 当前读 + 更新
```

```java
// Java 中区分快照读和当前读
public class ReadTypeDemo {

    public void snapshotRead() {
        // 普通查询，快照读
        String sql1 = "SELECT * FROM orders WHERE id = 100";
        jdbcTemplate.queryForList(sql1);
    }

    public void currentRead() {
        // FOR UPDATE，当前读
        String sql2 = "SELECT * FROM orders WHERE id = 100 FOR UPDATE";
        jdbcTemplate.queryForList(sql2);
    }

    public void updateOperation() {
        // UPDATE/DELETE 默认是当前读
        String sql3 = "UPDATE orders SET status = 'closed' WHERE id = 100";
        jdbcTemplate.update(sql3);
    }
}
```

## MVCC 的垃圾回收：清理旧版本

MVCC 会产生多个数据版本，需要定期清理，否则磁盘空间会被撑爆。

```sql
-- 手动触发垃圾回收（达梦会自动进行）
CALL DBMS_WORKLOAD_REPOSITORY.SNAPSHOT();

-- 查看版本信息
SELECT
    v$TRANSACTION.TRXID,
    v$TRANSACTION.BEGIN_TIME,
    v$TRANSACTION.STATUS
FROM V$TRANSACTION;
```

## MVCC 的优缺点

### 优点

1. **读写不互斥**：读操作不阻塞写操作，写操作不阻塞读操作
2. **并发度高**：多个事务可以同时读取不同版本的数据
3. **减少锁竞争**：大部分读操作不需要加锁

### 缺点

1. **存储开销**：多版本数据占用更多空间
2. **垃圾回收开销**：需要定期清理旧版本
3. **长事务问题**：事务持续时间越长，保留的旧版本越多

```java
// 长事务问题示例
public class LongTransactionProblem {

    public void longTransactionIssue() throws InterruptedException {
        // 开启长事务
        connection.setAutoCommit(false);

        // 模拟：用户思考时间、业务处理等导致事务持续很久
        System.out.println("开始事务...");
        List&lt;Object&gt; data = jdbcTemplate.queryForList("SELECT * FROM orders");

        // 用户思考、业务处理...
        Thread.sleep(300000);  // 模拟 5 分钟的处理时间

        // 期间，其他事务对这些数据的修改都无法清理旧版本
        // 大量历史版本堆积，占用磁盘空间

        jdbcTemplate.execute("COMMIT");
    }
}
```

## MVCC 与其他数据库的对比

| 数据库 | MVCC 实现 | 特点 |
|-------|----------|------|
| MySQL InnoDB | 回滚段 + Undo Log | 通过事务ID和回滚指针实现 |
| PostgreSQL | 版本链 + 可见性映射 | 多版本存储在表文件 |
| Oracle | SCN + 回滚段 | 使用 System Change Number |
| 达梦 | 隐藏列 + ReadView | 类似 Oracle 的实现方式 |

## 面试追问方向

- MVCC 能完全解决并发问题吗？什么情况下还需要锁？
- ReadView 在什么时候生成？什么情况下会失效？
- 如果一个事务持续 24 小时不提交，会发生什么？

---

## 一句话总结

MVCC 是数据库的「时间魔法」——让读写操作各走各的时间线，互不干扰。理解 MVCC，你才能真正理解现代数据库的并发之道。
