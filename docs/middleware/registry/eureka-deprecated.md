# Eureka 1.x vs 2.x 与替代方案

2018 年，Netflix 宣布 Eureka 2.x 停止开发。

这条消息在技术圈炸开了锅：「Eureka 要死了！」「Spring Cloud 要凉了！」「赶紧迁移！」

**但几年过去了，Eureka 1.x 还在生产环境跑得好好的。**

发生了什么？Eureka 真的死了吗？有没有好的替代方案？

## Eureka 1.x vs 2.x

### 版本对比

| 特性 | Eureka 1.x | Eureka 2.x |
|-----|-----------|-----------|
| **状态** | 开源维护 | 停止维护 |
| **架构** | 客户端-服务端 | 服务端集群改进 |
| **Dashboard** | 基础功能 | UI 大改版 |
| **健康检查** | 基础心跳 | 支持健康检查 |
| **运维复杂度** | 低 | 高 |

### Eureka 2.x 的改进

Eureka 2.x 本来计划解决 Eureka 1.x 的几个问题：

**1. 服务实例数量限制**

```
Eureka 1.x：
- 单机支持 ~3000 个实例
- 超过后性能明显下降

Eureka 2.x：
- 优化了内存使用
- 支持更大规模的服务实例
```

**2. Dashboard 改进**

```
Eureka 1.x Dashboard：
- 简陋的表格展示
- 没有实时状态

Eureka 2.x Dashboard：
- 图形化展示
- 实时状态监控
- 告警功能
```

**3. 健康检查增强**

```yaml
# Eureka 1.x：基础心跳
eureka:
  instance:
    lease-renewal-interval-in-seconds: 30

# Eureka 2.x：支持自定义健康检查
eureka:
  instance:
    health-check:
      enabled: true
      interval: 10s
      path: /health
      scheme: HTTPS
```

### 为什么停止维护？

Netflix 的解释是：

```
「Eureka 2.x 的使用量不如预期，我们决定将资源投入到更重要的项目上。」
```

但更深层的原因是：

1. **社区已经有了更好的替代品**（Nacos、Consul）
2. **Eureka 2.x 的改动太大**，迁移成本高
3. **Netflix 战略调整**，聚焦核心业务

## Eureka 1.x 的现状

### 生产环境中的 Eureka

```
Eureka 1.x 使用情况（2024 年）：
- 大量遗留系统仍在使用
- 很多公司不敢迁移
- Spring Cloud 官方仍在支持
```

**为什么还在用？**

1. **够用**：大部分公司服务数量 < 3000
2. **稳定**：跑了很多年，没出过问题
3. **迁移成本**：迁移到 Nacos 需要改代码、测试、灰度
4. **团队熟悉**：技术团队已经熟悉 Eureka

### Eureka 1.x 的生命周期

```
2012 年：Eureka 开源
2015 年：Spring Cloud Eureka 集成
2018 年：Eureka 2.x 宣布停止维护
2020 年：Spring Cloud 2020.0 移除 Eureka
        （但不阻止使用 Eureka 1.x）
2024 年：Eureka 1.x 仍在大量使用
```

**Spring Cloud 移除 Eureka 的影响：**

```xml
<!-- 2020.0 之前的依赖 -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
</dependency>

<!-- 2020.0 之后需要单独引入 -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-eureka-client</artifactId>
    <version>1.4.x.RELEASE</version>
</dependency>
```

## 替代方案对比

### 方案一：Nacos（推荐）

```yaml
# 迁移到 Nacos
spring:
  cloud:
    nacos:
      discovery:
        server-addr: nacos-server:8848
        namespace: ${NACOS_NAMESPACE}
        group: ${NACOS_GROUP}
```

**优点：**
- 功能更全面（注册 + 配置）
- 性能更好
- 社区活跃
- 和 Spring Cloud 无缝集成

**缺点：**
- 需要迁移代码
- 需要部署 Nacos 集群
- 学习成本

### 方案二：Consul

```yaml
# 迁移到 Consul
spring:
  cloud:
    consul:
      host: consul-server
      port: 8500
      discovery:
        service-name: ${spring.application.name}
```

**优点：**
- 多语言支持
- 跨数据中心
- KV 存储
- 服务网格（Consul Connect）

**缺点：**
- 配置管理不如 Nacos 方便
- Spring Cloud 集成不如 Nacos 完善

### 方案三：ZooKeeper

```yaml
# 使用 ZooKeeper
spring:
  cloud:
    zookeeper:
      connect-string: zk-server:2181
      discovery:
        root: /services
```

**优点：**
- 成熟稳定
- 中间件友好（Kafka、HBase）

**缺点：**
- 没有服务发现功能，需要自己实现
- 没有配置管理，需要自己实现
- 学习成本高

## 迁移方案

### 迁移步骤

```
第一步：准备阶段
├── 评估现有服务数量
├── 确定迁移时间窗口
├── 选择目标注册中心（Nacos）
└── 编写迁移文档

第二步：双注册
├── Eureka 继续运行
├── 新增 Nacos 注册
└── 验证双注册正常

第三步：流量切换
├── 网关切换到 Nacos
├── 逐步切流量
└── 监控异常

第四步：Eureka 下线
├── 关闭 Eureka 注册
├── 监控无异常
└── 清理 Eureka 相关代码
```

### 双注册实现

```java
// Eureka 注册
@Configuration
public class EurekaConfig {
    @Bean
    @ConditionalOnProperty(name = "eureka.enabled", havingValue = "true")
    public EurekaClient eurekaClient() {
        return new EurekaClient();
    }
}

// Nacos 注册
@Configuration
public class NacosConfig {
    @Bean
    @ConditionalOnProperty(name = "nacos.enabled", havingValue = "true")
    public NamingService namingService() {
        return NacosFactory.createNamingService(properties);
    }
}
```

### 迁移配置

```yaml
# application.yml
eureka:
  enabled: true  # 切换时改为 false

spring:
  cloud:
    nacos:
      enabled: false  # 切换时改为 true
      discovery:
        server-addr: nacos-server:8848
```

## 决策树：要不要迁移？

```
服务实例数量
     │
     ├── < 1000
     │     │
     │     └── 继续用 Eureka 1.x
     │
     ├── 1000 - 5000
     │     │
     │     └── 评估迁移 Nacos 的收益
     │           │
     │           ├── 有配置中心需求？ → 迁移 Nacos
     │           └── 没有配置中心需求？ → 继续 Eureka 1.x
     │
     └── > 5000
           │
           └── 强烈建议迁移 Nacos
```

## 总结

**Eureka 1.x 的现状：**
- 2.x 停止维护，但 1.x 仍然可用
- Spring Cloud 移除官方支持，但不阻止使用
- 生产环境仍有大量使用

**要不要迁移？**

| 情况 | 建议 |
|-----|-----|
| 新项目 | 使用 Nacos |
| 现有系统实例 < 1000 | 继续 Eureka 1.x |
| 现有系统实例 > 3000 | 迁移 Nacos |
| 有配置中心需求 | 迁移 Nacos |
| 多语言技术栈 | 迁移 Consul |

**迁移建议：**
- 不要为了迁移而迁移
- 评估迁移成本和收益
- 做好回滚预案
- 逐步迁移，不要一刀切

---

**留给你的问题：**

假设你的系统有 200 个微服务实例，目前使用 Eureka 1.x。团队决定迁移到 Nacos。

如果让你来负责这个迁移项目，你会如何规划？

分几个阶段？每个阶段做什么？如何保证迁移过程中的服务稳定性？
