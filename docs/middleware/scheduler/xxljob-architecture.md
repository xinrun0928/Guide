# XXL-Job 架构

Quartz 功能强大，但有个致命问题：**没有管理界面**。

每次加任务、改 cron 表达式，都要改代码、重新部署。

有没有一个任务调度平台，可以**可视化**管理所有定时任务？

这就是 XXL-Job 诞生的原因。

## 什么是 XXL-Job？

XXL-Job 是个人开发者许雪里开源的分布式任务调度平台，「XXL」是作者的小名。

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 名字由来                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   作者：许雪里（xxl）                                        │
│                                                             │
│   这个名字没有特别含义，就像 Java 是印度尼西亚的爪洼岛一样   │
│   ——纯属个人喜好                                            │
│                                                             │
│   但 XXL-Job 本身并不「小」：                                │
│   ·Star 数：25k+                                            │
│   ·公司用户：美团、京东、360、网易等                         │
│   ·社区活跃度高，中文文档完善                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 整体架构

XXL-Job 采用 **调度中心 + 执行器** 的架构：

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 整体架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌────────────────────────────────────────────────────┐   │
│   │                 调度中心 (Admin)                     │   │
│   │                                                     │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│   │   │ 任务管理 │  │执行器注册│  │ 执行监控 │          │   │
│   │   └─────────┘  └─────────┘  └─────────┘          │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────┐     │   │
│   │   │              MySQL                       │     │   │
│   │   │   · 任务配置    · 执行记录               │     │   │
│   │   │   · 执行器注册  · 调度日志               │     │   │
│   │   └─────────────────────────────────────────┘     │   │
│   └────────────────────────────────────────────────────┘   │
│                             │                               │
│         ┌───────────────────┼───────────────────┐           │
│         │                   │                   │           │
│         ▼                   ▼                   ▼           │
│   ┌───────────┐      ┌───────────┐      ┌───────────┐      │
│   │  执行器1   │      │  执行器2   │      │  执行器N   │      │
│   │ (App Svr) │      │ (App Svr) │      │ (App Svr) │      │
│   └───────────┘      └───────────┘      └───────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. 调度中心（Admin）

调度中心是 XXL-Job 的「大脑」，负责：
- 任务管理（增删改查）
- 执行器注册与发现
- 任务触发
- 执行结果收集
- 日志记录

调度中心本身**不执行任务**，只负责任务调度。

### 2. 执行器（Executor）

执行器是任务的「执行者」，负责：
- 注册到调度中心
- 接收调度中心的执行命令
- 真正执行任务逻辑
- 上报执行结果

执行器通常嵌入到业务应用（Spring Boot）中。

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 工作流程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 执行器注册                                             │
│   ┌─────────────┐                                          │
│   │  执行器     │ ──▶ 注册到调度中心 ──▶ 获取 adminAddr    │
│   └─────────────┘                                          │
│                                                             │
│   2. 任务触发                                               │
│   ┌─────────────┐                                          │
│   │  调度中心   │ ──▶ 检测到触发时间到了                    │
│   └──────┬──────┘                                          │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────┐                                          │
│   │  路由策略   │ ──▶ 选择一个执行器                        │
│   └──────┬──────┘                                          │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────┐                                          │
│   │  执行器调用 │ ──▶ HTTP 请求                             │
│   └──────┬──────┘                                          │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────┐                                          │
│   │  任务执行   │                                          │
│   └──────┬──────┘                                          │
│          │                                                  │
│          ▼                                                  │
│   ┌─────────────┐                                          │
│   │  结果回调   │ ──▶ 执行成功/失败 ──▶ 记录日志            │
│   └─────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 执行器注册机制

执行器如何注册到调度中心？

```java
// 执行器启动时，向调度中心注册
public class XxlJobSpringExecutor extends XxlJobExecutor {
    
    @Override
    public void start() {
        // 1. 初始化 RPC 客户端（Netty）
        initAdminBizList(adminAddresses);
        
        // 2. 注册自身信息到调度中心
        registry();
        
        // 3. 启动执行器服务，监听调度中心的任务
        super.start();
    }
    
    private void registry() {
        // 向调度中心发送注册请求
        XxlRpcRemotingClient.invoke(
            "http://api/registry",  // 调度中心 API
            new RegistryParam(registryKey, registryValue),
            3000
        );
    }
}
```

注册信息存储在数据库中：

```sql
CREATE TABLE xxl_job_registry (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    registry_group VARCHAR(50) NOT NULL COMMENT '执行器分组',
    registry_key VARCHAR(255) NOT NULL COMMENT '执行器 key',
    registry_value VARCHAR(255) NOT NULL COMMENT '执行器值（地址）',
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## 任务触发机制

调度中心如何触发任务？

```
┌─────────────────────────────────────────────────────────────┐
│                    任务触发流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   调度中心 cron 到点触发                                    │
│                                                             │
│   ┌───────────────────────────────────────────────────┐   │
│   │  1. 扫描 xxl_job_info 获取待触发任务              │   │
│   │     SELECT * FROM xxl_job_info                    │   │
│   │     WHERE trigger_status = 1                      │   │
│   │     AND next_trigger_time <= NOW                  │   │
│   └───────────────────────────────────────────────────┘   │
│                            │                               │
│                            ▼                               │
│   ┌───────────────────────────────────────────────────┐   │
│   │  2. 计算下一次触发时间                             │   │
│   │     next_trigger_time = calculateNextTime(cron)   │   │
│   │     UPDATE xxl_job_info SET next_trigger_time     │   │
│   └───────────────────────────────────────────────────┘   │
│                            │                               │
│                            ▼                               │
│   ┌───────────────────────────────────────────────────┐   │
│   │  3. 根据路由策略选择执行器                         │   │
│   │     SELECT * FROM xxl_job_registry                │   │
│   │     WHERE registry_group = :group                 │   │
│   └───────────────────────────────────────────────────┘   │
│                            │                               │
│                            ▼                               │
│   ┌───────────────────────────────────────────────────┐   │
│   │  4. 向执行器发送执行请求                           │   │
│   │     HTTP POST /api/run                             │   │
│   └───────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 执行器接收任务

执行器如何接收任务？

```java
// 执行器提供的 HTTP 接口
@RestController
@RequestMapping("/api")
public class JobApiController {
    
    @PostMapping("/run")
    public ReturnT<String> run(HttpServletRequest request) {
        // 1. 解析请求参数
        String jobId = request.getParameter("jobId");
        String executorParams = request.getParameter("executorParams");
        String shardIndex = request.getParameter("shardIndex");
        String shardParam = request.getParameter("shardParam");
        
        // 2. 查找任务
        GlueJobEnum job = GlueJobEnum.getJob(Integer.parseInt(jobId));
        
        // 3. 执行任务（异步）
        jobService.runAsync(job, executorParams, shardIndex, shardParam);
        
        return ReturnT.SUCCESS;
    }
}
```

## 执行结果回调

执行完成后，执行器需要回调调度中心：

```java
public class JobApiController {
    
    @PostMapping("/callback")
    public ReturnT<String> callback(HttpServletRequest request) {
        // 解析执行结果
        String logId = request.getParameter("logId");
        String logStatus = request.getParameter("logStatus");
        String msg = request.getParameter("msg");
        
        // 更新执行日志
        logService.updateLogStatus(logId, logStatus, msg);
        
        return ReturnT.SUCCESS;
    }
}
```

执行结果存储在数据库中：

```sql
CREATE TABLE xxl_job_log (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    job_group INT NOT NULL COMMENT '执行器分组 ID',
    job_id INT NOT NULL COMMENT '任务 ID',
    glue_type VARCHAR(50) COMMENT '任务类型',
    executor_address VARCHAR(255) COMMENT '执行器地址',
    executor_handler VARCHAR(255) COMMENT '任务处理器',
    executor_param TEXT COMMENT '任务参数',
    executor_sharding_param VARCHAR(255) COMMENT '分片参数',
    executor_fail_retry_count INT DEFAULT 0 COMMENT '失败重试次数',
    trigger_time DATETIME COMMENT '触发时间',
    trigger_code INT COMMENT '触发状态码',
    trigger_msg TEXT COMMENT '触发状态信息',
    handle_time DATETIME COMMENT '处理时间',
    handle_code INT COMMENT '处理状态码',
    handle_msg TEXT COMMENT '处理状态信息',
    alarm_status INT DEFAULT 0 COMMENT '告警状态'
);
```

## 调度中心集群

调度中心支持集群部署，保证高可用：

```
┌─────────────────────────────────────────────────────────────┐
│                    调度中心集群                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│   │  Admin-1   │  │  Admin-2   │  │  Admin-3   │      │
│   │ (调度器1)   │  │ (调度器2)   │  │ (调度器3)   │      │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘      │
│          │                 │                 │              │
│          └─────────────────┼─────────────────┘              │
│                            ▼                                 │
│                    ┌─────────────┐                         │
│                    │   MySQL     │                         │
│                    │  (共享数据)   │                         │
│                    └─────────────┘                         │
│                                                             │
│   集群策略：                                                │
│   · 调度中心无状态，共享同一个数据库                        │
│   · 多台机器同时调度，通过数据库锁竞争                       │
│   · 执行器回调时，通过轮询选择可用的 Admin                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 总结

| 组件 | 职责 | 是否必须 |
|---|---|---|
| 调度中心 | 任务管理、触发、监控 | 必须（可集群） |
| 执行器 | 任务执行 | 必须（嵌入业务） |
| MySQL | 存储任务配置、执行记录 | 必须 |
| ZooKeeper | 不需要 | - |

XXL-Job 的架构清晰：调度中心负责「什么时候执行」，执行器负责「谁来执行」。

## 思考题

XXL-Job 使用的是调度中心模式，有没有考虑过去中心化？

调度中心挂了怎么办？

这个问题涉及到高可用设计的核心——如何保证调度中心本身的高可用。
