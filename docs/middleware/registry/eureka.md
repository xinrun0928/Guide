# Eureka 架构

Netflix 在 2012 年开源了 Eureka，创造了「微服务注册中心」这个概念。

2018 年，Netflix 宣布 Eureka 2.x 停止维护。一时间，Eureka 被判了「死刑」。

但 Eureka 1.x 至今仍在大量生产环境中运行。

**为什么一个「已停止维护」的项目还能存活？它的设计有什么过人之处？**

今天，我们来深入理解 Eureka 的架构设计。

## 核心架构：客户端-服务端模式

Eureka 采用经典的 **客户端-服务端（C/S）** 架构。

```
┌─────────────────────────────────────────────────────────┐
│                     Eureka Server                        │
│                                                          │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐    │
│   │  Registry   │  │  Registry   │  │  Registry   │    │
│   │  区域 A     │  │  区域 B     │  │  区域 C     │    │
│   └─────────────┘  └─────────────┘  └─────────────┘    │
│                                                          │
│   ┌─────────────┐  ┌─────────────┐                      │
│   │  Renewals   │  │  Instances  │                      │
│   │  计数器     │  │  缓存       │                      │
│   └─────────────┘  └─────────────┘                      │
└─────────────────────────────────────────────────────────┘
         ↑                    ↑
         │                    │
┌────────┴────────────────────┴────────┐
│           Eureka Client               │
│                                       │
│  ┌───────────┐      ┌───────────┐    │
│  │  服务发现 │      │  心跳上报 │    │
│  │  客户端   │      │  客户端   │    │
│  └───────────┘      └───────────┘    │
└──────────────────────────────────────┘
```

### 服务端组件

```java
// Eureka Server 的核心组件

public class EurekaServer {
    // 1. Application Resource Manager
    // 管理所有服务实例的注册信息
    private ConcurrentHashMap&lt;String, Application&gt; registry;

    // 2. Registry
    // 存储服务实例的详细信息
    static class Application {
        String name;
        Set&lt;InstanceInfo&gt; instances;
    }

    // 3. Instance Registry
    // 注册、续约、下线、过期处理
    InstanceRegistry registry;

    // 4. Response Cache
    // 读写分离，提高性能
    ResponseCache readWriteCacheMap;
    ResponseCache readOnlyCacheMap;
}
```

### 客户端组件

```java
// Eureka Client 的核心组件

public class EurekaClient {
    // 1. ApplicationInfoManager
    // 管理本地服务实例信息
    private ApplicationInfoManager infoManager;

    // 2. DiscoveryClient
    // 服务发现的核心客户端
    private DiscoveryClient discoveryClient;

    // 3. HealthCheckHandler
    // 健康检查
    private HealthCheckHandler healthCheckHandler;

    // 4. InstanceInfo
    // 本地服务实例信息
    private InstanceInfo localInstanceInfo;
}
```

## 服务注册流程

### 服务实例启动

```
应用启动
     ↓
读取配置：eureka.client.service-url.defaultZone=http://eureka:8761/eureka
     ↓
读取本地 IP、端口、应用名
     ↓
构建 InstanceInfo
     ↓
发送 POST /eureka/apps/{appName}
     ↓
Eureka Server 注册成功
     ↓
启动心跳定时器（每 30 秒续约）
```

```java
// Eureka 客户端注册逻辑（简化）
public void register() {
    // 构建实例信息
    InstanceInfo info = new InstanceInfo();
    info.setInstanceId(instanceId);
    info.setHostName(hostName);
    info.setPort(port);
    info.setAppName(appName);
    info.setStatus(InstanceStatus.UP);

    // 发送注册请求
    httpClient.post(
        "/eureka/apps/" + appName,
        info.toJson(),
        headers
    );
}
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

## 心跳续约

Eureka 采用**拉模式**的心跳机制：客户端主动上报自己的状态。

### 心跳流程

```
服务实例                              Eureka Server
     │                                    │
     │──── 心跳 PUT /eureka/apps/xxx ───→ │
     │      InstanceId + Status           │
     │                                    │
     │     ←─── 200 OK ──────────────────  │
     │                                    │
     │     （每 30 秒重复一次）           │
```

```java
// 心跳续约逻辑
public boolean renew() {
    // 发送续约请求
    EurekaHttpResponse&lt;InstanceInfo&gt; response = httpClient.put(
        "/eureka/apps/" + appName + "/" + instanceId,
        instanceInfo,
        headers
    );

    // 如果续约失败（网络问题、实例已过期）
    if (response.getStatusCode() == 404) {
        // 实例不存在，需要重新注册
        register();
    }

    return response.getStatusCode() == 200;
}
```

```yaml
# 心跳相关配置
eureka:
  instance:
    lease-renewal-interval-in-seconds: 30   # 续约间隔
    lease-expiration-duration-in-seconds: 90 # 过期时间
```

### 续约失败处理

```java
// 心跳失败的重试策略
public boolean renewWithBackoff() {
    int attempts = 0;
    int maxAttempts = 3;

    while (attempts < maxAttempts) {
        try {
            if (renew()) {
                return true;
            }
        } catch (Exception e) {
            // 记录日志
        }

        // 指数退避
        long sleepTime = exponentialBackoff(attempts);
        Thread.sleep(sleepTime);
        attempts++;
    }

    // 所有重试都失败，重新注册
    register();
    return false;
}
```

## 服务发现

### 获取服务实例列表

```java
// 获取所有健康实例
public List&lt;InstanceInfo&gt; getInstancesById(String appName) {
    // 从本地缓存获取（默认缓存 30 秒）
    Applications applications = cacheManager.getApplications();

    // 过滤健康实例
    return applications.getInstancesById(appName)
        .stream()
        .filter(i -> i.getStatus() == InstanceStatus.UP)
        .collect(toList());
}
```

```java
// Spring Cloud 中的服务调用
@RestController
public class OrderController {
    @LoadBalanced
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @GetMapping("/order")
    public String createOrder() {
        // 使用服务名调用，不需要知道 IP 和端口
        String result = restTemplate.getForObject(
            "http://inventory-service/api/stock",
            String.class
        );
        return "订单创建成功: " + result;
    }
}
```

### 本地缓存机制

Eureka Client 会缓存服务实例列表，避免每次都请求 Server。

```
首次启动：
         ↓
从 Eureka Server 获取全量服务列表
         ↓
存入本地缓存
         ↓
定时刷新（每 30 秒）

运行时：
         ↓
优先从本地缓存读取
         ↓
同时后台异步刷新
         ↓
如果 Server 不可用，使用本地缓存
```

```java
// 缓存刷新逻辑
@Scheduled(every30Seconds)
public void refreshRegistry() {
    try {
        // 从 Server 获取最新数据
        Applications fetch = eurekaClient.getApplications();

        // 和本地缓存比较
        if (fetch != null) {
            localRegionApps.set(fetch);
            applications.set(fetch);
        }
    } catch (Throwable t) {
        // 如果刷新失败，使用本地缓存
        log.warn("从 Eureka Server 刷新失败，使用本地缓存");
    }
}
```

## 多级缓存架构

Eureka Server 采用了**多级缓存**来提高性能。

```
请求
  ↓
┌─────────────────┐
│ ReadOnly Cache  │ ← 定时同步（30 秒）
│  (ConcurrentMap) │
└────────┬────────┘
         ↓
┌─────────────────┐
│ ReadWrite Cache  │ ← 实时更新
│  (Guava Cache)   │
└────────┬────────┘
         ↓
┌─────────────────┐
│    Registry      │ ← 最终数据源
│  (ConcurrentMap) │
└─────────────────┘
```

```java
// 三级缓存的实现
public class ResponseCacheImpl implements ResponseCache {
    // 第一级：只读缓存（30 秒刷新一次）
    private final ConcurrentHashMap&lt;Key, Value&gt; readOnlyCacheMap;

    // 第二级：读写缓存（Guava Cache）
    private LoadingCache&lt;Key, Value&gt; readWriteCacheMap;

    // 第三级：Registry（ConcurrentHashMap）
    private final ConcurrentHashMap&lt;Key, InstanceRegistry&gt; registry;

    // 获取数据
    public Value get(Key key) {
        // 先查只读缓存
        Value value = readOnlyCacheMap.get(key);
        if (value != null) {
            return value;
        }

        // 再查读写缓存
        try {
            return readWriteCacheMap.get(key);
        } catch (ExecutionException e) {
            return null;
        }
    }
}
```

## 集群部署

Eureka Server 之间会同步注册信息，实现高可用。

```
┌──────────────┐         复制         ┌──────────────┐
│  Eureka 1   │ ←─────────────────→ │  Eureka 2   │
│  (Zone A)   │                      │  (Zone B)   │
└──────────────┘                      └──────────────┘
       ↑                                     ↑
       │ 复制                                │ 复制
       ↓                                     ↓
┌──────────────┐                      ┌──────────────┐
│  Eureka 3   │                      │  Eureka 4   │
│  (Zone C)   │                      │  (Zone D)   │
└──────────────┘                      └──────────────┘
```

```yaml
# Eureka Server 配置
server:
  port: 8761

eureka:
  instance:
    hostname: eureka1
  client:
    # 注册到其他 Server
    register-with-eureka: true
    fetch-registry: true
    service-url:
      defaultZone: http://eureka2:8761/eureka/,http://eureka3:8761/eureka/

---
spring:
  profiles: eureka2
eureka:
  instance:
    hostname: eureka2
  client:
    service-url:
      defaultZone: http://eureka1:8761/eureka/,http://eureka3:8761/eureka/
```

## 总结

Eureka 的核心设计：

```
客户端注册 → 心跳续约 → Server 缓存 → 服务发现
```

**Eureka 的特点：**

- **简单**：架构清晰，易于理解
- **可用性优先**：AP 模型，网络分区时仍能工作
- **多级缓存**：提高读取性能
- **客户端缓存**：Server 不可用时仍能工作

**为什么 Eureka 还能在生产环境存活？**

- 架构简单，运维成本低
- 满足大部分业务场景
- 替代方案（Nacos）需要迁移成本

---

**留给你的问题：**

假设 Eureka Server 集群有 3 台机器，其中 1 台因为网络问题和另外 2 台断开连接。

断开的这 1 台会怎样？它会停止服务吗？

如果没有自我保护机制，会发生什么？
