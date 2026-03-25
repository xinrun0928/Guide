# Flowable 用户任务：签收任务、完成任务、任务代理与委派

用户任务是 BPMN 中最核心的元素之一——它代表需要人工处理的步骤。

当流程执行到用户任务时，会停下来，等待某个人（或者某些人）去处理这个任务。

这篇文章带你彻底搞懂 Flowable 中用户任务的各种玩法。

---

## 用户任务基础

### 什么是用户任务？

用户任务（User Task）是一种活动类型，它需要人工参与才能继续流程。

```
┌─────────────────────────────────────────┐
│                                         │
│            用户任务                      │
│    ┌───────────────────────────┐         │
│    │  主管审批                  │         │
│    │  候选人: zhangsan, lisi   │         │
│    │  创建时间: 2024-01-15     │         │
│    └───────────────────────────┘         │
│                                         │
└─────────────────────────────────────────┘
```

### BPMN 定义

```xml
<userTask id="managerApproval" name="主管审批">
    <documentation>报销金额超过1万的审批</documentation>
    
    <!-- 候选用户（可以是多个） -->
    <potentialOwner>
        <resourceAssignmentExpression>
            <formalExpression>user(zhangsan), user(lisi)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
    
    <!-- 或者使用候选组 -->
    <potentialOwner>
        <resourceAssignmentExpression>
            <formalExpression>group(manager)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
    
</userTask>
```

---

## 任务查询

### 基础查询

```java
TaskService taskService = processEngine.getTaskService();

// 查询所有任务
List&lt;Task&gt; allTasks = taskService.createTaskQuery().list();

// 按任务ID查询
Task task = taskService.createTaskQuery()
    .taskId("taskId123")
    .singleResult();
```

### 按候选人查询

```java
/**
 * 查询某个用户待办的任务（该用户是候选人或 assignee）
 */
public List&lt;Task&gt; findTasksForUser(String userId) {
    return taskService.createTaskQuery()
        .taskCandidateOrAssigned(userId)
        .list();
}

/**
 * 查询某个用户作为候选人的任务
 */
public List&lt;Task&gt; findCandidateTasks(String userId) {
    return taskService.createTaskQuery()
        .taskCandidateUser(userId)
        .list();
}

/**
 * 查询某个组的任务
 */
public List&lt;Task&gt; findTasksByGroup(String groupId) {
    return taskService.createTaskQuery()
        .taskCandidateGroup(groupId)
        .list();
}
```

### 按流程实例查询

```java
/**
 * 查询某个流程实例的所有任务
 */
public List&lt;Task&gt; findTasksByProcessInstance(String processInstanceId) {
    return taskService.createTaskQuery()
        .processInstanceId(processInstanceId)
        .list();
}

/**
 * 按业务 Key 查询任务
 * 业务 Key 通常是订单号、申请单号等业务标识
 */
public List&lt;Task&gt; findTasksByBusinessKey(String businessKey) {
    return taskService.createTaskQuery()
        .processInstanceBusinessKey(businessKey)
        .list();
}
```

### 条件组合查询

```java
/**
 * 组合条件查询
 */
public List&lt;Task&gt; complexQuery() {
    return taskService.createTaskQuery()
        .taskCandidateUser("zhangsan")        // 候选人
        .taskName("主管审批")                  // 任务名称
        .taskCreatedAfter(startDate)          // 创建时间
        .taskCreatedBefore(endDate)           // 创建时间
        .processDefinitionKey("expenseApproval") // 流程定义 Key
        .taskPriority(High)                   // 优先级
        .list();
}
```

---

## 签收任务

### 概念解释

**候选任务 vs 已签收任务**：
- **候选任务（Candidate Task）**：任务池中的任务，多个人都可以看到，但还没人处理
- **已签收任务（Claimed Task）**：被某个人「认领」了，其他人就看不到了

```
候选任务池:  [张三] [李四] [王五] 都可以看到任务A
                    ↓
              张三签收（claim）
                    ↓
已签收任务: 张三 ← 任务A
候选任务池: [李四] [王五]  ← 看不到了
```

### 签收操作

```java
/**
 * 签收任务
 * 将候选任务分配给自己，变成自己的待办任务
 */
@Test
public void claimTask() {
    String taskId = "taskId123";
    String userId = "zhangsan";
    
    // 签收任务
    taskService.claim(taskId, userId);
    
    // 现在这个任务只能 zhangsan 看到了
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    System.out.println("Assignee: " + task.getAssignee()); // zhangsan
}

/**
 * 查询已签收给自己的任务
 */
public List&lt;Task&gt; findMyClaimedTasks(String userId) {
    return taskService.createTaskQuery()
        .taskAssignee(userId)
        .list();
}
```

### 取消签收

```java
/**
 * 取消签收
 * 将任务归还到候选池
 */
@Test
public void unclaimTask() {
    String taskId = "taskId123";
    
    // 设置 assignee 为 null，即取消签收
    taskService.setAssignee(taskId, null);
    
    // 或者使用 unclaim 方法
    // taskService.unclaim(taskId);
}
```

### 转让任务

```java
/**
 * 转让任务
 * 把任务从 A 转给 B
 */
@Test
public void delegateTask() {
    String taskId = "taskId123";
    String fromUser = "zhangsan";
    String toUser = "lisi";
    
    // 转让任务后，toUser 成为新的 assignee
    // fromUser 会在任务完成后收到通知
    taskService.delegateTask(taskId, toUser);
    
    // 查询转让后的任务
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    System.out.println("Assignee: " + task.getAssignee()); // lisi
    System.out.println("Owner: " + task.getOwner());        // zhangsan
}
```

---

## 完成任务

### 基础完成

```java
/**
 * 完成任务
 * 这是最基础的操作，表示任务处理完毕，流程继续往下走
 */
@Test
public void completeTask() {
    String taskId = "taskId123";
    
    // 简单完成
    taskService.complete(taskId);
    
    // 流程会继续往下执行
}

/**
 * 带变量的任务完成
 * 可以在完成任务时设置流程变量，供后续节点使用
 */
@Test
public void completeTaskWithVariables() {
    String taskId = "taskId123";
    
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("approved", true);
    variables.put("approvalComment", "同意报销");
    variables.put("approvalAmount", 15000);
    
    // 完成任务并设置变量
    taskService.complete(taskId, variables);
}
```

### 完整审批流程示例

```java
@Service
public class ApprovalWorkflowService {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 查询用户的待办任务
     */
    public List&lt;Task&gt; getMyTasks(String userId) {
        return taskService.createTaskQuery()
            .taskAssignee(userId)
            .active()
            .list();
    }
    
    /**
     * 审批任务
     */
    public void approve(String taskId, ApprovalRequest request) {
        // 校验任务是否存在
        Task task = taskService.createTaskQuery()
            .taskId(taskId)
            .singleResult();
        
        if (task == null) {
            throw new RuntimeException("任务不存在: " + taskId);
        }
        
        // 校验权限（只有 assignee 才能审批）
        String currentUser = SecurityContext.getCurrentUser();
        if (!currentUser.equals(task.getAssignee())) {
            throw new RuntimeException("无权限操作此任务");
        }
        
        // 设置审批变量
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("approved", request.isApproved());
        variables.put("approvalComment", request.getComment());
        variables.put("approvalTime", new Date());
        variables.put("approver", currentUser);
        
        // 完成任务
        taskService.complete(taskId, variables);
    }
    
    /**
     * 驳回任务（流程回到起点或指定节点）
     */
    public void reject(String taskId, String reason) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("approved", false);
        variables.put("rejectionReason", reason);
        
        // 完成任务，但流程会根据变量走向驳回分支
        taskService.complete(taskId, variables);
    }
}
```

---

## 任务代理与委派（Delegate）

### 概念区分

| 概念 | 说明 | 类比 |
|---|---|---|
| **Assignee（处理人）** | 当前负责执行任务的人 | 「这件事归谁干」 |
| **Owner（委托人）** | 发起委托的人 | 「这件事原本是谁的」 |
| **Delegation（委托状态）** | PENDING（待处理）/ RESOLVED（已处理） | 委托是否已完成 |

### 委托任务

```java
/**
 * 委托任务
 * 张三把任务委托给李四
 * 
 * 结果：
 * - Owner = 张三
 * - Assignee = 李四
 * - Delegation = PENDING
 * 
 * 李四完成后，任务会回到张三手中
 */
@Test
public void delegateTask() {
    String taskId = "taskId123";
    String owner = "zhangsan";
    String delegatee = "lisi";
    
    // 委托
    taskService.delegateTask(taskId, delegatee);
    
    // 查看任务状态
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    System.out.println("Owner: " + task.getOwner());           // zhangsan
    System.out.println("Assignee: " + task.getAssignee());      // lisi
    System.out.println("Delegation: " + task.getDelegationState()); // PENDING
}

/**
 * 被委托人完成任务
 */
@Test
public void resolveTask() {
    String taskId = "taskId123";
    
    // 李四完成任务
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("delegateComment", "已处理，请审核");
    
    // resolveTask：完成任务并标记委托已解决
    // 任务会回到 owner（张三）手中
    taskService.resolveTask(taskId, variables);
}

/**
 * 委托任务（不合并），继续往下走
 * 有时候委托人不希望任务再回来，而是直接完成
 */
@Test
public void delegateAndComplete() {
    String taskId = "taskId123";
    
    // 设置 assignee 为委托人自己
    String owner = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult()
        .getOwner();
    
    // 重新签收
    taskService.setAssignee(taskId, owner);
    
    // 然后完成任务，流程继续往下走
    taskService.complete(taskId);
}
```

### 三种分配模式对比

```
模式1: 直接分配
┌─────────┐    签收     ┌─────────┐
│ 候选池   │ ────────→ │ 张三处理 │
└─────────┘            └────┬────┘
                            │ 完成
                            ↓
                       流程继续

模式2: 委托
┌─────────┐    委托     ┌─────────┐
│ 张三     │ ────────→ │ 李四处理 │
└────┬────┘            └────┬────┘
     │ (Owner)              │ (Assignee)
     │                      │ 完成（resolveTask）
     │ ← ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘
     │ (任务回到 Owner)
     │ 完成
     ↓
流程继续

模式3: 转让
┌─────────┐    转让     ┌─────────┐
│ 张三     │ ────────→ │ 李四处理 │
└─────────┘  (setAssignee) └────┬────┘
     │                          │ 完成
     │                          ↓
     │                     流程继续
     ↓
   任务消失
```

---

## 任务监听器

### BPMN 定义

```xml
<userTask id="managerApproval" name="主管审批">
    <!-- 任务创建时触发 -->
    <extensionElements>
        <flowable:taskListener event="create" 
                               class="com.example.listener.ManagerApprovalTaskListener"/>
        <flowable:taskListener event="assignment" 
                               class="com.example.listener.AssignmentListener"/>
        <flowable:taskListener event="complete" 
                               class="com.example.listener.CompleteListener"/>
    </extensionElements>
</userTask>
```

### 监听器实现

```java
/**
 * 任务监听器：监听任务创建、分配、完成等事件
 */
public class ManagerApprovalTaskListener implements TaskListener {
    
    @Override
    public void notify(DelegateTask delegateTask) {
        // 获取流程变量
        String applyUser = (String) delegateTask.getVariable("applyUser");
        Integer amount = (Integer) delegateTask.getVariable("amount");
        
        // 任务创建时的处理
        if (TaskListener.EVENTNAME_CREATE.equals(delegateTask.getEventName())) {
            // 设置任务优先级
            if (amount != null && amount > 100000) {
                delegateTask.setPriority(High);
            }
            
            // 发送通知
            sendNotification(applyUser, "您有一个新的审批任务");
        }
        
        // 任务完成时的处理
        if (TaskListener.EVENTNAME_COMPLETE.equals(delegateTask.getEventName())) {
            // 更新业务数据
            updateBusinessData(delegateTask);
        }
    }
    
    private void sendNotification(String user, String message) {
        // 发送通知逻辑
    }
    
    private void updateBusinessData(DelegateTask delegateTask) {
        // 更新业务数据逻辑
    }
}
```

---

## 总结：用户任务操作速查

| 操作 | 方法 | 说明 |
|---|---|---|
| 查询候选任务 | `taskCandidateUser(userId)` | 该用户可以签收的任务 |
| 查询待办任务 | `taskAssignee(userId)` | 该用户已签收的任务 |
| 签收任务 | `taskService.claim(taskId, userId)` | 从候选池领任务 |
| 取消签收 | `taskService.unclaim(taskId)` | 归还到候选池 |
| 转让任务 | `taskService.delegateTask(taskId, userId)` | 委托他人处理，完成后回来 |
| 完成任务 | `taskService.complete(taskId)` | 任务完成，流程继续 |
| 带变量完成 | `taskService.complete(taskId, variables)` | 完成时设置流程变量 |

---

## 留给你的问题

假设你在实现一个 OA 审批系统，有这样一个场景：

员工提交报销申请后，主管需要审批。但主管 A 今天请假了，他想把自己的工作委托给主管 B。

问题来了：
1. 主管 A 直接「转让」任务给 B —— 那么 A 就再也看不到这个任务了
2. 主管 A 使用「委托」功能 —— B 处理完后，任务会回到 A 手中

但在实际的 OA 场景中，A 委托给 B 后，往往希望 B 直接处理完就结束，不需要再回来。

**Flowable 原生的委托功能不能满足这个需求，怎么办？**

你能想到几种解决方案？
