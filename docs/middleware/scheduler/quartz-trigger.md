# Quartz Trigger 类型

你的任务调度场景有哪些？

场景一：「每 5 分钟执行一次」
场景二：「每天早上 9 点执行」
场景三：「每隔 30 秒执行一次」
场景四：「每周一早上 10 点执行」

这些场景，Quartz 都支持，靠的就是 Trigger 的不同类型。

## Trigger 的两大类型

```
┌─────────────────────────────────────────────────────────────┐
│                    Trigger 类型体系                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                        Trigger                              │
│                           │                                 │
│           ┌───────────────┼───────────────┐                │
│           │               │               │                │
│           ▼               ▼               ▼                │
│    ┌────────────┐  ┌────────────┐  ┌────────────┐          │
│    │ Simple     │  │   Cron     │  │  Calendar   │          │
│    │ Trigger    │  │  Trigger   │  │  Interval   │          │
│    │            │  │            │  │  Trigger    │          │
│    └────────────┘  └────────────┘  └────────────┘          │
│                                                             │
│   SimpleTrigger：简单的时间间隔                               │
│   CronTrigger：强大的 Cron 表达式                            │
│   CalendarIntervalTrigger：日历相关的间隔                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SimpleTrigger：简单触发器

适合「每隔 N 毫秒/秒/分钟执行一次」的场景。

### 基本用法

```java
// 场景：5秒后开始，每隔10秒执行一次，执行10次
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startAt(DateBuilder.futureDate(5, DateBuilder.IntervalUnit.SECOND)) // 5秒后开始
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(10)        // 间隔10秒
        .withRepeatCount(9))             // 总共执行10次（首次 + 9次重复）
    .build();
```

### 执行时间线

```
┌─────────────────────────────────────────────────────────────┐
│         SimpleTrigger 执行时间线（间隔10秒，执行10次）         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   开始时间 ────────▶│                                       │
│                    │                                       │
│   第1次: T+0s      │                                       │
│   第2次: T+10s     │                                       │
│   第3次: T+20s     │                                       │
│   ...             │                                       │
│   第10次: T+90s    │                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 指定结束时间

```java
// 场景：5秒后开始，执行到指定时间为止
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startAt(DateBuilder.futureDate(5, DateBuilder.IntervalUnit.SECOND))
    .endAt(DateBuilder.dateOf(22, 0, 0))  // 到晚上10点结束
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(30)
        .repeatForever())
    .build();
```

### Misfire 策略

当 Trigger 错过触发时间（misfire）后，如何处理？

```java
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(10)
        .withRepeatCount(100)
        .withMisfireHandlingInstructionFireNow())  // 错失立即触发
    .build();
```

SimpleTrigger 的 Misfire 策略：

| 策略 | 说明 |
|---|---|
| MISFIRE_INSTRUCTION_FIRE_NOW | 错失后立即触发一次 |
| MISFIRE_INSTRUCTION_RESCHEDULE_NOW_WITH_REMAINING_REPEAT_COUNT | 重新计算执行次数 |
| MISFIRE_INSTRUCTION_RESCHEDULE_NEXT_WITH_REMAINING_REPEAT_COUNT | 从下一个周期开始 |
| MISFIRE_INSTRUCTION_SMART_POLICY | 智能策略（默认） |

## CronTrigger：Cron 表达式触发器

适合「复杂的定时规则」，如「每天早上9点」「每周一早上10点」。

### Cron 表达式格式

```
┌─────────────────────────────────────────────────────────────┐
│                    Cron 表达式格式                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│   │ 秒      │ 分钟    │ 小时    │ 日      │ 月      │ 星期    │
│   └─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘
│                                                             │
│   例如：0 0 9 * * ?                                         │
│        │ │ │                                                │
│        │ │ │                                                │
│        │ │ └── 小时：9 点                                    │
│        │ └──── 分钟：0 分                                    │
│        └─────── 秒：0 秒                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 常用表达式示例

```java
// 每天早上9点执行（不包括周六周日）
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 9 * * ?"))
    .build();

// 每天早上9点到下午6点，每小时执行一次
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 9-18 * * ?"))
    .build();

// 每周一早上10点执行
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 10 ? * MON"))
    .build();

// 每个月1号早上9点执行
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 9 1 * ?"))
    .build();

// 每隔5分钟执行一次
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0/5 * * * ?"))
    .build();

// 每天早上9点到下午5点，每隔30分钟执行一次
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0/30 9-17 * * ?"))
    .build();
```

### Cron 表达式特殊字符

| 字符 | 含义 | 示例 |
|---|---|---|
| * | 任意值 | `* * * * *` 每天每分钟 |
| ? | 无特定值 | `0 0 9 * * ?` 每天9点 |
| - | 范围 | `0 0 9-17 * * ?` 9点到17点 |
| , | 列表 | `0 0 9,12,18 * * ?` 9点、12点、18点 |
| / | 步长 | `0 0/5 * * * ?` 每5分钟 |
| L | 最后 | `0 0 L * ?` 每月最后一天 |
| W | 工作日 | `0 0 9 LW * ?` 每月最后一个工作日 |
| # | 第几个 | `0 0 ? * 2#1` 每月第一个周一 |

### CronScheduleBuilder 常用配置

```java
// 时区设置
CronScheduleBuilder.cronSchedule("0 0 9 * * ?")
    .inTimeZone(TimeZone.getTimeZone("Asia/Shanghai"))
    .build();

// 错失策略
.withMisfireHandlingInstructionDoNothing()  // 不触发
.withMisfireHandlingInstructionFireAndProceed()  // 立即触发（默认）
.withMisfireHandlingInstructionIgnoreMisfires()  // 忽略所有错失的触发

// 安全起见，Quartz 默认不使用秒级的 Cron 表达式
// 如果需要秒级精度，需要使用 withCronSchedule() 后再配置
```

## 对比：SimpleTrigger vs CronTrigger

| 维度 | SimpleTrigger | CronTrigger |
|---|---|---|
| 适用场景 | 简单间隔 | 复杂定时规则 |
| 表达式 | 指定间隔 | Cron 表达式 |
| 灵活性 | 一般 | 强大 |
| 学习成本 | 低 | 中 |
| 示例 | 每10秒执行一次 | 每周一早上9点执行 |

```
┌─────────────────────────────────────────────────────────────┐
│                    选择建议                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   每隔 N 秒/分钟/小时/天执行 ──────▶ SimpleTrigger           │
│                                                             │
│   复杂的定时规则                      │                     │
│   · 每天特定时间                     │                     │
│   · 每周特定时间                     │──▶ CronTrigger       │
│   · 每月特定日期                     │                     │
│   · 工作日/休息日区分                │                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 实战：如何选择 Trigger 类型？

### 场景一：报表生成

需求：每天凌晨2点生成前一天的日报表。

```java
// 选择 CronTrigger
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("dailyReportTrigger", "reportGroup")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0 2 * * ?"))
    .build();
```

### 场景二：心跳检测

需求：每30秒检测一次服务健康状态。

```java
// 选择 SimpleTrigger
SimpleTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("healthCheckTrigger", "monitorGroup")
    .startNow()
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(30)
        .repeatForever())
    .build();
```

### 场景三：限时活动

需求：每周五下午3点到5点，每10分钟推送一次活动提醒。

```java
// 选择 CronTrigger
CronTrigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("activityTrigger", "activityGroup")
    .withSchedule(CronScheduleBuilder.cronSchedule("0 0/10 15-17 ? * FRI"))
    .build();
```

## 总结

| Trigger 类型 | 使用场景 | 示例 |
|---|---|---|
| SimpleTrigger | 固定间隔重复 | 每30秒检测一次 |
| CronTrigger | 复杂定时规则 | 每天9点、每周一10点 |
| CalendarIntervalTrigger | 日历间隔 | 每2周、每3个月 |
| DailyTimeIntervalTrigger | 每天特定时段 | 每天9点到17点 |

## 思考题

如何用 Cron 表达式实现「每隔5分钟执行一次」？

有两种写法：
- `0 0/5 * * * ?`
- `0 */5 * * * ?`

这两种写法有什么区别？

提示：涉及到 Quartz 对秒级 Cron 表达式的特殊处理。
