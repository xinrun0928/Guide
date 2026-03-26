# Quartz Spring Boot 集成

Spring Boot 用 Quartz，怎么集成？

很多人第一反应是：引入依赖 + 写配置。

但其实还有两个注解更重要——`@DisallowConcurrentExecution` 和 `@PersistJobDataAfterExecution`。

它们在 Spring Boot 环境下怎么用？今天一起来看。

## 快速集成步骤

### 1. 添加依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
```

### 2. 配置 application.yml

```yaml
spring:
  quartz:
    # 使用 JobStoreTX 管理事务（必需）
    job-store-type: jdbc
    
    # 集群模式
    cluster:
      enabled: false
    
    # properties 配置
    properties:
      org:
        quartz:
          scheduler:
            instanceName: MyScheduler
            instanceId: AUTO
          jobStore:
            class: org.quartz.impl.jdbcjobstore.JobStoreTX
            driverDelegateClass: org.quartz.impl.jdbcjobstore.StdJDBCDelegate
            tablePrefix: QRTZ_
            isClustered: false
            useProperties: true
          threadPool:
            class: org.quartz.simpl.SimpleThreadPool
            threadCount: 10
            threadPriority: 5
```

### 3. 配置数据源

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/quartz?useUnicode=true
    username: root
    password: 123456
    driver-class-name: com.mysql.cj.jdbc.Driver
```

## Spring Boot 自动配置

Spring Boot 的 `spring-boot-starter-quartz` 提供了自动配置，会自动创建：

- `SchedulerFactoryBean`：创建调度器
- `DataSource`：如果配置了，使用配置的 DataSource
- `PlatformTransactionManager`：管理事务

```java
// Spring Boot 自动配置的 SchedulerFactoryBean
// 你也可以自定义 Bean 覆盖默认配置
@Bean
public SchedulerFactoryBeanCustomizer schedulerFactoryBeanCustomizer() {
    return (schedulerFactoryBean) -> {
        schedulerFactoryBean.setOverwriteExistingJobs(true);
        schedulerFactoryBean.setAutoStartup(true);
    };
}
```

## 创建 Job 的两种方式

### 方式一：继承 QuartzJobBean

```java
// 推荐方式：继承 QuartzJobBean
public class MySpringJob extends QuartzJobBean {
    
    // 通过 Setter 注入依赖
    @Autowired
    private MyService myService;
    
    private String name;
    
    // Setter 注入参数
    public void setName(String name) {
        this.name = name;
    }
    
    @Override
    protected void executeInternal(JobExecutionContext context) 
            throws JobExecutionException {
        // 这里可以直接使用注入的 service
        myService.doSomething();
        System.out.println("执行任务: " + name);
    }
}
```

```java
// JobDetailFactoryBean 配置
@Bean
public JobDetailFactoryBean myJobDetail() {
    JobDetailFactoryBean factory = new JobDetailFactoryBean();
    factory.setJobClass(MySpringJob.class);
    factory.getJobDataMap().put("name", "SpringJob");
    factory.setDurability(true);
    return factory;
}

@Bean
public Trigger myTrigger() {
    return TriggerBuilder.newTrigger()
        .forJob(myJobDetail())
        .withSchedule(CronScheduleBuilder.cronSchedule("0/5 * * * * ?"))
        .build();
}
```

### 方式二：使用 @DisallowConcurrentExecution 和 @PersistJobDataAfterExecution

在 Spring Boot 环境下，这两个注解的使用方式和纯 Quartz 一样：

```java
@PersistJobDataAfterExecution
@DisallowConcurrentExecution
public class StatefulSpringJob extends QuartzJobBean {
    
    @Autowired
    private OrderService orderService;
    
    @Override
    protected void executeInternal(JobExecutionContext context) 
            throws JobExecutionException {
        
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        
        // 获取并更新计数
        int count = dataMap.getInt("count");
        count++;
        dataMap.put("count", count);
        
        //执行业务逻辑
        orderService.processPendingOrders();
        
        System.out.println("第 " + count + " 次执行");
    }
}
```

## 注解详解

### @DisallowConcurrentExecution

```java
@DisallowConcurrentExecution
public class ConcurrentTestJob extends QuartzJobBean {
    
    @Override
    protected void executeInternal(JobExecutionContext context) 
            throws JobExecutionException {
        
        System.out.println("开始执行...");
        
        try {
            // 模拟耗时操作
            Thread.sleep(10000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        
        System.out.println("执行完成");
    }
}
```

**效果**：如果触发间隔为 5 秒，由于任务需要 10 秒，第二次触发会等待第一次完成后再执行。

### @PersistJobDataAfterExecution

```java
@PersistJobDataAfterExecution
public class PersistenceJob extends QuartzJobBean {
    
    private int executionCount = 0;
    
    @Override
    protected void executeInternal(JobExecutionContext context) 
            throws JobExecutionException {
        
        executionCount++;
        System.out.println("执行次数: " + executionCount);
        
        // 存储到 JobDataMap
        context.getJobDetail().getJobDataMap().put("count", executionCount);
    }
}
```

**注意**：这里的 `executionCount` 是实例变量，**不会**跨执行共享。真正持久化的是 `JobDataMap`。

```java
// 正确做法：始终从 JobDataMap 读写
@PersistJobDataAfterExecution
public class PersistenceJob extends QuartzJobBean {
    
    @Override
    protected void executeInternal(JobExecutionContext context) 
            throws JobExecutionException {
        
        JobDataMap dataMap = context.getJobDetail().getJobDataMap();
        
        // 始终从 JobDataMap 读取
        int count = dataMap.getInt("count");
        count++;
        
        // 存回 JobDataMap
        dataMap.put("count", count);
        
        System.out.println("执行次数: " + count);
    }
}
```

## 动态管理任务

### 创建任务

```java
@Service
public class JobService {
    
    @Autowired
    private Scheduler scheduler;
    
    public void addJob(String jobName, String jobClass, String cron) 
            throws SchedulerException {
        
        // 创建 JobDetail
        JobDetail jobDetail = JobBuilder.newJob()
            .ofType((Class&lt;? extends Job&gt;) Class.forName(jobClass))
            .withIdentity(jobName, "DEFAULT")
            .storeDurably()
            .build();
        
        // 创建 Trigger
        CronTrigger trigger = TriggerBuilder.newTrigger()
            .withIdentity(jobName, "DEFAULT")
            .withSchedule(CronScheduleBuilder.cronSchedule(cron))
            .build();
        
        scheduler.scheduleJob(jobDetail, trigger);
    }
}
```

### 暂停 / 恢复任务

```java
@Service
public class JobService {
    
    @Autowired
    private Scheduler scheduler;
    
    // 暂停任务
    public void pauseJob(String jobName) throws SchedulerException {
        scheduler.pauseJob(JobKey.jobKey(jobName, "DEFAULT"));
    }
    
    // 恢复任务
    public void resumeJob(String jobName) throws SchedulerException {
        scheduler.resumeJob(JobKey.jobKey(jobName, "DEFAULT"));
    }
    
    // 删除任务
    public void deleteJob(String jobName) throws SchedulerException {
        scheduler.deleteJob(JobKey.jobKey(jobName, "DEFAULT"));
    }
}
```

## 监听 Job 执行

### JobListener 监听器

```java
@Component
public class MyJobListener implements JobListener {
    
    @Override
    public String getName() {
        return "MyJobListener";
    }
    
    @Override
    public void jobToBeExecuted(JobExecutionContext context) {
        System.out.println("任务即将执行: " + context.getJobDetail().getKey());
    }
    
    @Override
    public void jobExecutionVetoed(JobExecutionContext context) {
        System.out.println("任务被否决: " + context.getJobDetail().getKey());
    }
    
    @Override
    public void jobWasExecuted(JobExecutionContext context, JobExecutionException e) {
        System.out.println("任务执行完成: " + context.getJobDetail().getKey());
        if (e != null) {
            System.out.println("异常: " + e.getMessage());
        }
    }
}
```

```java
@Configuration
public class QuartzConfig {
    
    @Autowired
    private MyJobListener myJobListener;
    
    @Bean
    public Scheduler scheduler() throws SchedulerException {
        Scheduler scheduler = StdSchedulerFactory.getDefaultScheduler();
        scheduler.getListenerManager().addJobListener(myJobListener);
        return scheduler;
    }
}
```

## 常见问题

### 问题一：Service 注入为 null

```java
// 错误写法
public class MyJob implements Job {
    @Autowired  // 无效！Job 由 Quartz 创建，Spring 无法注入
    private MyService myService;
}
```

```java
// 正确写法：继承 QuartzJobBean
public class MyJob extends QuartzJobBean {
    @Autowired
    private MyService myService;  // 有效！
}
```

### 问题二：JobDataMap 中的数据无法持久化

```java
// 确保使用了 @PersistJobDataAfterExecution
@PersistJobDataAfterExecution
public class MyJob extends QuartzJobBean {
    // ...
}
```

### 问题三：并发执行导致数据不一致

```java
// 确保使用了 @DisallowConcurrentExecution
@DisallowConcurrentExecution
public class MyJob extends QuartzJobBean {
    // ...
}
```

## 总结

| 要点 | 说明 |
|---|---|
| 依赖 | spring-boot-starter-quartz |
| Job 父类 | 推荐继承 QuartzJobBean |
| Service 注入 | 通过 Setter 注入 |
| 并发控制 | @DisallowConcurrentExecution |
| 数据持久化 | @PersistJobDataAfterExecution |
| 监听器 | 实现 JobListener 接口 |

## 思考题

如果一个 Job 需要注入多个 Service，但 QuartzJobBean 只支持 Setter 注入，怎么办？

提示：可以考虑使用 `AutowireCapableBeanFactory` 或者自定义 `JobFactory`。
