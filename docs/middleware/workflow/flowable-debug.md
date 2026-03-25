# Flowable 异常处理与调试：生产环境问题排查

工作流引擎在生产环境中难免会遇到各种问题：流程卡住、任务丢失、并发冲突……

这篇文章总结 Flowable 生产环境常见问题的排查方法和解决思路。

---

## 常见问题分类

### 1. 流程卡住

**症状**：流程实例一直在某个节点不动，既不往下走，也不报错。

**可能原因**：
- 任务没有分配给任何人
- 网关条件不满足
- 异步作业执行失败

**排查步骤**：

```sql
-- 1. 查看当前流程实例状态
SELECT * FROM ACT_RU_EXECUTION WHERE PROC_INST_ID_ = 'xxx';

-- 2. 查看当前任务
SELECT * FROM ACT_RU_TASK WHERE PROC_INST_ID_ = 'xxx';

-- 3. 查看异步作业
SELECT * FROM ACT_RU_JOB WHERE PROCESS_INSTANCE_ID_ = 'xxx';

-- 4. 查看失败作业
SELECT * FROM ACT_RU_JOB WHERE EXCEPTION_MSG_ IS NOT NULL;
```

**解决方案**：

```java
// 手动触发异步作业
managementService.executeJob(jobId);

// 或者手动完成卡住的任务
taskService.complete(taskId);
```

### 2. 任务丢失

**症状**：某个任务不见了，但流程还在运行。

**可能原因**：
- 任务被删除了
- 任务被分配给了错误的用户
- 并发导致任务状态不一致

**排查步骤**：

```sql
-- 1. 查看历史任务
SELECT * FROM ACT_HI_TASKINST WHERE PROC_INST_ID_ = 'xxx';

-- 2. 查看任务的 identity links
SELECT * FROM ACT_RU_IDENTITYLINK WHERE TASK_ID_ = 'xxx';
```

### 3. 并发冲突

**症状**：两个人同时处理同一个任务，或者流程状态不一致。

**可能原因**：
- 乐观锁冲突
- 数据库事务隔离级别问题
- 任务分配逻辑有漏洞

**排查步骤**：

```sql
-- 查看任务的 assignee
SELECT * FROM ACT_RU_TASK WHERE ID_ = 'xxx';

-- 查看任务的 REV_（版本号）
SELECT REV_ FROM ACT_RU_TASK WHERE ID_ = 'xxx';
```

**解决方案**：
- 使用悲观锁
- 设置正确的事务隔离级别
- 在任务操作前检查状态

---

## 调试技巧

### 1. 启用详细日志

```yaml
logging:
  level:
    org.flowable: DEBUG
    org.flowable.engine.impl.persistence.entity: TRACE
```

### 2. 使用 Flowable Cockpit

Cockpit 提供了可视化的流程监控和调试功能：
- 查看运行中的流程实例
- 查看每个任务的变量
- 手动执行作业
- 拖拽式修复流程

### 3. 单元测试

```java
@Test
public void testProcess() {
    // 部署流程
    repositoryService.createDeployment()
        .addClasspathResource("process.bpmn")
        .deploy();
    
    // 启动流程
    runtimeService.startProcessInstanceByKey("processKey");
    
    // 查询任务
    Task task = taskService.createTaskQuery().singleResult();
    
    // 完成任务
    taskService.complete(task.getId());
    
    // 验证结果
    ProcessInstance instance = runtimeService.createProcessInstanceQuery().singleResult();
    assertNull(instance); // 流程应该已结束
}
```

---

## 性能优化

### 1. 索引优化

```sql
-- 为常用查询字段添加索引
CREATE INDEX idx_task_assignee ON ACT_RU_TASK(ASSIGNEE_);
CREATE INDEX idx_task_create_time ON ACT_RU_TASK(CREATE_TIME_);
CREATE INDEX idx_execution_proc_inst ON ACT_RU_EXECUTION(PROC_INST_ID_);
CREATE INDEX idx_variable_proc_inst ON ACT_RU_VARIABLE(PROC_INST_ID_);
```

### 2. 历史数据清理

```yaml
flowable:
  history:
    cleanup:
      enabled: true
      days-to-keep: 30
      variable-instances-days-to-keep: 15
```

### 3. 异步执行优化

```yaml
flowable:
  async-executor:
    core-pool-size: 4
    max-pool-size: 8
    queue-size: 100
```

---

## 总结

| 问题类型 | 排查方法 | 解决方案 |
|---|---|---|
| 流程卡住 | 查询运行时表 | 手动触发作业或完成任务 |
| 任务丢失 | 查询历史表 | 检查任务分配逻辑 |
| 并发冲突 | 检查事务和锁 | 使用悲观锁或调整隔离级别 |
| 性能问题 | 添加索引、清理历史 | 优化查询、定期清理 |

---

## 留给你的问题

你遇到过哪些 Flowable 生产环境问题？有什么独到的排查经验？
