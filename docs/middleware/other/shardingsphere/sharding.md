# ShardingSphere 数据分片：分片键与分片算法

你接手了一个历史项目，发现数据库里有一张 `t_order` 表，数据量已经突破 5000 万。

业务方要求：订单查询要控制在 100ms 以内。

运维同学说：单库已经撑不住了，要分片。

你打开 Navicat，看着这张表犯愁：**该怎么分？按什么字段分？用什么算法分？**

这是每个分库分表场景下都必须回答的问题。今天，我们把 ShardingSphere 的分片策略讲透。

## 分片之前：先问自己三个问题

在动手配置之前，比选算法更重要的事情是：搞清楚你的业务查询模式。

**问题一：查询条件是什么？**

- 如果 80% 的查询都带 `user_id`，那 `user_id` 是分片键的首选
- 如果查询条件五花八门，没有统一字段，那分片可能不是最优解

**问题二：数据分布是否均匀？**

- 如果按 `status` 分片（待支付/已支付/已取消），数据会严重倾斜
- 如果按时间分片（新订单多、老订单少），冷热数据分离是好事，但查询需要指定时间范围

**问题三：未来扩容怎么办？**

- 哈希分片扩容困难，需要迁移大量数据
- 范围分片扩容简单，但可能有热点

这三个问题想清楚，再去选算法。

## ShardingSphere 分片核心概念

ShardingSphere 的分片配置有三个核心概念：

| 概念 | 说明 |
|-----|------|
| 分片键（Shard Column） | 用于计算路由的字段，比如 `user_id` |
| 分片算法（Sharding Algorithm） | 根据分片键计算目标分片的逻辑 |
| 分片规则（Sharding Rule） | 分片键 + 分片算法的组合 |

```java
// ShardingSphere 分片配置示例
ShardingRuleConfiguration config = new ShardingRuleConfiguration();

// 配置 t_order 表的分片规则
TableRuleConfiguration orderTableRule = new TableRuleConfiguration(
    "t_order",                              // 逻辑表名
    "ds_${0..1}.t_order_${0..15}"           // 真实表名表达式
);
orderTableRule.setTableShardingStrategyConfig(
    new StandardShardingStrategyConfiguration(
        "user_id",                          // 分片键
        new ModShardingAlgorithmConfiguration("4")  // 分片算法
    )
);

config.getTableRuleConfigs().add(orderTableRule);
```

注意 `ds_${0..1}.t_order_${0..15}` 这个表达式：它表示 2 个数据源（ds_0、ds_1），每个数据源 16 张表（t_order_0 到 t_order_15）。

总容量：2 × 16 = 32 个分片。

## 分片算法详解

ShardingSphere 内置了多种分片算法，我们逐一分析。

### 一、哈希分片（HashShardingAlgorithm）

哈希分片是最常用的算法，核心思想是：对分片键取哈希，再对分片数取模。

```java
// 等价的算法逻辑
int shardIndex = (hash(userId) & Integer.MAX_VALUE) % shardCount;
```

**配置方式：**

```yaml
tables:
  t_order:
    actualDataNodes: ds_${0..1}.t_order_${0..15}
    databaseStrategy:
      standard:
        shardingColumn: user_id
        shardingAlgorithmName: database_hash
    tableStrategy:
      standard:
        shardingColumn: user_id
        shardingAlgorithmName: table_hash
    shardingAlgorithms:
      database_hash:
        type: INLINE
        props:
          algorithm-expression: ds_${user_id % 2}
      table_hash:
        type: INLINE
        props:
          algorithm-expression: t_order_${user_id % 16}
```

**优缺点：**

| 优点 | 缺点 |
|-----|------|
| 数据分布均匀 | 扩容困难（取模变了，要迁移数据） |
| 查询条件带分片键时效率高 | 不支持范围查询 |
| 实现简单 | |

**适用场景：** 查询条件**必须包含分片键**，且数据量大、分布均匀。比如 `SELECT * FROM t_order WHERE user_id = ?`。

**不适用场景：** `SELECT * FROM t_order WHERE amount > 100` 这种不带分片键的查询，会触发全路由，性能极差。

### 二、范围分片（RangeShardingAlgorithm）

范围分片按照分片键的值域进行分片，常见的按时间分片就属于这一类。

```java
// 时间范围分片示例
public class MonthShardingAlgorithm implements RangeShardingAlgorithm&lt;Comparable&lt;?&gt;&gt; {
    
    @Override
    public Collection&lt;String&gt; doSharding(
            Collection&lt;String&gt; availableTargetNames,
            RangeShardingValue&lt;Comparable&lt;?&gt;&gt; shardingValue) {
        
        Range&lt;Comparable&lt;?&gt;&gt; range = shardingValue.getValueRange();
        List&lt;String&gt; result = new ArrayList&lt;&gt;();
        
        // 解析时间范围，生成需要的分片
        LocalDateTime lower = (LocalDateTime) range.lowerEndpoint();
        LocalDateTime upper = (LocalDateTime) range.upperEndpoint();
        
        YearMonth start = YearMonth.from(lower);
        YearMonth end = YearMonth.from(upper);
        
        // 按月生成表名
        while (!start.isAfter(end)) {
            String target = "t_order_" + start.format(DateTimeFormatter.ofPattern("yyyyMM"));
            if (availableTargetNames.contains(target)) {
                result.add(target);
            }
            start = start.plusMonths(1);
        }
        
        return result;
    }
}
```

**配置方式：**

```yaml
tables:
  t_order:
    actualDataNodes: ds_${0..1}.t_order_${202301..202312}
    tableStrategy:
      standard:
        shardingColumn: create_time
        shardingAlgorithmName: table_range
    shardingAlgorithms:
      table_range:
        type: CLASS_BASED
        props:
          strategy: STANDARD
          algorithmClassName: com.example.MonthShardingAlgorithm
```

**优缺点：**

| 优点 | 缺点 |
|-----|------|
| 支持范围查询 | 数据分布可能不均匀 |
| 扩容简单（新增范围即可） | 热点问题（当前月数据集中） |
| 冷热数据分离 | |

**适用场景：** 时间序列数据，比如日志表、订单表（按月查询）、监控数据。`SELECT * FROM t_order WHERE create_time BETWEEN '2024-01-01' AND '2024-03-31'` 这种查询效果很好。

**不适用场景：** 查询条件不带时间，或者要查「所有订单」，全路由无法避免。

### 三、时间分片（AutoShardingAlgorithm）

ShardingSphere 还提供了一个自动分片算法，它会根据数据量自动决定分配到哪个分片。

```java
// 基于标准分片的配置
shardingAlgorithms:
  standard_auto:
    type: AUTO
    props:
      strategy: STANDARD  # 或 AVG_GARBAGE, INTERFACE_HINT
```

这种算法的特点是：**分片数可以动态调整**，不需要一次性确定所有分片。它依赖注册中心（比如 ZooKeeper）来协调分片信息。

### 四、分布式序列算法（KeyGenerateSequence）

有些场景下，你希望分片键本身是**有序递增**的，比如订单号、时间戳 + 随机数等。ShardingSphere 提供了分布式 ID 生成机制：

```yaml
defaultKeyGenerator:
  type: SNOWFLAKE
  props:
    worker-id: 1
    max-tolerate-time-difference-milliseconds: 10
```

配合分片键使用：

```java
// 配置列的分布式序列生成
TableRuleConfiguration orderTableRule = new TableRuleConfiguration("t_order");
orderTableRule.setKeyGeneratorConfig(
    new KeyGeneratorConfiguration("order_id", "SNOWFLAKE")
);
```

关于分布式 ID 的详细内容，我们会在[分布式 ID 生成](/middleware/shardingsphere/distributed-id)章节详细讲解。

## 复合分片键

有些业务场景，单一分片键无法满足需求，需要多个字段组合分片。

比如：既要按用户分库，又要按订单状态分表。

```java
// 复合分片配置
TableRuleConfiguration orderTableRule = new TableRuleConfiguration(
    "t_order", 
    "ds_${user_id % 2}.t_order_${status}_${user_id % 4}"
);

// 使用复合分片键
ComplexShardingStrategyConfiguration complexStrategy = 
    new ComplexShardingStrategyConfiguration(
        "user_id, status",          // 复合分片键
        new ModShardingAlgorithmConfiguration("user_id", "2"),   // 库分片算法
        new ModShardingAlgorithmConfiguration("status", "4")     // 表分片算法
    );
```

但我必须提醒你：**复合分片键是一个陷阱**。

你以为是万能钥匙，实际上埋了大坑：

- 查询条件必须包含**所有分片键字段**才能精准路由
- 如果只带 `user_id`，那所有 `status` 对应的表都要扫描
- 如果只带 `status`，那所有 `user_id` 对应的库都要扫描

**经验法则：能用单一分片键，就不要用复合分片键。**

## 分片键选择原则

这是面试和实战中最常见的问题。我们来总结一下选择分片键的原则：

### 原则一：查询高频优先

选择业务查询中出现频率最高的字段作为分片键。

- 订单系统：通常是 `user_id`
- 商品系统：通常是 `category_id` 或 `merchant_id`
- 日志系统：通常是 `create_time`

### 原则二：分布均匀

分片键的值域分布要尽可能均匀，避免出现数据倾斜。

```java
// 反例：按性别分，只有男女两个分片
// 正例：按 user_id % 100 分，数据均匀
```

### 原则三：业务无关

避免选择业务状态类字段作为分片键。状态会变化，而且分布不均匀。

| 推荐 | 不推荐 |
|-----|-------|
| user_id | status |
| order_id | type |
| create_time | flag |

### 原则四：避免跨分片事务

分片键的选择要尽量让关联数据在同一分片，减少跨分片查询和事务。

比如：订单表按 `user_id` 分片，订单详情表也按 `user_id` 分片，这样用户的所有订单数据都在同一分片内。

## 路由类型详解

分片键选好了，算法也配好了，那 ShardingSphere 内部是怎么路由的？

### 携带分片键的查询

```sql
SELECT * FROM t_order WHERE user_id = 12345
```

ShardingSphere 会：

1. 解析 SQL，提取 `user_id = 12345`
2. 计算哈希：`12345 % 16 = 9`
3. 直接路由到 `ds_${12345 % 2}.t_order_9`

这是最理想的**精准路由**，只需访问一个分片。

### 携带范围的分片键查询

```sql
SELECT * FROM t_order WHERE user_id BETWEEN 1000 AND 2000
```

ShardingSphere 会：

1. 计算范围覆盖的分片数
2. 路由到所有可能命中的分片
3. 结果归并（如果需要排序、分页）

这种叫**范围路由**，可能访问多个分片。

### 不携带分片键的查询

```sql
SELECT * FROM t_order WHERE amount > 100
```

ShardingSphere 只能**全路由**：访问所有分片，合并结果。

对于分页查询：

```sql
SELECT * FROM t_order ORDER BY create_time LIMIT 100, 10
```

ShardingSphere 需要：

1. 从每个分片取前 110 条
2. 内存中合并排序
3. 返回第 100-110 条

**这就是分库分表后深分页性能差的根本原因。**

## 实战：订单系统分片设计

假设我们要对订单表进行分片，订单量预估 5 年内达到 10 亿。

**业务特点分析：**

- 80% 查询是「查我的订单」：`WHERE user_id = ?`
- 15% 查询是「查某时间段的订单」：`WHERE create_time BETWEEN ? AND ?`
- 5% 查询是管理后台的复杂查询

**分片策略设计：**

```yaml
tables:
  t_order:
    # 按 user_id 分库，同一用户的数据在同一库
    actualDataNodes: ds_${user_id % 2}.t_order_${user_id % 32}
    
    databaseStrategy:
      standard:
        shardingColumn: user_id
        shardingAlgorithmName: database_inline
        
    tableStrategy:
      standard:
        shardingColumn: user_id
        shardingAlgorithmName: table_inline
        
    shardingAlgorithms:
      database_inline:
        type: INLINE
        props:
          algorithm-expression: ds_${user_id % 2}
      table_inline:
        type: INLINE
        props:
          algorithm-expression: t_order_${user_id % 32}
```

**容量计算：**

- 2 个库 × 32 张表 = 64 个分片
- 单表容量：10亿 / 64 ≈ 1562 万（安全范围内）
- 最大支持：5 亿用户 × 每人 2 张表（不用担心，哈希均匀）

**时间维度的补充：**

对于时间范围查询，可以考虑**二级路由**：

```java
// 先按 user_id 定位库，再用时间过滤表
List<String> tables = new ArrayList&lt;&gt;();
for (int i = 0; i < 32; i++) {
    // 跳过不在时间范围内的表
    if (isInRange(i, startTime, endTime)) {
        tables.add("t_order_" + i);
    }
}
```

## 总结

分片策略的选择，没有银弹：

| 算法 | 适用场景 | 不适用场景 |
|-----|---------|-----------|
| 哈希分片 | 查询带分片键、数据均匀 | 范围查询、扩容困难 |
| 范围分片 | 时间序列查询 | 数据不均匀、热点问题 |
| 复合分片 | 特殊业务需求 | 大多数场景（慎用） |

选分片键的核心原则是：**让最频繁的查询命中精准路由**。

## 面试追问

- **为什么深分页在分库分表后性能很差？** 因为需要从每个分片取 N×分片数 条数据，内存排序后再返回。需要设计游标分页（基于 ID）或禁止深度翻页。
- **扩容时数据迁移怎么做？** 可以使用 ShardingSphere 的弹性迁移功能，或者设计双写双读策略（老数据写老库，新数据写新库，灰度迁移）。

下篇文章，我们来聊聊读写分离配置——主库写、从库读，怎么配置才合理？
