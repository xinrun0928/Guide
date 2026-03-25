# Quartz 任务调度

Quartz 有多经典？

它是 Java 领域最早的任务调度框架，早在 2001 年就诞生了，至今仍是 Spring 官方推荐的调度方案。

问题是：功能这么全，概念这么多，怎么入门？

今天，我们把 Quartz 的核心知识一网打尽。

## 什么是 Quartz？

Quartz 是一个完全由 Java 编写的开源任务调度框架，功能强大且灵活。

```
┌─────────────────────────────────────────────────────────────┐
│                    Quartz 特点                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   历史悠久     2001 年诞生，久经考验                          │
│   功能完善     支持 Cron 表达式、集群、插件                   │
│   社区活跃     持续维护，文档丰富                             │
│   Spring 集成  Spring Boot 原生支持                          │
│                                                             │
│   但也有缺点：                                              │
│   · 没有可视化管理界面                                     │
│   · 分布式支持需要额外配置                                  │
│   · 学习曲线较陡                                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心概念

Quartz 有四个核心概念：

| 组件 | 职责 | 关键类 |
|---|---|---|
| [Scheduler](/middleware/scheduler/quartz-core) | 调度器，任务的「总指挥」 | StdSchedulerFactory |
| [Trigger](/middleware/scheduler/quartz-trigger) | 触发器，定义「什么时候执行」 | SimpleTrigger, CronTrigger |
| [Job](/middleware/scheduler/quartz-core) | 任务，定义「做什么」 | Job 接口 |
| [JobDetail](/middleware/scheduler/quartz-core) | 任务描述，Job 的元信息 | JobBuilder |

```
┌─────────────────────────────────────────────────────────────┐
│                    四者关系图                                │
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
│   │  Trigger   │   │  Trigger   │   │  Trigger   │        │
│   │ (触发器)   │   │ (触发器)   │   │ (触发器)   │        │
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

## 模块内容

### 核心概念与进阶

- [核心概念](/middleware/scheduler/quartz-core)：Scheduler、Trigger、Job、JobDetail 详解
- [Trigger 类型](/middleware/scheduler/quartz-trigger)：SimpleTrigger（简单间隔）、CronTrigger（Cron 表达式）
- [Job 状态与持久化](/middleware/scheduler/quartz-job-state)：
  - @PersistJobDataAfterExecution：执行后持久化数据
  - @DisallowConcurrentExecution：禁止并发执行
- [Misfire 策略](/middleware/scheduler/quartz-misfire)：错过触发后的处理机制

### 集群与集成

- [Spring Boot 集成](/middleware/scheduler/quartz-springboot)：@Scheduled、SchedulerFactoryBean
- [集群原理](/middleware/scheduler/quartz-cluster)：
  - JDBC JobStore：调度状态存储到数据库
  - 分布式锁：QRTZ_LOCKS 表实现节点协调
  - 故障转移：节点失联后任务重新触发

## 快速上手

### 引入依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
```

### 定义 Job

```java
public class HelloJob implements Job {
    
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        System.out.println("Hello! Quartz is working!");
        
        // 从上下文获取参数
        String message = context.getJobDetail().getJobDataMap().getString("message");
        System.out.println("Message: " + message);
    }
}
```

### 配置与启动

```java
@Configuration
public class QuartzConfig {
    
    @Bean
    public JobDetail helloJobDetail() {
        return JobBuilder.newJob(HelloJob.class)
            .withIdentity("helloJob", "group1")
            .usingJobData("message", "Hello Quartz!")
            .storeDurably()
            .build();
    }
    
    @Bean
    public Trigger helloTrigger(JobDetail helloJobDetail) {
        return TriggerBuilder.newTrigger()
            .forJob(helloJobDetail)
            .withIdentity("helloTrigger", "group1")
            .withSchedule(CronScheduleBuilder.cronSchedule("0/5 * * * * ?"))
            .build();
    }
}
```

## 面试高频考点

```
┌─────────────────────────────────────────────────────────────┐
│                    Quartz 面试要点                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 四个核心组件是什么？                                    │
│      → Scheduler、Trigger、Job、JobDetail                   │
│                                                             │
│   2. Trigger 有哪些类型？区别是什么？                        │
│      → SimpleTrigger：固定间隔                               │
│        CronTrigger：Cron 表达式，更灵活                     │
│                                                             │
│   3. @DisallowConcurrentExecution 的作用？                   │
│      → 禁止同一个 JobDetail 并发执行                        │
│        场景：任务执行时间 > 触发间隔                          │
│                                                             │
│   4. @PersistJobDataAfterExecution 的作用？                 │
│      → 执行后将 JobDataMap 持久化到数据库                    │
│        场景：需要在多次执行间保持状态                         │
│                                                             │
│   5. Quartz 集群的原理？                                    │
│      → JDBC JobStore 存储所有调度状态到数据库                │
│        QRTZ_LOCKS 表实现分布式锁                            │
│        节点竞争获取锁，只有获得锁的节点执行任务               │
│                                                             │
│   6. Misfire 是什么？如何处理？                              │
│      → 错过触发时间后，配置处理策略                          │
│        → MISFIRE_INSTRUCTION_FIRE_NOW：立即执行              │
│        → MISFIRE_INSTRUCTION_RESCHEDULE_NOW_WITH_REMAINING_REPEAT_COUNT：重新计算执行次数
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 总结

| 维度 | 说明 |
|---|---|
| 定位 | 企业级任务调度框架 |
| 优点 | 功能完善、Spring 集成好、集群支持 |
| 缺点 | 无管理界面、学习曲线陡 |
| 适用场景 | 需要精细控制的企业级应用 |

Quartz 是调度领域的「瑞士军刀」——功能齐全，但需要花时间掌握。

## 下一步

- 深入学习 [Trigger 类型](/middleware/scheduler/quartz-trigger)，掌握 Cron 表达式的写法
- 理解 [Job 状态与持久化](/middleware/scheduler/quartz-job-state)，避免并发和数据丢失问题
- 了解 [集群原理](/middleware/scheduler/quartz-cluster)，为生产环境做准备
