# Camunda 部署与运维：生产环境最佳实践

把 Camunda 部署到生产环境，不是简单地把 WAR 包扔到 Tomcat 就完事了。

你需要考虑：
- 数据库配置
- 集群部署
- 作业执行器调优
- 监控与告警
- 历史数据清理

这篇文章总结 Camunda 生产环境部署与运维的最佳实践。

---

## 部署架构

### 单节点部署

```
┌─────────────────────────────────────────────────────────────┐
│                        应用服务器                            │
│   ┌─────────────────────────────────────────────────┐     │
│   │              Camunda Engine                      │     │
│   │  ┌──────────┐  ┌──────────┐  ┌──────────┐       │     │
│   │  │ Process  │  │  Job     │  │ History  │       │     │
│   │  │ Engine   │  │ Executor │  │ Service  │       │     │
│   │  └──────────┘  └──────────┘  └──────────┘       │     │
│   └─────────────────────────────────────────────────┘     │
│                           │                                 │
└───────────────────────────┼─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                        数据库                                 │
│   ┌─────────────────────────────────────────────────┐     │
│   │  Runtime Tables  │  History Tables  │  Bacth Jobs │     │
│   └─────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

### 集群部署

```
┌─────────────────────────────────────────────────────────────┐
│                        负载均衡器                            │
│                    (Nginx / F5 / ALB)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  应用节点 1   │   │  应用节点 2   │   │  应用节点 3   │
│ Camunda Engine│   │ Camunda Engine│   │ Camunda Engine│
│  Job Executor │   │  Job Executor │   │  Job Executor │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│                        数据库                                 │
│                    (带连接池优化)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 数据库配置

### 表结构初始化

```sql
-- 方式一：使用 Flyway（推荐）
-- Camunda 自带 Flyway 迁移脚本

-- 方式二：手动执行 SQL
-- 下载 Camunda 数据库脚本
-- https://app.camunda.com/nexus/content/repositories/camunda-bpm/

-- MySQL 示例
CREATE DATABASE camunda DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

### 数据库调优

```sql
-- MySQL 配置优化
[mysqld]
# 连接池优化
max_connections = 200
wait_timeout = 600

# 缓冲池优化
innodb_buffer_pool_size = 4G

# 日志优化
innodb_log_file_size = 1G
innodb_flush_log_at_trx_commit = 2

# 查询优化
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2
```

### 连接池配置

```yaml
spring:
  datasource:
    url: jdbc:mysql://dbserver:3306/camunda?useUnicode=true&characterEncoding=UTF-8&useSSL=false&serverTimezone=Asia/Shanghai
    username: camunda
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5
      connection-timeout: 30000
      idle-timeout: 600000
      max-lifetime: 1800000
```

---

## 生产配置

### 完整配置

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://dbserver:3306/camunda
    hikari:
      maximum-pool-size: 20
      
camunda:
  # 数据库配置
  database:
    schema-update: false  # 生产环境禁用自动更新
    type: mysql
    
  # 作业执行器
  job-execution:
    enabled: true
    core-pool-size: 4
    max-pool-size: 8
    queue-capacity: 100
    keep-alive-seconds: 60
    # 线程名称前缀
    thread-pool-name-prefix: camunda-job-executor-
    
  # 异步执行器（推荐启用）
  async-executor:
    enabled: true
    core-pool-size: 2
    max-pool-size: 4
    queue-capacity: 50
    
  # 历史配置
  history-level: audit  # 生产环境使用 audit 而不是 full
  history-cleanup:
    enabled: true
    cleanup-strategy: endTimeBased
    job-cleanup-enabled: true
    removal-time-based-strategy:
      enabled: true
      min-age: PT30D  # 保留30天
    batch-window:
      enabled: true
      start-time: "20:00"
      end-time: "06:00"
      
  # Web 应用
  webapp:
    index-redirect-enabled: true
    
  # 授权
  bpm:
    admin-user:
      id: admin
      password: ${ADMIN_PASSWORD}
```

---

## 作业执行器调优

### 核心参数

| 参数 | 说明 | 推荐值 |
|---|---|---|
| core-pool-size | 核心线程数 | CPU 核心数 |
| max-pool-size | 最大线程数 | CPU 核心数 × 2 |
| queue-capacity | 队列容量 | 100-500 |
| lock-time-in-millis | 作业锁定时间 | 30 分钟 |

### 生产环境配置

```yaml
camunda:
  job-execution:
    enabled: true
    core-pool-size: 4
    max-pool-size: 8
    queue-capacity: 200
    # 作业执行失败重试
    failed-job-command-code: defaultFailedJobListener
    default-failed-job-max-retries: 3
```

### 作业优先级

```java
// 设置作业优先级
runtimeService.setProcessInstanceVariable(
    processInstanceId,
    "_jobPriority",
    10  // 数值越大优先级越高
);
```

---

## 监控与运维

### Actuator 端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: always
  metrics:
    tags:
      application: camunda-app
```

### 自定义监控

```java
@Component
@Endpoint(id = "camunda-monitor")
public class CamundaMonitorEndpoint {
    
    @Autowired
    private ProcessEngine processEngine;
    
    @ReadOperation
    public Map&lt;String, Object&gt; monitor() {
        Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
        
        // 运行时统计
        RuntimeService runtimeService = processEngine.getRuntimeService();
        result.put("runningProcessInstances", 
            runtimeService.createProcessInstanceQuery().active().count());
        
        // 任务统计
        TaskService taskService = processEngine.getTaskService();
        result.put("pendingTasks", 
            taskService.createTaskQuery().active().count());
        result.put("overdueTasks", 
            taskService.createTaskQuery()
                .active()
                .dueBefore(new Date())
                .count());
        
        // 作业统计
        ManagementService managementService = processEngine.getManagementService();
        result.put("failedJobs", 
            managementService.createJobQuery().withException().count());
        result.put("executingJobs", 
            managementService.createJobQuery().executable().count());
        
        return result;
    }
}
```

### 告警规则

```yaml
# Prometheus 告警规则
groups:
  - name: camunda
    rules:
      - alert: HighFailedJobs
        expr: camunda_failed_jobs > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Camunda 失败作业过多"
          
      - alert: ProcessInstancesStuck
        expr: camunda_running_instances > 0 and camunda_process_stuck_seconds > 3600
        for: 10m
        labels:
          severity: critical
        annotations:
          summary: "存在卡住的流程实例"
```

---

## 历史数据清理

### 自动清理策略

```yaml
camunda:
  history-cleanup:
    enabled: true
    
    # 基于结束时间的清理策略
    removal-time-based-strategy:
      enabled: true
      min-age: P30D  # 保留30天
      
    # 基于完成实例数的清理策略
    removal-count-based-strategy:
      enabled: false
      
    # 批量窗口清理
    batch-window:
      enabled: true
      start-time: "21:00"
      end-time: "05:00"
      batch-size: 500
```

### 手动清理

```java
/**
 * 历史数据清理服务
 */
@Service
public class HistoryCleanupService {
    
    @Autowired
    private ProcessEngine processEngine;
    
    /**
     * 清理指定天数之前的历史数据
     */
    public void cleanupHistory(int daysToKeep) {
        HistoryService historyService = processEngine.getHistoryService();
        
        Date threshold = Date.from(
            Instant.now().minus(daysToKeep, ChronoUnit.DAYS)
        );
        
        // 清理流程实例历史
        historyService.deleteHistoricProcessInstancesAsync(
            threshold,  // 清理此日期之前的数据
            HistoricProcessInstanceQuery.class
        );
        
        // 清理任务历史
        historyService.deleteHistoricTaskInstancesAsync(
            threshold,
            HistoricTaskInstanceQuery.class
        );
    }
    
    /**
     * 获取清理统计
     */
    public Map&lt;String, Long&gt; getCleanupStats() {
        HistoryService historyService = processEngine.getHistoryService();
        
        Map&lt;String, Long&gt; stats = new HashMap&lt;&gt;();
        
        stats.put("totalProcessInstances", 
            historyService.createHistoricProcessInstanceQuery().count());
        stats.put("finishedProcessInstances", 
            historyService.createHistoricProcessInstanceQuery().finished().count());
        stats.put("totalTaskInstances", 
            historyService.createHistoricTaskInstanceQuery().count());
        
        return stats;
    }
}
```

---

## 故障排查

### 常见问题

| 问题 | 原因 | 解决方案 |
|---|---|---|
| 流程卡住 | 作业执行失败 | 检查 Job 表，查看异常信息 |
| 任务丢失 | 重复部署覆盖 | 使用版本管理，不要重复部署 |
| 内存溢出 | 历史数据过多 | 配置清理策略 |
| 连接池耗尽 | 并发过高 | 调整连接池大小 |

### 日志分析

```bash
# 查看作业执行日志
grep "JobEntity" application.log | grep "failure"

# 查看流程启动日志
grep "startProcessInstanceByKey" application.log

# 查看任务完成日志
grep "completeTask" application.log
```

---

## 总结

| 配置项 | 推荐值 |
|---|---|
| database-schema-update | false |
| history-level | audit |
| job-execution | true |
| async-executor | true |
| history-cleanup | 自动清理 |
| admin-password | 强密码 |

---

## 留给你的问题

假设你的 Camunda 集群在高峰期出现以下问题：

1. 作业执行延迟严重，很多定时任务超时
2. 数据库连接池经常耗尽
3. 历史表增长过快

**你会怎么排查和解决这些问题？**

这是典型的生产环境运维问题，需要从监控、调优、架构等多个角度分析。
