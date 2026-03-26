# Camunda：企业级工作流平台

你有没有想过一个问题：一个工作流引擎，除了核心执行能力，还需要什么？

答案是：**配套的工具链**。

没有流程设计器，你只能用 XML 写流程；没有监控界面，你只能用数据库查状态；没有 REST API，你的系统就和其他模块隔离了。

Camunda 在这方面做得相当完善——它提供了完整的生态：从设计、部署、执行到监控，一站式搞定。

---

## Camunda 的三大支柱

```
┌─────────────────────────────────────────────────────────────────┐
│                     Camunda Platform                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                     Web 应用层                           │   │
│   │   Cockpit（监控中心）│ Tasklist（任务列表）│ Admin（管理）│   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    REST API 层                           │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Engine Core                            │   │
│   │   Process Engine  │  CMMN  │  DMN  │  Form Engine      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| 组件 | 特点 | 适用场景 |
|---|---|---|
| **Cockpit** | 功能强大的监控面板 | 生产监控、问题排查 |
| **Tasklist** | 开箱即用的任务办理界面 | 快速原型、内部系统 |
| **REST API** | 完整、标准化 | 微服务架构、跨语言集成 |

---

## 快速入门

### Spring Boot 集成

```yaml
# pom.xml
<dependency>
    <groupId>org.camunda.bpm</groupId>
    <artifactId>camunda-bpm-spring-boot-starter-rest</artifactId>
    <version>7.20.0</version>
</dependency>
<dependency>
    <groupId>org.camunda.bpm</groupId>
    <artifactId>camunda-bpm-spring-boot-starter-webapp</artifactId>
    <version>7.20.0</version>
</dependency>
```

### 部署流程

```java
@Deployment(resources = {"processes/expense-approval.bpmn"})
public class ExpenseWorkflowConfig {
    // 流程定义会自动部署
}
```

### 启动流程

```java
@Inject
private RuntimeService runtimeService;

public ProcessInstance startExpenseWorkflow(String businessKey, Map<String, Object> variables) {
    return runtimeService.startProcessInstanceByKey(
        "expenseApproval",    // 流程定义 key
        businessKey,          // 业务键
        variables             // 流程变量
    );
}
```

### 外部任务模式

Camunda 的外部任务机制允许**外部系统主动拉取任务**，而不是被动等待引擎推送：

```java
// BPMN 配置
<serviceTask id="checkInventory">
    <extensionElements>
        <camunda:external>
            <camunda:topic name="inventory-check"/>
        </camunda:external>
    </extensionElements>
</serviceTask>

// Java 客户端
ExternalTaskService externalTaskService = processEngine.getExternalTaskService();

List<LockedExternalTask> tasks = externalTaskService
    .fetchAndLock(5, workerId)
    .topic("inventory-check", Duration.ofMinutes(5))
    .execute();

// 处理完成后
externalTaskService.complete(task.getId(), workerId);
```

---

## 文档导航

### 架构与部署

- [Camunda 架构](/middleware/workflow/camunda-architecture) — 引擎、REST API、Web 应用完整解析
- [Camunda Spring Boot 集成](/middleware/workflow/camunda-springboot) — 快速集成方案

### 核心功能

- [BPMN + DMN](/middleware/workflow/camunda-dmn) — 流程设计与决策表完整指南
- [Camunda 任务管理](/middleware/workflow/camunda-task) — 任务办理、委托、转让
- [Camunda 与 Flowable 对比](/middleware/workflow/camunda-compare) — 选型参考

### 运维相关

- [Camunda 运维指南](/middleware/workflow/camunda-operation) — 生产环境部署与维护

---

## BPMN + DMN：让业务人员也能维护规则

Camunda 的一大亮点是对 **DMN（决策模型与标注）** 的原生支持。

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   DMN 决策表示例：报销审批规则                                    │
│                                                                 │
│   ════════════════════════════════════════════════════════════  │
│   金额范围        │ 部门      │ 审批人    │ 备注                 │
│   ────────────────┼───────────┼───────────┼───────────────────  │
│   < 5000         │ *         │ 主管      │ 普通审批             │
│   5000 - 20000    │ *         │ 财务      │ 需复核               │
│   > 20000         │ *         │ 高管      │ 需会签               │
│   *               │ 销售      │ 总监      │ 销售特殊             │
│   ════════════════════════════════════════════════════════════  │
│                                                                 │
│   规则匹配：从上到下，匹配第一个满足条件的行                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

业务人员可以直接编辑决策表，而不需要改代码。

---

## Camunda vs Flowable

| 维度 | Camunda | Flowable |
|---|---|---|
| **起源** | Activiti fork (2013) | Activiti fork (2016) |
| **Cockpit** | ⭐⭐⭐⭐⭐ 功能强大 | 多个独立应用 |
| **外部任务** | 原生支持，更完善 | 需自行实现 |
| **CMMN** | 企业版 | 开源支持 |
| **社区活跃度** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| **学习曲线** | 中等 | 陡峭 |

**选择 Camunda 的理由：**
- 企业级应用，需要强大的监控能力
- 需要与外部系统集成（外部任务模式）
- 重视社区活跃度和文档质量
- 愿意投入时间配置和优化

---

## 适用场景

| 场景 | 为什么选 Camunda |
|---|---|
| 大型企业 OA | Cockpit 监控强大，适合多部门协作 |
| 订单处理系统 | 外部任务模式方便对接 ERP、WMS |
| 微服务架构 | REST API 完整，支持跨语言调用 |
| 审计合规场景 | 历史数据完整，支持流程回溯 |

---

## 留给你的问题

假设你要把 Camunda 部署到生产环境，需要支持以下需求：

1. 每天处理 10 万+ 流程实例
2. 需要 99.9% 的可用性
3. 多个业务系统需要调用工作流 API

**问题来了：**

1. Web 应用（Cockpit/Tasklist）应该和引擎分开部署还是放在一起？分开部署有什么好处？

2. 集群环境下，如果两个节点同时查询到一个待执行的作业，会发生什么？Camunda 是怎么避免重复执行的？

3. REST API 暴露给多个业务系统调用，如何做权限控制和流量限制？

这三个问题涉及到**架构设计**、**分布式一致性**和**API 安全**，是生产环境部署的核心考量。
