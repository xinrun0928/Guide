# Filebeat 轻量级日志采集：Prospector、Harvester、多行日志处理

如果说 Logstash 是一个强大的数据处理工厂，那 Filebeat 就是一位不知疲倦的「搬运工」——它轻量、快速、可靠，专门负责把日志从服务器搬到 Logstash 或 ES。

## 1. Filebeat 简介

### 1.1 什么是 Filebeat？

Filebeat 是 Elastic 官方提供的轻量级日志采集器，它的特点是：

- **轻量级**：资源消耗极低
- **可靠**：内置重试和缓冲机制
- **简单**：配置简单，部署容易
- **可观察**：内置监控和调试工具

### 1.2 Filebeat vs Logstash

```
┌─────────────────────────────────────────────────────────────┐
│              Filebeat vs Logstash                          │
│                                                               │
│   Filebeat                     Logstash                       │
│   ┌──────────────┐            ┌──────────────┐             │
│   │ 轻量级采集  │            │ 重量级处理  │             │
│   │ 资源占用低  │            │ 资源占用高   │             │
│   │ 采集+发送   │    →→→    │ 采集+处理+输出│             │
│   └──────────────┘            └──────────────┘             │
│                                                               │
│   Filebeat 适合：          Logstash 适合：                  │
│   ✓ 日志采集              ✓ 复杂数据转换                   │
│   ✓ 多行日志处理          ✓ 多数据源聚合                   │
│   ✓ 轻量级部署            ✓ 高级分析                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 2. 核心概念

### 2.1 Prospector（勘探者）

Prospector 负责「找到」要采集的文件。

```java
# filebeat.yml
filebeat.inputs:
  # 方式一：直接配置
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/*.log

  # 方式二：使用 glob 模式
  - type: log
    enabled: true
    paths:
      - /var/log/**/*.log      # 递归匹配
      - /var/log/*.log         # 单层匹配
```

### 2.2 Harvester（收割者）

Harvester 负责「读取」文件内容。每个文件对应一个 Harvester。

```
文件 → Harvester（读取） → 缓存 → 发送
```

**Harvester 的工作流程：**

```
1. 打开文件
2. 按行读取
3. 发送到 output
4. 记录读取位置
5. 等待新内容
6. 重复 2-5
```

### 2.3 内部队列

Filebeat 内置了一个小队列，用于缓冲和重试：

```
Harvester → Queue → Output (Logstash/ES)
            ↑          ↓
            └── 重试 ◀─┘
```

## 3. 配置详解

### 3.1 基础配置

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    # 添加额外字段
    fields:
      environment: production
      service: nginx
    fields_under_root: true    # 字段放在根级别

# 输出配置
output.logstash:
  hosts: ["logstash:5044"]

# 进程配置
filebeat.config.inputs:
  enabled: true
  path: /etc/filebeat/conf.d/*.yml
```

### 3.2 多数据源配置

```java
# 采集多种日志
filebeat.inputs:
  # Nginx 访问日志
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      log_type: nginx_access
    multiline:
      pattern: '^\d{4}-\d{2}-\d{2}'
      negate: true
      match: after

  # 应用日志
  - type: log
    enabled: true
    paths:
      - /var/log/app/*.log
    fields:
      log_type: application
    multiline:
      pattern: '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'
      negate: true
      match: after

  # 系统日志
  - type: log
    enabled: true
    paths:
      - /var/log/syslog
    fields:
      log_type: system
```

### 3.3 Registry（注册表）

Filebeat 使用 Registry 记录文件读取位置：

```java
# Registry 配置
filebeat.inputs:
  - type: log
    paths:
      - /var/log/app/*.log
    # Registry 文件位置
    registry_file: /var/lib/filebeat/registry
    # 清理已删除文件记录
    clean_removed: true
    # 忽略旧文件的时间
    ignore_older: 24h
```

## 4. 多行日志处理

多行日志是日志采集的难点，Filebeat 内置了 multiline 配置。

### 4.1 基本配置

```java
# 采集 Java 堆栈日志
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/application.log
    multiline:
      # 匹配新日志的开始（时间戳开头）
      pattern: '^\d{4}-\d{2}-\d{2}'
      negate: true
      match: after      # 与上一行合并
```

### 4.2 模式解释

```
pattern: '^%{TIMESTAMP_ISO8601}'
negate: true
match: after

含义：
- pattern: 匹配时间戳开头的行
- negate: true 表示取反，即「不以时间戳开头的行」
- match: after 表示合并到上一行

执行效果：
┌────────────────────────────────────────────┐
│ 2024-01-15 10:00:00 INFO 开始了     ← 开始 │
│ 这是日志内容                              │
│ 这是更多内容                              │
│ at com.example.Service.run(Service.java:10)│
│ ← 以上所有行都与第一行合并                │
│                                            │
│ 2024-01-15 10:00:01 INFO 完成了   ← 新的开始│
└────────────────────────────────────────────┘
```

### 4.3 常见模式

**Java 堆栈异常：**

```java
multiline:
  pattern: '^[[:space:]]+(at|Caused by:|...)|^Exception'
  negate: false
  match: after
```

**Python 错误：**

```java
multiline:
  pattern: '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}'
  negate: true
  match: after
```

**XML 格式：**

```java
multiline:
  pattern: '^<\\?xml'
  negate: true
  match: after
```

## 5. 数据处理

### 5.1 Processors

Filebeat 支持在发送前处理数据：

```java
# 添加元信息
processors:
  - add_host_metadata:
      when.not.contains.tags: forwarded
  - add_cloud_metadata: ~
  - add_docker_metadata: ~
  - add_kubernetes_metadata: ~

# 字段操作
processors:
  - rename:
      fields:
        - from: "host"
          to: "server.name"
      ignore_missing: false
      fail_on_error: true

  # 删除字段
  - drop_fields:
      fields: ["log.offset", "agent.version"]
      ignore_missing: true

  # 条件过滤
  - drop_event:
      when:
        regexp:
          message: "^DBG:"

  # 添加字段
  - add_fields:
      target: ''
      fields:
        environment: production
        version: 1.0.0
```

### 5.2 常用 Processors

```java
# 解析 JSON
processors:
  - decode_json_fields:
      fields: ["message"]
      target: ""
      overwrite_keys: true
      add_error_key: true

# 添加时间戳
processors:
  - timestamp:
      field: message
      layouts:
        - '2006-01-02T15:04:05Z07:00'
        - '2006-01-02 15:04:05'
      test:
        - '2024-01-15T10:00:00Z'

# DNS 反向解析
processors:
  - dns:
      fields:
        source.ip: source.hostname
      type: reverse
```

## 6. 输出配置

### 6.1 输出到 Logstash

```java
# filebeat.yml
output.logstash:
  hosts: ["logstash1:5044", "logstash2:5044", "logstash3:5044"]
  # 负载均衡
  loadbalance: true
  # 重试配置
  backoff.init: 1s
  backoff.max: 60s
  # SSL 配置
  ssl.enabled: true
  ssl.certificate_authorities: ["/etc/filebeat/ca.crt"]
  ssl.certificate: "/etc/filebeat/filebeat.crt"
  ssl.key: "/etc/filebeat/filebeat.key"
```

### 6.2 输出到 Elasticsearch

```java
# 直连 ES（不经过 Logstash）
output.elasticsearch:
  hosts: ["es1:9200", "es2:9200", "es3:9200"]
  index: "logs-%{+yyyy.MM.dd}"
  # 索引模板
  setup.template.enabled: true
  setup.template.name: "filebeat"
  setup.template.pattern: "filebeat-*"
  # ILM 配置
  ilm.enabled: true
  ilm.rollover_alias: "filebeat"
  ilm.pattern: "{now/d}-000001"
  ilm.policy_name: "filebeat-policy"
```

### 6.3 输出到 Kafka

```java
output.kafka:
  hosts: ["kafka1:9092", "kafka2:9092", "kafka3:9092"]
  topic: "logs-%{[fields.log_type]}"
  # 分区键
  key: "%{[fields.log_type]}-%{[host.name]}"
  # 序列化
  codec.json:
    include_rtt: false
  # acks 配置
  required_acks: 1
```

## 7. 可靠性配置

### 7.1 发送保证

```java
# 确保至少发送成功一次
filebeat.inputs:
  - type: log
    paths:
      - /var/log/app/*.log
    # 发货单模式
    harvester_buffer_size: 16384

output:
  # 批量发送
  bulk_max_size: 2048
  # 超时配置
  timeout: 90
  # 重试配置
  max_retries: 3
```

### 7.2 持久化队列

```java
# Filebeat 7.13+ 内置持久化队列
filebeat.inputs:
  - type: log
    paths:
      - /var/log/app/*.log

queue:
  type: persisted
  path: /var/lib/filebeat/queue
  size: 4096
  page_capacity: 256
```

### 7.3 死信队列

```java
# 配置死信队列
output.elasticsearch:
  hosts: ["es:9200"]
  bulk_max_size: 50
  # 死信配置
  dead_letter:
    enabled: true
    path: /var/lib/filebeat/dead_letter
    max_bytes: 10485760  # 10MB
```

## 8. 性能调优

### 8.1 资源限制

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    paths:
      - /var/log/**/*.log
    # Harvester 数量限制
    close_inactive: 5m
    # 扫描间隔
    scan_frequency: 10s
    # 文件句柄限制
    harvester_limit: 1024
```

### 8.2 内存配置

```java
# jvm.options
-Xms256m
-Xmx256m
```

### 8.3 并发配置

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/**/*.log
    # 单文件并发限制
    harvester_concurrency: 2
```

## 9. 监控与调试

### 9.1 调试模式

```bash
# 调试运行
filebeat -e -d "*"

# 只显示特定模块
filebeat -e -d "harvester"
```

### 9.2 测试配置

```bash
# 测试配置文件
filebeat test config -c filebeat.yml

# 测试输出连接
filebeat test output -c filebeat.yml
```

### 9.3 监控接口

```java
# 启用监控
monitoring:
  enabled: true
  elasticsearch:
    hosts: ["es:9200"]

# HTTP 接口
http.enabled: true
http.host: "localhost"
http.port: 5066
```

## 10. 常见问题

### Q1：文件被 logrotate 轮转后重复读取？

**答案**：配置 close_inactive 和 ignore_older。

```java
filebeat.inputs:
  - type: log
    close_inactive: 5m
    ignore_older: 24h
```

### Q2：日志丢失？

**答案**：
1. 检查 harvester 是否正常读取
2. 检查 output 是否正常发送
3. 启用持久化队列

### Q3：CPU 占用率高？

**答案**：
1. 减少 harvester_concurrency
2. 增大 close_inactive
3. 检查 multiline 配置

## 总结

Filebeat 的核心要点：

1. **Prospector**：找到要采集的文件
2. **Harvester**：读取文件内容
3. **Registry**：记录读取位置，保证不丢失
4. **Processors**：发送前处理数据
5. **多行处理**：multiline 配置

Filebeat 适合作为日志采集的第一站，轻量且可靠。

---

**留给你的问题**：

假设你负责采集一个 Java 微服务集群的日志，每个服务有多个实例，日志量约 50GB/天。

你会如何设计 Filebeat 部署方案？
- 每个节点一个 Filebeat？
- Filebeat 配置如何设计？
- 如何处理多行日志？
