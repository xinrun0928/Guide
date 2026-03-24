# Grafana：仪表盘、变量、告警

「Grafana 怎么做出让人眼前一亮的 Dashboard？」——变量、面板、告警三件套。

Grafana 是 Prometheus 的最佳拍档。但大多数人的 Grafana 用法是：Import 一个 Dashboard，然后改改标题。不是不能用，是太浪费了。学会用变量驱动面板、用表达式做计算、用 Unified Alerting 做告警，才能真正发挥 Grafana 的价值。

## 变量系统

### 变量类型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Grafana 变量类型                                │
│                                                                  │
│  Query        │ 从数据源查询可选项（Prometheus label_values）     │
│  Interval     │ 自动生成分布式时间间隔（1m, 5m, 15m...）         │
│  Custom       │ 自定义静态选项列表                                 │
│  Constant     │ 常量（Dashboard 间传递参数）                      │
│  Data source  │ 选择数据源                                        │
│  Ad hoc filter│ 自动从查询中生成过滤条件                           │
│  Text box     │ 自由文本输入                                      │
│  System       │ 内置变量（$__from, $__to, $user.name...）        │
└─────────────────────────────────────────────────────────────────┘
```

### Query 变量：动态下拉

```promql
# PromQL Query 变量
# 查询所有 service 标签的值
label_values(http_requests_total, service)

# 嵌套查询（先查 deployment，再查 pod）
label_values(
  sum by (deployment) (
    rate(http_requests_total[5m])
  ),
  deployment
)
```

### Dashboard 变量配置示例

```json
{
  "name": "env",
  "type": "query",
  "query": "label_values(up, env)",
  "default": "prod",
  "hide": "",
  "includeAll": true,
  "allValue": ".*"
}
```

### 变量引用

```promql
# Panel 查询中使用变量
# 格式：$variableName 或 ${variableName}

# 直接引用
sum by (service) (rate(http_requests_total{service="$env"}[5m]))

# 正则匹配（多选）
sum by (service) (rate(http_requests_total{service=~"$env"}[5m]))

# 包含全部（当选择 "All" 时匹配所有）
sum by (service) (rate(http_requests_total{service=~"${env:regex}"}[5m]))

# 嵌套变量引用
# 变量 A 的选项依赖于变量 B 的值
label_values(http_requests_total{service="$service"}, method)
```

### 变量联动

```
场景：选择「环境」后，「服务」下拉只显示该环境的服务

实现：
1. env 变量：label_values(up, env) → ["prod", "staging", "dev"]
2. service 变量：label_values(http_requests_total{env="$env"}, service)
   → 选择 prod 时，只显示 prod 下的服务
3. instance 变量：label_values(http_requests_total{service="$service"}, instance)
   → 选择 order-service 后，只显示该服务的实例
```

### 内置变量

```promql
# 时间变量
$__from        # 起始时间（毫秒时间戳或格式化）
$__to          # 结束时间
$__dateTimeFormate($__from)  # 格式化时间

# 区间变量（自动计算）
$__range       # 查询区间（秒）
$__range_s     # 同上，秒为单位
$__range_ms    # 同上，毫秒为单位
$__rate_interval  # 自动扩展的 rate 窗口（避免漏采）

# 示例：使用 $__rate_interval
# 比固定的 [5m] 更健壮，自动适配不同的查询区间
rate(http_requests_total[$__rate_interval])

# 其他内置变量
$__interval      # Panel 的时间间隔
$__interval_ms   # 毫秒版
$ds              # 当前数据源
$dsRealm         # 数据源 UID
$user.login      # 当前登录用户
```

## 面板（Panel）配置

### 面板类型选择

```
┌─────────────────────────────────────────────────────────────────┐
│                    Grafana 面板类型                                │
│                                                                  │
│  Graph (Time series) │ 时序图（折线/面积/柱状）                    │
│  Stat               │ 单值统计（卡片式）                           │
│  Gauge             │ 仪表盘（0-100%）                            │
│  Table             │ 表格                                        │
│  Bar Chart         │ 柱状图                                      │
│  Pie Chart         │ 饼图                                        │
│  Geomap            │ 地图                                        │
│  News              │ RSS 新闻（占位用）                          │
│  Text              │ 文本面板（说明/标题）                        │
│  Alert list        │ 告警列表                                    │
└─────────────────────────────────────────────────────────────────┘
```

### 时序图（Time Series）配置

```json
{
  "panels": [
    {
      "title": "请求率",
      "type": "timeseries",
      "datasource": "Prometheus",
      "targets": [
        {
          "expr": "sum by (service) (rate(http_requests_total[$__rate_interval]))",
          "legendFormat": "{{service}}"
        }
      ],
      "fieldConfig": {
        "defaults": {
          "unit": "reqps",
          "custom": {
            "lineWidth": 2,
            "fillOpacity": 10,
            "gradientMode": "opacity",
            "showPoints": "never"
          },
          "thresholds": {
            "mode": "absolute",
            "steps": [
              { "color": "green", "value": null },
              { "color": "yellow", "value": 100 },
              { "color": "red", "value": 500 }
            ]
          },
          "min": 0
        }
      },
      "options": {
        "legend": {
          "displayMode": "table",
          "placement": "right",
          "calcs": ["lastNotNull", "mean", "max"]
        },
        "tooltip": {
          "mode": "multi",
          "sort": "desc"
        }
      }
    }
  ]
}
```

### 仪表盘（Gauge）配置

```json
{
  "title": "CPU 使用率",
  "type": "gauge",
  "targets": [
    {
      "expr": "100 - (avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100)"
    }
  ],
  "fieldConfig": {
    "defaults": {
      "unit": "percent",
      "min": 0,
      "max": 100,
      "thresholds": {
        "mode": "percentage",
        "steps": [
          { "color": "green", "value": null },
          { "color": "yellow", "value": 70 },
          { "color": "orange", "value": 85 },
          { "color": "red", "value": 95 }
        ]
      }
    }
  }
}
```

### 表格（Table）配置

```json
{
  "title": "服务状态",
  "type": "table",
  "transform": "timeseries_to_columns",
  "targets": [
    {
      "expr": "up{job=~\"$job\"}",
      "format": "table"
    }
  ],
  "fieldConfig": {
    "overrides": [
      {
        "matcher": { "id": "byName", "options": "Value" },
        "properties": [
          {
            "id": "mappings",
            "value": [
              { "type": "value", "options": { "1": { "text": "Up", "color": "green" } } },
              { "type": "value", "options": { "0": { "text": "Down", "color": "red" } } }
            ]
          }
        ]
      }
    ]
  }
}
```

## 数据转换（Transformations）

### 常用转换

```json
{
  "transformations": [
    {
      "id": "organize",
      "options": {
        "excludeByName": {
          "Time": true
        },
        "renameByName": {
          "Value": "Status",
          "instance": "Instance"
        }
      }
    },
    {
      "id": "merge",
      "options": {}
    },
    {
      "id": "outerJoin",
      "options": {
        "mode": "outer"
      }
    },
    {
      "id": "groupBy",
      "options": {
        "fields": {
          "Value": { "aggregations": ["lastNotNull"], "operation": "aggregate" },
          "service": { "aggregations": [], "operation": "groupby" }
        }
      }
    },
    {
      "id": "filterFieldsByName",
      "options": {
        "include": {
          "pattern": "^(service|instance|Value)$"
        }
      }
    }
  ]
}
```

## Grafana Explore

### Explore 模式

```
┌─────────────────────────────────────────────────────────────────┐
│                    Explore 使用技巧                               │
│                                                                  │
│  1. 临时查询，不污染 Dashboard                                    │
│  2. 快速验证 PromQL 是否正确                                      │
│  3. 查看原始数据（Table 模式）                                    │
│  4. Inspector 查看查询详情                                        │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Inspector 面板                                          │    │
│  │  Query │ Response │ Stats │ Query History                │    │
│  │                                                         │    │
│  │  Stats：查询耗时、采样数、结果大小                        │    │
│  │  Response：原始 JSON（用于 Debug）                        │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Query History

```promql
# Query History 是 Explore 的查询记录
# 可以：
# 1. 收藏常用查询
# 2. 标注查询用途
# 3. 导出为 Dashboard（右键 → Create Dashboard）
```

## Grafana Unified Alerting

### 告警规则配置

```json
{
  "apiVersion": 1,
  "groups": [
    {
      "orgId": 1,
      "name": "service-alerts",
      "folder": "Production",
      "interval": "1m",
      "rules": [
        {
          "uid": "cpu-high-alert",
          "title": "High CPU Usage",
          "condition": "C",
          "data": [
            {
              "refId": "A",
              "relativeTimeRange": {
                "from": 300,
                "to": 0
              },
              "datasourceUid": "prometheus",
              "model": {
                "expr": "avg by (instance) (rate(node_cpu_seconds_total{mode=\"idle\"}[5m])) * 100"
              }
            },
            {
              "refId": "B",
              "relativeTimeRange": {
                "from": 300,
                "to": 0
              },
              "datasourceUid": "__expr__",
              "model": {
                "conditions": [
                  {
                    "evaluator": {
                      "params": [],
                      "type": "lt"
                    }
                  }
                ],
                "datasource": {
                  "type": "__expr__",
                  "uid": "__expr__"
                },
                "expression": "A",
                "reducer": "avg",
                "refId": "B",
                "type": "reduce"
              }
            },
            {
              "refId": "C",
              "relativeTimeRange": {
                "from": 300,
                "to": 0
              },
              "datasourceUid": "__expr__",
              "model": {
                "conditions": [
                  {
                    "evaluator": {
                      "params": [20],
                      "type": "lt"
                    }
                  }
                ],
                "datasource": {
                  "type": "__expr__",
                  "uid": "__expr__"
                },
                "expression": "B",
                "refId": "C",
                "type": "threshold"
              }
            }
          ],
          "noDataState": "NoData",
          "execErrState": "Error",
          "for": "5m",
          "annotations": {
            "summary": "CPU usage on {{ $labels.instance }} is {{ $values.B.Value }}%",
            "description": "CPU idle is below 20% for 5 minutes"
          },
          "labels": {
            "severity": "critical",
            "team": "ops"
          }
        }
      ]
    }
  ]
}
```

### 多条件告警

```json
{
  "rules": [
    {
      "title": "Service Degraded",
      "condition": "D",
      "data": [
        {
          "refId": "A",
          "model": {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m])"
          }
        },
        {
          "refId": "B",
          "model": {
            "expr": "rate(http_requests_total[5m])"
          }
        },
        {
          "refId": "C",
          "model": {
            "expression": "(A / B) * 100",
            "type": "math"
          }
        },
        {
          "refId": "D",
          "model": {
            "conditions": [
              {
                "evaluator": {
                  "params": [5],
                  "type": "gt"
                }
              }
            ],
            "expression": "C",
            "type": "threshold"
          }
        }
      ],
      "for": "3m",
      "annotations": {
        "summary": "Service {{ $labels.service }} error rate is {{ $values.C }}%"
      }
    }
  ]
}
```

## 告警通知渠道

```yaml
# contactpoints 配置（Grafana 10+）
apiVersion: 1
contactPoints:
  - name: ops-team
    receivers:
      - uid: slack-critical
        type: slack
        settings:
          recipient: "#alerts-critical"
          token: $SLACK_BOT_TOKEN
          mentionChannel: "here"
        # 告警触发时 @here
        # 支持告警标签控制通知内容
        # {{ if .Alerts.Firing }}...{{ end }}

  - name: pagerduty-critical
    receivers:
      - uid: pagerduty
        type: pagerduty
        settings:
          integrationKey: $PAGERDUTY_KEY
          severity: critical
          class: monitoring
          component: grafana

  - name: webhook-custom
    receivers:
      - uid: webhook
        type: webhook
        settings:
          url: http://custom-service/alert
          httpMethod: POST
          basicAuthUser: xxx
          basicAuthPassword: $WEBHOOK_AUTH
```

## 最佳实践

```
┌─────────────────────────────────────────────────────────────────┐
│                    Grafana Dashboard 最佳实践                     │
│                                                                  │
│  1. 层级设计：                                                   │
│      Overview (Row) → Service (Row) → Instance (Row)           │
│      顶层看全局，中层看服务，底层看实例                            │
│                                                                  │
│  2. 变量驱动：                                                   │
│      env → service → instance → pod（层层联动）                  │
│                                                                  │
│  3. 颜色规范：                                                   │
│      OK / Green: 可用性 ≥ 99.9%                                 │
│      Yellow: SLA 边缘（99% ~ 99.9%）                             │
│      Red: SLA 低于 99%                                          │
│                                                                  │
│  4. 单位规范：                                                   │
│      请求率: reqps                                              │
│      延迟: ms / s                                               │
│      百分比: percent / percentunit                               │
│      字节: bytes / bits                                         │
│                                                                  │
│  5. 图例设计：                                                   │
│      显示当前值 / 平均值 / 最大值                                 │
│      按值排序，高值在上                                           │
└─────────────────────────────────────────────────────────────────┘
```

## 面试追问方向

1. **Grafana 如何实现跨数据源查询？**
   答：使用 Mixed 数据源，在同一面板中添加多个查询，每个查询指向不同数据源。Grafana 会合并结果。需要注意的是，混合数据源时 PromQL 语法不变，但无法做跨数据源的 Join（需要 Transformation 的 Outer Join）。

2. **Grafana Alerting 和 Prometheus AlertManager 如何选择？**
   答：Grafana Alerting 和 Prometheus AlertManager 是互补关系。Grafana Alerting 适合 Dashboard 驱动的告警（看图发现问题 → 点按钮告警）；Prometheus AlertManager 适合运维自动化（由 Prometheus 规则触发，抑制、静默等机制更完善）。生产环境建议两者结合：Grafana 管理告警规则 + Prometheus AlertManager 统一路由。

3. **如何避免 Grafana Dashboard 加载慢？**
   答：避免面板中执行复杂 PromQL（用 Recording Rules 预计算）；减少面板数量（每个 Dashboard 不超过 10 个面板）；使用 Table 代替多个 Graph；Dashboard 设置变量默认值，减少初始加载查询；开启 Dashboard 缓存（浏览器端）；Grafana 8+ 使用 Server Side Caching。

4. **`$__rate_interval` 和固定 `[5m]` 哪个更好？**
   答：`$__rate_interval` 更好。它是 Grafana 自动计算的区间，公式为 `max(外层查询区间 / 120, 15s)`。当 Dashboard 时间范围变化时（如从 1h 切到 6h），`[5m]` 窗口不变，导致采样点减少或漏采；`$__rate_interval` 会自动调整，保证采样点数稳定。

Grafana 是监控的「面子」。好用的 Dashboard，让排查问题从「大海捞针」变成「一目了然」。
