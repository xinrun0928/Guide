# Flowable Form 表单引擎：动态表单与流程解耦

表单是工作流中不可或缺的一部分。

员工填写报销申请需要表单，主管审批需要表单，财务复核还是需要表单。

如果表单和流程耦合在一起，每次改表单都要改代码、重新部署。

**Flowable 的表单引擎就是为了解决这个问题——让表单独立于流程，可以动态配置和渲染。**

这篇文章带你了解 Flowable 的表单引擎。

---

## 表单引擎概述

### 为什么需要表单引擎？

```
传统方式：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  流程定义（BPMN）←──紧耦合──→ 表单（JSP/HTML）            │
│                                                             │
│  问题：                                                     │
│  - 表单和流程绑定，改表单要改流程定义                       │
│  - 难以动态渲染                                             │
│  - 表单字段和流程变量映射复杂                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘

表单引擎方式：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  流程定义（BPMN） ←─── 关联 ──── 表单定义（Form）        │
│                                                             │
│  流程变量 ←──────── 映射 ──────→ 表单字段                │
│                                                             │
│  优点：                                                     │
│  - 表单独立，可以单独修改                                   │
│  - 支持动态渲染                                             │
│  - 字段自动映射到流程变量                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 表单类型

| 类型 | 说明 | 使用场景 |
|---|---|---|
| 外部表单 | 独立的 HTML/React 表单 | 复杂表单、与前端框架集成 |
| 内嵌表单 | BPMN 中内嵌 JSON 定义 | 简单表单、快速开发 |
| Camunda Forms | Flowable 的表单解决方案 | 中等复杂度表单 |

---

## 内嵌表单

### 表单定义（JSON）

```json
{
  "key": "expenseForm",
  "name": "报销申请表单",
  "fields": [
    {
      "id": "amount",
      "label": "报销金额",
      "type": "number",
      "required": true,
      "placeholder": "请输入报销金额"
    },
    {
      "id": "reason",
      "label": "报销原因",
      "type": "text",
      "required": true
    },
    {
      "id": "category",
      "label": "报销类别",
      "type": "dropdown",
      "options": [
        { "id": "travel", "name": "差旅费" },
        { "id": "office", "name": "办公用品" },
        { "id": "other", "name": "其他" }
      ]
    },
    {
      "id": "receipts",
      "label": "发票附件",
      "type": "upload"
    }
  ]
}
```

### BPMN 配置

```xml
<userTask id="submitExpense" name="提交报销">
    
    <extensionElements>
        <!-- 表单 key -->
        <flowable:formKey>expenseForm</flowable:formKey>
        
        <!-- 表单字段映射（可选）-->
        <flowable:formProperty id="amount" name="报销金额"
                               type="number"
                               required="true"/>
        <flowable:formProperty id="reason" name="报销原因"
                               type="string"
                               required="true"/>
        <flowable:formProperty id="category" name="报销类别"
                               type="string"/>
    </extensionElements>
</userTask>
```

---

## 表单渲染

### Java API 渲染

```java
@Autowired
private FormService formService;

/**
 * 渲染表单
 */
@Test
public void renderForm() {
    // 渲染启动表单
    Object startFormData = formService.getRenderedStartForm(
        "expenseApproval",  // 流程定义 Key
        "forms-angular"    // 渲染器类型
    );
    
    // 渲染任务表单
    Object taskFormData = formService.getRenderedTaskForm(
        "taskId123",
        "forms-angular"
    );
}
```

### 获取表单定义

```java
/**
 * 获取表单定义
 */
@Test
public void getFormDefinition() {
    // 获取启动表单定义
    StartFormData startFormData = formService.getStartFormData(
        "expenseApproval"
    );
    
    List&lt;FormProperty&gt; properties = startFormData.getFormProperties();
    
    for (FormProperty property : properties) {
        System.out.println("ID: " + property.getId());
        System.out.println("Name: " + property.getName());
        System.out.println("Type: " + property.getType());
        System.out.println("Required: " + property.isRequired());
    }
}
```

---

## 表单数据提交

### 提交启动表单

```java
/**
 * 提交启动表单
 */
@Test
public void submitStartForm() {
    Map&lt;String, String&gt; formValues = new HashMap&lt;&gt;();
    formValues.put("amount", "15000");
    formValues.put("reason", "客户拜访差旅费");
    formValues.put("category", "travel");
    
    // 提交表单并启动流程
    ProcessInstance instance = formService.submitStartFormData(
        "expenseApproval",  // 流程定义 Key
        formValues           // 表单数据（自动映射到流程变量）
    );
    
    System.out.println("流程实例ID: " + instance.getId());
}
```

### 提交任务表单

```java
/**
 * 提交任务表单
 */
@Test
public void submitTaskForm() {
    String taskId = "taskId123";
    
    Map&lt;String, String&gt; formValues = new HashMap&lt;&gt;();
    formValues.put("approved", "true");
    formValues.put("comment", "同意报销");
    
    // 提交表单并完成任务
    formService.submitTaskFormData(taskId, formValues);
}
```

---

## 完整示例：报销审批流程

### 1. 创建表单定义

```json
{
  "key": "expenseRequestForm",
  "fields": [
    {
      "id": "amount",
      "label": "报销金额",
      "type": "number",
      "required": true
    },
    {
      "id": "reason",
      "label": "报销原因",
      "type": "textarea",
      "required": true
    },
    {
      "id": "hasReceipts",
      "label": "是否有发票",
      "type": "boolean"
    }
  ]
}
```

```json
{
  "key": "expenseApprovalForm",
  "fields": [
    {
      "id": "approved",
      "label": "是否同意",
      "type": "boolean",
      "required": true
    },
    {
      "id": "comment",
      "label": "审批意见",
      "type": "textarea"
    },
    {
      "id": "amountLimit",
      "label": "批准金额上限",
      "type": "number"
    }
  ]
}
```

### 2. 创建 BPMN 流程

```xml
<process id="expenseApproval" name="报销审批流程">
    
    <startEvent id="start"/>
    
    <!-- 提交申请（使用表单）-->
    <userTask id="submitTask" name="提交报销申请">
        <extensionElements>
            <flowable:formKey>expenseRequestForm</flowable:formKey>
        </extensionElements>
    </userTask>
    
    <!-- 主管审批（使用表单）-->
    <userTask id="approvalTask" name="主管审批">
        <extensionElements>
            <flowable:formKey>expenseApprovalForm</flowable:formKey>
        </extensionElements>
    </userTask>
    
    <!-- 金额判断 -->
    <exclusiveGateway id="amountCheck"/>
    
    <userTask id="directorApproval" name="总监审批"/>
    
    <endEvent id="end"/>
    
    <sequenceFlow sourceRef="start" targetRef="submitTask"/>
    <sequenceFlow sourceRef="submitTask" targetRef="approvalTask"/>
    <sequenceFlow sourceRef="approvalTask" targetRef="amountCheck"/>
    
    <sequenceFlow sourceRef="amountCheck" targetRef="directorApproval">
        <conditionExpression>${amount > 10000}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow sourceRef="amountCheck" targetRef="end">
        <conditionExpression>${amount &lt;= 10000}</conditionExpression>
    </sequenceFlow>
    
    <sequenceFlow sourceRef="directorApproval" targetRef="end"/>
</process>
```

### 3. 前端集成

```javascript
// React 表单组件
class ExpenseForm extends React.Component {
    render() {
        return (
            <Form onSubmit={this.handleSubmit}>
                <Form.Group>
                    <label>报销金额</label>
                    <input type="number" name="amount" required />
                </Form.Group>
                <Form.Group>
                    <label>报销原因</label>
                    <textarea name="reason" required />
                </Form.Group>
                <Form.Group>
                    <label>是否有发票</label>
                    <input type="checkbox" name="hasReceipts" />
                </Form.Group>
                <Button type="submit">提交</Button>
            </Form>
        );
    }
    
    handleSubmit = (event) => {
        event.preventDefault();
        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData);
        
        // 调用后端 API 提交表单
        fetch('/api/workflow/submit-start-form', {
            method: 'POST',
            body: JSON.stringify({
                processDefinitionKey: 'expenseApproval',
                formData: data
            })
        });
    };
}
```

---

## 表单与服务编排

### 表单与服务结合

```java
/**
 * 表单提交服务
 */
@Service
public class FormSubmissionService {
    
    @Autowired
    private FormService formService;
    
    @Autowired
    private NotificationService notificationService;
    
    @Autowired
    private AuditService auditService;
    
    /**
     * 提交表单（带业务逻辑）
     */
    public ProcessInstance submitWithBusinessLogic(
            String processDefinitionKey,
            Map&lt;String, String&gt; formData) {
        
        // 1. 表单验证
        validateFormData(formData);
        
        // 2. 提交表单并启动流程
        ProcessInstance instance = formService.submitStartFormData(
            processDefinitionKey,
            formData
        );
        
        // 3. 发送通知
        String assignee = getNextAssignee(formData);
        notificationService.notify(assignee, "有新审批任务");
        
        // 4. 记录审计日志
        auditService.log("FORM_SUBMITTED", 
            instance.getId(), 
            formData);
        
        return instance;
    }
    
    /**
     * 任务表单提交（带业务逻辑）
     */
    public void submitTaskWithBusinessLogic(
            String taskId,
            Map&lt;String, String&gt; formData) {
        
        // 1. 验证审批意见
        validateApprovalForm(formData);
        
        // 2. 提交表单并完成任务
        formService.submitTaskFormData(taskId, formData);
        
        // 3. 发送通知给申请人
        String applicant = getApplicantByTaskId(taskId);
        notificationService.notify(applicant, "您的报销申请已审批");
        
        // 4. 更新业务状态
        updateBusinessStatus(taskId, formData);
        
        // 5. 记录审计日志
        auditService.log("TASK_COMPLETED", taskId, formData);
    }
}
```

---

## 总结

| 功能 | 说明 |
|---|---|
| 表单定义 | JSON 格式，定义字段和属性 |
| 表单渲染 | API 返回表单结构，前端渲染 |
| 数据映射 | 表单字段自动映射到流程变量 |
| 启动表单 | 流程启动时的表单 |
| 任务表单 | 任务办理时的表单 |

---

## 留给你的问题

假设你在实现一个复杂的审批表单：

1. 表单有 20+ 个字段
2. 某些字段根据其他字段的值动态显示/隐藏
3. 需要实时验证字段（如金额不能超过预算）
4. 附件上传需要支持大文件

**问题：**
1. 表单引擎如何支持动态字段？
2. 复杂验证逻辑应该放在前端还是后端？
3. 大文件上传如何与流程实例关联？

这是一个典型的**表单与流程深度集成**问题，需要仔细设计表单引擎与前端框架的交互。
