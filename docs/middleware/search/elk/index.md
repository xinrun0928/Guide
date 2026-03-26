# ELK Stack：日志采集与分析平台

凌晨 2 点，监控系统报警：订单服务错误率飙升到 15%。

你登录服务器，想看看日志。结果发现：
- 日志分散在 20 台服务器上
- 每台服务器日志格式还不一样
- 部分日志已经被 logrotate 轮转了

等你手动把所有日志拼凑完，已经过去了 30 分钟，故障早就影响了 thousands of 用户。

**ELK Stack** 就是来解决这个问题的——它能帮你从海量日志中快速定位问题。

## ELK Stack 是什么？

ELK Stack 是三个开源组件的组合：

```
┌─────────────────────────────────────────────────────────────┐
│                       ELK Stack                             │
│                                                               │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│   │Elasticsearch│ ←  │  Logstash  │ ←  │   Kibana    │     │
│   │   存储+搜索  │    │   数据处理  │    │   可视化    │     │
│   └─────────────┘    └─────────────┘    └─────────────┘     │
│         ↑                                                        │
│         │                                                        │
│   ┌─────┴─────┐                                               │
│   │   Beats   │  ← 轻量级采集器                                │
│   └───────────┘                                               │
└─────────────────────────────────────────────────────────────┘
```

| 组件 | 全称 | 作用 |
|-----|------|------|
| Elasticsearch | ES | 分布式搜索引擎，存储、搜索、分析 |
| Logstash | LS | 数据收集与处理，ETL 管道 |
| Kibana | KB | 数据可视化，Web 界面 |
| Beats | - | 轻量级数据采集器 |

## 整体架构

ELK 的数据流如下：

```
日志源
  │
  ├── 应用日志 ──┐
  ├── 系统日志 ──┼──→ Beats（采集）──→ Kafka（缓冲）──→ Logstash（处理）──→ Elasticsearch（存储）──→ Kibana（展示）
  ├── 网络日志 ──┤
  └── 指标数据 ──┘
```

### 轻量级架构（Beats 直连）

适合小规模部署（< 10GB/天）：

```
Filebeat ──┐
           ├──→ Elasticsearch ──→ Kibana
Metricbeat ┘
```

### 标准架构（Beats + Logstash）

适合中等规模（10-100GB/天）：

```
Beats ──→ Logstash ──→ Elasticsearch ──→ Kibana
```

### 高可用架构（引入 Kafka）

适合大规模（100GB+/天）：

```
Beats ──→ Kafka ──→ Logstash ──→ Elasticsearch ──→ Kibana
```

Kafka 在其中起到缓冲和削峰的作用，防止日志量突增时压垮下游系统。

## 适用场景

| 场景 | 说明 | 推荐架构 |
|-----|------|---------|
| 日志分析 | 应用日志、系统日志分析 | ELK 标准架构 |
| 性能监控 | 实时监控服务性能指标 | ELK + Metricbeat |
| 安全审计 | 安全日志采集与异常检测 | ELK + Packetbeat |
| 链路追踪 | 微服务调用链追踪 | ELK + APM |
| 业务分析 | 用户行为、订单分析 | ELK + 自定义采集 |

## 文档导航

### 整体架构

- [ELK 架构](/middleware/elk/architecture)：整体架构与数据流

### Beats 采集器

- [Filebeat](/middleware/elk/filebeat)：日志文件采集
- [Metricbeat](/middleware/elk/metricbeat)：系统指标采集
- [Heartbeat](/middleware/elk/heartbeat)：心跳检测与可用性监控
- [Packetbeat](/middleware/elk/packetbeat)：网络流量分析

### 进阶配置

- [Kafka 集成](/middleware/elk/kafka-integration)：日志队列配置
- [最佳实践](/middleware/elk/best-practice)：容量规划、运维建议

---

**留给你的问题**：

你的系统日志量从 10GB/天增长到 500GB/天，当前的 ELK 架构会出现什么问题？

你会如何演进架构来应对这个增长？

需要考虑：采集层的扩展、处理层的优化、存储层的分片策略，以及如何实现冷热数据分离。
