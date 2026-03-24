# MongoDB $lookup：关联查询的正确姿势

MySQL 里 JOIN 是家常便饭。

MongoDB 呢？虽然原生不支持 JOIN，但 `$lookup` 提供了类似的能力。

不过 `$lookup` 有很多坑，用错了性能会让你怀疑人生。

---

## $lookup 基础

### 什么是 $lookup？

`$lookup` 是聚合管道中的一个阶段，用于从其他集合关联数据。

相当于 SQL 的 LEFT JOIN，但不是完全相同。

### 基本语法

```java
new Document("$lookup", new Document()
    .append("from", "orders")              // 关联的集合
    .append("localField", "userId")       // 本集合的字段
    .append("foreignField", "_id")        // 被关联集合的字段
    .append("as", "userOrders"))          // 结果字段名（数组）
```

### 示例数据

```json
// users 集合
{ "_id": 1, "username": "zhangsan", "email": "zhangsan@example.com" }
{ "_id": 2, "username": "lisi", "email": "lisi@example.com" }

// orders 集合
{ "_id": 101, "userId": 1, "amount": 100 }
{ "_id": 102, "userId": 1, "amount": 200 }
{ "_id": 103, "userId": 2, "amount": 150 }
```

### 基本查询

```java
List&lt;Document&gt; pipeline = List.of(
    new Document("$lookup", new Document()
        .append("from", "orders")
        .append("localField", "_id")
        .append("foreignField", "userId")
        .append("as", "orders"))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

结果：

```json
{
  "_id": 1,
  "username": "zhangsan",
  "orders": [
    { "_id": 101, "userId": 1, "amount": 100 },
    { "_id": 102, "userId": 1, "amount": 200 }
  ]
}
```

---

## 过滤关联结果

### 问题：关联数据太多

```java
// 用户可能有成百上千条订单
// 直接关联返回全部，性能很差

// ✅ 解决方案：用 pipeline 过滤
List&lt;Document&gt; pipeline = List.of(
    new Document("$lookup", new Document()
        .append("from", "orders")
        .append("let", new Document("uid", "$_id"))  // 定义变量
        .append("pipeline", List.of(
            // 只关联最近一个月的订单
            new Document("$match", new Document()
                .append("$expr", new Document("$eq", List.of("$userId", "$$uid")))
                .append("createdAt", new Document("$gte", thirtyDaysAgo)))),
            new Document("$sort", new Document("createdAt", -1)),
            new Document("$limit", 10)  // 最多10条
        ))
        .append("as", "recentOrders"))
);
```

---

## 嵌套 $lookup

### 关联多级数据

用户 → 订单 → 订单详情

```java
List&lt;Document&gt; pipeline = List.of(
    // 第一层：关联订单
    new Document("$lookup", new Document()
        .append("from", "orders")
        .append("localField", "_id")
        .append("foreignField", "userId")
        .append("as", "orders")),
    // 第二层：展开订单，再关联详情
    new Document("$unwind", new Document("path", "$orders")
        .append("preserveNullAndEmptyArrays", true)),
    new Document("$lookup", new Document()
        .append("from", "orderDetails")
        .append("localField", "orders._id")
        .append("foreignField", "orderId")
        .append("as", "orders.details")),
    // 重新组合订单
    new Document("$group", new Document()
        .append("_id", "$_id")
        .append("username", new Document("$first", "$username"))
        .append("orders", new Document("$push", new Document()
            .append("orderId", "$orders._id")
            .append("amount", "$orders.amount")
            .append("details", "$orders.details"))))
);
```

---

## 反向引用

### 从订单查用户

```java
// orders 集合关联 users
List&lt;Document&gt; pipeline = List.of(
    // 过滤大额订单
    new Document("$match", new Document("amount", new Document("$gte", 1000))),
    // 关联用户
    new Document("$lookup", new Document()
        .append("from", "users")
        .append("localField", "userId")
        .append("foreignField", "_id")
        .append("as", "user")),
    // 展开用户信息
    new Document("$unwind", "$user"),
    // 投影需要的字段
    new Document("$project", new Document()
        .append("orderId", "$_id")
        .append("amount", 1)
        .append("username", "$user.username")
        .append("email", "$user.email")))
);
```

---

## 关联 + 聚合

### 在 lookup 中计算

```java
List&lt;Document&gt; pipeline = List.of(
    new Document("$lookup", new Document()
        .append("from", "orders")
        .append("let", new Document("uid", "$_id"))
        .append("pipeline", List.of(
            new Document("$match", new Document("$expr",
                new Document("$eq", List.of("$userId", "$$uid"))))),
            // 在关联时直接聚合
            new Document("$group", new Document()
                .append("_id", null)
                .append("totalAmount", new Document("$sum", "$amount"))
                .append("orderCount", new Document("$sum", 1))))
        )
        .append("as", "orderStats"))
);
```

---

## 性能优化

### 优化一：限制关联数量

```java
// ❌ 不好：关联所有订单
new Document("$lookup", new Document()
    .append("from", "orders")
    .append("localField", "_id")
    .append("foreignField", "userId")
    .append("as", "orders"))

// ✅ 好：只关联最近 N 条
new Document("$lookup", new Document()
    .append("from", "orders")
    .append("let", new Document("uid", "$_id"))
    .append("pipeline", List.of(
        new Document("$match", new Document("$expr",
            new Document("$eq", List.of("$userId", "$$uid")))),
        new Document("$sort", new Document("createdAt", -1)),
        new Document("$limit", 10)))
    .append("as", "recentOrders"))
```

### 优化二：关联前过滤

```java
// ❌ 不好：先关联，再过滤用户
List.of(
    new Document("$lookup", ...),
    new Document("$match", new Document("status", "active"))  // 已经关联了大量数据
)

// ✅ 好：先过滤用户，再关联
List.of(
    new Document("$match", new Document("status", "active")),  // 先过滤
    new Document("$lookup", ...)  // 只关联符合条件的用户
)
```

### 优化三：使用 pipeline 模式

```java
// MongoDB 3.6+ 推荐使用 pipeline 模式
// 比基本的 localField/foreignField 模式更灵活

new Document("$lookup", new Document()
    .append("from", "orders")
    .append("let", new Document("uid", "$_id"))
    .append("pipeline", List.of(
        new Document("$match", new Document("$expr",
            new Document("$and", List.of(
                new Document("$eq", List.of("$userId", "$$uid")),
                new Document("$eq", List.of("$status", "completed"))
            )))),
        new Document("$limit", 5)))
    .append("as", "orders"))
```

---

## 与 SQL JOIN 的对比

| SQL | MongoDB |
|-----|--------|
| `INNER JOIN` | `$lookup` + `$match` + `$unwind` |
| `LEFT JOIN` | `$lookup`（没有匹配返回空数组） |
| `SELECT` | `$project` |
| `WHERE` | `$match` |
| `GROUP BY` | `$group` |

**关键区别**：
- MongoDB 的 `$lookup` 结果是数组（可能多条）
- MySQL JOIN 结果是单行（一一对应）
- MongoDB 关联后需要 `$unwind` 变成单条

---

## 常见问题

### Q1: 关联结果太大怎么办？

```java
// 使用 pipeline + $limit
new Document("$lookup", new Document()
    .append("from", "orders")
    .append("let", new Document("uid", "$_id"))
    .append("pipeline", List.of(
        new Document("$match", new Document("$expr",
            new Document("$eq", List.of("$userId", "$$uid")))),
        new Document("$limit", 10)))  // 限制数量
    .append("as", "orders"))
```

### Q2: 关联条件是数组？

```java
// products 集合有 tags: ["tech", "sale"]
// 要查询同时包含多个标签的产品

// 不能直接用 localField/foreignField
// 需要 pipeline 模式
new Document("$lookup", new Document()
    .append("from", "products")
    .append("let", new Document("requiredTags", "$requiredTags"))
    .append("pipeline", List.of(
        new Document("$match", new Document("$expr", new Document("$setIsSubset",
            List.of("$$requiredTags", "$tags"))))))
    .append("as", "matchingProducts"))
```

---

## 总结

`$lookup` 让 MongoDB 拥有了关联查询能力，但要注意：

1. **关联前先过滤**：减少关联数据量
2. **用 pipeline 模式**：更灵活，可以加限制
3. **注意结果数组大小**：可能撑爆内存
4. **考虑反范式设计**：有时候嵌入式更高效

---

## 面试追问方向

- `$lookup` 和 SQL JOIN 有什么本质区别？
- 如何在 `$lookup` 中实现 INNER JOIN 效果？
- `$lookup` 有什么性能问题？如何优化？
