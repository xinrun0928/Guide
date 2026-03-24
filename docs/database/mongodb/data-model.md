# MongoDB 数据模型设计：让你的数据结构「活」起来

你有过这种经历吗？写好了用户表，过两天产品说「再加个字段」，再过两天说「这个字段某些用户有，某些用户没有」。

MySQL 时代，你得 ALTER TABLE，全表锁，数据量大了可能要跑几个小时。

MongoDB 时代？直接写就行，Schema？不存在的。

但这不代表你可以随便写——**灵活不等于随意**，数据模型设计得好与坏，直接决定你的查询性能和维护成本。

---

## 嵌入式设计 vs 引用式设计

MongoDB 有两种数据组织方式：**嵌入式**和**引用式**。

### 嵌入式（Embedded）

把相关数据直接放在同一个文档里：

```json
{
  "_id": ObjectId("..."),
  "username": "zhangsan",
  "profile": {
    "age": 28,
    "city": "Beijing",
    "bio": "热爱技术"
  }
}
```

### 引用式（Normalized）

用 ID 引用其他集合的文档，类似关系型数据库的外键：

```json
// users collection
{
  "_id": ObjectId("..."),
  "username": "zhangsan",
  "address_id": ObjectId("...")  // 引用地址
}

// addresses collection
{
  "_id": ObjectId("..."),
  "province": "Beijing",
  "city": "Beijing",
  "district": "Haidian"
}
```

---

## 什么时候用嵌入式？

**频繁一起读取的数据**，用嵌入式。

比如一篇文章，包含作者信息、标签、评论数：

```json
{
  "_id": ObjectId("..."),
  "title": "MongoDB 最佳实践",
  "author": {
    "id": ObjectId("..."),
    "name": "张三",
    "avatar": "https://..."
  },
  "tags": ["MongoDB", "数据库", "最佳实践"],
  "stats": {
    "views": 1000,
    "likes": 100,
    "comments": 50
  },
  "content": "..."
}
```

这样查一篇文章，作者信息、统计数据都一起返回了，**零额外查询**。

**适用场景：**
- 一对一小数据量：用户-简介、订单-收货地址
- 一对多且数量有限：文章-标签（通常不超过 10 个）
- 需要原子性更新的数据

---

## 什么时候用引用式？

**数据会被多个地方引用，或数据量很大的情况**，用引用式。

比如博客系统，用户可能发几百篇文章：

```json
// 用户文档
{
  "_id": ObjectId("..."),
  "username": "zhangsan",
  "email": "zhangsan@example.com"
}

// 文章集合 - 引用用户
{
  "_id": ObjectId("..."),
  "title": "我的第一篇文章",
  "author_id": ObjectId("...")  // 引用用户
}
```

如果把用户信息嵌入到每篇文章里：
- 用户改了昵称，要更新几百篇文章
- 用户信息重复存储，浪费空间

---

## 混合模式：最常见的选择

实际项目中，**嵌入式和引用式往往混合使用**。

```json
{
  "_id": ObjectId("..."),
  "username": "zhangsan",
  "email": "zhangsan@example.com",
  // 嵌入式：常用的、不会频繁更新的信息
  "profile": {
    "avatar": "https://...",
    "bio": "...",
    "verified": true
  },
  // 引用式：文章列表（ID 引用）
  "article_ids": [ObjectId("..."), ObjectId("...")],
  // 嵌入式：统计数据（经常一起读取）
  "stats": {
    "articles": 100,
    "followers": 5000,
    "following": 200
  }
}
```

---

## 数据建模原则

### 原则一：按访问模式设计

> 先问自己：数据是怎么被读取的？

如果 90% 的查询都要同时获取 A 和 B，就嵌入式。
如果 A 和 B 经常独立变化，就引用式。

### 原则二：考虑数据大小

MongoDB 文档有 **16MB 大小限制**，所以嵌入式数据不能太大。

比如用户收藏的文章列表，如果无限制存，可能突破限制。改用引用式：

```json
// users collection
{
  "_id": ObjectId("..."),
  "username": "zhangsan"
}

// favorites collection（单独集合）
{
  "_id": ObjectId("..."),
  "user_id": ObjectId("..."),
  "article_id": ObjectId("..."),
  "created_at": ISODate("...")
}
```

### 原则三：考虑原子性

MongoDB 单个文档的更新是原子的。如果需要同时更新多个字段，嵌入式可以保证原子性。

但如果需要单独更新被引用的文档，就得用引用式 + 事务。

---

## Java 代码示例

### 嵌入式写入

```java
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.MongoCollection;
import org.bson.Document;

MongoClient mongoClient = MongoClients.create("mongodb://localhost:27017");
MongoDatabase database = mongoClient.getDatabase("myapp");
MongoCollection&lt;Document&gt; users = database.getCollection("users");

// 嵌入式：用户 + 地址信息
Document user = new Document()
    .append("username", "zhangsan")
    .append("email", "zhangsan@example.com")
    .append("address", new Document()
        .append("city", "Beijing")
        .append("district", "Haidian")
        .append("street", "中关村大街1号"));

users.insertOne(user);
```

### 引用式查询

```java
// 查询用户及其所有文章（两步查询）
Document user = users.find(eq("username", "zhangsan")).first();
ObjectId userId = user.getObjectId("_id");

// 查询文章列表
MongoCollection&lt;Document&gt; articles = database.getCollection("articles");
List&lt;Document&gt; userArticles = articles.find(eq("author_id", userId)).into(new ArrayList&lt;&gt;());
```

---

## 常见反模式

### 反模式一：无限数组

```json
// ❌ 不好：comments 数组无限增长
{
  "article_id": "...",
  "comments": [
    { "user": "A", "text": "..." },
    { "user": "B", "text": "..." },
    // ... 可能几万条
  ]
}
```

**问题**：文档超 16MB、查询慢、无法分页。

**改进**：把评论单独放到一个 collection。

### 反模式二：过度引用

```json
// ❌ 不好：每个小字段都引用
{
  "name": "...",
  "name_id": ObjectId("..."),
  "city": "...",
  "city_id": ObjectId("..."),
  "country": "...",
  "country_id": ObjectId("...")
}
```

**问题**：本来一步能查完的，变成 N 步，JOIN 噩梦。

**改进**：常用信息直接存，需要变更时批量更新。

---

## 总结

MongoDB 数据模型设计没有标准答案，关键是**根据访问模式来设计**。

记住三个问题：
1. 数据是怎么被读取的？
2. 数据量有多大？
3. 需要原子性吗？

想清楚这三个问题，你就知道该用嵌入式还是引用式了。

---

## 面试追问方向

- MongoDB 单个文档大小限制是多少？
- 如果需要同时更新多个文档的数据，怎么保证原子性？
- 什么时候应该把数据放到单独的 Collection 而不是嵌入？
