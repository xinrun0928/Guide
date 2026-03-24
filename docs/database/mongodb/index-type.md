# MongoDB 索引类型：选择正确的索引，事半功倍

你的 MongoDB 查询慢吗？

100 万条数据的表，没加索引时查一条记录要扫描全表；加了索引，同样的查询只要几次比较就能找到。

但 MongoDB 有很多种索引类型，用错了，不仅没效果，还浪费空间。

这篇文章，帮你搞清楚每种索引的适用场景。

---

## 为什么需要索引？

想象你在图书馆找一本书：

- **没索引**：从第一排书架开始，一本一本找，找到第 80 万本才发现是它 —— 全表扫描
- **有索引**：先查索引卡片，找到「技术书籍-编程-MongoDB」，然后直接去对应书架 —— 索引查询

MongoDB 默认会给 `_id` 字段创建唯一索引，其他字段的索引需要你自己创建。

---

## 索引类型一览

| 索引类型 | 适用场景 |
|---------|---------|
| 单字段索引 | 单列等值查询 |
| 复合索引 | 多列组合查询 |
| 多键索引 | 数组字段查询 |
| 文本索引 | 全文搜索 |
| 地理空间索引 | 位置查询 |
| 哈希索引 | 分片集群 |
| 唯一索引 | 字段值唯一 |
| 稀疏索引 | 字段稀疏分布 |
| TTL 索引 | 自动过期 |

---

## 单字段索引

最基础的索引，适用于单列的等值查询。

```java
import com.mongodb.client.model.Indexes;
import com.mongodb.client.model.IndexOptions;

// 在 username 字段上创建升序索引
collection.createIndex(Indexes.ascending("username"));

// 在 createdAt 字段上创建降序索引（适合倒序排列的查询）
collection.createIndex(Indexes.descending("createdAt"));
```

```json
// 生成的索引结构
{
  "v": 2,
  "key": { "username": 1 },
  "name": "username_1"
}
```

**使用场景：**
- 用户名查询
- 状态字段查询（`WHERE status = 'active'`）
- 日期字段查询（按时间排序的列表）

---

## 复合索引

多个字段组合的索引，适用于多条件查询。

```java
// 创建复合索引：city + age + username
collection.createIndex(Indexes.compoundIndex(
    Indexes.ascending("city"),
    Indexes.descending("age"),
    Indexes.ascending("username")
));
```

**使用场景：**
- `WHERE city = 'Beijing' AND age >= 18`
- `WHERE city = 'Beijing' AND age >= 18 ORDER BY age DESC`

### 最左前缀原则

复合索引遵循最左前缀原则，和 MySQL 一样。

索引 ` {city: 1, age: 1}` 可以支持：

| 查询 | 是否使用索引 |
|-----|------------|
| `city = 'Beijing'` | ✅ 使用 |
| `city = 'Beijing' AND age = 20` | ✅ 使用 |
| `city = 'Beijing' AND age > 18` | ✅ 使用 |
| `age = 20` | ❌ 不使用 |
| `age > 18` | ❌ 不使用 |

### 字段顺序选择

复合索引的字段顺序很重要，一般遵循：

1. **等值查询字段放前面**：字段 = 值
2. **范围查询字段放后面**：字段 > 值
3. **排序字段根据方向决定位置**

```java
// 查询条件：city = 'Beijing' AND age >= 18 ORDER BY createdAt DESC
// 索引设计：city(等值) -> age(范围) -> createdAt(排序)
collection.createIndex(Indexes.compoundIndex(
    Indexes.ascending("city"),      // 等值，放最前
    Indexes.ascending("age"),       // 范围，放中间
    Indexes.descending("createdAt") // 排序，放最后
));
```

---

## 多键索引

数组字段自动创建的索引。

```java
// tags 是数组字段：[ "Java", "MongoDB", "数据库" ]
// MongoDB 会自动为 tags 创建多键索引
collection.createIndex(Indexes.ascending("tags"));

// 查询包含特定标签的用户
collection.find(eq("tags", "MongoDB"));
```

**限制：**
- 一个集合只能有一个多键索引包含数组字段（避免索引爆炸）
- 索引字段不能是数组的数组

---

## 文本索引

用于全文搜索，支持多字段。

```java
// 单字段文本索引
collection.createIndex(Indexes.text("title"));

// 多字段文本索引
collection.createIndex(Indexes.compoundIndex(
    Indexes.text("title"),
    Indexes.text("content")
));

// 设置权重
collection.createIndex(
    new Document("title", "text").append("content", "text"),
    new IndexOptions().weights(new Document()
        .append("title", 10)    // title 匹配权重更高
        .append("content", 1))
);
```

```java
// 文本搜索
collection.find(
    new Document("$text", new Document("$search", "MongoDB 索引"))
);
```

**限制：**
- 每个集合最多一个文本索引
- 不支持中文分词（需要额外配置中文分词器）

---

## 地理空间索引

用于地理位置查询，比如「附近的人」「范围内搜索」。

### 2dsphere 索引（球面坐标）

```java
// location 字段格式：GeoJSON
// { "type": "Point", "coordinates": [经度, 纬度] }
Document location = new Document()
    .append("type", "Point")
    .append("coordinates", List.of(116.404, 39.915));  // 北京

Document user = new Document()
    .append("username", "zhangsan")
    .append("location", location);

collection.createIndex(Indexes.geo2dsphere("location"));
```

```java
import com.mongodb.client.model.geojson.*;
import static com.mongodb.client.model.Filters.*;

// 查询附近 5 公里内的用户
collection.find(
    nearSphere("location",
        new Point(new Position(116.404, 39.915)),
        5000.0,  // 最大距离（米）
        null)     // 最小距离
);
```

### 2d 索引（平面坐标）

适用于小游戏地图等小范围平面坐标场景。

---

## 哈希索引

用于分片集群，将字段哈希后分布到不同分片。

```java
// 分片键常用哈希索引
collection.createIndex(Indexes.hashed("userId"));
```

**特点：**
- 不支持范围查询（`userId > 100` 无法使用索引）
- 数据分布均匀，适合分片

---

## 唯一索引

保证字段值的唯一性。

```java
IndexOptions options = new IndexOptions().unique(true);

collection.createIndex(
    Indexes.ascending("email"),
    options
);

// 尝试插入重复 email 会报错
collection.insertOne(new Document("email", "exists@example.com"));
// DuplicateKeyException
```

**复合唯一索引：**

```java
// userId + status 组合唯一
collection.createIndex(
    Indexes.compoundIndex(
        Indexes.ascending("userId"),
        Indexes.ascending("status")
    ),
    new IndexOptions().unique(true)
);
```

---

## 稀疏索引

只为存在该字段的文档创建索引，忽略 null 值。

```java
IndexOptions options = new IndexOptions()
    .sparse(true)
    .unique(true);

collection.createIndex(Indexes.ascending("phone"), options);
```

**使用场景：**
- 字段大部分文档都没有（可选字段）
- 避免索引膨胀

---

## TTL 索引

自动删除过期文档，常用于会话、缓存、日志。

```java
// createdAt 后 30 天自动删除
collection.createIndex(
    Indexes.ascending("createdAt"),
    new IndexOptions().expireAfterSeconds(30 * 24 * 60 * 60L)
);
```

**限制：**
- 只能单字段
- 字段必须是 Date 类型
- 不支持数组字段

---

## 索引选择指南

| 场景 | 推荐索引 |
|-----|---------|
| 等值查询 username | 单字段索引 |
| 多条件查询 + 排序 | 复合索引 |
| 数组标签查询 | 多键索引 |
| 文章全文搜索 | 文本索引 |
| 附近商家 | 2dsphere 索引 |
| 分片键 | 哈希索引 |
| 保证 email 唯一 | 唯一索引 |
| 临时数据过期删除 | TTL 索引 |

---

## 总结

索引选对了，查询快 100 倍；选错了，浪费空间还没效果。

记住几个原则：
1. **等值字段放索引前面，范围和排序放后面**
2. **复合索引要匹配查询模式**
3. **不是索引越多越好，每个索引都要维护成本**

---

## 面试追问方向

- 复合索引 (a, b, c) 和 (a, c, b) 有什么区别？
- 什么情况下索引会失效？
- MongoDB 的 text 索引有什么限制？如何支持中文搜索？
