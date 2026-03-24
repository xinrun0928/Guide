# Seata AT 模式：自动补偿与全局锁

你有没有遇到过这种情况：

订单服务调用库存服务扣库存，扣完之后订单服务崩了。

库存已经扣了，但订单没创建成功。

数据不一致了，怎么办？

**Seata AT 模式，就是来解决这个问题的。**

## 为什么需要 AT 模式

传统的分布式事务方案，要么性能差（XA），要么侵入性强（TCC）。

Seata AT 模式的核心目标是：**对业务代码零侵入，同时保证分布式事务一致性。**

这不是魔法，背后是 Seata 对 SQL 的自动解析和回滚日志的巧妙设计。

## AT 模式 vs TCC 模式

TCC 需要业务实现 Try/Confirm/Cancel 三个方法，代码侵入性大。

AT 模式呢？业务代码什么都不用改，只加一个 `@GlobalTransactional` 注解就够了。

```
AT 模式原理：
1. 一阶段：Seata 自动解析 SQL，记录前后镜像（Before/After Image），生成行锁
2. 二阶段：自动删除镜像，释放全局锁

TCC 模式原理：
1. Try：业务预留资源
2. Confirm：业务确认使用资源
3. Cancel：业务释放资源
```

## 一阶段：解析 SQL 与记录镜像

AT 模式的一阶段，Seata 做了三件事：

```
1. 解析 SQL：识别 UPDATE/INSERT/DELETE 语句
2. 记录前镜像（Before Image）：执行 SQL 前，查询数据快照
3. 记录后镜像（After Image）：执行 SQL 后，查询数据快照
4. 生成行锁：将前后镜像和锁信息存入 undolog 表
```

```java
/**
 * AT 模式一阶段示例
 *
 * 假设执行：UPDATE account SET balance = balance - 100 WHERE id = 1
 */
public class AtModeExample {

    /**
     * 一阶段：解析 SQL + 记录镜像
     */
    public void beforeImage() {
        // 1. 解析 SQL，提取 WHERE 条件
        // SELECT * FROM account WHERE id = 1
        Account before = jdbcTemplate.queryForObject(
            "SELECT * FROM account WHERE id = ?", id);

        // 2. 记录前镜像
        // 保存到 undolog 表
        undoLogService.save(new UndoLog(
            "account",       // 表名
            before,          // 修改前的数据
            null,            // 修改后的数据（还没执行）
            xid,             // 全局事务 ID
            branchId         // 分支事务 ID
        ));

        // 3. 执行 UPDATE
        jdbcTemplate.update(
            "UPDATE account SET balance = balance - 100 WHERE id = ?", id);

        // 4. 记录后镜像
        Account after = jdbcTemplate.queryForObject(
            "SELECT * FROM account WHERE id = ?", id);
        undoLogService.updateAfterImage(after);
    }
}
```

## 二阶段：自动提交或回滚

二阶段的处理逻辑非常清晰：

```
分支事务成功：
→ 删除前镜像和后镜像，释放行锁

分支事务失败：
→ 读取后镜像数据，使用前镜像数据还原（反向 SQL）
→ 删除镜像，释放行锁
```

```java
/**
 * AT 模式二阶段：自动回滚
 */
public void rollback() {
    // 读取后镜像
    AfterImage afterImage = undoLogService.getAfterImage(branchId);

    // 生成反向 SQL 进行还原
    // UPDATE account SET balance = 1000 WHERE id = 1
    for (DataRecord record : afterImage.getRecords()) {
        String reverseSql = generateReverseSql(record);
        jdbcTemplate.update(reverseSql);
    }

    // 删除镜像记录
    undoLogService.delete(branchId);

    // 释放全局锁
    globalLockService.release(branchId);
}

/**
 * 生成反向 SQL
 *
 * 前镜像：balance = 1000
 * 后镜像：balance = 900
 *
 * 反向 SQL：UPDATE account SET balance = 1000 WHERE id = 1
 */
private String generateReverseSql(DataRecord record) {
    return String.format(
        "UPDATE %s SET %s = %s WHERE %s = %s",
        record.getTableName(),
        record.getPrimaryKey(), record.getBeforeValue(),
        record.getPrimaryKey(), record.getPrimaryKeyValue()
    );
}
```

## 全局锁：隔离性的保障

AT 模式的全局锁，是保证隔离性的关键。

```
全局锁的作用：
- 防止脏写：其他全局事务不能修改同一行数据
- 保证可重复读：在同一个全局事务中，每次读取的数据一致
```

```java
/**
 * 全局锁的实现
 */
public class GlobalLock {

    /**
     * 尝试获取全局锁
     *
     * SELECT * FROM table WHERE pk = ? FOR UPDATE
     * 只有获取全局锁后，才能修改数据
     */
    public boolean tryLock(String tableName, String pk) {
        // 向 Seata TC 注册全局锁
        return tcServer.lock(tableName, pk);
    }

    /**
     * 释放全局锁
     */
    public void unlock(String tableName, String pk) {
        tcServer.unlock(tableName, pk);
    }
}
```

## AT 模式的适用场景

**适用场景：**
- 对性能要求高的分布式事务场景
- 数据库直连的分库分表场景
- 业务代码不想改动的场景

**不适用场景：**
- 多数据库实例之间的分布式事务（Seata 目前主要支持单数据库内的 AT）
- 分库分表中间件（如 ShardingSphere Proxy）
- 非关系型数据库场景

## AT vs XA：核心区别

| 维度 | Seata AT | XA |
|------|----------|-----|
| 协议 | 自研协议 | X/Open XA 规范 |
| 锁粒度 | 行锁 | 行锁 |
| 性能 | 较高（异步删除镜像） | 较低（两阶段提交持锁时间长） |
| 侵入性 | 零侵入（注解） | 需要 XA API |
| 适用场景 | Java + 关系型数据库 | 多数据库 + 多语言 |

## 面试追问方向

**追问 1：AT 模式的全局锁和数据库行锁会冲突吗？**

不会。AT 模式的全局锁由 Seata TC 维护，与数据库行锁是两个独立的概念：
- 数据库行锁：防止并发事务之间的脏写
- 全局锁：防止跨全局事务的脏写

两者配合，共同保证隔离性。

**追问 2：如果二阶段回滚时数据已经被其他事务修改了怎么办？**

AT 模式通过「检查前后镜像是否一致」来保证：
- 如果后镜像与预期一致，说明数据未被修改，可以安全回滚
- 如果后镜像与预期不一致，说明数据已被修改，需要人工介入

这就是 AT 模式在隔离性和性能之间做的折中。

**追问 3：AT 模式的性能瓶颈在哪里？**

主要在：
1. TC 的锁竞争：高并发下，全局锁可能成为瓶颈
2. undolog 的写入：每次修改都要写 undolog
3. TC 和 RM 之间的通信：二阶段通知需要 RPC 调用

实际生产中，建议将 AT 模式用于「高频但数据量小」的场景，避免「低频但数据量大」的场景。

## 总结

Seata AT 模式的核心设计：

1. **零侵入**：业务代码加 `@GlobalTransactional` 注解即可
2. **自动解析 SQL**：一阶段解析 SQL，记录前后镜像
3. **自动回滚**：二阶段通过镜像数据还原
4. **全局锁**：保证跨全局事务的隔离性

AT 模式是分布式事务的「最佳实践」——在一致性、性能和侵入性之间找到了一个很好的平衡点。
