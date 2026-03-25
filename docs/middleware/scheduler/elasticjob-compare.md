# ElasticJob vs XXL-Job vs Quartz 功能对比

选型，一直是技术决策中最头疼的问题。

Quartz、XXL-Job、ElasticJob，三者各有优劣。

今天，我们把它们放在一起，好好对比一番。

## 先说结论

| 维度 | Quartz | XXL-Job | ElasticJob |
|---|---|---|---|
| 架构 | 单机 / 集群 | 调度中心 + 执行器 | 去中心化 |
| 管理界面 | 无（需二次开发） | 有（开箱即用） | 有（开箱即用） |
| 任务分片 | 不支持 | 支持 | 支持（核心亮点） |
| 故障转移 | 依赖数据库 | 执行器自抢 | ZooKeeper 选举 |
| 学习成本 | 中 | 低 | 中 |
| 适用场景 | 小型项目、快速集成 | 中大型项目 | 中大型项目、高可用 |

## 架构对比

```
┌─────────────────────────────────────────────────────────────┐
│                    三种架构模式对比                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Quartz：嵌入式                                             │
│   ┌────────┐  ┌────────┐  ┌────────┐                       │
│   │Server1 │  │Server2 │  │Server3 │                       │
│   │调度+执行│  │调度+执行│  │调度+执行│                       │
│   └────────┘  └────────┘  └────────┘                       │
│        │            │            │                           │
│        └────────────┴────────────┘                           │
│                      │                                      │
│                      ▼                                      │
│              ┌────────────┐                                 │
│              │   数据库   │                                 │
│              │(分布式锁)  │                                 │
│              └────────────┘                                 │
│                                                             │
│   XXL-Job：中心化                                            │
│   ┌─────────────────────────────────────────┐              │
│   │              调度中心 (Admin)               │              │
│   │   任务管理 · 触发调度 · 执行监控          │              │
│   └─────────────────────────────────────────┘              │
│                      │                                      │
│                      ▼                                      │
│   ┌────────┐  ┌────────┐  ┌────────┐                       │
│   │执行器1 │  │执行器2 │  │执行器N │                       │
│   │(仅执行)│  │(仅执行)│  │(仅执行)│                       │
│   └────────┘  └────────┘  └────────┘                       │
│                                                             │
│   ElasticJob-Lite：去中心化                                  │
│   ┌────────┐  ┌────────┐  ┌────────┐                       │
│   │调度+执行│  │调度+执行│  │调度+执行│                       │
│   └────┬───┘  └────┬───┘  └────┬───┘                       │
│        └───────────┼────────────┘                           │
│                    ▼                                        │
│            ┌────────────┐                                  │
│            │  ZooKeeper │                                  │
│            │(协调中心)  │                                  │
│            └────────────┘                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 功能对比

| 功能 | Quartz | XXL-Job | ElasticJob |
|---|---|---|---|
| 管理界面 | ❌ | ✅ | ✅ |
| 任务分片 | ❌ | ✅ | ✅ |
| 失败重试 | ❌ | ✅ | ✅ |
| 任务依赖 | ❌ | ✅（任务链） | ❌ |
| 任务超时 | ❌ | ✅ | ✅ |
| 阻塞处理 | ❌ | ✅ | ✅ |
| 事件追踪 | ❌ | ✅ | ✅ |
| 告警通知 | ❌ | ✅ | ✅ |
| 动态配置 | ❌ | ✅ | ✅ |
| GLUE 代码 | ❌ | ✅ | ❌ |
| 作业类型 | 单一 | 多种 | 三种 |
| 监听器 | ❌ | ❌ | ✅ |

## 作业类型对比

### Quartz

```java
// 只有一种：实现 Job 接口
public class MyJob implements Job {
    @Override
    public void execute(JobExecutionContext context) throws JobExecutionException {
        // 业务逻辑
    }
}
```

### XXL-Job

```java
// 多种执行模式

// 1. Bean 模式
@XxlJob("myBeanJob")
public ReturnT&lt;String&gt; execute() {
    return ReturnT.SUCCESS;
}

// 2. GLUE 模式（在线编辑代码）
// 支持 Java、Shell、Python、PHP 等

// 3. 脚本模式
// 直接执行脚本文件
```

### ElasticJob

```java
// 三种作业类型

// 1. SimpleJob - 简单作业
public class MySimpleJob implements SimpleJob {
    @Override
    public void execute(ShardingContext context) {
        // 业务逻辑
    }
}

// 2. DataflowJob - 数据流作业
public class MyDataflowJob implements DataflowJob&lt;Order&gt; {
    @Override
    public List&lt;Order&gt; fetchData(ShardingContext context) {
        return orderService.getPendingOrders();
    }
    @Override
    public void processData(ShardingContext context, List&lt;Order&gt; data) {
        for (Order order : data) {
            process(order);
        }
    }
}

// 3. ScriptJob - 脚本作业
// 执行 Shell、Python 等脚本
```

## 分片能力对比

### Quartz：不支持分片

```java
// Quartz 需要自己实现分片逻辑
public class ShardingQuartzJob implements Job {
    @Override
    public void execute(JobExecutionContext context) {
        // 自己实现分片逻辑
        int totalShards = 4;
        int currentShard = 0; // 需要自己计算
        
        // 根据当前 shard 处理数据
        processShardData(currentShard);
    }
}
```

### XXL-Job：支持简单分片

```java
// XXL-Job 提供分片参数
@XxlJob("shardingJob")
public ReturnT&lt;String&gt; execute() {
    // 获取分片参数
    ShardingVO shardingVO = XxlJobHelper.getSharding();
    
    // 分片序号
    int index = shardingVO.getIndex();
    // 分片总数
    int total = shardingVO.getTotal();
    
    // 根据分片处理数据
    List&lt;String&gt; data = getDataByShard(index, total);
    for (String item : data) {
        process(item);
    }
    
    return ReturnT.SUCCESS;
}
```

### ElasticJob：强大的分片能力

```java
// ElasticJob 分片是核心特性
public class MyShardingJob implements SimpleJob {
    @Override
    public void execute(ShardingContext context) {
        // 获取分片信息
        int shardingItem = context.getShardingItem();
        int shardingParameter = context.getShardingParameter();
        
        // 根据分片执行不同的数据处理
        switch (shardingItem) {
            case 0:
                processRegion("Beijing");
                break;
            case 1:
                processRegion("Shanghai");
                break;
            // ...
        }
    }
}

// 配置分片参数
JobConfiguration config = new JobConfiguration()
    .setShardingTotalCount(4)
    .setShardingItemParameters("0=Beijing,1=Shanghai,2=Guangzhou,3=Shenzhen");
```

## 故障转移对比

### Quartz

```sql
-- 依赖数据库锁实现故障转移
-- 多个节点竞争 QRTZ_LOCKS 表的锁
-- 获得锁的节点执行任务

SELECT * FROM QRTZ_LOCKS 
WHERE SCHED_NAME = 'MyScheduler' 
AND LOCK_NAME = 'TRIGGER_ACCESS';

-- 问题：数据库是瓶颈，节点宕机后需要等待锁超时
```

### XXL-Job

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 故障转移                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   执行器宕机：                                              │
│   1. 调度中心检测到执行器失联                                │
│   2. 将任务标记为失败                                        │
│   3. 失败重试或告警                                         │
│                                                             │
│   任务执行失败：                                            │
│   1. 执行器上报执行失败                                      │
│   2. 调度中心记录失败信息                                    │
│   3. 根据配置的重试次数，重新触发                             │
│                                                             │
│   问题：没有主节点，抢任务时可能有竞争                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ElasticJob

```
┌─────────────────────────────────────────────────────────────┐
│                ElasticJob 故障转移                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ZooKeeper 选举主节点：                                     │
│   · 主节点负责调度                                          │
│   · 非主节点负责执行                                        │
│                                                             │
│   节点宕机：                                                │
│   1. ZooKeeper 检测到临时节点消失                            │
│   2. Watch 触发，其他节点收到通知                             │
│   3. 主节点重新分配分片                                      │
│   4. 可用节点抢锁接管分片                                    │
│                                                             │
│   优势：ZooKeeper 保证了协调的一致性                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 运维复杂度对比

| 维度 | Quartz | XXL-Job | ElasticJob |
|---|---|---|---|
| 依赖服务 | MySQL | MySQL + 调度中心 | ZooKeeper |
| 部署复杂度 | 低 | 中 | 中 |
| 运维难度 | 低 | 中 | 高 |
| 水平扩展 | 难（需配置集群） | 易 | 易 |
| 故障恢复 | 自动（依赖数据库） | 自动 | 自动 |
| 监控告警 | 需自行实现 | 自带 | 需配置 |

## 性能对比

```
场景：1000 个任务，每分钟执行一次

Quartz（集群模式）：
┌─────────────────────────────────────────────────────────────┐
│ · 每分钟触发 1000 次调度请求                                 │
│ · 所有节点竞争数据库锁                                        │
│ · 瓶颈：数据库锁竞争严重                                      │
│ · 预估：100 TPS/秒                                          │
└─────────────────────────────────────────────────────────────┘

XXL-Job：
┌─────────────────────────────────────────────────────────────┐
│ · 调度中心负责触发，性能高                                    │
│ · 执行器接收 HTTP 请求执行                                    │
│ · 瓶颈：调度中心单点（可通过集群解决）                        │
│ · 预估：1000+ TPS/秒                                        │
└─────────────────────────────────────────────────────────────┘

ElasticJob-Lite：
┌─────────────────────────────────────────────────────────────┐
│ · 无中心调度，各节点通过 ZooKeeper 协调                       │
│ · 瓶颈：ZooKeeper 集群性能                                   │
│ · 预估：500-800 TPS/秒（取决于 ZooKeeper 集群）              │
└─────────────────────────────────────────────────────────────┘
```

## 选型决策树

```
开始选择
    │
    ▼
需要管理界面？
    │
    ├── 否 ──▶ Quartz
    │
    └── 是 ──▶ 有 ZooKeeper 集群？
                │
                ├── 否 ──▶ XXL-Job（首选）
                │
                └── 是 ──▶ 需要复杂分片？
                            │
                            ├── 否 ──▶ XXL-Job
                            │
                            └── 是 ──▶ ElasticJob
                                        │
                                        └── 分片复杂度高？
                                            │
                                            ├── 否 ──▶ XXL-Job
                                            └── 是 ──▶ ElasticJob
```

## 场景化推荐

### 场景一：小型项目（5台以下服务器）

```
推荐：Quartz

原因：
· 集成简单，无需额外部署
· 依赖少，运维成本低
· 任务量不大，数据库锁竞争不明显

配置示例：
spring:
  quartz:
    job-store-type: jdbc
    properties:
      org:
        quartz:
          scheduler:
            instanceName: MyClusteredScheduler
          jobStore:
            class: org.quartz.impl.jdbcjobstore.JobStoreTX
            driverDelegateClass: org.quartz.impl.jdbcjobstore.StdJDBCDelegate
            tablePrefix: QRTZ_
            isClustered: true
            clusterCheckinInterval: 10000
```

### 场景二：中型项目（5-20台服务器）

```
推荐：XXL-Job

原因：
· 开箱即用的管理界面
· GLUE 模式支持在线编辑代码
· 路由策略丰富
· 部署简单（调度中心 + 执行器）

配置示例：
# 调度中心独立部署
xxl:
  job:
    admin:
      addresses: http://xxl-job-admin:8080/xxl-job-admin
    executor:
      appname: my-app
      port: 9999
      logpath: /data/applogs/xxl-job/jobhandler
```

### 场景三：大型项目 / 大数据场景（20台以上服务器）

```
推荐：ElasticJob

原因：
· 强大的分片能力
· ZooKeeper 协调，高可用
· 去中心化，无单点
· 适合大规模数据处理

配置示例：
elasticjob:
  zookeeper:
    server-lists: zk1:2181,zk2:2181,zk3:2181
    namespace: elasticjob
  jobs:
    dataSyncJob:
      jobClass: com.example.DataSyncJob
      cron: "0/30 * * * * ?"
      shardingTotalCount: 10
      shardingItemParameters: "0=北京,1=上海,2=广州,..."
```

## 总结

| 框架 | 核心优势 | 最大劣势 | 最佳拍档 |
|---|---|---|---|
| Quartz | 功能完整、集成简单 | 无管理界面 | Spring Boot |
| XXL-Job | 开箱即用、GLUE 模式 | 需要运维调度中心 | 微服务架构 |
| ElasticJob | 强大分片、去中心化 | 需要 ZooKeeper | 大数据处理 |

**没有最好的框架，只有最适合的框架**——根据你的实际场景选择。

## 思考题

如果你的项目从小型发展到大型，需要从 Quartz 迁移到 XXL-Job 或 ElasticJob，应该怎么做？

迁移过程中如何保证任务的平滑切换？

这个问题涉及到技术债务和技术演进，是每个技术人员都会面对的挑战。
