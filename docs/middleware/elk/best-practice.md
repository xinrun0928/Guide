# ELK 日志收集最佳实践：日志规范、字段命名、索引生命周期管理（ILM）

好的日志系统，不仅仅是「能收集」，更要「好分析」。这一节我们来聊聊如何让日志真正发挥价值。

## 1. 日志规范

### 1.1 日志级别

```
日志级别定义：

FATAL   - 系统不可用（最高级别）
ERROR   - 错误，影响某个功能
WARN    - 警告，不影响功能但需要注意
INFO    - 信息，正常流程的记录
DEBUG   - 调试，开发阶段使用
TRACE   - 跟踪，最详细的日志

建议使用规范：
├─ 生产环境：INFO 及以上
├─ 测试环境：DEBUG 及以上
└─ 问题排查：临时开启 DEBUG
```

### 1.2 日志格式

```
推荐使用 JSON 格式：

{
  "timestamp": "2024-01-15T10:00:00.000Z",
  "level": "INFO",
  "service": "user-service",
  "traceId": "abc123",
  "spanId": "def456",
  "message": "User login",
  "data": {
    "userId": 12345,
    "ip": "192.168.1.100"
  }
}
```

### 1.3 日志内容规范

```java
// 好的日志示例
log.info("User login: userId={}, ip={}", userId, ip);
log.error("Order creation failed", ex);

// 不好的日志示例
log.info("处理请求");           // 太模糊
log.error("出错了");           // 缺少上下文
log.error(ex.toString());     // 堆栈信息不完整
```

### 1.4 结构化日志（Java 示例）

```java
// 使用结构化日志框架
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import net.logstash.logback.encoder.LogstashEncoder;

public class OrderService {
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public void createOrder(Order order) {
        try {
            // 结构化日志
            log.info("Order created: orderId={}, userId={}, amount={}",
                order.getId(),
                order.getUserId(),
                order.getAmount());
        } catch (Exception e) {
            // 包含堆栈的异常日志
            log.error("Order creation failed: orderId={}", order.getId(), e);
        }
    }
}
```

## 2. 字段命名规范

### 2.1 ECS 字段规范

ECS（Elastic Common Schema）是 Elastic 推荐的标准字段：

```
推荐字段命名：
├─ @timestamp          # 时间戳
├─ log.level          # 日志级别
├─ message            # 日志内容
├─ service.name       # 服务名称
├─ host.name          # 主机名
├─ trace.id           # 链路追踪 ID
├─ span.id            # Span ID
├─ user.id            # 用户 ID
├─ source.ip          # 源 IP
├─ dest.ip            # 目标 IP
└─ url.path           # 请求路径
```

### 2.2 自定义字段命名

```java
// 字段命名建议
// ✓ 推荐的命名
service.name          // 服务名
service.version        // 服务版本
environment            // 环境
region                 // 地域
trace.id               // 链路 ID
db.statement          // SQL 语句
db.operation          // 数据库操作

// ✗ 不推荐的命名
serviceName            // 驼峰命名
s_name                 // 简写
ServiceName            // 首字母大写
```

### 2.3 避免的字段

```
避免的命名：
├─ 使用保留字作为字段名
├─ 使用过长的字段名（> 255 字符）
├─ 使用特殊字符（.、* 等）
├─ 不同索引使用不同字段表示同一含义
└─ 过度嵌套（> 3 层）
```

## 3. 索引命名规范

### 3.1 索引命名格式

```
索引命名格式：
{system}-{type}-{date}

示例：
├─ nginx-access-2024.01.15
├─ app-error-2024.01.15
├─ mysql-slow-2024.01.15
└─ system-metrics-2024.01.15
```

### 3.2 索引命名建议

```
索引命名建议：
├─ 使用小写
├─ 使用连字符（-）分隔
├─ 包含日期便于管理
├─ 相同类型使用相同前缀
├─ 避免过长的索引名
└─ 不要使用特殊字符
```

## 4. 索引生命周期管理（ILM）

### 4.1 为什么需要 ILM？

```
数据生命周期：
┌─────────────────────────────────────────────────────────────┐
│  热数据 ────────→ 温数据 ────────→ 冷数据 ────────→ 删除    │
│   (SSD)            (HDD)           (归档)                     │
│   实时查询        偶尔查询        历史分析                    │
│   7 天           30 天           365 天                     │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 ILM 策略配置

```java
PUT _ilm/policy/myapp-logs-policy
{
  "policy": {
    "phases": {
      "hot": {
        "min_age": "0ms",
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "7d",
            "max_docs": 10000000
          },
          "set_priority": {
            "priority": 100
          }
        }
      },
      "warm": {
        "min_age": "30d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          },
          "allocate": {
            "require": {
              "data": "warm"
            }
          },
          "set_priority": {
            "priority": 50
          }
        }
      },
      "cold": {
        "min_age": "90d",
        "actions": {
          "allocate": {
            "require": {
              "data": "cold"
            }
          },
          "set_priority": {
            "priority": 0
          }
        }
      },
      "delete": {
        "min_age": "365d",
        "actions": {
          "delete": {}
        }
      }
    }
  }
}
```

### 4.3 应用 ILM 策略

```java
# 方式一：索引模板
PUT _index_template/myapp-logs-template
{
  "index_patterns": ["myapp-logs-*"],
  "template": {
    "settings": {
      "number_of_shards": 3,
      "number_of_replicas": 1,
      "index.lifecycle.name": "myapp-logs-policy",
      "index.lifecycle.rollover_alias": "myapp-logs"
    }
  }
}

# 初始化索引
PUT myapp-logs-000001
{
  "aliases": {
    "myapp-logs": {
      "is_write_index": true
    }
  }
}
```

### 4.4 冷热分离配置

```java
# 热节点配置（elasticsearch.yml）
node.attr.data: hot
node.attr.box_type: hot

# 温节点配置
node.attr.data: warm
node.attr.box_type: warm

# 冷节点配置
node.attr.data: cold
node.attr.box_type: cold

# 索引分配规则
PUT myapp-logs-*/_settings
{
  "index.routing.allocation.include.box_type": "hot",
  "index.routing.allocation.exclude.box_type": "cold"
}
```

## 5. 日志收集最佳实践

### 5.1 日志采集架构

```
推荐架构：

┌─────────────────────────────────────────────────────────────┐
│                    日志采集架构                              │
│                                                               │
│   应用服务器                                                  │
│   ┌─────────────┐  ┌─────────────┐                          │
│   │ Filebeat   │  │ Metricbeat │                          │
│   │ (日志)     │  │ (指标)      │                          │
│   └──────┬──────┘  └──────┬──────┘                          │
│          │                │                                  │
│          └───────┬────────┘                                  │
│                  │                                          │
│            ┌─────▼─────┐                                    │
│            │   Kafka   │                                    │
│            │ (缓冲)    │                                    │
│            └─────┬─────┘                                    │
│                  │                                          │
│            ┌─────▼─────┐                                    │
│            │  Logstash │                                    │
│            │ (处理)    │                                    │
│            └─────┬─────┘                                    │
│                  │                                          │
│            ┌─────▼─────┐                                    │
│            │Elasticsearch│                                   │
│            │ (存储)    │                                    │
│            └─────┬─────┘                                    │
│                  │                                          │
│            ┌─────▼─────┐                                    │
│            │  Kibana   │                                    │
│            │ (可视化)  │                                    │
│            └───────────┘                                    │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 日志分类处理

```java
# Filebeat 配置
filebeat.inputs:
  - type: log
    paths:
      - /var/log/nginx/access.log
    fields:
      log_type: access

  - type: log
    paths:
      - /var/log/app/error.log
    fields:
      log_type: error

  - type: log
    paths:
      - /var/log/app/audit.log
    fields:
      log_type: audit

# Logstash 处理
filter {
  if [fields][log_type] == "access" {
    grok { match => { "message" => "%{COMBINEDAPACHELOG}" } }
    mutate { add_field => { "[@metadata][index]" => "access" } }
  } else if [fields][log_type] == "error" {
    grok { match => { "message" => "%{APP_ERROR_PATTERN}" } }
    mutate { add_field => { "[@metadata][index]" => "error" } }
  } else if [fields][log_type] == "audit" {
    json { source => "message" }
    mutate { add_field => { "[@metadata][index]" => "audit" } }
  }
}

output {
  elasticsearch {
    index => "logs-%{[@metadata][index]}-%{+YYYY.MM.dd}"
  }
}
```

### 5.3 敏感数据处理

```java
# Filebeat 脱敏
processors:
  - redact:
      fields:
        - http.request.headers["authorization"]
        - http.request.headers["cookie"]
        - url.query
      replacement: "[redacted]"

# Logstash 脱敏
filter {
  mutate {
    gsub => [
      "message", "password=[^&\\s]+", "password=[redacted]",
      "token=[^&\\s]+", "token=[redacted]"
    ]
  }
}
```

## 6. 性能优化

### 6.1 写入优化

```java
# ES 写入配置
PUT myapp-logs/_settings
{
  "index": {
    "number_of_replicas": 0,          // 导入时关闭副本
    "refresh_interval": "30s",       // 延长刷新间隔
    "translog.durability": "async",   // 异步刷新
    "translog.sync_interval": "30s"
  }
}

# 导入完成后恢复
PUT myapp-logs/_settings
{
  "index": {
    "number_of_replicas": 1,
    "refresh_interval": "1s"
  }
}
```

### 6.2 查询优化

```java
# 使用别名指向热索引
POST _aliases
{
  "actions": [
    {
      "add": {
        "index": "myapp-logs-2024.01.15",
        "alias": "myapp-logs-recent"
      }
    }
  ]
}

# 查询时使用别名
GET myapp-logs-recent/_search
```

### 6.3 资源规划

```
资源规划建议：
├─ 热数据：每 TB 数据配置 2 核 CPU + 8GB 内存
├─ 温数据：每 3 TB 数据配置 1 核 CPU + 4GB 内存
├─ 冷数据：每 5 TB 数据配置 1 核 CPU + 4GB 内存
└─ 副本：与主分片相同配置
```

## 7. 监控与告警

### 7.1 监控指标

```
关键监控指标：
├─ 集群健康状态
├─ 写入速率（docs/s）
├─ 查询延迟（P95、P99）
├─ 磁盘使用率
├─ JVM 内存使用率
├─ 分片分布
└─ 消费 lag（如果有 Kafka）
```

### 7.2 告警配置

```java
# Kibana 告警规则

# 告警 1：集群不健康
Name: Cluster Health Alert
Condition: cluster.status != green

# 告警 2：磁盘空间不足
Name: Disk Usage Alert
Condition: index.store.size > 90%

# 告警 3：写入拒绝
Name: Write Rejection Alert
Condition: index.indices.indexing.index_failed_docs > 0
```

## 8. 运维检查清单

```
ELK 运维检查清单：

日常检查：
□ 集群健康状态
□ 磁盘使用情况
□ 写入/查询延迟
□ 索引数量和大小
□ 分片分布情况

定期任务：
□ 检查并调整 ILM 策略
□ 清理不必要的索引
□ 更新字段映射
□ 备份重要数据

容量规划：
□ 评估数据增长趋势
□ 规划扩容方案
□ 优化冷热分离
□ 调整分片策略
```

## 9. 常见问题

### Q1：如何减少日志量？

**答案**：
1. 按环境调整日志级别
2. 采样不重要日志
3. 合并重复日志
4. 使用摘要代替完整信息

### Q2：如何处理大文本字段？

**答案**：
1. 截断超长字段
2. 禁用 source 存储
3. 使用合成字段

### Q3：如何优化 Kibana 性能？

**答案**：
1. 使用日期过滤器
2. 减少时间范围
3. 使用聚合代替搜索
4. 限制返回数量

## 10. 实际案例

### 10.1 电商平台案例

```
场景：日活 100 万
日志量：200GB/天
保留策略：热 7 天，温 30 天，冷 365 天

架构设计：
1. 日志分类
   ├─ access-logs (访问日志)
   ├─ business-logs (业务日志)
   ├─ error-logs (错误日志)
   └─ audit-logs (审计日志)

2. 索引设计
   ├─ 每个日志类型独立索引
   ├─ 按天分索引
   └─ 使用 ILM 自动管理

3. 资源配置
   ├─ 热节点：3 台 SSD 500GB
   ├─ 温节点：3 台 HDD 2TB
   └─ 冷节点：3 台 HDD 10TB

4. 监控配置
   ├─ 每日容量报告
   ├─ 错误率告警
   └─ 性能趋势分析
```

### 10.2 微服务架构案例

```
场景：100+ 微服务
日志量：500GB/天
需求：统一日志分析、链路追踪

架构设计：
1. 日志格式统一
   所有服务使用相同格式：
   {
     "traceId": "...",
     "spanId": "...",
     "service": "...",
     "timestamp": "...",
     "level": "...",
     "message": "..."
   }

2. 链路追踪
   使用 OpenTelemetry
   采集 traceId、spanId
   在 Logstash 中关联

3. 索引设计
   ├─ logs-{service}-{date}
   └─ traces-{date}

4. 告警配置
   ├─ 服务级错误率
   ├─ 链路超时
   └─ 调用链路断裂
```

## 总结

ELK 日志收集最佳实践：

1. **日志规范**：结构化、JSON 格式、合适级别
2. **字段命名**：遵循 ECS 规范、语义清晰
3. **索引管理**：合理命名、ILM 自动管理
4. **性能优化**：分片策略、冷热分离、资源规划
5. **监控告警**：关键指标、阈值告警

好的实践让日志真正发挥价值。

---

**留给你的问题**：

假设你需要为一家中型互联网公司设计日志系统：

1. 公司有 50 个服务，日志量 100GB/天
2. 需要保留 30 天热数据，365 天冷数据
3. 需要满足审计合规要求

请设计完整的 ELK 架构，包括：
- 日志格式规范
- 索引设计
- ILM 策略
- 监控告警
