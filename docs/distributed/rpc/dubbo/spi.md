# Dubbo 过滤器链与扩展机制（SPI）

你有没有想过这个问题：

Dubbo 作为一个 RPC 框架，它是怎么支持这么多功能的？负载均衡、路由策略、序列化方式...这些都可以自由替换，它是怎么做到的？

答案就是 **SPI（Service Provider Interface）**。

今天，我们来彻底搞清楚 Dubbo 的 SPI 机制和过滤器链。

## 什么是 SPI？

SPI 的全称是 **Service Provider Interface**，是一种服务发现机制。

它的核心思想是：**框架定义接口，应用提供实现**。

### Java SPI 的问题

Java 自带了 SPI 机制（`ServiceLoader`），但它有几个明显的问题：

```java
// Java SPI 示例
ServiceLoader<Encoding> loader = ServiceLoader.load(Encoding.class);
for (Encoding encoding : loader) {
    encoding.encode("hello");
}
```

问题在于：

1. **一次性加载所有实现**：不管用不用，所有实现类都会被加载
2. **不支持懒加载**：无法按需加载
3. **不支持 IOC**：实现类之间的依赖需要自己处理
4. **不支持 AOP**：无法对实现类进行增强

### Dubbo SPI 的改进

Dubbo 在 Java SPI 的基础上做了大量改进：

```
┌─────────────────────────────────────────────────────────┐
│                 Dubbo SPI vs Java SPI                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Java SPI                Dubbo SPI                      │
│  ┌─────────┐            ┌─────────┐                    │
│  │一次性加载│            │按需加载 │                    │
│  │所有实现  │     →      │  懒加载 │                    │
│  └─────────┘            └─────────┘                    │
│                                                         │
│  ┌─────────┐            ┌─────────┐                    │
│  │无依赖注入│            │自动装配 │                    │
│  │  不支持  │     →      │   IOC   │                    │
│  └─────────┘            └─────────┘                    │
│                                                         │
│  ┌─────────┐            ┌─────────┐                    │
│  │  无增强 │            │ 过滤器链│                    │
│  │  不支持 │     →      │   AOP   │                    │
│  └─────────┘            └─────────┘                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Dubbo SPI 的使用

### 1. 定义接口

```java
// 标注为 SPI 扩展点
@SPI
public interface LoadBalance {

    /**
     * 选择一个 Invoker
     */
    <T> Invoker<T> select(List<Invoker<T>> invokers, URL url, Invocation invocation);
}
```

### 2. 定义实现

```java
// META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
random = org.apache.dubbo.rpc.cluster.loadbalance.RandomLoadBalance
roundrobin = org.apache.dubbo.rpc.cluster.loadbalance.RoundRobinLoadBalance
leastactive = org.apache.dubbo.rpc.cluster.loadbalance.LeastActiveLoadBalance
consistenthash = org.apache.dubbo.rpc.cluster.loadbalance.ConsistentHashLoadBalance
```

### 3. 使用

```java
LoadBalance loadBalance = ExtensionLoader
    .getExtensionLoader(LoadBalance.class)
    .getExtension("random");  // 获取随机负载均衡实现
```

## 自适应扩展：@Adaptive

Dubbo SPI 还有一个强大的特性：**自适应扩展**。

它的作用是：**根据运行时参数，自动选择合适的实现**。

### @Adaptive 注解

```java
@Adaptive
public interface Protocol {
    // 方法返回 Adaptive 实现
    @Adaptive
    <T> Exporter<T> export(Invoker<T> invoker);

    @Adaptive
    <T> Invoker<T> refer(Class<T> type, URL url);
}
```

### 工作原理

当你调用 `Protocol.export()` 时：

1. Dubbo 会根据 URL 中的 `protocol` 参数选择实现
2. `protocol=dubbo` → 选择 `DubboProtocol`
3. `protocol=rest` → 选择 `RestProtocol`

```java
// 使用自适应协议
URL url = URL.valueOf("dubbo://192.168.1.100:20880/com.example.UserService")
             .addParameter("protocol", "dubbo");

Protocol protocol = ExtensionLoader.getExtensionLoader(Protocol.class)
    .getAdaptiveExtension();

// 根据 URL 参数自动选择 DubboProtocol
Exporter exporter = protocol.export(invoker);
```

## 过滤器链：Dubbo 的 AOP

Dubbo 的过滤器链类似于 Servlet 的 Filter，每个请求都会经过一系列过滤器。

### 内置过滤器

| 过滤器 | 作用 |
|-------|------|
| EchoFilter | 回声测试，检测服务是否存活 |
| TokenFilter | 令牌认证，防止未授权访问 |
| AccessLogFilter | 记录访问日志 |
| ExceptionFilter | 统一异常处理 |
| TimeoutFilter | 超时日志记录 |
| MetricsFilter | 监控指标收集 |

### 过滤器执行顺序

```
请求进来 → EchoFilter → TokenFilter → ExceptionFilter → ... → 业务逻辑
                          ↓
响应回去 ← MetricsFilter ← TimeoutFilter ← AccessLogFilter ← ...
```

### 自定义过滤器

```java
// 实现 Filter 接口
@Activate(group = Constants.PROVIDER_GROUP, order = 1)
public class MyFilter implements Filter {

    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) throws RpcException {
        long startTime = System.currentTimeMillis();

        try {
            // 执行业务逻辑
            Result result = invoker.invoke(invocation);

            // 记录调用耗时
            long cost = System.currentTimeMillis() - startTime;
            if (cost > 1000) {
                logger.warn("Slow call: {} cost {}ms",
                           invocation.getMethodName(), cost);
            }

            return result;
        } finally {
            // 可以在这里做清理工作
        }
    }
}
```

### 注册过滤器

```java
// META-INF/dubbo/org.apache.dubbo.rpc.Filter
myFilter = com.example.MyFilter
```

### 使用过滤器

```java
// 在配置中引用
@DubboService(filter = "myFilter")
public class UserServiceImpl implements UserService { }

// 或全局配置
dubbo:
  provider:
    filter: myFilter
```

## Dubbo SPI 的核心应用场景

Dubbo 的核心组件几乎全部基于 SPI：

| 组件 | SPI 扩展点 | 默认实现 |
|-----|----------|---------|
| Protocol | 协议 | DubboProtocol |
| Cluster | 集群容错 | FailoverClusterInvoker |
| LoadBalance | 负载均衡 | RandomLoadBalance |
| Router | 路由 | ConditionRouter |
| Registry | 注册中心 | ZookeeperRegistry |
| Transporter | 网络传输 | NettyTransporter |
| Serialization | 序列化 | Hessian2Serialization |

### 替换默认实现

比如你想用 Nacos 作为注册中心：

```xml
<dubbo:registry
    address="nacos://127.0.0.1:8848"
    group="dubbo"
/>
```

Dubbo 会自动加载 `NacosRegistry`：

```java
// META-INF/dubbo/org.apache.dubbo.registry.Registry
nacos = org.apache.dubbo.registry.nacos.NacosRegistryFactory
```

## 完整示例：自定义负载均衡 + 过滤器

### 场景需求

实现一个自定义的「机房感知负载均衡」：优先选择同机房的 Provider。

### Step 1：定义负载均衡

```java
public class ZoneAwareLoadBalance extends AbstractLoadBalance {

    @Override
    protected <T> T doSelect(List<Invoker<T>> invokers, URL url, Invocation invocation) {
        // 获取 Consumer 的 zone
        String consumerZone = RpcContext.getContext().getAttachment("consumer.zone");

        if (consumerZone == null) {
            // 没有 zone 信息，使用默认负载均衡
            return selectByRandom(invokers);
        }

        // 筛选同 zone 的 Provider
        List<Invoker<T>> zoneInvokers = invokers.stream()
            .filter(inv -> consumerZone.equals(
                inv.getUrl().getParameter("zone")
            ))
            .collect(Collectors.toList());

        if (zoneInvokers.isEmpty()) {
            // 没有同 zone 的 Provider，使用默认
            return selectByRandom(invokers);
        }

        return selectByRandom(zoneInvokers);
    }
}
```

### Step 2：注册 SPI

```properties
# META-INF/dubbo/org.apache.dubbo.rpc.cluster.LoadBalance
zoneAware = com.example.ZoneAwareLoadBalance
```

### Step 3：添加过滤器设置 zone

```java
@Activate(group = Constants.CONSUMER_GROUP)
public class ZoneFilter implements Filter {

    @Override
    public Result invoke(Invoker<?> invoker, Invocation invocation) {
        // 从配置中获取机房信息
        String zone = System.getenv("DATACENTER_ZONE");
        RpcContext.getContext().setAttachment("consumer.zone", zone);

        return invoker.invoke(invocation);
    }
}
```

### Step 4：使用

```java
@Reference(
    loadbalance = "zoneAware",
    filter = "zoneFilter"
)
private UserService userService;
```

## 面试追问方向

- Dubbo 的 SPI 和 Java 的 SPI 有什么区别？为什么要自己实现？
- @Adaptive 是怎么实现的？方法级别的注解和方法体中的代码有什么区别？
- 过滤器链的执行顺序是怎么确定的？`@Activate` 的 `order` 参数有什么用？
- 如何实现一个「熔断降级」的过滤器？（提示：结合 Sentinel）

## 总结

Dubbo 的 SPI 机制是它的核心扩展能力：

```
┌─────────────────────────────────────────────────────────┐
│                   Dubbo SPI 体系                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  @SPI 注解 → 标记为扩展点                               │
│       ↓                                                 │
│  ExtensionLoader → 加载实现                             │
│       ↓                                                 │
│  @Adaptive → 自适应扩展                                 │
│       ↓                                                 │
│  过滤器链 → AOP 增强                                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Dubbo 的所有核心功能（Protocol、Cluster、LoadBalance、Router 等）都是基于 SPI 实现的。这种设计让 Dubbo 具有极强的扩展性——你可以替换任何一个组件，而不需要修改框架代码。

理解了这个机制，你才能真正掌握 Dubbo 的架构设计。
