# Camunda BPMN 流程设计与 DMN 决策表

你有没有这种感觉：有些业务流程很复杂，用 if-else 写出来像一团乱麻。

比如报销审批：
- 金额小于 5000，主管审批即可
- 金额 5000-20000，主管 + 财务审批
- 金额大于 20000，主管 + 财务 + 高管审批
- 如果是特殊类别（如差旅），还需要额外检查

这种「规则驱动」的逻辑，用 BPMN 的网关来实现会很复杂，但用 **DMN 决策表**就简单多了。

Camunda 同时支持 BPMN 和 DMN，让你能用最合适的方式处理不同类型的逻辑。

---

## BPMN 流程设计

### 基础流程元素

Camunda 使用标准的 BPMN 2.0 元素：

```xml
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
             targetNamespace="http://bpmn.io/schema/bpmn">
    
    <!-- 流程定义 -->
    <process id="expenseApproval" name="报销审批流程" isExecutable="true">
        
        <!-- 开始事件 -->
        <startEvent id="start" name="开始"/>
        
        <!-- 用户任务 -->
        <userTask id="submitExpense" name="提交报销">
            <extensionElements>
                <!-- 表单 key（对应 Camunda Form） -->
                <camunda:formKey>embedded:app:forms/expense-form.html</camunda:formKey>
            </extensionElements>
        </userTask>
        
        <!-- 排他网关 -->
        <exclusiveGateway id="amountCheck" name="金额判断"/>
        
        <!-- 服务任务 -->
        <serviceTask id="notifyApplicant" name="通知申请人">
            <extensionElements>
                <camunda:expression>${notificationService.send()}</camunda:expression>
            </extensionElements>
        </serviceTask>
        
        <!-- 结束事件 -->
        <endEvent id="end" name="结束"/>
        
        <!-- 顺序流 -->
        <sequenceFlow id="flow1" sourceRef="start" targetRef="submitExpense"/>
        <sequenceFlow id="flow2" sourceRef="submitExpense" targetRef="amountCheck"/>
        
        <!-- 带条件的顺序流 -->
        <sequenceFlow id="flow3a" sourceRef="amountCheck" targetRef="managerApproval">
            <conditionExpression>${amount &lt;= 5000}</conditionExpression>
        </sequenceFlow>
        <sequenceFlow id="flow3b" sourceRef="amountCheck" targetRef="financeApproval">
            <conditionExpression>${amount &gt; 5000 &amp;&amp; amount &lt;= 20000}</conditionExpression>
        </sequenceFlow>
        <sequenceFlow id="flow3c" sourceRef="amountCheck" targetRef="executiveApproval">
            <conditionExpression>${amount &gt; 20000}</conditionExpression>
        </sequenceFlow>
        
    </process>
</definitions>
```

### Camunda 扩展元素

Camunda 在标准 BPMN 基础上增加了很多实用的扩展：

```xml
<userTask id="managerApproval" name="经理审批">
    <extensionElements>
        <!-- 候选人表达式 -->
        <camunda:candidateUsers>zhangsan, lisi</camunda:candidateUsers>
        <camunda:candidateGroups>${managementGroup}</camunda:candidateGroups>
        
        <!-- 任务描述 -->
        <camunda:description>请审批 ${applicant} 的报销申请</camunda:description>
        
        <!-- 优先级 -->
        <camunda:priority>${amount &gt; 10000 ? 10 : 5}</camunda:priority>
        
        <!-- 任务监听器 -->
        <camunda:taskListener event="create">
            <camunda:expression>${taskListener.onCreate(execution)}</camunda:expression>
        </camunda:taskListener>
    </extensionElements>
</userTask>
```

### 服务任务类型

Camunda 支持多种服务任务实现方式：

```xml
<!-- 方式1：表达式 -->
<serviceTask id="validateRequest" name="验证请求">
    <camunda:expression>${validationService.validate(request)}</camunda:expression>
</serviceTask>

<!-- 方式2：委托类 -->
<serviceTask id="sendEmail" name="发送邮件">
    <camunda:delegateExpression>${emailDelegate}</camunda:delegateExpression>
</serviceTask>

<!-- 方式3：连接器 -->
<serviceTask id="callExternalSystem" name="调用外部系统">
    <camunda:connector>
        <camunda:connectorId>http-connector</camunda:connectorId>
        <camunda:inputOutput>
            <camunda:inputParameter name="url">https://api.example.com/check</camunda:inputParameter>
            <camunda:inputParameter name="method">POST</camunda:inputParameter>
            <camunda:outputParameter name="result">${response.body}</camunda:outputParameter>
        </camunda:inputOutput>
    </camunda:connector>
</serviceTask>

<!-- 方式4：脚本任务 -->
<scriptTask id="calculateDiscount" name="计算折扣" scriptFormat="groovy">
    <script>
        if (amount &gt; 10000) {
            discount = amount * 0.15;
        } else if (amount &gt; 5000) {
            discount = amount * 0.1;
        } else {
            discount = 0;
        }
        execution.setVariable("discount", discount);
    </script>
</scriptTask>
```

### 委托类实现

```java
/**
 * 委托类实现
 * 实现 JavaDelegate 或 ActivityBehavior 接口
 */

// 方式1：实现 JavaDelegate
public class EmailDelegate implements JavaDelegate {
    
    @Override
    public void execute(DelegateExecution execution) throws Exception {
        String recipient = (String) execution.getVariable("email");
        String subject = (String) execution.getVariable("subject");
        String message = (String) execution.getVariable("message");
        
        // 发送邮件
        emailService.send(recipient, subject, message);
        
        // 设置输出变量
        execution.setVariable("emailSent", true);
        execution.setVariable("emailSentAt", new Date());
    }
}

// 方式2：实现 ActivityBehavior（可控制流程走向）
public class ConditionalBranchBehavior implements ActivityBehavior {
    
    @Override
    public void execute(DelegateExecution execution) {
        String type = (String) execution.getVariable("requestType");
        
        if ("urgent".equals(type)) {
            // 动态选择下一个节点
            execution.executeActivity("urgentTask");
        } else if ("special".equals(type)) {
            execution.executeActivity("specialTask");
        } else {
            // 正常流程继续
            execution.takeDefaultOutgoingSequenceFlow();
        }
    }
}
```

---

## DMN 决策表

### DMN 基础

DMN（Decision Model and Notation）是一种用于**业务决策建模**的标准。

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   DMN 决策表示例：报销审批规则                                    │
│                                                                 │
│   ════════════════════════════════════════════════════════════  │
│   金额范围        │ 部门      │ 特殊类别 │ 审批人    │ 备注     │
│   ────────────────┼───────────┼─────────┼───────────┼────────  │
│   &lt; 5000         │ *         │ -       │ 主管      │ 普通审批 │
│   5000 - 20000    │ *         │ -       │ 财务      │ 需复核   │
│   &gt; 20000        │ *         │ -       │ 高管      │ 需会签   │
│   *               │ 销售      │ -       │ 总监      │ 销售特殊 │
│   *               │ *         │ 差旅    │ 主管+差旅 │ 差旅额外 │
│   ════════════════════════════════════════════════════════════  │
│                                                                 │
│   规则匹配：从上到下，匹配第一个满足条件的行                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### DMN XML 定义

```xml
<definitions xmlns="http://www.omg.org/spec/DMN/20180521/MODEL"
             xmlns:dmndi="http://www.omg.org/spec/DMN/20180521/DI"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             xmlns:camunda="http://camunda.org/schema/1.0/dmn"
             id="approvalRules"
             name="审批规则"
             namespace="http://camunda.org/example">
    
    <decision id="approvalDecision" name="审批决策">
        <extensionElements>
            <camunda:historyTimeToLive>90</camunda:historyTimeToLive>
        </extensionElements>
        
        <decisionTable id="approvalTable" hitPolicy="FIRST">
            
            <!-- 输入表达式 -->
            <input id="input1" label="金额">
                <inputExpression typeRef="number">
                    <text>amount</text>
                </inputExpression>
            </input>
            
            <input id="input2" label="部门">
                <inputExpression typeRef="string">
                    <text>department</text>
                </inputExpression>
            </input>
            
            <input id="input3" label="特殊类别">
                <inputExpression typeRef="string">
                    <text>category</text>
                </inputExpression>
            </input>
            
            <!-- 输出 -->
            <output id="output1" label="审批级别" name="approvalLevel" typeRef="string"/>
            <output id="output2" label="需要财务复核" name="needFinanceReview" typeRef="boolean"/>
            <output id="output3" label="备注" name="note" typeRef="string"/>
            
            <!-- 规则 -->
            <!-- 规则1：小金额，普通审批 -->
            <rule id="rule1">
                <inputEntry id="inputEntry1">
                    <text>&lt;= 5000</text>
                </inputEntry>
                <inputEntry id="inputEntry2">
                    <text>-</text>  <!-- 任意值 -->
                </inputEntry>
                <inputEntry id="inputEntry3">
                    <text>-</text>
                </inputEntry>
                <outputEntry id="outputEntry1">
                    <text>"MANAGER"</text>
                </outputEntry>
                <outputEntry id="outputEntry2">
                    <text>false</text>
                </outputEntry>
                <outputEntry id="outputEntry3">
                    <text>"普通审批"</text>
                </outputEntry>
            </rule>
            
            <!-- 规则2：中等金额，需财务复核 -->
            <rule id="rule2">
                <inputEntry id="inputEntry1">
                    <text>(5000..20000]</text>
                </inputEntry>
                <inputEntry id="inputEntry2">
                    <text>-</text>
                </inputEntry>
                <inputEntry id="inputEntry3">
                    <text>-</text>
                </inputEntry>
                <outputEntry id="outputEntry1">
                    <text>"FINANCE"</text>
                </outputEntry>
                <outputEntry id="outputEntry2">
                    <text>true</text>
                </outputEntry>
                <outputEntry id="outputEntry3">
                    <text>"需财务复核"</text>
                </outputEntry>
            </rule>
            
            <!-- 规则3：销售部门特殊规则 -->
            <rule id="rule3">
                <inputEntry id="inputEntry1">
                    <text>-</text>
                </inputEntry>
                <inputEntry id="inputEntry2">
                    <text>"sales"</text>
                </inputEntry>
                <inputEntry id="inputEntry3">
                    <text>-</text>
                </inputEntry>
                <outputEntry id="outputEntry1">
                    <text>"DIRECTOR"</text>
                </outputEntry>
                <outputEntry id="outputEntry2">
                    <text>false</text>
                </outputEntry>
                <outputEntry id="outputEntry3">
                    <text>"销售特殊规则"</text>
                </outputEntry>
            </rule>
            
            <!-- 规则4：差旅类别 -->
            <rule id="rule4">
                <inputEntry id="inputEntry1">
                    <text>-</text>
                </inputEntry>
                <inputEntry id="inputEntry2">
                    <text>-</text>
                </inputEntry>
                <inputEntry id="inputEntry3">
                    <text>"travel"</text>
                </inputEntry>
                <outputEntry id="outputEntry1">
                    <text>"MANAGER_PLUS"</text>
                </outputEntry>
                <outputEntry id="outputEntry2">
                    <text>true</text>
                </outputEntry>
                <outputEntry id="outputEntry3">
                    <text>"差旅需额外检查"</text>
                </outputEntry>
            </rule>
            
        </decisionTable>
    </decision>
</definitions>
```

### DMN 与 BPMN 集成

#### 在流程中调用决策

```xml
<!-- BPMN 中使用业务规则任务调用 DMN -->
<businessRuleTask id="determineApproval" name="确定审批级别">
    <extensionElements>
        <!-- 决策 Key -->
        <camunda:decisionRef>approvalDecision</camunda:decisionRef>
        <!-- 结果映射 -->
        <camunda:mapDecisionResult>
            <camunda:result name="approvalLevel"/>
            <camunda:result name="needFinanceReview"/>
        </camunda:mapDecisionResult>
    </extensionElements>
</businessRuleTask>
```

#### 完整示例

```java
/**
 * DMN 与 BPMN 集成使用
 */
public class DmnIntegrationDemo {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private DecisionService decisionService;
    
    /**
     * 启动流程，DMN 会自动被调用
     */
    @Test
    public void startProcessWithDmn() {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("amount", 15000);
        variables.put("department", "sales");
        variables.put("category", "office");
        
        // 启动流程，会自动执行 BusinessRuleTask
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            "expenseApproval", variables);
        
        // 等待流程执行到决策节点后，检查结果
        // ...
    }
    
    /**
     * 手动调用决策
     */
    @Test
    public void evaluateDecisionManually() {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("amount", 15000);
        variables.put("department", "sales");
        variables.put("category", "office");
        
        // 直接评估决策表
        DmnDecisionResult result = decisionService.evaluateDecisionTableByKey(
            "approvalDecision",  // 决策定义 key
            variables
        );
        
        // 获取结果
        for (DmnDecisionResultEntry entry : result) {
            String approvalLevel = entry.getEntry("approvalLevel");
            Boolean needFinanceReview = entry.getEntry("needFinanceReview");
            
            System.out.println("审批级别: " + approvalLevel);
            System.out.println("需财务复核: " + needFinanceReview);
        }
    }
    
    /**
     * 动态传入变量
     */
    @Test
    public void evaluateWithVariables() {
        Map&lt;String, Object&gt; inputs = new HashMap&lt;&gt;();
        inputs.put("amount", 30000);
        inputs.put("department", "engineering");
        inputs.put("category", "equipment");
        
        // 创建决策请求
        DecisionQuery query = decisionService.createDecisionRequirementQuery()
            .decisionDefinitionKey("approvalDecision");
        
        // 评估并获取单个结果
        Map&lt;String, Object&gt; result = decisionService.evaluate(
            "approvalDecision",
            inputs
        );
        
        String level = (String) result.get("approvalLevel");
        System.out.println("最终审批级别: " + level);
    }
}
```

### DMN 匹配策略

| 匹配策略 | 说明 | 适用场景 |
|---|---|---|
| FIRST | 匹配第一条规则 | 优先级明确的场景 |
| ANY | 所有匹配规则结果相同 | 规则互斥 |
| COLLECT | 收集所有匹配规则 | 需要汇总多个结果 |
| PRIORITY | 返回优先级最高的 | 优先级场景 |
| RULE ORDER | 按规则顺序返回 | 有顺序要求 |
| OUTPUT ORDER | 按输出值排序 | 排序场景 |

```xml
<!-- 设置匹配策略 -->
<decisionTable id="approvalTable" hitPolicy="COLLECT" collectHitPolicy="COUNT">
    <!-- collectHitPolicy: COUNT/ SUM/ MIN/ MAX/ LIST -->
</decisionTable>
```

---

## 决策服务高级用法

### 决策 vs 表达式对比

| 方式 | 优点 | 缺点 |
|---|---|---|
| DMN 决策表 | 业务人员可维护、可视化编辑 | 需要额外部署 |
| 表达式 | 简单直接 | 复杂规则难以维护 |
| 委托类 | 完全控制 | 需要编码、重新编译 |

### 决策缓存

```java
/**
 * 决策缓存配置
 */
@Bean
public DmnEngineConfiguration dmnEngineConfiguration() {
    return new CachedDmnDecisionService(
        processEngineConfiguration.getDmnEngine()
    ).enableGenericConditionCheck();
}
```

### 决策历史

```java
/**
 * 查询决策历史
 */
@Test
public void queryDecisionHistory() {
    HistoryService historyService = processEngine.getHistoryService();
    
    // 查询历史决策实例
    List&lt;HistoricDecisionInstance&gt; instances = historyService
        .createHistoricDecisionInstanceQuery()
        .decisionDefinitionKey("approvalDecision")
        .evaluatedAfter(new Date(System.currentTimeMillis() - 86400000))  // 过去24小时
        .list();
    
    for (HistoricDecisionInstance instance : instances) {
        System.out.println("决策定义: " + instance.getDecisionDefinitionKey());
        System.out.println("输入: " + instance.getInputs());
        System.out.println("输出: " + instance.getOutputs());
        System.out.println("评估时间: " + instance.getEvaluationTime());
    }
}
```

---

## 实践建议

### 何时使用 DMN

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   推荐使用 DMN 的场景：                                          │
│   ✓ 规则经常变化，需要业务人员维护                               │
│   ✓ 规则复杂，if-else 难以表达                                  │
│   ✓ 规则需要版本管理、审计追溯                                   │
│   ✓ 规则需要可视化展示                                           │
│                                                                 │
│   推荐使用 BPMN 表达式的场景：                                    │
│   ✓ 规则简单，1-2 个条件判断                                     │
│   ✓ 规则稳定，不太可能变化                                       │
│   ✓ 需要性能最优（避免决策服务调用）                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 规则设计原则

```java
/**
 * 好的 DMN 规则设计示例
 */

// 规则应该：
// 1. 清晰描述意图
// 2. 有明确的优先级
// 3. 覆盖所有可能情况（或使用默认规则）
// 4. 避免过于复杂的条件

/**
 * 示例：订单折扣规则表设计
 * 
 * | 客户等级 | 订单金额 | 促销商品 | 折扣率 | 备注     |
 * |----------|----------|----------|--------|----------|
 * | VIP      | *        | 否       | 15%    | VIP专属  |
 * | VIP      | *        | 是       | 20%    | VIP+促销 |
 * | 普通     | &gt;1000   | 否       | 5%     | 满千减   |
 * | 普通     | &gt;1000   | 是       | 10%    | 促销叠加 |
 * | 普通     | &lt;=1000   | *        | 0%     | 无折扣   |
 * 
 * 注意：规则从上到下匹配，第一条命中的规则生效
 * 所以要把更具体的规则放在前面，更通用的规则放在后面
 */
```

---

## 总结：DMN 使用场景

| 场景 | 推荐方式 | 原因 |
|---|---|---|
| 报销审批规则 | DMN | 规则复杂，需要业务维护 |
| 风险评估 | DMN | 多因素组合决策 |
| 简单的条件判断 | BPMN 表达式 | 简单直接 |
| 动态路由 | BPMN 排他网关 | 流程控制 |
| 定价计算 | DMN | 多维度决策 |

---

## 留给你的问题

假设你要设计一个「信贷审批」系统，有以下规则：

1. 贷款金额 &lt; 10 万：自动审批
2. 贷款金额 10-50 万：风控模型评分 &gt; 80 分自动通过，否则人工审批
3. 贷款金额 &gt; 50 万：必须人工审批
4. VIP 客户：自动审批
5. 首次贷款用户：无论金额都需要人工审批

**问题来了：**

1. 如何设计 DMN 决策表来表达这些规则？需要几张表？
2. 「风控模型评分」是一个外部系统的计算结果，应该在 DMN 决策之前调用，还是作为 DMN 的输入？
3. 如果风控模型评分的结果是 78 分，需要人工审批，但此时人工审批员还没处理，客户却提前还款了——如何取消待处理的人工审批？

这三个问题涉及到**规则设计**、**系统集成**和**状态管理**，是复杂业务规则设计的核心挑战。
