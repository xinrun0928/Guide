# Nacos 服务注册与心跳机制

你有没有想过这个问题：

服务 A 部署了 3 个实例，IP 分别是 192.168.1.1、192.168.1.2、192.168.1.3。

某个时刻，192.168.1.2 这个实例宕机了。

消费者服务 B 是怎么知道的？Nacos 是怎么剔除这个不健康实例的？

这就是今天要聊的——Nacos 的服务注册与心跳机制。

## 服务注册流程

### 应用启动时注册

当 Spring Boot 应用启动时，NacosDiscoveryClient 会自动向 Nacos Server 注册：

```java
// 伪代码：Nacos 服务注册流程
public void register() {
    // 1. 构建实例信息
    Instance instance = new Instance();
    instance.setIp("192.168.1.1");
    instance.setPort(8080);
    instance.setInstanceId("192.168.1.1:8080");
    instance.setServiceName("user-service");
    instance.setClusterName("DEFAULT");
    instance.setWeight(1.0);
    instance.setHealthy(true);

    // 2. 发送注册请求
    namingService.registerInstance("user-service", instance);
}
```

### 注册请求

```bash
# Nacos 注册 API
POST /nacos/v1/ns/instance

# 请求参数
{
    "serviceName": "user-service",
    "ip": "192.168.1.1",
    "port": 8080,
    "clusterName": "DEFAULT",
    "weight": 1.0,
    "healthy": true,
    "ephemeral": true,  // 临时实例
    "namespaceId": "public"
}
```

## 心跳机制

### 心跳发送

客户端会定期发送心跳，告诉 Nacos Server「我还活着」：

```java
// 心跳任务（默认 5 秒一次）
public class BeatTask implements Runnable {
    public void run() {
        // 1. 构建心跳信息
        BeatResult result = httpClient.post(
            "nacos/v1/ns/instance/beat",
            buildBeatParams()
        );

        // 2. 检查响应
        if (result.getCode() == 20404) {
            // 实例不存在，重新注册
            register();
        }
    }
}
```

### 心跳参数

```yaml
# Nacos 客户端配置
spring:
  cloud:
    nacos:
      discovery:
        heart-beat-interval: 5000      # 心跳间隔（毫秒）
        heart-beat-timeout: 15000      # 心跳超时（毫秒）
        ip-delete-timeout: 30000       # 实例删除超时（毫秒）
```

### 服务端健康检查

Nacos Server 收到心跳后，更新实例的最后更新时间：

```java
// Nacos 服务端处理心跳
public void handleBeat(BeatInfo beatInfo) {
    // 1. 查找实例
    Instance instance = serviceManager.getInstance(
        beatInfo.getServiceName(),
        beatInfo.getIp(),
        beatInfo.getPort()
    );

    // 2. 更新实例信息
    instance.setLastBeat(System.currentTimeMillis());
    instance.setHealthy(true);

    // 3. 更新服务实例列表
    updateServiceInstances(instance.getServiceName());
}
```

## 服务健康判定

### 健康阈值

当 Nacos Server 超过 `heartBeatTimeout`（默认 15 秒）没收到心跳：

```java
// 服务端健康检查
public void checkHealth() {
    long now = System.currentTimeMillis();

    for (Instance instance : allInstances) {
        long lastBeat = instance.getLastBeat();

        // 超过 15 秒没收到心跳，标记为不健康
        if (now - lastBeat > heartBeatTimeout) {
            instance.setHealthy(false);
        }
    }
}
```

### 服务下线

不健康的实例会被从「健康实例列表」中移除，但不会立即删除。

```java
// 获取健康实例（不健康的不会返回）
public List&lt;Instance&gt; selectInstances(String serviceName, boolean healthyOnly) {
    List&lt;Instance&gt; instances = serviceManager.getAllInstances(serviceName);

    if (healthyOnly) {
        // 只返回健康的实例
        return instances.stream()
            .filter(Instance::isHealthy)
            .collect(Collectors.toList());
    }
    return instances;
}
```

## 三级缓存机制

Nacos 实现了一套三级缓存来提升性能：

### L1：注册表缓存

```java
// 本地缓存（ConcurrentHashMap）
Map&lt;String, Service&gt; localCache = new ConcurrentHashMap&lt;&gt;();
// 注册表变更时，更新本地缓存
```

### L2：进程缓存

```java
// Nacos 客户端缓存
NacosNamingService namingService = new NacosNamingService();
namingService.getAllInstances("user-service");
// 第一次调用会从服务端拉取，后续使用本地缓存
```

### L3：定时轮询

```java
// 定时从服务端拉取最新数据
ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
executor.scheduleAtFixedRate(() -> {
    // 每 30 秒同步一次
    syncFromServer();
}, 30, 30, TimeUnit.SECONDS);
```

## Nacos 2.0 的升级：gRPC 长连接

### 旧版本的问题

Nacos 1.x 使用 HTTP 轮询实现服务发现：

```
问题：轮询间隔 30 秒，意味着服务上下线最多延迟 30 秒
解决：缩短轮询间隔 → 增加服务端压力
```

### Nacos 2.0 的方案

Nacos 2.0 引入 gRPC 长连接：

```
1. 客户端与 Nacos Server 建立 gRPC 长连接
2. 服务端主动推送变更
3. 服务上下线延迟从 30 秒降到 1 秒以内
```

```yaml
# Nacos 2.0 客户端配置
spring:
  cloud:
    nacos:
      discovery:
        server-addr: localhost:8848
        # 2.0 新增配置
        naming-load-cache-at-start: true  # 启动时加载缓存
```

### 协议差异

| 版本 | 通信方式 | 延迟 | 并发支持 |
|------|---------|------|---------|
| Nacos 1.x | HTTP 轮询 | ~30s | 一般 |
| Nacos 2.0 | gRPC 长连接 | < 1s | 更好 |

## Spring Boot + Nacos 示例

```java
@SpringBootApplication
@EnableDiscoveryClient  // 启用服务发现
public class UserServiceApplication {
    public static void main(String[] args) {
        SpringApplication.run(UserServiceApplication.class, args);
    }
}
```

```yaml
# application.yml
spring:
  application:
    name: user-service
  cloud:
    nacos:
      discovery:
        server-addr: 192.168.1.1:8848
        namespace: dev
        cluster-name: DEFAULT
```

## 总结

Nacos 的服务注册与心跳机制，是一个典型的「心跳保活」实现：

- **注册**：应用启动时注册实例信息
- **心跳**：客户端每 5 秒发送心跳
- **健康检查**：服务端 15 秒没收到心跳则标记不健康
- **服务发现**：只返回健康的实例
- **2.0 升级**：gRPC 长连接，延迟从 30s 降到 < 1s

理解这套机制，才能用好 Nacos 的服务发现。

**面试追问方向：**
- Nacos 的心跳间隔可以调整吗？有什么影响？
- Nacos 2.0 的 gRPC 连接是怎么建立的？
- 如果 Nacos Server 不可用，客户端会怎样？
- Nacos 的三级缓存是怎么工作的？