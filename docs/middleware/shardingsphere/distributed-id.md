# ShardingSphere 分布式 ID 生成

分库分表后，你的订单表有 64 张分片。

但问题来了：**订单 ID 怎么生成？**

你可能想用 MySQL 自增 ID，但每个分片的自增 ID 都从 1 开始，订单 ID 就会重复。

用 UUID？`550e8400-e29b-41d4-a716-446655440000`，又长又无序，数据库索引效率低下。

这就是分布式 ID 的核心挑战：**如何在多节点环境下生成全局唯一、趋势递增、高性能的 ID？**

## 分布式 ID 的要求

一个优秀的分布式 ID，需要满足以下条件：

| 要求 | 说明 |
|-----|------|
| 全局唯一 | 跨库、跨机器不重复 |
| 趋势递增 | 新 ID 比旧 ID 大，利于 B+ 树插入 |
| 高性能 | 每秒可生成几十万甚至上百万 ID |
| 高可用 | 部分节点故障不影响整体服务 |
| 可反解 | 从 ID 可以获取时间、机器等信息 |
| 接入简单 | 不需要复杂配置 |

**UUID 为什么不行？**

```java
UUID.randomUUID().toString()
// "f47ac10b-58cc-4372-a567-0e02b2c3d479"
```

UUID 的问题：

1. **无序**：随机字符串插入 B+ 树会导致大量页分裂
2. **存储成本高**：36 个字符，比 8 字节长整型多占 4.5 倍空间
3. **不可反解**：从 UUID 无法得知任何业务信息

## 雪花算法（Snowflake）

目前最流行的分布式 ID 算法，由 Twitter 提出。

### 核心原理

64 位 Long 型 ID，分为四部分：

```
+------+------------------+-----------+---------+
| sign |    timestamp     | machineId |  seq    |
+------+------------------+-----------+---------+
| 1bit |     41bit        |   10bit   |  12bit  |
+------+------------------+-----------+---------+
```

| 字段 | 位数 | 说明 |
|-----|-----|------|
| sign | 1bit | 符号位，固定为 0 |
| timestamp | 41bit | 时间戳（毫秒） |
| machineId | 10bit | 机器 ID（1024 个节点） |
| seq | 12bit | 序列号（每毫秒最多 4096 个） |

**计算公式：**

```java
long id = (timestamp - START_TIMESTAMP) << 22   // 时间戳部分
        | (machineId << 12)                      // 机器标识
        | seq;                                   // 序列号
```

### ShardingSphere 中的雪花算法

```yaml
rules:
- !KEY_GENERATE
  columns:
    order_id:
      keyGenerator: snowflake
    user_id:
      keyGenerator: snowflake
  keyGenerators:
    snowflake:
      type: SNOWFLAKE
      props:
        worker-id: 1
        max-tolerate-time-difference-milliseconds: 10
```

```java
// 代码中使用，无需手动生成
Order order = new Order();
// orderId 会自动生成
orderMapper.insert(order);
```

### 雪花算法的优势

**1. 趋势递增**

因为时间戳是 ID 的主体部分，新生成的 ID 一定比旧的 ID 大。这对 MySQL B+ 树索引非常友好。

**2. 强解耦**

不需要中心节点，不依赖 ZooKeeper 等外部服务。每个节点独立生成，互不干扰。

**3. 高性能**

在单节点内，ID 生成只是简单的位运算和 CAS 操作。每毫秒可生成 4096 个 ID，单机 QPS 可达百万级。

### 雪花算法的问题

**1. 时钟回拨**

如果机器时钟回拨（比如 NTP 同步），可能导致 ID 重复。

```java
// 模拟时钟回拨
// t1 时刻生成 ID: timestamp = 1000
// 时钟回拨到 990
// t2 时刻生成 ID: timestamp = 990，但 seq 可能耗尽
```

**ShardingSphere 的解决方案：**

```yaml
props:
  max-tolerate-time-difference-milliseconds: 10  # 允许 10ms 内的时钟回拨
```

当检测到时钟回拨时，会等待补齐时间，然后再继续生成。

```java
// 伪代码实现
if (timestamp < lastTimestamp) {
    // 时钟回拨了，等待追上
    waitTime = lastTimestamp - timestamp;
    Thread.sleep(waitTime);
}
lastTimestamp = timestamp;
```

如果回拨超过阈值（比如 10ms），会抛出异常或切换到备用方案。

**2. 机器 ID 需要手动配置**

雪花算法依赖机器 ID，不同节点必须有不同的 worker-id。

```yaml
# 节点 1
worker-id: 1

# 节点 2
worker-id: 2
```

如果两个节点配置了相同的 worker-id，ID 可能冲突。

在 ShardingSphere-Proxy 中，可以配置 ZooKeeper 自动分配：

```yaml
props:
  worker-id-generator-type: ZOOKEEPER
  zookeeper-url: zk-host:2181
```

## 其他分布式 ID 方案

### 一、号段模式（Segment）

每次从数据库批量获取一批 ID，用完再获取下一批。

```
表结构：
+---------------+-----------+
| max_id        | step      |
+---------------+-----------+
| 1000          | 1000      |
+---------------+-----------+

当前应用获取：1001 - 2000
其他应用获取：2001 - 3000
```

**优势：**

- 减少数据库交互（一次获取 1000 个 ID）
- ID 连续递增

**劣势：**

- ID 会有跳跃（比如 1999, 2000, 1001）
- 依赖数据库

**ShardingSphere 配置：**

```yaml
keyGenerators:
  segment:
    type: SNOWFLAKE  # 也可以用其他支持
    props:
      segment-initial-value: 1000
      segment-step: 1000
```

### 二、数据库自增 + 步长

```sql
-- 设置步长
SET @@auto_increment_increment = 10;

-- 节点 1
SET @@auto_increment_offset = 1;
-- 生成的 ID: 1, 11, 21, 31...

-- 节点 2
SET @@auto_increment_offset = 2;
-- 生成的 ID: 2, 12, 22, 32...
```

**劣势：**

- 依赖数据库主库（性能瓶颈）
- 步长固定，扩容困难
- 切换数据库麻烦

### 三、Leaf（美团方案）

Leaf 是美团开源的分布式 ID 生成方案，结合了雪花算法和号段模式。

**核心思想：**

- 双 Ring Buffer：两个缓冲区交替使用
- 预加载下一批 ID：当前缓冲区用完前，提前加载下一批
- ZK 协调 worker-id 分配

**架构：**

```
┌─────────────────────────────────────────┐
│                 Leaf Server              │
│  ┌─────────────────────────────────┐    │
│  │       SegmentService            │    │
│  │   RingBuffer1  |  RingBuffer2   │    │
│  │      [1-1000]     [1001-2000]   │    │
│  └─────────────────────────────────┘    │
└─────────────────┬───────────────────────┘
                  │ 获取 ID
                  ▼
            应用服务
```

### 四、百度 UidGenerator

基于雪花算法改良，通过取消时间戳回拨限制来优化。

```yaml
# 禁用时间回拨检测（风险较高）
props:
  enable-adapter: true
  tail-optimization-enabled: true
  boost-factor: 3
```

## 分布式 ID 与分片键的配合

分布式 ID 生成后，怎么配合分片策略？

### 方式一：ID 本身就是分片键

```yaml
tables:
  t_order:
    actualDataNodes: ds_${order_id % 4}.t_order_${order_id % 16}
```

**优点：** ID 生成后直接确定分片位置，路由效率高。

**缺点：** 如果 ID 不连续，可能导致数据倾斜（比如连续多个大 ID 落在同一分片）。

### 方式二：单独的分片键，ID 无业务含义

```yaml
tables:
  t_order:
    actualDataNodes: ds_${user_id % 4}.t_order_${user_id % 16}
```

**优点：** 按 user_id 分片，查询效率高（大多数查询带 user_id）。

**缺点：** order_id 只作为主键，不参与路由。

### 方式三：雪花 ID + 哈希分片（推荐）

```yaml
tables:
  t_order:
    actualDataNodes: ds_${order_id % 4}.t_order_${order_id % 16}
    
keyGenerators:
  snowflake:
    type: SNOWFLAKE
    props:
      worker-id: 1
```

**为什么推荐？**

因为雪花 ID 的时间戳部分保证了趋势递增：

- 单分片内数据按时间有序
- 新数据总是追加到 B+ 树尾部，页分裂少
- 主键查询（根据 ID 定位单条）性能稳定

## 实战：多环境下的 ID 生成

### 开发/测试环境

```yaml
# 开发环境：单机部署
props:
  worker-id: 1
```

### 生产环境：集群部署

**方案一：手动分配 worker-id**

```yaml
# Pod 1
props:
  worker-id: 1

# Pod 2
props:
  worker-id: 2

# Pod 3
props:
  worker-id: 3
```

问题：如果 Pod 动态扩缩容，worker-id 管理麻烦。

**方案二：基于 Pod ID 分配（Kubernetes 场景）**

```java
// 获取 Pod 的 hostname（如 order-service-0, order-service-1）
String hostname = System.getenv("HOSTNAME");
// 从 hostname 提取数字后缀
int workerId = Integer.parseInt(hostname.split("-")[2]);
```

**方案三：ZooKeeper 自动分配**

```yaml
props:
  worker-id-generator-type: ZOOKEPER
  zookeeper-url: zk-service:2181
  zookeeper-namespace: shardingsphere-id
```

ShardingSphere 会在 ZooKeeper 中注册临时节点，自动分配未使用的 worker-id。

### 时钟同步问题

时钟回拨是生产环境的定时炸弹。建议：

1. **NTP 服务稳定**：确保所有节点时钟同步
2. **监控告警**：检测时钟回拨次数和幅度
3. **备用方案**：回拨时降级为 UUID 或拒绝服务

```yaml
props:
  max-tolerate-time-difference-milliseconds: 5  # 阈值设置小一些
  worker-id-generator-type: ZOOKEPER            # 配合 ZK 做 worker-id 持久化
```

## 性能对比

| 方案 | TPS | ID 长度 | 趋势递增 | 依赖 |
|-----|-----|--------|---------|------|
| UUID | 10万+ | 36字符 | 无 | 无 |
| Snowflake | 26万/节点 | 19位数字 | 是 | 无 |
| Segment | 10万/节点 | 19位数字 | 是 | 数据库 |
| Leaf | 50万/节点 | 19位数字 | 是 | ZooKeeper + DB |

## 面试追问

- **雪花算法时钟回拨怎么处理？** 可以等待回拨时间补齐、降级为备选方案（如 UUID）、拒绝服务。
- **为什么雪花算法的时间戳用 41 位？** 因为 41 位可以表示 69 年的时间跨度（2^41 毫秒），足够大多数业务使用。
- **雪花算法每毫秒序列号用 12 位，超过了怎么办？** 序列号溢出后，阻塞到下一毫秒。
- **如果业务需要可反解的 ID 怎么办？** 可以自定义 ID 格式，比如 `日期_业务标识_机器号_序号`，或者使用类似美团 Leaf 的方案。

## 总结

分布式 ID 生成是分布式系统的基础设施，选型建议：

| 场景 | 推荐方案 |
|-----|---------|
| 简单场景、快速上线 | Snowflake（ShardingSphere 内置） |
| 超高并发（百万 QPS） | Leaf 号段模式 |
| 需要业务含义 | 自定义 ID 格式 |
| 有状态一致性要求 | ZooKeeper 协调的 Snowflake |

下篇文章，我们来聊聊 ShardingSphere 的编排治理——如何统一管理配置、监控多个分片节点。
