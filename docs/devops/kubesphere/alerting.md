# KubeSphere 告警与通知系统

「应用出问题了怎么知道？」——KubeSphere 的告警系统帮你盯着。

KubeSphere 的告警系统基于 Prometheus AlertManager 实现，提供了从告警规则创建、告警分组、告警抑制到通知发送的完整链路。配合多租户设计，不同角色的用户可以创建自己权限范围内的告警规则。

## 告警架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    KubeSphere 告警架构                             │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    Prometheus AlertManager                   │   │
│  │                                                          │   │
│  │  接收 Prometheus 推送的告警                                 │   │
│  │  分组（Group）→ 抑制（Inhibit）→ 静默（Silences）→ 通知   │   │
│  └─────────────────────────────┬──────────────────────────────┘   │
│                                │                                      │
│  ┌─────────────────────────────┴──────────────────────────────┐   │
│  │                    KubeSphere Alerting                      │   │
│  │                                                          │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │ 告警规则      │  │ 告警策略      │  │ 通知渠道      │   │   │
│  │  │（自定义 PromQL）│  │（告警级别）  │  │（邮件/钉钉） │   │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘   │   │
│  │                                                          │   │
│  │  ┌──────────────────────────────────────────────────┐   │   │
│  │  │              多租户隔离                              │   │   │
│  │  │  Workspace A 的告警 → Workspace A 的通知接收人       │   │   │
│  │  │  Workspace B 的告警 → Workspace B 的通知接收人       │   │   │
│  │  └──────────────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## 告警规则

### 告警规则类型

```bash
# KubeSphere 支持两种告警规则

# 1. 平台级告警规则（平台管理员创建）
# 监控集群级别资源：节点、组件状态、etcd
# 示例：节点 CPU 使用率 > 80%

# 2. 工作负载级告警规则（项目成员创建）
# 监控项目内的工作负载：Deployment、Pod、Service
# 示例：某 Deployment 的 Pod 重启次数 > 3
```

### PromQL 告警规则示例

```yaml
# 告警规则 YAML（由 KubeSphere 界面配置后生成）
apiVersion: monitoring.kubesphere.io/v1alpha1
kind: PrometheusRule
metadata:
  name: myapp-alerts
  namespace: my-project
spec:
  groups:
    - name: myapp.rules
      rules:
        # CPU 使用率告警
        - alert: HighCPUUsage
          expr: |
            sum(rate(container_cpu_usage_seconds_total{
              namespace="my-project",
              pod=~"myapp-.*"
            }[5m])) by (pod)
            / sum(container_spec_cpu_quota{
              namespace="my-project",
              pod=~"myapp-.*"
            } / container_spec_cpu_period{
              namespace="my-project",
              pod=~"myapp-.*"
            }) by (pod) > 0.8
          for: 5m
          labels:
            severity: warning
            workspace: my-workspace
          annotations:
            summary: "应用 CPU 使用率过高"
            description: "Pod {{ $labels.pod }} CPU 使用率超过 80%"

        # 内存使用率告警
        - alert: HighMemoryUsage
          expr: |
            container_memory_usage_bytes{
              namespace="my-project",
              pod=~"myapp-.*"
            }
            /
            container_spec_memory_limit_bytes{
              namespace="my-project",
              pod=~"myapp-.*"
            } > 0.85
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "应用内存使用率过高"

        # Pod 重启次数告警
        - alert: PodRestartingTooMuch
          expr: |
            sum(rate(kube_pod_container_status_restarts_total{
              namespace="my-project"
            }[5m])) by (pod) > 0.1
          for: 5m
          labels:
            severity: critical
          annotations:
            summary: "Pod 重启过于频繁"

        # 服务不可用告警
        - alert: ServiceDown
          expr: |
            sum(kube_endpoint_address_available{
              namespace="my-project",
              endpoint="myapp"
            }) == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "服务 {{ $labels.endpoint }} 不可用"
```

## 告警策略

### 告警级别

```bash
# KubeSphere 告警级别
# Critical（严重）：立即通知，需要人工介入
# Warning（警告）：需要关注，可能影响服务
# Info（通知）：信息性告警，无需立即处理

# 告警策略配置
# - 告警重复间隔（Alert Resend Interval）
# - 告警有效时间（Alert Valid For）
# - 告警通知方式
```

### 告警策略配置

```yaml
# 告警策略示例
apiVersion: alerting.kubesphere.io/v1alpha2
kind: AlertingPolicy
metadata:
  name: myapp-policy
  namespace: my-project
spec:
  # 告警级别
  severity: warning

  # 告警名称
  name: 我的应用告警策略

  # 告警规则（引用告警规则）
  ruleNames:
    - HighCPUUsage
    - HighMemoryUsage

  # 告警评估周期
  evaluationInterval: 30s

  # 告警触发后多久发送通知
  for: 5m

  # 告警重发间隔
  resendInterval: 1h

  # 通知接收人
  receiver:
    name: myapp-team
```

## 通知渠道

### 支持的通知方式

```
┌─────────────────────────────────────────────────────────────────┐
│                    通知渠道支持                                    │
│                                                                  │
│  邮件（Email）                                                    │
│  - 配置 SMTP 服务器                                               │
│  - 支持 TLS/SSL                                                  │
│  - 支持自定义通知模板                                             │
│                                                                  │
│  钉钉（DingTalk）                                                 │
│  - 配置钉钉机器人 Webhook                                         │
│  - 支持 @ 指定人员                                               │
│  - 支持 Markdown 格式                                            │
│                                                                  │
│  Slack                                                            │
│  - 配置 Slack Webhook                                             │
│  - 支持频道通知                                                  │
│                                                                  │
│  企业微信（WeCom）                                                │
│  - 配置企业微信 Webhook                                           │
│  - 支持 @ 指定人员                                               │
│                                                                  │
│  飞书（Lark/Feishu）                                             │
│  - 配置飞书自定义机器人 Webhook                                   │
│  - 支持 Markdown 格式                                            │
│                                                                  │
│  短信（SMS）                                                     │
│  - 企业版支持                                                    │
│  - 按条计费                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 钉钉通知配置

```yaml
# 钉钉 Webhook 通知配置
# 在 KubeSphere 控制台配置
# 通知配置 → 添加接收人 → 选择钉钉

# 钉钉告警消息格式（Markdown）
{
  "msgtype": "markdown",
  "markdown": {
    "title": "[{{ .alert.metadata.labels.severity }}] {{ .alerts[0].labels.alertname }}",
    "text": "## 🚨 告警通知\n\n" +
            "**告警名称**: {{ .alerts[0].labels.alertname }}\n\n" +
            "**告警级别**: {{ .alerts[0].labels.severity }}\n\n" +
            "**环境**: {{ .alerts[0].labels.env }}\n\n" +
            "**摘要**: {{ .alerts[0].annotations.summary }}\n\n" +
            "**详情**: {{ .alerts[0].annotations.description }}\n\n" +
            "**触发时间**: {{ .alerts[0].startsAt }}\n\n" +
            "[查看详情](http://kubesphere-console.example.com)"
  }
}
```

## 多租户告警

### 租户隔离

```bash
# 每个 Workspace 的告警规则只监控该 Workspace 的资源
# Project A 的告警 → Project A 的成员收到通知
# Project B 的告警 → Project B 的成员收到通知

# 告警规则命名空间隔离
# 平台级告警：kubesphere-monitoring-system
# Workspace 级告警：workspace-{workspace-name}
# Project 级告警：{project-namespace}
```

### 告警通知路由

```
┌─────────────────────────────────────────────────────────────────┐
│                    告警通知路由                                    │
│                                                                  │
│  Prometheus 推送告警                                             │
│         │                                                      │
│         ▼                                                      │
│  AlertManager 接收                                               │
│         │                                                      │
│         ▼                                                      │
│  分组（Group）                                                   │
│  同一服务、同一时间段的告警合并为一条通知                           │
│         │                                                      │
│         ▼                                                      │
│  抑制（Inhibit）                                                 │
│  严重告警触发后，抑制相关低级别告警                                 │
│         │                                                      │
│         ▼                                                      │
│  通知发送                                                       │
│  根据告警级别和接收人配置，发送到对应渠道                           │
└─────────────────────────────────────────────────────────────────┘
```

## 告警模板

### 自定义告警消息模板

```yaml
# 告警消息模板（KubeSphere 支持 Jinja2 模板语法）
# 在通知配置中设置

# 邮件告警模板
Subject: [{{ .alert.status }}] {{ .alert.labels.severity }} - {{ .alert.labels.alertname }}

{% for alert in .alerts %}
========================================
告警名称: {{ alert.labels.alertname }}
告警级别: {{ alert.labels.severity }}
命名空间: {{ alert.labels.namespace }}
Pod 名称: {{ alert.labels.pod | default "N/A" }}
触发条件: {{ alert.annotations.current_value }}
告警描述: {{ alert.annotations.description }}
开始时间: {{ alert.startsAt }}
{% if alert.endsAt != "0001-01-01T00:00:00Z" %}
结束时间: {{ alert.endsAt }}
持续时间: {{ alert.duration }}
{% end %}
========================================
{% endfor %}

---
此邮件由 KubeSphere 告警系统自动发送
点击查看详情：http://kubesphere-console.example.com
```

## 最佳实践

### 告警分级策略

```
┌─────────────────────────────────────────────────────────────────┐
│                    告警分级建议                                    │
│                                                                  │
│  P0 - 严重（Critical）                                          │
│  - 服务完全不可用                                                │
│  - 基础组件故障（数据库、Redis）                                 │
│  - 通知方式：立即电话 + 短信 + 钉钉                               │
│  - 响应时间：5 分钟                                              │
│                                                                  │
│  P1 - 高（High）                                                │
│  - 错误率 > 1%                                                  │
│  - 延迟 P99 > 1s                                                │
│  - 通知方式：钉钉 + 邮件                                         │
│  - 响应时间：30 分钟                                            │
│                                                                  │
│  P2 - 中（Medium）                                              │
│  - CPU/内存 > 80%                                               │
│  - Pod 重启次数增加                                              │
│  - 通知方式：邮件                                               │
│  - 响应时间：2 小时                                             │
│                                                                  │
│  P3 - 低（Low）                                                 │
│  - 资源使用趋势性升高                                            │
│  - 通知方式：日报汇总                                            │
│  - 响应时间：工作日内                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 避免告警疲劳

```bash
# 1. 设置合理的 for 周期
# 不要一超过阈值就告警，等待 5 分钟确认是否是瞬时波动

# 2. 告警聚合
# 多个 Pod 的相同告警合并为一条
# 例如：10 个 Pod 中有 5 个 CPU > 80%，合并为一条

# 3. 抑制规则
# 当服务 Down 时，抑制该服务的所有其他告警
# 当基础组件告警时，抑制依赖该组件的上层告警

# 4. 静默规则
# 计划内维护期间，静默相关告警

# 5. 升级策略
# 首次告警发邮件，30 分钟后未确认则升级为钉钉
# 1 小时后未确认则电话通知
```

## 面试追问方向

1. **KubeSphere 的告警是怎么工作的？**
   答：KubeSphere 告警基于 Prometheus + AlertManager 实现。Prometheus 持续评估告警规则，满足条件后推送给 AlertManager。AlertManager 负责告警分组、抑制、静默和路由，最终通过 KubeSphere 的通知系统发送（邮件、钉钉等）。KubeSphere 在此基础上封装了多租户的告警视图和权限控制。

2. **如何避免告警疲劳？**
   答：核心是「分级 + 聚合 + 升级」。分级：不同严重程度的告警用不同渠道和响应时间；聚合：将同一服务、同一时间段的告警合并；升级：未及时处理的告警自动升级通知方式。另外，告警规则要有合理的 `for` 周期（不要一超标就告），避免瞬时波动触发告警。

3. **告警和监控的区别是什么？**
   答：监控是持续采集和展示数据（被动），告警是基于监控数据的主动通知（主动）。监控告诉你「现在发生了什么」，告警告诉你「发生了什么，需要你注意」。好的告警系统，是监控系统的延伸——没有告警，监控只能被动的去看盘；有告警，监控系统才能主动告诉你问题在哪里。

> "告警不是越多越好。好的告警系统，是能在真正需要你的时候叫醒你，而不是在你看监控的时候制造噪音。配置告警之前，先问自己：收到这条告警，我会采取什么行动？如果答案是『什么都不做』，那这条告警就是噪音。"
