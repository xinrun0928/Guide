# Spring Cloud 版本命名与组件选型策略

> 「为什么 Spring Cloud 用的是伦敦地铁站名，而 Spring Cloud Alibaba 用的是河流名？」这个问题背后，是一套值得深入理解的设计哲学。

---

## 一个让无数人困惑的问题

初次接触 Spring Cloud 的同学，一定见过这样的版本号：`2022.0.0`、`2021.0.4`、`Hoxton.SR12`。

这不像普通的语义化版本（`1.0.0`、`2.3.1`），更像是某种神秘代码。

事实上，这是 Spring Cloud 特有的版本命名规则——**伦敦地铁站命名规则**。

---

## Spring Cloud 版本命名规则

### 命名格式

Spring Cloud 使用「地铁站名 + 字母后缀」的方式命名版本。

```
命名格式：<地铁站名>.<字母后缀>
```

| 字母后缀 | 含义 |
|---|---|
| `.0` | 第一个正式版 |
| `.SRX` | Service Release，X 是版本号 |
| `.M<X>` | Milestone，里程碑版本 |

**SR 的全称是 Service Release**，可以理解为「服务版本」——类似于 bug 修复补丁。

### 版本对照表

| 版本名 | 年份 | 地铁站 |
|---|---|---|
| 2023.0.x | 2023 | Leyton |
| 2022.0.x | 2022 | Kilowatt |
| 2021.0.x | 2021 | Jubilee |
| 2020.0.x | 2020 | Ilford |
| 2019.0.x | 2019 | Hoxton |
| ... | ... | ... |

> 记忆技巧：每年发布一个新版本，名字是伦敦地铁站名（按字母顺序）。

---

## 子模块版本管理

Spring Cloud 是一系列子项目的集合，每个子项目都有独立版本：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
    <!-- 版本由 spring-cloud-dependencies 统一管理 -->
</dependency>
```

**最佳实践：只声明父 BOM，不单独指定子模块版本。**

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>2022.0.4</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

这样可以避免版本冲突——所有子模块的版本都由 Spring Cloud 官方统一协调。

---

## Spring Cloud Alibaba 版本命名

与 Spring Cloud 不同，Spring Cloud Alibaba 使用更直观的命名规则：

```
命名格式：<年份>.<季度>

示例：
- 2023.0.1.0   → 2023年第1季度第1个版本
- 2022.0.2.0   → 2022年第2季度第2个版本
```

> 官方强烈建议使用 `2022.0.x.x` 或更高版本，因为这些版本基于 Spring Boot 3.x 和 Spring Cloud 2022.x。

---

## 版本选型策略

### 核心原则：看 Spring Boot 版本

Spring Cloud 版本与 Spring Boot 版本必须匹配：

```
Spring Boot 3.x  →  Spring Cloud 2022.x.x 及以上
Spring Boot 2.7.x → Spring Cloud 2022.0.x
Spring Boot 2.6.x → Spring Cloud 2021.0.x
Spring Boot 2.5.x → Spring Cloud 2020.0.x
```

### 组件选型矩阵

| 场景 | 推荐组件 | 替代方案 |
|---|---|---|
| 注册中心 | Nacos（推荐） | Consul、Eureka（已停更） |
| 配置中心 | Nacos Config | Apollo、Consul Config |
| 网关 | Spring Cloud Gateway | Spring Cloud Zuul |
| 声明式 HTTP 客户端 | OpenFeign | RestTemplate |
| 限流熔断 | Sentinel | Resilience4j |
| 链路追踪 | Sleuth + Zipkin | SkyWalking、Jaeger |
| 分布式事务 | Seata | TX-LCN |

---

## 版本依赖查询

Spring Cloud 官方提供了版本兼容查询网站：

**官方版本列表**：https://spring.io/projects/spring-cloud

**版本兼容性查询**：https://start.spring.io/assistant

在这个网站输入你的 Spring Boot 版本，它会自动给你一个兼容的 Spring Cloud 版本。

---

## 实战：如何确定你的依赖版本

### 场景一：新项目

如果你要启动一个新项目，直接用最新稳定版：

```xml
<!-- Spring Boot 最新稳定版 -->
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.x</version>
</parent>

<!-- Spring Cloud 对应版本 -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>2023.0.0</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>

<!-- Spring Cloud Alibaba（如果使用） -->
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>com.alibaba.cloud</groupId>
            <artifactId>spring-cloud-alibaba-dependencies</artifactId>
            <version>2023.0.1.2</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

### 场景二：老项目升级

老项目升级 Spring Cloud 版本，需要注意：

1. **先升级 Spring Boot**：确保 Spring Boot 版本兼容
2. **再升级 Spring Cloud**：跟着官方升级路径走
3. **最后升级组件**：如 Nacos、Sentinel 等

> 切记：不要跨版本升级。例如从 `Hoxton` 直接跳到 `2022.0`，中间可能有不兼容的 API 变更。

---

## 常见版本问题

### Q：为什么 Eureka 不更新了，还能用吗？

A：Eureka 1.x 仍然可以使用，它是 AP 模型的注册中心，核心功能稳定。但新项目不建议使用，推荐 Nacos。

### Q：Spring Cloud Netflix 还能用吗？

A：Netflix 官方已宣布 Hystrix、Ribbon、Zuul 等进入维护模式。但 Netflix 生态的组件仍然开源可用，只是不会再有大的功能更新。

### Q：Spring Cloud Alibaba 和 Spring Cloud Netflix 可以混用吗？

A：可以。例如用 Nacos 做注册中心，用 Gateway 做网关，用 Sentinel 做限流。这是目前国内的主流组合。

---

## 面试追问方向

- Spring Cloud 的版本命名规则是什么？
- 如何确定 Spring Cloud 和 Spring Boot 的版本兼容关系？
- 为什么 Netflix 组件进入维护模式后，阿里要自己做一套？
- 注册中心选择 AP 模型还是 CP 模型？Nacos 和 Eureka/Zookeeper 的区别是什么？
