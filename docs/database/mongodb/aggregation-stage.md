# MongoDB 聚合阶段详解：每个阶段的精妙之处

你已经了解了聚合框架的整体结构，现在来深入每个阶段。

有些阶段你可能天天用，有些可能从未听说。但每个阶段都有它的独门绝技。

---

## $match：过滤

**最简单也最重要**。把能过滤的数据尽早过滤掉，是优化的第一原则。

### 基本用法

```java
// 过滤单个条件
new Document("$match", new Document("status", "active"))

// 过滤多个条件（AND）
new Document("$match", new Document()
    .append("status", "active")
    .append("age", new Document("$gte", 18)))

// OR 条件
new Document("$match", new Document("$or", List.of(
    new Document("city", "Beijing"),
    new Document("city", "Shanghai")
)))
```

### 支持的操作符

```java
new Document("$match", new Document()
    // 比较
    .append("age", Map.of("$gte", 18, "$lte", 60))
    // IN
    .append("status", new Document("$in", List.of("active", "pending")))
    // 存在性
    .append("phone", new Document("$exists", true))
    // 类型
    .append("email", new Document("$type", "string"))
    // 正则
    .append("username", new Document("$regex", "^zhang"))
)
```

### 注意事项

- `$match` 尽量放在管道前面
- 在 `$match` 之前不能有 `$project` 或 `$group` 修改了你要过滤的字段
- 使用索引的字段放在 `$match` 开头

---

## $group：分组

### 分组字段

```java
// 按单个字段分组
new Document("$group", new Document("_id", "$city"))

// 按多个字段分组
new Document("$group", new Document("_id", new Document()
    .append("city", "$city")
    .append("status", "$status")))

// 所有文档一组
new Document("$group", new Document("_id", null)
    .append("total", new Document("$sum", 1)))
```

### 累加器（Accumulator）

`$group` 阶段有一些只能在组内使用的累加器：

```java
new Document("$group", new Document()
    .append("_id", "$userId")
    .append("firstLogin", new Document("$first", "$createdAt"))  // 组内第一条
    .append("lastLogin", new Document("$last", "$createdAt"))   // 组内最后一条
    .append("loginCount", new Document("$sum", 1))               // 计数
    .append("totalAmount", new Document("$sum", "$amount"))      // 求和
    .append("avgAmount", new Document("$avg", "$amount"))        // 平均
    .append("maxAmount", new Document("$max", "$amount"))        // 最大
    .append("minAmount", new Document("$min", "$amount"))        // 最小
    .append("tags", new Document("$push", "$tag"))              // 收集为数组
)
```

---

## $project：投影

### 字段控制

```java
new Document("$project", new Document()
    .append("_id", 0)          // 0 = 排除
    .append("fieldA", 1)        // 1 = 包含
    .append("fieldB", 0)        // 排除
)
```

### 计算字段

```java
new Document("$project", new Document()
    .append("username", 1)
    .append("price", 1)
    .append("quantity", 1)
    // 计算新字段
    .append("total", new Document("$multiply", List.of("$price", "$quantity")))
    // 条件字段
    .append("discountedPrice", new Document("$cond", new Document()
        .append("if", new Document("$gte", List.of("$price", 100)))
        .append("then", new Document("$multiply", List.of("$price", 0.9)))
        .append("else", "$price")))
)
```

### 嵌套字段访问

```java
// 访问嵌套字段
new Document("$project", new Document()
    .append("city", "$profile.address.city")
    .append("country", "$profile.address.country")
)
```

---

## $sort：排序

```java
// 单字段排序
new Document("$sort", new Document("age", 1))    // 1 = 升序
new Document("$sort", new Document("age", -1))   // -1 = 降序

// 多字段排序
new Document("$sort", new Document()
    .append("city", 1)        // 先按城市升序
    .append("age", -1))       // 再按年龄降序
```

**性能注意**：
- 如果排序字段有索引，直接用索引排序，不消耗内存
- 无索引排序会消耗内存，`allowDiskUse` 可以让 MongoDB 使用磁盘

```java
collection.aggregate(pipeline,
    AggregateOptions.builder()
        .allowDiskUse(true)  // 允许使用磁盘
        .build()
);
```

---

## $limit 和 $skip：分页

```java
// 限制返回数量
new Document("$limit", 10)

// 跳过记录（用于分页）
new Document("$skip", 20)

// 分页查询
List.of(
    new Document("$sort", new Document("createdAt", -1)),
    new Document("$skip", page * pageSize),
    new Document("$limit", pageSize)
)
```

---

## $unwind：展开数组

### 基本用法

```json
// 原始文档
{ "user": "zhangsan", "hobbies": ["reading", "coding", "gaming"] }

// $unwind 后
{ "user": "zhangsan", "hobbies": "reading" }
{ "user": "zhangsan", "hobbies": "coding" }
{ "user": "zhangsan", "hobbies": "gaming" }
```

```java
new Document("$unwind", "$hobbies")

// 指定保留字段
new Document("$unwind", new Document()
    .append("path", "$hobbies")
    .append("preserveNullAndEmptyArrays", true))
```

### 保留数组索引

```java
// 保留原数组中的位置信息
new Document("$unwind", new Document()
    .append("path", "$hobbies")
    .append("includeArrayIndex", "hobbyIndex"))
```

结果：

```json
{ "user": "zhangsan", "hobbies": "coding", "hobbyIndex": 1 }
```

---

## $lookup：关联查询

### 基本关联

```java
new Document("$lookup", new Document()
    .append("from", "orders")              // 关联集合
    .append("localField", "_id")           // 本集合字段
    .append("foreignField", "userId")      // 关联集合字段
    .append("as", "userOrders"))          // 结果字段名
```

### 子查询关联（MongoDB 3.6+）

```java
new Document("$lookup", new Document()
    .append("from", "orders")
    .append("let", new Document("userId", "$_id"))  // 定义局部变量
    .append("pipeline", List.of(
        new Document("$match", new Document("$expr", new Document("$eq",
            List.of("$userId", "$$userId")))),
        new Document("$limit", 5)  // 只取最近5条订单
    ))
    .append("as", "recentOrders"))
);
```

---

## $bucket 和 $bucketAuto：分桶

### $bucket：指定边界

```java
new Document("$bucket", new Document()
    .append("groupBy", "$age")
    .append("boundaries", List.of(0, 18, 30, 50, 100))  // 分段边界
    .append("default", "unknown")  // 不属于任何桶的文档
    .append("output", new Document()
        .append("count", new Document("$sum", 1))
        .append("avgIncome", new Document("$avg", "$income"))))
```

输出：

```json
{ "_id": 0, "count": 10, "avgIncome": 5000 }   // 0-18岁
{ "_id": 18, "count": 25, "avgIncome": 8000 }  // 18-30岁
{ "_id": 30, "count": 30, "avgIncome": 15000 }  // 30-50岁
```

### $bucketAuto：自动分桶

```java
// 自动分成 5 个桶，每桶文档数大致相同
new Document("$bucketAuto", new Document()
    .append("groupBy", "$income")
    .append("buckets", 5)
    .append("output", new Document("count", new Document("$sum", 1))))
```

---

## $facet：多管道并行

一次聚合，多个结果集。

```java
new Document("$facet", new Document()
    // 管道1：按状态统计
    .append("statusCounts", List.of(
        new Document("$group", new Document()
            .append("_id", "$status")
            .append("count", new Document("$sum", 1)))))
    // 管道2：按城市统计
    .append("cityCounts", List.of(
        new Document("$group", new Document()
            .append("_id", "$city")
            .append("count", new Document("$sum", 1)))))
    // 管道3：最新5条
    .append("recentUsers", List.of(
        new Document("$sort", new Document("createdAt", -1)),
        new Document("$limit", 5))))
```

---

## $addFields：添加字段

和 `$project` 类似，但不会排除其他字段。

```java
// $project 会排除未指定的字段
// $addFields 只添加，不影响其他字段

new Document("$addFields", new Document()
    .append("fullName", new Document("$concat", List.of("$firstName", " ", "$lastName")))
    .append("isAdult", new Document("$gte", List.of("$age", 18))))
```

---

## $replaceRoot / $replaceWith：替换根文档

把嵌套文档提升为根文档。

```json
// 原始文档
{ "_id": 1, "name": "product", "details": { "color": "red", "size": "L" } }

// $replaceRoot 后
{ "_id": 1, "name": "product", "color": "red", "size": "L" }
```

```java
new Document("$replaceRoot", new Document("newRoot", "$details"))
```

---

## 实战组合

### 场景：用户消费分析

```java
List&lt;Document&gt; pipeline = List.of(
    // 1. 过滤有效订单
    new Document("$match", new Document("status", "completed")),
    // 2. 展开订单商品
    new Document("$unwind", "$items"),
    // 3. 按用户分组，统计消费
    new Document("$group", new Document()
        .append("_id", "$userId")
        .append("totalSpent", new Document("$sum", "$items.price"))
        .append("orderCount", new Document("$sum", 1))
        .append("avgOrderValue", new Document("$avg", "$total"))),
    // 4. 计算消费等级
    new Document("$addFields", new Document("tier",
        new Document("$switch", new Document()
            .append("branches", List.of(
                new Document("case", new Document("$gte", List.of("$totalSpent", 10000))),
                new Document("then", "VIP"),
                new Document("case", new Document("$gte", List.of("$totalSpent", 1000))),
                new Document("then", "Regular")
            ))
            .append("default", "New"))))),
    // 5. 排序
    new Document("$sort", new Document("totalSpent", -1))
);
```

---

## 总结

每个聚合阶段都有自己的特长：

| 阶段 | 特长 |
|-----|-----|
| `$match` | 过滤，越早越好 |
| `$group` | 分组统计 |
| `$project` | 字段加工 |
| `$sort` | 排序 |
| `$limit` | 减少计算量 |
| `$unwind` | 展开数组 |
| `$lookup` | 关联查询 |
| `$bucket` | 分桶统计 |
| `$facet` | 多管道并行 |

记住：**没有最好的阶段，只有最合适的组合**。

---

## 面试追问方向

- `$match` 和 `$filter` 的区别是什么？
- `$lookup` 的 pipeline 模式和基本模式有什么区别？
- `$unwind` 有什么性能问题？如何避免？
