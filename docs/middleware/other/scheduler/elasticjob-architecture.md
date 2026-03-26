# ElasticJob 架构

XXL-Job 是调度中心模式，所有调度都在一个独立的「大脑」中进行。

但如果你的业务服务器已经是一个集群，还要额外维护一个调度中心集群，是不是有点麻烦？

**ElasticJob** 提供了另一种选择——**去中心化**的架构。

每个业务服务器都内置调度能力，通过 ZooKeeper 协调，谁抢到任务谁执行。

## 什么是 ElasticJob？

ElasticJob 是当当网开源的分布式调度框架，目前有两个主要版本：

```
┌─────────────────────────────────────────────────────────────┐
│                    ElasticJob 版本                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ElasticJob 2.x（已停止维护）                               │
│   ├── 基于 Quartz                                           │
│   └── 使用 ZooKeeper 协调                                   │
│                                                             │
│   ElasticJob 3.x（当前版本）                                │
│   ├── 完全重写                                              │
│   ├── 移除 Quartz 依赖                                      │
│   ├── 支持 Lite 和 Cloud 两种模式                           │
│   └── 性能大幅提升                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 两种部署模式

```
┌─────────────────────────────────────────────────────────────┐
│                    ElasticJob 两种模式                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───────────────────────┐  ┌───────────────────────┐      │
│   │      LiteJob         │  │       CloudJob        │      │
│   │     （轻量级）         │  │      （云原生）        │      │
│   └───────────────────────┘  └───────────────────────┘      │
│            │                            │                    │
│            ▼                            ▼                    │
│   ┌───────────────────────┐  ┌───────────────────────┐      │
│   │ · 无中心化设计         │  │ · 需要 Mesos 集群     │      │
│   │ · 嵌入业务应用         │  │ · 常驻进程运行        │      │
│   │ · ZooKeeper 协调     │  │ · 资源动态分配        │      │
│   │ · 运维简单            │  │ · 运维复杂            │      │
│   └───────────────────────┘  └───────────────────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### LiteJob：轻量级

LiteJob 将调度框架嵌入到业务应用，每个应用实例都是一个「调度节点」：

```xml
<dependency>
    <groupId>org.apache.shardingsphere.elasticjob</groupId>
    <artifactId>elasticjob-lite-core</artifactId>
    <version>3.0.4</version>
</dependency>
```

```java
@SpringBootApplication
public class MyApplication {
    
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}

@Configuration
public class ElasticJobConfig {
    
    @Bean
    public CoordinatorRegistryCenter registryCenter() {
        return new ZookeeperRegistryCenter(
            new ZookeeperConfiguration("localhost:2181", "elastic-job")
        );
    }
    
    @Bean
    public JobScheduler jobScheduler(CoordinatorRegistryCenter registryCenter) {
        return new SpringJobScheduler(
            new MyJob(),
            registryCenter,
            getJobConfiguration()
        );
    }
}
```

### CloudJob：云原生

CloudJob 需要配合 Mesos 使用，适合需要精细化资源管理的场景：

```
┌─────────────────────────────────────────────────────────────┐
│                    CloudJob 架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │
│   │   Mesos     │  │   Mesos     │  │   Mesos     │      │
│   │  Master     │  │   Agent1    │  │   Agent2    │      │
│   └─────────────┘  └─────────────┘  └─────────────┘      │
│          │                                    │              │
│          │              ┌────────────────────┘              │
│          │              ▼                                    │
│          │       ┌─────────────┐                           │
│          │       │  ElasticJob │                           │
│          │       │   Cloud    │                           │
│          │       │   Executor │                           │
│          │       └─────────────┘                           │
│          │                                                   │
│          │       ┌─────────────┐                           │
│          │       │ Job Server  │ ← 作业服务器（无状态）      │
│          │       └─────────────┘                           │
│          │                                                   │
└──────────┴───────────────────────────────────────────────────┘

注意：ElasticJob-Cloud 已停止维护，不推荐使用
```

## LiteJob 架构详解

```
┌─────────────────────────────────────────────────────────────┐
│                    LiteJob 架构                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│   │  App Svr1  │  │  App Svr2  │  │  App Svr3  │        │
│   │ ┌────────┐ │  │ ┌────────┐ │  │ ┌────────┐ │        │
│   │ │ LiteJob│ │  │ │ LiteJob│ │  │ │ LiteJob│ │        │
│   │ │调度+执行│ │  │ │调度+执行│ │  │ │调度+执行│ │        │
│   │ └────┬───┘ │  │ └────┬───┘ │  │ └────┬───┘ │        │
│   └──────┼─────┘  └──────┼─────┘  └──────┼─────┘        │
│          │                 │                 │                │
│          └─────────────────┼─────────────────┘                │
│                            ▼                                  │
│                   ┌─────────────┐                          │
│                   │  ZooKeeper  │                          │
│                   │  (协调中心)  │                          │
│                   │             │                          │
│                   │ · 主节点选举  │                          │
│                   │ · 分片分配   │                          │
│                   │ · 节点发现   │                          │
│                   │ · 故障检测   │                          │
│                   └─────────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心组件

### 1. JobScheduler（作业调度器）

JobScheduler 是 ElasticJob 的核心，负责：
- 初始化所有组件
- 启动调度
- 管理作业生命周期

```java
public class JobScheduler {
    
    // 1. 初始化注册中心
    private final CoordinatorRegistryCenter registryCenter;
    
    // 2. 初始化作业配置
    private final JobConfiguration jobConfiguration;
    
    // 3. 初始化执行器
    private final JobExecutor jobExecutor;
    
    // 4. 初始化调度器
    private final SchedulerFacade schedulerFacade;
    
    public void init() {
        // 1. 注册作业节点到 ZooKeeper
        registerExecutor();
        
        // 2. 启动调度线程
        startScheduleThread();
        
        // 3. 注册作业完成监听器
        registerJobFinishedListener();
    }
}
```

### 2. RegistryCenter（注册中心）

注册中心使用 ZooKeeper，实现：
- 作业节点管理
- 主节点选举
- 分片分配
- 故障检测

```java
// ZooKeeper 节点结构
/elastic-job
  /jobs
    /myJob
      /instances
        /192.168.1.1@-@12345  ← 执行实例
        /192.168.1.2@-@23456
      /sharding
        /0  ← 分片0 由实例1处理
        /1  ← 分片1 由实例2处理
      /leader
        /election
          /instance  ← 当前主节点
```

### 3. JobExecutor（作业执行器）

JobExecutor 负责执行具体的作业逻辑：

```java
public class JobExecutor {
    
    public void execute(ShardingContexts shardingContexts) {
        List&lt;ShardingContext&gt; shardingList = shardingContexts.getShardingContextList();
        
        for (ShardingContext shardingContext : shardingList) {
            // 1. 获取分片参数
            String shardingParameter = shardingContext.getShardingParameter();
            
            // 2. 执行作业
            JobJobExecutionSegmentExecutionEvent event = new JobExecutionEvent(tracingId);
            executionService.execute(
                () -> {
                    // 调用作业类执行
                    jobClass.execute(shardingContext);
                },
                shardingContext,
                event
            );
        }
    }
}
```

## 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│                    LiteJob 工作流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. 启动阶段                                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                                                      │  │
│   │  App Server ──▶ 初始化 JobScheduler                │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  ZooKeeper ──▶ 注册实例节点                        │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  ZooKeeper ──▶ 参与主节点选举                        │  │
│   │                                                      │  │
│   └─────────────────────────────────────────────────────┘  │
│                           │                                 │
│   2. 调度阶段                                               │
│   ┌─────────────────────────────────────────────────────┐  │
│   │                                                      │  │
│   │  主节点 ──▶ 读取 cron 表达式，计算下次触发时间        │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  主节点 ──▶ 分配分片                                  │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  ZooKeeper ──▶ 更新分片节点状态                      │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  所有节点 ──▶ 读取分片分配                           │  │
│   │      │                                              │  │
│   │      ▼                                              │  │
│   │  执行 ──▶ 每个节点执行自己负责的分片                  │  │
│   │                                                      │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 主节点选举

ElasticJob 使用 ZooKeeper 的临时节点实现主节点选举：

```java
public class LeaderService {
    
    public void electLeader() {
        // 1. 创建临时节点
        String nodePath = "/leader/election/instance";
        
        try {
            zkClient.createEphemeral(nodePath, instanceId);
            // 创建成功，说明成为主节点
            leaderNode = instanceId;
        } catch (Exception e) {
            // 节点已存在，说明已有主节点
            // 监听主节点变化
            addConnectionStateListener(new ConnectionStateListener() {
                @Override
                public void stateChanged(ConnectionState state) {
                    if (state == ConnectionState.CONNECTED) {
                        // 重新选举
                        electLeader();
                    }
                }
            });
        }
    }
}
```

## 与 XXL-Job 对比

| 维度 | ElasticJob Lite | XXL-Job |
|---|---|---|
| 架构 | 去中心化 | 调度中心模式 |
| 调度中心 | 无 | 必须部署 |
| 协调组件 | ZooKeeper | 数据库 |
| 分片支持 | 原生支持 | 支持 |
| 学习成本 | 中 | 低 |
| 运维复杂度 | 高（需要 ZooKeeper） | 低 |
| 适用场景 | 大数据、分片复杂 | 通用场景 |

## 总结

| 组件 | 作用 |
|---|---|
| JobScheduler | 核心调度器，管理作业生命周期 |
| RegistryCenter | ZooKeeper 注册中心，协调分布式 |
| JobExecutor | 执行具体的作业逻辑 |
| LeaderService | 主节点选举，确保调度唯一性 |
| ShardingService | 分片分配，将任务分配到各节点 |

## 思考题

ElasticJob 的去中心化架构和 XXL-Job 的调度中心模式，各有什么优缺点？

在什么场景下，去中心化架构更有优势？
