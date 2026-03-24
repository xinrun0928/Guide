# SQLite：看似简单，实则暗藏玄机

想象一下这个场景：你的手机存储了几千首歌曲、聊天记录、应用数据，但数据库文件只有几百 MB。没有专门的数据库服务器，没有 DBA 维护，却支撑着每天上万次的读写操作。

这，就是 SQLite。

---

## SQLite 是什么？

SQLite 是一个「零配置、零运维、零成本」的嵌入式数据库。它不是传统意义上的数据库服务器，而是一个**库**，直接编译进应用程序，成为应用的一部分。

你手机上的通讯录、微信的聊天记录、Chrome 浏览器的书签、飞机的飞行记录——很可能都是 SQLite 在背后默默服务。

**关键数据告诉你它的地位：**

- 全世界有超过 **1 万亿（10^12）个** SQLite 数据库实例在运行
- 每一部 iPhone、Android 手机、Mac 电脑都内置了 SQLite
- 每天被执行的 SQLite 语句数量，**超过地球上人口总数**

---

## 核心特性：为什么它能称霸嵌入式？

### 1. 零管理

MySQL 需要安装、配置、优化，SQLite 只需要引入一个 `.c` 文件（或 JAR 包），创建数据库就像创建文件一样简单。

```java
// Java 中使用 SQLite
import java.sql.*;

public class SQLiteDemo {
    public static void main(String[] args) throws Exception {
        // 一个 URL 就是整个数据库
        String url = "jdbc:sqlite:./myapp.db";

        try (Connection conn = DriverManager.getConnection(url)) {
            // 直接建表，没有用户权限、连接池这些概念
            String sql = "CREATE TABLE IF NOT EXISTS users (" +
                         "id INTEGER PRIMARY KEY, " +
                         "name TEXT NOT NULL, " +
                         "email TEXT UNIQUE)";

            try (Statement stmt = conn.createStatement()) {
                stmt.execute(sql);
            }
        }
    }
}
```

没有用户名密码，没有服务进程，没有连接池——一个文件，就是一个世界。

### 2. 单文件存储

整个数据库就是一个文件，可以轻松复制、备份、迁移。你甚至可以把它压缩成 ZIP 发邮件。

### 3. 事务支持（ACID）

别看它小，SQLite 对事务的支持相当完整：

| 特性 | SQLite 实现 |
|-----|------------|
| 原子性（Atomicity） | ✅ 完整支持 |
| 一致性（Consistency） | ✅ 支持，强制约束 |
| 隔离性（Isolation） | ✅ 支持，默认串行化 |
| 持久性（Durability） | ✅ 默认 fsync() 持久化 |

这意味着什么？你可以像用 MySQL 一样使用事务，rollback、commit 都能正常工作。

### 4. 多种存储引擎

SQLite 提供了多种「锁模式」，适配不同场景：

```sql
-- 默认模式：写操作完全独占数据库
PRAGMA locking_mode = NORMAL;

-- WAL 模式：写操作不阻塞读操作（后面会详细介绍）
PRAGMA journal_mode = WAL;
```

---

## SQLite 不是什么？

说了这么多优点，也要泼点冷水。SQLite 有它的局限性：

| 场景 | SQLite 表现 |
|-----|------------|
| 高并发写入 | ❌ 不擅长，默认串行写入 |
| 多客户端并发修改 | ❌ 单文件限制，天然串行化 |
| 超大规模数据 | ❌ 单数据库文件有上限（约 281 TB，但实际建议 < 100 GB） |
| 网络访问 | ❌ 没有网络接口，不支持远程连接 |
| 复杂查询优化 | ❌ 优化器相对简单 |

---

## SQLite 适合的场景

SQLite 是为**嵌入式场景**设计的：

- **移动应用**：Android、iOS 的本地存储
- **桌面应用**：Electron 应用、浏览器扩展
- **物联网设备**：资源受限的嵌入式系统
- **数据分析**：小规模数据集的快速处理
- **测试环境**：不需要额外部署

反过来说，如果你的应用需要**多进程/多机器同时写入**，或者需要**远程访问数据库**，那还是乖乖用 MySQL、PostgreSQL 吧。

---

## 面试追问方向

- SQLite 的 WAL 模式是什么？和默认模式有什么区别？
- SQLite 如何实现事务的原子性？（提示：和 MySQL 的 redo log 不同）

下一节，我们来深入看看 SQLite 的文件结构——它是如何把海量数据塞进一个小文件里的。
