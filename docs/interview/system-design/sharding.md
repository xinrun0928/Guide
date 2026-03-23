# 数据库读写分离与分库分表设计

双十一零点，你盯着监控大屏，看着数据库 CPU 从 30% 一路飙到 100%。

你心想：完了。

这不是故事，这是真实发生过的。每年双十一前夕，都有无数工程师在扩容、加机、优化 SQL。但数据库的瓶颈，往往不是靠优化能解决的。

这时候，你需要分库分表。

## 什么时候需要分库分表？

不是数据量大就得分库分表。

**判断标准**：
- 单表数据量超过 500 万条
- 单库 QPS 超过 1 万
- 磁盘空间告急
- 主从延迟影响业务

如果只是数据量大，但 QPS 不高，可以先考虑归档历史数据、分库分表可以缓一缓。

## 读写分离：最简单的扩展方式

### 原理

```
写入 ──► Master ──► 同步 ──► Slave
                                     │
读取 ◄────────────────────────────────┘
```

写操作走主库，读操作走从库。通过 binlog 异步同步数据。

### MySQL 主从配置

```java
// 应用层的读写分离配置
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource master() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://master:3306/db");
        config.setUsername("root");
        config.setPassword("xxx");
        return new HikariDataSource(config);
    }

    @Bean
    public DataSource slave() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://slave:3306/db");
        config.setUsername("root");
        config.setPassword("xxx");
        // 从库允许一定延迟，允许偶尔读取旧数据
        config.setReadOnly(true);
        return new HikariDataSource(config);
    }
}

// 读写分离路由策略
public class ReadWriteRoutingDataSource extends AbstractRoutingDataSource {
    private static final ThreadLocal<Boolean> READ_ONLY = new ThreadLocal<>();

    public static void setReadOnly() {
        READ_ONLY.set(true);
    }

    public static void setWritable() {
        READ_ONLY.set(false);
    }

    public static void clear() {
        READ_ONLY.remove();
    }

    @Override
    protected Object determineCurrentLookupKey() {
        // 写操作返回主库 key，读操作返回从库 key
        // 为什么用 ThreadLocal？因为一次请求中可能先写后读
        return Boolean.TRUE.equals(READ_ONLY.get()) ? "slave" : "master";
    }
}
```

### 主从延迟问题

读写分离最大的坑：**主从延迟**。

用户下单后立刻查询订单，可能查不到（从库还没同步完）。

**解决方案**：
1. **强制读主库**：对一致性要求高的读操作，路由到主库
2. **延迟读取**：写操作后等待 N 秒再读取（不推荐，治标不治本）
3. **应用层补偿**：写入后返回写入结果，不依赖从库查询

## 垂直拆分：按业务拆分

### 按表拆分

把一个大表按字段拆分：

```sql
-- 用户表拆分为用户基础表 + 用户详情表
CREATE TABLE user (
    id BIGINT PRIMARY KEY,
    username VARCHAR(50),
    password VARCHAR(100),
    created_at DATETIME
);

CREATE TABLE user_profile (
    user_id BIGINT PRIMARY KEY,
    avatar VARCHAR(200),
    bio TEXT,
    -- 其他「重」字段
);
```

### 按库拆分

把不同业务模块的表放到不同数据库：

```
库1: 用户中心 (user, address, wallet)
库2: 订单中心 (order, order_item)
库3: 商品中心 (product, category, sku)
```

**好处**：减少单库压力，不同库可以独立扩容

**问题**：跨库查询困难，需要通过应用层聚合

## 水平拆分：真正的海量数据

垂直拆分解决的是「表太宽」的问题，水平拆分解决的是「数据太多」的问题。

### 分片策略

**按用户 ID 分片**：
```java
// 最常见的分片策略
int shardId = userId % shardingCount;
```

**按时间分片**：
```java
// 适合日志、订单等有时间属性的数据
// 按月分片：2024-01、2024-02...
String shardKey = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy-MM"));
```

**按哈希分片**：
```java
// 取模分片，但要用一致性哈希减少迁移
int shardId = consistentHash(key) % shardingCount;
```

### 分片后的查询

分片最大的问题：**跨分片查询**。

```java
// 问题：查询「所有用户中名字包含 '张' 的」
// 答案：需要扫描所有分片，效率极低

// 解决方案1：建立全局索引表
public class GlobalIndexService {
    // 用户名到 userId 的映射，按用户名做索引
    // 但要注意：全局索引表本身也需要分片

    public List<Long> searchByName(String name) {
        // 1. 先在索引表查询 userId 列表
        List<Long> userIds = globalNameIndex.query(name);

        // 2. 再根据 userId 查询用户详情（可并行）
        return userIds.stream()
            .map(userService::getUser)
            .filter(Objects::nonNull)
            .collect(Collectors.toList());
    }
}

// 解决方案2：异构索引表
// 每个分片都有自己的索引表，数据异构同步
public class IndexSyncService {
    // 当用户表写入时，同时更新各分片的索引表
    // 这样做的好处：索引查询在单分片完成
    public void syncUserToIndex(User user) {
        for (int i = 0; i < indexShardingCount; i++) {
            // 按姓名首字母路由到对应索引分片
            int indexShard = getNameShardIndex(user.getName());
            indexService.save(indexShard, user.getUserId(), user.getName());
        }
    }
}
```

## 分库分表中间件

业界成熟的方案：

| 中间件 | 公司 | 特点 |
|-------|-----|-----|
| ShardingSphere | 当当 | 功能全面，社区活跃 |
| MyCat | – | 老牌方案，配置复杂 |
| Vitess | YouTube | 支持在线扩容 |
| TiDB | PingCAP | NewSQL，自动分片 |

```java
// ShardingSphere 的使用示例
@Configuration
public class ShardingConfig {
    @Bean
    public DataSource dataSource() {
        // 数据源配置
        Map<String, DataSource> dataSources = createDataSources();

        // 分片规则配置
        ShardingRuleConfiguration ruleConfig = new ShardingRuleConfiguration();
        ruleConfig.getTableRuleConfigs().add(orderTableRule());
        ruleConfig.setDefaultDatabaseStrategy(new InlineShardingStrategyConfiguration(
            "user_id", "ds_${user_id % 2}"
        ));

        return DataSourceFactory.createDataSource(dataSources, ruleConfig);
    }

    private TableRuleConfiguration orderTableRule() {
        TableRuleConfiguration config = new TableRuleConfiguration();
        config.setLogicTable("t_order");
        config.setActualDataNodes("ds_${0..1}.t_order_${0..15}");

        // 为什么按 user_id 分片？因为订单查询通常按用户维度
        // 这样查询某个用户的订单时，只需要访问一个分片
        config.setDatabaseShardingStrategyConfig(
            new InlineShardingStrategyConfiguration("user_id", "ds_${user_id % 2}")
        );
        config.setTableShardingStrategyConfig(
            new InlineShardingStrategyConfiguration("order_id", "t_order_${order_id % 16}")
        );
        return config;
    }
}
```

## 扩容：最头疼的问题

分库分表最怕的就是扩容——数据迁移是个大工程。

**方案1：双写**
1. 新旧两套系统同时写入
2. 后台任务把历史数据迁移到新系统
3. 切换读流量
4. 旧系统下线

**方案2：一致性哈希 + 虚拟节点**
- 扩容时，只需要迁移相邻节点的数据
- 迁移量可控

**方案3：放弃分库分表**
- 如果数据量没到 PB 级别，先考虑用 TiDB/CockroachDB
- 它们帮你做了分片，你只需要关心业务

## 总结

数据库扩展的演进路径：

1. **先读写分离**：解决读压力
2. **再垂直拆分**：按业务拆分
3. **最后水平拆分**：按数据量拆分

记住：**过早优化是万恶之源，但等数据库崩了再优化是火葬场**。找准扩容的时机，比学会扩容的技术更重要。
