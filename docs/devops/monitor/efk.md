# EFK 栈：Elasticsearch + Fluentd + Kibana 日志方案

「Kubernetes 日志怎么查？」——EFK 是标准答案。

Pod 漂移、容器重启、日志文件分散在各个节点。传统的 SSH 登录机器查日志已经失效。EFK（Elasticsearch + Fluentd/Fluent Bit + Kibana）让日志从「大海捞针」变成「一键搜索」。它是 K8s 日志的工业标准。

## K8s 日志架构

```
┌─────────────────────────────────────────────────────────────────┐
│                 Kubernetes 日志采集三层架构                         │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    第一层：应用日志                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │  │
│  │  │ stdout     │  │ stderr      │  │ 文件日志     │           │  │
│  │  │ (容器控制台) │  │ (错误日志)  │  │ (应用写入)   │           │  │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │  │
│  │         │                │                │                   │  │
│  └─────────┼────────────────┼────────────────┼───────────────────┘  │
│            │                │                │                      │
│  ┌─────────┴────────────────┴────────────────┴───────────────────┐  │
│  │                    kubelet (日志收集)                          │  │
│  │  /var/log/containers/*.log  (容器 stdout)                    │  │
│  │  /var/log/pods/*/*.log     (Pod 日志)                         │  │
│  └────────────────────────────┬────────────────────────────────┘  │
│                                │                                    │
│  ┌────────────────────────────┴────────────────────────────────┐  │
│  │                    Fluent Bit (节点代理)                       │  │
│  │  tail /var/log/containers/*.log                              │  │
│  │  tail /var/log/pods/*/*.log                                  │  │
│  │  JSON 解析、标签添加、过滤                                     │  │
│  └────────────────────────────┬────────────────────────────────┘  │
│                                │                                    │
│  ┌────────────────────────────┴────────────────────────────────┐  │
│  │                    Fluentd (可选聚合层)                        │  │
│  │  缓冲、聚合、路由                                              │  │
│  │  output Elasticsearch / S3 / Kafka                            │  │
│  └────────────────────────────┬────────────────────────────────┘  │
│                                │                                    │
│  ┌────────────────────────────┴────────────────────────────────┐  │
│  │                 Elasticsearch (日志存储)                       │  │
│  │  index: logstash-2024.01.15                                 │  │
│  │  shard: 5 primary + 1 replica                               │  │
│  └────────────────────────────┬────────────────────────────────┘  │
│                                │                                    │
│  ┌────────────────────────────┴────────────────────────────────┐  │
│  │                      Kibana (日志搜索)                        │  │
│  │  Discover / Dashboard / Visualization                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Elasticsearch 集群部署

### 单节点测试

```yaml
# elasticsearch-single.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: elasticsearch
  namespace: logging
spec:
  serviceName: elasticsearch
  replicas: 1
  selector:
    matchLabels:
      app: elasticsearch
  template:
    metadata:
      labels:
        app: elasticsearch
    spec:
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
          ports:
            - containerPort: 9200
              name: http
            - containerPort: 9300
              name: transport
          env:
            - name: discovery.type
              value: single-node
            - name: xpack.security.enabled
              value: "false"
            - name: ES_JAVA_OPTS
              value: "-Xms2g -Xmx2g"
          resources:
            requests:
              cpu: "500m"
              memory: "2Gi"
            limits:
              cpu: "2"
              memory: "4Gi"
          volumeMounts:
            - name: elasticsearch-data
              mountPath: /usr/share/elasticsearch/data
          livenessProbe:
            tcpSocket:
              port: 9300
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /_cluster/health
              port: 9200
            initialDelaySeconds: 10
            periodSeconds: 5
  volumeClaimTemplates:
    - metadata:
        name: elasticsearch-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: "ssd"
        resources:
          requests:
            storage: 100Gi
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

### 生产集群配置

```yaml
# elasticsearch-cluster.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: elasticsearch-master
  namespace: logging
spec:
  serviceName: elasticsearch-master
  replicas: 3
  selector:
    matchLabels:
      app: elasticsearch-master
  template:
    metadata:
      labels:
        app: elasticsearch-master
    spec:
      initContainers:
        - name: fix-permissions
          image: busybox
          command: ["sh", "-c", "chown -R 1000:1000 /usr/share/elasticsearch/data"]
          volumeMounts:
            - name: elasticsearch-data
              mountPath: /usr/share/elasticsearch/data
        - name: increase-vm-max-map
          image: busybox
          command: ["sysctl", "-w", "vm.max_map_count=262144"]
          securityContext:
            privileged: true
      containers:
        - name: elasticsearch
          image: docker.elastic.co/elasticsearch/elasticsearch:8.12.0
          ports:
            - containerPort: 9200
              name: http
            - containerPort: 9300
              name: transport
          env:
            - name: cluster.name
              value: k8s-logs
            - name: node.name
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: discovery.seed_hosts
              value: "elasticsearch-master-0.elasticsearch-master,elasticsearch-master-1.elasticsearch-master,elasticsearch-master-2.elasticsearch-master"
            - name: cluster.initial_master_nodes
              value: "elasticsearch-master-0,elasticsearch-master-1,elasticsearch-master-2"
            - name: ES_JAVA_OPTS
              value: "-Xms4g -Xmx4g"
            - name: xpack.security.enabled
              value: "false"
            - name: action.auto_create_index
              value: "true"
          resources:
            requests:
              cpu: "1"
              memory: "4Gi"
            limits:
              cpu: "2"
              memory: "8Gi"
          volumeMounts:
            - name: elasticsearch-data
              mountPath: /usr/share/elasticsearch/data
          readinessProbe:
            httpGet:
              path: /_cluster/health?wait_for_status=yellow&timeout=5s
              port: 9200
            initialDelaySeconds: 10
            periodSeconds: 10
  volumeClaimTemplates:
    - metadata:
        name: elasticsearch-data
      spec:
        accessModes: ["ReadWriteOnce"]
        storageClassName: "ssd"
        resources:
          requests:
            storage: 200Gi
```

## Fluent Bit 部署

### DaemonSet 部署

```yaml
# fluentbit.yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: fluent-bit
  namespace: logging
  labels:
    app: fluent-bit
spec:
  selector:
    matchLabels:
      app: fluent-bit
  template:
    metadata:
      labels:
        app: fluent-bit
    spec:
      serviceAccountName: fluent-bit
      containers:
        - name: fluent-bit
          image: cr.fluentbit.io/fluent/fluent-bit:3.0.1
          ports:
            - containerPort: 2020
              name: http
          env:
            - name: NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          resources:
            requests:
              cpu: 50m
              memory: 50Mi
            limits:
              cpu: 200m
              memory: 200Mi
          volumeMounts:
            - name: varlog
              mountPath: /var/log
              readOnly: true
            - name: varlibdockercontainers
              mountPath: /var/lib/docker/containers
              readOnly: true
            - name: fluent-bit-config
              mountPath: /fluent-bit/etc
          livenessProbe:
            httpGet:
              path: /
              port: 2020
            initialDelaySeconds: 10
            periodSeconds: 10
      volumes:
        - name: varlog
          hostPath:
            path: /var/log
        - name: varlibdockercontainers
          hostPath:
            path: /var/lib/docker/containers
        - name: fluent-bit-config
          configMap:
            name: fluent-bit-config
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluent-bit-config
  namespace: logging
data:
  fluent-bit.conf: |
    [SERVICE]
        Flush         5
        Log_Level     info
        Daemon        off
        Parsers_File  parsers.conf
        HTTP_Server   On
        HTTP_Listen   0.0.0.0
        HTTP_Port     2020
        Health_Check  On

    [INPUT]
        Name              tail
        Path              /var/log/containers/*.log
        Parser            docker
        Tag               kube.*
        Refresh_Interval  5
        Mem_Buf_Limit     50MB
        Skip_Long_Lines   On
        DB                /var/log/flb_kube.db

    [INPUT]
        Name              tail
        Path              /var/log/pods/*/*/*.log
        Parser            cri
        Tag               kube.*
        Refresh_Interval  5
        Mem_Buf_Limit     50MB
        Skip_Long_Lines   On

    [FILTER]
        Name                kubernetes
        Match               kube.*
        Kube_URL            https://kubernetes.default.svc:443
        Kube_CA_File        /var/run/secrets/kubernetes.io/serviceaccount/ca.crt
        Kube_Token_File     /var/run/secrets/kubernetes.io/serviceaccount/token
        Kube_Tag_Prefix     kube.var.log.containers.
        Merge_Log           On
        Merge_Log_Key       log_processed
        K8S-Logging.Parser  On
        K8S-Logging.Exclude On
        Labels              On
        Annotations         Off

    [OUTPUT]
        Name            es
        Match           kube.*
        Host            elasticsearch.logging.svc.cluster.local
        Port            9200
        HTTP_User       elastic
        HTTP_Passwd     changeme
        Logstash_Format On
        Logstash_Prefix k8s
        Retry_Limit     False
        Replace_Dots    On
        Suppress_Type_Name On
        # 缓冲配置
        buffer          yes
        buffer.type      filesystem
        buffer.path      /var/log/fluent-bit-buffer/
        buffer.total_size_size  100M
        buffer.flush_interval   10
        buffer.tag            kube.*

  parsers.conf: |
    [PARSER]
        Name        docker
        Format      json
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L
        Time_Keep   On

    [PARSER]
        Name        cri
        Format      regex
        Regex       ^(?<time>[^ ]+) (?<stream>stdout|stderr) (?<logtag>[^ ]*) (?<log>.*)$
        Time_Key    time
        Time_Format %Y-%m-%dT%H:%M:%S.%L%z
        Time_Keep   On

    [PARSER]
        Name        json
        Format      json
        Time_Key    timestamp
        Time_Format %Y-%m-%dT%H:%M:%S.%LZ
```

## Fluentd 聚合层（可选）

```yaml
# fluentd-aggregation.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fluentd-aggregation
  namespace: logging
spec:
  replicas: 2
  selector:
    matchLabels:
      app: fluentd-agg
  template:
    metadata:
      labels:
        app: fluentd-agg
    spec:
      containers:
        - name: fluentd
          image: fluent/fluentd:v1.16-1
          ports:
            - containerPort: 24224
              name: forward
            - containerPort: 24230
              name: metrics
          env:
            - name: FLUENTD_CONF
              value: fluent.conf
          resources:
            requests:
              cpu: 100m
              memory: 200Mi
            limits:
              cpu: 500m
              memory: 1Gi
          volumeMounts:
            - name: fluentd-config
              mountPath: /fluentd/etc
            - name: buffer
              mountPath: /fluentd/buffer
      volumes:
        - name: fluentd-config
          configMap:
            name: fluentd-config
        - name: buffer
          emptyDir: {}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: logging
data:
  fluent.conf: |
    # 接收 Fluent Bit 数据
    <source>
      @type forward
      @id input_forward
      port 24224
      bind 0.0.0.0
    </source>

    # Prometheus Metrics
    <source>
      @type prometheus
      @id input_prometheus
      port 24230
      bind 0.0.0.0
    </source>

    # Kubernetes 容器日志
    <filter kube.**>
      @type parser
      key_name log
      <parse>
        @type json
        time_key time
        time_format %Y-%m-%dT%H:%M:%S.%L
      </parse>
    </filter>

    # 添加元数据
    <filter kube.**>
      @type record_transformer
      <record>
        hostname "#{Socket.gethostname}"
        cluster ${CLUSTER_NAME}
        environment ${ENVIRONMENT}
      </record>
    </filter>

    # 过滤敏感信息
    <filter kube.**>
      @type grep
      <exclude>
        key log
        pattern /password|token|secret|api.key/i
      </exclude>
    </filter>

    # 输出到 Elasticsearch
    <match kube.**>
      @type elasticsearch
      @id output_es
      host elasticsearch.logging.svc.cluster.local
      port 9200
      logstash_format true
      logstash_prefix k8s-prod
      logstash_dateformat %Y.%m.%d
      include_tag_key true
      tag_key _tag
      flush_interval 10s
      buffer_type file
      buffer_path /fluentd/buffer/es.buffer
      buffer_queue_full_action block
      buffer_chunk_limit 2M
      buffer_queue_limit 256
      max_retry_wait 30
      disable_retry_limit
      num_threads 8
    </match>
```

## Kibana 配置

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
          image: docker.elastic.co/kibana/kibana:8.12.0
          ports:
            - containerPort: 5601
              name: http
          env:
            - name: ELASTICSEARCH_HOSTS
              value: '["http://elasticsearch:9200"]'
            - name: SERVER_NAME
              value: kibana
            - name: SERVER_BASEPATH
              value: ""
          resources:
            requests:
              cpu: 200m
              memory: 500Mi
            limits:
              cpu: "1"
              memory: "2Gi"
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
      targetPort: 5601
---
# Ingress
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: kibana
  namespace: logging
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  rules:
    - host: kibana.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: kibana
                port:
                  number: 5601
```

## 日志索引生命周期管理

```bash
# 创建 ILM Policy
curl -X PUT "localhost:9200/_ilm/policy/k8s-logs-policy" -H 'Content-Type: application/json' -d'
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_primary_shard_size": "50gb",
            "max_age": "7d"
          },
          "set_priority": {
            "priority": 100
          }
        }
      },
      "warm": {
        "min_age": "30d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          },
          "set_priority": {
            "priority": 50
          }
        }
      },
      "cold": {
        "min_age": "60d",
        "actions": {
          "set_priority": {
            "priority": 0
          },
          "freeze": {}
        }
      },
      "delete": {
        "min_age": "90d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
'

# 创建 Index Template
curl -X PUT "localhost:9200/_index_template/k8s-logs-template" -H 'Content-Type: application/json' -d'
{
  "index_patterns": ["k8s*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "k8s-logs-policy"
    },
    "mappings": {
      "properties": {
        "@timestamp": {
          "type": "date"
        },
        "kubernetes": {
          "properties": {
            "pod_name": { "type": "keyword" },
            "namespace_name": { "type": "keyword" },
            "container_name": { "type": "keyword" },
            "host": { "type": "keyword" },
            "pod_id": { "type": "keyword" },
            "labels": { "type": "object" }
          }
        },
        "log": { "type": "text" },
        "stream": { "type": "keyword" }
      }
    }
  }
}
'
```

## 常见问题

```
# 问题一：日志丢失
# 原因：Fluent Bit 缓冲区满了，Pod 被删除时缓冲区未刷新
# 解决：使用 Fluentd 聚合层做缓冲；增大 buffer 空间

# 问题二：Elasticsearch OOM
# 原因：索引副本数过多、shard 数量过多
# 解决：设置 ILM 策略；控制单节点 shard 数量（< 20 万）

# 问题三：日志查询慢
# 原因：未按时间范围查询；mapping 设置不合理
# 解决：按日期创建索引；Kibana 设置默认时间过滤器

# 问题四：Fluent Bit 资源占用高
# 原因：日志量太大，采集配置不够优化
# 解决：调整 Flush Interval；使用 Mem_Buf_Limit 限制
```

## 面试追问方向

1. **Docker 和 Kubernetes 的日志格式有什么区别？**
   答：Docker 早期日志格式是 JSON，每行一个 JSON 对象，包含 `log`、`stream`、`time`；Kubernetes（Container Runtime Interface）日志格式是 `时间 stream logtag 日志内容`，需要用 CRI Parser 解析。Fluent Bit 的 `parsers.conf` 中需要同时配置 `docker` 和 `cri` 两个解析器。

2. **为什么需要 Fluentd/Fluent Bit 聚合层？**
   答：Fluent Bit 轻量但功能有限，适合节点级采集；Fluentd 功能丰富，支持复杂的路由、过滤、聚合，适合聚合层。在大规模集群中，Fluent Bit 只负责采集和初步处理，Fluentd 负责缓冲、路由、输出到多个目标。

3. **Elasticsearch 索引设计有什么讲究？**
   答：按时间滚动（daily/weekly），避免单个索引过大；索引名包含日期便于管理；副本数根据可用性需求设置；设置 Index Lifecycle Management 自动管理热/冷/删除阶段；避免过多字段映射（mapping explosion）。

4. **如何处理日志中的敏感信息？**
   答：方案一：Fluentd/Fluent Bit 过滤，使用 record_transformer 或 grep 插件替换/脱敏；方案二：应用层不打印敏感信息日志；方案三：Elasticsearch 字段权限控制（X-Pack Security）；生产环境建议组合使用。

日志是排查问题的第一手资料。EFK 栈让日志从「机器上的文件」变成「可搜索的数据」。
