# Elasticsearch 分页查询：from/size vs search_after vs scroll

想象你要从图书馆的 100 万本书中找书。

方式一：让管理员把所有书摆好，你翻到第 50000 页，每页看 10 本。
方式二：你告诉管理员「我刚看了第 50000 页的第 10 本书，下一本是什么」。
方式三：管理员把所有书列成清单，你慢慢翻。

这就是 ES 三种分页方式的类比。

## 1. from + size（深度分页的陷阱）

### 1.1 基本用法

```java
// 查询第 11-20 条文档（page 2，每页 10 条）
GET my_index/_search
{
  "from": 10,
  "size": 10,
  "query": {
    "match": { "title": "Java" }
  }
}
```

### 1.2 原理分析

```
from + size 的执行过程：

1. 查询分发到所有分片
2. 每个分片返回 from + size 条数据（例：from=10000, size=10 → 每个分片返回 10010 条）
3. Coordinating 节点合并所有分片的结果（5 分片 × 10010 = 50050 条）
4. 在内存中排序，取第 10000-10010 条
5. 返回给客户端

问题：分片数越多，排序的数据量越大
```

### 1.3 ES 的限制

ES 默认限制 `max_result_window = 10000`：

```java
// 如果请求深度超过 10000，会报错
GET my_index/_search
{
  "from": 10000,
  "size": 10
}

// 错误响应：
{
  "error": {
    "root_cause": [{
      "type": "illegal_argument_exception",
      "reason": "Result window is too large, from + size must be less than or equal to: [10000]"
    }]
  }
}
```

### 1.4 为什么 from + size 不适合深分页？

| from + size | 分片数 | 每分片返回 | 协调节点处理 |
|------------|--------|-----------|------------|
| 0 + 10 | 5 | 10 | 50 |
| 100 + 10 | 5 | 110 | 550 |
| 1000 + 10 | 5 | 1010 | 5050 |
| 10000 + 10 | 5 | 10010 | 50050 |
| 50000 + 10 | 5 | 50010 | 250050 |

深度越大，需要处理的数据量越大，内存和 CPU 消耗急剧上升。

## 2. search_after（深度翻页的正确方式）

### 2.1 为什么需要 search_after？

search_after 解决了 from + size 的核心问题：**它不使用 from，而是基于上一页的结果继续翻页**。

### 2.2 基本原理

```
第一页查询：
GET my_index/_search
{
  "size": 10,
  "sort": [
    { "publish_date": "desc" },
    { "_id": "asc" }    // 第二排序字段用于唯一确定结果
  ]
}
// 返回：第 1-10 条，带上 sort_values

第二页查询：
GET my_index/_search
{
  "size": 10,
  "search_after": [1704067200000, "doc_10"],    // 上一页最后一条的 sort 值
  "sort": [
    { "publish_date": "desc" },
    { "_id": "asc" }
  ]
}
// 返回：第 11-20 条
```

### 2.3 使用示例

```java
// 第一页：普通查询
GET my_index/_search
{
  "size": 10,
  "sort": [
    { "views": "desc" },
    { "_id": "asc" }
  ],
  "query": {
    "match": { "title": "Java" }
  }
}

// 返回结果中提取最后一条的 sort 值
{
  "hits": {
    "hits": [
      { "_id": "1", "sort": [50000, "1"] },
      { "_id": "2", "sort": [48000, "2"] },
      // ...
      { "_id": "10", "sort": [42000, "10"] }
    ]
  }
}

// 第二页：使用 search_after
GET my_index/_search
{
  "size": 10,
  "search_after": [42000, "10"],
  "sort": [
    { "views": "desc" },
    { "_id": "asc" }
  ],
  "query": {
    "match": { "title": "Java" }
  }
}
```

### 2.4 search_after 的限制

1. **不支持跳页**：只能一页一页翻，不能直接跳到第 100 页
2. **必须有唯一排序字段**：多个排序字段组合能唯一确定一条结果
3. **不能跨索引**：如果索引结构变化，可能导致结果不一致

### 2.5 search_after 的优势

```java
// 相比 from + size
// 优势一：不限制翻页深度
GET my_index/_search
{
  "size": 10,
  "search_after": [100, "..."]  // 可以翻到任何深度
}

// 优势二：内存消耗固定
// 不管翻到第几页，每页只处理 size 条数据
// 不会因为 from 增大而增加内存消耗
```

## 3. scroll（大批量导出）

### 3.1 为什么需要 scroll？

scroll 适合**大批量导出数据**的场景，不是用来翻页的。

### 3.2 使用流程

```
┌─────────────────────────────────────────────────────┐
│                    Scroll 查询流程                   │
│                                                       │
│  1. 发起 scroll 请求，获得第一页 + scroll_id          │
│         │                                             │
│         ▼                                             │
│  2. 用 scroll_id 继续获取下一页                      │
│         │                                             │
│         ├─→ 有数据 → 继续获取下一页                   │
│         │                                             │
│         └─→ 无数据 → 删除 scroll，结束                │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### 3.3 基本用法

```java
// 第一步：发起 scroll 查询
GET my_index/_search?scroll=1m
{
  "size": 1000,
  "query": {
    "match_all": {}
  }
}

// 返回：
{
  "_scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAAAAAcWaF...",
  "hits": {
    "hits": [...1000 条...]
  }
}

// 第二步：用 scroll_id 获取下一页
POST _search/scroll
{
  "scroll": "1m",
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAAAAAcWaF..."
}

// 重复第二步直到没有结果

// 最后：清理 scroll
DELETE _search/scroll
{
  "scroll_id": "DXF1ZXJ5QW5kRmV0Y2gBAAAAAAAAAAcWaF..."
}
```

### 3.4 scroll 的问题

```java
// 问题一：scroll 会消耗资源
// 每个 scroll 请求会在内存中保留快照
// 如果 scroll 过多，会导致内存泄漏

// 问题二：scroll 不适合实时查询
// scroll 基于快照，数据可能是旧数据

// 问题三：scroll 有时间限制
// scroll=1m 表示每次 scroll 请求后保留快照 1 分钟
// 如果超过时间，快照会被清理
```

### 3.5 Java 客户端示例

```java
// 使用 scroll 导出所有数据
public List&lt;Map&lt;String, Object&gt;&gt; scrollExport(String indexName) {
    List&lt;Map&lt;String, Object&gt;&gt; allResults = new ArrayList&lt;&gt;();

    // 初始查询
    SearchRequest searchRequest = new SearchRequest(indexName);
    searchRequest.scroll(TimeValue.timeValueMinutes(1));
    searchRequest.source(new SearchSourceBuilder()
        .size(1000)
        .query(QueryBuilders.matchAllQuery()));

    SearchResponse response = client.search(searchRequest, RequestOptions.DEFAULT);
    String scrollId = response.getScrollId();
    SearchHit[] hits = response.getHits().getHits();

    // 循环获取所有数据
    while (hits != null && hits.length > 0) {
        for (SearchHit hit : hits) {
            allResults.add(hit.getSourceAsMap());
        }

        SearchScrollRequest scrollRequest = new SearchScrollRequest(scrollId);
        scrollRequest.scroll(TimeValue.timeValueMinutes(1));
        response = client.scroll(scrollRequest, RequestOptions.DEFAULT);
        scrollId = response.getScrollId();
        hits = response.getHits().getHits();
    }

    // 清理 scroll
    ClearScrollRequest clearRequest = new ClearScrollRequest();
    clearRequest.addScrollId(scrollId);
    client.clearScroll(clearRequest, RequestOptions.DEFAULT);

    return allResults;
}
```

## 4. 三种方式的对比

| 特性 | from + size | search_after | scroll |
|-----|-------------|--------------|--------|
| 是否支持跳页 | ✓ | ✗ | ✗ |
| 深度限制 | 10000 | 无 | 无 |
| 内存消耗 | 随 from 增大 | 固定 | 固定 |
| 数据实时性 | 实时 | 实时 | 快照 |
| 适用场景 | 前台翻页（前几页） | 后台列表 | 数据导出 |
| 性能 | 深度越大越慢 | 稳定 | 稳定 |

## 5. 选择指南

```
需要分页查询时，如何选择？
│
├─ 前台展示，需要跳页？
│   │
│   └─ from + size（限制 10000 以内）
│
├─ 后台列表，不需要跳页？
│   │
│   └─ search_after
│
└─ 大批量数据导出？
    │
    └─ scroll（或考虑其他方案）
```

## 6. 性能优化建议

### 6.1 减少 scroll 时间

```java
// 使用 slices 并行化 scroll
GET my_index/_search?scroll=1m
{
  "slice": {
    "id": 0,          // 当前 slice 编号
    "max": 3          // 总共 3 个 slice
  },
  "size": 1000
}
```

### 6.2 使用 point-in-time 替代 scroll

ES 7.1+ 提供了 PIT（Point-In-Time），比 scroll 更高效：

```java
// 创建 PIT
POST my_index/_pit?keep_alive=5m

// 使用 PIT 查询（可以配合 search_after）
POST _search
{
  "size": 10,
  "query": { "match_all": {} },
  "pit": {
    "id": "46f...",
    "keep_alive": "5m"
  },
  "sort": [{ "_id": "asc" }]
}
```

## 7. 面试高频问题

### Q1：为什么 from + size 不适合深度分页？

**答案**：深度分页时，每个分片需要返回 `from + size` 条数据，协调节点需要合并所有分片的结果后再排序。数据量和分片数成正比，深度越大，内存消耗急剧上升。

### Q2：search_after 有什么限制？

**答案**：

- 不能跳页，只能一页一页翻
- 需要有唯一排序字段
- 不支持跨索引查询

### Q3：scroll 和 search_after 的区别？

**答案**：

- scroll 基于快照，适合导出，数据可能不是最新的
- search_after 是实时的，每次查询都是最新数据
- scroll 有超时时间限制，search_after 没有

## 总结

ES 三种分页方式的选择：

1. **from + size**：适合前台小数据量翻页，深度限制 10000
2. **search_after**：适合后台列表，深分页无限制，不能跳页
3. **scroll**：适合大批量导出，基于快照，不是实时数据

理解它们的原理和限制，才能在实际应用中做出正确的选择。

---

**留给你的问题**：

假设你有一个 1 亿文档的索引，用户需要一个「导出全部数据」的功能。你会怎么做？

- 直接用 scroll？有什么风险？
- 分批次导出然后合并？
- 还是考虑其他方案？

这个问题的答案取决于数据量、导出频率、服务器资源等因素。
