# ELK + Kafka 组合：日志收集→缓冲→消费的架构设计

当你的系统每天产生 TB 级日志时，直接从 Beats 到 ES 的架构可能扛不住。Kafka 就是那个「缓冲带」，让你的日志系统在流量高峰时稳如老狗。

## 1. 为什么需要 Kafka？

### 1.1 问题场景

```
不用 Kafka 的问题：

流量高峰：
┌──────────────────────────────────────────────┐
│ 日志量      ████                    ▲          │
│            ██████        ████     ▲▲▲        │
│           ████████      ██████   ▲▲▲▲▲       │
│          ██████████    ███████ ▲▲▲▲▲▲▲      │
│──────────────────────────────────────────────│
│            0        10        20   时间(天)  │
└──────────────────────────────────────────────┘

Logstash 处理能力有限，流量高峰时：
├─ 消息堆积
├─ 数据延迟
└─ 甚至丢消息
```

### 1.2 Kafka 的价值

```
Kafka 作为缓冲：

┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ Beats   │ → │ Kafka   │ → │Logstash │ → │   ES    │
│ (生产者) │    │ (缓冲)  │    │ (消费者) │    │ (存储)  │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
                    ↑
                    │
              吸收突发流量
              削峰填谷
```

**Kafka 的核心优势：**

| 优势 | 说明 |
|-----|------|
| **缓冲** | 吸收突发流量，平滑处理 |
| **解耦** | 生产者和消费者独立扩展 |
| **可靠** | 消息持久化，保证不丢失 |
| **扩展** | 可以水平扩展消费者 |

## 2. 架构设计

### 2.1 基础架构

```
┌─────────────────────────────────────────────────────────────────┐
│                   ELK + Kafka 架构                               │
│                                                                   │
│   日志源                                                        │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                     │
│   │ App Log  │  │ Nginx    │  │ Sys Log  │                     │
│   └─────┬────┘  └─────┬────┘  └─────┬────┘                     │
│         │              │              │                          │
│         └──────┬───────┴───────┬──────┘                          │
│                │               │                                  │
│          ┌─────▼─────┐  ┌─────▼─────┐                        │
│          │  Filebeat  │  │ Metricbeat │                        │
│          └─────┬─────┘  └─────┬─────┘                        │
│                │               │                                  │
│                └───────┬───────┘                                  │
│                        │                                          │
│                  ┌─────▼─────┐                                    │
│                  │   Kafka   │  ← 消息队列                        │
│                  │  (集群)    │                                    │
│                  └─────┬─────┘                                    │
│                        │                                          │
│                  ┌─────▼─────┐                                    │
│                  │  Logstash │  ← 消费者组                       │
│                  │  (集群)    │                                    │
│                  └─────┬─────┘                                    │
│                        │                                          │
│                  ┌─────▼─────┐                                    │
│                  │Elasticsearch│                                   │
│                  │  (集群)    │                                    │
│                  └─────┬─────┘                                    │
│                        │                                          │
│                  ┌─────▼─────┐                                    │
│                  │  Kibana    │                                    │
│                  └────────────┘                                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 多消费者架构

```
Kafka Topic: logs

Partition 0 ──┬──→ Logstash Consumer 1 (索引服务)
             │
Partition 1 ─┼──→ Logstash Consumer 2 (实时分析)
             │
Partition 2 ─┼──→ Logstash Consumer 3 (归档)
             │
Partition 3 ─┴──→ Logstash Consumer 4 (安全分析)
```

## 3. Kafka 配置

### 3.1 Topic 设计

```bash
# 创建 Topic
kafka-topics.sh --create \
  --bootstrap-server kafka1:9092 \
  --topic logs \
  --partitions 12 \
  --replication-factor 2 \
  --config retention.ms=604800000 \
  --config max.message.bytes=10485760

# Topic 列表
kafka-topics.sh --list --bootstrap-server kafka1:9092

# 查看 Topic 详情
kafka-topics.sh --describe \
  --topic logs \
  --bootstrap-server kafka1:9092
```

### 3.2 分区策略

```java
# Filebeat 端配置
output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092", "kafka3:9092"]
  topic: "logs-%{[fields.log_type]}"
  # 分区键：保证同一类型日志到同一分区
  key: "%{[fields.log_type]}"
  # 或按主机名分区
  key: "%{[host.name]}"
```

### 3.3 消费者组配置

```bash
# 创建消费者组
kafka-consumer-groups.sh --create \
  --bootstrap-server kafka1:9092 \
  --group logstash-indexer \
  --topic logs

# 查看消费者组
kafka-consumer-groups.sh --list --bootstrap-server kafka1:9092

# 消费者组详情
kafka-consumer-groups.sh --describe \
  --group logstash-indexer \
  --bootstrap-server kafka1:9092
```

## 4. Filebeat 配置

### 4.1 Kafka 输出配置

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/**/*.log
    fields:
      log_type: application

output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092", "kafka3:9092"]
  topic: "logs-%{[fields.log_type]:application}"
  partition.round_robin:
    reachable_only: false
  # 分区键
  key: "%{[host.name]}"
  # 压缩
  compression: lz4
  # acks
  required_acks: 1
  # 批量配置
  bulk_max_size: 2048
```

### 4.2 可靠性配置

```java
output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092"]
  topic: "logs"
  # 失败重试
  max_message_bytes: 10485760
  backoff.init: 1s
  backoff.max: 60s
  # 确保发送成功
  timeout: 30s
  reconnect_on_error: true
```

## 5. Logstash 配置

### 5.1 Kafka Input 配置

```java
# logstash.conf
input {
  kafka {
    bootstrap_servers => "kafka1:9092,kafka2:9092,kafka3:9092"
    topics => ["logs-application", "logs-nginx", "logs-system"]
    group_id => "logstash-indexer"
    consumer_threads => 4
    # offset 管理
    auto_offset_reset => "earliest"
    enable_auto_commit => false
    # 拉取配置
    max_poll_records => 500
    fetch_min_bytes => 1
    fetch_max_wait => 500ms
    # 序列化
    codec => json
  }
}
```

### 5.2 处理 Pipeline

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]
    group_id => "logstash-indexer"
    auto_offset_reset => "earliest"
    enable_auto_commit => false
    consumer_threads => 8
  }
}

filter {
  # 解析日志格式
  if [fields][log_type] == "nginx" {
    grok {
      match => { "message" => "%{COMBINEDAPACHELOG}" }
    }
    date {
      match => ["timestamp", "dd/MMM/yyyy:HH:mm:ss Z"]
      target => "@timestamp"
    }
  } else if [fields][log_type] == "application" {
    grok {
      match => { "message" => "%{APP_LOG_PATTERN}" }
    }
  }

  # GeoIP 富化
  geoip {
    source => "[nginx][client_ip]"
    target => "geoip"
  }

  # 字段转换
  mutate {
    convert => {
      "status" => "integer"
      "bytes" => "integer"
    }
  }
}

output {
  elasticsearch {
    hosts => ["es1:9200", "es2:9200", "es3:9200"]
    index => "logs-%{[fields][log_type]:unknown}-%{+YYYY.MM.dd}"
  }
}
```

### 5.3 多 Pipeline 配置

```yaml
# pipelines.yml
- pipeline.id: logs-indexer
  path.config: "/etc/logstash/conf.d/logs.conf"
  pipeline.workers: 4
  queue.type: persisted

- pipeline.id: metrics-indexer
  path.config: "/etc/logstash/conf.d/metrics.conf"
  pipeline.workers: 2
  queue.type: persisted
```

## 6. 可靠性设计

### 6.1 消息不丢失

```java
# Filebeat 确保消息不丢失
output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092"]
  topic: "logs"
  # 必须收到 ack 才认为发送成功
  required_acks: -1  # all
  # 失败重试
  retries: 3

# Logstash 确保消费不丢失
input {
  kafka {
    enable_auto_commit => false  # 手动提交 offset
  }
}

filter {
  # 处理完成后才提交 offset
}

output {
  elasticsearch {
    # 使用幂等写入
    action => "index"
  }
}
```

### 6.2 消费者容错

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    group_id => "logstash-indexer"
    # 消费者失败后重试
    reconnect_backoff_ms => 1000
    reconnect_backoff_max_ms => 30000
    # Session 超时
    session_timeout_ms => 30000
    heartbeat_interval_ms => 3000
  }
}
```

### 6.3 死信队列

```java
output {
  # 发送失败的消息到死信队列
  kafka {
    hosts => ["kafka:9092"]
    topic => "logs-dlq"
    # 只发送处理失败的消息
    exclude_tags => ["_jsonparsefailure"]
  }
}
```

## 7. 性能优化

### 7.1 Kafka 端优化

```bash
# Topic 配置
kafka-configs.sh --alter \
  --bootstrap-server kafka1:9092 \
  --topic logs \
  --add-config \
  retention.ms=604800000,\
  max.message.bytes=10485760,\
  segment.bytes=1073741824
```

### 7.2 Filebeat 端优化

```java
output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092", "kafka3:9092"]
  topic: "logs"
  # 批量发送
  bulk_max_size: 8192
  # 压缩
  compression: lz4
  # 序列化
  codec => json
```

### 7.3 Logstash 端优化

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]
    # 增加消费者线程
    consumer_threads => 8
    # 批量拉取
    max_poll_records => 1000
  }
}

filter {
  # 优化 Grok
  grok {
    match => { "message" => "%{PATTERN}" }
    break_on_match => false
  }
}

output {
  elasticsearch {
    hosts => ["es:9200"]
    # 批量写入
    workers => 4
    flush_size => 5000
    idle_flush_time => 1
  }
}
```

## 8. 监控指标

### 8.1 Kafka 监控

```bash
# 消费 lag
kafka-consumer-groups.sh --describe \
  --group logstash-indexer \
  --bootstrap-server kafka1:9092

# 输出示例：
# GROUP                TOPIC       PARTITION  CURRENT-OFFSET  LOG-END-OFFSET  LAG
# logstash-indexer    logs        0          1000            1200            200
# logstash-indexer    logs        1          950             1150            200
```

### 8.2 Logstash 监控

```bash
# 查看 Pipeline 状态
curl -X GET "localhost:9600/_node/stats/pipeline?pretty"

# 查看 Kafka 消费者状态
curl -X GET "localhost:9600/_node/stats?pretty" | jq '.pipelines.main.plugins.inputs'
```

### 8.3 告警配置

```java
# 消费 lag 告警
# Lag > 10000 时告警

# Logstash 队列堆积告警
# queue_size > queue.max_bytes * 0.8 时告警
```

## 9. 实际案例

### 9.1 电商平台案例

```
场景：日活 100 万，峰值 QPS 10 万
日志量：200GB/天
需求：实时分析、离线分析、安全分析

架构设计：
1. Kafka Topic 按业务拆分
   ├─ logs-access (访问日志)
   ├─ logs-business (业务日志)
   └─ logs-security (安全日志)

2. 消费者组
   ├─ logstash-indexer (索引)
   ├─ logstash-analytics (分析)
   └─ logstash-security (安全)

3. ES 索引设计
   ├─ logs-access-{date} (热)
   ├─ logs-business-{date} (热)
   └─ logs-security-{date} (冷)

配置：
Kafka: 9 节点，12 分区
Logstash: 6 节点，每节点 8 workers
ES: 12 节点（3 master + 9 data）
```

### 9.2 日志分类处理

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]
    group_id => "logstash-processor"
    consumer_threads => 16
  }
}

filter {
  if [fields][log_type] == "nginx" {
    grok { match => { "message" => "%{COMBINEDAPACHELOG}" } }
    mutate { add_field => { "[@metadata][index]" => "nginx" } }
  } else if [fields][log_type] == "application" {
    grok { match => { "message" => "%{APP_LOG_PATTERN}" } }
    mutate { add_field => { "[@metadata][index]" => "app" } }
  } else if [fields][log_type] == "mysql" {
    json { source => "message" }
    mutate { add_field => { "[@metadata][index]" => "mysql" } }
  } else {
    mutate { add_field => { "[@metadata][index]" => "unknown" } }
  }
}

output {
  elasticsearch {
    hosts => ["es:9200"]
    index => "logs-%{[@metadata][index]}-%{+YYYY.MM.dd}"
  }
}
```

## 10. 常见问题

### Q1：Kafka 消息乱序怎么办？

**答案**：同一分区的消息有序。如果需要严格有序，按同一 key 发到同一分区。

### Q2：消费者挂了怎么办？

**答案**：Kafka 自动 rebalance，其他消费者接管。配置 `enable.auto.commit=false`，手动提交 offset 保证不丢失。

### Q3：如何选择分区数？

**答案**：分区数 = 消费者数，最大并发数等于分区数。建议设置为消费者数的整数倍。

## 总结

ELK + Kafka 组合的核心要点：

1. **Kafka 作为缓冲**：吸收突发流量，平滑处理
2. **Topic 设计**：按业务或日志类型拆分
3. **消费者组**：实现并行消费和容错
4. **可靠性**：至少一次语义保证
5. **监控**：消费 lag 是关键指标

Kafka 是大规模日志系统不可或缺的组件。

---

**留给你的问题**：

假设你的公司从单体应用迁移到微服务架构，日志量从 50GB/天增长到 500GB/天。

当前架构会出现什么问题？你会如何设计 ELK + Kafka 架构？

需要考虑：
- Kafka 集群规模？
- Topic 如何设计？
- 消费者如何部署？
- 如何保证可靠性？
