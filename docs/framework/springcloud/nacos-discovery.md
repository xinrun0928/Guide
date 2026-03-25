# Nacos 服务注册与发现

> 订单服务调用用户服务，IP 地址硬编码了 3 个，结果用户服务今天扩容了 5 个新实例——你的订单服务还在用旧 IP 调用，超时、报错、一脸懵。
>
> 服务注册与发现，就是来解决这个问题的。

---

## 一个经典的坑

假设有这样的场景：

```java
// 订单服务直接调用用户服务
@RestController
public class OrderController {
    
    @GetMapping("/order/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        // 硬编码用户服务地址 —— 这是灾难的开始
        String url = "http://192.168.1.101:8080/user/" + order.getUserId();
        return restTemplate.getForObject(url, User.class);
    }
}
```

问题来了：

- 用户服务 IP 变了怎么办？
- 用户服务有多个实例，调用哪个？
- 用户服务扩容/缩容，如何感知？

**服务注册与发现，就是让服务自动「汇报」自己的地址，让调用方自动「发现」可用实例。**

---

## Nacos 注册中心原理

### 核心概念

```
┌─────────────────────────────────────────────────────────┐
│                      Nacos Server                        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              服务注册表                            │   │
│  │  ┌─────────────┬─────────────────────────────┐ │   │
│  │  │ user-service│ [192.168.1.101:8080]        │ │   │
│  │  │             │ [192.168.1.102:8080]        │ │   │
│  │  ├─────────────┼─────────────────────────────┤ │   │
│  │  │ order-svc   │ [192.168.1.201:8081]        │ │   │
│  │  │             │ [192.168.1.202:8081]        │ │   │
│  │  └─────────────┴─────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
        ▲ 注册                    ▼ 查询
        │                         │
┌───────┴───────┐          ┌──────┴──────┐
│  用户服务实例   │          │  订单服务    │
│  :8080         │─────────►│  :8081      │
└───────────────┘  拉取服务列表 └─────────────┘
```

**三步走**：

1. **注册（Register）**：服务启动时，向 Nacos 报告「我来啦，我的地址是 xxx」
2. **心跳（Heartbeat）**：服务定期向 Nacos 发送心跳，证明自己还活着
3. **发现（Discover）**：调用方从 Nacos 拉取服务列表，按负载均衡策略选择实例

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Nacos 服务发现 -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
# bootstrap.yml
spring:
  application:
    name: order-service  # 服务名，必填
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848  # Nacos 服务器地址
        namespace: dev                # 命名空间，隔离环境
        group: DEFAULT_GROUP          # 分组，用于服务分组
        # 临时实例 vs 持久实例
        ephemeral: true               # true=临时实例（心跳检测），false=持久实例（Raft 协议）
```

### 3. 开启服务发现

```java
@SpringBootApplication
@EnableDiscoveryClient  // 启用服务注册发现
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

### 4. 启动 Nacos Server

```bash
# 下载并解压 Nacos
wget https://github.com/alibaba/nacos/releases/download/2.2.3/nacos-server-2.2.3.tar.gz
tar -xvf nacos-server-2.2.3.tar.gz

# 单机启动
cd nacos/bin
./startup.sh -m standalone
```

访问控制台：`http://localhost:8848/nacos`（默认账号密码：nacos/nacos）

---

## 服务查询与调用

### RestTemplate + LoadBalancer

```java
@Configuration
public class RestTemplateConfig {
    
    @Bean
    @LoadBalanced  // 开启负载均衡
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }
}
```

```java
@RestController
public class OrderController {
    
    @Autowired
    private RestTemplate restTemplate;
    
    @GetMapping("/order/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        // 直接用服务名替换 IP，RestTemplate 自动解析
        String url = "http://user-service/user/" + order.getUserId();
        return restTemplate.getForObject(url, User.class);
    }
}
```

### OpenFeign 调用

更推荐的方式，声明式接口，代码更简洁：

```java
@FeignClient(name = "user-service")
public interface UserClient {
    
    @GetMapping("/user/{id}")
    User getUser(@PathVariable("id") Long id);
}
```

```java
@RestController
public class OrderController {
    
    @Autowired
    private UserClient userClient;
    
    @GetMapping("/order/{orderId}")
    public Order getOrder(@PathVariable Long orderId) {
        User user = userClient.getUser(order.getUserId());
        order.setUser(user);
        return order;
    }
}
```

---

## 核心配置详解

### 命名空间（Namespace）

用于环境隔离：开发、测试、生产环境分离。

```yaml
spring:
  cloud:
    nacos:
      discovery:
        namespace: dev  # namespace id，不是名字
```

**在 Nacos 控制台创建命名空间后，会生成一个 namespace id**，配置时使用 id 而不是名字。

### 分组（Group）

用于服务分组：同一个命名空间下，按业务线或项目分组。

```yaml
spring:
  cloud:
    nacos:
      discovery:
        group: ORDER_GROUP  # 默认 DEFAULT_GROUP
```

### 集群（Cluster）

用于地域隔离：同地域服务优先调用，减少网络延迟。

```yaml
spring:
  cloud:
    nacos:
      discovery:
        cluster-name: HANGZHOU  # 集群名
```

```java
// 调用时优先选择同集群实例
@Configuration
public class FeignConfig {
    
    @Bean
    public Contract feignContract() {
        // 配置优先调用同集群
        return new Contract.Default();
    }
}
```

---

## 服务元数据

服务注册时，可以附加元数据用于路由、过滤等：

```yaml
spring:
  cloud:
    nacos:
      discovery:
        metadata:
          version: v1
          env: production
          weight: 0.8
```

```java
// 也可以通过代码方式注册元数据
@Autowired
private NacosServiceManager nacosServiceManager;

public void registerWithMetadata() {
    Instance instance = new Instance();
    instance.setIp("192.168.1.100");
    instance.setPort(8080);
    instance.setMetadata(Map.of("version", "v1", "env", "prod"));
    nacosServiceManager.registerInstance("order-service", instance);
}
```

---

## 健康检查机制

### 临时实例（默认）

通过客户端心跳维持：

```
服务实例 ──心跳(每5秒)──► Nacos Server
                         如果 15 秒没收到心跳 → 标记为不健康
                         如果 30 秒没收到心跳 → 从列表中移除
```

### 持久实例

服务端主动探测（TCP/HTTP）：

```yaml
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: false  # 持久实例
        health-checker:
          tcp:
            connectTimeout: 5000
            socketTimeout: 5000
```

---

## 负载均衡策略

Nacos 默认集成 Ribbon，支持多种负载均衡策略：

### 简单策略

| 策略 | 说明 |
|---|---|
| RandomRule | 随机 |
| RoundRobinRule | 轮询（默认） |
| WeightedResponseTimeRule | 权重，响应时间越短权重越高 |

### 同集群优先策略

```yaml
spring:
  cloud:
    nacos:
      discovery:
        cluster-name: HANGZHOU
```

Nacos 自带的 `NacosRule` 会**优先调用同集群实例**，同集群实例挂了才调用其他集群。

### 自定义权重

```yaml
spring:
  cloud:
    nacos:
      discovery:
        metadata:
          weight: 0.7  # 0.0-1.0，值越大被选中概率越高
```

---

## 实战：服务上下线的优雅处理

### 关闭时先注销

```yaml
# application.yml
spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

```java
@Component
public class NacosGracefulShutdown implements GracefulShutdown {
    
    @Override
    public CompletableFuture&lt;Void&gt; shutdown(String phase) {
        // 注销服务，停止接收新请求
        return CompletableFuture.runAsync(() -> {
            try {
                // 等待现有请求处理完成
                Thread.sleep(5000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
    }
}
```

### 预热新实例

新启动的实例，可以设置权重慢慢增加流量：

```yaml
spring:
  cloud:
    nacos:
      discovery:
        metadata:
          weight: 0.1  # 从 10% 开始，逐步增加
```

---

## 面试高频问题

### Q：Nacos 和 Eureka 的区别是什么？

A：核心区别在于三点——

1. **AP vs CP 可切换**：Nacos 同时支持 AP 和 CP 模式，Eureka 只支持 AP
2. **配置中心合一**：Nacos 同时是注册中心和配置中心，Eureka 只是注册中心
3. **健康检查**：Eureka 是客户端心跳，Nacos 支持服务端主动探测

### Q：临时实例和持久实例怎么选？

A：**大部分场景用临时实例**（默认），因为它轻量、通过心跳检测。如果需要服务元数据保持稳定（例如 Raft 协议选主），用持久实例。

### Q：服务注册失败了怎么办？

A：Nacos 客户端有重试机制，默认会重试 3 次。检查网络、防火墙、namespace 是否正确配置。

### Q：如何实现灰度发布？

A：可以用 Nacos 的元数据功能。给实例打上 `version` 标签，网关或 Feign 根据版本号路由到对应实例。

---

## 总结

Nacos 注册中心解决了微服务的核心问题：

1. **服务注册**：服务启动时自动注册，心跳维持活性
2. **服务发现**：调用方无需硬编码地址，自动获取可用实例
3. **负载均衡**：内置多种策略，支持同集群优先
4. **隔离策略**：通过 Namespace、Group、Cluster 实现多层次隔离

> 服务注册与发现是微服务的基础设施。搞懂了它，你就迈出了微服务架构的第一步。
