# 全局递增 ID 在分库分表中的实现

分库分表后，最让人头疼的问题是什么？

不是 SQL 怎么写，不是跨库查询怎么办。

而是——**ID 怎么生成**。

## 分库分表后 ID 的问题

在单机数据库下，ID 生成很简单：

```sql
CREATE TABLE orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  ...
);
```

`AUTO_INCREMENT` 帮我们解决了所有问题。

但分库分表后：

```yaml
orders_0:
  id = 1
  id = 2
  id = 3

orders_1:
  id = 1  # 冲突！
  id = 2  # 冲突！
  id = 3  # 冲突！
```

如果每个表都用 `AUTO_INCREMENT`，不同表的 ID 会重复。

如果全局用一张表生成 ID，**这个表就成了单点瓶颈**。

## 全局 ID 生成方案

### 方案一：号段模式

核心思想：**不要一个一个生成，一次取一批**。

```
表结构：
┌────────────┬─────────┐
│  max_id   │  step   │
├────────────┼─────────┤
│   1000     │   1000  │
└────────────┴─────────┘
```

原理：
1. 应用从 ID 表取 `max_id = 1000, step = 1000`
2. 本地生成 `[1001, 2000]` 的 ID
3. 用完后，再从表里取下一批

```java
@Service
public class IdGeneratorService {

    private Long currentMaxId = 0L;
    private Long step = 1000L;
    private Long currentId = 0L;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    public synchronized Long nextId() {
        if (currentId >= currentMaxId) {
            // 从数据库获取新的号段
            currentMaxId = fetchNewSegment();
            currentId = currentMaxId - step;
        }
        return ++currentId;
    }

    private Long fetchNewSegment() {
        // 原子更新：UPDATE + SELECT
        jdbcTemplate.execute("UPDATE id_generator SET max_id = max_id + " + step);
        Long newMaxId = jdbcTemplate.queryForObject(
            "SELECT max_id FROM id_generator", Long.class);
        return newMaxId;
    }
}
```

### 号段模式的优化：双 Buffer

单号段的问题是：**号段用完时，需要等待从数据库获取新号段**。

双 Buffer 的优化：**一个 Buffer 用到一半时，异步加载下一个号段**。

```java
@Service
public class IdGeneratorService {

    private volatile Long currentMaxId = 0L;
    private volatile Long nextMaxId = 0L;
    private volatile Long currentId = 0L;
    private volatile boolean loading = false;

    public synchronized Long nextId() {
        if (currentId >= currentMaxId) {
            // 触发加载下一个号段
            loadNextSegment();
        }
        return ++currentId;
    }

    private void loadNextSegment() {
        if (loading) return;
        loading = true;

        // 异步加载（实际实现需要线程安全）
        nextMaxId = fetchNewSegment();

        loading = false;
    }
}
```

### 方案二：雪花算法

雪花算法（Snowflake）是 Twitter 开源的分布式 ID 生成算法：

```
64 bits：
┌─────────────────────────────────────────────┐
│  符号位  │   时间戳 (41 bits)   │  机器ID  │ 序列号  │
│  (1 bit)│   (当前时间-基准)    │ (10 bits)│ (12 bits)│
└─────────────────────────────────────────────┘
```

- **时间戳**：毫秒级，可以用 69 年
- **机器 ID**：支持 1024 个节点
- **序列号**：每毫秒每个节点可生成 4096 个 ID

```java
public class SnowflakeIdGenerator {

    private final long twepoch = 1609459200000L;  // 2021-01-01
    private final long workerIdBits = 10L;
    private final long sequenceBits = 12L;
    private final long maxWorkerId = ~(-1L << workerIdBits);

    private final long workerId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;

    public SnowflakeIdGenerator(long workerId) {
        this.workerId = workerId;
    }

    public synchronized long nextId() {
        long timestamp = timeGen();

        if (timestamp < lastTimestamp) {
            throw new RuntimeException("Clock moved backwards");
        }

        if (lastTimestamp == timestamp) {
            sequence = (sequence + 1) & ((1 << sequenceBits) - 1);
            if (sequence == 0) {
                timestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = timestamp;

        return ((timestamp - twepoch) << (workerIdBits + sequenceBits))
            | (workerId << sequenceBits)
            | sequence;
    }

    private long tilNextMillis(long lastTimestamp) {
        long timestamp = timeGen();
        while (timestamp <= lastTimestamp) {
            timestamp = timeGen();
        }
        return timestamp;
    }

    private long timeGen() {
        return System.currentTimeMillis();
    }
}
```

### 方案三：UUID

最简单但不推荐的方案：

```java
String uuid = UUID.randomUUID().toString();
// 优点：简单
// 缺点：无序、太长（36字符）、无法排序
```

## 分库分表中间件

### ShardingSphere

ShardingSphere 是分库分表的主流中间件：

```yaml
spring:
  shardingsphere:
    datasource:
      ds:
        - &default-ds
          url: jdbc:mysql://localhost:3306/orders_0
          username: root
          password: root
        - &ds_1
          url: jdbc:mysql://localhost:3306/orders_1
    rules:
      sharding:
        tables:
          orders:
            actualDataNodes: ds_0.orders_0, ds_1.orders_1
            tableStrategy:
              standard:
                shardingColumn: user_id
                shardingAlgorithmName: orders_inline
            keyGenerateStrategy:
              column: id
              keyGeneratorName: snowflake
```

### ShardingSphere + 雪花算法

```java
@Configuration
public class ShardingConfig {

    @Bean
    public KeyGenerateStrategyConfiguration idKeyConfig() {
        // 配置雪花算法
        PropertiesProperties props = new Properties();
        props.setProperty("worker-id", "1");
        return new KeyGenerateStrategyConfiguration("id", "snowflake", props);
    }
}
```

## 分片键选择

分片键的选择直接影响查询性能：

- **好的分片键**：ID、用户 ID、时间戳（查询条件明确）
- **坏的分片键**：状态、类型（分布不均匀）

```java
// 按用户 ID 分片，查询某用户的订单很高效
String sql = "SELECT * FROM orders WHERE user_id = ?";

// 按状态分片，查询"待支付"订单需要跨所有分片
String sql = "SELECT * FROM orders WHERE status = 'PENDING'";
```

## 面试追问方向

- 雪花算法时钟回拨怎么办？（答：等待、拒绝、或用上一个 Sequence）
- 号段模式和雪花算法对比？（答：号段需要数据库支持，雪花算法不依赖；号段需要额外处理并发，雪花算法有 Sequence）
- 分库分表后如何做分页查询？（答：Scatter-Gather，并行查询所有分片后聚合）
- 分库分表后如何做跨库 JOIN？（答：绑定表广播、单库内 JOIN、或放弃 JOIN）

## 小结

分库分表后的 ID 生成是经典问题：

1. **号段模式**：批量取 ID，性能好，需要数据库支持
2. **雪花算法**：不依赖外部组件，需要处理时钟问题
3. **UUID**：简单但不推荐（无序、太长）

选型建议：

- 小规模（几百 T 数据）：雪花算法足够
- 大规模或需要趋势递增：号段模式
- 不想自己实现：直接用 ShardingSphere + 内置 ID 生成器
