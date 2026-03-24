# MongoDB 聚合框架：数据处理的瑞士军刀

你有一堆用户数据，想知道：
- 每个城市的用户数量
- 用户的年龄分布
- 每月的新增用户数
- 活跃用户和不活跃用户的比例

这些在 MySQL 里要用 GROUP BY、HAVING、子查询……

MongoDB 只需要一个**聚合管道（Aggregation Pipeline）**，优雅地搞定一切。

---

## 聚合管道是什么？

聚合管道就像工厂的流水线：

```
输入文档 → $match(过滤) → $group(分组) → $project(投影) → $sort(排序) → 输出
```

每个阶段处理完的数据，传递给下一个阶段，直到输出最终结果。

---

## Java 聚合框架基础

### 引入必要的类

```java
import com.mongodb.client.AggregateIterable;
import com.mongodb.client.MongoCollection;
import org.bson.Document;
import java.util.List;
import java.util.ArrayList;

MongoCollection&lt;Document&gt; collection = database.getCollection("users");
```

### 最简单的聚合：统计数量

```java
// 统计集合中的文档数量
List&lt;Document&gt; pipeline = List.of(
    new Document("$count", "total")
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
Document output = result.first();
System.out.println("总用户数: " + output.getInteger("total"));
```

---

## $match：过滤阶段

相当于 SQL 的 WHERE。

```java
// 过滤出年龄大于等于 18 的用户
List&lt;Document&gt; pipeline = List.of(
    new Document("$match", new Document("age", new Document("$gte", 18)))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

```java
// 多条件过滤
List&lt;Document&gt; pipeline = List.of(
    new Document("$match", new Document()
        .append("status", "active")
        .append("age", new Document("$gte", 18))
        .append("city", new Document("$in", List.of("Beijing", "Shanghai"))))
);
```

**性能优化建议**：
- `$match` 尽量放在管道前面，提前过滤数据
- 把大范围过滤放前面，小范围过滤放后面

---

## $group：分组阶段

相当于 SQL 的 GROUP BY。

### 基本分组

```java
// 按城市分组，统计用户数量
List&lt;Document&gt; pipeline = List.of(
    new Document("$group", new Document()
        .append("_id", "$city")                    // 分组字段
        .append("count", new Document("$sum", 1))  // 计数
        .append("avgAge", new Document("$avg", "$age"))  // 平均年龄
        .append("totalFollowers", new Document("$sum", "$followers"))  // 总粉丝数
    )
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
for (Document doc : result) {
    System.out.println("城市: " + doc.get("_id")
        + ", 人数: " + doc.getInteger("count")
        + ", 平均年龄: " + doc.getDouble("avgAge"));
}
```

### 分组聚合操作符

| 操作符 | 说明 | 示例 |
|-------|------|------|
| `$sum` | 求和 | `$sum: 1` 计数，`$sum: "$field"` 求字段和 |
| `$avg` | 平均值 | `$avg: "$score"` |
| `$min` | 最小值 | `$min: "$price"` |
| `$max` | 最大值 | `$max: "$price"` |
| `$push` | 数组收集 | `$push: "$username"` |
| `$addToSet` | 集合收集（不重复） | `$addToSet: "$tag"` |
| `$first` | 第一条（需排序后） | `$first: "$createdAt"` |
| `$last` | 最后一条（需排序后） | `$last: "$status"` |

---

## $project：投影阶段

相当于 SQL 的 SELECT 字段。

### 基本用法

```java
List&lt;Document&gt; pipeline = List.of(
    new Document("$project", new Document()
        .append("_id", 0)              // 排除 _id
        .append("username", 1)         // 包含 username
        .append("city", 1)             // 包含 city
        .append("ageInYears", "$age")  // 重命名字段
    ))
);
```

### 字段操作

```java
// 计算字段、重命名字段
List&lt;Document&gt; pipeline = List.of(
    new Document("$project", new Document()
        .append("username", 1)
        .append("age", 1)
        // 计算新字段
        .append("isAdult", new Document("$gte", List.of("$age", 18)))
        .append("ageGroup", new Document("$switch", new Document()
            .append("branches", List.of(
                new Document("case", new Document("$lt", List.of("$age", 18))),
                new Document("then", "未成年"),
                new Document("case", new Document("$lt", List.of("$age", 30))),
                new Document("then", "青年"),
                new Document("case", new Document("$lt", List.of("$age", 60))),
                new Document("then", "中年")
            ))
            .append("default", "老年")
        ))
    ))
);
```

---

## $sort：排序阶段

```java
// 按用户数量降序排列
List&lt;Document&gt; pipeline = List.of(
    new Document("$group", new Document()
        .append("_id", "$city")
        .append("count", new Document("$sum", 1))),
    new Document("$sort", new Document("count", -1))  // -1 降序，1 升序
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## $limit 和 $skip：分页

```java
// 第一页，每页 10 条
List&lt;Document&gt; pipeline = List.of(
    new Document("$sort", new Document("createdAt", -1)),
    new Document("$skip", 0),
    new Document("$limit", 10)
);

// 第二页
new Document("$skip", 10),
```

---

## $unwind：展开数组

把数组字段拆成多条文档。

```json
// 原始文档
{ "username": "zhangsan", "tags": ["Java", "MongoDB"] }

// $unwind 后
{ "username": "zhangsan", "tags": "Java" }
{ "username": "zhangsan", "tags": "MongoDB" }
```

```java
List&lt;Document&gt; pipeline = List.of(
    // 先过滤有 tags 的文档
    new Document("$match", new Document("tags", new Document("$exists", true))),
    // 展开 tags 数组
    new Document("$unwind", "$tags"),
    // 按 tag 分组统计
    new Document("$group", new Document()
        .append("_id", "$tags")
        .append("count", new Document("$sum", 1))),
    new Document("$sort", new Document("count", -1))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## $lookup：关联查询

相当于 SQL 的 LEFT JOIN。

```java
// 用户集合 join 订单集合
List&lt;Document&gt; pipeline = List.of(
    new Document("$lookup", new Document()
        .append("from", "orders")           // 关联的集合
        .append("localField", "_id")        // 本集合字段
        .append("foreignField", "userId")    // 关联集合字段
        .append("as", "userOrders")         // 结果字段名
    )),
    // 过滤有订单的用户
    new Document("$match", new Document("userOrders", new Document("$ne", List.of()))),
    // 只返回需要的字段
    new Document("$project", new Document()
        .append("username", 1)
        .append("orderCount", new Document("$size", "$userOrders")))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## $facet：多维度聚合

一次查询，多种聚合结果。

```java
List&lt;Document&gt; pipeline = List.of(
    new Document("$facet", new Document()
        // 第一个维度：按城市统计
        .append("byCity", List.of(
            new Document("$group", new Document()
                .append("_id", "$city")
                .append("count", new Document("$sum", 1))))
        ))
        // 第二个维度：按年龄段统计
        .append("byAgeGroup", List.of(
            new Document("$bucket", new Document()
                .append("groupBy", "$age")
                .append("boundaries", List.of(0, 18, 30, 50, 100))
                .append("default", "unknown")
                .append("output", new Document("count", new Document("$sum", 1))))
        ))
        // 第三个维度：最新 5 个用户
        .append("recentUsers", List.of(
            new Document("$sort", new Document("createdAt", -1)),
            new Document("$limit", 5),
            new Document("$project", new Document("username", 1).append("age", 1))
        ))
    ))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## 实战案例：用户行为分析

```java
// 统计用户活跃度分布
List&lt;Document&gt; pipeline = List.of(
    // 1. 过滤近30天活跃用户
    new Document("$match", new Document(
        "lastActiveAt", new Document("$gte", thirtyDaysAgo)
    )),
    // 2. 按用户分组，统计每日活跃
    new Document("$group", new Document()
        .append("_id", new Document("$dateToString", new Document()
            .append("format", "%Y-%m-%d")
            .append("date", "$lastActiveAt")))
        .append("activeUsers", new Document("$addToSet", "$_id"))
        .append("totalActions", new Document("$sum", "$actionCount"))
    )),
    // 3. 计算每日去重用户数
    new Document("$project", new Document()
        .append("_id", 1)
        .append("dau", new Document("$size", "$activeUsers"))
        .append("totalActions", 1)),
    // 4. 按日期排序
    new Document("$sort", new Document("_id", 1))
);

AggregateIterable&lt;Document&gt; result = collection.aggregate(pipeline);
```

---

## 性能优化

### 管道顺序很重要

```java
// ❌ 不好：先全量 group，再 filter
List.of(
    new Document("$group", new Document("_id", "$city").append("count", new Document("$sum", 1))),
    new Document("$match", new Document("count", gt(100)))
);

// ✅ 好：先 filter，减少 group 数据量
List.of(
    new Document("$match", new Document("status", "active")),
    new Document("$group", new Document("_id", "$city").append("count", new Document("$sum", 1))),
    new Document("$match", new Document("count", gt(100)))
);
```

### 使用 $limit 限制数据量

```java
// 如果只需要前 10 个结果，加 $limit 早停
List.of(
    new Document("$match", new Document("type", "sale")),
    new Document("$sort", new Document("amount", -1)),
    new Document("$limit", 10)  // 提前限制，减少后续阶段计算量
);
```

---

## 总结

聚合管道是 MongoDB 最强大的工具之一：

| 阶段 | 作用 | 类比 SQL |
|-----|-----|---------|
| `$match` | 过滤 | WHERE |
| `$group` | 分组 | GROUP BY |
| `$project` | 投影 | SELECT |
| `$sort` | 排序 | ORDER BY |
| `$limit` | 限制数量 | LIMIT |
| `$skip` | 跳过 | OFFSET |
| `$unwind` | 展开数组 | - |
| `$lookup` | 关联 | JOIN |

记住：**把能过滤的数据早点过滤**，性能提升立竿见影。

---

## 面试追问方向

- `$group` 和 `$bucket` 的区别是什么？
- `$lookup` 有什么性能问题？如何优化？
- 聚合管道的执行顺序可以调整吗？为什么？
