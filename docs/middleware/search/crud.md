# Elasticsearch 文档 CRUD 与并发控制

你已经知道 ES 是如何存储数据的，现在让我们来看看最基础的操作：**增删改查**（CRUD）。

但 ES 的 CRUD 和传统数据库不太一样——它的「改」和「删」都是异步的，而且还有一套独特的**乐观锁**机制来处理并发冲突。

## 1. Document 的唯一标识

在 ES 中，每个文档都有一个唯一标识：

```java
// 方式一：手动指定 ID
PUT my_index/_doc/1
{
  "title": "Elasticsearch 入门",
  "author": "张三"
}

// 方式二：自动生成 ID（UUID）
POST my_index/_doc
{
  "title": "Elasticsearch 进阶",
  "author": "李四"
}
// 返回的 _id 是自动生成的
```

**两种方式的对比：**

| 方式 | 优点 | 缺点 |
|-----|------|------|
| 手动指定 | ID 可控，可以做幂等写入 | 需要保证 ID 唯一性 |
| 自动生成 | 简单，无需管理 ID | 写入前不知道 ID |

## 2. Create（创建文档）

### 2.1 索引文档（自动创建）

```java
// 如果索引不存在，ES 会自动创建
PUT my_index/_doc/1
{
  "title": "深入理解 ES",
  "content": "倒排索引是 ES 的核心..."
}
```

### 2.2 存在性检查

```java
// 默认：如果文档已存在，返回 409 冲突
PUT my_index/_doc/1?op_type=create    // 只创建，不更新
PUT my_index/_doc/1?op_type=create
{
  "title": "Elasticsearch 进阶"
}

// 或者使用 _create 端点
PUT my_index/_doc/1/_create
{
  "title": "Elasticsearch 进阶"
}
```

## 3. Read（读取文档）

### 3.1 根据 ID 查询

```java
// 读取单个文档
GET my_index/_doc/1

// 返回结果
{
  "_index": "my_index",
  "_id": "1",
  "_version": 1,
  "_seq_no": 0,
  "_primary_term": 1,
  "found": true,
  "_source": {
    "title": "深入理解 ES",
    "content": "倒排索引是 ES 的核心..."
  }
}
```

### 3.2 批量读取

```java
// mget：批量获取多个文档
GET _mget
{
  "docs": [
    { "_index": "my_index", "_id": "1" },
    { "_index": "my_index", "_id": "2" },
    { "_index": "my_index", "_id": "3" }
  ]
}

// 简化写法
GET my_index/_mget
{
  "ids": ["1", "2", "3"]
}
```

### 3.3 只获取部分字段

```java
// _source_includes：只返回指定字段
GET my_index/_doc/1?_source_includes=title,author

// _source_excludes：排除指定字段
GET my_index/_doc/1?_source_excludes=content
```

## 4. Update（更新文档）

ES 的更新有三种方式，各有适用场景。

### 4.1 替换文档（PUT）

```java
// 替换整个文档
PUT my_index/_doc/1
{
  "title": "Elasticsearch 完全指南",    // 改了
  "content": "新版内容"                  // 整个 content 被替换
}

// 注意：如果只改 title，content 会丢失
```

### 4.2 部分更新（Update API）

```java
// 只更新指定字段
POST my_index/_update/1
{
  "doc": {
    "title": "Elasticsearch 完全指南",
    "views": 1000
  }
}
```

### 4.3 脚本更新

```java
// 使用 Painless 脚本更新
POST my_index/_update/1
{
  "script": {
    "source": "ctx._source.views += params.count",
    "params": {
      "count": 1
    }
  }
}

// 条件更新
POST my_index/_update/1
{
  "script": {
    "source": """
      if (ctx._source.views < params.threshold) {
        ctx._source.views += 1
      } else {
        ctx.op = 'noop'
      }
    """,
    "params": {
      "threshold": 100
    }
  }
}
```

### 4.4 upsert：不存在时创建

```java
// 如果文档存在就更新，不存在就创建
POST my_index/_update/1
{
  "upsert": {
    "title": "新文档",
    "created_at": "2024-01-01"
  },
  "doc": {
    "views": 1
  }
}
```

## 5. Delete（删除文档）

### 5.1 删除单个文档

```java
// 根据 ID 删除
DELETE my_index/_doc/1

// 返回结果
{
  "_index": "my_index",
  "_id": "1",
  "_version": 2,      // 版本号增加
  "result": "deleted"
}
```

### 5.2 删除匹配条件的文档

```java
// 删除所有 status=deleted 的文档
POST my_index/_delete_by_query
{
  "query": {
    "term": {
      "status": "deleted"
    }
  }
}
```

> **注意**：删除文档不会立即从物理存储中移除，而是标记为 deleted。等 Segment 合并时才会真正删除。这是 ES 的「逻辑删除」机制。

## 6. 批量操作（Bulk API）

### 6.1 批量索引

```java
POST _bulk
{ "index": { "_index": "my_index", "_id": "1" } }
{ "title": "文档1", "content": "内容1" }
{ "index": { "_index": "my_index", "_id": "2" } }
{ "title": "文档2", "content": "内容2" }
{ "index": { "_index": "my_index", "_id": "3" } }
{ "title": "文档3", "content": "内容3" }
```

### 6.2 混合操作

```java
POST _bulk
{ "index": { "_index": "my_index", "_id": "1" } }
{ "title": "文档1" }
{ "delete": { "_index": "my_index", "_id": "2" } }
{ "update": { "_index": "my_index", "_id": "3" } }
{ "doc": { "title": "更新的标题" } }
```

### 6.3 Java 客户端示例

```java
// BulkRequest 批量写入
BulkRequest bulkRequest = new BulkRequest();
for (Blog blog : blogs) {
    bulkRequest.add(new IndexRequest("blog")
        .id(blog.getId())
        .source(XContentType.JSON, "title", blog.getTitle(),
                "content", blog.getContent(),
                "author", blog.getAuthor()));
}

BulkResponse responses = client.bulk(bulkRequest, RequestOptions.DEFAULT);
if (responses.hasErrors()) {
    // 处理错误
}
```

## 7. 并发控制：乐观锁

ES 使用**乐观锁**（Optimistic Concurrency Control）来处理并发冲突。

### 7.1 版本控制原理

每个文档都有一个 `_version` 字段：

```
初始创建：_version = 1
第一次更新：_version = 2
第二次更新：_version = 3
...
```

**更新时必须指定版本号或序列号：**

```java
// 使用 _version 乐观锁
PUT my_index/_doc/1?if_seq_no=1&if_primary_term=1
{
  "title": "更新的标题"
}

// 如果版本不匹配，返回 409 Conflict
// 如果版本匹配，更新成功，_version + 1
```

### 7.2 _seq_no 和 _primary_term

ES 7.0+ 引入了更可靠的并发控制机制：

| 字段 | 说明 |
|-----|------|
| _seq_no | 序列号，每次操作递增，全局唯一 |
| _primary_term | 主分片任期号，主分片变更时递增 |

```java
// 读取文档获取当前版本信息
GET my_index/_doc/1

// 返回：
{
  "_seq_no": 5,
  "_primary_term": 1,
  "_version": 5
}

// 使用 seq_no 和 primary_term 更新
PUT my_index/_doc/1?if_seq_no=5&if_primary_term=1
{
  "title": "新的标题"
}
```

### 7.3 重试机制

```java
// retry_on_conflict：冲突时自动重试
POST my_index/_update/1?retry_on_conflict=3
{
  "doc": {
    "views": 1
  }
}

// Java 客户端示例
IndexRequest request = new IndexRequest("my_index").id("1")
    .source(Map.of("title", "New Title"))
    .setRefreshPolicy(WriteRequest.RefreshPolicy.TRUE)
    .setIfSeqNo(5)
    .setIfPrimaryTerm(1);
```

## 8. 写一致性模型

### 8.1 一致性级别

```java
// one：只写入主分片
PUT my_index/_doc/1?consistency=one
{
  "title": "Test"
}

// quorum：写入过半分片（默认）
PUT my_index/_doc/1?consistency=quorum
{
  "title": "Test"
}

// all：写入所有分片（包括副本）
PUT my_index/_doc/1?consistency=all
{
  "title": "Test"
}
```

### 8.2 wait_for_active_shards

```java
// 等待至少 N 个分片活跃后再写入
PUT my_index/_doc/1?wait_for_active_shards=2
{
  "title": "Test"
}

// 可以和一致性级别组合
PUT my_index/_doc/1?consistency=quorum&wait_for_active_shards=2
{
  "title": "Test"
}
```

## 9. 刷新机制

### 9.1 refresh 参数

```java
// true：立即可见（默认 false）
PUT my_index/_doc/1?refresh=true
{
  "title": "立即可见"
}

// wait_for：等待下次 refresh 后可见
PUT my_index/_doc/1?refresh=wait_for
{
  "title": "等待 refresh"
}

// false：不立即可见（默认，推荐批量写入时使用）
PUT my_index/_doc/1?refresh=false
{
  "title": "不立即可见"
}
```

> **注意**：`refresh=true` 会触发 refresh 操作，增加 CPU 和 IO 压力，影响写入性能。生产环境批量写入时应使用 `refresh=false`。

## 10. Java 客户端完整示例

```java
import org.elasticsearch.client.RequestOptions;
import org.elasticsearch.client.RestHighLevelClient;
import org.elasticsearch.client.core.BroadcastResponse;
import org.elasticsearch.client.indices.CreateIndexRequest;
import org.elasticsearch.client.indices.GetIndexRequest;
import org.elasticsearch.xcontent.XContentType;

import java.io.IOException;
import java.util.Map;

public class ESClientExample {

    private RestHighLevelClient client;

    // 创建索引
    public void createIndex() throws IOException {
        CreateIndexRequest request = new CreateIndexRequest("my_index");
        request.settings(Map.of(
            "number_of_shards", 3,
            "number_of_replicas", 1
        ));
        request.mapping(Map.of(
            "title", Map.of("type", "text"),
            "content", Map.of("type", "text"),
            "views", Map.of("type", "long")
        ), XContentType.JSON);

        client.indices().create(request, RequestOptions.DEFAULT);
    }

    // 索引文档
    public void indexDocument() throws IOException {
        Map&lt;String, Object&gt; doc = Map.of(
            "title", "ES 实战",
            "content", "倒排索引原理...",
            "views", 100
        );

        IndexRequest request = new IndexRequest("my_index")
            .id("1")
            .source(doc, XContentType.JSON);

        IndexResponse response = client.index(request, RequestOptions.DEFAULT);
        // response.getResult() == DocWriteResponse.Result.CREATED/UPDATED
    }

    // 读取文档
    public void getDocument() throws IOException {
        GetRequest request = new GetRequest("my_index", "1");
        GetResponse response = client.get(request, RequestOptions.DEFAULT);

        if (response.isExists()) {
            Map&lt;String, Object&gt; source = response.getSourceAsMap();
            System.out.println(source);
        }
    }

    // 更新文档
    public void updateDocument() throws IOException {
        UpdateRequest request = new UpdateRequest("my_index", "1")
            .doc(Map.of("views", 101));

        UpdateResponse response = client.update(request, RequestOptions.DEFAULT);
    }

    // 删除文档
    public void deleteDocument() throws IOException {
        DeleteRequest request = new DeleteRequest("my_index", "1");
        DeleteResponse response = client.delete(request, RequestOptions.DEFAULT);
    }
}
```

## 总结

ES 的 CRUD 特点：

1. **Document ID**：可以手动指定或自动生成
2. **Update 是部分更新**：使用 `doc` 参数只更新指定字段
3. **乐观锁机制**：通过 `_version` 或 `seq_no` 控制并发
4. **批量操作**：`Bulk API` 大幅提升写入性能
5. **refresh 策略**：`refresh=false` 适合批量写入

理解这些机制，是正确使用 ES 的基础。

---

**留给你的问题**：

在高频写入场景中，你发现大量更新操作因为版本冲突失败。你会如何优化？

可能的方向：调整重试策略、降低一致性要求、使用异步写入、合并多次更新为一次。哪种方案最适合你的场景？
