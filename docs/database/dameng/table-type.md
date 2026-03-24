# 达梦数据库表类型：HEAP 与 HFS 存储的秘密

你有没有好奇过，同样是存储数据，为什么有些表查询快、有些表写入快？

这不是玄学，而是表类型在起作用。

达梦数据库支持两种表组织方式：**堆表（HEAP TABLE）**和**HFS 表（HASH FILE SCAN TABLE）**。选对了表类型，查询性能可能提升 10 倍；选错了，索引再好也救不了你。

## 堆表（HEAP TABLE）：无序的「杂货铺」

堆表是达梦的默认表类型，数据按**插入顺序**存储，页内无序。

```sql
-- 创建堆表（默认方式）
CREATE TABLE t_heap (
    id INT PRIMARY KEY,
    name VARCHAR(50)
);

-- 显式指定堆表
CREATE TABLE t_heap2 (
    id INT,
    name VARCHAR(50)
) STORAGE(ONLINE HEAP);
```

**堆表的工作原理：**

数据写入时，像往箱子里扔东西——谁先来谁先占位置，新数据永远追加到表末尾。查询时，数据库只能老老实实扫描所有数据，或者靠索引定位。

**堆表适用场景：**

- 写入为主的表（如日志表、操作记录表）
- 数据量小、全表扫描也能接受的表
- 需要频繁批量插入的表

**堆表的问题：**

范围查询（`WHERE id > 1000 AND id < 5000`）时，即使有索引，也可能因为数据物理分布散乱而导致随机 I/O。数据量越大，这个问题越明显。

## HFS 表（HASH FILE SCAN TABLE）：有序的「图书馆」

HFS 表是达梦的特色表类型，数据按**指定列排序**存储。

```sql
-- 创建 HFS 表，按 ID 列排序存储
CREATE TABLE t_hfs (
    id INT PRIMARY KEY,
    name VARCHAR(50),
    create_time TIMESTAMP
) STORAGE(
    ON HASH(id)
);

-- 按时间字段排序的 HFS 表
CREATE TABLE t_hfs_time (
    id INT,
    create_time TIMESTAMP
) STORAGE(
    ON HASH(create_time)
);
```

**HFS 表的核心优势：**

1. **范围查询极快**：数据按排序列物理有序，范围查询可以利用顺序 I/O，避免大量随机读
2. **减少回表次数**：排序列数据聚集存储，一次 I/O 可能命中多条数据
3. **批量读取友好**：按排序列顺序读取数据，磁盘预读机制能充分发挥作用

**HFS 表的工作原理：**

达梦在创建 HFS 表时，会根据排序列计算数据的分布，将相近的数据页放在一起。就像图书馆的书按字母排序，《哈利波特》全集肯定挨在一起，而不是散落在不同楼层。

```java
// Java 应用中选择表类型的参考逻辑
public class TableTypeSelector {

    public String selectTableType(String tablePurpose, boolean rangeQueryHeavy) {
        if ("log".equals(tablePurpose) || "audit".equals(tablePurpose)) {
            // 日志/审计表：写入多，查询少
            return "HEAP";
        }

        if (rangeQueryHeavy) {
            // 范围查询多的表：时间范围、设备ID范围等
            return "HASH";
        }

        // 默认选择 HFS 表，因为大多数 OLTP 场景下读多于写
        return "HASH";
    }
}
```

## 混合使用：没有银弹

很多人在选表类型时犯了一个错：**要么全用 HEAP，要么全用 HFS**。

正确的思路是**根据表的访问模式来选**：

| 场景 | 推荐表类型 | 原因 |
|------|-----------|------|
| 日志表、操作流水 | HEAP | 写入为主，很少查询历史数据 |
| 时间序列数据 | HFS（按时间排序） | 范围查询按时间顺序访问 |
| 主数据表 | HFS（按主键排序） | 点查询和范围查询都高效 |
| 临时表 | HEAP | 用完即弃，无需关心查询性能 |

## 面试追问方向

- HFS 表的排序字段可以修改吗？修改后会发生什么？
- HFS 表和 MySQL 的聚集索引有什么相似和不同？

---

## 一句话总结

堆表是「先来后到」，HFS 表是「按序排座」。选对了，查询快 10 倍；选错了，索引也救不了你。
