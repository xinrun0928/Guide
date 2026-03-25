# ElasticJob 分片原理

1000 万条订单数据，需要在 1 小时内处理完成。

单机太慢，4 台服务器并行，每台处理 250 万条。

这就是**分片**的威力。

今天来看看 ElasticJob 是如何实现分片的。

## 什么是分片？

```
┌─────────────────────────────────────────────────────────────┐
│                    分片概念                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   没有分片：                                                │
│   ┌────────────────────────────────────────────────────┐   │
│   │  1000万条订单                                      │   │
│   │  Server1: [████████████████████████████████]     │   │
│   │  Server2: [                                   ]   │   │
│   │  Server3: [                                   ]   │   │
│   │  Server4: [                                   ]   │   │
│   │  耗时：10小时                                     │   │
│   └────────────────────────────────────────────────────┘   │
│                                                             │
│   分片后：                                                  │
│   ┌────────────────────────────────────────────────────┐   │
│   │  分片0: 1-250万    Server1: [████████]           │   │
│   │  分片1: 250-500万  Server2: [████████]           │   │
│   │  分片2: 500-750万  Server3: [████████]           │   │
│   │  分片3: 750-1000万 Server4: [████████]           │   │
│   │  耗时：2.5小时                                      │   │
│   └────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 分片参数配置

在 ElasticJob 中，分片是通过 `shardingItemParameters` 配置的：

```java
@Configuration
public class ElasticJobConfig {
    
    @Bean
    public JobScheduler jobScheduler(MyJob myJob, CoordinatorRegistryCenter registryCenter) {
        return new SpringJobScheduler(
            myJob,
            registryCenter,
            getJobConfiguration()
        );
    }
    
    private JobConfiguration getJobConfiguration() {
        JobConfiguration jobConfig = new JobConfiguration();
        jobConfig.setJobName("orderSyncJob");
        jobConfig.setShardingTotalCount(4);  // 总共 4 个分片
        jobConfig.setShardingItemParameters(
            "0=华北,1=华东,2=华南,3=西南"  // 每个分片的参数
        );
        jobConfig.setCron("0 0 2 * * ?");  // 每天凌晨2点
        return jobConfig;
    }
}
```

### 配置说明

| 参数 | 说明 | 示例 |
|---|---|---|
| shardingTotalCount | 分片总数 | 4 |
| shardingItemParameters | 分片参数 | "0=华北,1=华东,2=华南,3=西南" |

## 分片执行

```java
public class MyShardingJob implements SimpleJob {
    
    @Override
    public void execute(ShardingContext shardingContext) {
        // 获取当前节点负责的分片
        ShardingVO sharding = shardingContext.getShardingParameter();
        
        // 根据分片参数执行不同逻辑
        switch (sharding.getShardingItem()) {
            case 0:
                // 处理华北地区数据
                syncDataByRegion("华北");
                break;
            case 1:
                // 处理华东地区数据
                syncDataByRegion("华东");
                break;
            case 2:
                // 处理华南地区数据
                syncDataByRegion("华南");
                break;
            case 3:
                // 处理西南地区数据
                syncDataByRegion("西南");
                break;
        }
    }
}
```

## 分片分配原理

### ZooKeeper 节点结构

```
/elastic-job
  /jobs
    /orderSyncJob
      /instances
        /192.168.1.1@-@12345  ← Server1 实例
        /192.168.1.2@-@23456  ← Server2 实例
        /192.168.1.3@-@34567  ← Server3 实例
      /sharding
        /0  ← 分片0分配状态
        /1  ← 分片1分配状态
        /2  ← 分片2分配状态
        /3  ← 分片3分配状态
```

### 分片分配算法

```java
public class ShardingService {
    
    public void sharding(JobInstance currentInstance) {
        // 1. 获取所有在线实例
        List&lt;JobInstance&gt; allInstances = jobNodeStorage.getJobInstances();
        
        // 2. 获取分片总数
        int shardingTotalCount = jobConfig.getShardingTotalCount();
        
        // 3. 分配分片
        Map&lt;JobInstance, List&lt;Integer&gt;&gt; shardingResults = new HashMap&lt;&gt;();
        
        for (int i = 0; i < shardingTotalCount; i++) {
            // 哈希取模分配：i % instances.size()
            JobInstance targetInstance = allInstances.get(i % allInstances.size());
            
            shardingResults.computeIfAbsent(targetInstance, k -> new ArrayList&lt;&gt;()).add(i);
        }
        
        // 4. 更新 ZooKeeper 节点
        for (Map.Entry&lt;JobInstance, List&lt;Integer&gt;&gt; entry : shardingResults.entrySet()) {
            JobInstance instance = entry.getKey();
            List&lt;Integer&gt; shardingItems = entry.getValue();
            
            // 写入分配结果
            String shardingNode = "/sharding/" + shardingItems.get(0);
            jobNodeStorage.fillJobExecutionData(instance, shardingItems);
        }
    }
}
```

### 分配过程图解

```
┌─────────────────────────────────────────────────────────────┐
│                    分片分配过程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   初始状态：4 个分片，3 个实例                              │
│                                                             │
│   分片:  0    1    2    3                                │
│                                                             │
│   实例:                                                    │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  Server1 (192.168.1.1)                               │  │
│   │  Server2 (192.168.1.2)                               │  │
│   │  Server3 (192.168.1.3)                               │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   计算过程：                                                │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  分片0 → 0 % 3 = 0 → Server1                       │  │
│   │  分片1 → 1 % 3 = 1 → Server2                       │  │
│   │  分片2 → 2 % 3 = 2 → Server3                       │  │
│   │  分片3 → 3 % 3 = 0 → Server1                       │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   分配结果：                                                │
│   ┌─────────────────────────────────────────────────────┐  │
│   │  Server1: [分片0, 分片3]                            │  │
│   │  Server2: [分片1]                                  │  │
│   │  Server3: [分片2]                                  │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 动态分片

### 分片数 > 实例数

```
场景：6 个分片，3 个实例

分配结果：
Server1: [分片0, 分片3]
Server2: [分片1, 分片4]
Server3: [分片2, 分片5]
```

### 实例数 > 分片数

```
场景：4 个分片，6 个实例

分配结果：
Server1: [分片0]
Server2: [分片1]
Server3: [分片2]
Server4: [分片3]
Server5: []
Server6: []
```

### 实例增减

```
初始：4 分片，3 实例
分配：S1:[0,3], S2:[1], S3:[2]

新增实例 S4：
重新分配：S1:[0,3], S2:[1], S3:[2], S4:[]
        ↓
最终：  S1:[0], S2:[1], S3:[2], S4:[3]

新增实例 S5：
重新分配：S1:[0], S2:[1], S3:[2], S4:[3], S5:[]
        ↓
最终：  S1:[0], S2:[1], S3:[2], S4:[3], S5:[]  ← S4 的分片3被抢走了！

注意：新增实例可能导致已有实例失去分片
```

## 分片策略

ElasticJob 支持自定义分片策略：

### 平均分片策略（默认）

```java
public class AverageAllocationJobShardingStrategy implements JobShardingStrategy {
    
    @Override
    public Map&lt;JobInstance, List&lt;Integer&gt;&gt; sharding(
            List&lt;JobInstance&gt; shardingUnits, 
            JobConfiguration jobConfiguration) {
        
        Map&lt;JobInstance, List&lt;Integer&gt;&gt; result = new LinkedHashMap&lt;&gt;();
        int shardingTotalCount = jobConfiguration.getShardingTotalCount();
        
        // 按顺序分配
        for (int i = 0; i < shardingTotalCount; i++) {
            JobInstance target = shardingUnits.get(i % shardingUnits.size());
            result.computeIfAbsent(target, k -> new LinkedList&lt;&gt;()).add(i);
        }
        return result;
    }
}
```

### 自定义分片策略

```java
public class CustomShardingStrategy implements JobShardingStrategy {
    
    @Override
    public Map&lt;JobInstance, List&lt;Integer&gt;&gt; sharding(
            List&lt;JobInstance&gt; shardingUnits, 
            JobConfiguration jobConfiguration) {
        
        Map&lt;JobInstance, List&lt;Integer&gt;&gt; result = new HashMap&lt;&gt;();
        
        // 自定义分配逻辑：按区域分片
        String region = getCurrentServerRegion();  // 假设获取当前服务器所属区域
        
        List&lt;Integer&gt; targetSharding = new ArrayList&lt;&gt;();
        for (int i = 0; i < jobConfiguration.getShardingTotalCount(); i++) {
            if (jobConfiguration.getShardingItemParameters()
                    .get(String.valueOf(i)).equals(region)) {
                targetSharding.add(i);
            }
        }
        
        result.put(new JobInstance(JobRegistry.getInstance().getJobInstance()), targetSharding);
        return result;
    }
}
```

## 实战：订单数据同步

```java
public class OrderSyncJob implements SimpleJob {
    
    @Autowired
    private OrderMapper orderMapper;
    
    @Override
    public void execute(ShardingContext shardingContext) {
        // 1. 获取分片参数（区域）
        String region = shardingContext.getShardingParameter();
        System.out.println("开始同步 " + region + " 地区数据");
        
        // 2. 获取分片序号
        int shardingItem = shardingContext.getShardingParameter().charAt(0) - '0';
        
        // 3. 查询需要同步的数据（按分片过滤）
        List&lt;Order&gt; orders = orderMapper.selectPendingOrders(
            shardingItem,
            shardingContext.getShardingTotalCount()
        );
        
        System.out.println(region + " 地区待同步订单数：" + orders.size());
        
        // 4. 处理每条订单
        int successCount = 0;
        for (Order order : orders) {
            try {
                syncOrder(order);
                successCount++;
            } catch (Exception e) {
                System.out.println("同步订单失败：" + order.getId());
            }
        }
        
        System.out.println(region + " 地区同步完成，成功：" + successCount);
    }
}
```

```java
@Select("SELECT * FROM orders WHERE id % #{totalCount} = #{shardingItem} AND status = 'PENDING'")
List&lt;Order&gt; selectPendingOrders(@Param("shardingItem") int shardingItem, @Param("totalCount") int totalCount);
```

## 总结

| 概念 | 说明 |
|---|---|
| shardingTotalCount | 分片总数，决定任务分成几份 |
| shardingItemParameters | 每个分片的参数，传递给作业 |
| 分片分配 | 通过哈希取模分配到各实例 |
| 动态重分配 | 实例变化时自动重新分配 |

**分片的本质**：把一个任务按照某种规则分成多个子任务，每个子任务由不同的服务器处理。

## 思考题

如果 4 个分片分配给 3 个实例，其中一个实例宕机了，分片会如何重新分配？

宕机期间，其他两个实例会接管它的分片吗？恢复后会怎样？
