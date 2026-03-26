# XXL-Job 分布式任务调度

Quartz 功能强大，但有个致命问题：**没有管理界面**。

每次加任务、改 cron 表达式，都要改代码、重新部署。

有没有一个任务调度平台，可以**可视化**管理所有定时任务？

**XXL-Job** 就是答案。

## 什么是 XXL-Job？

XXL-Job 是个人开发者许雪里开源的分布式任务调度平台，「XXL」是作者的小名。

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 特点                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   国产精品     Star 25k+，美团、京东、360 等公司在用        │
│   可视化管理   Web 界面管理任务，无需改代码                  │
│   调度中心     独立部署的调度中心，负责任务分发               │
│   执行器       嵌入业务应用，负责真正执行                    │
│                                                             │
│   核心优势：                                               │
│   · 任务管理可视化                                         │
│   · 路由策略丰富（FIRST、ROUND、HASH、SHARDING 等）         │
│   · GLUE 模式支持在线编写代码                               │
│   · 失败重试、任务超时、阻塞处理一应俱全                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 核心架构

XXL-Job 采用 **调度中心 + 执行器** 的架构：

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 架构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌────────────────────────────────────────────────────┐   │
│   │                 调度中心 (Admin)                     │   │
│   │                                                     │   │
│   │   Web 界面  ──▶  任务管理、路由、监控               │   │
│   │       │                                             │   │
│   │       │ HTTP/Netty 远程调用                         │   │
│   └───────┼─────────────────────────────────────────────┘   │
│           │                                               │
│           ▼                                               │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│   │  执行器1   │  │  执行器2   │  │  执行器N   │            │
│   │  (App)    │  │  (App)    │  │  (App)    │            │
│   │  真正执行  │  │  真正执行  │  │  真正执行  │            │
│   └───────────┘  └───────────┘  └───────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 模块内容

### 架构与核心

- [架构原理](/middleware/scheduler/xxljob-architecture)：
  - 调度中心职责：任务管理、触发、监控
  - 执行器职责：注册、接收任务、执行、上报结果
  - 注册机制：执行器如何注册到调度中心

### 任务执行

- [任务类型](/middleware/scheduler/xxljob-task-type)：
  - Bean 模式：实现 XxlJob 接口，嵌入业务代码
  - GLUE 模式：在线编写 Java 代码，实时生效
  - Script 模式：执行 Shell、Python 等脚本

### 高级特性

- [路由策略](/middleware/scheduler/xxljob-route)：
  - FIRST/LAST/ROUND/RANDOM：基础路由
  - CONSISTENT_HASH：一致性哈希，同一参数路由到同一执行器
  - SHARDING：分片广播，所有执行器同时执行
- [失败重试与超时](/middleware/scheduler/xxljob-retry)：
  - 超时控制：防止任务无限执行
  - 失败重试：自动重试机制
  - 阻塞处理：SINGLE/QUEUE/DISCARD_LATER/COVER_EARLY
- [任务编排](/middleware/scheduler/xxljob-chaining)：任务依赖、串行执行
- [GLUE 热更新](/middleware/scheduler/xxljob-glue)：在线代码编辑、版本管理、安全机制
- [高可用](/middleware/scheduler/xxljob-ha)：调度中心集群、执行器高可用

## 快速上手

### 引入依赖

```xml
<dependency>
    <groupId>com.xuxueli</groupId>
    <artifactId>xxl-job-core</artifactId>
    <version>2.4.0</version>
</dependency>
```

### 配置执行器

```java
@Configuration
public class XxlJobConfig {
    
    @Bean
    public XxlJobSpringExecutor xxlJobExecutor() {
        XxlJobSpringExecutor xxlJobSpringExecutor = new XxlJobSpringExecutor();
        xxlJobSpringExecutor.setAdminAddresses("http://xxl-job-admin:8080/xxl-job-admin");
        xxlJobSpringExecutor.setAppname("xxl-job-executor");
        xxlJobSpringExecutor.setRegistryKey("xxl-job-executor");
        xxlJobSpringExecutor.setIp(null);
        xxlJobSpringExecutor.setPort(9999);
        xxlJobSpringExecutor.setAccessToken("xxl-job");
        return xxlJobSpringExecutor;
    }
}
```

### 定义任务

```java
@Component
public class SampleXxlJob extends XxlJobSimpleJob {
    
    @Override
    public void execute() throws Exception {
        String param = getJobParam();  // 获取任务参数
        int shardIndex = getShardingIndex();  // 获取分片序号
        int shardTotal = getShardingTotal();  // 获取分片总数
        
        log.info("开始执行分片任务：第 {} 片，共 {} 片", shardIndex, shardTotal);
        
        // 执行业务逻辑
        doSomething(param, shardIndex, shardTotal);
    }
}
```

### Web 界面配置

```
任务名称：数据同步任务
执行器：order-executor
JobHandler：sampleXxlJob
路由策略：SHARDING
cron：0 0 2 * * ?
任务参数：2024-01-01
```

## 面试高频考点

```
┌─────────────────────────────────────────────────────────────┐
│                    XXL-Job 面试要点                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   1. XXL-Job 的架构是怎样的？                              │
│      → 调度中心 + 执行器                                    │
│        调度中心负责任务管理，不执行任务                      │
│        执行器负责任务执行，注册到调度中心                     │
│                                                             │
│   2. 执行器如何注册到调度中心？                            │
│      → 执行器启动时通过 HTTP 调用调度中心 API 注册          │
│        注册信息存储在数据库 xxl_job_registry 表              │
│                                                             │
│   3. 路由策略有哪些？各自的场景？                          │
│      → FIRST：固定使用第一个                               │
│        ROUND：轮询负载均衡                                  │
│        CONSISTENT_HASH：同一参数路由到同一执行器            │
│        SHARDING：分片广播，所有执行器同时执行               │
│                                                             │
│   4. GLUE 模式是什么？有什么风险？                         │
│      → 在线编写代码，实时生效                              │
│        风险：SQL 注入、无限循环、权限控制                   │
│                                                             │
│   5. 阻塞处理策略有哪些？                                  │
│      → SINGLE：串行执行，等待上一个完成                    │
│        QUEUE：队列模式，依次执行                            │
│        DISCARD_LATER：丢弃后续触发                         │
│        COVER_EARLY：丢弃队列，只执行最新                    │
│                                                             │
│   6. 调度中心挂了怎么办？                                  │
│      → 调度中心无状态，集群部署                           │
│        多台调度中心共享数据库，通过锁竞争保证不重复调度     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 与其他框架对比

| 维度 | XXL-Job | Quartz | ElasticJob |
|---|---|---|---|
| 架构 | 调度中心 + 执行器 | 无中心，嵌入应用 | 无中心，嵌入应用 |
| 管理界面 | 有 | 无 | 无（但有 Lite 直辖市） |
| 分片支持 | 支持 | 不支持 | 原生支持 |
| 协调组件 | 数据库 | 数据库 | ZooKeeper |
| 学习成本 | 低 | 中 | 中 |
| 运维复杂度 | 中 | 低 | 高（需要 ZooKeeper） |

## 总结

| 维度 | 说明 |
|---|---|
| 定位 | 分布式任务调度平台 |
| 优点 | 可视化管理、路由策略丰富、GLUE 热更新 |
| 缺点 | 调度中心需要独立部署 |
| 适用场景 | 通用分布式调度场景，尤其需要可视化管理 |

XXL-Job 是国内最流行的分布式调度框架——上手简单，功能齐全，社区活跃。

## 下一步

- 深入学习 [路由策略](/middleware/scheduler/xxljob-route)，掌握分片广播的使用
- 了解 [失败重试与超时](/middleware/scheduler/xxljob-retry)，确保任务可靠性
- 研究 [高可用方案](/middleware/scheduler/xxljob-ha)，为生产环境做准备
