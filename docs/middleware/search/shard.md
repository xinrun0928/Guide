# Elasticsearch 分片策略与副本机制

如果你要在一个图书馆里存放一亿本书，你会怎么做？把所有书堆在一个房间？显然不行——你需要把它们分散到不同的楼层、不同的书架，甚至不同的图书馆。

ES 的分片策略，就是解决「**数据太多存不下**」这个问题的。

## 1. 为什么需要分片？

单台机器的存储空间和计算能力是有限的。分片让 ES 具备了**横向扩展**的能力。

```
不分片：1台机器 → 只能存这么多数据
分片后：N台机器 → 每台存 1/N 的数据
```

**分片带来的好处：**

| 能力 | 说明 |
|-----|------|
| 容量扩展 | 数据分散到多个节点，突破单机存储限制 |
| 并行查询 | 搜索同时在多个分片上执行，提升吞吐量 |
| 高可用 | 某个节点挂了，副本分片接管服务 |
| 负载均衡 | 请求分散到不同分片 |

## 2. 主分片（Primary Shard）

### 2.1 分片数量规划

创建索引时必须指定主分片数，**一旦指定，不可修改**。

```java
// 创建索引时指定主分片数
PUT my_index
{
  "settings": {
    "number_of_shards": 5    // 5 个主分片
  }
}
```

> **为什么主分片数不能改？**
>
> 因为 ES 使用 `hash(doc_id) % num_shards` 来路由文档。如果改分数，所有文档的路由位置都会变，需要重新分布所有数据——这在生产环境是不可接受的。

### 2.2 如何确定分片数？

这是一个需要权衡的问题：

```
分片数太小 ──────────────────────── 分片数太大
│                                   │
├─ 单分片数据量太大                 ├─ 大量小分片
├─ 单节点压力大                     ├─ 内存开销增加
├─ 写入/查询慢                     ├─ 协调成本增加
│                                   ├─ 元数据管理开销大
│                                   │
└───────────── 合适分片数 ──────────┘
```

**经验公式**：

```java
// 推荐：每个分片大小 30-50GB
// 如果预计数据量 500GB，主分片数 ≈ 10-17

// 或者：每个节点 1-3 个分片
// 3 个数据节点，预期 9 个分片
```

| 数据量 | 推荐主分片数 | 说明 |
|-------|-------------|------|
| < 10GB | 1 | 测试环境 |
| 10-50GB | 1-5 | 小型项目 |
| 50-200GB | 5-10 | 中型项目 |
| > 200GB | 按需扩展 | 需要规划 |

### 2.3 分片与节点的关系

```
┌────────────────────────────────────────────────┐
│              3 个主分片的索引                    │
│                                                 │
│   Shard 0   Shard 1   Shard 2                  │
│      │         │         │                     │
│      ▼         ▼         ▼                     │
│  ┌─────┐   ┌─────┐   ┌─────┐                   │
│  │Node1│   │Node2│   │Node3│                   │
│  └─────┘   └─────┘   └─────┘                   │
│                                                 │
└────────────────────────────────────────────────┘
```

一个节点可以存储多个分片，一个分片只能属于一个节点。

## 3. 副本分片（Replica Shard）

### 3.1 副本的作用

```
Primary Shard  ←  同步写入  →  Replica Shard 0
   (主分片)                      (副本1)

                        ┌────────┐
                        │ 同步写入│
                        └────────┘
                              │
                              ▼
Primary Shard  ←────────── Replica Shard 1
   (主分片)                      (副本2)
```

**副本的核心价值：**

1. **故障转移**：主分片挂了，副本自动升级
2. **提升读取**：查询可以分散到副本，降低主分片压力
3. **数据安全**：多副本确保数据不丢失

### 3.2 副本数量配置

```java
// 创建索引时指定副本数
PUT my_index
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 2    // 每个主分片有 2 个副本
  }
}

// 动态修改副本数
PUT my_index/_settings
{
  "number_of_replicas": 1
}
```

### 3.3 副本同步机制

ES 使用 **primary-backup 模型** 同步数据：

```
写入流程：

1. Client → Coordinating 节点：写入请求
2. Coordinating → Primary Shard：转发请求
3. Primary Shard：
   a. 写入本地
   b. 并行转发给所有 Replica
4. Replica Shard：
   a. 写入本地
   b. 返回成功给 Primary
5. Primary → Coordinating：确认成功
6. Coordinating → Client：返回响应
```

**注意**：写入需要等所有副本确认吗？

- 默认是 **quorum**（过半）确认：`min(quorum replicas, all replicas)`
- 3 副本（1 主 + 2 副）：需要 2 个确认
- 可以配置 `consistency: one|quorum|all`，但追求性能时用 `one`

```java
// 写入时指定一致性级别
PUT my_index/_doc/1?consistency=quorum
{
  "title": "Elasticsearch 实战"
}
```

## 4. 分片分配策略

### 4.1 分片均衡器

ES 内置自动均衡器，尽量让每个节点的分片数均衡。

```
均衡前：           均衡后：
Node1: 5 分片      Node1: 4 分片
Node2: 3 分片  →   Node2: 4 分片
Node3: 4 分片      Node3: 4 分片
```

### 4.2 强制均衡

```java
// 手动触发均衡
POST _cluster/reroute?retry_failed=true
```

### 4.3 禁止分片分配

```java
// 维护时禁止分配
PUT _cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable": "none"
  }
}

// 恢复分配
PUT _cluster/settings
{
  "transient": {
    "cluster.routing.allocation.enable": "all"
  }
}
```

## 5. 冷热分离架构

在生产环境中，数据有「热」「冷」之分：

```
热数据：最近的数据，访问频繁，需要高性能存储（SSD）
冷数据：历史数据，访问较少，可以使用大容量存储（HDD）
```

### 5.1 节点打标签

```java
// hot 节点（SSD，高性能）
node.attr.box_type: hot

// warm 节点（HDD，大容量）
node.attr.box_type: warm

// cold 节点（归档数据）
node.attr.box_type: cold
```

### 5.2 分片分配规则

```java
// 创建索引时指定分配规则
PUT logs-2024-01
{
  "settings": {
    "index.routing.allocation.include.box_type": "hot"
  }
}

// 3天后移动到 warm 节点
PUT logs-2024-01/_settings
{
  "index.routing.allocation.include.box_type": "warm"
}
```

### 5.3 ILM（索引生命周期管理）

```java
// 定义 ILM 策略
PUT _ilm/policy/my_policy
{
  "policy": {
    "phases": {
      "hot": {
        "actions": {
          "rollover": {
            "max_size": "50GB",
            "max_age": "1d"
          }
        }
      },
      "warm": {
        "min_age": "7d",
        "actions": {
          "shrink": {
            "number_of_shards": 1
          },
          "forcemerge": {
            "max_num_segments": 1
          },
          "allocate": {
            "require": {
              "box_type": "warm"
            }
          }
        }
      },
      "cold": {
        "min_age": "30d",
        "actions": {
          "allocate": {
            "require": {
              "box_type": "cold"
            }
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

## 6. 分片倾斜问题

### 6.1 什么是分片倾斜？

某些分片的数据量明显大于其他分片，导致负载不均。

```
正常情况：        倾斜情况：
Shard0: 100条     Shard0: 100条
Shard1: 95条      Shard1: 98条
Shard2: 102条     Shard2: 50000条 ← 数据倾斜！
```

### 6.2 原因分析

1. **Routing Key 不均匀**：某些文档的路由值集中
2. **数据本身不均匀**：某些分类的数据量天然很大
3. **写入热点**：所有数据都写到某个分片

### 6.3 解决方案

**方案一：使用组合 Routing Key**

```java
// 原来：只用 user_id 路由
POST my_index/_doc?routing=user_id
{
  "user_id": "123",
  "content": "..."
}

// 改进：用 user_id + timestamp 组合路由
// 相同用户在大多数情况下路由到同一分片
// 但不同月份的数据会分散到不同分片
```

**方案二：强制平衡**

```java
// 手动移动分片
POST _cluster/reroute
{
  "commands": [
    {
      "move": {
        "index": "my_index",
        "shard": 2,
        "from_node": "node1",
        "to_node": "node2"
      }
    }
  ]
}
```

## 7. 分片与副本的配置策略

| 场景 | 主分片数 | 副本数 | 说明 |
|-----|---------|--------|------|
| 单节点测试 | 1 | 0 | 无高可用需求 |
| 小型生产 | 3 | 1 | 基本的读写分离 |
| 中型生产 | 5 | 1-2 | 平衡成本和可用性 |
| 大型高可用 | 10+ | 2+ | 需要仔细规划 |

## 8. 面试高频问题

### Q1：主分片数和副本数如何选择？

**答案**：

- **主分片数**：根据数据量预估，每个分片 30-50GB 为宜；创建后不可改
- **副本数**：根据高可用需求选择，1-2 个足够；可随时调整

### Q2：副本数越多越好吗？

**答案**：不是。副本会占用存储空间，而且写入时要同步到副本，增加延迟。只有读多写少或有高可用需求时才增加副本。

### Q3：某个节点宕机后，ES 如何处理？

**答案**：

1. Master 节点检测到节点失联
2. 将失联节点的分片标记为 unassigned
3. 自动将副本分片提升为主分片（如果原主分片所在节点不可恢复）
4. 在可用节点上创建新的副本

## 总结

分片策略是 ES 架构设计的核心：

1. **主分片决定容量**：规划好主分片数，创建后不可改
2. **副本保证高可用**：副本数可动态调整，但会增加资源消耗
3. **冷热分离优化成本**：热数据用 SSD，冷数据用 HDD
4. **ILM 自动管理**：通过生命周期策略自动迁移和删除数据
5. **避免数据倾斜**：选择合适的 routing key，监控分片分布

---

**留给你的问题**：

假设你预估数据量 1TB，每个分片 50GB，需要 20 个主分片。但你有 5 个节点，每个节点 2 个 CPU 核心。

问题来了：20 个分片均匀分布意味着每节点 4 个分片，4 个分片同时搜索时 CPU 会成为瓶颈。你会怎么处理这个问题？

这个设计需要平衡存储、计算和网络资源，值得深入思考。
