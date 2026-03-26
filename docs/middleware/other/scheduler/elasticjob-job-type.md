# ElasticJob 作业类型

ElasticJob 支持三种作业类型：Simple、Dataflow、Script。

不同的作业类型，适用于不同的场景。今天一起来看。

## 作业类型概览

```
┌─────────────────────────────────────────────────────────────┐
│                    ElasticJob 作业类型                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│   │    Simple   │  │  Dataflow   │  │   Script    │        │
│   │   简单作业   │  │  流式作业   │  │  脚本作业   │        │
│   └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                             │
│   │              │                │                        │
│   ▼              ▼                ▼                        │
│ 执行一次        循环执行          执行脚本                  │
│ 立即返回        获取数据→处理     Shell/Python             │
│                                                             │
│ 适用场景：       适用场景：          适用场景：             │
│ · 数据同步       · 数据处理流水线    · 系统运维任务         │
│ · 消息通知       · ETL              · 快速脚本              │
│ · 报表生成       · 批处理           · 现有脚本复用          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SimpleJob：简单作业

SimpleJob 是最基础的作业类型，执行一次后立即返回。

### 定义 SimpleJob

```java
public class MySimpleJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        // 获取分片参数
        String shardParam = shardingContext.getShardingParameter();
        
        System.out.println("执行简单作业，分片参数：" + shardParam);
        
        // 执行业务逻辑
        doSomething();
    }
}
```

### 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                    SimpleJob 执行流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   触发时间到了                                              │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────────────┐   │
│   │ 创建 JobExecutionEvent                             │   │
│   └───────────────────────────────────────────────────┘   │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────────────┐   │
│   │ 调用 execute(ShardingContext)                     │   │
│   └───────────────────────────────────────────────────┘   │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────────────┐   │
│   │ 执行业务逻辑                                        │   │
│   └───────────────────────────────────────────────────┘   │
│       │                                                     │
│       ▼                                                     │
│   ┌───────────────────────────────────────────────────┐   │
│   │ 完成（成功或失败）                                  │   │
│   └───────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 典型应用场景

```java
// 场景1：每日数据同步
public class DailySyncJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        String date = shardingContext.getJobParameter();
        List&lt;Order&gt; orders = orderService.getOrdersByDate(date);
        
        for (Order order : orders) {
            syncToDataWarehouse(order);
        }
    }
}

// 场景2：发送邮件通知
public class EmailNotificationJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        List&lt;User&gt; users = userService.getUsersToNotify();
        
        for (User user : users) {
            emailService.sendNotification(user);
        }
    }
}

// 场景3：清理过期数据
public class DataCleanupJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        int deleted = dataRepository.deleteExpiredData();
        System.out.println("清理了 " + deleted + " 条过期数据");
    }
}
```

## DataflowJob：流式作业

DataflowJob 适用于需要**循环处理数据**的场景，比如批处理 ETL。

### 定义 DataflowJob

```java
public class MyDataflowJob implements DataflowJob&lt;Order&gt; {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Override
    public List&lt;Order&gt; fetchData(ShardingContext shardingContext) {
        // 1. 获取待处理数据
        List&lt;Order&gt; orders = orderMapper.selectPendingOrders(
            shardingContext.getShardingParameter()
        );
        
        // 返回的数据会被后续处理
        // 如果返回空或 null，表示没有更多数据
        return orders;
    }
    
    @Override
    public void processData(ShardingContext shardingContext, List&lt;Order&gt; orders) {
        // 2. 处理数据
        for (Order order : orders) {
            try {
                processOrder(order);
            } catch (Exception e) {
                // 处理失败，记录日志
                log.error("处理订单失败：" + order.getId(), e);
            }
        }
    }
}
```

### 执行流程

```
┌─────────────────────────────────────────────────────────────┐
│                    DataflowJob 执行流程                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───────────────────────────────────────────────────┐   │
│   │                  开始执行                            │   │
│   └───────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   ┌───────────────────────────────────────────────────┐   │
│   │ 循环开始                                            │   │
│   └───────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   ┌───────────────────────────────────────────────────┐   │
│   │ fetchData()                                       │   │
│   │      │                                            │   │
│   │      ▼                                            │   │
│   │   获取待处理数据？                                  │   │
│   │      │                                            │   │
│   │   有 ──┼── 无 → 退出循环                           │   │
│   │      │                                            │   │
│   │      ▼                                            │   │
│   │   ┌─────────────────────────────────────────┐   │   │
│   │   │  processData()                          │   │   │
│   │   │  处理 fetchData 返回的数据               │   │   │
│   │   └─────────────────────────────────────────┘   │   │
│   │      │                                            │   │
│   │      └──────────────────────▶ 继续循环           │   │
│   └───────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│   ┌───────────────────────────────────────────────────┐   │
│   │                  执行完成                            │   │
│   └───────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 与 SimpleJob 的区别

| 维度 | SimpleJob | DataflowJob |
|---|---|---|
| 方法 | 一个 execute() | fetchData() + processData() |
| 执行次数 | 执行一次 | 循环执行直到无数据 |
| 适用场景 | 简单任务 | 批处理、ETL |
| 数据获取 | 作业内部获取 | 框架调用 fetchData() |
| 流式处理 | 不支持 | 支持分批获取、处理 |

### 典型应用场景

```java
// 场景1：订单处理流水线
public class OrderProcessJob implements DataflowJob&lt;Order&gt; {
    
    @Override
    public List&lt;Order&gt; fetchData(ShardingContext context) {
        // 每次获取 100 条
        return orderMapper.selectPendingOrders(100);
    }
    
    @Override
    public void processData(ShardingContext context, List&lt;Order&gt; orders) {
        for (Order order : orders) {
            // 处理订单：验证 → 扣款 → 发货 → 更新状态
            processOrder(order);
        }
    }
}

// 场景2：日志分析
public class LogAnalysisJob implements DataflowJob&lt;LogEntry&gt; {
    
    @Override
    public List&lt;LogEntry&gt; fetchData(ShardingContext context) {
        return logRepository.fetchUnprocessedLogs(1000);
    }
    
    @Override
    public void processData(ShardingContext context, List&lt;LogEntry&gt; logs) {
        for (LogEntry log : logs) {
            analyzeLog(log);
            logRepository.markAsProcessed(log.getId());
        }
    }
}
```

## ScriptJob：脚本作业

ScriptJob 用于直接执行脚本文件，支持 Shell、Python 等。

### 定义 ScriptJob

```java
@Configuration
public class ElasticJobConfig {
    
    @Bean
    public JobScheduler jobScheduler(CoordinatorRegistryCenter registryCenter) {
        JobConfiguration jobConfig = new JobConfiguration();
        jobConfig.setJobName("scriptJob");
        jobConfig.setJobType(JobType.SCRIPT);
        jobConfig.setScriptCommandLine("/bin/bash /opt/scripts/cleanup.sh");
        jobConfig.setCron("0 0 3 * * ?");
        
        return new SpringJobScheduler(null, registryCenter, jobConfig);
    }
}
```

### 脚本示例

```bash
#!/bin/bash

# cleanup.sh - 清理过期日志

echo "========================================="
echo "开始清理过期日志"
echo "执行时间：$(date)"
echo "========================================="

# 查找并删除 7 天前的日志
find /var/log -name "*.log" -mtime +7 -delete

# 统计删除的文件数量
deleted_count=$(find /var/log -name "*.log" -mtime +7 | wc -l)

echo "删除了 $deleted_count 个文件"

# 清理空目录
find /var/log -type d -empty -delete

echo "清理完成"

exit 0
```

### 执行过程

```java
public class ScriptJobExecutor {
    
    public void execute(String scriptCommandLine) {
        try {
            // 1. 执行脚本
            Process process = Runtime.getRuntime().exec(scriptCommandLine);
            
            // 2. 读取输出
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );
            
            String line;
            while ((line = reader.readLine()) != null) {
                // 记录日志
                JobLogger.log(line);
            }
            
            // 3. 等待完成
            int exitCode = process.waitFor();
            
            if (exitCode != 0) {
                throw new RuntimeException("脚本执行失败，退出码：" + exitCode);
            }
            
        } catch (Exception e) {
            throw new RuntimeException("脚本执行异常", e);
        }
    }
}
```

### 典型应用场景

```bash
# 场景1：数据库备份
#!/bin/bash
mysqldump -h localhost -u root -p123456 mydb > /backup/mydb_$(date +%Y%m%d).sql

# 场景2：文件同步
#!/bin/bash
rsync -avz /data/app1 user@remote:/data/app1

# 场景3：服务健康检查
#!/bin/bash
curl -s http://localhost:8080/health | grep -q "UP"
if [ $? -ne 0 ]; then
    echo "服务不健康，重启中..."
    systemctl restart myapp
fi
```

## 三种作业类型对比

| 维度 | SimpleJob | DataflowJob | ScriptJob |
|---|---|---|---|
| 实现方式 | 实现接口 | 实现接口 | 配置脚本路径 |
| 数据获取 | 作业内部 | fetchData() | 无 |
| 执行次数 | 一次 | 循环 | 一次 |
| 适用场景 | 简单任务 | 批处理、ETL | 运维脚本 |
| 代码复杂度 | 低 | 中 | 无需 Java 代码 |
| 灵活性 | 高 | 高 | 低 |
| 调试难度 | 低 | 中 | 高 |

## 选型指南

```
┌─────────────────────────────────────────────────────────────┐
│                    作业类型选型                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   需要 Java 代码？                                          │
│      │                                                      │
│      ├── 否 ──▶ ScriptJob                                  │
│      │                                                      │
│      └── 是 ──▶ 数据需要循环处理？                          │
│                    │                                        │
│                    ├── 是 ──▶ DataflowJob                   │
│                    │                                        │
│                    └── 否 ──▶ SimpleJob                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 总结

| 作业类型 | 核心方法 | 特点 |
|---|---|---|
| SimpleJob | execute(ShardingContext) | 一次执行，立即返回 |
| DataflowJob | fetchData() + processData() | 循环获取数据并处理 |
| ScriptJob | 配置 scriptCommandLine | 执行外部脚本 |

## 思考题

DataflowJob 的 fetchData() 返回空列表后，作业就结束了。

但如果下次执行时，又有新数据了，作业会再次触发吗？

这涉及到 DataflowJob 和 cron 表达式的配合问题。
