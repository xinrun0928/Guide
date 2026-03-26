# Camunda 架构：引擎、REST API、Web 应用

你有没有想过：一个工作流引擎，除了核心执行能力，还需要什么？

答案是：**配套的工具链**。

没有流程设计器，你只能用 XML 写流程；没有监控界面，你只能用数据库查状态；没有 REST API，你的系统就和其他模块隔离了。

Camunda 在这方面做得相当完善——它提供了完整的生态：从设计、部署、执行到监控，一站式搞定。

---

## Camunda 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                      Camunda Platform                              │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                     Camunda Web Applications               │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐    │ │
│  │  │ Cockpit     │  │ Tasklist    │  │ Admin           │    │ │
│  │  │ (监控中心)   │  │ (任务列表)   │  │ (系统管理)      │    │ │
│  │  └─────────────┘  └─────────────┘  └─────────────────┘    │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                    REST API Layer                        │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │ │
│  │  │Process  │  │  Task   │  │ History │  │  Decision│   │ │
│  │  │ Engine  │  │  API    │  │   API   │  │   API   │   │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                   Engine Core                             │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐   │ │
│  │  │Process  │  │  CMMN   │  │   DMN   │  │  Form   │   │ │
│  │  │ Engine  │  │ Engine  │  │ Engine  │  │ Engine  │   │ │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘   │ │
│  └───────────────────────────────────────────────────────────┘ │
│                              │                                   │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                 Database Layer                             │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Camunda Engine（流程引擎）

### 核心组件

Camunda Engine 是整个平台的核心，负责 BPMN 流程的执行。

```java
// 获取流程引擎
ProcessEngine processEngine = ProcessEngineConfiguration
    .createStandaloneProcessEngineConfiguration()
    .buildProcessEngine();

// 获取核心服务
RuntimeService runtimeService = processEngine.getRuntimeService();
TaskService taskService = processEngine.getTaskService();
RepositoryService repositoryService = processEngine.getRepositoryService();
HistoryService historyService = processEngine.getHistoryService();
ProcessManagementService processManagementService = processEngine.getProcessManagementService();
```

### 引擎配置

Camunda 支持多种配置方式：

```java
// 方式1：编程式配置
ProcessEngineConfiguration config = ProcessEngineConfiguration
    .createStandaloneProcessEngineConfiguration()
    .setJdbcUrl("jdbc:mysql://localhost:3306/camunda")
    .setJdbcDriver("com.mysql.cj.jdbc.Driver")
    .setJdbcUsername("root")
    .setJdbcPassword("password")
    .setDatabaseSchemaUpdate(ProcessEngineConfiguration.DB_SCHEMA_UPDATE_TRUE)
    .setJobExecutorActivate(true)
    .setAsyncExecutorEnabled(true);

// 方式2：XML 配置
ProcessEngine processEngine = ProcessEngineConfiguration
    .createProcessEngineConfigurationFromResource("camunda.cfg.xml")
    .buildProcessEngine();
```

```xml
<!-- camunda.cfg.xml -->
<beans xmlns="http://www.springframework.org/schema/beans">
    <bean id="processEngineConfiguration" 
          class="org.camunda.bpm.engine.impl.cfg.StandaloneProcessEngineConfiguration">
        <property name="jdbcUrl" value="jdbc:mysql://localhost:3306/camunda"/>
        <property name="jdbcDriver" value="com.mysql.cj.jdbc.Driver"/>
        <property name="jdbcUsername" value="root"/>
        <property name="jdbcPassword" value="password"/>
        <property name="databaseSchemaUpdate" value="true"/>
    </bean>
</beans>
```

### 核心服务一览

| 服务 | 职责 | 常用方法 |
|---|---|---|
| RuntimeService | 流程运行时管理 | `startProcessInstanceByKey()` `setVariable()` `signal()` |
| TaskService | 任务管理 | `createTaskQuery()` `claim()` `complete()` |
| RepositoryService | 流程定义管理 | `createDeployment()` `getProcessDiagram()` |
| HistoryService | 历史数据查询 | `createHistoricProcessInstanceQuery()` |
| IdentityService | 身份管理 | `createUser()` `createGroup()` |
| FormService | 表单服务 | `getRenderedStartForm()` |
| DecisionService | 决策服务 | `evaluateDecision()` |
| ExternalTaskService | 外部任务服务 | `fetchAndLock()` `complete()` |

---

## Camunda REST API

### API 概览

Camunda 提供了完整的 REST API，覆盖所有核心功能：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│                      Camunda REST API                            │
│                                                                 │
│  /engine/{name}/                                               │
│  ├── process-definition/        流程定义管理                     │
│  │   ├── GET  /process-definition              列表查询         │
│  │   ├── GET  /process-definition/{key}       获取详情         │
│  │   ├── POST /process-definition/{key}/start 启动流程         │
│  │   └── GET  /process-definition/{key}/xml  获取BPMN XML      │
│  │                                                            │
│  ├── process-instance/           流程实例管理                     │
│  │   ├── GET  /process-instance               列表查询         │
│  │   ├── GET  /process-instance/{id}         获取详情         │
│  │   ├── POST /process-instance/{id}/variables 设置变量         │
│  │   ├── POST /process-instance/{id}/signal  发送信号           │
│  │   └── DELETE /process-instance/{id}       删除实例           │
│  │                                                            │
│  ├── task/                        任务管理                       │
│  │   ├── GET  /task                              列表查询      │
│  │   ├── GET  /task/{id}                         获取详情      │
│  │   ├── POST /task/{id}/claim                  签收任务      │
│  │   ├── POST /task/{id}/complete               完成任务      │
│  │   └── POST /task/{id}/delegate                委托任务      │
│  │                                                            │
│  ├── history/                      历史数据                     │
│  │   ├── /history/process-instance  流程实例历史               │
│  │   ├── /history/task                任务历史                 │
│  │   ├── /history/variable            变量历史                 │
│  │   └── /history/activity-instance   活动历史                 │
│  │                                                            │
│  └── decision-definition/           决策定义                    │
│      ├── GET  /decision-definition             列表查询        │
│      └── POST /decision-definition/{key}/evaluate 执行决策     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 使用示例

```bash
# 部署流程定义
curl -X POST "http://localhost:8080/engine-rest/deployment/create" \
  -H "Content-Type: multipart/form-data" \
  -F "data=@expense-approval.bpmn"

# 启动流程实例
curl -X POST "http://localhost:8080/engine-rest/process-definition/key/expense-approval/start" \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "amount": {"value": 15000, "type": "Integer"},
      "applicant": {"value": "zhangsan", "type": "String"}
    }
  }'

# 查询任务
curl "http://localhost:8080/engine-rest/task?assignee=zhangsan"

# 完成任务
curl -X POST "http://localhost:8080/engine-rest/task/{taskId}/complete" \
  -H "Content-Type: application/json" \
  -d '{
    "variables": {
      "approved": {"value": true, "type": "Boolean"}
    }
  }'

# 查询历史
curl "http://localhost:8080/engine-rest/history/process-instance?finished=true"
```

### Java 客户端

```java
/**
 * 使用 Camunda Java 客户端
 */
public class CamundaClientExample {
    
    public static void main(String[] args) {
        // 创建客户端
        ProcessEngineInstanceName = "default";
        String baseUrl = "http://localhost:8080/engine-rest";
        
        // 方式1：使用 Spring Boot Starter（推荐）
        // 只需引入依赖，配置 URL 即可
        
        // 方式2：手动创建客户端
        ProcessEngine processEngine = ProcessEngineConfiguration
            .createProcessEngineConfigurationFromResource()
            .buildProcessEngine();
        
        // 使用远程 REST API
        ProcessEngine remoteEngine = ProcessEngineConfiguration
            .createProcessEngineConfigurationFromResource("camunda-remote.cfg.xml")
            .buildProcessEngine();
    }
}
```

---

## Camunda Web 应用

### Cockpit（监控中心）

Cockpit 是 Camunda 的监控和控制台，用于：

- 查看运行中的流程实例
- 监控流程健康状态
- 取消/挂起流程实例
- 查看错误和异常
- 分析流程性能

```java
// 通过 Cockpit API 查询监控数据
HistoryService historyService = processEngine.getHistoryService();

// 查询正在运行的流程
List&lt;HistoricProcessInstance&gt; runningProcesses = historyService
    .createHistoricProcessInstanceQuery()
    .unfinished()
    .list();

// 查询失败的任务
List&lt;HistoricTaskInstance&gt; failedTasks = historyService
    .createHistoricTaskInstanceQuery()
    .deleted()
    .list();

// 查询超时任务
List&lt;HistoricTaskInstance&gt; overdueTasks = historyService
    .createHistoricTaskInstanceQuery()
    .taskDueDateBefore(new Date())
    .finished()
    .list();
```

### Tasklist（任务列表）

Tasklist 为终端用户提供任务办理界面：

- 显示待办任务列表
- 渲染任务表单
- 支持任务签收、办理、委托
- 流程历史和进度查看

```java
// Tasklist 相关的表单服务
FormService formService = processEngine.getFormService();

// 获取启动表单
Object startForm = formService.getRenderedStartForm(processDefinitionId);

// 获取任务表单
Object taskForm = formService.getRenderedTaskForm(taskId);

// 提交表单并启动流程
ProcessInstance instance = formService.submitStartForm(
    processDefinitionId, 
    variables
);

// 提交表单并完成任务
formService.submitTaskForm(taskId, variables);
```

### Admin（系统管理）

Admin 用于系统管理：

- 用户和组管理
- 权限配置
- 系统配置
- 审计日志

```java
// 用户管理
IdentityService identityService = processEngine.getIdentityService();

// 创建用户
User user = identityService.newUser("zhangsan");
user.setFirstName("张");
user.setLastName("三");
user.setEmail("zhangsan@example.com");
identityService.saveUser(user);

// 创建组
Group group = identityService.newGroup("manager");
group.setName("经理组");
group.setType("WORKFLOW");
identityService.saveGroup(group);

// 添加到组
identityService.createMembership("zhangsan", "manager");
```

---

## 外部任务（External Task）

### 概念

外部任务是 Camunda 特有的模式——它允许**外部系统主动拉取任务**，而不是被动等待引擎推送。

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   传统模式（Service Task）                                        │
│   ┌──────────────┐      ┌──────────────┐                       │
│   │   Camunda    │ ───→ │  外部系统     │                       │
│   │   引擎        │ 同步调用 │  被迫处理     │                       │
│   └──────────────┘      └──────────────┘                       │
│   问题：引擎需要知道外部系统的地址和接口                           │
│                                                                 │
│   外部任务模式                                                   │
│   ┌──────────────┐      ┌──────────────┐                       │
│   │   Camunda    │ ←─── │  外部系统     │                       │
│   │   引擎        │ 拉取  │  主动获取     │                       │
│   └──────────────┘      └──────────────┘                       │
│   优点：外部系统自己控制处理节奏，引擎不关心具体实现                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### BPMN 配置

```xml
<!-- 定义外部任务 -->
<serviceTask id="checkInventory" name="检查库存">
    <extensionElements>
        <!-- 外部任务主题 -->
        <camunda:external>
            <camunda:topic name="inventory-check"/>
            <camunda:lockDuration>PT5M</camunda:lockDuration>  <!-- 锁定5分钟 -->
        </camunda:external>
    </extensionElements>
</serviceTask>
```

### Java 客户端实现

```java
/**
 * 外部任务客户端
 * 外部系统使用这个客户端从 Camunda 获取任务并处理
 */
public class ExternalTaskWorker {
    
    private final ProcessEngine processEngine;
    private final String workerId;
    
    public ExternalTaskWorker(ProcessEngine processEngine, String workerId) {
        this.processEngine = processEngine;
        this.workerId = workerId;
    }
    
    /**
     * 拉取并锁定任务
     */
    public void fetchAndHandleTasks() {
        ExternalTaskService externalTaskService = processEngine.getExternalTaskService();
        
        // 拉取任务
        List&lt;LockedExternalTask&gt; tasks = externalTaskService.fetchAndLock(5, workerId)
            .topic("inventory-check", Duration.ofMinutes(5))
            .variables("productId", "quantity")
            .execute();
        
        for (LockedExternalTask task : tasks) {
            try {
                // 处理业务逻辑
                handleInventoryCheck(task);
                
                // 完成任务
                externalTaskService.complete(task.getId(), workerId);
                
            } catch (Exception e) {
                // 处理失败，报告错误
                externalTaskService.handleFailure(
                    task.getId(),
                    workerId,
                    "库存检查失败: " + e.getMessage(),
                    3,  // 重试次数
                    Duration.ofMinutes(1).toMillis()  // 重试间隔
                );
            }
        }
    }
    
    /**
     * 业务处理逻辑
     */
    private void handleInventoryCheck(LockedExternalTask task) {
        String productId = (String) task.getVariables().get("productId");
        Integer quantity = (Integer) task.getVariables().get("quantity");
        
        // 调用库存系统检查
        InventoryCheckResult result = inventoryService.check(productId, quantity);
        
        // 设置输出变量
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("inStock", result.isAvailable());
        variables.put("stockQuantity", result.getAvailableQuantity());
        
        // 注意：需要在 complete 时传入
    }
}
```

### 外部任务 vs 服务任务

| 特性 | 服务任务 | 外部任务 |
|---|---|---|
| 调用方式 | 引擎主动调用 | 外部系统拉取 |
| 同步/异步 | 同步（可配置异步） | 异步 |
| 错误处理 | 边界错误事件 | BpmnError 或失败报告 |
| 重试机制 | 内置重试 | 外部系统控制 |
| 适用场景 | 内部服务、简单逻辑 | 独立系统、长耗时任务 |

---

## 集群部署架构

### 单节点 vs 集群

```
┌─────────────────────────────────────────────────────────────────┐
│                     单节点部署                                    │
│   ┌─────────────────────────────────────────────────────────┐ │
│   │  ┌─────────┐  ┌─────────┐  ┌─────────┐                  │ │
│   │  │ Web App │  │ Engine  │  │  DB     │                  │ │
│   │  │ Cockpit │  │         │  │         │                  │ │
│   │  └─────────┘  └─────────┘  └─────────┘                  │ │
│   └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     集群部署                                      │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │
│   │  Node 1     │  │  Node 2     │  │  Node 3     │           │
│   │ ┌─────────┐ │  │ ┌─────────┐ │  │ ┌─────────┐ │           │
│   │ │ Engine  │ │  │ │ Engine  │ │  │ │ Engine  │ │           │
│   │ └─────────┘ │  │ └─────────┘ │  │ └─────────┘ │           │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘           │
│          │                │                │                    │
│          └────────────────┼────────────────┘                    │
│                           │                                     │
│                    ┌──────┴──────┐                             │
│                    │     DB      │                             │
│                    │  (共享存储)  │                             │
│                    └─────────────┘                             │
└─────────────────────────────────────────────────────────────────┘
```

### 集群配置要点

```java
/**
 * 集群环境下的引擎配置
 */
ProcessEngineConfiguration clusterConfig = ProcessEngineConfiguration
    .createProcessEngineConfigurationFromResource("clustered-camunda.cfg.xml")
    // 启用作业执行器
    .setJobExecutorActivate(true)
    .setAsyncExecutorEnabled(true)
    // 作业获取锁定时间（防止重复执行）
    .setJobExecutorLockTime(TimeDuration.ofMinutes(5))
    // 数据库schema自动更新
    .setDatabaseSchemaUpdate(DB_SCHEMA_UPDATE_TRUE)
    // 流程引擎名称（集群中唯一）
    .setProcessEngineName("cluster-node-1");
```

```xml
<!-- clustered-camunda.cfg.xml -->
<beans>
    <bean id="processEngineConfiguration" 
          class="org.camunda.bpm.engine.impl.cfg.JtaProcessEngineConfiguration">
        <!-- JTA 事务管理（用于集群） -->
        <property name="transactionManager" ref="transactionManager"/>
        
        <!-- 作业执行器配置 -->
        <property name="jobExecutorActivate" value="true"/>
        <property name="asyncExecutorEnabled" value="true"/>
        <property name="asyncExecutorLockTimeInMillis" value="300000"/>
        
        <!-- 数据库连接池（集群共享） -->
        <property name="jdbcUrl" value="jdbc:mysql://db-cluster:3306/camunda"/>
    </bean>
</beans>
```

---

## 总结：Camunda 架构特点

| 组件 | 特点 | 适用场景 |
|---|---|---|
| Engine | 轻量级、高性能 | 嵌入式或独立部署 |
| REST API | 完整、标准化 | 微服务架构、移动端 |
| Cockpit | 功能丰富 | 生产监控、问题排查 |
| Tasklist | 开箱即用 | 快速原型、内部系统 |
| External Task | 外部拉取 | 独立系统集成 |
| 集群支持 | 基于数据库锁 | 高可用部署 |

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
