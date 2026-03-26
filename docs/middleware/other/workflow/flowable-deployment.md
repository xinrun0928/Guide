# Flowable 流程定义：部署、激活、挂起、删除

你有没有想过这个问题：

一个 BPMN 流程定义在 Flowable 里，到底是怎么存储和管理的？

从你把 `.bpmn` 文件扔进系统，到它能被启动执行，这中间发生了什么？

这篇文章带你彻底搞懂 Flowable 的流程定义管理。

---

## 流程定义的生命周期

```
┌─────────────┐    部署     ┌─────────────┐    激活     ┌─────────────┐
│   空闲态     │ ─────────→ │   已部署     │ ─────────→ │   激活状态   │
│             │            │             │            │             │
└─────────────┘            └─────────────┘            └──────┬──────┘
                                                                  │
                         ┌──────────────────────────────────────┘
                         │
                         ▼
                  ┌─────────────┐    挂起     ┌─────────────┐
                  │   已挂起     │ ←───────── │   激活状态   │
                  │             │            │             │
                  └──────┬──────┘            └─────────────┘
                         │
                         ▼
                  ┌─────────────┐    删除     ┌─────────────┐
                  │   已删除     │ ←───────── │   已挂起     │
                  │             │            │             │
                  └─────────────┘            └─────────────┘
```

---

## RepositoryService：流程定义的管家

`RepositoryService` 是管理流程定义的核心服务：

```java
RepositoryService repositoryService = processEngine.getRepositoryService();
```

它负责：
- 部署流程定义
- 查询已部署的流程定义
- 获取流程定义的资源（BPMN XML、图片）
- 激活或挂起流程定义
- 删除流程定义

---

## 部署流程定义

### 方式一：Classpath 资源部署

```java
/**
 * 从 classpath 部署流程定义
 * 最简单的方式，适合开发和测试
 */
@Test
public void deployFromClasspath() {
    Deployment deployment = repositoryService.createDeployment()
        .name("报销审批流程")
        .key("expenseApproval")
        .addClasspathResource("processes/expense-approval.bpmn20.xml")
        .addClasspathResource("processes/expense-approval.png") // 可选：流程图
        .deploy();
    
    System.out.println("部署ID: " + deployment.getId());
    System.out.println("部署名称: " + deployment.getName());
}
```

### 方式二：ZIP 包部署

```java
/**
 * 部署包含多个文件的流程定义
 * 适合从外部上传 BPMN 文件
 */
@Test
public void deployFromZip() {
    ZipInputStream zipInputStream = new ZipInputStream(
        new FileInputStream("processes/expense-package.zip")
    );
    
    Deployment deployment = repositoryService.createDeployment()
        .name("报销流程包")
        .addZipInputStream(zipInputStream)
        .deploy();
}
```

### 方式三：字符串部署

```java
/**
 * 直接从字符串部署 BPMN XML
 * 适合动态生成流程定义的场景
 */
@Test
public void deployFromString() {
    String bpmnXml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<definitions xmlns=\"http://www.omg.org/spec/BPMN/20100524/MODEL\" " +
        "targetNamespace=\"http://flowable.org/test\">" +
        "<process id=\"dynamicProcess\" isExecutable=\"true\">" +
        "<!-- 动态生成的流程定义 -->" +
        "</process>" +
        "</definitions>";
    
    Deployment deployment = repositoryService.createDeployment()
        .name("动态流程")
        .addString("dynamic-process.bpmn20.xml", bpmnXml)
        .deploy();
}
```

### 部署结果

部署后，Flowable 会：
1. 解析 BPMN XML
2. 创建流程定义的持久化记录
3. 存储原始 BPMN 文件
4. 生成流程图（如果配置了）

```java
// 部署后查询流程定义
ProcessDefinition processDefinition = repositoryService
    .createProcessDefinitionQuery()
    .deploymentId(deployment.getId())
    .singleResult();

System.out.println("流程定义ID: " + processDefinition.getId());
// 格式：{processDefinitionKey}:{version}:{generatedId}
// 例如：expenseApproval:1:2504

System.out.println("流程定义Key: " + processDefinition.getKey());
System.out.println("版本: " + processDefinition.getVersion());
System.out.println("资源名称: " + processDefinition.getResourceName());
System.out.println("是否激活: " + processDefinition.isSuspended());
```

---

## 查询流程定义

### 基础查询

```java
// 查询所有已部署的流程定义
List&lt;ProcessDefinition&gt; definitions = repositoryService
    .createProcessDefinitionQuery()
    .list();

// 按 Key 查询
ProcessDefinition definition = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("expenseApproval")
    .latestVersion() // 获取最新版本
    .singleResult();

// 按名称模糊查询
List&lt;ProcessDefinition&gt; definitions = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionNameLike("%报销%")
    .list();

// 分页查询
List&lt;ProcessDefinition&gt; pagedDefinitions = repositoryService
    .createProcessDefinitionQuery()
    .orderByProcessDefinitionName()
    .desc()
    .listPage(0, 10); // 第1页，每页10条
```

### 获取流程定义资源

```java
/**
 * 获取 BPMN XML 文件内容
 */
@Test
public void getProcessResource() {
    ProcessDefinition processDefinition = repositoryService
        .createProcessDefinitionQuery()
        .processDefinitionKey("expenseApproval")
        .latestVersion()
        .singleResult();
    
    // 获取资源名称（如 expense-approval.bpmn20.xml）
    String resourceName = processDefinition.getResourceName();
    
    // 读取资源内容
    InputStream resourceStream = repositoryService
        .getResourceAsStream(
            processDefinition.getDeploymentId(),
            resourceName
        );
    
    // 转换为字符串
    String bpmnXml = IOUtils.toString(resourceStream, StandardCharsets.UTF_8);
    System.out.println(bpmnXml);
}

/**
 * 获取流程图
 */
@Test
public void getProcessDiagram() {
    ProcessDefinition processDefinition = repositoryService
        .createProcessDefinitionQuery()
        .processDefinitionKey("expenseApproval")
        .latestVersion()
        .singleResult();
    
    // 检查是否有流程图
    if (processDefinition.hasGraphicalNotation()) {
        InputStream diagramStream = repositoryService
            .getProcessDiagram(processDefinition.getId());
        
        // 保存为图片
        Files.copy(diagramStream, Paths.get("/tmp/process-diagram.png"));
    }
}
```

---

## 激活与挂起

### 为什么要挂起？

- 流程定义需要维护，不允许新启动
- 正在运行的实例需要继续执行，但不允许发起新的流程
- 紧急停用某个流程（比如发现严重 bug）

### 挂起流程定义

```java
/**
 * 挂起单个流程定义
 * 挂起后，无法再启动新的流程实例
 */
@Test
public void suspendProcessDefinition() {
    ProcessDefinition processDefinition = repositoryService
        .createProcessDefinitionQuery()
        .processDefinitionKey("expenseApproval")
        .latestVersion()
        .singleResult();
    
    repositoryService.suspendProcessDefinition(processDefinition.getId());
    
    // 或者按 Key 挂起
    repositoryService.suspendProcessDefinitionByKey("expenseApproval");
    
    System.out.println("流程定义已挂起: " + processDefinition.getId());
}

/**
 * 挂起流程定义时，同时挂起所有运行中的实例
 */
@Test
public void suspendProcessDefinitionWithInstances() {
    repositoryService.suspendProcessDefinitionByKey(
        "expenseApproval",
        true,  // suspendProcessInstances：是否挂起实例
        new Date() // suspensionDate：定时挂起（null 表示立即）
    );
}
```

### 激活流程定义

```java
/**
 * 重新激活已挂起的流程定义
 */
@Test
public void activateProcessDefinition() {
    repositoryService.activateProcessDefinitionByKey("expenseApproval");
    
    // 或者按 ID 激活
    // repositoryService.activateProcessDefinition(processDefinitionId);
}
```

### 验证挂起状态

```java
// 查询当前状态
ProcessDefinition processDefinition = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("expenseApproval")
    .singleResult();

if (processDefinition.isSuspended()) {
    System.out.println("流程定义已挂起");
} else {
    System.out.println("流程定义已激活");
}

// 尝试启动已挂起的流程会抛出异常
try {
    runtimeService.startProcessInstanceByKey("expenseApproval");
} catch (FlowableObjectNotFoundException e) {
    System.out.println("无法启动：流程定义已挂起");
}
```

---

## 删除流程定义

### 删除基础操作

```java
/**
 * 删除流程定义
 * 默认只删除流程定义，不删除运行中的实例
 */
@Test
public void deleteProcessDefinition() {
    ProcessDefinition processDefinition = repositoryService
        .createProcessDefinitionQuery()
        .processDefinitionKey("expenseApproval")
        .latestVersion()
        .singleResult();
    
    repositoryService.deleteDeployment(processDefinition.getDeploymentId());
}

/**
 * 删除流程定义（连同历史数据一起删除）
 */
@Test
public void deleteProcessDefinitionWithHistory() {
    String deploymentId = "12345";
    
    // 第二个参数 true：级联删除历史记录
    repositoryService.deleteDeployment(deploymentId, true);
}
```

### 强制删除（级联删除）

```java
/**
 * 级联删除：删除流程定义及其所有运行中的实例
 * 危险操作！请确认后再执行
 */
@Test
public void cascadeDelete() {
    ProcessDefinition processDefinition = repositoryService
        .createProcessDefinitionQuery()
        .processDefinitionKey("expenseApproval")
        .singleResult();
    
    // cascade = true 会删除所有流程实例
    repositoryService.deleteDeployment(
        processDefinition.getDeploymentId(),
        true // cascade
    );
}
```

### 删除前的安全检查

```java
/**
 * 删除前检查是否有运行中的实例
 */
@Test
public void safeDelete() {
    String deploymentId = "12345";
    
    // 查询运行中的实例数量
    long activeCount = runtimeService
        .createProcessInstanceQuery()
        .deploymentId(deploymentId)
        .count();
    
    if (activeCount > 0) {
        System.out.println("警告：该流程定义有 " + activeCount + " 个运行中的实例");
        System.out.println("请先完成或取消这些实例后再删除");
        return;
    }
    
    // 没有运行中的实例，可以安全删除
    repositoryService.deleteDeployment(deploymentId);
}
```

---

## 版本管理

### 自动版本递增

每次部署同名流程定义，版本号会自动 +1：

```java
// 第一次部署
repositoryService.createDeployment()
    .addClasspathResource("processes/expense-approval.bpmn20.xml")
    .key("expenseApproval") // 指定 Key
    .deploy();
// 版本 = 1

// 修改后重新部署（相同 Key）
repositoryService.createDeployment()
    .addClasspathResource("processes/expense-approval.bpmn20.xml")
    .key("expenseApproval")
    .deploy();
// 版本 = 2（自动递增）

// 再部署一次
repositoryService.createDeployment()
    .addClasspathResource("processes/expense-approval.bpmn20.xml")
    .key("expenseApproval")
    .deploy();
// 版本 = 3
```

### 查询历史版本

```java
// 查询某个 Key 的所有版本
List&lt;ProcessDefinition&gt; allVersions = repositoryService
    .createProcessDefinitionQuery()
    .processDefinitionKey("expenseApproval")
    .orderByProcessDefinitionVersion()
    .desc()
    .list();

for (ProcessDefinition pd : allVersions) {
    System.out.println("版本: " + pd.getVersion() 
        + ", ID: " + pd.getId()
        + ", 状态: " + (pd.isSuspended() ? "已挂起" : "已激活"));
}
```

---

## 总结：流程定义管理要点

| 操作 | 方法 | 注意事项 |
|---|---|---|
| 部署 | `RepositoryService.createDeployment()` | 支持 classpath、zip、字符串 |
| 查询 | `RepositoryService.createProcessDefinitionQuery()` | 支持按 Key、版本、名称等 |
| 挂起 | `suspendProcessDefinition*()` | 挂起后无法启动新实例 |
| 激活 | `activateProcessDefinition*()` | 恢复流程定义的可用性 |
| 删除 | `deleteDeployment()` | 确认没有运行中的实例 |
| 版本 | 自动递增 | 相同 Key 部署时版本 +1 |

---

## 留给你的问题

假设你负责的系统正在运行，突然老板说：「紧急！这个报销流程有 bug，需要马上修复并上线。」

你的流程是：
1. 修改 BPMN 文件
2. 重新部署
3. 问题：新版本部署后，老版本正在运行的实例会怎样？

如果老版本有 100 个运行中的实例，你是等它们全部完成，还是强制切换到新版本？

这个问题涉及到**流程版本管理**的核心问题：如何在不停机的情况下平滑升级流程定义？
