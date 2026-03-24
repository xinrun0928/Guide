# MongoDB 慢查询：找出那个拖慢你系统的「凶手」

凌晨 2 点，你被报警叫醒：接口响应时间从 50ms 飙到了 5 秒。

日志里全是数据库超时，但数据库 CPU 和内存都正常。

你懵了。

这种情况，**慢查询分析**是你排查问题的第一步。

---

## 慢查询是怎么发生的？

MongoDB 中，查询慢的原因主要有几种：

| 原因 | 表现 | 解决方案 |
|-----|-----|---------|
| 全表扫描 | COLLSCAN | 加索引 |
| 索引选择不当 | 没选最优索引 | 优化索引 |
| 投影过多 | 返回了大字段 | 只查需要的字段 |
| 排序无索引 | SORT 阶段慢 | 建索引或内存排序 |
| 网络传输慢 | 数据量大 | 分页或限制返回 |
| 锁等待 | 并发冲突 | 减少长事务 |

---

## 开启慢查询日志

MongoDB 默认把超过 100ms 的操作记入慢日志。

### 查看当前阈值

```java
// 查看慢查询阈值（毫秒）
Document result = database.runCommand(new Document("getParameter", 1)
    .append("slowOpThresholdMs", 1));

// 默认 100ms
System.out.println(result.get("slowOpThresholdMs"));
```

### 修改阈值

```java
// 设置慢查询阈值为 50ms
database.runCommand(new Document("setParameter", 1)
    .append("slowOpThresholdMs", 50));
```

### 查看慢日志

```java
// 使用 Profiler 查看慢查询
List&lt;Document&gt; slowQueries = database.getCollection("system.profile")
    .find(gte("millis", 100))
    .sort(descending("ts"))
    .limit(10)
    .into(new ArrayList&lt;&gt;());

for (Document query : slowQueries) {
    System.out.println("执行时间: " + query.getInteger("millis") + "ms");
    System.out.println("操作类型: " + query.getString("op"));
    System.out.println("集合: " + query.getString("ns"));
    System.out.println("查询条件: " + query.get("query"));
    System.out.println("---");
}
```

---

## explain() 分析查询

慢查询分析的核心工具是 `explain()`。

### 基础分析

```java
import static com.mongodb.client.model.ExplainVerbosity.*;

Document query = collection.find(
    Filters.eq("status", "active")
).explain(QUERY_PLANNER);

System.out.println(query.toJson());
```

### 关键字段解读

```json
{
  "queryPlanner": {
    "winningPlan": {
      "stage": "FETCH",
      "inputStage": {
        "stage": "IXSCAN",        // 关键：是否使用索引
        "keyPattern": { "status": 1 },
        "indexName": "status_1",
        "nReturned": 10,
        "totalDocsExamined": 10,  // 关键：扫描了多少文档
        "totalKeysExamined": 10   // 关键：检查了多少索引键
      }
    }
  },
  "executionStats": {
    "executionTimeMillis": 5,
    "nReturned": 10,
    "totalKeysExamined": 10,
    "totalDocsExamined": 10,
    "executionStages": [...]
  }
}
```

**判断标准：**
- `totalDocsExamined` 越接近 `nReturned` 越好
- `stage` 是 `IXSCAN` + `FETCH` 是理想状态
- 如果是 `COLLSCAN`，说明没用索引

---

## 常见慢查询场景

### 场景一：投影返回大字段

```java
// ❌ 慢：返回整个文档，包含大字段
FindIterable&lt;Document&gt; result = collection.find(eq("userId", userId));

// ✅ 快：只返回需要的字段
FindIterable&lt;Document&gt; result = collection.find(eq("userId", userId))
    .projection(Projections.include("username", "email"));
```

### 场景二：排序无索引

```java
// ❌ 慢：按 createdAt 排序，但没有这个字段的索引
// MongoDB 会在内存中排序，数据量大时很慢
FindIterable&lt;Document&gt; result = collection.find()
    .sort(Sorts.descending("createdAt"))
    .limit(100);

// ✅ 快：建索引，MongoDB 用索引排序
collection.createIndex(Indexes.descending("createdAt"));

// ✅ 快：限制返回数量，减少内存占用
FindIterable&lt;Document&gt; result = collection.find()
    .sort(Sorts.descending("createdAt"))
    .limit(1000);  // 最多排 1000 条
```

### 场景三：深度分页

```java
// ❌ 极慢：跳过大数据量后取几条
FindIterable&lt;Document&gt; result = collection.find()
    .skip(1000000)  // 跳过一百万条
    .limit(10);

// ✅ 快：基于上一页最后一条记录继续查
if (lastDoc != null) {
    FindIterable&lt;Document&gt; result = collection.find(
        Filters.gt("_id", lastDoc.getObjectId("_id"))
    ).limit(10);
}

// ✅ 快：使用 Cursor，基于 _id 排序
FindIterable&lt;Document&gt; result = collection.find()
    .sort(Sorts.ascending("_id"))
    .limit(1000);
```

### 场景四：正则表达式

```java
// ❌ 慢：正则不是前缀匹配，无法用索引
FindIterable&lt;Document&gt; result = collection.find(
    Filters.regex("username", "san")
);

// ✅ 快：前缀匹配可以用索引
FindIterable&lt;Document&gt; result = collection.find(
    Filters.regex("username", "^zhang")
);
```

---

## 系统工具分析

### mongotop

查看每个集合的读写时间：

```bash
mongotop --host localhost:27017 3

# 输出：
#                            ns    total    read    write
#                      myapp.users    125ms    80ms    45ms
#                   myapp.orders     2340ms  1230ms   1110ms
#                myapp.products       45ms    30ms    15ms
```

### mongostat

查看数据库状态：

```bash
mongostat --host localhost:27017 1

# 输出：
# insert query update delete getmore command flushes mapped  vsize    res nonpt
#     100    500      0      0       0     2|0       0   512mb  1.5gb   256mb  0.0
```

关注这些列：
- `query`：每秒查询数
- `locked`：锁等待比例（超过 30% 说明有问题）
- `miss`：页面缓存未命中

---

## Java 中排查慢查询

### 添加日志

```java
import org.bson.Document;
import java.time.Duration;

MongoClientSettings settings = MongoClientSettings.builder()
    .applyConnectionString(new ConnectionString("mongodb://localhost:27017"))
    .commandListener((commandStarted, next) -> {
        // 记录慢查询
        if (commandStarted.getCommandName().equals("find")) {
            long startTime = System.currentTimeMillis();
            next.run();
            long elapsed = System.currentTimeMillis() - startTime;
            if (elapsed > 100) {
                System.out.println("慢查询 [" + elapsed + "ms]: "
                    + commandStarted.getCommand().toString());
            }
        } else {
            next.run();
        }
    })
    .build();
```

### 配置 Profiler

```java
// 设置 Profiler 级别（2 = 所有操作，1 = 慢查询，0 = 关闭）
database.runCommand(new Document("profile", 1)
    .append("slowms", 100)  // 慢查询阈值
    .append("sampleRate", 1.0));  // 采样率

// 查询 Profiler 数据
List&lt;Document&gt; profiles = database.getCollection("system.profile")
    .find(gte("millis", 100))
    .into(new ArrayList&lt;&gt;());
```

---

## 优化建议清单

| 问题 | 优化方案 |
|-----|---------|
| COLLSCAN | 分析查询条件，加合适索引 |
| 排序慢 | 确保排序字段有索引 |
| 投影多 | 使用 projection 只查需要的字段 |
| 深分页 | 用基于 ID 的游标分页 |
| 大数据量 | 分批处理，不要一次查太多 |
| 锁等待 | 减少长事务，拆分批量操作 |

---

## 总结

慢查询排查三部曲：

1. **开启慢日志**，找到慢查询
2. **explain() 分析**，看执行计划
3. **针对性优化**，加索引、调投影、改分页

记住：优化之前先测量，测量之前先定位。盲目的优化往往适得其反。

---

## 面试追问方向

- MongoDB 的 COLLSCAN 和 IXSCAN 有什么区别？
- 如何优化深度分页？
- 什么情况下索引会失效？
