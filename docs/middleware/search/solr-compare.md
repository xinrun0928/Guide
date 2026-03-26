# Solr 简介与对比

在企业级搜索领域，Elasticsearch 和 Solr 是两个最著名的开源搜索引擎。它们都基于 Apache Lucene，但发展路线和特点各不相同。

## 1. Solr 简介

### 1.1 Solr 的历史

```
2004 年 - Solr 诞生于 CNET Networks
2006 年 - 捐赠给 Apache 软件基金会
2008 年 - 成为 Apache Lucene 的子项目
2010 年 - Solr 3.0 发布，添加 facet、复制等功能
2012 年 - Solr 4.0 发布，添加 SolrCloud（分布式）
```

### 1.2 Solr 的特点

```java
Solr 核心特性：

1. 企业级功能完善
   ├── 丰富的管理界面（Solr Admin）
   ├── 完善的中文分词支持（IK、jieba 等）
   ├── 强大的 facet（分面导航）
   └── 成熟的缓存机制

2. 稳定性优先
   ├── 经过多年生产验证
   ├── 丰富的文档和社区支持
   └── 与 Hadoop 生态深度集成

3. 配置驱动
   ├── XML 配置方式
   ├── 丰富的可配置项
   └── schema.xml 管理字段定义
```

### 1.3 Solr 的基本架构

```
┌─────────────────────────────────────────────────────────────┐
│                     SolrCloud 架构                          │
│                                                               │
│   ZooKeeper                                                  │
│   ┌─────────┐                                                │
│   │ Cluster │  管理集群状态、分片分配                         │
│   │ State   │                                                │
│   └─────────┘                                                │
│                                                               │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│   │ Solr 1  │  │ Solr 2  │  │ Solr 3  │  │ Solr 4  │        │
│   │ P0  R1  │  │ P1  R0  │  │ P2  R1  │  │ P3  R0  │        │
│   └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│                                                               │
└─────────────────────────────────────────────────────────────┘

P = Primary Shard
R = Replica Shard
```

## 2. Elasticsearch vs Solr

### 2.1 核心对比

| 维度 | Elasticsearch | Solr |
|-----|--------------|------|
| 诞生年份 | 2010 | 2004 |
| 社区活跃度 | 非常活跃 | 活跃 |
| 文档完善度 | 中等 | 完善 |
| 分布式支持 | 原生内置 | SolrCloud（相对复杂） |
| REST API | 原生支持 | 支持（后来添加） |
| 实时性 | 近实时 | 需要配置 |
| 中文分词 | 需要插件 | 需要插件 |
| 管理界面 | Kibana（独立） | 内置 Admin UI |
| 与 Hadoop 集成 | 一般 | 深度集成 |

### 2.2 写入流程对比

**ES 写入流程**：

```
写入请求 → Routing → Primary Shard → 副本同步 → 返回
```

**Solr 写入流程**：

```
写入请求 → ZooKeeper → Leader Shard → 副本同步 → 返回
```

主要区别：Solr 依赖 ZooKeeper 做协调，ES 自己实现协调机制。

### 2.3 搜索功能对比

| 功能 | Elasticsearch | Solr |
|-----|--------------|------|
| 全文搜索 | ✓ | ✓ |
| 分面搜索（Facet） | ✓ | ✓（更强大） |
| 高亮 | ✓ | ✓ |
| 拼写检查 | ✓ | ✓ |
| 自动补全 | ✓（completion suggester） | ✓（SuggestComponent） |
| 地理位置搜索 | ✓ | ✓ |
| 聚合分析 | ✓（更强大） | ✓ |
| 机器学习 | ✓ | ✗ |

### 2.4 分布式能力对比

**ES 的分布式**：

- 自带分布式协调
- 自动分片和副本分配
- 故障自动转移
- 配置简单

```java
// ES 集群配置
cluster.name: my-cluster
node.name: node-1
discovery.seed_hosts: ["host1", "host2", "host3"]
```

**Solr 的分布式（SolrCloud）**：

- 需要 ZooKeeper
- 配置相对复杂
- 但提供了更细粒度的控制

```java
// Solr ZooKeeper 配置
zkHost: zookeeper:2181/solr

// 上传配置到 ZooKeeper
bin/solr zk upconfig -n myconfig -d /path/to/config
```

### 2.5 分片与副本对比

**ES**：

```java
// 创建索引时指定分片和副本
PUT my_index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  }
}
```

**Solr**：

```java
// 通过 API 创建 collection
POST /admin/collections
{
  "name": "my_collection",
  "numShards": 3,
  "replicationFactor": 1
}
```

## 3. 各自的优势场景

### 3.1 Elasticsearch 更适合的场景

```
✓ 日志分析（ELK Stack）
✓ 实时搜索
✓ 敏捷开发（配置简单）
✓ 微服务架构
✓ 需要近实时分析的 OLAP 场景
✓ 需要复杂聚合分析的场景
```

### 3.2 Solr 更适合的场景

```
✓ 传统企业级搜索
✓ 需要强大的 Facet 功能（电商分类导航）
✓ 需要丰富的管理界面
✓ 需要与 Hadoop/Spark 集成
✓ 需要精细化的配置控制
✓ 已有 Hadoop 生态的系统
```

## 4. 功能细节对比

### 4.1 Facet（分面搜索）

Solr 的 Facet 功能比 ES 更强大：

```java
// Solr Facet 配置
facet=true
facet.field=category
facet.field=brand
facet.query=price:[0 TO 100]
facet.range=price
facet.range.start=0
facet.range.end=1000
facet.range.gap=100
```

ES 的 Terms Aggregation 可以实现类似功能，但 Solr 的 Facet 更简洁。

### 4.2 缓存机制

**Solr 的缓存**：

```java
// solrconfig.xml
&lt;query&gt;
  &lt;filterCache
    size="512"
    initialSize="512"
    autowarmCount="256"/&gt;
  &lt;queryResultCache
    size="512"
    initialSize="512"/&gt;
  &lt;documentCache
    size="512"/&gt;
  &lt;cache name="myCache"
    size="128"
    initialSize="128"
    regenerator="regenerator"/&gt;
&lt;/query&gt;
```

**ES 的缓存**：

```java
// 节点级别配置
indices.queries.cache.size: 10%
indices.cache.filter.size: 10%
```

### 4.3 中文分词

两者都需要插件支持中文分词：

**ES + IK**：

```java
{
  "settings": {
    "analysis": {
      "analyzer": {
        "ik": {
          "type": "custom",
          "tokenizer": "ik_max_word"
        }
      }
    }
  }
}
```

**Solr + IK**：

```java
// managed-schema
&lt;fieldType name="text_ik" class="solr.TextField"&gt;
  &lt;analyzer type="index"&gt;
    &lt;tokenizer class="org.wltea.analyzer.lucene.IKTokenizerFactory"/&gt;
  &lt;/analyzer&gt;
&lt;/fieldType&gt;
```

## 5. 迁移与兼容

### 5.1 从 Solr 迁移到 ES

```java
// Solr 的 Schema.xml 对应 ES 的 Mapping
// Solr 的 solrconfig.xml 对应 ES 的 Settings

// 核心概念对照：
// Solr collection → ES index
// Solr shard → ES shard
// Solr replica → ES replica
// Solr core → ES index（单分片情况）
```

### 5.2 迁移注意事项

```java
迁移检查清单：

1. 字段类型映射
   ├── string → keyword 或 text
   ├── tint → integer
   └── float → float

2. 查询语法转换
   ├── Solr: q=title:Java AND status:1
   └── ES: match 或 term 查询

3. 分片策略调整
   ├── ES 每个索引可以有多个分片
   └── Solr collection 的分片在创建时确定

4. Facet 转换
   ├── Solr facet.field → ES terms aggregation
   └── Solr facet.range → ES range aggregation

5. 缓存策略
   ├── ES 有 query cache 和 filter cache
   └── Solr 有更丰富的缓存选项
```

## 6. 未来发展趋势

### 6.1 Elasticsearch 的发展

```
近期重点：
✓ 增强安全性（RBAC、加密）
✓ 改进集群协调机制
✓ 加强机器学习能力
✓ 优化 Kubernetes 部署
✓ 改进 ILM（索引生命周期管理）
```

### 6.2 Solr 的发展

```
近期重点：
✓ 改进 SolrCloud 的易用性
✓ 增强 Lucene 功能
✓ 改进查询性能
✓ 更好地集成云原生架构
✓ 与数据生态更紧密集成
```

## 7. 面试常见问题

### Q1：为什么 Elasticsearch 更流行？

**答案**：

- 原生分布式，不需要 ZooKeeper
- REST API 设计更现代
- 配置简单，上手快
- 文档简洁，开发者友好
- ELK Stack 生态完整
- 社区活跃度高

### Q2：什么情况下选择 Solr？

**答案**：

- 已有 Hadoop 生态的企业
- 需要强大的 Facet 功能
- 需要精细化的缓存控制
- 有传统企业搜索背景
- 需要成熟的管理界面

### Q3：两者可以同时使用吗？

**答案**：技术上可以，但通常不推荐。维护两套搜索系统会增加复杂度和成本。

## 总结

**选择建议**：

```
新的互联网项目：推荐 Elasticsearch
企业级搜索系统：可以考虑 Solr
Hadoop 生态系统：Solr 更合适
日志分析场景：ELK Stack（Elasticsearch）
```

两者都是成熟的搜索引擎，选择时需要根据团队技术栈、项目需求和运维能力综合考虑。

---

**留给你的问题**：

假设你的公司正在从传统 Solr 迁移到 Elasticsearch，你会如何规划迁移路径？

需要考虑的问题：
- 如何保证数据一致性？
- 如何灰度切换？
- 如何回滚？
- 如何让团队快速上手？
