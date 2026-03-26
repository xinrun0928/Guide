# Heartbeat 站点与端口健康检测

想象一下，你的网站突然宕机了，但你要等到用户投诉才知道吗？Heartbeat 让你能**主动发现**服务不可用，而不是被动等待用户报告。

## 1. Heartbeat 简介

### 1.1 什么是 Heartbeat？

Heartbeat 是 Elastic 官方提供的健康检测工具，可以定期检测站点、端口、服务的可用性。

```
Heartbeat 的检测类型：
├─ HTTP 检测：网站可访问性、响应时间
├─ TCP 检测：端口可达性
├─ ICMP 检测：主机可达性
└─ 自定义检测：组合多个检测点
```

### 1.2 与其他监控对比

| 特性 | Heartbeat | Prometheus | Nagios |
|-----|-----------|-----------|--------|
| 检测类型 | HTTP/TCP/ICMP | 自定义 | 自定义 |
| 集成 ES | 原生 | 需要适配 | 需要适配 |
| 可视化 | Kibana Uptime | Grafana | 多种 |
| 告警 | Kibana Alerting | AlertManager | Nagios |
| 适用场景 | ELK 生态 | Prometheus 生态 | 企业监控 |

## 2. 基础配置

### 2.1 HTTP 检测

```java
# heartbeat.yml
heartbeat.monitors:
  - type: http
    enabled: true
    name: "My Website"
    urls:
      - "https://www.example.com"
      - "https://www.example.com/api/health"
    schedule: '@every 30s'
    timeout: 5s
    check.response:
      status: 200
    ssl:
      certificate_authorities: ["/etc/ssl/certs/ca-certificates.crt"]
```

### 2.2 TCP 检测

```java
  - type: tcp
    enabled: true
    name: "MySQL Port"
    hosts:
      - "mysql:3306"
    schedule: '@every 30s'
    timeout: 3s
    check.send: "\x01\x00\x00\x00\x01"
    check.receive: 5
```

### 2.3 ICMP 检测

```java
  - type: icmp
    enabled: true
    name: "Gateway Ping"
    hosts:
      - "192.168.1.1"
    schedule: '@every 10s'
    timeout: 5s
```

## 3. 检测配置详解

### 3.1 HTTP 检测配置

```java
heartbeat.monitors:
  - type: http
    name: "API Health Check"
    enabled: true
    urls:
      - "https://api.example.com/health"
    schedule: '@every 10s'
    timeout: 10s

    # 请求配置
    check.request:
      method: GET
      headers:
        Authorization: "Bearer token123"
    #      Content-Type: "application/json"
    #    body: '{"key": "value"}'

    # 响应检查
    check.response:
      status: 200
    #  json:
    #    - description: "Check status field"
    #      condition: response.status == 200

    # SSL 配置
    ssl:
      enabled: true
      certificate_authorities: ["/etc/ssl/certs/ca-certificates.crt"]
      verification_mode: "full"
```

### 3.2 响应检查

```java
# 检查响应状态码
check.response:
  status: 200

# 检查响应头
check.response:
  status: 200
  headers:
    Content-Type: "application/json"

# 检查 JSON 响应
check.response:
  json:
    - description: "Response status check"
      condition: response.status == 200
    - description: "Data exists check"
      condition: response.data.result == "ok"
```

### 3.3 条件判断

```java
heartbeat.monitors:
  - type: http
    name: "Conditional Monitor"
    schedule: '@every 30s'
    urls:
      - "https://api.example.com/health"
    # 根据响应条件判断成功/失败
    check.response:
      json:
        - condition: status == 200
          type: equals
          target: http.response.body.content.data.status
```

## 4. 高级配置

### 4.1 组合检测

```java
heartbeat.monitors:
  # 检测网站 + API + 数据库
  - type: http
    name: "Website"
    urls:
      - "https://www.example.com"
    schedule: '@every 30s'

  - type: http
    name: "API"
    urls:
      - "https://api.example.com/health"
    schedule: '@every 30s'

  - type: tcp
    name: "MySQL"
    hosts:
      - "mysql.example.com:3306"
    schedule: '@every 30s'

  - type: tcp
    name: "Redis"
    hosts:
      - "redis.example.com:6379"
    schedule: '@every 30s'
```

### 4.2 地理位置

```java
heartbeat.monitors:
  - type: http
    name: "Website from Asia"
    enabled: true
    schedule: '@every 1m'
    urls:
      - "https://www.example.com"
    fields:
      region: asia
      datacenter: tokyo
    # 运行位置
    processors:
      - add_observer_metadata:
          geo:
            name: asia-dc
            location: 35.6762, 139.6503
```

### 4.3 TLS 检测

```java
heartbeat.monitors:
  - type: http
    name: "TLS Certificate Check"
    schedule: '@every 1h'
    urls:
      - "https://www.example.com"
    check.response:
      ssl:
        certificate_info: true
        certificate_expiry: 30d
```

## 5. 数据处理

### 5.1 Processors

```java
# heartbeat.yml
processors:
  # 添加运行位置信息
  - add_observer_metadata:
      geo:
        name: production-datacenter
        location: 39.9042, 116.4074

  # 添加标签
  - add_fields:
      target: ''
      fields:
        environment: production
        service_type: critical

  # 删除字段
  - drop_fields:
      fields: ["monitor.id", "url.query"]
      ignore_missing: true
```

### 5.2 动态字段

```java
heartbeat.monitors:
  - type: http
    name: "Service Monitor"
    urls:
      - "https://service1.example.com/health"
    fields:
      service_name: service1
    fields_under_root: true

  - type: http
    name: "Service Monitor"
    urls:
      - "https://service2.example.com/health"
    fields:
      service_name: service2
    fields_under_root: true
```

## 6. 输出配置

### 6.1 输出到 Elasticsearch

```java
output.elasticsearch:
  hosts: ["es1:9200", "es2:9200"]
  index: "heartbeat-%{[agent.version]}-%{+yyyy.MM.dd}"

  # ILM 配置
  setup.ilm.enabled: true
  setup.ilm.rollover_alias: "heartbeat"
  setup.ilm.pattern: "{now/d}-000001"
  setup.ilm.policy_name: "heartbeat-policy"
```

### 6.2 输出到 Logstash

```java
output.logstash:
  hosts: ["logstash1:5044", "logstash2:5044"]
  loadbalance: true
```

## 7. Kibana Uptime 集成

### 7.1 Uptime 功能

Heartbeat 采集的数据可以在 Kibana Uptime 中查看：

```
Kibana Uptime 功能：
├─ 监控列表：查看所有监控点状态
├─ 地图视图：按地理位置展示
├─ 快照：定时保存状态快照
├─ 告警：基于状态变化的告警
└─ 历史分析：查看历史可用性
```

### 7.2 设置 Uptime

```bash
# 启用 Uptime
heartbeat setup --machine-learning

# 或者通过 Kibana UI
# Stack Management → Kibana → Uptime → Enable
```

### 7.3 告警配置

```java
# Kibana 中配置告警规则
# Stack Management → Rules and Connectors → Create rule

# 告警条件：
# - monitor.status: down
# - observer.geo.name: "production-dc"
# - url.full: "https://api.example.com"

# 动作：
# - 发送 Slack 通知
# - 发送邮件
# - 创建工单
```

## 8. 实际案例

### 8.1 网站监控配置

```java
heartbeat.monitors:
  # 主站检测
  - type: http
    name: "Main Website"
    urls:
      - "https://www.example.com"
    schedule: '@every 30s'
    timeout: 5s
    check.response:
      status: 200
    ssl:
      enabled: true

  # API 健康检测
  - type: http
    name: "API Health"
    urls:
      - "https://api.example.com/v1/health"
      - "https://api.example.com/v1/ready"
    schedule: '@every 10s'
    timeout: 3s
    check.response:
      status: 200
      json:
        - condition: status == "healthy"
          type: equals
          target: body.data.status

  # 关键服务端口
  - type: tcp
    name: "Critical Ports"
    hosts:
      - "mysql.example.com:3306"
      - "redis.example.com:6379"
      - "rabbitmq.example.com:5672"
      - "kafka.example.com:9092"
    schedule: '@every 30s'
    timeout: 3s
```

### 8.2 多地域检测

```java
heartbeat.monitors:
  # 亚洲节点
  - type: http
    name: "Asia Website"
    schedule: '@every 1m'
    urls:
      - "https://www.example.com"
    fields:
      region: asia
      location: tokyo
    processors:
      - add_observer_metadata:
          geo:
            name: asia-tokyo
            location: 35.6762, 139.6503

  # 美洲节点
  - type: http
    name: "Americas Website"
    schedule: '@every 1m'
    urls:
      - "https://www.example.com"
    fields:
      region: americas
      location: virginia
    processors:
      - add_observer_metadata:
          geo:
            name: americas-virginia
            location: 37.4316, -78.6569

  # 欧洲节点
  - type: http
    name: "Europe Website"
    schedule: '@every 1m'
    urls:
      - "https://www.example.com"
    fields:
      region: europe
      location: frankfurt
    processors:
      - add_observer_metadata:
          geo:
            name: europe-frankfurt
            location: 50.1109, 8.6821
```

## 9. 性能与可靠性

### 9.1 资源优化

```java
# heartbeat.yml
heartbeat.monitors:
  - type: http
    schedule: '@every 30s'
    timeout: 5s

# 限制并发检测数
monitoring:
  enabled: true

# HTTP 连接池
heartbeat.http:
  default_request_timeout: 10s
  max_idle_conns_per_host: 10
```

### 9.2 高可用部署

```java
# 多个 Heartbeat 实例
heartbeat.monitors:
  - type: http
    name: "Website"
    urls:
      - "https://www.example.com"
    schedule: '@every 30s'
    # 会被多个实例同时检测
```

## 10. 常见问题

### Q1：如何避免误报？

**答案**：
1. 合理设置超时时间
2. 配置重试机制
3. 使用连续失败才告警

### Q2：如何检测 API 的具体业务状态？

**答案**：使用 JSON 响应检查。

```java
check.response:
  json:
    - condition: status == "ok"
      type: equals
      target: body.status
```

### Q3：如何检测 SSL 证书过期？

**答案**：使用 TLS 检测。

```java
check.response:
  ssl:
    certificate_info: true
    certificate_expiry: 30d
```

## 总结

Heartbeat 的核心要点：

1. **HTTP 检测**：网站可访问性、响应内容
2. **TCP 检测**：端口可达性
3. **ICMP 检测**：主机可达性
4. **地理位置**：从多地检测
5. **Kibana Uptime**：可视化和告警

Heartbeat 是保障服务可用性的第一道防线。

---

**留给你的问题**：

假设你负责监控一个电商平台的可用性，需要检测：

1. 主站（前端页面）
2. 用户服务 API
3. 订单服务 API
4. 支付服务 API
5. MySQL、Redis、Kafka 端口

你会如何设计 Heartbeat 配置？如何设置告警条件？
