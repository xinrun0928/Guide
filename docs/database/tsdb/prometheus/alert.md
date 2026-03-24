# Prometheus 告警：从规则到通知

告警是监控系统的核心目的。

今天我们来看看 Prometheus 的告警机制：怎么定义告警规则，怎么触发，怎么通知。

---

## 告警架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Prometheus Alerting                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Alerting Rules                           │  │
│  │                                                      │  │
│  │  groups:                                             │  │
│  │    - name: api-alerts                               │  │
│  │      rules:                                         │  │
│  │        - alert: HighErrorRate                       │  │
│  │          expr: rate(errors[5m]) > 0.05              │  │
│  │          for: 5m                                    │  │
│  └─────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌─────────────────────────────────────────────────────┐  │
│  │              Alertmanager                            │  │
│  │                                                      │  │
│  │  接收 Prometheus 的告警 → 去重 → 分组 → 路由 → 通知  │  │
│  └─────────────────────────────────────────────────────┘  │
│                            ↓                                │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                 Notification                        │  │
│  │                                                      │  │
│  │  Email │ Slack │ PagerDuty │ WeChat │ DingTalk    │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 告警规则

### 基础规则

```yaml
# alerting-rules.yml
groups:
  - name: api-alerts
    rules:
      # 告警：5分钟内错误率超过5%
      - alert: HighErrorRate
        expr: |
          sum(rate(http_requests_total{status=~"5.."}[5m]))
          /
          sum(rate(http_requests_total[5m])) > 0.05
        for: 5m              # 持续 5 分钟才触发
        labels:
          severity: critical
          team: api
        annotations:
          summary: "High error rate on {{ $labels.job }}"
          description: "Error rate is {{ $value | printf \"%.2f\" }}%"
          runbook_url: "https://wiki.example.com/runbooks/high-error-rate"

      # 告警：P99延迟超过1秒
      - alert: HighLatency
        expr: |
          histogram_quantile(0.99,
            sum(rate(http_request_duration_seconds_bucket[5m])) by (le, job)
          ) > 1
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High latency on {{ $labels.job }}"
```

### 模板变量

```yaml
annotations:
  # 常用模板变量
  summary: "{{ $labels.job }} - {{ $labels.instance }}"
  description: |
    {{ $labels.job }} ({{ $labels.instance }})
    当前值: {{ $value | printf \"%.2f\" }}
    阈值: {{ $threshold }}
    持续时间: {{ $duration }}
```

---

## 告警状态

```
┌─────────────────────────────────────────────────────────────┐
│                        告警生命周期                            │
│                                                             │
│  Pending (等待中) ──→ Firing (触发中) ──→ Resolved (已解决)   │
│       │                      │                    │         │
│       │ 条件满足              │ 持续超过 for        │ 条件恢复  │
│       │ 但未超过 for         │ 时间                │         │
│       ↓                      ↓                    ↓         │
│   可能误报               真正告警            发送恢复通知     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Alertmanager 配置

### 基本配置

```yaml
# alertmanager.yml
global:
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'alertmanager@example.com'
  smtp_auth_username: 'alerts'
  smtp_auth_password: 'password'

route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s          # 告警分组等待时间
  group_interval: 5m       # 告警分组间隔
  repeat_interval: 4h     # 重复告警间隔
  receiver: 'default'
  routes:
    - match:
        severity: critical
      receiver: 'critical-alerts'
      continue: true
    - match:
        severity: warning
      receiver: 'warning-alerts'

receivers:
  - name: 'default'
    email_configs:
      - to: 'team@example.com'

  - name: 'critical-alerts'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/xxx'
        channel: '#critical-alerts'
        send_resolved: true

  - name: 'warning-alerts'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/yyy'
        channel: '#warning-alerts'
        send_resolved: true
```

### 抑制规则

```yaml
# 避免重复告警
inhibit_rules:
  # 如果整个服务挂了，不发单个实例的告警
  - source_match:
      alertname: 'ServiceDown'
    target_match_re:
      alertname: '.*InstanceDown'
    equal: ['service']
```

---

## Java 中的告警管理

### 读取告警状态

```java
import java.net.http.HttpClient;
import java.net.URI;

public class AlertManagerClient {
    private final HttpClient httpClient;
    private final String alertmanagerUrl;

    // 获取当前告警
    public List&lt;Alert&gt; getAlerts(boolean silenced, boolean inhibited) throws Exception {
        String url = alertmanagerUrl + "/api/v2/alerts?" +
            "silenced=" + silenced +
            "&inhibited=" + inhibited;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .GET()
            .build();

        HttpResponse&lt;String&gt; response = httpClient.send(request,
            HttpResponse.BodyHandlers.ofString());

        return parseAlerts(response.body());
    }

    // 静默告警
    public void silenceAlert(String alertId, int durationHours) throws Exception {
        String json = String.format("""
            {
                "matchers": [
                    {"name": "alertname", "value": "%s"}
                ],
                "startsAt": "%s",
                "endsAt": "%s",
                "createdBy": "api",
                "comment": "Planned maintenance"
            }
            """,
            alertId,
            Instant.now().toString(),
            Instant.now().plusHours(durationHours).toString()
        );

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(alertmanagerUrl + "/api/v2/silences"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        httpClient.send(request, HttpResponse.BodyHandlers.ofString());
    }
}
```

### 告警 Webhook

```java
// Alertmanager 会 POST 到这个端点
@RestController
@RequestMapping("/webhooks/alertmanager")
public class AlertWebhookController {

    @PostMapping
    public ResponseEntity&lt;Void&gt; handleAlert(
            @RequestBody AlertWebhookPayload payload) {

        for (Alert alert : payload.getAlerts()) {
            if ("firing".equals(alert.getStatus())) {
                // 发送告警
                handleFiringAlert(alert);
            } else if ("resolved".equals(alert.getStatus())) {
                // 发送恢复通知
                handleResolvedAlert(alert);
            }
        }

        return ResponseEntity.ok().build();
    }

    private void handleFiringAlert(Alert alert) {
        String alertName = alert.getLabels().get("alertname");
        String severity = alert.getLabels().getOrDefault("severity", "info");
        String description = alert.getAnnotations().get("description");

        // 发送到飞书/钉钉/企业微信
        if ("critical".equals(severity)) {
            feishuClient.sendCritical(alertName, description);
            pagerdutyClient.trigger(alertName, description);
        } else {
            feishuClient.sendWarning(alertName, description);
        }
    }
}
```

---

## 告警最佳实践

### 1. 告警分级

```yaml
groups:
  - name: severity-examples
    rules:
      # P1 - 立即处理
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        # 必须有明确的行动指南

      # P2 - 尽快处理
      - alert: HighErrorRate
        expr: error_rate > 0.05
        for: 5m
        labels:
          severity: warning

      # P3 - 关注
      - alert: DiskSpaceWarning
        expr: disk_free < 0.1
        for: 1h
        labels:
          severity: info
```

### 2. 避免告警风暴

```yaml
# 合理分组
route:
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s      # 30秒内聚合告警
  group_interval: 5m  # 5分钟检查一次新告警
```

### 3. 告警疲劳预防

```yaml
# 减少重复告警
route:
  repeat_interval: 4h  # 4小时重复一次，而不是频繁重复
  routes:
    - match:
        severity: critical
      repeat_interval: 30m  # 关键告警可以更频繁
```

---

## 面试追问方向

- Alertmanager 是怎么实现告警去重和分组的？
- 如何设计一个好的告警规则，避免告警疲劳？

下一节，我们来了解 Prometheus 的 Kubernetes 服务发现。
