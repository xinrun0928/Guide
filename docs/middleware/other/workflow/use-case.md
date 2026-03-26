# 工作流应用场景：审批流、订单处理、自动化业务流程

你可能没有意识到，但工作流引擎每天都在你的生活中「跑着」。

请假申请通过 OA 系统审批、网购订单从下单到收货的追踪、银行开户需要填写一堆表单并等待审核——这些业务流程的背后，都有工作流引擎在调度。

这篇文章带你看看工作流引擎最典型的应用场景，以及如何用 BPMN 建模。

---

## 审批流：最经典的应用

### 场景描述

员工发起请假申请 → 直属主管审批 → HR 复核（假期 > 3 天） → 系统自动归档

```
开始 → 填写请假单 → [假期>3天?] → 否 → 主管审批 → 结束
                      │
                     是 → 主管审批 → HR复核 → 结束
```

### BPMN 建模

```xml
<process id="leaveApproval" name="请假审批流程" isExecutable="true">
    
    <!-- 开始事件 -->
    <startEvent id="start"/>
    
    <!-- 填写请假单 -->
    <userTask id="fillLeaveForm" name="填写请假单">
        <documentation>员工填写请假申请表单</documentation>
    </userTask>
    
    <!-- 金额/天数判断（排他网关） -->
    <exclusiveGateway id="daysCheck"/>
    
    <!-- 主管审批 -->
    <userTask id="managerApproval" name="主管审批"/>
    
    <!-- HR复核 -->
    <userTask id="hrReview" name="HR复核"/>
    
    <!-- 结束事件 -->
    <endEvent id="end"/>
    
    <!-- 顺序流 -->
    <sequenceFlow id="f1" sourceRef="start" targetRef="fillLeaveForm"/>
    <sequenceFlow id="f2" sourceRef="fillLeaveForm" targetRef="daysCheck"/>
    
    <!-- 条件分支 -->
    <sequenceFlow id="f3" sourceRef="daysCheck" targetRef="managerApproval">
        <conditionExpression>${days &lt;= 3}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f4" sourceRef="daysCheck" targetRef="managerApproval">
        <conditionExpression>${days > 3}</conditionExpression>
    </sequenceFlow>
    
    <!-- HR复核（长假期需要） -->
    <sequenceFlow id="f5" sourceRef="managerApproval" targetRef="hrReview">
        <conditionExpression>${days > 3}</conditionExpression>
    </sequenceFlow>
    
    <!-- 直接结束（短假期不需要HR复核） -->
    <sequenceFlow id="f6" sourceRef="managerApproval" targetRef="end">
        <conditionExpression>${days &lt;= 3}</conditionExpression>
    </sequenceFlow>
    
    <sequenceFlow id="f7" sourceRef="hrReview" targetRef="end"/>
</process>
```

### 代码实现

```java
@Service
public class LeaveWorkflowService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    /**
     * 提交请假申请
     */
    public ProcessInstance submitLeave(LeaveRequest request) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("days", request.getDays());
        variables.put("reason", request.getReason());
        variables.put("applicant", request.getApplicant());
        variables.put("leaveType", request.getLeaveType());
        
        // 按流程定义Key启动，businessKey用于关联业务数据
        return runtimeService.startProcessInstanceByKey(
            "leaveApproval",
            request.getApplicant(), // businessKey
            variables
        );
    }
    
    /**
     * 查询主管待办任务
     */
    public List&lt;Task&gt; getManagerPendingTasks(String managerId) {
        return taskService.createTaskQuery()
            .taskCandidateUser(managerId)
            .taskName("主管审批")
            .list();
    }
    
    /**
     * 主管审批
     */
    public void approveByManager(String taskId, boolean approved, String comment) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("managerApproved", approved);
        variables.put("managerComment", comment);
        
        taskService.complete(taskId, variables);
    }
}
```

---

## 订单处理：电商核心流程

### 场景描述

```
下单 → 库存锁定 → 支付 → 支付成功? → 否 → 订单取消 → 释放库存 → 结束
                                      │
                                     是 → 发货准备 → 仓库发货 → 物流追踪 → 确认收货 → 结束
```

这是一个典型的**订单状态机**场景。

### 使用并行网关处理支付和库存

```java
// 订单流程的关键步骤：下单后，同时处理库存和支付
// 使用并行网关
public class OrderWorkflowService {
    
    public ProcessInstance createOrder(Order order) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("orderId", order.getId());
        variables.put("totalAmount", order.getTotalAmount());
        variables.put("items", order.getItems());
        
        return runtimeService.startProcessInstanceByKey(
            "orderProcessing",
            order.getId(),
            variables
        );
    }
}
```

### 支付结果处理

```java
public void handlePaymentCallback(String taskId, PaymentResult result) {
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("paymentSuccess", result.isSuccess());
    variables.put("paymentTime", result.getPaymentTime());
    
    if (!result.isSuccess()) {
        variables.put("failureReason", result.getFailureReason());
    }
    
    // 完成支付任务，流程会根据 paymentSuccess 走不同分支
    taskService.complete(taskId, variables);
}
```

---

## 采购审批：多级审批场景

### 场景描述

- 采购金额 < 1 万：采购员自行决定
- 采购金额 1-10 万：部门主管审批
- 采购金额 10-50 万：部门主管 + 财务审批
- 采购金额 > 50 万：部门主管 + 财务 + 高管审批

### 使用会签实现多级审批

```java
/**
 * 采购金额超过50万时，需要高管会签
 * 使用 Flowable 的 Multi-Instance 实现并行会签
 */
public class PurchaseWorkflowService {
    
    public void submitPurchase(PurchaseRequest request) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("amount", request.getAmount());
        variables.put("item", request.getItem());
        variables.put("reason", request.getReason());
        
        // 根据金额动态设置审批流程
        if (request.getAmount() > 500000) {
            variables.put("executives", Arrays.asList("CEO", "CFO", "COO"));
            // 高管会签人数
            variables.put("nrOfInstances", 3);
            variables.put("nrOfCompletedInstances", 0);
        }
        
        runtimeService.startProcessInstanceByKey(
            "purchaseApproval",
            request.getId(),
            variables
        );
    }
}
```

---

## 客服工单：事件驱动流程

### 场景描述

用户提交工单 → 客服分类 → 根据类型分流 → 解决 → 评价 → 归档

```
开始 → 提交工单 → 客服分类
                    │
         ┌──────────┼──────────┐
         ↓          ↓          ↓
      技术问题    投诉问题    咨询问题
         ↓          ↓          ↓
      工程师处理  投诉专员    客服解答
         ↓          ↓          ↓
         └──────────┼──────────┘
                    ↓
                 用户评价 → 结束
```

### 使用包容网关实现分流

```xml
<!-- 客服工单分流逻辑 -->
<inclusiveGateway id="ticketTypeGateway"/>

<!-- 技术问题 -->
<sequenceFlow id="techFlow" sourceRef="ticketTypeGateway" targetRef="techSupport">
    <conditionExpression>${ticketType == 'technical'}</conditionExpression>
</sequenceFlow>

<!-- 投诉问题 -->
<sequenceFlow id="complaintFlow" sourceRef="ticketTypeGateway" targetRef="complaintHandler">
    <conditionExpression>${ticketType == 'complaint'}</conditionExpression>
</sequenceFlow>

<!-- 咨询问题 -->
<sequenceFlow id="inquiryFlow" sourceRef="ticketTypeGateway" targetRef="customerService">
    <conditionExpression>${ticketType == 'inquiry'}</conditionExpression>
</sequenceFlow>

<!-- 汇聚网关 -->
<inclusiveGateway id="ticketResolvedGateway"/>
<sequenceFlow sourceRef="techSupport" targetRef="ticketResolvedGateway"/>
<sequenceFlow sourceRef="complaintHandler" targetRef="ticketResolvedGateway"/>
<sequenceFlow sourceRef="customerService" targetRef="ticketResolvedGateway"/>
```

---

## 定时任务调度：自动化业务流程

### 场景描述

每天凌晨检查即将到期的合同，提前 30 天发送续签提醒。

### 定时开始事件

```xml
<!-- 每天早上9点执行合同检查 -->
<startEvent id="timerStart">
    <timerEventDefinition>
        <timeCycle>0 0 9 * * ?</timeCycle>
    </timerEventDefinition>
</startEvent>

<!-- 服务任务：查询即将到期的合同 -->
<serviceTask id="queryExpiringContracts" 
             name="查询即将到期合同"
             flowable:class="com.example.contract.QueryExpiringDelegate"/>

<!-- 循环处理每个合同 -->
<multiInstanceLoopCharacteristics isSequential="false">
    <loopCardinality>${contractList.size()}</loopCardinality>
</multiInstanceLoopCharacteristics>

<!-- 发送提醒 -->
<serviceTask id="sendReminder" 
             name="发送续签提醒"
             flowable:class="com.example.contract.SendReminderDelegate"/>

<endEvent id="end"/>
```

### 代码实现

```java
public class QueryExpiringDelegate implements JavaDelegate {
    
    @Autowired
    private ContractService contractService;
    
    @Override
    public void execute(DelegateExecution execution) {
        // 查询30天内即将到期的合同
        List&lt;Contract&gt; expiringContracts = contractService
            .findExpiringWithinDays(30);
        
        // 存入流程变量，供后续循环使用
        execution.setVariable("contractList", expiringContracts);
        execution.setVariable("totalCount", expiringContracts.size());
    }
}
```

---

## 合同签署：与外部系统集成

### 场景描述

企业内部审批通过后，需要调用第三方电子签章平台完成合同签署。

### 调用活动（Call Activity）

```xml
<!-- 主流程：合同审批 -->
<callActivity id="callContractApproval" 
              calledElement="commonApprovalProcess">
    <inputAssociation>
        <assignment>
            <from>${contractId}</from>
            <to>${_contractId}</to>
        </assignment>
    </inputAssociation>
    <outputAssociation>
        <assignment>
            <from>${_approved}</from>
            <to>${contractApproved}</to>
        </assignment>
    </outputAssociation>
</callActivity>

<!-- 调用第三方签章 -->
<serviceTask id="callSignPlatform" name="调用签章平台">
    <extensionElements>
        <flowable:class>com.example.contract.CallSignPlatformDelegate</flowable:class>
    </extensionElements>
</serviceTask>
```

```java
public class CallSignPlatformDelegate implements JavaDelegate {
    
    @Autowired
    private SignPlatformClient signPlatformClient;
    
    @Override
    public void execute(DelegateExecution execution) {
        String contractId = (String) execution.getVariable("contractId");
        
        // 调用第三方签章平台
        SignResult result = signPlatformClient.createSignTask(
            contractId,
            execution.getVariable("signers") //签署人列表
        );
        
        // 存储签署任务ID，供后续查询签署状态
        execution.setVariable("signTaskId", result.getTaskId());
        execution.setVariable("signStatus", result.getStatus());
    }
}
```

---

## 总结：工作流的应用价值

| 场景 | 核心价值 | 关键技术 |
|---|---|---|
| 审批流 | 规范流程、明确责任、便于追溯 | 排他网关、会签 |
| 订单处理 | 状态清晰、可扩展、多系统协同 | 并行网关、信号事件 |
| 采购审批 | 分级授权、灵活配置 | 多实例会签、包容网关 |
| 客服工单 | 自动分流、加快处理速度 | 包容网关、服务任务 |
| 定时任务 | 自动化执行、减少人工 | 定时开始事件 |
| 外部集成 | 解耦业务流程与外部服务 | 调用活动 |

---

## 留给你的问题

想象一个合同签署场景：

1. 员工发起合同签署申请
2. 主管审批
3. 审批通过后，调用第三方签章平台
4. 对方签署完成后，系统自动归档

现在有一个问题：第三方签章平台可能需要几天甚至几周才能完成签署。在这个等待期间，流程实例一直「挂起」吗？如果系统重启，流程实例的状态会不会丢失？

这个问题涉及到工作流的**持久化**与**异步处理**机制——是生产级工作流系统必须考虑的问题。
