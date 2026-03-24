# XA 规范与两阶段提交

数据库有一句老话：

**「ACID 是数据库的承诺，分布式事务是让多个数据库一起做出承诺。」**

XA 规范，就是让多个数据库一起做承诺的标准。

## XA 规范是什么

XA 是 X/Open 组织定义的分布式事务标准。

它定义了 **TM（事务管理器）** 和 **RM（资源管理器）** 之间的接口规范。

```
XA 架构：

  TM（事务管理器）
      │
      │ XA 接口
      │
  ┌───┴───┐
  │       │
 RM1     RM2     （资源管理器：数据库、消息队列等）
```

## XA 的核心角色

```
1. AP（Application Program）：应用程序，使用分布式事务的业务代码
2. TM（Transaction Manager）：事务管理器，协调全局事务
3. RM（Resource Manager）：资源管理器，管理分布式事务中的资源
```

## Java XA API

Java 通过 `javax.transaction.xa` 包提供 XA 支持：

```java
import javax.transaction.xa.*;

/**
 * XA 核心接口
 */
public class XAExample {
    
    /**
     * Xid：事务 ID
     * 
     * 包含三部分：
     * - formatId：格式 ID（通常为 0）
     * - gtrid：全局事务 ID
     * - bqual：分支限定符
     */
    public void work() throws XAException {
        // 1. 创建 Xid
        Xid xid = new MyXid(0, "global-transaction-001", "branch-001");
        
        // 2. 获取 XA 资源
        XAResource xaResource = dataSource.getXAResource();
        
        // 3. 加入全局事务
        xaResource.start(xid, XAResource.TMNOFLAGS);
        
        // 4. 执行 SQL
        executeSql();
        
        // 5. 结束分支事务
        xaResource.end(xid, XASuccess);
        
        // 6. 准备提交（Phase 1）
        int prepareResult = xaResource.prepare(xid);
        
        if (prepareResult == XAResource.XA_OK) {
            // 7. 提交（Phase 2）
            xaResource.commit(xid, false);
        } else {
            // 回滚
            xaResource.rollback(xid);
        }
    }
}
```

## 两阶段提交的执行流程

```
Phase 1：Prepare（准备阶段）

  TM ──Prepare──▶ RM1 ──Promise──▶ TM（我准备好了）
  TM ──Prepare──▶ RM2 ──Promise──▶ TM（我准备好了）
  
  RM 做了什么：
  1. 开启本地事务
  2. 执行 SQL，但不提交
  3. 持有行锁
  4. 返回「准备好了」

Phase 2：Commit 或 Rollback

  情况 A：所有 RM 都准备好了
  TM ──Commit──▶ RM1 ──Commit OK──▶ TM
  TM ──Commit──▶ RM2 ──Commit OK──▶ TM
  结果：所有节点都提交

  情况 B：任意 RM 失败了
  TM ──Rollback──▶ RM1 ──Rollback OK──▶ TM
  TM ──Rollback──▶ RM2 ──Rollback OK──▶ TM
  结果：所有节点都回滚
```

## MySQL XA 的具体实现

```sql
-- MySQL XA 事务示例

-- Phase 1：Prepare
XA BEGIN 'global-transaction-001';
UPDATE account SET balance = balance - 100 WHERE id = 1;
XA END 'global-transaction-001';
XA PREPARE 'global-transaction-001';

-- Phase 2：Commit（如果所有节点都 Prepare 成功）
XA COMMIT 'global-transaction-001';

-- 或者：Rollback（如果任意节点失败）
XA ROLLBACK 'global-transaction-001';
```

```java
/**
 * MySQL XA 事务实现
 */
public class MySQLXATransaction {
    
    private DataSource dataSource;
    
    /**
     * 执行 XA 事务
     */
    public void executeXA() throws SQLException {
        Connection conn = dataSource.getConnection();
        
        try {
            // 1. 开启 XA 事务
            conn.setAutoCommit(false);
            ((XAConnection) conn.getMetaData()).getXAResource()
                .start(new XidImpl(1, "gtrid".getBytes(), "bqual".getBytes()), 0);
            
            // 2. 执行 SQL
            conn.createStatement().executeUpdate(
                "UPDATE account SET balance = balance - 100 WHERE id = 1"
            );
            
            // 3. 结束分支事务
            ((XAConnection) conn.getMetaData()).getXAResource().end(
                new XidImpl(1, "gtrid".getBytes(), "bqual".getBytes()),
                XAResource.TMSUCCESS
            );
            
            // 4. Prepare
            int prepare = ((XAConnection) conn.getMetaData()).getXAResource().prepare(
                new XidImpl(1, "gtrid".getBytes(), "bqual".getBytes())
            );
            
            // 5. Commit 或 Rollback
            if (prepare == XAResource.XA_OK) {
                ((XAConnection) conn.getMetaData()).getXAResource().commit(
                    new XidImpl(1, "gtrid".getBytes(), "bqual".getBytes()),
                    false
                );
            } else {
                ((XAConnection) conn.getMetaData()).getXAResource().rollback(
                    new XidImpl(1, "gtrid".getBytes(), "bqual".getBytes())
                );
            }
            
        } finally {
            conn.setAutoCommit(true);
        }
    }
}
```

## XA 的三大缺陷

### 缺陷一：同步阻塞

XA 最大的问题是**同步阻塞**。

```
同步阻塞的原因：
- Prepare 阶段，所有 RM 必须持锁等待
- 在 Prepare 和 Commit 之间，锁一直被持有
- 其他事务无法修改这些行

时间估算：
- 每个 RM 的 Prepare：10ms
- 5 个 RM 的 Prepare：50ms
- 锁持有时间 = 50ms + 网络延迟 + Commit 时间
```

### 缺陷二：单点问题

如果 TM（协调者）在 Phase 1 和 Phase 2 之间崩溃：

```
场景：
1. RM1 和 RM2 都已经 Prepare 成功
2. TM 发送 Commit 前崩溃了
3. RM1 和 RM2 都不知道该怎么办

结果：
- RM1 提交了
- RM2 等待 TM 的指令
- 数据不一致！

MySQL 的解决方案：
- RM 会持久化 XID 和状态
- TM 恢复后，重新发送指令
- 但如果 TM 永久崩溃，问题依然存在
```

### 缺陷三：数据不一致

即使 TM 不崩溃，XA 也可能出现数据不一致：

```
场景：
1. TM 发送 Commit 给 RM1（RM1 提交成功）
2. TM 发送 Commit 给 RM2（RM2 没收到，TM 崩溃）
3. RM1 提交了，RM2 未提交

结果：数据不一致
```

## XA vs Seata AT：核心区别

| 维度 | XA | Seata AT |
|------|-----|---------|
| 协议 | X/Open 标准 | Seata 自研 |
| 锁粒度 | 行锁 | 行锁 |
| 锁持有时间 | 长（Prepare 到 Commit） | 短（一阶段结束就释放） |
| 性能 | 差 | 中等 |
| 侵入性 | 需要 XA API | 注解（零侵入） |
| TM 位置 | 通常在应用层 | 独立 TC 服务 |
| 适用场景 | 多数据库 + 多语言 | Java + 关系型数据库 |

## XA 的适用场景

```
XA 适合的场景：
- 多数据库实例之间的强一致事务
- 需要与异构资源（数据库 + MQ）一起参与事务
- 对一致性要求极高（金融场景）
- 不在乎性能损耗
```

## 面试追问方向

**追问 1：XA 的性能为什么差？**

1. **锁持有时间长**：从 Prepare 到 Commit，整个阶段都持有锁
2. **同步阻塞**：所有节点必须等待最慢的节点
3. **多次网络往返**：Prepare + Commit，每个 RM 都要两次 RPC

**追问 2：Seata AT 模式是不是 XA 的优化？**

不是完全一样，但有关联：
- AT 模式也用行锁
- AT 模式的锁在 Phase 1 结束后就释放了
- AT 模式的回滚是通过 undo log 实现的，不依赖全局协调

**追问 3：MySQL XA 有哪些参数可以优化？**

```properties
# MySQL XA 相关参数
xa_detach_on_prepare = ON    # Prepare 时断开连接
xa_log_space = 1G             # XA 日志空间
innodb_support_xa = ON        # 开启 XA 支持
```

## 总结

XA 规范的核心：
1. **标准接口**：TM 和 RM 之间的通信标准
2. **两阶段提交**：Prepare + Commit/Rollback
3. **强一致性**：所有节点要么全部提交，要么全部回滚

XA 的代价：
1. **同步阻塞**：锁持有时间长
2. **单点问题**：TM 崩溃可能导致数据不一致
3. **性能差**：不适合高并发场景

选择建议：
- 金融场景、高一致性要求：选 XA
- 普通业务场景：选 Seata AT/TCC
