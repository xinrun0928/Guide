# 自适应 Hash 索引：InnoDB 的隐藏加速器

你有没有注意到这个问题：

InnoDB 的默认索引是 B+ 树，但我们都知道 Hash 索引的等值查询是 O(1)，比 B+ 树的 O(log n) 快得多。

那为什么 InnoDB 不用 Hash 索引？

**答案：InnoDB 其实有 Hash 索引，但它藏得很深——自适应 Hash 索引（Adaptive Hash Index，简称 AHI）。**

---

## 自适应 Hash 索引是什么？

自适应 Hash 索引是 InnoDB 自动管理的内部机制，无需手动创建。

当 InnoDB 发现某些 B+ 树索引被频繁访问时，会自动为这些热点数据构建 Hash 索引，以加速等值查询。

```
┌────────────────────────────────────────────────────────────┐
│  Adaptive Hash Index 工作原理                              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  B+ 树索引：频繁访问的热点数据                              │
│  ┌─────────────────────────────────┐                       │
│  │ [key=100] → [key=200] → [key=300]│                       │
│  │     ↓         ↓         ↓      │                       │
│  │   数据       数据       数据   │                       │
│  └─────────────────────────────────┘                       │
│                    ↓                                       │
│         InnoDB 监控访问模式                                │
│                    ↓                                       │
│  AHI 构建：热点 key 自动 Hash 索引                         │
│  ┌─────────────────────────────────┐                       │
│  │ hash(key=100) → 数据页指针      │                       │
│  │ hash(key=200) → 数据页指针      │                       │
│  │ hash(key=300) → 数据页指针      │                       │
│  └─────────────────────────────────┘                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

## 为什么是「自适应」？

因为 InnoDB 不能确定哪些索引值得构建 Hash 索引。它会观察 workload，自动判断。

构建 AHI 的条件通常是：
1. 某个 B+ 树页面被访问多次
2. 访问模式符合 Hash 查找的特征（等值查询为主）
3. 表足够大，页面足够热

---

## AHI vs 普通 Hash 索引

| 对比项 | 自适应 Hash 索引 | 显式 Hash 索引（Memory 引擎） |
|--------|-----------------|-------------------------------|
| 是否需要手动创建 | 否，InnoDB 自动管理 | 是 |
| 存储位置 | InnoDB 缓冲池 | 内存表（Memory 引擎） |
| 持久性 | 不持久化，重启后重建 | 可持久化 |
| 适用引擎 | InnoDB | Memory |
| 控制方式 | innodb_adaptive_hash_index 参数 | CREATE INDEX USING HASH |

---

## AHI 的限制

虽然 AHI 能加速查询，但它有几个重要限制：

### 限制一：只支持等值查询

```sql
-- ✅ AHI 能加速
SELECT * FROM orders WHERE id = 100;

-- ❌ AHI 无法加速范围查询
SELECT * FROM orders WHERE id > 100;

-- ❌ AHI 无法加速模糊查询
SELECT * FROM orders WHERE name LIKE '张%';
```

### 限制二：不能用于覆盖索引

```sql
-- 如果查询需要索引外的字段，AHI 不会生效
SELECT name FROM users WHERE id = 1;  -- 可能用 AHI
SELECT * FROM users WHERE id = 1;     -- AHI 不适用（需要回表）
```

### 限制三：占用缓冲池内存

AHI 存储在 InnoDB 缓冲池中，会占用部分内存。如果 AHI 过大会影响缓存命中率。

---

## 查看和监控 AHI

```sql
-- 查看 AHI 使用情况
SHOW ENGINE INNODB STATUS\G

-- 输出示例：
-- ...
-- Hash table size 346679, node heap has 0 buffer(s)
-- Hash table size 346679, node heap has 1 buffer(s), using 1/1/1
-- 0.00 hash searches/s, 10.00 non-hash searches/s
-- ...
```

关键指标：
- `Hash table size`：AHI 节点数量
- `hash searches/s`：Hash 查找次数（高说明 AHI 在发挥作用）
- `non-hash searches/s`：非 Hash 查找次数

---

## AHI 对性能的影响

### 适合 AHI 的场景

- 等值查询极多的 OLTP 场景
- 主键或唯一索引的频繁访问
- 热点数据的高频读取

### 不适合 AHI 的场景

- 范围查询为主的场景（AHI 无效）
- 数据量小、缓存命中率高的场景（AHI 收益不明显）
- 内存紧张的场景（AHI 占用缓冲池内存）

---

## 关闭或调整 AHI

默认情况下 AHI 是开启的。如果有特殊需求，可以调整：

```sql
-- 关闭 AHI（需要重启）
SET GLOBAL innodb_adaptive_hash_index = OFF;

-- 建议：在 benchmark 测试后再决定是否关闭
-- 大多数情况下，AHI 是有益的
```

---

## 面试追问方向

- InnoDB 的 AHI 和 Memory 引擎的 Hash 索引有什么区别？
- 为什么不默认使用 Hash 索引而是 B+ 树？
- AHI 在数据库重启后会怎样？

> AHI 不持久化，重启后会根据访问模式重新构建。
