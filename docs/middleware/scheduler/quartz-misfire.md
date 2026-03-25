# Quartz Misfire 策略与重试机制

凌晨 3 点，你的服务器由于内存泄漏导致 Full GC 停顿了 30 秒。

等到服务器恢复时，原本应该在 3 点执行的任务，**已经错过了触发时间**。

这种情况叫做 **Misfire**（错失触发）。

Quartz 如何处理 Misfire？重试机制又是怎样的？今天一起来看。

## 什么是 Misfire？

```
┌─────────────────────────────────────────────────────────────┐
│                      什么是 Misfire？                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   正常触发：                                                │
│   10:00:00 ──────▶ [执行任务]                               │
│                                                             │
│   Misfire（错过触发）：                                      │
│   10:00:00 ──── 服务器卡住了 ────▶ [执行任务]               │
│                 (延迟到10:01执行)                            │
│                                                             │
│   问题：                                                    │
│   1. 任务应该什么时候执行？                                   │
│   2. 要不要补偿执行？                                        │
│   3. 跳过的触发点怎么处理？                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Misfire 发生的原因**：
- 服务器 Full GC 停顿
- 服务器负载过高
- 节点宕机恢复后
- 调度线程忙于执行其他任务

## Misfire 指令

Quartz 为不同的 Trigger 类型提供了多种 Misfire 处理策略。

### SimpleTrigger 的 Misfire 策略

| 策略 | 说明 |
|---|---|
| MISFIRE_INSTRUCTION_FIRE_NOW | 立即触发一次，然后按新时间继续 |
| MISFIRE_INSTRUCTION_RESCHEDULE_NOW_WITH_REMAINING_REPEAT_COUNT | 立即触发，用剩余次数 |
| MISFIRE_INSTRUCTION_RESCHEDULE_NEXT_WITH_REMAINING_REPEAT_COUNT | 从下一个周期开始，保留剩余次数 |
| MISFIRE_INSTRUCTION_NOOP | 不触发任何操作 |
| MISFIRE_INSTRUCTION_SMART_POLICY | 智能策略（默认） |

### CronTrigger 的 Misfire 策略

| 策略 | 说明 |
|---|---|
| MISFIRE_INSTRUCTION_FIRE_ONCE_NOW | 立即触发一次 |
| MISFIRE_INSTRUCTION_DO_NOTHING | 不触发任何操作 |
| MISFIRE_INSTRUCTION_SMART_POLICY | 智能策略（默认） |

## 配置 Misfire 策略

### SimpleTrigger 示例

```java
// 立即触发错失的作业
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(10)
        .withRepeatCount(100)
        .withMisfireHandlingInstructionFireNow())  // 立即触发
    .build();

// 用剩余次数重新开始
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(10)
        .withRepeatCount(100)
        .withMisfireHandlingInstructionRescheduleNowWithRemainingRepeats())  // 保留剩余次数
    .build();
```

### CronTrigger 示例

```java
// 立即触发一次
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 9 * * ?")
        .withMisfireHandlingInstructionFireAndProceed())  // 立即触发
    .build();

// 不触发
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 9 * * ?")
        .withMisfireHandlingInstructionDoNothing())  // 忽略本次
    .build();
```

## 智能策略详解

`withMisfireHandlingInstructionSmartPolicy()` 是默认策略，它会根据 Trigger 类型自动选择合适的策略：

```java
// Quartz 内部的策略映射
public class SimpleTriggerExtensions {
    
    public static SimpleTriggerBuilder withMisfireHandlingInstructionSmartPolicy() {
        // SimpleTrigger 的智能策略：FIRE_NOW
        return withMisfireHandlingInstructionFireNow();
    }
}

public class CronTriggerExtensions {
    
    public static CronScheduleBuilder withMisfireHandlingInstructionSmartPolicy() {
        // CronTrigger 的智能策略：FIRE_ONCE_NOW
        return withMisfireHandlingInstructionFireOnceNow();
    }
}
```

## Misfire 检测机制

Quartz 使用一个后台线程（叫 **MisfireHandler**）来检测和处理 Misfire：

```
┌─────────────────────────────────────────────────────────────┐
│                    Misfire 处理流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. MisfireHandler 线程定期扫描数据库                       │
│      ┌────────────────────────────────────────────────┐    │
│      │ SELECT * FROM QRTZ_TRIGGERS                   │    │
│      │ WHERE NEXT_FIRE_TIME < CURRENT_TIME           │    │
│      │ AND TRIGGER_STATE = 'WAITING'                │    │
│      └────────────────────────────────────────────────┘    │
│                                                             │
│   2. 计算 misfireThreshold（默认 60000ms）                   │
│      如果 NEXT_FIRE_TIME + misfireThreshold < NOW         │
│      → 判定为 Misfire                                      │
│                                                             │
│   3. 根据策略处理 Misfire Trigger                          │
│                                                             │
│   4. 更新 NEXT_FIRE_TIME                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 配置 Misfire 阈值

```yaml
spring:
  quartz:
    properties:
      org:
        quartz:
          jobStore:
            misfireThreshold: 60000  # 超过 60 秒才判定为 Misfire
```

## 不同场景的处理策略

### 场景一：定时报表任务

需求：每天凌晨 2 点生成报表，错过就跳过，不能补发。

```java
// 策略：不触发（等待下一个周期）
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("dailyReportTrigger", "reportGroup")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 2 * * ?")
        .withMisfireHandlingInstructionDoNothing())  // 忽略 Misfire
    .build();
```

### 场景二：心跳检测任务

需求：每 30 秒检测一次服务健康状态，错过要立即检测。

```java
// 策略：立即触发
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("healthCheckTrigger", "monitorGroup")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(30)
        .repeatForever()
        .withMisfireHandlingInstructionFireNow())  // 立即触发
    .build();
```

### 场景三：数据同步任务

需求：每小时同步一次数据，错过等待下一个周期，但保证总执行次数。

```java
// 策略：保留剩余次数，从下一个周期开始
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("syncTrigger", "syncGroup")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInHours(1)
        .withRepeatCount(24)
        .withMisfireHandlingInstructionRescheduleNextWithRemainingRepeatCount())
    .build();
```

## Misfire 与集群

在集群环境下，Misfire 处理更加复杂：

```
┌─────────────────────────────────────────────────────────────┐
│                    集群环境下的 Misfire                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   场景：Node1 执行任务时宕机                                  │
│                                                             │
│   1. Node1 宕机前：                                         │
│      Trigger 状态 = ACQUIRED（已获得）                       │
│                                                             │
│   2. 其他节点检测到 Node1 失联：                             │
│      · 更新 QRTZ_SCHEDULER_STATE（标记为失联）               │
│      · 释放 Node1 持有的锁                                  │
│                                                             │
│   3. MisfireHandler 处理：                                   │
│      ┌────────────────────────────────────────────────┐   │
│      │ 如果 Trigger 状态 = ACQUIRED + 节点失联         │   │
│      │ → 重新设置状态为 WAITING                        │   │
│      │ → 重新分配给其他节点执行                        │   │
│      └────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 重试机制

Quartz 本身不提供任务失败重试机制，需要自己实现：

### 方式一：使用 Trigger 的重复执行

```java
// Trigger 本身就是一种重试机制
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(60)
        .withRepeatCount(3))  // 总共执行 4 次（首次 + 3 次重复）
    .build();
```

### 方式二：在 Job 中手动重试

```java
public class RetryableJob implements Job {
    
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        int maxRetries = 3;
        int retryCount = 0;
        
        while (retryCount < maxRetries) {
            try {
                // 执行业务逻辑
                doBusinessLogic();
                return;  // 成功，退出
            } catch (Exception e) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    throw new JobExecutionException("重试失败", e);
                }
                
                // 等待后重试
                try {
                    Thread.sleep(5000 * retryCount);  // 指数退避
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    throw new JobExecutionException("重试被中断", ie);
                }
            }
        }
    }
}
```

### 方式三：使用 Spring Retry

```java
@Retryable(value = Exception.class, maxAttempts = 3, backoff = @Backoff(delay = 5000))
public void doBusinessLogic() {
    // 业务逻辑
}
```

## 总结

| 策略 | 适用场景 | 效果 |
|---|---|---|
| FIRE_NOW | 心跳检测、实时监控 | 立即补偿执行 |
| DO_NOTHING | 定时报表、批量任务 | 忽略本次，等待下一周期 |
| RESCHEDULE_NOW_WITH_REMAINING | 需要保证执行次数 | 重新计时，保留剩余次数 |
| SMART_POLICY | 一般场景 | 自动选择合适策略 |

**最佳实践**：
1. 明确业务需求：Misfire 后是要补偿执行还是跳过
2. 设置合理的 misfireThreshold，避免误判
3. 集群环境下，确保 MisfireHandler 正常工作
4. 对于关键任务，考虑实现自己的重试机制

## 思考题

如果一个每分钟执行一次的任务，在 Misfire 后使用了 `FIRE_NOW` 策略，会发生什么？

比如：
- 10:00 应该执行（错过了）
- 10:01 恢复正常

任务会在 10:01 立即执行一次，然后按 10:02、10:03... 继续执行吗？

还是有什么特殊情况？
