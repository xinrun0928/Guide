# MongoDB 性能优化：索引设计与分片策略

你的 MongoDB 数据库越来越慢。查询时间从 100ms 飙升到 5 秒。

你加了索引，但问题依旧。**问题可能出在你的索引设计上。**

MongoDB 的索引机制与 MySQL 类似，但也有自己的特点。错误的索引设计不仅不能提升性能，反而会拖慢写入速度。

## 索引基础

### 创建索引

```java
// 单字段索引
db.collection.createIndex({"username": 1})

// 复合索引
db.collection.createIndex({"status": 1, "createdAt": -1})

// 多键索引（数组字段）
db.collection.createIndex({"tags": 1})

// 地理空间索引
db.collection.createIndex({"location": "2dsphere"})

// 全文索引
db.collection.createIndex({"content": "text"})
```

```java
// Java 代码创建索引
MongoCollection&lt;Document&gt; collection = database.getCollection("users");

// 创建复合索引
collection.createIndex(Indexes.compoundIndex(
    Indexes.ascending("status"),
    Indexes.descending("createdAt")
), new IndexOptions().name("idx_status_createdAt"));

// 创建唯一索引
collection.createIndex(
    Indexes.ascending("email"),
    new IndexOptions().unique(true)
);

// 后台创建索引（不阻塞）
collection.createIndex(
    Indexes.ascending("username"),
    new IndexOptions().background(true)
);
```

## 复合索引设计

### 最左前缀原则

复合索引遵循最左前缀原则，与 MySQL 类似：

```java
// 创建复合索引
db.collection.createIndex({"a": 1, "b": 1, "c": 1})

// 可以命中的查询
db.collection.find({"a": 1})
db.collection.find({"a": 1, "b": 1})
db.collection.find({"a": 1, "b": 1, "c": 1})

// 无法命中
db.collection.find({"b": 1})
db.collection.find({"c": 1})
db.collection.find({"b": 1, "c": 1})
```

### 字段顺序选择

原则：**区分度高的字段放在前面**

```java
// 场景：查询用户订单
// 查询条件：status + user_id + createdAt
// 排序：createdAt

// 好的索引设计
db.orders.createIndex({"status": 1, "user_id": 1, "createdAt": -1})
// 查询：db.orders.find({"status": "completed", "user_id": "user123"}).sort({"createdAt": -1})

// 差的索引设计
db.orders.createIndex({"createdAt": -1, "status": 1, "user_id": 1})
// createdAt 区分度低，放在前面会导致索引效率降低
```

### 覆盖查询

如果查询只需要返回索引字段，MongoDB 可以直接从索引返回，无需回表：

```java
// 创建覆盖索引
db.users.createIndex({"username": 1, "email": 1})

// 覆盖查询
db.users.find({"username": "john"}, {"username": 1, "email": 1, "_id": 0})
// _id 字段需要单独指定排除
```

### explain 分析

```java
// 使用 explain 分析查询
db.orders.find({"status": "completed", "user_id": "user123"})
  .sort({"createdAt": -1})
  .explain("executionStats")
```

```json
{
  "queryPlanner": {
    "winningPlan": {
      "stage": "FETCH",
      "inputStage": {
        "stage": "IXSCAN",
        "indexName": "idx_status_user_createdAt"
      }
    }
  },
  "executionStats": {
    "executionSuccess": true,
    "nReturned": 10,
    "totalKeysExamined": 10,
    "totalDocsExamined": 10,
    "executionTimeMillis": 5
  }
}
```

**关键指标**：
- `nReturned`：返回的文档数
- `totalKeysExamined`：扫描的索引键数（越接近 nReturned 越好）
- `totalDocsExamined`：扫描的文档数（越接近 nReturned 越好）

## 分片策略

当单机 MongoDB 无法满足需求时，需要使用分片集群。

### 分片键选择

分片键决定了数据的分布方式：

```java
// 范围分片（默认）
sh.shardCollection("mydb.orders", {"user_id": "hashed"})

// 基于哈希的分片
sh.shardCollection("mydb.orders", {"user_id": "hashed"})
```

### 最佳分片键特征

| 特征 | 说明 |
|---|---|
| 高基数 | 分片键的值越多越好 |
| 低频率 | 分片键值出现频率不要太高 |
| 非单调 | 分片键不要单调递增/递减 |

### 常见问题：热数据分片

如果使用单调递增字段（如时间戳、ObjectId）作为分片键，所有新数据都会写入同一个分片（chunk）：

```java
// 问题：createdAt 单调递增，新数据都写入 chunk 5
sh.shardCollection("mydb.events", {"createdAt": 1})

// 解决方案：使用复合分片键，加入高基数字段
sh.shardCollection("mydb.events", {"event_type": 1, "createdAt": 1})
// 或者使用哈希分片
sh.shardCollection("mydb.events", {"createdAt": "hashed"})
```

## Java 性能优化实践

### 连接池配置

```java
MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString("mongodb://localhost:27017"))
    .applyToConnectionPoolSettings(builder -> builder
        .maxSize(100)      // 最大连接数
        .minSize(10)       // 最小连接数
        .maxWaitTime(2000, TimeUnit.MILLISECONDS)  // 最大等待时间
        .maxConnectionIdleTime(60000, TimeUnit.MILLISECONDS)  // 最大空闲时间
    )
    .applyToSocketSettings(builder -> builder
        .connectTimeout(5000, TimeUnit.MILLISECONDS)
        .readTimeout(10000, TimeUnit.MILLISECONDS)
    )
    .build();

MongoClient mongoClient = new MongoClient(settings);
```

### 查询优化

```java
MongoCollection&lt;Document&gt; collection = database.getCollection("orders");

// 1. 只查询需要的字段
Bson projection = Projections.fields(
    Projections.include("order_id", "status", "total_amount"),
    Projections.excludeId()
);

FindIterable&lt;Document&gt; cursor = collection
    .find(eq("status", "completed"))
    .projection(projection)
    .sort(Sorts.descending("created_at"))
    .limit(20);


// 2. 使用 hint 指定索引
Bson hint = Indexes.ascending("status", "created_at");
collection.find(eq("status", "completed"))
    .hint(hint)
    .sort(Sorts.descending("created_at"))
    .limit(20);


// 3. 批量操作
BulkWriteBatch bulkWrite = collection.initializeUnorderedBulkOperation();
for (Order order : orders) {
    bulkWrite.insertOne(toDocument(order));
}
BulkWriteResult result = bulkWrite.execute();
```

### Aggregation Pipeline 优化

```java
// 错误的写法：$match 放在开头
collection.aggregate(Arrays.asList(
    Aggregates.group("$category", Accumulators.sum("count", 1)),
    Aggregates.match(Filters.gt("count", 100))  // 应该放在 group 前面
));

// 正确的写法：$match 尽量靠前
collection.aggregate(Arrays.asList(
    Aggregates.match(Filters.eq("status", "active")),  // 先过滤
    Aggregates.group("$category", Accumulators.sum("count", 1)),
    Aggregates.match(Filters.gt("count", 100))  // 最后筛选
));
```

## 监控与诊断

### 使用 explain

```java
// 分析查询计划
collection.find(eq("status", "completed"))
    .explain(ExplainVerbosity.EXECUTION_STATS)
    .forEach(doc -> System.out.println(doc.toJson()));
```

### 查看慢查询

```java
// 查看慢查询日志
database.getCollection("system.profile").find()
    .forEach(doc -> System.out.println(doc.toJson()));

// 设置慢查询阈值
// 在 MongoDB 配置文件中：
// operationProfiling.slowOpThresholdMs = 100
```

### 索引统计

```java
// 查看集合的索引
for (Document index : collection.listIndexes()) {
    System.out.println(index.toJson());
}

// 查看索引使用情况
collection.aggregate(Arrays.asList(
    Aggregates.group(null, Accumulators.sum("count", 1))
));
```

## 总结

MongoDB 性能优化涉及多个层面：

1. **索引设计**：复合索引遵循最左前缀原则，区分度高的字段放前面
2. **分片策略**：选择高基数、低频率、非单调的分片键
3. **查询优化**：使用投影、hint、批量操作
4. **连接池**：合理配置连接池参数
5. **监控诊断**：定期分析慢查询和执行计划

---

## 留给你的问题

假设你的 MongoDB 有以下场景：

- 用户行为日志集合，约 10 亿条数据
- 查询模式：按用户 ID 查询 + 时间范围过滤 + 排序
- 当前问题：按用户查询很慢，需要 5 秒

请思考：

1. 如何设计索引来优化这个查询？字段顺序应该怎么安排？
2. 如果数据量继续增长，单机无法支撑，如何设计分片策略？
3. 如果使用时间字段作为分片键，会出现什么问题？如何解决？
4. 如果查询中需要同时支持多种过滤条件（user_id、event_type、device），如何设计复合索引？

这道题的关键在于理解 MongoDB 的索引机制，以及如何根据查询模式设计最优的索引。
