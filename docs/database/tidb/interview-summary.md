# TiDB 面试汇总：高频问题与深度解答

TiDB 是近年来非常火热的分布式数据库，面试中经常被问到。

本篇汇总 TiDB 面试的高频问题，从浅入深，帮助你全面准备。

## 一、基础概念类

### Q1：TiDB 的整体架构是怎样的？

TiDB 由三个核心组件构成：

```
┌─────────────────────────────────────────────────────────┐
│                     TiDB 数据库                          │
│                                                         │
│  ┌─────────────────┐     ┌─────────────────┐           │
│  │  TiDB Server   │     │      PD         │           │
│  │   （SQL 层）    │◄───►│   （调度层）     │           │
│  └────────┬────────┘     └────────┬────────┘           │
│           │                       │                     │
│           └───────────┬───────────┘                     │
│                       ▼                                  │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  TiKV（存储层）                  │   │
│  │  - 数据存储                                     │   │
│  │  - Raft 复制                                    │   │
│  │  - MVCC 事务                                    │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

- **TiDB Server**：SQL 解析、优化、执行，无状态，可水平扩展
- **TiKV**：分布式 KV 存储引擎，Raft 多数派复制
- **PD**：调度中心，管理元信息、分配 TSO、调度数据分布

### Q2：TiDB 和 NewSQL 是什么关系？

NewSQL = NoSQL 的扩展性 + 传统数据库的 ACID。

| 特性 | 传统数据库 | NoSQL | NewSQL |
|-----|-----------|-------|--------|
| 水平扩展 | 困难 | 简单 | 简单 |
| ACID | 支持 | 通常不支持 | 支持 |
| SQL | 支持 | 不支持 | 支持 |
| 典型产品 | MySQL | MongoDB | TiDB, CockroachDB |

### Q3：TiDB 和 TiKV 的关系是什么？

**TiDB = TiDB Server + TiKV + PD**

可以理解为：
- TiDB Server = MySQL（计算层）
- TiKV = InnoDB（存储层）
- PD = MySQL 运维工具（调度层）

TiKV 也可以单独使用，作为分布式 KV 存储（如替代 etcd）。

---

## 二、存储引擎类

### Q4：TiKV 的数据分片机制是怎样的？

TiKV 使用 **Region** 作为数据分片的基本单位：

```java
// Region 的核心概念
public class Region {
    private byte[] startKey;  // 起始 Key（包含）
    private byte[] endKey;    // 结束 Key（不包含）
    private List<Peer> peers; // Raft 副本
    private Peer leader;      // 当前 Leader
}
// 每个 Region 默认 96MB
// 大于阈值会自动分裂
// 小于阈值会尝试合并
```

**为什么用 Key 范围分片而不是 Hash 分片？**
- 范围分片支持有序遍历（`BETWEEN` 查询更高效）
- Hash 分片在范围查询时需要扫描所有节点

### Q5：Raft 协议在 TiKV 中如何实现？

Raft 是 TiKV 一致性的基石：

```java
// Raft 的核心机制
public class RaftProtocol {
    // 1. Leader 选举
    // Follower 收不到心跳 → 变成 Candidate → 发起选举
    // 获得多数票的节点成为 Leader

    // 2. 日志复制
    // 所有写入经过 Leader → 复制到 Follower → 多数派确认后 apply

    // 3. 成员变更
    // 增删节点通过 Raft 协议完成，保证安全性
}
```

**TiKV 的 Multi-Raft 优化**：
- 不是整个集群一个 Raft Group
- 每个 Region 有独立的 Raft Group
- 不同 Region 可以有不同的 Leader，实现真正的分布式写入

### Q6：MVCC 是如何实现的？

TiKV 使用 MVCC 实现并发控制：

```java
// MVCC 的核心思想
public class MVCC {
    // Key = user_key + start_ts
    // Value = {commit_ts, data, lock}

    // 读取时：
    // 返回所有 commit_ts <= startTs 的最新版本

    // 写入时：
    // Prewrite: 写入数据 + 锁
    // Commit: 写入 commit_ts，释放锁
}
```

**TSO（Timestamp Oracle）**：
- PD 分配全局唯一时间戳
- 一次 SQL 事务有两个时间戳：`start_ts` 和 `commit_ts`
- 事务看到的是 `start_ts` 时刻的数据库快照

### Q7：热点问题如何解决？

热点是分布式数据库的常见问题：

| 热点类型 | 解决方案 |
|---------|---------|
| 写入热点 | 使用 AUTO_RANDOM 代替自增主键 |
| 读取热点 | PD 自动迁移 Leader 到冷节点 |
| 索引热点 | 创建合适的二级索引分散访问 |

```sql
-- 使用 AUTO_RANDOM 解决写入热点
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_RANDOM,
    ...
);
```

---

## 三、SQL 引擎类

### Q8：TiDB 的查询优化器是怎么工作的？

TiDB 优化器分两个阶段：

```java
// 阶段 1：逻辑优化
public class LogicalOptimization {
    // 谓词下推：把过滤条件推到 TiKV 层
    // 列裁剪：只读取需要的列
    // 聚合下推：先在 TiKV 层聚合
    // JOIN 重排：根据数据量选择最优顺序
}

// 阶段 2：物理优化
public class PhysicalOptimization {
    // 枚举可能的物理计划
    // 代价估算
    // 选择代价最低的计划
}
```

### Q9：TiDB 支持哪些 JOIN 类型？

| JOIN 类型 | 适用场景 |
|---------|---------|
| Hash Join | 大表 JOIN 小表 |
| Merge Join | 已排序的数据 |
| Index Look Up Join | 有索引的小表 JOIN 大表 |

**TiFlash 还支持 MPP JOIN**，多个 TiFlash 节点并行计算。

### Q10：悲观事务和乐观事务怎么选？

| 事务模式 | 适用场景 |
|---------|---------|
| 乐观事务 | 低并发、冲突少（如日志、表单提交） |
| 悲观事务 | 高并发、冲突多（如库存扣减、转账） |

```sql
-- TiDB 默认使用乐观事务
-- 可以切换到悲观事务
SET GLOBAL tidb_txn_mode = 'pessimistic';
```

---

## 四、HTAP 类

### Q11：TiFlash 和 TiKV 的区别是什么？

| 特性 | TiKV | TiFlash |
|-----|------|---------|
| 存储格式 | 行存 | 列存 |
| 一致性 | 强一致 | 最终一致 |
| 查询类型 | 点查 | 聚合 |
| 写入方式 | 同步 | 异步同步 |

### Q12：MPP 是什么？什么时候用？

MPP（Massively Parallel Processing）让多个 TiFlash 节点并行计算：

```sql
-- 开启 MPP 模式
SET SESSION tidb_enforce_mpp = on;

-- 大表 JOIN 自动使用 MPP
SELECT a.*, SUM(b.amount)
FROM large_table_a a
JOIN large_table_b b ON a.id = b.id
GROUP BY a.id;
```

**适合场景**：复杂聚合、多表 JOIN、大数据量分析
**不适合场景**：简单点查、强一致性要求

### Q13：HTAP 场景下如何选型？

```
OLTP 为主 + 简单 OLAP → TiKV 足够
复杂 OLAP + 大数据量 → TiFlash + MPP
需要 Spark 生态 → TiSpark
```

---

## 五、运维管理类

### Q14：如何监控 TiDB 集群？

TiDB 的监控体系：

| 监控组件 | 说明 |
|--------|------|
| Grafana | 可视化展示 |
| Prometheus | 指标收集存储 |
| TiDB Dashboard | Web 诊断界面 |

关键监控指标：
- TiDB Server：QPS、延迟、连接数
- TiKV：Leader 分布、Region 健康度、磁盘使用
- PD：调度状态、TSO 延迟

### Q15：如何进行备份恢复？

TiDB 使用 **BR（Backup & Restore）** 工具：

```bash
# 全量备份
br backup full \
    --pd 192.168.1.1:2379 \
    --storage "s3://bucket/backup"

# 恢复
br restore full \
    --pd 192.168.1.1:2379 \
    --storage "s3://bucket/backup"
```

### Q16：扩缩容会影响服务吗？

**不会**。TiDB 的扩缩容是在线完成的：

- TiKV 扩容：PD 自动迁移 Region 到新节点
- TiKV 缩容：先迁移数据，再下线节点
- TiDB Server 扩容：无状态，直接加节点

---

## 六、高频追问类

### Q17：TiDB 和 CockroachDB 的区别？

| 维度 | TiDB | CockroachDB |
|-----|------|------------|
| 兼容性 | MySQL | PostgreSQL |
| 存储引擎 | TiKV（自研） | RocksDB |
| HTAP | 支持（TiFlash） | 不支持 |
| 社区活跃度 | 高 | 中 |

**选择建议**：已有 MySQL 经验选 TiDB，已有 PostgreSQL 经验选 CockroachDB。

### Q18：TiDB 的扩展上限是多少？

官方数据：
- TiKV 节点：100+ 节点
- 数据容量：PB 级
- QPS：百万级

实际上限取决于：
- 数据分布是否均匀
- 查询复杂度
- 网络带宽

### Q19：什么时候不适合用 TiDB？

| 场景 | 原因 | 替代方案 |
|-----|------|---------|
| 超高并发点查 | 网络开销大 | Redis + MySQL |
| 海量冷数据 | 存储成本高 | 对象存储 + Presto |
| 强事务 + 超大数据量 | 分布式事务开销大 | 分库分表 |
| 复杂全文检索 | 不支持全文索引 | Elasticsearch |

### Q20：如何定位 TiDB 慢查询？

```sql
-- 1. 查看执行计划
EXPLAIN ANALYZE <slow_query>;

-- 2. 查看 Top SQL
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_STATEMENTS_SUMMARY
ORDER BY SUM_LATENCY DESC LIMIT 10;

-- 3. 查看正在执行的查询
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_PROCESSLIST
WHERE Time > 10;

-- 4. TiDB Dashboard
-- Key Visualizer：分析热点
-- SQL Statement：查看慢查询
```

---

## 七、思维深度类

### Q21：TiDB 如何保证分布式一致性？

TiDB 的分布式一致性通过多层机制保证：

```
应用层 ──────────────────────────────
        分布式事务（Percolator）
              │
              ▼
        MVCC + TSO
              │
              ▼
        Raft 复制
              │
              ▼
        RocksDB 持久化
```

**Percolator 模型**：
- 去中心化的事务协调
- 主键机制保证原子性
- MVCC 实现快照隔离

### Q22：TiDB 的调度策略是怎样的？

PD 是 TiDB 的调度中心：

| 调度目标 | 说明 |
|---------|------|
| 负载均衡 | Region 数量均匀分布 |
| 热点分散 | Leader 分布均衡 |
| 副本隔离 | 不同 AZ/机架的副本 |
| 容量管理 | Region 分裂与合并 |

调度是通过 **Operator** 实现的：
- AddPeer / RemovePeer：增删副本
- TransferLeader：迁移 Leader
- Split / Merge：分裂合并 Region

### Q23：TiDB 的 SQL 引擎如何与存储层交互？

```java
// TiDB Server 接收 SQL
// SQL 解析 → 优化 → 生成分布式执行计划
// 执行计划被拆分成多个子任务
// 每个子任务发送到对应的 Region Leader
// TiKV 并行执行，返回结果
// TiDB Server 聚合结果
```

**算子下推**是关键优化：
- Filter 下推：减少数据传输
- 聚合下推：减少计算量
- 索引下推：减少回表

---

## 八、实战经验类

### Q24：生产环境遇到过什么问题？如何解决？

常见生产问题：

| 问题 | 原因 | 解决方案 |
|-----|------|---------|
| 写入热点 | 自增主键 | AUTO_RANDOM |
| 查询超时 | 缺少索引 | ADD INDEX |
| Region 不均衡 | 新节点加入 | 等待 PD 调度 |
| 同步延迟高 | TiFlash 负载高 | 增加 TiFlash 节点 |

### Q25：如何规划 TiDB 集群容量？

容量规划要素：

| 组件 | 规划要点 |
|-----|---------|
| TiKV | 数据量 × 3 副本 × 1.5 冗余 = 存储容量 |
| TiDB Server | QPS × 0.1 = CPU 核心数 |
| PD | 3 节点，etcd 数据量小 |
| TiFlash | 分析数据量 / 压缩比 |

### Q26：从 MySQL 迁移到 TiDB 的注意事项？

| 注意事项 | 说明 |
|---------|------|
| 自增主键 | TiDB 推荐 AUTO_RANDOM |
| 外键约束 | 功能有限，需评估 |
| 存储过程 | 不支持复杂存储过程 |
| 分区表 | 使用有限制，需测试 |
| 字符集 | UTF8MB4 完全支持 |

---

## 总结

TiDB 面试的核心知识点：

```
┌─────────────────────────────────────────────────────────┐
│                     TiDB 知识体系                        │
│                                                         │
│  架构原理 ────────────────────────────────────────      │
│  ├── TiDB Server / TiKV / PD 的职责                    │
│  ├── Region 分片机制                                    │
│  └── 存储计算分离架构                                   │
│                                                         │
│  核心技术 ────────────────────────────────────────      │
│  ├── Raft 协议与 Multi-Raft                            │
│  ├── MVCC 与 TSO                                       │
│  ├── Percolator 分布式事务                              │
│  └── SQL 引擎与算子下推                                 │
│                                                         │
│  HTAP 能力 ────────────────────────────────────────    │
│  ├── TiFlash 列式存储                                  │
│  ├── MPP 并行查询                                       │
│  └── TiSpark 集成                                       │
│                                                         │
│  运维实践 ────────────────────────────────────────      │
│  ├── 扩缩容与调度                                       │
│  ├── 监控与故障排查                                     │
│  └── 备份恢复                                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

面试回答的技巧：
- **概念清晰**：能用简洁的语言解释核心概念
- **深入理解**：知道原理和 trade-off
- **实战经验**：有生产环境的经验加分
- **举一反三**：能把 TiDB 的设计和其他系统类比

祝面试顺利！
