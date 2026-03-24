# TiDB 整体架构

想象一个场景：你的 MySQL 数据库已经撑不住了——单表数据量突破 10 亿，每天 QPS 几十万，扩容成了唯一选择。但 MySQL 分库分表的改造成本太高，数据迁移风险太大。

怎么办？

PingCAP 团队给出了一个答案：**把数据库做成「乐高」——每个组件都可以独立扩缩容，用 Raft 协议保证数据一致性，用 MySQL 协议保持兼容性。**

这就是 TiDB。

## TiDB 的四大核心组件

TiDB 并不是一个传统意义上的单机数据库，而是一个**分布式 SQL 数据库集群**。它由四个核心组件构成：

### 1. TiDB Server：SQL 层的「大脑」

TiDB Server 是整个集群的接入层，负责：

- 接收客户端的 SQL 请求
- 解析、编译、优化 SQL
- 执行查询计划
- 返回查询结果

你可以把它理解为 MySQL 的「Query Processor」，但它本身**不存储数据**。所有数据都存在 TiKV 或 TiFlash 中。

```java
// TiDB Server 的核心职责可以用这个接口来理解
public interface TiDBQueryProcessor {
    // 接收 SQL 请求
    QueryResult processQuery(String sql);
    
    // 解析 SQL
    AbstractSyntaxTree parse(String sql);
    
    // 优化执行计划
    ExecutionPlan optimize(AbstractSyntaxTree ast);
    
    // 分布式执行
    QueryResult distributedExecute(ExecutionPlan plan);
}
```

关键点：**TiDB Server 是无状态的**。你可以随时增加或减少 TiDB Server 的数量，客户端通过负载均衡连接任意节点。这意味着什么？SQL 层的扩展，是真正意义上「零停机」的。

### 2. TiKV：存储层的「基石」

TiKV 是 TiDB 的分布式 Key-Value 存储引擎，负责：

- 存放所有业务数据（行存格式）
- 提供强一致性的数据读写
- 自动进行数据分片和副本管理
- 通过 Raft 协议保证数据高可用

```java
// TiKV 的核心概念
public class TiKVRegion {
    private byte[] startKey;      // 数据的起始 Key
    private byte[] endKey;        // 数据的结束 Key
    private List<Peer> peers;     // Raft 副本列表
    private int leaderId;         // 当前 Leader
    
    // 每个 Region 默认 96MB，数据按 Key 范围分片
    // 当 Region 过大时，会自动分裂
    // 当 Region 过小时，会自动合并
}
```

TiKV 基于 RocksDB 构建，底层数据存储在 RocksDB 的 LSM-Tree 结构中。这意味着什么？**TiKV 天然适合写多读少的场景**，LSM-Tree 的顺序写入性能远优于 B+Tree。

> LSM-Tree vs B+Tree：LSM-Tree 将随机写转换为顺序写，写入性能更好；但读取时可能需要访问多层数据，读取性能略逊于 B+Tree。

### 3. PD：集群的「调度中心」

Placement Driver（PD）是 TiDB 集群的管理节点，负责：

- 分配全局唯一的事务 ID
- 存储集群元信息（哪个 TiKV 存哪些 Region）
- 调度数据分布（负载均衡、热点分散）
- 提供 TSO（Timestamp Oracle）服务

```java
// PD 的核心功能
public class PlacementDriver {
    // TSO 是分布式事务的基础
    // 每个事务都有一个唯一的 (physicalTime, logicalTime) 时间戳
    public Timestamp getTSO();
    
    // Region 调度
    public void scheduleRegion(int regionId, TargetStore target);
    
    // 元信息存储
    public ClusterMetadata getClusterInfo();
}
```

PD 是整个集群的「单点」，但这个单点本身是通过 **etcd** 实现高可用的。PD 宕机不会导致数据丢失，但新事务的 TSO 获取会暂停。

### 4. TiFlash：分析型的「加速器」

TiFlash 是 TiDB 5.0 引入的列式存储引擎，专门用于 OLAP 场景。它：

- 使用 ClickHouse 的列式存储技术
- 通过 Raft Learner 异步复制 OLTP 数据
- 支持实时分析，延迟可控制在秒级
- 与 TiKV 数据保持最终一致

```java
// TiFlash 工作原理
public class TiFlashReplicator {
    // TiFlash 通过 Raft Learner 异步拉取 TiKV 的数据
    // Learner 只复制数据，不参与写入确认
    // 这样分析查询不会影响 OLTP 写入性能
    public void startReplication(Region region);
    
    // 列式存储，按列压缩，利于聚合查询
    public ColumnarStorage createColumnarStorage(Region region);
}
```

## 组件间的协作

当你执行一条 SQL 时，背后发生了什么？

```
客户端 → TiDB Server → PD（获取元信息） → TiKV/TiFlash（读写数据） → 返回结果
```

1. 客户端连接到任意 TiDB Server
2. TiDB Server 向 PD 请求：「这条数据在哪几个节点上？」
3. PD 返回 Region 的位置信息
4. TiDB Server 直接和 TiKV 通信，获取数据
5. TiDB Server 聚合结果，返回给客户端

整个过程对客户端透明——**它只知道自己连接了一个 MySQL 兼容的数据库**。

## 为什么这样设计？

这种架构背后有几个核心理念：

| 设计理念 | 解决什么问题 | 实现方式 |
|---------|-------------|---------|
| 存储计算分离 | 单机数据库的扩展瓶颈 | TiKV 横向扩展存储，TiDB Server 横向扩展计算 |
| 强一致性与高可用 | 数据安全和业务连续性 | Raft 多数派写入，自动故障转移 |
| MySQL 兼容性 | 迁移成本和学习曲线 | 兼容 MySQL 5.7/8.0 协议和语法 |
| HTAP 能力 | 同时处理 OLTP 和 OLAP | TiKV 行存 + TiFlash 列存，智能路由 |

## 面试追问

**Q: TiDB 和 NewSQL 的关系是什么？**

TiDB 是 NewSQL 的典型代表。NewSQL 旨在同时具备 NoSQL 的扩展能力（水平扩展）和传统数据库的 ACID 事务能力（强一致性）。Google Spanner、CockroachDB 也是 NewSQL 家族的一员。

**Q: TiDB 和 TiKV 的关系是什么？**

TiDB 是整个数据库产品，TiKV 是其核心存储引擎。TiDB = TiDB Server + TiKV + PD。可以单独使用 TiKV 作为独立的 KV 存储（如etcd 的替代），但单独使用 TiKV 无法执行 SQL。

---

## 总结

TiDB 的架构，用一句话概括：**SQL 层做解析和优化，存储层做分布和复制，调度层做协调和均衡。**

三个组件各司其职，通过 Raft 协议和 TSO 服务串联成一个整体。这就是 TiDB 能做到「水平扩展 + 强一致 + MySQL 兼容」的奥秘。
