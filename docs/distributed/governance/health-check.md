# 服务注册与健康检查：心跳机制与故障剔除

你有没有想过这个问题：

服务 A 有 3 个实例，其中一个实例宕机了。

但服务 A 的消费者还在往这个宕机的实例发送请求，导致请求失败。

**为什么消费者不知道这个实例已经不可用了？**

答案是：**健康检查机制缺失或不完善**。

今天，我们来聊聊服务健康检查的实现。

## 健康检查的必要性

分布式系统中，实例随时可能宕机：

```
1. 硬件故障（机器宕机、网络中断）
2. 软件故障（OOM、线程池耗尽）
3. 资源耗尽（CPU 100%、磁盘写满）
4. 临时不可用（GC 暂停、JVM 预热）
```

如果健康检查不到位，故障实例会持续接收流量，直到超时才知道实例不可用。

## 健康检查的两种方式

### 客户端心跳（Client-Side Health Check）

服务实例主动上报自己的健康状态。

```
┌─────────────┐        心跳        ┌─────────────┐
│  服务实例    │ ────────────────► │  注册中心    │
│  (每 5s)    │ ◄───────────────  │             │
│              │        ACK        │             │
└─────────────┘                  └─────────────┘
```

**代表系统**：Nacos、Eureka

### 服务端探测（Server-Side Health Check）

注册中心主动探测服务实例的健康状态。

```
┌─────────────┐                  ┌─────────────┐
│  注册中心    │ ─ ─ ─ 探测 ─ ─ ─► │  服务实例    │
│             │ ◄─── 健康状态 ───  │             │
└─────────────┘                  └─────────────┘
```

**代表系统**：Kubernetes、Dubbo Admin

## 客户端心跳实现

### Nacos 的心跳机制

```java
// Nacos 客户端心跳任务
public class BeatTask implements Runnable {

    public void run() {
        // 1. 构建心跳信息
        BeatInfo beatInfo = new BeatInfo();
        beatInfo.setServiceName(serviceName);
        beatInfo.setIp(ip);
        beatInfo.setPort(port);
        beatInfo.setClusterName(clusterName);
        beatInfo.setWeight(weight);
        beatInfo.setScheduled(false);

        // 2. 发送心跳
        httpClient.post(
            "nacos/v1/ns/instance/beat",
            buildParams(beatInfo)
        );
    }
}
```

### 心跳配置参数

```yaml
spring:
  cloud:
    nacos:
      discovery:
        heart-beat-interval: 5000      # 心跳间隔（毫秒）
        heart-beat-timeout: 15000      # 心跳超时（毫秒）
        ip-delete-timeout: 30000       # 实例删除超时（毫秒）
```

### 健康判定逻辑

```java
// Nacos 服务端健康判定
public class HealthCheck {

    public void checkInstanceHealth() {
        long now = System.currentTimeMillis();

        for (Instance instance : instances) {
            long lastBeat = instance.getLastBeat();

            // 超过 15 秒没收到心跳，标记为不健康
            if (now - lastBeat > heartBeatTimeout) {
                instance.setHealthy(false);
                notifySubscribers(instance);
            }

            // 超过 30 秒没收到心跳，删除实例
            if (now - lastBeat > ipDeleteTimeout) {
                deleteInstance(instance);
            }
        }
    }
}
```

## 服务端探测实现

### Kubernetes 的健康检查

```yaml
# Kubernetes Pod 健康检查
apiVersion: v1
kind: Pod
metadata:
  name: nginx
spec:
  containers:
    - name: nginx
      image: nginx
      livenessProbe:      # 存活探针（判断是否重启容器）
        httpGet:
          path: /healthz
          port: 80
        initialDelaySeconds: 30
        periodSeconds: 10
      readinessProbe:     # 就绪探针（判断是否接收流量）
        httpGet:
          path: /ready
          port: 80
        initialDelaySeconds: 5
        periodSeconds: 5
```

### 三种探测方式

```java
// 1. HTTP 探测
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
// 返回 200-399 表示健康

// 2. TCP 探测
readinessProbe:
  tcpSocket:
    port: 8080
// 能建立连接表示健康

// 3. 命令探测
livenessProbe:
  exec:
    command:
      - cat
      - /tmp/healthy
// 退出码为 0 表示健康
```

## Eureka 的自我保护机制

### 问题背景

Eureka 采用客户端心跳模式。如果网络抖动，大量实例同时心跳失败，会被误判为宕机并剔除。

这会导致**服务雪崩**——健康的实例被错误剔除，请求集中在少数实例上，最终系统崩溃。

### 自我保护机制

Eureka Server 会统计每分钟收到的心跳数，如果**低于预期值**（默认 85%），进入自我保护模式：

```java
// Eureka 自我保护判定
public class SelfPreservation {

    public boolean shouldEnableSelfPreservation() {
        // 预期心跳数 = 注册实例数 * 2（每 30 秒一次）
        // 实际心跳数 / 预期心跳数 < 0.85
        // 进入自我保护模式
        double renewsPerMinThreshold = registry.getExpectedRenewsPerMin();
        double renewsLastMin = registry.getNumOfRenewsInLastMin();

        return (renewsLastMin < renewsPerMinThreshold * 0.85);
    }
}
```

### 自我保护的影响

```
自我保护开启时：
- 不会剔除任何实例
- 服务列表可能包含已宕机的实例

自我保护关闭时：
- 正常剔除心跳超时的实例
```

## 健康检查的最佳实践

### 检查粒度

```java
// 1. 进程存活检查（最基础）
// 检测进程是否存活，不检测业务
public boolean isProcessAlive() {
    return ManagementFactory.getRuntimeMXBean()
        .getUptime() > 0;
}

// 2. 端口可达检查
// 检测端口是否监听
public boolean isPortReachable(String host, int port) {
    try (Socket socket = new Socket()) {
        socket.connect(new InetSocketAddress(host, port), 1000);
        return true;
    } catch (IOException e) {
        return false;
    }
}

// 3. 业务接口检查（最可靠）
// 检测业务逻辑是否正常
public boolean isHealthy() {
    try {
        ResponseEntity<String> response = restTemplate.getForEntity(
            "http://localhost:8080/health",
            String.class
        );
        return response.getStatusCode().is2xxSuccessful();
    } catch (Exception e) {
        return false;
    }
}
```

### 故障剔除策略

```java
// 连续失败 N 次才剔除，避免网络抖动误判
public class FailureCountingStrategy {

    private Map<String, Integer> failureCount = new ConcurrentHashMap<>();
    private static final int THRESHOLD = 3;

    public boolean shouldRemove(String instanceId, boolean isHealthy) {
        if (isHealthy) {
            failureCount.remove(instanceId);
            return false;
        }

        int count = failureCount.merge(instanceId, 1, Integer::sum);

        if (count >= THRESHOLD) {
            failureCount.remove(instanceId);
            return true;  // 连续失败 N 次才剔除
        }
        return false;
    }
}
```

## Spring Boot Actuator 集成

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: always
```

```java
// 自定义健康检查
@Component
public class DatabaseHealthIndicator implements HealthIndicator {

    @Override
    public Health health() {
        try {
            jdbcTemplate.execute("SELECT 1");
            return Health.up()
                .withDetail("database", "MySQL")
                .build();
        } catch (Exception e) {
            return Health.down()
                .withDetail("error", e.getMessage())
                .build();
        }
    }
}
```

## 总结

健康检查是服务可靠性的保障：

- **客户端心跳**：Nacos、Eureka 实例主动上报
- **服务端探测**：Kubernetes Controller 主动探测
- **自我保护**：Eureka 防止雪崩的机制
- **故障剔除策略**：连续失败 N 次才剔除

好的健康检查机制，能让你的系统在故障发生时快速恢复。

**面试追问方向：**
- Nacos 的心跳机制是如何实现的？
- Eureka 的自我保护机制是什么？为什么需要它？
- 如何实现自定义的健康检查？
- 如果健康检查本身有问题，会导致什么后果？