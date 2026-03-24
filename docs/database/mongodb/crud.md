# MongoDB CRUD：增删改查的正确姿势

你已经学会了怎么连接 MongoDB，现在该学学怎么操作数据了。

CRUD——Create（创建）、Read（读取）、Update（更新）、Delete（删除），是所有数据库操作的基础。

但 MongoDB 的 CRUD 和 MySQL 有些不一样，最大的区别在于：**你不是在操作行，而是在操作文档**。

---

## 插入（Create）

### 插入单篇文档

```java
MongoCollection&lt;Document&gt; collection = database.getCollection("users");

Document user = new Document()
    .append("username", "zhangsan")
    .append("age", 28)
    .append("email", "zhangsan@example.com")
    .append("tags", List.of("Java", "MongoDB"));

// 插入单篇
InsertOneResult result = collection.insertOne(user);
System.out.println("插入的文档ID: " + result.getInsertedId());
```

### 批量插入

```java
List&lt;Document&gt; users = List.of(
    new Document().append("username", "user1").append("age", 20),
    new Document().append("username", "user2").append("age", 25),
    new Document().append("username", "user3").append("age", 30)
);

InsertManyResult result = collection.insertMany(users);
System.out.println("插入了 " + result.getInsertedIds().size() + " 篇文档");
```

### 插入或更新（upsert）

如果文档不存在就插入，存在就更新：

```java
collection.updateOne(
    eq("username", "zhangsan"),  // 查询条件
    new Document("$set", new Document("age", 29)),  // 更新操作
    new UpdateOptions().upsert(true)  // 启用 upsert
);
```

---

## 查询（Read）

### 基础查询

```java
import static com.mongodb.client.model.Filters.*;
import static com.mongodb.client.model.Sorts.*;
import static com.mongodb.client.model.Projections.*;

// 查询单个文档
Document user = collection.find(eq("username", "zhangsan")).first();

// 查询多个文档
List&lt;Document&gt; adults = collection.find(gt("age", 18)).into(new ArrayList&lt;&gt;());

// 带排序
List&lt;Document&gt; sortedUsers = collection
    .find()
    .sort(descending("age"))
    .into(new ArrayList&lt;&gt;());

// 分页查询（每页10条，第2页）
List&lt;Document&gt; page2 = collection
    .find()
    .sort(descending("createdAt"))
    .skip(10)
    .limit(10)
    .into(new ArrayList&lt;&gt;());
```

### 常用查询条件

| 操作 | MongoDB | 说明 |
|-----|--------|-----|
| 等于 | `eq("age", 25)` | age = 25 |
| 大于 | `gt("age", 25)` | age > 25 |
| 小于 | `lt("age", 25)` | age < 25 |
| 大于等于 | `gte("age", 25)` | age >= 25 |
| 包含 | `in("status", List.of("active", "pending"))` | status in (...) |
| 正则 | `regex("username", "^zhang")` | username like 'zhang%' |
| 且 | `and(eq("age", 25), eq("city", "Beijing"))` | age = 25 AND city = 'Beijing' |
| 或 | `or(eq("city", "Beijing"), eq("city", "Shanghai"))` | city = 'Beijing' OR city = 'Shanghai' |

### 嵌套字段查询

```java
// 查询嵌入文档的字段
// 数据: { "profile": { "age": 28 } }
Document user = collection.find(eq("profile.age", 28)).first();

// 查询嵌套数组
// 数据: { "tags": ["Java", "MongoDB"] }
List&lt;Document&gt; javaUsers = collection.find(eq("tags", "Java")).into(new ArrayList&lt;&gt;());
```

### 只返回需要的字段

```java
// 只返回 username 和 email，不返回 _id
List&lt;Document&gt; users = collection
    .find()
    .projection(fields(include("username", "email"), excludeId()))
    .into(new ArrayList&lt;&gt;());
```

---

## 更新（Update）

### 基础更新操作符

| 操作符 | 说明 | 示例 |
|-------|------|------|
| `$set` | 设置字段值 | `set("age", 30)` |
| `$inc` | 递增/递减 | `inc("views", 1)` |
| `$push` | 添加到数组 | `push("tags", "newTag")` |
| `$pull` | 从数组移除 | `pull("tags", "oldTag")` |
| `$addToSet` | 集合添加（不重复） | `addToSet("tags", "newTag")` |
| `$unset` | 删除字段 | `unset("tempField")` |
| `$rename` | 重命名字段 | `rename("oldName", "newName")` |

### 示例代码

```java
// $set：更新单个字段
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$set", new Document("email", "new@example.com"))
);

// $inc：递增计数器
// 数据: { "views": 100 }
collection.updateOne(
    eq("_id", articleId),
    new Document("$inc", new Document("views", 1))
);
// 结果: { "views": 101 }

// $push：添加数组元素
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$push", new Document("comments", "new comment"))
);

// $set + 嵌套字段
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$set", new Document("profile.city", "Shanghai"))
);

// $unset：删除字段
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$unset", new Document("tempField", 1))
);
```

### 批量更新

```java
// 将所有 age < 18 的用户标记为未成年
UpdateResult result = collection.updateMany(
    lt("age", 18),
    new Document("$set", new Document("status", "minor"))
);
System.out.println("更新了 " + result.getModifiedCount() + " 条记录");
```

---

## 删除（Delete）

### 删除单个文档

```java
// 删除第一条匹配的文档
DeleteResult result = collection.deleteOne(eq("username", "zhangsan"));
System.out.println("删除了 " + result.getDeletedCount() + " 条记录");
```

### 批量删除

```java
// 删除所有 age > 100 的异常数据
DeleteResult result = collection.deleteMany(gt("age", 100));
System.out.println("删除了 " + result.getDeletedCount() + " 条记录");
```

### 清空整个集合

```java
// 删除所有文档，集合本身保留
collection.deleteMany(new Document());  // 空 Document 匹配所有

// 删除整个集合（包括索引）
collection.drop();
```

---

## 原子性与批量操作

### findAndModify

原子性地查询并修改，返回修改后的文档：

```java
// 抢购场景：原子性扣库存
Document result = collection.findOneAndUpdate(
    and(
        eq("product_id", productId),
        gt("stock", 0)  // 库存大于0才能扣
    ),
    new Document("$inc", new Document("stock", -1)),
    new FindOneAndUpdateOptions().returnNew(true)
);

if (result != null) {
    System.out.println("抢购成功，剩余库存: " + result.getInteger("stock"));
} else {
    System.out.println("库存不足");
}
```

### BulkWrite 批量操作

在一次请求中执行多种操作，减少网络往返：

```java
BulkWriteOperation bulk = collection.initializeOrderedBulkOperation();

// 插入
bulk.insert(new Document("username", "newuser1").append("age", 22));

// 更新
bulk.find(eq("username", "zhangsan"))
    .updateOne(new Document("$inc", new Document("age", 1)));

// 删除
bulk.find(eq("username", "todelete"))
    .remove();

BulkWriteResult result = bulk.execute();
```

---

## 常见错误与避坑

### 错误一：更新整个文档

```java
// ❌ 错误：$set 整个文档，会丢失其他字段
collection.updateOne(eq("_id", id), 
    new Document("username", "newname").append("age", 30));

// ✅ 正确：只更新需要的字段
collection.updateOne(eq("_id", id),
    new Document("$set", new Document("username", "newname")));
```

### 错误二：upsert 导致重复

```java
// 如果查询条件匹配不到，会插入新文档
// 但如果你以为会更新，实际上插入了新数据，可能导致数据重复
collection.updateOne(
    eq("email", "zhangsan@example.com"),  // 可能有多个相同email的记录
    new Document("$set", new Document("name", "newname")),
    new UpdateOptions().upsert(true)
);

// ✅ 更好的做法：确保查询条件唯一
collection.updateOne(
    and(eq("email", "zhangsan@example.com"), eq("status", "active")),
    new Document("$set", new Document("name", "newname")),
    new UpdateOptions().upsert(true)
);
```

---

## 总结

MongoDB 的 CRUD 操作比你想象的简单，比 MySQL 更灵活。记住几个关键点：

1. **查询用 Filter**，更新用 `$set` 等操作符
2. **嵌套字段用点号**：`profile.age`
3. **upsert** 可以让你少写很多判断逻辑
4. **findAndModify** 保证原子性，适合计数器、抢购等场景

---

## 面试追问方向

- MongoDB 的批量操作（BulkWrite）和逐条执行有什么区别？性能差异有多大？
- 如何用 MongoDB 实现一个分布式锁？
- `$push` 和 `$addToSet` 的区别是什么？
