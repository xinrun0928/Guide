# MVCC：TiKV 的并发控制与快照隔离

你在电商网站下单，支付完成后查询订单状态，显示「已支付」。

但问题是：支付成功和查询之间，可能有其他事务也在修改这个订单。如果没有任何隔离机制，你可能查到「支付中」或者「超时关闭」。

**这就是数据库并发控制要解决的问题。**

TiKV 使用 MVCC（Multi-Version Concurrency Control，多版本并发控制）来解决并发问题。它让每个事务看到的数据都有一个「快照版本」，互相不干扰。

## MVCC 是什么？

**核心思想：同一份数据，保存多个历史版本。**

每次修改不是「覆盖」，而是「创建新版本」。事务根据时间戳读取自己应该看到的版本。

```java
// MVCC 的核心概念
public class MVCCEngine {
    // 数据不再只有一个值，而是有多个版本
    // Key: user_id=123
    // Value: [version1, version2, version3, ...]

    // 写入时不覆盖，创建新版本
    public void put(String key, byte[] value, long txnStartTs) {
        // start_ts 是事务开始时 PD 分配的时间戳
        // 每次写入产生一个新版本
        MVCCVersion newVersion = new MVCCVersion(key, txnStartTs, value);
        storage.addVersion(newVersion);
    }

    // 读取时根据 start_ts 获取对应版本
    public byte[] get(String key, long startTs) {
        // 返回所有 commit_ts <= startTs 的最新版本
        return findVersion(key, startTs);
    }
}
```

## TiDB 的时间戳：TSO

TiKV 的 MVCC 依赖 PD 分配的全局唯一时间戳。这个时间戳叫做 TSO（Timestamp Oracle）。

```java
// PD 分配的时间戳
public class Timestamp {
    private final long physical;  // 物理时间（毫秒）
    private final long logical;   // 逻辑时间（微递增）

    // 一次 SQL 事务会分配两个时间戳：
    // - start_ts: 事务开始时间
    // - commit_ts: 事务提交时间
}
```

为什么需要两个时间戳？

```
事务 A (start_ts=100, commit_ts=105)
    │
    ├── 写入 Key=X, Value="A"
    │   版本：(start_ts=100, commit_ts=105)

事务 B (start_ts=102, commit_ts=103)
    │
    ├── 读取 Key=X
    │   看到：(commit_ts <= 102) 的最新版本
    │   如果 X 之前被事务 C 提交（commit_ts=101）
    │   则 B 看到 C 提交的旧值
    │
    ├── 写入 Key=X, Value="B"
    │   版本：(start_ts=102, commit_ts=103)
```

**这就是快照隔离（Snapshot Isolation）的核心——事务看到的是事务开始时的「数据库快照」。**

## MVCC 的存储结构

TiKV 底层使用 RocksDB 的 LSM-Tree，MVCC 的多版本数据怎么存储？

```java
// TiKV 的 Key 编码格式
public class MVCCKeyEncoder {
    // Key = user_key + start_ts
    // 当 start_ts = 0 时，表示当前版本（未删除）

    public byte[] encode(String userKey, long startTs) {
        // 编码格式：user_key + "_" + (max - start_ts)
        // 用 (max - start_ts) 使得新版本在前面，利于点查
        byte[] userKeyBytes = userKey.getBytes();
        byte[] tsBytes = encodeUint64(Long.MAX_VALUE - startTs);
        return Bytes.concat(userKeyBytes, tsBytes);
    }

    // RocksDB 读取时，可以快速定位到 start_ts 对应的版本
    public MVCCVersion decode(byte[] key) {
        // 解析出 user_key 和 start_ts
        return new MVCCVersion(userKey, Long.MAX_VALUE - extractTs(key));
    }
}
```

**为什么 TiKV 把 start_ts 反过来编码？**

因为 RocksDB 按字典序排序。当 `max - start_ts` 越小（start_ts 越大）时，编码后越小，新版本排在前面。点查时只需从前往后扫描，第一个匹配的就是最新版本。

## 事务隔离级别

TiDB 默认使用快照隔离（Snapshot Isolation），类似 MySQL 的可重复读（Repeatable Read），但实现不同。

```java
// TiDB 的隔离级别实现
public class IsolationLevel {
    // 快照隔离（Snapshot Isolation）
    // 事务看到的是 start_ts 时刻的数据库快照
    // 不存在脏读、不可重复读

    public byte[] get(String key, long startTs) {
        // 返回 commit_ts <= startTs 的最新版本
        // 即事务开始时已经提交的数据
        return mvccStorage.get(key, startTs);
    }

    // 写写冲突：检查 start_ts 到当前的最大 commit_ts
    // 如果有重叠，说明两个事务并发写过同一行
    // TiDB 会让后提交的事务回滚（Write-Write Conflict）
    public boolean hasWriteConflict(String key, long startTs) {
        long maxCommitTs = mvccStorage.getMaxCommitTs(key);
        return maxCommitTs > startTs;  // 有事务在你之后提交
    }
}
```

### MVCC 与隔离级别对比

| 隔离级别 | TiDB 实现 | 说明 |
|---------|----------|------|
| 读未提交 | 不支持 | 几乎不用 |
| 读已提交 | 不支持 | 可能看到事务中间状态 |
| 可重复读 | Snapshot Isolation | TiDB 默认，与 MySQL 有差异 |
| 串行化 | 不支持 | 最高隔离，性能差 |

## GC：垃圾回收机制

MVCC 会保存多个历史版本，数据会越来越多。TiKV 使用 GC（Garbage Collection）来清理过期版本。

```java
// TiKV GC 机制
public class GCManager {
    // TiDB 定期触发 GC，TiKV 执行清理

    // GC Safe Point = 当前时间 - TTL
    // 只清理 commit_ts < Safe Point 且不再被任何快照引用的版本
    private long safePoint = currentTime - TimeUnit.HOURS.toMillis(10);

    // GC 时扫描所有 Key，清理过期版本
    public void gc(long safepoint) {
        for (String key : allKeys()) {
            List&lt;MVCCVersion&gt; versions = getAllVersions(key);
            List&lt;MVCCVersion&gt; toDelete = new ArrayList&lt;&gt;();

            // 保留：commit_ts >= safepoint 的版本
            // 保留：可能被未结束事务引用的版本
            // 其他：可以安全删除
            for (MVCCVersion v : versions) {
                if (v.getCommitTs() &lt; safepoint &amp;&amp; !isReferenced(v)) {
                    toDelete.add(v);
                }
            }
            deleteVersions(toDelete);
        }
    }
}
```

**GC 的触发频率和 TTL 设置需要根据业务场景调整：**
- 长时间运行的事务需要更大的 TTL
- GC 太频繁会有 CPU 开销
- GC 太慢会占用过多存储空间

## Prewrite + Commit 两阶段提交

TiDB 的分布式事务使用两阶段提交：

```java
// TiDB 的两阶段提交
public class TwoPhaseCommit {
    public void execute(Transaction txn) {
        // ============ 阶段 1: Prewrite ============
        long startTs = pd.getTimestamp();

        for (KeyValue mutation : txn.mutations()) {
            // 检查是否有写写冲突
            // 如果有另一个事务在 (startTs, +∞) 写过同一行，冲突
            if (mvcc.hasWriteConflict(mutation.key(), startTs)) {
                throw new WriteConflictException();
            }

            // Prewrite：写入数据 + lock
            // 写入格式：Key + startTs = value
            mvcc.prewrite(mutation.key(), mutation.value(), startTs);
        }

        // ============ 阶段 2: Commit ============
        long commitTs = pd.getTimestamp();

        for (KeyValue mutation : txn.mutations()) {
            // Commit：写入 commit_ts，释放锁
            // 写入格式：Key + startTs (作为 lock) + commit_ts
            mvcc.commit(mutation.key(), startTs, commitTs);
        }
    }
}
```

**两阶段提交保证了分布式事务的原子性——要么全部提交，要么全部回滚。**

但两阶段提交也是 TiDB 分布式事务延迟高的原因。如果跨多个 Region，需要等待所有 Region 完成 Prewrite 才能 Commit。

## 面试追问

**Q: TiDB 的可重复读和 MySQL 的有什么区别？**

MySQL 使用 Next-Key Lock 实现可重复读，可以锁住索引范围（包括未存在的记录），避免幻读。

TiDB 使用快照隔离，不锁范围，只检查已存在的行的写冲突。但 TiDB 5.0+ 提供了 RC 隔离级别下的锁读（For Update）来支持写入。

**Q: MVCC 能完全解决并发问题吗？**

不能。MVCC 主要解决读读和读写并发。写写并发仍需要通过锁或冲突检测来处理。TiDB 使用「乐观锁」——检测到写写冲突后让后提交的事务回滚。

**Q: 为什么 TiDB 不支持串行化隔离级别？**

实现成本高，性能差。串行化需要全局锁或严格的时间戳排序，会严重影响 TiDB 的分布式写入性能。对于绝大多数业务，快照隔离已经足够。

---

## 总结

MVCC 是 TiKV 并发控制的基石。通过保存多个数据版本，让每个事务看到一致的数据库快照，既保证了隔离性，又避免了读写冲突导致的阻塞。

理解 MVCC 的时间戳机制、两阶段提交和 GC 回收，是深入理解 TiDB 分布式事务的关键。
