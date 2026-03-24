# MongoDB 索引管理：让索引成为你的得力助手

索引建好了，但你真的了解它吗？

索引占用多少空间？查询有没有用到索引？怎么知道索引创建得对不对？

这篇文章教你如何管理和优化索引。

---

## 查看索引

### 查看集合的所有索引

```java
// 列出所有索引
List&lt;IndexModel&gt; indexes = collection.listIndexes().into(new ArrayList&lt;&gt;());

for (IndexModel index : indexes) {
    Document keys = index.getKeys();
    Document options = index.getOptions();
    System.out.println("索引名: " + options.getString("name"));
    System.out.println("键: " + keys);
    System.out.println("---");
}
```

输出示例：

```json
{
  "name": "_id_",
  "key": { "_id": 1 },
  "v": 2
}
{
  "name": "username_1",
  "key": { "username": 1 },
  "v": 2,
  "unique": true
}
{
  "name": "city_1_age_-1",
  "key": { "city": 1, "age": -1 },
  "v": 2
}
```

### 查看索引大小

```java
// 使用 aggregate 查看索引总大小
List&lt;Document&gt; result = database.runCommand(
    new Document("collStats", "users")
).get("indexSizes", List.class);

// 或通过 shell
// db.users.totalIndexSize()
```

---

## 创建索引

### 基本创建

```java
import com.mongodb.client.model.Indexes;
import com.mongodb.client.model.IndexOptions;

// 普通索引
collection.createIndex(Indexes.ascending("username"));

// 带选项的索引
IndexOptions options = new IndexOptions()
    .name("idx_username_email")  // 自定义索引名
    .unique(true)                 // 唯一索引
    .background(true)            // 后台创建（生产环境必须）
    .sparse(true);               // 稀疏索引

collection.createIndex(
    Indexes.compoundIndex(
        Indexes.ascending("username"),
        Indexes.ascending("email")
    ),
    options
);
```

### 后台创建 vs 前台创建

**重要**：生产环境必须使用 `background: true`。

| 模式 | 阻塞 | 时间 | 适用场景 |
|-----|-----|-----|---------|
| foreground | 阻塞所有操作 | 快 | 测试环境 |
| background | 不阻塞 | 慢（3-10倍） | 生产环境 |

```java
// ✅ 生产环境：后台创建，不阻塞读写
collection.createIndex(
    Indexes.ascending("phone"),
    new IndexOptions().background(true)
);

// ❌ 前台创建（生产环境禁止）：会锁住整个集合
collection.createIndex(Indexes.ascending("phone"));
```

---

## 删除索引

### 删除单个索引

```java
// 按名称删除
collection.dropIndex("username_1");

// 按键删除
collection.dropIndex(Indexes.ascending("username"));
```

### 删除所有非 _id 索引

```java
// 删除集合的所有索引（除了 _id）
collection.dropIndexes();
```

### 删除索引的注意事项

```java
// ❌ 错误：删除后立即重建可能来不及
collection.dropIndex("old_index");
collection.createIndex(Indexes.ascending("field"));

// ✅ 正确：先创建新索引，再删除旧索引
// 1. 创建新索引
collection.createIndex(
    Indexes.ascending("newField"),
    new IndexOptions().background(true)
);

// 2. 确认新索引生效后，删除旧索引
collection.dropIndex("old_index");
```

---

## 修改索引

MongoDB 不支持直接修改索引，需要删除后重建。

```java
// 1. 删除旧索引
collection.dropIndex("old_idx_name");

// 2. 创建新索引
collection.createIndex(
    Indexes.ascending("field"),
    new IndexOptions()
        .name("new_idx_name")
        .background(true)
);
```

---

## 分析索引效果

### explain() 查看查询计划

这是最重要的索引分析工具：

```java
import com.mongodb.client.model.Filters;
import static com.mongodb.client.model.ExplainVerbosity.*;

// 查看查询的详细执行计划
Document explain = collection.find(Filters.eq("username", "zhangsan"))
    .explain(new ExplainProfileLevel(ExplainVerbosity.QUERY_PLANNER));

System.out.println(explain.toJson());
```

关键字段解读：

```json
{
  "queryPlanner": {
    "plannerVersion": 1,
    "namespace": "myapp.users",
    "indexFilterSet": false,
    "parsedQuery": { "username": { "$eq": "zhangsan" } },
    "winningPlan": {
      "stage": "FETCH",           // FETCH 表示从索引获取文档
      "inputStage": {
        "stage": "IXSCAN",        // IXSCAN = 索引扫描
        "keyPattern": { "username": 1 },
        "indexName": "username_1",
        "isMultiKey": false,
        "nReturned": 1,           // 返回 1 条记录
        "totalDocsExamined": 1    // 扫描了 1 条文档（好！）
      }
    }
  },
  "executionStats": {
    "executionSuccess": true,
    "nReturned": 1,
    "totalKeysExamined": 1,      // 检查了 1 个索引键
    "totalDocsExamined": 1,      // 检查了 1 个文档
    "executionTimeMillis": 0,
    "winningPlan": { ... }
  }
}
```

### 关键指标判断

| 指标 | 理想值 | 说明 |
|-----|-------|------|
| `totalDocsExamined` | ≈ `nReturned` | 等于最好，说明没有多余扫描 |
| `totalKeysExamined` | ≈ `nReturned` | 等于最好，说明索引效率高 |
| `stage` | IXSCAN + FETCH | 如果是 COLLSCAN，说明没用索引 |
| `nReturned` | 符合预期 | 查询应该返回多少条 |

**不好的执行计划示例：**

```json
{
  "winningPlan": {
    "stage": "COLLSCAN",    // COLLSCAN = 全表扫描！
    "direction": "forward"
  },
  "executionStats": {
    "totalDocsExamined": 1000000,  // 扫描了 100 万条
    "nReturned": 1                // 只返回 1 条
  }
}
```

---

## 索引命名规范

好的索引名应该能一眼看出用途：

```java
// ✅ 好的命名
collection.createIndex(
    Indexes.compoundIndex(
        Indexes.ascending("city"),
        Indexes.descending("age")
    ),
    new IndexOptions().name("idx_city_age")
);

// ❌ 默认生成的奇怪名字
// "city_1_age_-1" 让人摸不着头脑
```

常见命名模式：

| 模式 | 示例 | 说明 |
|-----|-----|-----|
| `idx_字段` | `idx_username` | 单字段索引 |
| `idx_字段1_字段2` | `idx_city_age` | 复合索引 |
| `idx_字段_text` | `idx_content_text` | 文本索引 |
| `idx_字段_geo` | `idx_location_2dsphere` | 地理索引 |
| `idx_字段_ttl` | `idx_createdAt_ttl` | TTL 索引 |

---

## 索引维护

### 重建索引

索引用久了会产生碎片，可以重建：

```java
// MongoDB 4.2+ 支持在线重建索引（不阻塞）
collection.reIndex();

// 或通过 collMod 命令修改索引属性
database.runCommand(new Document("collMod", "users")
    .append("validator", new Document("$jsonSchema", new Document())));
```

### 监控索引使用情况

```java
// 查看哪些索引被使用过
Document stats = database.runCommand(
    new Document("aggregate", "users")
        .append("pipeline", List.of(
            new Document("$indexStats", new Document())
        ))
        .append("cursor", new Document())
);

System.out.println(stats.toJson());
```

输出：

```json
[
  {
    "name": "username_1",
    "spec": { "username": 1 },
    "usageCount": 15234,     // 使用了 15234 次
    "lastAccess": ISODate("2024-01-15T10:30:00Z")
  },
  {
    "name": "unused_index",
    "spec": { "unusedField": 1 },
    "usageCount": 0          // 从未使用，可以考虑删除
  }
]
```

---

## 常见问题

### Q1: 索引创建很慢怎么办？

```java
// MongoDB 4.2+ 支持混合索引构建
// 先创建索引，再在后台回填数据
// 但这不是你能控制的，是 MongoDB 内部优化
```

**解决方案：**
1. 使用 `background: true`
2. 选择业务低峰期
3. 分片集群可以并行构建

### Q2: 索引占用太多空间？

```java
// 查看索引大小
Document stats = database.runCommand(
    new Document("collStats", "users")
);
long indexSize = stats.get("totalIndexSize", Number.class).longValue();
System.out.println("索引大小: " + (indexSize / 1024 / 1024) + " MB");
```

**常见原因：**
- 索引数量太多
- 复合索引设计不当
- 数组字段过多（每个数组元素都建索引）

### Q3: 索引没生效？

检查几个常见原因：

```java
// 1. 查询条件没匹配索引
// ❌ 用了正则开头不是 ^ 的搜索
collection.find(Filters.regex("username", "zhang"));

// ✅ 改用前缀匹配
collection.find(Filters.regex("username", "^zhang"));

// 2. 类型不匹配
// 如果字段是字符串，查询用数字就不会用索引
// 存储: { "age": "28" } (字符串)
// 查询: { "age": 28 } (数字) -> 不走索引
```

---

## 总结

索引管理三板斧：

1. **explain() 分析** - 确认查询用对了索引
2. **indexStats 监控** - 发现不用的索引就删除
3. **background 创建** - 生产环境不阻塞

记住：索引是空间换时间，但空间也是成本。定期检查，删除无用的索引。

---

## 面试追问方向

- `totalDocsExamined` 和 `nReturned` 的比值代表什么？
- 如何判断一个索引是否需要创建？
- MongoDB 4.2 对索引有什么新改进？
