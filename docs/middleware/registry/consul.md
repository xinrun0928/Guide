# Consul 核心特性

如果让你设计一个工具，能够同时做到：

- 服务发现（让服务互相找到对方）
- 健康检查（确保找到的服务是健康的）
- KV 存储（存储配置、开关）
- 多数据中心（跨越机房、跨越地区）

**你会怎么设计？**

Consul 给出了答案：一个工具，四种能力，开箱即用。

## Consul 是什么？

Consul 是 HashiCorp 公司开源的分布式服务发现和配置中心。

```
官网：https://www.consul.io/
首次发布：2014 年
当前版本：1.17+（持续活跃维护）
```

**Consul 的核心特点：**
- **多数据中心原生支持**：无需额外组件
- **服务健康检查**：内置多种健康检查方式
- **KV 存储**：轻量级配置中心
- **服务网格**：Consul Connect（可选功能）
- **HTTP API**：天然支持多语言

## 核心概念

### Agent

Consul 采用 **Agent** 架构。每个 Consul 节点都运行一个 Agent。

```
Consul Agent 有两种模式：

1. Server 模式
   - 存储服务注册信息
   - 参与 Leader 选举
   - 处理查询请求
   - 建议 3-5 台

2. Client 模式
   - 轻量级
   - 注册本地服务
   - 转发请求到 Server
   - 建议多台
```

```
┌─────────────────────────────────────────────────┐
│                    Data Center                    │
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
│  │   (Server)  │     │   (Server)  │           │
│  └─────────────┘     └─────────────┘           │
│         ↑                                         │
│         │                                         │
│  ┌──────┴──────┐                                │
│  │             │                                 │
│  ↓             ↓                                 │
│ ┌────┐  ┌────┐  ┌────┐                         │
│ │ C1 │  │ C2 │  │ C3 │  ← Client 节点           │
│ └────┘  └────┘  └────┘                         │
│   ↑        ↑       ↑                             │
│   │        │       │                             │
│ 服务注册   服务注册  服务注册                      │
└─────────────────────────────────────────────────┘
```

### Catalog vs CNS

Consul 有两个核心概念：

**1. Catalog（服务目录）**
- 记录所有注册的服务
- 由 Server 节点管理
- 提供全局视图

**2. CNS（Service Discovery）**
- 负责服务注册和发现
- 可以由 Client 或 Server 处理

## 服务发现

### 服务注册

```hcl
# 服务定义文件 service.json
{
  "service": {
    "name": "order-service",
    "id": "order-service-001",
    "port": 8080,
    "address": "192.168.1.100",
    "tags": ["v1", "prod"],
    "meta": {
      "version": "1.0.0"
    },
    "check": {
      "id": "health-check",
      "http": "http://192.168.1.100:8080/health",
      "interval": "10s",
      "timeout": "5s"
    }
  }
}
```

```bash
# 方式一：配置文件注册
consul agent -config-file service.json

# 方式二：HTTP API 注册
curl -X PUT http://localhost:8500/v1/agent/service/register \
  -d '{
    "Name": "order-service",
    "ID": "order-service-001",
    "Port": 8080,
    "Check": {
      "HTTP": "http://192.168.1.100:8080/health",
      "Interval": "10s"
    }
  }'
```

### 服务查询

```bash
# 查询所有服务
curl http://localhost:8500/v1/catalog/services

# 查询特定服务实例
curl http://localhost:8500/v1/health/service/order-service

# 健康检查过滤
curl http://localhost:8500/v1/health/service/order-service?passing
```

```json
// 返回的服务实例信息
[
  {
    "Service": {
      "ID": "order-service-001",
      "Service": "order-service",
      "Address": "192.168.1.100",
      "Port": 8080,
      "Tags": ["v1"],
      "Meta": {"version": "1.0.0"}
    },
    "Checks": [
      {
        "Status": "passing",
        "ServiceName": "order-service"
      }
    ]
  }
]
```

## 健康检查

Consul 提供了多种健康检查方式：

### HTTP 检查

```hcl
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "http-check",
      "http": "http://192.168.1.100:8080/health",
      "method": "GET",
      "interval": "10s",
      "timeout": "5s"
    }
  }
}
```

### TCP 检查

```hcl
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "tcp-check",
      "tcp": "192.168.1.100:8080",
      "interval": "10s",
      "timeout": "5s"
    }
  }
}
```

### Script 检查

```hcl
{
  "service": {
    "name": "order-service",
    "check": {
      "id": "script-check",
      "args": ["/usr/local/bin/check_order.sh"],
      "interval": "30s"
    }
  }
}
```

### TTL 检查

```hcl
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
# 主动上报健康状态
curl -X PUT http://localhost:8500/v1/agent/check/pass/service:order-service-001
```

### 健康检查配置参数

```hcl
{
  "check": {
    "id": "example",
    "name": "Example HTTP Check",
    "http": "https://example.com/health",
    "tls_skip_verify": true,
    "interval": "10s",
    "timeout": "5s",
    "deregister_critical_service_after": "2m"
  }
}
```

| 参数 | 说明 |
|-----|-----|
| `interval` | 检查间隔 |
| `timeout` | 检查超时时间 |
| `deregister_critical_service_after` | 超过多长时间后自动注销 |

## KV 存储

Consul 提供了轻量级的 Key-Value 存储。

### 基本操作

```bash
# 存储值
consul kv put config/order/max-count 100
consul kv put config/order/database "mysql://localhost:3306"

# 读取值
consul kv get config/order/max-count

# 删除值
consul kv delete config/order/max-count

# 列出键的前缀
consul kv keys config/
```

### 使用场景

```bash
# 1. 功能开关
consul kv put feature/new-checkout/enabled true
consul kv put feature/recommendation/enabled false

# 2. 配置管理
consul kv put config/database/max-connections 100
consul kv put config/redis/timeout 5000

# 3. 分布式锁
consul kv put locks/order-lock "" -acquire -ttl 30s
```

### Java 客户端

```java
import com.ecwid.consul.v1.ConsulClient;
import com.ecwid.consul.v1.kv.model.GetValue;

public class ConsulKVExample {
    public void kvOperations() {
        ConsulClient client = new ConsulClient("localhost", 8500);

        // 存储
        client.setKVValue("config/order/max-count", "100");

        // 读取
        GetValue response = client.getKVValue("config/order/max-count");
        String value = response.getValue();

        // 删除
        client.deleteKVValue("config/order/max-count");
    }
}
```

## 多数据中心

Consul 最强大的特性之一：**原生支持多数据中心**。

### 架构

```
数据中心 A（dc1）          数据中心 B（dc2）
┌──────────────┐          ┌──────────────┐
│  Server A1   │  WAN     │  Server B1   │
│  Server A2   │──────────│  Server B2   │
│  Server A3   │  复制    │  Server B3   │
└──────────────┘          └──────────────┘
       ↑                         ↑
       │ LAN                      │ LAN
       ↓                         ↓
┌──────────────┐          ┌──────────────┐
│  Client A1   │          │  Client B1   │
│  Client A2   │          │  Client B2   │
└──────────────┘          └──────────────┘
```

### 配置

```hcl
# Server 节点配置（dc1）
{
  "datacenter": "dc1",
  "data_dir": "/var/consul",
  "server": true,
  "bootstrap_expect": 3,
  "retry_join": ["server1.dc1", "server2.dc1"],
  "rejoin_after_leave": true,
  "enable_debug": true
}
```

```hcl
# Server 节点配置（dc2）
{
  "datacenter": "dc2",
  "data_dir": "/var/consul",
  "server": true,
  "bootstrap_expect": 3,
  "retry_join": ["server1.dc2", "server2.dc2"],
  "rejoin_after_leave": true
}
```

### 跨数据中心查询

```bash
# 查询其他数据中心的服务
curl 'http://localhost:8500/v1/health/service/order-service?dc=dc2&passing'

# 在 DNS 中指定数据中心
dig @localhost -p 8600 order-service.service.dc2.consul
```

## 总结

Consul 的四大核心特性：

```
服务发现 → 注册、查询、健康检查
健康检查 → HTTP/TCP/Script/TTL
KV 存储 → 配置、开关、锁
多数据中心 → 跨地域、跨机房
```

**Consul 的优势：**

- **原生多数据中心**：无需额外组件
- **丰富的健康检查**：支持多种方式
- **HTTP API**：天然支持多语言
- **KV 存储**：轻量级配置中心
- **服务网格**：Consul Connect（可选）

---

**留给你的问题：**

假设你有三个数据中心，分别在北京、上海、广州。你希望广州的用户访问广州的服务实例，上海的用户访问上海的服务实例。

用 Consul 的多数据中心功能，如何实现这种「就近访问」？

有没有自动的方案，还是需要手动配置？
