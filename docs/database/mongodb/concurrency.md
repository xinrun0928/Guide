# MongoDB 并发控制：锁机制与并发模型

你的系统遇到了并发问题：

- 用户重复点击按钮，扣了两次库存
- 热点数据被多个请求同时修改，数据乱了
- 明明加了索引，高并发时还是慢得离谱

这都是并发控制没做好。

MongoDB 是怎么处理并发的？它的锁机制和 MySQL 有什么不同？

---

## MongoDB 的并发模型

### 发展历程

| 版本 | 锁类型 | 说明 |
|-----|-------|------|
| 3.0 之前 | 全局锁 | 整个数据库一把锁 |
| 3.0 | 库级锁 | 每个数据库一把锁 |
| 3.2 | 集合级锁 | 每个集合一把锁 |
| 4.0 | 文档级锁 | WiredTiger 引擎支持 |
| 4.2+ | 文档级锁 | 更加精细化 |

从 MongoDB 3.0 开始，使用 WiredTiger 存储引擎，引入了集合级锁；4.0+ 实现了文档级锁。

### 当前模型

MongoDB 使用**乐观锁**和**悲观锁**结合的方式：

| 锁类型 | 场景 | 特点 |
|-------|------|-----|
| 乐观锁 | 单文档操作 | 通过版本号控制 |
| 悲观锁 | 事务操作 | 通过读写锁控制 |
| 意向锁 | 多文档操作 | 表明意图，不阻塞 |

---

## 锁的粒度

### 全局锁（已废弃）

早期 MongoDB 使用全局锁，导致所有操作互斥。

```
❌ 3.0 之前
database {
    lock: "exclusive"
    operations: [op1, op2, op3]  // 串行执行
}
```

### 库级锁

3.0 版本改进为库级锁，不同数据库可以并行。

```
✓ 3.0 版本
database1 { lock: "exclusive" }  // db1 独占
database2 { lock: "exclusive" }  // db2 独占
// db1 和 db2 可以并行
```

### 集合级锁（当前默认）

3.2+ 使用集合级锁，WiredTiger 引擎。

```
✓ 3.2+ 版本
collection1 { lock: "exclusive" }  // coll1 独占
collection2 { lock: "shared" }       // coll2 共享
// coll1 和 coll2 可以并行
```

### 文档级锁

WiredTiger 引擎支持文档级锁，锁粒度更细。

```java
// 两个操作修改不同文档，可以并行
collection.updateOne(eq("_id", 1), set("name", "A"));
collection.updateOne(eq("_id", 2), set("name", "B"));
```

---

## 乐观并发控制

### 什么是乐观锁？

假设并发冲突很少发生，允许多个操作同时执行，冲突时再处理。

### MongoDB 的实现：版本号

MongoDB 通过 `_id` 字段和隐式版本机制实现乐观并发：

```java
// 读取文档
Document user = collection.find(eq("_id", userId)).first();

// 检查库存
if (user.getInteger("stock") < 1) {
    System.out.println("库存不足");
    return;
}

// 模拟并发：另一个请求也在检查库存
// ...

// 更新时存在竞态条件，可能超卖
collection.updateOne(
    eq("_id", userId),
    new Document("$inc", new Document("stock", -1))
);
```

### 使用 findAndModify 原子操作

```java
// ✅ 原子性地检查并扣减
Document result = collection.findOneAndUpdate(
    and(
        eq("_id", productId),
        gt("stock", 0)  // 库存大于0才扣
    ),
    new Document("$inc", new Document("stock", -1)),
    new FindOneAndUpdateOptions()
        .returnNew(true)  // 返回更新后的文档
);

if (result != null) {
    System.out.println("扣减成功，当前库存: " + result.getInteger("stock"));
} else {
    System.out.println("库存不足");
}
```

---

## 悲观并发控制

### 什么是悲观锁？

假设并发冲突一定会发生，先加锁再操作。

### MongoDB 事务中的锁

```java
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();

    // 获取锁
    collection.find(session, eq("_id", productId)).first();

    // 检查并更新
    // ...

    // 释放锁（提交或回滚时自动释放）
    session.commitTransaction();
}
```

### 锁等待与超时

```java
// 设置锁等待超时（默认无限等待）
TransactionOptions options = TransactionOptions.builder()
    .maxTransactionLockRequestTimeoutMillis(5000)  // 5秒超时
    .build();

session.startTransaction(options);
```

---

## Java 中的并发处理

### 场景一：计数器并发

```java
// ❌ 错误：并发不安全
Document user = collection.find(eq("_id", userId)).first();
int currentViews = user.getInteger("views", 0);
collection.updateOne(eq("_id", userId),
    new Document("$set", new Document("views", currentViews + 1)));

// ✅ 正确：使用 $inc 原子操作
collection.updateOne(eq("_id", userId),
    new Document("$inc", new Document("views", 1)));

// ✅ 正确：使用 findAndModify
collection.findOneAndUpdate(
    eq("_id", userId),
    new Document("$inc", new Document("views", 1)),
    new FindOneAndUpdateOptions().returnNew(true)
);
```

### 场景二：库存扣减（乐观锁）

```java
public boolean decrementStock(String productId, int quantity) {
    // 循环重试，最多尝试3次
    for (int i = 0; i < 3; i++) {
        Document product = collection.find(eq("_id", productId)).first();

        int currentStock = product.getInteger("stock", 0);
        if (currentStock < quantity) {
            return false;  // 库存不足
        }

        // 使用版本号实现乐观锁
        try {
            UpdateResult result = collection.updateOne(
                and(
                    eq("_id", productId),
                    eq("version", product.getInteger("version")),  // 版本匹配
                    gte("stock", quantity)  // 库存足够
                ),
                new Document()
                    .append("$inc", new Document()
                        .append("stock", -quantity)
                        .append("version", 1))
            );

            if (result.getModifiedCount() == 1) {
                return true;  // 更新成功
            }
            // 版本不匹配，说明有并发，重试
        } catch (MongoCommandException e) {
            // 乐观锁冲突，重试
        }
    }
    return false;
}
```

### 场景三：分布式锁

```java
public void distributedLock(String lockKey, Runnable task) {
    String lockValue = UUID.randomUUID().toString();
    MongoCollection&lt;Document&gt; locks = database.getCollection("locks");

    // 尝试获取锁
    locks.insertOne(new Document()
        .append("_id", lockKey)
        .append("owner", lockValue)
        .append("expireAt", new Date(System.currentTimeMillis() + 30000)));

    try {
        // 执行业务逻辑
        task.run();
    } finally {
        // 释放锁（只能释放自己的锁）
        locks.deleteOne(and(
            eq("_id", lockKey),
            eq("owner", lockValue)
        ));
    }
}
```

---

## 并发性能优化

### 减少锁竞争

```java
// ❌ 不好：热点数据，高并发锁竞争
collection.updateOne(eq("status", "active"),
    new Document("$inc", new Document("views", 1)));

// ✅ 好：分散热点，使用多个集合或文档
String shardKey = userId % 10;  // 分片到 10 个文档
collection.updateOne(
    and(eq("shardKey", shardKey), eq("userId", userId)),
    new Document("$inc", new Document("views", 1))
);
```

### 使用队列消峰

```java
// 高并发写入时，使用队列缓冲
BlockingQueue&lt;Document&gt; queue = new LinkedBlockingQueue&lt;&gt;(1000);

// 生产者
while (true) {
    queue.put(document);  // 阻塞直到队列有空位
}

// 消费者
while (true) {
    Document doc = queue.take();
    collection.insertOne(doc);
}
```

---

## 监控并发状态

### 查看锁信息

```java
// 查看当前锁状态
Document locks = database.runCommand(new Document("serverStatus", 1))
    .get("locks", Document.class);

System.out.println(locks.toJson());
```

### 查看锁等待

```java
// 查看当前操作和锁等待
List&lt;Document&gt; operations = database.getCollection("currentOp")
    .find(new Document("waitingForLock", true))
    .into(new ArrayList&lt;&gt;());

for (Document op : operations) {
    System.out.println("操作: " + op.getString("command"));
    System.out.println("等待锁: " + op.getDocument("lockStats"));
}
```

---

## 总结

| 并发场景 | 解决方案 |
|---------|---------|
| 计数器 | `$inc` 原子操作 |
| 库存扣减 | `findAndModify` |
| 热点数据 | 分片、队列 |
| 分布式锁 | 外部系统（如 Redis） |
| 多文档事务 | MongoDB 事务 |

记住：**MongoDB 的文档级锁已经很细粒度了，大多数场景不需要额外的锁机制**。优先使用原子操作和事务。

---

## 面试追问方向

- MongoDB 和 MySQL 的锁机制有什么区别？
- 什么是乐观锁和悲观锁？各自适用什么场景？
- MongoDB 的锁升级是怎么回事？
