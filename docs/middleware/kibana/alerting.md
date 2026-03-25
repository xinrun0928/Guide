# Kibana 告警规则与 Threshold Alerting

监控不仅仅是「看到」数据，更重要的是「知道」什么时候出了问题。Kibana 的告警功能让你能在指标异常时及时收到通知。

## 1. 告警概述

### 1.1 什么是告警？

告警是一种**主动通知机制**，当监控指标满足预设条件时，系统自动发送通知。

```
告警流程：

指标监控 → 条件判断 → 触发阈值 → 发送通知 → 响应处理

例如：
CPU > 80% → 持续 5 分钟 → 发送邮件 → 运维处理
```

### 1.2 Kibana 告警类型

| 类型 | 说明 | 适用场景 |
|-----|------|---------|
| Threshold | 阈值告警 | 指标超过/低于阈值 |
| Inventory | 库存告警 | 资源状态变化 |
| ML | 机器学习告警 | 异常检测 |
| APM | 应用性能告警 | 性能指标 |

## 2. Threshold 告警配置

### 2.1 基本配置流程

```
创建阈值告警步骤：

1. 创建规则
   └─→ Stack Management → Rules and Connectors → Create rule

2. 选择告警类型
   └─→ Threshold

3. 配置条件
   └─→ 索引、字段、运算符、阈值

4. 配置动作
   └─→ 发送邮件、Slack、Webhook 等

5. 启用并保存
```

### 2.2 配置界面

```
┌─────────────────────────────────────────────────────────────┐
│  Create Rule - Threshold                                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Name: High CPU Alert                                   │  │
│  │  Description: Alert when CPU > 80%                     │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Check every: 1m          For: 5m                      │  │
│  └───────────────────────────────────────────────────────┐  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Conditions                                           │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  WHERE avg of cpu_usage > 80                    │  │  │
│  │  │  OVER all documents                             │  │  │
│  │  │  IN index: metrics-*                            │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Actions                                              │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  ☑ Email                                         │  │  │
│  │  │  ☑ Slack                                        │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 条件配置详解

```java
// WHERE 子句
WHERE avg of cpu_usage > 80

// 支持的聚合函数
avg       // 平均值
sum       // 总和
min       // 最小值
max       // 最大值
count     // 文档数量
cardinality  // 去重计数
percentile   // 百分位数

// OVER 子句
OVER all documents                              // 全局
OVER all documents grouped by host              // 按字段分组
OVER top 10 documents by cpu_usage              // Top N

// IN 子句
IN index: metrics-*
IN index: logs-*,timefield: @timestamp
```

### 2.4 时间条件

```
告警时间条件：

Check every: 1m      ← 检查间隔（每次检查执行一次）
For: 5m              ← 触发条件（必须持续 5 分钟才告警）

时间条件组合：
├─ 立即告警：Check every: 1m, For: 1m
├─ 持续告警：Check every: 1m, For: 5m（必须持续 5 分钟）
└─ 间隔告警：Check every: 5m, For: 0m（每 5 分钟检查一次）
```

## 3. 连接器（Connectors）

### 3.1 连接器类型

| 类型 | 说明 | 适用场景 |
|-----|------|---------|
| Email | 邮件通知 | 正式通知、报告 |
| Slack | Slack 消息 | 团队协作、快速响应 |
| Webhook | HTTP 回调 | 集成第三方系统 |
| PagerDuty | 告警平台 | 生产告警 |
| Jira | 问题跟踪 | 创建工单 |

### 3.2 配置 Email 连接器

```
配置 Email：

1. 创建连接器
   └─→ Name: Production Alerts
   └─→ Type: Email

2. 配置 SMTP
   └─→ From: alerts@example.com
   └─→ To: oncall@example.com
   └─→ Host: smtp.example.com
   └─→ Port: 587

3. 保存并测试
```

### 3.3 配置 Slack 连接器

```
配置 Slack：

1. 创建连接器
   └─→ Name: Slack Alerts
   └─→ Type: Slack

2. 配置 Webhook
   └─→ Webhook URL: https://hooks.slack.com/services/xxx

3. 消息模板
   └─→ 自定义消息格式
```

### 3.4 配置 Webhook 连接器

```java
// Webhook 配置
{
  "url": "http://your-system.com/webhook",
  "method": "POST",
  "headers": {
    "Authorization": "Bearer xxx",
    "Content-Type": "application/json"
  },
  "body": {
    "alert": "{{context.rule.name}}",
    "message": "{{context.message}}",
    "value": "{{context.value}}",
    "timestamp": "{{context.date}}"
  }
}
```

## 4. 告警规则模板

### 4.1 服务可用性告警

```java
// 规则：服务错误率告警
Name: Service Error Rate Alert
Check every: 1m
For: 2m

Conditions:
WHERE sum of count > 0
WHERE term of status >= 500
IN index: nginx-logs-*

Action:
- Slack: "@oncall Service error rate spike detected"
- Email: 告警报告
```

### 4.2 性能告警

```java
// 规则：响应时间告警
Name: High Response Time Alert
Check every: 30s
For: 5m

Conditions:
WHERE avg of response_time > 3000
OVER all documents grouped by service
IN index: logs-*

Action:
- Slack: "High latency detected"
```

### 4.3 容量告警

```java
// 规则：磁盘使用率告警
Name: Disk Usage Alert
Check every: 5m
For: 10m

Conditions:
WHERE max of disk_usage > 85
OVER all documents grouped by host
IN index: metrics-*

Action:
- Email: 磁盘使用率告警
- Webhook: 触发自动扩容
```

## 5. 告警消息模板

### 5.1 消息变量

```java
// 可用变量
{{context.rule.name}}      // 规则名称
{{context.rule.id}}        // 规则 ID
{{context.message}}        // 自动生成的消息
{{context.date}}           // 触发时间
{{context.conditions[0].metric}}  // 触发条件的指标值
{{context.value}}          // 当前值
{{context.link}}           // 指向 Kibana 的链接
```

### 5.2 自定义消息

```java
// Slack 消息模板
{
  "text": "🚨 {{context.rule.name}}",
  "attachments": [{
    "color": "danger",
    "fields": [{
      "title": "服务",
      "value": "{{service}}",
      "short": true
    }, {
      "title": "错误数",
      "value": "{{context.value}}",
      "short": true
    }]
  }]
}
```

### 5.3 邮件模板

```java
// 邮件模板
Subject: [Alert] {{context.rule.name}}

Body:
告警名称: {{context.rule.name}}
触发时间: {{context.date}}
触发条件: {{context.message}}

当前值: {{context.value}}
阈值: {{context.threshold}}

查看详情: {{context.link}}

请及时处理。
```

## 6. 告警管理

### 6.1 查看告警状态

```
告警状态：

Active     // 告警中（条件满足）
Recovered  // 已恢复（条件不再满足）
Error      // 执行错误
Pending    // 等待触发
```

### 6.2 告警历史

```
告警历史：

- 查看历史触发的告警
- 分析告警趋势
- 评估告警有效性
- 调整阈值
```

### 6.3 告警抑制

```java
// 告警抑制配置

// 避免告警风暴：同一告警触发后，抑制一段时间
Suppress: 10m  // 10 分钟内不重复告警

// 分组抑制：同类型告警合并
Group by: service  // 同一服务只发送一条告警
```

## 7. 高级配置

### 7.1 按维度告警

```java
// 规则：每个服务单独监控
Name: Per-Service Error Alert
Check every: 1m
For: 2m

Conditions:
WHERE sum of count > 0
OVER all documents grouped by service
IN index: logs-*

Action:
- Slack: "{{service}} has errors"
```

### 7.2 多条件告警

```java
// 规则：多个条件组合
Name: System Health Alert
Check every: 1m
For: 3m

Conditions:
(1) WHERE avg of cpu_usage > 80
AND
(2) WHERE avg of memory_usage > 90
IN index: metrics-*

Action:
- Slack: "System health critical"
```

### 7.3 恢复通知

```java
// 配置恢复通知
Name: Error Rate Alert

// 触发条件
Conditions:
WHERE avg of error_rate > 0.05

// 触发动作
Actions (Active):
- Slack: "Error rate exceeded 5%"

// 恢复动作
Actions (Recovered):
- Slack: "Error rate back to normal"
```

## 8. 最佳实践

### 8.1 告警设计原则

```
告警设计原则：

1. 明确性
   └─→ 告警名称和消息清晰易懂
   └─→ 附带必要的上下文信息

2. 可操作性
   └─→ 每个告警都应有明确的处理流程
   └─→ 提供足够的诊断信息

3. 避免告警疲劳
   └─→ 设置合理的阈值
   └─→ 使用告警抑制
   └─→ 按重要性分级

4. 持续优化
   └─→ 定期回顾告警有效性
   └─→ 调整不合理的阈值
```

### 8.2 告警分级

```
告警分级：

P1 - Critical（紧急）
└─→ 服务完全不可用
└─→ 需要立即响应
└─→ 电话/短信通知

P2 - High（高）
└─→ 核心功能受影响
└─→ 需要尽快处理
└─→ Slack/邮件通知

P3 - Medium（中）
└─→ 非核心功能问题
└─→ 工作时间处理
└─→ 邮件通知

P4 - Low（低）
└─→ 轻微问题
└─→ 批量报告
└─→ 日报汇总
```

### 8.3 阈值设置建议

```java
// 常用阈值参考

// 性能
响应时间 P95 > 2s     → 警告
响应时间 P95 > 5s     → 严重
CPU > 80%             → 警告
CPU > 95%             → 严重

// 可用性
错误率 > 1%           → 警告
错误率 > 5%           → 严重
成功率 < 99%          → 警告
成功率 < 95%          → 严重

// 容量
磁盘使用 > 80%        → 警告
磁盘使用 > 95%        → 严重
内存使用 > 85%        → 警告
内存使用 > 95%        → 严重
```

## 9. 常见问题

### Q1：告警没有触发？

**答案**：
1. 检查规则是否启用
2. 检查时间范围是否包含数据
3. 检查索引模式是否匹配
4. 查看告警执行日志

### Q2：告警过多怎么办？

**答案**：
1. 调整阈值，降低敏感度
2. 增加 For 时间（持续多久才告警）
3. 使用告警抑制
4. 按维度分组，减少重复告警

### Q3：如何集成到运维平台？

**答案**：使用 Webhook 连接器，将告警发送到运维平台（如PagerDuty、飞书、企业微信）。

## 总结

Kibana 告警的核心要点：

1. **Threshold 告警**：最常用的阈值告警
2. **连接器**：Email、Slack、Webhook 等通知方式
3. **时间条件**：Check every 和 For 的配合
4. **消息模板**：使用变量自定义通知内容
5. **最佳实践**：避免告警疲劳，持续优化

---

**留给你的问题**：

假设你负责一个电商系统，需要设计告警规则。

1. 哪些指标最重要？
2. 阈值应该怎么设置？
3. 不同级别的告警如何通知？
4. 如何避免告警疲劳？

请设计一个完整的告警方案。
