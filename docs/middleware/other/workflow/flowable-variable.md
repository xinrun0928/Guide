# Flowable 流程变量与执行上下文

你有没有遇到过这种情况：流程跑着跑着，突然想知道「当前流程执行到哪一步了？」「谁发起的这个流程？」「这个节点之前设置的数据还能不能拿到？」

这些问题的答案，都藏在**流程变量与执行上下文**里。

如果说流程定义是剧本，流程实例是正在上演的戏，那么执行上下文就是舞台上演员们共享的「道具箱」——每个人都可以往里面放东西，也可以取出来用。

---

## 流程变量的本质

### 什么是流程变量？

流程变量（Process Variable）是**贯穿整个流程生命周期的小数据容器**。

当你启动一个报销审批流程时，员工填写的报销金额、报销原因、附件地址……这些数据都需要跟着流程一起「流动」——每个审批节点都能看到，审批后还能更新。

这就是流程变量的作用：**让数据跟着流程走**。

```java
// 启动流程时设置初始变量
Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
variables.put("amount", 15000);           // 报销金额
variables.put("reason", "客户拜访差旅费");  // 报销原因
variables.put("applicant", "zhangsan");    // 申请人

ProcessInstance instance = runtimeService.startProcessInstanceByKey(
    "expenseApproval",
    "EXP-2024-001",  // 业务Key
    variables
);
```

### 变量的存储层级

Flowable 的变量存储有三个层级，理解它们才能用好变量：

```
┌─────────────────────────────────────────────┐
│            全局变量 (Process Instance)       │
│   整个流程实例共享，所有节点都能访问           │
│   例如：报销金额、申请人                      │
├─────────────────────────────────────────────┤
│            执行变量 (Execution)              │
│   当前执行分支私有，只在当前执行线有效         │
│   例如：某个并行分支的临时计算结果            │
├─────────────────────────────────────────────┤
│            本地变量 (Local)                   │
│   仅在特定任务节点有效，任务完成后消失        │
│   例如：任务处理过程中的草稿数据              │
└─────────────────────────────────────────────┘
```

**为什么需要这么多层级？**

考虑这个场景：审批流程有 A、B 两个并行分支，每个分支都要计算自己的「审批优先级」。这个优先级只在各自分支内有用，不需要让其他分支知道。

这时候用本地变量最合适——既不污染全局命名空间，任务结束后还能自动清理。

```java
/**
 * 全局变量：整个流程可见
 */
runtimeService.setVariable(processInstanceId, "amount", 15000);

/**
 * 本地变量：只在当前执行分支可见
 * 适合并行网关分支内的临时数据
 */
runtimeService.setVariableLocal(executionId, "branchPriority", 5);

/**
 * 任务本地变量：只在任务执行期间有效
 */
taskService.setVariableLocal(taskId, "draftComment", "草稿意见");
```

---

## 执行上下文

### 执行对象（Execution）

执行对象是 Flowable 中的**运行时概念**，它代表流程执行的一条「路径」。

在简单流程中，一个流程实例对应一个执行对象：

```
流程实例 A
    └── 执行线 1（从头执行到尾）
```

但在并行流程中，一个流程实例会有多个执行对象：

```
流程实例 A
    ├── 执行线 1（主管审批分支）
    │     └── 等待用户任务...
    └── 执行线 2（财务复核分支）
          └── 等待用户任务...
```

```java
// 查询流程实例的所有执行对象
List&lt;Execution&gt; executions = runtimeService.createExecutionQuery()
    .processInstanceId(processInstanceId)
    .list();

for (Execution execution : executions) {
    System.out.println("执行线ID: " + execution.getId());
    System.out.println("当前节点: " + execution.getActivityId());
    System.out.println("是否并行分支: " + (executions.size() &gt; 1));
}
```

### 变量作用域规则

在并行执行中，变量的访问规则是这样的：

```
全局变量 ← 任何执行线都能读写
本地变量 ← 只有创建它的执行线能访问
```

```java
/**
 * 演示并行分支中的变量访问
 */
@Test
public void variableScopeInParallel() {
    // 启动流程（会自动执行到并行网关，创建两个分支）
    ProcessInstance instance = runtimeService.startProcessInstanceByKey("parallelApproval");
    
    // 查询所有执行线
    List&lt;Execution&gt; executions = runtimeService.createExecutionQuery()
        .processInstanceId(instance.getId())
        .list();
    
    // 两个执行线都能访问全局变量
    String amount = (String) runtimeService.getVariable(instance.getId(), "amount");
    System.out.println("执行线1看到金额: " + amount);
    System.out.println("执行线2看到金额: " + amount);  // 一样的值
    
    // 但本地变量互不影响
    runtimeService.setVariableLocal(executions.get(0).getId(), "branchResult", "通过");
    runtimeService.setVariableLocal(executions.get(1).getId(), "branchResult", "需讨论");
    
    // 执行线1读自己的本地变量
    Object result1 = runtimeService.getVariableLocal(executions.get(0).getId(), "branchResult");
    System.out.println("执行线1的结果: " + result1);  // "通过"
    
    // 执行线1读执行线2的本地变量？读不到！
    Object result2 = runtimeService.getVariableLocal(executions.get(0).getId(), "branchResult");
    System.out.println("执行线1读执行线2的结果: " + result2);  // null
}
```

---

## 变量的读写操作

### 基本 CRUD

```java
@Service
public class VariableService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    /**
     * 读取流程变量的标准方式
     * 使用泛型方法避免强制类型转换
     */
    public &lt;T&gt; T getVariable(String processInstanceId, String variableName, Class&lt;T&gt; type) {
        Object value = runtimeService.getVariable(processInstanceId, variableName);
        if (value == null) {
            return null;
        }
        if (!type.isAssignableFrom(value.getClass())) {
            throw new ClassCastException("变量类型不匹配");
        }
        return type.cast(value);
    }
    
    /**
     * 批量读取变量
     */
    public Map&lt;String, Object&gt; getVariables(String processInstanceId, 
                                             Set&lt;String&gt; variableNames) {
        return runtimeService.getVariables(processInstanceId, variableNames);
    }
    
    /**
     * 批量设置变量
     */
    public void setVariables(String processInstanceId, Map&lt;String, Object&gt; variables) {
        runtimeService.setVariables(processInstanceId, variables);
    }
    
    /**
     * 删除变量
     */
    public void removeVariable(String processInstanceId, String variableName) {
        runtimeService.removeVariable(processInstanceId, variableName);
    }
    
    /**
     * 判断变量是否存在
     */
    public boolean hasVariable(String processInstanceId, String variableName) {
        return runtimeService.hasVariable(processInstanceId, variableName);
    }
}
```

### 任务级别的变量操作

```java
/**
 * 任务变量的特点：
 * 1. 可以设置为"本地"变量，仅任务可见
 * 2. 任务完成后变量是否保留取决于配置
 */
@Test
public void taskVariables() {
    String taskId = "taskId123";
    
    // 设置任务变量（任务级别，不是流程级别）
    taskService.setVariable(taskId, "taskComment", "审批通过");
    
    // 设置本地变量（任务结束即消失）
    taskService.setVariableLocal(taskId, "draftContent", "草稿内容");
    
    // 获取任务变量（会自动向上查找：任务 → 执行 → 流程实例）
    Object comment = taskService.getVariable(taskId, "taskComment");
    
    // 只获取任务本地的变量
    Object draft = taskService.getVariableLocal(taskId, "draftContent");
}
```

---

## 复杂类型变量

### 对象类型变量

Flowable 支持存储 Serializable 对象作为流程变量：

```java
/**
 * 自定义对象作为流程变量
 * 注意：对象必须实现 Serializable 接口
 */
@Data
public class ExpenseInfo implements Serializable {
    private static final long serialVersionUID = 1L;
    
    private String expenseId;
    private String applicant;
    private Integer amount;
    private String category;
    private List&lt;String&gt; attachments;
    private LocalDateTime applyTime;
}

// 存储对象变量
ExpenseInfo expense = new ExpenseInfo();
expense.setExpenseId("EXP-001");
expense.setApplicant("zhangsan");
expense.setAmount(15000);
expense.setCategory("差旅费");

runtimeService.setVariable(processInstanceId, "expenseInfo", expense);

// 读取对象变量
ExpenseInfo saved = (ExpenseInfo) runtimeService.getVariable(processInstanceId, "expenseInfo");
```

### JSON 类型变量

现代应用中，JSON 是常见的数据格式。Flowable 6.x 支持原生 JSON 类型：

```java
/**
 * 使用 ObjectMapper 将对象转为 JSON 存储
 */
@Autowired
private ObjectMapper objectMapper;

public void setJsonVariable(String processInstanceId, Object data) throws JsonProcessingException {
    String jsonValue = objectMapper.writeValueAsString(data);
    runtimeService.setVariable(processInstanceId, "formData", jsonValue);
}

public &lt;T&gt; T getJsonVariable(String processInstanceId, String variableName, Class&lt;T&gt; clazz) 
    throws JsonProcessingException {
    String json = (String) runtimeService.getVariable(processInstanceId, variableName);
    if (json == null) {
        return null;
    }
    return objectMapper.readValue(json, clazz);
}
```

---

## 执行上下文与流程追踪

### 获取当前执行位置

```java
/**
 * 获取流程当前执行到的节点
 */
public String getCurrentActivity(String processInstanceId) {
    // 找到主执行线
    Execution execution = runtimeService.createExecutionQuery()
        .processInstanceId(processInstanceId)
        .onlySubProcessInstances(false)
        .singleResult();
    
    // 获取当前活动节点ID
    String activityId = execution.getActivityId();
    
    // 获取节点名称（需要从流程定义中查询）
    ProcessDefinition processDefinition = repositoryService.createProcessDefinitionQuery()
        .processDefinitionId(execution.getProcessDefinitionId())
        .singleResult();
    
    BpmnModel bpmnModel = repositoryService.getBpmnModel(processDefinition.getId());
    FlowNode flowNode = (FlowNode) bpmnModel.getFlowElement(activityId);
    
    return flowNode != null ? flowNode.getName() : activityId;
}
```

### 变量历史记录

```java
/**
 * 查询变量的变更历史
 */
public List&lt;HistoricVariableUpdate&gt; getVariableHistory(String processInstanceId, 
                                                        String variableName) {
    HistoryService historyService = processEngine.getHistoryService();
    
    return historyService.createHistoricVariableInstanceQuery()
        .processInstanceId(processInstanceId)
        .variableName(variableName)
        .orderByCreateTime()
        .desc()
        .list();
}

/**
 * 完整变量快照
 */
public Map&lt;String, Object&gt; getVariableSnapshot(String processInstanceId, Date snapshotTime) {
    List&lt;HistoricDetail&gt; details = historyService.createHistoricDetailQuery()
        .processInstanceId(processInstanceId)
        .variableUpdates()
        .createTimeBefore(snapshotTime)
        .orderByCreateTime()
        .desc()
        .list();
    
    Map&lt;String, Object&gt; snapshot = new HashMap&lt;&gt;();
    for (HistoricDetail detail : details) {
        HistoricVariableUpdate update = (HistoricVariableUpdate) detail;
        snapshot.put(update.getVariableName(), update.getValue());
    }
    return snapshot;
}
```

---

## 性能与最佳实践

### 变量存储的成本

每次设置变量都会触发数据库操作，频繁操作变量会影响性能。以下是优化建议：

```java
/**
 * 错误示范：循环中频繁设置变量
 */
for (OrderItem item : items) {
    runtimeService.setVariable(processInstanceId, "currentItem", item);  // 每次都写DB
    processItem(item);
}

/**
 * 正确做法：批量操作
 */
Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
for (OrderItem item : items) {
    variables.put("item_" + item.getId(), item);  // 先收集到Map
}
runtimeService.setVariables(processInstanceId, variables);  // 一次批量写入
```

### 变量命名规范

```java
/**
 * 推荐的变量命名方式
 * 使用清晰的命名空间前缀，避免变量名冲突
 */

// 按模块前缀分组
public static final String VAR_PREFIX = "expense_";
public static final String VAR_PREFIX_APPROVAL = "approval_";
public static final String VAR_PREFIX_FINANCE = "finance_";

// 使用常量定义变量名
public class ExpenseVariable {
    public static final String AMOUNT = "expense_amount";
    public static final String REASON = "expense_reason";
    public static final String CATEGORY = "expense_category";
    
    public static final String APPROVAL_RESULT = "approval_result";
    public static final String APPROVAL_COMMENT = "approval_comment";
}
```

---

## 总结：变量的使用场景

| 场景 | 推荐变量类型 | 说明 |
|---|---|---|
| 流程启动时的业务数据 | 全局变量 | 需要在所有节点访问 |
| 并行分支的临时计算 | 本地变量 | 避免变量名冲突 |
| 用户输入的草稿 | 任务本地变量 | 不需要持久化 |
| 审批结果标记 | 全局变量 | 影响后续流程走向 |
| 敏感中间数据 | 本地变量 | 最小化数据暴露 |

---

## 留给你的问题

假设你在设计一个「合同审批」流程：

1. 合同金额、合同内容这类数据，应该用什么变量级别？
2. 法务、财务两个并行分支各自需要「分支审批意见」，怎么避免变量名冲突？
3. 如果审批过程中，法务需要知道财务的审批结果（但财务还没审批完），这种情况下变量应该怎么设计？

这三个问题，涉及到**数据一致性**与**并发安全**的核心矛盾，值得你仔细思考。
