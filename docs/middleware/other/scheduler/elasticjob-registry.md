# ElasticJob-Lite 注册中心原理

ZooKeeper 在 ElasticJob 中扮演什么角色？

它不是简单的「存储配置」，而是整个分布式协调的核心——**选举主节点、分配分片、检测故障**。

理解 ZooKeeper 的工作原理，是掌握 ElasticJob 的关键。

## ZooKeeper 在 ElasticJob 中的作用

```
┌─────────────────────────────────────────────────────────────┐
│                ZooKeeper 在 ElasticJob 中的角色               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                      ZooKeeper                       │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │ 1. 服务注册                                  │  │   │
│   │   │    节点启动时注册到 ZooKeeper                 │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │ 2. 主节点选举                                │  │   │
│   │   │    选举产生 Leader 负责调度                   │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │ 3. 分片分配                                  │  │   │
│   │   │    动态分配分片到在线节点                     │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │ 4. 故障检测                                  │  │   │
│   │   │    节点宕机时自动重新分配                     │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   │   ┌─────────────────────────────────────────────┐  │   │
│   │   │ 5. 分布式锁                                  │  │   │
│   │   │    保证同一分片只有一个节点执行                │  │   │
│   │   └─────────────────────────────────────────────┘  │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 节点结构

ElasticJob 在 ZooKeeper 中创建的节点结构：

```
/elasticjob
├── config                           # 作业配置
│   └── {jobName}                   # 作业名称
│       ├── shardingTotalCount      # 分片总数
│       ├── cron                    # cron 表达式
│       ├── shardingItemParameters  # 分片参数
│       └── jobParameter            # 作业参数
│
├── instances                        # 运行实例
│   └── {jobName}
│       └── {instanceId}            # 实例 ID（IP + 进程 ID）
│           └── sharding             # 该实例负责的分片
│               ├── 0                # 分片 0
│               └── 1                # 分片 1
│
├── sharding                        # 分片状态
│   └── {jobName}
│       └── {shardingItem}          # 分片号
│           └── instance             # 当前拥有该分片的实例
│
├── leader                          # 主节点选举
│   └── election
│       └── instance                # 当前主节点
│
├── server                          # 服务实例信息
│   └── {ip:port}
│       ├── jobs                    # 该节点运行的作业列表
│       └── status                  # 节点状态
│
└── locks                           # 分布式锁
    └── {jobName}
        └── {shardingItem}         # 分片锁
            └── lock                # 锁节点
```

## 服务注册机制

当一个应用节点启动时，会向 ZooKeeper 注册：

```java
// 节点启动时注册
public class JobRegistry {
    
    public void register(String jobName, JobInstance instance) {
        // 1. 创建临时节点 /elasticjob/instances/{jobName}/{instanceId}
        String instancePath = "/elasticjob/instances/" + jobName 
            + "/" + instance.getInstanceId();
        
        registryCenter.persistEphemeral(instancePath, 
            JSON.toJSONString(instance));
        
        // 2. 创建服务节点 /elasticjob/server/{ip:port}
        String serverPath = "/elasticjob/server/" + instance.getIpPort();
        
        // 持久化节点，记录该节点运行了哪些作业
        registryCenter.persist(serverPath, jobName);
        
        // 3. 设置 Watch 监听节点变化
        watchJobInstancesChange(jobName);
    }
}
```

### 注册信息示例

```json
// /elasticjob/instances/orderSyncJob/192.168.1.100@-@12345
{
    "instanceId": "192.168.1.100@-@12345",
    "ip": "192.168.1.100",
    "port": 12345,
    "sharding": [0, 2],  // 该实例负责分片 0 和 2
    "startTime": "2024-01-15T10:00:00"
}
```

## 主节点选举

ElasticJob 使用 ZooKeeper 的**临时有序节点**实现主节点选举：

```java
// 主节点选举核心逻辑
public class LeaderService {
    
    private final String jobName;
    private final CoordinatorRegistryCenter registryCenter;
    
    // 选举主节点
    public void leaderElection() {
        // 1. 创建临时有序节点 /elasticjob/leader/election/instance
        // ZooKeeper 会自动生成一个递增的序号
        String instancePath = "/elasticjob/leader/election/instance";
        
        String leaderNode = registryCenter.persistEphemeralSequential(
            instancePath, 
            JSON.toJSONString(currentInstance)
        );
        
        // 2. 获取所有节点，按序号排序
        List&lt;String&gt; instances = registryCenter.getChildrenKeys(
            "/elasticjob/leader/election/instance"
        );
        
        // 3. 序号最小的节点成为主节点
        Collections.sort(instances);
        String smallestInstance = instances.get(0);
        
        // 4. 如果自己是主节点，设置主节点信息
        if (smallestInstance.equals(leaderNode)) {
            setLeaderHost(currentInstance);
        }
    }
    
    // 监听主节点变化
    public void addLeaderElectionListener(Runnable listener) {
        String leaderPath = "/elasticjob/leader/election/instance";
        
        // Watch 机制：当节点列表变化时，重新触发选举
        registryCenter.watch(leaderPath, () -> {
            // 主节点可能发生了变化
            leaderElection();
            listener.run();
        });
    }
}
```

### 选举过程图解

```
┌─────────────────────────────────────────────────────────────┐
│                    主节点选举过程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   初始状态：                                                │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ /leader/election/instance                           │   │
│   │ ├── 0000000001  (Server1)                          │   │
│   │ ├── 0000000002  (Server2)                          │   │
│   │ └── 0000000003  (Server3)                          │   │
│   │                                                      │   │
│   │ 主节点：Server1 (序号最小)                            │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   Server1 宕机：                                            │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ /leader/election/instance                           │   │
│   │ ├── 0000000002  (Server2)  ──▶ 成为新的主节点      │   │
│   │ └── 0000000003  (Server3)                          │   │
│   │                                                      │   │
│   │ ZooKeeper 自动删除 Server1 的临时节点                 │   │
│   │ Server2 和 Server3 收到 Watch 通知                   │   │
│   │ 重新选举，Server2 成为主节点                          │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 分片分配机制

主节点负责将分片分配给各个在线节点：

```java
// 分片分配核心逻辑
public class ShardingService {
    
    public void sharding() {
        // 1. 获取作业配置
        int shardingTotalCount = jobConfig.getShardingTotalCount();
        
        // 2. 获取所有在线实例
        List&lt;JobInstance&gt; onlineInstances = getOnlineInstances();
        
        // 3. 计算分配方案（平均分配）
        Map&lt;JobInstance, List&lt;Integer&gt;&gt; allocation = 
            calculateAllocation(shardingTotalCount, onlineInstances);
        
        // 4. 更新分片状态
        for (Map.Entry&lt;JobInstance, List&lt;Integer&gt;&gt; entry : allocation.entrySet()) {
            JobInstance instance = entry.getKey();
            List&lt;Integer&gt; shards = entry.getValue();
            
            // 写入 /elasticjob/sharding/{jobName}/{shardId}/instance
            for (Integer shardId : shards) {
                String path = "/elasticjob/sharding/" + jobName 
                    + "/" + shardId + "/instance";
                registryCenter.persist(path, instance.getInstanceId());
            }
            
            // 更新实例的分片信息
            updateInstanceSharding(instance, shards);
        }
    }
    
    // 平均分配算法
    private Map&lt;JobInstance, List&lt;Integer&gt;&gt; calculateAllocation(
            int totalShards, List&lt;JobInstance&gt; instances) {
        
        Map&lt;JobInstance, List&lt;Integer&gt;&gt; result = new HashMap&lt;&gt;();
        
        // 每个实例应得的分片数
        int avg = totalShards / instances.size();
        int remainder = totalShards % instances.size();
        
        int currentShard = 0;
        for (int i = 0; i &lt; instances.size(); i++) {
            JobInstance instance = instances.get(i);
            int count = avg + (i &lt; remainder ? 1 : 0);
            
            List&lt;Integer&gt; shards = new ArrayList&lt;&gt;();
            for (int j = 0; j &lt; count; j++) {
                shards.add(currentShard++);
            }
            
            result.put(instance, shards);
        }
        
        return result;
    }
}
```

### 分片分配示例

```
场景：4个分片，3台服务器

初始分配：
┌─────────────────────────────────────────────────────────────┐
│ /elasticjob/sharding/orderSyncJob/                         │
│ ├── 0/instance = "192.168.1.100@-@12345"                  │
│ ├── 1/instance = "192.168.1.101@-@12346"                  │
│ ├── 2/instance = "192.168.1.100@-@12345"                  │
│ └── 3/instance = "192.168.1.102@-@12347"                  │
│                                                             │
│ Server1 (192.168.1.100) → 分片 [0, 2]                     │
│ Server2 (192.168.1.101) → 分片 [1]                        │
│ Server3 (192.168.1.102) → 分片 [3]                        │
└─────────────────────────────────────────────────────────────┘

Server3 宕机后重新分配：
┌─────────────────────────────────────────────────────────────┐
│ Server1 (192.168.1.100) → 分片 [0, 2, 3]                  │
│ Server2 (192.168.1.101) → 分片 [1]                        │
│ Server3 已离线                                             │
└─────────────────────────────────────────────────────────────┘
```

## 节点监听机制

ZooKeeper 的 **Watch 机制**是实时感知节点变化的关键：

```java
// 监听节点变化
public class Instance listeningService {
    
    // 监听实例变化
    public void watchInstances(String jobName) {
        String instancesPath = "/elasticjob/instances/" + jobName;
        
        // 监听子节点变化（新增或删除）
        registryCenter.watch(instancesPath, new Watcher() {
            @Override
            public void process(WatchedEvent event) {
                if (event.getType() == Event.EventType.NodeChildrenChanged) {
                    // 实例列表发生变化
                    onInstancesChanged();
                }
            }
        });
    }
    
    // 实例变化处理
    private void onInstancesChanged() {
        // 1. 重新获取在线实例
        List&lt;String&gt; onlineInstances = registryCenter
            .getChildrenKeys("/elasticjob/instances/" + jobName);
        
        // 2. 如果是主节点，重新分配分片
        if (isLeader()) {
            shardingService.sharding();
        }
        
        // 3. 触发故障转移
        failoverService.processFailover();
    }
    
    // 监听分片变化
    public void watchSharding(String jobName, int shardingItem) {
        String shardingPath = "/elasticjob/sharding/" + jobName 
            + "/" + shardingItem + "/instance";
        
        registryCenter.watch(shardingPath, new Watcher() {
            @Override
            public void process(WatchedEvent event) {
                // 分片所属节点发生变化
                onShardingInstanceChanged(shardingItem);
            }
        });
    }
}
```

### Watch 机制图解

```
┌─────────────────────────────────────────────────────────────┐
│                    Watch 机制工作流程                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Server1 启动                                              │
│        │                                                    │
│        ▼                                                    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ ZooKeeper 创建临时节点：                              │   │
│   │ /elasticjob/instances/orderSyncJob/192.168.1.100    │   │
│   │                                                      │   │
│   │ 同时设置 Watch：                                       │   │
│   │ 「当这个节点的子节点列表变化时，通知我」               │   │
│   └─────────────────────────────────────────────────────┘   │
│        │                                                    │
│        ▼                                                    │
│   Server2、Server3 启动                                     │
│        │                                                    │
│        ▼                                                    │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ ZooKeeper 检测到子节点列表变化                         │   │
│   │ 通知所有 Watch 该路径的客户端                          │   │
│   │                                                      │   │
│   │ Server1 收到通知：「有新的实例加入了」                  │   │
│   │ Server1 作为主节点，执行重新分片                        │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 分布式锁

ElasticJob 使用 ZooKeeper 实现分布式锁，保证同一分片只有一个节点执行：

```java
// 分片分布式锁
public class ShardingLockService {
    
    private final String jobName;
    private final int shardingItem;
    private final CoordinatorRegistryCenter registryCenter;
    
    // 尝试获取分片锁
    public boolean tryLock(long timeout, TimeUnit unit) {
        String lockPath = "/elasticjob/locks/" + jobName 
            + "/" + shardingItem + "/lock";
        
        // 创建临时顺序节点
        String lockNode = registryCenter.persistEphemeralSequential(
            lockPath + "/", 
            currentInstance.getInstanceId()
        );
        
        // 获取锁列表
        List&lt;String&gt; locks = registryCenter.getChildrenKeys(lockPath);
        Collections.sort(locks);
        
        // 如果自己是最小的节点，获得锁
        if (lockNode.endsWith(locks.get(0))) {
            return true;
        }
        
        // 否则等待比自己序号小的节点释放锁
        String predecessor = findPredecessor(lockNode, locks);
        return waitForLock(predecessor, timeout, unit);
    }
    
    // 释放锁
    public void unlock() {
        String lockPath = "/elasticjob/locks/" + jobName 
            + "/" + shardingItem + "/lock";
        registryCenter.remove(lockPath);
    }
}
```

### 锁竞争过程

```
┌─────────────────────────────────────────────────────────────┐
│                    分布式锁竞争过程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   场景：分片 0 正在等待执行                                  │
│                                                             │
│   Server1 尝试获取锁                                        │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ /elasticjob/locks/orderSyncJob/0/lock/              │   │
│   │ ├── 0000000001  (Server1)  ← 最小，获得锁 ✓         │   │
│   │ └── 0000000002  (Server2)                          │   │
│   │                                                      │   │
│   │ Server1 开始执行分片 0                                │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│   Server1 执行完成，释放锁                                  │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ /elasticjob/locks/orderSyncJob/0/lock/              │   │
│   │ └── 0000000002  (Server2)  ← 现在最小，获得锁 ✓     │   │
│   │                                                      │   │
│   │ Server2 开始执行分片 0                                │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 故障检测与恢复

ZooKeeper 的临时节点特性使得故障检测变得简单：

```java
// 故障检测服务
public class FailoverService {
    
    public void processFailover() {
        // 1. 找出宕机的实例
        List&lt;String&gt; allInstances = registryCenter.getChildrenKeys(
            "/elasticjob/instances/" + jobName
        );
        
        List&lt;String&gt; crashedInstances = findCrashedInstances(allInstances);
        
        // 2. 处理每个宕机实例的分片
        for (String crashedInstance : crashedInstances) {
            List&lt;Integer&gt; shards = getInstanceShards(crashedInstance);
            
            for (Integer shard : shards) {
                // 3. 尝试抢锁
                if (tryAcquireShardingLock(shard)) {
                    // 4. 执行故障转移
                    executeFailoverJob(shard);
                }
            }
        }
    }
    
    // 检查实例是否存活
    private boolean isInstanceAlive(String instanceId) {
        // 如果实例的临时节点存在，说明实例还活着
        String instancePath = "/elasticjob/instances/" + jobName + "/" + instanceId;
        return registryCenter.isExisted(instancePath);
    }
}
```

## 总结

| ZooKeeper 机制 | ElasticJob 应用 |
|---|---|
| 临时节点 | 服务注册、故障检测 |
| Watch | 节点变化监听、分片重新分配 |
| 临时顺序节点 | 主节点选举、分布式锁 |
| 持久化节点 | 作业配置、节点信息服务 |

**ZooKeeper 是 ElasticJob 去中心化架构的基石**——没有 ZooKeeper，就无法实现分布式协调。

## 思考题

ZooKeeper 本身也是分布式系统，它会不会也出现故障？

如果 ZooKeeper 集群发生脑裂（Split-Brain），ElasticJob 会发生什么？

这个问题涉及到分布式系统的一致性和可用性权衡，也是 CAP 理论的核心体现。
