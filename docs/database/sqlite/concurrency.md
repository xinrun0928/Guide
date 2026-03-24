# SQLite 的并发限制：写锁与数据库锁

很多人在项目中引入 SQLite 后，发现并发写入时性能急剧下降，甚至出现「数据库被锁定」的异常。

```java
try {
    // 抛出了这个异常
    // "SQLITE_BUSY: database is locked"
} catch (SQLException e) {
    e.printStackTrace();
}
```

这背后，是 SQLite 经典的「写锁」问题。

---

## SQLite 的锁模型：五层锁机制

SQLite 的并发控制基于五层锁模型，从低到高：

| 锁级别 | 状态 | 允许的操作 |
|-------|------|-----------|
| UNLOCKED | 无连接访问 | 任意连接读取 |
| SHARED | 读取中 | 多个读取，不允许写入 |
| RESERVED | 写入准备 | 保留写入权限，其他可继续读取 |
| PENDING | 即将写入 | 等待所有读取完成，之后不允许新读取 |
| EXCLUSIVE | 写入中 | 完全独占，不允许任何读写 |

```
时间线 →
                                                                 
连接A:  SHARED ─────── RESERVED ──────────── EXCLUSIVE ─────── SHARED
连接B:       SHARED ────── (等待) ────────────────── (等待) ──
连接C:            SHARED (等待) ────────────────────── (等待) ──
```

**关键点**：只有 EXCLUSIVE 锁状态下，写操作才能真正执行。

---

## 为什么写锁是「全局」的？

这是 SQLite 和 MySQL 最大的设计差异。

**MySQL（InnoDB）的锁粒度：**

- 行锁：只锁定某一行的数据
- 页锁：锁定某个数据页
- 表锁：锁定整张表

**SQLite 的锁粒度：**

- **数据库锁**：锁定整个数据库文件

这意味着：SQLite 的写操作必须独占整个数据库，而 MySQL 可以在锁定某一行数据的同时，让其他连接继续操作同一张表的其他行。

```java
// MySQL：可以同时执行（锁不同行）
Connection conn1 = getConnection();
Connection conn2 = getConnection();
Connection conn3 = getConnection();

// conn1 更新 id=1 的行
// conn2 更新 id=2 的行  <-- 完全并行，无冲突
// conn3 读取 id=3 的行  <-- 读不阻塞写

// SQLite：不能同时执行（锁整个数据库）
Connection conn1 = getConnection();
Connection conn2 = getConnection();

// conn1 开始写入 -> 获取 EXCLUSIVE 锁
// conn2 想读取 -> 必须等待 conn1 释放锁（如果是 WAL 模式则可以）
```

---

## WAL 模式下的并发改善

开启 WAL 模式后，读写可以分离：

```sql
PRAGMA journal_mode = WAL;
```

| 操作类型 | 默认模式 | WAL 模式 |
|---------|---------|---------|
| 读 + 读 | ✅ 并行 | ✅ 并行 |
| 读 + 写 | ❌ 互斥 | ✅ 并行 |
| 写 + 写 | ❌ 互斥 | ❌ 仍互斥 |

**WAL 模式的限制**：

1. 写操作之间仍然是串行的（只有一个写事务能执行）
2. Checkpoint 操作可能短暂阻塞
3. WAL 文件可能增长，需要定期维护

---

## 超时与重试：优雅处理锁冲突

当数据库被锁定时，SQLite 会抛出 `SQLITE_BUSY` 错误。你可以选择：

### 1. 设置超时

```java
// Java 中设置超时
String url = "jdbc:sqlite:./myapp.db";
ConnectionProperties props = new ConnectionProperties(url);
props.setBusyTimeout(5000);  // 等待 5 秒，期间不断重试
```

```sql
-- SQLite 中设置超时
PRAGMA busy_timeout = 5000;  -- 5 秒
```

### 2. 应用层重试

```java
public void executeWithRetry(Connection conn, String sql, int maxRetries) {
    int attempts = 0;
    while (attempts < maxRetries) {
        try {
            conn.createStatement().execute(sql);
            return;  // 成功退出
        } catch (SQLException e) {
            if (e.getErrorCode() == SQLITE_BUSY && attempts < maxRetries - 1) {
                attempts++;
                try {
                    Thread.sleep(100 * attempts);  // 指数退避
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new RuntimeException(ie);
                }
            } else {
                throw e;  // 重试次数用完，抛出异常
            }
        }
    }
}
```

### 3. 使用独占事务（谨慎）

```sql
-- 开始独占事务
BEGIN EXCLUSIVE;
-- 执行操作
COMMIT;
```

这会立即获取 EXCLUSIVE 锁，如果获取失败立即报错。适合批量导入等场景。

---

## 并发写入的替代方案

如果你的应用确实需要高并发写入，SQLite 可能不是最佳选择。但在此之前，可以考虑：

### 方案一：连接池 + 队列化

把所有写操作放入队列，由单一连接串行执行：

```java
public class SerializedWriter {
    private final BlockingQueue&lt;WriteTask&gt; queue = new LinkedBlockingQueue&lt;&gt;();

    public SerializedWriter(Connection conn) {
        // 单一写线程
        Thread writer = new Thread(() -> {
            while (true) {
                try {
                    WriteTask task = queue.take();
                    task.execute(conn);
                    task.getFuture().complete(null);
                } catch (Exception e) {
                    task.getFuture().completeExceptionally(e);
                }
            }
        });
        writer.start();
    }

    public &lt;T&gt; Future&lt;T&gt; enqueue(WriteTask&lt;T&gt; task) {
        queue.offer(task);
        return task.getFuture();
    }
}
```

### 方案二：分库分表

多个 SQLite 文件，按业务键分片：

```java
public class ShardedSQLite {
    private final SQLite[] shards;
    private final int shardCount;

    public ShardedSQLite(int shardCount) {
        this.shards = new SQLite[shardCount];
        for (int i = 0; i < shardCount; i++) {
            shards[i] = new SQLite("shard_" + i + ".db");
        }
        this.shardCount = shardCount;
    }

    public SQLite getShard(String key) {
        int hash = key.hashCode() & Integer.MAX_VALUE;
        return shards[hash % shardCount];
    }

    public void write(String key, String sql) {
        getShard(key).exec(sql);
    }
}
```

---

## 面试追问方向

- SQLite 有没有行锁？（提示：没有，它是文件级锁）
- WAL 模式下，如果 Checkpoint 和写入同时发生会怎样？（提示：Checkpoint 会被延迟）

下一节，我们来聊聊 SQLite 在 Android 开发中的应用。
