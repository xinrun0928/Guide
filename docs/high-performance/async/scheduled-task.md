# ScheduledExecutorService 定时任务优化

你的定时任务是准时执行的吗？

表面上看起来是的：每天 9 点「准时」发工资，凌晨 2 点「准时」同步数据。

但实际上，99% 的定时任务实现都有问题：任务执行时间过长导致堆积、相邻任务重叠执行、节点重复执行……

这些坑，我来帮你避开。

## 定时任务的常见问题

```
问题场景：

├─ 任务堆积
│   └─ 上一次还没执行完，下一次又开始了
│
├─ 执行时间漂移
│   └─ 9:00 开始执行，9:05 才真正运行
│
├─ 多节点重复执行
│   └─ 3 台机器同时执行同一个任务
│
└─ 任务失败无重试
   └─ 执行失败了，没有补救措施
```

## ScheduledExecutorService 基础

### 创建定时执行器

```java
// 创建 ScheduledExecutorService
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
// 参数说明：
// - 线程数 = 1：串行执行，只有一个任务在运行
// - 线程数 > 1：可以并行执行多个定时任务
// 推荐：设为 CPU 核心数 + 1

ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(
    Runtime.getRuntime().availableProcessors() + 1
);
```

### 四种调度方法

```java
// 1. 固定延迟执行（fixedDelay）
// 上一次执行完成后，等待固定时间再执行下一次
scheduler.scheduleWithFixedDelay(task, initialDelay, delay, TimeUnit.SECONDS);
// 执行时序：
// [Task1] ---- delay ---- [Task2] ---- delay ---- [Task3]
// 注意：如果 Task1 执行了 30 秒，delay 是从 Task1 完成后开始计算

// 2. 固定频率执行（fixedRate）
// 按照固定频率执行，不管上一次是否完成
scheduler.scheduleAtFixedRate(task, initialDelay, period, TimeUnit.SECONDS);
// 执行时序（假设任务执行时间 &lt; period）：
// [Task1] -------- [Task2] -------- [Task3]
// 执行时序（假设任务执行时间 > period）：
// [Task1 takes long time...] ---- [Task2 starts immediately after Task1]
// 注意：如果任务执行时间超过 period，会立即执行下一次（无等待）

// 3. 单次延迟执行
scheduler.schedule(task, delay, TimeUnit.SECONDS);

// 4. 带返回值的调度
ScheduledFuture&lt;String&gt; future = scheduler.schedule(callableTask, delay, TimeUnit.SECONDS);
String result = future.get();  // 获取执行结果
```

## 任务堆积问题

### 问题分析

```java
// 使用 fixedDelay 的问题
scheduler.scheduleWithFixedDelay(() -> {
    // 假设这个任务执行需要 10 秒
    doLongRunningTask();
}, 0, 5, TimeUnit.SECONDS);

// 时序分析：
// [Task1: 0-10s] -------- [Task2: 15-25s] -------- [Task3: 30-40s]
// 每次间隔 5 秒（从完成后计算）
// 这个没问题！

// 但是：如果任务执行时间超过了 delay
scheduler.scheduleWithFixedDelay(() -> {
    doLongRunningTask();  // 假设执行 20 秒
}, 0, 5, TimeUnit.SECONDS);

// 时序分析：
// [Task1: 0-20s] ---- [Task2: 20-40s] ---- [Task3: 40-60s]
// Task1 完成后，立即开始 Task2（5 秒的等待被任务执行时间吞掉了）
```

### 解决方案：执行锁

```java
public class ScheduledTaskWithLock {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final AtomicBoolean running = new AtomicBoolean(false);
    
    public void scheduleTask() {
        scheduler.scheduleWithFixedDelay(() -> {
            // 检查是否有任务在执行
            if (!running.compareAndSet(false, true)) {
                // 上一次任务还没执行完，跳过本次
                log.warn("Task is still running, skip this execution");
                return;
            }
            
            try {
                doTask();
            } finally {
                running.set(false);
            }
        }, 0, 5, TimeUnit.SECONDS);
    }
}
```

### 解决方案：带超时的执行

```java
public class ScheduledTaskWithTimeout {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    
    public void scheduleTask() {
        scheduler.scheduleWithFixedDelay(() -> {
            Future&lt;?&gt; future = taskExecutor.submit(() -> {
                doTask();
            });
            
            try {
                // 设置任务超时时间
                future.get(30, TimeUnit.SECONDS);
            } catch (TimeoutException e) {
                log.error("Task execution timeout, cancelling...");
                future.cancel(true);  // 中断正在执行的任务
            } catch (Exception e) {
                log.error("Task execution failed", e);
            }
        }, 0, 5, TimeUnit.SECONDS);
    }
}
```

## 执行时间漂移问题

### 问题分析

```
固定频率执行的真正含义：

├─ fixedRate: 按照绝对时间执行（理想情况）
│   └─ 每 5 分钟执行一次，9:00, 9:05, 9:10...
│
├─ 问题：如果任务执行时间不稳定
│   ├─ 9:00 开始，执行 6 分钟（到 9:06）
│   ├─ 9:05 的执行时间被「吞掉」
│   └─ 下一个执行时间变成 9:10
│
└─ 实际效果：执行时间会逐渐漂移
```

### 解决方案：使用时间窗口

```java
public class ScheduledTaskWithTimeWindow {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    
    public void scheduleDailyTask() {
        // 每天凌晨 2 点执行
        scheduler.scheduleAtFixedRate(() -> {
            // 计算下一个凌晨 2 点
            LocalDateTime now = LocalDateTime.now();
            LocalDateTime nextRun = now.withHour(2).withMinute(0).withSecond(0);
            if (now.isAfter(nextRun)) {
                nextRun = nextRun.plusDays(1);
            }
            
            // 等待到下一个执行时间
            long delay = Duration.between(now, nextRun).toMillis();
            scheduler.schedule(this::doDailyTask, delay, TimeUnit.MILLISECONDS);
        }, calculateDelayTo2AM(), TimeUnit.DAYS.toSeconds(1), TimeUnit.SECONDS);
    }
    
    private long calculateDelayTo2AM() {
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime next2AM = now.withHour(2).withMinute(0).withSecond(0);
        if (now.isAfter(next2AM)) {
            next2AM = next2AM.plusDays(1);
        }
        return Duration.between(now, next2AM).toSeconds();
    }
}
```

## 多节点重复执行问题

### 问题分析

```
多节点部署场景：

┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│   Node 1    │ │   Node 2    │ │   Node 3    │
│  定时任务   │ │  定时任务   │ │  定时任务   │
│   2:00 AM   │ │   2:00 AM   │ │   2:00 AM   │
└─────────────┘ └─────────────┘ └─────────────┘
     ↓              ↓              ↓
   数据重复！    数据重复！     数据重复！
```

### 解决方案一：分布式锁

```java
public class DistributedScheduledTask {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    
    private static final String LOCK_KEY = "scheduled:task:lock";
    private static final long LOCK_TIMEOUT = 30;  // 锁超时时间（秒）
    
    public void scheduleWithDistributedLock(Runnable task) {
        scheduler.scheduleWithFixedDelay(() -> {
            // 尝试获取分布式锁
            Boolean acquired = redisTemplate.opsForValue()
                .setIfAbsent(LOCK_KEY, "locked", LOCK_TIMEOUT, TimeUnit.SECONDS);
            
            if (Boolean.TRUE.equals(acquired)) {
                try {
                    task.run();
                } finally {
                    // 执行完成后释放锁
                    redisTemplate.delete(LOCK_KEY);
                }
            } else {
                log.info("Another node is executing the task, skip");
            }
        }, 0, 60, TimeUnit.SECONDS);
    }
}
```

### 解决方案二：数据库标记

```java
public class DatabaseBasedScheduledTask {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final TaskExecutionRepository repository;
    
    public void scheduleWithDatabaseLock(Runnable task, String taskName) {
        scheduler.scheduleWithFixedDelay(() -> {
            // 尝试创建执行记录
            Optional&lt;TaskExecution&gt; existing = repository
                .findByTaskNameAndExecutionDate(taskName, LocalDate.now());
            
            if (existing.isPresent()) {
                log.info("Task already executed today, skip");
                return;
            }
            
            try {
                // 创建执行记录（乐观锁）
                TaskExecution execution = new TaskExecution();
                execution.setTaskName(taskName);
                execution.setExecutionDate(LocalDate.now());
                execution.setStartTime(LocalDateTime.now());
                execution.setStatus("RUNNING");
                repository.save(execution);
                
                // 执行任务
                task.run();
                
                // 更新执行记录
                execution.setStatus("COMPLETED");
                execution.setEndTime(LocalDateTime.now());
                repository.save(execution);
                
            } catch (Exception e) {
                log.error("Task execution failed", e);
                // 更新执行记录
                execution.setStatus("FAILED");
                execution.setErrorMessage(e.getMessage());
                repository.save(execution);
            }
        }, 0, 60, TimeUnit.SECONDS);
    }
}
```

### 解决方案三：ShedLock

```java
// ShedLock 是一个专门解决定时任务多节点执行的库

@Configuration
public class ShedLockConfig {
    
    @Bean
    public LockProvider lockProvider(RedisConnectionFactory factory) {
        return new RedisLockProvider(factory, "my-app");
    }
    
    @Bean
    public ScheduledLockConfiguration taskscheduler(LockProvider lockProvider) {
        return ScheduledLockConfigurationBuilder
            .withLockProvider(lockProvider)
            .withPoolSize(4)
            .withDefaultLockAtMostFor(Duration.ofMinutes(10))
            .build();
    }
}

@Service
public class MyScheduledTask {
    
    private final ScheduledLockConfiguration locks;
    
    public MyScheduledTask(ScheduledLockConfiguration locks) {
        this.locks = locks;
    }
    
    @SchedulerLock(name = "myScheduledTask", lockAtMostFor = "10m", lockAtLeastFor = "1m")
    public void doScheduledTask() {
        // 任务逻辑
        // ShedLock 会确保只有一个节点在执行
    }
}
```

## 任务失败重试

### 简单重试

```java
public class RetryableScheduledTask {
    
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);
    private final int maxRetries = 3;
    
    public void scheduleWithRetry(Runnable task) {
        AtomicInteger retryCount = new AtomicInteger(0);
        
        Runnable wrappedTask = () -> {
            try {
                task.run();
            } catch (Exception e) {
                int retries = retryCount.incrementAndGet();
                if (retries &lt;= maxRetries) {
                    log.warn("Task failed, retry {}/{}", retries, maxRetries);
                    // 指数退避：1s, 2s, 4s...
                    long delay = (long) Math.pow(2, retries - 1);
                    scheduler.schedule(wrappedTask, delay, TimeUnit.SECONDS);
                } else {
                    log.error("Task failed after {} retries", maxRetries);
                    // 告警通知
                    alertService.send("Scheduled task failed: " + e.getMessage());
                }
            }
        };
        
        scheduler.scheduleWithFixedDelay(wrappedTask, 0, 60, TimeUnit.SECONDS);
    }
}
```

### Spring Retry 集成

```java
// 添加依赖
// &lt;dependency&gt;
//     &lt;groupId&gt;org.springframework.retry&lt;/groupId&gt;
//     &lt;artifactId&gt;spring-retry&lt;/artifactId&gt;
// &lt;/dependency&gt;
// &lt;dependency&gt;
//     &lt;groupId&gt;org.springframework&lt;/groupId&gt;
//     &lt;artifactId&gt;spring-aspects&lt;/artifactId&gt;
// &lt;/dependency&gt;

@Configuration
@EnableRetry
public class RetryConfig {
    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();
        
        // 配置重试策略
        ExponentialBackOffPolicy backOffPolicy = new ExponentialBackOffPolicy();
        backOffPolicy.setInitialInterval(1000);
        backOffPolicy.setMultiplier(2.0);
        backOffPolicy.setMaxInterval(10000);
        template.setBackOffPolicy(backOffPolicy);
        
        // 配置重试条件
        Map&lt;Class&lt;? extends Throwable&gt;, Boolean&gt; retryableExceptions = new HashMap&lt;&gt;();
        retryableExceptions.put(RemoteException.class, true);
        retryableExceptions.put(SQLException.class, true);
        retryableExceptions.put(IllegalStateException.class, false);  // 不重试
        template.setRetryPolicy(new SimpleRetryPolicy(3, retryableExceptions));
        
        return template;
    }
}

@Service
public class RetryableScheduledTask {
    
    @Autowired
    private RetryTemplate retryTemplate;
    
    @Async
    public void scheduleWithSpringRetry(Runnable task) {
        retryTemplate.execute(context -> {
            try {
                task.run();
            } catch (Exception e) {
                log.warn("Retry attempt {} failed", context.getRetryCount());
                throw e;  // 让 Spring Retry 处理重试
            }
            return null;
        });
    }
}
```

## 最佳实践总结

| 场景 | 解决方案 |
|------|---------|
| 防止任务堆积 | 使用执行锁或超时机制 |
| 固定时间执行 | 使用时间窗口计算 |
| 多节点单执行 | 分布式锁/ShedLock |
| 任务失败重试 | 指数退避重试 |
| 日志审计 | 数据库记录执行历史 |
| 监控告警 | 监控任务执行时间和失败率 |

---

## 留给你的问题

假设你有一个每天凌晨 2 点执行的报表生成任务：

1. 如果任务执行时间是 3 小时，而下一次调度是 2 小时后，fixedDelay 和 fixedRate 分别会怎么处理？
2. 如果你的应用部署了 3 个节点，每个节点都会执行这个定时任务。你怎么确保只有 1 个节点在执行？
3. 如果任务执行到 2.5 小时时，服务器突然重启了，重启后任务会重新执行吗？你怎么保证任务不会重复执行？
4. 如果你的定时任务依赖外部 API，而这个 API 有 10% 的失败率，你会怎么设计重试机制？

思考这些问题，能帮助你设计更健壮的定时任务系统。
