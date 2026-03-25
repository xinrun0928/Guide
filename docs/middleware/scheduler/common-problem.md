# 定时任务常见问题

你的定时任务上线三个月，一切正常。

直到有一天，运营同学反馈：「用户收到三封相同的邮件了」。

这不是用户运气好，是你的定时任务出了问题。

## 问题一：重复执行

### 为什么会重复执行？

**场景一：多实例部署**

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：每台服务器都执行了任务                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │ Server1 │  │ Server2 │  │ Server3 │                 │
│   │ 执行任务✓│  │ 执行任务✓│  │ 执行任务✓│                 │
│   └──────────┘  └──────────┘  └──────────┘                 │
│                                                             │
│   用户：「为什么我收到3封邮件？」                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**场景二：调度器重复触发**

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：任务执行时间过长，触发器又触发了一次                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   时间线：                                                   │
│   10:00:00 ── 触发 ──▶ 执行（预计5分钟）                      │
│   10:00:00 ── 触发 ──▶ 等待（线程池满）                        │
│   10:00:05 ── 完成 ──▶ 完成                                  │
│   10:05:00 ── 再次触发 ──▶ 执行（又来一次）                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 解决方案

**方案一：分布式锁**

```java
public class PreventDuplicateExecution {
    
    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    
    public boolean tryLock(String taskId, long expireSeconds) {
        String key = "task:lock:" + taskId;
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(key, "locked", Duration.ofSeconds(expireSeconds));
        return Boolean.TRUE.equals(success);
    }
    
    public void executeWithLock(String taskId, Runnable task) {
        if (tryLock(taskId, 3600)) {
            try {
                task.run();
            } finally {
                // 注意：finally 中释放锁
                redisTemplate.delete("task:lock:" + taskId);
            }
        } else {
            System.out.println("任务正在其他节点执行，跳过");
        }
    }
}
```

**方案二：数据库唯一标记**

```java
public class DatabaseDeduplication {
    
    public void executeWithDeduplication(Connection conn, String taskId) {
        String sql = "INSERT INTO task_execution (task_id, start_time) VALUES (?, ?)";
        
        try {
            // 尝试插入，如果主键冲突则说明已执行
            new PreparedStatementCreator() {
                @Override
                public PreparedStatement createPreparedStatement(Connection con) 
                        throws SQLException {
                    PreparedStatement ps = con.prepareStatement(sql);
                    ps.setString(1, taskId);
                    ps.setTimestamp(2, new Timestamp(System.currentTimeMillis()));
                    return ps;
                }
            };
            
            // 插入成功，执行任务
            executeTask();
            
        } catch (DuplicateKeyException e) {
            // 主键冲突，跳过执行
            System.out.println("任务已执行，跳过");
        }
    }
}
```

**方案三：ShedLock（Spring Scheduler 的分布式锁）**

```java
@Configuration
@EnableScheduling
public class SchedulingConfig {
}

@SchedulerLock(name = "sendEmailJob", lockAtMostFor = "PT30M")
public void sendEmailJob() {
    // 这个方法在集群中只会有一个节点执行
    emailService.sendWeeklyReport();
}
```

## 问题二：时钟漂移

### 什么是时钟漂移？

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：每台服务器的时钟不完全一致                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   时间基准：2024-01-15 10:00:00                              │
│                                                             │
│   Server1: 10:00:00 ──▶ 执行！                               │
│   Server2: 09:59:58 ──▶ 还没到点呢...                        │
│   Server3: 10:00:03 ──▶ 晚了几秒...                          │
│                                                             │
│   问题：时钟不同步导致任务执行时间不准确                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 场景：整点任务

用户期望：每天早上 9 点执行报表生成

```
实际发生：
┌────────────────────────────────────────────────────────────┐
│ Server1（快 2 秒）│ Server2（准确） │ Server3（慢 3 秒）   │
├────────────────────────────────────────────────────────────┤
│ 08:59:58 执行？  │ 09:00:00 执行   │ 09:00:03 执行        │
└────────────────────────────────────────────────────────────┘

结果：报表数据可能不一致！
```

### 解决方案

**方案一：使用 ZooKeeper 时间同步**

```java
// ZooKeeper 的分布式协调能力可以保证节点间的时钟同步
// 但它主要用于选举和协调，不是专门的时间同步工具
```

**方案二：使用数据库时间作为基准**

```java
public class DatabaseTimeService {
    
    @Autowired
    private DataSource dataSource;
    
    public Date getDatabaseTime() {
        return jdbcTemplate.queryForObject(
            "SELECT NOW()", Date.class
        );
    }
    
    public void scheduleTask() {
        Date dbTime = getDatabaseTime();
        
        // 使用数据库时间判断是否应该执行
        if (isScheduledTime(dbTime)) {
            executeTask();
        }
    }
}
```

**方案三：使用时间窗口**

```
┌─────────────────────────────────────────────────────────────┐
│ 解决方案：使用时间窗口，允许 ±N 秒的误差                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   任务触发时间：09:00:00                                      │
│   时间窗口：±30 秒                                           │
│                                                             │
│   Server1: 08:59:30 ──▶ 忽略（太早）                         │
│   Server2: 09:00:00 ──▶ 执行 ✓                               │
│   Server3: 09:00:28 ──▶ 执行 ✓                               │
│   Server4: 09:00:35 ──▶ 忽略（太晚）                         │
│                                                             │
│   「谁先进入时间窗口，谁执行」                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 问题三：任务堆积

### 为什么会堆积？

**场景一：任务执行失败后重试**

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：任务失败后不断重试，导致堆积                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   10:00 任务1执行失败 ──▶ 重试                                 │
│   10:01 任务1重试失败 ──▶ 重试                                 │
│   10:02 任务1重试失败 ──▶ 重试                                 │
│   ...                                                        │
│   10:30 任务1终于成功 ──▶ 但已经堆积了30个任务                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**场景二：任务执行时间过长**

```
┌─────────────────────────────────────────────────────────────┐
│ 问题：一个任务执行 10 分钟，后续任务全部延迟                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   线程池: 5 个线程                                           │
│                                                             │
│   10:00:00 任务1开始（预计10分钟）                             │
│   10:00:00 任务2等待...                                      │
│   10:00:00 任务3等待...                                      │
│   10:00:00 任务4等待...                                      │
│   10:00:00 任务5等待...                                      │
│                                                             │
│   10:10:00 任务1完成，任务2开始                                │
│   10:20:00 任务2完成，任务3开始（已经等了20分钟）                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**场景三：上游数据量突增**

```java
// 假设每 5 分钟执行一次，正常处理 1 万条数据
// 但某次上游放了 100 万条数据进来

public void processOrders() {
    List&lt;Order&gt; orders = orderService.getPendingOrders();
    // orders.size() = 1000000 ❌
    
    for (Order order : orders) {
        // 循环处理 100 万条数据...
        // 5 分钟内根本处理不完！
        processOrder(order);
    }
}
```

### 解决方案

**方案一：设置任务超时时间**

```java
@Bean
public TaskScheduler taskScheduler() {
    ThreadPoolTaskScheduler scheduler = new ThreadPoolTaskScheduler();
    scheduler.setPoolSize(10);
    scheduler.setWaitForTasksToCompleteOnShutdown(true);
    scheduler.setAwaitTerminationSeconds(60);
    return scheduler;
}

@Scheduled(fixedRate = 5000)
public void scheduledTask() {
    try {
        // 设置超时：最多执行 4 分钟
        CompletableFuture.runAsync(() -> {
            doTask();
        }).get(4, TimeUnit.MINUTES);
    } catch (TimeoutException e) {
        // 任务超时，记录日志，执行下一个
        log.error("任务执行超时，跳过本次执行");
    }
}
```

**方案二：分页处理 + 断点续传**

```java
public void processOrdersWithPage() {
    int pageSize = 1000;
    int pageNum = 1;
    long lastId = 0;
    
    while (true) {
        List&lt;Order&gt; orders = orderService.getPendingOrders(lastId, pageSize);
        
        if (orders.isEmpty()) {
            break; // 没有更多数据
        }
        
        for (Order order : orders) {
            processOrder(order);
            lastId = order.getId();
        }
        
        pageNum++;
        
        // 每处理 100 页，暂停 1 秒，避免占用太多资源
        if (pageNum % 100 == 0) {
            try {
                Thread.sleep(1000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }
    }
}
```

**方案三：限流 + 队列缓冲**

```java
public class RateLimitedTaskProcessor {
    
    private final Semaphore semaphore = new Semaphore(5); // 最多5个并发
    
    public void submitTask(Task task) {
        executor.submit(() -> {
            try {
                semaphore.acquire();
                try {
                    doTask(task);
                } finally {
                    semaphore.release();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }
}
```

**方案四：告警 + 人工介入**

```java
public void monitoredTask() {
    long startTime = System.currentTimeMillis();
    int processed = 0;
    
    try {
        processed = doTask();
    } catch (Exception e) {
        sendAlert("任务执行失败", e);
        throw e;
    } finally {
        long duration = System.currentTimeMillis() - startTime;
        
        // 处理数量异常
        if (processed < expectedMinCount) {
            sendAlert("任务处理数量低于预期", 
                "期望: " + expectedMinCount + ", 实际: " + processed);
        }
        
        // 处理时间异常
        if (duration > expectedMaxDuration) {
            sendAlert("任务执行时间过长",
                "期望: " + expectedMaxDuration + "ms, 实际: " + duration + "ms");
        }
    }
}
```

## 三个问题的关联

```
┌─────────────────────────────────────────────────────────────┐
│                   三个问题的关联关系                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      时钟漂移                                 │
│                         │                                   │
│                         ▼                                   │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              重复执行 / 漏执行                         │  │
│   └─────────────────────────────────────────────────────┘  │
│                         │                                   │
│                         ▼                                   │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                      任务堆积                         │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   解决方案：分布式锁 + 时间窗口 + 任务监控                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 总结

| 问题 | 原因 | 解决方案 |
|---|---|---|
| 重复执行 | 多实例/重试触发 | 分布式锁、数据库唯一键 |
| 时钟漂移 | 服务器时钟不同步 | ZooKeeper、数据库时间、时间窗口 |
| 任务堆积 | 执行慢/重试/数据突增 | 超时控制、分页处理、限流 |

## 思考题

如果一个任务正在执行时，服务器突然断电，会发生什么？

已执行的数据如何恢复？未执行的任务如何处理？

这个问题涉及到分布式调度的容错设计和幂等性保障。
