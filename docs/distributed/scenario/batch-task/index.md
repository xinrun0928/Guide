# 分布式批量任务框架设计：分片任务与结果聚合

想象一下这个场景：

你需要处理 1000 万条数据迁移，从旧数据库迁移到新数据库。

单机处理需要 10 小时，但业务只给了你 2 小时的窗口期。

怎么办？

分布式批量任务。

## 分布式批处理的场景

- **数据迁移**：旧系统到新系统的数据迁移
- **对账**：日终交易对账，批量校验数据一致性
- **报表生成**：日、周、月报表的批量计算
- **数据清洗**：ETL 过程中的数据清洗和转换

这些场景的共同特点是：**数据量大，需要并行加速**。

## 分片任务的核心思想

分片任务的核心是**将大任务拆分为多个小任务，并行处理**。

```
原始任务：处理 1000 万条数据
拆分后：
  分片 1: 处理 0-250 万条
  分片 2: 处理 250-500 万条
  分片 3: 处理 500-750 万条
  分片 4: 处理 750-1000 万条

4 个节点并行处理 → 时间缩短到 2.5 小时
```

## 分片策略

### Hash 分片

根据某个字段 hash 取模：

```java
public int calculateShard(String key, int shardCount) {
    return Math.abs(key.hashCode()) % shardCount;
}
```

### 范围分片

按时间或 ID 范围分段：

```java
public List&lt;ShardRange&gt; calculateRangeShards(long startId, long endId, int shardCount) {
    long range = endId - startId;
    long step = range / shardCount;

    List&lt;ShardRange&gt; shards = new ArrayList&lt;&gt;();
    for (int i = 0; i < shardCount; i++) {
        shards.add(new ShardRange(
            startId + i * step,
            startId + (i + 1) * step - 1
        ));
    }
    return shards;
}
```

### 固定分片

任务列表平均分配：

```java
public List&lt;Task&gt; distributeTasks(List&lt;Task&gt; tasks, int shardCount) {
    List&lt;List&lt;Task&gt;&gt; shards = new ArrayList&lt;&gt;();
    for (int i = 0; i < shardCount; i++) {
        shards.add(new ArrayList&lt;&gt;());
    }

    for (int i = 0; i < tasks.size(); i++) {
        shards.get(i % shardCount).add(tasks.get(i));
    }

    return shards;
}
```

## 分布式任务框架

### ElasticJob

ElasticJob 是当当网开源的分布式任务框架：

```java
// 引入依赖
// <dependency>
//     <groupId>com.dangdang</groupId>
//     <artifactId>elastic-job-lite-core</artifactId>
//     <version>2.1.5</version>
// </dependency>

public class MyJob implements SimpleJob {

    @Override
    public void execute(ShardingContext context) {
        // 获取当前分片
        int shardingItem = context.getShardingItem();

        // 获取分片参数
        String shardingParameter = context.getShardingParameter();

        // 处理分片任务
        switch (shardingItem) {
            case 0:
                processData("region_0");
                break;
            case 1:
                processData("region_1");
                break;
            case 2:
                processData("region_2");
                break;
        }
    }

    private void processData(String region) {
        log.info("处理 {} 区域数据", region);
        // 具体业务逻辑
    }
}
```

### 配置分片

```java
@Configuration
public class ElasticJobConfig {

    @Bean
    public JobScheduler jobScheduler(JobRegistryCenter regCenter) {
        JobConfiguration config = new JobConfiguration();
        config.setJobName("myDataMigrationJob");
        config.setShardingTotalCount(3);  // 分成 3 个分片
        config.setJobClass(MyJob.class);
        config.setShardingStrategyClass(CenterOrderlyShardingStrategy.class);
        config.setCron("0 0 2 * * ?");  // 每天凌晨 2 点执行

        return new JobScheduler(regCenter, config);
    }
}
```

## 结果聚合

每个分片处理完成后，需要汇总结果：

```java
public class AggregationJob implements SimpleJob {

    private Map&lt;String, Integer&gt; resultMap = new ConcurrentHashMap&lt;&gt;();

    @Override
    public void execute(ShardingContext context) {
        int shardingItem = context.getShardingItem();

        // 处理分片
        int processedCount = processShard(shardingItem);

        // 上报结果
        reportResult(shardingItem, processedCount);
    }

    // 分片监听器，聚合结果
    @ElasticJobConfig(shardingListenerClass = ResultAggregationListener.class)
    public static class ResultAggregationListener extends AbstractJobExecutionEventListener {

        @Override
        public void onJobExecutionEvent(JobExecutionEvent event) {
            if (event.getShardingItem() >= 0) {
                // 收集分片结果
                Map&lt;String, Object&gt; data = event.getData();
                aggregateResult(data);
            }
        }
    }

    private void aggregateResult(Map&lt;String, Object&gt; data) {
        log.info("聚合结果: {}", data);
    }
}
```

## 面试追问方向

- 分片数怎么设置？（答：通常设置为节点数的倍数，便于负载均衡）
- 分片任务失败怎么办？（答：重试、标记失败、补偿处理）
- 如何保证分片均匀？（答：按 ID 范围或 Hash 分片，避免数据倾斜）
- 分片任务和普通定时任务的区别？（答：分片任务可以并行加速，普通任务只能单机执行）

## 小结

分布式批量任务是处理大数据量的有效手段：

1. **分片**：将大任务拆分为多个小任务
2. **并行**：多节点并行处理，提高效率
3. **聚合**：收集各分片结果，汇总输出
4. **框架**：ElasticJob、XXL-JOB 等框架简化了实现

选择合适的分片策略，是分布式批处理的关键。
