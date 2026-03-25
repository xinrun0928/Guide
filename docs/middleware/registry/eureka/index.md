# Eureka：Netflix 的服务发现方案

2012 年，Netflix 在微服务还没有「火」的时候，开源了 Eureka。

2018 年，Netflix 宣布 Eureka 2.x 停止维护。

一时间，「Eureka 已死」的论调甚嚣尘上。

**但直到今天，Eureka 1.x 仍在大量生产环境中运行。**

为什么一个「停止维护」的项目还能存活？它的设计有什么过人之处？

今天，我们来深入理解 Eureka 的架构与自我保护机制。

## 什么是 Eureka？

Eureka 是 Netflix 开源的 **REST-based 服务注册与发现组件**，是 Spring Cloud 早期默认的注册中心方案。

```
┌─────────────────────────────────────────────────────────┐
│                   Eureka Server Cluster                   │
│                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Eureka 1   │←─→│  Eureka 2   │←─→│  Eureka 3   │   │
│  │  (Region A) │  │  (Region B) │  │  (Region C) │   │
│  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                          │
│  集群节点之间互相注册，定时同步注册表                      │
└─────────────────────────────────────────────────────────┘
           ↑                       ↑
           │                       │
    ┌──────┴──────┐          ┌──────┴──────┐
    │ Eureka Client│          │ Eureka Client│
    │   (Zone A)  │          │   (Zone B)  │
    └─────────────┘          └─────────────┘
```

**Eureka 的核心特点：**

- **客户端-服务端模式**：服务实例向 Server 注册
- **拉模式**：Client 定时从 Server 拉取服务列表
- **AP 模型**：优先可用性，允许数据短暂不一致
- **多级缓存**：Server 和 Client 都有本地缓存
- **自我保护**：网络分区时防止误删健康实例

## 架构设计

### 服务端组件

```java
// Eureka Server 核心组件
public class EurekaServer {
    // 1. ApplicationResourceManager
    // 管理所有服务实例的注册信息
    private ConcurrentHashMap<String, Application> registry;

    // 2. InstanceRegistry
    // 处理注册、续约、下线、过期
    InstanceRegistry registry;

    // 3. ResponseCache
    // 三级缓存：只读缓存 → 读写缓存 → Registry
    ResponseCache readOnlyCacheMap;
    ResponseCache readWriteCacheMap;
}
```

### 客户端组件

```java
// Eureka Client 核心组件
public class EurekaClient {
    // 管理本地服务实例信息
    private ApplicationInfoManager infoManager;

    // 服务发现客户端
    private DiscoveryClient discoveryClient;

    // 心跳续约
    private InstanceInfoReplicator replicator;

    // 本地缓存
    private ApplicationsCache cache;
}
```

### 服务注册流程

```
服务实例启动
     ↓
读取配置：eureka.client.service-url.defaultZone
     ↓
构建 InstanceInfo（IP、端口、服务名）
     ↓
发送 POST /eureka/apps/{appName}
     ↓
启动心跳定时器（默认 30 秒续约一次）
```

```yaml
# application.yml
eureka:
  instance:
    appname: order-service
    instance-id: ${spring.cloud.client.ip-address}:${server.port}
    prefer-ip-address: true
    lease-renewal-interval-in-seconds: 30
  client:
    service-url:
      defaultZone: http://eureka1:8761/eureka/,http://eureka2:8761/eureka/
    register-with-eureka: true
    fetch-registry: true
```

详细架构分析请阅读：

- [Eureka 架构详解](/middleware/registry/eureka)

## 自我保护机制

这是 Eureka 最重要的特性，也是它区别于其他注册中心的核心。

### 什么是自我保护？

Eureka 会在运行时会统计「心跳失败比例」：

```
正常情况：每分钟应该有 85% 的实例成功续约
自我保护：如果心跳成功率 < 85%，进入保护模式
```

**进入保护模式后：**

- 不会删除任何过期的实例
- 即使心跳超时，也不剔除服务
- 宁可保留不稳定的服务，也不「误杀」健康的实例

### 为什么需要自我保护？

考虑这个场景：

```
凌晨 3 点，80% 的微服务在重启发版

正常情况：Eureka 会误以为这些实例宕机，全部删除
保护模式：Eureka 知道这是「计划内重启」，不删除实例
```

**没有自我保护的后果：**

1. 服务实例重启中，被从注册表删除
2. 调用方发现不了这些服务，请求失败
3. 即使实例启动成功，也需要重新注册
4. 服务短暂不可用

**自我保护的本质：宁可相信「网络分区导致心跳失败」，也不「误杀」健康的实例。**

### 保护模式触发与退出

```yaml
# 触发阈值（默认 85%）
eureka:
  server:
    renewal-percent-threshold: 0.85

# 关闭自我保护（不推荐）
eureka:
  server:
    enable-self-preservation: false
```

```
触发条件：
每分钟续约次数 < 期望续约次数 × 85%

退出条件：
连续 3 次心跳成功率 > 85%
```

详细机制请阅读：

- [Eureka 自我保护机制](/middleware/registry/eureka-protection)

## 已停止维护的影响

2018 年，Netflix 宣布 Eureka 2.x 停止维护。

### 影响分析

**不影响的：**

- Eureka 1.x 继续可以使用
- Spring Cloud 继续支持 Eureka 1.x
- 已有项目可以继续运行

**影响的：**

- 没有新功能
- 没有安全补丁（需要自己打）
- 没有性能优化
- 未来 Spring Cloud 版本可能移除支持

### 应对策略

| 策略 | 适用场景 | 说明 |
|-----|--------|-----|
| **继续使用** | 已有 Eureka，迁移成本高 | 稳定即可，继续用 |
| **迁移 Nacos** | 新项目或迁移窗口 | 功能更丰富 |
| **双注册双发现** | 过渡期 | Eureka + Nacos 并行 |

详细说明请阅读：

- [Eureka 停止维护说明](/middleware/registry/eureka-deprecated)

## 使用场景

| 场景 | 推荐指数 | 说明 |
|-----|--------|-----|
| **Spring Cloud 老项目** | ⭐⭐⭐⭐ | 继承项目，继续用 |
| **Java 微服务** | ⭐⭐⭐ | 功能够用 |
| **需要配置中心** | ⭐ | 没有，需要额外组件 |
| **新项目** | ⭐⭐ | 建议用 Nacos |
| **多语言技术栈** | ⭐ | 不推荐 |

**选 Eureka 如果：**

- 已有 Eureka 集群，迁移成本高
- Spring Cloud 老项目，短期内不重构
- 服务实例数量 < 5000
- 不需要配置中心

**不选 Eureka 如果：**

- 新项目（选 Nacos）
- 需要配置中心（选 Nacos）
- 多语言技术栈（选 Consul）
- 需要活跃社区支持（选 Nacos）

## 面试追问

**Q：Eureka 的自我保护机制是什么？**

A：Eureka 会在心跳失败比例过高时进入保护模式，不删除过期实例。目的是防止网络分区时误杀健康实例。可以通过 `renewal-percent-threshold` 配置阈值。

**Q：Eureka 和 Nacos 的区别？**

A：
- 一致性：Eureka 只有 AP，Nacos 同时支持 CP + AP
- 功能：Eureka 只有注册中心，Nacos 还有配置中心
- 维护：Eureka 停止维护，Nacos 持续活跃
- 性能：Nacos 性能更好，支持更多实例

**Q：Eureka 的多级缓存有什么作用？**

A：
- 只读缓存（30 秒刷新）：减少 Registry 压力
- 读写缓存：加速读取，写入会失效缓存
- Registry：最终数据源

这样的设计可以提高并发读取性能，但会导致短暂的数据不一致。

---

**留给你的问题：**

假设 Eureka Server 集群有 3 台机器，其中 1 台因为网络问题和另外 2 台断开连接。

断开的这 1 台会怎样？它会停止服务吗？

如果没有自我保护机制，会发生什么？

提示：考虑服务实例的注册和心跳方向。
