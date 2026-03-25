# Nacos：新一代服务发现与配置中心

你在凌晨 2 点被报警叫醒：「线上环境数据库连接池耗尽」。

你检查了代码，没有改动。检查了配置，没有改动。检查了机器，CPU、内存都正常。

最后你发现：某台应用服务器在发版时网络闪断，导致它从注册中心消失了。但调用方还在往这台「死」机器发请求。

**问题来了：为什么注册中心没有及时感知到实例下线？**

Nacos 试图回答这个问题——它不只是一个注册中心，更是一个**完整的动态服务发现与配置管理平台**。

## 什么是 Nacos？

Nacos 是阿里巴巴开源的项目，定位是 **Dynamic Service Discovery + Configuration Management**（动态服务发现 + 配置管理）。

```
┌─────────────────────────────────────────────────────────┐
│                        Nacos                              │
│                                                          │
│   ┌─────────────────────┐  ┌─────────────────────┐     │
│   │     注册中心         │  │     配置中心         │     │
│   │                     │  │                     │     │
│   │  · 服务注册         │  │  · 配置管理         │     │
│   │  · 服务发现         │  │  · 配置推送         │     │
│   │  · 健康检查         │  │  · 配置变更监听     │     │
│   │  · 权重路由         │  │  · 配置版本管理     │     │
│   └─────────────────────┘  └─────────────────────┘     │
│                                                          │
│   ┌──────────────────────────────────────────────┐      │
│   │              命名空间 + 分组                   │      │
│   │         多环境隔离 · 多业务隔离                │      │
│   └──────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

**Nacos 的核心能力：**

- **服务注册发现**：注册、订阅、心跳、负载均衡
- **配置管理**：配置发布、变更推送、版本管理
- **动态路由**：权重、实例优先、就近访问
- **健康检查**：TCP、HTTP、MySQL、自定义
- **多环境支持**：命名空间隔离不同环境

## 快速开始

```yaml
# 引入依赖
spring:
  cloud:
    nacos:
      discovery:
        server-addr: 127.0.0.1:8848
        namespace: prod
        group: order-group
  application:
    name: order-service
```

```java
// 服务启动后自动注册
// 无需额外代码

// 服务调用（RestTemplate）
@LoadBalanced
@Bean
public RestTemplate restTemplate() {
    return new RestTemplate();
}

@RestController
public class OrderController {
    @GetMapping("/create")
    public String createOrder() {
        // 使用服务名调用
        return restTemplate.getForObject(
            "http://inventory-service/api/stock",
            String.class
        );
    }
}
```

```java
// 服务调用（OpenFeign）
@FeignClient(name = "inventory-service")
public interface InventoryClient {
    @GetMapping("/api/stock")
    String getStock();
}

// 配置监听
@RestController
@RefreshScope
public class ConfigController {
    @Value("${order.max-count:100}")
    private int maxCount;

    // 配置变更时，maxCount 会自动刷新
}
```

## 注册中心

Nacos 的服务注册发现机制是它最核心的功能。

### 临时实例 vs 永久实例

```
临时实例（ephemeral=true）：
- 依赖心跳维持
- 心跳超时后自动删除
- Nacos 重启后需要重新注册
- 适合普通业务服务

永久实例（ephemeral=false）：
- 不依赖心跳
- Nacos 重启后实例仍在
- 适合中间件、数据库等基础设施
```

### 健康检查

Nacos 支持多种健康检查方式：

```yaml
# HTTP 检查
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: HTTP
          path: /actuator/health
          interval: 10s

# TCP 检查
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: TCP
          interval: 10s

# MySQL 检查
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: MYSQL
          query: SELECT 1
          interval: 10s
```

详细原理请阅读：

- [Nacos 注册中心原理](/middleware/registry/nacos-registry)

## 配置中心

Nacos 的配置中心功能让你告别「改配置要重启」。

```java
// 配置获取
@RestController
@RefreshScope  // 配置变更时自动刷新
public class ConfigController {
    @Value("${order.max-count:100}")
    private int maxCount;

    @GetMapping("/config")
    public String getConfig() {
        return "maxCount = " + maxCount;
    }
}

// 配置监听
@NacosConfigListener
public void onConfigChange(String newConfig) {
    System.out.println("配置变更: " + newConfig);
}
```

```yaml
# 配置发布（Nacos 控制台）
# Data ID: order-service.yaml
# Group: DEFAULT_GROUP
# 命名空间: prod

order:
  max-count: 500
  timeout: 3000
```

详细功能请阅读：

- [Nacos 配置中心](/middleware/registry/nacos-config)

## Distro 协议

Nacos 在服务注册场景使用 **Distro 协议**，实现最终一致性。

```
核心思想：数据分片 + 异步同步

1. 每个 Nacos 节点负责一部分服务实例
2. 节点之间通过异步复制保持最终一致
3. 写入时只需在本节点确认
4. 读取时可能需要跨节点请求（最终一致）

优势：
- 高可用：任何节点宕机，其他节点接管
- 高性能：写入不需要跨节点同步
- 低延迟：本地写入，本地读取（大部分场景）
```

详细实现请阅读：

- [Nacos Distro 协议](/middleware/registry/nacos-distro)

## 选举机制

Nacos 在配置管理场景使用 **Raft 协议**，实现强一致性。

```
Leader 选举流程：
1. 节点启动，状态为 Follower
2. 等待 election timeout（随机 150-300ms）
3. 发起选举，给自己投票
4. 获得多数节点投票，成为 Leader
5. Leader 发送心跳，维持统治

特点：
- 强一致：写操作必须经过 Leader
- 高可用：Leader 宕机后重新选举
- 奇数节点：通常部署 3 或 5 个节点
```

详细实现请阅读：

- [Nacos 选举机制](/middleware/registry/nacos-election)

## 对比选择

| 特性 | Nacos | ZooKeeper | Consul |
|-----|-------|-----------|--------|
| **一致性模型** | CP + AP | CP | CP |
| **注册中心** | 原生 | 需二次开发 | 原生 |
| **配置中心** | 原生 | 需二次开发 | KV 存储 |
| **多数据中心** | 部分支持 | 不支持 | 原生 |
| **健康检查** | 丰富 | 基础 | 最丰富 |
| **Java 集成** | 极简 | 一般 | 一般 |
| **多语言支持** | 一般 | 一般 | 极好 |

**选 Nacos 如果：**

- Java 技术栈 + Spring Cloud
- 需要同时使用注册中心和配置中心
- 服务实例数量 > 5000
- 需要配置热更新
- 想要友好的运维 UI

详细对比请阅读：

- [Nacos vs ZooKeeper vs Consul](/middleware/registry/compare)

## 面试追问

**Q：Nacos 如何保证服务发现的实时性？**

A：Nacos 使用推送 + 拉取的混合模式：
- 客户端长轮询配置变更（30 秒）
- 服务端推送实例变更通知
- 客户端订阅后，服务端主动推送

**Q：Nacos 的 AP 和 CP 模式分别在什么场景使用？**

A：
- AP 模式（ephemeral=true）：服务发现，优先可用性
- CP 模式（ephemeral=false）：配置管理、分布式锁，优先一致性

**Q：Nacos 和 Eureka 的区别是什么？**

A：
- 一致性：Nacos 支持 CP + AP，Eureka 只有 AP
- 功能：Nacos 同时是注册中心 + 配置中心，Eureka 只是注册中心
- 维护：Eureka 2.x 停止维护，Nacos 持续活跃

---

**留给你的问题：**

假设一个微服务有 100 个实例，部署在 10 台机器上。每台机器 10 个实例。

如果其中一台机器宕机，Nacos 会怎样处理？

实例是临时实例还是永久实例，会影响处理方式吗？

这个问题涉及到 Nacos 的健康检查机制和实例剔除策略。
