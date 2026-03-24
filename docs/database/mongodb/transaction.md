# MongoDB 事务：让多文档操作变得安全可靠

你的系统有这样一个场景：

用户下单，需要同时：
1. 扣减库存
2. 创建订单
3. 扣减用户余额

如果库存扣了，但余额扣款失败了怎么办？库存已经少了，但订单没创建，用户会疯掉的。

在 MySQL 里，一个事务就能解决这个问题。那 MongoDB 呢？

---

## MongoDB 事务的演进

MongoDB 对事务的支持经历了几个阶段：

| 版本 | 事务支持 |
|-----|---------|
| 3.0-3.5 | 只有单文档事务（atomic） |
| 4.0 | 引入多文档事务（副本集） |
| 4.2 | 引入分布式事务（分片集群） |
| 4.4+ | 事务性能优化 |

从 MongoDB 4.0 开始，你可以在副本集上使用多文档事务；4.2 开始，分片集群也支持事务了。

---

## 事务基础概念

### 什么是事务？

事务是一组操作，它们要么全部成功，要么全部失败。

事务有四个特性（ACID）：

| 特性 | 说明 |
|-----|------|
| Atomic（原子性） | 事务中的操作要么全部成功，要么全部失败 |
| Consistency（一致性） | 事务前后数据状态是一致的 |
| Isolation（隔离性） | 并发事务之间互不干扰 |
| Durability（持久性） | 事务提交后，数据不会丢失 |

### MongoDB 事务 vs MySQL 事务

| 维度 | MongoDB | MySQL |
|-----|---------|-------|
| 单文档 | 原生原子性 | 依赖锁 |
| 多文档 | 4.0+ 支持 | 原生支持 |
| 分片集群 | 4.2+ 支持 | 不支持 |
| 隔离级别 | 可配置 | 可配置 |
| 性能 | 略低于单操作 | 成熟 |

---

## Java 中使用事务

### 基本用法

```java
import com.mongodb.client.ClientSession;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoCollection;
import org.bson.Document;

MongoClient mongoClient = MongoClients.create("mongodb://localhost:27017");

try (ClientSession session = mongoClient.startSession()) {
    // 开启事务
    session.startTransaction();

    try {
        MongoCollection&lt;Document&gt; users = database.getCollection("users");
        MongoCollection&lt;Document&gt; orders = database.getCollection("orders");
        MongoCollection&lt;Document&gt; products = database.getCollection("products");

        // 1. 扣减库存
        products.updateOne(
            session,
            eq("_id", productId),
            new Document("$inc", new Document("stock", -1))
        );

        // 2. 创建订单
        Document order = new Document()
            .append("userId", userId)
            .append("productId", productId)
            .append("amount", amount)
            .append("status", "pending");
        orders.insertOne(session, order);

        // 3. 扣减余额
        users.updateOne(
            session,
            eq("_id", userId),
            new Document("$inc", new Document("balance", -amount))
        );

        // 提交事务
        session.commitTransaction();
        System.out.println("下单成功");

    } catch (Exception e) {
        // 回滚事务
        session.abortTransaction();
        System.out.println("下单失败: " + e.getMessage());
        throw e;
    }
}
```

### 事务选项

```java
import com.mongodb.ReadConcern;
import com.mongodb.WriteConcern;
import com.mongodb.TransactionOptions;

// 配置事务选项
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())  // 快照隔离
    .writeConcern(WriteConcern.MAJORITY)   // 多数派写入
    .readPreference(ReadPreference.primary())  // 主节点读取
    .build();

try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction(options);

    // ... 执行操作 ...

    session.commitTransaction();
}
```

---

## 事务的隔离级别

MongoDB 支持多种读关注（Read Concern）级别：

| 级别 | 说明 | 适用场景 |
|-----|------|---------|
| `local` | 读取本地最新的数据，可能还没同步到多数节点 | 默认，数据一致性要求不高 |
| `available` | 读取本地数据（分片集群优化） | 分片集群，不关心副本 |
| `majority` | 读取被多数节点确认的数据 | 需要确认数据已持久化 |
| `snapshot` | 读取事务开始时的快照 | 事务内部，序列化隔离 |

### 读关注配置

```java
// 事务内使用快照隔离
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())
    .build();

session.startTransaction(options);

// 事务中的所有读取都使用快照
Document user = users.find(session, eq("_id", userId)).first();
```

---

## 事务的回滚

### 自动回滚

当事务中出现异常时，MongoDB 会自动回滚：

```java
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();

    try {
        // 操作1：成功
        collection1.insertOne(session, doc1);

        // 操作2：违反唯一约束，抛出异常
        collection2.insertOne(session, doc2);  // DuplicateKeyException

        session.commitTransaction();

    } catch (Exception e) {
        // MongoDB 自动回滚，无需手动处理
        // doc1 的插入也会被撤销
        session.abortTransaction();
    }
}
```

### 手动回滚

```java
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();

    try {
        // 检查业务逻辑
        Document product = products.find(session, eq("_id", productId)).first();

        if (product.getInteger("stock") < 1) {
            // 库存不足，手动回滚
            session.abortTransaction();
            System.out.println("库存不足");
            return;
        }

        // 继续扣减库存
        products.updateOne(session, eq("_id", productId),
            new Document("$inc", new Document("stock", -1)));

        session.commitTransaction();

    } catch (Exception e) {
        session.abortTransaction();
        throw e;
    }
}
```

---

## 事务的注意事项

### 事务不是万能的

**能用的场景：**
- 需要原子性的多文档操作
- 需要读取一致性的场景
- 需要回滚的场景

**不建议的场景：**
- 高并发热点数据的事务（性能问题）
- 长时间运行的事务（占用资源）
- 大量文档的事务（死锁风险）

### 性能影响

```java
// ❌ 不好：在事务中做大量操作
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();

    // 一次性插入 10000 条文档
    for (int i = 0; i < 10000; i++) {
        collection.insertOne(session, new Document("data", i));
    }

    session.commitTransaction();
}

// ✅ 好：分批处理，不要把事务拉太长
for (int i = 0; i < 10000; i += 100) {
    try (ClientSession session = mongoClient.startSession()) {
        session.startTransaction();
        for (int j = i; j < i + 100 && j < 10000; j++) {
            collection.insertOne(session, new Document("data", j));
        }
        session.commitTransaction();
    }
}
```

### 错误处理

```java
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction();

    try {
        // ... 操作 ...

        session.commitTransaction();

    } catch (MongoException e) {
        // 区分可重试错误
        if (e.hasErrorLabel(MongoException.TxnLabel)) {
            // 事务错误，可以选择重试或放弃
            session.abortTransaction();
        }
        throw e;
    }
}
```

---

## 实战案例：转账系统

```java
public void transfer(String fromUserId, String toUserId, double amount) {
    try (ClientSession session = mongoClient.startSession()) {
        session.startTransaction(
            TransactionOptions.builder()
                .readConcern(ReadConcern.SNAPSHOT())
                .writeConcern(WriteConcern.MAJORITY)
                .build()
        );

        try {
            MongoCollection&lt;Document&gt; users = database.getCollection("users");

            // 1. 查询转出账户
            Document fromUser = users.find(session,
                eq("_id", fromUserId)).first();

            if (fromUser == null) {
                throw new RuntimeException("转出账户不存在");
            }

            double fromBalance = fromUser.getDouble("balance");
            if (fromBalance < amount) {
                throw new RuntimeException("余额不足");
            }

            // 2. 扣减转出账户
            users.updateOne(session,
                eq("_id", fromUserId),
                new Document("$inc", new Document("balance", -amount)));

            // 3. 增加转入账户
            users.updateOne(session,
                eq("_id", toUserId),
                new Document("$inc", new Document("balance", amount)));

            // 4. 记录转账流水
            MongoCollection&lt;Document&gt; transfers = database.getCollection("transfers");
            Document transfer = new Document()
                .append("fromUserId", fromUserId)
                .append("toUserId", toUserId)
                .append("amount", amount)
                .append("status", "completed")
                .append("createdAt", new Date());
            transfers.insertOne(session, transfer);

            // 5. 提交
            session.commitTransaction();
            System.out.println("转账成功");

        } catch (Exception e) {
            session.abortTransaction();
            System.out.println("转账失败: " + e.getMessage());
            throw e;
        }
    }
}
```

---

## 总结

MongoDB 的多文档事务让复杂操作变得安全：

| 要点 | 说明 |
|-----|------|
| 开启事务 | `session.startTransaction()` |
| 提交事务 | `session.commitTransaction()` |
| 回滚事务 | `session.abortTransaction()` |
| 配置选项 | 读关注、写关注 |
| 隔离级别 | 快照隔离（snapshot） |

但记住：**事务不是性能优化的替代品，能不用就不用，能少用就少用**。

---

## 面试追问方向

- MongoDB 单文档的原子性是怎么实现的？
- 事务和单文档原子性有什么区别？
- MongoDB 4.0 之前是怎么处理多文档一致性的？
