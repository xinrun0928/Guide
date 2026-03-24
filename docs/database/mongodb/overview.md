# MongoDB 是什么？为什么你的下一个项目应该考虑它？

你正在为一个社交应用设计数据库，用户可以随意关注、取消关注，发帖子、评论、点赞。

如果用 MySQL，你要怎么存？

用户表、关注关系表、帖子表、评论表、点赞表……表越来越多，关联查询越来越慢，每次改需求都要改一堆表。

而 MongoDB，可能只需要一个 collection 就能搞定。

这就是 MongoDB 的魅力——**灵活的文档模型，让它天生适合处理「数据结构变化快」「嵌套关系多」「原型阶段快速迭代」的场景**。

---

## MongoDB 的诞生与核心理念

MongoDB 诞生于 2007 年，由 10gen 公司（后更名为 MongoDB Inc.）开发。它的名字来自英文单词 "humongous"，意思是「巨大的」——团队希望这个数据库能够处理海量的数据。

MongoDB 的核心理念有三个：

1. **文档导向**：数据以文档（Document）为基本单位，而不是行
2. **无 Schema**：文档不需要预先定义结构，可以随时增减字段
3. **横向扩展**：原生支持分片，数据可以分散到多台机器上

---

## 文档模型：MongoDB 的基本单元

在 MongoDB 中，数据存储的基本单位是**文档（Document）**。

一个文档就是一个 JSON 对象的二进制表示（BSON），长这样：

```json
{
  "_id": ObjectId("..."),
  "username": "zhangsan",
  "profile": {
    "age": 28,
    "city": "Beijing",
    "interests": ["reading", "coding", "gaming"]
  },
  "followers": 1000,
  "createdAt": ISODate("2024-01-01")
}
```

相比 MySQL 的行，文档有几个显著优势：

| 特性 | MySQL 行 | MongoDB 文档 |
|-----|---------|--------------|
| 结构 | 固定 Schema | 灵活 Schema |
| 嵌套 | 需要额外表 | 原生支持 |
| 数组 | 需要额外表 | 原生支持 |
| 修改结构 | ALTER TABLE | 直接写入新字段 |

---

## Collection 与 Database

**文档**组成**集合（Collection）**，**集合**组成**数据库（Database）**。

```
Database
├── Collection: users
├── Collection: orders
└── Collection: products
```

这和 MySQL 的 database → table 结构类似，但更灵活。

注意：MongoDB 的 collection 不需要预先创建，当你往里面写入第一篇文档时，它会自动创建。

---

## Java 代码初体验

MongoDB 支持多种语言的客户端，以 Java 为例：

```java
import com.mongodb.client.MongoClients;
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoDatabase;
import com.mongodb.client.MongoCollection;
import org.bson.Document;

public class MongoDBDemo {
    public static void main(String[] args) {
        // 连接到 MongoDB
        try (MongoClient mongoClient = MongoClients.create("mongodb://localhost:27017")) {
            // 获取数据库和集合
            MongoDatabase database = mongoClient.getDatabase("myapp");
            MongoCollection&lt;Document&gt; collection = database.getCollection("users");

            // 插入文档
            Document doc = new Document()
                .append("username", "zhangsan")
                .append("age", 28)
                .append("skills", List.of("Java", "MongoDB"));

            collection.insertOne(doc);
            System.out.println("文档插入成功");
        }
    }
}
```

依赖（使用 Maven）：

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.mongodb&lt;/groupId&gt;
    &lt;artifactId&gt;mongodb-driver-sync&lt;/artifactId&gt;
    &lt;version&gt;4.11.1&lt;/version&gt;
&lt;/dependency&gt;
```

---

## MongoDB 的适用场景

MongoDB 不是银弹，它有自己的主场：

**最适合的场景：**
- 内容管理系统（CMS）：文章、评论、标签，嵌套结构多
- 用户画像：字段随时增减，不固定
- 物联网（IoT）：传感器数据，结构不统一
- 原型开发：快速迭代，Schema 还没定下来
- 日志系统：写入密集，需要水平扩展

**不太适合的场景：**
- 强事务需求：虽然 MongoDB 4.0+ 支持事务，但不如 MySQL 成熟
- 复杂关联查询：JOIN 能力弱，多表关联不如 SQL
- 结构高度统一的数据：比如财务系统，每笔账目结构必须一样

---

## MongoDB vs MySQL：选择指南

| 维度 | MongoDB | MySQL |
|-----|---------|-------|
| 数据模型 | 文档（BSON） | 关系（行+列） |
| Schema | 动态 | 固定 |
| JOIN | 有限（$lookup） | 强大 |
| 事务 | 4.0+ 支持 | 原生支持 |
| 扩展性 | 水平扩展容易 | 垂直扩展为主 |
| 写入性能 | 高 | 中 |
| 成熟度 | 较新 | 20+ 年 |

---

## 下一步

MongoDB 的理念你已了解，接下来我们深入它的数据模型设计。

---

## 面试追问方向

- MongoDB 和 MySQL 的核心区别是什么？各自适用什么场景？
- 为什么 MongoDB 的写入性能比 MySQL 高？
