# Nacos 注册中心

想象一下，你点了一份外卖。

你不需要知道骑手在哪栋楼、穿过哪条街、爬了几层楼。你只知道「我的外卖正在配送中」。

但外卖平台的后台系统呢？它需要知道：哪家店能接单、哪个骑手空闲、最优的配送路线是什么。

**服务发现，就是外卖平台的调度系统。**

在微服务架构中，服务实例成百上千，IP 随时变化。Nacos 就是那个帮你「找到服务」的调度中心。

## 服务注册：让服务「报名」

当一个微服务启动时，它需要做两件事：

1. **告诉 Nacos：「我在这里」**
2. **告诉 Nacos：「我还活着」**

这就是服务注册和心跳保活。

### 服务注册流程

```
服务实例启动
     ↓
读取配置：nacos.server-addr=192.168.1.100:8848
     ↓
向 Nacos 发送注册请求
     ↓
Nacos 将实例信息写入注册表
     ↓
注册成功
```

```yaml
# application.yml 配置
spring:
  application:
    name: order-service
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.100:8848
        namespace: prod
        group: order-group
```

```java
// 服务启动时，自动注册到 Nacos
// 只需添加依赖和配置，无需额外代码
@SpringBootApplication
@EnableDiscoveryClient
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

**Nacos 会自动完成以下事情：**

1. 读取应用的 `spring.application.name` 作为服务名
2. 读取实例的 IP 和端口
3. 向 Nacos server 发送注册请求
4. 启动心跳线程，定期发送心跳

### 注册的信息有哪些？

Nacos 存储的服务实例信息非常丰富：

```json
{
  "instanceId": "192.168.1.101:8080",
  "serviceName": "order-service",
  "ip": "192.168.1.101",
  "port": 8080,
  "weight": 1.0,
  "healthy": true,
  "ephemeral": true,
  "clusterName": "DEFAULT",
  "groupName": "order-group",
  "namespaceId": "prod",
  "metadata": {
    "version": "v1",
    "region": "shanghai"
  }
}
```

这些信息包括：

- **基础信息**：IP、端口、服务名
- **健康状态**：实例是否正常运行
- **分组信息**：用于隔离不同环境或业务线
- **权重**：负载均衡时的重要参数
- **元数据**：自定义的扩展信息

## 心跳保活：证明「我还活着」

服务注册后，还需要证明自己还活着。这就是心跳机制。

### 心跳的原理

```
服务实例                              Nacos Server
     │                                    │
     │──── 心跳（只含 instanceId）──────→  │
     │                                    │
     │     ←─── 响应（ack）──────────────  │
     │                                    │
     │     （每 5 秒重复一次）            │
```

**Nacos 的心跳机制：**

| 心跳类型 | 发送间隔 | 说明 |
|---------|---------|-----|
| 实例心跳 | 5 秒 | 告诉 Nacos「我还活着」 |
| 服务心跳 | 10 秒 | 服务级别的健康检查 |

```yaml
# 可配置心跳参数
spring:
  cloud:
    nacos:
      discovery:
        heart-beat-interval: 5000      # 心跳间隔（毫秒）
        heart-beat-timeout: 15000      # 心跳超时时间（毫秒）
        ip-delete-timeout: 30000       # 实例删除超时（毫秒）
```

### 心跳超时与实例剔除

当 Nacos 超过 `heart-beat-timeout`（默认 15 秒）没收到某实例的心跳，就会将其标记为**不健康**。

超过 `ip-delete-timeout`（默认 30 秒）还没收到心跳，就会将该实例从注册表中**删除**。

```
时间线：
T=0      实例注册成功
T=5s     心跳 1
T=10s    心跳 2
T=15s    心跳 3（超时判定点）
         此时：实例被标记为不健康
T=30s    心跳 4（删除判定点）
         此时：实例被从注册表删除
```

### 心跳丢了怎么办？

```java
// Nacos 客户端会自动重试
// 心跳请求使用 HTTP 长连接，超时后自动重连
// 服务实例重启后，会重新注册
```

**关键点：服务实例不需要自己实现重连逻辑，Nacos SDK 会处理。**

## 健康检查：不只是心跳

Nacos 支持两种健康检查模式：

### 客户端主动上报（默认）

服务实例自己报告健康状态。Nacos 收到心跳即认为健康，收不到心跳就判定不健康。

**优点：** 实现简单，开销小
**缺点：** 如果服务进程卡死但机器还活着，会误报健康

```java
// 服务可以主动下线
@PreDestroy
public void deregister() {
    namingService.deregisterInstance("order-service", "192.168.1.101:8080");
}
```

### 服务端主动探测

Nacos 服务端定期探测服务实例的健康状态。

```yaml
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: HTTP        # HTTP / TCP / MYSQL
          interval: 10s     # 检查间隔
          path: /actuator/health  # 健康检查路径
```

**优点：** 探测更准确
**缺点：** 开销较大，不适合大规模场景

## 临时实例 vs 永久实例

这是 Nacos 区别于 ZooKeeper 的重要特性。

### 临时实例（ephemeral=true）

```yaml
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: true  # 默认值
```

- 心跳维持：没有心跳会被删除
- 数据不持久化：Nacos 重启后需要重新注册
- 适用场景：一般业务服务，适合频繁扩缩容的场景

### 永久实例（ephemeral=false）

```yaml
spring:
  cloud:
    nacos:
      discovery:
        ephemeral: false
```

- 不依赖心跳：没有心跳也不会被删除
- 数据持久化：Nacos 重启后实例信息仍在
- 适用场景：中间件服务，需要高可用的基础设施

**什么时候用永久实例？**

- 数据库（不希望主从切换时实例消失）
- 注册中心自身（Nacos Cluster）
- 配置中心
- 任何「不应该随意消失」的服务

## 服务发现：找到目标服务

### 查询服务实例列表

```java
// 方式一：使用 RestTemplate
@RestController
public class OrderController {
    @LoadBalanced
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @GetMapping("/create")
    public String createOrder() {
        // 使用服务名调用，不需要知道 IP 和端口
        String result = restTemplate.getForObject(
            "http://inventory-service/api/stock/reduce",
            String.class
        );
        return "订单创建成功: " + result;
    }
}
```

```java
// 方式二：使用 OpenFeign
@FeignClient(name = "inventory-service")
public interface InventoryClient {
    @PostMapping("/api/stock/reduce")
    String reduceStock(@RequestParam("productId") Long productId);
}

@RestController
public class OrderController {
    @Autowired
    private InventoryClient inventoryClient;

    @GetMapping("/create")
    public String createOrder(Long productId) {
        String result = inventoryClient.reduceStock(productId);
        return "订单创建成功: " + result;
    }
}
```

```java
// 方式三：直接使用 NamingService
@Autowired
private NamingService namingService;

public String getServerUrl(String serviceName) {
    try {
        // 获取所有健康实例
        List&lt;Instance&gt; instances = namingService.selectInstances(serviceName, true);
        // 选择一个实例（随机负载均衡）
        Instance instance = namingService.selectOneHealthyInstance(serviceName);
        return instance.getIp() + ":" + instance.getPort();
    } catch (NacosException e) {
        throw new RuntimeException("服务发现失败", e);
    }
}
```

### 订阅服务变化

```java
// 订阅服务实例变化通知
namingService.subscribe("order-service", event -> {
    if (event instanceof InstancesChangeEvent) {
        InstancesChangeEvent changeEvent = (InstancesChangeEvent) event;
        List&lt;Instance&gt; hosts = changeEvent.getHosts();
        // 更新本地的服务实例缓存
        updateLocalCache(hosts);
    }
});
```

## 总结

Nacos 注册中心的核心流程：

```
服务启动 → 注册（IP、端口、服务名） → 心跳保活 → 客户端发现 → 服务调用
```

**Nacos 的优势：**
- **上手简单**：配置 + 依赖，不需要写代码
- **功能丰富**：支持临时/永久实例、健康检查、权重、分组
- **心跳灵活**：可配置间隔、超时时间
- **多语言支持**：Java、Go、Node.js 等

---

**留给你的问题：**

假设一个服务实例正在处理一个长请求（比如文件上传，需要 2 分钟）。在这个过程中，如果心跳超时被标记为不健康，会发生什么？

实例会被删除吗？请求会中断吗？

这个问题涉及到健康检查策略和流量控制的设计。
