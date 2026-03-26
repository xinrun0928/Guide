# ElasticJob 作业监听器

你的任务失败了，但没有人知道。

直到第二天早上，用户反馈「为什么没收到报表」，你才发现问题。

ElasticJob 的监听器，就是来解决这个问题的——让任务执行状态可感知、可追踪。

## 两种监听器

ElasticJob 提供两种监听器：

```
┌─────────────────────────────────────────────────────────────┐
│                    两种监听器                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              ElasticJobListener                       │   │
│   │   作业级监听器，监听整个作业的执行                     │   │
│   │   · beforeJobExecuted()  作业执行前                  │   │
│   │   · afterJobExecuted()   作业执行后                  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │             ExecutionListener                         │   │
│   │   分片级监听器，监听每个分片的执行                     │   │
│   │   · beforeJobExecution()    分片执行前                │   │
│   │   · afterJobExecution()     分片执行后                │   │
│   │   · jobExecutionEvent()     执行事件                  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## ElasticJobListener：作业级监听

### 基本用法

```java
public class MyJobListener implements ElasticJobListener {
    
    private static final Logger logger = LoggerFactory.getLogger(
        MyJobListener.class
    );
    
    @Override
    public void beforeJobExecuted(ShardingContext shardingContext) {
        // 作业执行前调用
        logger.info("作业 [{}] 开始执行，分片数：{}",
            shardingContext.getJobName(),
            shardingContext.getShardingTotalCount());
        
        // 适合做：数据准备、资源初始化、开始计时
    }
    
    @Override
    public void afterJobExecuted(ShardingContext shardingContext, 
                                 ExecutionService executionService) {
        // 作业执行后调用（无论成功还是失败）
        logger.info("作业 [{}] 执行完成",
            shardingContext.getJobName());
        
        // 适合做：数据清理、状态更新、结果统计
    }
}

// 注册监听器
@Configuration
public class JobConfig {
    
    @Bean
    public SpringJobScheduler myJobScheduler(
            MyJob job,
            CoordinatorRegistryCenter regCenter,
            MyJobListener listener) {
        
        return new SpringJobScheduler(
            job,
            regCenter,
            new JobConfiguration()
                .setJobName("myJob")
                .setCron("0/10 * * * * ?")
                .addJobListeners(listener)  // 添加监听器
        );
    }
}
```

### 典型应用：性能监控

```java
public class PerformanceMonitorListener implements ElasticJobListener {
    
    private final MetricsService metricsService;
    
    public PerformanceMonitorListener(MetricsService metricsService) {
        this.metricsService = metricsService;
    }
    
    @Override
    public void beforeJobExecuted(ShardingContext shardingContext) {
        // 记录开始时间
        JobExecutionEvent startEvent = new JobExecutionEvent(
            System.currentTimeMillis(),
            JobExecutionEvent.ExecutionSource.BEFORE_EXECUTE,
            shardingContext.getShardingParameter()
        );
        metricsService.recordJobStart(startEvent);
    }
    
    @Override
    public void afterJobExecuted(ShardingContext shardingContext,
                                 ExecutionService executionService) {
        // 统计执行结果
        JobExecutionService jobExecutionService = executionService
            .getJobExecutionService();
        
        // 获取分片执行状态
        List&lt;ShardingContext&gt; shardingContexts = jobExecutionService
            .getShardingContexts();
        
        long successCount = shardingContexts.stream()
            .filter(s -> s.getStatus() == Status.SUCCESS)
            .count();
        
        long failedCount = shardingContexts.stream()
            .filter(s -> s.getStatus() == Status.FAILED)
            .count();
        
        // 上报监控指标
        metricsService.recordJobResult(
            shardingContext.getJobName(),
            successCount,
            failedCount
        );
    }
}
```

## ExecutionListener：分片级监听

### 基本用法

```java
public class MyExecutionListener implements ExecutionListener {
    
    private static final Logger logger = LoggerFactory.getLogger(
        MyExecutionListener.class
    );
    
    @Override
    public void beforeJobExecution(ShardingContexts shardingContexts) {
        // 每个分片执行前调用
        for (ShardingContext context : shardingContexts.getShardingContextList()) {
            logger.debug("分片 [{}] 即将执行", 
                context.getShardingItem());
        }
    }
    
    @Override
    public void afterJobExecution(ShardingContexts shardingContexts,
                                  ExecutionService executionService) {
        // 每个分片执行后调用
        for (ShardingContext context : shardingContexts.getShardingContextList()) {
            logger.debug("分片 [{}] 执行完成", 
                context.getShardingItem());
        }
    }
    
    @Override
    public void jobExecutionEvent(JobExecutionEvent event) {
        // 记录详细执行事件
        logger.info("执行事件：类型={}, 来源={}, 分片={}",
            event.getType(),
            event.getSource(),
            event.getShardingParameter());
    }
}
```

### 典型应用：数据追踪

```java
public class DataTracingListener implements ExecutionListener {
    
    private final TracingService tracingService;
    
    @Override
    public void jobExecutionEvent(JobExecutionEvent event) {
        // 记录每个分片的执行详情
        JobTrace trace = JobTrace.builder()
            .jobName(event.getJobName())
            .shardingParameter(event.getShardingParameter())
            .executionSource(event.getSource().name())
            .type(event.getType().name())
            .startTime(event.getStartTime())
            .endTime(event.getCompleteTime())
            .build();
        
        tracingService.save(trace);
    }
    
    @Override
    public void afterJobExecution(ShardingContexts shardingContexts,
                                  ExecutionService executionService) {
        // 分片全部完成后，更新批次状态
        String batchId = generateBatchId(shardingContexts);
        
        boolean allSuccess = shardingContexts.getShardingContextList()
            .stream()
            .allMatch(s -> s.getStatus() == Status.SUCCESS);
        
        batchService.completeBatch(batchId, allSuccess);
    }
}
```

## 事件追踪

ElasticJob 提供了完整的事件追踪机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    事件追踪架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   作业执行过程产生的事件                                       │
│                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │ 执行开始  │  │ 执行中   │  │ 执行成功  │  │ 执行失败  │   │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│        │              │              │              │         │
│        └──────────────┴──────────────┴──────────────┘         │
│                             │                                │
│                             ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              JobExecutionEvent                      │   │
│   │                                                     │   │
│   │   · jobName         作业名称                       │   │
│   │   · shardingParameter  分片参数                    │   │
│   │   · type             事件类型                      │   │
│   │   · source           触发来源                      │   │
│   │   · startTime        开始时间                      │   │
│   │   · completeTime     完成时间                      │   │
│   │   · success          是否成功                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                             │                                │
│                             ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              EventTracker                           │   │
│   │   事件追踪器，负责存储事件到数据库                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 配置事件追踪

```java
@Configuration
public class JobConfig {
    
    @Bean
    public EventTraceDataSource eventTraceDataSource() {
        // 使用单独的数据库存储事件
        return new EventTraceDataSource(
            "jdbc:mysql://localhost:3306/elasticjob_events"
        );
    }
}

// 事件表结构
// CREATE TABLE elastic_job_execution_log (
//     id BIGINT PRIMARY KEY AUTO_INCREMENT,
//     job_name VARCHAR(100) NOT NULL,
//     sharding_item VARCHAR(100),
//     execution_source VARCHAR(50),
//     event_type VARCHAR(50),
//     start_time DATETIME,
//     complete_time DATETIME,
//     is_success BOOLEAN,
//     failure_cause TEXT,
//     create_time DATETIME DEFAULT CURRENT_TIMESTAMP
// );
```

## 监听器链

可以添加多个监听器，形成监听器链：

```java
@Configuration
public class JobConfig {
    
    @Bean
    public SpringJobScheduler myJobScheduler(
            MyJob job,
            CoordinatorRegistryCenter regCenter) {
        
        JobConfiguration jobConfig = new JobConfiguration()
            .setJobName("myJob")
            .setCron("0/10 * * * * ?")
            // 添加多个监听器，按添加顺序执行
            .addJobListeners(
                new MetricsListener(),     // 1. 先记录指标
                new TracingListener(),      // 2. 再追踪数据
                new NotificationListener()  // 3. 最后发送通知
            );
        
        return new SpringJobScheduler(job, regCenter, jobConfig);
    }
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                    监听器链执行顺序                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   beforeJobExecuted()                                       │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │ MetricsListener │ → │TracingListener │ → │NotificationListener│
│   └─────────────┘  └─────────────┘  └─────────────┘       │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                  执行业务逻辑                         │  │
│   └─────────────────────────────────────────────────────┘  │
│        │                                                   │
│        ▼                                                   │
│   afterJobExecuted()                                        │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │NotificationListener │ ← │TracingListener │ ← │MetricsListener │
│   └─────────────┘  └─────────────┘  └─────────────┘       │
│        (倒序执行，确保通知在最后)                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 典型应用场景

### 1. 告警通知

```java
public class AlertListener implements ElasticJobListener {
    
    private final AlertService alertService;
    
    @Override
    public void beforeJobExecuted(ShardingContext shardingContext) {
        // 执行前不做任何操作
    }
    
    @Override
    public void afterJobExecuted(ShardingContext shardingContext,
                                 ExecutionService executionService) {
        // 获取执行结果
        JobExecutionService jobExecutionService = executionService
            .getJobExecutionService();
        
        // 检查是否有失败
        if (hasFailures(shardingContext)) {
            alertService.sendAlert(
                "作业执行失败",
                buildAlertMessage(shardingContext)
            );
        }
    }
    
    private boolean hasFailures(ShardingContext context) {
        // 实际实现中需要从 executionService 获取分片状态
        return context.getStatus() == Status.FAILED;
    }
    
    private String buildAlertMessage(ShardingContext context) {
        return String.format(
            "作业名称：%s\n" +
            "分片数：%d\n" +
            "失败分片：%s\n" +
            "触发时间：%s",
            context.getJobName(),
            context.getShardingTotalCount(),
            getFailedShards(context),
            LocalDateTime.now()
        );
    }
}
```

### 2. 分布式锁

```java
public class DistributedLockListener implements ElasticJobListener {
    
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    
    @Override
    public void beforeJobExecuted(ShardingContext shardingContext) {
        // 尝试获取分布式锁
        String lockKey = "job:lock:" + shardingContext.getJobName();
        Boolean acquired = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "locked", Duration.ofHours(1));
        
        if (!Boolean.TRUE.equals(acquired)) {
            // 没获取到锁，抛出异常终止执行
            throw new JobExecutionException(
                "无法获取分布式锁，作业可能在其他节点执行"
            );
        }
    }
    
    @Override
    public void afterJobExecuted(ShardingContext shardingContext,
                                 ExecutionService executionService) {
        // 释放分布式锁
        String lockKey = "job:lock:" + shardingContext.getJobName();
        redisTemplate.delete(lockKey);
    }
}
```

## 总结

| 监听器类型 | 作用域 | 典型用途 |
|---|---|---|
| ElasticJobListener | 作业级 | 日志记录、性能监控、告警通知 |
| ExecutionListener | 分片级 | 数据追踪、精细化监控 |

**监听器是扩展 ElasticJob 能力的重要手段**——善用监听器，让你的任务调度系统更加可控。

## 思考题

如果你需要在监听器中访问 Spring Bean，应该怎么做？

监听器实例是由谁创建的？如果直接在监听器中 `@Autowired`，会有什么后果？

这个问题涉及到 Spring 与非 Spring 管理的 Bean 之间的桥梁。
