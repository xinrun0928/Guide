# BPMN 2.0 规范：流程设计元素与建模规范

你有没有想过一个问题：Flowable 的流程定义，Camunda 能执行吗？

理论上应该可以——因为它们都遵循 **BPMN 2.0** 规范。

BPMN（Business Process Model and Notation）是一套标准的业务流程建模符号体系。2.0 版本增加了执行语义，让流程图不仅能「看」，还能「跑」。

---

## 为什么需要 BPMN？

在 BPMN 出现之前：

- 流程图用 Visio 画，但没办法直接执行
- 每个工作流引擎有自己的流程定义格式，互不兼容
- 业务人员画的图，开发人员要重新理解再写代码

BPMN 解决了这个问题：
- 统一的符号体系，业务人员和开发人员都能看懂
- 标准化的 XML 格式，不同引擎可以互通
- 完整的执行语义，流程图可以直接部署运行

---

## 事件（Events）

事件是流程中发生的「事情」——流程的开始、进行中的信号、流程的结束。

### 开始事件（Start Event）

流程的入口点。没有开始事件，流程无法启动。

```
┌─────────┐
│ (circle)│ 开始事件
└─────────┘
```

| 类型 | 图标 | 说明 |
|---|---|---|
| 空开始事件 | ○ | 普通启动，需手动触发 |
| 定时器开始事件 | ○(⏱) | 定时自动启动（如每天早上 9 点） |
| 消息开始事件 | ○(✉) | 收到特定消息时启动 |
| 信号开始事件 | ○(◢) | 收到信号时启动 |

```xml
<!-- 定时器开始事件：每天早上9点自动启动 -->
<startEvent id="timerStart">
    <timerEventDefinition>
        <timeCycle>0 0 9 * * ?</timeCycle>
    </timerEventDefinition>
</startEvent>
```

### 结束事件（End Event）

流程的终点。流程执行到这里就会结束。

```
┌─────────┐
│(circle) │ 结束事件
└─────────┘
```

| 类型 | 图标 | 说明 |
|---|---|---|
| 空结束事件 | (●) | 正常结束 |
| 错误结束事件 | (●) | 以错误结束，可触发错误边界事件 |
| 终止结束事件 | (⊗) | 直接终止整个流程树 |

### 中间事件（Intermediate Event）

发生在流程执行过程中。

```
┌─────────┐
│○(event) │ 中间事件（捕获）
└─────────┘
```

常见场景：
- 任务超时：用户任务配置定时器中间事件
- 等待信号：等待外部系统信号
- 等待消息：等待特定消息到达

---

## 活动（Activities）

活动是流程中需要执行的工作单元。

### 用户任务（User Task）

需要人工处理的任务。流程执行到这里会停下来，等待用户操作。

```
┌───────────────────┐
│                   │
│    用户任务        │
│   □ 用户任务       │
│                   │
└───────────────────┘
```

```xml
<userTask id="approveTask" name="主管审批">
    <documentation>报销金额超过1万的审批</documentation>
    <potentialOwner>
        <resourceAssignmentExpression>
            <formalExpression>group(director)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
</userTask>
```

### 服务任务（Service Task）

自动执行的任务，不需要人工介入。

```
┌───────────────────┐
│                   │
│    服务任务        │
│   ■ 服务任务       │
│                   │
└───────────────────┘
```

```xml
<serviceTask id="sendNotification" name="发送通知">
    <extensionElements>
        <flowable:class>com.example.Delegate.SendNotificationDelegate</flowable:class>
    </extensionElements>
</serviceTask>
```

### 脚本任务（Script Task）

执行一段脚本（JavaScript、Groovy等）。

```xml
<scriptTask id="calculateAmount" name="计算金额">
    <script>
        var amount = execution.getVariable("originalAmount");
        var tax = amount * 0.06;
        execution.setVariable("taxAmount", tax);
    </script>
</scriptTask>
```

### 手动任务（Manual Task）

表示不需要系统自动执行的人工操作，比如「现场检查」。

---

## 网关（Gateways）

网关用于控制流程的分流与合流，是 BPMN 中最难理解的组件。

### 排他网关（Exclusive Gateway）

**只会选择一条分支**。条件为真的第一条分支被执行。

```
┌─────────┐
│    ×    │ 排他网关（XOR）
└────┬────┘
     │
   ┌─┴─┐
   │   │
   ▼   ▼
  是   否
```

```xml
<!-- 金额判断：大于10000走高管审批，否则直接财务复核 -->
<exclusiveGateway id="amountCheck"/>

<sequenceFlow id="flow1" sourceRef="amountCheck" targetRef="executiveReview">
    <conditionExpression xsi:type="tFormalExpression">
        ${amount > 10000}
    </conditionExpression>
</sequenceFlow>
<sequenceFlow id="flow2" sourceRef="amountCheck" targetRef="financeReview">
    <conditionExpression xsi:type="tFormalExpression">
        ${amount <= 10000}
    </conditionExpression>
</sequenceFlow>
```

**面试常问**：如果两个条件都为真，会走哪条？

答案是：**排他网关只会选择第一个匹配的条件分支**。因此，条件表达式应该有互斥性。

### 并行网关（Parallel Gateway）

**所有分支同时执行**。用于需要多个步骤并行处理的场景。

```
┌─────────┐
│    +    │ 并行网关（AND）
└────┬────┘
     │
   ┌─┴─┬─┐
   │   │ │
   ▼   ▼ ▼
  A    B  C
```

```xml
<!-- 审批通过后，需要同时通知财务和法务 -->
<parallelGateway id="notifyGate"/>
```

### 包容网关（Inclusive Gateway）

**根据条件选择分支**。每条条件为真的分支都会被选中。

```
┌─────────┐
│    O    │ 包容网关（OR）
└────┬────┘
     │
   ┌─┴─┐
   │   │
   ▼   ▼
  A    B
```

场景：报销金额大于 5000 **或者** 含有差旅费，需要财务复核。

### 事件网关（Event Gateway）

根据**发生的事件**决定走哪条分支，而不是条件表达式。

```
┌─────────┐
│    ◇    │ 事件网关
└────┬────┘
     │
   ┌─┴─┐
   │   │
   ▼   ▼
  事件A 事件B
```

---

## 子流程（Subprocess）

### 嵌入式子流程（Embedded Subprocess）

子流程嵌入在主流程中。

```xml
<subProcess id="approvalSubProcess">
    <startEvent id="subStart"/>
    <userTask id="subTask1"/>
    <endEvent id="subEnd"/>
</subProcess>
```

### 调用活动（Call Activity）

调用一个独立定义的流程（可以被多个流程复用）。

```
┌───────────────────┐
│                   │
│   调用活动         │
│   ⎈ 调用活动       │
│                   │
└───────────────────┘
```

```xml
<!-- 调通用的审批子流程 -->
<callActivity id="callExpenseApproval" calledElement="commonApprovalProcess">
    <inputAssociation>
        <assignment>
            <from>${orderId}</from>
            <to>${_OrderId}</to>
        </assignment>
    </inputAssociation>
</callActivity>
```

---

## 泳道（Pool & Lane）

泳道用于划分职责。一个泳道代表一个角色或部门。

```
┌─────────────────────────────────────────────────┐
│                    泳池（Pool）                   │
├───────────────────────┬─────────────────────────┤
│                       │                          │
│   申请人               │   审批人                  │
│   ┌─────────┐         │   ┌─────────┐           │
│   │提交申请 │         │   │审批任务 │           │
│   └─────────┘         │   └─────────┘           │
│                       │                          │
└───────────────────────┴─────────────────────────┘
```

---

## 常用 BPMN 元素速查

| 类别 | 元素 | 用途 |
|---|---|---|
| **事件** | 开始事件 | 流程入口 |
| | 结束事件 | 流程终点 |
| | 中间事件 | 流程中某时刻发生的事 |
| **活动** | 用户任务 | 人工处理 |
| | 服务任务 | 自动执行 |
| | 脚本任务 | 执行脚本 |
| | 子流程 | 嵌套流程 |
| **网关** | 排他网关 | 条件分支，选一 |
| | 并行网关 | 并行执行，都走 |
| | 包容网关 | 条件分支，多选 |
| | 事件网关 | 事件触发分支 |
| **连接** | 顺序流 | 节点连接 |
| | 消息流 | 跨泳池通信 |

---

## 一个完整的流程示例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:flowable="http://flowable.org/bpmn"
             targetNamespace="http://flowable.org/test">

    <process id="expenseApproval" name="报销审批流程" isExecutable="true">
        
        <!-- 开始事件 -->
        <startEvent id="startEvent"/>
        
        <!-- 提交申请 -->
        <userTask id="submitExpense" name="提交报销申请"/>
        
        <!-- 金额判断 -->
        <exclusiveGateway id="amountGateway" name="金额判断"/>
        
        <!-- 高管审批（金额 > 10000） -->
        <userTask id="executiveReview" name="高管审批"/>
        
        <!-- 主管审批（金额 <= 10000） -->
        <userTask id="directorReview" name="主管审批"/>
        
        <!-- 财务复核 -->
        <userTask id="financeReview" name="财务复核"/>
        
        <!-- 结束事件 -->
        <endEvent id="endEvent"/>
        
        <!-- 顺序流 -->
        <sequenceFlow id="flow1" sourceRef="startEvent" targetRef="submitExpense"/>
        <sequenceFlow id="flow2" sourceRef="submitExpense" targetRef="amountGateway"/>
        
        <!-- 条件分支 -->
        <sequenceFlow id="flow3" sourceRef="amountGateway" targetRef="executiveReview">
            <conditionExpression>${amount > 10000}</conditionExpression>
        </sequenceFlow>
        <sequenceFlow id="flow4" sourceRef="amountGateway" targetRef="directorReview">
            <conditionExpression>${amount <= 10000}</conditionExpression>
        </sequenceFlow>
        
        <!-- 高管/主管审批后都到财务复核 -->
        <sequenceFlow id="flow5" sourceRef="executiveReview" targetRef="financeReview"/>
        <sequenceFlow id="flow6" sourceRef="directorReview" targetRef="financeReview"/>
        <sequenceFlow id="flow7" sourceRef="financeReview" targetRef="endEvent"/>
        
    </process>
</definitions>
```

这个流程图对应的图形化表示：

```
开始 → 提交申请 → [金额>10000?] → 是 → 高管审批 ─┐
                      ↓否                         │
                   主管审批 ──────────────────────→ 财务复核 → 结束
```

---

## 总结

BPMN 2.0 规范的核心元素：

| 类型 | 核心要素 | 记忆口诀 |
|---|---|---|
| 事件 | 开始/中间/结束 | 「起承转合」 |
| 活动 | 用户任务/服务任务/子流程 | 「人机子」 |
| 网关 | 排他/并行/包容/事件 | 「X、+、O、◇」 |
| 连接 | 顺序流/消息流 | 「连」 |

---

## 留给你的问题

假设有这样一个场景：
- 报销金额 > 5000，需要财务复核
- 报销类型是「差旅」，需要主管复核

如果报销金额 8000，类型是「差旅」，走并行网关的话，财务复核和主管复核会同时开始——但这两件事真的有先后依赖吗？

什么时候用并行网关，什么时候用串行？你能想到一个判断标准吗？
