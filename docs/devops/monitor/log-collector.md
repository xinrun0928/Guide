# 日志采集器：Fluent Bit、Fluentd、Logstash、Vector 对比

「该选哪个日志采集器？」——没有最好的，只有最合适的。

Fluent Bit、Fluentd、Logstash、Vector……每个采集器都有自己的定位和适用场景。选错了，轻则浪费资源，重则日志丢失。理解它们的设计哲学，才能做出正确的选择。

## 整体对比

| 维度 | Fluent Bit | Fluentd | Logstash | Vector |
|------|-----------|---------|----------|--------|
| 设计目标 | 边缘采集（轻量、快速） | 数据聚合（功能丰富） | ETL 处理（日志为主） | 高性能通用采集 |
| 语言 | C | Ruby | JRuby | Rust |
| 内存占用 | < 1MB | 100-200MB | 500MB+ | < 10MB |
| 吞吐量 | 极高（100k+ msg/s） | 中等（30k msg/s） | 较低（10k msg/s） | 极高（100k+ msg/s） |
| 插件生态 | 中等（60+） | 丰富（1000+） | 丰富（200+） | 中等（100+） |
| 配置语法 | INI/JSON | Ruby DSL | Ruby DSL | TOML/YAML |
| 缓冲支持 | 本地文件 | 内存/文件 | 内存/文件 | 本地磁盘 |
| K8s 集成 | 原生 DaemonSet | 需额外配置 | 需额外配置 | 原生 DaemonSet |
| 适用场景 | K8s 日志采集 | 日志聚合路由 | 日志 + ETL | 高性能/安全敏威 |
| 性能瓶颈 | 几乎无 | 正则表达式 | 正则表达式/JRuby | 几乎无 |

## Fluent Bit：K8s 日志采集首选

```
┌─────────────────────────────────────────────────────────────────┐
│                    Fluent Bit 架构                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Input (tail, cpu, disk, exec...)                          │  │
│  │  ↓                                                          │  │
│  │  Parser (JSON, regex, multiline...)                         │  │
│  │  ↓                                                          │  │
│  │  Filter (kubernetes, modify, grep, throttle...)             │  │
│  │  ↓                                                          │  │
│  │  Buffer (filesystem, memory)                               │  │
│  │  ↓                                                          │  │
│  │  Output (es, kafka, s3, forward, stdout...)                 │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### K8s 日志采集配置

```ini
# fluent-bit.conf
[SERVICE]
    Flush         5
    Log_Level     info
    Daemon        off
    Parsers_File  parsers.conf
    HTTP_Server   On
    HTTP_Listen   0.0.0.0
    HTTP_Port     2020

# 采集容器日志
[INPUT]
    Name              tail
    Path              /var/log/containers/*.log
    Parser            docker
    Tag               kube.*
    Refresh_Interval  5
    Mem_Buf_Limit     50MB
    Skip_Long_Lines   On
    DB                /var/log/flb_kube.db

# Kubernetes 元数据注入
[FILTER]
    Name                kubernetes
    Match               kube.*
    Kube_URL            https://kubernetes.default.svc:443
    Kube_CA_File        /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
    Kube_Token_File     /var/run/secrets/kubernetes.io/serviceaccount/token
    Merge_Log           On
    K8S-Logging.Parser  On
    K8S-Logging.Exclude On

# 多行日志处理（Java StackTrace）
[FILTER]
    Name                multiline
    Match               kube.*
    multiline.content  key log
    multiline.start_regexp ^\[
   -parser                parser_firstline

# 过滤敏感日志
[FILTER]
    Name                grep
    Match               kube.*
    Exclude             log password|token|secret|api.key

# 输出到 Elasticsearch
[OUTPUT]
    Name            es
    Match           kube.*
    Host            elasticsearch.logging.svc.cluster.local
    Port            9200
    HTTP_User       elastic
    HTTP_Passwd     changeme
    Logstash_Format On
    Logstash_Prefix k8s
    Replace_Dots    On
    Retry_Limit     False
```

### 多行处理（Java/Python StackTrace）

```ini
# 追加更多解析器
[PARSER]
    Name                java-stacktrace
    Format              regex
    Regex               ^(?<time>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}.\d{3}).*$
    Time_Key            time
    Time_Format         %Y-%m-%d %H:%M:%S.%L

[FILTER]
    Name                multiline
    Match               kube.*
    multiline.content  log
    multiline.key       log
    multiline.parser    java-stacktrace
    multiline.timeout   3
    multiline.flush_timeout 3
```

## Fluentd：功能丰富的聚合层

```
┌─────────────────────────────────────────────────────────────────┐
│                    Fluentd 架构                                  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Source (tail, forward, syslog, http...)                   │  │
│  │  ↓                                                          │  │
│  │  Filter (grep, record_transformer, parser, geoip...)       │  │
│  │  ↓                                                          │  │
│  │  Buffer (memory, file, inline_memory...)                   │  │
│  │  ↓                                                          │  │
│  │  Output (elasticsearch, kafka, s3, forward, http...)      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Fluentd 聚合配置

```ruby
# fluent.conf
# 接收来自 Fluent Bit 的数据
<source>
  @type forward
  @id input_forward
  port 24224
  bind 0.0.0.0
</source>

# Kubernetes 元数据
<filter kube.**>
  @type kubernetes_metadata
  @id kubernetes_metadata
  kubernetes_url "#{ENV['KUBERNETES_SERVICE_HOST']}:#{ENV['KUBERNETES_SERVICE_PORT']}"
  bearer_token_file /var/run/secrets/kubernetes.io/serviceaccount/token
  ca_file /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
</filter>

# JSON 解析
<filter kube.**>
  @type parser
  @id filter_parser
  key_name log
  <parse>
    @type json
    time_type float
  </parse>
</filter>

# 添加字段
<filter kube.**>
  @type record_transformer
  <record>
    hostname "#{Socket.gethostname}"
    cluster_name "#{ENV['CLUSTER_NAME']}"
    environment "#{ENV['ENVIRONMENT']}"
  </record>
</filter>

# 脱敏处理
<filter kube.**>
  @type record_transformer
  <record>
    # 替换敏感字段
    log ${record["log"].gsub(/password[\s]*[:=][\s]*["'][^"']+["']/, "password: ***")}
  </record>
</filter>

# 输出到多个目标
<match kube.**>
  @type copy
  <store>
    @type elasticsearch
    host elasticsearch.logging.svc.cluster.local
    port 9200
    logstash_format true
    logstash_prefix k8s-prod
    flush_interval 10s
    <buffer>
      @type file
      path /fluentd/buffer/es.buffer
      flush_mode interval
      flush_interval 10s
      flush_thread_count 4
      chunk_limit_size 2M
      queue_limit_length 256
      retry_max_intervals 30s
    </buffer>
  </store>
  <store>
    @type kafka
    brokers kafka:9092
    default_topic k8s-logs
    <buffer>
      @type file
      path /fluentd/buffer/kafka.buffer
      flush_interval 10s
    </buffer>
  </store>
  <store>
    @type s3
    s3_region ap-northeast-1
    s3_bucket my-logs-backup
    path logs/
    buffer_path /fluentd/buffer/s3.buffer
    <buffer>
      @type file
      timekey 3600
      timekey_wait 300
      chunk_limit_size 256M
    </buffer>
  </store>
</match>
```

## Logstash：老牌 ETL 工具

```ruby
# logstash.conf
input {
  beats {
    port => 5044
    codec => json
  }
  tcp {
    port => 5000
    codec => json_lines
  }
}

filter {
  # JSON 解析
  if [message] =~ /^\{/ {
    json {
      source => "message"
      target => "parsed"
    }
  }

  # Grok 解析（自定义模式）
  grok {
    match => {
      "message" => "%{TIMESTAMP_ISO8601:timestamp} %{LOGLEVEL:loglevel} %{JAVACLASS:classname} - %{GREEDYDATA:log_message}"
    }
    tag_on_failure => ["_grokparsefailure"]
  }

  # 日期解析
  date {
    match => ["timestamp", "ISO8601"]
    target => "@timestamp"
  }

  # GeoIP 解析
  if [client_ip] {
    geoip {
      source => "client_ip"
      target => "geoip"
    }
  }

  # User-Agent 解析
  if [user_agent] {
    useragent {
      source => "user_agent"
      target => "ua"
    }
  }

  # 过滤
  if [loglevel] == "DEBUG" {
    drop { }
  }

  # 字段重命名
  mutate {
    rename => {
      "host" => "server_host"
      "path" => "log_file_path"
    }
    remove_field => ["message", "@version"]
  }
}

output {
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "logs-%{+YYYY.MM.dd}"
    user => elastic
    password => changeme
  }

  # 告警
  if [loglevel] == "ERROR" {
    stdout {
      codec => rubydebug
    }
  }
}
```

## Vector：高性能 Rust 新秀

```toml
# vector.toml
[sources.kubernetes]
type = "kubernetes_logs"
exclude_paths = ["/var/log/containers/fluent*"]

[sources.host]
type = "journald"
units = ["kubelet.service", "docker.service"]

[transforms.parse_json]
type = "regex_parser"
inputs = ["kubernetes", "host"]
pattern = '^(?P<timestamp>[^\s]+) (?P<level>\w+) (?P<message>.*)$'
types.timestamp = "timestamp|%Y-%m-%d %H:%M:%S"
types.level = "string"
types.message = "string"

[transforms.add_metadata]
type = "lua"
inputs = ["parse_json"]
hooks.process = "process"
script = <<-EOF
function process(event, emit)
  event.log.hostname = hostname()
  event.log.cluster = os.getenv("CLUSTER_NAME")
  emit(event)
end
EOF

[transforms.filter]
type = "filter"
inputs = ["add_metadata"]
condition = '!contains(.message, "password") && !contains(.message, "token")'

[sinks.elasticsearch]
type = "elasticsearch"
inputs = ["filter"]
endpoint = "http://elasticsearch.logging.svc.cluster.local:9200"
index = "k8s-logs-%Y.%m.%d"
bulk.action = "append"
auth.strategy = "basic"
auth.user = "elastic"
auth.password = "${ELASTIC_PASSWORD}"

[sinks.s3]
type = "aws_s3"
inputs = ["filter"]
region = "ap-northeast-1"
bucket = "my-logs-archive"
key_prefix = "logs/{{ host }}/"
encoding.codec = "json"
buffer.type = "disk"
buffer.max_size = 1073741824  # 1GB
```

## 性能对比

```
┌─────────────────────────────────────────────────────────────────┐
│                    日志采集器性能对比                               │
│                                                                  │
│  测试环境：4 vCPU, 8GB RAM, 1M 条/天日志                          │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Fluent Bit      │ CPU: ~50m  │ 内存: ~50MB │ QPS: 100k+   │  │
│  │  Fluentd         │ CPU: ~300m │ 内存: ~200MB│ QPS: 30k+    │  │
│  │  Logstash        │ CPU: ~500m │ 内存: ~500MB│ QPS: 10k+    │  │
│  │  Vector          │ CPU: ~30m  │ 内存: ~10MB │ QPS: 100k+   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  结论：                                                         │
│  - K8s DaemonSet 首选 Fluent Bit 或 Vector                       │
│  - 聚合层选 Fluentd（功能丰富）                                    │
│  - 高吞吐/安全敏感选 Vector（Rust，内存安全）                      │
└─────────────────────────────────────────────────────────────────┘
```

## 选型建议

```
┌─────────────────────────────────────────────────────────────────┐
│                    日志采集器选型决策                               │
│                                                                  │
│  Q1: 主要场景是什么？                                             │
│                                                                  │
│  ├── K8s 日志采集                                               │
│  │   └── Fluent Bit（轻量、官方推荐）                            │
│  │                                                               │
│  ├── 日志聚合 + 路由                                            │
│  │   └── Fluentd（插件丰富）                                    │
│  │                                                               │
│  ├── 日志 + APM 数据                                            │
│  │   └── Vector（高性能、安全）                                  │
│  │                                                               │
│  └── 传统 ELK 迁移                                              │
│      └── Logstash（历史积累）                                    │
│                                                                  │
│  Q2: 吞吐量要求？                                                │
│                                                                  │
│  ├── > 50k msg/s                                               │
│  │   └── Fluent Bit / Vector                                    │
│  │                                                               │
│  └── < 50k msg/s                                               │
│      └── Fluentd / Logstash                                      │
│                                                                  │
│  Q3: 团队技术栈？                                                │
│                                                                  │
│  ├── Ruby 团队                                                  │
│  │   └── Fluentd                                                │
│  │                                                               │
│  ├── 高安全要求                                                  │
│  │   └── Vector（内存安全、无 GC 停顿）                          │
│  │                                                               │
│  └── 快速上线                                                    │
│      └── Fluent Bit（配置简单）                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 常见错误

```
# 错误一：Fluent Bit 和 Fluentd 混用但配置不兼容
# Fluent Bit 默认使用 MessagePack 格式，Forward 插件可兼容
# 但部分配置（如 Filter 语法）需要转换

# 错误二：缓冲配置不当导致日志丢失
# Memory 缓冲：快但重启丢数据
# File 缓冲：稳但占磁盘
# 建议：生产用 File 缓冲，配置足够的 buffer 大小

# 错误三：正则表达式回溯导致 CPU 100%
# Fluentd/Fluent Bit 的 Grok/Regex 解析器在输入不匹配时可能回溯
# 解决：简化正则，或使用 Dissect（比正则快 10x）

# 错误四：多行日志合并失败
# Java StackTrace、Python Error 等多行日志需要 multiline 插件
# 关键配置：超时时间（timeout）和起始行匹配（start_regexp）
```

## 面试追问方向

1. **Fluent Bit 和 Fluentd 有什么区别？**
   答：Fluent Bit 定位「边缘采集」，内存占用 < 1MB，适合 K8s DaemonSet；Fluentd 定位「聚合处理」，功能丰富，插件生态强大，适合聚合层。两者可以组合使用：Fluent Bit 采集，Fluentd 聚合路由。

2. **日志采集器如何保证日志不丢失？**
   答：三重保障：1) 应用日志落盘（不只打标准输出）；2) 采集器使用 File 缓冲（而非内存缓冲），并在重启时恢复；3) 目标存储（ES/S3）使用批量写入 + ACK 机制。建议 Fluent Bit 用 File 缓冲 + 异步 flush。

3. **多行日志怎么处理？**
   答：关键在于识别日志的「起始行」。Java 用正则 `^\[` 或 `^\d{4}-\d{2}-\d{2}`；Python 用 `^Traceback`；通用日志用 `^\d{4}-\d{2}-\d{2}`. 配置超时（3-5秒）决定多行合并的等待时间。

4. **Vector 相比 Fluentd 有什么优势？**
   答：Vector 是 Rust 编写，无 GC 停顿，内存占用极低（< 10MB），性能比 Fluentd 高 5-10 倍。且内存安全，适合安全敏感场景。缺点是生态相对年轻，插件数量不如 Fluentd。

选对日志采集器，让日志从「负担」变成「资产」。
