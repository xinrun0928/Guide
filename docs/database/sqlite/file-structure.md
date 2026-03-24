# SQLite 数据库文件结构：Page 与 B-Tree

你有没有想过：一个 10 GB 的 SQLite 数据库，到底是怎么存数据的？

不是分成 10 个文件，不是放在不同的文件夹，就是**一个文件**，整整齐齐地排列着。

答案藏在 SQLite 的核心设计里：**Page（页面）** 和 **B-Tree（B 树）**。

---

## Page：数据库的「一页纸」

SQLite 把整个数据库文件分成固定大小的「页面」，默认大小是 **4 KB**（可配置，最大 65536 字节）。

为什么要分页？

想象一下图书馆：如果 100 万本书全部堆在一起，找一本书得翻遍整个图书馆。但如果把书分成一摞一摞的（每摞 100 本），再按编号排列，查找效率瞬间提升。

Page 就是数据库的「一摞书」。

```java
// 模拟 SQLite 的 Page 结构
public class Page {
    // Page 头部信息（类似目录）
    private short pageType;      // 1=索引页, 2=表 B-Tree 页, 10=WAL 页
    private short freeBlockStart; // 空闲块起始位置
    private int cellCount;       // 本页有多少条记录
    private short cellContentArea; // 内容区起始位置

    // 数据区域
    private byte[] data;

    // 每个数据库文件的第一页（Page 1）是特殊的
    // 它存储了文件头信息：数据库版本、页大小、WAL 信息等
}
```

一个 10 GB 的数据库，实际上就是 **约 260 万个 Page** 的集合。

---

## B-Tree：数据的「高速公路」

有了 Page，还需要一种高效的组织方式。SQLite 使用 **B-Tree** 来组织数据。

但注意：SQLite 用的是 **B-Tree 变种**，不是 MySQL 的 B+Tree。具体来说：

| 类型 | 特点 | SQLite 对应 |
|-----|------|------------|
| B-Tree | 非叶子节点也存储数据 | ❌ SQLite 不用 |
| B+Tree | 叶子节点连成链表，范围查询快 | ✅ MySQL InnoDB |
| B-Tree（SQLite 版） | 所有节点都可能存数据，深度更浅 | ✅ SQLite |

SQLite 的 B-Tree 更接近经典 B-Tree 定义，每个节点都是「数据节点」。

### 表 B-Tree vs 索引 B-Tree

SQLite 中有两种 B-Tree：

**1. 表 B-Tree（Table B-Tree）**

- 存储真正的表数据
- Rowid 是隐式主键（如果没有定义主键）
- 每行数据完整存储在叶子节点

**2. 索引 B-Tree（Index B-Tree）**

- 只存储索引列的值 + Rowid
- 通过 Rowid 回表查找完整数据

```sql
-- 创建一个普通表
CREATE TABLE users (
    id INTEGER PRIMARY KEY,  -- 这个 INTEGER PRIMARY KEY 就是 Rowid
    name TEXT,
    email TEXT
);

-- 创建一个索引
CREATE INDEX idx_email ON users(email);

-- 底层结构：
-- 表 B-Tree：id -> 完整行数据
-- 索引 B-Tree：email -> id（回表查找）
```

---

## 数据页的内部结构

一个典型的 Table B-Tree 页面长这样：

```
+-------------------+
| Page Header (12B) |  页头：类型、指针数量等
+-------------------+
| Cell Pointers     |  单元格指针数组（指向实际数据位置）
| (8B each)         |
+-------------------+
|                   |
| Cell Content      |  实际数据存储区（从后往前增长）
|                   |
+-------------------+
| Freelist          |  删除记录的「回收站」
+-------------------+
```

**为什么 Cell Content 从后往前增长？**

因为插入数据时，指针数组需要动态扩展（往前增长）。如果数据也从前往后增长，就会「撞车」。SQLite 巧妙地让它们从两端向中间生长。

---

## 局部性原理：为什么 SQLite 这么快？

你可能觉得：不就是按页存储吗，有什么稀奇？

关键在于**局部性原理（Locality of Reference）**：

当你查询一条记录时，SQLite 会把这条记录所在的整个 Page 加载进内存。如果下次查询相邻的数据，很可能就在同一个 Page 里，**不需要再次磁盘 I/O**。

```java
// 实际查询过程
public class SQLiteQueryDemo {
    public List&lt;User&gt; findByIdRange(int startId, int endId) {
        List&lt;User&gt; results = new ArrayList&lt;&gt;();

        // SQLite 会先定位到 startId 所在的 Page
        // 假设 Page 大小是 4KB，每页能存约 100 条用户记录
        // 那么从 startId 到 endId 的数据，很可能就在 1-2 个 Page 里
        // 只需要 1-2 次磁盘 I/O！

        return results;
    }
}
```

这就是为什么：顺序读写 SQLite，往往比网络访问远程数据库快几个数量级。

---

## 思考题

1. 如果一个表的数据量超过了一个 Page 能容纳的上限，会发生什么？（提示：树会变深）
2. SQLite 的 B-Tree 深度最多能达到几层？（提示：Page 大小固定，每个节点最多 4000+ 字节）

下一节，我们来聊聊 SQLite 的事务机制——它是怎么在「零运维」的情况下保证数据不出错的？
