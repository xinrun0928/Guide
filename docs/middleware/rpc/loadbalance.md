# 负载均衡：客户端还是服务端？

「我们的服务部署了 3 台机器，怎么让调用方均衡地访问它们？」

方案 A：在调用方写轮询逻辑
方案 B：加一个 Nginx 做负载均衡
方案 C：用 RPC 框架内置的负载均衡

看起来都是负载均衡，但背后的原理和效果完全不同。

**选错方案，轻则浪费资源，重则拖垮整个系统。**

---

## 先理解两个核心概念

### 什么是负载均衡？

负载均衡（Load Balancing）是把请求分散到多个服务实例的技术，目的是：
- 提高系统吞吐量
- 避免单点过载
- 提升系统可用性

### 客户端负载均衡 vs 服务端负载均衡

```
┌─────────────────────────────────────────────────────┐
│                   客户端负载均衡                       │
│                                                     │
│  ┌────────┐    ┌────────┐    ┌────────┐             │
│  │服务实例A│    │服务实例B│    │服务实例C│             │
│  └────────┘    └────────┘    └────────┘             │
│       ▲             ▲             ▲                │
│       │             │             │                │
│       └─────────────┼─────────────┘                │
│                     │                              │
│              ┌──────┴──────┐                       │
│              │   客户端    │                       │
│              │ (选择实例)  │                       │
│              └────────────┘                       │
│                                                     │
│  代表：Dubbo（默认）、Feign+Ribbon                   │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                   服务端负载均衡                     │
│                                                     │
│  ┌────────┐    ┌────────┐    ┌────────┐             │
│  │服务实例A│    │服务实例B│    │服务实例C│             │
│  └────────┘    └────────┘    └────────┘             │
│                     ▲                              │
│                     │                              │
│              ┌──────┴──────┐                       │
│              │    Nginx    │                       │
│              │ (选择实例)  │                       │
│              └─────────────┘                       │
│                     ▲                              │
│                     │                              │
│              ┌─────┴─────┐                        │
│              │   客户端   │                        │
│              └───────────┘                        │
│                                                     │
│  代表：Nginx、HAProxy、云厂商 LB                     │
└─────────────────────────────────────────────────────┘
```

---

## 客户端负载均衡

### 工作原理

客户端持有所有服务实例列表，根据负载均衡策略选择一台进行调用。

```
客户端                          服务端
  │                               │
  │  ① 注册中心订阅                │
  ├───────────────────────────────▶│
  │  返回服务实例列表               │
  │  [192.168.1.10:8080]          │
  │  [192.168.1.11:8080]          │
  │  [192.168.1.12:8080]          │
  ◀───────────────────────────────┤
  │                               │
  │  ② 调用时，根据策略选择          │
  │     策略：轮询/随机/加权...     │
  │  选择：192.168.1.11:8080       │
  │                               │
  │  ③ 发起调用                   │
  ├──────────────────────────────▶│
  │                               │
```

### Dubbo 的客户端负载均衡

Dubbo 内置了多种负载均衡策略：

```java
// Dubbo 负载均衡配置
@DubboReference(
    loadbalance = "random"  // 可选：random/roundrobin/leastactive/consistanthash
)
private OrderService orderService;
```

**Dubbo 内置的负载均衡策略：**

| 策略 | 原理 | 适用场景 |
|-----|-----|---------|
| `random` | 加权随机 | 默认，最常用 |
| `roundrobin` | 加权轮询 | 需要顺序的场景 |
| `leastactive` | 最少活跃调用 | 响应时间敏感 |
| `consistenthash` | 一致性哈希 | 有缓存的场景 |

### 随机策略实现

```java
// 加权随机负载均衡实现
public class RandomLoadBalance extends AbstractLoadBalance {
    
    @Override
    protected &lt;T&gt; doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, URL url, Invocation invocation) {
        int length = invokers.size();
        boolean sameWeight = true;
        int[] weights = new int[length];
        int totalWeight = 0;
        
        // 计算每个实例的权重
        for (int i = 0; i &lt; length; i++) {
            int weight = getWeight(invokers.get(i), invocation);
            totalWeight += weight;
            weights[i] = totalWeight;
            
            // 检查权重是否相同
            if (sameWeight && i > 0 && weight != weights[i - 1]) {
                sameWeight = false;
            }
        }
        
        if (totalWeight > 0 && !sameWeight) {
            // 不等权随机：用 Math.random() * totalWeight
            int offset = ThreadLocalRandom.current().nextInt(totalWeight);
            for (int i = 0; i &lt; length; i++) {
                if (offset < weights[i]) {
                    return invokers.get(i);
                }
            }
        }
        
        // 等权随机
        return invokers.get(ThreadLocalRandom.current().nextInt(length));
    }
}
```

### 一致性哈希策略

对于有缓存的场景，一致性哈希可以保证相同参数的请求打到同一台机器：

```java
// 一致性哈希负载均衡实现
public class ConsistentHashLoadBalance extends AbstractLoadBalance {
    
    private final ConcurrentMap&lt;String, ConsistentHashSelector&gt; selectors = 
        new ConcurrentHashMap&lt;&gt;();
    
    @Override
    protected &lt;T&gt; Invoker&lt;T&gt; doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, 
                                      URL url, Invocation invocation) {
        String methodName = invocation.getMethodName();
        int identityHashCode = System.identityHashCode(invokers);
        
        // 获取或创建 Selector
        ConsistentHashSelector&lt;T&gt; selector = selectors.get(methodName);
        if (selector == null || selector.identityHashCode != identityHashCode) {
            selector = new ConsistentHashSelector&lt;&gt;(invokers, methodName, identityHashCode);
            selectors.put(methodName, selector);
        }
        
        // 根据参数选择实例
        return selector.select(invocation.getArguments());
    }
}
```

---

## 服务端负载均衡

### 工作原理

服务端（或中间件）持有所有服务实例列表，客户端把请求发给负载均衡器，由它选择实例转发。

```
客户端                          Nginx                         服务端
  │                               │                            │
  │  ① 发起请求                    │                            │
  ├───────────────────────────────▶│                            │
  │                               │                            │
  │  ② Nginx 选择实例              │                            │
  │     (轮询/加权/最小连接...)    │                            │
  │     选择：192.168.1.11:8080    │                            │
  │                               │                            │
  │                               │  ③ 转发请求                  │
  │                               ├────────────────────────────▶│
  │                               │                            │
  │  ④ 返回响应                    │                            │
  │  ◀────────────────────────────┤                            │
  │                               │                            │
```

### Nginx 负载均衡配置

```nginx
upstream order-service {
    # 加权轮询（默认）
    server 192.168.1.10:8080 weight=5;
    server 192.168.1.11:8080 weight=3;
    server 192.168.1.12:8080 weight=2;
    
    # 最少连接
    # least_conn;
    
    # IP 哈希（会话保持）
    # ip_hash;
}

server {
    listen 80;
    
    location /api/orders {
        proxy_pass http://order-service;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 常用 Nginx 策略

| 策略 | 原理 | 适用场景 |
|-----|-----|---------|
| 轮询（Round Robin） | 依次分配 | 无状态服务 |
| 加权轮询（Weighted） | 按权重分配 | 机器配置不同 |
| 最少连接（Least Conn） | 分配给连接最少的 | 长连接场景 |
| IP 哈希（IP Hash） | 按客户端 IP 哈希 | 会话保持 |
| 响应时间（Least Time） | 分配给响应最快的 | Nginx Plus |

---

## 客户端 vs 服务端：深度对比

| 对比维度 | 客户端 LB | 服务端 LB |
|---------|----------|-----------|
| **延迟** | 无额外延迟 | 多一跳网络转发 |
| **单点故障** | 无（去中心化） | 有（Nginx 挂了全挂） |
| **配置复杂度** | 高（SDK 集成） | 低（配置 Nginx） |
| **策略灵活性** | 高（可自定义） | 中等 |
| **监控运维** | 难（分散在各客户端） | 易（集中） |
| **适用场景** | 微服务内部 | 外部网关入口 |

### 延迟分析

```
客户端负载均衡：
客户端 ────────────────────▶ 服务端
     1. 直接调用，无额外跳数

服务端负载均衡：
客户端 ────────▶ Nginx ─────▶ 服务端
               多一跳网络转发
```

**在微服务内部，建议使用客户端负载均衡，减少不必要的网络跳数。**

### 单点故障分析

```
服务端 LB 问题：
                          Nginx（单点）
                             ╳
┌────────┐               ┌────────┐
│ 客户端 A │ ────────▶     │ 客户端 B │
└────────┘               └────────┘
    │                        │
    ╳                        ╳
┌────────┐               ┌────────┐
│ 客户端 C │               │ 客户端 D │
└────────┘               └────────┘
所有客户端都无法访问服务端

客户端 LB 问题：
各客户端独立选择，任意一台客户端挂了不影响其他
```

---

## 混合使用：最佳实践

### 典型架构

```
                    ┌─────────────────┐
                    │    云厂商 LB     │  ← 服务端负载均衡，入口
                    │  (SLB/ALB)       │
                    └────────┬────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
              ┌─────┴─────┐      ┌────┴────┐
              │  Nginx    │      │ Gateway │
              │  (可选)   │      │         │
              └─────┬─────┘      └────┬────┘
                    │                 │
        ┌───────────┼─────────────────┼───────────┐
        │           │                 │           │
   ┌────┴────┐ ┌───┴───┐         ┌────┴────┐ ┌───┴───┐
   │服务实例 A │ │服务B  │         │服务实例 C │ │服务 D  │
   └─────────┘ └───────┘         └─────────┘ └───────┘
        ↑           ↑                   ↑           ↑
        │           │                   │           │
        └───────────┴───────────────────┴───────────┘
                      │
              ┌───────┴───────┐
              │  客户端负载均衡  │
              │ Dubbo/Feign    │
              └───────────────┘
```

### 各层职责

| 层级 | 负载均衡类型 | 职责 |
|-----|------------|-----|
| **入口层** | 云厂商 LB | 公网流量入口，可用性保障 |
| **网关层** | Nginx/Gateway | 统一入口，协议转换 |
| **服务层** | 客户端 LB | 微服务间调用，去中心化 |

---

## 高级特性

### 1. 区域感知

优先调用同可用区的实例，减少跨区延迟：

```java
// Dubbo 区域感知配置
@DubboReference(
    cluster = "zone-aware",
    parameters = {
        "zone": "us-west-1a",
        "fallback.zone": "us-west-1b"
    }
)
private OrderService orderService;
```

### 2. 权重动态调整

根据实例负载动态调整权重：

```java
// 自适应权重负载均衡
public class AdaptiveLoadBalance extends AbstractLoadBalance {
    
    @Override
    protected &lt;T&gt; Invoker&lt;T&gt; doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, 
                                      URL url, Invocation invocation) {
        for (Invoker&lt;T&gt; invoker : invokers) {
            // 获取实例当前负载
            int active = invoker.getActive();
            int weight = invoker.getWeight();
            
            // 负载越高，有效权重越低
            // effectiveWeight = weight / (active + 1)
            int effectiveWeight = weight / (active + 1);
        }
        // 选择 effectiveWeight 最高的
    }
}
```

### 3. 熔断与降级

```java
// Dubbo 熔断配置
@DubboReference(
    cluster = "failover",
    retries = 2,  // 失败后重试次数
    methods = {
        @Method(
            name = "getOrder",
            timeout = 3000,
            actives = 10  // 最大并发调用数
        )
    }
)
private OrderService orderService;
```

---

## 总结

| 场景 | 推荐方案 |
|-----|---------|
| 微服务内部调用 | 客户端负载均衡（Dubbo/Feign） |
| API 网关入口 | 服务端负载均衡（Nginx/云 LB） |
| 有状态服务 | 一致性哈希（客户端） |
| 跨区域调用 | 区域感知 + 分级负载均衡 |

**没有最好的方案，只有最适合的方案。理解原理，才能做出正确的选择。**

---

## 留给你的问题

假设你的系统有以下特点：

- 5 个微服务，每个服务部署 10 个实例
- 服务间调用链路复杂，存在循环调用
- 需要支持蓝绿部署和灰度发布

**在这种情况下，你会选择哪种负载均衡策略？如何实现灰度发布时的流量控制？**

这个问题，可以结合 [RPC 超时控制与重试机制](/middleware/rpc/timeout-retry) 来思考如何保证调用的可靠性。
