# Metricbeat 系统与服务指标采集

日志告诉你「发生了什么」，而指标告诉你「系统状态如何」。Metricbeat 正是采集系统指标的利器。

## 1. Metricbeat 简介

### 1.1 什么是 Metricbeat？

Metricbeat 是 Elastic 官方提供的指标采集器，定期采集系统和服务指标，发送到 ES 或 Logstash。

```
Metricbeat 采集的指标类型：
├─ 系统指标：CPU、内存、磁盘、网络
├─ 服务指标：Nginx、MySQL、Redis、Kafka
├─ 容器指标：Docker、Kubernetes
└─ 自定义指标：通过模块扩展
```

### 1.2 Metricbeat vs 其他方案

| 方案 | Metricbeat | Prometheus | Zabbix |
|-----|-----------|-----------|--------|
| 数据存储 | ES | Prometheus | Zabbix DB |
| 采集方式 | 拉取 | 拉取 | 拉取/推送 |
| 指标类型 | 多种 | 自定义 | 自定义 |
| 与 ELK 集成 | 原生 | 需要适配 | 需要适配 |
| 适用场景 | ELK 生态 | Prometheus 生态 | 传统监控 |

## 2. 模块系统

Metricbeat 使用模块来采集不同类型的指标：

```
┌─────────────────────────────────────────────────────────────┐
│                    Metricbeat 模块                          │
│                                                               │
│   system              # 系统指标                              │
│   ├─ cpu             # CPU 指标                             │
│   ├─ memory          # 内存指标                             │
│   ├─ network         # 网络指标                             │
│   └─ process         # 进程指标                             │
│                                                               │
│   nginx              # Nginx 指标                            │
│   ├─ stubstatus      # 状态指标                             │
│   └─ logs            # Nginx 日志                           │
│                                                               │
│   mysql              # MySQL 指标                           │
│   ├─ status          # 状态指标                             │
│   ├─ performance     # 性能指标                             │
│   └─ binarylogs     # 二进制日志                           │
│                                                               │
│   redis              # Redis 指标                           │
│   ├─ info            # 信息指标                             │
│   └─ keyspace        # 键空间                               │
│                                                               │
│   docker             # Docker 指标                           │
│   ├─ container       # 容器                                 │
│   ├─ cpu             # CPU                                  │
│   └─ memory          # 内存                                 │
│                                                               │
│   kubernetes         # K8s 指标                             │
│   ├─ container       # 容器                                 │
│   ├─ node           # 节点                                 │
│   └─ pod             # Pod                                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 3. 系统指标采集

### 3.1 基础配置

```java
# metricbeat.yml
metricbeat.modules:
  # 系统模块
  - module: system
    enabled: true
    period: 10s
    metricsets:
      - cpu
      - memory
      - network
      - process
      - diskio
      - filesystem
      - fsstat

# 输出配置
output.elasticsearch:
  hosts: ["es:9200"]
  index: "metricbeat-%{[agent.version]}-%{+yyyy.MM.dd}"
```

### 3.2 指标详解

**CPU 指标：**

```java
{
  "system.cpu.idle": 85.5,           // CPU 空闲率
  "system.cpu.user": 10.2,           // 用户态使用率
  "system.cpu.system": 4.3,          // 系统态使用率
  "system.cpu.iowait": 0.0,          // IO 等待率
  "system.cpu.stolen": 0.0,         // 被虚拟化偷走
  "system.cpu.cores": 8              // 核心数
}
```

**内存指标：**

```java
{
  "system.memory.total": 33554432000,  // 总内存（字节）
  "system.memory.used": 20971520000,  // 已使用
  "system.memory.free": 12582912000,  // 空闲
  "system.memory.swap.total": 8589934592,  // 交换区总量
  "system.memory.swap.used": 1073741824,   // 交换区已用
  "system.memory.swap.free": 7516192768    // 交换区空闲
}
```

**网络指标：**

```java
{
  "system.network.name": "eth0",
  "system.network.bytes.rx": 1234567890,    // 接收字节
  "system.network.bytes.tx": 987654321,     // 发送字节
  "system.network.packets.rx": 1234567,     // 接收包数
  "system.network.packets.tx": 987654,       // 发送包数
  "system.network.errors.rx": 0,            // 接收错误
  "system.network.errors.tx": 0              // 发送错误
}
```

## 4. 服务指标采集

### 4.1 Nginx 指标

**前提条件：启用 stub_status**

```nginx
# Nginx 配置
server {
    location /status {
        stub_status on;
        access_log off;
        allow 127.0.0.1;
        deny all;
    }
}
```

**Metricbeat 配置：**

```java
metricbeat.modules:
  - module: nginx
    enabled: true
    period: 10s
    hosts: ["http://nginx:80"]
    metricsets:
      - stubstatus
    # stubstatus 配置
    nginx.stubstatus.url: "http://nginx:80/status"
    nginx.stubstatus.response_timeout: 30s
```

**采集到的指标：**

```java
{
  "nginx.stubstatus.active": 1,         // 活跃连接数
  "nginx.stubstatus.accepts": 12345,     // 接受的连接总数
  "nginx.stubstatus.handled": 12345,     // 处理的连接总数
  "nginx.stubstatus.requests": 98765,    // 请求总数
  "nginx.stubstatus.reading": 0,        // 读取中的连接
  "nginx.stubstatus.writing": 1,        // 写入中的连接
  "nginx.stubstatus.waiting": 0          // 等待中的连接
}
```

### 4.2 MySQL 指标

**Metricbeat 配置：**

```java
metricbeat.modules:
  - module: mysql
    enabled: true
    period: 10s
    hosts:
      - user: "metricbeat"
        password: "${MYSQL_PASSWORD}"
        hosts: ["mysql:3306"]
    metricsets:
      - status
      - performance
```

**采集到的指标：**

```java
// 状态指标
{
  "mysql.status.connections": 150,      // 当前连接数
  "mysql.status.threads_connected": 25, // 活跃连接
  "mysql.status.threads_running": 5,     // 正在执行的 SQL
  "mysql.status.questions": 1234567,     // 总查询数
  "mysql.status.slow_queries": 123,      // 慢查询数
  "mysql.status.innodb_row_operations": 12345  // InnoDB 行操作
}

// 性能指标
{
  "mysql.performance.thread_cache_size": 64,
  "mysql.performance.queries": 1234567,
  "mysql.performance.com_select": 500000,
  "mysql.performance.com_insert": 200000,
  "mysql.performance.com_update": 300000,
  "mysql.performance.com_delete": 100000
}
```

### 4.3 Redis 指标

**Metricbeat 配置：**

```java
metricbeat.modules:
  - module: redis
    enabled: true
    period: 10s
    hosts: ["redis://redis:6379"]
    password: "${REDIS_PASSWORD}"
    metricsets:
      - info
      - keyspace
```

**采集到的指标：**

```java
// Info 指标
{
  "redis.info.version": "7.0.0",
  "redis.info.uptime": 1234567,           // 运行时间（秒）
  "redis.info.connected_clients": 25,       // 客户端数
  "redis.info.used_memory_human": "1.5M",  // 内存使用
  "redis.info.total_connections_received": 12345,  // 总连接数
  "redis.info.total_commands_processed": 98765   // 总命令数
}

// Keyspace 指标
{
  "redis.keyspace.keys": 1000,              // 键数量
  "redis.keyspace.expires": 800,           // 设置了过期时间的键
  "redis.keyspace.avg_ttl": 3600000         // 平均 TTL
}
```

## 5. Docker 指标采集

### 5.1 基础配置

```java
metricbeat.modules:
  - module: docker
    enabled: true
    period: 10s
    hosts: ["unix:///var/run/docker.sock"]
    metricsets:
      - container
      - cpu
      - memory
      - network
      - diskio
```

### 5.2 容器指标

```java
{
  "docker.container.id": "abc123...",
  "docker.container.name": "my-app",
  "docker.container.image": "my-app:latest",
  "docker.container.labels.app": "my-app",
  "docker.container.cpu.container.start": 1234567890,
  "docker.container.cpu.system.start": 1234567890,
  "docker.container.cpu.usage.container.pct": 25.5,
  "docker.container.memory.usage.pct": 45.2,
  "docker.container.memory.rss.bytes": 524288000,
  "docker.container.network.rx.bytes": 1234567,
  "docker.container.network.tx.bytes": 987654
}
```

## 6. Kubernetes 指标采集

### 6.1 基础配置

```java
metricbeat.modules:
  - module: kubernetes
    enabled: true
    period: 10s
    hosts: ["kube-state-metrics:8080"]
    metricsets:
      - node
      - pod
      - container
      - volume
      - pod_container
      - state_container
```

### 6.2 Node 指标

```java
{
  "kubernetes.node.name": "node-1",
  "kubernetes.node.cpu.usage.nanocores": 500000000,
  "kubernetes.node.cpu.capacity.cores": 8,
  "kubernetes.node.memory.usage.bytes": 16384000000,
  "kubernetes.node.memory.capacity.bytes": 33554432000,
  "kubernetes.node.network.rx.bytes": 1234567890,
  "kubernetes.node.network.tx.bytes": 987654321
}
```

### 6.3 Pod 指标

```java
{
  "kubernetes.pod.name": "my-app-7f8b9c",
  "kubernetes.pod.namespace": "production",
  "kubernetes.pod.uid": "abc123...",
  "kubernetes.pod.cpu.usage.nanocores": 500000000,
  "kubernetes.pod.memory.usage.bytes": 524288000,
  "kubernetes.pod.start_time": "2024-01-15T10:00:00Z"
}
```

## 7. 自定义指标采集

### 7.1 HTTP JSON 采集

```java
metricbeat.modules:
  - module: custom
    enabled: true
    period: 10s
    metricsets:
      - http
    httpHosts:
      - "http://custom-api:8080/metrics"
    filter:
      - include_fields: ["metric1", "metric2", "metric3"]
    processors:
      - add_fields:
          target: ''
          fields:
            service: custom-api
```

### 7.2 Prometheus 指标采集

```java
metricbeat.modules:
  - module: prometheus
    enabled: true
    period: 10s
    hosts: ["prometheus:9090"]
    metricsets:
      - collector
    metrics_path: /metrics
    ssl.enabled: false
```

## 8. 数据处理

### 8.1 Processors

```java
# metricbeat.yml
processors:
  # 添加主机信息
  - add_host_metadata:
      when.not.contains.tags: forwarded

  # 添加云信息
  - add_cloud_metadata: ~

  # 添加 K8s 信息
  - add_kubernetes_metadata: ~

  # 删除不需要的字段
  - drop_event:
      when:
        equals:
          event.dataset: "system.memory"
```

### 8.2 字段映射

```java
processors:
  - rename:
      fields:
        - from: "host"
          to: "server.name"
      ignore_missing: true
      fail_on_error: false
```

## 9. 部署方式

### 9.1 独立部署

```bash
# 下载并安装
curl -L -O https://artifacts.elastic.co/downloads/beats/metricbeat/metricbeat-8.11.0-linux-x86_64.tar.gz
tar -xzf metricbeat-8.11.0-linux-x86_64.tar.gz
cd metricbeat-8.11.0-linux-x86_64

# 配置
./metricbeat setup -e

# 启动
./metricbeat -e
```

### 9.2 Docker 部署

```yaml
# docker-compose.yml
version: '3'
services:
  metricbeat:
    image: docker.elastic.co/beats/metricbeat:8.11.0
    user: root
    volumes:
      - ./metricbeat.yml:/usr/share/metricbeat/metricbeat.yml:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    environment:
      - ELASTICSEARCH_HOST=elasticsearch
      - ELASTICSEARCH_PORT=9200
```

### 9.3 Kubernetes 部署

```yaml
# metricbeat-kubernetes.yaml
apiVersion: v1
kind: DaemonSet
metadata:
  name: metricbeat
  namespace: kube-system
spec:
  selector:
    matchLabels:
      app: metricbeat
  template:
    metadata:
      labels:
        app: metricbeat
    spec:
      serviceAccountName: metricbeat
      containers:
        - name: metricbeat
          image: docker.elastic.co/beats/metricbeat:8.11.0
          args:
            - "-e"
            - "-system.hostfs=/hostfs"
          env:
            - name: ELASTICSEARCH_HOST
              value: "elasticsearch"
            - name: ELASTICSEARCH_PORT
              value: "9200"
          volumeMounts:
            - name: config
              mountPath: /usr/share/metricbeat/metricbeat.yml
              readOnly: true
              subPath: metricbeat.yml
            - name: dockersock
              mountPath: /var/run/docker.sock
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: cgroup
              mountPath: /host/sys/fs/cgroup
              readOnly: true
```

## 10. 监控与调试

### 10.1 测试配置

```bash
# 测试配置
metricbeat test config -c metricbeat.yml

# 测试输出
metricbeat test output -c metricbeat.yml
```

### 10.2 调试模式

```bash
# 调试运行
metricbeat -e -d "*"

# 只测试特定模块
metricbeat -e -d "kubernetes"
```

### 10.3 监控接口

```java
# metricbeat.yml
monitoring.enabled: true
monitoring.cluster_uuid: "${ES_CLUSTER_UUID}"

http.enabled: true
http.host: "localhost"
http.port: 5066
```

## 总结

Metricbeat 的核心要点：

1. **模块系统**：通过模块采集不同类型指标
2. **系统指标**：CPU、内存、网络、磁盘
3. **服务指标**：Nginx、MySQL、Redis 等
4. **容器指标**：Docker、Kubernetes
5. **自定义指标**：HTTP JSON、Prometheus

Metricbeat 是系统监控的重要数据源，与日志数据结合使用效果更佳。

---

**留给你的问题**：

假设你需要监控一个 Kubernetes 集群中的应用，需要采集：

1. 系统指标（每个节点）
2. Kubernetes 状态指标
3. 应用自定义指标（通过 HTTP API）

你会如何设计 Metricbeat 部署方案？如何组织数据？
