# Flowable 数据库表结构与核心表说明

你有没有过这种感觉：Flowable 跑起来了，流程也能跑了，但数据库里那一堆表是什么鬼？

ACT_RE_*, ACT_RU_*, ACT_HI_*……每次看到这些表都一脸懵。

这篇文章帮你把 Flowable 的数据库表结构彻底搞清楚。理解了表结构，你就能：
- 排查流程执行的问题
- 优化查询性能
- 进行数据统计分析
- 实现自定义的业务需求

---

## 表前缀说明

Flowable 的表名都以特定前缀开头：

| 前缀 | 说明 | 示例 |
|---|---|---|
| `ACT_RE_*` | Repository，流程定义相关 | ACT_RE_DEPLOYMENT, ACT_RE_PROCDEF |
| `ACT_RU_*` | Runtime，运行时数据 | ACT_RU_EXECUTION, ACT_RU_TASK |
| `ACT_HI_*` | History，历史数据 | ACT_HI_PROCINST, ACT_HI_TASKINST |
| `ACT_GE_*` | General，通用数据 | ACT_GE_BYTEARRAY, ACT_GE_PROPERTY |
| `ACT_ID_*` | Identity，身份管理 | ACT_ID_USER, ACT_ID_GROUP |

**为什么这样设计？**

这是 Flowable（借鉴了 Activiti）的命名规范。前缀清晰地表明了表的用途，加上 `_` 后面的具体名称，你就能大概猜出表的作用。

---

## 流程定义表（ACT_RE_*）

### ACT_RE_DEPLOYMENT：部署信息

存储流程部署的基本信息：

```sql
CREATE TABLE ACT_RE_DEPLOYMENT (
    ID_ VARCHAR(64) NOT NULL,
    NAME_ VARCHAR(255),
    CATEGORY_ VARCHAR(255),
    KEY_ VARCHAR(255),
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    DEPLOY_TIME_ TIMESTAMP,
    LAST_SYNC_TIME_ TIMESTAMP,
    VERSION_ INT,
    PROJECT_RELEASE_VERSION_ VARCHAR(64),
    ...
);
```

| 字段 | 说明 |
|---|---|
| ID_ | 部署ID，UUID |
| NAME_ | 部署名称 |
| CATEGORY_ | 分类 |
| KEY_ | 流程定义的 Key |
| TENANT_ID_ | 租户ID（多租户支持） |
| DEPLOY_TIME_ | 部署时间 |
| VERSION_ | 部署版本 |

### ACT_RE_PROCDEF：流程定义

存储流程定义信息：

```sql
CREATE TABLE ACT_RE_PROCDEF (
    ID_ VARCHAR(64) NOT NULL,          -- 格式: key:version
    CATEGORY_ VARCHAR(255),
    NAME_ VARCHAR(255),
    KEY_ VARCHAR(255) NOT NULL,
    VERSION_ INT NOT NULL,
    DEPLOYMENT_ID_ VARCHAR(64),
    RESOURCE_NAME_ VARCHAR(255),       -- BPMN 文件名
    DGRM_RESOURCE_NAME_ VARCHAR(255), -- 流程图文件名
    DESCRIPTION_ VARCHAR(255),
    HAS_START_FORM_KEY_ SMALLINT,
    HAS_GRAPHIC_NOTATION_ SMALLINT,
    SUSPENSION_STATE_ INT,
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    ...
);
```

```java
/**
 * 查看流程定义
 */
@Test
public void queryProcessDefinition() {
    ProcessDefinitionQuery query = repositoryService.createProcessDefinitionQuery();
    
    // 查询已部署的流程定义
    List&lt;ProcessDefinition&gt; definitions = query.list();
    
    for (ProcessDefinition def : definitions) {
        System.out.println(String.format(
            "Key: %s, Version: %d, Name: %s, DeploymentId: %s",
            def.getKey(),
            def.getVersion(),
            def.getName(),
            def.getDeploymentId()
        ));
    }
    
    // 获取最新版本
    ProcessDefinition latest = query.processDefinitionKey("expense")
        .latestVersion()
        .singleResult();
}
```

---

## 运行时数据表（ACT_RU_*）

### ACT_RU_EXECUTION：执行实例

存储当前正在执行的流程实例和执行线：

```sql
CREATE TABLE ACT_RU_EXECUTION (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    PROC_INST_ID_ VARCHAR(64),        -- 所属流程实例ID
    BUSINESS_KEY_ VARCHAR(255),
    PARENT_ID_ VARCHAR(64),            -- 父执行ID（并行分支）
    PROC_DEF_ID_ VARCHAR(64),
    SUPER_EXEC_ VARCHAR(64),           -- 调用活动时的父执行
    ROOT_PROC_INST_ID_ VARCHAR(64),   -- 根流程实例（子流程场景）
    ACT_ID_ VARCHAR(255),              -- 当前节点ID
    IS_ACTIVE_ SMALLINT,
    IS_CONCURRENT_ SMALLINT,          -- 是否并行分支
    IS_SCOPE_ SMALLINT,
    IS_EVENT_SCOPE_ SMALLINT,
    PRIORITY_ INT,
    CREATE_TIME_ TIMESTAMP,
    LAST_UPDATED_TIME_ TIMESTAMP,
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    ...
);
```

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ACT_RU_EXECUTION 数据示例：                                   │
│                                                                 │
│   ID_          PROC_INST_ID_  PARENT_ID_  ACT_ID_    IS_CONCURRENT │
│   ──────────────────────────────────────────────────────────────  │
│   exec-001     exec-001       NULL        startEvent   0         │
│   exec-002     exec-001       exec-001    userTask1    0         │
│   exec-003     exec-001       exec-002    parallelGW   0         │
│   exec-004     exec-001       exec-003    taskA        1  ← 并行  │
│   exec-005     exec-001       exec-003    taskB        1  ← 并行  │
│                                                                 │
│   并行网关后，创建两个执行线，分别执行 taskA 和 taskB              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### ACT_RU_TASK：当前任务

存储当前等待处理的任务：

```sql
CREATE TABLE ACT_RU_TASK (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    EXECUTION_ID_ VARCHAR(64),         -- 所属执行
    PROC_INST_ID_ VARCHAR(64),         -- 所属流程实例
    PROC_DEF_ID_ VARCHAR(64),
    NAME_ VARCHAR(255),
    PARENT_TASK_ID_ VARCHAR(64),       -- 父任务ID（子任务场景）
    DESCRIPTION_ VARCHAR(255),
    TASK_DEF_KEY_ VARCHAR(255),
    OWNER_ VARCHAR(255),               -- 委托人
    ASSIGNEE_ VARCHAR(255),            -- 处理人
    DELEGATION_ VARCHAR(64),           -- 委托状态
    PRIORITY_ INT,
    CREATE_TIME_ TIMESTAMP,
    LAST_UPDATED_TIME_ TIMESTAMP,
    DUE_DATE_ TIMESTAMP,
    CATEGORY_ VARCHAR(255),
    SUSPENSION_STATE_ INT,
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    ...
);
```

### ACT_RU_VARIABLE：运行时变量

存储流程执行中的变量：

```sql
CREATE TABLE ACT_RU_VARIABLE (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    TYPE_ VARCHAR(255),                -- 变量类型
    NAME_ VARCHAR(255),
    EXECUTION_ID_ VARCHAR(64),
    PROC_INST_ID_ VARCHAR(64),
    TASK_ID_ VARCHAR(64),             -- 关联任务ID（本地变量）
    BYTEARRAY_ID_ VARCHAR(64),        -- 大对象存储
    DOUBLE_ DOUBLE,
    LONG_ BIGINT,
    TEXT_ VARCHAR(4000),              -- 文本值
    TEXT2_ VARCHAR(4000),
    CREATE_TIME_ TIMESTAMP,
    LAST_UPDATED_TIME_ TIMESTAMP,
    ...
);
```

### ACT_RU_IDENTITYLINK：身份关联

存储任务与用户/组的关联关系：

```sql
CREATE TABLE ACT_RU_IDENTITYLINK (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    GROUP_ID_ VARCHAR(255),
    TYPE_ VARCHAR(255),                -- 类型: candidate, assignee, owner, starter
    USER_ID_ VARCHAR(255),
    TASK_ID_ VARCHAR(64),
    PROC_INST_ID_ VARCHAR(64),
    PROC_DEF_ID_ VARCHAR(64),
    SCOPE_ID_ VARCHAR(255),
    SCOPE_TYPE_ VARCHAR(255),
    ...
);
```

---

## 历史数据表（ACT_HI_*）

### ACT_HI_PROCINST：流程实例历史

存储已结束流程实例的信息：

```sql
CREATE TABLE ACT_HI_PROCINST (
    ID_ VARCHAR(64) NOT NULL,
    PROC_INST_ID_ VARCHAR(64),
    BUSINESS_KEY_ VARCHAR(255),
    PROC_DEF_ID_ VARCHAR(64),
    START_TIME_ TIMESTAMP,
    END_TIME_ TIMESTAMP,
    DURATION_ BIGINT,                  -- 持续时间（毫秒）
    START_USER_ID_ VARCHAR(255),
    START_ACT_ID_ VARCHAR(255),
    END_ACT_ID_ VARCHAR(255),
    DELETE_REASON_ VARCHAR(4000),
    SUPER_PROCESS_INSTANCE_ID_ VARCHAR(64),
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    NAME_ VARCHAR(255),
    ...
);
```

```java
/**
 * 查询历史流程实例
 */
@Test
public void queryHistoricProcessInstances() {
    HistoricProcessInstanceQuery query = historyService
        .createHistoricProcessInstanceQuery();
    
    // 查询已完成的流程
    List&lt;HistoricProcessInstance&gt; completed = query
        .finished()
        .list();
    
    // 查询某时间段内的流程
    List&lt;HistoricProcessInstance&gt; inRange = query
        .startedAfter(startDate)
        .startedBefore(endDate)
        .list();
    
    // 统计平均耗时
    long totalDuration = 0;
    for (HistoricProcessInstance inst : completed) {
        totalDuration += inst.getDurationInMillis();
    }
    long avgDuration = completed.isEmpty() ? 0 : totalDuration / completed.size();
    
    System.out.println("平均耗时: " + (avgDuration / 1000 / 60) + " 分钟");
}
```

### ACT_HI_TASKINST：任务历史

存储已完成任务的信息：

```sql
CREATE TABLE ACT_HI_TASKINST (
    ID_ VARCHAR(64) NOT NULL,
    PROC_DEF_ID_ VARCHAR(64),
    PROC_INST_ID_ VARCHAR(64),
    EXECUTION_ID_ VARCHAR(64),
    NAME_ VARCHAR(255),
    PARENT_TASK_ID_ VARCHAR(64),
    DESCRIPTION_ VARCHAR(4000),
    OWNER_ VARCHAR(255),
    ASSIGNEE_ VARCHAR(255),
    START_TIME_ TIMESTAMP,
    END_TIME_ TIMESTAMP,
    DURATION_ BIGINT,
    DELETE_REASON_ VARCHAR(4000),
    TASK_DEF_KEY_ VARCHAR(255),
    FORM_KEY_ VARCHAR(255),
    PRIORITY_ INT,
    DUE_DATE_ TIMESTAMP,
    RUNTIME_TIMEOUT_ BIGINT,
    ...
);
```

### ACT_HI_ACTINST：活动实例历史

记录每个活动（节点）的执行历史：

```sql
CREATE TABLE ACT_HI_ACTINST (
    ID_ VARCHAR(64) NOT NULL,
    PROC_DEF_ID_ VARCHAR(64),
    PROC_INST_ID_ VARCHAR(64),
    EXECUTION_ID_ VARCHAR(64),
    ACT_ID_ VARCHAR(255),              -- 活动节点ID
    ACT_NAME_ VARCHAR(255),
    ACT_TYPE_ VARCHAR(255),            -- 活动类型: startEvent, userTask, serviceTask...
    ASSIGNEE_ VARCHAR(255),
    START_TIME_ TIMESTAMP,
    END_TIME_ TIMESTAMP,
    DURATION_ BIGINT,
    DELETE_REASON_ VARCHAR(4000),
    TENANT_ID_ VARCHAR(255) DEFAULT '',
    ...
);
```

### ACT_HI_VARINST：变量历史

```sql
CREATE TABLE ACT_HI_VARINST (
    ID_ VARCHAR(64) NOT NULL,
    PROC_DEF_ID_ VARCHAR(64),
    PROC_INST_ID_ VARCHAR(64),
    EXECUTION_ID_ VARCHAR(64),
    TASK_ID_ VARCHAR(64),
    NAME_ VARCHAR(255),
    VAR_TYPE_ VARCHAR(255),
    REV_ INT,
    BYTEARRAY_ID_ VARCHAR(64),
    DOUBLE_ DOUBLE,
    LONG_ BIGINT,
    TEXT_ VARCHAR(4000),
    TEXT2_ VARCHAR(4000),
    CREATE_TIME_ TIMESTAMP,
    LAST_UPDATED_TIME_ TIMESTAMP,
    ...
);
```

### ACT_HI_DETAIL：明细历史

记录变量变更的详细历史：

```sql
CREATE TABLE ACT_HI_DETAIL (
    ID_ VARCHAR(64) NOT NULL,
    TYPE_ VARCHAR(255),                -- FormProperty, VariableUpdate
    PROC_INST_ID_ VARCHAR(64),
    EXECUTION_ID_ VARCHAR(64),
    TASK_ID_ VARCHAR(64),
    ACT_INST_ID_ VARCHAR(64),
    NAME_ VARCHAR(255),
    VAR_TYPE_ VARCHAR(255),
    REV_ INT,
    TIME_ TIMESTAMP,
    BYTEARRAY_ID_ VARCHAR(64),
    DOUBLE_ DOUBLE,
    LONG_ BIGINT,
    TEXT_ VARCHAR(4000),
    TEXT2_ VARCHAR(4000),
    ...
);
```

---

## 通用数据表（ACT_GE_*）

### ACT_GE_BYTEARRAY：二进制数据

存储 BPMN XML 和流程图等二进制数据：

```sql
CREATE TABLE ACT_GE_BYTEARRAY (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    NAME_ VARCHAR(255),
    DEPLOYMENT_ID_ VARCHAR(64),
    BYTES_ LONGBLOB,
    GENERATED_ SMALLINT,
    ...
);
```

### ACT_GE_PROPERTY：属性配置

存储 Flowable 的配置信息：

```sql
CREATE TABLE ACT_GE_PROPERTY (
    NAME_ VARCHAR(64) NOT NULL,
    VALUE_ VARCHAR(4000),
    REV_ INT,
    ...
);
```

---

## 身份管理表（ACT_ID_*）

### 主要表结构

```sql
-- 用户表
CREATE TABLE ACT_ID_USER (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    FIRST_ VARCHAR(255),
    LAST_ VARCHAR(255),
    EMAIL_ VARCHAR(255),
    PWD_ VARCHAR(255),
    PICTURE_ID_ VARCHAR(64),
    ...
);

-- 组表
CREATE TABLE ACT_ID_GROUP (
    ID_ VARCHAR(64) NOT NULL,
    REV_ INT,
    NAME_ VARCHAR(255),
    TYPE_ VARCHAR(255),
    ...
);

-- 用户-组关联表
CREATE TABLE ACT_ID_MEMBERSHIP (
    USER_ID_ VARCHAR(64),
    GROUP_ID_ VARCHAR(64),
    ...
);
```

---

## 表关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   流程定义相关（ACT_RE_*）                                       │
│   ┌──────────────────┐    ┌──────────────────┐                │
│   │ACT_RE_DEPLOYMENT │───→│ ACT_RE_PROCDEF    │                │
│   └──────────────────┘    └──────────────────┘                │
│           │                        │                             │
│           │                        ▼                             │
│           │              ┌──────────────────┐                   │
│           └─────────────→ │ ACT_GE_BYTEARRAY │                   │
│                          └──────────────────┘                   │
│                                                                 │
│   运行时数据（ACT_RU_*）                                        │
│   ┌──────────────────┐    ┌──────────────────┐                │
│   │ ACT_RU_EXECUTION │←───│ ACT_RU_TASK      │                │
│   └────────┬─────────┘    └──────────────────┘                │
│            │                      │                            │
│            ▼                      ▼                            │
│   ┌──────────────────┐    ┌──────────────────┐                │
│   │ ACT_RU_VARIABLE  │    │ACT_RU_IDENTITYLINK│               │
│   └──────────────────┘    └──────────────────┘                │
│                                                                 │
│   历史数据（ACT_HI_*）                                          │
│   ┌──────────────────┐    ┌──────────────────┐                │
│   │ ACT_HI_PROCINST  │←───│ ACT_HI_TASKINST  │                │
│   └────────┬─────────┘    └──────────────────┘                │
│            │                      │                            │
│            ▼                      ▼                            │
│   ┌──────────────────┐    ┌──────────────────┐                │
│   │ ACT_HI_ACTINST    │    │ ACT_HI_DETAIL     │                │
│   └──────────────────┘    └──────────────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 常见查询示例

### 查询某用户的待办任务

```sql
SELECT t.* FROM ACT_RU_TASK t
LEFT JOIN ACT_RU_IDENTITYLINK i ON t.ID_ = i.TASK_ID_
WHERE i.USER_ID_ = 'zhangsan'
   OR i.GROUP_ID_ IN (
       SELECT GROUP_ID_ FROM ACT_ID_MEMBERSHIP WHERE USER_ID_ = 'zhangsan'
   )
AND t.SUSPENSION_STATE_ = 1;
```

### 查询流程实例的执行状态

```sql
SELECT 
    p.PROC_DEF_KEY_,
    p.PROC_INST_ID_,
    e.ACT_ID_,
    t.NAME_
FROM ACT_RU_EXECUTION e
JOIN ACT_RE_PROCDEF p ON e.PROC_DEF_ID_ = p.ID_
LEFT JOIN ACT_RU_TASK t ON e.ID_ = t.EXECUTION_ID_
WHERE e.PROC_INST_ID_ = ?
  AND e.IS_ACTIVE_ = 1;
```

### 统计流程耗时

```sql
SELECT 
    PROC_DEF_KEY_,
    AVG(DURATION_) as avg_duration,
    MAX(DURATION_) as max_duration,
    MIN(DURATION_) as min_duration,
    COUNT(*) as total_count
FROM ACT_HI_PROCINST
WHERE END_TIME_ IS NOT NULL
GROUP BY PROC_DEF_KEY_;
```

---

## 总结：表结构速查

| 前缀 | 表类型 | 生命周期 | 说明 |
|---|---|---|---|
| ACT_RE_* | Repository | 永久 | 流程定义，部署后一直存在 |
| ACT_RU_* | Runtime | 临时 | 运行时数据，流程结束后删除 |
| ACT_HI_* | History | 永久 | 历史数据，用于审计和统计 |
| ACT_GE_* | General | 永久 | 通用数据，BPMN文件等 |
| ACT_ID_* | Identity | 永久 | 用户、组信息 |

---

## 留给你的问题

假设你在排查一个生产问题：用户反馈任务一直卡在某个节点，不往下走了。

**问题来了：**

1. 你会先查哪张表？为什么？
2. 如果查 `ACT_RU_TASK` 发现没有这个任务，但查 `ACT_HI_TASKINST` 发现有历史记录——这说明什么？
3. 如果 `ACT_RU_EXECUTION` 显示流程还在运行，`ACT_RU_TASK` 显示有任务，但任务就是不显示给用户——可能是什么原因？

这三个问题涉及到**问题排查思路**和**表结构理解**，是 DBA 和后端开发者的必备技能。
