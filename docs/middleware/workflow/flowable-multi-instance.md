# Flowable 会签（Multi-Instance）：串行会签与并行会签实现

你有没有见过这种情况：一个审批节点需要「多个人都点头」才能通过。

比如项目立项需要技术负责人、产品负责人、财务负责人三个人都同意。这时候怎么处理？

有人说：那就加三个用户任务嘛！技术上没问题，但问题是——**顺序怎么控制？全部通过才算成功吗？有人拒绝怎么办？**

Flowable 的 Multi-Instance（会签）功能，就是来解决这个问题的。

---

## 什么是会签？

会签（Multi-Instance）是一种 BPMN 模式，**让同一个任务被重复执行多次**。

根据执行方式的不同，分为两种：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   串行会签（Sequential）        并行会签（Parallel）             │
│                                                                 │
│   ┌─────────────────┐         ┌─────────┬─────────┬─────────┐   │
│   │  任务 A → 任务 B → 任务 C  │  任务A  │  任务B  │  任务C  │   │
│   └─────────────────┘         └─────────┴─────────┴─────────┘   │
│        一个人完成，下一个              三个人同时执行              │
│        才轮到下一个人                                          │
└─────────────────────────────────────────────────────────────────┘
```

### 会签的典型场景

| 场景 | 推荐类型 | 原因 |
|---|---|---|
| 部门领导逐级审批 | 串行会签 | 上一级同意了才到下一级 |
| 多人会签通过 | 并行会签 | 需要所有人同意才能继续 |
| 多人会签否决 | 并行会签 | 一人否决即否决 |
| 多人任意一人通过 | 并行会签 | 任一人通过即可 |
| 投票决策 | 并行会签 | 需要收集所有人的意见 |

---

## 并行会签

### 基础配置

```xml
<!-- BPMN 配置：并行会签 -->
<userTask id="multiApproval" name="会签审批">
    <multiInstanceLoopCharacteristics isSequential="false">
        <!-- 指定会签人列表的变量名 -->
        <loopCardinality>3</loopCardinality>
        <!-- 或使用表达式从变量中获取 -->
        <loopDataInputRef>approvers</loopDataInputRef>
        <!-- 输出结果集合的变量名 -->
        <outputDataItem name="approvalResults"/>
    </multiInstanceLoopCharacteristics>
</userTask>
```

### 完整示例

```java
/**
 * 并行会签：多个审批人同时审批
 * 只有所有人都同意，才算通过
 */
@Test
public void parallelMultiInstance() {
    // 准备会签人列表
    List&lt;String&gt; approvers = Arrays.asList("userA", "userB", "userC");
    
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("approvers", approvers);
    variables.put("approvalThreshold", 3);  // 3票全通过
    
    // 启动流程
    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "multiApproval", variables);
    
    // 查询会签任务
    List&lt;Task&gt; tasks = taskService.createTaskQuery()
        .processInstanceId(instance.getId())
        .list();
    
    System.out.println("会签任务数量: " + tasks.size());  // 3个任务
    
    // 模拟三个人同时审批
    for (Task task : tasks) {
        // 每个人独立完成任务
        Map&lt;String, Object&gt; taskVars = new HashMap&lt;&gt;();
        taskVars.put("approved", true);
        taskVars.put("approver", task.getAssignee());
        taskService.complete(task.getId(), taskVars);
    }
    
    // 检查会签结果
    List&lt;Integer&gt; results = (List&lt;Integer&gt;) runtimeService.getVariable(
        instance.getId(), "approvalResults");
    System.out.println("会签结果: " + results);
}
```

### 会签完成条件

会签何时算完成？可以通过表达式灵活配置：

```xml
<!-- 方式1：固定次数 -->
<multiInstanceLoopCharacteristics isSequential="false">
    <loopCardinality>3</loopCardinality>
</multiInstanceLoopCharacteristics>

<!-- 方式2：表达式指定次数 -->
<multiInstanceLoopCharacteristics isSequential="false">
    <loopDataInputRef>approverCount</loopDataInputRef>
</multiInstanceLoopCharacteristics>

<!-- 方式3：使用已有集合 -->
<multiInstanceLoopCharacteristics isSequential="false">
    <completionCondition>
        <!-- 一票否决：任意一个拒绝就结束 -->
        ${nrOfCompletedInstances &gt;= 1 and anyFailed}
    </completionCondition>
</multiInstanceLoopCharacteristics>

<!-- 方式4：多数通过（如6人中至少4人同意） -->
<multiInstanceLoopCharacteristics isSequential="false">
    <completionCondition>
        ${nrOfCompletedInstances &gt;= nrOfInstances * 0.67}
    </completionCondition>
</multiInstanceLoopCharacteristics>
```

### 会签变量

会签执行过程中，Flowable 会自动维护一些内置变量：

| 变量名 | 类型 | 说明 |
|---|---|---|
| `nrOfInstances` | Integer | 会签总实例数 |
| `nrOfCompletedInstances` | Integer | 已完成的实例数 |
| `nrOfActiveInstances` | Integer | 当前活跃（未完成）的实例数 |
| `loopCounter` | Integer | 当前循环计数器（从1开始） |

```java
/**
 * 在会签任务中使用这些内置变量
 */
public class MultiInstanceListener implements ExecutionListener {
    
    @Override
    public void notify(DelegateExecution execution) {
        Integer nrOfInstances = (Integer) execution.getVariable("nrOfInstances");
        Integer nrOfCompleted = (Integer) execution.getVariable("nrOfCompletedInstances");
        Integer nrOfActive = (Integer) execution.getVariable("nrOfActiveInstances");
        
        System.out.println(String.format("会签进度: %d/%d（还剩 %d 个）", 
            nrOfCompleted, nrOfInstances, nrOfActive));
        
        // 在最后一个任务中汇总结果
        if (nrOfCompleted.equals(nrOfInstances)) {
            collectAndSummarizeResults(execution);
        }
    }
}
```

---

## 串行会签

### 基础配置

```xml
<!-- BPMN 配置：串行会签 -->
<userTask id="sequentialApproval" name="逐级审批">
    <multiInstanceLoopCharacteristics isSequential="true">
        <loopCardinality>3</loopCardinality>
    </multiInstanceLoopCharacteristics>
</userTask>
```

### 完整示例

```java
/**
 * 串行会签：逐级审批
 * 上一级同意后，下一级才能看到任务
 */
@Test
public void sequentialMultiInstance() {
    // 按审批顺序排列
    List&lt;String&gt; approvers = Arrays.asList(
        "manager",    // 第一级：直属主管
        "director",   // 第二级：总监
        "vp"          // 第三级：副总裁
    );
    
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("approvers", approvers);
    variables.put("applyUser", "employee001");
    
    // 启动流程
    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "sequentialApproval", variables);
    
    // 查询当前任务（串行会签一次只有一个任务）
    List&lt;Task&gt; currentTasks = taskService.createTaskQuery()
        .processInstanceId(instance.getId())
        .list();
    
    System.out.println("当前任务数: " + currentTasks.size());  // 1个
    
    // 第一级审批
    Task firstTask = currentTasks.get(0);
    System.out.println("当前审批人: " + firstTask.getAssignee());  // manager
    
    Map&lt;String, Object&gt; approval1 = new HashMap&lt;&gt;();
    approval1.put("approved", true);
    approval1.put("level1Comment", "同意，金额合理");
    taskService.complete(firstTask.getId(), approval1);
    
    // 第二级审批（现在才能看到）
    currentTasks = taskService.createTaskQuery()
        .processInstanceId(instance.getId())
        .list();
    
    System.out.println("当前审批人: " + currentTasks.get(0).getAssignee());  // director
    
    Map&lt;String, Object&gt; approval2 = new HashMap&lt;&gt;();
    approval2.put("approved", true);
    approval2.put("level2Comment", "同意，符合预算");
    taskService.complete(currentTasks.get(0).getId(), approval2);
    
    // 第三级审批...
}
```

### 串行会签的判断逻辑

```java
/**
 * 串行会签中，只有满足特定条件才流转到下一级
 * 通常是当前审批人同意，且还未到最后一轮
 */
@Test
public void sequentialWithCondition() {
    List&lt;String&gt; approvers = Arrays.asList("manager", "director", "vp");
    
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("approvers", approvers);
    variables.put("rejectionCount", 0);
    
    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "conditionalApproval", variables);
    
    // 模拟拒绝场景
    while (true) {
        List&lt;Task&gt; tasks = taskService.createTaskQuery()
            .processInstanceId(instance.getId())
            .active()
            .list();
        
        if (tasks.isEmpty()) {
            break;  // 会签结束
        }
        
        Task task = tasks.get(0);
        Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
        
        // 模拟经理拒绝
        if ("manager".equals(task.getAssignee())) {
            result.put("approved", false);
            taskService.complete(task.getId(), result);
            
            Integer rejections = (Integer) runtimeService.getVariable(
                instance.getId(), "rejectionCount");
            runtimeService.setVariable(instance.getId(), "rejectionCount", 
                rejections + 1);
            
            System.out.println("会签被拒绝，流程终止");
            break;
        }
        
        result.put("approved", true);
        taskService.complete(task.getId(), result);
    }
}
```

---

## 高级用法

### 动态添加/删除会签人

```java
/**
 * 动态修改会签人列表
 * 在会签执行过程中，可以添加新的审批人
 */
@Test
public void dynamicAddApprover() {
    List&lt;String&gt; initialApprovers = Arrays.asList("userA", "userB");
    
    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "dynamicMultiInstance");
    
    // 获取会签执行上下文
    Execution execution = runtimeService.createExecutionQuery()
        .processInstanceId(instance.getId())
        .activityId("multiApproval")
        .singleResult();
    
    // 动态添加会签人（添加到列表末尾）
    List&lt;String&gt; currentApprovers = (List&lt;String&gt;) runtimeService.getVariable(
        instance.getId(), "approvers");
    currentApprovers.add("userC");
    runtimeService.setVariable(instance.getId(), "approvers", currentApprovers);
    
    // 如果需要在当前实例后立即生效
    // 需要通过监听器重新初始化
}
```

### 会签结果汇总

```java
/**
 * 会签完成后，汇总所有审批结果
 */
public class MultiInstanceResultCollector {
    
    /**
     * 收集所有任务的审批意见
     */
    public Map&lt;String, Boolean&gt; collectResults(String processInstanceId) {
        List&lt;HistoricTaskInstance&gt; tasks = historyService.createHistoricTaskInstanceQuery()
            .processInstanceId(processInstanceId)
            .taskDefinitionKey("multiApproval")
            .list();
        
        Map&lt;String, Boolean&gt; results = new LinkedHashMap&lt;&gt;();
        for (HistoricTaskInstance task : tasks) {
            Boolean approved = (Boolean) task.getTaskLocalVariables()
                .get("approved");
            results.put(task.getAssignee(), approved);
        }
        return results;
    }
    
    /**
     * 判断会签是否全部通过
     */
    public boolean isAllApproved(String processInstanceId) {
        Map&lt;String, Boolean&gt; results = collectResults(processInstanceId);
        return results.values().stream().allMatch(approved -&gt; approved);
    }
    
    /**
     * 获取投票统计
     */
    public Map&lt;String, Long&gt; getVoteStatistics(String processInstanceId) {
        Map&lt;String, Boolean&gt; results = collectResults(processInstanceId);
        
        long approveCount = results.values().stream().filter(v -&gt; v).count();
        long rejectCount = results.values().stream().filter(v -&gt; !v).count();
        
        Map&lt;String, Long&gt; stats = new HashMap&lt;&gt;();
        stats.put("approve", approveCount);
        stats.put("reject", rejectCount);
        return stats;
    }
}
```

### 代理与委派在会签中的应用

```java
/**
 * 会签中的代理场景
 * 比如用户 A 委托给用户 B 审批
 */
@Test
public void delegateInMultiInstance() {
    // 查询会签任务
    Task task = taskService.createTaskQuery()
        .taskAssignee("userA")
        .taskDefinitionKey("multiApproval")
        .singleResult();
    
    // A 委托给 B
    taskService.delegateTask(task.getId(), "userB");
    
    // B 完成任务
    // 注意：任务完成后，会签计数+1
    Map&lt;String, Object&gt; taskVars = new HashMap&lt;&gt;();
    taskVars.put("approved", true);
    taskVars.put("actualApprover", "userB");  // 记录实际审批人
    taskVars.put("delegatedFrom", "userA");    // 记录委托人
    taskService.complete(task.getId(), taskVars);
}
```

---

## 会签与网关的结合

### 排他网关：根据会签结果分支

```java
/**
 * 会签完成后，用排他网关判断流程走向
 */
@Test
public void multiInstanceWithGateway() {
    ProcessInstance instance = runtimeService.startProcessInstanceByKey(
        "approvalWithBranches");
    
    // 等待会签完成...
    
    // 查询会签结果
    Map&lt;String, Boolean&gt; results = collectResults(instance.getId());
    boolean allApproved = results.values().stream().allMatch(v -&gt; v);
    
    if (allApproved) {
        // 全票通过，流程继续
        runtimeService.setVariable(instance.getId(), "finalResult", "PASSED");
    } else {
        // 有反对票，流程驳回
        runtimeService.setVariable(instance.getId(), "finalResult", "REJECTED");
    }
    
    // 排他网关会根据变量值选择分支
}
```

---

## 总结：串行 vs 并行会签

| 特性 | 串行会签 | 并行会签 |
|---|---|---|
| 同时执行的任务数 | 1个 | 多个（最多等于会签人数） |
| 执行顺序 | 按定义的顺序 | 无固定顺序（并发执行） |
| 适用场景 | 逐级审批、需要审批记录 | 需要多人共识、一票否决 |
| 等待时间 | 累加（每人时间之和） | 最长单人时间 |
| 数据汇总 | 简单（按顺序记录） | 需要聚合统计 |
| 并发安全 | 无需考虑 | 需要处理结果聚合 |

---

## 留给你的问题

假设你要实现一个「投标评审」流程，需要满足以下要求：

1. 3位专家独立评分（并行会签）
2. 只有评分差距不超过20%才算有效，否则重新评分
3. 最终得分取平均值

**问题来了：**

1. 如何在会签过程中判断「评分差距」？需要等到所有人完成吗？
2. 如果3人中有人超时未评分（比如说专家生病了），怎么处理？
3. 会签结果汇总后，如何触发「重新评分」流程？

这三个问题涉及到**会签完成条件**、**超时处理**和**动态流程控制**，是实际业务中经常会遇到的挑战。
