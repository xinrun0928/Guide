# ElasticJob-Cloud 与 Mesos

ElasticJob-Lite 已经很好了，但有一个问题：

**每台服务器的处理能力不同**——有的机器 64 核，有的 8 核，如果固定分配分片，资源利用率会很低。

ElasticJob-Cloud 就是来解决这个问题的——**让资源分配变得动态**。

## 为什么需要 Cloud 模式？

```
┌─────────────────────────────────────────────────────────────┐
│                    Lite 模式的问题                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   场景：4个分片，3台服务器                                   │
│                                                             │
│   Server1 (64核, 128G)  ──▶ 分配分片 0, 3                  │
│   Server2 (8核, 16G)    ──▶ 分配分片 1                      │
│   Server3 (8核, 16G)    ──▶ 分配分片 2                      │
│                                                             │
│   问题：                                                     │
│   · Server1 性能最强，却只处理了 50% 的分片                  │
│   · Server2 和 Server3 性能弱，却各自只处理 25%              │
│   · 资源利用率极不均衡                                       │
│                                                             │
│   根本原因：Lite 模式的分片是静态分配的，不考虑节点能力        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Mesos 是什么？

Apache Mesos 是一个**资源管理平台**，负责抽象和管理整个集群的计算资源。

```
┌─────────────────────────────────────────────────────────────┐
│                    Mesos 架构                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                      Master                          │   │
│   │   · 资源管理  · 任务调度  · 节点管理                │   │
│   │   (主备集群，保证高可用)                              │   │
│   └─────────────────────────────────────────────────────┘   │
│                            │                                │
│        ┌───────────────────┼───────────────────┐           │
│        │                   │                   │           │
│        ▼                   ▼                   ▼           │
│   ┌─────────┐        ┌─────────┐        ┌─────────┐       │
│   │ Agent 1 │        │ Agent 2 │        │ Agent N │       │
│   │(计算资源)│        │(计算资源)│        │(计算资源)│       │
│   └─────────┘        └─────────┘        └─────────┘       │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                     Framework                         │   │
│   │   · ElasticJob-Cloud  · Marathon  · Hadoop         │   │
│   │   (运行在 Mesos 上的应用程序)                          │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Mesos 的核心理念：**两级调度**

1. **Master**：管理整个集群的资源
2. **Framework**：根据获取到的资源，决定如何运行任务

## ElasticJob-Cloud 架构

```
┌─────────────────────────────────────────────────────────────┐
│                  ElasticJob-Cloud 架构                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                    Mesos 集群                        │   │
│   │                                                     │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│   │   │ Master  │  │ Master  │  │ Master  │ (主备)  │   │
│   │   └─────────┘  └─────────┘  └─────────┘          │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │              ZooKeeper                      │  │   │
│   │   │   · 服务注册  · Leader 选举  · 状态同步    │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│   │   │ Agent 1 │  │ Agent 2 │  │ Agent N │          │   │
│   │   │ 8核16G   │  │ 64核128G│  │ 16核32G  │          │   │
│   │   └─────────┘  └─────────┘  └─────────┘          │   │
│   └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              ElasticJob-Cloud                         │   │
│   │                                                     │   │
│   │   ┌─────────┐  ┌─────────┐  ┌─────────┐          │   │
│   │   │作业调度器│  │资源分配器│  │ 状态管理 │          │   │
│   │   └─────────┘  └─────────┘  └─────────┘          │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │              Appctor                         │  │   │
│   │   │   根据 Mesos 分配的资源，动态创建作业实例    │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Cloud vs Lite 核心区别

| 维度 | ElasticJob-Lite | ElasticJob-Cloud |
|---|---|---|
| 资源分配 | 静态分片 | 动态分配 |
| 部署方式 | 嵌入应用 | 独立部署 |
| 作业实例 | 预先启动 | 按需创建 |
| 依赖服务 | ZooKeeper | ZooKeeper + Mesos |
| 适用场景 | 常规业务 | 大数据、计算密集型 |

## 核心组件：Appctor

Appctor 是 ElasticJob-Cloud 的核心组件，负责将作业实例化到 Mesos 分配的容器中：

```
┌─────────────────────────────────────────────────────────────┐
│                    Appctor 工作原理                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Mesos 分配资源                                         │
│   ┌────────────────────────────────────────────────────┐   │
│   │ Mesos 发送 Offer 给 Framework：                       │   │
│   │ {                                                    │   │
│   │   "slaveId": "xxx",                                 │   │
│   │   "resources": {                                    │   │
│   │     "cpu": 8,                                        │   │
│   │     "mem": 16384                                     │   │
│   │   }                                                  │   │
│   │ }                                                    │   │
│   └────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   2. Appctor 决策                                           │
│   ┌────────────────────────────────────────────────────┐   │
│   │ 判断 Offer 是否满足作业需求：                         │   │
│   │ · 当前作业需要 2CPU, 4G                             │   │
│   │ · Offer 提供了 8CPU, 16G                            │   │
│   │ · 决定：接受 Offer，启动 4 个作业实例                │   │
│   └────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   3. 启动作业实例                                           │
│   ┌────────────────────────────────────────────────────┐   │
│   │ 在 Mesos Agent 上启动作业进程：                      │   │
│   │ · 分配 CPU 和内存                                    │   │
│   │ · 启动 Java 进程                                     │   │
│   │ · 注册到 ZooKeeper                                   │   │
│   └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 作业配置

```java
// Cloud 模式的作业配置
public class CloudJobConfiguration {
    
    // 作业名称
    private String jobName;
    
    // 作业实现类
    private String jobClass;
    
    // CPU 需求
    private double cpuCount;
    
    // 内存需求
    private int memoryMb;
    
    // 分片配置
    private int shardingTotalCount;
    
    // 分片参数
    private String shardingItemParameters;
    
    // 作业参数
    private String jobParameter;
    
    // 是否需要网络
    private boolean networkResource;
    
    // 实例数配置
    private ExecutionMode executionMode;
    
    // 弹性配置：是否允许动态调整实例数
    private boolean elasticity = true;
}

// 示例：配置一个计算密集型作业
JobConfiguration config = new JobConfiguration();
config.setJobName("dataProcessJob");
config.setJobClass(DataProcessJob.class);
config.setCpuCount(4.0);      // 需要 4 核 CPU
config.setMemoryMb(8192);     // 需要 8G 内存
config.setShardingTotalCount(10);
config.setElasticity(true);   // 允许弹性伸缩
```

## 资源调度策略

### 1. 贪心策略

```java
// 优先使用资源充足的节点
public class GreedyResourceAllocationStrategy 
        implements ResourceAllocationStrategy {
    
    @Override
    public List&lt;ResourceOffer&gt; allocate(List&lt;ResourceOffer&gt; offers,
                                         JobConfiguration jobConfig) {
        List&lt;ResourceOffer&gt; selected = new ArrayList&lt;&gt;();
        
        // 按资源量降序排序
        offers.sort((a, b) -> 
            Double.compare(b.getCpu(), a.getCpu())
        );
        
        // 选择第一个满足需求的 Offer
        for (ResourceOffer offer : offers) {
            if (offer.getCpu() >= jobConfig.getCpuCount() 
                && offer.getMemoryMb() >= jobConfig.getMemoryMb()) {
                selected.add(offer);
                break;
            }
        }
        
        return selected;
    }
}
```

### 2. 负载均衡策略

```java
// 尽量均匀分配到各节点
public class LoadBalanceResourceAllocationStrategy 
        implements ResourceAllocationStrategy {
    
    @Override
    public List&lt;ResourceOffer&gt; allocate(List&lt;ResourceOffer&gt; offers,
                                         JobConfiguration jobConfig) {
        // 计算每个 Offer 的剩余资源占比
        Map&lt;String, Double&gt; remainingRatio = new HashMap&lt;&gt;();
        
        for (ResourceOffer offer : offers) {
            double usedCpu = offer.getUsedCpu();
            double usedMem = offer.getUsedMemoryMb();
            
            double cpuRatio = usedCpu / offer.getTotalCpu();
            double memRatio = usedMem / offer.getTotalMemoryMb();
            
            // 取平均作为负载指标
            remainingRatio.put(
                offer.getAgentId(), 
                (cpuRatio + memRatio) / 2
            );
        }
        
        // 选择负载最低的节点
        return offers.stream()
            .sorted(Comparator.comparing(
                o -> remainingRatio.get(o.getAgentId())
            ))
            .limit(1)
            .collect(Collectors.toList());
    }
}
```

## 弹性伸缩

Cloud 模式支持根据负载动态调整实例数：

```
┌─────────────────────────────────────────────────────────────┐
│                    弹性伸缩流程                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   监控指标：CPU使用率、内存使用率、任务队列长度                │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 当前状态                                             │   │
│   │ 实例数：2  CPU使用率：85%  队列长度：1000           │   │
│   └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 判断：CPU使用率 > 80%，需要扩容                       │   │
│   └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 执行扩容                                             │   │
│   │ · 向 Mesos 请求新资源                                │   │
│   │ · 等待 Offer                                        │   │
│   │ · 启动新作业实例                                     │   │
│   │ · 更新 ZooKeeper 状态                               │   │
│   └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ 新状态                                               │   │
│   │ 实例数：3  CPU使用率：60%  队列长度：500            │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```java
// 弹性配置
@Configuration
public class CloudJobConfig {
    
    @Bean
    public SpringCloudJobScheduler dataProcessJobScheduler(
            DataProcessJob job,
            CoordinatorRegistryCenter regCenter,
            MesosAssignmentsService mesosService) {
        
        JobConfiguration config = new JobConfiguration();
        config.setJobName("dataProcessJob");
        config.setCpuCount(2.0);
        config.setMemoryMb(4096);
        config.setShardingTotalCount(10);
        config.setElasticity(true);  // 开启弹性
        
        // 弹性配置
        ElasticJobProperties elasticity = new ElasticJobProperties();
        elasticity.setEnabled(true);
        elasticity.setMinInstanceCount(1);   // 最少1个实例
        elasticity.setMaxInstanceCount(10);  // 最多10个实例
        elasticity.setScaleUpThreshold(80);  // CPU > 80% 扩容
        elasticity.setScaleDownThreshold(30); // CPU < 30% 缩容
        
        return new SpringCloudJobScheduler(
            job, regCenter, config, mesosService, elasticity
        );
    }
}
```

## 为什么 Cloud 模式停止维护了？

ElasticJob-Cloud 在 2020 年停止了维护，主要原因：

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloud 模式停更原因                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. Mesos 生态衰落                                         │
│      · Kubernetes 崛起，Mesos 市场萎缩                       │
│      · 越来越多的公司选择 K8s 作为容器编排平台                 │
│                                                             │
│   2. 使用门槛高                                              │
│      · 需要维护 Mesos + ZooKeeper 两套系统                   │
│      · 运维成本大于带来的收益                                │
│                                                             │
│   3. 云原生时代                                            │
│      · Kubernetes 提供了更完善的资源调度能力                 │
│      · Cloud Mode 的价值被 K8s Job/CronJob 替代             │
│                                                             │
│   结论：与其维护 Cloud 模式，不如专注做好 Lite 模式          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 替代方案

如果需要类似 Cloud 模式的动态资源分配能力，可以考虑：

| 方案 | 说明 |
|---|---|
| Kubernetes + Job | 使用 K8s CronJob 实现定时任务，配合 HPA 实现弹性伸缩 |
| XXL-Job | 调度中心模式，支持任务路由策略 |
| 自研 | 基于 K8s Operator 实现任务调度 |

## 总结

| 维度 | ElasticJob-Lite | ElasticJob-Cloud |
|---|---|---|
| 资源管理 | 无（固定分片） | 有（Mesos 分配） |
| 部署方式 | 嵌入应用 | 独立服务 |
| 弹性伸缩 | 不支持 | 支持 |
| 适用场景 | 常规业务 | 计算密集型 |
| 维护状态 | 活跃 | 已停止 |

**Cloud 模式的理念很先进，但受限于 Mesos 生态的衰落**。如果确实需要动态资源分配，建议考虑 Kubernetes 生态的方案。

## 思考题

如果 Mesos Master 挂了，ElasticJob-Cloud 的作业还能正常运行吗？

如果不能，有什么办法可以提高 Cloud 模式的高可用性？

这个问题涉及到分布式系统的高可用设计——单点故障的消除。
