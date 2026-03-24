# ELK 日志收集体系

「日志怎么管理？」——ELK 是日志收集与分析的标准方案。

日志是排查故障的第一手资料。当系统出问题的时候，你最需要的往往不是监控图表，而是日志。但单机日志文件分散、grep 不够用、查询效率低、无法关联分析——ELK（Elasticsearch + Logstash/Vector + Kibana）解决这些问题，把分散在各个角落的日志汇聚起来，让你能搜、能分析、能告警。

## ELK 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      ELK 日志处理流程                            │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐  ┌──────────┐ │
│  │  应用    │────►│ Logstash│────►│Elasticsea│──►│  Kibana  │ │
│  │  (文件/  │     │ (采集+  │     │  (存储+  │  │  (可视化) │ │
│  │   容器)  │     │  解析)  │     │  搜索)   │  │          │ │
│  └──────────┘     └──────────┘     └──────────┘  └──────────┘ │
│       │                                     │                   │
│  ┌──────────┐                   ┌────────────────────────────┐│
│  │  Beats   │                   │     Beats (轻量级采集器)    ││
│  │ (Filebeat│                   │  Filebeat Metricbeat       ││
│  │  Journald│                   │  Packetbeat Heartbeat      ││
│  │  ... )   │                   └────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Elasticsearch

Elasticsearch 是分布式搜索引擎，用于存储和搜索日志。

### 安装

```bash
# Docker 部署（开发环境）
docker network create elastic
docker run -d \
  --name elasticsearch \
  --net elastic \
  -p 9200:9200 \
  -p 9300:9300 \
  -e "discovery.type=single-node" \
  -e "xpack.security.enabled=false" \
  -e "ES_JAVA_OPTS=-Xms512m -Xmx512m" \
  elasticsearch:8.11.0

# 访问测试
curl http://localhost:9200
```

### Kubernetes 部署（生产环境）

```yaml
# elasticsearch.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: elasticsearch
  namespace: logging
spec:
  serviceName: elasticsearch
  replicas: 3
  selector:
    matchLabels:
      app: elasticsearch
  template:
    metadata:
      labels:
        app: elasticsearch
    spec:
      initContainers:
        - name: fix-permissions
          image: busybox
          command:
            - sh
            - -c
            - chown -R 1000:1000 /usr/share/elasticsearch/data
          volumeMounts:
            - name: data
              mountPath: /usr/share/elasticsearch/data
        - name: increase-vm-max-map
          image: busybox
          command:
            - sysctl
            - -w
            - vm.max_map_count=262144
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.11.0
          ports:
            - containerPort: 9200
              name: http
            - containerPort: 9300
              name: transport
          env:
            - name: cluster.name
              value: my-cluster
            - name: node.name
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: discovery.seed_hosts
              value: "elasticsearch-0.elasticsearch,elasticsearch-1.elasticsearch,elasticsearch-2.elasticsearch"
            - name: ES_JAVA_OPTS
              value: "-Xms2g -Xmx2g"
            - name: xpack.security.enabled
              value: "false"
          resources:
            requests:
              cpu: "1"
              memory: 2Gi
            limits:
              cpu: "2"
              memory: 4Gi
          volumeMounts:
            - name: data
              mountPath: /usr/share/elasticsearch/data
          readinessProbe:
            httpGet:
              path: /_cluster/health?wait_for_status=yellow&timeout=5s
              port: 9200
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: elasticsearch-data
---
apiVersion: v1
kind: Service
metadata:
  name: elasticsearch
  namespace: logging
spec:
  clusterIP: None
  selector:
    app: elasticsearch
  ports:
    - port: 9200
      name: http
    - port: 9300
      name: transport
```

## Logstash

Logstash 负责采集、解析、转换日志。

### logstash.conf

```conf
# logstash.conf
input {
  # 从文件读取
  file {
    path => "/var/log/**/*.log"
    start_position => "beginning"
    sincedb_path => "/var/lib/logstash/sincedb"
    codec => json
    type => "app-log"
  }

  # 从 Beats 接收
  beats {
    port => 5044
    type => "filebeat"
  }

  # 从 Kafka 读取
  kafka {
    bootstrap_servers => "kafka:9092"
    topics => ["app-logs", "nginx-logs"]
    group_id => "logstash"
    codec => json
    type => "kafka"
  }

  # 从 Syslog 读取
  syslog {
    port => 514
    type => "syslog"
  }
}

filter {
  # 处理 JSON 格式日志
  if [type] == "app-log" {
    json {
      source => "message"
      target => "parsed"
    }
    mutate {
      rename => {
        "[parsed][timestamp]" => "log_timestamp"
        "[parsed][level]" => "log_level"
        "[parsed][service]" => "service_name"
        "[parsed][message]" => "log_message"
      }
      remove_field => ["parsed", "message"]
    }
  }

  # 处理 Nginx 日志
  if [type] == "nginx" {
    grok {
      match => {
        "message" => "%{IPORHOST:client_ip} - %{DATA:user} \[%{HTTPDATE:timestamp}\] \"%{WORD:method} %{URIPATHPARAM:request} HTTP/%{NUMBER:http_version}\" %{NUMBER:status:int} %{NUMBER:bytes:int} \"%{DATA:referrer}\" \"%{DATA:user_agent}\""
      }
    }
    geoip {
      source => "client_ip"
      target => "geoip"
    }
    useragent {
      source => "user_agent"
      target => "ua"
    }
    mutate {
      convert => {
        "bytes" => "integer"
        "status" => "integer"
      }
    }
  }

  # 时间戳处理
  date {
    match => ["log_timestamp", "ISO8601", "yyyy-MM-dd HH:mm:ss"]
    target => "@timestamp"
  }

  # 标签和分类
  mutate {
    add_tag => ["%{type}"]
  }

  # 丢弃调试日志
  if [log_level] == "DEBUG" {
    drop {}
  }
}

output {
  # 输出到 Elasticsearch
  elasticsearch {
    hosts => ["elasticsearch:9200"]
    index => "app-logs-%{+YYYY.MM.dd}"
    user => ""
    password => ""
  }

  # 输出到 Kafka（可选）
  kafka {
    bootstrap_servers => "kafka:9092"
    topic_id => "processed-logs"
    codec => json
  }

  # 标准输出（调试）
  stdout {
    codec => rubydebug
  }
}
```

## Filebeat

Filebeat 是轻量级日志采集器，适合在每个节点部署。

### 配置

```yaml
# filebeat.yml
filebeat.inputs:
  # 应用日志
  - type: log
    enabled: true
    paths:
      - /var/log/app/*.log
    json.keys_under_root: true
    json.add_error_key: true
    fields:
      type: app-log
      env: production
    fields_under_root: true

  # Nginx 日志
  - type: log
    enabled: true
    paths:
      - /var/log/nginx/access.log
    fields:
      type: nginx-access
      env: production
    fields_under_root: true

  - type: log
    enabled: true
    paths:
      - /var/log/nginx/error.log
    fields:
      type: nginx-error
      env: production
    fields_under_root: true

  # Docker 容器日志（通过 journald）
  - type: journald
    paths:
      - /var/log/journal
    include_matches:
      - "_SYSTEMD_UNIT=docker.service"

processors:
  - add_host_metadata:
      when.not.contains.tags: forwarded
  - add_cloud_metadata: ~
  - add_docker_metadata: ~
  - decode_json_fields:
      fields: ["message"]
      target: ""
      overwrite_keys: true
      add_error_key: true
  - drop_event:
      when:
        regexp:
          message: "^DEBUG"

output.elasticsearch:
  hosts: ["elasticsearch:9200"]
  index: "filebeat-%{[type]}-%{+yyyy.MM.dd}"

setup.template:
  name: "filebeat"
  pattern: "filebeat-*"
  settings:
    index.number_of_shards: 2
    index.number_of_replicas: 1

setup.ilm.enabled: true
setup.ilm.rollover_alias: "filebeat"
setup.ilm.pattern: "{now/d}-000001"
setup.ilm.policy_name: "filebeat-policy"
```

### Kubernetes 部署

```yaml
# filebeat-daemonset.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: filebeat
  namespace: logging
spec:
  selector:
    matchLabels:
      app: filebeat
  template:
    metadata:
      labels:
        app: filebeat
    spec:
      serviceAccountName: filebeat
      terminationGracePeriodSeconds: 30
      containers:
        - name: filebeat
          image: docker.elastic.co/beats/filebeat:8.11.0
          args:
            - -c
            - /etc/filebeat.yml
            - -e
          securityContext:
            runAsUser: 0
            capabilities:
              add:
                - SYS_ADMIN
          volumeMounts:
            - name: config
              mountPath: /etc/filebeat.yml
              subPath: filebeat.yml
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
              memory: 100Mi
            limits:
              cpu: 200m
              memory: 200Mi
      volumes:
        - name: config
          configMap:
            name: filebeat-config
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

## Kibana

Kibana 是 Elasticsearch 的可视化界面。

### 部署

```yaml
# kibana.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kibana
  namespace: logging
spec:
  replicas: 1
  selector:
    matchLabels:
      app: kibana
  template:
    metadata:
      labels:
        app: kibana
    spec:
      containers:
        - name: kibana
          image: docker.elastic.co/kibana/kibana:8.11.0
          ports:
            - containerPort: 5601
          env:
            - name: ELASTICSEARCH_HOSTS
              value: '["http://elasticsearch:9200"]'
            - name: SERVER_NAME
              value: "kibana.example.com"
            - name: SERVER_BASEPATH
              value: ""
          resources:
            requests:
              cpu: 200m
              memory: 512Mi
            limits:
              cpu: 500m
              memory: 1Gi
          readinessProbe:
            httpGet:
              path: /api/status
              port: 5601
            initialDelaySeconds: 10
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: kibana
  namespace: logging
spec:
  selector:
    app: kibana
  ports:
    - port: 5601
  type: NodePort
```

### Kibana Discover 查询

```kql
# 搜索包含 "ERROR" 的日志
message: ERROR

# 搜索特定服务的日志
service_name: "order-service"

# 搜索错误码
status: 500

# 组合查询
service_name: "order-service" AND status: >= 500

# 按时间范围过滤
@timestamp: [now-1h TO now]

# 按字段聚合
avg(response_time)

# 按时间分桶
date_histogram(field: "@timestamp", interval: 1m)
```

## 日志索引生命周期管理

```yaml
# elasticsearch-index-lifecycle.yaml
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: Elasticsearch
metadata:
  name: elasticsearch
  namespace: logging
spec:
  version: 8.11.0
  nodeSets:
    - name: default
      count: 3
      volumeClaimTemplates:
        - name: data
          spec:
            storageClassName: standard
            resources:
              requests:
                storage: 100Gi
  indexLifecycleManagement:
    name: my-policy
---
apiVersion: elasticsearch.k8s.elastic.co/v1
kind: IndexLifecyclePolicy
metadata:
  name: app-logs-policy
  namespace: logging
spec:
  policy:
    phases:
      hot:
        min_age: 0ms
        actions:
          rollover:
            max_age: 7d
            max_size: 50gb
          set_priority:
            priority: 100
      warm:
        min_age: 30d
        actions:
          shrink:
            number_of_shards: 1
          forcemerge:
            max_num_segments: 1
          set_priority:
            priority: 50
          allocate:
            number_of_replicas: 0
      cold:
        min_age: 90d
        actions:
          set_priority:
            priority: 0
          allocate:
            number_of_replicas: 0
      delete:
        min_age: 365d
        actions:
          delete: {}
```

## 面试追问方向

1. **ELK 和 Loki 的区别是什么？**
   答：ELK 使用 Elasticsearch 存储日志，支持全文索引和复杂聚合查询，存储成本较高；Loki 使用对象存储（如 S3）存储日志，仅索引元标签（labels），存储成本极低但查询能力不如 Elasticsearch。Loki + Promtail + Grafana 的组合适合「指标用 Prometheus，日志用 Loki」的统一监控场景。

2. **Filebeat 和 Logstash 的区别是什么？**
   答：Filebeat 是轻量级采集器（Go 语言），部署在每个节点上，负责收集日志并发送到 Logstash 或 Elasticsearch，占用资源极少；Logstash 是重量级处理引擎（JVM），负责解析、过滤、转换日志，可以处理复杂的 ETL 流程。两者通常组合使用：Filebeat 采集，Logstash 处理，Elasticsearch 存储。

3. **如何处理高并发的日志写入？**
   答：使用 Kafka 或 Redis 作为缓冲层，Logstash 从缓冲层消费；增加 Logstash 实例和 Kafka Partition 数量实现水平扩展；使用 Bulk API 批量写入 Elasticsearch；配置 Elasticsearch 索引模板的分片数和副本数；使用 ILM（Index Lifecycle Management）自动管理索引的冷热切换和清理。

4. **Elasticsearch 集群的容量规划怎么做？**
   答：单条日志按 500~2000 字节估算；主分片数量 = 预期日数据量 / 单分片容量（建议 30~50GB）；副本数根据可用性要求配置（开发环境 0，生产至少 1）；存储空间 = 原始数据量 *（1 + 副本数）/（1 - 磁盘预留比例 10%）*（1 + 索引开销 10%）。建议监控集群健康状态和磁盘使用率，提前扩容。

日志是系统的心跳。ELK 让你从噪音中找到信号，从信号中定位问题。
