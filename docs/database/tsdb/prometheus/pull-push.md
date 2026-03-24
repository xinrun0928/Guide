# Prometheus Pull vs Push：监控数据采集的两条路线

监控系统的核心问题：**数据怎么送到监控系统？**

两种路线：Pull（拉）和 Push（推）。

Prometheus 选择 Pull，InfluxDB 选择 Push。

这场争论，已经持续了十几年。

---

## Pull 模式：Prometheus 的选择

```
┌─────────────────────────────────────────────────────────────┐
│                      Pull 模式                                │
│                                                             │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐      │
│   │ Server1 │        │ Server2 │        │ Server3 │      │
│   │  :8080  │        │  :8080  │        │  :8080  │      │
│   └────┬────┘        └────┬────┘        └────┬────┘      │
│        │                   │                   │            │
│        └───────────────────┼───────────────────┘            │
│                            ↓                                │
│                    ┌─────────────────┐                      │
│                    │   Prometheus    │                      │
│                    │                 │                      │
│                    │  ┌───────────┐  │                      │
│                    │  │  /metrics │  │ ← 主动拉取         │
│                    │  └───────────┘  │                      │
│                    └─────────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Prometheus 定期访问每个应用的 `/metrics` 端点，获取指标数据。

---

## Push 模式：InfluxDB 的选择

```
┌─────────────────────────────────────────────────────────────┐
│                      Push 模式                                │
│                                                             │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐      │
│   │ Server1 │        │ Server2 │        │ Server3 │      │
│   │         │        │         │        │         │      │
│   │  发送！ │        │  发送！ │        │  发送！ │      │
│   └────┬────┘        └────┬────┘        └────┬────┘      │
│        │                   │                   │            │
│        └───────────────────┼───────────────────┘            │
│                            ↓                                │
│                    ┌─────────────────┐                      │
│                    │   InfluxDB      │                      │
│                    │                 │                      │
│                    │   接收数据      │ ← 被动接收           │
│                    └─────────────────┘                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

应用主动将指标推送到 InfluxDB。

---

## Pull vs Push 对比

| 维度 | Pull (Prometheus) | Push (InfluxDB) |
|-----|------------------|----------------|
| **架构** | 被动采集 | 主动推送 |
| **网络要求** | Prometheus 能访问应用 | 应用能访问数据库 |
| **短生命周期任务** | ❌ 不适合 | ✅ 适合 |
| **故障节点检测** | ✅ 自动发现 | ⚠️ 需要额外机制 |
| **数据一致性** | ✅ 拉取间隔一致 | ⚠️ 推送频率可能不一致 |
| **安全性** | ⚠️ 需要暴露 /metrics | ✅ 应用不暴露端口 |
| **扩展性** | ✅ 拉取端控制 | ⚠️ 推送端可能超载 |

---

## Pull 模式的优势

### 1. 监控节点自主管理

```
Pull 模式：
- Prometheus 决定采集频率
- 应用不需要关心谁来采集
- 多个 Prometheus 可以采集同一目标
```

```java
// 应用只需要提供 /metrics 端点
// 不需要知道谁来采集，什么时候采集

@SpringBootApplication
public class MetricsApplication {
    public static void main(String[] args) {
        // Micrometer 自动暴露 /metrics
        SpringApplication.run(MetricsApplication.class, args);
    }
}
```

### 2. 故障自动感知

```yaml
# Prometheus 自动检测节点故障
scrape_configs:
  - job_name: 'api'
    static_configs:
      - targets: ['api1:8080', 'api2:8080', 'api3:8080']
    # 节点挂了，Prometheus 自动停止采集
    # 不会推送垃圾数据
```

### 3. 更简单的开发端

```java
// Push 模式：应用需要管理推送逻辑
public class PushExample {
    private final InfluxDB influxDB;

    public void recordMetric() {
        // 需要考虑：推送频率、重试、缓冲...
        influxDB.write(Point.measurement("metric")
            .addField("value", 45.2)
            .build());
    }
}

// Pull 模式：只需要暴露端点
public class PullExample {
    // 什么都不用做，框架自动处理
    // Prometheus 来拉取即可
}
```

---

## Push 模式的优势

### 1. 适合短生命周期任务

```python
# Kubernetes Job 或 Lambda 函数
# 任务执行完就销毁，Prometheus 无法拉取

# Push 模式：任务结束时主动推送
def lambda_handler(event, context):
    # 执行任务
    result = process(event)

    # 推送指标
    metrics.push("task_duration", result.duration)
    metrics.push("task_errors", result.error_count)

    return result
```

### 2. 绕过防火墙

```yaml
# Pull 模式问题：
# 如果应用在内网，Prometheus 无法访问
# 需要 VPN 或其他方案

# Push 模式：
# 应用可以访问外网的 InfluxDB
# 不需要反向通道
```

### 3. 批次任务

```python
# ETL 批处理任务
# 运行时间可能很长，但完成后立即结束
# Pull 模式可能采集不到

# Push 模式：每个批次完成后推送
for batch in etl_batches:
    process(batch)
    push_metrics(batch.id, batch.duration, batch.count)
```

---

## Prometheus 的 Pushgateway：解决短生命周期问题

对于短生命周期任务，Prometheus 提供了 **Pushgateway**：

```
短生命周期任务        Pushgateway          Prometheus
┌─────────────┐      ┌─────────────┐      ┌─────────────┐
│             │ ───→ │             │ ←─── │             │
│ Batch Job   │      │ :9091       │      │ 拉取        │
│ Lambda      │ ───→ │             │      │             │
│ K8s Job    │      │ 暂存指标    │      │             │
└─────────────┘      └─────────────┘      └─────────────┘
```

### Pushgateway 配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'pushgateway'
    static_configs:
      - targets: ['pushgateway:9091']
    # Pushgateway 适合长期存在的任务指标
    # 不适合短生命周期任务的瞬时指标
```

### Pushgateway 的使用场景

```python
# 适合用 Pushgateway
# - 定时批处理任务
# - 长时间运行的批处理
# - 需要聚合的指标

# 不适合用 Pushgateway
# - 非常短的任务（可能没推送就结束了）
# - 需要精确计数（Pushgateway 是累积的）
# - 服务发现（用 Pushgateway 会失去这个能力）
```

---

## 选择建议

### 选 Pull (Prometheus)

```yaml
# 微服务架构
# 长期运行的服务
# Kubernetes 环境
# 需要自动服务发现
scrape_configs:
  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
```

### 选 Push (InfluxDB)

```yaml
# 短生命周期任务多
# Lambda 函数
# 批处理作业
# 网络隔离环境

# InfluxDB Telegraf Agent
[[inputs.pushgw]]
  service_address = ":9091"
```

### 混合方案

```yaml
# Prometheus + Pushgateway + Thanos
# 主架构用 Pull
# 短任务用 Pushgateway
scrape_configs:
  - job_name: 'services'
    static_configs:
      - targets: ['service1:8080', 'service2:8080']

  - job_name: 'batch'
    static_configs:
      - targets: ['pushgateway:9091']
```

---

## 面试追问方向

- 为什么 Prometheus 选择 Pull 模式而不是 Push 模式？
- Pushgateway 的优缺点是什么？适合什么场景？

下一节，我们来了解 Prometheus 的存储机制。
