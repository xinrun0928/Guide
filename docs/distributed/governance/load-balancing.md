# 负载均衡策略：轮询、随机、哈希、最小连接、加权

你有没有想过这个问题：

服务 A 有 3 个实例：

- 实例 1：4 核 CPU，扛得住
- 实例 2：8 核 CPU，性能更强
- 实例 3：2 核 CPU，弱一点

如果请求都平均分配给 3 个实例，那实例 3 肯定先扛不住。但实例 1 和实例 2 的能力又没充分利用。

这就是负载均衡策略要解决的问题。

## 为什么需要负载均衡策略

传统轮询的缺点：

```
- 不考虑服务器性能差异
- 不考虑当前负载情况
- 不考虑请求的处理时间
```

负载均衡策略的目标：

```
- 充分利用服务器资源
- 避免单点过载
- 提升整体吞吐量
```

## 七种负载均衡策略

### 1. 轮询（Round Robin）

最简单也最常用的策略，顺序循环分配请求。

```java
public class RoundRobinLoadBalancer {
    private AtomicInteger index = new AtomicInteger(0);

    public String select(List&lt;String&gt; servers) {
        int i = index.getAndIncrement() % servers.size();
        return servers.get(i);
    }
}
```

适用场景：服务器性能相近的简单场景。

### 2. 随机（Random）

随机选择一个服务器。

```java
public class RandomLoadBalancer {
    public String select(List&lt;String&gt; servers) {
        Random random = new Random();
        int index = random.nextInt(servers.size());
        return servers.get(index);
    }
}
```

适用场景：请求量足够大时，效果接近轮询。

### 3. 加权轮询（Weighted Round Robin）

根据服务器性能分配权重，权重高的分配更多请求。

```java
public class WeightedRoundRobinLoadBalancer {
    // 权重映射
    private Map&lt;String, Integer&gt; weights = Map.of(
        "server1", 4,  // 4 核
        "server2", 8,  // 8 核
        "server3", 2   // 2 核
    );

    public String select(List&lt;String&gt; servers) {
        int totalWeight = servers.stream()
            .mapToInt(s -> weights.getOrDefault(s, 1))
            .sum();

        int random = new Random().nextInt(totalWeight);
        int cumulative = 0;

        for (String server : servers) {
            cumulative += weights.getOrDefault(server, 1);
            if (random < cumulative) {
                return server;
            }
        }
        return servers.get(0);
    }
}
```

适用场景：服务器性能差异较大的场景。

### 4. 加权随机（Weighted Random）

```java
public class WeightedRandomLoadBalancer {
    private Map&lt;String, Integer&gt; weights = Map.of(
        "server1", 4,
        "server2", 8,
        "server3", 2
    );

    public String select(List&lt;String&gt; servers) {
        // 构建权重池
        List&lt;String&gt; weightedPool = new ArrayList&lt;&gt;();
        servers.forEach(s -> {
            int weight = weights.getOrDefault(s, 1);
            for (int i = 0; i < weight; i++) {
                weightedPool.add(s);
            }
        });
        return weightedPool.get(new Random().nextInt(weightedPool.size()));
    }
}
```

### 5. 最少连接（Least Connections）

选择当前连接数最少的服务器。

```java
public class LeastConnectionsLoadBalancer {
    private Map&lt;String, AtomicInteger&gt; connections = new ConcurrentHashMap&lt;&gt;();

    public String select(List&lt;String&gt; servers) {
        // 找到连接数最少的服务器
        return servers.stream()
            .min(Comparator.comparingInt(
                s -> connections.getOrDefault(s, new AtomicInteger(0)).get()
            ))
            .orElse(servers.get(0));
    }

    public void addConnection(String server) {
        connections.computeIfAbsent(server, k -> new AtomicInteger(0))
            .incrementAndGet();
    }

    public void removeConnection(String server) {
        AtomicInteger count = connections.get(server);
        if (count != null) {
            count.decrementAndGet();
        }
    }
}
```

适用场景：长连接场景，如数据库连接池、HTTP Keep-Alive。

### 6. 一致性哈希（Consistent Hash）

相同请求 key 打到同一服务器，适合缓存场景。

```java
public class ConsistentHashLoadBalancer {
    private final TreeMap&lt;Long, String&gt; ring = new TreeMap&lt;&gt;();
    private final HashFunction hashFunction = Hashing.murmur3_128();

    public ConsistentHashLoadBalancer(List&lt;String&gt; servers) {
        for (String server : servers) {
            // 每个服务器对应 1000 个虚拟节点
            for (int i = 0; i < 1000; i++) {
                long hash = hashFunction.hashString(server + "#" + i, Charsets.UTF_8).asLong();
                ring.put(hash, server);
            }
        }
    }

    public String select(String key) {
        long hash = hashFunction.hashString(key, Charsets.UTF_8).asLong();

        // 找到顺时针方向的第一个节点
        Map.Entry&lt;Long, String&gt; entry = ring.ceilingEntry(hash);
        if (entry == null) {
            entry = ring.firstEntry();
        }
        return entry.getValue();
    }
}
```

适用场景：缓存服务、Session 保持。

### 7. 源地址哈希（Source IP Hash）

相同 IP 的请求打到同一服务器。

```java
public class SourceIpHashLoadBalancer {
    public String select(List&lt;String&gt; servers, String clientIp) {
        int hash = clientIp.hashCode();
        int index = Math.abs(hash) % servers.size();
        return servers.get(index);
    }
}
```

适用场景：需要 Session 保持但无法使用 Cookie 的场景。

## Dubbo LoadBalance 实现

Dubbo 内置了 5 种负载均衡策略：

```java
public enum LoadBalance {
    RANDOM,      // 加权随机（默认）
    ROUNDROBIN,  // 加权轮询
    LEASTACTIVE, // 最少连接
    CONSISTENTHASH, // 一致性哈希
    SHORTESTRESPONSE // 最短响应时间
}
```

```xml
<!-- Dubbo 配置 -->
<dubbo:reference interface="com.example.UserService"
    loadbalance="roundrobin" />
```

## 负载均衡策略对比

| 策略 | 复杂度 | 考虑因素 | 适用场景 |
|------|-------|---------|---------|
| 轮询 | 简单 | 无 | 性能相近的服务器 |
| 随机 | 简单 | 无 | 请求量大 |
| 加权轮询 | 中等 | 权重 | 性能不均 |
| 加权随机 | 中等 | 权重 | 性能不均 |
| 最少连接 | 复杂 | 连接数 | 长连接 |
| 一致性哈希 | 复杂 | Key | 缓存、Session |
| 最短响应 | 复杂 | 响应时间 | 实时响应 |

## 总结

负载均衡策略是服务治理的核心组件：

- **轮询/随机**：简单高效，适合无状态服务
- **加权**：考虑服务器性能差异
- **最少连接**：考虑服务器当前负载
- **一致性哈希**：保证同一请求路由到同一服务器

选对策略，能显著提升系统的吞吐量和稳定性。

**面试追问方向：**
- 一致性哈希的虚拟节点是什么？解决什么问题？
- 最少连接策略如何实现？有什么缺点？
- 如何设计一个加权轮询算法？
- 负载均衡和 Ribbon 有什么关系？