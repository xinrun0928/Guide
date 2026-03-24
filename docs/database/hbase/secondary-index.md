# HBase 二级索引：突破 RowKey 的限制

HBase 只有 RowKey 索引，想按其他列查询？

二级索引就是解决方案。

---

## 为什么需要二级索引？

```
HBase 原生只支持 RowKey 索引：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  主表：users                                                │
│  RowKey: user_001                                          │
│  - 查询 user_001 ✓ （快）                                   │
│  - 查询 email = 'test@example.com' ✗ （慢，需要全表扫描）       │
│                                                             │
└─────────────────────────────────────────────────────────────┘

解决方案：二级索引
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  索引表：idx_email                                          │
│  RowKey: email_value                                       │
│  Column: user_id                                           │
│                                                             │
│  索引结构：                                                 │
│  test@example.com → user_001                                │
│  zhang@example.com → user_002                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 实现方案对比

| 方案 | 实现复杂度 | 维护成本 | 查询性能 | 适用场景 |
|-----|-----------|---------|---------|---------|
| **Phoenix 索引** | 低 | 自动 | 高 | SQL 查询 |
| **协处理器索引** | 中 | 自动 | 高 | Java 代码 |
| **手动索引表** | 高 | 手动 | 高 | 定制化需求 |
| **ElasticSearch** | 中 | 外部同步 | 极高 | 复杂查询 |

---

## 方案一：Phoenix 索引

```sql
-- 全局索引（高读取性能）
CREATE INDEX idx_email ON users(email);

-- 本地索引（高写入性能）
CREATE LOCAL INDEX idx_status ON users(status);

-- 覆盖索引（避免回表）
CREATE INDEX idx_email_covering ON users(email)
    INCLUDE (name, phone);
```

### 查询

```sql
-- 自动使用索引
SELECT * FROM users WHERE email = 'test@example.com';

-- 查看执行计划
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';
```

---

## 方案二：协处理器索引

### 索引表设计

```
索引表名：idx_status_idx

RowKey: status_value_rowkey
示例：
  active_user_001 → 原始 RowKey（用于回表）
  active_user_002 → 原始 RowKey
  inactive_user_003 → 原始 RowKey
```

### 协处理器实现

```java
// 写入时维护索引
public class IndexObserver extends RegionObserver {

    @Override
    public void postPut(ObserverContext<Region> c, Put put, WALEdit edit)
            throws IOException {
        // 获取索引列的值
        String status = getColumnValue(put, "info", "status");
        String rowKey = getRowKey(put);

        // 写入索引表
        String indexRowKey = status + "_" + rowKey;
        Put indexPut = new Put(Bytes.toBytes(indexRowKey));
        indexPut.addColumn(
            Bytes.toBytes("idx"),
            Bytes.toBytes("rk"),
            Bytes.toBytes(rowKey)
        );

        Table indexTable = getIndexTable("idx_status_idx");
        indexTable.put(indexPut);
    }

    @Override
    public void postDelete(ObserverContext<Region> c, Delete delete, WALEdit edit)
            throws IOException {
        // 删除时同时删除索引
        String status = getColumnValue(delete, "info", "status");
        String rowKey = getRowKey(delete);

        Delete indexDelete = new Delete(
            Bytes.toBytes(status + "_" + rowKey)
        );

        Table indexTable = getIndexTable("idx_status_idx");
        indexTable.delete(indexDelete);
    }
}
```

### 索引查询

```java
// 使用索引查询
public List<String> queryByIndex(String indexColumn, String indexValue)
        throws IOException {
    // 1. 查询索引表，获取所有匹配的 RowKey
    Table indexTable = connection.getTable(
        TableName.valueOf("idx_" + indexColumn + "_idx"));

    Scan scan = new Scan();
    scan.withStartRow(Bytes.toBytes(indexValue + "_"));
    scan.withStopRow(Bytes.toBytes(indexValue + "_" + Character.MAX_VALUE));

    List<String> rowKeys = new ArrayList<>();

    try (ResultScanner scanner = indexTable.getScanner(scan)) {
        for (Result result : scanner) {
            byte[] rk = result.getValue(
                Bytes.toBytes("idx"),
                Bytes.toBytes("rk")
            );
            rowKeys.add(Bytes.toString(rk));
        }
    }

    // 2. 批量获取主表数据
    List<Get> gets = rowKeys.stream()
        .map(rk -> {
            Get get = new Get(Bytes.toBytes(rk));
            return get;
        })
        .collect(Collectors.toList());

    Table mainTable = connection.getTable(TableName.valueOf("users"));
    Result[] results = mainTable.get(gets);

    return parseResults(results);
}
```

---

## 方案三：ElasticSearch 索引

### 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    ES + HBase 架构                         │
│                                                             │
│  HBase (主数据源)                                          │
│       │                                                     │
│       ├─→ Indexer ──→ ElasticSearch (二级索引)               │
│       │                                                     │
│       └─→ 实时查询                                         │
│                                                             │
│  查询流程：                                                 │
│  1. ES 查询获取 RowKey 列表                                │
│  2. HBase 批量获取实际数据                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 配置

```xml
<!-- Morphline 配置文件 -->
<morphlines>
  <morphline id="indexHBaseToEs">
    importCommands:
      - org.kitesdk.morphline.**
      - org.apache.solr.**

    readHBase {
      bethalFormat: true
      table: users
      columns: [user_id, name, email, status]
    }

    extractJsonPaths {
      FLATTEN: true
      paths {
        user_id: /user_id
        name: /name
        email: /email
        status: /status
      }
    }

    sanitizeJson {
      outputClass: java.lang.String
    }

    loadSolr {
      solrLocator {
        collection: users
        zkHost: "es-zk1:2181,es-zk2:2181,es-zk3:2181/solr"
      }
    }
  </morphline>
</morphlines>
```

### Java 代码

```java
// ES + HBase 查询
public class EsHBaseQuery {
    private final RestHighLevelClient esClient;
    private final Connection hbaseConn;

    // 搜索用户
    public List<User> searchUsers(String keyword) throws IOException {
        // 1. ES 搜索获取 RowKey
        SearchRequest request = new SearchRequest("users");
        SearchSourceBuilder source = new SearchSourceBuilder();
        source.query(QueryBuilders.matchQuery("email", keyword));

        SearchResponse response = esClient.search(request);

        List<String> rowKeys = new ArrayList<>();
        for (SearchHit hit : response.getHits()) {
            Map<String, Object> sourceMap = hit.getSourceAsMap();
            rowKeys.add((String) sourceMap.get("user_id"));
        }

        // 2. HBase 批量获取
        Table table = hbaseConn.getTable(TableName.valueOf("users"));
        List<Get> gets = rowKeys.stream()
            .map(rk -> new Get(Bytes.toBytes(rk)))
            .collect(Collectors.toList());

        Result[] results = table.get(gets);

        return parseResults(results);
    }
}
```

---

## 方案选择建议

```
┌─────────────────────────────────────────────────────────────┐
│                    二级索引方案选择                          │
│                                                             │
│  需要 SQL 查询？                                            │
│     │                                                      │
│     ├─ 是 → Phoenix 索引                                    │
│     │                                                      │
│     └─ 否 → 需要什么特性？                                 │
│                │                                          │
│                ├─ 高写入性能 → 本地索引或协处理器              │
│                ├─ 复杂查询 → ElasticSearch                │
│                └─ 简单等值查询 → 协处理器索引             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

- HBase 二级索引的维护代价是什么？
- 如何保证主表和索引表的数据一致性？

下一节，我们来了解 HBase 的典型应用场景。
