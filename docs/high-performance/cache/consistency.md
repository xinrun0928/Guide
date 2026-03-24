# 缓存与数据库双写一致性：延时双删 + 订阅 binlog

你更新了商品价格，但用户看到的还是旧价格。

你去查数据库，明明已经改了。

问题在哪？

**缓存和数据库，数据不一致了。**

双写一致性，是分布式系统中永恒的难题。

---

## 先理解一个根本问题

**缓存和数据库，谁是「主」？**

这个问题决定了你要采用什么一致性策略：

| 角色 | 含义 | 策略 |
|------|------|------|
| **Cache As Data** | 缓存即数据源 | 先写缓存，后写数据库 |
| **DB As Data** | 数据库即数据源 | 先写数据库，后写缓存 |

大多数业务场景采用 **DB As Data**（Cache Aside 模式），因为：
- 数据库有事务保障，强一致
- 缓存无事务，只能作为加速层

---

## 一致性的四个级别

| 级别 | 描述 | 实现难度 |
|------|------|----------|
| **强一致性** | 任何时刻，缓存和数据库完全一致 | 极高 |
| **最终一致性** | 允许短暂不一致，但最终一致 | 中等 |
| **弱一致性** | 不保证什么时候一致 | 低 |
| **因果一致性** | 相关的操作最终一致 | 中等 |

对于大部分业务，**最终一致性**就足够了。

---

## 方案一：延时双删

### 核心思想

先删除缓存，再更新数据库，最后**延时再删一次缓存**。

```
写操作流程：
1. DELETE cache
2. UPDATE db
3. (延时 N 毫秒) DELETE cache
```

为什么要延时再删？因为要覆盖「读旧数据回填缓存」的时间窗口。

### 图解

```
时刻 T1：线程 A 需要更新 user:1001 的 name 为 "张三"

T1: 线程 A DELETE cache（删除旧缓存）
T2: 线程 B GET user:1001 → 缓存未命中
T3: 线程 A UPDATE db（name = "张三"）
T4: 线程 B GET from DB → 返回 "张三"
T5: 线程 A DELETE cache（延时删除，覆盖 T2-T4 的回填）
T6: 线程 C GET user:1001 → 缓存未命中 → 查 DB → "张三" ✓

结果：数据一致
```

### 代码实现

```java
public class DelayDoubleDeleteCacheService {
    
    private static final int DELAY_DELETE_MS = 500;  // 延时 500ms
    private static final int RETRY_TIMES = 3;         // 重试次数
    
    @Transactional
    public void updateUser(User user) {
        String cacheKey = "user:" + user.getId();
        
        // 1. 先删除缓存
        redisTemplate.delete(cacheKey);
        
        // 2. 更新数据库
        userDao.updateById(user);
        
        // 3. 延时再删除缓存（异步）
        CompletableFuture.runAsync(() -&gt; {
            try {
                Thread.sleep(DELAY_DELETE_MS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            
            // 重试机制，防止删除失败
            for (int i = 0; i &lt; RETRY_TIMES; i++) {
                try {
                    redisTemplate.delete(cacheKey);
                    break;
                } catch (Exception e) {
                    log.warn("延时删除缓存失败，第 {} 次重试", i + 1, e);
                }
            }
        });
    }
}
```

### 延时双删的问题

✅ **优点**：
- 实现相对简单
- 覆盖了大部分并发场景

❌ **缺点**：
- 延时时间不好确定（太长影响实时性，太短可能覆盖不了）
- 并发更新同一 key 时，可能有问题
- 分布式环境下，延时删除和更新可能不按预期顺序执行

### 延时时间怎么定？

```java
// 延时时间的经验值：
// - 单机环境：300-500ms
// - 分布式环境：500-1000ms
// - 网络延迟高：1000-2000ms

// 更精确的估算：
// 延时 = 最大查询耗时 + 网络往返时间 × 2
private int calculateDelayMs() {
    long maxQueryTime = 50;      // 最大查询耗时 50ms
    long networkRtt = 100;        // 网络往返 100ms
    return (int) (maxQueryTime + networkRtt * 2);  // 250ms
}
```

---

## 方案二：订阅 binlog

### 核心思想

把数据库变更记录当成「消息源」，通过订阅 binlog 来更新缓存。

```
数据库变更 → binlog → Canal/Maxwell → 消息队列 → 缓存更新服务 → Redis
```

### 为什么更好？

1. **解耦**：数据库和缓存完全解耦
2. **可靠**：binlog 是数据库已提交的变更，不会丢
3. **实时**：几乎无延迟
4. **幂等**：可以重复消费

### Canal 工作原理

Canal 是阿里巴巴开源的 MySQL binlog 增量订阅组件：

```
MySQL 主库
    ↓ 写入
binlog 文件
    ↓ Canal 解析
解析后的变更事件
    ↓ 发送到
MQ（Kafka/RocketMQ）
    ↓ 消费
缓存更新服务 → 更新 Redis
```

### Canal + Redis 实现

#### 1. 配置 Canal Server

```yaml
# canal.properties
canal.serverMode = kafka
kafka.bootstrap.servers = localhost:9092
kafka.topic = binlog_product
kafka.partition.hash.topic = mytest1
```

#### 2. 定义 binlog 消息格式

```java
// Canal 发送的消息格式
public class BinlogMessage {
    private String tableName;      // 表名
    private String eventType;      // INSERT/UPDATE/DELETE
    private List&lt;Column&gt; before;   // 变更前的数据
    private List&lt;Column&gt; after;   // 变更后的数据
    
    @Data
    public static class Column {
        private String name;
        private String value;
        private String type;
        private boolean updated;  // 是否被更新
    }
}
```

#### 3. 缓存更新服务

```java
@Service
public class BinlogCacheSyncService {
    
    @Autowired
    private KafkaConsumer&lt;BinlogMessage&gt; kafkaConsumer;
    
    @Autowired
    private RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    @PostConstruct
    public void init() {
        kafkaConsumer.subscribe("binlog_product");
        
        // 启动消费者
        new Thread(() -&gt; {
            while (true) {
                ConsumerRecords&lt;BinlogMessage&gt; records = kafkaConsumer.poll(Duration.ofSeconds(1));
                
                for (ConsumerRecord&lt;BinlogMessage&gt; record : records) {
                    processMessage(record.value());
                }
            }
        }).start();
    }
    
    private void processMessage(BinlogMessage message) {
        String tableName = message.getTableName();
        String eventType = message.getEventType();
        
        if ("product".equals(tableName)) {
            switch (eventType) {
                case "INSERT":
                    handleInsert(message);
                    break;
                case "UPDATE":
                    handleUpdate(message);
                    break;
                case "DELETE":
                    handleDelete(message);
                    break;
            }
        }
    }
    
    private void handleInsert(BinlogMessage message) {
        // 获取变更后的数据
        Map&lt;String, String&gt; afterData = extractColumns(message.getAfter());
        String productId = afterData.get("id");
        String cacheKey = "product:" + productId;
        
        // 查询完整数据并写入缓存
        Product product = productDao.selectById(Long.parseLong(productId));
        if (product != null) {
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
        }
    }
    
    private void handleUpdate(BinlogMessage message) {
        // 获取变更后的数据
        Map&lt;String, String&gt; afterData = extractColumns(message.getAfter());
        String productId = afterData.get("id");
        String cacheKey = "product:" + productId;
        
        // 查询完整数据并更新缓存
        Product product = productDao.selectById(Long.parseLong(productId));
        if (product != null) {
            redisTemplate.opsForValue().set(cacheKey, product, 1, TimeUnit.HOURS);
        } else {
            // 数据被删除，删除缓存
            redisTemplate.delete(cacheKey);
        }
    }
    
    private void handleDelete(BinlogMessage message) {
        // 获取变更前的数据
        Map&lt;String, String&gt; beforeData = extractColumns(message.getBefore());
        String productId = beforeData.get("id");
        String cacheKey = "product:" + productId;
        
        // 删除缓存
        redisTemplate.delete(cacheKey);
    }
    
    private Map&lt;String, String&gt; extractColumns(List&lt;BinlogMessage.Column&gt; columns) {
        Map&lt;String, String&gt; result = new HashMap&lt;&gt;();
        for (BinlogMessage.Column col : columns) {
            result.put(col.getName(), col.getValue());
        }
        return result;
    }
}
```

### binlog 同步的优缺点

✅ **优点**：
- 可靠性高（基于 binlog，不会丢数据）
- 实时性好（几乎无延迟）
- 应用层完全解耦
- 可以支持多个消费者（同步多个缓存、搜索引擎等）

❌ **缺点**：
- 架构复杂（需要部署 Canal、Kafka 等组件）
- 延时性（binlog → Kafka → 消费，最快也是毫秒级）
- 不支持跨库事务

---

## 方案三：直接解析 binlog（ogg / debezium）

对于不想引入 Kafka 的场景，可以用 **Debezium** 直接连接数据库：

```java
// Debezium Embedded 模式
public class DebeziumCacheSyncService {
    
    public void startSync() {
        Configuration config = Configuration.create()
            .with("connector.class", "io.debezium.connector.mysql.MySqlConnector")
            .with("database.hostname", "localhost")
            .with("database.port", "3306")
            .with("database.user", "debezium")
            .with("database.password", "password")
            .with("database.server.id", "184054")
            .with("database.server.name", "dbserver1")
            .with("table.include.list", "shop.product")
            .with("topic.prefix", "dbserver1")
            .build();
        
        EmbeddedEngine engine = EmbeddedEngine.create()
            .using(config)
            .notifying(this::handleChangeEvent)
            .build();
        
        Executors.newSingleThreadExecutor().submit(engine);
    }
    
    private void handleChangeEvent(SourceRecords records) {
        for (SourceRecord record : records) {
            // 处理变更事件
            // 更新 Redis
        }
    }
}
```

---

## 四种方案对比

| 方案 | 一致性 | 实时性 | 复杂度 | 可靠性 |
|------|--------|--------|--------|--------|
| Cache Aside | 最终一致 | 高 | 低 | 中 |
| 延时双删 | 最终一致 | 高 | 中 | 中 |
| binlog 订阅 | 最终一致 | 中 | 高 | 高 |
| 同步双写 | 强一致 | 最高 | 中 | 低 |

---

## 实战：混合一致性方案

```java
public class HybridCacheConsistencyService {
    
    // 核心数据：使用 binlog 同步（高可靠）
    // 一般数据：使用延时双删（实时性好）
    
    private static final Set&lt;String&gt; CORE_TABLES = Set.of(
        "product", "sku", "price", "stock"
    );
    
    @Transactional
    public void updateData(String tableName, Object data) {
        if (CORE_TABLES.contains(tableName)) {
            // 核心数据：直接删除缓存，让 binlog 同步来更新
            deleteCache(tableName, data);
            // 不用延时双删，依赖 binlog 保证一致性
        } else {
            // 一般数据：延时双删
            delayDoubleDelete(tableName, data);
        }
    }
    
    private void deleteCache(String tableName, Object data) {
        String cacheKey = buildCacheKey(tableName, data);
        redisTemplate.delete(cacheKey);
        // 依赖 binlog 异步更新
    }
    
    private void delayDoubleDelete(String tableName, Object data) {
        String cacheKey = buildCacheKey(tableName, data);
        
        // 1. 先删除
        redisTemplate.delete(cacheKey);
        
        // 2. 更新数据库
        updateDb(tableName, data);
        
        // 3. 延时再删除
        CompletableFuture.runAsync(() -&gt; {
            try {
                Thread.sleep(500);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            redisTemplate.delete(cacheKey);
        });
    }
}
```

---

## 最终一致性 vs 强一致性

### 什么场景需要强一致性？

- **金融交易**：账户余额、交易流水
- **库存扣减**：不能超卖
- **订单状态**：不能出现矛盾状态

### 什么场景用最终一致性就够了？

- **商品信息**：价格、描述更新
- **用户信息**：昵称、头像
- **配置信息**：系统参数

---

## 总结

缓存与数据库一致性是分布式系统的永恒难题：

| 方案 | 适用场景 | 推荐度 |
|------|----------|--------|
| Cache Aside | 一般业务，读多写少 | ⭐⭐⭐⭐ |
| 延时双删 | 中小规模系统 | ⭐⭐⭐⭐ |
| binlog 订阅 | 大规模系统，核心数据 | ⭐⭐⭐⭐⭐ |
| 同步双写 | 不推荐 | ⭐ |

**最佳实践**：
- 核心数据用 binlog 同步
- 一般数据用延时双删
- 对一致性要求极高的数据，不要用缓存

---

## 留给你的问题

假设这样一个场景：你的电商系统有**商品价格**和**用户等级折扣**两个维度：

- 商品价格可能随时变化（运营调价）
- 用户等级折扣可能随时变化（会员权益调整）

用户最终看到的商品价格 = 商品价格 × (1 - 折扣率)

请思考：
1. 商品价格和用户折扣分别存在不同的表，用 binlog 同步时应该怎么处理？
2. 如果用户正在浏览商品时，商品价格和折扣同时变了，如何保证他看到的价格计算是正确的？
3. 是否需要引入**分布式事务**来保证一致性？还是最终一致性就够了？

提示：可以考虑「读写分离 + 版本号」方案。
