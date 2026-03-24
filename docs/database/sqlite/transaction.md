# SQLite 事务模型与 WAL 模式

一个尴尬的事实：很多程序员用了几十年数据库，却从来没搞清楚「事务」到底是怎么工作的。

他们知道 BEGIN、COMMIT、ROLLBACK，知道 ACID，知道隔离级别——但如果被追问：「事务提交的时候，数据是怎么写到磁盘的？」十个人里有九个会卡壳。

今天，我们用 SQLite 把这个问题彻底搞清楚。

---

## 事务的「魔法」：原子性是怎么实现的？

SQLite 的事务原子性，靠的不是 MySQL 那套复杂的 redo log、undo log，而是更简单、更暴力的方案：

**Shadow Page（影子页）**

原理很简单：

1. 事务开始时，复制一份原页（Shadow Page）
2. 所有修改都在 Shadow Page 上进行
3. 提交时，一次性把 Shadow Page 写回原位置
4. 如果中途崩溃，原始数据完好无损

```java
// 伪代码：SQLite 事务的原子性保证
public class TransactionManager {
    public void commit() {
        // 1. 先把修改写入「中间区域」（磁盘顺序写）
        for (Page modifiedPage : dirtyPages) {
            writeToWalFile(modifiedPage);
        }

        // 2. 标记事务完成
        writeCommitMarker();

        // 3. 最后把脏页写回原位置
        // （如果崩溃发生在这之前，重启后会发现没提交，直接丢弃）
        for (Page modifiedPage : dirtyPages) {
            writeToOriginalLocation(modifiedPage);
        }
    }
}
```

这套机制看起来简单，但有几个关键点：

- **fsync() 调用**：确保数据真正写入磁盘，而不是停留在 OS 缓存
- **文件锁**：确保同一时间只有一个事务在写
- **原子页面写入**：4KB 的 Page 写入是原子的（磁盘硬件保证）

---

## 三种日志模式

SQLite 支持三种日志模式，决定了事务如何记录和恢复：

### 1. DELETE 模式（默认）

```sql
PRAGMA journal_mode = DELETE;
```

事务开始时，创建一个 `.db-journal` 文件，记录所有修改的页面。提交后删除 journal 文件。

如果崩溃发生：
- journal 文件存在且完整 → 重放 journal，恢复修改
- journal 文件不存在或不完整 → 说明没提交，丢弃即可

### 2. TRUNCATE 模式

```sql
PRAGMA journal_mode = TRUNCATE;
```

和 DELETE 类似，但删除 journal 文件时只截断文件头部（更快）。

### 3. PERSIST 模式

```sql
PRAGMA journal_mode = PERSIST;
```

不删除 journal 文件，而是把文件头清零。这样避免了删除/创建文件的开销。

---

## WAL 模式：读不阻塞写

这是 SQLite 3.7.0 引入的重要特性，也是面试高频考点。

```sql
PRAGMA journal_mode = WAL;
```

**核心思想：把「写操作」和「读操作」分开。**

### 传统模式的问题

在 DELETE/TRUNCATE/PERSIST 模式下：

- 事务 A 正在写入：数据库文件被独占锁定
- 事务 B 想读取：必须等待事务 A 提交或回滚

**这就是为什么高并发场景下 SQLite 性能会断崖式下跌。**

### WAL 模式如何解决？

```
┌─────────────────────────────────────────────────┐
│                   数据库文件 (.db)                │
│  存储已提交的数据，叶子节点完整                    │
└─────────────────────────────────────────────────┘
                    ↕ 读写分离
┌─────────────────────────────────────────────────┐
│                WAL 文件 (.db-wal)                │
│  存储未提交的修改（Write-Ahead Log）             │
│  写操作在这里追加，不影响主文件                    │
└─────────────────────────────────────────────────┘
```

**读操作**：读取主数据库文件 + WAL 文件（合并后的视图）

**写操作**：写入 WAL 文件，不锁定主数据库

**提交时**：把 WAL 文件的内容「合并」回主数据库（Checkpoint）

```java
// WAL 模式下的读写示意
public class WalDemo {
    public void write(String sql) {
        // 1. 写入 WAL 文件（追加写，很快）
        appendToWalFile(sql);

        // 2. 提交时，Checkpoint：把 WAL 内容合并回主文件
        if (shouldCheckpoint()) {
            mergeWalToMain();
        }
    }

    public List&lt;Object&gt; read(String sql) {
        // 读取时，自动合并：主文件 + WAL 中的未提交修改
        return queryWithWalMerge(sql);
    }
}
```

### WAL 的优势

| 特性 | 默认模式 | WAL 模式 |
|-----|---------|---------|
| 读操作 | 阻塞写 | 不阻塞写 ✅ |
| 写操作 | 阻塞读 | 不阻塞读 ✅ |
| 并发性能 | 低 | 高 ✅ |
| 磁盘空间 | 较小 | 可能增长（WAL 文件） |
| 崩溃恢复 | 通过 journal 恢复 | 通过 WAL 恢复 |

---

## WAL 的 Checkpoint 时机

WAL 文件不会无限增长，SQLite 会自动触发 Checkpoint：

1. **自动 Checkpoint**：当 WAL 文件达到 1000 页（约 4 MB）时自动触发
2. **手动 Checkpoint**：`PRAGMA wal_checkpoint(FULL);`
3. **连接关闭时**：自动 Checkpoint

```sql
-- 强制 Checkpoint，把 WAL 内容写回数据库
PRAGMA wal_checkpoint(PASSIVE);  -- 不阻塞其他连接
PRAGMA wal_checkpoint(FULL);     -- 完整 Checkpoint，可能阻塞
PRAGMA wal_checkpoint(TRUNCATE); -- Checkpoint 后截断 WAL 文件
```

---

## 事务隔离与隔离级别

SQLite 支持两种隔离级别：

| 隔离级别 | 说明 |
|--------|------|
| DEFERRED（默认） | 事务开始时不获取锁，读操作不阻塞 |
| EXCLUSIVE | 事务开始即获取排他锁，完全独占数据库 |

**注意**：SQLite 的隔离级别比 MySQL 简单得多。在默认的 DEFERRED 模式下：

- 读操作永远不会阻塞其他读操作
- 写操作会在第一次写时获取锁
- 读操作可以看到自己事务中未提交的修改（不隔离自身）

---

## 面试追问方向

- SQLite 的 WAL 模式有没有什么坑？（提示：WAL 文件增长、Checkpoint 阻塞、跨平台兼容性）
- 如果 WAL 文件损坏或丢失了怎么办？（提示：可能导致部分提交丢失）

下一节，我们来聊聊 SQLite 的索引——它是怎么在嵌入式场景下保持高效查询的？
