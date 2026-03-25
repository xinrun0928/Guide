# Kibana 查询语法：KQL（Kibana Query Language）与 Lucene

你已经知道 ES 的查询 DSL，但 Kibana 提供了一种更简洁的查询方式：**KQL（Kibana Query Language）**。

## 1. KQL 简介

KQL 是 Kibana 独有的查询语言，专为 Kibana 的 Discover、仪表板等场景设计。相比 ES 的 DSL，KQL 更简洁、更直观。

```
对比示例：

ES DSL：
{
  "query": {
    "bool": {
      "must": [
        { "match": { "message": "error" } },
        { "term": { "service": "user-svc" } }
      ]
    }
  }
}

KQL：
message: error and service: user-svc
```

## 2. 基本语法

### 2.1 字段查询

```java
// 精确匹配
status: 200

// 全文搜索（message 字段）
message: error

// 短语搜索（精确短语）
message: "error occurred"

// 数值范围
bytes: >= 1000
response_time: 100 TO 500

// 日期范围
@timestamp: "2024-01-15" to "2024-01-16"
```

### 2.2 通配符

```java
// 单字符通配符
service: user-sv?

// 多字符通配符
service: user-*

// 正则表达式
message: /error.*exception/
```

### 2.3 数值和范围

```java
// 精确数值
bytes: 1024

// 范围
bytes: 1000 to 5000
bytes: >= 1000
bytes: < 10000

// 组合
status: >= 400 and bytes: > 1000
```

## 3. 逻辑操作

### 3.1 AND / OR / NOT

```java
// AND：两个条件都满足
status: 200 and service: user-svc

// OR：满足任一条件
service: user-svc or service: order-svc

// NOT：排除条件
not service: auth-svc
level: ERROR and not message: timeout

// 括号改变优先级
(status: 200 or status: 201) and service: user-svc
```

### 3.2 存在性检查

```java
// 字段存在
user_id: *

// 字段不存在
not user_id: *
```

## 4. 特殊查询

### 4.1 全文搜索

```java
// 默认搜索 _all 字段
error timeout

// 等同于
_all: error or _all: timeout

// 搜索特定字段
message: error and message: timeout
```

### 4.2 嵌套字段查询

```java
// 查询嵌套对象（使用点号）
user.name: "John"
comments.text: "great"

// 查询嵌套数组
products.name: "iPhone"
```

### 4.3 地理查询

```java
// 地理位置范围
geoip.country_name: "China"

// 距离查询（需要配合 geo_point）
location: (40.7, -74.0) within 100km
```

## 5. KQL 的局限性

### 5.1 KQL 不支持的功能

```java
// KQL 不能做的事：
// 1. 聚合查询（需要使用 Visualize）
// 2. 脚本字段
// 3. 高级分析（如 function_score）

// 这些场景需要用 ES DSL 或 Vega
```

### 5.2 何时用 Lucene

某些场景需要切换到 Lucene 语法：

```java
// Lucene 语法示例
message: error AND NOT message: timeout
service: (user-svc OR order-svc) AND status: 200

// KQL 等价
message: error and not message: timeout
service: (user-svc or order-svc) and status: 200
```

## 6. KQL vs Lucene

| 特性 | KQL | Lucene |
|-----|-----|--------|
| 语法风格 | 更接近自然语言 | 更像传统查询 |
| 布尔操作 | AND, OR, NOT | AND, OR, NOT, + , - |
| 范围查询 | `field: >= 100` | `field:[100 TO *]` |
| 短语搜索 | `"exact phrase"` | `"exact phrase"` |
| 正则表达式 | 支持 | 支持 |
| 补全支持 | 更好 | 一般 |

## 7. 实用查询示例

### 7.1 错误日志查询

```java
// 查询所有错误日志
level: ERROR

// 查询特定服务的错误
level: ERROR and service: user-svc

// 排除调试日志
not level: DEBUG

// 错误且包含特定关键词
level: ERROR and message: "NullPointerException"
```

### 7.2 性能分析

```java
// 慢请求
response_time: > 5000

// 高流量端点
request_path: "/api/orders" and method: POST

// 5xx 错误
status: >= 500 and status: < 600
```

### 7.3 安全监控

```java
// 登录失败
event: "login_failed"

// 异常访问
status: 403 or status: 401

// 可疑 IP 访问
source_ip: 192.168.1.100 and status: 403
```

## 8. 自动补全

KQL 提供智能补全功能：

```
补全触发：
1. 输入字段名 + :
   └─→ service: ← 自动显示可用操作符

2. 输入字段值
   └─→ service: user- ← 显示匹配的值

3. 使用 Tab 键选择补全项
```

## 9. 保存和加载查询

### 9.1 保存查询

```
保存查询步骤：

1. 编写 KQL 查询
   └─→ level: ERROR and service: user-svc

2. 点击 Save
   └─→ 输入名称：Error Logs by Service

3. 保存后可在仪表板中引用
```

### 9.2 使用保存的查询

```
使用保存的查询：

1. 在 Discover 中加载保存的查询
2. 在仪表板中添加过滤
3. 在可视化中作为基础查询
```

## 10. 常见问题

### Q1：KQL 和 Lucene 哪个更好？

**答案**：KQL 更适合日常使用，语法更直观。Lucene 更传统，在某些复杂场景下更灵活。新手推荐从 KQL 开始。

### Q2：查询不生效怎么办？

**答案**：
1. 检查字段名是否正确（区分大小写）
2. 检查索引模式是否匹配
3. 检查时间范围是否包含数据

### Q3：如何调试查询？

**答案**：
1. 在 Discover 中逐步构建查询
2. 查看返回的文档是否匹配预期
3. 使用 ES DSL 查看完整查询

## 总结

KQL 的核心要点：

1. **基本语法**：`field: value` 格式
2. **逻辑组合**：AND、OR、NOT
3. **范围查询**：`field: >= 100` 或 `field: 100 TO 500`
4. **全文搜索**：直接输入关键词
5. **智能补全**：减少输入错误

---

**留给你的问题**：

假设你需要在 Kibana 中查询以下条件，你会如何编写 KQL？

1. service 是 user-svc 或 order-svc
2. status 不是 200
3. response_time 超过 1000ms
4. message 包含 "timeout" 或 "error"

你能写出这个查询吗？
