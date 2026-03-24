# MongoDB 事务隔离级别：读未提交、读已提交、快照

你可能会遇到这样的场景：

事务 A 修改了用户余额，从 1000 改成 2000，但还没提交。
此时事务 B 读取余额，会读到多少？

1000？2000？还是报错？

**这取决于事务的隔离级别**。

---

## 为什么需要隔离级别？

并发环境下，多个事务同时操作数据，可能出现以下问题：

| 问题 | 说明 | 例子 |
|-----|------|-----|
| 脏读 | 读取到其他事务未提交的数据 | A 扣了库存但回滚，B 看到了扣减后的库存 |
| 不可重复读 | 同一事务中两次读取结果不同 | 事务 B 两次读取余额，第一次 1000，第二次 2000 |
| 幻读 | 同一事务中两次查询结果数不同 | 事务 A 插入订单时，事务 B 同时查询订单数 |

隔离级别就是为了解决这些问题。

---

## MongoDB 的隔离级别

MongoDB 支持的读关注（Read Concern）级别：

| 级别 | 脏读 | 不可重复读 | 幻读 | 说明 |
|-----|-----|----------|-----|------|
| `local` | 可能 | 可能 | 可能 | 读取本地最新数据 |
| `majority` | 不可能 | 可能 | 可能 | 读取多数节点确认的数据 |
| `snapshot` | 不可能 | 不可能 | 可能 | 读取事务快照 |

---

## 读关注详解

### local（默认）

读取本地节点最新的数据，**不保证数据已被多数节点确认**。

```java
// 默认读关注
FindIterable&lt;Document&gt; result = collection.find(eq("username", "zhangsan"));

// 显式设置
FindIterable&lt;Document&gt; result = collection.find(eq("username", "zhangsan"))
    .readConcern(ReadConcern.LOCAL);
```

**问题场景：**

```
时间线：
T1: Primary 更新 doc = 2000
T2: Secondary 同步完成
T3: 你查询 Secondary（local）

结果：可能读到旧值 1000
```

**适用场景：**
- 实时性要求不高
- 能容忍短暂的不一致

### majority

读取被多数节点确认的数据，**确保读取的数据不会回滚**。

```java
FindIterable&lt;Document&gt; result = collection.find(eq("username", "zhangsan"))
    .readConcern(ReadConcern.MAJORITY);
```

**特点：**

```
时间线：
T1: Primary 更新 doc = 2000
T2: 大多数节点（Primary + 1个Secondary）确认
T3: 你查询（majority）

结果：一定读到 2000，因为已经多数确认
```

**适用场景：**
- 需要读取已确认的数据
- 不想读到会回滚的数据

### snapshot（事务专用）

在事务中使用，读取事务开始时的快照。

```java
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())
    .build();

session.startTransaction(options);

// 事务内所有读取都基于同一个快照
Document user = collection.find(session, eq("_id", userId)).first();
```

**特点：**
- 事务期间读取的数据一致
- 类似于关系型数据库的可重复读

---

## 写关注详解

写关注（Write Concern）控制写入的确认级别：

| 级别 | 说明 | 持久性 |
|-----|------|-------|
| `w: 1` | 只等 Primary 确认 | 中 |
| `w: majority` | 等多数节点确认 | 高 |
| `w: 0` | 不等待确认 | 低 |

```java
// 默认写关注（w: 1）
collection.insertOne(doc);

// 强持久性写关注
collection.insertOne(doc)
    .withWriteConcern(WriteConcern.MAJORITY);

// 自定义节点数
collection.insertOne(doc)
    .withWriteConcern(new WriteConcern(2));  // 等2个节点确认
```

---

## 组合使用

### 查询和写入组合

```java
// 查询：用 majority 确保读到已确认数据
// 写入：用 majority 确保数据持久化
collection.find(eq("username", "zhangsan"))
    .readConcern(ReadConcern.MAJORITY);

collection.insertOne(doc)
    .withWriteConcern(WriteConcern.MAJORITY);
```

### 事务中的读写

```java
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())    // 快照隔离
    .writeConcern(WriteConcern.MAJORITY)    // 多数写入
    .build();

session.startTransaction(options);
```

---

## 实际案例分析

### 案例一：库存扣减

**场景：** 抢购商品，库存只剩 1 件，2 个用户同时抢购。

```java
// ❌ 不好：没有隔离级别，可能超卖
collection.updateOne(
    eq("productId", productId),
    new Document("$inc", new Document("stock", -1))
);

// ✅ 好：事务 + 快照隔离
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction(TransactionOptions.builder()
        .readConcern(ReadConcern.SNAPSHOT())
        .writeConcern(WriteConcern.MAJORITY)
        .build());

    Document product = collection.find(session,
        eq("_id", productId)).first();

    if (product.getInteger("stock") < 1) {
        session.abortTransaction();
        System.out.println("库存不足");
        return;
    }

    collection.updateOne(session,
        eq("_id", productId),
        new Document("$inc", new Document("stock", -1)));

    session.commitTransaction();
}
```

### 案例二：账户余额查询

**场景：** 查询用户余额，余额可能随时被其他事务修改。

```java
// 快照隔离：确保事务内读取一致
try (ClientSession session = mongoClient.startSession()) {
    session.startTransaction(TransactionOptions.builder()
        .readConcern(ReadConcern.SNAPSHOT())
        .build());

    // 第一次读取
    double balance1 = collection.find(session, eq("_id", userId))
        .first().getDouble("balance");

    // 模拟延迟
    Thread.sleep(1000);

    // 第二次读取（同一事务，应该相同）
    double balance2 = collection.find(session, eq("_id", userId))
        .first().getDouble("balance");

    // 在 snapshot 隔离下，balance1 == balance2
    session.commitTransaction();
}
```

---

## 常见问题

### Q1: majority 能防止脏读吗？

**可以**。majority 确保读取的数据已被多数节点确认，不会回滚。

但注意：如果 Primary 挂了，election 期间可能读取到旧 Primary 的未确认数据。

### Q2: snapshot 和 majority 哪个更安全？

snapshot 更安全（序列化隔离），但性能更低。

- `snapshot`：事务内读取一致，但可能读到较旧的数据
- `majority`：读取已确认的数据，但事务之间可能有交叉

### Q3: 什么时候用 local？

`local` 适合：
- 分片集群的某些场景（更高效）
- 实时监控、数据采集
- 不关心副本一致性的场景

---

## Java 代码示例

### 配置全局默认隔离级别

```java
MongoClientSettings settings = MongoClientSettings.builder()
    .readConcern(ReadConcern.MAJORITY)
    .writeConcern(WriteConcern.MAJORITY)
    .build();

MongoClient mongoClient = MongoClients.create(settings);
```

### 单次查询指定隔离级别

```java
// 单次查询指定读关注
FindIterable&lt;Document&gt; result = collection
    .withReadConcern(ReadConcern.MAJORITY)
    .find(eq("status", "active"));

// 单次写入指定写关注
collection
    .withWriteConcern(WriteConcern.MAJORITY)
    .insertOne(doc);
```

### 事务中隔离级别

```java
TransactionOptions options = TransactionOptions.builder()
    .readConcern(ReadConcern.SNAPSHOT())
    .writeConcern(WriteConcern.MAJORITY)
    .maxCommitTime(10, TimeUnit.SECONDS)  // 最大事务时间
    .build();

session.startTransaction(options);
```

---

## 总结

| 场景 | 推荐配置 |
|-----|---------|
| 普通查询 | `local` |
| 重要数据读取 | `majority` |
| 事务内读取 | `snapshot` |
| 普通写入 | `w: 1` |
| 重要数据写入 | `w: majority` |
| 事务提交 | `w: majority` |

记住：**隔离级别越高，数据越安全，但性能越低**。根据业务需求选择合适的级别。

---

## 面试追问方向

- MongoDB 的 Read Concern 有几种？分别是？
- `majority` 和 `snapshot` 的区别是什么？
- 事务中可以用 `local` 读关注吗？会有什么后果？
