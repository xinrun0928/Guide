# Elasticsearch 性能优化：Segments 合并、Refresh_interval、Routing

ES 的默认配置可以让你快速上手，但要在生产环境发挥最佳性能，需要进行精细调优。

## 1. Segment：ES 的存储单元

### 1.1 Segment 是什么？

ES 的数据最终存储在 **Segment** 中。每个 Segment 是一个完整的倒排索引。

```
Index
    │
    └── Shard
          │
          ├── Segment 1 (Lucene 索引)
          ├── Segment 2 (Lucene 索引)
          └── Segment 3 (Lucene 索引)
```

### 1.2 写入流程

```
写入请求 → Memory Buffer → Segments（写入磁盘）
                │
                └─→ Refresh（每秒一次）→ 新 Segment 可搜索
```

**详细流程：**

```
1. 写入内存 Buffer
2. 写入 Transaction Log（用于故障恢复）
3. Refresh 时，Buffer 刷新为新的 Segment
4. Segment 写入磁盘（fsync）
5. 新 Segment 可被搜索
```

### 1.3 Segment 合并

Segment 越来越多会影响搜索性能，ES 会自动合并小 Segment 为大 Segment。

```
合并前：
Segment A (10条) + Segment B (8条) → 合并 → Segment C (18条)

合并后：
- 查询时需要打开的 Segment 数量减少
- 被删除的文档在合并时被物理删除
```

## 2. Refresh 和 Translog

### 2.1 Refresh 机制

```java
// ES 默认每秒执行一次 refresh
// 新写入的文档在 1 秒后才能被搜索到

// 可以调整 refresh 间隔
PUT my_index/_settings
{
  "refresh_interval": "5s"    // 改为 5 秒
}

// 批量写入时可以临时关闭 refresh
PUT my_index/_settings
{
  "refresh_interval": "-1"    // 关闭自动 refresh
}

// 写入完成后恢复
PUT my_index/_settings
{
  "refresh_interval": "1s"
}
```

### 2.2 Translog（事务日志）

Translog 保证了数据的持久性。

```
写入流程：

1. 写入 Buffer
2. 写入 Translog（内存）
3. 返回客户端（此时数据已安全）

后台：
4. Buffer 刷新为 Segment
5. Translog fsync 到磁盘
6. 清空 Translog
```

**Translog 配置：**

```java
PUT my_index/_settings
{
  "index.translog": {
    "sync_interval": "5s",         // 同步间隔
    "durability": "async",         // async=异步写入，request=同步写入
    "retention": {
      "max_size": "1gb"            // 保留的最大大小
    }
  }
}
```

## 3. 写入性能优化

### 3.1 批量写入

```java
// 每次批量写入 5000-10000 条
BulkRequest bulkRequest = new BulkRequest();

for (Blog blog : blogs) {
    bulkRequest.add(new IndexRequest("blog")
        .id(blog.getId())
        .source(XContentType.JSON, "title", blog.getTitle()));
}

// 设置刷新策略为异步
bulkRequest.setRefreshPolicy(WriteRequest.RefreshPolicy.FALSE);

BulkResponse responses = client.bulk(bulkRequest, RequestOptions.DEFAULT);
```

### 3.2 多线程写入

```java
// 使用多线程并发写入
ExecutorService executor = Executors.newFixedThreadPool(8);

List&lt;Callable&lt;BulkResponse&gt;&gt; tasks = Lists.partition(blogLists, 5000)
    .stream()
    .map(batch -> (Callable&lt;BulkResponse&gt;) () -> {
        BulkRequest request = new BulkRequest();
        batch.forEach(blog -> request.add(...));
        return client.bulk(request, RequestOptions.DEFAULT);
    })
    .collect(Collectors.toList());

List&lt;Future&lt;BulkResponse&gt;&gt; futures = executor.invokeAll(tasks);
```

### 3.3 写入优化配置

```java
PUT my_index/_settings
{
  "index": {
    // 副本设为 0，批量导入完成后再开启
    "number_of_replicas": 0,

    // 增大 Translog 缓冲区
    "translog.durability": "async",
    "translog.sync_interval": "5s",

    // 关闭 refresh
    "refresh_interval": "-1",

    // 增大合并线程数
    "index.merge.scheduler.max_thread_count": 1    // 机械硬盘设为 1
  }
}
```

### 3.4 导入完成后恢复

```java
// 批量导入完成后，恢复正常配置
PUT my_index/_settings
{
  "index": {
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  }
}

// 手动触发一次 merge
POST my_index/_forcemerge
{
  "max_num_segments": 1
}
```

## 4. 搜索性能优化

### 4.1 使用 filter 而非 query

```java
// 慢：需要计算相关性评分
{
  "query": {
    "term": { "status": "published" }
  }
}

// 快：不计算评分，结果会被缓存
{
  "query": {
    "bool": {
      "filter": [
        { "term": { "status": "published" } }
      ]
    }
  }
}
```

### 4.2 只返回需要的字段

```java
// _source 指定返回的字段
GET my_index/_search
{
  "_source": ["title", "author", "publish_date"],
  "query": { ... }
}

// 不返回 _source（节省带宽）
GET my_index/_doc/1?_source=false
```

### 4.3 合理使用路由

```java
// 使用 routing 直接定位分片
GET my_index/_search?routing=user_123
{
  "query": {
    "term": { "user_id": "user_123" }
  }
}

// 这样查询只会发送到特定分片，而不是所有分片
```

### 4.4 避免大结果集

```java
// 控制返回数量
GET my_index/_search
{
  "size": 100    // 默认返回 10 条
}

// 使用聚合代替深分页
{
  "size": 0,
  "aggs": {
    "top_categories": {
      "terms": { "field": "category", "size": 10 }
    }
  }
}
```

## 5. Segment 优化

### 5.1 Force Merge

定期合并 Segment，减少 Segment 数量。

```java
// 将 Segment 合并为 1 个
POST my_index/_forcemerge
{
  "max_num_segments": 1
}

// 合并为 5 个
POST my_index/_forcemerge
{
  "max_num_segments": 5
}

// 合并时删除已标记删除的文档
POST my_index/_forcemerge
{
  "max_num_segments": 1,
  "only_expunge_deletes": true
}
```

### 5.2 合并策略配置

```java
PUT my_index/_settings
{
  "index": {
    "merge_scheduler": {
      "default": "concurrent"    // 并行合并
    },
    "merge": {
      "policy": {
        "floor_segment": "2mb",           // 最小 Segment 大小
        "max_merge_at_once": 10,           // 一次最多合并 10 个
        "segments_per_tier": 10            // 每层最少的 Segment 数
      }
    }
  }
}
```

## 6. 内存优化

### 6.1 Fielddata 和 Doc Values

```java
// 聚合、排序、脚本会用到 fielddata
// 默认基于磁盘的 doc_values

// 调整 fielddata 缓存大小
PUT my_index/_settings
{
  "indices.breaker.fielddata.limit": "40%"
}

// 查看字段的数据结构
GET my_index/_field_caps?fields=*
```

### 6.2 Query Cache

```java
// 查询结果缓存
// filter 查询的结果会被缓存

// 调整查询缓存大小
PUT _cluster/settings
{
  "transient": {
    "indices.queries.cache.size": "10%"
  }
}

// 查看缓存命中率
GET _nodes/stats/indices/query_cache
```

## 7. 分片策略优化

### 7.1 分片数规划

```java
// 经验公式：每个分片 30-50GB 数据
// 根据数据量确定分片数

// 假设每天 10GB 日志数据，保留 30 天 = 300GB
// 分片数 = ceil(300 / 50) = 6 个主分片
```

### 7.2 分片分配策略

```java
// 将分片分散到不同节点
PUT my_index/_settings
{
  "index.routing.allocation.include._tier_preference": "data_hot,data_warm"
}

// 禁止分配到特定节点
PUT my_index/_settings
{
  "index.routing.allocation.exclude.name": "old-node"
}
```

## 8. 监控与诊断

### 8.1 查看索引状态

```java
// 查看 segments 信息
GET my_index/_segments

// 查看分片分配情况
GET _cat/shards/my_index?v

// 查看索引统计
GET my_index/_stats
```

### 8.2 查看节点状态

```java
// 查看节点统计
GET _nodes/stats

// 查看 CPU 和内存使用
GET _nodes/stats/breaker,fs,http,jvm,os,process,thread_pool

// 查看索引缓存使用
GET _nodes/stats/indices/indexing,search,query_cache,fielddata
```

### 8.3 慢查询日志

```java
// 配置慢查询日志
PUT my_index/_settings
{
  "index.indexing.slowlog.threshold.index.warn": "2s",
  "index.indexing.slowlog.threshold.index.info": "1s",
  "index.indexing.slowlog.threshold.index.debug": "800ms",
  "index.indexing.slowlog.threshold.index.trace": "400ms",

  "index.search.slowlog.threshold.query.warn": "5s",
  "index.search.slowlog.threshold.query.info": "2s"
}

// 查看慢查询日志
GET /my_index/_search
```

## 9. 常见问题与解决

### 9.1 写入很慢

可能原因：

- 副本数太多（副本会拖慢写入）
- refresh 间隔太短
- Translog 同步太频繁
- 分片数太少（单分片成为瓶颈）

解决方案：

- 导入时关闭副本，导入后开启
- 增大 refresh_interval
- 设置 translog.durability: async
- 增加分片数或使用多线程

### 9.2 搜索很慢

可能原因：

- Segment 太多
- 查询条件不走索引
- 返回字段太多
- 内存不足导致频繁 GC

解决方案：

- 定期 forcemerge
- 使用 filter 而非 query
- 限制返回字段
- 扩容或优化 JVM 配置

## 总结

ES 性能优化的关键点：

1. **写入优化**：批量写入、多线程、临时关闭副本和 refresh
2. **搜索优化**：使用 filter、限制返回字段、合理使用 routing
3. **Segment 管理**：定期 forcemerge，减少 Segment 数量
4. **内存管理**：监控缓存命中率，合理配置 JVM
5. **分片策略**：根据数据量合理规划分片数

---

**留给你的问题**：

假设你的 ES 集群有 10 个数据节点，每天写入 100GB 日志数据。但最近发现写入速度明显下降，从每秒 10 万条降到了 5 万条。

你会如何排查问题？可能的原因有哪些？

排查思路：监控指标 → 逐步分析 → 定位瓶颈 → 针对性优化。
