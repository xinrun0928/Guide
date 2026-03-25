# ElasticJob 作业配置

ElasticJob 的配置看似简单，但里面藏着很多细节。

配置错了，轻则任务不执行，重则数据错乱。

## 核心配置类

ElasticJob 的配置通过 `JobConfiguration` 完成：

```java
public class JobConfiguration {
    
    // 作业名称（必填，唯一标识）
    private String jobName;
    
    // 作业实现类（全限定类名）
    private String jobClass;
    
    // cron 表达式
    private String cron;
    
    // 分片总数
    private int shardingTotalCount = 1;
    
    // 分片参数
    private String shardingItemParameters = "";
    
    // 作业参数
    private String jobParameter = "";
    
    // 是否开启任务执行追踪
    private boolean jobExecutionType = true;
    
    // 前置任务完成触发
    private boolean previousExecutionCompleteHandling = false;
    
    // 是否启用
    private boolean disabled = false;
    
    // 作业描述
    private String description = "";
    
    // 作业属性
    private JobProperties jobProperties = new JobProperties();
    
    // 监控配置
    private JobCoreConfiguration jobCoreConfiguration;
    
    // 异常处理器
    private Class&lt;? extends JobExecutionException&gt; exceptionHandler;
    
    // 监听器
    private List&lt;ElasticJobListener&gt; elasticJobListeners;
}
```

## Spring Boot 集成

### 依赖配置

```xml
<!-- pom.xml -->
<dependencies>
    <!-- ElasticJob-Lite -->
    <dependency>
        <groupId>com.dangdang</groupId>
        <artifactId>elastic-job-lite-spring</artifactId>
        <version>2.1.5</version>
    </dependency>
    
    <!-- ZooKeeper -->
    <dependency>
        <groupId>org.apache.zookeeper</groupId>
        <artifactId>zookeeper</artifactId>
        <version>3.8.0</version>
    </dependency>
</dependencies>
```

### application.yml 配置

```yaml
spring:
  application:
    name: my-elasticjob-app

# ElasticJob 配置
elasticjob:
  # ZooKeeper 注册中心配置
  zookeeper:
    server-lists: 192.168.1.100:2181,192.168.1.101:2181,192.168.1.102:2181
    namespace: elasticjob
    
  # 作业配置
  jobs:
    orderSyncJob:
      jobClass: com.example.job.OrderSyncJob
      cron: "0/30 * * * * ?"
      shardingTotalCount: 4
      shardingItemParameters: "0=region:Beijing,1=region:Shanghai,2=region:Guangzhou,3=region:Shenzhen"
      jobParameter: "${spring.application.name}"
      description: "订单数据同步"
      
    reportGenerateJob:
      jobClass: com.example.job.ReportGenerateJob
      cron: "0 0 2 * * ?"
      shardingTotalCount: 1
      jobParameter: "2024"
      description: "每日报表生成"
```

### Java Config 配置

```java
@Configuration
public class ElasticJobConfig {
    
    // 注册中心
    @Bean
    public CoordinatorRegistryCenter zookeeperRegistryCenter(
            @Value("${elasticjob.zookeeper.server-lists}") String serverLists,
            @Value("${elasticjob.zookeeper.namespace}") String namespace) {
        
        ZookeeperConfiguration zkConfig = new ZookeeperConfiguration(
            serverLists,
            namespace
        );
        
        // 设置连接超时时间和会话超时时间
        zkConfig.setConnectionTimeoutMilliseconds(10000);
        zkConfig.setSessionTimeoutMilliseconds(30000);
        
        return new ZookeeperRegistryCenter(zkConfig);
    }
    
    // 作业1：订单同步
    @Bean
    public OrderSyncJob orderSyncJob() {
        return new OrderSyncJob();
    }
    
    @Bean
    public SpringJobScheduler orderSyncJobScheduler(
            OrderSyncJob job,
            CoordinatorRegistryCenter regCenter) {
        
        return new SpringJobScheduler(
            job,
            regCenter,
            new JobConfiguration()
                .setJobName("orderSyncJob")
                .setCron("0/30 * * * * ?")
                .setShardingTotalCount(4)
                .setShardingItemParameters(
                    "0=region:Beijing,1=region:Shanghai,2=region:Guangzhou,3=region:Shenzhen"
                )
                .setJobParameter("order-sync")
                .setDescription("订单数据同步")
        );
    }
    
    // 作业2：报表生成
    @Bean
    public ReportGenerateJob reportGenerateJob() {
        return new ReportGenerateJob();
    }
    
    @Bean
    public SpringJobScheduler reportGenerateJobScheduler(
            ReportGenerateJob job,
            CoordinatorRegistryCenter regCenter) {
        
        return new SpringJobScheduler(
            job,
            regCenter,
            new JobConfiguration()
                .setJobName("reportGenerateJob")
                .setCron("0 0 2 * * ?")  // 每天凌晨2点
                .setShardingTotalCount(1)
                .setJobParameter("report-2024")
                .setDescription("每日报表生成")
        );
    }
}
```

## 作业属性配置

```java
// JobProperties 包含作业的内部属性
JobProperties jobProperties = new JobProperties();
jobProperties.getJobCoreConfiguration()
    .setJobThreadCount(10)           // 作业线程数
    .setExecutionType(ExecutionType.LABEL_PERENT)  // 执行类型
    .setMaxTimeDiffSeconds(60)       // 最大时间差异（秒）
    .setMisfire(true)                // 是否开启错过重执行
    .setShardingStrategyClass("com.example.MyShardingStrategy");  // 分片策略

jobProperties.getJobTypeConfiguration()
    .setJobType(JobType.DATAFLOW)    // 作业类型
    .setStreamingProcess(false);     // 是否流式处理
```

## 常见配置场景

### 场景一：高并发分片任务

```java
// 大量数据需要并行处理
JobConfiguration config = new JobConfiguration()
    .setJobName("dataProcessingJob")
    .setJobClass(DataProcessingJob.class)
    .setCron("0 0 * * * ?")  // 每小时执行
    .setShardingTotalCount(10)  // 10个分片
    .setShardingItemParameters(
        "0=offset:0,1=offset:100000,2=offset:200000," +
        "3=offset:300000,4=offset:400000," +
        "5=offset:500000,6=offset:600000," +
        "7=offset:700000,8=offset:800000,9=offset:900000"
    )
    // 高并发配置
    .getJobProperties().getJobCoreConfiguration()
        .setJobThreadCount(20)  // 增加线程数
        .setExecutionType(ExecutionType.PERMIT);
```

### 场景二：关键任务（需要可靠执行）

```java
// 财务对账等关键任务，不允许丢失
JobConfiguration config = new JobConfiguration()
    .setJobName("reconciliationJob")
    .setJobClass(ReconciliationJob.class)
    .setCron("0 0 0 * * ?")  // 每天零点
    .setShardingTotalCount(1)
    // 开启错过重执行
    .getJobProperties().getJobCoreConfiguration()
        .setMisfire(true)
        // 监控配置
        .setMaxTimeDiffSeconds(10);  // 时钟偏差超过10秒告警
```

### 场景三：数据流任务

```java
// DataflowJob 配置
JobConfiguration config = new JobConfiguration()
    .setJobName("paymentProcessJob")
    .setJobClass(PaymentProcessJob.class)
    .setCron("0/10 * * * * ?")  // 每10秒
    .setShardingTotalCount(4)
    .setShardingItemParameters(
        "0=status:PENDING,1=status:PROCESSING,2=status:FAILED,3=status:REFUND"
    )
    // DataflowJob 特有配置
    .getJobProperties().getJobTypeConfiguration()
        .setJobType(JobType.DATAFLOW)
        .setStreamingProcess(true);  // 流式处理模式
```

## 配置与 Zookeeper

配置信息会同步到 ZooKeeper：

```
/elasticjob
├── config
│   └── {jobName}
│       ├── shardingTotalCount
│       ├── cron
│       ├── shardingItemParameters
│       └── jobParameter
├── instances
│   └── {instanceId}
│       └── {shardingItem}
├── sharding
│   └── {jobName}
│       └── {shardingItem}
├── leader
│   ├── election
│   └── necessary
├── server
│   └── {ip:port}
└── locks
    └── {jobName}
        └── {shardingItem}
```

```java
// ZooKeeper 中的配置节点
public class ConfigService {
    
    // 读取作业配置
    public JobConfiguration load(String jobName) {
        String configPath = "/elasticjob/config/" + jobName;
        String data = curatorFramework.getData().forPath(configPath);
        return JSON.parseObject(data, JobConfiguration.class);
    }
    
    // 更新作业配置（动态生效）
    public void update(String jobName, JobConfiguration config) {
        String configPath = "/elasticjob/config/" + jobName;
        curatorFramework.setData()
            .forPath(configPath, JSON.toJSONString(config).getBytes());
        // ZooKeeper 的 Watch 会通知所有节点配置变更
    }
}
```

## 常见配置错误

### 错误一：分片参数格式错误

```java
// ❌ 错误：使用了空格
.setShardingItemParameters("0=北京, 1=上海, 2=广州")

// ✅ 正确：不能有空格
.setShardingItemParameters("0=北京,1=上海,2=广州")

// ✅ 或者换行格式
.setShardingItemParameters("0=北京\n1=上海\n2=广州")
```

### 错误二：cron 表达式错误

```java
// ❌ 错误：年份不能有多个值
.setCron("0 0 0 1 1 ? 2024,2025")

// ✅ 正确：年份只写一个
.setCron("0 0 0 1 1 ?")  // 每年1月1日零点

// ✅ 或者用范围
.setCron("0 0 0 1 1 ? 2024/2025")  // 2024到2025年
```

### 错误三：分片数与服务节点不匹配

```java
// 分片数远大于节点数
.setShardingTotalCount(100)  // 只有3台服务器

// 结果：大部分分片没有节点执行
// 解决方案：分片数应接近或略大于节点数
.setShardingTotalCount(6)  // 3台服务器，每台2个分片
```

## 配置模板

```java
@Configuration
public class JobConfigurationTemplate {
    
    /**
     * 标准配置模板
     * 适用于大多数业务场景
     */
    public JobConfiguration standardJob(String jobName, 
                                        Class&lt;? extends SimpleJob&gt; jobClass,
                                        String cron,
                                        int shardingCount,
                                        String shardingParams) {
        return new JobConfiguration()
            .setJobName(jobName)
            .setJobClass(jobClass.getName())
            .setCron(cron)
            .setShardingTotalCount(shardingCount)
            .setShardingItemParameters(shardingParams)
            .setDescription("任务描述")
            // 默认开启错过重执行
            .getJobProperties().getJobCoreConfiguration()
                .setMisfire(true)
                // 默认10个线程
                .setJobThreadCount(10);
    }
    
    /**
     * 关键任务配置模板
     * 适用于财务、数据同步等不允许失败的任务
     */
    public JobConfiguration criticalJob(String jobName,
                                         Class&lt;? extends SimpleJob&gt; jobClass,
                                         String cron) {
        return new JobConfiguration()
            .setJobName(jobName)
            .setJobClass(jobClass.getName())
            .setCron(cron)
            .setShardingTotalCount(1)  // 关键任务建议单分片
            .setDescription("关键任务")
            // 严格监控
            .getJobProperties().getJobCoreConfiguration()
                .setMisfire(true)
                .setMaxTimeDiffSeconds(10)  // 时钟偏差告警
                .setJobThreadCount(5);
    }
}
```

## 总结

| 配置项 | 说明 | 建议 |
|---|---|---|
| jobName | 作业名称，唯一标识 | 必须唯一，不能重复 |
| cron | 触发时间表达式 | 使用标准 Cron 格式 |
| shardingTotalCount | 分片数量 | 根据数据量和节点数调整 |
| shardingItemParameters | 分片参数 | 格式：序号=参数，无空格 |
| jobParameter | 作业参数 | 用于区分不同作业实例 |

**配置是 ElasticJob 的核心**——正确的配置是任务稳定运行的前提。

## 思考题

如果需要在运行时动态修改分片数，应该怎么做？

修改配置后，已经在执行的任务会受到影响吗？

这个问题涉及到动态配置与运行时状态的一致性问题。
