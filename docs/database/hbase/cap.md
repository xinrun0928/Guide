# HBase 与 CAP 理论：分布式系统的权衡

分布式系统领域有一个著名的定理：**CAP 理论**。

它告诉我们：在分布式系统中，一致性（Consistency）、可用性（Availability）、分区容错性（Partition Tolerance）三者只能同时满足两个。

HBase 作为分布式数据库，是如何在这三者之间做权衡的？

---

## CAP 理论回顾

```
                    CAP 理论
                         
           C                    A
            ┌───────────────────┐
            │                   │
            │      HBase        │  ← 选择了 CA
            │                   │
            └─────────[P]───────┘
                         
         必须在 C 和 A 之间选择
         P（分区容错）是必须满足的
```

### 三选二？

等等，CAP 理论说的是「三者只能同时满足两个」，但实际上：

> **分布式系统必须容忍网络分区（P）**，否则一旦网络分区，系统就完全不可用了。

所以实际上是在 **C 和 A 之间做选择**：

- **CP**：保证一致性，牺牲可用性
- **AP**：保证可用性，牺牲一致性

---

## HBase 的 CAP 定位

**HBase 是 CP 系统**。

```
┌─────────────────────────────────────────────────────────────┐
│                        HBase                                 │
│                                                             │
│  ✓ 一致性（Consistency）：每次读取都能读到最新写入          │
│  ✓ 分区容错（Partition Tolerance）：建在 HDFS 上，天然支持   │
│  ✗ 高可用（Availability）：Master 故障时会短暂不可用         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 为什么是 CP？

1. **WAL + Replica**：写入时先写 WAL，复制到多个节点后再返回
2. **强一致性读取**：读操作可以指定 `Consistency.TIMELINE` 确保读取最新数据
3. **Master 协调**：元数据变更需要 Master 确认

### 但不完全是 CP

HBase 有一些最终一致性的场景：

```java
// Region 迁移时，短暂不可用
// Master 故障切换时，短暂不可用（毫秒级）
// 如果使用读副本（Read Replicas），可以变成最终一致性
```

---

## HBase 的高可用机制

### 1. Region 多副本

```
Region 副本分布：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Region: user_table                                    │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  RegionServer-1 (Primary)                           │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │  │
│  │  │ HFile   │  │ HFile   │  │ HFile   │  ← 写入   │  │
│  │  └─────────┘  └─────────┘  └─────────┘            │  │
│  └─────────────────────────────────────────────────────┘  │
│           ↕ 同步复制                                          │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  RegionServer-2 (Replica)                          │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │  │
│  │  │ HFile   │  │ HFile   │  │ HFile   │  ← 只读   │  │
│  │  └─────────┘  └─────────┘  └─────────┘            │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Master 高可用

```
Master 选举（通过 Zookeeper）：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  Zookeeper 节点：                                           │
│  /hbase/master                                             │
│       │                                                     │
│       ├── Master-1 (ACTIVE)  ← 持有锁                      │
│       └── Master-2 (STANDBY)                               │
│                                                             │
│  Master-1 故障 → 锁释放 → Master-2 抢锁 → 升级为 ACTIVE     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3. WAL 持久化

```java
// 写入流程（保证不丢失）
public void write(byte[] rowKey, byte[] cf, byte[] cq, byte[] value) {
    // 1. 先写入 WAL（保证持久化）
    WAL.Entry entry = new WAL.Entry(rowKey, mutations);
    wal.append(entry);
    wal.sync();  // 必须刷盘

    // 2. 写入 MemStore（内存）
    memStore.put(new KeyValue(rowKey, cf, cq, value));

    // 3. 返回成功
}
```

---

## HBase 的一致性模式

### 1. 强一致性（默认）

```java
// 强一致性读取：每次都读取最新数据
Get get = new Get(rowKey);
get.setConsistency(Consistency.STRONG);  // 默认值

Result result = table.get(get);
```

### 2. 最终一致性（读副本）

```java
// 最终一致性读取：从副本读取，可能不是最新
Get get = new Get(rowKey);
get.setConsistency(Consistency.TIMELINE);  // 读副本

Result result = table.get(get);
// 读取延迟更低，但可能不是最新数据
```

### 3. 多版本一致性

```java
// 读取指定时间戳的数据
Get get = new Get(rowKey);
get.setTimestamp(timestamp);  // 指定版本

Result result = table.get(get);
```

---

## 与其他系统的对比

| 系统 | CAP | 说明 |
|-----|-----|------|
| HBase | CP | 强一致性，Master 协调 |
| Cassandra | AP | 最终一致性，去中心化 |
| DynamoDB | AP | 可配置一致性级别 |
| MongoDB | CP | 主从复制，强一致性 |
| MySQL | CA | 单节点，无分区容错 |

### Cassandra vs HBase

| 维度 | Cassandra | HBase |
|-----|----------|-------|
| 架构 | 去中心化（P2P）| Master-Slave |
| 一致性 | 可配置（最终一致）| 强一致 |
| 写入 | 强写入（4xx）| WAL + 内存 |
| 读取 | 强读取（QUORUM）| BlockCache |
| 热点处理 | 虚拟节点 | 预分区 |
| 查询 | CQL（类 SQL）| Scan + Filter |

**选择建议**：

- 需要强一致 → HBase
- 需要高可用、去中心化 → Cassandra
- 需要复杂查询 → 都不适合，用 HDFS/Hive

---

## 实际场景分析

### 场景一：订单系统

```
需求：订单数据必须准确，不能丢失

选择：HBase (CP)

原因：
- 订单数据不允许丢失
- 强一致性保证数据准确
- 允许短暂不可用（Master 切换期间）
```

### 场景二：实时Feed系统

```
需求：用户随时可以读取，高可用优先

选择：HBase + 读副本

原因：
- 高可用优先
- 允许短暂数据不一致
- 使用 TIMELINE 读取提高性能
```

### 场景三：消息系统

```
需求：消息不能丢失，按时间顺序展示

选择：HBase + 强一致性

原因：
- 消息丢失不可接受
- 按时间排序依赖一致性
- 写入量大但 HBase 可以支撑
```

---

## 面试追问方向

- Cassandra 是 AP 系统，它是怎么处理写冲突的？
- HBase 如何保证强一致性读取？

下一节，我们来对比 HBase 和关系型数据库。
