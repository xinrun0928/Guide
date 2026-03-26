# Feign 负载均衡：Ribbon 集成

你有没有注意到一件事：

用 `@FeignClient` 定义接口时，你只写了服务名 `user-service`，没有写具体的 IP 和端口。

那调用的时候，Feign 是怎么知道应该请求哪台机器的？

答案就是 **Ribbon**。

今天，我们来搞清楚 Ribbon 的负载均衡机制，以及它和 Feign 的关系。

## Ribbon 是什么？

Ribbon 是 Netflix 开发的客户端负载均衡器。它在微服务架构中扮演着重要角色：

```
┌─────────────────────────────────────────────────────────┐
│                   Ribbon 负载均衡                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    ┌─────────┐                         │
│                    │ Consumer │                         │
│                    └────┬────┘                         │
│                         │                               │
│                         │ Feign 调用                    │
│                         ↓                               │
│   ┌─────────────────────────────────────────────────┐  │
│   │              Ribbon LoadBalancer                 │  │
│   │                                                 │  │
│   │  ┌─────────┐ ┌─────────┐ ┌─────────┐           │  │
│   │  │  Rule 1 │ │  Rule 2 │ │  Rule 3 │ ...      │  │
│   │  │ Random  │ │RoundRobin│ │ Weighted │       │  │
│   │  └─────────┘ └─────────┘ └─────────┘           │  │
│   └─────────────────────────────────────────────────┘  │
│                         │                               │
│                         │ 负载均衡选择                   │
│                         ↓                               │
│            ┌────────┬────────┬────────┐               │
│            ↓        ↓        ↓                           │
│       ┌────────┐┌────────┐┌────────┐                │
│       │Server 1 ││Server 2 ││Server 3 │                │
│       │192.168.1││192.168.2││192.168.3│                │
│       └─────────┘└─────────┘└─────────┘                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## Ribbon 的核心组件

Ribbon 由三个核心组件构成：

| 组件 | 作用 | 示例 |
|-----|------|-----|
| **ServerList** | 获取服务实例列表 | StaticServerList（静态）、DiscoveryEnabledNIWSServerList（Eureka） |
| **IPing** | 检测服务实例是否存活 | PingUrl（HTTP 检测）、NIWSDiscoveryPing |
| **IRule** | 负载均衡策略 | RoundRobinRule、RandomRule、WeightedResponseTimeRule |

## IRule 负载均衡策略

Ribbon 内置了多种负载均衡策略：

### 1. RoundRobinRule（轮询）

```java
// 默认策略，顺序遍历所有服务器
public class RoundRobinRule extends AbstractLoadBalancerRule {

    private AtomicInteger nextServerCyclicCounter;

    @Override
    public Server choose(ILoadBalancer lb, Object key) {
        if (lb == null) {
            return null;
        }

        List<Server> servers = lb.getReachableServers();
        int nextIndex = nextServerCyclicCounter.incrementAndGet() % servers.size();
        return servers.get(nextIndex);
    }
}
```

### 2. RandomRule（随机）

```java
public class RandomRule extends AbstractLoadBalancerRule {
    @Override
    public Server choose(ILoadBalancer lb, Object key) {
        return chooseRandom(lb.getReachableServers());
    }

    private Server chooseRandom(List<Server> servers) {
        if (servers.isEmpty()) {
            return null;
        }
        int randomIndex = ThreadLocalRandom.current().nextInt(servers.size());
        return servers.get(randomIndex);
    }
}
```

### 3. WeightedResponseTimeRule（加权响应时间）

根据服务器的平均响应时间分配权重，响应时间越短，权重越高，被选中的概率越大。

```java
public class WeightedResponseTimeRule extends RoundRobinRule {
    // 定时更新权重
    // 响应时间越短，权重越高
}
```

### 4. BestAvailableRule（最小并发数）

选择并发请求数最少的服务器。

```java
public class BestAvailableRule extends ClientConfigEnabledRoundRobinRule {
    @Override
    public Server choose(Object key) {
        // 选择并发数最小的服务器
    }
}
```

### 5. AvailabilityFilteringRule（可用性过滤）

先过滤掉以下服务器：
- 并发数过高（超过阈值）
- 连接失败的服务器

然后在剩余服务器中使用轮询。

### 6. ZoneAvoidanceRule（区域感知）

根据服务器所在区域（Zone）的可用性进行选择，避免单区域故障。

## Feign 如何使用 Ribbon

### 默认行为

在 OpenFeign 中，Ribbon 是**默认集成**的：

```yaml
# 你只需要配置服务发现，Ribbon 会自动工作
spring:
  cloud:
    discovery:
      client:
        simple:
          instances:
            user-service:
              - uri: http://192.168.1.101:8080
              - uri: http://192.168.1.102:8080
```

### Ribbon 配置

```yaml
# 服务名必须大写
user-service:
  ribbon:
    # 负载均衡策略
    NFLoadBalancerRuleClassName: com.netflix.loadbalancer.RoundRobinRule

    # 连接超时
    ConnectTimeout: 5000

    # 读取超时
    ReadTimeout: 10000

    # 最大重试次数
    MaxAutoRetries: 1

    # 同一服务其他实例的重试次数
    MaxAutoRetriesNextServer: 2

    # 是否对所有操作都重试
    OkToRetryOnAllOperations: false
```

## 自定义 Ribbon 策略

### 方式 1：配置文件

```yaml
# 针对特定服务配置
user-service:
  ribbon:
    NFLoadBalancerRuleClassName: com.example.CustomRule
```

### 方式 2：Java 配置

```java
@Configuration
public class RibbonConfig {

    @Bean
    public IRule ribbonRule() {
        // 自定义规则
        return new CustomRibbonRule();
    }
}

@FeignClient(name = "user-service", configuration = RibbonConfig.class)
public interface UserClient { }
```

### 自定义规则示例

```java
public class CustomRibbonRule extends AbstractLoadBalancerRule {

    @Override
    public Server choose(Object key) {
        return choose(getLoadBalancer(), key);
    }

    @Override
    public Server choose(ILoadBalancer lb, Object key) {
        if (lb == null) {
            return null;
        }

        Server server = null;
        int count = 0;

        while (count++ < 10) {
            List<Server> reachableServers = lb.getReachableServers();
            List<Server> allServers = lb.getAllServers();

            int upCount = reachableServers.size();
            if (upCount == 0) {
                return null;
            }

            // 自定义逻辑：优先选择健康的服务器
            int nextIndex = selectRandom(upCount);
            server = reachableServers.get(nextIndex);

            if (server == null) {
                Thread.yield();
                continue;
            }

            if (server.isAlive() && server.isReadyToServe()) {
                return server;
            }
        }

        return null;
    }
}
```

## Ribbon 组件详解

### ServerList：服务列表

```java
// 静态配置
@Configuration
public class StaticServerListConfig {

    @Value("${user-service.ribbon.listOfServers}")
    private String listOfServers;

    @Bean
    public ServerList<Server> staticServerList() {
        return new StaticServerList<>(
            new Server("http", 80, listOfServers)
        );
    }
}
```

### IPing：健康检查

```java
// 方式 1：HTTP Ping
@Configuration
public class PingUrlConfig {

    @Bean
    public IPing ribbonPing(IClientConfig config) {
        return new PingUrl(false, "/health");
    }
}

// 方式 2：不健康检查（手动下线）
@Configuration
public class NoOpPingConfig {

    @Bean
    public IPing ribbonPing() {
        return new NoOpPing();
    }
}
```

## Ribbon 与 Spring Cloud LoadBalancer

### 演进背景

2020 年后，Spring Cloud 官方宣布 **Ribbon 进入维护模式**，推荐使用 **Spring Cloud LoadBalancer**：

```
Ribbon（维护中）
    ↓
Spring Cloud LoadBalancer（推荐）
```

### 迁移方式

```xml
<!-- 排除 Ribbon -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-starter-netflix-ribbon</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<!-- 使用 LoadBalancer -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-loadbalancer</artifactId>
</dependency>
```

### Spring Cloud LoadBalancer 配置

```java
// 自定义负载均衡策略
@Configuration
public class CustomLoadBalancerConfig {

    @Bean
    public ReactorLoadBalancer<ServiceInstance> randomLoadBalancer(
            ServiceInstanceListSupplier supplier) {
        return new RandomLoadBalancer(supplier);
    }
}

// 使用
@LoadBalancerClient(name = "user-service",
                   configuration = CustomLoadBalancerConfig.class)
@FeignClient(name = "user-service")
public interface UserClient { }
```

## 面试追问方向

- Ribbon 的负载均衡是怎么获取服务列表的？（Eureka/配置文件）
- Ribbon 的健康检查是怎么实现的？心跳机制是什么？
- Ribbon 和 Nginx（服务端负载均衡）有什么区别？
- 如何实现一个「灰度发布」的 Ribbon 策略？

## 总结

Ribbon 是 Feign 的「眼睛」，让它知道该把请求发到哪台机器：

```
┌─────────────────────────────────────────────────────────┐
│              Ribbon + Feign 调用链                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  @FeignClient("user-service")                          │
│         ↓                                               │
│  Feign 请求拦截器                                       │
│         ↓                                               │
│  Ribbon LoadBalancer                                    │
│         ↓                                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │ 1. ServerList：获取服务器列表                     │   │
│  │ 2. IPing：检测服务器健康状态                      │   │
│  │ 3. IRule：根据策略选择服务器                       │   │
│  └─────────────────────────────────────────────────┘   │
│         ↓                                               │
│  HTTP Client 发送请求                                   │
│         ↓                                               │
│  返回响应                                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

理解 Ribbon 的工作原理，对于排查负载均衡问题和进行服务治理非常重要。
