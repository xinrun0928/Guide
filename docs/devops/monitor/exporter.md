# Exporter 生态：Node、Blackbox、JDBC、Custom

「Prometheus 怎么采集自定义指标？」——Exporter 是桥梁。

官方 Exporter 覆盖了 90% 的场景：Node、Blackbox、MySQL、Redis、Kafka……但当你的业务有自己的指标时，你需要自己写 Exporter。理解 Exporter 的工作原理和最佳实践，是 Prometheus 监控进阶的必经之路。

## Exporter 工作原理

```
┌─────────────────────────────────────────────────────────────────┐
│                    Exporter 工作流程                              │
│                                                                  │
│  Prometheus                      Exporter                       │
│      │                              │                            │
│      │  GET /metrics                │                            │
│      ├─────────────────────────────►│                            │
│      │                              │                            │
│      │                     1. 采集目标系统的数据                   │
│      │                     2. 转换为 Prometheus 格式               │
│      │                     3. 格式化输出                           │
│      │                              │                            │
│      │  # HELP node_cpu_seconds...  │                            │
│      │  # TYPE node_cpu_seconds...  │                            │
│      │  node_cpu_seconds{mode="idle"} 1.23                       │
│      │◄─────────────────────────────┤                            │
│                                                                  │
│  Exporter 本质：一个 HTTP 服务，暴露 /metrics 端点                │
└─────────────────────────────────────────────────────────────────┘
```

## 官方 Exporter 矩阵

| Exporter | 监控对象 | 默认端口 | 关键指标 |
|---------|---------|---------|---------|
| node_exporter | 主机（CPU、内存、磁盘、网络） | 9100 | node_cpu/node_memory |
| blackbox_exporter | HTTP/TCP/ICMP/DNS | 9115 | probe_success/probe_duration |
| mysqld_exporter | MySQL | 9104 | mysql_up/global_status |
| postgres_exporter | PostgreSQL | 9187 | pg_stat_database |
| redis_exporter | Redis | 9121 | redis_up/redis_mem |
| kafka_exporter | Kafka | 9308 | kafka_broker_messages |
| elasticsearch_exporter | Elasticsearch | 9114 | elasticsearch_cluster_health |
| consul_exporter | Consul | 9107 | consul_up |
| aws_exporter | AWS CloudWatch | 9096 | 各服务指标 |
| snmp_exporter | SNMP 设备 | 9116 | 各设备指标 |

## Node Exporter（主机监控）

### 安装与启动

```bash
# 下载
wget https://github.com/prometheus/node_exporter/releases/download/v1.7.0/node_exporter-1.7.0.linux-amd64.tar.gz
tar -xzf node_exporter-1.7.0.linux-amd64.tar.gz

# 启动（启用全部采集器）
./node_exporter --collector.cpu --collector.meminfo --collector.diskstats \
    --collector.filesystem --collector.netdev --collector.loadavg \
    --collector.pressure

# 验证
curl http://localhost:9100/metrics | head -50
```

### 常用采集器

```bash
# 启用特定采集器
./node_exporter \
    --collector.cpu \
    --collector.meminfo \
    --collector.diskstats \
    --collector.filesystem \
    --collector.netdev \
    --collector.loadavg \
    --collector.pressure \
    --collector.entropy \
    --collector.bonding \
    --collector.conntrack \
    --collector.mdadm \
    --collector.zfs \
    --collector.tapestats \
    --collector.bcache \
    --collector.infiniband \
    --collector.runlevel \
    --collector.systemd \
    --collector.time \
    --collector.timex

# 禁用特定采集器（省资源）
./node_exporter \
    --no-collector.cpu.info \
    --no-collector.bonding \
    --no-collector.mdadm
```

### 关键指标解读

```promql
# CPU 使用率
100 - (avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)

# 内存使用率
100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))

# 磁盘使用率
100 * (1 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"}))

# 磁盘 IOPS
rate(node_disk_reads_completed_total[5m])
rate(node_disk_writes_completed_total[5m])

# 网卡流量
rate(node_network_receive_bytes_total{device!="lo"}[5m])
rate(node_network_transmit_bytes_total{device!="lo"}[5m])

# 负载
node_load1 / count by (instance) (node_cpu_seconds_total)

# 进程数
node_procs_running
node_procs_blocked
```

## Blackbox Exporter（黑盒监控）

### 配置

```yaml
# blackbox.yml
modules:
  http_2xx:
    prober: http
    http:
      preferred_ip_protocol: ip4
      valid_http_status_codes: [200, 201, 202, 204]
      valid_status_codes: []

  http_post_2xx:
    prober: http
    http:
      method: POST
      headers:
        Content-Type: application/json
      body: '{"key": "value"}'

  tcp_connect:
    prober: tcp
    timeout: 5s

  dns_http:
    prober: http
    http:
      url: http://dns.example.com/health

  icmp:
    prober: icmp
    tcp: false

# Prometheus 配置
scrape_configs:
  - job_name: 'blackbox-http'
    metrics_path: /probe
    params:
      module: [http_2xx]
    static_configs:
      - targets:
          - https://example.com
          - https://api.example.com/health
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        target_label: instance
      - target_label: __address__
        replacement: blackbox-exporter:9115

  - job_name: 'blackbox-tcp'
    metrics_path: /probe
    params:
      module: [tcp_connect]
    static_configs:
      - targets:
          - mysql:3306
          - redis:6379
          - kafka:9092
    relabel_configs:
      - source_labels: [__address__]
        target_label: __param_target
      - source_labels: [__param_target]
        regex: "(.+):(.+)"
        target_label: host
        replacement: "${1}"
      - source_labels: [__param_target]
        regex: "(.+):(.+)"
        target_label: port
        replacement: "${2}"
```

### 黑盒监控指标

```promql
# 探测成功率
sum(rate(probe_success[5m])) by (job, instance)

# 探测延迟
probe_duration_seconds{job="blackbox-http"}

# HTTP 状态码（从响应中提取）
probe_http_status_code

# TLS 证书过期时间（天）
probe_tls_cert_info_not_after - time()

# DNS 解析时间
probe_dns_lookup_time_seconds
```

## MySQL Exporter

### 配置

```bash
# 安装
mysqld_exporter --collectors.global_status \
    --collectors.global_variables \
    --collectors.info_schema.tables \
    --collectors.info_schema.innodb_tablespaces \
    --collectors.perf_schema.eventsstatements \
    --collectors.slave_status \
    --web.listen-address=0.0.0.0:9104 \
    --mysql.dsn="prometheus:password@(localhost:3306)/"
```

```yaml
# 数据源配置（支持多个 MySQL）
# .my.cnf
[client]
user = prometheus
password = password
host = localhost
port = 3306
```

### 关键指标

```promql
# QPS
rate(mysql_global_status_questions[5m])

# 连接数使用率
mysql_global_status_threads_connected
  /
mysql_global_variables_max_connections

# 慢查询
rate(mysql_global_status_slow_queries[5m])

# InnoDB Buffer Pool
mysql_insn_buffer_pool_pages_data / mysql_insn_buffer_pool_pages_total

# 查询延迟（P99）
mysql_global_status_statements_total{command="execute"}
```

## 自定义 Exporter（Go / Python / Java）

### Go Exporter（官方推荐）

```go
package main

import (
    "net/http"
    "github.com/prometheus/client_golang/prometheus"
    "github.com/prometheus/client_golang/prometheus/promhttp"
)

var (
    // Counter：只增不减
    httpRequestsTotal = prometheus.NewCounterVec(
        prometheus.CounterOpts{
            Name: "http_requests_total",
            Help: "Total HTTP requests",
        },
        []string{"method", "status"},
    )

    // Gauge：可增可减
    currentUsers = prometheus.NewGauge(
        prometheus.GaugeOpts{
            Name: "current_users_online",
            Help: "Current number of online users",
        },
    )

    // Histogram：延迟分布
    requestDuration = prometheus.NewHistogramVec(
        prometheus.HistogramOpts{
            Name:    "http_request_duration_seconds",
            Help:    "HTTP request latency distribution",
            Buckets: []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10},
        },
        []string{"method", "path"},
    )
)

func init() {
    prometheus.MustRegister(httpRequestsTotal, currentUsers, requestDuration)
}

func recordMetrics() {
    // 模拟数据采集
    httpRequestsTotal.WithLabelValues("GET", "200").Inc()
    currentUsers.Set(1234)
    requestDuration.WithLabelValues("GET", "/api/orders").Observe(0.025)
}

func main() {
    http.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
        recordMetrics()
        promhttp.Handler().ServeHTTP(w, r)
    })
    http.ListenAndServe(":8080", nil)
}
```

### Python Exporter（prometheus_client）

```python
from prometheus_client import start_http_server, Counter, Gauge, Histogram
import random
import time

# 定义指标
REQUEST_COUNT = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'status']
)

CURRENT_USERS = Gauge(
    'current_users_online',
    'Current number of online users'
)

REQUEST_LATENCY = Histogram(
    'http_request_duration_seconds',
    'HTTP request latency',
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
)

if __name__ == '__main__':
    start_http_server(8080)
    while True:
        # 模拟数据采集
        REQUEST_COUNT.labels(method='GET', status='200').inc()
        CURRENT_USERS.set(random.randint(100, 2000))
        with REQUEST_LATENCY.labels(method='GET').time():
            time.sleep(random.uniform(0.001, 0.1))
```

### Java Exporter（Micrometer）

```java
// Spring Boot + Micrometer
// pom.xml
// <dependency>
//     <groupId>io.micrometer</groupId>
//     <groupId>micrometer-registry-prometheus</groupId>
// </dependency>

// application.yml
// management:
//   endpoints:
//     web:
//       exposure:
//         include: prometheus,health,info
//   metrics:
//     tags:
//       application: ${spring.application.name}

@Service
public class OrderService {
    private final Counter orderCounter;
    private final Timer orderTimer;

    public OrderService(MeterRegistry registry) {
        this.orderCounter = Counter.builder("order.created.total")
            .description("Total orders created")
            .tag("service", "order")
            .register(registry);

        this.orderTimer = Timer.builder("order.process.duration")
            .description("Order processing time")
            .publishPercentiles(0.5, 0.95, 0.99)
            .publishPercentileHistogram()
            .register(registry);
    }

    public void createOrder(Order order) {
        orderCounter.increment();
        orderTimer.record(() -> {
            // 订单处理逻辑
        });
    }
}
```

## Exporter 最佳实践

```
┌─────────────────────────────────────────────────────────────────┐
│                    Exporter 最佳实践                             │
│                                                                  │
│  1. 指标命名规范                                                 │
│     namespace_subsystem_name_total/count/seconds/gauge           │
│     例如：order_service_request_duration_seconds                  │
│                                                                  │
│  2. 标签设计                                                     │
│     - 低基数：method, status, service, instance, env             │
│     - 禁止高基数：user_id, session_id, request_id                 │
│                                                                  │
│  3. 错误处理                                                     │
│     - 采集失败时返回 0 或设置 Gauge 为 0，不崩溃                   │
│     - 提供 exporter_up{job="xxx"} = 1/0 判断 Exporter 健康状态   │
│                                                                  │
│  4. 性能考虑                                                     │
│     - 避免频繁创建对象（指标在 init 时注册）                       │
│     - 批量采集代替循环单个采集                                    │
│     - 采集超时设置（防止 Exporter 阻塞 Prometheus）                 │
│                                                                  │
│  5. 资源限制                                                     │
│     - 监控 Exporter 的 Exporter（exporter_up）                   │
│     - 内存和 CPU 限制（K8s 中设置 limits）                        │
└─────────────────────────────────────────────────────────────────┘
```

## 常见错误

```
# 错误一：指标类型用错
# Counter 记录当前值（用户数），Counter 只能增不能减
# 正确：用 Gauge
current_users_online{service="order"} 10

# 错误二：高基数标签
# 不要用 request_id、user_id 作为标签
# 错误：{request_id="abc123"} 1
# 正确：{service="order", method="GET"} 1

# 错误三：指标名重复
# 同一个 Exporter 中不要有两个同名的指标
# 错误：request_total 和 request_total（一个是 Counter，一个是 Gauge）

# 错误四：未注册指标
# 指标必须在 init() 或 main() 中注册
prometheus.MustRegister(httpRequestsTotal)

# 错误五：采集超时导致 Prometheus 阻塞
# Exporter 响应慢会影响 Prometheus 的拉取周期
# 设置 scrape_timeout 略小于 scrape_interval
```

## 面试追问方向

1. **如何监控 Prometheus 自身？**
   答：Prometheus 自身暴露 `/metrics` 端点。使用 `self` 监控自己：`prometheus_tsdb_head_samples`、`prometheus_target_scrapes_exceeded_sample_limit`、`prometheus_target_scrapes_cache_flush_forbidden` 等。也可以用 Prometheus Federation，让一个 Prometheus 监控另一个。

2. **Exporter 的性能瓶颈在哪？**
   答：Exporter 本身是轻量的，瓶颈在采集目标系统。比如 MySQL Exporter 执行 `SHOW GLOBAL STATUS` 可能耗时较长（数百毫秒）；Node Exporter 的 `textfile` 采集器如果文件多会慢；Blackbox Exporter 的 DNS 解析可能超时。建议 Exporter 设置超时（10s），并监控 Exporter 的响应时间。

3. **如何让 Exporter 支持 TLS 和认证？**
   答：Prometheus Exporter 本身不内置 TLS，需要前面加 Nginx/Envoy 做反向代理。或者使用 Go 的 `crypto/tls` 包自己实现。Basic Auth 可以通过 `basic_auth` 配置在 Prometheus 端，也可以用 Nginx 代理。

4. **Go 和 Python Exporter 哪个更好？**
   答：官方推荐 Go，因为 Prometheus 官方库是 Go 的，性能最好。Python（`prometheus_client`）适合快速原型或业务团队已有的 Python 项目。但 Go Exporter 的内存占用更低，适合大规模部署。

Exporter 是 Prometheus 监控的延伸。理解它的工作原理，你就能把任何系统的数据采集进来。
