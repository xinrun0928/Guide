# 客户端负载均衡 vs 服务端负载均衡

你有没有想过这个问题：

你去商场买东西，排队结账时，收银员说：「请去 3 号窗口结账」。

这就是**服务端负载均衡**——收银员（LB）决定你去哪个窗口。

如果收银员说：「你想去哪个窗口就去哪个窗口」，那这就是**客户端负载均衡**——你自己（客户端）决定去哪个窗口。

这两种方式各有优缺点，今天我们来聊聊。

## 服务端负载均衡（Server-Side Load Balancing）

### 工作原理

```
用户请求 → Nginx/HAProxy/F5 → 分发到后端服务器
```

负载均衡器是一个独立的组件，位于用户和服务器之间。

### 典型实现：Nginx

```nginx
upstream backend {
    server 192.168.1.1:8080 weight=3;
    server 192.168.1.2:8080 weight=3;
    server 192.168.1.3:8080 weight=1;
}

server {
    listen 80;

    location / {
        proxy_pass http://backend;
    }
}
```

### 典型实现：AWS ALB

```
用户 → AWS ALB → Target Group → EC2 实例
```

AWS ALB 支持：
- 基于路径的路由
- 基于主机名的路由
- 基于查询参数的路由

### 服务端 LB 的特点

**优点**：

- **消费者轻量**：不需要负载均衡逻辑
- **统一入口**：方便做 SSL 终止、统一鉴权、日志收集
- **跨语言**：任何语言都可以访问

**缺点**：

- **多一跳网络**：请求经过负载均衡器
- **单点瓶颈**：如果 LB 挂了，整个服务不可用
- **性能开销**：LB 需要处理所有流量

## 客户端负载均衡（Client-Side Load Balancing）

### 工作原理

```
用户请求 → 客户端（内置 LB 逻辑）→ 直接访问后端服务器
```

负载均衡逻辑嵌入在客户端中。

### 典型实现：Ribbon

```java
@Configuration
public class RibbonConfig {

    @Bean
    public IRule ribbonRule() {
        // 随机规则
        return new RandomRule();
        // 或加权轮询
        // return new WeightedResponseTimeRule();
        // 或一致性哈希
        // return new ZoneAvoidanceRule();
    }
}
```

```java
@RestController
public class UserController {

    @Autowired
    private RestTemplate restTemplate;

    @GetMapping("/users/{id}")
    public User getUser(@PathVariable Long id) {
        // Ribbon 会自动选择实例
        return restTemplate.getForObject(
            "http://user-service/users/" + id,
            User.class
        );
    }
}
```

### Ribbon 的工作原理

```java
public class RibbonLoadBalancer {

    // 1. 获取服务实例列表（从 Eureka/Nacos）
    public List&lt;Server&gt; getServers(String serviceId) {
        return discoveryClient.getInstances(serviceId);
    }

    // 2. 使用负载均衡策略选择实例
    public Server chooseServer(List&lt;Server&gt; servers) {
        IRule rule = new RoundRobinRule();
        return rule.choose(servers);
    }

    // 3. 直接访问选中的实例
    public Response callService(String serviceId, String path) {
        List&lt;Server&gt; servers = getServers(serviceId);
        Server selected = chooseServer(servers);
        return httpClient.call(selected.getHost(), selected.getPort(), path);
    }
}
```

### 客户端 LB 的特点

**优点**：

- **少一跳网络**：直接访问后端服务
- **更灵活**：可以自己实现复杂的负载均衡策略
- **去中心化**：没有 LB 单点问题

**缺点**：

- **消费者变重**：需要集成负载均衡组件
- **升级复杂**：客户端升级需要所有消费者同步
- **多语言支持**：不同语言需要不同的客户端库

## 两种方案的对比

| 维度 | 服务端 LB | 客户端 LB |
|------|-----------|-----------|
| 架构复杂度 | 基础设施复杂 | 消费者复杂 |
| 网络延迟 | 多一跳 | 少一跳 |
| 单点问题 | LB 可能成为瓶颈 | 无单点 |
| 跨语言支持 | 原生支持 | 需要多语言客户端 |
| 策略灵活性 | 受限于 LB | 可自定义 |
| 运维复杂度 | 低 | 高 |

## 实际选型

### 选服务端 LB 的场景

- **外部流量入口**：Nginx 处理外部请求
- **Kubernetes**：Ingress Controller + Service
- **多语言混合架构**：统一流量入口

### 选客户端 LB 的场景

- **微服务内部调用**：Ribbon + Feign
- **需要复杂策略**：自定义负载均衡算法
- **Spring Cloud 全家桶**：Feign + Ribbon

### 大公司常见做法

```
外部流量：Nginx（服务端 LB）
内部流量：Ribbon（客户端 LB）

Nginx 负责：
- SSL 终止
- 统一鉴权
- 请求日志
- 静态资源缓存

Ribbon 负责：
- 细粒度负载均衡
- 服务发现
- 重试机制
```

## Spring Cloud 中的 LB

### Feign + Ribbon

```java
@FeignClient(name = "user-service")
public interface UserClient {
    @GetMapping("/users/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

```yaml
# application.yml
user-service:
  ribbon:
    NFLoadBalancerRuleClassName: com.netflix.loadbalancer.RandomRule
```

### Spring Cloud LoadBalancer（Ribbon 替代）

```java
@FeignClient(name = "user-service")
public interface UserClient {
    @GetMapping("/users/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

```yaml
# application.yml
spring:
  cloud:
    loadbalancer:
      configurations: weighted
```

## 总结

服务端负载均衡和客户端负载均衡，各有适用场景：

- **服务端 LB**：外部流量入口，多语言支持
- **客户端 LB**：内部服务调用，策略灵活性

实际项目中，两者往往配合使用。

**面试追问方向：**
- Ribbon 和 Spring Cloud LoadBalancer 有什么区别？
- Nginx 和 Ribbon 能同时使用吗？
- 如何自定义 Ribbon 的负载均衡策略？
- 服务端 LB 如何实现高可用？