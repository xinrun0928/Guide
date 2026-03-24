# MRR 优化：让随机 I/O 变成顺序 I/O

你有没有想过这个问题：

用非聚簇索引查询时，MySQL 按索引顺序一条一条找主键，然后逐个回表。

问题是：**这些主键值可能是散乱的，回表时会产生大量随机 I/O。**

比如索引查到了主键 100、50000、10、99999... 回表时要跳转 4 个不同的数据页，这就是 4 次随机 I/O。

**MRR（Multi-Range Read，多范围读取）** 就是来解决这个问题的。

---

## MRR 的核心思想

MRR 的原理很简单：**把随机 I/O 变成顺序 I/O**。

索引查询得到主键后，先排序，再按主键顺序回表读取数据。一次磁盘顺序读取，比多次随机读取快得多。

```
无 MRR：
┌────────────────────────────────────────────────────────────┐
│ 索引查询得到主键：[99, 50001, 1, 88888]                     │
│                                                            │
│ 回表顺序：                                                  │
│ ① 读取主键 99 所在页  ─┐                                   │
│ ② 读取主键 50001 所在页 ─┼─ 4 次随机 I/O                   │
│ ③ 读取主键 1 所在页    ─┤                                   │
│ ④ 读取主键 88888 所在页 ─┘                                   │
└────────────────────────────────────────────────────────────┘

有 MRR：
┌────────────────────────────────────────────────────────────┐
│ 索引查询得到主键：[99, 50001, 1, 88888]                     │
│                                                            │
│ 排序后：[1, 99, 50001, 88888]                              │
│                                                            │
│ 回表顺序：                                                  │
│ ① 按顺序读取 4 个数据 ── 一次顺序 I/O（可能合并成 1 次）   │
└────────────────────────────────────────────────────────────┘
```

---

## MRR 的工作流程

```java
// MRR 伪代码实现
public class MRRDemo {

    /**
     * 带 MRR 的查询流程
     */
    public List&lt;Row&gt; queryWithMRR(Index idx, String condition) {
        // 1. 存储引擎：收集满足条件的 (索引键, 主键) 对
        List&lt;IndexKey&gt; indexKeys = idx.scan(condition);

        // 2. MRR 优化：根据主键排序
        List&lt;IndexKey&gt; sorted = indexKeys.stream()
            .sorted(Comparator.comparing(IndexKey::getPrimaryKey))
            .toList();

        // 3. 按排序后的主键顺序读取数据页（顺序 I/O）
        List&lt;Row&gt; results = new ArrayList&lt;&gt;();
        Set&lt;Long&gt; fetchedPages = new HashSet&lt;&gt;();
        List&lt;Row&gt; pageBuffer = new ArrayList&lt;&gt;();

        for (IndexKey key : sorted) {
            Row row = fetchRowByPrimaryKey(key.getPrimaryKey());

            // 4. 批量预读取优化：一次 I/O 读取相邻数据页
            if (!fetchedPages.contains(row.getPageId())) {
                // 预读取当前页的后续页面
                prefetchAdjacentPages(row.getPageId(), 8);
                fetchedPages.add(row.getPageId());
            }

            results.add(row);
        }

        return results;
    }
}
```

---

## MRR 的触发条件

MRR 不是所有查询都会触发，需要满足以下条件：

1. **使用非聚簇索引**：主键查询直接返回数据，不需要 MRR
2. **查询涉及范围扫描或多个单点查询**：如 `IN`、`BETWEEN`、`>`、`<` 等
3. **优化器判断 MRR 会有收益**

```sql
-- MRR 可能触发的场景
SELECT * FROM orders WHERE id IN (100, 500, 1000);
SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';
SELECT * FROM orders WHERE user_id = 100 AND status = 'paid';

-- MRR 不适用的场景
SELECT id FROM orders WHERE user_id = 100;  -- 只查主键，不需要回表
```

---

## 查看 MRR 是否生效

```sql
EXPLAIN SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';
```

```
无 MRR 时：
+----+-------------+--------+-------+---------------+----------------+
| id | select_type| table  | type  | key           | Extra          |
+----+-------------+--------+-------+---------------+----------------+
|  1 | SIMPLE     | orders | range | idx_created   | Using where    |
+----+-------------+--------+-------+---------------+----------------+

有 MRR 时：
+----+-------------+--------+-------+---------------+----------------------------------------+
| id | select_type| table  | type  | key           | Extra                                  |
+----+-------------+--------+-------+---------------+----------------------------------------+
|  1 | SIMPLE     | orders | range | idx_created   | Using index condition; Using MRR      |
+----+-------------+--------+-------+---------------+----------------------------------------+
```

关键标志：`Using MRR`

---

## MRR + ICP：黄金组合

MRR 经常和索引下推（ICP）一起使用，效果更佳：

```sql
SELECT * FROM orders WHERE user_id = 100 AND created_at > '2024-01-01';
```

**优化流程**：
1. **ICP**：在存储引擎层用 `user_id` 和 `created_at` 过滤（减少回表次数）
2. **MRR**：收集主键后排序，然后顺序回表读取数据（减少随机 I/O）

```
┌────────────────────────────────────────────────────────────┐
│ ICP + MRR 组合优化                                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│ 原始数据：user_id=100 的记录有 10000 条                     │
│ 但 created_at > '2024-01-01' 的只有 100 条                 │
│                                                            │
│ 无优化：回表 10000 次，取 100 条真实数据                    │
│                                                            │
│ ICP 优化：回表前先过滤，只回表 100 次                      │
│                                                            │
│ ICP + MRR 优化：过滤后对 100 个主键排序，1 次顺序 I/O     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## MRR 的性能收益

| 场景 | 无 MRR | 有 MRR | 收益 |
|------|--------|--------|------|
| 1000 条记录分散在 1000 个数据页 | 1000 次随机 I/O | 1-2 次顺序 I/O | **大幅减少 I/O** |
| 1000 条记录集中在 10 个数据页 | 1000 次随机 I/O | 10 次顺序 I/O | **减少 99% I/O** |
| 索引过滤后只剩 1 条 | 1 次随机 I/O | 1 次随机 I/O | **无明显收益** |

---

## 控制 MRR

```sql
-- 开启/关闭 MRR（MySQL 5.6+）
SET optimizer_switch='mrr=on';    -- 开启
SET optimizer_switch='mrr=off';   -- 关闭

-- MRR 缓冲区大小
SET optimizer_switch='mrr_cost_based=on';  -- 优化器自动判断
SET optimizer_switch='mrr_cost_based=off'; -- 强制使用 MRR
```

---

## 面试追问方向

- MRR 和 ICP 有什么区别？分别解决什么问题？
- MRR 适用于什么场景？什么时候 MRR 可能没有收益？
- 如何判断一条 SQL 是否用到了 MRR？

> MRR 主要优化的是回表时的 I/O 模式，ICP 优化的是回表次数。两者配合使用，效果最佳。
