# Kibana 仪表盘分享与嵌入式可视化

你已经创建了漂亮的仪表板，现在的问题是：**如何让其他人也能看到？**

Kibana 提供了多种分享方式，从简单的链接分享到嵌入式可视化，满足不同场景需求。

## 1. 分享方式概览

```
┌─────────────────────────────────────────────────────────────┐
│                    分享方式                                  │
│                                                               │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │   分享链接  │  │  嵌入式     │  │  导出报告   │        │
│   │  Share Link │  │   iFrame    │  │  PDF/CSV    │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## 2. 分享链接

### 2.1 生成分享链接

```
分享仪表板步骤：

1. 打开仪表板
2. 点击右上角 Share 按钮
3. 选择 Link 标签
4. 复制链接
```

### 2.2 链接选项

```
链接分享选项：

┌─────────────────────────────────────────────────────────────┐
│  Share Link                                                   │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ☑ Include embedded iframe                             │  │
│  │  ┌─────────────────────────────────────────────────┐  │  │
│  │  │  <iframe src="..." width="100%" height="600">  │  │  │
│  │  └─────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ☑ Short URL                                         │  │
│  │  ☑ Client-side permissions (uses browser cookie)    │  │
│  │  ☐ Server-side permissions (login required)         │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  Copy Link: ┌─────────────────────────────────────────┐    │
│             │ https://kibana:5601/share/dashboards/...│    │
│             └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.3 权限选项

| 选项 | 说明 | 适用场景 |
|-----|------|---------|
| Client-side permissions | 基于浏览器 Cookie | 内部共享 |
| Server-side permissions | 需要登录 | 外部共享、安全要求高 |

## 3. 嵌入式可视化（iFrame）

### 3.1 生成嵌入代码

```
嵌入可视化步骤：

1. 打开可视化
2. 点击 Share → Embed code
3. 复制 HTML 代码

生成的代码：
<iframe
  src="http://kibana:5601/app/visualize#/embed?..."
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

### 3.2 自定义嵌入参数

```html
<!-- 基础嵌入 -->
<iframe
  src="http://kibana:5601/app/visualize#/embed?..."
  width="100%"
  height="600"
></iframe>

<!-- 隐藏顶部导航 -->
<iframe
  src="http://kibana:5601/app/visualize#/embed?hideHeader=true&..."
  width="100%"
  height="600"
></iframe>

<!-- 指定时间范围 -->
<iframe
  src="http://kibana:5601/app/visualize#/embed?_g=(time:(from:now-7d,mode:quick,to:now))&..."
  width="100%"
  height="600"
></iframe>

<!-- 指定过滤器 -->
<iframe
  src="http://kibana:5601/app/visualize#/embed?_t=...,filters=..."
  width="100%"
  height="600"
></iframe>
```

### 3.3 URL 参数说明

```java
// 时间参数
_g=(time:(from:now-7d,to:now))
_g=(time:(from:2024-01-01,to:2024-01-31))

// 过滤器参数
_f=(query:(query_string:(analyze_wildcard:true,query:'service:user-svc')))

// 隐藏元素
hideHeader=true
hideAnnouncements=true

// 刷新间隔
_autorefreshInterval=30000
```

## 4. 完整页面嵌入

### 4.1 仪表板完整嵌入

```html
<!DOCTYPE html>
<html>
<head>
  <title>监控仪表板</title>
  <style>
    body { margin: 0; padding: 0; }
    iframe { width: 100vw; height: 100vh; border: none; }
  </style>
</head>
<body>
  <iframe
    src="http://kibana:5601/s/production/app/dashboards#/view/dashboard-id?embed=true&_g=(time:(from:now-24h,to:now))"
    allow="fullscreen"
  ></iframe>
</body>
</html>
```

### 4.2 固定过滤器嵌入

```html
<!-- 固定显示某个服务的数据 -->
<iframe
  src="http://kibana:5601/s/production/app/dashboards#/view/dashboard-id?embed=true&_t=...&_f=(query:(match_phrase:(service:user-svc)))"
></iframe>
```

### 4.3 响应式嵌入

```html
<style>
  .kibana-iframe-container {
    position: relative;
    width: 100%;
    padding-top: 56.25%; /* 16:9 比例 */
  }

  .kibana-iframe-container iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }
</style>

<div class="kibana-iframe-container">
  <iframe src="..."></iframe>
</div>
```

## 5. 导出报告（Reporting）

### 5.1 生成 PDF 报告

```
导出 PDF 步骤：

1. 打开仪表板/可视化
2. 点击 Share → PDF Reports
3. 配置选项
   └─→ Layout: Portrait / Landscape
   └─→ Size: A4 / Letter / Custom
4. 点击 Generate PDF
5. 等待生成完成
6. 下载 PDF
```

### 5.2 定时报告

```
定时报告配置：

1. Stack Management → Reporting → Create report

2. 选择类型
   └─→ Dashboard PDF
   └─→ Visualization PNG

3. 选择对象
   └─→ Dashboard: Sales Dashboard

4. 设置时间
   └─→ Time range: Last 7 days
   └─→ Schedule: Weekly (Monday 9:00 AM)

5. 交付方式
   └─→ Email to: team@example.com
```

### 5.3 CSV 报告

```
导出 CSV 步骤：

1. Discover → 保存的搜索
2. 点击 Actions → Export CSV
3. 下载 CSV 文件

支持的格式：
├─ CSV (逗号分隔)
├─ TSV (制表符分隔)
└─ TXT (纯文本)
```

## 6. 分享最佳实践

### 6.1 内部共享

```html
<!-- 内部仪表板嵌入 -->
<iframe
  src="http://kibana.internal:5601/s/production/app/dashboards/...?embed=true"
  width="100%"
  height="800"
  frameborder="0"
></iframe>

<!-- 带固定时间范围 -->
<iframe
  src="...?embed=true&_g=(time:(from:now-7d,to:now))"
></iframe>
```

### 6.2 外部共享

```html
<!-- 外部页面嵌入（使用公共 URL） -->
<!-- 注意：需要配置 Kibana 允许外部嵌入 -->

<!-- 使用 iframe 嵌入 -->
<iframe
  src="https://kibana.example.com/s/public/app/dashboards/...?embed=true"
  width="100%"
  height="800"
></iframe>
```

### 6.3 安全考虑

```java
// 安全配置

// Kibana.yml 配置
server.publicBaseUrl: "https://kibana.example.com"
xpack.security.allowedIframeHosts:
  - "https://example.com"
  - "https://dashboard.example.com"

// 响应头设置
Content-Security-Policy: frame-ancestors 'self' https://example.com
```

## 7. 第三方集成

### 7.1 与 Grafana 对比

```
Kibana vs Grafana 分享：

┌──────────────────┬──────────────────┐
│      Kibana      │     Grafana     │
├──────────────────┼──────────────────┤
│ iFrame 嵌入     │ iFrame 嵌入      │
│ 独立 HTML 导出  │ 独立 HTML 导出   │
│ 直接分享链接    │ 直接分享链接     │
│ API 集成        │ API 集成         │
│ 截图/PDF        │ 截图/PDF/CSV    │
└──────────────────┴──────────────────┘

选择建议：
- ELK 生态：使用 Kibana
- 多数据源：使用 Grafana
```

### 7.2 API 集成

```java
// 使用 Reporting API 生成报告

// 1. 获取报告
POST /api/reporting/generate/dashboard
{
  "dashboardId": "dashboard-123",
  "title": "Weekly Report",
  "timeRange": {
    "from": "now-7d",
    "to": "now"
  }
}

// 2. 下载报告
GET /api/reporting/downloads/{job-id}

// 3. 检查状态
GET /api/reporting/jobs/{job-id}
```

## 8. 常见问题

### Q1：嵌入后页面空白？

**答案**：
1. 检查 iframe 源 URL 是否正确
2. 检查 CORS 配置
3. 确认用户有访问权限
4. 检查浏览器控制台错误

### Q2：嵌入后样式不对？

**答案**：
1. 设置 iframe 宽高
2. 添加 CSS 重置
3. 使用正确的 embed 参数

### Q3：如何限制嵌入访问？

**答案**：
1. 使用 Server-side permissions
2. 配置 allowedIframeHosts
3. 设置 Token 过期时间

## 9. 分享场景模板

### 9.1 内部监控页面

```html
<!-- 公司内网监控页面 -->
<!DOCTYPE html>
<html>
<head>
  <title>运维监控</title>
  <meta http-equiv="refresh" content="60">  <!-- 每分钟刷新 -->
</head>
<body>
  <h1>系统监控 - 实时</h1>
  <iframe
    src="http://kibana.internal/s/ops/app/dashboards/...?embed=true&_g=(time:(from:now-1h,to:now))&hideHeader=true"
    width="100%"
    height="800"
  ></iframe>
</body>
</html>
```

### 9.2 数据报告页面

```html
<!-- 月度报告页面 -->
<!DOCTYPE html>
<html>
<head>
  <title>月度销售报告</title>
</head>
<body>
  <h1>销售数据分析报告</h1>
  <p>报告时间：2024年1月</p>

  <h2>销售趋势</h2>
  <iframe src=".../visualization/sales-trend?...&embed=true"></iframe>

  <h2>区域分布</h2>
  <iframe src=".../visualization/region-dist?...&embed=true"></iframe>
</body>
</html>
```

## 总结

Kibana 分享功能的核心要点：

1. **分享链接**：快速分享给内部用户
2. **嵌入式 iFrame**：嵌入到外部页面
3. **PDF/CSV 报告**：生成定时或手动报告
4. **安全配置**：正确配置权限和 CORS

---

**留给你的问题**：

假设你需要将 Kibana 仪表板嵌入到公司官网的「关于我们」页面中，展示公开的统计数据。

你会如何配置？需要考虑什么问题？
