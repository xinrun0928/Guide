# Elasticsearch：全文搜索引擎

你遇到过这种情况吗？

在电商网站搜索「iPhone 手机」，结果里出现了「苹果笔记本」、「apple 手表」，甚至「水果拼盘」——这显然不是用户想要的。

问题出在哪里？传统数据库的 `LIKE '%关键词%'` 查询，只能做字符串匹配，无法理解「iPhone」和「手机」之间的语义关系。

**Elasticsearch** 就是来解决这个问题的——它能理解你的搜索意图，返回真正相关的结果。

## ES 是什么？

Elasticsearch 是一个基于 **Apache Lucene** 的分布式全文搜索引擎，由 Elastic 公司开发。它的核心能力是：**对海量文本数据进行高效、准确的搜索**。

```
传统数据库：找「包含」某个词的数据
ES：找「相关度最高」的数据
```

## 核心能力

| 能力 | 说明 | 典型场景 |
|-----|------|---------|
| 全文搜索 | 分词 + 倒排索引，理解语义 | 电商搜索、日志检索 |
| 分布式存储 | 自动分片、副本、高可用 | PB 级数据存储 |
| 聚合分析 | 多维度统计、计算 | 数据报表、实时分析 |
| 实时性 | 秒级索引、近实时搜索 | 监控系统、BI 分析 |

## 适用场景

ES 不是万能的，它最适合以下场景：

- **搜索类场景**：电商搜索、站内搜索、文库检索
- **日志分析**：ELK Stack 的核心组件，日志收集与分析
- **指标监控**：时序数据存储与聚合分析
- **全文检索**：需要模糊匹配、相关性排序的场景

> 但如果你需要事务支持、复杂关联查询，ES 可能不是最佳选择——这时候应该考虑传统数据库。

## 文档导航

### 基础入门

- [核心概念](/middleware/es/core-concept)：Index、Document、Shard、Replica
- [CRUD 操作](/middleware/es/crud)：文档的增删改查
- [分页查询](/middleware/es/pagination)：from/size、search after、scroll

### 原理深入

- [倒排索引](/middleware/es/inverted-index)：ES 搜索的底层原理
- [分片机制](/middleware/es/shard)：主分片与副本的分配策略
- [DSL 查询](/middleware/es/dsl)：Query DSL 语法详解
- [搜索原理](/middleware/es/search)：Query 和 Fetch 阶段详解

### 进阶应用

- [聚合分析](/middleware/es/aggregation)：Bucket、Metric、Pipeline 聚合
- [索引管理](/middleware/es/index-management)：索引配置、模板、生命周期
- [数据同步](/middleware/es/data-sync)：数据库到 ES 的同步方案
- [性能优化](/middleware/es/performance)：写入优化、查询优化

### 架构与对比

- [集群架构](/middleware/es/architecture)：Master、Data、Coordinating 节点
- [Solr 对比](/middleware/es/solr-compare)：ES vs Solr 如何选型

### 面试准备

- [面试题总结](/middleware/es/interview-summary)：高频面试题与参考答案

---

**留给你的问题**：

一个日均写入 1000 万条日志的系统，你会选择多少个分片？副本数设为多少合适？

这个问题涉及到分片策略对性能和资源的影响，我们后续会深入讨论。
