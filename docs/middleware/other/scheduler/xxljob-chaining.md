# XXL-Job 任务编排

任务 A 跑完后才能跑任务 B？
任务 C 需要等任务 A 和任务 B 都完成？

这种任务之间的依赖关系，叫做**任务编排**。

今天来看看 XXL-Job 是如何实现任务编排的。

## 场景引入

```
┌─────────────────────────────────────────────────────────────┐
│                    典型业务场景                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   每日数据报表生成：                                          │
│                                                             │
│   ┌─────────┐                                              │
│   │ 同步订单 │ ──▶ [完成]                                   │
│   └────┬────┘                                              │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────┐                                              │
│   │ 统计报表 │ ──▶ [需要等订单同步完成]                      │
│   └────┬────┘                                              │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────┐                                              │
│   │ 生成PDF │ ──▶ [需要等统计完成]                          │
│   └────┬────┘                                              │
│        │                                                   │
│        ▼                                                   │
│   ┌─────────┐                                              │
│   │ 发送邮件 │ ──▶ [需要等PDF生成]                          │
│   └─────────┘                                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 子任务机制

XXL-Job 支持配置「子任务」，当主任务执行完成后，自动触发子任务。

### 配置子任务

在调度中心配置：

```
主任务：生成日报
├── 子任务1：同步订单数据
├── 子任务2：同步用户数据
└── 子任务3：同步商品数据
```

### 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                    子任务执行流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 主任务触发                                             │
│      ┌─────────────────────────────────────────────────┐   │
│      │ 任务A 执行中...                                   │   │
│      └─────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   2. 主任务完成                                           │
│      ┌─────────────────────────────────────────────────┐   │
│      │ UPDATE xxl_job_log SET handle_code = 200       │   │
│      │ WHERE id = :logId                               │   │
│      └─────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   3. 查询子任务                                           │
│      ┌─────────────────────────────────────────────────┐   │
│      │ SELECT * FROM xxl_job_info                       │   │
│      │ WHERE parent_job_id = :jobId                     │   │
│      └─────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   4. 触发子任务                                           │
│      ┌─────────────────────────────────────────────────┐   │
│      │ 任务B.trigger()                                  │   │
│      │ 任务C.trigger()                                  │   │
│      │ 任务D.trigger()                                  │   │
│      └─────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 代码实现

```java
public class ChildJobService {
    
    public void onJobSuccess(long jobId, long logId) {
        // 1. 查询子任务
        List&lt;JobInfo&gt; childJobs = jobInfoDao.findByParentJobId(jobId);
        
        for (JobInfo childJob : childJobs) {
            // 2. 为每个子任务创建新的执行记录
            XxlJobLog childLog = new XxlJobLog();
            childLog.setJobId(childJob.getId());
            childLog.setTriggerTime(new Date());
            childLog.setTriggerStatus(TriggerStatus.BE_TRIGGER_CODE.getCode());
            logDao.save(childLog);
            
            // 3. 触发子任务
            triggerJob(childJob, childLog.getId(), TriggerTypeEnum.PARENT_TRIGGER);
        }
    }
}
```

## 任务依赖

### 配置任务依赖

XXL-Job 支持配置任务依赖：

```
任务A：数据同步（无依赖）
任务B：数据清洗（依赖任务A）
任务C：数据统计（依赖任务B）
任务D：报表生成（依赖任务A和任务B）
```

### 依赖判断逻辑

```java
public class JobDependencyChecker {
    
    public boolean canExecute(JobInfo job) {
        // 1. 获取任务的所有依赖
        List&lt;Long&gt; parentJobIds = job.getParentJobIds();
        
        if (parentJobIds == null || parentJobIds.isEmpty()) {
            return true;  // 没有依赖，可以执行
        }
        
        // 2. 检查每个依赖任务的状态
        for (Long parentJobId : parentJobIds) {
            JobInfo parentJob = jobInfoDao.findById(parentJobId);
            
            // 3. 检查最近一次执行结果
            XxlJobLog lastLog = jobLogDao.findLastJobLog(parentJobId);
            
            if (lastLog == null) {
                return false;  // 从未执行过
            }
            
            if (lastLog.getHandleCode() != ReturnT.SUCCESS_CODE) {
                return false;  // 上次执行失败
            }
        }
        
        return true;  // 所有依赖都成功，可以执行
    }
}
```

### 依赖检测时机

```
┌─────────────────────────────────────────────────────────────┐
│                    依赖检测时机                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   检测点1：触发时检测                                        │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ if (!canExecute(job)) {                             │  │
│   │     log.warn("依赖任务未成功，跳过执行");             │  │
│   │     return;                                         │  │
│   │ }                                                    │  │
│   │ executor.run();                                      │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   检测点2：执行前检测                                        │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ public void execute() {                              │  │
│   │     if (!canExecute(job)) {                          │  │
│   │         throw new RuntimeException("依赖任务未成功");   │  │
│   │     }                                                 │  │
│   │     // 执行业务逻辑                                   │  │
│   │ }                                                    │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 执行顺序控制

### 简单顺序（子任务）

```
A（主任务）
  └─▶ B
  └─▶ C
  └─▶ D

执行顺序：A → B, C, D（并发）
```

### 链式顺序

```
A → B → C → D

执行顺序：A → B → C → D（串行）
```

实现方式：

```java
public class ChainJobExecutor {
    
    public void executeChain(List&lt;Long&gt; jobIds) {
        for (Long jobId : jobIds) {
            // 执行当前任务
            executeJob(jobId);
            
            // 检查执行结果
            JobLog lastLog = jobLogDao.findLastJobLog(jobId);
            if (lastLog.getHandleCode() != ReturnT.SUCCESS_CODE) {
                throw new RuntimeException("任务执行失败：" + jobId);
            }
        }
    }
}
```

### DAG 顺序（有向无环图）

```
     ┌─────────┐
     │    A    │
     └────┬────┘
          │
    ┌─────┴─────┐
    ▼           ▼
┌───────┐   ┌───────┐
│   B   │   │   C   │
└───┬───┘   └───┬───┘
    │           │
    └─────┬─────┘
          │
          ▼
      ┌───────┐
      │   D   │
      └───────┘

执行顺序：
1. A
2. B, C（等 A 完成）
3. D（等 B, C 都完成）
```

XXL-Job 通过子任务 + 依赖检测实现 DAG 顺序：

```
任务A：无依赖
任务B：依赖任务A
任务C：依赖任务A
任务D：依赖任务B 和任务C
```

## 任务编排的最佳实践

### 实践一：避免深层依赖

```
❌ 不推荐：深层依赖
A → B → C → D → E → F → G

问题：
· 一个任务失败会导致整条链失败
· 调试困难
· 性能差（串行执行）

✅ 推荐：扁平依赖
A ──┬──▶ D
B ──┘
C ──┬──▶ E
    └──▶ F

特点：
· 失败影响范围小
· 可以并行执行
· 易于调试
```

### 实践二：设置合理的超时时间

```java
public class ComplexJob implements XxlJobSimpleJob {
    
    @Override
    public void execute() throws Exception {
        long startTime = System.currentTimeMillis();
        long maxTime = 30 * 60 * 1000;  // 30 分钟
        
        // 任务1：数据同步
        syncData();
        checkTimeout(startTime, maxTime);
        
        // 任务2：数据清洗
        cleanData();
        checkTimeout(startTime, maxTime);
        
        // 任务3：生成报表
        generateReport();
    }
    
    private void checkTimeout(long startTime, long maxTime) {
        if (System.currentTimeMillis() - startTime > maxTime) {
            throw new RuntimeException("任务执行超时");
        }
    }
}
```

### 实践三：完善的错误处理

```java
public class ResilientJob implements XxlJobSimpleJob {
    
    @Override
    public void execute() throws Exception {
        try {
            // 任务1：同步数据
            syncOrders();
        } catch (Exception e) {
            XxlJobHelper.log("订单同步失败：" + e.getMessage());
            // 记录失败，但继续执行后续任务
        }
        
        try {
            // 任务2：统计汇总（依赖任务1，但容忍部分失败）
            statistics();
        } catch (Exception e) {
            XxlJobHelper.log("统计失败：" + e.getMessage());
            // 记录失败，但继续执行
        }
        
        // 任务3：发送通知（无论如何都要执行）
        try {
            sendNotification();
        } catch (Exception e) {
            XxlJobHelper.log("通知发送失败：" + e.getMessage());
            // 这个失败应该告警
            XxlJobHelper.handleFail("通知发送失败");
        }
    }
}
```

## 任务编排 vs 工作流引擎

| 维度 | XXL-Job 任务编排 | 专业工作流引擎 |
|---|---|---|
| 适用场景 | 简单的任务依赖 | 复杂业务流程 |
| 配置方式 | UI 配置 | BPMN 文件 |
| 可视化 | 简单树状 | 完整流程图 |
| 状态管理 | 基础 | 完善 |
| 补偿机制 | 无 | 支持 |
| 人工审批 | 无 | 支持 |
| 学习成本 | 低 | 高 |

## 总结

| 功能 | 说明 | 适用场景 |
|---|---|---|
| 子任务 | 主任务完成后触发子任务 | 并行执行多个相关任务 |
| 任务依赖 | 检查依赖任务状态后再执行 | 顺序执行，有前置条件 |
| 阻塞策略 | 控制并发行为 | 不可并发的任务 |
| 超时控制 | 防止任务无限执行 | 长耗时任务 |

## 思考题

如果任务 A 有 3 个子任务 B、C、D，其中 C 执行失败了，XXL-Job 会怎么处理？

是继续执行 D，还是整个流程都标记为失败？
