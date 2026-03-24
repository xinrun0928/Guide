# 达梦数据库索引类型：不止 B+ 树

提到数据库索引，你脑子里是不是立刻浮现出 B+ 树？

但如果你只了解 B+ 树，那你对达梦数据库的索引体系只了解了**一半**。

达梦支持多种索引类型，每种都有它的用武之地。选错索引类型，就像用螺丝刀拧螺丝——能用，但费劲。

## B 树索引：老牌劲旅

达梦的默认索引类型，与 MySQL、Oracle 类似，采用 B+ 树结构。

```sql
-- 单列索引
CREATE INDEX idx_name ON employee(name);

-- 复合索引（最左前缀原则）
CREATE INDEX idx_dept_salary ON employee(dept_id, salary);

-- 唯一索引
CREATE UNIQUE INDEX idx_emp_no ON employee(emp_no);
```

**B 树索引的适用场景：**

- 等值查询（`WHERE name = '张三'`）
- 范围查询（`WHERE salary BETWEEN 5000 AND 10000`）
- 排序操作（`ORDER BY name`）
- 前缀匹配（`WHERE name LIKE '张%'`）

**B 树索引的底层结构：**

B+ 树是一种多路平衡查找树，叶子节点存储所有数据（或者指向数据的指针），非叶子节点只存储索引键。树的高度通常控制在 3-4 层，这意味着查询最多只需 3-4 次 I/O。

```java
// B 树索引查询的 Java 模拟
public class BTreeIndexSearch {

    /**
     * 模拟 B 树索引的查找过程
     * 实际上，数据库会沿着根节点 -> 非叶子节点 -> 叶子节点的路径查找
     */
    public Integer search(int targetKey, List&lt;Integer&gt; indexKeys) {
        // 第一层：根节点查找，确定目标在哪个子树
        int node = findRootNode(targetKey, indexKeys);

        // 第二层：叶子节点查找
        // 实际数据库中，叶子节点之间有双向链表，便于范围扫描
        return binarySearch(node, targetKey);
    }
}
```

## HASH 索引：等值查询的火箭

HASH 索引通过哈希函数直接定位数据，理论时间复杂度是 O(1)。

```sql
-- 创建 HASH 索引
CREATE INDEX idx_session ON user_session(session_token) USING HASH;
```

**HASH 索引的适用场景：**

- **等值查询**：如 `WHERE session_token = 'abc123'`
- **唯一性校验**：适合高选择性的列
- **内存数据库**：In-Memory HASH 索引查询速度极快

**HASH 索引的致命弱点：**

1. **不支持范围查询**：`WHERE id > 100` 无法使用 HASH 索引
2. **不支持排序**：无法用于 `ORDER BY` 操作
3. **哈希冲突**：极端情况下性能会退化

## 位图索引：枚举类型的杀手锏

达梦支持位图索引（Bitmap Index），特别适合**低基数列**（枚举值少）。

```sql
-- 为性别、状态等低基数列创建位图索引
CREATE BITMAP INDEX idx_gender ON employee(gender);
CREATE BITMAP INDEX idx_status ON order_header(status);
```

**位图索引的工作原理：**

假设有 100 万条员工记录，其中 `gender` 只有两个值：男、女。

```
男：0 1 0 0 1 1 0 ... （0 表示女，1 表示男）
女：1 0 1 1 0 0 1 ... （与男相反）
```

每个值对应一个位图，查询时直接用位运算：

```java
// 位图索引的 AND 运算模拟
public class BitmapIndexExample {

    // 模拟位图：假设 8 条记录
    int[] maleBitmap = {0b01001100};   // 男员工位图
    int[] activeBitmap = {0b10101010}; // 在职员工位图

    // 查询：在职男员工
    // 男性 AND 在职 = 01001100 & 10101010 = 00001000
    public int[] andOperation(int[] bitmap1, int[] bitmap2) {
        int[] result = new int[bitmap1.length];
        for (int i = 0; i < bitmap1.length; i++) {
            result[i] = bitmap1[i] & bitmap2[i];
        }
        return result;
        // 结果位图中为 1 的位置，就是符合条件的记录
    }
}
```

**位图索引的适用场景：**

- 枚举类型列（性别、状态、类别）
- 多条件组合查询（位运算极快）
- 数据仓库的 OLAP 场景

**位图索引的问题：**

- 更新代价高：插入/删除一条记录需要更新多个位图
- 不适合高并发写入的 OLTP 系统

## 函数索引：让计算结果可索引

有时候需要索引的不是列本身，而是**计算结果**。

```sql
-- 索引 email 列的大写形式（忽略大小写的查询）
CREATE INDEX idx_email_upper ON employee(UPPER(email));

-- 索引日期的年份（按年份查询时高效）
CREATE INDEX idx_year ON orders(YEAR(order_date));

-- 表达式索引
CREATE INDEX idx_total ON order_detail(quantity * unit_price);
```

```java
// 函数索引的使用示例
public class FunctionIndexUsage {

    // 查询时自动使用函数索引
    public void queryExample() {
        String sql = "SELECT * FROM employee WHERE UPPER(email) = 'ZHANG@EXAMPLE.COM'";
        // Oracle、达梦等会使用 idx_email_upper 索引
        // 普通 B 树索引无法用于 UPPER(column) 的查询
    }
}
```

## 索引类型选择指南

| 索引类型 | 适用场景 | 不适用场景 |
|---------|---------|-----------|
| B 树索引 | 等值、范围、排序、前缀匹配 | 枚举类、低选择率列 |
| HASH 索引 | 等值查询、高性能内存数据库 | 范围查询、排序 |
| 位图索引 | 枚举列、组合查询、OLAP | 高并发写入、基数高 |
| 函数索引 | 计算列查询、大小写不敏感查询 | 普通查询 |

## 面试追问方向

- 什么情况下复合索引会失效？达梦的复合索引有什么特点？
- 位图索引在高并发写入场景下会有什么问题？如何解决？

---

## 一句话总结

索引不是越多越好，也不是只有 B+ 树。选对索引类型，等值查询用 HASH、枚举查询用位图、表达式查询用函数——让每一分索引都花在刀刃上。
