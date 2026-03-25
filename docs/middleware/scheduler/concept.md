# 任务调度核心概念

凌晨 2 点，你的订单系统需要在每天凌晨结算昨日交易数据；
每小时要同步一次商品库存；
每周要给活跃用户发送邮件；
每个整点要把日志数据导入数据仓库。

这些「什么时候做什么」的需求，就是任务调度要解决的问题。

但当数据量从一万条变成一亿条，从单机变成集群，这些定时任务就开始「闹脾气」了——重复执行、漏执行、执行顺序混乱……

本文带你彻底搞懂任务调度的核心概念，为后续学习 Quartz、XXL-Job、ElasticJob 打下坚实基础。

## 四大核心组件

一个完整的任务调度系统，离不开这四个核心组件：

### 1. Job（任务）

**Job** 是真正要执行的具体业务逻辑。你可以把它理解为「要做的事」。

```java
public interface Job {
    void execute(JobExecutionContext context) throws JobExecutionException;
}
```

这个接口极其简单——就是一个 `execute` 方法。但简单不代表它做的事情少。

Job 的职责是：
- 执行具体的业务逻辑
- 从 `JobExecutionContext` 中获取任务参数
- 抛出异常（让调度器知道执行失败了）

### 2. JobDetail（任务描述）

**JobDetail** 是对 Job 的完整描述，包含 Job 的类型、属性、以及必要的数据。

```java
// JobDetail 包含的信息
public class JobDetail {
    private final String name;           // 任务名称
    private final String group;          // 任务所属组
    private final Class&lt;? extends Job&gt; jobClass;  // Job 实现类
    private final JobDataMap dataMap;    // 任务数据
    private final boolean durability;   // 是否持久化
    private final boolean shouldRecover; // 是否自动恢复
}
```

**为什么要区分 Job 和 JobDetail？**

这是一个经典的设计模式——**命令模式**。

- `Job` 是「做什么」（Do）
- `JobDetail` 是「谁来做、怎么做、用什么做」（Command）

想象餐厅的点餐系统：
- `Job` 像是「做一份宫保鸡丁」
- `JobDetail` 像是「2号桌的客人要点宫保鸡丁，微辣，不要花生」

`Job` 可以复用，但 `JobDetail` 记录了每次执行的具体上下文。

### 3. Trigger（触发器）

**Trigger** 定义了「什么时候执行」。

```java
public interface Trigger {
    String getName();
    String getGroup();
    Date getStartTime();
    Date getEndTime();
    Date getNextFireTime();
    Date getPreviousFireTime();
    // ... 更多方法
}
```

触发器有以下几种类型：

| 触发器类型 | 说明 | 适用场景 |
|---|---|---|
| SimpleTrigger | 指定间隔重复执行 | 每隔 5 分钟执行一次 |
| CronTrigger | 使用 Cron 表达式 | 每天早上 9 点执行 |
| DateIntervalTrigger | 日期间隔触发 | 每隔 2 天执行一次 |
| NthIncludedDayTrigger | 每月的第 N 天执行 | 每月 1 日执行 |

### 4. Scheduler（调度器）

**Scheduler** 是整个调度系统的「总指挥」。

它的职责包括：
- 管理 JobDetail 和 Trigger 的注册与删除
- 根据 Trigger 的触发时间执行 Job
- 维护任务调度线程池

```java
// Scheduler 的核心操作
Scheduler scheduler = StdSchedulerFactory.getDefaultScheduler();

// 添加任务
scheduler.scheduleJob(jobDetail, trigger);

// 启动调度器
scheduler.start();

// 暂停调度器
scheduler.shutdown();
```

## 线程池：并发执行的保障

Scheduler 内部维护了一个**线程池**，这是任务能够并发执行的关键。

```
┌─────────────────────────────────────────────────────────────┐
│                      Scheduler                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  线程池 (Thread Pool)                │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │   │
│  │  │线程 1   │ │线程 2   │ │线程 3   │ │线程 N   │   │   │
│  │  │执行Job1 │ │执行Job2 │ │执行Job3 │ │执行JobN │   │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**为什么需要线程池？**

假设你有一百个定时任务：
- 如果每个任务用一个线程，就需要 100 个线程，线程切换开销巨大
- 如果共用一个线程，任务只能串行执行，效率低下
- 使用线程池，可以在并发性能和资源消耗之间取得平衡

**线程池大小的选择**：

```
线程池大小 = CPU核心数 × (1 + 等待时间/执行时间)
```

对于 IO 密集型任务（等待数据库、网络），线程数可以设置大一些；
对于 CPU 密集型任务（复杂计算），线程数最好接近 CPU 核心数。

## 组件之间的关系

```
                    ┌─────────────┐
                    │  Scheduler  │
                    │  (调度器)    │
                    └──────┬──────┘
                           │
            ┌──────────────┼──────────────┐
            │              │              │
            ▼              ▼              ▼
     ┌───────────┐  ┌───────────┐  ┌───────────┐
     │  Trigger  │  │  Trigger  │  │  Trigger  │
     │ (触发器1)  │  │ (触发器2)  │  │ (触发器3)  │
     └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
           │              │              │
           ▼              ▼              ▼
     ┌───────────┐  ┌───────────┐  ┌───────────┐
     │ JobDetail │  │ JobDetail │  │ JobDetail │
     │ (任务描述1)│  │ (任务描述2)│  │ (任务描述3)│
     └─────┬─────┘  └─────┬─────┘  └─────┬─────┘
           │              │              │
           ▼              ▼              ▼
     ┌───────────┐  ┌───────────┐  ┌───────────┐
     │    Job    │  │    Job    │  │    Job    │
     │ (任务1)   │  │ (任务2)   │  │ (任务3)   │
     └───────────┘  └───────────┘  └───────────┘
```

**一个 Trigger 只能对应一个 JobDetail，但一个 JobDetail 可以被多个 Trigger 引用。**

这就好比：
- 一个闹钟（Trigger）只能叫醒一个人（JobDetail）
- 但一个人（JobDetail）可以设置多个闹钟（Trigger）叫醒自己

## 数据传递：JobDataMap

任务之间需要传递数据，通过 `JobDataMap` 实现：

```java
// 设置数据
JobDetail jobDetail = JobBuilder.newJob(MyJob.class)
    .withIdentity("myJob", "group1")
    .usingJobData("count", 0)
    .usingJobData("name", "张三")
    .build();

// 在 Job 中获取数据
public class MyJob implements Job {
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        int count = dataMap.getInt("count");
        String name = dataMap.getString("name");
        
        System.out.println("任务执行：" + name + "，计数：" + count);
    }
}
```

## 总结

任务调度的四大组件：

| 组件 | 职责 | 类比 |
|---|---|---|
| Job | 做什么 | 厨师做菜 |
| JobDetail | 任务的描述和上下文 | 菜单 + 桌位信息 |
| Trigger | 什么时候做 | 闹钟 |
| Scheduler | 协调调度 | 餐厅服务员 |

理解这四个概念，是学习 Quartz、XXL-Job、ElasticJob 的基础。

## 思考题

一个任务可以被多个 Trigger 触发，但如果两个 Trigger 同时触发同一个任务，Job 会执行几次？

这个问题涉及到任务调度的并发控制和幂等性设计，是面试中经常考察的点。
