# Logstash 集群部署与配置文件管理

单节点 Logstash 扛不住流量？这一节我们来聊聊 Logstash 的集群部署和配置管理。

## 1. 为什么要集群部署？

```
单节点 Logstash：
┌─────────────────────┐
│   Logstash Node     │
│                     │
│  Input → Filter → Output
└─────────────────────┘
        ↑
        │ 瓶颈
        │
   流量有限

集群 Logstash：
┌─────────────────────┐
│   Load Balancer     │
└────────┬────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌───▼───┐ ┌───▼───┐
│ LS 1  │ │ LS 2  │ │ LS 3  │
│       │ │       │ │       │
└───┬───┘ └───┬───┘ └───┬───┘
    │         │         │
    └─────────┴─────────┘
        ↓
   Elasticsearch
```

**集群的优势：**

- **横向扩展**：增加节点提升吞吐量
- **高可用**：单节点故障不影响整体
- **负载均衡**：流量分散到多个节点
- **容错性**：故障节点自动隔离

## 2. 多 Pipeline 配置

### 2.1 pipelines.yml

```yaml
# /etc/logstash/pipelines.yml

- pipeline.id: main-logs
  path.config: "/etc/logstash/conf.d/main/*.conf"
  pipeline.workers: 4
  pipeline.batch.size: 250

- pipeline.id: nginx-logs
  path.config: "/etc/logstash/conf.d/nginx/*.conf"
  pipeline.workers: 2
  pipeline.batch.size: 500

- pipeline.id: jdbc-sync
  path.config: "/etc/logstash/conf.d/jdbc/*.conf"
  pipeline.workers: 1
  pipeline.batch.size: 100
  queue.type: persisted
```

### 2.2 Pipeline 优先级

```yaml
- pipeline.id: high-priority
  path.config: "/etc/logstash/conf.d/high/*.conf"
  pipeline.workers: 4
  pipeline.java_execution: true
  execution: "single"    # 独占线程池
  priority: 100          # 高优先级

- pipeline.id: normal
  path.config: "/etc/logstash/conf.d/normal/*.conf"
  priority: 0
```

### 2.3 Pipeline 间通信

Pipeline 之间可以共享数据：

```java
// Pipeline A: 解析请求
input { file { path => "/var/log/access.log" } }
filter {
  grok { match => { "message" => "%{COMBINEDAPACHELOG}" } }
  mutate { add_field => { "[@metadata][pipeline]" => "A" } }
}
output {
  pipeline { send_to => "parsed_logs" }
}

// Pipeline B: 接收处理后的数据
input { pipeline { address => "parsed_logs" } }
filter {
  geoip { source => "client_ip" }
  useragent { source => "agent" }
}
output {
  elasticsearch { hosts => ["http://localhost:9200"] }
}
```

## 3. 架构设计

### 3.1 常见的架构模式

**模式一：Beats → Logstash → Elasticsearch**

```
Filebeat ──┐
Metricbeat ├──→ Logstash Cluster → Elasticsearch ←── Kibana
Heartbeat ┘
```

**模式二：Kafka 作为缓冲**

```
Filebeat → Kafka → Logstash Cluster → Elasticsearch
                    ↑
                    │
              削峰填谷
```

**模式三：分层架构**

```
                    ┌─────────────┐
                    │ Beats       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Light LS    │  (解析、富化)
                    │ (解析节点)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Kafka       │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Heavy LS    │  (聚合、分析)
                    │ (聚合节点)  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Elasticsearch│
                    └─────────────┘
```

### 3.2 节点角色分配

```yaml
# 解析节点配置
pipeline.workers: 4
pipeline.batch.size: 500

# 聚合节点配置
pipeline.workers: 2
pipeline.batch.size: 125
queue.type: persisted
```

## 4. 配置管理

### 4.1 配置文件组织

```
/etc/logstash/
├── logstash.yml              # 主配置
├── pipelines.yml             # Pipeline 配置
├── jvm.options               # JVM 配置
├── log4j2.properties          # 日志配置
│
├── conf.d/                   # Pipeline 配置目录
│   ├── common/               # 通用配置
│   │   ├── 01-inputs.conf
│   │   ├── 02-filters.conf
│   │   └── 03-outputs.conf
│   │
│   ├── nginx/                # Nginx 日志 Pipeline
│   │   └── pipeline.conf
│   │
│   ├── app/                  # 应用日志 Pipeline
│   │   └── pipeline.conf
│   │
│   └── jdbc/                 # 数据库同步 Pipeline
│       └── pipeline.conf
│
└── patterns/                 # 自定义 Grok 模式
    ├── myapp
    └── nginx
```

### 4.2 通用配置模式

```java
# conf.d/common/01-inputs.conf
input {
  beats {
    port => 5044
    ssl => true
    ssl_certificate => "/etc/logstash/ssl/logstash.crt"
    ssl_key => "/etc/logstash/ssl/logstash.key"
  }
}
```

```java
# conf.d/common/03-outputs.conf
output {
  if "nginx" in [tags] {
    elasticsearch {
      hosts => ["http://es-node1:9200", "http://es-node2:9200"]
      index => "nginx-%{+YYYY.MM.dd}"
    }
  } else if "app" in [tags] {
    elasticsearch {
      hosts => ["http://es-node1:9200", "http://es-node2:9200"]
      index => "app-%{+YYYY.MM.dd}"
    }
  }
}
```

### 4.3 环境变量

```yaml
# logstash.yml
---
node.name: "${HOSTNAME}"
path.data: /var/lib/logstash
path.logs: /var/log/logstash

# 从环境变量读取
xpack.monitoring.elasticsearch.hosts: ["${ES_HOSTS}"]
xpack.monitoring.enabled: true

# 默认值
var.destination: "${ES_DESTINATION:localhost:9200}"
```

```bash
# 启动时指定环境变量
ES_HOSTS="es1:9200,es2:9200" bin/logstash -f pipeline.conf
```

### 4.4 配置版本控制

```bash
# Git 目录结构
logstash-config/
├── pipelines.yml
├── conf.d/
│   ├── nginx/
│   │   ├── pipeline.conf
│   │   └── pipeline.conf.bak
│   └── app/
│       └── pipeline.conf
├── patterns/
│   └── myapp
└── templates/
    └── elasticsearch-template.json
```

## 5. 高可用配置

### 5.1 心跳检测

```yaml
# logstash.yml
xpack.monitoring.enabled: true
xpack.monitoring.elasticsearch.hosts: ["http://es:9200"]

# 监控 Logstash 自身
monitoring.cluster.uuid: "my-logstash-cluster"
```

### 5.2 健康检查

```bash
# 检查 Logstash 健康状态
curl -X GET "localhost:9600/_node/stats?pretty"

# 检查 Pipeline 状态
curl -X GET "localhost:9600/_node/pipeline?pretty"

# 检查配置文件
curl -X GET "localhost:9600/_node/config_files?pretty"
```

### 5.3 故障转移

```
                    ┌─────────────┐
                    │ Load Balancer│
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ LS Node 1   │ ←── 故障时自动移除
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ LS Node 2   │ ←── 接管流量
                    └─────────────┘
```

**使用 HAProxy 做负载均衡：**

```bash
# /etc/haproxy/haproxy.cfg
listen logstash
    bind *:5044
    mode tcp
    balance roundrobin
    server ls1 192.168.1.10:5044 check inter 5s rise 2 fall 3
    server ls2 192.168.1.11:5044 check inter 5s rise 2 fall 3
```

## 6. 部署实践

### 6.1 Docker Compose 部署

```yaml
# docker-compose.yml
version: '3'

services:
  logstash:
    image: docker.elastic.co/logstash/logstash:8.11.0
    volumes:
      - ./pipeline:/usr/share/logstash/pipeline
      - ./patterns:/usr/share/logstash/patterns
      - ./config/logstash.yml:/usr/share/logstash/config/logstash.yml
      - ./data:/usr/share/logstash/data
    ports:
      - "5044:5044"
      - "9600:9600"
    environment:
      - "LS_JAVA_OPTS=-Xmx2g -Xms2g"
    deploy:
      replicas: 3
    restart: always

  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
    environment:
      - discovery.type=single-node
```

### 6.2 Kubernetes 部署

```yaml
# logstash-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: logstash
spec:
  replicas: 3
  selector:
    matchLabels:
      app: logstash
  template:
    metadata:
      labels:
        app: logstash
    spec:
      containers:
        - name: logstash
          image: docker.elastic.co/logstash/logstash:8.11.0
          ports:
            - containerPort: 5044
            - containerPort: 9600
          resources:
            requests:
              cpu: "1"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          volumeMounts:
            - name: pipeline
              mountPath: /usr/share/logstash/pipeline
          env:
            - name: "LS_JAVA_OPTS"
              value: "-Xmx2g -Xms2g"
      volumes:
        - name: pipeline
          configMap:
            name: logstash-pipeline
---
apiVersion: v1
kind: Service
metadata:
  name: logstash
spec:
  ports:
    - port: 5044
      name: beats
    - port: 9600
      name: api
  selector:
    app: logstash
```

## 7. 监控与告警

### 7.1 监控指标

```bash
# 关键监控指标

# 吞吐量
curl -s "localhost:9600/_node/stats/pipeline" | jq '.pipelines.main.events'

# 队列大小
curl -s "localhost:9600/_node/stats/pipeline" | jq '.pipelines.main.queue_size'

# 批次处理时间
curl -s "localhost:9600/_node/stats/pipeline" | jq '.pipelines.main.plugins.filters[].duration_in_millis'

# JVM 内存
curl -s "localhost:9600/_node/stats/jvm" | jq '.jvm.mem'
```

### 7.2 Prometheus 监控

```yaml
# logstash.yml
xpack.monitoring.enabled: true
xpack.monitoring.elasticsearch.hosts: ["http://es:9200"]
```

```yaml
# prometheus 配置
scrape_configs:
  - job_name: 'logstash'
    static_configs:
      - targets: ['logstash:9600']
    metrics_path: '/_node/stats/metrics'
```

### 7.3 告警规则

```yaml
# Prometheus 告警规则
groups:
  - name: logstash
    rules:
      - alert: LogstashDown
        expr: up{job="logstash"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Logstash instance down"

      - alert: LogstashQueueFull
        expr: logstash_queue_size > 0.9 * logstash_queue_max_size
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Logstash queue almost full"

      - alert: LogstashHighLatency
        expr: rate(logstash_pipeline_filter_duration_seconds_sum[5m]) / rate(logstash_pipeline_filter_events[5m]) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Logstash filter latency high"
```

## 8. 运维清单

```
Logstash 集群运维检查清单：

□ 节点数量与流量匹配
□ Pipeline 配置正确分发
□ 配置文件版本控制
□ 监控指标正常
□ 日志文件正常
□ 队列未堆积
□ 资源使用合理
□ 故障转移正常
□ 备份配置已更新
```

## 总结

Logstash 集群部署的关键要点：

1. **多 Pipeline**：按功能分离 Pipeline，便于管理和调优
2. **架构设计**：根据流量选择合适的架构（直接、缓冲、分层）
3. **配置管理**：统一的配置文件组织 + 版本控制
4. **高可用**：多节点 + 负载均衡 + 健康检查
5. **监控告警**：监控关键指标，及时发现问题

---

**留给你的问题**：

假设你的系统每天需要处理 10GB 日志，你计划部署多少个 Logstash 节点？如何配置？

需要考虑的问题：
- 每个节点的处理能力
- 高可用要求
- 数据不丢失的保障

这个设计需要根据实际情况调整。
