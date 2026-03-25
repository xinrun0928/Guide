# Logstash：数据处理管道

日志分散在 10 台服务器上，格式各不相同——有 JSON、有 CSV、有纯文本。运营同学突然问你：「昨天北京地区 iOS 用户下单失败的总次数是多少？」

你不可能一台一台服务器去 grep。

Logstash 就是来解决这个问题的——它能把散落在各处的数据统一收集、清洗、转换，送到 Elasticsearch 进行分析。

## Logstash 是什么？

Logstash 是 ELK Stack 中的 **ETL（Extract-Transform-Load）组件**，负责数据的采集、处理和输出。它就像一条数据流水线，把原始数据加工成可分析的格式。

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│    Input     │ →  │    Filter    │ →  │    Output    │
│  数据采集     │    │  数据处理    │    │  数据输出    │
└──────────────┘    └──────────────┘    └──────────────┘
```

## 核心概念

### Pipeline（管道）

Logstash 的工作单元，由 Input、Filter、Output 三部分组成：

```java
input {
  # 从哪里获取数据
  beats { port => 5044 }
  file { path => "/var/log/nginx/*.log" }
}

filter {
  # 如何处理数据
  json { source => "message" }
  date { match => ["timestamp", "ISO8601"] }
  grok { match => ["message", "%{COMBINEDAPACHELOG}"] }
}

output {
  # 发送到哪里
  elasticsearch { hosts => ["http://localhost:9200"] }
}
```

### 事件处理

Logstash 中的数据以 **Event** 的形式流转，本质上是一个 JSON 对象：

```java
{
  "@timestamp": "2024-01-15T10:00:00.000Z",
  "host": "web-server-01",
  "message": "GET /api/users HTTP/1.1 200 123ms",
  "level": "INFO",
  "service": "user-api"
}
```

## 适用场景

| 场景 | 说明 | 推荐配置 |
|-----|------|---------|
| 日志收集 | 收集多台服务器的日志 | Filebeat + Logstash |
| 数据同步 | 数据库定时同步到 ES | JDBC Input |
| 消息队列对接 | 消费 Kafka 数据 | Kafka Input |
| API 数据接入 | 接收外部系统推送 | HTTP Input |

## 文档导航

### 基础入门

- [Input 插件](/middleware/logstash/input)：File、Beats、JDBC、Kafka、HTTP
- [Filter 插件](/middleware/logstash/filter)：Grok、JSON、Date、Mutate
- [Pipeline 配置](/middleware/logstash/pipeline)：完整管道配置

### 进阶应用

- [多行处理](/middleware/logstash/multiline)：Java 堆栈、日志换行
- [性能优化](/middleware/logstash/performance)：队列、线程、内存调优
- [集群部署](/middleware/logstash/cluster)：多节点部署与协调

---

**留给你的问题**：

一个日志文件里有这样的内容：

```json
{"level": "ERROR", "msg": "NullPointerException\nat com.example.UserService.getUser(Unknown Source)"}
```

你会如何配置 Filter 来提取 `level`、`msg` 和堆栈信息？

这个问题涉及到 Grok 模式和 Multiline 的配合使用。
