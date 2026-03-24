# Percolator：分布式事务的两阶段提交

TiDB 的分布式事务，用的是 **Percolator 模型**。

这个名字来自 Google 的一篇论文——2008 年 Google 用 Percolator 构建了 Bigtable 上的增量处理系统。后来 TiDB 借鉴了这个思路，实现了自己的分布式事务。

**Percolator 的核心是：把事务状态存在 KV 存储本身里。**

## 传统两阶段提交的问题

传统的两阶段提交（2PC）需要一个协调者。如果协调者挂了，可能导致事务卡住。

```
传统 2PC：
┌─────────┐         ┌─────────┐         ┌─────────┐
│客户端   │────────▶│协调者   │────────▶│参与者1  │
└─────────┘         └─────────┘         └─────────┘
                           │
                           │ 阶段1: Prepare
                           ▼
                    ┌───────────┐
                    │ 参与者2   │
                    └───────────┘

问题：
- 协调者是单点
- 协调者挂了，事务状态未知
- 参与者挂了，需要人工介入
```

Percolator 的思路是：**不要中心协调者，让每个参与者自己管理事务状态。**

## Percolator 的核心思想

Percolator 用 **KV 存储本身来记录事务状态**，每个 Key 的 Value 不只是一个值，而是包含版本和时间戳。

```java
// Percolator 的数据模型
public class PercolatorData {
    // Percolator 的 Key 包含：
    // - user_key: 业务数据的 Key
    // - start_ts: 事务开始时间戳

    // Value 包含：
    // - commit_ts: 事务提交时间戳
    // - value: 实际数据
    // - lock_by: 锁持有者（哪个事务）
    // - lock_type: 锁类型

    // 示例：
    // Key: "user:1001", start_ts=100
    // Value: {
    //     commit_ts: 105,
    //     value: "Alice's data",
    //     lock: null  // 提交后无锁
    // }

    // 写入中：
    // Key: "user:1001", start_ts=100
    // Value: {
    //     value: "Alice's new data",
    //     lock: {
    //         tx_id: "tx-abc123",
    //         primary_key: "user:1001"  // 主键位置
    //     }
    // }
}
```

## Percolator 事务流程

### Prewrite 阶段

```java
// Prewrite：写入数据 + 锁
public class PercolatorPrewrite {
    public void prewrite(Transaction txn) {
        for (KeyValue mutation : txn.mutations()) {
            // 1. 检查是否有冲突
            // 读取 start_ts 之前最新的已提交版本
            MVCCVersion latest = storage.getLatest(mutation.key());

            if (latest.commit_ts > txn.start_ts) {
                // 有更新在此事务开始之后提交，冲突！
                throw new WriteConflictException();
            }

            // 2. 检查是否有未提交的锁
            Lock lock = storage.getLock(mutation.key());
            if (lock != null && !lock.isMyOwn(txn)) {
                // 有其他事务的锁，冲突！
                throw new LockConflictException();
            }

            // 3. 写入数据 + 锁
            // 锁信息：事务ID、主键位置
            storage.put(
                mutation.key(),
                new PercolatorValue(
                    mutation.value(),
                    txn.start_ts,
                    new Lock(txn.id, txn.primaryKey, LockType.Normal)
                )
            );
        }
    }
}
```

### Commit 阶段

```java
// Commit：释放锁
public class PercolatorCommit {
    public void commit(Transaction txn) {
        // 1. 获取 commit_ts
        long commitTs = pd.getTimestamp();  // TSO

        // 2. 先提交主键（保证原子性）
        commitSingleKey(txn.primaryKey, txn.startTs, commitTs);

        // 3. 再提交其他 Key
        for (KeyValue mutation : txn.mutations()) {
            if (!mutation.key().equals(txn.primaryKey)) {
                commitSingleKey(mutation.key(), txn.startTs, commitTs);
            }
        }
    }

    private void commitSingleKey(byte[] key, long startTs, long commitTs) {
        // 1. 检查锁是否还在
        Lock lock = storage.getLock(key);
        if (lock == null || !lock.isMyOwn(startTs)) {
            // 锁没了，可能已回滚或超时
            throw new CommitFailedException();
        }

        // 2. 写入提交信息（清除锁）
        storage.commit(key, startTs, commitTs);

        // 3. 释放锁
        storage.releaseLock(key, startTs);
    }
}
```

### 关键设计：主键机制

**为什么要有主键（Primary Key）？**

因为 Percolator 采用「延迟提交」策略：Commit 时先提交主键，然后异步提交其他 Key。如果事务中途失败，通过主键可以回滚所有 Key。

```java
// 事务回滚
public class PercolatorRollback {
    public void rollback(Transaction txn) {
        // 扫描所有写入过的 Key
        for (KeyValue mutation : txn.mutations()) {
            // 清除 Prewrite 时留下的锁
            storage.cleanupLock(mutation.key(), txn.startTs);
        }
    }
}

// 清理者：清理过期的事务
public class LockResolver {
    public void resolveExpiredLocks() {
        for (Transaction inProgress : expiredTransactions) {
            // 找到事务的主键
            byte[] primaryKey = inProgress.getPrimaryKey();

            // 检查主键是否已提交
            MVCCVersion primaryVersion = storage.get(primaryKey, inProgress.startTs);
            if (primaryVersion.isCommitted()) {
                // 主键已提交，说明事务成功，异步提交其他 Key
                asyncCommitOtherKeys(inProgress);
            } else {
                // 主键未提交，事务失败，回滚所有 Key
                rollbackTransaction(inProgress);
            }
        }
    }
}
```

## Percolator vs 传统 2PC

| 特性 | 传统 2PC | Percolator |
|-----|----------|------------|
| 协调者 | 需要独立组件 | 不需要 |
| 单点故障 | 有 | 无 |
| 事务状态 | 存在协调者 | 存在 KV 数据本身 |
| 恢复方式 | 协调者恢复 | 任何节点都能恢复 |
| 延迟 | 较高（多一次协调） | 较低（可异步提交） |

## TiDB 的 Percolator 实现

TiDB 基于 Percolator 模型实现了分布式事务：

```java
// TiDB 的事务接口
public class TiDBTransaction {
    // 悲观事务（TiDB 3.0+ 默认）
    // 与乐观事务的区别：在 Prewrite 前就加锁

    public void pessimisticExecute() {
        // 1. For Update 读取（加锁）
        for (KeyValue mutation : mutations) {
            // SELECT FOR UPDATE 自动加锁
            lockManager.lockForUpdate(mutation.key());
        }

        // 2. 修改数据
        // 3. Prewrite + Commit
    }

    // 乐观事务
    // 与悲观事务的区别：不在读取时加锁，提交时检测冲突

    public void optimisticExecute() {
        // 1. 读取（不加锁）
        // 2. 修改数据（本地缓存）
        // 3. Prewrite（检测冲突）
        // 4. Commit
    }
}
```

## 事务隔离与 Percolator

Percolator 的 MVCC 天然实现了**快照隔离（Snapshot Isolation）**：

```java
// 快照隔离读取
public class SnapshotRead {
    public byte[] read(byte[] key, long startTs) {
        // 返回 commit_ts <= startTs 的最新版本
        // 即事务开始时数据库的状态
        return mvccStorage.get(key, startTs);
    }
}
```

**TiDB 默认使用乐观事务**——假设冲突不频繁，提交时检测冲突。如果冲突频繁（高并发写入），建议切换到悲观事务。

## 面试追问

**Q: Percolator 事务的代价是什么？**

主要是网络往返次数。每次写入需要两次 RPC（Prewrite + Commit），跨 Region 时延迟更高。悲观事务在读取时就加锁，减少了冲突重试，但增加了锁等待。

**Q: TiDB 乐观事务和悲观事务怎么选？**

- **乐观事务**：低并发写入、冲突少的场景（如日志、表单提交）
- **悲观事务**：高并发写入、冲突多的场景（如库存扣减、账户转账）

**Q: Percolator 的锁超时后会被清理吗？**

是的。TiDB 有 Lock Resolver 组件，检测到过期锁后会尝试清理——如果主键已提交则异步提交其他 Key，如果主键未提交则回滚。

**Q: TiDB 分布式事务能保证 ACID 吗？**

TiDB 使用 Percolator + Raft，保证的是：
- **原子性**：两阶段提交 + 主键机制
- **一致性**：MVCC + 快照隔离
- **隔离性**：快照隔离（类似 MySQL 可重复读）
- **持久性**：Raft 多数派写入

---

## 总结

Percolator 是 TiDB 分布式事务的基石。它用 KV 存储本身记录事务状态，消除了中心协调者，实现了高可用的分布式事务。

理解 Percolator 的两阶段提交流程、主键机制和冲突处理，有助于你选择合适的事务模式（乐观/悲观），并正确处理分布式事务带来的挑战。
