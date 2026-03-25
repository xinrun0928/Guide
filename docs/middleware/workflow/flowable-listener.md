# Flowable 事件监听：执行监听器与任务监听器

你有没有遇到过这种情况：流程在正常运行，但你不知道它什么时候做了什么。

比如：
- 谁在什么时候完成了任务？
- 流程变量是什么时候被修改的？
- 流程启动和结束时，你想自动发送通知怎么办？

这些需求，都需要靠**事件监听器**来实现。

Flowable 的事件监听机制，就像给流程装上了「监控摄像头」——流程执行的每一个关键节点，都会被记录下来，你只需要决定「看到什么就做什么」。

---

## 事件监听体系

Flowable 提供了两套监听器：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   执行监听器（ExecutionListener）                               │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  监听流程/活动的开始和结束                                │   │
│   │  可用于：流程启动/结束、节点进入/离开、变量变更            │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   任务监听器（TaskListener）                                    │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  监听任务的创建、分配、 完成                             │   │
│   │  可用于：任务通知、动态赋值、自动处理                     │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 执行监听器（ExecutionListener）

### 监听事件类型

执行监听器可以监听以下事件：

| 事件 | 触发时机 | 典型用途 |
|---|---|---|
| `start` | 流程实例或活动开始时 | 发送启动通知、初始化数据 |
| `end` | 流程实例或活动结束时 | 发送完成通知、汇总数据 |
| `take` | 顺序流被选中时 | 记录流程路径、计算耗时 |

```xml
<!-- 监听整个流程实例 -->
<process id="myProcess" name="我的流程">
    <!-- 流程开始事件 -->
    <startEvent id="start">
        <extensionElements>
            <flowable:executionListener event="start" 
                class="com.example.listener.ProcessStartListener"/>
        </extensionElements>
    </startEvent>
    
    <!-- 监听特定活动 -->
    <userTask id="approvalTask" name="审批任务">
        <extensionElements>
            <flowable:executionListener event="start" 
                class="com.example.listener.TaskStartListener"/>
            <flowable:executionListener event="end" 
                class="com.example.listener.TaskEndListener"/>
        </extensionElements>
    </userTask>
    
    <!-- 流程结束事件 -->
    <endEvent id="end">
        <extensionElements>
            <flowable:executionListener event="end" 
                class="com.example.listener.ProcessEndListener"/>
        </extensionElements>
    </endEvent>
</process>
```

### 监听器实现

```java
/**
 * 执行监听器基础实现
 * 实现 Flowable 提供的接口
 */
public class ProcessStartListener implements ExecutionListener {
    
    @Override
    public void notify(DelegateExecution execution) {
        // 获取流程定义信息
        String processDefinitionId = execution.getProcessDefinitionId();
        String processInstanceId = execution.getProcessInstanceId();
        
        // 获取流程变量
        String applicant = (String) execution.getVariable("applicant");
        
        // 获取当前节点信息
        String currentActivityId = execution.getCurrentActivityId();
        
        System.out.println(String.format(
            "流程启动: processInstanceId=%s, activity=%s, applicant=%s",
            processInstanceId, currentActivityId, applicant
        ));
        
        // 执行自定义逻辑
        sendNotification(applicant, "您的申请已提交");
        initializeProcessData(execution);
    }
    
    private void sendNotification(String user, String message) {
        // 发送通知逻辑
    }
    
    private void initializeProcessData(DelegateExecution execution) {
        // 初始化流程数据
        execution.setVariable("startTime", new Date());
        execution.setVariable("status", "PROCESSING");
    }
}
```

### 监听器中的表达式

```xml
<!-- 使用表达式替代 Java 类 -->
<userTask id="task1">
    <extensionElements>
        <!-- 调用 Spring Bean 的方法 -->
        <flowable:executionListener event="start" 
            expression="${notificationService.sendStartNotification(execution)}"/>
        
        <!-- 也可以使用 delegateExpression（支持注入） -->
        <flowable:executionListener event="end" 
            delegateExpression="${taskEndListener}"/>
    </extensionElements>
</userTask>
```

```java
/**
 * 支持表达式调用的 Bean
 */
@Service("notificationService")
public class NotificationService {
    
    public void sendStartNotification(DelegateExecution execution) {
        String applicant = (String) execution.getVariable("applicant");
        // 发送通知...
    }
}

@Component("taskEndListener")
public class TaskEndListener implements ExecutionListener {
    
    @Autowired
    private HistoryService historyService;
    
    @Override
    public void notify(DelegateExecution execution) {
        // 使用注入的服务
    }
}
```

---

## 任务监听器（TaskListener）

### 监听事件类型

任务监听器专门监听任务的生命周期事件：

| 事件 | 触发时机 | 典型用途 |
|---|---|---|
| `create` | 任务创建时 | 发送通知、设置候选人 |
| `assignment` | 任务分配时 | 记录分配日志、触发事件 |
| `complete` | 任务完成时 | 更新业务数据、触发后续流程 |
| `delete` | 任务删除时 | 清理关联数据 |

```xml
<!-- 任务监听器配置 -->
<userTask id="managerApproval" name="经理审批">
    <extensionElements>
        <!-- 任务创建时 -->
        <flowable:taskListener event="create" 
            class="com.example.listener.TaskCreateListener"/>
        
        <!-- 任务分配时 -->
        <flowable:taskListener event="assignment" 
            class="com.example.listener.TaskAssignmentListener"/>
        
        <!-- 任务完成时 -->
        <flowable:taskListener event="complete" 
            class="com.example.listener.TaskCompleteListener"/>
    </extensionElements>
</userTask>
```

### 监听器实现

```java
/**
 * 任务创建监听器
 */
public class TaskCreateListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        // 事件名称
        String eventName = delegateTask.getEventName();
        
        // 任务信息
        String taskId = delegateTask.getId();
        String taskName = delegateTask.getName();
        
        // 流程变量
        String applicant = (String) delegateTask.getVariable("applicant");
        Integer amount = (Integer) delegateTask.getVariable("amount");
        
        // 动态设置候选人
        if (amount != null && amount &gt; 10000) {
            // 大额需要总监审批
            delegateTask.addCandidateUser("director");
        } else {
            // 普通金额主管审批
            delegateTask.addCandidateUser("manager");
        }
        
        // 设置优先级
        if (amount != null && amount &gt; 50000) {
            delegateTask.setPriority(100);  // 最高优先级
        } else if (amount != null && amount &gt; 10000) {
            delegateTask.setPriority(50);
        }
        
        // 发送通知
        notifyApprover(delegateTask);
    }
    
    private void notifyApprover(DelegateTask task) {
        // 查找候选人
        Set&lt;String&gt; candidates = task.getCandidates().stream()
            .map(IdentityLink::getUserId)
            .collect(Collectors.toSet());
        
        for (String candidate : candidates) {
            System.out.println("通知用户 " + candidate + ": 您有新的审批任务");
        }
    }
}

/**
 * 任务分配监听器
 */
public class TaskAssignmentListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        String assignee = delegateTask.getAssignee();
        String taskId = delegateTask.getId();
        
        System.out.println("任务已分配: taskId=" + taskId + ", assignee=" + assignee);
        
        // 记录分配日志
        saveAssignmentLog(delegateTask);
        
        // 锁定相关业务记录
        lockBusinessRecord(delegateTask);
    }
    
    private void saveAssignmentLog(DelegateTask task) {
        String businessKey = getBusinessKey(task);
        String assignee = task.getAssignee();
        
        // 保存分配记录
    }
    
    private void lockBusinessRecord(DelegateTask task) {
        // 锁定业务数据，防止重复处理
    }
}

/**
 * 任务完成监听器
 */
public class TaskCompleteListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        String taskId = delegateTask.getId();
        
        // 获取完成时设置的变量
        Boolean approved = (Boolean) delegateTask.getVariable("approved");
        String comment = (String) delegateTask.getVariable("approvalComment");
        
        // 更新业务数据
        updateBusinessData(delegateTask);
        
        // 发送结果通知
        notifyApplicant(delegateTask, approved, comment);
        
        // 释放业务锁定
        releaseBusinessLock(delegateTask);
    }
    
    private void updateBusinessData(DelegateTask task) {
        String businessKey = getBusinessKey(task);
        Boolean approved = (Boolean) task.getVariable("approved");
        
        // 根据审批结果更新业务状态
    }
    
    private void notifyApplicant(DelegateTask task, Boolean approved, String comment) {
        String applicant = (String) task.getVariable("applicant");
        String message = approved ? "您的申请已通过" : "您的申请未通过: " + comment;
        
        // 发送通知给申请人
    }
    
    private void releaseBusinessLock(DelegateTask task) {
        // 释放业务数据锁定
    }
}
```

---

## 事件监听的高级用法

### 监听变量变更

Flowable 6.x 提供了专门的变量变更监听器：

```java
/**
 * 变量变更监听器
 * 监听流程变量的变化
 */
public class VariableChangeListener {
    
    /**
     * 监听单个变量变化
     */
    public void onVariableChange(String processInstanceId, 
                                  String variableName, 
                                  Object oldValue, 
                                  Object newValue) {
        System.out.println(String.format(
            "变量变更: %s, %s → %s", 
            variableName, oldValue, newValue
        ));
        
        // 记录变更日志
        saveVariableChangeLog(processInstanceId, variableName, oldValue, newValue);
        
        // 触发联动逻辑
        if ("amount".equals(variableName)) {
            recalculateRelatedFields(processInstanceId, (Integer) newValue);
        }
    }
}
```

```xml
<!-- BPMN 中配置变量监听 -->
<userTask id="task1">
    <extensionElements>
        <!-- 监听特定变量的变更 -->
        <flowable:executionListener 
            event="start" 
            expression="${variableListener.onAmountChange(execution)}"/>
    </extensionElements>
</userTask>
```

### 全局事件监听器

除了在 BPMN 中配置监听器，还可以注册全局监听器来监听所有流程的事件：

```java
/**
 * 全局事件监听器
 * 实现 ProcessEngineConfiguration 中注册
 */
@Configuration
public class FlowableEventConfig {
    
    @Autowired
    private ProcessEngine processEngine;
    
    @PostConstruct
    public void initGlobalListener() {
        RuntimeService runtimeService = processEngine.getRuntimeService();
        
        // 添加全局运行时监听器
        runtimeService.addEventListener(new GlobalRuntimeEventListener());
    }
    
    @Autowired
    private HistoryService historyService;
    
    @PostConstruct
    public void initHistoryListener() {
        // 添加全局历史监听器
        historyService.addHistoricProcessInstanceListener(
            new GlobalHistoryEventListener());
    }
}

class GlobalRuntimeEventListener implements org.flowable.engine.delegate.BaseEntityEventListener {
    
    @Override
    public void onEvent(FlowableEvent event) {
        FlowableEventType type = event.getType();
        
        if (FlowableEventType.PROCESS_STARTED.equals(type)) {
            System.out.println("流程启动（全局）");
        } else if (FlowableEventType.TASK_CREATED.equals(type)) {
            System.out.println("任务创建（全局）");
        } else if (FlowableEventType.TASK_COMPLETED.equals(type)) {
            System.out.println("任务完成（全局）");
        } else if (FlowableEventType.PROCESS_COMPLETED.equals(type)) {
            System.out.println("流程结束（全局）");
        }
    }
    
    @Override
    public boolean isFailOnException() {
        return false;  // 监听器异常不影响流程执行
    }
}
```

### 条件监听

有时候你只想在特定条件下触发监听器：

```java
/**
 * 条件监听器实现
 */
public class ConditionalTaskListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        // 获取流程变量
        Integer amount = (Integer) delegateTask.getVariable("amount");
        String category = (String) delegateTask.getVariable("category");
        
        // 条件判断
        boolean shouldNotify = false;
        
        // 金额超过5万或特定类别需要额外通知
        if (amount != null && amount &gt; 50000) {
            shouldNotify = true;
        }
        if ("特殊采购".equals(category)) {
            shouldNotify = true;
        }
        
        if (shouldNotify) {
            sendUrgentNotification(delegateTask);
        }
    }
}
```

---

## 监听器与事务

### 监听器中的事务处理

```java
/**
 * 监听器中需要注意事务边界
 * 监听器代码和流程执行在同一个事务中
 */
public class TransactionAwareListener implements TaskListener {
    
    @Autowired
    private BusinessService businessService;
    
    @Override
    public void notify(DelegateTask delegateTask) {
        try {
            // 业务操作（会在流程事务中执行）
            businessService.updateStatus(delegateTask);
            
        } catch (Exception e) {
            // 监听器异常会导致整个事务回滚
            // 如果不希望影响流程，需要捕获异常
            log.error("监听器执行失败", e);
        }
    }
}

/**
 * 如果监听器需要独立事务
 */
@Service
public class AsyncTaskListener {
    
    /**
     * 使用 @TransactionalEventListener
     * 在事务提交后再处理
     */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onTaskCompleted(TaskCompletedEvent event) {
        // 这里的代码会在流程事务提交后执行
        // 如果这里失败，不会影响流程
        sendEmail(event);
    }
}
```

### 异步监听器

如果监听器执行时间较长，可以使用异步监听器：

```xml
<userTask id="task1">
    <extensionElements>
        <!-- async="true" 使监听器异步执行 -->
        <flowable:taskListener event="complete" 
            async="true"
            class="com.example.listener.HeavyTaskListener"/>
    </extensionElements>
</userTask>
```

---

## 实际应用场景

### 场景1：自动发送通知

```java
/**
 * 任务通知服务
 */
@Service
public class TaskNotificationService {
    
    public void notifyNewTask(DelegateTask task) {
        // 查找候选人
        Set&lt;String&gt; candidates = findCandidates(task);
        
        for (String candidate : candidates) {
            TaskNotification notification = new TaskNotification();
            notification.setUserId(candidate);
            notification.setTaskId(task.getId());
            notification.setTaskName(task.getName());
            notification.setMessage(buildMessage(task));
            
            // 发送通知
            sendNotification(notification);
        }
    }
    
    public void notifyTaskCompleted(DelegateTask task) {
        // 通知申请人
        String applicant = (String) task.getVariable("applicant");
        
        TaskNotification notification = new TaskNotification();
        notification.setUserId(applicant);
        notification.setMessage(buildCompletionMessage(task));
        
        sendNotification(notification);
    }
    
    private String buildMessage(DelegateTask task) {
        Integer amount = (Integer) task.getVariable("amount");
        return String.format("您有新的审批任务：金额 %s 元", amount);
    }
    
    private String buildCompletionMessage(DelegateTask task) {
        Boolean approved = (Boolean) task.getVariable("approved");
        return approved ? "您的申请已通过" : "您的申请未通过";
    }
}
```

### 场景2：业务数据同步

```java
/**
 * 任务完成时同步业务数据
 */
public class BusinessSyncListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        if (!TaskListener.EVENTNAME_COMPLETE.equals(delegateTask.getEventName())) {
            return;
        }
        
        String businessKey = getBusinessKey(delegateTask);
        Boolean approved = (Boolean) delegateTask.getVariable("approved");
        
        if (approved) {
            // 审批通过，更新业务状态
            updateBusinessStatus(businessKey, "APPROVED");
            
            // 触发后续业务动作
            triggerFollowUpAction(businessKey);
        } else {
            // 审批拒绝
            updateBusinessStatus(businessKey, "REJECTED");
            
            // 通知相关方
            notifyRejection(businessKey);
        }
    }
    
    private String getBusinessKey(DelegateTask task) {
        String processInstanceId = task.getProcessInstanceId();
        return runtimeService.createProcessInstanceQuery()
            .processInstanceId(processInstanceId)
            .singleResult()
            .getBusinessKey();
    }
}
```

---

## 总结：监听器使用指南

| 监听器类型 | 适用场景 | 注意事项 |
|---|---|---|
| 执行监听器（流程级） | 流程启动/结束通知、统计 | 不要在 start 事件中读取未初始化的变量 |
| 执行监听器（活动级） | 节点进入/离开的日志、监控 | 注意事务边界，长时间操作用异步 |
| 任务监听器（create） | 设置候选人、优先级、发送通知 | 可以修改任务属性 |
| 任务监听器（assignment） | 记录分配日志、触发联动 | 候选人变更时也会触发 |
| 任务监听器（complete） | 更新业务数据、触发后续流程 | 可以获取任务结果变量 |
| 全局监听器 | 统一日志、审计、监控 | 需要过滤不需要的事件 |

---

## 留给你的问题

假设你要实现一个完整的「审批审计日志」功能：

1. 记录每个任务何时被创建、分配给谁、何时完成
2. 记录任务完成时的审批结果和意见
3. 记录流程变量的关键变更（如金额修改）
4. 这些日志需要持久化，用于后续审计查询

**问题来了：**

1. 监听器中直接写数据库日志，会不会影响流程的事务？如果监听器抛出异常，流程会回滚吗？
2. 如何避免重复记录？比如任务 `complete` 事件触发时，任务已经被标记完成了，这时查询任务状态是已完成的——如何获取「完成前」的数据？
3. 如果流程需要支持「撤回」操作，撤回后之前记录的审计日志怎么处理？

这三个问题涉及到**事务一致性**、**事件时序**和**数据回滚**，是审计系统设计的核心挑战。
