# Nacos vs ZooKeeper vs Consul

注册中心选型，是微服务架构中的经典难题。

有人选 ZooKeeper，因为成熟稳定。

有人选 Nacos，因为功能全面。

有人选 Consul，因为多语言友好。

**但到底选哪个？**

今天我们从多个维度深入对比，帮你做出选择。

## 一览表

| 特性 | Nacos | ZooKeeper | Consul |
|-----|-------|-----------|--------|
| **一致性模型** | CP + AP | CP | CP |
| **服务健康检查** | TCP/HTTP/MySQL | 心跳 | Agent + 健康检查 |
| **多数据中心** | 支持 | 不支持 | 原生支持 |
| **支持语言** | Java/Go/Node.js | Java/C | 所有主流语言 |
| **配置管理** | 原生支持 | 需二次开发 | 原生支持 |
| **权限控制** | RBAC | ACL | ACL |
| **服务实例上限** | 100000+ | ~10000 | ~50000 |
| **社区活跃度** | 非常活跃 | 一般 | 活跃 |
| **维护状态** | 持续维护 | 稳定维护 | 持续维护 |

## 一致性模型对比

### Nacos：同时支持 CP 和 AP

```yaml
# AP 模式（服务发现）
spring:
  cloud:
    nacos:
      discovery:
        # 默认 AP，支持临时实例
        ephemeral: true

# CP 模式（配置管理、选举）
spring:
  cloud:
    nacos:
      config:
        # 启用 Raft 协议
        raft:
          enabled: true
```

**Nacos 的聪明之处：** 同一集群可以同时服务发现用 AP、配置管理用 CP。

### ZooKeeper：强一致 CP

```yaml
# ZooKeeper 只能 CP
# 所有写操作必须经过 Leader
# 过半节点确认才算成功
```

**优点：** 数据一致性强
**缺点：** 可用性受限，网络分区时可能不可用

### Consul：强一致 CP

```bash
# Consul 支持两种一致性模式
# default：Raft 协议，强一致
curl http://localhost:8500/v1/catalog/service/my-service

# stale：允许读取旧数据，高可用
curl http://localhost:8500/v1/catalog/service/my-service?stale
```

## 服务健康检查对比

### Nacos

```yaml
# 支持多种健康检查方式
spring:
  cloud:
    nacos:
      discovery:
        health-checker:
          type: HTTP        # HTTP/TCP/MYSQL
          interval: 10s      # 检查间隔
          path: /actuator/health
          port: 8080
```

```java
// 自定义健康检查
@Component
public class MyHealthChecker implements HealthChecker {
    @Override
    public boolean isHealthy(String ip, int port) {
        try {
            HttpResponse response = HttpUtil.get("http://" + ip + ":" + port + "/health");
            return response.getStatus() == 200;
        } catch (Exception e) {
            return false;
        }
    }
}
```

### ZooKeeper

```java
// ZooKeeper 没有原生健康检查
// 健康检查需要自己实现
// 通常结合 Curator 或自己实现心跳

public class HealthCheck {
    public boolean isHealthy(String ip, int port) {
        try {
            Socket socket = new Socket(ip, port);
            socket.close();
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
```

### Consul

```hcl
# Consul 支持丰富的健康检查配置
service {
  name = "order-service"
  port = 8080
  check {
    id = "http-check"
    http = "http://localhost:8080/health"
    interval = "10s"
    timeout = "5s"
  }
  check {
    id = "tcp-check"
    tcp = "localhost:8080"
    interval = "10s"
  }
  check {
    id = "grpc-check"
    grpc = "localhost:8080"
    grpc_use_tls = false
    interval = "10s"
  }
}
```

## 配置管理对比

### Nacos：原生支持配置中心

```java
// 配置获取和监听
@RestController
@RefreshScope
public class ConfigController {
    @Value("${order.max-count:100}")
    private int maxCount;

    @NacosConfigListener
    public void onConfigChange(String newConfig) {
        System.out.println("配置变更: " + newConfig);
    }
}
```

### ZooKeeper：需要二次开发

```java
// ZooKeeper 做配置中心需要自己实现
// 典型方案：ZNode + Watch

public class ZKConfigCenter {
    public void watchConfig(String path) {
        zk.getData(path, event -> {
            if (event.getType() == Event.EventType.NodeDataChanged) {
                refreshConfig();
            }
        }, stat);
    }
}
```

**缺点：**
- 没有配置版本管理
- 没有回滚功能
- 没有分组管理
- 配置变更没有 UI

### Consul

```bash
# Consul KV 存储
consul kv put config/order/max-count 100
consul kv get config/order/max-count
consul kv delete config/order/max-count

# 配置监听
consul config watch -type=key -prefix=config/order
```

```java
// Consul 配置客户端
@Value("${config/order/max-count}")
private int maxCount;
```

## 多语言支持对比

### Nacos

| 语言 | 客户端 | 支持程度 |
|-----|-------|---------|
| Java | spring-cloud-starter-alibaba-nacos-discovery | 完整 |
| Go | go nacos client | 完整 |
| Node.js | nacos-sdk-js | 基本完整 |
| Python | nacos-sdk-python | 基本完整 |
| C# | nacos-csharp-sdk | 基本完整 |

### ZooKeeper

| 语言 | 客户端 | 支持程度 |
|-----|-------|---------|
| Java | Apache Curator | 完整 |
| C | zookeeper-client-c | 完整 |
| Python | kazoo | 完整 |
| Go | scrollpad/go-zookeeper | 基本完整 |

### Consul

| 语言 | 客户端 | 支持程度 |
|-----|-------|---------|
| 所有语言 | HTTP API | 完整 |
| Java | consul-api | 完整 |
| Go | consul sdk | 完整 |
| Python | python-consul | 完整 |

**Consul 的优势：** HTTP API 是天然的多语言支持，不需要特定的客户端库。

## 性能对比

### 理论性能

| 指标 | Nacos | ZooKeeper | Consul |
|-----|-------|-----------|--------|
| 写吞吐（单机） | ~10000 QPS | ~1000 QPS | ~3000 QPS |
| 读吞吐（单机） | ~50000 QPS | ~10000 QPS | ~10000 QPS |
| 最大服务实例 | 100000+ | ~10000 | ~50000 |

### 实际测试场景

```bash
# 测试场景：10000 个服务实例，每个实例 5 秒心跳一次

Nacos：
- 写 QPS：10000 / 5 = 2000 QPS（轻松应对）
- CPU 使用率：稳定

ZooKeeper：
- 写 QPS：2000 QPS（接近上限）
- CPU 使用率：较高

Consul：
- 写 QPS：2000 QPS（需要优化）
- 内存使用：较高
```

## 选型建议

### 选 Nacos 如果：

```
✓ Java 技术栈，微服务框架是 Spring Cloud
✓ 需要同时使用注册中心和配置中心
✓ 服务实例数量 > 5000
✓ 需要配置热更新
✓ 需要友好的运维 UI
```

### 选 ZooKeeper 如果：

```
✓ Kafka、HBase、Dubbo 等中间件需要
✓ 数据一致性要求极高
✓ 服务实例数量 < 5000
✓ 已经部署了 ZooKeeper 集群
```

### 选 Consul 如果：

```
✓ 多语言技术栈
✓ 需要跨数据中心服务发现
✓ 需要服务网格（Consul Connect）
✓ 需要内置的 KV 存储
```

## 实战对比

### Spring Cloud 集成

**Nacos（最简单）：**

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
</dependency>
```

**ZooKeeper：**

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-zookeeper-discovery</artifactId>
</dependency>
```

**Consul：**

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-consul-discovery</artifactId>
</dependency>
```

### 配置管理集成

**Nacos：**

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
</dependency>
```

**Consul：**

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-consul-config</artifactId>
</dependency>
```

**ZooKeeper：** 需要自己实现配置管理功能。

## 总结

没有最好的注册中心，只有最合适的。

| 场景 | 推荐选择 |
|-----|---------|
| Java + Spring Cloud | Nacos（首选） |
| 已有 ZooKeeper | ZooKeeper |
| 多语言 + 跨数据中心 | Consul |
| 需要配置中心 | Nacos |
| 中间件协调 | ZooKeeper |
| 服务网格 | Consul |

**记住：技术选型没有标准答案，要结合团队技术栈、项目规模和业务需求综合考虑。**

---

**留给你的问题：**

假设你负责一个多语言技术栈的项目，后端有 Java、Go、Python 三种服务。但团队主要使用 Spring Cloud。

你会选择哪个注册中心？为什么？

如果需要同时满足「Spring Cloud 集成简单」和「多语言支持」，你有什么方案？
