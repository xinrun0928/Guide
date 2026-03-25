# Flowable 与业务系统集成：实战经验总结

把 Flowable 集成到现有业务系统，不是简单地把 JAR 包加进来就完事了。

你需要考虑：
- 流程与业务数据的同步
- 用户和权限的集成
- 异常处理和补偿机制
- 监控和运维

这篇文章总结 Flowable 与业务系统集成的实战经验。

---

## 集成架构

### 典型架构图

```
┌─────────────────────────────────────────────────────────────┐
│                       前端应用层                              │
│   Web 管理后台 ←→ 移动端 ←→ 第三方系统                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                       服务层                                  │
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐                 │
│  │  业务服务        │  │  流程服务        │                 │
│  │  OrderService   │  │  WorkflowService │                │
│  │  ExpenseService │  │  TaskService     │                 │
│  └────────┬────────┘  └────────┬────────┘                 │
│           │                       │                          │
│           │    ┌─────────────────┘                          │
│           │    │                                             │
│           ▼    ▼                                             │
│  ┌─────────────────────────────────────────┐               │
│  │           事务管理层                        │               │
│  │         (保证流程与业务一致性)              │               │
│  └─────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                       Flowable 引擎层                          │
│   ProcessEngine ←→ JobExecutor ←→ HistoryService            │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────┐
│                       数据层                                  │
│   MySQL（业务数据）←→ MySQL（Flowable 数据）                │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心集成模式

### 模式一：BusinessKey 关联

最常用的集成方式，通过 BusinessKey 关联流程实例和业务数据。

```java
/**
 * 业务数据实体
 */
@Data
@Entity
@Table(name = "expense_request")
public class ExpenseRequest {
    
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    
    private String businessKey;  // 关联 Flowable 的 businessKey
    
    private BigDecimal amount;
    
    private String reason;
    
    @Enumerated(EnumType.STRING)
    private ExpenseStatus status;
    
    private String applicantId;
    
    private Date createTime;
    
    private Date updateTime;
}

/**
 * 启动流程并保存业务数据
 */
@Service
public class ExpenseService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private ExpenseRepository expenseRepository;
    
    @Transactional
    public ExpenseRequest submitExpense(ExpenseRequestDTO dto) {
        // 1. 生成业务 Key
        String businessKey = "EXP-" + UUID.randomUUID().toString();
        
        // 2. 保存业务数据
        ExpenseRequest expense = new ExpenseRequest();
        expense.setBusinessKey(businessKey);
        expense.setAmount(dto.getAmount());
        expense.setReason(dto.getReason());
        expense.setStatus(ExpenseStatus.SUBMITTED);
        expense.setApplicantId(dto.getApplicantId());
        expenseRepository.save(expense);
        
        // 3. 启动流程
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("amount", dto.getAmount());
        variables.put("reason", dto.getReason());
        variables.put("businessKey", businessKey);
        
        runtimeService.startProcessInstanceByKey(
            "expenseApproval",
            businessKey,
            variables
        );
        
        return expense;
    }
    
    /**
     * 通过 businessKey 查询流程实例
     */
    public ProcessInstance getProcessInstance(String businessKey) {
        return runtimeService.createProcessInstanceQuery()
            .processInstanceBusinessKey(businessKey)
            .singleResult();
    }
}
```

### 模式二：监听器集成

通过监听器自动同步业务数据。

```java
/**
 * 任务完成监听器：更新业务状态
 */
@Component
public class ExpenseTaskListener implements TaskListener {
    
    @Autowired
    private ExpenseRepository expenseRepository;
    
    @Autowired
    private NotificationService notificationService;
    
    @Override
    public void notify(DelegateTask delegateTask) {
        String eventName = delegateTask.getEventName();
        String taskDefinitionKey = delegateTask.getTaskDefinitionKey();
        
        // 任务完成时处理
        if ("complete".equals(eventName)) {
            String businessKey = (String) delegateTask.getVariable("businessKey");
            Boolean approved = (Boolean) delegateTask.getVariable("approved");
            
            // 更新业务状态
            ExpenseRequest expense = expenseRepository.findByBusinessKey(businessKey);
            if (expense != null) {
                if ("approvalTask".equals(taskDefinitionKey)) {
                    if (approved != null && approved) {
                        expense.setStatus(ExpenseStatus.APPROVED);
                    } else {
                        expense.setStatus(ExpenseStatus.REJECTED);
                    }
                }
                expenseRepository.save(expense);
            }
            
            // 发送通知
            notificationService.notifyApplicant(expense.getApplicantId(), expense.getStatus());
        }
    }
}
```

---

## 用户与权限集成

### 方式一：使用 Flowable 内置身份管理

```java
/**
 * 用户管理服务
 */
@Service
public class FlowableUserService {
    
    @Autowired
    private IdentityService identityService;
    
    /**
     * 创建用户
     */
    public void createUser(UserDTO dto) {
        // 检查是否已存在
        User existing = identityService.createUserQuery()
            .userId(dto.getUserId())
            .singleResult();
        
        if (existing != null) {
            return;
        }
        
        // 创建用户
        User user = identityService.newUser(dto.getUserId());
        user.setFirstName(dto.getFirstName());
        user.setLastName(dto.getLastName());
        user.setEmail(dto.getEmail());
        user.setPassword(dto.getPassword());
        identityService.saveUser(user);
    }
    
    /**
     * 创建组并添加用户
     */
    public void createGroupAndAddUser(String groupId, String groupName, List&lt;String&gt; userIds) {
        // 创建组
        Group group = identityService.newGroup(groupId);
        group.setName(groupName);
        group.setType("assignment");
        identityService.saveGroup(group);
        
        // 添加用户到组
        for (String userId : userIds) {
            identityService.createMembership(userId, groupId);
        }
    }
}
```

### 方式二：集成 LDAP/AD

```yaml
# application.yml
flowable:
  idm:
    enabled: true
    ldap:
      enabled: true
      url: ldap://ldap.company.com:389
      base-dn: dc=company,dc=com
      user-dn-pattern: uid={0},ou=users
      group-search-base: ou=groups
      group-search-filter: (member={0})
      group-name-attribute: cn
      # 管理员配置
      admin-group: cn=flowable-admins,ou=groups
```

### 方式三：自定义权限服务

```java
/**
 * 自定义权限服务
 */
@Service
public class CustomPermissionService {
    
    /**
     * 检查用户是否有权限操作任务
     */
    public boolean hasTaskPermission(String userId, String taskId) {
        // 1. 检查是否是受理人
        Task task = taskService.createTaskQuery()
            .taskId(taskId)
            .singleResult();
        
        if (userId.equals(task.getAssignee())) {
            return true;
        }
        
        // 2. 检查是否是候选人
        List&lt;IdentityLink&gt; links = taskService.getIdentityLinksForTask(taskId);
        for (IdentityLink link : links) {
            if (userId.equals(link.getUserId())) {
                return true;
            }
            if (link.getGroupId() != null && isUserInGroup(userId, link.getGroupId())) {
                return true;
            }
        }
        
        // 3. 检查业务权限（自定义）
        return checkBusinessPermission(userId, task);
    }
}
```

---

## 异常处理与补偿

### 事务一致性处理

```java
/**
 * 审批服务
 */
@Service
public class ApprovalService {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private ExpenseRepository expenseRepository;
    
    @Autowired
    private PaymentService paymentService;
    
    /**
     * 完成审批（带事务）
     */
    @Transactional
    public void completeApproval(String taskId, ApprovalDTO approval) {
        // 1. 获取任务信息
        Task task = taskService.createTaskQuery()
            .taskId(taskId)
            .singleResult();
        
        String businessKey = (String) task.getVariable("businessKey");
        ExpenseRequest expense = expenseRepository.findByBusinessKey(businessKey);
        
        // 2. 更新业务状态
        if (approval.isApproved()) {
            expense.setStatus(ExpenseStatus.APPROVED);
        } else {
            expense.setStatus(ExpenseStatus.REJECTED);
        }
        expenseRepository.save(expense);
        
        // 3. 如果通过且金额大于阈值，自动打款（模拟）
        if (approval.isApproved() && expense.getAmount().compareTo(new BigDecimal("1000")) > 0) {
            paymentService.autoPay(expense);
        }
        
        // 4. 完成任务（放在最后，确保业务操作已完成）
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("approved", approval.isApproved());
        variables.put("comment", approval.getComment());
        taskService.complete(taskId, variables);
    }
}
```

### 补偿机制

```java
/**
 * 补偿服务
 */
@Service
public class CompensationService {
    
    /**
     * 补偿操作示例
     */
    public void compensatePayment(Long expenseId) {
        ExpenseRequest expense = expenseRepository.findById(expenseId);
        
        if ("PAYMENT_COMPLETED".equals(expense.getStatus())) {
            // 撤销支付
            paymentService.refund(expense.getPaymentId());
            
            // 更新状态
            expense.setStatus(ExpenseStatus.PAYMENT_REVERSED);
            expenseRepository.save(expense);
        }
    }
}
```

---

## 监控与运维

### 流程监控服务

```java
/**
 * 流程监控服务
 */
@Service
public class WorkflowMonitorService {
    
    @Autowired
    private RuntimeService runtimeService;
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private HistoryService historyService;
    
    @Autowired
    private ManagementService managementService;
    
    /**
     * 获取监控数据
     */
    public Map&lt;String, Object&gt; getMonitorData() {
        Map&lt;String, Object&gt; data = new HashMap&lt;&gt;();
        
        // 运行中的流程实例
        long runningInstances = runtimeService.createProcessInstanceQuery()
            .active()
            .count();
        data.put("runningInstances", runningInstances);
        
        // 待处理任务
        long pendingTasks = taskService.createTaskQuery()
            .active()
            .count();
        data.put("pendingTasks", pendingTasks);
        
        // 今日完成的任务
        long todayCompletedTasks = historyService.createHistoricTaskInstanceQuery()
            .completedAfter(getTodayStart())
            .count();
        data.put("todayCompletedTasks", todayCompletedTasks);
        
        // 失败的作业
        long failedJobs = managementService.createJobQuery()
            .withException()
            .count();
        data.put("failedJobs", failedJobs);
        
        return data;
    }
    
    /**
     * 获取超时任务
     */
    public List&lt;Task&gt; getOverdueTasks() {
        return taskService.createTaskQuery()
            .active()
            .dueBefore(new Date())
            .list();
    }
    
    /**
     * 获取卡住的流程实例
     */
    public List&lt;ProcessInstance&gt; getStuckProcesses() {
        return runtimeService.createProcessInstanceQuery()
            .active()
            .list()
            .stream()
            .filter(instance -> isStuck(instance))
            .collect(Collectors.toList());
    }
}
```

### 告警通知

```java
/**
 * 监控告警服务
 */
@Service
public class AlertService {
    
    @Autowired
    private WorkflowMonitorService monitorService;
    
    @Autowired
    private AlertNotifier alertNotifier;
    
    /**
     * 检查并发送告警
     */
    @Scheduled(fixedDelay = 60000) // 每分钟检查一次
    public void checkAndAlert() {
        // 检查超时任务
        List&lt;Task&gt; overdueTasks = monitorService.getOverdueTasks();
        if (!overdueTasks.isEmpty()) {
            alertNotifier.alert(
                AlertType.TASK_OVERDUE,
                String.format("有 %d 个任务已超时", overdueTasks.size())
            );
        }
        
        // 检查卡住的流程
        List&lt;ProcessInstance&gt; stuckProcesses = monitorService.getStuckProcesses();
        if (!stuckProcesses.isEmpty()) {
            alertNotifier.alert(
                AlertType.PROCESS_STUCK,
                String.format("有 %d 个流程实例卡住", stuckProcesses.size())
            );
        }
        
        // 检查失败的作业
        long failedJobs = monitorService.getFailedJobs();
        if (failedJobs > 10) {
            alertNotifier.alert(
                AlertType.JOB_FAILED,
                String.format("有 %d 个作业执行失败", failedJobs)
            );
        }
    }
}
```

---

## 总结

| 集成模式 | 适用场景 |
|---|---|
| BusinessKey 关联 | 通用场景，流程与业务数据一一对应 |
| 监听器同步 | 需要自动更新业务状态的场景 |
| 事务一致性 | 需要保证流程与业务操作原子性的场景 |
| LDAP/AD 集成 | 企业内部系统，统一身份认证 |
| 自定义权限 | 需要细粒度权限控制的场景 |

---

## 留给你的问题

假设你在集成 Flowable 时遇到以下问题：

1. **事务边界**：流程操作和业务操作在同一个事务中，但业务操作失败后，流程已经启动的部分怎么处理？
2. **数据一致性**：流程状态和业务状态可能出现不一致，如何处理？
3. **并发控制**：两个人同时处理同一个任务，如何保证不会重复处理？

这些都是生产环境中会遇到的实际问题，值得深入思考和设计。
