# Flowable 子流程：嵌入式子流程、调用活动（Call Activity）

你有没有遇到过这种情况：某个业务流程很复杂，包含了很多重复的子流程。

比如「报销审批」流程和「采购审批」流程，都需要「财务复核」环节。如果每个流程都单独定义「财务复核」，那维护起来就麻烦了——一旦财务复核的逻辑变了，所有流程都要改。

更糟糕的是，如果「财务复核」本身也是一个完整的流程，有自己的发起人、审批记录、历史数据……那把它嵌入到其他流程里，就更复杂了。

**子流程**就是来解决这个问题的。

---

## 子流程的两种类型

Flowable 支持两种子流程：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   嵌入式子流程（Embedded Sub Process）                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  子流程是父流程的一部分，共享同一个执行上下文              │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   调用活动（Call Activity）                                      │
│   ┌─────────────┐      ┌─────────────┐                        │
│   │   父流程     │ ───→ │   子流程     │                        │
│   │             │ 调用 │   (独立流程)  │                        │
│   └─────────────┘      └─────────────┘                        │
│                          独立运行，数据通过入参/出参传递          │
└─────────────────────────────────────────────────────────────────┘
```

| 特性 | 嵌入式子流程 | 调用活动 |
|---|---|---|
| 流程定义 | 内嵌在父流程 XML 中 | 独立部署的流程 |
| 生命周期 | 随父流程启动/结束 | 可独立运行 |
| 变量共享 | 完全共享 | 通过入参/出参传递 |
| 适用场景 | 逻辑复用、不需要独立追踪 | 独立业务流程、需要单独管理 |
| 维护方式 | 修改一处，所有使用处都生效 | 需要单独更新子流程 |

---

## 调用活动（Call Activity）

### 基础概念

调用活动（Call Activity）是最常用的子流程形式。它调用的子流程是**独立部署、独立运行的流程**。

```
父流程（主流程）
    │
    │ 遇到「财务复核」调用活动
    │
    ▼
┌─────────────────┐
│   子流程        │
│  (财务复核流程)  │
│                 │
│  有自己的：     │
│  - 开始事件     │
│  - 审批节点     │
│  - 结束事件     │
└─────────────────┘
    │
    │ 子流程结束，返回结果
    │
    ▼
父流程继续执行
```

### BPMN 配置

```xml
<!-- 父流程定义 -->
<process id="expenseProcess" name="报销审批主流程">
    
    <startEvent id="start"/>
    <userTask id="submitExpense" name="提交报销"/>
    
    <!-- 调用子流程 -->
    <callActivity id="financeReview" name="财务复核">
        <extensionElements>
            <!-- 要调用的子流程 Key -->
            <flowable:calledElement binding="latest">financeReviewProcess</flowable:calledElement>
            
            <!-- 输入参数映射：父流程变量 → 子流程变量 -->
            <flowable:in source="expenseAmount" target="amount"/>
            <flowable:in source="expenseCategory" target="category"/>
            <flowable:in source="applicant" target="applyUser"/>
            
            <!-- 输出参数映射：子流程变量 → 父流程变量 -->
            <flowable:out source="reviewResult" target="financeResult"/>
            <flowable:out source="reviewerComment" target="financeComment"/>
        </extensionElements>
    </callActivity>
    
    <exclusiveGateway id="financeResultCheck"/>
    <userTask id="handleResult" name="处理结果"/>
    <endEvent id="end"/>
    
    <!-- 连接线 -->
    <sequenceFlow id="flow1" sourceRef="start" targetRef="submitExpense"/>
    <sequenceFlow id="flow2" sourceRef="submitExpense" targetRef="financeReview"/>
    <sequenceFlow id="flow3" sourceRef="financeReview" targetRef="financeResultCheck"/>
    <sequenceFlow id="flow4a" sourceRef="financeResultCheck" targetRef="handleResult">
        <conditionExpression>${financeResult == 'PASSED'}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="flow4b" sourceRef="financeResultCheck" targetRef="end">
        <conditionExpression>${financeResult == 'REJECTED'}</conditionExpression>
    </sequenceFlow>
    
</process>
```

### 完整代码示例

```java
/**
 * 调用活动的使用
 */
@Test
public void callActivityDemo() {
    // 1. 部署子流程（独立部署）
    Deployment subProcess = repositoryService.createDeployment()
        .addClasspathResource("bpmn/financeReviewProcess.bpmn20.xml")
        .deploy();
    
    System.out.println("子流程部署ID: " + subProcess.getId());
    
    // 2. 部署父流程
    Deployment parentProcess = repositoryService.createDeployment()
        .addClasspathResource("bpmn/expenseProcess.bpmn20.xml")
        .deploy();
    
    // 3. 启动父流程
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("expenseAmount", 15000);
    variables.put("expenseCategory", "差旅费");
    variables.put("applicant", "zhangsan");
    
    ProcessInstance parentInstance = runtimeService.startProcessInstanceByKey(
        "expenseProcess", "EXP-001", variables);
    
    System.out.println("父流程启动: " + parentInstance.getId());
    
    // 4. 执行父流程到调用活动
    // 此时会启动子流程
    
    // 5. 查询子流程实例
    ProcessInstance subInstance = runtimeService.createProcessInstanceQuery()
        .superProcessInstanceId(parentInstance.getId())
        .singleResult();
    
    System.out.println("子流程实例: " + (subInstance != null ? subInstance.getId() : "null"));
    
    // 6. 在子流程中完成任务
    Task subTask = taskService.createTaskQuery()
        .processInstanceId(subInstance.getId())
        .singleResult();
    
    Map&lt;String, Object&gt; reviewResult = new HashMap&lt;&gt;();
    reviewResult.put("reviewResult", "PASSED");
    reviewResult.put("reviewerComment", "票据齐全，同意报销");
    taskService.complete(subTask.getId(), reviewResult);
    
    // 7. 子流程结束后，返回父流程
    // 检查父流程中的输出变量
    String financeResult = (String) runtimeService.getVariable(
        parentInstance.getId(), "financeResult");
    String financeComment = (String) runtimeService.getVariable(
        parentInstance.getId(), "financeComment");
    
    System.out.println("财务复核结果: " + financeResult);
    System.out.println("财务复核意见: " + financeComment);
}
```

### 变量映射详解

```java
/**
 * 变量映射的三种方式
 */

// 方式1：固定映射（在 BPMN 中配置）
// &lt;flowable:in source="amount" target="amount"/&gt;
// 子流程的 "amount" = 父流程的 "amount"

// 方式2：表达式映射
// &lt;flowable:in source="amount" target="amount" /&gt;  可以用表达式
// &lt;flowable:in sourceExpression="${getAmount()}" target="amount"/&gt;
// 调用方法的结果作为输入

// 方式3：动态映射（代码中动态指定）
@Test
public void dynamicVariableMapping() {
    Map&lt;String, Object&gt; inputVariables = new HashMap&lt;&gt;();
    inputVariables.put("amount", 15000);
    inputVariables.put("category", "差旅费");
    
    // 启动子流程并传递参数
    ProcessInstance subInstance = runtimeService.createProcessInstance(
        "financeReviewProcess",  // 子流程 Key
        inputVariables           // 输入参数
    );
    
    // 子流程执行完毕后，获取输出参数
    Map&lt;String, Object&gt; outputVariables = runtimeService.getVariables(subInstance.getId());
    
    // 将输出合并到父流程
    runtimeService.setVariables(parentInstanceId, outputVariables);
}
```

---

## 嵌入式子流程

### 基础概念

嵌入式子流程（Embedded Sub Process）是直接内嵌在父流程中的子流程，与父流程**共享执行上下文**。

```
主流程
    │
    ├── 任务A
    │
    ├── ┌─────────────────────────────────┐
    │   │  嵌入式子流程                    │
    │   │  ┌────────┐    ┌────────┐       │
    │   │  │ 子任务1 │ → │ 子任务2 │       │
    │   │  └────────┘    └────────┘       │
    │   └─────────────────────────────────┘
    │
    └── 任务B
```

### BPMN 配置

```xml
<process id="mainProcess">
    <startEvent id="start"/>
    <userTask id="taskA" name="任务A"/>
    
    <!-- 嵌入式子流程 -->
    <subProcess id="embeddedSubProcess" name="嵌入式子流程">
        <startEvent id="subStart"/>
        <userTask id="subTask1" name="子任务1"/>
        <userTask id="subTask2" name="子任务2"/>
        <endEvent id="subEnd"/>
        
        <sequenceFlow id="subFlow1" sourceRef="subStart" targetRef="subTask1"/>
        <sequenceFlow id="subFlow2" sourceRef="subTask1" targetRef="subTask2"/>
        <sequenceFlow id="subFlow3" sourceRef="subTask2" targetRef="subEnd"/>
    </subProcess>
    
    <userTask id="taskB" name="任务B"/>
    <endEvent id="end"/>
    
    <sequenceFlow sourceRef="start" targetRef="taskA"/>
    <sequenceFlow sourceRef="taskA" targetRef="embeddedSubProcess"/>
    <sequenceFlow sourceRef="embeddedSubProcess" targetRef="taskB"/>
    <sequenceFlow sourceRef="taskB" targetRef="end"/>
</process>
```

### 嵌入式子流程的事件

嵌入式子流程可以附加事件：

```xml
<!-- 带有错误事件的嵌入式子流程 -->
<subProcess id="orderProcess" name="订单处理">
    <startEvent id="subStart"/>
    <userTask id="processOrder" name="处理订单"/>
    <endEvent id="subEnd"/>
    
    <!-- 错误事件 -->
    <boundaryEvent id="errorBoundary" attachedToRef="processOrder">
        <errorEventDefinition errorRef="orderError"/>
    </boundaryEvent>
    
    <userTask id="handleError" name="处理异常"/>
    
    <sequenceFlow sourceRef="errorBoundary" targetRef="handleError"/>
    <sequenceFlow sourceRef="handleError" targetRef="subEnd"/>
</subProcess>
```

---

## 子流程与事务控制

### 事务边界

子流程和父流程的事务边界是一个重要概念：

| 子流程类型 | 事务边界 | 说明 |
|---|---|---|
| 调用活动 | 独立事务 | 子流程失败不影响父流程 |
| 嵌入式子流程 | 共享事务 | 子流程失败会导致整个流程回滚 |

```java
/**
 * 调用活动的事务隔离
 * 子流程失败不会导致父流程回滚
 */
@Test
public void callActivityTransaction() {
    // 启动父流程
    ProcessInstance parent = runtimeService.startProcessInstanceByKey("parentProcess");
    
    // 父流程执行到调用活动，启动子流程
    ProcessInstance child = runtimeService.createProcessInstanceQuery()
        .superProcessInstanceId(parent.getId())
        .singleResult();
    
    // 模拟子流程失败
    runtimeService.deleteProcessInstance(child.getId(), "子流程业务异常");
    
    // 父流程仍然存在，只是子流程调用失败
    ProcessInstance stillExists = runtimeService.createProcessInstanceQuery()
        .processInstanceId(parent.getId())
        .singleResult();
    
    System.out.println("父流程状态: " + (stillExists != null ? "运行中" : "不存在"));
    // 输出：父流程状态: 运行中
}
```

### 取消与终止

```java
/**
 * 取消子流程的各种场景
 */

// 场景1：取消特定的子流程实例
public void cancelChildProcess(String superExecutionId) {
    ProcessInstance child = runtimeService.createProcessInstanceQuery()
        .superProcessExecutionId(superExecutionId)
        .singleResult();
    
    if (child != null) {
        runtimeService.deleteProcessInstance(
            child.getId(), 
            "被父流程取消"
        );
    }
}

// 场景2：父流程取消所有子流程
public void cancelAllChildProcesses(String parentInstanceId) {
    List&lt;ProcessInstance&gt; children = runtimeService.createProcessInstanceQuery()
        .superProcessInstanceId(parentInstanceId)
        .list();
    
    for (ProcessInstance child : children) {
        runtimeService.deleteProcessInstance(child.getId(), "父流程终止");
    }
}

// 场景3：子流程完成后回调父流程
public class ChildProcessCallbackListener implements ExecutionListener {
    
    @Override
    public void notify(DelegateExecution execution) {
        if ("end".equals(execution.getCurrentFlowElement().getId())) {
            // 子流程结束，可以通知父流程
            String superExecutionId = execution.getSuperExecutionId();
            if (superExecutionId != null) {
                // 通知父流程执行后续逻辑
            }
        }
    }
}
```

---

## 递归调用与循环

### 递归调用子流程

如果子流程调用自己，会形成递归：

```xml
<!-- 这是一个递归调用的子流程 -->
<subProcess id="recursiveTask">
    <!-- 每次调用都会启动新的子流程实例 -->
    <!-- 需要通过条件控制递归终止 -->
</subProcess>
```

```java
/**
 * 递归调用的实现
 */
@Test
public void recursiveCallActivity() {
    int recursionDepth = 0;
    int maxDepth = 5;
    
    while (recursionDepth &lt; maxDepth) {
        // 检查是否需要继续递归
        Boolean needContinue = checkRecursionCondition();
        
        if (!needContinue) {
            break;
        }
        
        // 递归调用子流程
        Map&lt;String, Object&gt; vars = new HashMap&lt;&gt;();
        vars.put("depth", recursionDepth + 1);
        
        ProcessInstance child = runtimeService.createProcessInstance(
            "recursiveSubProcess", vars);
        
        // 等待子流程完成
        waitForCompletion(child.getId());
        
        recursionDepth++;
    }
}
```

---

## 调用活动的高级用法

### 动态选择子流程

```java
/**
 * 根据条件动态选择调用哪个子流程
 */
@Test
public void dynamicSubProcessSelection() {
    // 根据业务类型选择不同的子流程
    String businessType = (String) runtimeService.getVariable(
        processInstanceId, "businessType");
    
    String calledElement;
    switch (businessType) {
        case "expense":
            calledElement = "expenseApprovalSubProcess";
            break;
        case "purchase":
            calledElement = "purchaseApprovalSubProcess";
            break;
        case "contract":
            calledElement = "contractReviewSubProcess";
            break;
        default:
            throw new RuntimeException("未知的业务类型: " + businessType);
    }
    
    // 动态设置调用活动要调用的子流程
    runtimeService.setVariable(processInstanceId, "calledElement", calledElement);
    
    // 在 BPMN 中使用表达式
    // &lt;flowable:calledElement&gt;${calledElement}&lt;/flowable:calledElement&gt;
}
```

### 子流程版本控制

```java
/**
 * 调用特定版本的子流程
 */
@Test
public void callSpecificVersion() {
    // 查询特定版本的流程定义
    ProcessDefinition processDefinition = repositoryService.createProcessDefinitionQuery()
        .processDefinitionKey("financeReviewProcess")
        .version(2)  // 指定版本号
        .singleResult();
    
    if (processDefinition != null) {
        // 在 BPMN 中，可以通过变量指定版本
        runtimeService.setVariable(
            processInstanceId, 
            "calledElement", 
            processDefinition.getId()  // 使用流程定义ID而非Key
        );
    }
}
```

---

## 总结：子流程使用场景

| 场景 | 推荐类型 | 原因 |
|---|---|---|
| 多个流程都需要「审批」 | 调用活动 | 审批流程独立维护 |
| 某个复杂步骤需要拆分 | 嵌入式子流程 | 逻辑封装，不需要独立运行 |
| 需要单独追踪的子流程 | 调用活动 | 有独立的流程实例 |
| 仅用于代码组织的步骤 | 嵌入式子流程 | 简化主流程定义 |
| 递归处理（如树形审批） | 调用活动 | 每次调用都是新实例 |

---

## 留给你的问题

假设你要设计一个「订单履约」流程，其中包含以下子流程：

1. **库存检查子流程** - 检查商品库存是否充足
2. **支付处理子流程** - 处理用户支付
3. **物流配送子流程** - 安排发货和配送
4. **财务结算子流程** - 与供应商结算

**问题来了：**

1. 这些子流程中，哪些应该用「调用活动」，哪些应该用「嵌入式子流程」？
2. 如果「支付处理」失败了，订单流程应该怎么处理？已执行的「库存检查」需要回滚吗？
3. 如果同一个商品在「物流配送」过程中，又触发了新的「库存检查」子流程（用于补货）——这两个子流程之间需要同步数据吗？

这三个问题涉及到**子流程选型**、**事务边界**和**并发控制**，是实际业务系统设计的核心考量。
