# ES 查询优化：分页方式选择、路由优化、filter vs query

你的 Elasticsearch 查询越来越慢。从最初的 50ms，到现在的 2 秒。

仔细一看 SQL：查询条件没变，数据量也没变。**问题出在你的查询方式上。**

比如分页查询：当你想看第 10000 页的数据时，Elasticsearch 需要合并前 10000 页的所有结果，然后跳过前面的 9999 页，只返回第 10000 页。

这得多慢？

## 分页方式的选择

### from + size（浅分页）

最常见的分页方式，但有严重的性能问题：

```json
GET /my_index/_search
{
  "from": 10000,
  "size": 10
}
```

**问题**：Elasticsearch 需要从每个分片获取 10010 条数据，然后协调节点合并排序，取第 10000-10010 条。如果分片多、数据量大，这个过程会非常慢。

**限制**：`from + size` 有一个硬限制，默认 10000。超过会报错。

### search_after（深度分页）

使用上一页最后一条数据的排序值作为起点，跳过前面的数据：

```json
// 第一次查询
GET /my_index/_search
{
  "sort": [
    {"timestamp": "desc"},
    {"_id": "asc"}
  ],
  "size": 10
}

// 返回结果中，最后一条的 sort 值
// 用于下一页查询
GET /my_index/_search
{
  "sort": [
    {"timestamp": "desc"},
    {"_id": "asc"}
  ],
  "search_after": [1614556800000, "doc_123"],
  "size": 10
}
```

```java
// Java 实现
public List&lt;Map&lt;String, Object&gt;&gt; searchAfter(String index, List&lt;Object&gt; lastSortValues, int size) {
    SearchRequest searchRequest = SearchRequest.of(s -> s
        .index(index)
        .size(size)
        .query(q -> q.matchAll(m -> m))
        .sort(so -> so.field(f -> f.field("timestamp").order(SortOrder.Desc)))
        .sort(so -> so.field(f -> f.field("_id").order(SortOrder.Asc)))
    );
    
    if (lastSortValues != null && !lastSortValues.isEmpty()) {
        searchRequest.searchAfter(lastSortValues);
    }
    
    SearchResponse&lt;Map&gt; response = client.search(searchRequest, Map.class);
    return response.hits().hits().stream()
        .map(Hit::source)
        .collect(Collectors.toList());
}
```

**优点**：
- 无深度限制
- 性能稳定，不随页码增加而下降

**缺点**：
- 不支持跳页
- 需要维护上一页的 sort 值

### scroll（离线批量处理）

适合导出大量数据，但不适合实时查询：

```json
// 初始化 scroll
GET /my_index/_search?scroll=5m
{
  "size": 1000,
  "sort": ["_doc"]
}

// 后续查询（使用 scroll_id）
POST /_search/scroll
{
  "scroll": "5m",
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAAAAD4..."
}
```

```java
// Java 实现
public void scrollExport(String index, Consumer&lt;List&lt;Map&lt;String, Object&gt;&gt;&gt; consumer) {
    SearchRequest searchRequest = SearchRequest.of(s -> s
        .index(index)
        .size(1000)
        .sort(so -> so.field(f -> f.field("_doc")))
    );
    
    String scrollId = null;
    try {
        SearchResponse&lt;Map&gt; response = client.search(searchRequest, Map.class);
        scrollId = response.scrollId();
        
        while (true) {
            List&lt;Map&lt;String, Object&gt;&gt; batch = response.hits().hits().stream()
                .map(Hit::source)
                .collect(Collectors.toList());
            
            if (batch.isEmpty()) {
                break;
            }
            
            consumer.accept(batch);
            
            // 继续滚动
            response = client.scroll(scroll -> scroll
                .scrollId(scrollId)
                .scroll("5m"), Map.class);
            scrollId = response.scrollId();
        }
    } finally {
        // 清理 scroll
        if (scrollId != null) {
            client.clearScroll(c -> c.scrollId(scrollId));
        }
    }
}
```

**注意**：`scroll` 会占用大量内存，不适合大量并发。

### 分页方式对比

| 方式 | 适用场景 | 性能 | 深度限制 | 跳页支持 |
|---|---|---|---|---|
| from + size | 前几页 | 差（随页码下降） | 10000 | 支持 |
| search_after | 深度分页 | 稳定 | 无 | 不支持 |
| scroll | 离线导出 | 稳定 | 无 | 不支持 |

## filter vs query：性能差异巨大

### 什么是 query？

Query 会对文档进行评分（relevance score），计算文档与查询条件的相关度。

```json
GET /my_index/_search
{
  "query": {
    "match": {
      "title": "elasticsearch"
    }
  }
}
```

**特点**：
- 计算评分，有相关度排序
- 结果缓存（但评分过程不缓存）
- 适合全文搜索

### 什么是 filter？

Filter 只判断文档是否匹配条件，不计算评分。

```json
GET /my_index/_search
{
  "query": {
    "bool": {
      "filter": [
        {"term": {"status": "active"}},
        {"range": {"age": {"gte": 18}}}
      ]
    }
  }
}
```

**特点**：
- 不计算评分，性能更好
- 结果会被缓存（bitset 缓存）
- 适合精确匹配、范围查询

### 性能对比

```
Query（match）: 100ms - 500ms
Filter（term）: 5ms - 20ms
```

Filter 比 Query 快 5-10 倍，原因：

1. 不需要计算相关度评分
2. 结果会被缓存，下次查询更快
3. bitset 缓存支持快速合并

### 最佳实践

```java
// 错误示例：把所有条件都放在 query 中
SearchRequest request = SearchRequest.of(s -> s
    .index("my_index")
    .query(q -> q.bool(b -> {
        b.must(m -> m.match(mq -> mq.field("title").query("elasticsearch")));
        b.must(m -> m.term(t -> t.field("status").value("active"))));
        b.must(m -> m.range(r -> r.field("age").gte(JsonData.of(18)))));
        return b;
    }))
);

// 正确示例：非评分条件放在 filter 中
SearchRequest request = SearchRequest.of(s -> s
    .index("my_index")
    .query(q -> q.bool(b -> {
        // 全文搜索，需要评分
        b.must(m -> m.match(mq -> mq.field("title").query("elasticsearch")));
        // 精确匹配和范围查询，放到 filter 中
        b.filter(f -> f.term(t -> t.field("status").value("active")));
        b.filter(f -> f.range(r -> r.field("age").gte(JsonData.of(18))));
        return b;
    }))
);
```

## 路由优化

### Routing 原理

默认情况下，Elasticsearch 根据文档 ID 计算哈希来确定分片。但你可以通过 routing 指定路由字段。

```json
PUT /my_index/_doc/1?routing=user123
{
  "title": "My article",
  "user_id": "user123"
}
```

### 何时使用 Routing？

```java
// 查询用户的所有文章
// 不用 routing：查询会发送到所有分片
SearchResponse response = client.search(s -> s
    .index("my_index")
    .query(q -> q.term(t -> t.field("user_id").value("user123")))
);

// 使用 routing：查询只发送到 user123 所在的分片
SearchResponse response = client.search(s -> s
    .index("my_index")
    .routing("user123")
    .query(q -> q.term(t -> t.field("user_id").value("user123")))
);
```

**性能提升**：如果有 5 个分片，不使用 routing 需要查询 5 个分片，使用 routing 只查询 1 个分片，性能提升 5 倍。

### Routing 的注意事项

1. **数据倾斜**：如果某个路由值的数据量过大，会导致单个分片数据不均衡
2. **跨分片查询困难**：使用 routing 后，查询其他分片的数据会失败
3. **复合路由**：可以指定多个字段作为路由

```java
// 复合路由
SearchResponse response = client.search(s -> s
    .index("my_index")
    .routing("user123", "article")
    .query(q -> q.term(t -> t.field("category").value("article")))
);
```

## 其他优化技巧

### 1. 只返回需要的字段

```json
GET /my_index/_search
{
  "_source": ["title", "author", "timestamp"],
  "query": {...}
}
```

### 2. 避免使用通配符前缀查询

```json
// 差：前缀通配查询
{"prefix": {"title": "*elasticsearch*"}}

// 好：使用 match 或 ngram
{"match": {"title": "elasticsearch"}}
```

### 3. 使用 doc_values

对于需要聚合和排序的字段，确保开启 doc_values：

```json
{
  "mappings": {
    "properties": {
      "timestamp": {
        "type": "date",
        "doc_values": true  // 默认开启
      }
    }
  }
}
```

### 4. 使用 Constant Score 包装

对于不需要评分的查询：

```json
{
  "query": {
    "constant_score": {
      "filter": {
        "term": {"status": "active"}
      },
      "boost": 0
    }
  }
}
```

## 监控查询性能

```bash
# 查看慢查询
GET /_search?q=...

# 开启 slow log
PUT /my_index/_settings
{
  "index.search.slowlog.threshold.query.warn": "10s",
  "index.search.slowlog.threshold.fetch.info": "5s"
}

# 使用 Profile API 分析查询
GET /my_index/_search
{
  "profile": true,
  "query": {...}
}
```

## 总结

ES 查询优化有以下几个关键点：

1. **分页方式**：根据业务选择合适的分页方式（from+size / search_after / scroll）
2. **filter vs query**：非评分条件放在 filter 中，性能提升 5-10 倍
3. **路由优化**：使用 routing 减少查询的分片数
4. **字段裁剪**：只返回需要的字段
5. **慢查询监控**：定期分析慢查询，优化查询模式

---

## 留给你的问题

假设你的系统有以下场景：

- 商品搜索系统，数据量 1 亿
- 用户需要搜索商品，支持按分类、价格区间、品牌筛选
- 用户可以按相关度、价格、销量排序
- 需要支持分页浏览，每页 20 条

请思考：

1. 这个场景中，哪些查询应该用 filter，哪些应该用 query？为什么？
2. 如果用户想看第 50000 页（100万条数据），from+size 能支持吗？有什么替代方案？
3. 如果商品数据按商家隔离（每个商家只能看到自己的商品），如何设计 routing？
4. 如果查询「分类=手机 AND 价格<2000 AND 品牌=小米」，Elasticsearch 是如何高效执行这个查询的？

这道题的关键在于理解 Elasticsearch 的查询机制，以及如何根据业务特点设计高效的查询。
