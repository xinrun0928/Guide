# Flowable 高级特性：候选用户、组任务、权限控制

你有没有遇到过这种情况：OA 系统里，一个审批任务需要「经理组」的所有人来处理。

张三、李四、王五都是经理组的成员，他们都应该能看到这个任务。但问题是——谁审批了，其他人还需要审批吗？或者说，只有组内某个人审批通过就行了？

这就是**候选用户**和**组任务**要解决的问题。

---

## 用户与组的基础概念

### Flowable 的身份管理

Flowable 有自己的身份管理模块，主要涉及以下实体：

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   用户（User）                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  ID: user001                                             │   │
│   │  Name: 张三                                              │   │
│   │  Email: zhangsan@company.com                            │   │
│   │  Groups: [manager, approval_group]                       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   组（Group）                                                   │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  ID: manager                                            │   │
│   │  Name: 经理组                                            │   │
│   │  Type: assignment                                       │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   关联关系（Membership）                                        │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  User: zhangsan  ─── belongs to ───  Group: manager      │   │
│   │  User: lisi      ─── belongs to ───  Group: manager      │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 用户与组的管理

```java
/**
 * 用户和组的管理
 */
@Service
public class IdentityManagementService {
    
    @Autowired
    private IdentityService identityService;
    
    /**
     * 创建用户
     */
    public void createUser(String userId, String firstName, String lastName, String email) {
        // 检查是否已存在
        if (identityService.createUserQuery().userId(userId).count() &gt; 0) {
            return;
        }
        
        User user = identityService.newUser(userId);
        user.setFirstName(firstName);
        user.setLastName(lastName);
        user.setEmail(email);
        user.setPassword("defaultPassword");  // 生产环境应该加密
        
        identityService.saveUser(user);
    }
    
    /**
     * 创建组
     */
    public void createGroup(String groupId, String name, String type) {
        // type: security-role, assignment, workflow-role
        Group group = identityService.newGroup(groupId);
        group.setName(name);
        group.setType(type);
        
        identityService.saveGroup(group);
    }
    
    /**
     * 用户加入组
     */
    public void addUserToGroup(String userId, String groupId) {
        identityService.createMembership(userId, groupId);
    }
    
    /**
     * 查询用户所在组
     */
    public List&lt;Group&gt; getGroupsForUser(String userId) {
        return identityService.createGroupQuery()
            .groupMember(userId)
            .list();
    }
    
    /**
     * 查询组内所有用户
     */
    public List&lt;User&gt; getUsersInGroup(String groupId) {
        return identityService.createUserQuery()
            .memberOfGroup(groupId)
            .list();
    }
}
```

---

## 候选用户与候选组

### 概念区分

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   候选用户（Candidate User）                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  任务 ← 候选用户列表                                      │   │
│   │  zhangsan ✓（已签收）                                    │   │
│   │  lisi（可以看到，但还没签收）                             │   │
│   │  wangwu（可以看到，但还没签收）                           │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│   候选组（Candidate Group）                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  任务 ← 候选组列表                                        │   │
│   │  manager（组）→ 包含: zhangsan, lisi, wangwu            │   │
│   │  director（组）→ 包含: boss                              │   │
│   └─────────────────────────────────────────────────────────┘   │
│   组内成员可以查看到任务，签收后成为处理人                         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### BPMN 配置

```xml
<!-- 候选用户配置 -->
<userTask id="approvalTask1" name="经理审批">
    <potentialOwner>
        <resourceAssignmentExpression>
            <!-- 指定候选用户 -->
            <formalExpression>user(zhangsan), user(lisi), user(wangwu)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
</userTask>

<!-- 候选组配置 -->
<userTask id="approvalTask2" name="主管审批">
    <potentialOwner>
        <resourceAssignmentExpression>
            <!-- 指定候选组 -->
            <formalExpression>group(manager), group(director)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
</userTask>

<!-- 也可以两者结合 -->
<userTask id="approvalTask3" name="综合审批">
    <potentialOwner>
        <resourceAssignmentExpression>
            <formalExpression>user(admin), group(manager)</formalExpression>
        </resourceAssignmentExpression>
    </potentialOwner>
</userTask>
```

### 动态设置候选用户/组

```java
/**
 * 动态设置候选用户和候选组
 */
@Service
public class DynamicCandidateService {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private RuntimeService runtimeService;
    
    /**
     * 在流程启动时动态设置候选人
     */
    public ProcessInstance startWithCandidates(String processKey, 
                                                List&lt;String&gt; candidateUsers,
                                                List&lt;String&gt; candidateGroups) {
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("candidateUsers", candidateUsers);
        variables.put("candidateGroups", candidateGroups);
        
        ProcessInstance instance = runtimeService.startProcessInstanceByKey(
            processKey, variables);
        
        return instance;
    }
    
    /**
     * 在任务监听器中设置候选用户
     */
    public class DynamicCandidateListener implements TaskListener {
        
        @Override
        public void notify(DelegateTask delegateTask) {
            String taskName = delegateTask.getName();
            
            // 根据任务名称设置不同的候选人
            if ("技术评审".equals(taskName)) {
                // 技术评审由技术委员会处理
                delegateTask.addCandidateGroup("techCommittee");
                delegateTask.addCandidateUser("techLead");
                
            } else if ("财务审批".equals(taskName)) {
                // 财务审批由财务部处理
                delegateTask.addCandidateGroup("finance");
                
                // 大额金额需要 CFO 审批
                Integer amount = (Integer) delegateTask.getVariable("amount");
                if (amount != null && amount &gt; 100000) {
                    delegateTask.addCandidateUser("cfo");
                }
            }
        }
    }
    
    /**
     * 运行时添加候选人
     */
    public void addCandidates(String taskId, 
                               List&lt;String&gt; users, 
                               List&lt;String&gt; groups) {
        Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
        
        // 添加候选用户
        for (String user : users) {
            taskService.addCandidateUser(taskId, user);
        }
        
        // 添加候选组
        for (String group : groups) {
            taskService.addCandidateGroup(taskId, group);
        }
    }
    
    /**
     * 删除候选人
     */
    public void removeCandidates(String taskId, String userId) {
        taskService.deleteCandidateUser(taskId, userId);
    }
}
```

---

## 查询候选任务

### 基础查询

```java
/**
 * 候选任务的查询
 */
@Service
public class CandidateTaskQueryService {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private IdentityService identityService;
    
    /**
     * 查询用户的所有待办任务（包括候选任务和已签收任务）
     */
    public List&lt;Task&gt; getAllTasksForUser(String userId) {
        // 1. 获取用户所在的所有组
        List&lt;Group&gt; groups = identityService.createGroupQuery()
            .groupMember(userId)
            .list();
        
        List&lt;String&gt; groupIds = groups.stream()
            .map(Group::getId)
            .collect(Collectors.toList());
        
        // 2. 构建查询：候选人 或 候选组 或 已签收
        TaskQuery query = taskService.createTaskQuery();
        
        // 候选用户 + 候选组 + 已签收
        if (groupIds.isEmpty()) {
            return query.taskCandidateOrAssigned(userId).list();
        } else {
            return query.taskCandidateOrAssigned(userId, groupIds).list();
        }
    }
    
    /**
     * 只查询候选任务（未签收的）
     */
    public List&lt;Task&gt; getCandidateTasks(String userId) {
        // 候选用户查询
        List&lt;Task&gt; candidateUserTasks = taskService.createTaskQuery()
            .taskCandidateUser(userId)
            .list();
        
        // 候选组查询
        List&lt;Group&gt; groups = identityService.createGroupQuery()
            .groupMember(userId)
            .list();
        
        List&lt;Task&gt; candidateGroupTasks = new ArrayList&lt;&gt;();
        for (Group group : groups) {
            List&lt;Task&gt; tasks = taskService.createTaskQuery()
                .taskCandidateGroup(group.getId())
                .list();
            candidateGroupTasks.addAll(tasks);
        }
        
        // 合并去重
        Set&lt;String&gt; taskIds = new HashSet&lt;&gt;();
        List&lt;Task&gt; result = new ArrayList&lt;&gt;();
        for (Task task : candidateUserTasks) {
            if (taskIds.add(task.getId())) {
                result.add(task);
            }
        }
        for (Task task : candidateGroupTasks) {
            if (taskIds.add(task.getId())) {
                result.add(task);
            }
        }
        
        return result;
    }
    
    /**
     * 查询组的所有任务
     */
    public List&lt;Task&gt; getTasksByGroup(String groupId) {
        return taskService.createTaskQuery()
            .taskCandidateGroup(groupId)
            .list();
    }
    
    /**
     * 查询某个用户作为候选人的所有任务
     */
    public List&lt;Task&gt; getTasksWhereUserIsCandidate(String userId) {
        return taskService.createTaskQuery()
            .taskCandidateUser(userId)
            .list();
    }
}
```

### 候选任务的 SQL 对应

```sql
-- 查询候选用户
SELECT * FROM ACT_RU_TASK 
WHERE ASSIGNEE_ IS NULL 
  AND ID_ IN (
      SELECT TASK_ID_ FROM ACT_RU_IDENTITYLINK 
      WHERE USER_ID_ = 'zhangsan' AND TYPE_ = 'candidate'
  );

-- 查询候选组
SELECT * FROM ACT_RU_TASK 
WHERE ASSIGNEE_ IS NULL 
  AND ID_ IN (
      SELECT TASK_ID_ FROM ACT_RU_IDENTITYLINK 
      WHERE GROUP_ID_ IN (
          SELECT GROUP_ID_ FROM ACT_ID_MEMBERSHIP 
          WHERE USER_ID_ = 'zhangsan'
      ) AND TYPE_ = 'candidate'
  );
```

---

## 权限控制

### 任务操作的权限规则

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   任务操作权限矩阵                                                │
│                                                                 │
│   操作              候选人     处理人     委托人     管理员      │
│   ─────────────────────────────────────────────────────────────  │
│   查看任务           ✓          ✓          ✓          ✓         │
│   签收任务           ✓                      ✓          ✓         │
│   完成任务           ✓          ✓                      ✓         │
│   转让任务                      ✓                                  │
│   委托任务                      ✓                                  │
│   驳回任务                      ✓                      ✓         │
│   转派任务                      ✓          ✓          ✓         │
│   添加候选人                               ✓          ✓         │
│   删除候选人                               ✓          ✓         │
│   删除任务                                 ✓          ✓         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 权限控制实现

```java
/**
 * 任务权限控制服务
 */
@Service
public class TaskPermissionService {
    
    @Autowired
    private TaskService taskService;
    
    @Autowired
    private IdentityService identityService;
    
    /**
     * 检查用户是否有权限操作任务
     */
    public boolean hasPermission(String userId, String taskId, TaskAction action) {
        Task task = taskService.createTaskQuery().taskId(taskId).singleResult();
        
        if (task == null) {
            return false;
        }
        
        switch (action) {
            case CLAIM:      // 签收
                return canClaim(userId, task);
                
            case COMPLETE:   // 完成
                return canComplete(userId, task);
                
            case DELEGATE:   // 委托
                return canDelegate(userId, task);
                
            case REASSIGN:   // 转派
                return canReassign(userId, task);
                
            case DELETE:     // 删除
                return isAdmin(userId);
                
            default:
                return false;
        }
    }
    
    /**
     * 是否有权限签收任务
     */
    private boolean canClaim(String userId, Task task) {
        // 任务还没有被签收
        if (task.getAssignee() != null) {
            return false;
        }
        
        // 检查是否是候选用户
        List&lt;IdentityLink&gt; candidates = taskService.getIdentityLinksForTask(task.getId());
        for (IdentityLink link : candidates) {
            if ("candidate".equals(link.getType())) {
                if (userId.equals(link.getUserId())) {
                    return true;
                }
                if (link.getGroupId() != null && isUserInGroup(userId, link.getGroupId())) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * 是否有权限完成任务
     */
    private boolean canComplete(String userId, Task task) {
        // 处理人可以完成
        if (userId.equals(task.getAssignee())) {
            return true;
        }
        
        // 候选用户也可以完成（无需签收）
        return canClaim(userId, task);
    }
    
    /**
     * 是否有权限委托任务
     */
    private boolean canDelegate(String userId, Task task) {
        // 只有处理人可以委托
        return userId.equals(task.getAssignee());
    }
    
    /**
     * 是否有权限转派任务（给其他人）
     */
    private boolean canReassign(String userId, Task task) {
        // 处理人或管理员可以转派
        return userId.equals(task.getAssignee()) || isAdmin(userId);
    }
    
    /**
     * 检查用户是否在某个组
     */
    private boolean isUserInGroup(String userId, String groupId) {
        return identityService.createGroupQuery()
            .groupMember(userId)
            .groupId(groupId)
            .count() &gt; 0;
    }
    
    /**
     * 检查是否是管理员
     */
    private boolean isAdmin(String userId) {
        List&lt;Group&gt; groups = identityService.createGroupQuery()
            .groupMember(userId)
            .list();
        
        return groups.stream()
            .anyMatch(g -> "admin".equals(g.getId()));
    }
    
    public enum TaskAction {
        CLAIM, COMPLETE, DELEGATE, REASSIGN, DELETE
    }
}
```

### 任务操作的权限拦截

```java
/**
 * 任务操作的权限拦截器
 */
@Component
public class TaskPermissionInterceptor {
    
    @Autowired
    private TaskPermissionService permissionService;
    
    @Autowired
    private TaskService taskService;
    
    /**
     * 签收任务前的权限校验
     */
    public void claimWithPermissionCheck(String taskId, String userId) {
        if (!permissionService.hasPermission(userId, taskId, 
                TaskPermissionService.TaskAction.CLAIM)) {
            throw new PermissionDeniedException("您没有权限签收此任务");
        }
        
        taskService.claim(taskId, userId);
    }
    
    /**
     * 完成任务前的权限校验
     */
    public void completeWithPermissionCheck(String taskId, String userId,
                                             Map&lt;String, Object&gt; variables) {
        if (!permissionService.hasPermission(userId, taskId, 
                TaskPermissionService.TaskAction.COMPLETE)) {
            throw new PermissionDeniedException("您没有权限完成此任务");
        }
        
        taskService.complete(taskId, variables);
    }
    
    /**
     * 委托任务
     */
    public void delegateWithPermissionCheck(String taskId, String userId,
                                             String delegateeId) {
        if (!permissionService.hasPermission(userId, taskId, 
                TaskPermissionService.TaskAction.DELEGATE)) {
            throw new PermissionDeniedException("您没有权限委托此任务");
        }
        
        // 校验委托对象是否存在
        User delegatee = identityService.createUserQuery()
            .userId(delegateeId)
            .singleResult();
        
        if (delegatee == null) {
            throw new IllegalArgumentException("委托对象不存在: " + delegateeId);
        }
        
        taskService.delegateTask(taskId, delegateeId);
    }
}
```

---

## 任务代理与委派的高级场景

### 会签中的委托

```java
/**
 * 会签场景中的任务委托
 */
public class MultiInstanceDelegation {
    
    /**
     * 会签中某个人委托给其他人
     * 注意：委托不会改变会签的计数
     */
    @Test
    public void delegateInMultiInstance() {
        // 假设会签任务列表中有一个任务
        Task task = taskService.createTaskQuery()
            .taskCandidateUser("userA")
            .taskDefinitionKey("multiApproval")
            .singleResult();
        
        // userA 委托给 userB
        taskService.delegateTask(task.getId(), "userB");
        
        // userB 完成
        Map&lt;String, Object&gt; variables = new HashMap&lt;&gt;();
        variables.put("approved", true);
        taskService.complete(task.getId(), variables);
        
        // 会签计数 +1，最终审批结果是 userB 的意见
    }
}
```

### 委托链追踪

```java
/**
 * 追踪任务的委托历史
 */
public class DelegationHistoryTracker {
    
    /**
     * 获取任务的委托历史
     */
    public List&lt;DelegationRecord&gt; getDelegationHistory(String taskId) {
        List&lt;DelegationRecord&gt; history = new ArrayList&lt;&gt;();
        
        // 从任务历史中获取委托记录
        HistoricTaskInstance historicTask = historyService
            .createHistoricTaskInstanceQuery()
            .taskId(taskId)
            .singleResult();
        
        // 检查原始处理人
        String originalAssignee = historicTask.getOwner();
        
        // 任务当前的 assignee
        Task currentTask = taskService.createTaskQuery()
            .taskId(taskId)
            .singleResult();
        
        // 如果有转让记录
        List&lt;HistoricIdentityLink&gt; links = historyService
            .getHistoricIdentityLinksForTask(taskId);
        
        for (HistoricIdentityLink link : links) {
            if ("assignee".equals(link.getType())) {
                DelegationRecord record = new DelegationRecord();
                record.setFromUser(historicTask.getOwner());
                record.setToUser(link.getUserId());
                record.setDelegationTime(historicTask.getCreateTime());
                history.add(record);
            }
        }
        
        return history;
    }
}
```

---

## 总结：用户与权限速查

| 功能 | API | 说明 |
|---|---|---|
| 设置候选人 | `addCandidateUser()` | 添加候选用户 |
| 设置候选组 | `addCandidateGroup()` | 添加候选组 |
| 移除候选人 | `deleteCandidateUser()` | 移除候选用户 |
| 查询候选任务 | `taskCandidateUser()` | 查询候选用户任务 |
| 查询组任务 | `taskCandidateGroup()` | 查询候选组任务 |
| 查询待办 | `taskAssignee()` | 查询已签收任务 |
| 查询所有 | `taskCandidateOrAssigned()` | 查询所有可处理任务 |

---

## 留给你的问题

假设你在设计一个 OA 审批系统，有以下场景：

1. **会签审批**：一个项目需要技术负责人、产品负责人、财务负责人三个人都「同意」才算通过
2. **竞争签收**：多个候选人都能看到任务，谁先签收谁处理
3. **组内轮流**：同一个任务，组内成员按顺序轮流处理
4. **代理审批**：经理 A 出差了，委托给 B 处理，B 处理完后 A 需要知道

**问题来了：**

1. 会签场景中，如果有人拒绝，流程应该立即终止还是继续等其他人的意见？
2. 竞争签收场景中，两个人同时签收同一个任务，会发生什么？需要加锁吗？
3. 如果 A 委托给 B，B 又委托给 C，最后谁完成任务时，任务会回到谁手里？

这三个问题涉及到**并发控制**、**委托语义**和**业务规则设计**，是审批系统开发的核心挑战。
