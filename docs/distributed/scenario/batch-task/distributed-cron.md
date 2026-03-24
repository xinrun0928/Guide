# 定时任务的分布式化：广播模式与分片模式

单机定时任务很简单：

```java
@Scheduled(cron = "0 0 3 * * ?")
public void dailySettlement() {
    // 每天凌晨 3 点执行对账
}
```

但如果你有 10 台服务器，每台都执行这个定时任务，对账结果会重复 10 份。

这就是定时任务分布式化的原因。

## 为什么定时任务需要分布式化

### 单机定时任务的问题

```
服务器 1: @Scheduled → 执行对账 → 生成报表
服务器 2: @Scheduled → 执行对账 → 生成报表  (重复！)
服务器 3: @Scheduled → 执行对账 → 生成报表  (重复！)
```

问题：
1. **任务重复执行**：多台机器执行同一个任务
2. **无法协同**：各节点独立执行，无法共享状态
3. **资源浪费**：多台机器做同样的工作

## 广播模式

广播模式是**所有节点都执行同一个任务**。

### 适用场景

- 每个节点都需要执行的任务
- 任务之间相互独立
- 例如：清理本地缓存、日志上报、健康检查

### ElasticJob 广播模式

```java
public class CacheCleanJob implements SimpleJob {

    @Override
    public void execute(ShardingContext context) {
        // 所有节点都会执行这段代码
        log.info("清理本地缓存，当前节点: {}",
            context.getShardingParameter());

        // 清理本地缓存
        localCache.clear();
    }
}

@Configuration
public class JobConfig {

    @Bean
    public JobScheduler cacheCleanJobScheduler(RegistryCenter regCenter) {
        JobConfiguration config = new JobConfiguration();
        config.setJobName("cacheCleanJob");
        config.setJobClass(CacheCleanJob.class);
        config.setShardingTotalCount(1);  // 不分片，所有节点都执行
        config.setShardingStrategyClass("");  // 空表示广播模式
        config.setCron("0 0 2 * * ?");

        return new JobScheduler(regCenter, config);
    }
}
```

## 分片模式

分片模式是**多个节点各执行一部分任务**。

### 适用场景

- 大任务需要并行加速
- 每个分片的任务不同
- 例如：数据迁移、报表生成、批量处理

### 分片广播模式

分片广播 = 分片 + 广播。每个节点获取自己的分片，但每个分片都要执行。

```java
public class DataMigrationJob implements ElasticJob {

    @Override
    public void execute(ShardingContext context) {
        int shardingItem = context.getShardingItem();
        String shardingParameter = context.getShardingParameter();

        log.info("开始数据迁移，分片: {}, 参数: {}",
            shardingItem, shardingParameter);

        // 执行分片任务
        switch (shardingItem) {
            case 0:
                migrateRegion("华北");
                break;
            case 1:
                migrateRegion("华东");
                break;
            case 2:
                migrateRegion("华南");
                break;
        }
    }
}

@Configuration
public class JobConfig {

    @Bean
    public JobScheduler dataMigrationJobScheduler(RegistryCenter regCenter) {
        JobConfiguration config = new JobConfiguration();
        config.setJobName("dataMigrationJob");
        config.setJobClass(DataMigrationJob.class);
        config.setShardingTotalCount(3);  // 分成 3 个分片
        config.setCron("0 0 3 * * ?");

        // 分配分片参数
        config.getShardingStrategyParameters()
            .put("0=华北,1=华东,2=华南");

        return new JobScheduler(regCenter, config);
    }
}
```

## 任务调度的三大问题

### 问题一：任务重复执行

**分布式锁 + 状态检查**

```java
public class SafeJob implements ElasticJob {

    @Override
    public void execute(ShardingContext context) {
        String taskId = context.getJobName() + ":" + context.getShardingItem();

        // 尝试获取锁
        if (!lockService.tryLock(taskId)) {
            log.info("未获取到锁，跳过执行");
            return;
        }

        try {
            // 再次检查状态
            if (jobStateService.isRunning(taskId)) {
                log.info("任务正在执行，跳过");
                return;
            }

            // 执行业务逻辑
            doJob(context);
        } finally {
            lockService.unlock(taskId);
        }
    }
}
```

### 问题二：任务漏执行

**补偿机制 + 监控告警**

```java
@Service
public class JobMonitorService {

    @Autowired
    private JobMapper jobMapper;

    @Scheduled(fixedRate = 60000)
    public void checkMissedJobs() {
        // 查询最近 5 分钟应该执行但未执行的任务
        List&lt;JobRecord&gt; missedJobs = jobMapper.findMissedJobs(
            new Date(System.currentTimeMillis() - 5 * 60 * 1000)
        );

        for (JobRecord job : missedJobs) {
            // 发送告警
            alertService.send("任务漏执行: " + job.getJobName());

            // 触发补偿执行
            scheduler.triggerJob(job.getJobName());
        }
    }
}
```

### 问题三：任务超时

**超时监控 + 中断机制**

```java
public class TimeoutJob implements ElasticJob {

    private static final long TIMEOUT_MS = 30 * 60 * 1000;  // 30 分钟

    @Override
    public void execute(ShardingContext context) {
        String taskId = context.getJobName() + ":" + context.getShardingItem();

        Future&lt;?&gt; future = executor.submit(() -> {
            doJob(context);
        });

        try {
            future.get(TIMEOUT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException e) {
            // 超时了，中断任务
            future.cancel(true);

            // 记录超时
            jobStateService.markTimeout(taskId);

            // 发送告警
            alertService.send("任务执行超时: " + taskId);
        }
    }
}
```

## 面试追问方向

- 广播模式和分片模式的区别？（答：广播所有节点都执行，分片每个节点执行一部分）
- 如何保证任务不重复执行？（答：分布式锁 + 状态检查）
- 任务超时怎么处理？（答：中断任务、记录超时、触发重试）
- 分布式定时任务框架有哪些？（答：ElasticJob、XXL-JOB、PowerJob、Quartz）

## 小结

定时任务的分布式化需要解决三大问题：

1. **不重复执行**：分布式锁 + 乐观锁
2. **不漏执行**：补偿机制 + 监控告警
3. **不超时执行**：超时监控 + 中断机制

选择合适的任务分发模式（广播或分片），是分布式任务调度的第一步。
