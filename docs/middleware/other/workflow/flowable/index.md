# Flowable：功能最全面的开源工作流引擎

Flowable 的野心，从它的名字就能看出来——它不只是一个流程引擎，而是一个**完整的数字化转型平台**。

2016 年，原 Activiti 团队的部分核心成员 fork 了 Activiti，创建了 Flowable。此后的每一年，Flowable 都在不断扩展自己的边界：从最初的 BPMN 引擎，到现在的 6 大引擎。

问题是：**你真的需要这 6 个引擎吗？**

---

## Flowable 的六大引擎

```
┌─────────────────────────────────────────────────────────────────┐
│                      Flowable Platform                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┬──────────┬─────┬──────────┬──────────┬──────────┐ │
│  │ Process  │   CMMN   │ DMN │   Form   │ Content  │   IDM    │ │
│  │  Engine  │  Engine  │Engine│  Engine  │  Engine  │  Engine  │ │
│  └──────────┴──────────┴─────┴──────────┴──────────┴──────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

| 引擎 | 职责 | 解决的问题 |
|---|---|---|
| **Process Engine** | BPMN 执行 | 结构化业务流程 |
| **CMMN Engine** | 案例管理 | 灵活多变的业务场景 |
| **DMN Engine** | 决策规则 | 业务规则与代码分离 |
| **Form Engine** | 动态表单 | 表单与流程解耦 |
| **Content Engine** | 文件管理 | 文档存储与关联 |
| **IDM Engine** | 身份管理 | 用户权限控制 |

大多数团队只用 Process Engine——但了解其他引擎，能帮你设计出更优雅的解决方案。

---

## 快速入门

### Spring Boot 集成

```yaml
# pom.xml
<dependency>
    <groupId>org.flowable</groupId>
    <artifactId>flowable-spring-boot-starter</artifactId>
    <version>6.8.0</version>
</dependency>

# application.yml
flowable:
  async-executor-enabled: true
  database-schema-update: true
```

### 部署流程

```java
@Autowired
private RepositoryService repositoryService;

@Test
public void deployProcess() {
    Deployment deployment = repositoryService.createDeployment()
        .addClasspathResource("processes/expense-approval.bpmn20.xml")
        .name("报销审批流程")
        .deploy();
    
    System.out.println("部署ID: " + deployment.getId());
}
```

### 启动流程实例

```java
@Autowired
private RuntimeService runtimeService;

@Test
public void startProcess() {
    Map<String, Object> variables = new HashMap<>();
    variables.put("amount", 15000);
    variables.put("applicant", "zhangsan");
    
    ProcessInstance instance = runtimeService
        .startProcessInstanceByKey("expenseApproval", variables);
    
    System.out.println("实例ID: " + instance.getId());
}
```

### 完成任务

```java
@Autowired
private TaskService taskService;

@Test
public void completeTask() {
    Task task = taskService.createTaskQuery()
        .taskCandidateUser("manager")
        .singleResult();
    
    Map<String, Object> variables = new HashMap<>();
    variables.put("approved", true);
    
    taskService.complete(task.getId(), variables);
}
```

---

## 文档导航

### 架构与选型

- [Flowable 架构](/middleware/workflow/flowable-architecture) — 六大核心引擎详解
- [Flowable vs Activiti](/middleware/workflow/flowable-vs-activiti) — 为什么要从 Activiti 迁移？

### 核心功能

- [流程定义与部署](/middleware/workflow/flowable-deployment) — BPMN 文件部署、版本管理
- [用户任务](/middleware/workflow/flowable-task) — 签收、办理、委托、转让
- [网关](/middleware/workflow/flowable-gateway) — 排他、并行、包容、事件
- [流程变量](/middleware/workflow/flowable-variable) — 全局、本地、任务变量作用域
- [会签（多实例）](/middleware/workflow/flowable-multi-instance) — 串行/并行会签实现
- [子流程](/middleware/workflow/flowable-subprocess) — 嵌入式 vs 调用活动
- [监听器](/middleware/workflow/flowable-listener) — 执行监听器、任务监听器
- [异步执行](/middleware/workflow/flowable-async) — Job、异步执行器

### 进阶功能

- [表单引擎](/middleware/workflow/flowable-form) — 动态表单与流程的结合
- [DMN 决策引擎](/middleware/workflow/flowable-dmn) — 业务规则与代码分离
- [CMMN 案例管理](/middleware/workflow/flowable-cmmn) — 灵活多变的业务场景
- [历史记录](/middleware/workflow/flowable-history) — 审计追踪、流程回溯
- [身份管理](/middleware/workflow/flowable-identity) — 用户、组、权限
- [调试与排错](/middleware/workflow/flowable-debug) — 常见问题排查
- [集成方案](/middleware/workflow/flowable-integration) — 与业务系统深度集成

### 运维相关

- [Spring Boot 集成](/middleware/workflow/flowable-springboot) — 完整集成方案
- [表结构解析](/middleware/workflow/flowable-table) — 核心表及用途

---

## Flowable vs Camunda

| 维度 | Flowable | Camunda |
|---|---|---|
| **引擎数量** | 6 个 | 4 个 |
| **CMMN** | 开源支持 | 企业版 |
| **外部任务** | 需自行实现 | 原生支持 |
| **Web 管理** | 多个应用 | Cockpit 更强大 |
| **学习曲线** | 陡峭 | 中等 |

**选择 Flowable 的理由：**
- 需要 CMMN（案例管理）
- 预算有限，不需要企业版
- 需要完整的表单引擎
- 使用 Spring Boot，追求开箱即用

---

## 常见应用场景

| 场景 | 推荐方案 |
|---|---|
| OA 审批流 | Process Engine + Form Engine |
| 规则驱动决策 | Process Engine + DMN Engine |
| 案件调查 | CMMN Engine |
| 订单处理 | Process Engine + Content Engine |

---

## 留给你的问题

Flowable 的 6 个引擎听起来很美好，但现实是：**很多团队只用了 Process Engine，其他引擎都被束之高阁。**

为什么？

是因为其他引擎功能不够强大，还是因为业务场景不需要？或者说，这些引擎之间的集成真的有那么丝滑吗？

**如果你正在考虑引入 Flowable，你需要问问自己：你真的需要这 6 个引擎吗？还是说你只需要一个 Process Engine 就够了？**
