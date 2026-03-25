# 注册中心

订单服务要调用用户服务，但用户服务部署在 5 台机器上。

你该怎么办？把 5 个 IP 地址写死在代码里？

```
String userServiceUrl = "http://192.168.1.101:8080";
String userServiceUrl = "http://192.168.1.102:8080";
String userServiceUrl = "http://192.168.1.103:8080";
// ... 还有两台
```

明天运维扩容，加了 2 台新机器，你得改代码。
后天有一台机器挂了，你得改代码。
大后天灰度发布，你要切换流量，你得改代码。

**这不科学。**

注册中心解决的就是这个问题：**服务把自己的地址注册到一个「中介」，调用方从这里获取地址列表，不需要知道具体 IP。**

---

## 什么是注册中心？

注册中心是微服务架构中的「服务发现」基础设施，核心功能有三个：

1. **服务注册**：服务启动时，把自己的地址（IP + 端口）注册到注册中心
2. **服务发现**：调用方从注册中心拉取服务地址列表
3. **健康检查**：注册中心定期检查服务是否存活，不健康的节点自动移除

```
                    注册中心（Nacos/ZooKeeper/Consul/Eureka）
                           ↕ 拉取地址列表
用户服务 → 查地址 →  订单服务 1（192.168.1.101:8080）
                   订单服务 2（192.168.1.102:8080）
                   订单服务 3（192.168.1.103:8080）

服务启动 → 注册 →  订单服务 1 注册成功
服务宕机 → 自动消失 → 订单服务 2 心跳超时，自动注销
```

---

## 四大注册中心

### ZooKeeper

ZooKeeper 是分布式协调领域的老牌选手，以**强一致性**著称。

它的核心是 ZAB 协议（ZooKeeper Atomic Broadcast），保证写操作的顺序性。这让它非常适合做分布式锁、配置管理等场景。

**但为什么 ZooKeeper 不适合作为服务注册中心？**

- **CAP 理论**：ZooKeeper 选择了 CP（一致性 + 分区容忍），注册中心需要的是 AP（可用性 + 分区容忍）—— 服务不可用比数据短暂不一致更严重
- **性能问题**：每次服务注册/注销都需要通知所有订阅者，在大规模服务场景下会广播风暴
- **使用场景**：更适合做分布式锁、配置中心，而不是服务发现

深入理解：[ZooKeeper 核心](/middleware/registry/zookeeper-core) | [ZooKeeper 分布式锁](/middleware/registry/zookeeper-lock) | [ZooKeeper 脑裂问题](/middleware/registry/zookeeper-brain-split)

### Nacos

Nacos 是阿里开源的**一体化**解决方案，同时支持**服务发现**和**配置管理**。

Nacos 为什么会赢？

1. **AP + CP 双模式**：你可以根据场景选择一致性策略
2. **Distro 协议**：专门为注册中心设计的协议，比 Raft 更轻量
3. **配置中心能力**：不需要额外部署 Apollo，直接一套系统搞定
4. **国内生态好**：Spring Cloud Alibaba 默认集成

```java
// Nacos 的 Distro 协议 —— 注册中心的专用一致性协议
// 核心思想：每个节点负责一部分服务，通过异步同步保证最终一致
// 写操作：本地处理 + 异步同步到其他节点
// 读操作：直接读本地数据，不需要跨节点通信
```

深入理解：[Nacos 注册中心](/middleware/registry/nacos-registry) | [Nacos 配置中心](/middleware/registry/nacos-config) | [Nacos Distro 协议](/middleware/registry/nacos-distro) | [Nacos 选举机制](/middleware/registry/nacos-election)

### Consul

Consul 是 HashiCorp 公司的产品，主打**多数据中心**和**健康检查**能力。

**为什么用 Consul？**

- **健康检查强**：支持 HTTP、TCP、Docker、Shell 脚本等多种检查方式
- **多数据中心**：原生支持跨数据中心的服务发现
- **Service Mesh 友好**：与 Consul Connect 集成，支持服务网格
- **DNS 优先**：可以直接用 DNS 查询服务地址，零代码改造

```bash
# Consul 健康检查示例
# 定义一个 HTTP 健康检查
{
  "check": {
    "id": "order-service-health",
    "name": "Order Service Health",
    "http": "http://localhost:8080/health",
    "interval": "10s",
    "timeout": "5s"
  }
}
```

深入理解：[Consul](/middleware/registry/consul) | [Consul 对比](/middleware/registry/consul-compare)

### Eureka

Eureka 是 Netflix 开源的 Spring Cloud 默认注册中心，现在已经**停止维护**。

为什么被放弃？

- **自我保护机制**：Eureka 的自我保护是为了防止网络分区时的误删，但在某些场景下会导致「服务已死但未移除」的问题
- **可用性优先**：Eureka 选择 AP，但数据一致性问题让它在生产环境中存在隐患
- **社区停滞**：Netflix 停止维护后，社区 fork 了多个版本，但都不如原生版本稳定

**现在的选择**：如果是新项目，不建议用 Eureka；如果是存量系统，了解其保护机制即可。

深入理解：[Eureka](/middleware/registry/eureka) | [Eureka 保护机制](/middleware/registry/eureka-protection) | [Eureka 废弃说明](/middleware/registry/eureka-deprecated)

---

## 核心对比

| 特性 | ZooKeeper | Nacos | Consul | Eureka |
|-----|----------|-------|--------|--------|
| **一致性协议** | ZAB | Distro / Raft | Raft | 无中心 |
| **CAP 取舍** | CP | AP + CP | CP | AP |
| **健康检查** | TCP 心跳 | TCP/HTTP/MYSQL | 多方式 | 心跳 |
| **多数据中心** | 不支持 | 不支持 | 原生支持 | 不支持 |
| **Spring Cloud 集成** | 需要适配 | 官方支持 | 官方支持 | 原生支持 |
| **维护状态** | 活跃 | 活跃 | 活跃 | 停止维护 |
| **推荐场景** | 分布式锁 | 国内微服务 | 云原生多机房 | 不推荐 |

**选择建议**：

- 国内 Java 微服务 → **Nacos**（生态好，一站式）
- 云原生多机房部署 → **Consul**（多数据中心支持好）
- 需要强一致性的协调场景 → **ZooKeeper**（分布式锁、配置中心）
- 新项目不要选 **Eureka**，老项目迁移优先考虑 Nacos

---

## 面试高频问题

**Q：注册中心挂了，服务还能调用吗？**

能，但有限制：

1. **服务消费者有本地缓存**：启动时会拉取一份地址列表缓存在内存中
2. **短期内可以继续调用**：注册中心挂了，不影响已有连接
3. **新服务上线无法感知**：注册中心恢复前，新实例无法注册，旧实例下线也无法感知

最佳实践：注册中心做高可用（多节点部署），同时客户端做好本地缓存和故障切换。

**Q：ZooKeeper 和 Nacos 的区别？**

- **ZooKeeper**：强一致性（CP），适合协调场景，不适合大规模服务发现
- **Nacos**：最终一致性（AP），专门为服务发现设计，支持配置中心

**Q：Nacos 的 Distro 协议是什么？**

Distro 是 Nacos 为注册中心场景设计的专用协议：

- 每个节点负责一部分服务实例
- 写操作在本地处理后，异步同步到其他节点
- 读操作直接读本地数据，不需要跨节点通信
- 牺牲强一致性，换取高可用和低延迟

**Q：如何保证注册中心的高可用？**

- **多节点部署**：Nacos/Consul 都是集群部署
- **客户端重试**：注册中心挂了，客户端有本地缓存 + 重试机制
- **数据同步**：节点之间同步数据，防止单点故障

**Q：Eureka 的自我保护机制是什么？**

Eureka 的自我保护是为了防止网络分区时误删健康实例。但这把双刃剑也会导致「服务已死但未被移除」的问题：

```java
// Eureka 会在以下情况进入自我保护模式
// 15 分钟内，超过 85% 的服务实例心跳失败
// 此时 Eureka 不再删除过期的服务实例
// 即使实例已经真的死了，Eureka 也不会移除它
```

---

## 学习路径

```
先理解为什么需要注册中心
  ↓
理解服务注册/发现/健康检查的流程
  ↓
对比四大注册中心的 CAP 取舍和使用场景
  ↓
深入学习 ZooKeeper（理解分布式协调）
  ↓
深入学习 Nacos（国内微服务首选）
  ↓
理解注册中心的高可用和故障处理
```

下一节，从 [注册中心对比](/middleware/registry/compare) 开始——先搞清楚每个注册中心的定位，再深入学习具体实现。
