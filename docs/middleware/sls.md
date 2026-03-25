# SLS 日志服务：云原生时代的日志「中央厨房」

凌晨 3 点，你被一条告警惊醒：服务响应变慢。用户开始抱怨，但日志散落在 10 台机器上，你一个个登录服务器翻日志，找到问题时天都亮了。

如果有一套系统，能把所有日志**统一收集、统一查询、统一分析**——你只需要敲几个关键字，5 秒内定位问题——效率会提升多少？

这就是 SLS（Simple Log Service，阿里云日志服务）要解决的问题。

## 为什么传统日志方式不够用了？

在单体时代，日志就是本地文件，查问题用 `grep` 或 `tail -f` 就够了。但到了微服务时代，游戏规则变了：

**日志分散了**：一个用户请求经过 API 网关 → 认证服务 → 订单服务 → 库存服务 → 支付服务 → 物流服务，每个服务都在自己的机器上写日志。想追踪一次请求的完整调用链？做梦。

**日志量爆炸了**：单服务一天 1GB 日志，100 个服务就是 100GB。你那台 100GB 的服务器，存 5 天日志就满了。

**查询太慢了**：`grep` 在 100GB 数据里搜关键字？等结果的时候你都能泡杯咖啡了。

SLS 就是为这个场景设计的：**海量日志的采集、存储、查询、分析**。

## SLS 核心架构

```
┌─────────────────────────────────────────────────────────────────┐
│                          SLS 架构                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐                         │
│   │ LogHub  │  │ Logtail │  │  SDK    │  ← 日志采集              │
│   │(采集代理)│  │(主机代理)│  │(嵌入代码)│                        │
│   └────┬────┘  └────┬────┘  └────┬────┘                        │
│        │            │            │                               │
│        └────────────┼────────────┘                               │
│                     ▼                                            │
│           ┌───────────────────┐                                  │
│           │   LogStore (日志库) │  ← 按时间切分，支持 Shard 分片   │
│           └─────────┬─────────┘                                  │
│                     ▼                                            │
│           ┌───────────────────┐                                  │
│           │   查询分析引擎      │  ← SQL 查询、聚合统计            │
│           └─────────┬─────────┘                                  │
│                     ▼                                            │
│           ┌───────────────────┐                                  │
│           │   可视化 + 告警     │  ← Dashboard、实时告警           │
│           └───────────────────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**三个采集入口，各有分工：**

- **LogHub**：阿里云 ECS、容器服务等场景，开箱即用
- **Logtail**：自建机房或其他云厂商，通过守护进程采集文件日志
- **SDK**：嵌入式埋点，代码里直接 `log.info()` 发送到 SLS

## 核心功能：从「能查到」到「查得快」

### 1. 日志采集：让日志「主动上门」

Logtail 是 SLS 的主机代理，部署在每台服务器上，监控指定路径的日志文件。

```java
// SLS Java SDK 埋点示例
// 相比文件日志，SDK 方式可以直接指定 Project/LogStore，无需关心文件路径
import com.aliyun.openservices.log.request.*;
import com.aliyun.openservices.log.response.*;

public class SLSClient {
    private final String endpoint = "cn-hangzhou.log.aliyuncs.com";
    private final String accessKeyId = "your_access_key";
    private final String accessKeySecret = "your_access_secret";
    private final String projectName = "order-service";
    private final String logStoreName = "application-log";

    // 关键参数说明：
    // - topic：用于区分不同来源，如服务名、环境
    // - source：机器 IP，便于定位日志来源
    // - time：日志时间，默认当前时间
    public void log(String level, String message) {
        LogItem item = new LogItem();
        item.PushBack("level", level);
        item.PushBack("message", message);
        item.PushBack("service", "order-service");
        // 将关键字段设为索引字段，查询时可以按字段筛选
        // 比如：level: ERROR AND service: order-service
        // SLS 的索引类似于 ES 的倒排索引，建立索引后才能高效查询
    }
}
```

Logtail 的优势在于**智能解析**：JSON 日志、自动分隔符日志、RegEx 日志，它都能自动识别结构，提取出字段。

### 2. 日志存储：时间轴 + 分片

SLS 按时间顺序存储日志，每个时间段称为一个 **Shard**（分片）。

```
时间线示意：
──────────────────────────────────────────────────────────────▶
| Shard 0 (0-1h) | Shard 1 (1-2h) | Shard 2 (2-3h) | ... |

每个 Shard 的特性：
- 可写入：每秒支持 5MB 或 5000 次写入
- 可读取：每秒支持 10MB 或 100 次读取
- 可分裂：流量高峰时自动分裂扩容
```

**这个设计解决什么问题？** 日志写入量是波动的——白天流量高，夜间流量低。Shard 可以动态调整，写入带宽跟着流量走。

### 3. 日志查询：SQL 风格，想怎么查就怎么查

SLS 支持类 SQL 的查询语法，告别 `grep` 的繁琐：

```sql
-- 查询所有 ERROR 级别日志
level: ERROR

-- 查询订单服务的异常，支持通配符
service: order* AND level: ERROR

-- 聚合统计：每分钟错误数
* | SELECT date_trunc('minute', __time__) AS minute, COUNT(*) AS error_count
WHERE level = 'ERROR'
GROUP BY minute
ORDER BY minute
```

这种查询方式的优势在于：**不只是在搜日志，而是在分析日志**。你可以做聚合统计、绘制趋势图、设置异常告警——这些是 `grep` 做不到的。

### 4. 日志分析：把日志变成洞察

```sql
-- 统计各接口的平均响应时间
* | SELECT url,
    avg(latency) AS avg_latency,
    max(latency) AS max_latency,
    count(*) AS request_count
GROUP BY url
HAVING count(*) > 100
ORDER BY avg_latency DESC
LIMIT 10
```

这个查询能告诉你：**哪个接口最慢、慢到什么程度、影响了多少请求**。配合 Dashboard，一眼就能看出系统的健康状态。

## SLS vs ELK Stack：选哪个？

| 维度 | SLS | ELK Stack |
|-----|-----|-----------|
| **部署方式** | 全托管云服务 | 自建或云上 ECS |
| **运维成本** | 零运维，阿里云兜底 | 需要自己维护 ES 集群 |
| **接入复杂度** | 简单，SDK/Agent 开箱即用 | 需要部署 Filebeat/Logstash |
| **查询性能** | 10 亿级数据秒级响应 | 与 ES 集群规模相关 |
| **成本模型** | 按写入量付费 | 需预估 ES 集群规模 |
| **适用场景** | 快速接入、云原生环境 | 需要深度定制、混合云 |

**选型建议：**

- **快速上线、免运维** → SLS
- **深度定制、需要开源生态** → ELK
- **已有 ELK 不想迁移** → 继续用 ES，SLS 做补充也可以

## 应用场景

### 场景一：微服务调用链追踪

```sql
-- 追踪一次订单请求的完整链路
traceId: "abc123" | SELECT * ORDER BY __time__ ASC
```

所有服务都用统一的 traceId 打印日志，查一次就能看到完整的调用链——比每个服务单独登录查日志快 100 倍。

### 场景二：业务指标监控

```sql
-- 实时统计订单金额
* | SELECT sum(amount) AS total_amount,
    count(*) AS order_count
WHERE type = "ORDER_CREATED"
```

把业务日志当数据源，实时计算 GMV、转化率等业务指标——不用单独建 BI 系统，日志本身就是数据源。

### 场景三：异常告警

```sql
-- 设置告警：5 分钟内 ERROR 数超过 10 触发告警
* | SELECT COUNT(*) AS error_count
WHERE level = "ERROR"
```

配合钉钉、短信、飞书告警通道，出现异常第一时间通知——比用户投诉来得更快。

## SLS 的局限

没有完美的系统，SLS 也有它的适用边界：

1. **数据主权**：日志上了阿里云，对于金融、政务等强合规场景可能有限制
2. **生态锁定**：SLS 语法和 API 是阿里云特有的，换云厂商需要改代码
3. **冷数据成本**：超过 30 天的日志存储费用较高，需要规划归档策略

## 面试高频问题

**Q: SLS 是怎么保证日志不丢失的？**

A: SLS 从采集到存储有多重保障：
- Logtail 本地缓存：Agent 端会先缓存日志，网络中断时本地排队
- 高可用写入：写入成功前会复制到多个副本
- 确认机制：SDK 支持同步写入确认（Syncproducer）

**Q: SLS 的查询延迟是多少？**

A: 在开启索引的情况下，10 亿级日志的查询可以在 5 秒内返回；关闭索引的全量扫描会慢很多，建议对关键字段开启索引。

**Q: SLS 和 Kafka 都能做日志收集，区别在哪？**

A: Kafka 是消息队列，适合**流处理**场景（消费一次、处理一次）；SLS 是日志仓库，适合**存储 + 查询**场景（多次查询、聚合分析）。两者可以配合：Kafka 做缓冲，SLS 做存储和查询。

## 写在最后

SLS 的核心价值不是「日志存储」，而是**让日志从噪音变成信号**。

以前你花 1 小时翻日志，现在花 5 分钟查 SLS —— 省下来的时间，用来喝咖啡不香吗？

但日志只是事后分析，**想在问题发生前就发现苗头**？你需要另一个武器：链路追踪。

下一节，我们来聊聊 [SkyWalking](/middleware/skywalking) —— 它能把微服务的调用链画成图，告诉你慢在哪、卡在哪。
