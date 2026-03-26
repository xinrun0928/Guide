# Flowable CMMN 案例管理：非结构化业务流程

你遇到过这种情况吗？

一个客服处理工单：
- 首先收集客户信息
- 然后分析问题原因
- 最后给出解决方案

这三个步骤看起来有顺序，但其实**顺序可能随时变化**——有时候客户信息收集和问题分析可以同时进行，有时候又必须先分析再解决方案。

传统的 BPMN 流程强调**步骤的顺序**，但现实中有很多**非结构化**的业务，它们需要更灵活的案例管理。

**CMMN（Case Management Model and Notation）就是来解决这个问题的。**

这篇文章带你了解 Flowable 的 CMMN 案例管理。

---

## 什么时候用 CMMN？

### BPMN 适用场景

```
顺序清晰、步骤固定：
开始 → 提交申请 → 主管审批 → 财务复核 → 结束
```

### CMMN 适用场景

```
顺序灵活、步骤可变：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  客服工单处理                                                │
│                                                             │
│  ┌─────────────┐                                          │
│  │ 收集信息    │ ← 必需，先做后做都行                       │
│  └──────┬──────┘                                          │
│         ↓                                                  │
│  ┌──────┴──────┐    ┌─────────────┐                      │
│  │             │    │ 分析问题    │ ← 可选，可能不做      │
│  │   ┌─────┐   │    └─────────────┘                      │
│  │   │评估 │   │ ← 新增步骤（根据情况决定是否做）        │
│  │   └─────┘   │                                          │
│  │             │    ┌─────────────┐                      │
│  │   ┌─────┐   │    │ 提供方案    │ ← 可选，可能多个方案 │
│  │   │确认 │   │    └─────────────┘                      │
│  │   └─────┘   │                                          │
│  └─────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### BPMN vs CMMN 对比

| 维度 | BPMN | CMMN |
|---|---|---|
| 流程确定性 | 高（步骤顺序明确） | 低（步骤可以变化） |
| 适用场景 | 结构化审批流 | 非结构化案例处理 |
| 执行模式 | 按定义顺序执行 | 事件驱动、自由顺序 |
| 任务依赖 | 显式定义 | 通过 entry/exit 条件触发 |
| 典型案例 | 审批流、订单处理 | 客服处理、案件调查 |

---

## CMMN 核心元素

### Plan Item（计划项）

CMMN 中的工作单元，可以是：
- **Task（任务）**：人工或自动执行的工作
- **Milestone（里程碑）**：表示某个阶段完成
- **Stage（阶段）**：嵌套的子案例

### Criteria（条件）

控制 Plan Item 的触发：
- **Entry Criterion（进入条件）**：满足条件才进入
- **Exit Criterion（退出条件）**：满足条件则退出

### Repeater（重复器）

控制 Plan Item 的重复执行。

---

## CMMN 案例定义

### 简单案例

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/CMMN/20151111/MODEL"
             xmlns:flowable="http://flowable.org/cmmn"
             targetNamespace="http://flowable.org/test">
    
    <case id="customerServiceCase" name="客服案例">
        <casePlanModel id="casePlanModel" name="案例计划">
            
            <!-- 里程碑：收集信息 -->
            <milestone id="milestone1" name="信息收集完成"/>
            
            <!-- 人工任务：收集客户信息 -->
            <humanTask id="task1" name="收集客户信息"/>
            
            <!-- 人工任务：分析问题 -->
            <humanTask id="task2" name="分析问题原因"/>
            
            <!-- 人工任务：提供解决方案 -->
            <humanTask id="task3" name="提供解决方案"/>
            
            <!-- 里程碑：案例关闭 -->
            <milestone id="milestone2" name="案例关闭"/>
            
        </casePlanModel>
    </case>
</definitions>
```

### 带条件的案例

```xml
<case id="customerServiceCase" name="客服案例">
    <casePlanModel id="casePlanModel" name="案例计划">
        
        <!-- 人工任务：分析问题（带进入条件）-->
        <humanTask id="task2" name="分析问题原因">
            <entryCriterion sentryRef="sentry1"/>
        </humanTask>
        
        <!-- 哨兵（Sentry）：控制任务的触发 -->
        <sentry id="sentry1">
            <planItemOnPart sourceRef="task1">
                <standardEvent>complete</standardEvent>
            </planItemOnPart>
        </sentry>
        
        <!-- 说明：task2 只有在 task1 完成后才会激活 -->
        
    </casePlanModel>
</case>
```

---

## CMMN 与 BPMN 的集成

### 从流程调用案例

```xml
<!-- BPMN 流程 -->
<process id="mainProcess">
    <startEvent id="start"/>
    
    <!-- 调用 CMMN 案例 -->
    <caseServiceTask id="callCase" name="处理客户请求"
                     flowable:caseDefinitonKey="customerServiceCase"/>
    
    <endEvent id="end"/>
    
    <sequenceFlow sourceRef="start" targetRef="callCase"/>
    <sequenceFlow sourceRef="callCase" targetRef="end"/>
</process>
```

### 从案例调用流程

```xml
<!-- CMMN 案例 -->
<case id="customerServiceCase">
    <casePlanModel id="casePlanModel">
        
        <!-- 调用 BPMN 流程 -->
        <processTask id="processTask1" name="执行标准流程"
                    flowable:processDefinitionKey="standardProcess"/>
        
    </casePlanModel>
</case>
```

---

## Java API

### 启动案例

```java
@Autowired
private CaseService caseService;

/**
 * 启动案例实例
 */
@Test
public void startCase() {
    CaseInstance caseInstance = caseService.createCaseInstanceBuilder()
        .caseDefinitionKey("customerServiceCase")
        .businessKey("CASE-001")
        .variable("customerId", "CUST-123")
        .variable("priority", "HIGH")
        .start();
    
    System.out.println("案例实例ID: " + caseInstance.getId());
}
```

### 查询案例任务

```java
/**
 * 查询案例中的任务
 */
@Test
public void queryCaseTasks() {
    // 查询某个案例的所有任务
    List&lt;CaseTask&gt; tasks = caseService.createCaseTaskQuery()
        .caseInstanceId("caseInstanceId")
        .list();
    
    // 查询待处理的任务
    List&lt;CaseTask&gt; pendingTasks = caseService.createCaseTaskQuery()
        .assignee("zhangsan")
        .list();
}
```

### 控制案例执行

```java
/**
 * 完成案例任务
 */
@Test
public void completeCaseTask() {
    caseService.completeCaseTask("caseTaskId");
}

/**
 * 触发里程碑
 */
@Test
public void triggerMilestone() {
    caseService.completeCaseMilestone("milestoneId");
}

/**
 * 创建新的计划项
 */
@Test
public void manualStart() {
    // 手动触发一个可选任务
    caseService.createPlanItemInstanceBuilder()
        .caseDefinitionKey("customerServiceCase")
        .planItemDefinitionId("task4")
        .create();
}
```

---

## 典型应用场景

### 1. 客服工单处理

```xml
<!-- 客服案例 -->
<case id="customerServiceCase">
    <casePlanModel>
        
        <!-- 必选任务 -->
        <humanTask id="collectInfo" name="收集客户信息"/>
        
        <!-- 可选任务（需要时才做）-->
        <humanTask id="analyzeProblem" name="分析问题"/>
        
        <!-- 里程碑 -->
        <milestone id="resolved" name="问题已解决"/>
        
        <!-- 控制逻辑 -->
        <sentry id="sentry1">
            <planItemOnPart sourceRef="collectInfo">
                <standardEvent>complete</standardEvent>
            </planItemOnPart>
        </sentry>
        
        <!-- analyzeProblem 在 collectInfo 完成后可选 -->
        <humanTask id="analyzeProblem">
            <entryCriterion sentryRef="sentry1"/>
        </humanTask>
        
    </casePlanModel>
</case>
```

### 2. 案件调查

```xml
<!-- 调查案例 -->
<case id="investigationCase">
    <casePlanModel>
        
        <milestone id="investigationStarted" name="调查开始"/>
        
        <!-- 多个调查步骤，顺序灵活 -->
        <humanTask id="collectEvidence" name="收集证据"/>
        <humanTask id="interviewWitness" name="证人访谈"/>
        <humanTask id="analyzeData" name="数据分析"/>
        
        <!-- 条件触发 -->
        <sentry id="sentry1">
            <planItemOnPart sourceRef="collectEvidence">
                <standardEvent>complete</standardEvent>
            </planItemOnPart>
        </sentry>
        
        <!-- 只有收集证据后才开始数据分析 -->
        <humanTask id="analyzeData">
            <entryCriterion sentryRef="sentry1"/>
        </humanTask>
        
        <milestone id="investigationCompleted" name="调查完成"/>
        
    </casePlanModel>
</case>
```

---

## 总结：何时用 BPMN，何时用 CMMN？

| 场景 | 推荐 |
|---|---|
| 审批流程（固定步骤） | BPMN |
| 订单处理（状态机） | BPMN |
| 客服工单（灵活处理） | CMMN |
| 案件调查（自由探索） | CMMN |
| 混合场景 | BPMN + CMMN |

---

## 留给你的问题

假设你在实现一个软件开发项目流程：

1. 需求收集（必做）
2. 技术设计（根据项目复杂度可选）
3. 代码开发（必做）
4. 代码评审（根据代码量可选，多人评审）
5. 测试（必做）
6. 上线部署（必做）

**问题：**
1. 哪些步骤适合用 BPMN，哪些适合用 CMMN？
2. 如何设计 BPMN 和 CMMN 的边界？
3. 如果评审发现重大问题，需要返回设计阶段，如何处理？

这是一个典型的**结构化与非结构化混合**场景，需要合理规划 BPMN 和 CMMN 的边界。
