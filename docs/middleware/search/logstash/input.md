# Logstash Input 插件：File、Beats、JDBC、Kafka、HTTP

Logstash 的 Input 阶段决定「**数据从哪里来**」。不同的数据源，需要选择不同的 Input 插件。

这一节我们来详细讲解常用的 Input 插件。

## 1. File Input：读取本地文件

File Input 是最常用的插件之一，用于读取日志文件。

### 1.1 基础配置

```java
input {
  file {
    # 文件路径，支持通配符
    path => "/var/log/nginx/access.log"

    # 从哪里开始读取
    # beginning：从头开始
    # end：从尾部开始（新追加的内容）
    start_position => "beginning"

    # 记录读取位置（避免重启后重复读取）
    sincedb_path => "/var/lib/logstash/sincedb/access.log"
  }
}
```

### 1.2 读取新文件的行为

```java
input {
  file {
    path => "/var/log/**/*.log"           # 通配符匹配多个文件
    type => "app-log"                     # 添加 type 字段标识来源
    discover_interval => 10               # 扫描新文件间隔（秒）
    stat_interval => 1                    # 检查文件变化间隔（秒）
  }
}
```

**工作原理：**

```
1. Logstash 启动时扫描所有匹配的文件
2. 检查 sincedb 记录的上次读取位置
3. 从上次位置继续读取新内容
4. 定期检查是否有新文件
5. 文件句柄长时间不活跃会自动关闭（close_older）
```

### 1.3 高级配置

```java
input {
  file {
    path => "/var/log/app.log"

    # 文件不活跃多久后关闭句柄
    close_older => "1h"

    # 读取模式
    # tail：追加模式，只读新内容（默认）
    # read：一次性读取整个文件
    mode => "tail"

    # 是否跟踪软链接
    follow_links => false

    # 忽略超过指定时间的文件变化（防止误读）
    ignore_older => "24h"

    # 文件编码
    codec => plain {
      charset => "UTF-8"
    }

    # 添加文件元数据
    add_field => {
      "log_source" => "app-server-01"
    }
  }
}
```

### 1.4 常见问题

```java
# 问题一：文件被 logrotate 轮转后重复读取
# 解决：设置 close_older 和 ignore_older

input {
  file {
    path => "/var/log/app.log"
    close_older => "1h"
    ignore_older => "24h"
  }
}

# 问题二：sincedb 文件损坏导致重复读取
# 解决：删除 sincedb 文件或设为 /dev/null（测试环境）
sincedb_path => "/dev/null"
```

## 2. Beats Input：接收 Beats 数据

Beats 是轻量级数据采集器，Filebeat、Metricbeat 等通过 Beats Input 发送数据给 Logstash。

### 2.1 基础配置

```java
input {
  beats {
    port => 5044
    host => "0.0.0.0"
  }
}
```

### 2.2 SSL/TLS 配置（生产环境推荐）

```java
input {
  beats {
    port => 5044
    host => "0.0.0.0"

    # SSL 配置
    ssl => true
    ssl_certificate => "/etc/logstash/ssl/logstash.crt"
    ssl_key => "/etc/logstash/ssl/logstash.key"

    # 可选：客户端证书验证
    ssl_certificate_verification => true
    ssl_client_authentication => "required"    # none, optional, required
    ssl_ca_cert => "/etc/logstash/ssl/ca.crt"
  }
}
```

### 2.3 与 Filebeat 的配合

Filebeat 端配置：

```java
# filebeat.yml
filebeat.inputs:
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log

output.logstash:
  hosts: ["logstash:5044"]
  ssl.enabled: true
  ssl.certificate_authorities: ["/etc/filebeat/ca.crt"]
  ssl.certificate: "/etc/filebeat/filebeat.crt"
  ssl.key: "/etc/filebeat/filebeat.key"
```

## 3. HTTP Input：接收 HTTP 请求

HTTP Input 允许通过 HTTP POST 发送数据到 Logstash。

### 3.1 基础配置

```java
input {
  http {
    port => 8080

    # 可以指定多个端口
    # port => [8080, 8081]

    # 远程地址字段
    remote_host_target_field => "client_ip"

    # 请求方法
    # methods => ["POST", "GET"]

    # 响应内容
    response_code => 200
    response_body => '{"status": "ok"}'
  }
}
```

### 3.2 认证配置

```java
input {
  http {
    port => 8080

    # HTTP Basic 认证
    user => "logstash"
    password => "secret"

    # 或者使用第三方认证
    # rocks_authorization => true
  }
}
```

### 3.3 测试

```bash
# 发送 JSON 数据
curl -X POST "http://localhost:8080" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Hello from HTTP",
    "level": "info",
    "timestamp": "2024-01-15T10:00:00Z"
  }'

# 使用 HTTP Basic 认证
curl -X POST "http://localhost:8080" \
  -u "logstash:secret" \
  -d '{"message": "test"}'
```

## 4. JDBC Input：读取数据库

JDBC Input 定期执行 SQL 查询，将结果写入 Pipeline。

### 4.1 基础配置

```java
input {
  jdbc {
    # 数据库连接
    jdbc_driver_library => "/etc/logstash/driver/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog?useSSL=false&serverTimezone=UTC"
    jdbc_user => "root"
    jdbc_password => "password"

    # SQL 查询
    statement => "SELECT id, title, author, created_at as createdAt FROM blog"

    # 或者使用参数化查询
    statement => "SELECT * FROM blog WHERE updated_at > :sql_last_value ORDER BY updated_at"
  }
}
```

### 4.2 增量同步配置

```java
input {
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog"
    jdbc_user => "root"
    jdbc_password => "password"

    # 增量同步：记录上次查询的位置
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"

    # 记录位置的文件
    last_run_metadata_path => "/var/lib/logstash/jdbc_last_run"

    # SQL 语句中使用 :sql_last_value
    statement => "SELECT * FROM blog WHERE updated_at > :sql_last_value"

    # 调度：每 5 分钟执行一次
    schedule => "*/5 * * * *"

    # 清理带时间戳的列
    clean_run => false
  }
}
```

### 4.3 多个数据源

```java
input {
  # 用户数据
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/blog"
    jdbc_user => "root"
    jdbc_password => "password"
    statement => "SELECT * FROM users WHERE updated_at > :sql_last_value"
    schedule => "*/5 * * * *"
    last_run_metadata_path => "/var/lib/logstash/jdbc_last_run_users"
    tags => ["users"]
  }

  # 订单数据
  jdbc {
    jdbc_driver_library => "/path/to/mysql-connector-java.jar"
    jdbc_driver_class => "com.mysql.cj.jdbc.Driver"
    jdbc_connection_string => "jdbc:mysql://mysql:3306/orders"
    jdbc_user => "root"
    jdbc_password => "password"
    statement => "SELECT * FROM orders WHERE updated_at > :sql_last_value"
    schedule => "*/10 * * * *"
    last_run_metadata_path => "/var/lib/logstash/jdbc_last_run_orders"
    tags => ["orders"]
  }
}
```

### 4.4 PostgreSQL 示例

```java
input {
  jdbc {
    jdbc_driver_library => "/path/to/postgresql.jar"
    jdbc_driver_class => "org.postgresql.Driver"
    jdbc_connection_string => "jdbc:postgresql://postgres:5432/blog"
    jdbc_user => "postgres"
    jdbc_password => "password"

    statement => "SELECT * FROM articles WHERE updated_at > :sql_last_value"
    use_column_value => true
    tracking_column => "updated_at"
    tracking_column_type => "timestamp"
    schedule => "*/5 * * * *"
  }
}
```

## 5. Kafka Input：从 Kafka 消费

Kafka Input 从 Kafka 集群消费消息。

### 5.1 基础配置

```java
input {
  kafka {
    bootstrap_servers => "kafka1:9092,kafka2:9092,kafka3:9092"
    topics => ["app-logs", "access-logs"]
    group_id => "logstash-consumer-group"

    # 消费者线程数
    consumer_threads => 4

    # 消费者配置
    auto_offset_reset => "earliest"    # earliest：从头；latest：从最新开始
    enable_auto_commit => true
    auto_commit_interval_ms => 5000

    # Codec
    codec => "json"

    # 添加元数据字段
    add_field => {
      "consumer_group" => "logstash-consumer-group"
    }
  }
}
```

### 5.2 高级配置

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["logs"]
    group_id => "logstash"

    # Offset 管理
    auto_offset_reset => "earliest"
    offset_reset => "earliest"           # 兼容旧版本

    # 手动提交（更可靠）
    enable_auto_commit => false

    # 序列化
    key_deserializer_class => "org.apache.kafka.common.serialization.StringDeserializer"
    value_deserializer_class => "org.apache.kafka.common.serialization.StringDeserializer"

    # 安全配置
    security_protocol => "PLAINTEXT"      # PLAINTEXT, SSL, SASL_PLAINTEXT, SASL_SSL
    # ssl_endpoint_identification_algorithm => "https"
    # ssl_ca_cert => "/path/to/ca.crt"

    # 分区发现
    metadata_max_age_ms => 30000
    group_instance_id => "%{host}-logstash"
  }
}
```

### 5.3 消费多个 Topic

```java
input {
  kafka {
    bootstrap_servers => "kafka:9092"

    # 方式一：数组形式
    topics => ["topic-a", "topic-b", "topic-c"]

    # 方式二：使用 topic_pattern
    topics_pattern => "logs-.*"

    # 添加 topic 名称字段
    add_field => {
      "[@metadata][kafka_topic]" => "%{[@metadata][kafka_topic_name]}"
    }
  }
}
```

## 6. 插件对比

| 插件 | 适用场景 | 实时性 | 复杂度 |
|-----|---------|--------|--------|
| file | 收集本地日志文件 | 准实时 | 低 |
| beats | 接收 Filebeat 数据 | 准实时 | 低 |
| http | 接收外部系统推送 | 实时 | 低 |
| jdbc | 同步数据库数据 | 定时 | 中 |
| kafka | 从消息队列消费 | 实时 | 中 |

## 7. 组合使用

一个 Pipeline 可以同时使用多个 Input：

```java
input {
  # 接收本地日志
  file {
    path => "/var/log/nginx/access.log"
    type => "nginx-access"
  }

  # 接收 Filebeat 数据
  beats {
    port => 5044
    type => "filebeat"
  }

  # 接收 HTTP 请求
  http {
    port => 8080
    type => "http-api"
  }

  # 消费 Kafka
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["app-logs"]
    type => "kafka"
  }
}

filter {
  # 根据 type 分别处理
  if [type] == "nginx-access" {
    grok {
      match => { "message" => "%{COMBINEDAPACHELOG}" }
    }
  } else if [type] == "filebeat" {
    json {
      source => "message"
    }
  }
}

output {
  elasticsearch {
    hosts => ["http://localhost:9200"]
    index => "logs-%{type}-%{+YYYY.MM.dd}"
  }
}
```

## 8. 性能调优

### 8.1 输入性能优化

```java
input {
  file {
    path => "/var/log/**/*.log"

    # 增加管道 workers 数（需要配合 pipeline.workers）
    pipeline workers => 4

    # 增加批量大小
    pipeline.batch.size => 500
  }
}
```

### 8.2 线程模型

```
Logstash 线程模型：

Main 线程 ──┬── Pipeline.1 线程 ──┬── Input 线程
           │                     ├── Filter 线程
           │                     └── Output 线程
           │
           ├── Pipeline.2 线程 ── ...
           │
           └── Pipeline.3 线程 ── ...
```

## 总结

Input 插件的选择原则：

1. **数据在哪里，就用什么 Input**
2. **本地文件 → file Input**
3. **Beats 采集 → beats Input**
4. **外部推送 → http Input**
5. **数据库同步 → jdbc Input**
6. **消息队列 → kafka Input**

---

**留给你的问题**：

假设你有以下数据源需要接入 Logstash：

1. 应用日志（文件）
2. 监控指标（HTTP API）
3. 业务数据（MySQL 数据库）
4. 第三方系统日志（Kafka）

你会如何设计 Input 配置？每个数据源需要注意什么问题？

这个设计需要考虑实时性、数据量、数据一致性等因素。
