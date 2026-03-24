# 异地多活架构：同城双活、两地三中心、三地五中心

你有没有想过这个问题：2019 年双十一，天猫的交易峰值达到 54.4 万笔/秒。

这个流量是什么概念？如果把这些请求分散到全国，需要多少台服务器？

更重要的是：如果广州的机房突然断电了，会怎么样？

答案取决于你的高可用架构做得多好。

今天我们来聊聊异地多活——这是一种让系统「死不掉」的设计哲学。

## 为什么需要异地多活

### 单机房的问题

```
┌─────────────────────────────────────────┐
│              单机房架构                     │
│                                         │
│    用户 ──▶ 负载均衡 ──▶ 应用服务器       │
│                              │          │
│                              ▼          │
│                         数据库集群        │
│                              │          │
│                              ▼          │
│                         缓存集群         │
│                                         │
│    ⚠️ 机房断电 / 光纤被挖断 / 自然灾害   │
│    → 整个系统不可用                      │
└─────────────────────────────────────────┘
```

### 异地多活的价值

1. **容灾**：一个机房挂了，其他机房继续服务
2. **就近访问**：用户访问最近的机房，降低延迟
3. **容量扩展**：多个机房分担流量

## 异地多活的层次

### 1. 同城双活

两个机房在同一个城市，距离通常在 50 公里以内。

```
┌─────────────────────────────────────────┐
│              同城双活架构                 │
│                                         │
│   ┌─────────────┐   ┌─────────────┐   │
│   │   机房A     │   │   机房B     │   │
│   │             │   │             │   │
│   │  应用服务器  │   │  应用服务器  │   │
│   │  数据库节点  │◀─▶│  数据库节点  │   │
│   │  缓存节点   │   │  缓存节点   │   │
│   │  负载均衡   │   │  负载均衡   │   │
│   └──────┬──────┘   └──────┬──────┘   │
│          │                  │          │
│          └────────┬─────────┘          │
│                   │                    │
│              数据同步                    │
│                                         │
└─────────────────────────────────────────┘
```

#### 特点

- **RPO（恢复点目标）**：通常可以做到秒级或分钟级
- **RTO（恢复时间目标）**：通常可以做到分钟级
- **延迟**：网络延迟通常在 1-5 毫秒，影响较小
- **成本**：相对较低

#### 适用场景

- 同城企业级应用
- 对延迟敏感但可接受少量额外延迟的业务
- 预算有限但需要基本容灾能力的场景

### 2. 两地三中心

在两个城市部署三个机房：一个是本地主机房，一个是本地备机房（通常在郊区或周边区域），另一个是异地灾备中心。

```
┌─────────────────────────────────────────────────────────┐
│                   两地三中心架构                            │
│                                                         │
│   ┌─────────────────┐        ┌─────────────────┐       │
│   │    本地主机房    │◀──────▶│    本地备机房    │       │
│   │                 │  同步   │                 │       │
│   │  应用 + 数据库  │        │  应用 + 数据库  │       │
│   └─────────────────┘        └─────────────────┘       │
│           │                            │               │
│           │         数据同步              │               │
│           └──────────────┬───────────────┘               │
│                          │                               │
│                          ▼                               │
│              ┌─────────────────┐                        │
│              │   异地灾备中心   │                        │
│              │                 │                        │
│              │   应用（冷备）   │  ←── 异步同步          │
│              │   数据库（热备） │                        │
│              └─────────────────┘                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

#### 特点

- **RPO**：分钟级到小时级（取决于异地同步频率）
- **RTO**：通常在小时级别
- **延迟**：异地之间可能有 10-50 毫秒延迟
- **成本**：中等

#### 适用场景

- 金融、证券等对数据安全性要求较高的行业
- 需要基本容灾能力的企业

### 3. 三地五中心

这是一种更高级的架构，在三个城市部署五个机房，数据中心之间互相连接，形成网状结构。

```
┌─────────────────────────────────────────────────────────────────┐
│                        三地五中心架构                              │
│                                                                 │
│   ┌─────────────────┐    ┌─────────────────┐                   │
│   │   城市A-机房1   │◀──▶│   城市A-机房2   │                   │
│   │                 │    │                 │                   │
│   │   应用 + 数据库  │    │   应用 + 数据库  │                   │
│   └────────┬────────┘    └────────┬────────┘                   │
│            │                      │                             │
│            └──────────┬───────────┘                             │
│                       │                                          │
│                       │         全互连 + 数据同步                  │
│            ┌──────────▼───────────┐                             │
│            │                      │                             │
│   ┌────────▼────────┐   ┌────────▼────────┐                   │
│   │   城市B-机房1    │◀─▶│   城市B-机房2    │                   │
│   │                 │   │                 │                   │
│   │   应用 + 数据库  │   │   应用 + 数据库  │                   │
│   └────────┬────────┘   └────────┬────────┘                   │
│            │                      │                             │
│            └──────────┬───────────┘                             │
│                       │                                          │
│                       │                                          │
│            ┌──────────▼───────────┐                             │
│            │   城市C-机房1         │                             │
│            │                      │                             │
│            │   应用 + 数据库       │                             │
│            └─────────────────────┘                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 特点

- **RPO**：秒级甚至接近零
- **RTO**：分钟级别
- **延迟**：取决于城市之间的距离，通常在 5-30 毫秒
- **成本**：较高

#### 适用场景

- 大型互联网公司
- 对可用性要求极高的业务
- 全球化部署需求

## 数据同步策略

### 1. 同步复制（同城）

```java
/**
 * 同步复制：在主节点写入后，必须等待所有副本节点确认才能返回成功
 */
public class SynchronousReplicator {

    private final List&lt;DataNode&gt; replicas;

    public WriteResult write(Data data) {
        // 1. 写入主节点
        primary.write(data);

        // 2. 同步写入所有副本节点
        CompletableFuture.allOf(
            replicas.stream()
                .map(r -> r.writeAsync(data))
                .toArray(CompletableFuture[]::new)
        ).join();

        return WriteResult.SUCCESS;
    }
}
```

**优点**：数据一致性最强
**缺点**：延迟高，性能差

### 2. 异步复制（异地）

```java
/**
 * 异步复制：写入主节点后立即返回，数据同步在后台进行
 */
public class AsynchronousReplicator {

    private final DataNode primary;
    private final List&lt;DataNode&gt; remoteReplicas;
    private final BlockingQueue&lt;Data&gt; syncQueue = new LinkedBlockingQueue&lt;&gt;();

    public WriteResult write(Data data) {
        // 1. 写入主节点（立即返回）
        primary.write(data);

        // 2. 加入同步队列（后台异步同步）
        syncQueue.offer(data);

        return WriteResult.SUCCESS;
    }

    // 同步线程
    @Scheduled(fixedRate = 100)
    public void syncToRemote() {
        List&lt;Data&gt; batch = new ArrayList&lt;&gt;();
        syncQueue.drainTo(batch, 100);

        for (DataNode replica : remoteReplicas) {
            replica.writeBatch(batch);
        }
    }
}
```

**优点**：延迟低，性能好
**缺点**：可能丢失少量数据

### 3. 半同步复制

```java
/**
 * 半同步复制：写入主节点后，等待至少一个副本确认
 */
public class SemiSynchronousReplicator {

    private final DataNode primary;
    private final List&lt;DataNode&gt; replicas;

    public WriteResult write(Data data) {
        primary.write(data);

        // 等待至少一个副本确认
        CompletableFuture.anyOf(
            replicas.stream()
                .map(r -> r.writeAsync(data))
                .toArray(CompletableFuture[]::new)
        ).join();

        return WriteResult.SUCCESS;
    }
}
```

### 4. CRDT 解决冲突

Conflict-free Replicated Data Types（无冲突复制数据类型）是一种专门设计用于分布式系统的数据结构，可以在不进行中心协调的情况下自动解决冲突。

```java
/**
 * G-Counter：只增计数器
 */
public class GCounter {

    private final Map&lt;String, Long&gt; counts = new ConcurrentHashMap&lt;&gt;();

    public void increment(String nodeId) {
        counts.compute(nodeId, (k, v) -> v == null ? 1 : v + 1);
    }

    public long value() {
        return counts.values().stream().mapToLong(Long::longValue).sum();
    }
}

/**
 * PN-Counter：可增可减计数器
 */
public class PNCounter {

    private final GCounter positive = new GCounter();
    private final GCounter negative = new GCounter();

    public void increment(String nodeId) {
        positive.increment(nodeId);
    }

    public void decrement(String nodeId) {
        negative.increment(nodeId);
    }

    public long value() {
        return positive.value() - negative.value();
    }
}

/**
 * LWW-Register：最后写入胜出寄存器
 */
public class LWWRegister&lt;T&gt; {

    private final Map&lt;String, Long&gt; timestamps = new ConcurrentHashMap&lt;&gt;();
    private final Map&lt;String, T&gt; values = new ConcurrentHashMap&lt;&gt;();

    public void set(String nodeId, long timestamp, T value) {
        Long existing = timestamps.get(nodeId);
        if (existing == null || existing &lt; timestamp) {
            timestamps.put(nodeId, timestamp);
            values.put(nodeId, value);
        }
    }

    public T get(String nodeId) {
        return values.get(nodeId);
    }
}
```

## 流量调度

### 1. DNS 调度

根据用户地理位置，返回最近机房的 IP 地址。

```java
@Configuration
public class GeoDNSConfig {

    private final Map&lt;String, List&lt;String&gt;&gt; regionToDC = Map.of(
        "华东", List.of("10.0.1.1", "10.0.1.2"),
        "华南", List.of("10.0.2.1", "10.0.2.2"),
        "华北", List.of("10.0.3.1", "10.0.3.2")
    );

    public String resolveDC(String region) {
        return regionToDC.getOrDefault(region, "华东").get(0);
    }
}
```

### 2. AnyCast 调度

通过 AnyCast 技术，多个数据中心使用相同的 IP 地址，用户请求会被路由到最近的数据中心。

```
用户 ──▶ DNS ──▶ 最近的机房（自动选择）
```

### 3. 应用层调度

```java
@Service
public class GlobalTrafficScheduler {

    private final Map&lt;String, DataCenter&gt; dataCenters;

    public DataCenter selectDataCenter(User user) {
        // 1. 尝试选择最近的数据中心
        DataCenter nearest = geoSelector.findNearest(user.getLocation());

        // 2. 检查容量
        if (nearest.hasCapacity()) {
            return nearest;
        }

        // 3. 容量不足，降级到其他可用数据中心
        return fallbackSelector.selectAvailable(nearest);
    }

    public Response routeRequest(Request request) {
        DataCenter dc = selectDataCenter(request.getUser());
        return dc.process(request);
    }
}
```

## 容灾切换

### 1. 自动切换

```java
@Service
public class AutoFailoverService {

    @Autowired
    private HealthChecker healthChecker;
    @Autowired
    private TrafficRouter trafficRouter;

    @EventListener
    public void onDataCenterFailure(DataCenterFailureEvent event) {
        DataCenter failedDC = event.getDataCenter();

        // 1. 确认故障（非误判）
        if (!confirmFailure(failedDC)) {
            log.info("故障未确认，取消切换: {}", failedDC);
            return;
        }

        log.error("数据中心 {} 故障，开始自动切换", failedDC);

        // 2. 切换流量
        trafficRouter.failover(failedDC);

        // 3. 通知运维
        alertManager.send(Alert.builder()
            .level(AlertLevel.CRITICAL)
            .title("数据中心故障切换")
            .message("数据中心 " + failedDC.getName() + " 已自动切换到备用")
            .build());

        // 4. 启动数据恢复流程
        recoveryService.startRecovery(failedDC);
    }

    private boolean confirmFailure(DataCenter dc) {
        // 连续检查 3 次都失败才确认
        for (int i = 0; i &lt; 3; i++) {
            if (healthChecker.isHealthy(dc)) {
                return false;
            }
            sleep(1000);
        }
        return true;
    }
}
```

### 2. 手动切换

```java
@RestController
@RequestMapping("/admin/failover")
public class FailoverController {

    @Autowired
    private FailoverService failoverService;

    @PostMapping("/switch")
    public Response switchTo(@RequestParam String targetDC) {
        log.info("管理员发起切换: target={}", targetDC);

        // 预检查
        if (!failoverService.canSwitchTo(targetDC)) {
            return Response.error("目标数据中心不可用");
        }

        failoverService.switchTo(targetDC);
        return Response.success("切换成功");
    }

    @GetMapping("/status")
    public Response getStatus() {
        return Response.success(failoverService.getCurrentStatus());
    }
}
```

### 3. 切换后的数据一致性

```java
@Service
public class DataConsistencyService {

    @Scheduled(fixedRate = 60000)  // 每分钟检查一次
    public void checkConsistency() {
        List&lt;DataCenter&gt; dcs = dataCenterRegistry.getAll();

        for (String key : getReplicatedKeys()) {
            Map&lt;String, String&gt; checksums = new HashMap&lt;&gt;();

            for (DataCenter dc : dcs) {
                checksums.put(dc.getName(), dc.getChecksum(key));
            }

            Set&lt;String&gt; unique = new HashSet&lt;&gt;(checksums.values());
            if (unique.size() > 1) {
                log.error("数据不一致: key={}, checksums={}", key, checksums);
                alertInconsistency(key, checksums);
            }
        }
    }
}
```

## 架构设计要点

### 1. 数据分区

```java
/**
 * 按用户 ID 哈希分区
 */
public class HashPartitionStrategy implements PartitionStrategy {

    @Override
    public String getPrimaryDataCenter(String userId) {
        int hash = Math.abs(userId.hashCode());
        int index = hash % dataCenters.size();
        return dataCenters.get(index).getName();
    }
}

/**
 * 按地域分区
 */
public class GeoPartitionStrategy implements PartitionStrategy {

    private final Map&lt;String, String&gt; regionMapping = Map.of(
        "北京", "dc-north",
        "上海", "dc-east",
        "广州", "dc-south"
    );

    @Override
    public String getPrimaryDataCenter(String userId) {
        String region = userService.getUserRegion(userId);
        return regionMapping.getOrDefault(region, "dc-east");
    }
}
```

### 2. 单元化架构

```java
/**
 * 单元化：用户只能在固定的数据中心操作
 */
public class CellBasedArchitecture {

    public boolean canAccessDataCenter(String cellId, String targetCellId) {
        // 同单元可以直接访问
        if (cellId.equals(targetCellId)) {
            return true;
        }

        // 跨单元需要通过网关
        return false;
    }

    public Response processRequest(Request request) {
        String userCell = getUserCell(request.getUserId());

        if (canAccessDataCenter(userCell, request.getTargetCellId())) {
            return localDataCenter.process(request);
        }

        // 跨单元调用
        return crossCellProxy.forward(request, userCell);
    }
}
```

---

**思考题：**

1. 同城双活的两个机房之间网络中断了会发生什么？如何检测和处理这种「脑裂」情况？

2. 异地多活的 RTO 和 RPO 取决于什么？如何根据业务需求选择合适的多活架构？

3. 在三地五中心的架构中，如果两个数据中心同时出现故障，系统如何保证可用性？

4. 为什么大型互联网公司更倾向于选择「异地多活」而不是「同城双活 + 异地灾备」？各自的优缺点是什么？
