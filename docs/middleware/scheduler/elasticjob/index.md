# ElasticJob 分布式任务调度

1000 万条订单数据，需要在 1 小时内处理完成。

单机太慢，4 台服务器并行，每台处理 250 万条。

这就是**分片**的威力——ElasticJob 最擅长的场景。

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

| 模式 | 说明 | 适用场景 |
|---|---|---|
| [LiteJob](/middleware/scheduler/elasticjob-architecture) | 轻量级，嵌入业务应用 | 通用分布式调度 |
| [CloudJob](/middleware/scheduler/elasticjob-cloud) | 需要 Mesos 资源调度 | 云原生场景（已停止维护） |

```
┌─────────────────────────────────────────────────────────────┐
│                    两种模式对比                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌───────────────────────┐  ┌───────────────────────┐      │
│   │      LiteJob         │  │       CloudJob        │      │
│   │     （轻量级）         │  │      （云原生）        │      │
│   └───────────────────────┘  └───────────────────────┘      │
│            │                            │                    │
│            ▼                            ▼                    │
│   · 无中心化设计         · 需要 Mesos 集群                  │
│   · 嵌入业务应用         · 常驻进程运行                     │
│   · ZooKeeper 协调     · 资源动态分配                     │
│   · 运维简单            · 运维复杂                        │
│                                                             │
│   推荐使用 LiteJob，CloudJob 已停止维护                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 模块内容

### 架构与核心

- [架构原理](/middleware/scheduler/elasticjob-architecture)：
  - LiteJob：去中心化设计，每个节点都有调度能力
  - CloudJob：Mesos 资源调度（已停止维护）
  - ZooKeeper 协调：主节点选举、分片分配

### 分片

- [分片原理](/middleware/scheduler/elasticjob-sharding)：
  - 分片配置：shardingTotalCount、shardingItemParameters
  - 分片分配：哈希取模算法
  - 动态分片：节点增减时自动重新分配
  - 自定义分片策略

### 作业类型

- [作业类型](/middleware/scheduler/elasticjob-job-type)：
  - SimpleJob：简单作业，一次执行立即返回
  - DataflowJob：流式作业，fetchData() + processData() 循环处理
  - ScriptJob：执行 Shell、Python 等脚本

### 高级特性

- [监听器](/middleware/scheduler/elasticjob-listener)：
  - ElasticJobListener：作业级监听
  - ExecutionListener：分片级监听
  - 事件追踪：完整的执行日志
- [配置详解](/middleware/scheduler/elasticjob-config)：Spring Boot 配置、分片参数
- [注册中心](/middleware/scheduler/elasticjob-registry)：ZooKeeper 节点结构、选举机制

### 选型对比

- [与 XXL-Job 对比](/middleware/scheduler/elasticjob-compare)：详细的功能对比和选型建议

## 快速上手

### 引入依赖

```xml
<dependency>
    <groupId>org.apache.shardingsphere.elasticjob</groupId>
    <artifactId>elasticjob-lite-core</artifactId>
    <version>3.0.4</version>
</dependency>
```

### 配置注册中心

```java
@Configuration
public class ElasticJobConfig {
    
    @Bean
    public CoordinatorRegistryCenter registryCenter() {
        return new ZookeeperRegistryCenter(
            new ZookeeperConfiguration("localhost:2181", "elastic-job")
        );
    }
}
```

### 定义作业

```java
public class MyJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        // 获取分片参数
        String shardParam = shardingContext.getShardingParameter();
        
        System.out.println("开始执行分片任务，分片参数：" + shardParam);
        
        // 执行业务逻辑
        doSomething();
    }
}
```

### 配置作业

```java
@Bean
public JobScheduler jobScheduler(MyJob job, CoordinatorRegistryCenter registryCenter) {
    return new SpringJobScheduler(
        job,
        registryCenter,
        new JobConfiguration()
            .setJobName("myJob")
            .setShardingTotalCount(4)  // 4 个分片
            .setShardingItemParameters("0=华北,1=华东,2=华南,3=西南")
            .setCron("0 0 2 * * ?")
    );
}
```

## 分片执行示例

```java
public class OrderSyncJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        // 获取分片信息
        int shardIndex = shardingContext.getShardingParameter().charAt(0) - '0';
        int shardTotal = shardingContext.getShardingTotalCount();
        
        System.out.println("开始同步第 " + shardIndex + " 片数据，共 " + shardTotal + " 片");
        
        // 查询本分片需要处理的数据
        List<Order> orders = orderMapper.selectByShard(shardIndex, shardTotal);
        
        for (Order order : orders) {
            syncOrder(order);
        }
        
        System.out.println("第 " + shardIndex + " 片同步完成，共处理 " + orders.size() + " 条");
    }
}
```

```
分片分配结果（4 分片，3 台服务器）：
┌─────────────────────────────────────────────────────────────┐
│ 分片0 → Server1 (0 % 3 = 0)                               │
│ 分片1 → Server2 (1 % 3 = 1)                               │
│ 分片2 → Server3 (2 % 3 = 2)                               │
│ 分片3 → Server1 (3 % 3 = 0)                               │
└─────────────────────────────────────────────────────────────┘

效果：3 台服务器并行处理 4 个分片，Server1 处理 2 个分片
```

## 面试高频考点

```
┌─────────────────────────────────────────────────────────────┐
│                    ElasticJob 面试要点                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. ElasticJob 的架构是怎样的？                            │
│      → 去中心化设计，每个业务服务器都内置调度能力            │
│        通过 ZooKeeper 协调，谁抢到任务谁执行                │
│                                                             │
│   2. 分片是如何分配的？                                    │
│      → 哈希取模：shardingItem % instances.size()           │
│        分片0 → instances[0]                                │
│        分片1 → instances[1]                                │
│        分片2 → instances[2]                                │
│        分片3 → instances[0]                                │
│                                                             │
│   3. 节点宕机后，分片如何处理？                            │
│      → ZooKeeper 检测到节点失联                            │
│        其他节点接管宕机节点的分片                            │
│        恢复后，分片可能重新分配                            │
│                                                             │
│   4. SimpleJob 和 DataflowJob 的区别？                    │
│      → SimpleJob：execute() 执行一次就结束                  │
│        DataflowJob：fetchData() + processData() 循环处理   │
│                                                             │
│   5. ElasticJob 和 XXL-Job 的区别？                        │
│      → ElasticJob：去中心化，ZooKeeper 协调，原生分片      │
│        XXL-Job：调度中心模式，数据库协调，可视化管理         │
│                                                             │
│   6. ZooKeeper 在 ElasticJob 中的作用？                    │
│      → 主节点选举：确保只有一个节点执行调度                 │
│        分片分配：记录分片和节点的对应关系                   │
│        故障检测：检测节点是否存活                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 与 XXL-Job 对比

| 维度 | ElasticJob Lite | XXL-Job |
|---|---|---|
| 架构 | 去中心化 | 调度中心模式 |
| 协调组件 | ZooKeeper | 数据库 |
| 分片支持 | 原生支持，更强大 | 支持 |
| 管理界面 | 无（需要自建） | 有 Web 界面 |
| 学习成本 | 中 | 低 |
| 运维复杂度 | 高（需要 ZooKeeper） | 低 |
| 适用场景 | 大数据、分片复杂 | 通用场景 |

## 总结

| 维度 | 说明 |
|---|---|
| 定位 | 分布式调度框架 |
| 优点 | 原生分片支持、去中心化架构、高性能 |
| 缺点 | 需要 ZooKeeper、无原生管理界面 |
| 适用场景 | 大数据量、分片复杂的场景 |

ElasticJob 是分片调度的专家——如果你有海量数据需要并行处理，它是不二之选。

## 下一步

- 深入学习 [分片原理](/middleware/scheduler/elasticjob-sharding)，掌握分片分配的精髓
- 了解 [作业类型](/middleware/scheduler/elasticjob-job-type)，选择最适合你的作业类型
- 研究 [监听器](/middleware/scheduler/elasticjob-listener)，实现任务执行的完整监控
