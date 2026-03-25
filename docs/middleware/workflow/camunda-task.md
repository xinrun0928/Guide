# Camunda 任务与用户交互：Tasklist 开发指南

Camunda Tasklist 是用户处理任务的 Web 界面。

但大多数时候，我们需要在自己的应用中集成任务功能，而不是直接使用 Tasklist。

这篇文章介绍如何在 Camunda 中实现用户任务交互。

---

## 任务查询

### 按条件查询

```java
@Autowired
private TaskService taskService;

/**
 * 查询用户的待办任务
 */
public List&lt;Task&gt; getMyTasks(String userId) {
    return taskService.createTaskQuery()
        .taskAssignee(userId)
        .active()
        .list();
}

/**
 * 查询候选任务
 */
public List&lt;Task&gt; getCandidateTasks(String userId) {
    return taskService.createTaskQuery()
        .taskCandidateUser(userId)
        .active()
        .list();
}

/**
 * 按流程定义查询
 */
public List&lt;Task&gt; getTasksByProcess(String processDefinitionKey) {
    return taskService.createTaskQuery()
        .processDefinitionKey(processDefinitionKey)
        .active()
        .list();
}

/**
 * 按变量值查询
 */
public List&lt;Task&gt; getTasksByVariable() {
    return taskService.createTaskQuery()
        .taskVariableValueEquals("priority", "HIGH")
        .taskVariableValueGreaterThan("amount", 10000)
        .list();
}

/**
 * 分页查询
 */
public Page&lt;Task&gt; getTasksPaged(String userId, int page, int size) {
    TaskQuery query = taskService.createTaskQuery()
        .taskAssignee(userId)
        .active()
        .orderByTaskCreateTime()
        .desc();
    
    long total = query.count();
    List&lt;Task&gt; tasks = query.listPage((page - 1) * size, size);
    
    return new Page&lt;&gt;(tasks, total, page, size);
}
```

### 高级查询

```java
/**
 * 复杂条件查询
 */
public List&lt;Task&gt; complexQuery(TaskQueryDTO dto) {
    TaskQuery query = taskService.createTaskQuery();
    
    if (dto.getAssignee() != null) {
        query.taskAssignee(dto.getAssignee());
    }
    
    if (dto.getCandidateUser() != null) {
        query.taskCandidateUser(dto.getCandidateUser());
    }
    
    if (dto.getCandidateGroup() != null) {
        query.taskCandidateGroup(dto.getCandidateGroup());
    }
    
    if (dto.getProcessDefinitionKey() != null) {
        query.processDefinitionKey(dto.getProcessDefinitionKey());
    }
    
    if (dto.getName() != null) {
        query.taskNameLike("%" + dto.getName() + "%");
    }
    
    if (dto.getDueDateBefore() != null) {
        query.taskDueBefore(dto.getDueDateBefore());
    }
    
    if (dto.getDueDateAfter() != null) {
        query.taskDueAfter(dto.getDueDateAfter());
    }
    
    // 排序
    if ("dueDate".equals(dto.getSortBy())) {
        if (dto.isAscending()) {
            query.orderByTaskDueDate().asc();
        } else {
            query.orderByTaskDueDate().desc();
        }
    } else {
        query.orderByTaskCreateTime().desc();
    }
    
    return query.list();
}
```

---

## 任务操作

### 签收任务

```java
/**
 * 签收任务
 */
public void claimTask(String taskId, String userId) {
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    // 检查任务是否已被签收
    if (task.getAssignee() != null) {
        throw new RuntimeException("任务已被 " + task.getAssignee() + " 签收");
    }
    
    // 检查用户是否有资格签收
    List&lt;IdentityLink&gt; candidates = taskService.getIdentityLinksForTask(taskId);
    boolean canClaim = candidates.stream()
        .anyMatch(link -> userId.equals(link.getUserId()));
    
    if (!canClaim) {
        throw new RuntimeException("用户无权签收此任务");
    }
    
    taskService.claim(taskId, userId);
}
```

### 完成任务

```java
/**
 * 完成任务
 */
public void completeTask(String taskId, Map&lt;String, Object&gt; variables) {
    // 验证任务状态
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    if (task == null) {
        throw new RuntimeException("任务不存在");
    }
    
    // 完成任务
    taskService.complete(taskId, variables);
}

/**
 * 审批任务（带业务逻辑）
 */
public void approveTask(String taskId, ApprovalDTO approval) {
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    // 验证审批权限
    String currentUser = SecurityContext.getCurrentUser();
    if (!currentUser.equals(task.getAssignee())) {
        throw new SecurityException("无权审批此任务");
    }
    
    // 验证审批意见
    if (approval.getComment() == null && !approval.isApproved()) {
        throw new RuntimeException("驳回时必须填写意见");
    }
    
    // 设置变量
    Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
    variables.put("approved", approval.isApproved());
    variables.put("approvalComment", approval.getComment());
    variables.put("approvalTime", new Date());
    variables.put("approver", currentUser);
    
    // 完成任务
    taskService.complete(taskId, variables);
}
```

### 委托与转让

```java
/**
 * 委托任务
 */
public void delegateTask(String taskId, String fromUser, String toUser) {
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    // 验证委托人
    if (!fromUser.equals(task.getAssignee())) {
        throw new SecurityException("只有当前处理人可以委托");
    }
    
    // 委托任务
    taskService.delegateTask(taskId, toUser);
}

/**
 * 转让任务
 */
public void transferTask(String taskId, String fromUser, String toUser) {
    Task task = taskService.createTaskQuery()
        .taskId(taskId)
        .singleResult();
    
    // 验证权限
    if (!fromUser.equals(task.getAssignee())) {
        throw new SecurityException("只有当前处理人可以转让");
    }
    
    // 直接设置新的处理人
    taskService.setAssignee(taskId, toUser);
}
```

---

## 任务表单

### 获取表单数据

```java
@Autowired
private FormService formService;

/**
 * 获取任务的表单数据
 */
public Map&lt;String, Object&gt; getTaskFormData(String taskId) {
    TaskFormData formData = formService.getTaskFormData(taskId);
    
    Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
    result.put("taskId", formData.getTaskId());
    result.put("formKey", formData.getFormKey());
    
    List&lt;FormField&gt; fields = formData.getFormFields();
    for (FormField field : fields) {
        Map&lt;String, Object&gt; fieldInfo = new HashMap&lt;&gt;();
        fieldInfo.put("id", field.getId());
        fieldInfo.put("name", field.getLabel());
        fieldInfo.put("type", field.getType());
        fieldInfo.put("required", field.isRequired());
        fieldInfo.put("value", field.getValue());
        
        if (field.getType().equals("enum")) {
            fieldInfo.put("options", field.getType().getInformation("values"));
        }
        
        result.put(field.getId(), fieldInfo);
    }
    
    return result;
}

/**
 * 获取流程启动表单
 */
public Map&lt;String, Object&gt; getStartFormData(String processDefinitionKey) {
    StartFormData startFormData = formService.getStartFormData(processDefinitionKey);
    
    Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
    result.put("processDefinitionKey", processDefinitionKey);
    result.put("formKey", startFormData.getFormKey());
    
    for (FormField field : startFormData.getFormFields()) {
        result.put(field.getId(), field.getValue());
    }
    
    return result;
}
```

### 表单渲染（前端集成）

```java
/**
 * 获取表单定义（JSON格式）
 */
public String getFormJson(String formKey) {
    // 根据 formKey 加载表单定义
    // 这里简化处理，实际应该从数据库或文件系统加载
    return "{" +
        "\"fields\": [" +
        "  {\"id\": \"amount\", \"label\": \"报销金额\", \"type\": \"number\", \"required\": true}," +
        "  {\"id\": \"reason\", \"label\": \"报销原因\", \"type\": \"textarea\", \"required\": true}" +
        "]," +
        "\"layout\": \"vertical" +
    "}";
}
```

---

## REST API

### 常用端点

```bash
# 查询任务
GET /engine-rest/task?assignee=zhangsan

# 查询候选任务
GET /engine-rest/task?candidateUser=zhangsan

# 获取任务详情
GET /engine-rest/task/{id}

# 签收任务
POST /engine-rest/task/{id}/claim
{"userId": "zhangsan"}

# 完成任务
POST /engine-rest/task/{id}/complete
{"variables": {"approved": {"value": true, "type": "Boolean"}}}

# 委托任务
POST /engine-rest/task/{id}/delegate
{"userId": "lisi"}

# 获取表单
GET /engine-rest/task/{id}/form
```

### 完整 REST 服务

```java
@RestController
@RequestMapping("/api/workflow")
public class WorkflowTaskController {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private FormService formService;
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 查询任务列表
     */
    @GetMapping("/tasks")
    public List&lt;TaskVO&gt; getTasks(
            @RequestParam(required = false) String assignee,
            @RequestParam(required = false) String candidateUser,
            @RequestParam(required = false) String processDefinitionKey) {
        
        TaskQuery query = taskService.createTaskQuery();
        
        if (assignee != null) {
            query.taskAssignee(assignee);
        }
        if (candidateUser != null) {
            query.taskCandidateUser(candidateUser);
        }
        if (processDefinitionKey != null) {
            query.processDefinitionKey(processDefinitionKey);
        }
        
        List&lt;Task&gt; tasks = query.active()
            .orderByTaskCreateTime()
            .desc()
            .list();
        
        return tasks.stream()
            .map(this::toTaskVO)
            .collect(Collectors.toList());
    }
    
    /**
     * 获取任务表单
     */
    @GetMapping("/tasks/{taskId}/form")
    public TaskFormVO getTaskForm(@PathVariable String taskId) {
        TaskFormData formData = formService.getTaskFormData(taskId);
        return toTaskFormVO(formData);
    }
    
    /**
     * 完成任务
     */
    @PostMapping("/tasks/{taskId}/complete")
    public void completeTask(
            @PathVariable String taskId,
            @RequestBody Map&lt;String, Object&gt; variables) {
        
        // 转换变量格式
        Map&lt;String, Object&gt; camundaVariables = toCamundaVariables(variables);
        
        taskService.complete(taskId, camundaVariables);
    }
    
    /**
     * 启动流程
     */
    @PostMapping("/process/{processDefinitionKey}/start")
    public ProcessInstanceVO startProcess(
            @PathVariable String processDefinitionKey,
            @RequestBody Map&lt;String, Object&gt; variables) {
        
        Map&lt;String, Object&gt; camundaVariables = toCamundaVariables(variables);
        
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            processDefinitionKey,
            camundaVariables
        );
        
        return toProcessInstanceVO(instance);
    }
    
    // 辅助方法...
}
```

---

## 前端集成示例

### React 任务列表

```jsx
import React, { useState, useEffect } from 'react';

function TaskList({ userId }) {
    const [tasks, setTasks] = useState([]);
    
    useEffect(() => {
        fetchTasks();
    }, [userId]);
    
    const fetchTasks = async () => {
        const response = await fetch(`/api/workflow/tasks?assignee=${userId}`);
        const data = await response.json();
        setTasks(data);
    };
    
    const claimTask = async (taskId) => {
        await fetch(`/api/workflow/tasks/${taskId}/claim`, {
            method: 'POST',
            body: JSON.stringify({ userId })
        });
        fetchTasks();
    };
    
    const completeTask = async (taskId, variables) => {
        await fetch(`/api/workflow/tasks/${taskId}/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ variables })
        });
        fetchTasks();
    };
    
    return (
        <div className="task-list">
            {tasks.map(task => (
                <div key={task.id} className="task-item">
                    <h3>{task.name}</h3>
                    <p>创建时间: {task.createTime}</p>
                    <p>流程: {task.processDefinitionName}</p>
                    <button onClick={() => claimTask(task.id)}>签收</button>
                    <button onClick={() => completeTask(task.id, { approved: true })}>
                        完成
                    </button>
                </div>
            ))}
        </div>
    );
}
```

---

## 总结

| 功能 | API/端点 |
|---|---|
| 查询待办 | `TaskService.createTaskQuery().taskAssignee()` |
| 查询候选 | `TaskService.createTaskQuery().taskCandidateUser()` |
| 签收任务 | `taskService.claim(taskId, userId)` |
| 完成任务 | `taskService.complete(taskId, variables)` |
| 委托任务 | `taskService.delegateTask(taskId, userId)` |
| 获取表单 | `FormService.getTaskFormData(taskId)` |
| 启动流程 | `RuntimeService.startProcessInstanceByKey()` |

---

## 留给你的问题

假设你在实现一个任务处理页面，需要支持：

1. 任务列表分页和筛选
2. 任务详情查看和表单渲染
3. 批量完成任务
4. 任务转交和加急

**问题：**
1. 如何设计前端状态管理来处理复杂的任务交互？
2. 如何处理任务操作的并发问题（如两个人同时点击完成）？
3. 如何实现任务操作的撤销/回退？

这是典型的前后端集成问题，需要仔细设计 API 和交互流程。
