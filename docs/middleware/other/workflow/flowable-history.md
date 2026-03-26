# Flowable 活动与历史：流程追踪与审计

Flowable 的历史服务是流程追踪和审计的基础。

当流程运行结束后，运行时的数据会被删除，但历史数据会被保留下来。

这篇文章介绍 Flowable 的历史服务和流程追踪功能。

---

## 历史级别配置

### 历史级别

| 级别 | 说明 | 存储内容 |
|---|---|---|
| none | 不记录历史 | 无 |
| activity | 仅记录活动 | 活动名称、开始/结束时间 |
| audit | 审计级别 | 活动 + 变量变更 |
| full | 完整历史 | 活动 + 变量 + 表单属性 + 任务详情 |

### 配置方式

```yaml
# application.yml
flowable:
  history-level: full  # 开发环境
  # 生产环境推荐使用 audit
  # history-level: audit
```

或通过代码配置：

```java
config.setHistoryLevel(HistoryLevel.FULL);
```

---

## 历史服务

### HistoryService

```java
@Autowired
private HistoryService historyService;

/**
 * 查询历史流程实例
 */
@Test
public void queryHistoricProcessInstances() {
    List&lt;HistoricProcessInstance&gt; instances = historyService
        .createHistoricProcessInstanceQuery()
        .processDefinitionKey("expenseApproval")
        .finished()  // 已结束的
        .list();
    
    for (HistoricProcessInstance instance : instances) {
        System.out.println("流程定义ID: " + instance.getProcessDefinitionId());
        System.out.println("开始时间: " + instance.getStartTime());
        System.out.println("结束时间: " + instance.getEndTime());
        System.out.println("持续时间: " + instance.getDurationInMillis() + "ms");
        System.out.println("删除原因: " + instance.getDeleteReason());
    }
}
```

### 查询历史活动

```java
/**
 * 查询历史活动
 */
@Test
public void queryHistoricActivities() {
    List&lt;HistoricActivityInstance&gt; activities = historyService
        .createHistoricActivityInstanceQuery()
        .processInstanceId("processInstanceId")
        .orderByHistoricActivityInstanceStartTime()
        .asc()
        .list();
    
    for (HistoricActivityInstance activity : activities) {
        System.out.println("活动ID: " + activity.getActivityId());
        System.out.println("活动名称: " + activity.getActivityName());
        System.out.println("活动类型: " + activity.getActivityType());
        System.out.println("开始时间: " + activity.getStartTime());
        System.out.println("结束时间: " + activity.getEndTime());
    }
}
```

### 查询历史任务

```java
/**
 * 查询历史任务
 */
@Test
public void queryHistoricTasks() {
    List&lt;HistoricTaskInstance&gt; tasks = historyService
        .createHistoricTaskInstanceQuery()
        .processInstanceId("processInstanceId")
        .finished()
        .list();
    
    for (HistoricTaskInstance task : tasks) {
        System.out.println("任务名称: " + task.getName());
        System.out.println("处理人: " + task.getAssignee());
        System.out.println("开始时间: " + task.getStartTime());
        System.out.println("结束时间: " + task.getEndTime());
        System.out.println("持续时间: " + task.getDurationInMillis() + "ms");
    }
}
```

### 查询历史变量

```java
/**
 * 查询历史变量
 */
@Test
public void queryHistoricVariables() {
    List&lt;HistoricVariableInstance&gt; variables = historyService
        .createHistoricVariableInstanceQuery()
        .processInstanceId("processInstanceId")
        .list();
    
    for (HistoricVariableInstance variable : variables) {
        System.out.println("变量名: " + variable.getVariableName());
        System.out.println("变量值: " + variable.getValue());
        System.out.println("类型: " + variable.getVariableTypeName());
    }
}
```

---

## 流程追踪

### 获取流程时间线

```java
/**
 * 获取流程执行时间线
 */
public List&lt;TimelineEvent&gt; getProcessTimeline(String processInstanceId) {
    List&lt;TimelineEvent&gt; timeline = new ArrayList&lt;&gt;();
    
    // 查询历史活动
    List&lt;HistoricActivityInstance&gt; activities = historyService
        .createHistoricActivityInstanceQuery()
        .processInstanceId(processInstanceId)
        .orderByHistoricActivityInstanceStartTime()
        .asc()
        .list();
    
    for (HistoricActivityInstance activity : activities) {
        TimelineEvent event = new TimelineEvent();
        event.setTime(activity.getStartTime());
        event.setType("activity");
        event.setName(activity.getActivityName());
        event.setDetails(getActivityDetails(activity));
        timeline.add(event);
    }
    
    return timeline;
}

/**
 * 获取活动详情
 */
private Map&lt;String, Object&gt; getActivityDetails(HistoricActivityInstance activity) {
    Map&lt;String, Object&gt; details = new HashMap&lt;&gt;();
    
    // 获取该活动相关的变量
    List&lt;HistoricVariableInstance&gt; variables = historyService
        .createHistoricVariableInstanceQuery()
        .activityInstanceId(activity.getId())
        .list();
    
    for (HistoricVariableInstance variable : variables) {
        details.put(variable.getVariableName(), variable.getValue());
    }
    
    return details;
}
```

### 获取审批轨迹

```java
/**
 * 获取审批轨迹
 */
public List&lt;ApprovalRecord&gt; getApprovalTrail(String processInstanceId) {
    List&lt;ApprovalRecord&gt; records = new ArrayList&lt;&gt;();
    
    // 查询历史任务
    List&lt;HistoricTaskInstance&gt; tasks = historyService
        .createHistoricTaskInstanceQuery()
        .processInstanceId(processInstanceId)
        .taskNameLike("%审批%")
        .finished()
        .orderByHistoricTaskInstanceEndTime()
        .asc()
        .list();
    
    for (HistoricTaskInstance task : tasks) {
        ApprovalRecord record = new ApprovalRecord();
        record.setTaskName(task.getName());
        record.setAssignee(task.getAssignee());
        record.setStartTime(task.getStartTime());
        record.setEndTime(task.getEndTime());
        record.setDuration(task.getDurationInMillis());
        
        // 获取审批结果
        HistoricVariableInstance approved = historyService
            .createHistoricVariableInstanceQuery()
            .taskId(task.getId())
            .variableName("approved")
            .singleResult();
        
        if (approved != null) {
            record.setApproved((Boolean) approved.getValue());
        }
        
        // 获取审批意见
        HistoricVariableInstance comment = historyService
            .createHistoricVariableInstanceQuery()
            .taskId(task.getId())
            .variableName("comment")
            .singleResult();
        
        if (comment != null) {
            record.setComment((String) comment.getValue());
        }
        
        records.add(record);
    }
    
    return records;
}
```

---

## 审计日志

### 启用审计日志

```yaml
flowable:
  history-level: audit
  # 启用审计日志
  audit-map-beans: |
    auditMapService: com.example.service.AuditMapService
```

### 自定义审计日志

```java
/**
 * 自定义审计日志服务
 */
@Component
public class AuditLogService {
    
    @Autowired
    private HistoryService historyService;
    
    /**
     * 记录操作日志
     */
    public void logOperation(String userId, String operation, String targetType, String targetId) {
        // 查询操作人信息
        User user = identityService.createUserQuery()
            .userId(userId)
            .singleResult();
        
        // 记录日志
        AuditLog log = new AuditLog();
        log.setUserId(userId);
        log.setUserName(user.getFirstName() + " " + user.getLastName());
        log.setOperation(operation);
        log.setTargetType(targetType);
        log.setTargetId(targetId);
        log.setTimestamp(new Date());
        
        auditLogRepository.save(log);
    }
    
    /**
     * 查询审计日志
     */
    public Page&lt;AuditLog&gt; queryLogs(String userId, Date startDate, Date endDate, int page, int size) {
        // 查询逻辑...
        return null;
    }
}

/**
 * 任务完成监听器：记录审计日志
 */
@Component
public class AuditTaskListener implements TaskListener {
    
    @Autowired
    private AuditLogService auditLogService;
    
    @Override
    public void notify(DelegateTask delegateTask) {
        if ("complete".equals(delegateTask.getEventName())) {
            String userId = delegateTask.getAssignee();
            String taskName = delegateTask.getName();
            String processInstanceId = delegateTask.getProcessInstanceId();
            
            Boolean approved = (Boolean) delegateTask.getVariable("approved");
            String comment = (String) delegateTask.getVariable("comment");
            
            auditLogService.logOperation(
                userId,
                "TASK_COMPLETE",
                "Task",
                delegateTask.getId()
            );
        }
    }
}
```

---

## 统计分析

### 流程统计

```java
/**
 * 获取流程统计
 */
public Map&lt;String, Object&gt; getProcessStatistics() {
    Map&lt;String, Object&gt; stats = new HashMap&lt;&gt;();
    
    // 按流程定义统计
    List&lt;ProcessDefinition&gt; definitions = repositoryService
        .createProcessDefinitionQuery()
        .list();
    
    List&lt;Map&lt;String, Object&gt;&gt; processStats = new ArrayList&lt;&gt;();
    for (ProcessDefinition def : definitions) {
        Map&lt;String, Object&gt; defStat = new HashMap&lt;&gt;();
        defStat.put("key", def.getKey());
        defStat.put("name", def.getName());
        defStat.put("version", def.getVersion());
        
        // 运行中实例数
        long runningCount = runtimeService
            .createProcessInstanceQuery()
            .processDefinitionId(def.getId())
            .active()
            .count();
        defStat.put("runningCount", runningCount);
        
        // 已结束实例数
        long finishedCount = historyService
            .createHistoricProcessInstanceQuery()
            .processDefinitionId(def.getId())
            .finished()
            .count();
        defStat.put("finishedCount", finishedCount);
        
        // 平均处理时长
        Double avgDuration = historyService
            .createHistoricProcessInstanceQuery()
            .processDefinitionId(def.getId())
            .completed()
            .singleResult()
            .getDurationInMillis();
        // 实际应该计算平均值...
        defStat.put("avgDuration", avgDuration);
        
        processStats.add(defStat);
    }
    
    stats.put("processes", processStats);
    return stats;
}
```

### 用户任务统计

```java
/**
 * 获取用户任务统计
 */
public Map&lt;String, Object&gt; getUserTaskStatistics(String userId) {
    Map&lt;String, Object&gt; stats = new HashMap&lt;&gt;();
    
    // 待处理任务数
    long pendingCount = taskService
        .createTaskQuery()
        .taskAssignee(userId)
        .active()
        .count();
    stats.put("pendingCount", pendingCount);
    
    // 本月完成任务数
    Calendar cal = Calendar.getInstance();
    cal.set(Calendar.DAY_OF_MONTH, 1);
    cal.set(Calendar.HOUR_OF_DAY, 0);
    cal.set(Calendar.MINUTE, 0);
    cal.set(Calendar.SECOND, 0);
    
    long completedCount = historyService
        .createHistoricTaskInstanceQuery()
        .taskAssignee(userId)
        .completedAfter(cal.getTime())
        .count();
    stats.put("completedThisMonth", completedCount);
    
    // 平均任务处理时长
    List&lt;HistoricTaskInstance&gt; tasks = historyService
        .createHistoricTaskInstanceQuery()
        .taskAssignee(userId)
        .completedAfter(cal.getTime())
        .list();
    
    if (!tasks.isEmpty()) {
        long totalDuration = tasks.stream()
            .mapToLong(HistoricTaskInstance::getDurationInMillis)
            .sum();
        stats.put("avgTaskDuration", totalDuration / tasks.size());
    }
    
    return stats;
}
```

---

## 总结

| 功能 | API |
|---|---|
| 历史流程实例 | `HistoryService.createHistoricProcessInstanceQuery()` |
| 历史活动 | `HistoryService.createHistoricActivityInstanceQuery()` |
| 历史任务 | `HistoryService.createHistoricTaskInstanceQuery()` |
| 历史变量 | `HistoryService.createHistoricVariableInstanceQuery()` |
| 流程追踪 | 结合历史活动和变量查询 |
| 审计日志 | 自定义实现或使用历史服务 |

---

## 留给你的问题

假设你需要实现一个流程审计功能，要求：

1. 记录所有任务的开始和完成时间
2. 记录所有审批意见和结果
3. 记录流程变量的变更历史
4. 支持按时间、用户、流程类型等维度查询

**你会怎么设计这个审计系统？**

Flowable 的历史服务能完全满足需求吗？还是需要额外的审计表？
