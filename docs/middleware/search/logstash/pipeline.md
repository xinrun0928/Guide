# Logstash 工作流程：Input → Filter → Output 管道模型

如果说 Elasticsearch 是一个强大的搜索引擎，那 Logstash 就是它的「血管」——负责把各种数据输送到 ES 中。

Logstash 的设计理念非常简单：**数据进来，经过处理，出去**。这就是经典的 **Pipeline（管道）模型**。

## 1. Pipeline 架构概述

```
┌─────────────────────────────────────────────────────────────┐
│                    Logstash Pipeline                        │
│                                                               │
│   Input          Filter              Output                  │
│  ┌─────┐       ┌─────┐            ┌─────┐                  │
│  │     │  ═══  │     │  ═══════  │     │                  │
│  │     │       │     │            │     │                  │
│  └─────┘       └─────┘            └─────┘                  │
│     │             │                  │                       │
│     ▼             ▼                  ▼                       │
│  数据源        数据处理            数据目的地                  │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Pipeline 的三个阶段：**

| 阶段 | 作用 | 示例 |
|-----|------|------|
| **Input** | 数据从哪里来 | File、Beats、HTTP、Kafka |
| **Filter** | 数据如何处理 | 解析、转换、过滤、富化 |
| **Output** | 数据到哪里去 | Elasticsearch、File、Redis |

## 2. 第一个 Pipeline 配置

### 2.1 配置文件结构

```java
# logstash.conf

# 输入配置
input {
  file {
    path => "/var/log/nginx/access.log"
    start_position => "beginning"
    sincedb_path => "/dev/null"
  }
}

# 过滤配置
filter {
  grok {
    match => { "message" => "%{COMBINEDAPACHELOG}" }
  }
  date {
    match => [ "timestamp", "dd/MMM/yyyy:HH:mm:ss Z" ]
    target => "@timestamp"
  }
}

# 输出配置
output {
  elasticsearch {
    hosts => ["http://localhost:9200"]
    index => "nginx-logs-%{+YYYY.MM.dd}"
  }
  stdout { codec => rubydebug }
}
```

### 2.2 运行 Logstash

```bash
# 使用配置文件运行
bin/logstash -f logstash.conf

# 验证配置语法
bin/logstash -f logstash.conf --config.test_and_exit

# 自动重载配置（开发环境）
bin/logstash -f logstash.conf --config.reload.automatic
```

## 3. Input 插件详解

### 3.1 File Input

```java
input {
  file {
    # 基本配置
    path => "/var/log/**/*.log"      # 支持通配符
    start_position => "beginning"    # beginning：从头开始；end：从尾开始
    sincedb_path => "/var/lib/logstash/sincedb"

    # 高级配置
    discover_interval => 10           # 扫描新文件间隔（秒）
    stat_interval => 1               # 检查文件变化间隔（秒）
    close_older => "1h"              # 多久不活跃后关闭文件句柄
    mode => "tail"                   # tail：读新行；read：读整个文件
    codec => "json"                  # 解码器
  }
}
```

### 3.2 Beats Input

```java
# 接收来自 Filebeat、Metricbeat 等的数据
input {
  beats {
    port => 5044
    host => "0.0.0.0"

    # SSL 配置
    ssl => true
    ssl_certificate => "/etc/logstash/ssl/server.crt"
    ssl_key => "/etc/logstash/ssl/server.key"
  }
}
```

### 3.3 HTTP Input

```java
# 接收 HTTP 请求（POST 发送 JSON 数据）
input {
  http {
    port => 8080
    codec => "json"

    # 认证配置
    # user => "elastic"
    # password => "changeme"
  }
}

# 测试发送数据
curl -X POST -H "Content-Type: application/json" \
  -d '{"message": "hello", "level": "info"}' \
  http://localhost:8080
```

### 3.4 Kafka Input

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["app-logs", "access-logs"]
    group_id => "logstash-consumer-group"
    consumer_threads => 4

    # offset 管理
    auto_offset_reset => "earliest"    # earliest：从头；latest：从尾
    enable_auto_commit => true

    # Codec
    codec => "json"
  }
}
```

### 3.5 JDBC Input

```java
input {
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog"
    jdbc_user => "root"
    jdbc_password => "password"

    # SQL 语句
    statement => "SELECT * FROM blog WHERE updated_at > :sql_last_value"
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"
    last_run_metadata_path => "/var/lib/logstash/jdbc_last_run"

    # 调度
    schedule => "*/5 * * * *"    # Cron 表达式
  }
}
```

## 4. Filter 插件详解

### 4.1 Grok 插件（正则解析）

Grok 是 Logstash 最强大的插件，用于解析非结构化日志。

```java
filter {
  grok {
    # 方式一：使用内置模式
    match => { "message" => "%{IP:client_ip} %{USER:ident} %{USER:auth} \[%{HTTPDATE:timestamp}\] \"%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}\" %{NUMBER:status:int} %{NUMBER:bytes:int}" }

    # 方式二：使用自定义模式
    patterns_dir => ["./patterns"]
    match => { "message" => "%{MY_PATTERN:field_name}" }
  }

  # 移除不需要的字段
  mutate {
    remove_field => ["message", "host"]
  }

  # 添加字段
  mutate {
    add_field => {
      "environment" => "production"
      "[@metadata][index_prefix]" => "app"
    }
  }
}
```

**常用内置模式：**

| 模式 | 说明 | 示例 |
|-----|------|------|
| IP | IP 地址 | 192.168.1.1 |
| WORD | 单词 | hello |
| NUMBER | 数字 | 123 |
| TIMESTAMP_ISO8601 | ISO8601 时间 | 2024-01-01T00:00:00Z |
| HTTPDATE | HTTP 日期 | 01/Jan/2024:00:00:00 +0000 |
| URI | URI | /api/users?id=1 |
| QS | 查询字符串 | name=John&age=30 |
| COMBINEDAPACHELOG | Apache 组合日志 | 标准 Apache 格式 |

### 4.2 JSON 插件

```java
filter {
  # 解析 JSON 字符串
  json {
    source => "message"
    target => "parsed"          # 解析结果放到 parsed 字段
  }

  # 如果已经是 JSON，可以直接获取字段
  mutate {
    add_field => {
      "user_id" => "%{[parsed][user][id]}"
    }
  }
}
```

### 4.3 Date 插件

```java
filter {
  date {
    # 从日志中提取时间作为 @timestamp
    match => ["timestamp", "dd/MMM/yyyy:HH:mm:ss Z", "ISO8601"]
    target => "@timestamp"

    # 时区转换
    timezone => "Asia/Shanghai"
  }
}
```

### 4.4 Mutate 插件

```java
filter {
  mutate {
    # 重命名字段
    rename => {
      "HTTP_STATUS" => "status"
      "request_time" => "duration"
    }

    # 转换类型
    convert => {
      "status" => "integer"
      "bytes" => "integer"
      "duration" => "float"
    }

    # 分割字符串
    split => { "field" => "client_ips" }
    split => { "field" => "tags", separator => "," }

    # 替换/更新
    update => { "status" => "200" }
    replace => { "message" => "%{message} - Updated" }

    # 移除字段
    remove_field => ["raw_message", "temp_field"]
  }
}
```

### 4.5 GeoIP 插件

```java
filter {
  geoip {
    source => "client_ip"
    target => "geoip"

    # 不需要的字段不添加
    add_tag => ["geoip"]

    # 数据库路径（可选）
    # database => "/etc/logstash/GeoLite2-City.mmdb"
  }
}

# 输出字段示例：
# {
#   "geoip": {
#     "city_name": "Beijing",
#     "country_name": "China",
#     "region_name": "Beijing",
#     "location": { "lat": 39.9042, "lon": 116.4074 }
#   }
# }
```

### 4.6 Useragent 插件

```java
filter {
  useragent {
    source => "user_agent"
    target => "ua"

    # 示例输出：
    # {
    #   "ua": {
    #     "name": "Chrome",
    #     "os": "Windows 10",
    #     "os_name": "Windows",
    #     "device": "Other",
    #     "major": "120",
    #     "minor": "0"
    #   }
    # }
  }
}
```

## 5. Output 插件详解

### 5.1 Elasticsearch Output

```java
output {
  elasticsearch {
    # 基本配置
    hosts => ["http://localhost:9200"]
    index => "myapp-logs-%{+YYYY.MM.dd}"

    # 认证
    user => "elastic"
    password => "changeme"

    # 模板管理
    manage_template => true
    template_name => "myapp"
    template_overwrite => true

    # 文档 ID（用于幂等写入）
    document_id => "%{uuid}"

    # 批量写入优化
    workers => 2
    flush_size => 5000
    idle_flush_time => 1

    # 死信队列
    dlq_codec_retry_max => 3
  }
}
```

### 5.2 File Output

```java
output {
  # 写入文件
  file {
    path => "/var/log/logstash/output-%{+YYYY-MM-dd}.log"
    codec => "json_lines"

    # 写入模式
    write_behavior => "append"
  }

  # 同时输出到 stdout
  stdout {
    codec => "rubydebug"
  }
}
```

### 5.3 Kafka Output

```java
output {
  kafka {
    bootstrap_servers => "kafka:9092"
    topic_id => "processed-logs"

    # 消息格式
    codec => "json"

    # 分区策略
    partition => "%{[@metadata][partition_field]}"
    key => "%{uuid}"

    # acks 配置
    acks => "all"
  }
}
```

## 6. 多 Pipeline 配置

```java
# pipelines.yml
- pipeline.id: main
  path.config: "/etc/logstash/conf.d/main.conf"
  pipeline.workers: 4
  pipeline.batch.size: 500

- pipeline.id: slow-logs
  path.config: "/etc/logstash/conf.d/slow.conf"
  pipeline.workers: 2
  queue.type: persisted

- pipeline.id: metrics
  path.config: "/etc/logstash/conf.d/metrics.conf"
  pipeline.workers: 1
```

## 7. 队列与可靠性

### 7.1 内存队列 vs 持久化队列

```yaml
# logstash.yml
queue.type: memory    # 内存队列（默认）
queue.type: persisted # 持久化队列（保证数据不丢失）
```

### 7.2 持久化队列配置

```yaml
queue.type: persisted
queue.max_bytes: 1gb           # 队列最大存储
queue.checkpoint.writes: 1024  # 写入多少次后 checkpoint
queue.page_capacity: 64mb      # 页面大小
```

## 8. 监控与调试

### 8.1 查看 Pipeline 状态

```bash
# 查看节点信息
curl -X GET "localhost:9600/_node/stats?pretty"

# 查看 Pipeline 信息
curl -X GET "localhost:9600/_node/pipeline?pretty"
```

### 8.2 调试技巧

```bash
# 使用 --log.level 调整日志级别
bin/logstash -f logstash.conf --log.level debug

# 使用 stdin input 测试
bin/logstash -e 'input { stdin { } } output { stdout { codec => rubydebug } }'

# 使用配置测试（不实际运行）
bin/logstash -f logstash.conf --config.test_and_exit
```

## 总结

Logstash Pipeline 的核心概念：

1. **Input**：数据源（File、Beats、HTTP、Kafka、Jdbc）
2. **Filter**：数据处理（Grok、JSON、Date、Mutate、GeoIP）
3. **Output**：数据目的地（Elasticsearch、File、Kafka）

Logstash 的强大之处在于插件生态——丰富的插件让它能处理各种数据源和数据格式。

---

**留给你的问题**：

假设你要收集一个 Java 应用的日志，日志格式如下：

```
2024-01-15 10:30:45 INFO [pool-2-thread-1] c.u.s.UserService - User login: userId=12345, ip=192.168.1.100
```

你会如何编写 Logstash 配置来解析这个日志？需要提取哪些字段？

这个配置会用到 grok、date、mutate 等多个插件。
