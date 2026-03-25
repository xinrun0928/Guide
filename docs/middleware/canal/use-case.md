# Canal 应用场景：数据库实时同步、ES 索引更新、缓存更新

原理懂了，配置会了，接下来最重要的问题是：**Canal 到底能干什么？**

这一节，从三个最经典的应用场景出发，看看 Canal 在实际业务中是怎么发挥价值的。

---

## 场景一：数据库实时同步

### 痛点

MySQL 是你的业务数据库，但数据量大了之后，复杂查询（比如多表 JOIN、模糊搜索）会拖垮主库。

**解决方案：** 把数据同步到从库，用从库做查询。

**但问题来了：** 怎么保证主从数据一致？怎么做到实时同步？

### Canal + 消息队列方案

```
MySQL ──binlog──▶ Canal ──▶ Kafka ──▶ 消费服务 ──▶ MySQL 从库
                              │
                              └──▶ 消费服务 ──▶ PostgreSQL
```

**为什么加 Kafka？**

- Canal 作为消息生产者，Kafka 作为缓冲层
- 多个下游消费方各自独立，互不影响
- Kafka 本身支持消息持久化和重试

### 完整实现

```java
// Canal Client：消费 binlog，发送到 Kafka
public class BinlogToKafkaProducer {
 private KafkaProducer&lt;String, String&gt; producer;

 public void init() {
 Properties props = new Properties();
 props.put("bootstrap.servers", "kafka:9092");
 props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
 props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
 producer = new KafkaProducer&lt;&gt;(props);
 }

 public void sendToKafka(Entry entry) {
 String topic = "binlog-" + entry.getHeader().getSchemaName()
 + "-" + entry.getHeader().getTableName();

 // 解析 binlog 数据
 BinlogMessage message = parseEntry(entry);
 String json = toJson(message);

 // 发送到 Kafka
 producer.send(new ProducerRecord&lt;&gt;(topic, json), (recordMetadata, e) -> {
 if (e != null) {
 // 发送失败，记录日志
 log.error("发送 Kafka 失败", e);
 }
 });
 }

 private BinlogMessage parseEntry(Entry entry) {
 BinlogMessage message = new BinlogMessage();
 message.setSchemaName(entry.getHeader().getSchemaName());
 message.setTableName(entry.getHeader().getTableName());
 message.setEventType(entry.getHeader().getEventType().name());
 message.setTimestamp(entry.getHeader().getExecuteTime());
 message.setLogFileName(entry.getHeader().getLogfileName());
 message.setLogPosition(entry.getHeader().getLogfileOffset());
 return message;
 }
}

// Kafka Consumer：从 Kafka 消费，同步到目标数据库
public class KafkaToDbConsumer {
 @KafkaListener(topics = "binlog-order-*")
 public void consume(String message) {
 BinlogMessage binlogMsg = parseJson(message);

 switch (binlogMsg.getEventType()) {
 case "INSERT":
 case "UPDATE":
 upsertData(binlogMsg);  // 同步到目标库
 break;
 case "DELETE":
 deleteData(binlogMsg);  // 从目标库删除
 break;
 }
 }
}
```

### 同步策略选择

| 策略 | 适用场景 | 优点 | 缺点 |
|-----|---------|------|-----|
| **实时同步** | 高一致性要求的场景 | 延迟低 | 系统压力大 |
| **批量同步** | 数据量大的场景 | 减少数据库 IO | 有延迟 |
| **异步双写** | 允许短暂不一致 | 性能好 | 可能丢数据 |

---

## 场景二：Elasticsearch 索引更新

### 痛点

业务数据存在 MySQL，但用户需要一个强大的搜索引擎——支持全文搜索、模糊匹配、相关性排序。

**ES 是好选择，但问题是怎么保持 MySQL 和 ES 的数据一致？**

### 方案：Canal + ES

```
MySQL ──binlog──▶ Canal ──▶ 消费服务 ──▶ Elasticsearch
                              │
                              └── 解析 binlog ──▶ 构建 ES 文档 ──▶ 索引更新
```

### 核心实现

```java
public class CanalToEsSync {

 private RestHighLevelClient esClient;

 /**
 * 处理 binlog 事件，更新 ES 索引
 */
 public void handleBinlog(Entry entry) {
 TableMeta表 meta = entry.getHeader().getTableMeta();
 String indexName = meta.getSchemaName() + "_" + meta.getTableName();

 for (RowChange rowChange : entry.getRowChangesList()) {
 switch (rowChange.getEventType()) {
 case INSERT:
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 新增文档
 Map&lt;String, Object&gt; doc = columnsToMap(rowData.getAfterColumnsList());
 indexDocument(indexName, rowData, doc);
 }
 break;

 case UPDATE:
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 更新文档（先删后增，或使用 update API）
 Map&lt;String, Object> doc = columnsToMap(rowData.getAfterColumnsList());
 updateDocument(indexName, rowData, doc);
 }
 break;

 case DELETE:
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 删除文档
 String id = getPrimaryKey(rowData.getBeforeColumnsList());
 deleteDocument(indexName, id);
 }
 break;
 }
 }
 }

 private void indexDocument(String indexName, RowData rowData, Map&lt;String, Object&gt; doc) {
 try {
 String id = getPrimaryKey(rowData.getAfterColumnsList());
 IndexRequest request = new IndexRequest(indexName)
 .id(id)
 .source(doc, XContentType.JSON);

 // 使用批量写入提升性能
 bulkProcessor.add(request);
 } catch (Exception e) {
 log.error("索引文档失败: index={}, id={}", indexName, id, e);
 }
 }

 private void updateDocument(String indexName, RowData rowData, Map&lt;String, Object&gt; doc) {
 try {
 String id = getPrimaryKey(rowData.getBeforeColumnsList());
 UpdateRequest request = new UpdateRequest(indexName, id)
 .doc(doc)
 .upsert(doc);  // 文档不存在时插入

 bulkProcessor.add(request);
 } catch (Exception e) {
 log.error("更新文档失败", e);
 }
 }
}
```

### ES 字段映射处理

MySQL 的表结构不能直接映射到 ES 的索引，需要做转换：

```java
/**
 * MySQL 类型到 ES 类型的映射
 */
private String mapToEsType(String mysqlType) {
 if (mysqlType.startsWith("int") || mysqlType.startsWith("bigint")) {
 return "long";
 } else if (mysqlType.startsWith("decimal") || mysqlType.startsWith("float")
 || mysqlType.startsWith("double")) {
 return "double";
 } else if (mysqlType.startsWith("date") || mysqlType.startsWith("time")
 || mysqlType.startsWith("year")) {
 return "date";
 } else if (mysqlType.equals("text") || mysqlType.equals("varchar")) {
 return "text";  // text 类型会分词
 }
 return "keyword";  // 其他类型默认 keyword
}

/**
 * 处理分词器选择
 */
private void setAnalyzer(Map&lt;String, Object&gt; doc, String fieldName, String fieldValue) {
 if (isChineseField(fieldName)) {
 // 中文全文搜索字段，使用 IK 分词器
 doc.put(fieldName + "_keyword", fieldValue);  // 保留 keyword 类型用于精确匹配
 }
}
```

### 批量写入优化

ES 索引更新是 IO 密集型操作，批量写入能显著提升性能：

```java
// 配置 BulkProcessor
BulkProcessor bulkProcessor = BulkProcessor.builder(
 (request, bulkListener) ->
 esClient.bulkAsync(request, RequestOptions.DEFAULT, bulkListener),
 bulkListener -> {
 // 批量完成后回调
 log.info("批量写入完成，数量: {}", bulkListener.getBulkCount());
 }
)
.setBulkActions(1000)      // 每 1000 条请求执行一次
.setBulkSize(5, FileSizeUnit.MB)  // 或每 5MB 执行一次
.setFlushInterval(TimeValue.timeValueSeconds(5))  // 每 5 秒执行一次
.setConcurrentRequests(4)  // 并发请求数
.build();
```

---

## 场景三：Redis 缓存更新

### 痛点

数据库查询太慢，加了 Redis 缓存。但缓存怎么保持新鲜？每次更新数据库时手动更新缓存？太麻烦，还容易漏。

**Canal 帮你自动同步。**

### 缓存更新的三种策略

| 策略 | 说明 | 适用场景 | 一致性 |
|-----|------|---------|-------|
| **Cache Aside** | 读时写缓存，写时删缓存 | 读多写少 | 最终一致 |
| **Read Through** | 缓存负责从数据库加载 | 缓存为主 | 最终一致 |
| **Write Through** | 写时同时写缓存 | 强一致性要求 | 强一致 |

**Canal 实现的是 Cache Aside 的变体：写时删缓存，让下次读时重新加载。**

### Canal + Redis 实现

```java
public class CanalToRedisSync {

 private JedisCluster jedis;

 /**
 * 处理缓存更新
 */
 public void handleCacheUpdate(Entry entry) {
 for (RowChange rowChange : entry.getRowChangesList()) {
 switch (rowChange.getEventType()) {
 case INSERT:
 case UPDATE:
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 根据变更数据生成缓存 key，更新缓存
 updateCache(rowData.getAfterColumnsList());
 }
 break;

 case DELETE:
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 删除缓存
 deleteCache(rowData.getBeforeColumnsList());
 }
 break;
 }
 }
 }

 private void updateCache(List&lt;Column&gt; columns) {
 // 假设缓存 key 格式为: cache:{table}:{primaryKey}
 String tableName = columns.stream()
 .findFirst()
 .orElseThrow(() -> new IllegalStateException("空列"))
 .getTableName();

 String primaryKey = null;
 Map&lt;String, String&gt; cacheData = new HashMap&lt;&gt;();

 for (Column col : columns) {
 if (col.isPrimary()) {
 primaryKey = col.getValue();
 }
 cacheData.put(col.getName(), col.getValue());
 }

 if (primaryKey == null) {
 return;
 }

 String cacheKey = "cache:" + tableName + ":" + primaryKey;

 // 写入 Redis Hash
 jedis.hset(cacheKey, cacheData);
 // 设置过期时间（防止缓存雪崩）
 jedis.expire(cacheKey, 3600);  // 1 小时过期
 }

 private void deleteCache(List&lt;Column&gt; columns) {
 // 找到主键，删除缓存
 String primaryKey = columns.stream()
 .filter(Column::isPrimary)
 .map(Column::getValue)
 .findFirst()
 .orElse(null);

 if (primaryKey != null) {
 String tableName = columns.get(0).getTableName();
 String cacheKey = "cache:" + tableName + ":" + primaryKey;
 jedis.del(cacheKey);
 }
 }
}
```

### 缓存一致性问题

**Canal + Redis 的组合不能保证强一致性，只能保证最终一致性。**

常见问题及解决方案：

| 问题 | 场景 | 解决方案 |
|-----|------|---------|
| **缓存击穿** | 缓存过期瞬间，大量请求击穿到数据库 | 缓存永不过期 + 后台异步刷新 |
| **缓存雪崩** | 大量缓存同时过期 | 随机过期时间 + 缓存预热 |
| **数据不一致** | Canal 延迟导致缓存和 DB 不同步 | 给缓存加短过期时间 + 延迟双删 |

**延迟双删策略：**

```java
// 更新数据库
updateDatabase(record);

// 删除缓存
deleteCache(key);

// 延迟一段时间后再删除一次（处理并发问题）
// 如果在删除缓存和更新 DB 之间，有请求把旧数据写回缓存，延迟删除可以清除它
new Thread(() -> {
 try {
 Thread.sleep(500);  // 延迟 500ms
 deleteCache(key);
 } catch (InterruptedException e) {
 // ignore
 }
}).start();
```

---

## 组合场景：多下游同步

Canal 的真正威力在于**一对多**——一个数据库变更，同时触发多个下游系统的同步。

```
MySQL ──binlog──▶ Canal ──┬──▶ Kafka ──▶ ES 索引更新
                         │
                         ├──▶ Redis ──▶ 缓存更新
                         │
                         ├──▶ MySQL 从库 ──▶ 报表查询
                         │
                         └──▶ 消息队列 ──▶ 下游业务系统
```

### 实现多消费者

```java
public class MultiDestinationSync {
 private final KafkaTemplate&lt;String, String&gt; kafkaTemplate;
 private final RedisTemplate&lt;String, Object&gt; redisTemplate;
 private final ElasticsearchRestTemplate esTemplate;

 public void handleBinlog(Entry entry) {
 for (RowChange rowChange : entry.getRowChangesList()) {
 // 1. 发 Kafka
 sendToKafka(entry);

 // 2. 更新 Redis 缓存
 updateRedis(rowChange);

 // 3. 更新 ES 索引
 updateEs(rowChange);

 // 4. 发送到业务消息队列（触发下游业务）
 sendToBizQueue(entry);
 }
 }
}
```

---

## 面试官会问什么？

**Q1：Canal 同步延迟是多少？怎么优化？**

Canal 的延迟主要来自：binlog 传输 + Canal 解析 + 网络传输 + 消费处理。

优化方向：

- 批量 ACK，减少 Zookeeper 压力
- 批量写入 ES/Redis，减少 IO 次数
- 多线程并行处理（注意幂等性）
- 使用 Kafka 作为缓冲层，削峰填谷

**Q2：Canal 丢数据怎么办？**

Canal 丢数据的场景：

- Canal Server 挂了，没来得及持久化 position
- MySQL binlog 被清理了

解决方案：

- 开启半同步复制，保证 binlog 写入从库
- 设置合理的 binlog 过期时间
- 集群模式，position 持久化到 Zookeeper

**Q3：如何保证消费幂等性？**

binlog 消费必须幂等，否则重复处理会导致数据错误。

```java
public void processMessage(BinlogMessage message) {
 String uniqueKey = message.getSchemaName() + ":"
 + message.getTableName() + ":"
 + message.getLogPosition();  // 用 position 作为唯一标识

 // 幂等检查：分布式锁或去重表
 if (isProcessed(uniqueKey)) {
 return;  // 已处理，跳过
 }

 // 处理业务逻辑
 doProcess(message);

 // 标记已处理
 markProcessed(uniqueKey);
}
```

---

## 写在最后

Canal 的价值，在于把「数据库变更」变成「可消费的事件」。一旦你有了这个事件流，就可以做无限多的事情——同步数据、更新索引、刷新缓存、触发业务、监控变更……

**关键是：你想用这个事件流做什么？**

**留给你的问题：**

假设你的业务同时使用了 MySQL 主库、ES 索引、Redis 缓存。现在有个需求：用户查询必须返回完全一致的数据（强一致性）。

Canal 能满足这个需求吗？如果不能，你有什么解决方案？

下一节，我们来横向对比 [Canal vs Maxwell vs Debezium](/middleware/canal/compare)，看看不同工具的适用场景。
