# Elasticsearch 数据同步方案：双写、Logstash、Canal、Debezium

业务系统的数据通常存储在 MySQL、PostgreSQL 等关系型数据库中。如何将这些数据同步到 ES？这里有几种主流方案。

## 1. 为什么需要数据同步？

```
┌──────────────┐       写入       ┌──────────────┐
│   MySQL      │ ──────────────→ │   应用       │
│  (主数据库)   │                  │              │
└──────────────┘                  └──────────────┘
                                          │
                                          │ 同步
                                          ▼
                                   ┌──────────────┐
                                   │ Elasticsearch │
                                   │ (搜索索引)    │
                                   └──────────────┘
```

**为什么要同步？**

1. **ES 不擅长的事务性操作**：ES 不支持 ACID 事务，复杂业务逻辑在数据库中更可靠
2. **各司其职**：MySQL 处理业务，ES 处理搜索
3. **数据规模**：全量数据在 MySQL，ES 只索引需要搜索的字段

## 2. 方案一：双写（同步双写）

### 2.1 原理

在写入 MySQL 的同时，也写入 ES。

```java
// 应用层双写
@Service
public class BlogService {

    @Autowired
    private BlogMapper blogMapper;

    @Autowired
    private ElasticsearchClient esClient;

    public void createBlog(Blog blog) {
        // 1. 写入 MySQL
        blogMapper.insert(blog);

        // 2. 写入 ES
        IndexRequest request = IndexRequest.of(b -> b
            .index("blog")
            .id(blog.getId())
            .document(blog)
        );
        esClient.index(request);
    }
}
```

### 2.2 优缺点

| 优点 | 缺点 |
|-----|------|
| 实现简单 | 业务代码耦合 |
| 数据实时性高 | 可能出现数据不一致 |
| 一次事务完成 | 写入性能下降 |

### 2.3 异步双写优化

```java
// 使用消息队列异步双写，降低耦合
public void createBlog(Blog blog) {
    // 1. 写入 MySQL
    blogMapper.insert(blog);

    // 2. 发送消息到 MQ
    kafkaTemplate.send("blog-sync", JSON.toJSONString(blog));
}

// 消费者处理消息，写入 ES
@KafkaListener(topics = "blog-sync")
public void syncToES(String message) {
    Blog blog = JSON.parseObject(message, Blog.class);
    esClient.index(request);
}
```

## 3. 方案二：Logstash JDBC Input

### 3.1 原理

```
MySQL → Logstash → Elasticsearch

Logstash 定期执行 SQL，将结果批量写入 ES
```

### 3.2 配置示例

```java
// logstash-mysql-to-es.conf
input {
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog"
    jdbc_user => "root"
    jdbc_password => "password"

    // 追踪字段，记录上次同步位置
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"
    last_run_metadata_path => "/var/lib/logstash/jdbc_last_run"

    // SQL 语句
    statement => "SELECT * FROM blog WHERE updated_at > :sql_last_value"

    // 同步频率
    schedule => "*/5 * * * *"    // 每 5 分钟执行一次
  }
}

filter {
  // 处理日期格式
  date {
    match => ["created_at", "ISO8601"]
    target => "created_at"
  }
}

output {
  elasticsearch {
    hosts => ["http://es:9200"]
    index => "blog"
    document_id => "%{id}"
    action => "update"           // 支持更新
    doc_as_upsert => true        // 不存在则创建
  }
}
```

### 3.3 优缺点

| 优点 | 缺点 |
|-----|------|
| 配置简单 | 有延迟（取决于同步频率） |
| 不影响业务代码 | 不支持增量删除 |
| 支持复杂转换 | 全量同步较慢 |

## 4. 方案三：Canal（阿里开源）

### 4.1 原理

```
MySQL → Canal Server → Canal Adapter → Elasticsearch

Canal 伪装成 MySQL 从库，解析 binlog，实现增量同步
```

### 4.2 架构

```
┌─────────────┐     Binlog      ┌─────────────┐
│   MySQL     │ ─────────────→ │ Canal Server │
│  (主库)     │                │   (解析)     │
└─────────────┘                └──────┬──────┘
                                       │
                                       │ TCP/HTTP
                                       ▼
                                ┌─────────────┐
                                │Canal Adapter│
                                │  (写入 ES)  │
                                └──────┬──────┘
                                       │
                                       ▼
                                ┌─────────────┐
                                │Elasticsearch │
                                └─────────────┘
```

### 4.3 Canal 配置

```java
// application.yml
server:
  port: 8081

canal:
  server: canal-server:11111

elasticsearch:
  hosts: es:9200
  index: blog

dataSourceKey: defaultDS
destination: example
```

```java
// binlog 订阅配置
{
  "destination": "example",
  " Canal Mode": "TCP",
  "dataSourceKey": "defaultDS",
  "etl": "false",
  "commitBatch": 3000,
  "parallel": true,
  "parallelThreadSize": 8,
  "filters": {
    // 表名过滤
  },
  "sink": {
    "elasticsearch": {
      "hosts": ["es:9200"],
      "index": "blog_{}_{{YYYY-MM-dd}}"
    }
  }
}
```

### 4.4 优缺点

| 优点 | 缺点 |
|-----|------|
| 实时性高（秒级） | 架构复杂 |
| 不影响主库性能 | 需要部署额外组件 |
| 支持增量更新和删除 | MySQL 需要开启 binlog |

## 5. 方案四：Debezium（Red Hat 开源）

### 5.1 原理

Debezium 是一个 CDC（Change Data Capture）平台，读取数据库 binlog，将变化数据发送到 Kafka，再由消费者处理。

```
MySQL → Debezium → Kafka → 消费者 → Elasticsearch
```

### 5.2 Docker Compose 配置

```yaml
version: '3'

services:
  mysql:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: rootpass
      MYSQL_DATABASE: blog
    command:
      - --binlog-format=ROW
      - --server-id=1

  zookeeper:
    image: confluentinc/cp-zookeeper:5.9.0

  kafka:
    image: confluentinc/cp-kafka:5.9.0
    depends_on:
      - zookeeper
    environment:
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092

  debezium:
    image: debezium/connect:1.9
    depends_on:
      - kafka
    environment:
      BOOTSTRAP_SERVERS: kafka:9092
      GROUP_ID: 1
      CONFIG_STORAGE_TOPIC: my-connect-configs
      OFFSET_STORAGE_TOPIC: my-connect-offsets

  elasticsearch:
    image: elasticsearch:8.0.0
    environment:
      - discovery.type=single-node
```

### 5.3 注册 Debezium Connector

```bash
curl -i -X POST http://debezium:8083/connectors \
  -H "Accept:application/json" \
  -H "Content-Type:application/json" \
  -d '{
    "name": "blog-connector",
    "config": {
      "connector.class": "io.debezium.connector.mysql.MySqlConnector",
      "database.hostname": "mysql",
      "database.port": "3306",
      "database.user": "root",
      "database.password": "rootpass",
      "database.server.id": "1",
      "database.server.name": "blog-db",
      "database.include.list": "blog",
      "table.include.list": "blog.blog",
      "include.schema.changes": "false",
      "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
      "schema.history.internal.kafka.topic": "schema-changes",
      "topic.prefix": "blog",
      "transforms": "unwrap",
      "transforms.unwrap.type": "io.debezium.transforms.ExtractNewRecordState"
    }
  }'
```

### 5.4 消费消息写入 ES

```java
// Kafka 消费者
@KafkaListener(topics = "blog.blog")
public void consumeBlogEvent(String message) {
    // Debezium 发送的是 JSON 格式的变更事件
    // 需要解析并提取 after 字段（变更后的数据）
    JsonNode event = objectMapper.readTree(message);

    JsonNode payload = event.get("payload");
    String operation = payload.get("op").asText();  // c=create, u=update, d=delete, r=snapshot

    JsonNode after = payload.get("after");

    if ("c".equals(operation) || "u".equals(operation)) {
        // 插入或更新
        Blog blog = parseBlog(after);
        esClient.index(request);
    } else if ("d".equals(operation)) {
        // 删除
        String id = after.get("id").asText();
        esClient.delete(DeleteRequest.of(d -> d.index("blog").id(id)));
    }
}
```

### 5.5 优缺点

| 优点 | 缺点 |
|-----|------|
| 实时性高 | 架构复杂 |
| 支持多种数据库 | 需要维护 Kafka |
| 社区活跃 | 学习成本较高 |
| 可选多消费者 | 配置项较多 |

## 6. 方案对比

| 方案 | 实时性 | 延迟 | 复杂度 | 数据一致性 | 适合场景 |
|-----|--------|------|--------|-----------|---------|
| 双写（同步） | 秒级 | < 1s | 低 | 可能不一致 | 小规模、实时性要求不高 |
| 双写（异步） | 秒级 | < 1s | 中 | 可能不一致 | 中规模、需要解耦 |
| Logstash JDBC | 准实时 | 分钟级 | 低 | 依赖追踪字段 | 定时同步、增量同步 |
| Canal | 实时 | 秒级 | 中 | 高 | 大规模、实时同步 |
| Debezium | 实时 | 秒级 | 高 | 高 | 大规模、需要多消费者 |

## 7. 数据一致性保障

无论使用哪种方案，数据一致性都是关键问题。

### 7.1 幂等写入

```java
// ES 写入使用 upsert，保证幂等性
POST blog/_doc/blog_123?op_type=create
{
  // 重复写入不会创建重复文档
}

// 或使用版本控制
POST blog/_update/blog_123
{
  "doc": { ... },
  "doc_as_upsert": true
}
```

### 7.2 全量 + 增量同步

```
┌─────────────────────────────────────────────────────────────┐
│                    数据同步策略                              │
│                                                               │
│  阶段一：全量同步（初始化）                                    │
│  └─→ 定时任务或手动触发，一次性同步全部数据                    │
│                                                               │
│  阶段二：增量同步（日常）                                      │
│  └─→ Canal/Debezium 监听 binlog，持续同步增量                 │
│                                                               │
│  阶段三：定期校验（可选）                                      │
│  └─→ 定期对比 MySQL 和 ES 数据，修复不一致                     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 7.3 数据校验

```java
// 定期校验数据一致性
public void verifyDataConsistency() {
    // 1. 统计 MySQL 数据量
    long mysqlCount = blogMapper.count();

    // 2. 统计 ES 数据量
    CountRequest countRequest = CountRequest.of(c -> c.index("blog"));
    CountResponse esResponse = client.count(countRequest, RequestOptions.DEFAULT);
    long esCount = esResponse.count();

    // 3. 对比
    if (mysqlCount != esCount) {
        // 数据不一致，触发告警或修复
        log.error("Data inconsistency detected: MySQL={}, ES={}", mysqlCount, esCount);
    }
}
```

## 8. 面试高频问题

### Q1：如何选择数据同步方案？

**答案**：

- 小规模、实时性要求不高：Logstash JDBC
- 中等规模、需要实时：异步双写 + MQ
- 大规模、严格实时：Canal 或 Debezium

### Q2：如何保证数据一致性？

**答案**：

1. 使用幂等写入，避免重复
2. 定期校验数据
3. 全量 + 增量同步结合
4. 建立补偿机制，处理异常情况

### Q3：Canal 和 Debezium 的区别？

**答案**：

- Canal 只支持 MySQL，Debezium 支持 MySQL、PostgreSQL、MongoDB 等
- Canal 直接写入，Debezium 通过 Kafka 解耦
- Debezium 社区更活跃，功能更丰富

## 总结

数据同步是 ES 应用的关键环节：

1. **双写**：简单直接，但影响业务代码
2. **Logstash JDBC**：配置简单，适合定时同步
3. **Canal**：实时性高，但架构复杂
4. **Debezium**：最灵活，但需要 Kafka

选择方案时需要权衡：数据规模、实时性要求、团队技术栈、运维成本。

---

**留给你的问题**：

假设你负责一个日活 100 万的电商平台，商品数据需要同步到 ES。商品表有 1000 万数据，每天更新 10 万次。

你会选择哪种同步方案？为什么？

需要考虑的问题：实时性要求、峰值流量、数据一致性保障、运维成本。
