# 工作流引擎：从原理到实战

你有没有遇到过这种场景？

一个简单的请假申请，背后可能有：直属主管审批 → 部门经理复核 → HR 备案 → 通知申请人。

如果用 if-else 实现，代码会变成一团乱麻；每加一个审批节点，就要改一次代码；审批规则一变，整个系统都得重新测试。

**工作流引擎**就是来解决这个问题的——它让你把业务流程「画」出来，而不是「写」出来。

---

## 什么是工作流引擎？

工作流引擎是**执行业务流程的运行时引擎**。你用 BPMN（业务流程建模标注）画出流程图，它就能帮你执行：

- 控制流程的执行顺序
- 管理流程实例的生命周期
- 分派任务给指定的人
- 维护流程中流转的数据

简单说：**你定义「要做什么」，引擎帮你「做到」。**

---

## 核心概念

在深入之前，先理解四个核心概念：

| 概念 | 说明 | 类比 |
|---|---|---|
| **流程定义** | 业务流程的静态描述（模板） | 报销单模板 |
| **流程实例** | 流程定义的一次执行（填好的表） | 张三的报销申请 |
| **任务** | 需要人工处理的步骤 | 待审批的节点 |
| **流程变量** | 流转中的数据 | 表单填的内容 |

---

## 选型：三大主流引擎对比

| 特性 | Flowable | Camunda | Activiti |
|---|---|---|---|
| **起源** | Activiti fork (2016) | Activiti fork (2013) | jBPM |
| **功能完整性** | 6 大引擎 | 4 大引擎 | 基础 BPMN |
| **Spring Boot** | 原生支持 | 原生支持 | 需配置 |
| **社区活跃度** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐ |
| **推荐场景** | 全功能需求 | 企业级监控 | 简单场景 |

> **选型建议**：新项目推荐 Flowable 或 Camunda，功能完整、生态好；老项目有 Activiti 积累的可继续维护。

---

## 文档导航

### 基础入门

- [工作流核心概念](/middleware/workflow/concept) — 流程定义、实例、任务、变量
- [BPMN 2.0 规范](/middleware/workflow/bpmn) — 事件、任务、网关的符号与语义

### Flowable

- [Flowable 架构](/middleware/workflow/flowable-architecture) — 六大核心引擎详解
- [Flowable 与 Activiti 对比](/middleware/workflow/flowable-vs-activiti) — 选型参考
- [Flowable 流程定义与部署](/middleware/workflow/flowable-deployment)
- [Flowable 用户任务](/middleware/workflow/flowable-task) — 签收、办理、委托
- [Flowable 网关](/middleware/workflow/flowable-gateway) — 排他、并行、包容
- [Flowable 变量](/middleware/workflow/flowable-variable) — 全局、本地、任务变量
- [Flowable 会签](/middleware/workflow/flowable-multi-instance) — 串行/并行会签
- [Flowable 子流程](/middleware/workflow/flowable-subprocess)
- [Flowable 监听器](/middleware/workflow/flowable-listener)
- [Flowable 异步执行](/middleware/workflow/flowable-async)
- [Flowable Spring Boot 集成](/middleware/workflow/flowable-springboot)
- [Flowable 表结构](/middleware/workflow/flowable-table)
- [Flowable 身份权限](/middleware/workflow/flowable-identity)
- [Flowable 历史记录](/middleware/workflow/flowable-history)
- [Flowable 表单](/middleware/workflow/flowable-form)
- [Flowable 调试](/middleware/workflow/flowable-debug)
- [Flowable CMMN](/middleware/workflow/flowable-cmmn)
- [Flowable DMN](/middleware/workflow/flowable-dmn)
- [Flowable 集成](/middleware/workflow/flowable-integration)

### Camunda

- [Camunda 架构](/middleware/workflow/camunda-architecture) — 引擎、REST API、Web 应用
- [Camunda BPMN + DMN](/middleware/workflow/camunda-dmn) — 流程设计与决策表
- [Camunda Spring Boot 集成](/middleware/workflow/camunda-springboot)
- [Camunda 任务管理](/middleware/workflow/camunda-task)
- [Camunda 与 Flowable 对比](/middleware/workflow/camunda-compare)
- [Camunda 运维指南](/middleware/workflow/camunda-operation)

### 综合内容

- [工作流引擎对比](/middleware/workflow/compare) — Flowable vs Camunda vs Activiti
- [工作流使用场景](/middleware/workflow/use-case)
- [工作流面试题](/middleware/workflow/interview-summary) — 高频面试问题汇总

---

## 什么时候用工作流引擎？

**推荐使用：**
- 审批流程复杂，涉及多角色、多节点
- 流程需要可视化配置，业务人员要参与维护
- 需要流程历史追踪、审计
- 审批规则经常变化

**可能不需要：**
- 简单状态机（新建 → 处理 → 完成），直接用数据库字段
- 超高并发场景，流程引擎可能成为瓶颈
- 流程非常简单，if-else 能解决

---

## 留给你的问题

假设你要设计一个「通用审批系统」，需要支持：

- 不同的业务用不同的审批模板
- 审批节点可以动态配置（增删改）
- 支持会签（多人审批）

**你会怎么设计？**是用一个「大流程」加配置，还是用多个「小流程」组合？

这个问题涉及到**流程设计的粒度**，是一个需要仔细权衡的设计决策。
