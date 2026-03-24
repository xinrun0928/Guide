# Prometheus 架构：PromQL、Exporter、AlertManager

「Prometheus 怎么工作？」——拉取、存储、查询、告警四件套。

Prometheus 的架构看似简单（一个二进制跑起来），但理解 Server、Queryable、Remote Read/Write、Alertmanager 的关系，是构建可靠监控系统的关键。

## 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Prometheus 完整架构                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  Prometheus Server                          │  │
│  │  ┌──────────────┐ ┌─────────────┐ ┌─────────────┐     │  │
│  │  │  TSDB        │ │ Query Engine│ │ AlertMgr   │     │  │
│  │  │  (时序存储)   │ │ (PromQL)   │ │ (告警路由) │     │  │
│  │  └──────┬───────┘ └──────┬──────┘ └──────┬──────┘     │  │
│  │         │                │              │                 │  │
│  │  ┌──────┴───────┐ ┌────┴──────┐ ┌────┴──────┐     │  │
│  │  │  Retrieval   │ │ HTTP API  │ │ Notific.   │     │  │
│  │  │  (拉取引擎)  │ │ (查询接口) │ │ (通知)    │     │  │
│  │  └──────┬───────┘ └───────────┘ └──────┬──────┘     │  │
│  └──────────┼───────────────────────────────┼──────────────┘  │
│             │                               │                   │
│        ┌────┴────┐                    ┌─────┴─────┐             │
│        │ Exporter│                    │AlertManager│             │
│        │(指标暴露)│                    │(告警聚合) │             │
│        └────┬────┘                    └─────┬─────┘             │
│             │                               │                   │
│  ┌──────────┴──────────┐             ┌────┴──────┐             │
│  │  监控目标           │             │  Email/Slack │             │
│  │  K8s / VM / App    │             │  PagerDuty  │             │
│  └─────────────────────┘             └────────────┘             │
│                                                                  │
│  Remote Read/Write ◄──► Thanos/Cortex/其他存储                    │
└─────────────────────────────────────────────────────────────────┘
```

## Prometheus Server 核心组件

### Retrieval（拉取引擎）

```yaml
# prometheus.yml
scrape_configs:
  # 标准拉取
  - job_name: 'kubernetes-nodes'
    scrape_interval: 15s
    scrape_timeout: 10s
    metrics_path: /metrics
    scheme: http  # 或 https

    # 静态配置
    static_configs:
      - targets: ['node-exporter:9100']

    # Kubernetes 服务发现
    kubernetes_sd_configs:
      - role: node
      - role: pod
        namespaces:
          names:
            - production
      - role: service
      - role: endpoints

    # AWS EC2 服务发现
    ec2_sd_configs:
      - region: us-east-1
        access_key: xxx
        secret_key: xxx
        port: 9100

    # DNS 服务发现
    dns_sd_configs:
      - names:
          - 'prometheusTargets'
        refresh_interval: 30s
        type: A
        port: 9100

    # relabel_configs（在拉取前处理标签）
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_name]
        regex: (.+)
        target_label: pod
      - source_labels: [__meta_kubernetes_namespace]
        regex: (.+)
        target_label: namespace
      # 只保留带特定注解的 Pod
      - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
        regex: "true"
        action: keep
      # 添加环境标签
      - target_label: env
        replacement: production
```

### TSDB（时序存储）

```
┌─────────────────────────────────────────────────────────────────┐
│                    TSDB 存储结构                                │
│                                                                  │
│  写入路径：                                                    │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐   │
│  │  内存   │───►│  WAL    │───►│  Memory │───►│  Block  │   │
│  │ (Head)  │    │ (预写日志)│    │ (热点)  │    │ (持久块) │   │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘   │
│      即时写入        持久化         2小时合并      2小时或2h生成  │
│                                                                  │
│  Block 结构（2小时一段）：                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  chunk/         # 时序数据（逐点压缩）                    │   │
│  │    000001                               │               │
│  │    000002                               │               │
│  │  index           # 索引（反向索引）                       │   │
│  │  meta.json       # Block 元数据                          │   │
│  │  tombstones      # 软删除标记                            │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Query Engine（PromQL 引擎）

```promql
# 简单查询
node_cpu_seconds_total{mode="idle"}

# 聚合查询
avg by (instance) (rate(node_cpu_seconds_total[5m]))

# 子查询（嵌套查询）
# 计算 1 小时窗口内，每 5 分钟查询一次趋势
max_over_time(
  rate(http_requests_total[5m])[1h:5m]
)

# 记录规则（将复杂查询结果保存为新指标）
# prometheus.yml 中配置
rule_files:
  - "/etc/prometheus/rules/*.yml"
```

### Remote Read/Write（远程读写）

```yaml
# prometheus.yml
remote_write:
  # 写入远程存储（Thanos/Cortex）
  - url: http://thanos-receiver:19291/api/v1/receive
    queue_config:
      capacity: 10000
      max_shards: 5
      max_samples_per_send: 2000
      batch_send_deadline: 30s
    # 认证
    basic_auth:
      username: thanos
      password: xxx
    # 写前过滤
    metadata_config:
      send: true
      send_interval: 1m

remote_read:
  # 从远程读取
  - url: http://thanos-querier:10902/api/v1/read
    read_recent: true
    basic_auth:
      username: thanos
      password: xxx
```

## AlertManager

### 路由树

```yaml
# alertmanager.yml
route:
  # 根路由
  receiver: 'default-receiver'
  group_by: ['alertname', 'cluster', 'service']
  # 分组配置
  group_wait: 30s       # 等待 30s 聚合同类告警
  group_interval: 5m     # 每 5m 发送一次增量告警
  repeat_interval: 12h  # 告警未解决时，12h 重发
  # 子路由
  routes:
    - match:
        severity: critical
      receiver: 'pagerduty'
      continue: true  # 继续匹配后续规则
    - match:
        severity: warning
      receiver: 'slack'
    - match:
        team: backend
      receiver: 'backend-slack'
    - match:
        service: payment
      receiver: 'payment-critical'
      # 告警抑制（inhibit）
      # 如果 "cluster" 相同，"severity=critical" 会抑制 "severity=warning"
```

### 抑制规则

```yaml
inhibit_rules:
  # 源告警存在时，抑制目标告警
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    # 相同以下标签的告警会被抑制
    equal: ['alertname', 'cluster', 'service']
```

### 告警规则

```yaml
# prometheus-rules.yml
groups:
  - name: example
    interval: 30s  # 评估间隔
    rules:
      - alert: HighMemoryUsage
        expr: |
          (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) < 0.15
        for: 5m       # 持续 5 分钟才触发
        labels:
          severity: warning
          team: ops
        annotations:
          summary: "High memory usage on {{ $labels.instance }}"
          description: "Memory usage is {{ $value | humanizePercentage }}"

      - alert: K8sNodeNotReady
        expr: |
          kube_node_status_condition{condition="Ready",status="true"} == 0
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Node {{ $labels.node }} is NotReady"

      - alert: PodRestartingTooMuch
        expr: |
          increase(kube_pod_container_status_restarts_total[1h]) > 3
        for: 0m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.namespace }}/{{ $labels.pod }} restarted {{ $value }} times in 1h"
```

## 高可用方案

### 水平扩展（Federation）

```yaml
# 全局 Prometheus（聚合层）
scrape_configs:
  - job_name: 'federate'
    metrics_path: '/federate'
    params:
      match[]:
        - '{job="kubernetes-nodes"}'
        - '{job="kubernetes-pods"}'
    static_configs:
      - targets:
          - 'prometheus-a:9090'
          - 'prometheus-b:9090'
```

### Thanos（推荐方案）

```
┌─────────────────────────────────────────────────────────────────┐
│                    Thanos 架构                                    │
│                                                                  │
│  ┌──────────┐     ┌──────────┐     ┌──────────┐               │
│  │ Prometheus│────►│ Receiver │────►│ Object   │               │
│  │ (Sidecar) │     │ (写入)   │     │ Storage  │               │
│  └──────────┘     └──────────┘     │ (S3/GCS) │               │
│                                     └────┬─────┘               │
│                                          │                       │
│  ┌──────────────────────────────────────┴───────────────────┐  │
│  │                      Query Frontend                          │  │
│  │  ┌──────────┐     ┌──────────┐     ┌──────────┐       │  │
│  │  │  Store    │────►│  Query   │────►│  HTTP   │       │  │
│  │  │  Gateway │     │  (聚合)  │     │  API   │       │  │
│  │  └──────────┘     └──────────┘     └──────────┘       │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## 面试追问方向

1. **Prometheus 的写入流程是什么？**
   答：样本首先写入内存中的 Head Block，然后写入 WAL（预写日志）防止丢失。Prometheus 每 2 小时将内存中的数据压缩成持久 Block（Chunk）。Block 最终落盘（通过 Remote Write 发送到对象存储）。查询时，Prometheus 从内存和磁盘中并行读取，合并结果返回。

2. **Prometheus 如何保证告警不漏报？**
   答：AlertManager 的 `group_wait` 确保同类告警聚合发送；`repeat_interval` 确保未解决的告警定期重发；`inhibit_rules` 防止告警风暴；`silence` 用于临时静默；Prometheus 的 `for` 子句避免瞬时抖动触发告警。关键告警建议配合 PagerDuty 使用，多渠道通知。

3. **Prometheus 的局限性有哪些？**
   答：高基数标签（Cardinality）会导致内存爆炸；不支持动态扩缩容目标的自动发现（需要精心设计 relabel_configs）；长期存储需要 Thanos/Cortex；不支持跨集群统一视图（需要 Thanos Querier Federation）；查询复杂时 O(n) 扫描成本高。

4. **Thanos 的 Store Gateway 和 Query Frontend 作用是什么？**
   答：Store Gateway 从对象存储读取历史数据，实现无限历史存储；Query Frontend 在查询前缓存结果，实现查询加速，并发控制。两者组合让 Prometheus 从「本地存储」升级为「全局视图」。

理解 Prometheus 的架构，是构建大规模监控系统的第一步。它不是银弹，但在 80% 的场景下，它足够用。
