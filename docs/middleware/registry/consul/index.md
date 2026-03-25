# Consul：多数据中心的分布式服务发现

你的公司有三个机房： 北京、上海、广州。

每个机房有几十台服务器，部署着 Java、Go、Python 等多种语言的服务。

**你需要让这些服务能够互相发现——北京的用户访问北京的服务，广州的用户访问广州的服务。**

你打算怎么做？

Consul 给出了答案：**一个工具，四种能力，开箱即用。**

## 什么是 Consul？

Consul 是 HashiCorp 公司开源的 **分布式服务发现与配置管理平台**。

```
官网：https://www.consul.io/
首次发布：2014 年
当前版本：1.17+（持续活跃维护）

四大核心特性：
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│  服务发现  │ │  健康检查  │ │   KV 存储  │ │ 多数据中心 │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

**Consul 的核心特点：**

- **多数据中心原生支持**：无需额外组件，跨越机房、跨越地区
- **服务健康检查**：内置 HTTP、TCP、Script、TTL、gRPC 等多种检查方式
- **KV 存储**：轻量级配置中心，支持键值存储
- **服务网格**：Consul Connect（可选功能）
- **HTTP API**：天然支持多语言，所有主流语言都能用

## 快速开始

```bash
# 启动 Consul Agent（开发模式）
consul agent -dev

# 注册服务
curl -X PUT http://localhost:8500/v1/agent/service/register \
  -d '{
    "Name": "order-service",
    "ID": "order-service-001",
    "Port": 8080,
    "Address": "192.168.1.100",
    "Check": {
      "HTTP": "http://192.168.1.100:8080/health",
      "Interval": "10s"
    }
  }'

# 查询服务
curl http://localhost:8500/v1/health/service/order-service?passing
```

```java
// Java 客户端
ConsulClient client = new ConsulClient("localhost", 8500);

// 服务注册
client.agentServiceRegister(
    ImmutableServiceRegistration.builder()
        .id("order-service-001")
        .name("order-service")
        .port(8080)
        .check(AgentCheckCheck.http("http://192.168.1.100:8080/health"))
        .build()
);

// 服务发现
List<ServiceHealth> services = client.getHealthyServices("order-service").getValue();

// KV 存储
client.setKVValue("config/order/max-count", "100");
String value = client.getKVValue("config/order/max-count").getValue().getDecodedValue();
```

## 核心概念

### Agent 架构

Consul 采用 **Agent** 架构，每个 Consul 节点都运行一个 Agent。

```
Agent 有两种模式：

1. Server 模式
   - 存储服务注册信息
   - 参与 Leader 选举（Raft 协议）
   - 处理查询请求
   - 建议 3-5 台

2. Client 模式
   - 轻量级
   - 注册本地服务
   - 转发请求到 Server
   - 建议多台

┌─────────────────────────────────────────────────┐
│                 Data Center                      │
│                                                  │
│  ┌─────────────┐                                │
│  │   Server 1  │ ←── Leader                      │
│  │   (Server)  │                                │
│  └─────────────┘                                │
│         ↑                                         │
│    复制 │                                         │
│         ↓                                         │
│  ┌─────────────┐     ┌─────────────┐           │
│  │   Server 2  │ ←──→│   Server 3  │           │
│  └─────────────┘     └─────────────┘           │
│         ↑                                         │
│  ┌──────┴──────┐                                │
│  ↓             ↓                                 │
│ ┌────┐  ┌────┐  ┌────┐                         │
│ │ C1 │  │ C2 │  │ C3 │  ← Client 节点          │
│ └────┘  └────┘  └────┘                         │
└─────────────────────────────────────────────────┘
```

### Catalog vs CNS

Consul 有两个核心概念：

- **Catalog（服务目录）**：记录所有注册的服务，由 Server 节点管理
- **CNS（Service Discovery）**：负责服务注册和发现，可以由 Client 或 Server 处理

详细功能请阅读：

- [Consul 核心特性](/middleware/registry/consul)

## 健康检查

Consul 提供了最丰富的健康检查方式。

| 检查类型 | 说明 | 典型场景 |
|---------|-----|---------|
| **HTTP** | 定期发送 HTTP 请求 | Web 服务 |
| **TCP** | 检测端口是否开放 | TCP 服务、数据库 |
| **Script** | 执行自定义脚本 | 业务逻辑检查 |
| **TTL** | 服务主动上报 | 长任务服务 |
| **gRPC** | 检测 gRPC 服务 | Go 微服务 |

```hcl
# HTTP 检查
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "http-check",
      "http": "http://192.168.1.100:8080/health",
      "interval": "10s",
      "timeout": "5s"
    }
  }
}

# TCP 检查
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "tcp-check",
      "tcp": "192.168.1.100:8080",
      "interval": "10s"
    }
  }
}

# TTL 检查（服务主动上报）
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "ttl-check",
      "ttl": "30s"
    }
  }
}
```

```bash
# TTL 检查：服务主动上报健康状态
curl -X PUT http://localhost:8500/v1/agent/check/pass/service:order-service-001
```

## 多数据中心

Consul 最强大的特性：**原生支持多数据中心**。

```
数据中心 A（dc-beijing）        数据中心 B（dc-shanghai）
┌──────────────┐ WAN 复制     ┌──────────────┐
│  Server A1   │────────────│  Server A2   │
│  Server A3   │             │  Server A3   │
└──────────────┘             └──────────────┘
       ↑                            ↑
       │ LAN                        │ LAN
       ↓                            ↓
┌──────────────┐             ┌──────────────┐
│  Client A1   │             │  Client B1   │
│  Client A2   │             │  Client B2   │
└──────────────┘             └──────────────┘
```

### 跨数据中心查询

```bash
# 查询其他数据中心的服务
curl 'http://localhost:8500/v1/health/service/order-service?dc=dc-shanghai&passing'

# DNS 跨数据中心
dig @localhost -p 8600 order-service.service.dc-shanghai.consul
```

### 就近访问实现

```bash
# 1. 配置数据中心元数据
{
  "service": {
    "name": "order-service",
    "tags": ["dc:beijing"]
  }
}

# 2. 服务发现时过滤数据中心
curl 'http://localhost:8500/v1/health/service/order-service?tag=dc:beijing'
```

```java
// Java 实现就近访问
public String getServiceUrl(String serviceName, String datacenter) {
    // 查询指定数据中心的服务
    String url = String.format("http://localhost:8500/v1/health/service/%s?dc=%s&passing",
        serviceName, datacenter);

    HttpResponse response = httpClient.get(url);
    // 返回最近的服务实例
    return selectNearestInstance(response);
}
```

## 对比选择

| 特性 | Consul | ZooKeeper | etcd | Nacos |
|-----|--------|-----------|------|-------|
| **一致性模型** | CP | CP | CP | CP + AP |
| **服务发现** | 原生 | 需开发 | 需开发 | 原生 |
| **配置中心** | KV 存储 | 需开发 | 需开发 | 原生 |
| **健康检查** | 最丰富 | 基础 | 基础 | 丰富 |
| **多数据中心** | **原生** | 不支持 | 不支持 | 部分支持 |
| **服务网格** | **Consul Connect** | 不支持 | 不支持 | 不支持 |
| **客户端语言** | HTTP API | Java/C | Go | Java/Go |
| **共识协议** | Raft | ZAB | Raft | Raft + Distro |
| **学习曲线** | 中等 | 陡峭 | 陡峭 | 低 |

详细对比请阅读：

- [Consul vs ZooKeeper vs etcd vs Nacos](/middleware/registry/consul-compare)

## 使用场景

| 场景 | 推荐指数 | 说明 |
|-----|--------|-----|
| **多数据中心** | ⭐⭐⭐⭐⭐ | Consul 最强场景 |
| **跨地域服务发现** | ⭐⭐⭐⭐⭐ | 原生支持 |
| **Kubernetes 集群** | ⭐⭐⭐⭐⭐ | 云原生友好 |
| **服务网格** | ⭐⭐⭐⭐⭐ | Consul Connect |
| **多语言技术栈** | ⭐⭐⭐⭐⭐ | HTTP API |
| **Java 微服务** | ⭐⭐⭐ | 可以，但 Nacos 更简单 |
| **需要配置中心** | ⭐⭐⭐ | KV 存储，功能较弱 |

**选 Consul 如果：**

- 需要跨数据中心服务发现
- 多语言技术栈（Java、Go、Python 等）
- Kubernetes + 服务网格
- 需要 Consul Connect
- 需要丰富的健康检查

**不选 Consul 如果：**

- 纯 Java 技术栈（选 Nacos）
- 已有 ZooKeeper（选 ZooKeeper）
- 需要强大的配置中心（选 Nacos）
- 服务实例 > 50000（选 Nacos）

## 面试追问

**Q：Consul 的多数据中心是怎么实现的？**

A：Consul 使用 **WAN Gossip 协议** 实现跨数据中心通信：
- 每个数据中心内部用 LAN Gossip 通信
- 数据中心之间用 WAN Gossip 通信
- 跨数据中心查询时，通过 WAN 网络转发

**Q：Consul 和 ZooKeeper 的区别？**

A：
- 功能：Consul 有服务发现 + 健康检查 + KV，ZK 只有协调
- 多语言：Consul 用 HTTP API，ZK 用特定客户端
- 多数据中心：Consul 原生支持，ZK 不支持
- 健康检查：Consul 内置多种检查，ZK 需要自己实现

**Q：Consul 的 Raft 协议和 ZooKeeper 的 ZAB 协议有什么区别？**

A：两者都是共识协议，都能保证强一致性：
- ZAB 是 ZooKeeper 专用，更专注于「主备切换」
- Raft 是通用协议，更易于理解和实现
- 性能上，两者差异不大

---

**留给你的问题：**

假设你在北京和上海各有一个 Consul 集群，两地的服务实例需要互相发现。

如果北京的用户访问上海的服务，上海的服务实例宕机了，会发生什么？

Consul 的多数据中心支持能自动切换到其他实例吗？还是需要你手动处理？

这个问题涉及到多数据中心的服务发现和故障转移设计。
