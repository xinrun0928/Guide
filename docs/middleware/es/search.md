# Elasticsearch 搜索原理：Query Phase 与 Fetch Phase

当你在 Google 输入「Java 教程」，瞬间返回 millions of results。这个过程到底发生了什么？

ES 的搜索分为两个核心阶段：**Query Phase** 和 **Fetch Phase**。理解这两个阶段，是掌握 ES 搜索原理的关键。

## 1. 搜索的整体流程

```
客户端
  │
  │
  ▼
┌─────────────────────────────────────────────────────┐
│                  Coordinating 节点                   │
│                                                     │
│   Query Phase ──────────────────── Fetch Phase      │
│        │                                    │       │
│        ▼                                    ▼       │
│   ┌──────────────────────────────────────────────┐  │
│   │              数据节点 (Data Nodes)            │  │
│   │                                                │  │
│   │   Shard 0  Shard 1  Shard 2  Shard 3  Shard 4  │  │
│   │      │        │        │        │        │      │  │
│   └──────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
         │
         ▼
       客户端收到结果
```

## 2. Query Phase：找到匹配的文档

Query Phase 的目标是：**在所有相关分片上找到匹配的文档ID和排序值**。

### 2.1 查询分发

```
用户查询: "Java 教程"
    │
    ▼
Coordinating 节点广播查询到所有相关分片
    │
    ├──→ Primary Shard 0 (执行查询)
    ├──→ Primary Shard 1 (执行查询)
    ├──→ Primary Shard 2 (执行查询)
    ├──→ Replica Shard 3 (执行查询)
    └──→ Replica Shard 4 (执行查询)
```

**查询分发策略：**

```java
// 轮询分发到主分片或副本分片
// 目的是均衡负载
round_robin(primary_or_replica_shards)
```

### 2.2 分片内查询执行

在每个分片上，查询执行分为几个步骤：

```
┌─────────────────────────────────────────────────────┐
│           单个 Shard 的查询流程                      │
│                                                      │
│   1. 查询解析 → Query Parser                         │
│         │                                            │
│         ▼                                            │
│   2. 词项查找 → 在倒排索引中找到匹配的文档 ID          │
│         │                                            │
│         ▼                                            │
│   3. 评分计算 → 计算 TF/IDF 得分                     │
│         │                                            │
│         ▼                                            │
│   4. 排序 → 按 score 或其他字段排序                   │
│         │                                            │
│         ▼                                            │
│   5. 分页 → 取 from + size 条记录                     │
│         │                                            │
│         ▼                                            │
│   6. 返回 → [doc_id, score] 列表                    │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 2.3 返回结果

```java
// 每个分片返回的是什么？
// 不是完整的文档，而是 doc_id + score 的列表

// 分片 0 返回：
{ "hits": [
    { "_id": "doc_10", "_score": 2.5 },
    { "_id": "doc_23", "_score": 2.1 }
  ]}

// 分片 1 返回：
{ "hits": [
    { "_id": "doc_5", "_score": 3.2 },
    { "_id": "doc_18", "_score": 1.8 }
  ]}

// ...
```

> **为什么只返回 doc_id？**
>
> 因为完整的文档数据存储在 Data 节点上。如果每次查询都返回完整文档，网络开销会非常大。ES 选择先返回 doc_id，再在 Fetch Phase 批量获取文档。

## 3. Fetch Phase：获取完整文档

### 3.1 全局排序

```java
// Coordinating 节点收集所有分片的返回结果
// 进行全局排序

// 原始结果：
Shard 0: [doc_10:2.5, doc_23:2.1]
Shard 1: [doc_5:3.2, doc_18:1.8]
Shard 2: [doc_7:2.8, doc_15:1.5]
...

// 全局排序后：
排序后的 doc_ids: [doc_5:3.2, doc_10:2.5, doc_7:2.8, doc_23:2.1, ...]
```

### 3.2 文档获取

```java
// Coordinating 节点根据排序结果，向各分片请求完整文档
// 这个过程叫 fetch

// 排序后需要获取前 10 条：
// doc_5 在 Shard 1 → 获取
// doc_10 在 Shard 0 → 获取
// doc_7 在 Shard 2 → 获取
// ...

// fetch 请求（mget 批量获取）
GET _mget
{
  "docs": [
    { "_index": "my_index", "_id": "doc_5" },
    { "_index": "my_index", "_id": "doc_10" },
    { "_index": "my_index", "_id": "doc_7" }
  ]
}
```

### 3.3 返回给客户端

```java
// 最终返回给用户的是完整的文档列表
{
  "took": 5,                    // 耗时（毫秒）
  "timed_out": false,
  "hits": {
    "total": { "value": 10000, "relation": "gte" },
    "max_score": 3.2,
    "hits": [
      {
        "_index": "my_index",
        "_id": "doc_5",
        "_score": 3.2,
        "_source": { "title": "Java 基础教程", ... }
      },
      // ... 更多文档
    ]
  }
}
```

## 4. Query-then-Fetch 的问题

### 4.1 深分页问题

假设你要获取第 10000 条到第 10010 条数据：

```java
// 客户端请求
GET my_index/_search
{
  "from": 10000,
  "size": 10
}

// 执行过程：
// 1. 每个分片需要排序并返回 top (10000 + 10) = 10010 条
// 2. Coordinating 节点合并 5 个分片的结果 = 50050 条
// 3. 再从中取 10000-10010 的 10 条
```

**问题**：分片数越多，需要处理的数据量越大。

| from + size | 分片数 | 每个分片返回 | 总数据量 |
|------------|--------|------------|---------|
| 10 + 10 | 5 | 20 | 100 |
| 10000 + 10 | 5 | 10010 | 50050 |
| 100000 + 10 | 5 | 100010 | 500050 |

> **ES 默认限制 `max_result_window = 10000`**。超过这个限制需要使用 `search_after` 或 `scroll`。

### 4.2 解决方案

| 方案 | 适用场景 | 缺点 |
|-----|---------|------|
| `from + size` | 小数据量翻页 | 无法深度翻页 |
| `search_after` | 深度翻页 | 不支持跳页 |
| `scroll` | 导出大量数据 | 消耗资源，结果非实时 |

## 5. 搜索的执行上下文

### 5.1 query 与 filter

```java
// query：会计算相关性评分
{
  "query": {
    "match": {
      "title": "Java 教程"
    }
  }
}

// filter：只做过滤，不评分（更快）
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java 教程" } }
      ],
      "filter": [
        { "term": { "status": "published" } },
        { "range": { "publish_date": { "gte": "2024-01-01" } } }
      ]
    }
  }
}
```

**query vs filter 的区别：**

| 维度 | query | filter |
|-----|-------|--------|
| 评分 | 计算 TF/IDF 得分 | 不评分 |
| 缓存 | 不缓存 | 结果会缓存 |
| 性能 | 较慢 | 较快 |
| 使用场景 | 需要排序的场景 | 精确过滤的场景 |

### 5.2 post_filter

```java
// post_filter：在聚合之后执行，不影响聚合结果
{
  "query": {
    "match": { "title": "Java" }
  },
  "aggs": {
    "by_category": {
      "terms": { "field": "category" }
    }
  },
  "post_filter": {
    "term": { "status": "published" }
  }
}
```

## 6. 搜索性能优化

### 6.1 使用 filter 缓存

```java
// 充分利用 filter 缓存
{
  "query": {
    "bool": {
      "must": [
        { "match": { "title": "Java" } }      // 需要评分
      ],
      "filter": [                              // 不评分，被缓存
        { "term": { "category": "tutorial" } },
        { "term": { "status": "published" } },
        { "range": { "views": { "gte": 100 } } }
      ]
    }
  }
}
```

### 6.2 避免 wildcard 前缀通配

```java
// 慢：前缀通配符需要扫描整个倒排索引
{ "wildcard": { "title": "*教程" } }

// 快：使用 match + filter 组合
{
  "bool": {
    "must": [ { "match": { "title": "教程" } } ],
    "filter": [ { "term": { "title": "*教程" } } ]  // 不要这样做！
  }
}
```

### 6.3 路由优化

```java
// 使用 routing 直接定位到特定分片
GET my_index/_search?routing=user_123
{
  "query": {
    "term": { "author_id": "user_123" }
  }
}

// 这样查询只会发送到包含 user_123 数据的分片
// 而不是所有分片
```

## 7. 面试高频问题

### Q1：ES 搜索为什么比 MySQL 快？

**答案**：核心在于倒排索引。

- MySQL 的 B+ Tree 索引是「id → 数据」，查询关键词需要遍历
- ES 的倒排索引是「词 → doc_ids」，查询关键词直接定位

另外 ES 在查询阶段只返回 doc_id，不返回完整文档，减少了网络传输。

### Q2：Query-then-Fetch 有什么问题？

**答案**：深分页时，每个分片需要返回大量数据到 Coordinating 节点进行排序，消耗大量内存和 CPU。

### Q3：如何优化深度分页？

**答案**：

- 小数据量：用 `from + size`
- 深度翻页：用 `search_after`
- 导出大量数据：用 `scroll`

## 总结

ES 搜索的两个阶段：

```
Query Phase：找到匹配的文档 ID
    ├── 广播查询到所有分片
    ├── 每个分片执行查询，返回 [doc_id, score]
    └── Coordinating 节点收集结果

Fetch Phase：获取完整的文档
    ├── 全局排序
    ├── 批量获取文档内容
    └── 返回给客户端
```

理解这两个阶段的原理，对于优化查询性能至关重要。

---

**留给你的问题**：

假设你的索引有 10 个分片，用户请求 `from=50000, size=10`。每个分片需要处理 50010 条数据，协调节点需要处理 500100 条数据。

你会如何优化这个场景？是减少分片数，还是改变查询方式，还是其他方案？
