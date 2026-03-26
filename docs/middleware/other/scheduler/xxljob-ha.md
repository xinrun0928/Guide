# XXL-Job 高可用与调度中心集群

你的调度中心挂了。

所有定时任务都停了，用户开始抱怨报表没收到，运营开始追问你什么时候能恢复。

这就是单点故障的代价。

今天来看看 XXL-Job 如何通过集群部署实现高可用。

## 什么是高可用？

```
┌─────────────────────────────────────────────────────────────┐
│                    单点 vs 高可用                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   单点模式：                                                │
│   ┌─────────────┐                                          │
│   │  调度中心   │ ← 挂了                                      │
│   └─────────────┘                                          │
│                                                             │
│   结果：所有任务停止                                        │
│                                                             │
│   ─────────────────────────────────────────────             │
│                                                             │
│   高可用模式：                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│   │  调度中心1  │  │  调度中心2  │  │  调度中心3  │         │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│          │                 │                 │               │
│          └─────────────────┼─────────────────┘               │
│                            ▼                                 │
│                    ┌─────────────┐                          │
│                    │    MySQL    │                          │
│                    └─────────────┘                          │
│                                                             │
│   结果：一个挂了，其他继续工作                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## XXL-Job 集群架构

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 集群架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                     执行器集群                       │   │
│   │                                                     │   │
│   │  ┌───────────┐  ┌───────────┐  ┌───────────┐       │   │
│   │  │ Executor1 │  │ Executor2 │  │ Executor3 │       │   │
│   │  └───────────┘  └───────────┘  └───────────┘       │   │
│   └─────────────────────────────────────────────────────┘   │
│                             ▲                               │
│                             │                               │
│         ┌───────────────────┼───────────────────┐         │
│         │                   │                   │         │
│         ▼                   ▼                   ▼         │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │  Admin-1   │  │  Admin-2   │  │  Admin-3   │        │
│   │  (调度中心)  │  │  (调度中心)  │  │  (调度中心)  │        │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│          │                 │                 │               │
│          └─────────────────┼─────────────────┘               │
│                            ▼                                 │
│                    ┌─────────────┐                          │
│                    │    MySQL    │                          │
│                    │  (共享存储)   │                          │
│                    └─────────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 调度中心集群原理

### 无状态设计

调度中心本身是无状态的，所有状态都存储在 MySQL 中：

```sql
-- 任务配置表
CREATE TABLE xxl_job_info (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    job_group INT NOT NULL COMMENT '执行器分组',
    job_cron VARCHAR(128) NOT NULL COMMENT 'cron 表达式',
    job_desc VARCHAR(255) DEFAULT NULL,
    -- ... 其他字段
);

-- 执行器注册表
CREATE TABLE xxl_job_registry (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    registry_group VARCHAR(50) NOT NULL,
    registry_key VARCHAR(255) NOT NULL,
    registry_value VARCHAR(255) NOT NULL,
    update_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 任务抢调度

多个调度中心实例竞争调度权：

```
┌─────────────────────────────────────────────────────────────┐
│                    任务抢调度机制                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   调度中心1    调度中心2    调度中心3                       │
│      │            │            │                            │
│      │     SELECT * FROM xxl_job_info                      │
│      │     WHERE trigger_next_time <= NOW()                │
│      ├────────────────────────────────────────────────────▶││
│      │                        │                            │
│      │                        │                           │
│      ▼                        ▼                            │
│   ┌─────────┐            ┌─────────┐                       │
│   │ 尝试更新 │            │ 尝试更新 │                       │
│   │ 任务状态 │            │ 任务状态 │                       │
│   └────┬────┘            └────┬────┘                       │
│        │                       │                            │
│        ▼                       ▼                            │
│   ┌─────────┐            ┌─────────┐                       │
│   │ 更新成功 │            │ 更新失败 │ ← 已被其他实例抢走     │
│   │ 获得调度 │            │ 放弃调度 │                       │
│   │ 权      │            │         │                       │
│   └─────────┘            └─────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 代码实现

```java
public class JobScheduleHelper {
    
    private static final String MisfireThreshold = "60000";
    
    public void schedule() {
        while (!toStop) {
            // 1. 获取待触发任务（所有实例竞争）
            List&lt;JobInfo&gt; jobInfoList = JobInfoDao.findJobInfoList(
                System.currentTimeMillis() + PRE_READ_MS
            );
            
            if (jobInfoList == null || jobInfoList.isEmpty()) {
                continue;
            }
            
            for (JobInfo jobInfo : jobInfoList) {
                // 2. 尝试抢占调度权
                long rows = JobInfoDao.updateNextTriggerTime(
                    jobInfo.getId(),
                    System.currentTimeMillis(),
                    nextTriggerTime
                );
                
                if (rows == 0) {
                    // 被其他实例抢走了，跳过
                    continue;
                }
                
                // 3. 获得调度权，执行调度
                doSchedule(jobInfo);
            }
        }
    }
}
```

### 数据库锁机制

使用时间戳比较实现乐观锁：

```sql
-- 伪代码
UPDATE xxl_job_info 
SET trigger_last_time = :lastTime,
    trigger_next_time = :nextTime,
    update_time = NOW()
WHERE id = :id 
  AND trigger_next_time <= :currentTime
  AND update_time < :lastUpdateTime + :threshold
```

## 执行器发现机制

执行器如何发现调度中心？

### 方式一：手动配置

```yaml
xxl:
  job:
    adminAddresses: http://admin1:8080/xxl-job-admin,http://admin2:8080/xxl-job-admin,http://admin3:8080/xxl-job-admin
```

### 方式二：动态发现

```java
public class ExecutorRegistry {
    
    // 执行器启动时注册
    public void registry() {
        for (String adminAddress : adminAddresses) {
            try {
                // 注册到所有调度中心
                HttpResponse response = HttpRequest.post(adminAddress + "/api/registry")
                    .body(json)
                    .timeout(3000)
                    .execute();
                
                if (response.isOk()) {
                    // 注册成功
                    break;
                }
            } catch (Exception e) {
                // 注册失败，尝试下一个
            }
        }
    }
    
    // 定时续约
    public void registryKeepAlive() {
        while (!toStop) {
            try {
                // 续约到任意一个存活的调度中心
                httpRequest.post(getValidAdminAddress() + "/api/registry");
            } catch (Exception e) {
                log.error("续约失败", e);
            }
            
            Thread.sleep(30 * 1000);
        }
    }
}
```

## 故障转移

### 执行器故障转移

```
┌─────────────────────────────────────────────────────────────┐
│                    执行器故障转移                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 执行器宕机                                             │
│                                                             │
│   ┌─────────────────────────────────────────────────┐     │
│   │  Admin: 检测执行器心跳                            │     │
│   │  SELECT * FROM xxl_job_registry                  │     │
│   │  WHERE update_time < NOW() - 30s                 │     │
│   └─────────────────────────────────────────────────┘     │
│                            │                               │
│                            ▼                               │
│   2. 标记执行器失联                                        │
│      ┌─────────────────────────────────────────────────┐   │
│      │ UPDATE xxl_job_registry                          │   │
│      │ SET registry_status = 'OFFLINE'                  │   │
│      │ WHERE update_time < NOW() - 30s                  │   │
│      └─────────────────────────────────────────────────┘   │
│                                                             │
│   3. 后续任务不再分配给失联执行器                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 调度中心故障转移

```
┌─────────────────────────────────────────────────────────────┐
│                    调度中心故障转移                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Admin-1 挂了                                             │
│                                                             │
│   ┌─────────────────────────────────────────────────┐     │
│   │ 执行器检测调度中心可用性                          │     │
│   │                                                │     │
│   │ 尝试调用 adminAddresses 中的任意一个             │     │
│   │                                                │     │
│   │ 如果当前调度中心不可用，切换到其他               │     │
│   └─────────────────────────────────────────────────┘     │
│                                                             │
│   执行器内部逻辑：                                          │
│   ┌─────────────────────────────────────────────────┐     │
│   │ 1. 维护一个可用的调度中心列表                      │     │
│   │ 2. 按顺序尝试调用                                │     │
│   │ 3. 失败则尝试下一个                              │     │
│   │ 4. 成功则更新当前可用调度中心                     │     │
│   └─────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 集群部署配置

### Admin 集群配置

```yaml
server:
  port: 8080

spring:
  datasource:
    url: jdbc:mysql://mysql-master:3306/xxl_job?useUnicode=true
    username: root
    password: 123456

xxl:
  job:
    # 所有调度中心地址
    adminAddresses: http://admin1:8080/xxl-job-admin,http://admin2:8080/xxl-job-admin
```

### Nginx 负载均衡（可选）

如果需要对外提供统一入口，可以用 Nginx：

```nginx
upstream xxl-job-admin {
    server admin1:8080;
    server admin2:8080;
    server admin3:8080;
}

server {
    listen 80;
    server_name xxl-job.example.com;
    
    location / {
        proxy_pass http://xxl-job-admin;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 执行器配置

```yaml
xxl:
  job:
    # 调度中心地址列表
    adminAddresses: http://admin1:8080/xxl-job-admin,http://admin2:8080/xxl-job-admin
    appname: my-executor
    port: 9999
    logpath: /data/applogs/xxl-job/jobhandler
    logretentiondays: 30
```

## 监控与告警

### 调度中心健康检查

```java
@RestController
@RequestMapping("/api")
public class AdminApiController {
    
    @GetMapping("/beat")
    public ReturnT<String> beat() {
        return ReturnT.SUCCESS;
    }
}
```

### 告警配置

```java
@Configuration
public class XxlJobConfig {
    
    @Bean
    public XxlJobSpringExecutor xxlJobExecutor() {
        XxlJobSpringExecutor executor = new XxlJobSpringExecutor();
        executor.setAdminAddresses(adminAddresses);
        executor.setAppname(appname);
        
        // 配置告警回调
        executor.setAlarmEmail("admin@example.com");
        
        return executor;
    }
}
```

## 高可用测试

### 测试一：调度中心宕机

```
步骤：
1. 启动 3 个调度中心
2. 触发任务执行
3. 关闭其中一个调度中心
4. 观察任务是否继续执行

预期结果：
✅ 任务继续在其他调度中心执行
```

### 测试二：执行器宕机

```
步骤：
1. 启动 3 个执行器
2. 触发任务（使用 FAILOVER 路由策略）
3. 关闭其中一个执行器
4. 观察任务是否自动切换到其他执行器

预期结果：
✅ 任务自动切换到其他执行器
```

### 测试三：数据库故障

```
步骤：
1. 正常执行任务
2. 主数据库故障，切换到从数据库
3. 观察任务是否继续执行

预期结果：
✅ 任务继续执行（如果数据库切换快速）
⚠️ 可能需要重试（如果切换时间较长）
```

## 总结

| 组件 | 高可用方式 | 切换时间 |
|---|---|---|
| 调度中心 | 集群 + 抢调度 | 秒级 |
| 执行器 | 心跳检测 + 路由策略 | 30 秒（心跳间隔）|
| 数据库 | 主从切换 | 分钟级 |
| 执行结果 | 数据库持久化 | 不受影响 |

**部署建议**：
- 调度中心：至少 2 个，推荐 3 个
- 执行器：至少 2 个，推荐与业务服务器混部
- 数据库：主从复制，或使用高可用方案

## 思考题

如果 3 个调度中心同时抢同一个任务，会不会导致同一个任务被执行多次？

XXL-Job 如何保证任务不被重复执行？
