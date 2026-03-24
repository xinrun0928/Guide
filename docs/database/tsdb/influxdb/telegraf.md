# Telegraf：数据采集的瑞士军刀

InfluxDB 是数据库，那数据从哪来？

Telegraf 就是答案。

Telegraf 是 InfluxDB 官方出品的**数据采集代理**，支持 200+ 数据源，堪称监控领域的瑞士军刀。

---

## Telegraf 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Telegraf                                  │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│  │ Input Plugins │  │ Processor     │  │ Output Plugins │       │
│  │  (采集器)     │  │ Plugins       │  │  (输出)        │       │
│  │               │  │  (处理器)     │  │                │       │
│  │  ┌─────────┐  │  │              │  │  ┌──────────┐  │       │
│  │  │ CPU     │  │  │  ┌─────────┐ │  │  │ InfluxDB │  │       │
│  │  │ Memory  │  │  │  │ Drop    │ │  │  │ Prometheus│  │       │
│  │  │ MySQL   │  │  │  │ Rename  │ │  │  │ Kafka    │  │       │
│  │  │ Redis   │  │  │  │ Convert │ │  │  │ File     │  │       │
│  │  │ ...200+ │  │  │  │ ...     │ │  │  │ ...      │  │       │
│  │  └─────────┘  │  │  └─────────┘ │  │  └──────────┘  │       │
│  └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 安装与配置

### 安装

```bash
# Linux (Ubuntu/Debian)
wget https://dl.influxdata.com/telegraf/releases/telegraf_1.28_linux_amd64.tar.gz
tar xzf telegraf_1.28_linux_amd64.tar.gz
cd telegraf

# macOS
brew install telegraf
```

### 基本配置

```toml
# /etc/telegraf/telegraf.conf

# 全局配置
[agent]
  interval = "10s"          # 采集间隔
  round_interval = true
  metric_batch_size = 1000
  metric_buffer_limit = 10000
  collection_jitter = "0s"
  flush_interval = "10s"
  flush_jitter = "0s"

# 输入插件：CPU
[[inputs.cpu]]
  percpu = true              # 每个 CPU 核心单独统计
  totalcpu = false           # 不需要总计
  collect_cpu_time = false

# 输入插件：内存
[[inputs.mem]]
  # 使用默认配置即可

# 输入插件：磁盘
[[inputs.disk]]
  ignore_fs = ["tmpfs", "devtmpfs", "devfs", "iso9660", "overlay", "aufs", "squashfs"]

# 输入插件：MySQL
[[inputs.mysql]]
  servers = ["tcp://localhost:3306/?tls=false"]
  username = "telegraf"
  password = "password"
  gather_table_row_counts = true

# 输出插件：InfluxDB
[[outputs.influxdb]]
  urls = ["http://localhost:8086"]
  database = "monitoring"
  retention_policy = "30d"
  username = "telegraf"
  password = "password"
```

---

## 常用输入插件

### 1. HTTP Server（采集 Web 应用指标）

```toml
[[inputs.http_listener]]
  service_address = ":8080"
  paths = ["/telegraf"]
  allowed_pending_messages = 10000
  max_message_size = "10MB"
```

```java
// 应用端发送数据
public class MetricsReporter {
    private final HttpClient httpClient = HttpClient.newHttpClient();

    public void report(String metricsJson) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("http://telegraf:8080/telegraf"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(metricsJson))
            .build();

        httpClient.send(request, HttpResponse.BodyHandlers.discarding());
    }
}
```

### 2. Kafka（消费消息队列）

```toml
[[inputs.kafka_consumer]]
  brokers = ["kafka1:9092", "kafka2:9092"]
  topics = ["metrics", "events"]
  consumer_group = "telegraf"
  data_format = "json"
  json_name_key = "measurement"
  json_time_key = "timestamp"
  json_time_format = "unix"
```

### 3. Prometheus（拉取指标）

```toml
[[inputs.prometheus]]
  urls = ["http://app1:9090/metrics", "http://app2:9090/metrics"]
  metric_version = 2
  url_tag = "url"
```

### 4. MySQL

```toml
[[inputs.mysql]]
  servers = [
    "tcp://user:password@localhost:3306/?tls=false",
    "tcp://user:password@remote-host:3306/?tls=false"
  ]
  gather_table_row_counts = true
  gather_table_size = true
  gather_process_list = true
  gather_innodb_metrics = true
```

### 5. Redis

```toml
[[inputs.redis]]
  servers = ["tcp://localhost:6379"]
  password = "redis-password"
  keys = ["key1", "key2", "key3"]
```

---

## 处理器插件

### 1. 数据转换

```toml
# 删除不需要的字段
[[processors.rename]]
  [[processors.rename.replace]]
    measurement = "cpu"
    dest = "cpu_measurement"

[[processors.converter]]
  [processors.converter.fields]
    integer = ["value", "count"]
    float = ["rate"]
    string = ["status"]

[[processors.defaults]]
  [processors.defaults.fields]
    env = "production"
    service = "unknown"
```

### 2. 数据过滤

```toml
# 丢弃符合条件的数据
[[processors.predicate]]
  drop = false
  criteria = "and"
  [[processors.predicate.condition1]]
    field = "status"
    operation = "=="
    value = "disabled"

# 只保留指定字段
[[processors.selectors]]
  [[processors.selectors.tagkey]]
    key = "host"
    ordered = false
```

### 3. 数据增强

```toml
# 添加静态标签
[[processors.defaults]]
  [processors.defaults.fields]
    datacenter = "us-east-1"
    env = "production"

# 提取信息作为标签
[[processors.regex]]
  [[processors.regex.tags]]
    key = "path"
    pattern = "^/api/v([0-9]+)/(.+)$"
    replacement = "${1}"
    dest = "api_version"
```

---

## 输出插件

### 1. 多个输出

```toml
# 同时输出到 InfluxDB 和 Prometheus
[[outputs.influxdb]]
  urls = ["http://influxdb:8086"]
  database = "monitoring"

[[outputs.prometheus_client]]
  listen = ":9273"
  metric_version = 2
```

### 2. Kafka

```toml
[[outputs.kafka]]
  brokers = ["kafka1:9092", "kafka2:9092"]
  topic = "telegraf"
  data_format = "json"
```

### 3. File

```toml
[[outputs.file]]
  files = ["stdout", "/var/log/telegraf/metrics.out"]
  data_format = "influx"
  influx_sort_fields = true
```

---

## Java 集成

### 1. 自定义 Telegraf 输入

Telegraf 支持通过 HTTP 接收自定义指标：

```java
public class CustomMetricsReporter {
    private final String telegrafUrl;

    // 使用 InfluxDB Line Protocol 格式
    public void report(CpuMetrics metrics) {
        String lineProtocol = String.format(
            "custom_metrics,host=%s,service=%s cpu_user=%.2f,cpu_system=%.2f,cpu_idle=%.2f %d",
            metrics.getHost(),
            metrics.getService(),
            metrics.getCpuUser(),
            metrics.getCpuSystem(),
            metrics.getCpuIdle(),
            System.currentTimeMillis() * 1_000_000  // 纳秒
        );

        sendToTelegraf(lineProtocol);
    }

    // 批量发送
    public void batchReport(List&lt;CpuMetrics&gt; metricsList) {
        StringBuilder sb = new StringBuilder();
        for (CpuMetrics m : metricsList) {
            sb.append(String.format(
                "custom_metrics,host=%s,service=%s cpu_user=%.2f %d\n",
                m.getHost(), m.getService(), m.getCpuUser(),
                System.currentTimeMillis() * 1_000_000
            ));
        }
        sendToTelegraf(sb.toString());
    }

    private void sendToTelegraf(String data) {
        // POST 到 Telegraf HTTP 输入
    }
}
```

### 2. 使用 StatsD 协议

```toml
[[inputs.statsd]]
  service_address = ":8125"
  delete_gauges = true
  delete_counters = true
  delete_sets = true
  delete_timings = true
  percentiles = [50, 90, 95, 99]
```

```java
// Java 发送 StatsD 指标
public class StatsDClient {
    private final DatagramSocket socket;
    private final InetAddress telegrafHost;
    private final int port;

    public void gauge(String metric, double value, String... tags) {
        String packet = buildPacket("g", metric, value, tags);
        send(packet);
    }

    public void increment(String metric, String... tags) {
        String packet = buildPacket("c", metric, 1, tags);
        send(packet);
    }

    private String buildPacket(String type, String metric, double value, String... tags) {
        StringBuilder sb = new StringBuilder();
        sb.append(metric);
        for (String tag : tags) {
            sb.append(",").append(tag);
        }
        sb.append(":").append(value).append("|").append(type);
        if (tags.length > 0) {
            sb.append("|#").append(String.join(",", tags));
        }
        return sb.toString();
    }
}
```

---

## 面试追问方向

- Telegraf 和其他采集器（如 Filebeat、Fluentd）有什么区别？
- 如何处理 Telegraf 采集高峰时的背压问题？

下一节，我们来了解 TDengine 的超级表设计。
