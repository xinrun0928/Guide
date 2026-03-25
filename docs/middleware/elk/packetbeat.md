# Packetbeat 网络流量协议分析

日志告诉你「发生了什么」，但网络流量告诉你「数据是怎么流动的」。Packetbeat 能捕获网络数据包，分析 HTTP、DNS、MySQL 等协议，让你看到应用的「交通流量」。

## 1. Packetbeat 简介

### 1.1 什么是 Packetbeat？

Packetbeat 是 Elastic 官方提供的网络协议分析工具，通过抓取和分析网络数据包，实现应用层协议的监控。

```
Packetbeat 支持的协议：
├─ HTTP/HTTPS
├─ DNS
├─ MySQL
├─ PostgreSQL
├─ Redis
├─ MongoDB
├─ Cassandra
├─ gRPC
├─ Thrift
├─ AMQP (RabbitMQ)
└─ 自定义协议
```

### 1.2 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                   Packetbeat 工作原理                        │
│                                                               │
│   网络流量                                                    │
│   ┌──────────┐                                             │
│   │ Packetbeat│ ← libpcap/winpcap 抓包                    │
│   └─────┬────┘                                             │
│         │                                                   │
│         ▼                                                   │
│   ┌──────────┐                                             │
│   │协议解析器 │ ← 解析 HTTP、DNS、MySQL 等                  │
│   └─────┬────┘                                             │
│         │                                                   │
│         ▼                                                   │
│   ┌──────────┐                                             │
│   │   输出    │ ← 发送到 ES/Logstash                        │
│   └──────────┘                                             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 2. 安装与配置

### 2.1 安装

```bash
# Linux (Debian/Ubuntu)
curl -L -O https://artifacts.elastic.co/downloads/beats/packetbeat/packetbeat-%{[version]}-linux-x86_64.tar.gz
tar -xzf packetbeat-%{[version]}-linux-x86_64.tar.gz
cd packetbeat-%{[version]}-linux-x86_64

# macOS
brew install packetbeat
```

### 2.2 基础配置

```java
# packetbeat.yml
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    snapshot: true

# 协议配置
packetbeat.protocols:
  - type: http
    enabled: true
    ports: [80, 8080, 8000]

  - type: dns
    enabled: true
    ports: [53]

  - type: mysql
    enabled: true
    ports: [3306]

# 流量采集
packetbeat.flows:
  enabled: true

# 输出配置
output.elasticsearch:
  hosts: ["es:9200"]
```

## 3. 协议配置

### 3.1 HTTP 协议

```java
packetbeat.protocols:
  - type: http
    enabled: true
    ports: [80, 8080, 8000, 443, 8443]

    # 请求超时
    send_request: true
    send_response: true

    # 敏感字段处理
    hide_keywords: ["password", "secret", "token"]
    split_cookie: true

    # keepalive
    transaction_timeout: 30s

    # 方法过滤
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"]
```

### 3.2 MySQL 协议

```java
  - type: mysql
    enabled: true
    ports: [3306]

    # 发送请求和响应
    send_request: true
    send_response: true

    # 敏感字段处理
    hide_keywords: ["password"]

    # 事务超时
    transaction_timeout: 30s
```

### 3.3 DNS 协议

```java
  - type: dns
    enabled: true
    ports: [53]

    # 发送请求和响应
    send_request: true
    send_response: true

    # 事务超时
    transaction_timeout: 30s
```

## 4. 采集配置

### 4.1 网卡配置

```java
packetbeat.interfaces:
  # 方式一：监听单个网卡
  - type: af_packet
    device: eth0
    snapshot: true

  # 方式二：监听所有网卡
  - type: af_packet
    iface: any
    snapshot: true

  # 方式三：多个网卡
  - type: af_packet
    device: eth0
  - type: af_packet
    device: eth1
```

### 4.2 流量过滤

```java
# BPF 过滤器
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    # 只采集 HTTP 流量
    bpf_filter: "tcp port 8080"

# 按网络过滤
packetbeat.procs.enabled: true
packetbeat.procs:
  - enabled: true
    monitored:
      - cmdline_starts_with:
          - "/opt/app/server"
```

### 4.3 流量统计

```java
packetbeat.flows:
  enabled: true
  timeout: 30s
  period: 10s
```

## 5. 数据处理

### 5.1 Processors

```java
processors:
  # 添加主机信息
  - add_host_metadata:
      when.not.contains.tags: forwarded

  # 添加云信息
  - add_cloud_metadata: ~

  # 脱敏处理
  - redact:
      fields:
        - http.request.headers["authorization"]
        - http.response.headers["set-cookie"]
     规则:
        - replace: "[redacted]"

  # 删除字段
  - drop_event:
      when:
        equals:
          event.action: "network_flow"
```

### 5.2 HTTP 字段处理

```java
processors:
  # 添加请求耗时
  - script:
      lang: javascript
      id: http_timing
      file: ${path.config}/scripts/http-timing.js

  # 提取 URL 参数
  - script:
      lang: javascript
      id: url_parsing
      file: ${path.config}/scripts/url-parsing.js
```

## 6. 输出配置

### 6.1 Elasticsearch 输出

```java
output.elasticsearch:
  hosts: ["es1:9200", "es2:9200"]
  index: "packetbeat-%{[agent.version]}-%{+yyyy.MM.dd}"

  # 索引模板
  setup.template.enabled: true
  setup.template.name: "packetbeat"
  setup.template.pattern: "packetbeat-*"
```

### 6.2 Logstash 输出

```java
output.logstash:
  hosts: ["logstash1:5044", "logstash2:5044"]
  loadbalance: true
```

## 7. 数据字段

### 7.1 HTTP 事件字段

```java
{
  "@timestamp": "2024-01-15T10:00:00.000Z",
  "event.kind": "event",
  "event.category": "network",
  "event.type": "info",
  "event.action": "http-request",

  // HTTP 请求
  "http.request.method": "POST",
  "http.request.bytes": 1024,
  "http.request.body.bytes": 512,

  // HTTP 响应
  "http.response.status_code": 200,
  "http.response.bytes": 2048,
  "http.response.body.bytes": 1024,

  // URL
  "url.original": "/api/users",
  "url.domain": "api.example.com",
  "url.scheme": "https",
  "url.port": 443,

  // 性能
  "http.response.time": 125,  // 毫秒

  // 源和目标
  "source.ip": "192.168.1.100",
  "source.port": 54321,
  "source.bytes": 1024,

  "dest.ip": "10.0.0.10",
  "dest.port": 8080,
  "dest.bytes": 2048,

  // GeoIP
  "source.geo.city_name": "Beijing",
  "source.geo.country_name": "China",
  "source.geo.location": {"lat": 39.9042, "lon": 116.4074}
}
```

### 7.2 MySQL 事件字段

```java
{
  "event.action": "mysql-query",
  "event.category": "database",
  "event.type": "info",

  // MySQL 查询
  "mysql.query": "SELECT * FROM users WHERE id = 1",
  "mysql.method": "SELECT",
  "mysql.table": "users",

  // MySQL 连接
  "mysql.connection_id": 12345,

  // 性能
  "mysql.num_rows": 1,

  // 错误
  "mysql.error_code": 0,
  "mysql.error_message": "",

  // 源和目标
  "source.ip": "192.168.1.100",
  "source.port": 54321,

  "dest.ip": "10.0.0.10",
  "dest.port": 3306
}
```

### 7.3 DNS 事件字段

```java
{
  "event.action": "dns-query",
  "event.category": "network",
  "event.type": "info",

  // DNS 查询
  "dns.question.name": "example.com",
  "dns.question.type": "A",
  "dns.question.registered_domain": "example.com",

  // DNS 响应
  "dns.response_code": "NOERROR",
  "dns.answers": [
    {"data": "93.184.216.34", "type": "A"}
  ],

  // 性能
  "dns.response_time": 15,  // 毫秒
  "dns.resolver.port": 53,
  "dns.resolver.ip": "8.8.8.8"
}
```

## 8. 实际案例

### 8.1 Web 服务监控

```java
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    snapshot: true

packetbeat.protocols:
  - type: http
    enabled: true
    ports: [80, 8080, 443, 8443]
    send_request: true
    send_response: true
    hide_keywords: ["password", "token", "secret"]

  - type: dns
    enabled: true
    ports: [53]

packetbeat.flows:
  enabled: true
  timeout: 30s
  period: 10s

processors:
  - add_host_metadata:
  - add_cloud_metadata: ~
  - add_fields:
      fields:
        environment: production
```

### 8.2 数据库监控

```java
packetbeat.interfaces:
  - type: af_packet
    device: eth0

packetbeat.protocols:
  - type: mysql
    enabled: true
    ports: [3306]
    send_request: true
    send_response: true
    hide_keywords: ["password"]

  - type: postgresql
    enabled: true
    ports: [5432]
    send_request: true
    send_response: true
    hide_keywords: ["password"]

  - type: redis
    enabled: true
    ports: [6379]
    send_request: true
    send_response: true
```

## 9. 安全考虑

### 9.1 敏感数据处理

```java
# HTTP 敏感字段
packetbeat.protocols:
  - type: http
    hide_keywords: ["password", "secret", "token", "authorization"]
    redact:
      enabled: true
      replace: "[redacted]"

# MySQL 敏感字段
packetbeat.protocols:
  - type: mysql
    hide_keywords: ["password"]
```

### 9.2 权限控制

```java
# 只读取特定网卡
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    snapshot: true

# 限制抓包大小
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    snaplen: 262144  # 最大抓包大小
```

## 10. 性能与资源

### 10.1 性能优化

```java
# 减少采样率
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    snapshot: true
    sample_frequency: 100  # 每100个包采样1个

# BPF 过滤器减少流量
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    bpf_filter: "tcp port 8080 or tcp port 3306"
```

### 10.2 资源限制

```java
# 限制内存使用
packetbeat.interfaces:
  - type: af_packet
    device: eth0
    buffer_size_mb: 100

# JVM 内存配置
# jvm.options
-Xms256m
-Xmx256m
```

## 11. 常见问题

### Q1：Packetbeat 和 Metricbeat 有什么区别？

**答案**：

| 维度 | Packetbeat | Metricbeat |
|-----|-----------|-----------|
| 数据来源 | 网络流量 | 系统/API |
| 粒度 | 请求级别 | 聚合统计 |
| 资源消耗 | 较高 | 较低 |
| 适用场景 | 深度分析 | 性能监控 |

### Q2：如何处理大流量？

**答案**：
1. 使用 BPF 过滤器过滤不需要的流量
2. 降低采样率
3. 分散到多个 Packetbeat 实例

### Q3：如何保护敏感数据？

**答案**：
1. 使用 hide_keywords 隐藏敏感字段
2. 使用 redact processor 脱敏
3. 配置网络隔离

## 总结

Packetbeat 的核心要点：

1. **协议支持**：HTTP、DNS、MySQL 等多种协议
2. **实时分析**：抓包后即时解析
3. **性能监控**：HTTP 响应时间、MySQL 查询时间
4. **流量分析**：网络流统计
5. **安全处理**：敏感数据脱敏

Packetbeat 适合需要深度分析网络流量的场景。

---

**留给你的问题**：

假设你需要监控一个微服务架构的性能，需要：

1. HTTP API 的请求量、响应时间
2. MySQL 查询的慢查询
3. Redis 命令的执行

你会如何设计 Packetbeat 配置？如何设置告警条件？
