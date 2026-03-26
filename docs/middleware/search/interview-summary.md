# Elasticsearch 面试高频问题汇总

面试 ES 相关岗位时，哪些问题最常被问到？让我们来系统性地梳理一下。

## 1. 基础概念类

### Q1：ES 的倒排索引是什么？

**答案**：倒排索引是一种数据结构，以词为索引，存储每个词出现在哪些文档中。相比正排索引（文档包含哪些词），倒排索引在全文搜索时效率更高。

可以类比书的索引页：索引页告诉你「Java 在第 1、3、5 页」，而不是「第 1 页有 Java、Python」。

### Q2：ES 和关系型数据库的对应关系是什么？

**答案**：

| 关系型数据库 | Elasticsearch |
|-------------|--------------|
| Database | Cluster |
| Table | Index |
| Row | Document |
| Column | Field |
| Schema | Mapping |
| Index | B+ Tree Index |
| Primary Key | _id |
| Join | Nested Query / Parent-Child |

### Q3：分片和副本的作用是什么？

**答案**：

- **分片**：将数据分散存储，支持横向扩展和并行查询
- **副本**：提供高可用，主分片挂了副本自动顶替；提升读取吞吐量

> 追问：主分片数和副本数可以改吗？
>
> 主分片数在创建索引后不可改，副本数可以随时调整。

## 2. 架构原理类

### Q4：ES 集群的节点角色有哪些？

**答案**：

- **Master 节点**：集群管理（创建/删除索引、分片分配）
- **Data 节点**：存储数据、执行查询
- **Coordinating 节点**：接收请求、分发查询、聚合结果
- **Ingest 节点**：数据预处理（类似 Logstash 的 Filter）

> 追问：Master 节点挂了集群还能用吗？
>
> 如果还有数据节点，集群可以继续读写，只是会重新选举 Master。如果所有数据节点都挂了，集群不可用。

### Q5：如何避免脑裂问题？

**答案**：配置 `minimum_master_nodes = (N/2) + 1`，其中 N 是有资格成为 Master 的节点数。

3 个 Master-eligible 节点：设置为 2
5 个 Master-eligible 节点：设置为 3

### Q6：ES 的写入流程是什么？

**答案**：

1. 请求发送到 Coordinating 节点
2. 根据 routing 计算目标分片
3. 发送到主分片
4. 主分片写入内存和 Translog
5. 并行发送到所有副本
6. 副本写入成功后返回确认
7. 主分片返回给客户端

> 追问：Translog 的作用是什么？
>
> 保证数据持久性。写入先写 Translog，即使节点宕机也可以从 Translog 恢复数据。

### Q7：ES 的搜索流程是什么？

**答案**：Query Then Fetch

**Query Phase**：
1. Coordinating 节点广播查询到所有相关分片
2. 每个分片执行查询，返回匹配的 doc_id 和 score
3. Coordinating 节点收集并排序

**Fetch Phase**：
1. Coordinating 节点根据排序结果，向各分片请求完整文档
2. 返回给客户端

> 追问：为什么分两步而不是一步？
>
> 减少网络传输。如果直接返回所有文档内容，数据量会很大。

## 3. 索引与映射类

### Q8：text 和 keyword 字段的区别？

**答案**：

| 字段类型 | 分词 | 适用场景 |
|---------|------|---------|
| text | ✓ | 全文搜索 |
| keyword | ✗ | 精确匹配、排序、聚合 |

两者可以同时使用：

```java
{
  "properties": {
    "email": {
      "type": "text",
      "fields": {
        "keyword": { "type": "keyword" }
      }
    }
  }
}
```

### Q9：ES 支持哪些数据类型？

**答案**：

- 字符串：text、keyword
- 数值：long、integer、short、byte、double、float、half_float、scaled_float
- 日期：date
- 布尔：boolean
- 二进制：binary
- 范围：integer_range、float_range、date_range、long_range
- 复杂：object、nested
- 特殊：geo_point、geo_shape、ip、completion

### Q10：什么是索引模板？

**答案**：索引模板用于自动为匹配的索引设置配置和映射。

```java
PUT _index_template/logs_template
{
  "index_patterns": ["logs-*"],
  "template": {
    "settings": { "number_of_shards": 3 },
    "mappings": { "properties": { ... } }
  }
}
```

## 4. 查询类

### Q11：match 和 term 查询的区别？

**答案**：

- **match**：会分析查询字符串（分词），适合全文搜索
- **term**：不分析查询字符串，精确匹配倒排索引中的词

```java
// 搜索 "Java Tutorial"
match: 查找包含 "java" 或 "tutorial" 的文档
term: 查找包含完整 "Java Tutorial" 的文档
```

### Q12：query 和 filter 的区别？

**答案**：

| 区别 | query | filter |
|-----|-------|--------|
| 评分 | 计算 TF/IDF | 不计算 |
| 缓存 | 不缓存 | 结果会被缓存 |
| 性能 | 较慢 | 较快 |
| 使用场景 | 需要排序 | 精确过滤 |

### Q13：bool 查询的子句有哪些？

**答案**：

- **must**：必须匹配，计算评分
- **should**：应该匹配，计算评分
- **filter**：必须匹配，不计算评分
- **must_not**：必须不匹配，不计算评分

### Q14：什么是嵌套查询？

**答案**：ES 的 object 类型会导致嵌套字段扁平化存储，搜索时可能匹配错误。嵌套查询用于正确处理嵌套对象。

```java
{
  "nested": {
    "path": "comments",
    "query": {
      "bool": {
        "must": [
          { "term": { "comments.user": "alice" } },
          { "match": { "comments.content": "good" } }
        ]
      }
    }
  }
}
```

## 5. 分页与性能类

### Q15：深度分页的三种方式？

**答案**：

| 方式 | 适用场景 | 限制 |
|-----|---------|------|
| from + size | 前台小数据量翻页 | 最大 10000 |
| search_after | 后台列表，不需跳页 | 不能跳页 |
| scroll | 大批量数据导出 | 非实时，基于快照 |

### Q16：如何优化搜索性能？

**答案**：

1. **使用 filter 而非 query**：不计算评分，结果缓存
2. **限制返回字段**：`_source` 指定需要的字段
3. **合理使用 routing**：直接定位分片
4. **减少分片数量**：查询时需要合并更多分片的结果
5. **定期 forcemerge**：减少 Segment 数量
6. **使用副本分担查询**：增加副本数提升读取吞吐

### Q17：Segment 合并的原理？

**答案**：

1. ES 写入时先写入内存 Buffer，然后刷新为 Segment
2. Segment 越来越多会影响搜索性能
3. 后台会定期合并小 Segment 为大 Segment
4. 合并时会物理删除被标记的文档

> 追问：什么时候需要手动 forcemerge？
>
> 当删除大量文档后，或者导入完成后，手动 forcemerge 可以减少 Segment 数量，释放空间。

## 6. 数据同步类

### Q18：数据同步有哪些方案？

**答案**：

| 方案 | 实时性 | 复杂度 | 适合场景 |
|-----|--------|--------|---------|
| 双写 | 秒级 | 低 | 小规模 |
| Logstash JDBC | 分钟级 | 低 | 定时同步 |
| Canal | 秒级 | 中 | 大规模实时同步 |
| Debezium | 秒级 | 高 | 多消费者场景 |

### Q19：如何保证数据一致性？

**答案**：

1. **幂等写入**：使用 document_id + op_type=create
2. **全量 + 增量**：先全量同步，再增量监听 binlog
3. **定期校验**：对比源数据库和 ES 的数据量
4. **补偿机制**：建立数据修复机制

## 7. 高可用与故障处理类

### Q20：节点挂了会怎样？

**答案**：

1. Master 检测到节点失联
2. 标记失联节点的分片为 unassigned
3. 将副本分片提升为主分片（如果有）
4. 在可用节点上创建新副本

### Q21：如何监控 ES 集群？

**答案**：

```java
// 查看集群健康状态
GET _cluster/health

// 查看节点状态
GET _cat/nodes?v

// 查看索引状态
GET _cat/indices?v

// 查看分片分配
GET _cat/shards?v

// 查看慢查询
GET my_index/_search
```

## 8. 实战经验类

### Q22：亿级数据如何做全文检索？

**答案**：

1. **分片策略**：每个分片 30-50GB，预估分片数
2. **冷热分离**：热数据用 SSD，冷数据用 HDD
3. **ILM 策略**：自动管理索引生命周期
4. **路由优化**：使用 routing 减少查询范围
5. **数据同步**：Canal 或 Debezium 监听 binlog
6. **监控告警**：监控写入速率、查询延迟、集群健康

### Q23：生产环境遇到过什么问题？

**常见问题**：

- **脑裂**：未正确配置 minimum_master_nodes
- **分片倾斜**：数据分布不均
- **OOM**：fielddata 缓存过大
- **写入阻塞**：translog 磁盘满了
- **查询超时**：深分页或复杂聚合

> 建议：结合自己实际经验，准备 1-2 个真实案例。

## 总结

ES 面试的核心知识点：

1. **核心概念**：倒排索引、分片、副本、Segment
2. **架构原理**：节点角色、选举机制、读写流程
3. **查询语法**：match、term、bool、nested
4. **性能优化**：filter vs query、Segment 合并、分片策略
5. **数据同步**：双写、Logstash、Canal、Debezium
6. **实战经验**：分片规划、冷热分离、故障排查

---

**面试准备建议**：

1. 理解原理比背诵概念更重要
2. 结合实际项目经验
3. 能手写基本查询 DSL
4. 了解常见问题的排查思路
