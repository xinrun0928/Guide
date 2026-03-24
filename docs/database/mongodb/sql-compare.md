# MongoDB vs SQL：一张表看懂所有对应关系

你是不是也这样？

会 MySQL，但第一次用 MongoDB 时，一脸懵：
- 表叫什么？Document？Collection？
- WHERE 怎么写？
- JOIN 怎么做？
- GROUP BY 还有吗？

别急，这篇文章用 MySQL 的思维来学 MongoDB，看完你就能无痛切换。

---

## 核心概念对应

| MySQL | MongoDB | 说明 |
|-------|--------|------|
| Database | Database | 数据库 |
| Table | Collection | 表 → 集合 |
| Row | Document | 行 → 文档 |
| Column | Field | 列 → 字段 |
| Index | Index | 索引 |
| Primary Key | `_id` | 主键（自动创建） |
| Foreign Key | ObjectId 引用 | 外键（手动维护） |
| View | View | 视图 |
| Trigger | Change Stream | 变更流 |

---

## 创建数据库和集合

### MySQL

```sql
CREATE DATABASE myapp;
USE myapp;

CREATE TABLE users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL,
    email VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### MongoDB

```java
// MongoDB 不需要预先创建 Collection，第一条数据写入时自动创建
// 但可以通过 Java 代码显式创建（设置验证规则等）
MongoDatabase database = mongoClient.getDatabase("myapp");
MongoCollection&lt;Document&gt; users = database.getCollection("users");

// 插入数据，Collection 会自动创建
users.insertOne(new Document()
    .append("username", "zhangsan")
    .append("email", "zhangsan@example.com"));
```

---

## 插入数据

### MySQL

```sql
-- 单条插入
INSERT INTO users (username, email) VALUES ('zhangsan', 'zhangsan@example.com');

-- 批量插入
INSERT INTO users (username, email) VALUES
    ('user1', 'user1@example.com'),
    ('user2', 'user2@example.com');
```

### MongoDB

```java
// 单条插入
users.insertOne(new Document()
    .append("username", "zhangsan")
    .append("email", "zhangsan@example.com"));

// 批量插入
List&lt;Document&gt; docs = List.of(
    new Document().append("username", "user1").append("email", "user1@example.com"),
    new Document().append("username", "user2").append("email", "user2@example.com")
);
users.insertMany(docs);
```

---

## 查询数据

### MySQL

```sql
-- 基础查询
SELECT * FROM users;

-- 条件查询
SELECT * FROM users WHERE age >= 18;

-- 模糊查询
SELECT * FROM users WHERE username LIKE 'zhang%';

-- 只查某些列
SELECT username, email FROM users;

-- 排序
SELECT * FROM users ORDER BY created_at DESC;

-- 分页
SELECT * FROM users LIMIT 10 OFFSET 20;
```

### MongoDB

```java
import static com.mongodb.client.model.Filters.*;
import static com.mongodb.client.model.Sorts.*;
import static com.mongodb.client.model.Projections.*;

// 基础查询
collection.find();

// 条件查询
collection.find(gte("age", 18));

// 模糊查询（正则）
collection.find(regex("username", "^zhang"));

// 只查某些字段
collection.find().projection(include("username", "email"));

// 排序
collection.find().sort(descending("createdAt"));

// 分页
collection.find().skip(20).limit(10);
```

---

## 更新数据

### MySQL

```sql
-- 更新单个字段
UPDATE users SET email = 'new@example.com' WHERE username = 'zhangsan';

-- 更新多个字段
UPDATE users SET email = 'new@example.com', age = 30 WHERE username = 'zhangsan';

-- 原子递增
UPDATE users SET views = views + 1 WHERE id = 1;

-- 批量更新
UPDATE users SET status = 'inactive' WHERE last_login < DATE_SUB(NOW(), INTERVAL 1 YEAR);
```

### MongoDB

```java
// 更新单个字段
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$set", new Document("email", "new@example.com"))
);

// 更新多个字段
collection.updateOne(
    eq("username", "zhangsan"),
    new Document("$set", new Document()
        .append("email", "new@example.com")
        .append("age", 30))
);

// 原子递增
collection.updateOne(
    eq("_id", 1),
    new Document("$inc", new Document("views", 1))
);

// 批量更新
collection.updateMany(
    lt("lastLogin", yesterday),
    new Document("$set", new Document("status", "inactive"))
);
```

---

## 删除数据

### MySQL

```sql
-- 删除单条
DELETE FROM users WHERE username = 'zhangsan';

-- 批量删除
DELETE FROM users WHERE status = 'deleted' AND created_at < '2023-01-01';

-- 清空表
DELETE FROM users;
```

### MongoDB

```java
// 删除单条
collection.deleteOne(eq("username", "zhangsan"));

// 批量删除
collection.deleteMany(
    and(
        eq("status", "deleted"),
        lt("createdAt", startOf2023)
    )
);

// 清空集合
collection.deleteMany(new Document());
```

---

## 聚合查询（替代 GROUP BY）

### MySQL

```sql
-- 统计每个城市的用户数
SELECT city, COUNT(*) as count
FROM users
GROUP BY city
HAVING count > 100;

-- 关联查询
SELECT u.username, o.order_id, o.total
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE o.created_at > '2024-01-01';
```

### MongoDB

```java
import com.mongodb.client.AggregateIterable;

// 按城市统计用户数
List&lt;Document&gt; pipeline = List.of(
    // $group 按城市分组，统计数量
    new Document("$group", new Document()
        .append("_id", "$city")
        .append("count", new Document("$sum", 1))),
    // $match 过滤数量大于100的
    new Document("$match", new Document("count", gt(100)))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## 索引操作

### MySQL

```sql
-- 创建索引
CREATE INDEX idx_username ON users(username);
CREATE INDEX idx_city_age ON users(city, age);

-- 查看索引
SHOW INDEX FROM users;

-- 删除索引
DROP INDEX idx_username ON users;
```

### MongoDB

```java
import com.mongodb.client.model.Indexes;
import com.mongodb.client.model.IndexOptions;

// 创建单字段索引
collection.createIndex(Indexes.ascending("username"));

// 创建复合索引
collection.createIndex(Indexes.compoundIndex(
    Indexes.ascending("city"),
    Indexes.descending("age")
));

// 查看集合的所有索引
List&lt;IndexModel&gt; indexes = collection.listIndexes().into(new ArrayList&lt;&gt;());
for (IndexModel index : indexes) {
    System.out.println(index.getKeys());
}

// 删除索引
collection.dropIndex("username_1");
```

---

## 表结构变更

### MySQL

```sql
-- 添加列
ALTER TABLE users ADD COLUMN phone VARCHAR(20);

-- 修改列
ALTER TABLE users MODIFY COLUMN phone VARCHAR(30);

-- 删除列
ALTER TABLE users DROP COLUMN phone;

-- 添加索引
ALTER TABLE users ADD INDEX idx_phone (phone);
```

### MongoDB

MongoDB 不需要 ALTER TABLE，直接插入新字段就行。但如果你想给现有文档补充缺失字段，需要用 update：

```java
// 添加/修改字段（对所有文档执行）
collection.updateMany(
    new Document(),  // 空文档 = 匹配所有
    new Document("$set", new Document("phone", ""))
);

// 删除字段
collection.updateMany(
    new Document(),
    new Document("$unset", new Document("tempField", 1))
);

// 重命名字段（需要逐条更新）
collection.updateMany(
    new Document(),
    new Document("$rename", new Document("oldName", "newName"))
);
```

---

## 常用命令对照

| 操作 | MySQL | MongoDB |
|-----|-------|---------|
| 查看所有数据库 | `SHOW DATABASES` | `show dbs` |
| 使用数据库 | `USE dbname` | `use dbname` |
| 查看所有表 | `SHOW TABLES` | `show collections` |
| 查看表结构 | `DESC users` | `db.users.findOne()` |
| 查看数据量 | `SELECT COUNT(*) FROM users` | `db.users.countDocuments()` |
| 清空表 | `TRUNCATE TABLE users` | `db.users.deleteMany({})` |

---

## 总结

MongoDB 和 MySQL 的核心区别在于：

| 维度 | MySQL | MongoDB |
|-----|-------|---------|
| 数据模型 | 关系型，固定Schema | 文档型，灵活Schema |
| JOIN | 原生支持 | 有限（$lookup） |
| 事务 | 成熟 | 4.0+ 才完善 |
| 扩展方式 | 垂直扩展为主 | 水平扩展容易 |

**选型建议：**
- 结构固定、关联多、事务强 → MySQL
- 结构灵活、数据量大、追求写入性能 → MongoDB

---

## 面试追问方向

- MongoDB 能替代 MySQL 吗？什么情况下不能替代？
- MongoDB 的 $lookup 和 MySQL 的 JOIN 有什么区别？
- MongoDB 的 Schema-less 有什么缺点？
