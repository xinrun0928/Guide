# ReadView：MVCC 的快照相机

如果说 MVCC 是时间魔法，那 ReadView 就是那台相机。

每当你执行一个快照读，MySQL 就用 ReadView「拍一张照片」，记录下当前时刻数据库的状态。

然后无论数据后来怎么变化，你看到的都是这张「照片」里的内容。

---

## ReadView 的组成

ReadView 包含 4 个关键字段：

```java
public class ReadView {
    // 事务 ID 生成器的当前值，表示已分配的最大事务 ID + 1
    private long m_low_limit_id;

    // 活跃事务 ID 列表（未提交的事务）
    private List&lt;Long&gt; m_ids;

    // 创建这个 ReadView 的事务 ID
    private long m_creator_trx_id;

    // 活跃事务的最小 ID（m_ids 中的最小值）
    private long m_low_limit_id;  // 实际上是 min_trx_id
}
```

简化理解：

| 字段 | 说明 | 作用 |
|------|------|------|
| `min_trx_id` | 活跃事务的最小 ID | 小于这个 ID 的事务都已提交 |
| `max_trx_id` | 活跃事务的最大 ID + 1 | 大于等于这个 ID 的事务还未开始 |
| `m_ids` | 活跃事务 ID 列表 | 这些事务的修改对当前 ReadView 不可见 |
| `creator_trx_id` | 当前事务 ID | 自己的修改对自己可见 |

---

## ReadView 的可见性判断

当读取一行数据时，MySQL 根据以下规则判断该版本的可见性：

```java
public class ReadView {

    /**
     * 判断一行数据的某个版本是否对当前 ReadView 可见
     */
    public boolean isVisible(long rowTrxId) {
        // 规则 1：自己的修改对自己可见
        if (rowTrxId == creatorTrxId) {
            return true;
        }

        // 规则 2：小于 min_trx_id，说明事务已提交，可见
        if (rowTrxId < minTrxId) {
            return true;
        }

        // 规则 3：大于等于 max_trx_id，说明事务在当前 ReadView 创建之后才开始
        if (rowTrxId >= maxTrxId) {
            return false;
        }

        // 规则 4：在 min 和 max 之间，看是否在活跃列表中
        if (mIds.contains(rowTrxId)) {
            return false;  // 在活跃列表中，说明还未提交，不可见
        }

        return true;  // 不在活跃列表中，说明已提交，可见
    }
}
```

### 判断流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                    ReadView 可见性判断                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  读取一行数据（rowTrxId = 事务 ID）                              │
│                          ↓                                      │
│              rowTrxId == creatorTrxId？                         │
│                    /            \                               │
│                  Yes              No                           │
│                   ↓                ↓                            │
│              返回可见          rowTrxId < minTrxId？            │
│                                 /            \                   │
│                               Yes              No               │
│                                ↓                ↓              │
│                           返回可见      rowTrxId >= maxTrxId？  │
│                                           /            \        │
│                                         Yes              No      │
│                                          ↓                ↓      │
│                                     返回不可见      rowTrxId in mIds？  │
│                                                     /        \   │
│                                                   Yes          No   │
│                                                    ↓            ↓   │
│                                              返回不可见    返回可见  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## ReadView 的生成时机

这是 RC 和 RR 隔离级别最大的区别：

```java
public class MVCC {

    // Read Committed：每次快照读都生成新 ReadView
    public ResultSet queryRC(Connection conn, String sql) {
        ReadView readView = createReadView();  // 每次都新建
        return executeWithReadView(sql, readView);
    }

    // Repeatable Read：只在事务开始时生成一次 ReadView
    public ResultSet queryRR(Transaction tx, String sql) {
        if (tx.getReadView() == null) {
            tx.setReadView(createReadView());  // 只在第一次读取时创建
        }
        return executeWithReadView(sql, tx.getReadView());
    }
}
```

---

## 实际案例分析

### 场景

```
时间线：

T1: 事务 100 开始
T2: 事务 101 开始
T3: 事务 101: UPDATE users SET age = 30 WHERE id = 1;
T4: 事务 100: SELECT age FROM users WHERE id = 1;  -- 第一次读取
T5: 事务 101: COMMIT;
T6: 事务 100: SELECT age FROM users WHERE id = 1;  -- 第二次读取
T7: 事务 100: COMMIT;
```

### Read Committed 下的 ReadView

```
T4 时刻（第一次读取）：
- min_trx_id = 100
- max_trx_id = 102  （事务 101 还未提交，所以 101 还在活跃列表中）
- m_ids = [100, 101]  （事务 101 未提交）
- 读取 age = 25（旧值）

T6 时刻（第二次读取）：
- min_trx_id = 100
- max_trx_id = 102  （事务 101 已提交，不再活跃）
- m_ids = [100]  （只有当前事务）
- 读取 age = 30（新值）

结果：不可重复读
```

### Repeatable Read 下的 ReadView

```
T4 时刻（事务开始，第一次读取）：
- min_trx_id = 100
- max_trx_id = 102
- m_ids = [100, 101]  （事务 101 未提交）
- 创建 ReadView#1

T6 时刻（复用 ReadView#1）：
- 仍使用 ReadView#1，m_ids = [100, 101]
- 事务 101 的修改对 ReadView#1 不可见
- 读取 age = 25（旧值）

结果：可重复读
```

---

## ReadView 与 Undo Log 的配合

当 ReadView 判断某个版本不可见时，会通过 `DB_ROLL_PTR` 找到更早的版本：

```java
public class RowVersion {
    /**
     * 获取对当前 ReadView 可见的行数据版本
     */
    public Row getVisibleVersion(ReadView readView) {
        Row current = this;

        // 沿着版本链向前找，直到找到可见的版本
        while (current != null) {
            if (readView.isVisible(current.getTrxId())) {
                return current;  // 找到了可见版本
            }
            // 不可见，通过回滚指针找更早的版本
            current = current.getPreviousVersion();
        }

        return null;  // 所有版本都不可见
    }
}
```

---

## 面试追问方向

- ReadView 中的 `max_trx_id` 为什么是「活跃事务最大 ID + 1」而不是「全局最大事务 ID」？
- 如果一个事务执行了 1 个小时，期间 ReadView 一直不变化，会有什么问题？
- 什么时候 ReadView 会被更新？

> 提示：ReadView 的更新时机取决于隔离级别。Read Committed 每次读取都会重新生成，而 Repeatable Read 在某些情况下（如执行 DDL 语句）也会生成新的 ReadView。
