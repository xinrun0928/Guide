# Loki 日志收集体系

「有没有比 ELK 更省钱的日志方案？」——Loki 是答案。

ELK 功能强大，但存储成本高。Elasticsearch 的全文索引虽然查询快，但存储空间是纯日志文件的 2~5 倍。对于只需要按标签筛选、不需要全文索引的场景，Loki 是个更经济的选择——它只索引元数据（标签），日志本体存在对象存储里，存储成本可以降低 10 倍以上。

## Loki vs ELK

```
┌─────────────────────────────────────────────────────────────────┐
│                 Loki vs ELK 核心区别                            │
│                                                                  │
│  Elasticsearch (ELK)                    Loki                    │
│  ├── 全文索引                          ├── 标签索引            │
│  ├── 查询快（倒排索引）                 ├── 查询较慢但够用       │
│  ├── 存储成本高                        ├── 存储成本极低         │
│  ├── 占用资源多                        ├── 轻量级（Go）         │
│  └── 需要 SSD                          └── 可用对象存储         │
│                                                                  │
│  ELK 适合：全文搜索、复杂聚合                               │
│  Loki 适合：按标签筛选、指标+日志统一视图                      │
└─────────────────────────────────────────────────────────────────┘
```

| 维度 | Elasticsearch | Loki |
|------|--------------|------|
| 存储方式 | 倒排索引 | 标签索引 + 对象存储 |
| 存储成本 | 高 | 极低（S3/对象存储） |
| 查询能力 | 全文搜索、复杂聚合 | 标签筛选、LogQL |
| 部署复杂度 | 高（多组件） | 低（单进程） |
| 资源消耗 | 大 | 小 |
| 与 Prometheus 集成 | 一般 | 优秀 |
| 适用场景 | 日志分析和搜索 | 日志 + 指标关联分析 |

## Loki 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Loki 架构                                  │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │ Promtail │────►│  Loki   │────►│   S3 /   │               │
│  │ (采集)   │     │ (存储+  │     │  MinIO   │               │
│  └──────────┘     │  查询)   │     │ (对象存储)│               │
│       │          └────┬─────┘     └──────────┘               │
│  ┌──────────┐         │                                       │
│  │  应用    │─────────┼───────────────────────────────────────│
│  │  (日志)  │         │                                       │
│  └──────────┘         ▼                                       │
│                 ┌──────────┐     ┌──────────┐               │
│                 │ Grafana  │────►│  PromQL  │               │
│                 │ (可视化) │     │  LogQL   │               │
│                 └──────────┘     └──────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

## Loki 部署

### 单机部署（开发环境）

```bash
# Docker 部署
docker run -d \
  --name loki \
  -p 3100:3100 \
  -v $(pwd)/loki.yaml:/etc/loki/loki.yaml \
  grafana/loki:2.9.0 \
  -config.file=/etc/loki/loki.yaml
```

### Loki 配置文件

```yaml
# loka-config.yaml
auth_enabled: false

server:
  http_listen_port: 3100
  grpc_listen_port: 9096

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    instance_addr: 127.0.0.1
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2024-01-01
      store: boltdb-shipper
      object_store: filesystem
      schema: v12
      index:
        prefix: index_
        period: 24h

storage_config:
  boltdb_shipper:
    active_index_directory: /loki/index
    cache_location: /loki/index_cache
    resync_interval: 5s
    shared_store: filesystem
  filesystem:
    directory: /loki/chunks

limits_config:
  reject_old_samples: true
  reject_old_samples_max_age: 168h
  ingestion_rate_mb: 50
  ingestion_burst_size_mb: 100

chunk_store_config:
  chunk_cache_config:
    embedded_cache:
      enabled: true
      max_size_mb: 500

query_range:
  align_queries_with_step: true
  cache_results: true
  max_retries: 5

table_manager:
  retention_deletes_enabled: true
  retention_period: 720h
```

### Kubernetes 部署（微服务模式）

```yaml
# loki-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: loki
  namespace: monitoring
spec:
  serviceName: loki
  replicas: 3
  podManagementPolicy: Parallel
  selector:
    matchLabels:
      app: loki
  template:
    metadata:
      labels:
        app: loki
    spec:
      serviceAccountName: loki
      containers:
        - name: loki
          image: grafana/loki:2.9.0
          ports:
            - containerPort: 3100
              name: http
            - containerPort: 9096
              name: grpc
          args:
            - -config.file=/etc/loki/loki.yaml
            - -target=all
          resources:
            requests:
              cpu: 200m
              memory: 512Mi
            limits:
              cpu: 2000m
              memory: 4Gi
          volumeMounts:
            - name: storage
              mountPath: /loki
          readinessProbe:
            httpGet:
              path: /ready
              port: 3100
            initialDelaySeconds: 10
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: storage
      spec:
        storageClassName: ssd
        resources:
          requests:
            storage: 50Gi
---
apiVersion: v1
kind: Service
metadata:
  name: loki
  namespace: monitoring
spec:
  clusterIP: None
  selector:
    app: loki
  ports:
    - port: 3100
      name: http
    - port: 9096
      name: grpc
```

## Promtail

Promtail 是 Loki 的日志采集器，类似于 Filebeat for Elasticsearch。

### 配置文件

```yaml
# promtail.yaml
server:
  http_listen_port: 9080
  grpc_listen_port: 0

positions:
  filename: /var/positions.yaml
  ignore_invalid_yaml: true

clients:
  - url: http://loki:3100/loki/api/v1/push

scrape_configs:
  # 采集应用日志
  - job_name: app-logs
    static_configs:
      - targets:
          - localhost
        labels:
          job: app-logs
          env: production
          __path__: /var/log/app/**/*.log
    pipeline_stages:
      - json:
          expressions:
            timestamp: timestamp
            level: level
            message: message
            service: service
      - labels:
          level:
          service:

  # 采集 Kubernetes Pod 日志
  - job_name: kubernetes-pods
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: (.+)
        action: keep
        target_label: app
      - source_labels: [__meta_kubernetes_namespace]
        action: replace
        target_label: namespace
      - source_labels: [__meta_kubernetes_pod_name]
        action: replace
        target_label: pod
      - action: replace
        replacement: /var/log/pods/$1/*.log
        source_labels: [__meta_kubernetes_pod_uid]

  # 采集 Syslog
  - job_name: syslog
    syslog:
      listen_address: 0.0.0.0:1514
      labels:
        job: syslog
    relabel_configs:
      - action: labelmap
        regex: __syslog_message_(.+)

  # 采集 Journald
  - job_name: journal
    journal:
      max_age: 12h
      path: /var/log/journal
      labels:
        job: systemd-journal
    relabel_configs:
      - source_labels: [__journal__systemd_unit]
        target_label: unit
      - source_labels: [__journal__hostname]
        target_label: hostname
```

### Kubernetes DaemonSet 部署

```yaml
# promtail-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: promtail
  namespace: monitoring
spec:
  selector:
    matchLabels:
      app: promtail
  template:
    metadata:
      labels:
        app: promtail
    spec:
      serviceAccountName: promtail
      containers:
        - name: promtail
          image: grafana/promtail:2.9.0
          args:
            - -config.file=/etc/promtail/promtail.yaml
          env:
            - name: HOSTNAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          volumeMounts:
            - name: config
              mountPath: /etc/promtail
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: varlibdockercontainers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: runlogjournal
              mountPath: /run/log/journal
              readOnly: true
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
            limits:
              cpu: 200m
              memory: 256Mi
      volumes:
        - name: config
          configMap:
            name: promtail-config
        - name: varlog
          hostPath:
            path: /var/log
        - name: varlibdockercontainers
          hostPath:
            path: /var/lib/docker/containers
        - name: runlogjournal
          hostPath:
            path: /run/log/journal
```

## Grafana 日志面板

```json
{
  "title": "Application Logs",
  "uid": "app-logs",
  "panels": [
    {
      "title": "Log Stream",
      "type": "logs",
      "targets": [
        {
          "expr": "{app=\"order-service\", env=\"production\"}",
          "refId": "A"
        }
      ],
      "options": {
        "showLabels": true,
        "showCommonLabels": false,
        "showTime": true,
        "wrapLogMessage": false,
        "enableLogDetails": true,
        "dedupStrategy": "none",
        "prettifyLogMessage": true
      }
    },
    {
      "title": "Error Rate",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(rate({app=\"order-service\"} |~ \"ERROR\"[5m]))",
          "refId": "A"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "short",
          "thresholds": {
            "steps": [
              { "value": 0, "color": "green" },
              { "value": 1, "color": "yellow" },
              { "value": 10, "color": "red" }
            ]
          }
        }
      }
    },
    {
      "title": "Logs by Level",
      "type": "piechart",
      "targets": [
        {
          "expr": "sum by (level) (count_over_time({app=\"order-service\"}[5m]))",
          "refId": "A"
        }
      ]
    }
  ]
}
```

## LogQL 查询语法

```logql
# 基础查询
{app="order-service"}
{service=~"order.*"}

# 过滤日志级别
{app="order-service"} |= "ERROR"
{app="order-service"} |= "timeout" |= "connection"

# 正则过滤
{app="order-service"} |~ "user_id=\\d+"

# 排除特定日志
{app="order-service"} != "DEBUG"

# 统计错误数量
count_over_time({app="order-service"} |= "ERROR"[5m])

# 统计每秒日志量
rate({app="order-service"}[1m])

# 解析标签（使用 JSON 表达式）
{service="order"} | json | status_code >= 500

# 解析日志格式
{service="order"} | logfmt | level="error"

# 统计延迟 P99
quantile_over_time(0.99,
  {service="order"} | logfmt | unwrap latency_ms [5m]
) by (service)

# 时间聚合
sum by (level) (rate({app="order-service"}[5m]))

# 关联 Prometheus 指标
{service="order"}
  | json
  | status_code >= 500
  and latency_ms > 1000
  or (rate(http_requests_total[1m]) > 100)
```

## Loki 高可用部署

```yaml
# loki-distributed.yaml (微服务模式)
# Loki 在微服务模式下，将查询、写入、索引分开部署
apiVersion: loki.grafana.com/v1beta1
kind: LokiStack
metadata:
  name: loki
  namespace: monitoring
spec:
  size: 3x.medium
  storage:
    type: S3
    s3:
      endpoint: s3.amazonaws.com
      bucket: loki-data
      region: us-east-1
  replication:
    factor: 3
  limits:
    global:
      ingestion:
        ingestionRate: 50
        ingestionBurstSize: 100
      queries:
        queryTimeout: 30s
```

### S3 作为后端存储

```yaml
# loki-s3.yaml
common:
  storage:
    s3:
      endpoint: s3.amazonaws.com
      region: us-east-1
      bucketnames: loki-data
      s3forcepathstyle: false
    boltdb_shipper:
      shared_store: s3
```

## Loki + Grafana + Prometheus 统一监控

```yaml
# Grafana 配置 Loki 和 Prometheus
# grafana-datasources.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-datasources
  namespace: monitoring
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Prometheus
        type: prometheus
        access: proxy
        url: http://prometheus:9090
        isDefault: true

      - name: Loki
        type: loki
        access: proxy
        url: http://loki:3100
        jsonData:
          derivedFields:
            - name: TraceID
              matcherRegex: "trace_id=(\\w+)"
              url: "http://jaeger:16686/trace/$${__value.raw}"
              datasourceUid: jaeger
```

## 面试追问方向

1. **Loki 如何保证日志不丢失？**
   答：Promtail 使用本地文件缓存日志（positions.yaml），在 Loki 不可用时暂存日志；Loki 的 Distributor 使用 gRPC 流式接收日志并写入-ingester，ingester 将数据写入本地 WAL（Write-Ahead Log）后再确认；配置足够的副本数和持久化存储可以保证可靠性。

2. **Loki 和 Elasticsearch 的查询性能差异有多大？**
   答：对于标签筛选（`{app="order", level="error"}`），Loki 几乎和 Elasticsearch 一样快，因为只查索引；但对于全文搜索（`"exception in method"`），Elasticsearch 快得多，Loki 需要扫描日志行。实际选择取决于查询类型：标签筛选多选 Loki，关键词搜索多选 ELK。

3. **Loki 的标签设计有什么讲究？**
   答：Loki 的查询性能取决于标签的基数（Cardinality）。高基数标签（如 user_id、session_id、请求 ID）会导致索引过大和查询变慢。推荐的标签：app、namespace、env、level、host。日志正文中的关键词用 LogQL 的过滤器处理，而非标签。

4. **Promtail 和 Filebeat 哪个更好？**
   答：Promtail 专为 Loki 设计，支持 LogQL 语法转换；Filebeat 更通用，支持多种输出。对于新建的 Loki 基础设施，Promtail 是自然选择；对于已有的 ELK 基础设施想迁移到 Loki，Filebeat + Loki HTTP API 是过渡方案。

Loki 的核心理念是：「指标用 Prometheus，日志用 Loki」。在 Grafana 中一键切换指标图和日志视图，是它最大的卖点。
