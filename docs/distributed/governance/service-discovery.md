# 服务发现：客户端发现 vs 服务端发现

你有没有想过这个问题：

服务 A 需要调用服务 B，服务 A 怎么知道服务 B 的 IP 和 Port？

答案是：**服务发现**。

但具体怎么发现？两种主流方案：客户端发现和服务端发现。

## 服务发现的核心问题

分布式系统中，服务实例的网络位置是动态变化的：

```
1. 服务实例可能随时宕机
2. 服务实例可能扩缩容
3. 服务实例可能迁移到其他机器
```

消费者需要一个机制，来获取「当前可用」的服务实例列表。

## 客户端发现（Client-Side Discovery）

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                      Consumer                                │
│  ┌─────────────────┐                                        │
│  │  Service Client  │                                        │
│  │                  │                                        │
│  │  1. 查询注册中心 │                                        │
│  │  2. 获取实例列表 │                                        │
│  │  3. 负载均衡     │                                        │
│  └────────┬────────┘                                        │
└───────────┼─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│      注册中心            │
│   (Eureka / Nacos)     │
└─────────────────────────┘
```

消费者直接向注册中心查询服务列表，然后在客户端完成负载均衡。

### 典型实现：Netflix Eureka

```java
// Eureka 客户端
@Service
public class UserServiceClient {

    @Autowired
    private EurekaClient eurekaClient;

    public String callService() {
        // 1. 从 Eureka 获取服务实例列表
        InstanceInfo instance = eurekaClient.getNextServerFromEureka("order-service", false);

        // 2. 在客户端选择实例（负载均衡）
        String url = instance.getHomePageUrl() + "/api/orders";

        // 3. 调用服务
        return restTemplate.getForObject(url, String.class);
    }
}
```

### 优点

- **少一跳网络**：消费者直接连接服务提供者
- **更灵活**：消费者可以自己实现负载均衡策略
- **去中心化**：没有单点瓶颈

### 缺点

- **消费者变重**：需要集成服务发现客户端
- **升级复杂**：客户端升级需要所有消费者同步
- **语言绑定**：不同语言需要不同的客户端库

## 服务端发现（Server-Side Discovery）

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                      Consumer                                │
│  ┌─────────────────┐                                        │
│  │  Simple Client  │                                        │
│  │                  │                                        │
│  │  1. 发送请求     │                                        │
│  │  2. 等待响应     │                                        │
│  └────────┬────────┘                                        │
└───────────┼─────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│           Load Balancer                  │
│     (Nginx / HAProxy / AWS ELB)         │
│                                          │
│  1. 查询注册中心                         │
│  2. 选择实例                             │
│  3. 转发请求                             │
└────────────────────┬────────────────────┘
                     │
     ┌───────────────┼───────────────┐
     ▼               ▼               ▼
┌─────────┐    ┌─────────┐    ┌─────────┐
│实例 1   │    │实例 2   │    │实例 3   │
└─────────┘    └─────────┘    └─────────┘
```

消费者将请求发送给负载均衡器，负载均衡器查询注册中心并转发请求。

### 典型实现：Kubernetes Service

```yaml
# Kubernetes Service
apiVersion: v1
kind: Service
metadata:
  name: order-service
spec:
  selector:
    app: order
  ports:
    - protocol: TCP
      port: 80
      targetPort: 8080
```

```java
// 服务消费者只需访问 Service 名称
@RestController
public class UserController {

    @GetMapping("/order")
    public String getOrder() {
        // Kubernetes DNS 会解析 service name
        // kube-proxy 负责负载均衡
        return restTemplate.getForObject("http://order-service/api/orders", String.class);
    }
}
```

### 优点

- **消费者轻量**：不需要服务发现客户端
- **统一入口**：方便做流量管理和监控
- **跨语言**：任何语言都可以访问

### 缺点

- **多一跳网络**：请求经过负载均衡器
- **单点瓶颈**：负载均衡器可能成为瓶颈
- **依赖额外组件**：需要部署和维护负载均衡器

## DNS 能否做服务发现？

DNS 本身可以做服务发现，但有明显的局限性：

### DNS 的问题

```
1. DNS 不支持健康检查（传统 DNS）
2. DNS 缓存时间长，不适合快速扩缩容
3. DNS 不支持负载均衡（除非使用特殊记录类型）
4. DNS 记录变更传播慢
```

### DNS 的优势

```
1. 协议简单，所有语言都支持
2. 基础设施自带，不需要额外部署
3. 可以作为补充手段
```

### Kubernetes 的 DNS 服务发现

Kubernetes 扩展了 DNS，支持服务发现：

```bash
# 服务 DNS 名称
<service>.<namespace>.svc.<cluster-domain>

# 举例
order-service.default.svc.cluster.local

# 简写（同命名空间）
order-service
```

## 两种方案对比

| 维度 | 客户端发现 | 服务端发现 |
|------|-----------|-----------|
| 架构复杂度 | 消费者复杂 | 基础设施复杂 |
| 延迟 | 少一跳 | 多一跳 |
| 单点 | 无 | 负载均衡器 |
| 跨语言 | 需要多语言客户端 | 原生支持 |
| 负载均衡策略 | 灵活自定义 | 受限于 LB |
| 典型场景 | Netflix OSS | Kubernetes |

## 实际选型

### 选客户端发现的场景

- **微服务内部调用**：Netflix Eureka + Ribbon
- **Spring Cloud 全家桶**：Feign + Ribbon

### 选服务端发现的场景

- **Kubernetes 生态**：Service + kube-proxy
- **多语言混合架构**：Ingress + Service
- **统一流量入口**：API Gateway

### 大公司常见做法

```
Nginx（服务端 LB）+ Ribbon（客户端 LB）组合使用

Nginx：处理外部流量，做 SSL 终止、统一鉴权
Ribbon：处理内部流量，做细粒度负载均衡
```

## 总结

服务发现是分布式系统的基石：

- **客户端发现**：消费者直接查询注册中心，灵活但复杂
- **服务端发现**：通过负载均衡器转发，统一但多一跳
- **DNS**：简单但不完善，常作为补充

根据业务场景和技术栈，选择合适的方案。

**面试追问方向：**
- Eureka 和 Nacos 在服务发现上有什么区别？
- Kubernetes Service 是怎么做负载均衡的？
- 为什么 Eureka 停止维护后社区转向 Nacos？
- 如何实现跨命名空间的服务发现？