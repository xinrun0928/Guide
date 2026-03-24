# MongoDB 锁机制：深入 WiredTiger 存储引擎

你可能听说过：MongoDB 使用 WiredTiger 引擎，支持文档级锁。

但你真的理解这个锁是怎么工作的吗？

这把锁，比你想象的要复杂得多。

---

## WiredTiger 引擎简介

WiredTiger 是 MongoDB 3.0+ 默认的存储引擎，它有三大特性：

| 特性 | 说明 |
|-----|------|
| B-Tree 索引 | 支持多种索引类型 |
| MVCC | 多版本并发控制 |
|Checkpoint | 定期将内存数据刷到磁盘 |

**MVCC（Multi-Version Concurrency Control）** 是理解 MongoDB 并发的关键。

---

## MVCC：多版本并发控制

### 什么是 MVCC？

MVCC 允许同一份数据有多个版本，每个事务看到的是特定版本的数据。

```
时间线：
T1: 用户A读取 doc v1（balance = 1000）
T2: 用户B修改 doc v2（balance = 2000）
T3: 用户A再次读取，读到 v1 还是 v2？
```

**取决于隔离级别：**
- `local`：可能读到 v1 或 v2
- `majority`：读到已确认的版本
- `snapshot`：只读事务开始时的版本

### WiredTiger 的实现

```c
// 内部结构（简化理解）
struct WT_PAGE {
    uint64_t txnid;           // 最后修改的事务ID
    uint64_t version;         // 版本号
    char data[];              // 实际数据
    WT_UPDATE *updates[];     // 未提交的更新链表
}
```

---

## 锁的类型

WiredTiger 使用多种锁来控制并发：

### 全局锁

最粗粒度的锁，用于：
- 创建/删除数据库
- 关闭 WiredTiger
- 恢复（Recovery）

### 数据库锁

每个数据库一把锁，用于：
- 创建/删除集合
- 创建/删除索引

### 集合锁

每个集合一把锁，锁模式：
- **SHARED**：读操作
- **INTENTION_SHARED**：读操作（预留）
- **EXCLUSIVE**：写操作
- **INTENTION_EXCLUSIVE**：写操作（预留）

### 页面锁

B-Tree 页面级别的锁，细粒度：
- 读取页面：IS（Intention Shared）
- 写入页面：IX（Intention Exclusive）
- 同时读写：S + IX 或 X + IS

---

## 锁的获取顺序

```
请求锁 → 检查是否可以获取 → 可能等待 → 获取锁 → 执行操作 → 释放锁
```

### 锁等待链

如果锁被占用，请求会进入等待队列：

```java
// 查看当前锁等待
Document serverStatus = database.runCommand(
    new Document("serverStatus", 1)
);
Document locks = serverStatus.get("locks", Document.class);
System.out.println(locks.toJson());
```

输出示例：

```json
{
  "Global": {
    "waiting": 0,
    "total": 15234
  },
  "Database:admin": {
    "waiting": 2,
    "total": 100
  }
}
```

---

## 死锁检测

MongoDB 有死锁检测机制：

```java
// 查看死锁超时（默认60秒）
Document result = database.runCommand(
    new Document("getParameter", 1)
        .append("transactionLifetimeLimitSeconds", 1)
);
// 返回 60
```

### 死锁场景

```
事务A: 锁文档1 → 等待锁文档2
事务B: 锁文档2 → 等待锁文档1
→ 死锁！
```

### 避免死锁

```java
// ✅ 统一按相同顺序获取锁
// 事务A: 先锁用户，再锁订单
collection1.find(session, eq("_id", userId));
collection2.find(session, eq("_id", orderId));

// 事务B: 也是先用户，再订单
collection1.find(session, eq("_id", userId));
collection2.find(session, eq("_id", orderId));

// ❌ 不好：顺序不一致
// 事务A: 先用户，再订单
// 事务B: 先订单，再用户
```

---

## 锁与索引

### 索引的锁行为

```java
// 创建索引会加集合级别的 EXCLUSIVE 锁
collection.createIndex(Indexes.ascending("username"));
```

### 索引对锁的影响

| 操作 | 索引影响 |
|-----|---------|
| 插入 | 更新所有索引，可能触发锁竞争 |
| 更新 | 如果更新索引字段，锁范围扩大 |
| 删除 | 更新所有索引 |
| 查询 | 先通过索引定位，可能只锁少量页面 |

### 优化建议

```java
// ❌ 不好：索引过多，高并发写入时锁竞争严重
for (String field : manyFields) {
    collection.createIndex(Indexes.ascending(field));
}

// ✅ 好：只创建必要的索引
collection.createIndex(Indexes.ascending("username"));
collection.createIndex(Indexes.compoundIndex(
    Indexes.ascending("city"),
    Indexes.descending("createdAt")
));
```

---

## 读已提交 vs 读未提交

### 读未提交（默认）

读取最新版本的数据，可能读取到未提交的修改：

```java
// 设置读关注为 local
collection.find(eq("_id", userId))
    .readConcern(ReadConcern.LOCAL);
```

### 读已提交

读取已提交的版本：

```java
// 设置读关注为 majority
collection.find(eq("_id", userId))
    .readConcern(ReadConcern.MAJORITY);
```

### 快照读

事务中的读取，读取事务开始时的快照：

```java
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())
    .build();

session.startTransaction(options);
```

---

## Java 中的锁配置

### 设置锁超时

```java
MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString("mongodb://localhost:27017"))
    .socketTimeout(30, TimeUnit.SECONDS)
    .build();
```

### 监控锁等待

```java
// 获取当前操作
Document currentOp = database.getCollection("currentOp")
    .find(new Document("op", "command"))
    .first();

// 查看锁等待时间
if (currentOp != null) {
    Long waitedMs = currentOp.getLong("ms");
    System.out.println("等待了 " + waitedMs + "ms");
}
```

---

## 性能调优

### 减少锁持有时间

```java
// ❌ 不好：长事务持有锁
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();
    // 在事务中做大量操作，锁持有时间长
    for (Document doc : manyDocs) {
        collection.updateOne(session, eq("_id", doc.get("_id")), ...);
    }
    session.commitTransaction();
}

// ✅ 好：批量操作，减少锁持有时间
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();
    // 收集所有需要更新的 ID
    List&lt;ObjectId&gt; ids = manyDocs.stream()
        .map(d -> d.getObjectId("_id"))
        .collect(Collectors.toList());
    // 一次批量更新
    collection.updateMany(session,
        in("_id", ids),
        new Document("$inc", new Document("views", 1)));
    session.commitTransaction();
}
```

### 选择合适的存储引擎

| 引擎 | 适用场景 | 锁粒度 |
|-----|---------|-------|
| WiredTiger | 大多数场景 | 文档级 |
| In-Memory | 超低延迟 | 无磁盘锁 |
| MMAPv1（已废弃） | 低写入量 | 集合级 |

---

## 总结

| 维度 | 说明 |
|-----|------|
| 存储引擎 | WiredTiger |
| 并发控制 | MVCC |
| 锁粒度 | 文档级 |
| 锁类型 | SHARED, EXCLUSIVE, IS, IX |
| 死锁处理 | 自动检测，超时回滚 |
| 隔离级别 | local, majority, snapshot |

记住：**MongoDB 的文档级锁已经很细粒度了，大多数并发问题可以通过原子操作解决，不需要事务**。

---

## 面试追问方向

- WiredTiger 的 MVCC 是怎么工作的？
- MongoDB 的锁升级和 MySQL 有什么区别？
- 如何避免死锁？死锁后怎么处理？
