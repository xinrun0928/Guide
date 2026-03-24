# KubeSphere 日志收集与查询：Elasticsearch + FluentBit

「应用出问题了，怎么快速找到日志？」——KubeSphere 的日志系统帮你一站式搞定。

KubeSphere 的日志系统基于 Elasticsearch + FluentBit 构建，提供了多租户的日志收集、存储、查询和导出能力。开发者不需要 SSH 到服务器找日志，在 KubeSphere 控制台里就能检索、过滤、导出日志。

## 日志架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 日志架构                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    日志采集层（DaemonSet）                   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              FluentBit（每个节点一个 Pod）            │   │   │
│  │  │                                                      │   │   │
│  │  │  输入（Inputs）                                      │   │   │
│  │  │  ├── 容器日志（/var/log/pods/*/*.log）               │   │   │
│  │  │  ├── systemd 日志（journald）                       │   │   │
│  │  │  └── 文件日志（自定义路径）                          │   │   │
│  │  │                                                      │   │   │
│  │  │  过滤器（Filters）                                    │   │   │
│  │  │  ├── Kubernetes 元数据注入                           │   │   │
│  │  │  ├── 多租户标签注入                                  │   │   │
│  │  │  └── 日志解析（JSON/正则）                           │   │   │
│  │  │                                                      │   │   │
│  │  │  输出（Outputs）                                     │   │   │
│  │  │  ├── Elasticsearch                                  │   │   │
│  │  │  └── Kafka（可选，作为缓冲）                         │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    日志存储与检索层                            │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │                  Elasticsearch                      │   │   │
│  │  │                                                      │   │   │
│  │  │  Index 命名规则：                                    │   │   │
│  │  │  logstash-{workspace}-{date}                       │   │   │
│  │  │  例如：logstash-myapp-2024.01.15                   │   │   │
│  │  │                                                      │   │   │
│  │  │  每个 Index 包含的字段：                            │   │   │
│  │  │  - log：日志内容                                    │   │   │
│  │  │  - stream：stdout / stderr                        │   │   │
│  │  │  - time：日志时间                                  │   │   │
│  │  │  - kubernetes.namespace_name                       │   │   │
│  │  │  - kubernetes.pod_name                            │   │   │
│  │  │  - kubernetes.container_name                      │   │   │
│  │  │  - kubernetes.host                                 │   │   │
│  │  │  - workspace：所属工作空间（多租户隔离）              │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    KubeSphere Console（日志查询）             │   │
│  │                                                          │   │
│  │  - 多租户隔离：用户只能查询自己 Workspace 的日志              │   │
│  │  - 实时日志流                                            │   │
│  │  - 日志导出（JSON/CSV）                                   │   │
│  │  - 日志统计与趋势图                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 日志采集配置

### FluentBit 配置

```yaml
# FluentBit Operator 配置示例
apiVersion: fluentbit.fluent.io/v1alpha2
kind: FluentBitConfig
metadata:
  name: fluentbit-config
  namespace: kubesphere-logging-system
spec:
  # 输入配置
  input:
    tail: |
      [INPUT]
          Name              tail
          Path              /var/log/containers/*.log
          Parser            docker
          Tag               kube.*
          Refresh_Interval  5
          Mem_Buf_Limit    50MB
          Skip_Long_Lines  On
          DB                /var/log/flb_kube.db

  # 过滤器配置
  filter: |
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
        Annotations         On

    [FILTER]
        Name                modify
        Match               kube.*
        Add                 workspace ${WORKSPACE_NAME}
        Add                 cluster ${CLUSTER_NAME}

  # 输出配置
  output: |
    [OUTPUT]
        Name            es
        Match           kube.*
        Host            elasticsearch-logging-data.kubesphere-logging-system.svc
        Port            9200
        HTTP_User       elastic
        HTTP_Passwd     ${ES_PASSWORD}
        Logstash_Format On
        Logstash_Prefix logstash
        Logstash_DateFormat %Y.%m.%d
        Replace_Dots    On
        Retry_Limit     False
        tls             On
        tls.verify      Off
```

### 应用日志采集

```yaml
# 如果应用日志不是写入 stdout/stderr（而是写入文件）
# 需要额外配置日志路径

# 方式一：使用 sidecar 容器采集文件日志
apiVersion: v1
kind: Pod
metadata:
  name: myapp
  namespace: my-project
spec:
  containers:
    - name: app
      image: myapp:latest
      volumeMounts:
        - name: app-logs
          mountPath: /var/log/app

    - name: log-collector
      image: fluent/fluent-bit:latest
      volumeMounts:
        - name: app-logs
          mountPath: /var/log/app
        - name: fluentbit-config
          mountPath: /fluent-bit/etc/

  volumes:
    - name: app-logs
      emptyDir: {}
    - name: fluentbit-config
      configMap:
        name: app-log-config
```

## 日志查询

### KubeSphere 控制台查询

```
┌─────────────────────────────────────────────────────────────────┐
│                    日志查询界面                                   │
│                                                                  │
│  搜索框                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ namespace:my-project AND pod_name:order-service* AND   │   │
│  │ level:ERROR AND time:["2024-01-15T00:00:00Z" TO "..."] │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  快速过滤器                                                      │
│  - 时间范围（最近 15 分钟/1 小时/24 小时/自定义）                │
│  - 命名空间                                                     │
│  - 工作负载                                                      │
│  - 日志级别（INFO/WARN/ERROR）                                  │
│                                                                  │
│  日志格式                                                       │
│  - 结构化 JSON 日志自动解析                                      │
│  - 显示：时间、级别、Pod 名称、日志内容                          │
└─────────────────────────────────────────────────────────────────┘
```

### 日志查询语法

```bash
# Elasticsearch 查询语法（Kusto 查询语言）
# KubeSphere 支持类 KQL 的查询语法

# 基础查询
namespace: my-project                              # 限定命名空间
pod_name: order-service*                           # Pod 名称模糊匹配
log: *Exception*                                   # 日志内容关键词
level: ERROR                                      # 日志级别

# 组合查询
namespace: my-project AND level: ERROR           # 组合条件

# 时间范围
time: ["2024-01-15T00:00:00Z" TO "2024-01-15T23:59:59Z"]

# JSON 字段查询（结构化日志）
# 如果日志是 {"message": "...", "traceId": "xxx"}
traceId: abc123
message: database timeout

# 正则查询
log: /timeout.*connection/i

# 输出字段
# 在日志列表中显示哪些字段
# 默认：time、level、pod_name、log
# 可添加：workspace、container_name、host

# 日志统计
# 统计每分钟 ERROR 日志数量
# chart(type:count, time:minute) | filter(level:ERROR)
```

### 日志导出

```bash
# 在 KubeSphere 控制台
# 日志查询 → 选择时间范围 → 填写查询条件 → 导出

# 导出格式支持
# - JSON：结构化导出，便于程序处理
# - CSV：表格导出，便于分析
# - TEXT：纯文本导出

# 导出大小限制
# 单次导出最大 10MB
# 超过限制需要分批导出

# 通过命令行导出（如果有 Elasticsearch 访问权限）
curl -u elastic:${ES_PASSWORD} \
  "https://elasticsearch.kubesphere.logs:9200/logstash-myapp-*/_search" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": {
      "bool": {
        "filter": [
          { "match": { "kubernetes.namespace_name": "my-project" } },
          { "match": { "level": "ERROR" } }
        ]
      }
    },
    "size": 1000
  }'
```

## 多租户日志隔离

```bash
# KubeSphere 的多租户日志隔离通过 Elasticsearch Index 实现
# 每个 Workspace 有独立的 Index 前缀

# Index 命名
# logstash-{workspace-name}-{date}

# 例如：
# logstash-order-team-2024.01.15    → Workspace "order-team" 的日志
# logstash-payment-team-2024.01.15  → Workspace "payment-team" 的日志

# 隔离原理
# KubeSphere Console 查询日志时，自动加上 workspace 过滤条件
# 用户只能看到属于自己 Workspace 的 Index 中的日志

# 租户管理员可以查看 Workspace 内所有项目的日志
# 普通成员只能查看自己有权限的项目的日志
```

## 日志保留策略

```yaml
# Elasticsearch ILM（Index Lifecycle Management）配置
# 控制日志的保留时间和存储层级

apiVersion: elasticsearch.kubesphere.io/v1
kind: ElasticsearchIndexTemplate
metadata:
  name: logstash-template
spec:
  # 热数据存储（最近 7 天）
  # 使用高性能 SSD 存储
  warm: true
  warmAge: "7d"
  warmStorage: ssd-storage

  # 冷数据存储（7-30 天）
  # 使用普通磁盘
  cold: true
  coldAge: "30d"
  coldStorage: standard-storage

  # 删除策略（30 天后删除）
  delete: true
  deleteAge: "30d"

# 查看当前保留策略
# 在 KubeSphere 控制台 → 日志系统 → 索引管理
```

## 结构化日志最佳实践

```java
// 应用层输出结构化 JSON 日志
// KubeSphere 会自动解析 JSON 字段

// Spring Boot 配置 Logback 输出 JSON
// logback-spring.xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
        <encoder class="ch.qos.logback.core.encoder.LayoutWrappingEncoder">
            <layout class="ch.qos.logback.contrib.json.classic.JsonLayout">
                <timestampFormat>yyyy-MM-dd'T'HH:mm:ss.SSS'Z'</timestampFormat>
                <timestampFormatTimezoneId>UTC</timestampFormatTimezoneId>
                <appendLineSeparator>true</appendLineSeparator>
                <jsonFormatter class="ch.qos.logback.contrib.jackson.JacksonJsonFormatter">
                    <prettyPrint>false</prettyPrint>
                </jsonFormatter>
            </layout>
        </encoder>
    </appender>

    <root level="INFO">
        <appender-ref ref="JSON"/>
    </root>
</configuration>

// 日志输出示例
{
  "@timestamp": "2024-01-15T10:30:00.000Z",
  "level": "ERROR",
  "logger": "c.o.s.OrderService",
  "message": "Database connection failed",
  "traceId": "a1b2c3d4e5f6",
  "spanId": "g7h8i9j0",
  "service": "order-service",
  "version": "v1.2.3",
  "stack_trace": "java.sql.SQLException: Connection refused..."
}

// 结构化日志的优势
// 1. 字段可搜索：traceId:abc123 精确查找
// 2. 聚合分析：统计各 ERROR 类型的出现频率
// 3. 链路追踪：traceId 串联所有相关日志
```

## 面试追问方向

1. **FluentBit 和 Fluentd 有什么区别？**
   答：FluentBit 是 Fluentd 的轻量级替代品，专为边缘节点和容器环境设计。FluentBit 资源占用更低（通常 10-30MB 内存），启动更快，适合作为 DaemonSet 部署在每个 K8s 节点上。Fluentd 更强大，适合作为日志聚合服务器，处理海量日志。KubeSphere 选择 FluentBit 作为节点级日志采集器，兼顾性能和资源占用。

2. **如果 Elasticsearch 不可用了，已产生的日志会丢失吗？**
   答：FluentBit 有本地缓存机制（File Buffer），在输出目标不可用时会将日志写入本地磁盘缓冲区，重试成功后继续发送。但本地缓冲区大小有限（默认 50MB），如果长时间不可用，可能丢失日志。生产环境建议：1) 监控 Elasticsearch 健康状态；2) 配置 Kafka 作为缓冲层（可选）；3) FluentBit 设置合理的 buffer_chunksize 和 buffer_max_size。

3. **日志和监控、链路追踪三者的关系是什么？**
   答：三者构成可观测性的三大支柱。日志记录离散事件（What happened），告诉你具体发生了什么；监控记录聚合指标（How is it performing），告诉你系统运行状态；链路追踪记录请求路径（How did it happen），告诉你问题出在哪个环节。出现问题时：监控先发现异常 → 链路追踪定位瓶颈 → 日志定位根因。三者缺一不可。

> "结构化日志是日志系统的基础投资。上传 JSON 日志时多写几个字段，查日志时就能少掉几根头发。traceId、serviceName、version 这些字段，在排查问题时价值连城。"
