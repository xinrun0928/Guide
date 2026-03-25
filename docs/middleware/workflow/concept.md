# 工作流核心概念：流程定义、流程实例、任务、流程变量

想象一下这个场景：员工提交了一份报销申请。

他要经过直属主管审批、财务复核、高管审批，最后财务打款。整个过程涉及多个角色、多个人、多个步骤，而且每个步骤可能还有不同的条件分支（金额超过 1 万需要高管审批，低于 1 万主管审批即可）。

如果你用 if-else 来实现这个逻辑，代码会变成什么样？

```java
if (amount > 10000) {
    // 高管审批
    if (managerApproved) {
        // 财务复核
        if (financeApproved) {
            // 打款
        }
    }
} else {
    // 主管审批
    if (directorApproved) {
        // 财务复核
        if (financeApproved) {
            // 打款
        }
    }
}
```

当审批节点增多、条件分支变复杂时，这种方式会迅速失控。**工作流引擎**就是为了解决这个问题而生的。

---

## 什么是工作流？

工作流（Workflow）是**业务过程的计算机化表示**。它定义了流程中各个环节的执行顺序、参与角色、执行条件，以及数据流转方式。

工作流引擎则是执行这些流程定义的运行时引擎——它负责：
- 推进流程执行
- 管理流程状态
- 维护流程变量
- 分派任务给用户

---

## 四个核心概念

### 1. 流程定义（Process Definition）

流程定义是对**业务流程的静态描述**——它定义了流程「长什么样」。

流程定义包括：
- 流程的所有节点（开始事件、用户任务、服务任务、网关、结束事件等）
- 节点之间的流转顺序
- 每个节点的业务逻辑
- 节点参与者（谁来处理）
- 流程变量（需要什么数据）

流程定义通常用 **BPMN 2.0** 规范来描述，使用 XML 文件或图形化工具（如 Flowable Designer、Camunda Modeler）来定义。

```xml
<!-- BPMN 2.0 流程定义示例 -->
<process id="expenseApproval" name="报销审批流程">
    <startEvent id="start"/>
    <userTask id="directorReview" name="主管审批"/>
    <exclusiveGateway id="amountCheck"/>
    <userTask id="financeReview" name="财务复核"/>
    <endEvent id="end"/>
</process>
```

### 2. 流程实例（Process Instance）

流程实例是流程定义的**运行时执行**——一个流程定义可以被启动多次，每次启动都创建一个新的流程实例。

```java
// 启动一个报销流程实例
RuntimeService runtimeService = processEngine.getRuntimeService();
ProcessInstance instance = runtimeService.startProcessInstanceByKey("expenseApproval");

// 查看流程实例ID
String processInstanceId = instance.getId();
// processInstanceId 可能是：2501
```

流程实例与流程定义的关系，就像「对象」与「类」的关系：

| 概念 | 生活类比 | 编程类比 |
|---|---|---|
| 流程定义 | 报销流程模板（所有报销都走这个流程） | 类（Class） |
| 流程实例 | 员工A的报销申请（具体的一次报销） | 对象（Object） |

### 3. 任务（Task）

任务是流程实例中**需要人工处理的工作单元**。

当流程执行到「主管审批」节点时，系统会创建一个任务，分配给相应的主管。这个任务会出现在主管的「待办任务列表」中。

任务的核心属性：

| 属性 | 说明 |
|---|---|
| id | 任务唯一标识 |
| name | 任务名称（如「主管审批」） |
| assignee | 任务的实际处理人 |
| candidateUsers | 任务候选用户列表 |
| candidateGroups | 任务候选组列表 |
| processInstanceId | 所属流程实例ID |
| executionId | 所属执行对象ID |
| createTime | 任务创建时间 |
| dueDate | 任务截止时间 |

```java
// 查询待办任务
TaskService taskService = processEngine.getTaskService();
List&lt;Task&gt; tasks = taskService.createTaskQuery()
    .taskAssignee("zhangsan")
    .list();

// 完成任务
Task task = tasks.get(0);
taskService.complete(task.getId());
```

### 4. 流程变量（Process Variable）

流程变量是**在流程执行过程中流转的数据**。

报销流程中需要用到：
- 报销金额（amount）
- 报销原因（reason）
- 审批意见（approvalComment）

这些数据会以流程变量的形式存储和传递。

```java
// 启动流程时设置变量
Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
variables.put("amount", 15000);
variables.put("reason", "客户拜访差旅费");
runtimeService.startProcessInstanceByKey("expenseApproval", variables);

// 在任务中设置变量
taskService.setVariable(taskId, "approvalComment", "同意报销");

// 获取流程变量
Integer amount = (Integer) runtimeService.getVariable(processInstanceId, "amount");
```

---

## 概念之间的关系

四个核心概念之间的关系：

```
┌─────────────────────────────────────────────────────────────────┐
│                         流程定义                                 │
│                    (Process Definition)                          │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │开始事件 │ → │主管审批 │ → │金额判断 │ → │结束事件  │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │ 启动
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                       流程实例 1                                  │
│   变量: amount=15000, reason=差旅费                              │
│   当前节点: 高管审批                                            │
│   状态: 进行中                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 执行到「主管审批」
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│                         任务 1                                    │
│   名称: 主管审批                                                 │
│   候选人: zhangsan (主管)                                        │
│   创建时间: 2024-01-15 09:30                                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## 执行上下文与数据流转

流程变量在流程执行过程中可以跨节点传递：

```java
// 场景：主管审批时需要查看报销金额，审批后需要记录审批意见

// 启动流程
Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
variables.put("amount", 15000);
variables.put("reason", "客户拜访差旅费");
ProcessInstance instance = runtimeService.startProcessInstanceByKey(
    "expenseApproval", variables);

// 主管审批任务中，可以读取这些变量
Task directorTask = taskService.createTaskQuery()
    .taskCandidateUser("zhangsan")
    .singleResult();

// 获取流程变量
Integer amount = (Integer) taskService.getVariable(directorTask.getId(), "amount");

// 审批通过后，设置审批意见（流程变量）
Map&lt;String, Object&gt; approvalVars = new HashMap&lt;&gt;();
approvalVars.put("directorApproved", true);
approvalVars.put("directorComment", "情况属实，同意报销");
taskService.complete(directorTask.getId(), approvalVars);
```

---

## 流程状态机

流程实例在生命周期中会经历不同状态：

| 状态 | 说明 | 引擎操作 |
|---|---|---|
| 激活（Active） | 正常运行 | - |
| 挂起（Suspended） | 暂停执行 | `runtimeService.suspendProcessInstanceById()` |
| 完成（Completed） | 正常结束 | 所有节点执行完毕 |
| 中止（Aborted） | 被手动终止 | `runtimeService.deleteProcessInstance()` |

```java
// 挂起流程实例（比如员工请假期间，其发起的所有流程暂停）
runtimeService.suspendProcessInstanceById(processInstanceId);

// 激活流程实例
runtimeService.activateProcessInstanceById(processInstanceId);

// 中止流程实例（比如报销被撤销）
runtimeService.deleteProcessInstance(processInstanceId, "canceled by user");
```

---

## 总结

工作流的四个核心概念：

| 概念 | 作用 | 类比 |
|---|---|---|
| 流程定义 | 描述业务流程的结构 | 模板、表单 |
| 流程实例 | 流程定义的一次执行 | 填好的表单 |
| 任务 | 需要人工处理的步骤 | 具体的待办事项 |
| 流程变量 | 流程中流转的数据 | 表单中的填写内容 |

理解这四个概念，是掌握工作流引擎的第一步。

---

## 留给你的问题

如果员工提交报销后，突然发现金额填错了，需要修改金额——这时候流程已经启动，流程变量能修改吗？如果能，应该怎么改？

这个问题涉及到工作流的「数据一致性」与「业务灵活性」的平衡，值得你深入思考。
