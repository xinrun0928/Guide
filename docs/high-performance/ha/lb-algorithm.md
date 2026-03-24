# 负载均衡算法详解

你的服务有 10 台服务器，10000 个请求同时涌来。

**问题来了：这 10000 个请求该怎么分配？**

全部打给第一台？那是压力测试，不是负载均衡。

轮流分发给每台？看起来公平，但如果机器配置不一样呢？

随机分配？听起来不错，但同一个用户的两次请求可能打到不同的服务器，导致会话丢失。

这就是负载均衡算法要解决的问题。

## 常见算法分类

负载均衡算法大体分两类：

- **静态算法**：不考虑后端服务器的实际负载状态
- **动态算法**：根据后端服务器的实际状态来分配请求

## 轮询（Round Robin）

最简单的算法，请求轮流分配给每台服务器。

### 原理

```
请求1 → Server A
请求2 → Server B
请求3 → Server C
请求4 → Server A
...（循环往复）
```

### Nginx 配置

```nginx
upstream backend {
    server 192.168.1.10;
    server 192.168.1.11;
    server 192.168.1.12;
}
```

### 加权轮询（Weighted Round Robin）

如果服务器配置不一样，可以给每台机器加权重。

```nginx
upstream backend {
    server 192.168.1.10 weight=5;   # 接收 5 个请求
    server 192.168.1.11 weight=2;   # 接收 2 个请求
    server 192.168.1.12 weight=3;   # 接收 3 个请求
}
```

### 特点

- **优点**：实现简单，无需状态，开销小
- **缺点**：无法感知后端真实负载，配置不均时可能打爆低配机器

## 随机（Random）

### 原理

随机选择一台服务器处理请求。数学上证明，当请求量足够大时，随机算法能够均匀分布。

### Nginx 配置

```nginx
upstream backend {
    random;
    server 192.168.1.10;
    server 192.168.1.11;
    server 192.168.1.12;
}
```

### 加权随机（Weighted Random）

```nginx
upstream backend {
    random two;
    server 192.168.1.10 weight=5;
    server 192.168.1.11 weight=2;
    server 192.168.1.12 weight=3;
}
```

### 特点

- **优点**：实现简单，负载分布均匀性好
- **缺点**：无法保证同一客户端的请求打到同一服务器

## 哈希（Hash）

### 原理

根据某个 Key（如客户端 IP）计算哈希值，然后映射到后端服务器。

```nginx
upstream backend {
    ip_hash;  # 基于客户端 IP 做哈希
    server 192.168.1.10;
    server 192.168.1.11;
    server 192.168.1.12;
}
```

### 自定义哈希 Key

```nginx
upstream backend {
    hash $request_uri consistent;  # consistent 开启一致性哈希
    server 192.168.1.10;
    server 192.168.1.11;
    server 192.168.1.12;
}
```

### 特点

- **优点**：同一 Key 的请求会打到同一服务器，适合有状态服务
- **缺点**：服务器扩容时，大面积 Key 重新映射，可能导致缓存失效

## 一致性哈希（Consistent Hash）

### 背景问题

普通哈希有个致命缺陷：服务器数量变化时，几乎所有 Key 都要重新映射。

假设原来：
```
hash("user_1001") % 3 = 1 → Server B
```

新增一台服务器后：
```
hash("user_1001") % 4 = ?  → 很可能不是 1 了
```

这意味着**缓存全部失效**。

### 一致性哈希原理

一致性哈希把哈希空间组织成一个环：

```
                    0
                   / \
                  /   \
                 /     \
                /       \
          2^32-1 ------> 0
                \       /
                 \     /
                  \   /
                   \ /
                    0
```

- 每台服务器映射到环上的一个位置
- 请求 Key 也映射到环上，顺时针找第一个服务器

### 新增节点的影响

假设新增 Server D：

```
原来 Server A 负责 [A→B] 区间的请求
新增 Server D 后，Server A 只负责 [A→D] 的部分
Server D 接管 [D→B] 的部分
只有小部分 Key 需要迁移
```

### Java 实现示例

```java
public class ConsistentHashRouter<T> {
    private final TreeMap<Long, T> ring = new TreeMap<>();
    private final HashFunction hashFunction;
    private final int virtualNodes;

    public ConsistentHashRouter(List<T> nodes, int virtualNodes) {
        this.virtualNodes = virtualNodes;
        this.hashFunction = HashAlgorithm.KETAMA_HASH;
        for (T node : nodes) {
            addNode(node);
        }
    }

    public void addNode(T node) {
        for (int i = 0; i < virtualNodes; i++) {
            long hash = hashFunction.hash(node.toString() + "#VN" + i);
            ring.put(hash, node);
        }
    }

    public void removeNode(T node) {
        for (int i = 0; i < virtualNodes; i++) {
            long hash = hashFunction.hash(node.toString() + "#VN" + i);
            ring.remove(hash);
        }
    }

    public T route(String key) {
        if (ring.isEmpty()) {
            throw new IllegalStateException("No nodes available");
        }
        long hash = hashFunction.hash(key);
        // 找到第一个大于等于 hash 的节点
        Map.Entry<Long, T> entry = ring.ceilingEntry(hash);
        // 如果没有，顺时针回到起点
        if (entry == null) {
            entry = ring.firstEntry();
        }
        return entry.getValue();
    }
}
```

### 虚拟节点的作用

虚拟节点让每台物理服务器在环上有多个位置，解决数据倾斜问题：

```
# 没有虚拟节点
Server A (性能差):  1 个位置
Server B (性能好):  1 个位置

# 有虚拟节点
Server A (性能差): 100 个虚拟节点
Server B (性能好): 100 个虚拟节点
Server C (性能好): 100 个虚拟节点
```

### 特点

- **优点**：服务器扩缩容时，Key 迁移范围小
- **缺点**：实现复杂，需要维护环结构

## 最小连接数（Least Connections）

### 原理

动态选择当前连接数最少的服务器。

```nginx
upstream backend {
    least_conn;  # 启用最小连接数算法
    server 192.168.1.10;
    server 192.168.1.11;
    server 192.168.1.12;
}
```

### Java 实现示例

```java
public class LeastConnectionsLoadBalancer<T> {
    private final Map<T, AtomicInteger> connectionCount = new ConcurrentHashMap<>();
    private final List<T> nodes;

    public LeastConnectionsLoadBalancer(List<T> nodes) {
        this.nodes = nodes;
        nodes.forEach(n -> connectionCount.put(n, new AtomicInteger(0)));
    }

    public T select() {
        T selected = null;
        int minConnections = Integer.MAX_VALUE;

        for (T node : nodes) {
            int current = connectionCount.get(node).get();
            if (current < minConnections) {
                minConnections = current;
                selected = node;
            }
        }

        if (selected != null) {
            connectionCount.get(selected).incrementAndGet();
        }

        return selected;
    }

    public void release(T node) {
        connectionCount.get(node).decrementAndGet();
    }
}
```

### 加权最小连接数

```nginx
upstream backend {
    least_conn;
    server 192.168.1.10 weight=5;
    server 192.168.1.11 weight=2;
    server 192.168.1.12 weight=3;
}
```

### 特点

- **优点**：能感知后端真实负载，适合长连接场景
- **缺点**：需要维护每台服务器的连接数，有一定开销

## 算法对比

| 算法 | 类型 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|----------|
| 轮询 | 静态 | 简单 | 不感知负载 | 无状态服务 |
| 随机 | 静态 | 均匀性好 | 可能有抖动 | 无状态服务 |
| 哈希 | 静态 | 会话保持 | 扩缩容影响大 | 有状态服务 |
| 一致性哈希 | 静态 | 扩缩容影响小 | 实现复杂 | 缓存层 |
| 最小连接 | 动态 | 感知真实负载 | 需维护状态 | 长连接服务 |

## 实际选型

### 无状态 HTTP 服务

推荐：加权轮询 + 七层负载均衡

```nginx
upstream backend {
    server 192.168.1.10 weight=5;
    server 192.168.1.11 weight=3;
    server 192.168.1.12 weight=2;
}

server {
    location / {
        proxy_pass http://backend;
        # 开启会话保持
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Redis 集群

推荐：一致性哈希（客户端）或 Twemproxy

### 数据库读写分离

推荐：加权轮询（写请求发主库，读请求发从库）

```nginx
upstream write_backend {
    server 192.168.1.10:3306;  # 主库
}

upstream read_backend {
    server 192.168.1.11:3306;  # 从库1
    server 192.168.1.12:3306;  # 从库2
}

server {
    # 写请求
    location /write {
        proxy_pass http://write_backend;
    }

    # 读请求
    location /read {
        proxy_pass http://read_backend;
        # 读从库允许一点延迟
        proxy_read_timeout 30s;
    }
}
```

---

**思考题：**

假设你有 3 台 Redis 缓存服务器，使用普通哈希取模做路由。某天业务暴涨，你需要扩容到 4 台服务器。

请计算：
1. 使用普通哈希，理论上会有多少比例的缓存失效？
2. 如果改用一致性哈希，数据迁移比例能降到多少？
3. 如果你用 150 个虚拟节点 per 物理节点，数据迁移的均匀性会提升多少？

实际工程中，一致性哈希真的是最优解吗？有没有更好的方案？
