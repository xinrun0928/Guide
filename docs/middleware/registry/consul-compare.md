# Consul vs ZooKeeper vs etcd vs Nacos

选择注册中心，就像选择手机的操作系统。

iOS 简单但封闭，Android 开放但碎片化。

每个注册中心都有自己的设计哲学和使用场景。

**哪个更适合你？**

## 一览表

| 特性 | Consul | ZooKeeper | etcd | Nacos |
|-----|--------|-----------|------|-------|
| **一致性模型** | CP | CP | CP | CP + AP |
| **服务发现** | 原生 | 需开发 | 需开发 | 原生 |
| **配置中心** | KV 存储 | 需开发 | 需开发 | 原生 |
| **健康检查** | 丰富 | 基础 | 基础 | 丰富 |
| **多数据中心** | 原生 | 不支持 | 不支持 | 部分支持 |
| **服务网格** | Consul Connect | 不支持 | 不支持 | 不支持 |
| **客户端语言** | HTTP API | Java/C | Go | Java/Go |
| **共识协议** | Raft | ZAB | Raft | Raft + Distro |
| **学习曲线** | 中等 | 陡峭 | 陡峭 | 低 |
| **运维复杂度** | 中等 | 高 | 中等 | 低 |

## 共识协议对比

### ZooKeeper：ZAB 协议

```
ZAB（ZooKeeper Atomic Broadcast）专门为 ZooKeeper 设计
- 写必须经过 Leader
- 过半确认才算成功
- 数据一致性有保障
- 但性能受限于单节点
```

### etcd：Raft 协议

```
Raft 协议是通用的共识算法
- 写必须经过 Leader
- 过半确认才算成功
- 易于理解和实现
- 性能稳定
```

### Consul：Raft 协议

```
Consul 使用 Raft 协议
- 类似 etcd
- 支持多数据中心（WAN Gossip）
- Gossip 协议用于 Server 间的通信
```

### Nacos：Raft + Distro

```
Nacos 混合使用两种协议
- Raft：配置管理、Leader 选举
- Distro：服务注册、最终一致
```

## 服务发现对比

### Consul：开箱即用

```bash
# 服务注册
consul services register -name=order-service -port=8080

# 服务查询
curl http://localhost:8500/v1/health/service/order-service

# DNS 查询
dig @localhost -p 8600 order-service.service.consul
```

```java
// Java 客户端
ConsulClient client = new ConsulClient("localhost", 8500);
List&lt;ServiceHealth&gt; services = client.getHealthyServices("order-service").getValue();
```

### ZooKeeper：需要二次开发

```java
// ZooKeeper 没有原生的服务发现
// 需要自己实现

// 服务注册
zk.create("/services/order-service/instance-001",
    "192.168.1.100:8080".getBytes(),
    ZooDefs.Ids.OPEN_ACL_UNSAFE,
    CreateMode.EPHEMERAL);

// 服务发现
List&lt;String&gt; instances = zk.getChildren("/services/order-service", false);
```

### etcd：需要二次开发

```bash
# etcd 存储服务实例
etcdctl put /services/order-service/instance-001 '{"ip":"192.168.1.100","port":8080}'

# 查询服务实例
etcdctl get --prefix /services/order-service/
```

### Nacos：开箱即用

```yaml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: nacos-server:8848
```

## 健康检查对比

### Consul：最丰富

```hcl
check {
  id = "http"
  http = "http://localhost:8080/health"
  interval = "10s"
}

check {
  id = "tcp"
  tcp = "localhost:8080"
  interval = "10s"
}

check {
  id = "script"
  args = ["/usr/local/bin/check.sh"]
  interval = "30s"
}

check {
  id = "ttl"
  ttl = "30s"
}

check {
  id = "grpc"
  grpc = "localhost:8080"
  interval = "10s"
}
```

### Nacos：基本够用

```yaml
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: HTTP
          path: /actuator/health
          interval: 10s
```

### ZooKeeper：最基础

```java
// ZooKeeper 没有内置健康检查
// 需要自己实现定时任务向 ZooKeeper 发送心跳
// 或者依赖临时节点的心跳机制
```

### etcd：最基础

```bash
# etcd 没有健康检查
# 需要自己实现定时更新 key 的 TTL
etcdctl put --lease=<lease_id> /health/service1 "ok"
```

## 多数据中心对比

### Consul：原生支持

```
北京数据中心（dc-beijing）
├── Consul Server 1
├── Consul Server 2
└── Consul Server 3

上海数据中心（dc-shanghai）
├── Consul Server 1
├── Consul Server 2
└── Consul Server 3

WAN Gossip：跨数据中心通信
```

```bash
# 跨数据中心查询
curl 'http://localhost:8500/v1/health/service/order-service?dc=dc-shanghai'

# DNS 跨数据中心
dig @localhost -p 8600 order-service.service.dc-shanghai.consul
```

### 其他三者：不支持或部分支持

| 注册中心 | 多数据中心支持 |
|---------|--------------|
| ZooKeeper | 不支持 |
| etcd | 不支持 |
| Nacos | 需配置 federation |

## 选型决策树

```
项目需求
     │
     ├── 需要多数据中心支持？
     │     │
     │     └── 是 → Consul
     │
     ├── 需要配置中心？
     │     │
     │     └── 是 → Nacos
     │
     ├── Java 技术栈？
     │     │
     │     └── 是 → Nacos（首选）或 ZooKeeper
     │
     ├── 多语言技术栈？
     │     │
     │     └── 是 → Consul（HTTP API）
     │
     └── 已有 ZooKeeper？
           │
           └── 是 → ZooKeeper
```

## 场景对比

### 场景一：电商系统

```
背景：
- 100+ 微服务
- Java 技术栈
- Spring Cloud 框架
- 单机房部署

推荐：Nacos

理由：
- 和 Spring Cloud 无缝集成
- 同时支持注册中心和配置中心
- 运维简单
- 性能足够（支持 10 万实例）
```

### 场景二：跨地域服务

```
背景：
- 多数据中心（北京、上海、广州）
- Go + Java 混合技术栈
- 需要跨地域服务发现

推荐：Consul

理由：
- 原生多数据中心支持
- HTTP API 支持多语言
- 跨地域服务发现简单
```

### 场景三：Kubernetes 集群

```
背景：
- Kubernetes 部署
- 需要服务网格
- 云原生架构

推荐：Consul

理由：
- Consul Connect 支持服务网格
- Kubernetes 原生集成
- CNCF 生态
```

### 场景四：Kafka 生态

```
背景：
- 已有 ZooKeeper 集群
- 使用 Kafka、HBase
- 主要是 Java 技术栈

推荐：ZooKeeper

理由：
- Kafka、HBase 原生支持 ZooKeeper
- 复用现有集群
- 成熟稳定
```

## 性能对比

### 理论性能

| 注册中心 | 写 QPS | 读 QPS | 最大实例数 |
|---------|--------|--------|-----------|
| Consul | ~5000 | ~10000 | 50000 |
| ZooKeeper | ~1000 | ~10000 | 10000 |
| etcd | ~5000 | ~20000 | 10000 |
| Nacos | ~10000 | ~50000 | 100000+ |

### 实际测试场景

```bash
# 测试场景：10000 个服务实例

Consul：
- 写延迟：5-10ms
- 读延迟：1-2ms
- 内存占用：较高

ZooKeeper：
- 写延迟：2-5ms
- 读延迟：0.5-1ms
- 内存占用：低

etcd：
- 写延迟：3-8ms
- 读延迟：0.5-1ms
- 内存占用：高（内存数据库）

Nacos：
- 写延迟：2-5ms
- 读延迟：0.5-1ms
- 内存占用：中等
```

## 总结

| 注册中心 | 最佳场景 | 不适合场景 |
|---------|---------|-----------|
| **Consul** | 多数据中心、跨地域、Kubernetes、服务网格 | 单机房、简单场景 |
| **ZooKeeper** | 中间件协调、强一致需求 | 大规模服务发现、配置中心 |
| **etcd** | Kubernetes、服务配置 | 大规模服务发现 |
| **Nacos** | Java 技术栈、注册+配置、Spring Cloud | 多语言、跨地域 |

**最终建议：**

```
新项目 → Nacos（Java）或 Consul（多语言）
已有 ZooKeeper → 继续用或迁移 Nacos
多数据中心 → Consul
Kubernetes 生态 → Consul
配置中心需求 → Nacos
```

---

**留给你的问题：**

假设你负责一个大型互联网项目，有以下需求：

1. 200+ 微服务（Java 为主，少量 Go）
2. 部署在三个机房（北京、上海、广州）
3. 需要同时使用注册中心和配置中心
4. 未来可能需要服务网格

你会选择哪个注册中心？如何设计架构？

如果让你来评估迁移成本，你会考虑哪些因素？
