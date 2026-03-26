# Flowable DMN 决策引擎：业务规则与代码分离

你有没有遇到过这种情况：业务流程里有一段复杂的判断逻辑，比如：

- 报销金额 > 10000，需要总监审批
- 报销金额 > 5000 且部门是销售，需要部门经理审批
- 其他情况，主管审批即可

这段逻辑如果写在代码里，每次改规则都要改代码、测试、发版。

**DMN（Decision Model and Notation）就是为了解决这个问题——让业务人员可以直接定义决策规则，而不需要写代码。**

这篇文章带你彻底搞懂 Flowable 的 DMN 决策引擎。

---

## 为什么需要 DMN？

### 传统方式的痛点

```java
// 审批级别判断（硬编码在代码里）
public String determineApprovalLevel(Integer amount, String department) {
    if (amount > 10000) {
        return "DIRECTOR";
    } else if (amount > 5000 && "sales".equals(department)) {
        return "MANAGER";
    } else {
        return "SUPERVISOR";
    }
}

// 问题：
// 1. 规则变了要改代码
// 2. 业务人员看不懂代码
// 3. 测试困难
// 4. 规则复杂时难以维护
```

### DMN 的优势

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  传统方式：规则写在代码里                                  │
│  ┌─────────────┐                                          │
│  │   Java 代码  │                                          │
│  └─────────────┘                                          │
│        ↓                                                   │
│    改代码 → 测试 → 发版                                    │
│                                                             │
│  DMN 方式：规则写在决策表里                                │
│  ┌─────────────┐                                          │
│  │   决策表    │  ← 业务人员可以直接编辑                  │
│  └─────────────┘                                          │
│        ↓                                                   │
│    改决策表 → 热加载                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## DMN 决策表结构

### 基础结构

```
┌─────────────────────────────────────────────────────────────┐
│                    审批决策表                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入（Input）：                                            │
│  ┌──────────────────┬──────────────────┐                 │
│  │  金额 (amount)    │  部门 (department) │                 │
│  ├──────────────────┼──────────────────┤                 │
│  │  > 10000        │  *                │                 │
│  │  > 5000         │  销售             │                 │
│  │  *              │  *                │                 │
│  └──────────────────┴──────────────────┘                 │
│                                                             │
│  输出（Output）：                                           │
│  ┌────────────────────────────────────────────────────┐   │
│  │  审批级别 (approvalLevel)    是否需要财务复核       │   │
│  ├────────────────────────────────────────────────────┤   │
│  │  总监                       是                      │   │
│  │  经理                       是                      │   │
│  │  主管                       否                      │   │
│  └────────────────────────────────────────────────────┘   │
│                                                             │
│  规则解释：                                                │
│  规则1：金额 > 10000 → 审批级别=总监，需要财务复核       │
│  规则2：金额 > 5000 且部门=销售 → 审批级别=经理，需要   │
│  规则3：其他情况 → 审批级别=主管，不需要财务复核         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### FEEL 表达式

DMN 使用 FEEL（Friendly Enough Expression Language）作为表达式语言：

```xml
<!-- FEEL 表达式示例 -->
<inputEntry>
    <text>[>10000]</text>
</inputEntry>
<inputEntry>
    <text>["销售", "市场"]</text>
</inputEntry>
<inputEntry>
    <text>if amount > 10000 then "HIGH" else if amount > 5000 then "MEDIUM" else "LOW"</text>
</inputEntry>
```

---

## BPMN 集成 DMN

### 决策服务任务

在 BPMN 中调用 DMN 决策：

```xml
<!-- BPMN 中的决策服务任务 -->
<businessRuleTask id="determineApproval" name="确定审批级别"
                 flowable:decisionTableReferenceKey="approvalDecision"/>
```

### 完整示例

```xml
<process id="expenseApproval" name="报销审批流程" isExecutable="true">
    
    <startEvent id="start"/>
    <userTask id="submitExpense" name="提交报销"/>
    
    <!-- 调用 DMN 决策 -->
    <businessRuleTask id="determineApproval" name="确定审批级别"
                     flowable:decisionTableReferenceKey="approvalDecision"
                     flowable:resultVariable="approvalResult"/>
    
    <!-- 根据决策结果分流 -->
    <exclusiveGateway id="approvalGateway"/>
    
    <userTask id="directorApproval" name="总监审批"/>
    <userTask id="managerApproval" name="经理审批"/>
    <userTask id="supervisorApproval" name="主管审批"/>
    
    <endEvent id="end"/>
    
    <sequenceFlow sourceRef="start" targetRef="submitExpense"/>
    <sequenceFlow sourceRef="submitExpense" targetRef="determineApproval"/>
    <sequenceFlow sourceRef="determineApproval" targetRef="approvalGateway"/>
    
    <sequenceFlow sourceRef="approvalGateway" targetRef="directorApproval">
        <conditionExpression>${approvalResult == "DIRECTOR"}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow sourceRef="approvalGateway" targetRef="managerApproval">
        <conditionExpression>${approvalResult == "MANAGER"}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow sourceRef="approvalGateway" targetRef="supervisorApproval">
        <conditionExpression>${approvalResult == "SUPERVISOR"}</conditionExpression>
    </sequenceFlow>
    
    <sequenceFlow sourceRef="directorApproval" targetRef="end"/>
    <sequenceFlow sourceRef="managerApproval" targetRef="end"/>
    <sequenceFlow sourceRef="supervisorApproval" targetRef="end"/>
</process>
```

---

## Java 代码调用 DMN

### 直接调用决策表

```java
@Autowired
private DmnEngine dmnEngine;

/**
 * 调用 DMN 决策
 */
@Test
public void evaluateDecision() {
    DmnRuleService ruleService = dmnEngine.getRuleService();
    
    // 准备输入变量
    VariableMap variables = Variables.createVariables()
        .putValue("amount", 15000)
        .putValue("department", "sales");
    
    // 执行决策
    DmnDecisionResult result = ruleService.executeDecision(
        "approvalDecision",  // 决策定义 Key
        variables
    );
    
    // 获取结果
    DmnDecisionResultEntries outputEntries = result.getFirstResult();
    
    String approvalLevel = outputEntries.getEntry("approvalLevel");
    Boolean needFinanceReview = outputEntries.getEntry("needFinanceReview");
    
    System.out.println("审批级别: " + approvalLevel);
    System.out.println("需要财务复核: " + needFinanceReview);
}
```

### 完整服务封装

```java
@Service
public class DecisionService {
    
    @Autowired
    private DmnEngine dmnEngine;
    
    /**
     * 执行审批决策
     */
    public ApprovalDecision evaluateApproval(Integer amount, String department) {
        DmnRuleService ruleService = dmnEngine.getRuleService();
        
        VariableMap variables = Variables.createVariables()
            .putValue("amount", amount)
            .putValue("department", department);
        
        DmnDecisionResult result = ruleService.executeDecision(
            "approvalDecision",
            variables
        );
        
        DmnDecisionResultEntries entries = result.getFirstResult();
        
        return new ApprovalDecision(
            entries.getEntry("approvalLevel"),
            entries.getEntry("needFinanceReview"),
            entries.getEntry("approvalType")
        );
    }
    
    /**
     * 执行价格折扣决策
     */
    public BigDecimal evaluateDiscount(String customerType, BigDecimal originalPrice) {
        DmnRuleService ruleService = dmnEngine.getRuleService();
        
        VariableMap variables = Variables.createVariables()
            .putValue("customerType", customerType)
            .putValue("originalPrice", originalPrice);
        
        DmnDecisionResult result = ruleService.executeDecision(
            "discountDecision",
            variables
        );
        
        return result.getFirstResult().getEntry("discountRate");
    }
}

/**
 * 审批决策结果
 */
@Data
@AllArgsConstructor
public class ApprovalDecision {
    private String approvalLevel;
    private Boolean needFinanceReview;
    private String approvalType;
}
```

---

## 决策表设计

### 命中策略

DMN 支持多种命中策略：

| 策略 | 说明 |
|---|---|
| FIRST | 命中第一条匹配的规则 |
| UNIQUE | 只能有一条规则匹配（否则报错）|
| ANY | 任意一条匹配即可 |
| COLLECT | 收集所有匹配的规则结果 |

```java
// 指定命中策略
DmnDecisionResult result = ruleService.executeDecisionBuilder("discountDecision")
    .variables(variables)
    .hitPolicy(HitPolicy.UNIQUE)
    .execute();
```

### 规则优先级

```xml
<!-- 添加优先级 -->
<decisionRule id="rule1" outputEntry="10%">
    <inputEntry>VIP</inputEntry>
    <annotation>最高优先级：VIP客户</annotation>
</decisionRule>
```

---

## 决策服务生命周期

### 部署决策

```java
/**
 * 部署 DMN 决策
 */
@Test
public void deployDecision() {
    RepositoryService repositoryService = processEngine.getRepositoryService();
    
    Deployment deployment = repositoryService.createDeployment()
        .name("审批决策表")
        .addClasspathResource("dmn/approval-decision.dmn")
        .deploy();
    
    System.out.println("决策部署ID: " + deployment.getId());
}
```

### 查询决策

```java
/**
 * 查询已部署的决策
 */
@Test
public void queryDecisions() {
    DecisionService decisionService = processEngine.getDecisionService();
    
    List&lt;DecisionDefinition&gt; decisions = decisionService
        .createDecisionDefinitionQuery()
        .list();
    
    for (DecisionDefinition decision : decisions) {
        System.out.println("Key: " + decision.getKey());
        System.out.println("Name: " + decision.getName());
        System.out.println("Version: " + decision.getVersion());
    }
}
```

### 历史决策

```java
/**
 * 查询决策历史
 */
@Test
public void queryDecisionHistory() {
    HistoryService historyService = processEngine.getHistoryService();
    
    List&lt;HistoricDecisionInputInstance&gt; inputs = historyService
        .createHistoricDecisionInputInstanceQuery()
        .decisionInstanceId("decisionInstanceId")
        .list();
    
    List&lt;HistoricDecisionOutputInstance&gt; outputs = historyService
        .createHistoricDecisionOutputInstanceQuery()
        .decisionInstanceId("decisionInstanceId")
        .list();
}
```

---

## DRD（决策需求图）

复杂的业务决策可以拆分为多个决策表，通过 DRD 关联：

```
┌─────────────────────────────────────────────────────────────┐
│                    客户信用评估决策                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────────┐                                         │
│  │ 历史交易表    │                                         │
│  └───────┬───────┘                                         │
│          ↓                                                 │
│  ┌───────────────┐                                         │
│  │ 交易评分表    │                                         │
│  └───────┬───────┘                                         │
│          ↓                                                 │
│  ┌───────────────┐                                         │
│  │ 客户评级表    │                                         │
│  └───────┬───────┘                                         │
│          ↓                                                 │
│  ┌───────────────┐                                         │
│  │ 信用额度表    │                                         │
│  └───────────────┘                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 总结

| 概念 | 说明 |
|---|---|
| DMN | 决策模型与标注，业务规则与代码分离 |
| 决策表 | 定义输入、输出和规则 |
| FEEL | 友好的表达式语言 |
| BPMN 集成 | 通过 BusinessRuleTask 调用决策 |
| 命中策略 | FIRST、UNIQUE、ANY、COLLECT |

---

## 留给你的问题

假设你在实现一个复杂的定价系统，规则如下：

1. VIP 客户：固定 8 折
2. 普通客户：订单金额 > 10000，9 折；> 5000，95 折；其他不打折
3. 新客户（注册 < 30 天）：额外 9 折

**问题：**
1. 如何用 DMN 决策表实现这个逻辑？
2. 多个折扣之间是乘法关系还是加法关系？
3. 如何处理规则之间的优先级？

这是一个典型的**多层决策**问题，需要合理的 DRD 设计。
