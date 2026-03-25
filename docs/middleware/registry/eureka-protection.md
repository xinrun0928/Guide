# Eureka 自我保护机制

凌晨 2 点，你被报警吵醒：「Eureka 注册中心告警：大量实例被剔除！」

你赶紧打开监控，发现不是服务真的挂了，而是 **Eureka 的自我保护机制被触发了**。

**什么是自我保护？为什么 Eureka 要保护「已经下线的服务」？**

## 网络分区问题

在[上一篇文章](/middleware/registry/eureka)中，我们提到 Eureka 是 AP 模型，优先保证可用性。

但这里有一个问题：**如果 Eureka Server 和服务实例之间发生了网络分区，实例的心跳会失败。**

```
正常情况：
服务实例 ──心跳──→ Eureka Server

网络分区时：
服务实例 ──心跳──→ ✗（网络不通）
              ↓
         Eureka Server 判定实例已下线
              ↓
         实例被剔除
              ↓
         服务调用失败
```

**问题：** 实际上服务实例还活着，只是网络不通。如果 Eureka Server 在这个窗口期剔除实例，会导致服务不可用。

## 什么是自我保护？

Eureka 的自我保护机制（Self-Preservation）是为了**防止误剔除「还活着但心跳超时」的服务实例**。

### 触发条件

```java
// 自我保护的触发条件
// 每 15 分钟检查一次
public class SelfPreservationMode {
    // 期望每分钟收到的心跳总数
    // = 服务实例数 ×（60 / 续约间隔）
    // = 服务实例数 × 2（默认续约间隔 30 秒）

    // 如果实际收到的心跳数 < 期望的 85%
    // 触发自我保护

    if (actualRenewals < expectedRenewals * renewalPercentThreshold) {
        // 触发自我保护：停止剔除实例
        enableSelfPreservation = true;
    }
}
```

### 计算公式

```java
// 期望心跳数计算
expectedHeartbeat = numOfRenewsLastMin *
    ((registrySize + 1) / registrySize)

renewalPercentThreshold = 0.85

// 如果实际心跳数 < 期望心跳数 × 0.85
// 触发自我保护
```

### 具体例子

```
场景：100 个服务实例

期望心跳数 = 100 × 2 = 200（每分钟）

如果实际心跳数 < 200 × 0.85 = 170
触发自我保护
```

## 自我保护的表现

### 触发前

```
服务实例 100 个
期望心跳数 200
实际心跳数 180（因为有 10 个实例网络抖动）
         ↓
180 < 170？ 不成立
         ↓
正常剔除超过 90 秒没心跳的实例
```

### 触发后

```
服务实例 100 个
期望心跳数 200
实际心跳数 80（因为有网络分区，60 个实例心跳失败）
         ↓
80 < 170？ 成立
         ↓
触发自我保护，停止剔除
         ↓
所有实例都被保留，即使心跳超时
```

### 日志表现

```bash
# Eureka Server 日志
EMERGENCY! EUREKA IS IN SELF PRESERVATION MODE

# 这表示自我保护已触发
# 旧实例不会被剔除
# 新实例仍然可以注册
```

## 代码实现

```java
// 自我保护的核心逻辑
public class EvictionTask implements Runnable {
    @Override
    public void run() {
        try {
            // 获取期望的最小续约数
            long expiresTimestamp = getExpectedRenewal();

            // 判断是否在自我保护期
            if (isSelfPreservationModeEnabled()) {
                // 在自我保护期，不剔除任何实例
                logger.warn("Self-Preservation is enabled. Not evicting expired instances.");
                return;
            }

            // 正常剔除过期实例
            evict(expiresTimestamp);
        } catch (Throwable t) {
            logger.error("Error evicting instances", t);
        }
    }
}
```

## 配置参数

```yaml
eureka:
  server:
    # 是否启用自我保护（默认 true）
    enable-self-preservation: true
    # 期望续约百分比阈值（默认 0.85）
    renewal-percent-threshold: 0.85
    # 续约心跳刷新间隔（默认 15 分钟）
    renewal-update-threshold: 900000
    # 清理过期实例的间隔（默认 60 秒）
    eviction-interval-timer-in-ms: 60000
```

### 生产环境建议

```yaml
# 高可用生产环境
eureka:
  server:
    enable-self-preservation: true
    renewal-percent-threshold: 0.85
    eviction-interval-timer-in-ms: 30000  # 更频繁地检查

# 开发和测试环境
eureka:
  server:
    enable-self-preservation: false  # 关闭自我保护
    eviction-interval-timer-in-ms: 5000   # 每 5 秒清理
```

## 自我保护的利弊

### 优点

1. **防止误剔除**：网络抖动时不会大量剔除实例
2. **提高可用性**：AP 模型优先保证服务可用
3. **用户体验好**：不会因为短暂网络问题导致服务不可用

### 缺点

1. **可能保留已下线实例**：真正的下线实例可能不会被及时剔除
2. **调用失败**：客户端可能尝试调用已下线的实例
3. **调试困难**：需要区分「真正的下线」和「自我保护」

## 实际场景分析

### 场景一：灰度发布

```
发布新版本时，旧版本实例会被逐步替换。

正常流程：
实例 A（v1） ──心跳──→ Eureka Server
实例 B（v2） ──心跳──→ Eureka Server
... 逐步切换 ...
实例 A 下线
实例 B 上线

如果有自我保护：
即使实例 A 心跳超时，也不会立即剔除
优点：发布过程更平滑
缺点：如果实例 A 真正下线，需要等待超时才能剔除
```

### 场景二：网络抖动

```
云服务器网络抖动，持续 30 秒。

没有自我保护：
服务实例被大量剔除 → 服务调用失败

有自我保护：
实例保留 → 服务调用正常 → 网络恢复 → 一切正常

结论：自我保护有效防止网络抖动导致的误剔除
```

### 场景三：服务真的下线

```
服务实例崩溃，心跳停止。

没有自我保护：
90 秒后实例被剔除

有自我保护：
实例可能长时间保留
直到自我保护模式退出

结论：需要配合健康检查和监控来及时发现真正下线的实例
```

## 最佳实践

### 服务端配置

```yaml
eureka:
  server:
    # 开启自我保护
    enable-self-preservation: true
    # 调整阈值
    renewal-percent-threshold: 0.85
    # 快速感知变化
    eviction-interval-timer-in-ms: 10000

  instance:
    # 缩短心跳间隔
    lease-renewal-interval-in-seconds: 10
    # 缩短过期时间
    lease-expiration-duration-in-seconds: 30
```

### 客户端配置

```yaml
eureka:
  instance:
    # 开启健康检查
    health-check-url-path: /actuator/health
    # 缩短注册间隔
    registry-fetch-interval-seconds: 10
```

### 监控告警

```java
// 监控自我保护状态
@Component
public class EurekaHealthIndicator implements HealthIndicator {
    @Override
    public Health health() {
        boolean selfPreservation = eurekaServer.getSelfPreservationMode();

        if (selfPreservation) {
            return Health.status("WARNING")
                .withDetail("message", "Eureka is in self-preservation mode")
                .build();
        }

        return Health.up().build();
    }
}
```

## 总结

自我保护机制是 Eureka 的核心特性之一：

```
正常情况下：心跳超时 → 实例剔除
         ↓
网络分区时：心跳减少 → 触发自我保护
         ↓
保护期间：停止剔除 → 保留实例
         ↓
网络恢复：心跳恢复 → 退出自我保护
```

**什么时候应该开启自我保护？**

- 生产环境（高可用优先）
- 网络不稳定的部署环境
- 不能接受服务误剔除的业务

**什么时候可以关闭自我保护？**

- 开发测试环境
- 网络非常稳定的私有云环境
- 愿意接受网络抖动导致服务短暂不可用的业务

---

**留给你的问题：**

假设你关闭了 Eureka 的自我保护功能。在一次发布过程中，你逐步下线旧版本实例，突然遇到了网络抖动。

会发生什么？服务调用会失败吗？

有自我保护和没有自我保护，在这种情况下会有什么不同？
