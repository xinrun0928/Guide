# Dubbo SPI：框架的「万能插座」

你有没有想过这个问题？

Dubbo 内置了多种负载均衡策略，但你写了一个自定义的「最热机器优先」策略，怎么让 Dubbo 认识它？

Spring 框架用 `@Autowired` 注入依赖，但 Dubbo 没有 Spring 也能跑，它是怎么找到实现的？

**答案就是 SPI（Service Provider Interface）。**

---

## 从 Java SPI 说起

### 什么是 SPI？

SPI（Service Provider Interface）是 Java 提供的一种服务发现机制。

```
核心思想：
├─ 接口定义者：定义接口规范
├─ 接口实现者：提供具体实现
└─ 服务使用者：通过约定发现实现
```

### Java SPI 示例

**Step 1：定义接口**

```java
// com.example.spi.OrderSerializer
package com.example.spi;

public interface OrderSerializer {
    byte[] serialize(Order order);
    Order deserialize(byte[] data);
}
```

**Step 2：创建实现**

```java
// com.example.spi.JsonSerializer
package com.example.spi;

public class JsonSerializer implements OrderSerializer {
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    @Override
    public byte[] serialize(Order order) {
        return objectMapper.writeValueAsBytes(order);
    }
    
    @Override
    public Order deserialize(byte[] data) {
        return objectMapper.readValue(data, Order.class);
    }
}
```

**Step 3：配置文件**

```
# META-INF/services/com.example.spi.OrderSerializer
com.example.spi.JsonSerializer
com.example.spi.ProtobufSerializer
com.example.spi.FastJsonSerializer
```

**Step 4：使用**

```java
// 通过 ServiceLoader 加载实现
ServiceLoader&lt;OrderSerializer&gt; loader = 
    ServiceLoader.load(OrderSerializer.class);

for (OrderSerializer serializer : loader) {
    System.out.println("发现实现: " + serializer.getClass().getName());
    // 使用第一个（按配置文件顺序）
}
```

### Java SPI 的问题

**问题一：没有分组概念**

所有实现都会被加载，无法按条件选择。

```java
// 想只用 Protobuf 实现，但 JSON 也被加载了
ServiceLoader&lt;OrderSerializer&gt; loader = 
    ServiceLoader.load(OrderSerializer.class);
// 得到的不是单个实现，而是全部实现
```

**问题二：无法按需加载**

只能全部加载或全部不加载，无法指定具体实现。

**问题三：无法自定义加载行为**

加载过程完全由 JVM 控制，无法扩展。

---

## Dubbo SPI 的改进

### Dubbo SPI 的核心改进

| 特性 | Java SPI | Dubbo SPI |
|-----|----------|-----------|
| 分组 | ❌ 不支持 | ✅ 支持 |
| 条件选择 | ❌ 不支持 | ✅ 支持 |
| 依赖注入 | ❌ 不支持 | ✅ 支持 |
| 懒加载 | ❌ 一次性全部加载 | ✅ 按需加载 |
| AOP | ❌ 不支持 | ✅ 支持 |
| 自适应扩展 | ❌ 不支持 | ✅ 支持 |

### Dubbo SPI 示例

**Step 1：定义接口（加上 @SPI 注解）**

```java
// org.apache.dubbo.common.bytecode.NoSuchAnnotationException
@SPI
public interface LoadBalance {
    // 选择一个 Invoker
    &lt;T&gt; Invoker&lt;T&gt; select(List&lt;Invoker&lt;T&gt;&gt; invokers);
}
```

**Step 2：创建实现类**

```java
// 目录：META-INF/dubbo/
// 文件：org.apache.dubbo.rpc.cluster.LoadBalance

// RandomLoadBalance
public class RandomLoadBalance extends AbstractLoadBalance {
    @Override
    protected &lt;T&gt; Invoker&lt;T&gt; doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers) {
        int length = invokers.size();
        return invokers.get(ThreadLocalRandom.current().nextInt(length));
    }
}

// RoundRobinLoadBalance
public class RoundRobinLoadBalance extends AbstractLoadBalance {
    // ...
}
```

**Step 3：配置文件**

```properties
# META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
random=org.apache.dubbo.rpc.cluster.loadbalance.RandomLoadBalance
roundrobin=org.apache.dubbo.rpc.cluster.loadbalance.RoundRobinLoadBalance
leastactive=org.apache.dubbo.rpc.cluster.loadbalance.LeastActiveLoadBalance
consistenthash=org.apache.dubbo.rpc.cluster.loadbalance.ConsistentHashLoadBalance
```

**Step 4：使用**

```java
// 通过 ExtensionLoader 加载
ExtensionLoader&lt;LoadBalance&gt; loader = 
    ExtensionLoader.getExtensionLoader(LoadBalance.class);

// 按名称加载指定实现
LoadBalance random = loader.getExtension("random");

// 按名称加载：轮询
LoadBalance roundRobin = loader.getExtension("roundrobin");

// 获取默认实现（@SPI 注解的值）
LoadBalance defaultImpl = loader.getDefaultExtension();
```

---

## Dubbo SPI 的高级特性

### 1. 自适应扩展（@Adaptive）

根据运行时参数自动选择实现：

```java
@SPI("random")
public interface LoadBalance {
    @Adaptive
    &lt;T&gt; Invoker&lt;T&gt; select(List&lt;Invoker&lt;T&gt;&gt; invokers, 
                            Invocation invocation);
}
```

**使用场景：**

```java
// 配置文件可以指定参数
random=org.apache.dubbo.rpc.cluster.loadbalance.RandomLoadBalance
roundrobin=org.apache.dubbo.rpc.cluster.loadbalance.RoundRobinLoadBalance

// 调用时指定使用哪个实现
@DubboReference(
    loadbalance = "roundrobin"  // 使用 roundrobin 实现
)
private OrderService orderService;

// 底层通过 URL 参数传递
// dubbo://...?loadbalance=roundrobin
```

### 2. 自动包装（Wrapper）

Wrapper 类用于在实现类周围添加通用逻辑：

```java
// 日志包装器
public class LoggerWrapper implements LoadBalance {
    private final LoadBalance delegate;  // 注入真实实现
    
    public LoggerWrapper(LoadBalance delegate) {
        this.delegate = delegate;
    }
    
    @Override
    public &lt;T&gt; Invoker&lt;T&gt; select(List&lt;Invoker&lt;T&gt;&gt; invokers, 
                                 Invocation invocation) {
        System.out.println("调用 LoadBalance.select，候选者数量: " 
            + invokers.size());
        
        Invoker&lt;T&gt; selected = delegate.select(invokers, invocation);
        
        System.out.println("选择了: " + selected.getUrl());
        return selected;
    }
}
```

**Dubbo 自动识别并包装：**

```
配置文件中：
random=org.apache.dubbo.xxx.RandomLoadBalance
roundrobin=org.apache.dubbo.xxx.RoundRobinLoadBalance

Dubbo 的 Wrapper 机制：
所有实现都会被 LoggerWrapper 包装一层
```

### 3. 依赖注入

Dubbo SPI 支持自动注入依赖：

```java
public class MySerializer implements OrderSerializer {
    
    // 自动注入 Logger
    private Logger logger;
    
    // 自动注入另一个 SPI 实例
    private Compressor compressor;
    
    // Dubbo 会自动注入这些依赖
    public void setLogger(Logger logger) {
        this.logger = logger;
    }
    
    public void setCompressor(Compressor compressor) {
        this.compressor = compressor;
    }
}
```

### 4. 激活机制（@Activate）

根据条件自动激活一组实现：

```java
// 所有 Cache 相关实现都可以被自动激活
@Activate(group = "cache")
public class LruCache implements Cache {
    // ...
}

// 只有在 group 匹配时才激活
@DubboReference(
    group = "cache",  // 只激活 cache 组的实现
    filter = "cache"
)
private ProductService productService;
```

---

## 实战：自定义负载均衡策略

### 需求

实现一个「最热机器优先」的负载均衡策略：优先选择调用次数最多的机器。

### Step 1：定义接口

```java
@SPI("random")
public interface LoadBalance {
    &lt;T&gt; Invoker&lt;T&gt; select(List&lt;Invoker&lt;T&gt;&gt; invokers, Invocation invocation);
}
```

### Step 2：实现策略

```java
// 统计调用次数（需要集群管理支持）
public class LeastInvocationLoadBalance extends AbstractLoadBalance {
    
    // 使用 ConcurrentHashMap 统计各机器的调用次数
    private final Map&lt;String, AtomicLong&gt; invocationCount = 
        new ConcurrentHashMap&lt;&gt;();
    
    @Override
    protected &lt;T&gt; Invoker&lt;T&gt; doSelect(List&lt;Invoker&lt;T&gt;&gt; invokers, 
                                        Invocation invocation) {
        Invoker&lt;T&gt; leastActiveInvoker = null;
        int leastActive = Integer.MAX_VALUE;
        long leastCount = Long.MAX_VALUE;
        
        for (Invoker&lt;T&gt; invoker : invokers) {
            // 获取活跃调用数
            int active = invoker.getUrl().getParameter(Constants.ACTIVES_KEY, 0);
            
            // 获取总调用次数
            String key = invoker.getUrl().toIdentityString();
            long count = invocationCount.computeIfAbsent(
                key, k -> new AtomicLong(0)
            ).get();
            
            // 选择标准：活跃数最少 + 总调用次数最少
            if (active < leastActive || 
                (active == leastActive && count < leastCount)) {
                leastActiveInvoker = invoker;
                leastActive = active;
                leastCount = count;
            }
        }
        
        // 增加调用计数
        if (leastActiveInvoker != null) {
            String key = leastActiveInvoker.getUrl().toIdentityString();
            invocationCount.get(key).incrementAndGet();
        }
        
        return leastActiveInvoker;
    }
}
```

### Step 3：注册实现

```properties
# META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
random=org.apache.dubbo.rpc.cluster.loadbalance.RandomLoadBalance
roundrobin=org.apache.dubbo.rpc.cluster.loadbalance.RoundRobinLoadBalance
leastactive=org.apache.dubbo.rpc.cluster.loadbalance.LeastActiveLoadBalance
consistenthash=org.apache.dubbo.rpc.cluster.loadbalance.ConsistentHashLoadBalance

# 新增自定义策略
leastreplication=com.example.LeastReplicationLoadBalance
```

### Step 4：使用

```java
@DubboReference(
    loadbalance = "leastreplication"  // 使用自定义策略
)
private OrderService orderService;
```

---

## Dubbo SPI 扩展点一览

Dubbo 的几乎所有组件都支持 SPI 扩展：

| 扩展点 | 说明 | 默认实现 |
|-------|-----|---------|
| `LoadBalance` | 负载均衡 | Random |
| `Cluster` | 集群容错 | Failover |
| `Router` | 路由策略 | ConditionRouter |
| `Protocol` | 协议 | DubboProtocol |
| `Serializer` | 序列化 | Hessian |
| `Transporter` | 网络传输 | Netty4 |
| `Registry` | 注册中心 | Zookeeper |
| `Configurator` | 配置 | AbsentConfigurator |
| `Filter` | 过滤器 | EchoFilter |

### Filter 扩展示例

```java
// 记录每次调用的日志
@Activate(group = Constants.PROVIDER)
public class LoggingFilter implements Filter {
    
    private Logger logger = LoggerFactory.getLogger(LoggingFilter.class);
    
    @Override
    public Result invoke(Invoker&lt;?&gt; invoker, Invocation invocation) {
        long start = System.currentTimeMillis();
        
        // 调用
        Result result = invoker.invoke(invocation);
        
        long elapsed = System.currentTimeMillis() - start;
        
        // 记录日志
        logger.info("调用 {} {}({}) 耗时 {}ms, 结果: {}", 
            invoker.getInterface().getSimpleName(),
            invocation.getMethodName(),
            Arrays.toString(invocation.getArguments()),
            elapsed,
            result.getException() == null ? "成功" : "失败"
        );
        
        return result;
    }
}
```

```properties
# META-INF/dubbo/org.apache.dubbo.rpc.Filter
logging=com.example.LoggingFilter
```

---

## 与 Spring IoC 的对比

| 特性 | Spring IoC | Dubbo SPI |
|-----|-----------|----------|
| 定位 | 应用级依赖管理 | 框架级扩展点 |
| 注解 | `@Bean` / `@Autowired` | `@SPI` / `@Activate` |
| 配置 | XML / Java Config | `META-INF/dubbo/*` |
| 范围 | 应用内 | 可跨应用 |
| 用途 | 业务 bean 管理 | 框架扩展 |

**Spring 管理业务对象，Dubbo SPI 管理框架扩展点。**

---

## 总结

| 特性 | 说明 |
|-----|-----|
| **@SPI** | 标记接口为可扩展 |
| **@Adaptive** | 根据 URL 参数动态选择实现 |
| **@Activate** | 根据条件自动激活 |
| **Wrapper** | 自动包装，添加通用逻辑 |
| **依赖注入** | 自动注入其他 SPI 实例 |

**Dubbo SPI 是 Dubbo 框架灵活性的基础，掌握它，你就能深度定制 Dubbo 的任何组件。**

---

## 留给你的问题

假设你需要为 Dubbo 添加一个「灰度发布」功能：

- 新版本服务只接受 10% 的流量
- 按用户 ID 哈希分流，保证用户体验一致
- 出现问题时可以快速回滚

**你会如何利用 Dubbo SPI 实现这个功能？需要扩展哪些扩展点？**

这个问题，可以结合 [RPC 负载均衡](/middleware/rpc/loadbalance) 来思考灰度路由的实现。
