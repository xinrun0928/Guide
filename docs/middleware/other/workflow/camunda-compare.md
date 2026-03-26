# Camunda vs Flowable 功能对比

选择工作流引擎，从来不是单纯看功能强不强的问题。

Camunda 和 Flowable 都是优秀的开源工作流引擎，它们有很多相似之处，但也各有特色。

选对了，开发的痛苦程度会降低一半；选错了，后期可能要大重构。

这篇文章帮你做出选择。

---

## 整体对比

| 维度 | Camunda | Flowable |
|---|---|---|
| 起源 | 从 Activiti  fork，2013 年独立发展 | 从 Activiti fork，2016 年独立发展 |
| 社区活跃度 | 活跃，企业支持强大 | 活跃，社区驱动 |
| 商业支持 | Camunda 公司提供企业版 | 无官方企业版 |
| 文档质量 | 非常完善 | 完善 |
| 学习曲线 | 中等 | 较陡（API 较复杂） |
| Spring Boot 支持 | 官方 starter，完善 | 官方 starter，完善 |
| Web 管理界面 | Cockpit、Tasklist、Admin | Flowable Admin、IDM |
| REST API | 完整 | 完整 |

---

## 核心功能对比

### 流程引擎

#### 相同点

```
┌─────────────────────────────────────────────────────────────────┐
│                         两者都支持                               │
├─────────────────────────────────────────────────────────────────┤
│  ✓ BPMN 2.0 完整支持                                           │
│  ✓ 流程定义、部署、启动、完成任务                               │
│  ✓ 多种网关：排他、并行、包含、事件                             │
│  ✓ 子流程：嵌入式、调用活动                                     │
│  ✓ 会签：串行、并行                                             │
│  ✓ 定时器：边界事件、开始事件                                   │
│  ✓ 异步执行：作业执行器                                         │
│  ✓ 事件监听：执行监听器、任务监听器                             │
│  ✓ 候选用户、候选组                                             │
│  ✓ 历史记录：完整历史、活动历史                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 差异点

| 功能 | Camunda | Flowable |
|---|---|---|
| **外部任务** | 原生支持 | 需要额外配置 |
| **DMN 决策表** | 原生支持 | 原生支持 |
| **CMMN 案例管理** | 企业版 | 开源支持 |
| **表单** | 支持 | 支持 |
| **多租户** | 支持 | 支持 |
| **批量操作** | API 支持 | 需要自行实现 |

### 外部任务（External Task）

**Camunda 有明显优势**

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Camunda 外部任务：                                            │
│   ┌─────────────┐                                               │
│   │   引擎      │ ←── 客户端主动拉取                            │
│   │  维护任务列表 │                                               │
│   │  锁定机制   │                                               │
│   └─────────────┘                                               │
│                                                                 │
│   优点：                                                        │
│   • 官方完整实现                                                │
│   • 支持错误处理和重试                                          │
│   • 支持心跳机制                                                │
│   • 客户端 SDK 完善                                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Flowable 需要自行实现外部任务的拉取和锁定机制：

```java
// Camunda 外部任务（简洁）
ExternalTaskService service = processEngine.getExternalTaskService();
List&lt;LockedExternalTask&gt; tasks = service
    .fetchAndLock(10, workerId)
    .topic("inventory-check", Duration.ofMinutes(5))
    .execute();

// Flowable 需要自行实现类似逻辑
// 需要考虑：任务锁定、超时、心跳、重试等
```

### 表单

| 特性 | Camunda | Flowable |
|---|---|---|
| 嵌入式表单 | 支持 | 支持 |
| 外置表单 | 支持 | 支持 |
| 表单变量 | 支持 | 支持 |
| 表单验证 | 支持 | 支持 |

Camunda 表单配置更简洁：

```java
// Camunda 表单定义
Map&lt;String, Object&gt; formFields = new HashMap&lt;&gt;();
formFields.put("approved", FormFields.formField()
    .id("approved")
    .label("是否批准")
    .type("boolean")
    .defaultValue("true")
    .required());

formService.submitStartForm(processDefinitionId, formFields);
```

### 历史记录

| 特性 | Camunda | Flowable |
|---|---|---|
| 历史级别 | none/activity/audit/full | none/activity/audit/full |
| 变量历史 | 支持 | 支持 |
| 详情历史 | 支持 | 支持 |
| 审计日志 | 支持 | 支持 |

```java
// Camunda 历史查询
List&lt;HistoricProcessInstance&gt; instances = historyService
    .createHistoricProcessInstanceQuery()
    .finished()
    .startedAfter(startDate)
    .orderByDuration().desc()
    .listPage(0, 10);

// Flowable 类似
```

---

## API 设计对比

### Camunda API

Camunda 的 API 设计更加**面向对象**，使用链式调用：

```java
// Camunda 风格
runtimeService
    .createProcessInstanceByKey("expense")
    .setVariable("amount", 15000)
    .start();

// 或者
ProcessInstance instance = runtimeService.startProcessInstanceByKey("expense");
taskService
    .createTaskQuery()
    .taskAssignee("zhangsan")
    .active()
    .list();
```

### Flowable API

Flowable 的 API 更加**函数式**，返回查询对象：

```java
// Flowable 风格
runtimeService.startProcessInstanceByKey("expense", variables);

taskService.createTaskQuery()
    .taskAssignee("zhangsan")
    .active()
    .list();
```

两者区别不大，选择取决于个人偏好。

---

## Spring Boot 集成对比

### Camunda

```xml
<dependency>
    <groupId>org.camunda.bpm.springboot</groupId>
    <artifactId>camunda-bpm-spring-boot-starter</artifactId>
    <version>7.20.0</version>
</dependency>
```

```yaml
camunda:
  auto-deployment:
    enabled: true
    resources: classpath:processes/*.bpmn
  bpm:
    history-level: full
```

### Flowable

```xml
<dependency>
    <groupId>org.flowable</groupId>
    <artifactId>flowable-spring-boot-starter</artifactId>
    <version>6.7.2</version>
</dependency>
```

```yaml
flowable:
  process:
    files-to-deploy: classpath:processes/*.bpmn
  history-level: full
```

**结论**：两者集成体验相近，Camunda 配置项稍多一些。

---

## Web 管理界面对比

### Camunda Cockpit

Camunda 的管理界面功能丰富：

- 流程实例监控
- 错误查看和重试
- 作业管理
- 变量修改
- 流程图追踪
- 批量操作

### Flowable Admin

Flowable 的界面相对简洁：

- 流程定义管理
- 流程实例管理
- 任务管理
- 用户/组管理
- 历史查看

**结论**：Camunda 的 Cockpit 功能更强大，适合生产环境监控。

---

## 性能对比

### 理论性能

| 测试场景 | Camunda | Flowable |
|---|---|---|
| 简单流程启动 | 优秀 | 优秀 |
| 并发任务处理 | 优秀 | 优秀 |
| 历史查询 | 良好 | 良好 |
| 大量变量 | 良好 | 良好 |

实际性能取决于：
- 数据库性能
- 流程复杂度
- 并发量
- 配置优化

### 内存占用

- Camunda：较轻量
- Flowable：6 个引擎组件，内存占用略高

---

## 生态系统

### Camunda

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Camunda 生态系统                                               │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│   │ 企业版      │  │  云服务     │  │  Modeler   │             │
│   │ (完整功能)  │  │ (Camunda Cloud) │ (Web 设计器) │             │
│   └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│   │ Optimize    │  │  Run       │  │  Connect   │             │
│   │ (流程分析)   │  │ (简化部署)  │  │ (连接器)    │             │
│   └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Flowable

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Flowable 生态系统                                             │
│                                                                 │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│   │ Flowable    │  │  Flowable   │  │  Flowable   │             │
│   │ Design      │  │  Engage     │  │  Insight   │             │
│   │ (设计器)     │  │ (用户界面)   │  │ (分析)      │             │
│   └─────────────┘  └─────────────┘  └─────────────┘             │
│                                                                 │
│   注：部分组件需要企业订阅                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 选择建议

### 选择 Camunda 如果：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ✓ 需要完整的外部任务支持（与外部系统集成）                     │
│   ✓ 需要强大的生产环境监控（Cockpit）                            │
│   ✓ 需要商业支持和企业级功能                                     │
│   ✓ 流程变更频繁，需要快速部署                                   │
│   ✓ 团队对 BPMN 有一定经验                                       │
│   ✓ 需要 DMN 决策表（两者都支持，但 Camunda 更成熟）              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 选择 Flowable 如果：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ✓ 需要 CMMN 案例管理（开源支持）                              │
│   ✓ 预算有限，无法购买企业版                                     │
│   ✓ 项目主要是简单审批流程                                       │
│   ✓ 需要与现有系统深度集成                                       │
│   ✓ 团队喜欢折腾（社区驱动，更灵活但需要更多配置）               │
│   ✓ 需要轻量级方案                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 都不是最优选择如果：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   • 只是需要简单的任务队列，考虑使用 RabbitMQ 或 Kafka           │
│   • 业务流程非常简单，考虑使用规则引擎 + 数据库状态机              │
│   • 需要超高性能，考虑自研状态机                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 迁移与共存

### 从 Activiti 迁移

Camunda 和 Flowable 都是从 Activiti fork 的，迁移相对简单：

1. 依赖替换
2. 包名替换（`org.activiti` → `org.camunda` 或 `org.flowable`）
3. 配置文件调整
4. API 微调

### 两者共存

理论上可以同时使用，但**不建议**：

- 数据库表会冲突
- 会增加系统复杂度
- 维护成本翻倍

---

## 总结

| 维度 | Camunda | Flowable |
|---|---|---|
| 外部任务 | ⭐⭐⭐⭐⭐ 原生支持 | ⭐⭐ 需要自行实现 |
| Web 管理 | ⭐⭐⭐⭐⭐ Cockpit 强大 | ⭐⭐⭐ 基础功能 |
| 商业支持 | ⭐⭐⭐⭐⭐ 企业版 | ⭐⭐ 开源社区 |
| 学习曲线 | ⭐⭐⭐ 中等 | ⭐⭐ 较陡 |
| CMMN 支持 | ⭐⭐ 企业版 | ⭐⭐⭐⭐ 开源支持 |
| 社区生态 | ⭐⭐⭐⭐ 活跃 | ⭐⭐⭐⭐ 活跃 |
| 文档质量 | ⭐⭐⭐⭐⭐ 完善 | ⭐⭐⭐⭐ 完善 |

**最终建议**：

- 如果你有钱、需要企业支持、重视监控 → 选择 **Camunda**
- 如果你预算有限、需要 CMMN、喜欢折腾 → 选择 **Flowable**
- 如果你只是需要简单任务队列 → 考虑其他方案

---

## 留给你的问题

假设你要给团队选择工作流引擎，需要说服技术负责人和项目经理：

**问题来了：**

1. 技术负责人说「这两个引擎都太重了，我们自己实现一个状态机就够了」——你怎么反驳？
2. 项目经理说「Camunda 有企业版，出问题有人负责；Flowable 是社区的，没人兜底」——你怎么看待这个顾虑？
3. 如果你选择了 Flowable，但后来发现某个关键功能只有 Camunda 支持（比如外部任务），迁移成本有多高？

这三个问题涉及到**技术选型**、**风险评估**和**长期规划**，是架构决策的核心考量。
