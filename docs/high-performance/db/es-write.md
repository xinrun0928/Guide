# ES 写入性能优化：refresh_interval、translog、segments 合并

凌晨 3 点，你的 Elasticsearch 集群突然告警：写入队列堆积 10 万条，延迟从 50ms 飙升到 5 秒。

运维同学检查了一圈：节点正常，数据量正常，网络正常。那问题在哪？

**问题出在 Elasticsearch 的写入机制上。**

Elasticsearch 的写入流程比你想象的要复杂得多。不是简单的「数据进来，存进去」，而是涉及分段（Segment）、事务日志（Translog）、内存缓冲区（Buffer）、刷新（Refresh）等多个环节。

理解这些环节，才能真正优化写入性能。

## Elasticsearch 写入流程

### 写入链路

```
Client
  ↓
协调节点（Coordinating Node）
  ↓
数据节点（Data Node）
  ↓
  ├─→ 内存缓冲区（Memory Buffer）
  │       ↓ refresh
  └─→ 磁盘 ── 事务日志（Translog）
```

### 详细流程

1. **写入请求**：客户端发送写入请求到协调节点
2. **路由**：协调节点根据文档 ID 计算哈希，确定目标分片
3. **写入主分片**：写入请求转发到主分片所在节点
4. **写入 Translog**：同时写入事务日志（保证持久性）
5. **写入 Buffer**：写入内存缓冲区（可被搜索）
6. **异步复制**：并行写入副本分片
7. **等待响应**：主分片和副本分片都写入后返回成功

```java
// Elasticsearch Java Client 写入示例
public void indexDocument(String index, String id, Map&lt;String, Object&gt; doc) {
    IndexResponse response = client.prepareIndex(index, "_doc", id)
        .setSource(doc, XContentType.JSON)
        .setRefreshPolicy(WriteRequest.RefreshPolicy.NONE)  // 不立即刷新
        .setRefreshPolicy(WriteRequest.RefreshPolicy.WAIT_UNTIL)  // 写入后立即可搜索
        .setRefreshPolicy(WriteRequest.RefreshPolicy.IMMEDIATE)  // 强制刷新
        .get();
}
```

## 核心参数调优

### 1. refresh_interval

`refresh_interval` 控制段（Segment）刷写到磁盘的频率。默认 1 秒，意味着数据写入后最多 1 秒后才能被搜索到。

```json
// 创建索引时设置
PUT /my_index
{
  "settings": {
    "refresh_interval": "1s"  // 默认值，1秒刷新一次
  }
}

// 批量写入时临时关闭
PUT /my_index
{
  "settings": {
    "refresh_interval": "-1"  // 关闭自动刷新
  }
}
```

**调优建议**：

| 场景 | refresh_interval | 说明 |
|---|---|---|
| 实时搜索 | 1s | 默认值，延迟可接受 |
| 日志场景 | 10s - 30s | 允许一定延迟，追求吞吐量 |
| 批量导入 | -1（关闭） | 导入完成后手动刷新 |

```java
// 批量写入时临时调整
public void bulkImport(String index, List&lt;Map&lt;String, Object&gt;&gt; docs) {
    // 1. 关闭刷新
    client.admin().indices().prepareUpdateSettings(index)
        .setSettings(Settings.builder().put("refresh_interval", -1)).get();
    
    // 2. 批量写入
    BulkRequestBuilder bulkRequest = client.prepareBulk();
    for (Map&lt;String, Object&gt; doc : docs) {
        bulkRequest.add(client.prepareIndex(index, "_doc")
            .setSource(doc, XContentType.JSON));
    }
    BulkResponse bulkResponse = bulkRequest.get();
    
    // 3. 写入完成后刷新
    client.admin().indices().prepareRefresh(index).get();
    
    // 4. 恢复刷新设置
    client.admin().indices().prepareUpdateSettings(index)
        .setSettings(Settings.builder().put("refresh_interval", "1s")).get();
}
```

### 2. translog 持久化策略

Translog 是 Elasticsearch 的事务日志，用于在节点故障时恢复数据。

```json
{
  "settings": {
    "index.translog.durability": "async",  // 异步写入
    "index.translog.sync_interval": "5s"   // 同步间隔（5.x 版本）
  }
}
```

**两种模式**：

| 模式 | 说明 | 适用场景 |
|---|---|---|
| `request`（默认） | 每次写入都同步 Translog | 数据安全性优先 |
| `async` | Translog 异步写入，性能更高 | 允许少量数据丢失 |

```java
// 设置 Translog 策略
client.admin().indices().prepareCreate(index)
    .setSettings(Settings.builder()
        .put("index.translog.durability", "async")
        .put("index.translog.sync_interval", "5s"))
    .get();
```

### 3. segments 合并优化

Segment 是 Elasticsearch 存储数据的基本单位。每个 Segment 都是一个倒排索引。小 Segment 太多会影响查询性能。

```json
// 配置合并策略
{
  "settings": {
    "index.merge.policy.max_merged_segment": "2gb",  // 单个 Segment 最大 2GB
    "index.merge.policy.segments_per_tier": 10,       // 每层最大 Segment 数
    "index.merge.scheduler.max_thread_count": 1      // 合并线程数（机械硬盘设 1）
  }
}
```

```java
// Force Merge 手动合并
client.admin().indices().prepareForceMerge(index)
    .setMaxNumSegments(1)  // 合并成 1 个 Segment
    .setOnlyExpungeDeletes(true)  // 只合并已删除的文档
    .get();
```

## Buffer 和 Cache 配置

### 堆内存配置

Elasticsearch 使用 JVM 堆内存，但堆内存不宜过大（建议不超过 31GB）。

```bash
# 设置堆大小（不超过 31GB）
export ES_HEAP_SIZE=31g

# 或者在 jvm.options 中配置
-Xms31g
-Xmx31g
```

### indices.memory.index_buffer_size

用于索引缓冲区的内存比例，默认 10%。

```json
{
  "settings": {
    "indices.memory.index_buffer_size": "20%"  // 默认 10%
  }
}
```

## 批量写入最佳实践

### 批量大小

```java
// 最佳批量大小：5-15MB
public void optimalBulkWrite(List&lt;Map&lt;String, Object&gt;&gt; docs) {
    BulkRequestBuilder bulkRequest = client.prepareBulk();
    long estimatedSize = 0;
    
    for (Map&lt;String, Object&gt; doc : docs) {
        try {
            bulkRequest.add(client.prepareIndex("my_index", "_doc")
                .setSource(doc, XContentType.JSON));
            
            // 估算批量大小，超过 10MB 则执行
            estimatedSize += estimateSize(doc);
            if (estimatedSize >= 10 * 1024 * 1024) {  // 10MB
                executeBulk(bulkRequest);
                bulkRequest = client.prepareBulk();
                estimatedSize = 0;
            }
        } catch (Exception e) {
            // 处理失败
            bulkRequest = client.prepareBulk();
            estimatedSize = 0;
        }
    }
    
    // 执行剩余的请求
    if (bulkRequest.numberOfActions() > 0) {
        executeBulk(bulkRequest);
    }
}

private void executeBulk(BulkRequestBuilder bulkRequest) {
    BulkResponse bulkResponse = bulkRequest.get();
    if (bulkResponse.hasFailures()) {
        // 处理失败
        for (BulkItemResponse item : bulkResponse.getItems()) {
            if (item.isFailed()) {
                log.error("Failed: {}", item.getFailureMessage());
            }
        }
    }
}

private long estimateSize(Map&lt;String, Object&gt; doc) {
    try {
        return JSON.toJSONString(doc).getBytes().length;
    } catch (Exception e) {
        return 1024;  // 默认 1KB
    }
}
```

### 并发控制

```java
// 控制并发数量，避免集群过载
public void controlledBulkWrite(List&lt;Map&lt;String, Object&gt;&gt; docs) {
    ExecutorService executor = Executors.newFixedThreadPool(10);
    List&lt;Future&lt;?&gt;&gt; futures = new ArrayList&lt;&gt;();
    
    // 每批 5000 条
    List&lt;List&lt;Map&lt;String, Object&gt;&gt;&gt; batches = Lists.partition(docs, 5000);
    
    for (List&lt;Map&lt;String, Object&gt;&gt; batch : batches) {
        futures.add(executor.submit(() -> {
            bulkImport(batch);
        }));
    }
    
    // 等待所有批次完成
    for (Future&lt;?&gt; future : futures) {
        try {
            future.get();
        } catch (Exception e) {
            log.error("Batch failed", e);
        }
    }
    
    executor.shutdown();
}
```

## 监控指标

```bash
# 查看写入队列
GET _cat/thread_pool?v&h=node_name,name,active,queue,rejected,completed
# 期望：queue 和 rejected 都是 0

# 查看 refresh 状态
GET _cat/indices?v&h=index,refresh_interval,segments.memory,translog.size

# 查看 Segment 信息
GET _cat/segments?v&index=my_index
```

## 总结

Elasticsearch 写入优化涉及多个环节：

1. **refresh_interval**：根据业务需求选择合适的刷新频率
2. **Translog 策略**：数据安全性 vs 性能
3. **Segment 合并**：定期合并减少 Segment 数量
4. **批量写入**：控制批量大小和并发数
5. **监控告警**：关注写入队列、延迟、吞吐量指标

---

## 留给你的问题

假设你的 Elasticsearch 集群有以下情况：

- 数据量：每天 1TB 日志数据
- 副本数：1
- 集群规模：10 个数据节点，每个节点 32 核 CPU、128GB 内存
- 当前问题：写入延迟 500ms，远超 SLA 要求的 100ms

请思考：

1. 影响写入延迟的关键因素有哪些？如何定位瓶颈？
2. 如果 `refresh_interval` 从 1s 改成 10s，能降低延迟吗？会有什么影响？
3. 如果使用 Translog 异步模式（`durability: async`），写入延迟能降低多少？数据安全性如何保证？
4. 如果要实现「写入延迟 < 100ms」同时「数据不丢失」，你有哪些优化手段？

这道题的关键在于理解 Elasticsearch 的写入机制，以及如何在性能和数据安全性之间取得平衡。
