# XXL-Job 路由策略

想象一个场景：你的订单同步任务，需要处理 1000 万条数据。

单机执行需要 10 个小时，但你只有 10 个小时的时间窗口。

怎么办？

**答案是：分片执行**。

但在此之前，你需要先理解 XXL-Job 的路由策略——它决定了「任务发给哪个执行器」。

## 什么是路由策略？

```
┌─────────────────────────────────────────────────────────────┐
│                    路由策略的作用                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   调度中心                                                  │
│       │                                                     │
│       │ 路由策略：选择执行器                                  │
│       ▼                                                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │ 执行器1  │  │ 执行器2  │  │ 执行器3  │                 │
│   │ (10:00) │  │ (10:00) │  │ (10:00) │                 │
│   └──────────┘  └──────────┘  └──────────┘                 │
│                                                             │
│   不同的路由策略，任务会发到不同的执行器                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## XXL-Job 支持的路由策略

| 策略 | 说明 | 图示 |
|---|---|---|
| FIRST | 第一个注册的执行器 | 🏃 永远第一个 |
| LAST | 最后一个注册的执行器 | 🏃 永远最后 |
| ROUND | 轮询 | 🔄 1→2→3→1→2→3 |
| RANDOM | 随机 | 🎲 随机选择 |
| CONSISTENT_HASH | 一致性哈希 | 🍎 相同参数 → 相同执行器 |
| LEAST_LOADED | 最少负载 | ⚖️ 选择任务最少的 |
| FAILOVER | 失败自动切换 | 🔄A失败→B |
| BUSY_OVER | 繁忙跳过 | ⏭️ 忙就跳过 |
| SHARDING | 分片广播 | 📢 所有执行器同时执行 |

## 详解各种策略

### FIRST：第一个

永远选择第一个注册的执行器。

```java
// 伪代码实现
public class FirstRouter {
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList) {
        // 按注册顺序，第一个就是最小的
        return addressList.stream()
            .min(Comparator.comparing(ExecutorAddress::getRegistryTime))
            .orElse(null);
    }
}
```

**使用场景**：
- 测试环境，固定使用某台机器
- 单机执行需求

```
执行器注册顺序：Server1 → Server2 → Server3
任务触发：永远发送到 Server1
```

### LAST：最后一个

永远选择最后一个注册的执行器。

**使用场景**：
- 灰度发布，先用新机器执行
- 特殊业务需求

### ROUND：轮询

依次选择每个执行器，循环往复。

```java
public class RoundRouter {
    
    private AtomicInteger index = new AtomicInteger(0);
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList) {
        int i = index.getAndIncrement() % addressList.size();
        return addressList.get(i);
    }
}
```

**使用场景**：
- 负载均衡
- 批量数据处理

```
触发第1次：Server1
触发第2次：Server2
触发第3次：Server3
触发第4次：Server1（循环）
```

### RANDOM：随机

随机选择一个执行器。

```java
public class RandomRouter {
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList) {
        int i = new Random().nextInt(addressList.size());
        return addressList.get(i);
    }
}
```

**使用场景**：
- 负载均衡
- 减少单点压力

### CONSISTENT_HASH：一致性哈希

相同参数的任务，路由到相同的执行器。

```java
public class ConsistentHashRouter {
    
    private final TreeMap&lt;Long, ExecutorAddress&gt; ring = new TreeMap&lt;&gt;();
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList, String param) {
        // 计算参数的一致性哈希值
        long hash = hash(param);
        
        // 找到大于等于 hash 的第一个节点
        Map.Entry&lt;Long, ExecutorAddress&gt; entry = ring.ceilingEntry(hash);
        
        // 如果没有，就取第一个（环形）
        if (entry == null) {
            entry = ring.firstEntry();
        }
        
        return entry.getValue();
    }
}
```

**使用场景**：
- 分片任务，保证同一分片数据一致
- 缓存友好，避免重复处理

```
任务参数=order_100 → Server1
任务参数=order_101 → Server1
任务参数=order_200 → Server2

同一参数，永远路由到同一执行器
```

### LEAST_LOADED：最少负载

选择当前正在执行任务最少的执行器。

```java
public class LeastLoadedRouter {
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList) {
        return addressList.stream()
            .min(Comparator.comparing(ExecutorAddress::getRunningTaskCount))
            .orElse(null);
    }
}
```

**使用场景**：
- 动态负载均衡
- 执行器性能不一致

```
Server1：正在执行 5 个任务
Server2：正在执行 2 个任务 ← 选择这个
Server3：正在执行 8 个任务
```

### FAILOVER：失败自动切换

当执行器执行失败时，自动切换到下一个执行器重试。

```java
public class FailoverRouter {
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList, int startIndex) {
        // 从 startIndex 开始尝试
        for (int i = startIndex; i < addressList.size(); i++) {
            ExecutorAddress address = addressList.get(i);
            if (isAlive(address)) {
                return address;
            }
        }
        return null;
    }
}
```

**使用场景**：
- 高可用场景
- 容错处理

### BUSY_OVER：繁忙跳过

如果执行器正在执行任务，跳过它，选择下一个。

```java
public class BusyOverRouter {
    
    public ExecutorAddress doRoute(List&lt;ExecutorAddress&gt; addressList) {
        for (ExecutorAddress address : addressList) {
            if (!isBusy(address)) {  // 如果不繁忙
                return address;
            }
        }
        return null;  // 所有都繁忙
    }
}
```

**使用场景**：
- 避免过载
- 快速失败

### SHARDING：分片广播

所有在线的执行器同时执行，每个执行器处理部分数据。

这是实现**任务分片**的关键！

```
┌─────────────────────────────────────────────────────────────┐
│                    分片广播原理                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   任务配置：分片数 = 3                                       │
│                                                             │
│   调度中心                                                  │
│       │                                                     │
│       │ 同时发送给所有执行器                                  │
│       ▼                                                     │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐                 │
│   │ Server1 │  │ Server2 │  │ Server3 │                 │
│   │ shard=0 │  │ shard=1 │  │ shard=2 │                 │
│   │ [处理1/3]│  │ [处理1/3]│  │ [处理1/3]│                 │
│   └──────────┘  └──────────┘  └──────────┘                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

代码示例：

```java
@Component
public class ShardingJob extends XxlJobSimpleJob {
    
    @Override
    public void execute() throws Exception {
        // 获取分片参数
        int shardIndex = getShardingIndex();  // 当前执行器的分片序号
        int shardTotal = getShardingTotal();  // 总分片数
        
        log.info("开始执行分片任务：第 {} 片，共 {} 片", shardIndex, shardTotal);
        
        // 根据分片参数处理数据
        // 例如：shardIndex=0, shardTotal=3 → 处理 ID % 3 == 0 的数据
        //       shardIndex=1, shardTotal=3 → 处理 ID % 3 == 1 的数据
        //       shardIndex=2, shardTotal=3 → 处理 ID % 3 == 2 的数据
        
        List&lt;Order&gt; orders = orderService.getOrdersByShard(shardIndex, shardTotal);
        
        for (Order order : orders) {
            processOrder(order);
        }
        
        log.info("分片任务执行完成：第 {} 片，处理 {} 条数据", shardIndex, orders.size());
    }
}
```

## 分片广播实战

### 数据分片

```java
public List&lt;Order&gt; getOrdersByShard(int shardIndex, int shardTotal) {
    // 使用取模分片
    return jdbcTemplate.query(
        "SELECT * FROM orders WHERE id % ? = ? AND status = ?",
        (rs, rowNum) -> toOrder(rs),
        shardTotal, shardIndex, "PENDING"
    );
}
```

### 效果对比

| 方案 | 3台服务器处理 900万数据 | 耗时 |
|---|---|---|
| 单机执行 | Server1 单独处理 900万 | ~10 小时 |
| 分片执行 | 每台处理 300万 | ~3.3 小时 |

```
分片前：
┌────────────────────────────────────────────────────────────┐
│ Server1: [████████████████████████████████] 900万条，10小时 │
└────────────────────────────────────────────────────────────┘

分片后：
┌────────────────────────────────────────────────────────────┐
│ Server1: [████████] 300万条，3.3小时                        │
│ Server2: [████████] 300万条，3.3小时                        │
│ Server3: [████████] 300万条，3.3小时                        │
│ 时间:              ↓ 并行执行 ↓                             │
│                总耗时 3.3 小时！                             │
└────────────────────────────────────────────────────────────┘
```

## 路由策略对比

| 策略 | 负载均衡 | 任务一致 | 容错 | 适用场景 |
|---|---|---|---|---|
| FIRST | ❌ | ❌ | ❌ | 测试、单机 |
| LAST | ❌ | ❌ | ❌ | 灰度 |
| ROUND | ✅ | ❌ | ❌ | 轮询任务 |
| RANDOM | ✅ | ❌ | ❌ | 随机任务 |
| CONSISTENT_HASH | ✅ | ✅ | ❌ | 分片、缓存 |
| LEAST_LOADED | ✅ | ❌ | ❌ | 动态负载 |
| FAILOVER | ✅ | ❌ | ✅ | 高可用 |
| BUSY_OVER | ✅ | ❌ | ❌ | 防过载 |
| SHARDING | ✅ | ✅ | ✅ | 大数据 |

## 总结

| 场景 | 推荐策略 |
|---|---|
| 简单定时任务 | ROUND |
| 大数据分片 | SHARDING |
| 保证数据一致性 | CONSISTENT_HASH |
| 高可用容错 | FAILOVER |
| 避免过载 | BUSY_OVER |
| 动态负载均衡 | LEAST_LOADED |

## 思考题

假设有 3 个执行器，执行器 1 和 2 很忙，执行器 3 很空闲。

如果任务配置的是 SHARDING 策略，分片数设置为 2，会发生什么？

执行器 3 能分担执行器 1 和 2 的压力吗？

这个问题涉及到分片数和执行器数的关系。
