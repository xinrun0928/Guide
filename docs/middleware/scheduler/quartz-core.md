# Quartz 核心概念

学 Quartz，第一件事是什么？

不是写代码，是搞清楚它的四个核心概念：**Scheduler、Trigger、Job、JobDetail**。

这四个东西搞不清楚，后面的内容你看了也是云里雾里。

## Scheduler：调度器

Scheduler 是 Quartz 的「大脑」，负责管理所有的调度工作。

```
┌─────────────────────────────────────────────────────────────┐
│                        Scheduler                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   它的工作：                                                │
│   · 启动 Trigger                                           │
│   · 停止 Trigger                                           │
│   · 添加 Job 和 Trigger                                     │
│   · 暂停 Job 和 Trigger                                     │
│   · 删除 Job 和 Trigger                                     │
│   · 查询 Job 执行状态                                       │
│                                                             │
│   创建方式：                                                │
│   Scheduler scheduler = StdSchedulerFactory.getDefaultScheduler();
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Scheduler 的生命周期**：

```java
// 1. 创建调度器
Scheduler scheduler = StdSchedulerFactory.getDefaultScheduler();

// 2. 启动（启动之前，Trigger 不会触发）
scheduler.start();

// 3. 做一些其他事情...
Thread.sleep(10000);

// 4. 关闭（关闭之后，所有 Trigger 停止工作）
scheduler.shutdown();
```

**记住一点**：Scheduler 必须显式启动，否则任务不会执行。

## Trigger：触发器

Trigger 定义了「**什么时候**」执行 Job。

你可以把它想象成「闹钟」——你告诉它几点叫你，它就几点叫你。

```java
// 创建一个简单的触发器：5秒后开始，每10秒执行一次
Trigger trigger = TriggerBuilder.newTrigger()
    .withIdentity("myTrigger", "group1")
    .startAt(DateBuilder.futureDate(5, DateBuilder.IntervalUnit.SECOND))
    .withSchedule(SimpleScheduleBuilder.simpleSchedule()
        .withIntervalInSeconds(10)
        .repeatForever())
    .build();
```

### Trigger 的属性

每个 Trigger 都有以下关键属性：

| 属性 | 说明 |
|---|---|
| identity | 触发器名称 + 分组，唯一标识 |
| startTime | 开始时间 |
| endTime | 结束时间（可选） |
| misfireInstruction | 错失触发后的处理策略 |
| priority | 优先级，多个 Trigger 同时触发时决定顺序 |

### Trigger 的类型

Quartz 提供了多种 Trigger 类型，最常用的是：

| 类型 | 说明 |
|---|---|
| SimpleTrigger | 指定间隔重复执行，如「每5分钟执行一次」 |
| CronTrigger | 使用 Cron 表达式，如「每天早上9点执行」 |

## Job：任务

Job 是真正执行的具体业务逻辑。

```java
public class HelloJob implements Job {
    
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        // 这里是真正的业务逻辑
        System.out.println("Hello! Quartz is running!");
        
        // 可以从 context 中获取传递的参数
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        String message = dataMap.getString("message");
        System.out.println("Message: " + message);
    }
}
```

**Job 的特点**：

- Job 是无状态的，每次执行都是新实例
- Job 实例可以被多个 Trigger 引用
- Job 执行完成后会立即销毁

## JobDetail：任务描述

JobDetail 是对 Job 的完整描述，包括 Job 的类型、属性、以及需要传递的数据。

```java
// 创建 JobDetail
JobDetail jobDetail = JobBuilder.newJob(HelloJob.class)
    .withIdentity("myJob", "group1")      // 设置名称和分组
    .withDescription("这是一个测试任务")     // 设置描述
    .usingJobData("message", "Hello World") // 传递参数
    .storeDurably()                          // 设置为持久化
    .build();
```

**JobDetail vs Job**：

```
┌─────────────────────────────────────────────────────────────┐
│                    JobDetail vs Job                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   JobDetail（图纸）         Job（建造者）                     │
│   · 名称、分组              · execute() 方法                 │
│   · 描述信息               · 每次执行创建新实例                │
│   · 参数数据               · 无状态                           │
│   · 持久化标记             · 执行完即销毁                      │
│                                                             │
│   类比：                                                    │
│   JobDetail = 餐厅订单（记录谁点什么、口味要求）               │
│   Job = 厨师（根据订单做菜）                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 四者的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    四者的关系                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      ┌────────────┐                        │
│                      │ Scheduler  │                        │
│                      │  (调度器)   │                        │
│                      └─────┬──────┘                        │
│                            │                                │
│           ┌────────────────┼────────────────┐              │
│           │                │                │              │
│           ▼                ▼                ▼              │
│   ┌────────────┐   ┌────────────┐   ┌────────────┐        │
│   │  Trigger1  │   │  Trigger2  │   │  Trigger3  │        │
│   │ (触发器1)   │   │ (触发器2)   │   │ (触发器3)   │        │
│   └─────┬──────┘   └─────┬──────┘   └─────┬──────┘        │
│         │                │                │              │
│         └────────────────┼────────────────┘              │
│                          ▼                                 │
│                  ┌────────────┐                           │
│                  │  JobDetail  │                           │
│                  │ (任务描述)   │                           │
│                  └─────┬──────┘                           │
│                        │                                   │
│                        ▼                                   │
│                  ┌────────────┐                           │
│                  │    Job     │                           │
│                  │ (任务执行)  │                           │
│                  └────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**重要规则**：
- 一个 Scheduler 可以注册多个 JobDetail 和 Trigger
- 一个 Trigger 只能对应一个 JobDetail
- 一个 JobDetail 可以被多个 Trigger 引用

## 完整示例

```java
public class QuartzHelloWorld {
    
    public static void main(String[] args) throws SchedulerException {
        
        // 1. 创建调度器
        Scheduler scheduler = StdSchedulerFactory.getDefaultScheduler();
        
        // 2. 创建 JobDetail（指定要执行的任务）
        JobDetail jobDetail = JobBuilder.newJob(HelloJob.class)
            .withIdentity("myJob", "group1")
            .usingJobData("message", "Hello Quartz!")
            .build();
        
        // 3. 创建 Trigger（指定什么时候执行）
        Trigger trigger = TriggerBuilder.newTrigger()
            .withIdentity("myTrigger", "group1")
            .startNow()  // 立即开始
            .withSchedule(CronScheduleBuilder.cronSchedule("0/5 * * * * ?")) // 每5秒
            .build();
        
        // 4. 将 JobDetail 和 Trigger 注册到调度器
        scheduler.scheduleJob(jobDetail, trigger);
        
        // 5. 启动调度器
        scheduler.start();
        
        // 6. 运行一段时间后关闭
        Thread.sleep(30000);
        scheduler.shutdown();
    }
}
```

## 总结

| 组件 | 职责 | 关键类 |
|---|---|---|
| Scheduler | 管理所有调度工作 | StdSchedulerFactory |
| Trigger | 定义触发时间 | SimpleTrigger, CronTrigger |
| Job | 定义执行逻辑 | Job 接口 |
| JobDetail | 描述 Job 的元数据 | JobBuilder |

理解这四个概念，就掌握了 Quartz 的骨架。

## 思考题

如果一个 JobDetail 被两个 Trigger 引用：
- Trigger A：每分钟执行一次
- Trigger B：每小时执行一次

当第 30 分钟时，Job 会执行几次？

这个问题涉及到 Trigger 和 JobDetail 的多对多关系。
