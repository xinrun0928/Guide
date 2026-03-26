# Flowable 异步执行：作业与定时作业（Job & Timer）

你有没有遇到过这种情况：流程中有一些耗时的操作，比如发送邮件、调用外部系统、批量处理数据……

如果这些操作放在主流程里同步执行，用户发起流程后就要等很久才能看到结果。更糟糕的是，如果外部系统响应慢或者宕机，整个流程都会卡住。

Flowable 的**异步执行**和**定时作业**就是为了解决这个问题。

---

## 同步 vs 异步执行

先来理解两种执行模式的区别：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   同步执行：                                                    │
│   ┌─────────┐    ┌─────────────────┐    ┌─────────┐              │
│   │  发起人  │ ─→ │  Flowable引擎   │ ─→ │  完成   │              │
│   └─────────┘    │  等待邮件发送完成 │    └─────────┘              │
│                  └─────────────────┘                             │
│                  用户体验：卡住等待                               │
│                                                                 │
│   异步执行：                                                    │
│   ┌─────────┐    ┌─────────────────┐    ┌─────────┐              │
│   │  发起人  │ ─→ │  Flowable引擎   │ ─→ │  返回   │              │
│   └─────────┘    │  触发异步作业    │    └─────────┘              │
│                  └────────┬────────┘                              │
│                           │                                       │
│                           ↓                                       │
│                  ┌─────────────────┐                              │
│                  │   作业执行器     │                              │
│                  │  后台发送邮件   │                              │
│                  └─────────────────┘                              │
│                  用户体验：立即返回                               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 异步执行（Async）

### 配置方式

在 BPMN 中配置异步执行非常简单：

```xml
<!-- 服务任务配置异步执行 -->
<serviceTask id="sendNotification" name="发送通知">
    <extensionElements>
        <!-- async="true" 开启异步 -->
        <flowable:async primitive="true"/>
        <flowable:expression>${notificationService.send()}</flowable:expression>
    </extensionElements>
</serviceTask>

<!-- 用户任务也可以异步 -->
<userTask id="approvalTask" name="审批">
    <extensionElements>
        <flowable:async primitive="true"/>
    </extensionElements>
</userTask>
```

### 完整示例

```java
/**
 * 异步执行示例
 */
public class AsyncExecutionDemo {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private ManagementService managementService;
    
    /**
     * 启动流程后，服务任务会异步执行
     */
    @Test
    public void asyncServiceTask() {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("recipient", "user@example.com");
        variables.put("message", "您的申请已提交");
        
        // 启动流程（立即返回）
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "asyncNotificationProcess", variables);
        
        System.out.println("流程已启动，立即返回");
        // 邮件发送在后台异步进行
    }
    
    /**
     * 查询异步作业
     */
    @Test
    public void queryAsyncJobs() {
        // 查询等待执行的异步作业
        List&lt;Job&gt; jobs = managementService.createJobQuery()
            .list();
        
        for (Job job : jobs) {
            System.out.println("作业ID: " + job.getId());
            System.out.println("类型: " + job.getJobType());
            System.out.println("重试次数: " + job.getRetries());
            System.out.println("异常信息: " + job.getExceptionMessage());
        }
    }
    
    /**
     * 手动触发作业执行
     * 用于测试或调试
     */
    @Test
    public void executeJobManually() {
        String jobId = "jobId123";
        
        // 执行单个作业
        managementService.executeJob(jobId);
        
        // 或者执行所有待处理作业（用于测试环境）
        List&lt;Job&gt; jobs = managementService.createJobQuery().list();
        for (Job job : jobs) {
            try {
                managementService.executeJob(job.getId());
            } catch (Exception e) {
                System.out.println("作业执行失败: " + e.getMessage());
            }
        }
    }
}
```

### 异步执行器配置

异步执行需要配置执行器：

```java
@Configuration
public class AsyncExecutorConfig {
    
    /**
     * Flowable 6.x 使用新的异步执行器
     */
    @Bean
    public AsyncExecutor asyncExecutor() {
        DefaultAsyncJobExecutor executor = new DefaultAsyncJobExecutor();
        
        // 线程池配置
        executor.setCorePoolSize(5);
        executor.setMaxPoolSize(10);
        executor.setQueueSize(100);
        
        // 线程名称前缀
        executor.setThreadNamePrefix("flowable-async-");
        
        // 异步执行器启动
        executor.setStartExecutorThreadPoolSize(2);
        
        return executor;
    }
}
```

---

## 定时作业（Timer）

### 定时器事件类型

BPMN 支持多种定时器：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   定时器边界事件（Timer Boundary Event）                         │
│   ┌─────────────────────────────────────────┐                   │
│   │           父活动                         │                   │
│   │  ┌───────────────────────────────────┐  │                   │
│   │  │   定时器边界                        │  │                   │
│   │  └───────────────────────────────────┘  │                   │
│   └─────────────────────────────────────────┘                   │
│   活动执行时启动定时器，活动结束时取消                              │
│                                                                 │
│   定时器开始事件（Timer Start Event）                            │
│   ───[⏰ 0 0 * * ?]───→ 流程实例                                  │
│   定时触发，启动新的流程实例                                      │
│                                                                 │
│   中间定时捕获事件（Timer Intermediate Catching Event）          │
│   ═══ ⏰ ═══                                                       │
│   在流程中等待指定时间后继续                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 定时器表达式

```xml
<!-- 定时器表达式格式 -->

<!-- 1. ISO 8601 时间格式 -->
<timerEventDefinition>
    <timeDuration>PT5M</timeDuration>        <!-- 5分钟后 -->
</timerEventDefinition>

<timerEventDefinition>
    <timeDuration>PT1H30M</timeDuration>     <!-- 1小时30分钟后 -->
</timerEventDefinition>

<!-- 2. Cron 表达式 -->
<timerEventDefinition>
    <timeCycle>0 0 * * * ?</timeCycle>       <!-- 每小时整点 -->
</timerEventDefinition>

<timerEventDefinition>
    <timeCycle>0 0 9 ? * MON-FRI</timeCycle> <!-- 工作日9点 -->
</timerEventDefinition>

<!-- 3. 日期表达式 -->
<timerEventDefinition>
    <timeDate>2024-12-31T23:59:59</timeDate>
</timerEventDefinition>
```

### 定时器边界事件

```xml
<!-- 用户任务超时处理 -->
<userTask id="approvalTask" name="审批任务">
    <!-- 定时器边界事件 -->
    <boundaryEvent id="timeoutTimer" attachedToRef="approvalTask">
        <timerEventDefinition>
            <!-- 2小时后自动处理 -->
            <timeDuration>PT2H</timeDuration>
        </timerEventDefinition>
    </boundaryEvent>
    
    <!-- 超时后转向超时处理节点 -->
    <sequenceFlow sourceRef="timeoutTimer" targetRef="handleTimeout"/>
    
    <serviceTask id="handleTimeout" name="超时处理">
        <flowable:expression>${timeoutService.handleTimeout(execution)}</flowable:expression>
    </serviceTask>
</userTask>
```

### 定时器开始事件

```xml
<!-- 定时启动流程实例 -->
<process id="dailyReportProcess">
    <!-- 每天早上8点自动启动 -->
    <startEvent id="start">
        <timerEventDefinition>
            <timeCycle>0 0 8 * * ?</timeCycle>
        </timerEventDefinition>
    </startEvent>
    
    <serviceTask id="generateReport" name="生成报表">
        <flowable:expression>${reportService.generateDailyReport()}</flowable:expression>
    </serviceTask>
    
    <endEvent id="end"/>
</process>
```

### 完整示例：任务超时处理

```java
/**
 * 定时器使用完整示例
 */
public class TimerDemo {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private HistoryService historyService;
    
    /**
     * 启动带超时检测的审批流程
     */
    @Test
    public void timeoutProcess() {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("approver", "manager");
        variables.put("taskId", "TASK-001");
        
        // 启动流程
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "approvalWithTimeout", variables);
        
        System.out.println("流程已启动，等待审批...");
    }
    
    /**
     * 超时监听器
     */
    public class TimeoutListener implements ExecutionListener {
        
        @Override
        public void notify(DelegateExecution execution) {
            String processInstanceId = execution.getProcessInstanceId();
            
            // 查询原始任务
            List&lt;Task&gt; tasks = taskService.createTaskQuery()
                .processInstanceId(processInstanceId)
                .list();
            
            for (Task task : tasks) {
                // 检查任务是否仍在进行
                if (task.getEndTime() == null) {
                    // 任务超时，记录日志
                    logTimeout(task);
                    
                    // 自动转派给其他人
                    reassignTask(task);
                    
                    // 或者直接标记超时
                    markTaskAsTimeout(task);
                }
            }
        }
        
        private void logTimeout(Task task) {
            HistoricTaskInstance historicTask = historyService.createHistoricTaskInstanceQuery()
                .taskId(task.getId())
                .singleResult();
            
            Duration duration = Duration.between(
                historicTask.getCreateTime().toInstant(),
                Instant.now()
            );
            
            System.out.println("任务超时: " + task.getName() + 
                ", 超时时长: " + duration.toMinutes() + " 分钟");
        }
        
        private void reassignTask(Task task) {
            // 转派给备用审批人
            taskService.setAssignee(task.getId(), "backupApprover");
        }
    }
}
```

---

## 作业（Job）与定时作业

### 作业类型

Flowable 中的作业分为几种类型：

| 类型 | 说明 | 触发方式 |
|---|---|---|
| 异步作业 | 异步执行的服务任务 | 流程执行到时立即触发 |
| 定时作业 | 需要在特定时间执行的作业 | 时间到达时触发 |
| 排他作业 | 集群环境下的排他锁作业 | 确保只有一个节点执行 |
| 挂起/激活 | 流程实例的挂起/激活操作 | 手动触发 |

```java
/**
 * 作业查询与操作
 */
public class JobManagement {
    
    @Autowired
    private ManagementService managementService;
    
    /**
     * 查询所有作业
     */
    public void queryJobs() {
        // 待执行的异步作业
        List&lt;Job&gt; asyncJobs = managementService.createJobQuery()
            .jobType(JobType.ASYNC)
            .list();
        
        // 定时作业
        List&lt;TimerJob&gt; timerJobs = managementService.createTimerJobQuery()
            .list();
        
        // 挂起的作业
        List&lt;SuspendedJob&gt; suspendedJobs = managementService.createSuspendedJobQuery()
            .list();
        
        // 死信作业（执行失败多次的作业）
        List&lt;DeadLetterJob&gt; deadLetterJobs = managementService.createDeadLetterJobQuery()
            .list();
    }
    
    /**
     * 作业重试
     */
    public void retryJob(String jobId) {
        // 将作业移回待执行队列
        managementService.moveDeadLetterJobToExecutableJob(jobId, 3);
    }
    
    /**
     * 删除作业
     */
    public void deleteJob(String jobId) {
        managementService.deleteJob(jobId);
    }
}
```

### 定时器表达式详解

```java
/**
 * 常用定时器表达式示例
 */

// 1. 相对时间：流程启动后多久执行
@Test
public void relativeTimers() {
    // 流程启动 30 分钟后执行
    // &lt;timeDuration&gt;PT30M&lt;/timeDuration&gt;
    
    // 流程启动 2 小时后执行
    // &lt;timeDuration&gt;PT2H&lt;/timeDuration&gt;
    
    // 流程启动 1 天后执行
    // &lt;timeDuration&gt;P1D&lt;/timeDuration&gt;
}

// 2. Cron 表达式：更灵活的定时配置
@Test
public void cronExpressions() {
    // 每分钟执行一次
    // "0 * * * * ?"
    
    // 每天凌晨2点执行
    // "0 0 2 * * ?"
    
    // 每周一早上9点执行
    // "0 0 9 ? * MON"
    
    // 每月1号凌晨3点执行
    // "0 0 3 1 * ?"
    
    // 每个工作日早上9点执行
    // "0 0 9 ? * MON-FRI"
}

// 3. 动态表达式（使用变量）
@Test
public void dynamicTimer() {
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    
    // 从变量中获取定时时间
    variables.put("reminderDelay", "PT1H");  // 1小时后提醒
    
    // 启动流程
    runtimeService.startProcessInstanceByKey("reminderProcess", variables);
}
```

```xml
<!-- 使用变量的定时器 -->
<timerEventDefinition>
    <timeDuration>${reminderDelay}</timeDuration>
</timerEventDefinition>

<!-- 也可以使用表达式计算 -->
<timerEventDefinition>
    <timeDuration>${reminderDelay != null ? reminderDelay : 'PT24H'}</timeDuration>
</timerEventDefinition>
```

---

## 作业执行器配置

### 单节点配置

```java
@Configuration
public class JobExecutorConfig {
    
    /**
     * 配置作业执行器
     */
    @Bean
    public FlowableAsyncExecutor asyncExecutor(ProcessEngineConfiguration config) {
        DefaultAsyncJobExecutor executor = new DefaultAsyncJobExecutor();
        
        // 基本配置
        executor.setAsyncExecutorActivate(true);  // 启动时激活
        
        // 线程池配置
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueSize(100);
        
        // 定时作业线程池（用于定时扫描）
        executor.setTimerExecutorThreadPoolSize(4);
        
        // 作业锁定期（防止重复执行）
        executor.setDefaultAsyncJobAcquireWaitTime(5000L);
        executor.setDefaultTimerJobAcquireWaitTime(10000L);
        
        return executor;
    }
}
```

### 集群配置

```java
@Configuration
public class ClusterJobExecutorConfig {
    
    /**
     * 集群环境下的作业执行器配置
     */
    @Bean
    public AsyncExecutor clusterAsyncExecutor() {
        DefaultAsyncJobExecutor executor = new DefaultAsyncJobExecutor();
        
        // 开启排他作业（集群环境下保证同一作业只有一个节点执行）
        executor.setAutoActivate排他作业 = true;
        
        // 作业获取策略
        executor.setAsyncJobLockTimeAcquisitionTime(5000L);  // 获取锁超时
        executor.setTimerJobLockTimeAcquisitionTime(10000L);
        
        // 锁定期（作业执行后多久释放锁）
        executor.setDefaultAsyncJobLockTime(30000L);  // 30秒
        
        return executor;
    }
}
```

---

## 常见问题与解决方案

### 问题1：作业没有执行

```java
/**
 * 排查步骤
 */
public void troubleshootMissingJobs() {
    // 1. 检查作业是否被挂起
    List&lt;Job&gt; suspendedJobs = managementService.createSuspendedJobQuery()
        .list();
    System.out.println("挂起作业数: " + suspendedJobs.size());
    
    // 2. 检查定时作业是否未到时间
    List&lt;TimerJob&gt; timerJobs = managementService.createTimerJobQuery()
        .list();
    System.out.println("定时作业数: " + timerJobs.size());
    
    // 3. 检查死信作业（执行失败的作业）
    List&lt;DeadLetterJob&gt; deadLetterJobs = managementService.createDeadLetterJobQuery()
        .list();
    for (DeadLetterJob job : deadLetterJobs) {
        System.out.println("失败作业: " + job.getId() + ", 原因: " + job.getExceptionMessage());
    }
    
    // 4. 检查异步执行器是否启动
    // 确保 Flowable 配置中 asyncExecutorActivate = true
}
```

### 问题2：作业重复执行

```java
/**
 * 避免作业重复执行的策略
 */
public class IdempotentJobHandler {
    
    /**
     * 使用流程变量实现幂等性
     */
    public void handleJob(DelegateExecution execution) {
        String executionId = execution.getId();
        String processInstanceId = execution.getProcessInstanceId();
        
        // 检查是否已处理
        Boolean alreadyProcessed = (Boolean) runtimeService.getVariable(
            processInstanceId, "job_" + executionId + "_processed");
        
        if (Boolean.TRUE.equals(alreadyProcessed)) {
            // 跳过重复执行
            return;
        }
        
        // 执行实际逻辑
        doActualWork(execution);
        
        // 标记为已处理
        runtimeService.setVariable(
            processInstanceId, 
            "job_" + executionId + "_processed", 
            true
        );
    }
}
```

---

## 总结：异步与定时器使用场景

| 功能 | 适用场景 | 配置要点 |
|---|---|---|
| 异步服务任务 | 发送通知、调用外部系统、批量处理 | `async="true"` |
| 定时器边界事件 | 任务超时检测、活动期限提醒 | `timeDuration` 或 `timeCycle` |
| 定时器开始事件 | 周期性的流程实例启动 | `timeCycle` |
| 中间定时事件 | 等待特定时间后继续流程 | `timeDuration` |
| 异步排他网关 | 并行分支完成后汇总 | `async="true"` |

---

## 留给你的问题

假设你要实现一个「订单超时处理」系统：

1. 用户下单后创建订单流程
2. 如果 30 分钟内没有支付，自动取消订单
3. 订单取消前 5 分钟，发送催付提醒
4. 如果用户多次未支付，将用户加入黑名单

**问题来了：**

1. 「30分钟未支付取消」和「25分钟催付提醒」是两个独立的定时器，它们之间如何保证时序正确？
2. 如果服务器在定时器触发前宕机了，重启后定时器还能正常触发吗？Flowable 是怎么保证定时器不丢失的？
3. 如果用户 A 下单后 29 分钟时，修改了收货地址（触发流程变量变更）——这时候「30分钟取消」定时器的时间需要重新计算吗？

这三个问题涉及到**定时器可靠性**、**事件时序**和**状态同步**，是生产环境定时任务设计的核心考量。
