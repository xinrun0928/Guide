# Flowable 架构：六个核心引擎

Flowable 的野心，从它的名字就能看出来——它不只是一个流程引擎，而是一个**完整的数字化转型平台**。

如果你仔细看 Flowable 的依赖包，会发现它包含了 6 个独立的引擎：
- Process Engine（流程引擎）
- CMMN Engine（案例管理引擎）
- DMN Engine（决策引擎）
- Form Engine（表单引擎）
- Content Engine（内容引擎）
- App Engine（应用引擎）

这篇文章带你彻底理解 Flowable 的架构设计。

---

## 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                      Flowable Platform                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    App Engine                             │   │
│  │              (Flowable App 应用)                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│  ┌──────────┬──────────┬─────┴─────┬──────────┬──────────┐   │
│  │          │          │           │          │          │   │
│  ▼          ▼          ▼           ▼          ▼          ▼   │
│┌────┐   ┌────┐   ┌────┐      ┌────┐   ┌────┐      ┌────┐   │
││Process│ │CMMN│   │DMN │      │Form│   │Content│   │ IDM │   │
││Engine │ │Engine│  │Engine│    │Engine│ │Engine│   │Engine│   │
│└────┘   └────┘   └────┘      └────┘   └────┘      └────┘   │
│    │        │        │            │        │            │     │
│    └────────┴────────┴────────────┴────────┴────────────┘     │
│                              │                                  │
│                    ┌─────────┴─────────┐                       │
│                    │   Shared Services   │                       │
│                    │  (通用服务层)        │                       │
│                    └─────────┬─────────┘                       │
│                              │                                  │
│                    ┌─────────┴─────────┐                       │
│                    │  Database Layer    │                       │
│                    │   (数据库持久层)    │                       │
│                    └───────────────────┘                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Process Engine（流程引擎）

**核心职责**：执行 BPMN 2.0 流程

这是 Flowable 最核心的引擎，负责：
- 解析和执行 BPMN 流程定义
- 管理流程实例的生命周期
- 创建和管理用户任务
- 维护流程变量
- 处理网关、分支、合并

```java
// 获取流程引擎
ProcessEngine processEngine = ProcessEngines.getDefaultProcessEngine();

// 核心服务
RuntimeService runtimeService = processEngine.getRuntimeService();
TaskService taskService = processEngine.getTaskService();
RepositoryService repositoryService = processEngine.getRepositoryService();
HistoryService historyService = processEngine.getHistoryService();
```

### 流程引擎核心服务

| 服务 | 职责 |
|---|---|
| RepositoryService | 管理流程定义（部署、查询） |
| RuntimeService | 管理流程实例（启动、执行） |
| TaskService | 管理用户任务（查询、完成） |
| HistoryService | 查询历史数据 |
| ManagementService | 管理作业（Job）和异步执行 |
| IdentityService | 管理用户和组 |
| DynamicBpmnService | 动态修改流程定义 |

---

## CMMN Engine（案例管理引擎）

**核心职责**：执行 CMMN 案例

CMMN（Case Management Model and Notation）是专门为**案例型业务**设计的规范。与 BPMN 的流程化不同，CMMN 更灵活，适合：
- 案件调查
- 客户服务
- 故障处理
- 自由形式的业务流程

```xml
<!-- CMMN 案例定义 -->
<case id="customerServiceCase" name="客服案例">
    <casePlanModel id="casePlanModel" name="案例计划">
        
        <!-- 人工任务 -->
        <humanTask id="task1" name="收集信息"/>
        
        <!-- 里程碑 -->
        <milestone id="milestone1" name="完成调查"/>
        
        <!-- 自由任务（没有预定义顺序） -->
        <task id="task2" name="分析原因"/>
        <task id="task3" name="制定方案"/>
        
        <!-- 触发器 -->
        <planItemOnPart id="trigger1" sourceRef="task1">
            <standardEvent>complete</standardEvent>
        </planItemOnPart>
        
    </casePlanModel>
</case>
```

### BPMN vs CMMN 的区别

| 维度 | BPMN | CMMN |
|---|---|---|
| 流程确定性 | 高（步骤顺序明确） | 低（步骤可能变化） |
| 适用场景 | 审批流、订单处理 | 案件调查、客服处理 |
| 执行模式 | 按定义顺序执行 | 事件驱动、自由顺序 |
| 任务依赖 | 显式定义 | 通过 entry/exit 条件触发 |

---

## DMN Engine（决策引擎）

**核心职责**：执行业务决策规则

DMN（Decision Model and Notation）让业务人员可以直接定义决策规则，而不需要写代码。

```xml
<!-- DMN 决策表 -->
<decision id="approvalDecision" name="审批决策">
    <decisionTable id="decisionTable">
        <inputExpression typeRef="string">
            <text>amount</text>
        </inputExpression>
        <inputExpression typeRef="string">
            <text>department</text>
        </inputExpression>
        
        <outputEntry name="requiredApprover">
            <text>"manager"</text>
        </outputEntry>
        <outputEntry name="requireFinanceReview">
            <text>true</text>
        </outputEntry>
        
        <!-- 规则 -->
        <rule>
            <inputEntry><text>&gt;=10000</text></inputEntry>
            <inputEntry><text>"sales"</text></inputEntry>
            <outputEntry><text>"director"</text></outputEntry>
            <outputEntry><text>true</text></outputEntry>
        </rule>
        <rule>
            <inputEntry><text>&lt;10000</text></inputEntry>
            <inputEntry><text>*</text></inputEntry>
            <outputEntry><text>"manager"</text></outputEntry>
            <outputEntry><text>false</text></outputEntry>
        </rule>
    </decisionTable>
</decision>
```

### DMN 在流程中的应用

```java
// 在流程中调用 DMN 决策
DmnEngine dmnEngine = DmnEngineConfiguration
    .createStandaloneInMemDmnEngineConfiguration()
    .buildDmnEngine();

DmnRuleService dmnRuleService = dmnEngine.getDmnRuleService();

// 执行决策
DmnDecisionResult result = dmnRuleService.executeDecision(
    "approvalDecision", // 决策定义Key
    Variables.createVariables()
        .putValue("amount", 15000)
        .putValue("department", "sales")
);

String requiredApprover = result.getResultList().get(0).get("requiredApprover");
```

---

## Form Engine（表单引擎）

**核心职责**：管理动态表单

Flowable 的表单引擎可以动态渲染表单，而不需要硬编码 HTML。

```java
// 表单定义
FormService formService = processEngine.getFormService();

// 渲染启动表单
Object startFormData = formService.getRenderedStartForm(
    "expenseApproval", // 流程定义Key
    "forms-angular"    // 表单类型（angular、freemarker等）
);

// 渲染任务表单
Object taskFormData = formService.getRenderedTaskForm(
    taskId,
    "forms-angular"
);
```

### 表单字段类型

| 类型 | 说明 | 示例 |
|---|---|---|
| text | 单行文本 | 申请人姓名 |
| number | 数字 | 报销金额 |
| date | 日期 | 报销日期 |
| dropdown | 下拉选择 | 报销类型 |
| radio | 单选按钮 | 是否紧急 |
| checkbox | 多选框 | 附件选项 |
| user | 用户选择 | 审批人 |

---

## Content Engine（内容引擎）

**核心职责**：管理文件和附件

Content Engine 提供：
- 文件上传和下载
- 文件元数据管理
- 附件与流程/任务的关联
- 文件访问控制

```java
ContentEngine contentEngine = processEngine.getContentEngine();
ContentService contentService = contentEngine.getContentService();

// 上传文件
ContentItem contentItem = contentService.createContentBuilder()
    .name("receipt.pdf")
    .content(bytes)
    .mimeType("application/pdf")
    .create();

// 关联到任务
taskService.addAttachment(
    taskId,
    "receipt",      // 附件类型
    "报销发票",      // 附件名称
    "https://...",  // 外部URL或ContentItem ID
    "application/pdf",
    contentItem.getId()
);
```

---

## IDM Engine（身份管理引擎）

**核心职责**：管理用户、组和权限

IDM（Identity Management）引擎提供：
- 用户 CRUD
- 组管理
- 权限控制
- 令牌管理（OAuth2）
- LDAP/SSO 集成

```java
IDMEngine idmEngine = processEngine.getIdmEngine();
IDMIdentityService identityService = idmEngine.getIdentityService();

// 创建用户
User user = identityService.newUser("zhangsan");
user.setFirstName("张");
user.setLastName("三");
user.setEmail("zhangsan@company.com");
user.setPassword("encryptedPassword");
identityService.saveUser(user);

// 创建组
Group group = identityService.newGroup("manager");
group.setName("主管组");
group.setType("assignment");
identityService.saveGroup(group);

// 用户加入组
identityService.createMembership("zhangsan", "manager");
```

---

## 引擎间的协作

### 场景：报销审批流程

```
1. 用户通过 Form Engine 填写报销表单
2. Form Engine 提交后，Process Engine 启动审批流程
3. 审批过程中，可能调用 DMN Engine 决定审批路径
4. 审批结果可能触发 CMMN Engine 处理后续跟进
5. 相关文件通过 Content Engine 存储
6. 权限控制通过 IDM Engine 验证
```

```java
public class ExpenseWorkflowService {
    
    @Autowired
    private FormService formService;
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private DmnRuleService dmnRuleService;
    
    /**
     * 提交报销申请
     */
    public ProcessInstance submitExpense(ExpenseRequest request) {
        // 1. 验证用户权限（IDM Engine）
        // 2. 通过 DMN 决策判断审批路径
        DmnDecisionResult dmnResult = dmnRuleService.executeDecision(
            "expenseApprovalRule",
            Variables.createVariables()
                .putValue("amount", request.getAmount())
                .putValue("department", request.getDepartment())
        );
        
        // 3. 启动流程
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("amount", request.getAmount());
        variables.put("approvalLevel", dmnResult.getResultList().get(0).get("approvalLevel"));
        
        return runtimeService.startProcessInstanceByKey(
            "expenseApproval",
            request.getBusinessKey(),
            variables
        );
    }
}
```

---

## 总结：Flowable 的设计哲学

| 引擎 | 职责 | 解决的问题 |
|---|---|---|
| Process Engine | BPMN 执行 | 结构化业务流程 |
| CMMN Engine | 案例管理 | 灵活多变的业务场景 |
| DMN Engine | 决策规则 | 业务规则与代码分离 |
| Form Engine | 动态表单 | 表单与流程解耦 |
| Content Engine | 文件管理 | 文档存储与关联 |
| IDM Engine | 身份管理 | 用户权限控制 |

**核心思想**：每个引擎专注自己的领域，通过统一的服务接口和事件机制协同工作。

---

## 留给你的问题

Flowable 的 6 个引擎听起来很美好，但现实是：**很多团队只用了 Process Engine，其他引擎都被束之高阁。**

为什么？

是因为其他引擎功能不够强大，还是因为业务场景不需要？或者说，这些引擎之间的集成真的有那么丝滑吗？

如果你正在考虑引入 Flowable，你需要问问自己：你真的需要这 6 个引擎吗？还是说你只需要一个 Process Engine就够了？
