# 日志聚合方案：ELK + Kafka 分流架构

多台服务器，多个服务，日志分散在各个节点上。

用户报错了，你需要在 10 台服务器的日志文件中搜索。

这就是日志聚合要解决的问题。

## 为什么需要日志聚合

```
server1:/var/log/app.log
server2:/var/log/app.log
server3:/var/log/app.log
...
```

问题：
1. **搜索困难**：需要登录到每台服务器搜索
2. **无法关联**：同一 TraceId 的日志在不同服务器上
3. **无法实时**：离线分析，无法实时监控

## ELK Stack 架构

```
日志文件 → Filebeat → Kafka → Logstash → Elasticsearch → Kibana
                                    ↑
                            可选：分流到不同 Topic
```

### Elasticsearch

搜索引擎，存储和检索日志：
- **分布式存储**：横向扩展
- **全文检索**：支持模糊搜索
- **聚合分析**：统计、报表

### Logstash

日志处理管道，收集、过滤、转发日志：
- **输入**：文件、TCP、Kafka
- **过滤**：JSON 解析、Grok 解析、字段提取
- **输出**：Elasticsearch、文件

### Kibana

可视化平台，查询和分析日志：
- **搜索**：DSL 查询
- **图表**：折线图、饼图
- **仪表盘**：多图表组合

## Kafka 在日志架构中的角色

### 为什么需要 Kafka

1. **解耦**：日志生产和消费解耦
2. **缓冲**：高峰期缓冲，防止 Elasticsearch 过载
3. **分流**：不同 Topic 分离不同类型日志

### Topic 设计

```yaml
# 不同类型日志
logs.application: 应用日志
logs.access: 访问日志
logs.error: 错误日志
logs.audit: 审计日志
```

## 日志采集工具选型

### Filebeat vs Logstash

| 对比 | Filebeat | Logstash |
|-----|----------|----------|
| 资源消耗 | 低 | 高 |
| 功能 | 轻量，只做采集 | 强大，采集+过滤+转换 |
| 配置 | 简单 | 复杂 |
| 适用场景 | 单纯采集 | 需要复杂处理 |

Filebeat 轻量高效，适合单纯采集；Logstash 功能强大，适合需要复杂处理的场景。

### Filebeat 配置

```yaml
filebeat.inputs:
  - type: log
    paths:
      - /var/log/app/*.log
    fields:
      service: app
      env: prod
    json.keys_under_root: true

output.kafka:
  hosts: ["kafka:9092"]
  topic: "logs.application"
```

### Logstash 配置

```ruby
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs.application"]
    group_id => "logstash-consumer"
    codec => json
  }
}

filter {
  # JSON 解析
  json {
    source => "message"
    target => "parsed"
  }

  # 时间戳处理
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }

  # 字段提取
  grok {
    match => ["message", "%{TIMESTAMP_ISO8601:logTime} %{LOGLEVEL:level} %{JAVACLASS:class} - %{GREEDYDATA:content}"]
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
  }
}
```

## 日志格式规范

### JSON 格式日志

```java
@Slf4j
public class JsonLogger {

    public static void info(String message, Map&lt;String, Object&gt; data) {
        Map&lt;String, Object&gt; log = new HashMap&lt;&gt;();
        log.put("timestamp", Instant.now().toString());
        log.put("level", "INFO");
        log.put("service", "order-service");
        log.put("traceId", MDC.get("traceId"));
        log.put("message", message);
        log.put("data", data);

        log.info(JSON.toJSONString(log));
    }
}
```

### 必须包含的字段

- timestamp: 日志时间
- level: 日志级别
- traceId: 链路追踪 ID
- serviceName: 服务名
- message: 日志内容

### Logback JSON 配置

```xml
<configuration>
    <appender name="JSON_CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="net.logstash.logback.encoder.LogstashEncoder">
            <customFields>{"service":"order-service"}</customFields>
            <includeMdcKeyName>traceId</includeMdcKeyName>
        </encoder>
    </appender>
</configuration>
```

## 面试追问方向

- Filebeat 和 Logstash 的区别？（答：Filebeat 轻量只做采集，Logstash 功能强大可以做过滤转换）
- Kafka 在日志架构中的作用？（答：解耦、缓冲、分流）
- 如何设计日志 Topic？（答：按日志类型分、便于消费和查询）
- ELK 架构有哪些瓶颈？（答：Elasticsearch 写入性能、Kibana 查询性能）

## 小结

日志聚合是分布式系统的基础设施：

1. **ELK Stack**：Elasticsearch + Logstash + Kibana
2. **Kafka 解耦**：日志生产和消费分离
3. **分流设计**：不同 Topic 分离不同类型日志
4. **格式规范**：JSON 格式，必含字段统一
