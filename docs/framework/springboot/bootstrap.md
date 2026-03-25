# Bootstrap.yml 与 Application.yml

你知道吗，Spring Cloud 和 Spring Boot 的配置文件，名字很像，但加载时机完全不同。

如果你在 Spring Cloud 项目中只配置了 `application.yml`，有些配置可能不会生效——因为 Spring Cloud 组件需要先加载 `bootstrap.yml`。

## Bootstrap 的含义

Bootstrap 在英文中是「引导程序」的意思。在 Spring Boot/Cloud 中：

- **Bootstrap 阶段**：应用程序刚刚启动，Spring 上下文还没初始化，这是「最初的引导」
- **Application 阶段**：Spring 上下文初始化完成，进入正常运行

## Bootstrap.yml 的作用

### 为 Spring Cloud 服务

`bootstrap.yml` 在 ApplicationContext 初始化之前加载，专门用于：

1. **配置 Spring Cloud 配置中心**
2. **配置服务注册与发现**
3. **加载远程配置**

典型配置：

```yaml
spring:
  application:
    name: user-service
  cloud:
    config:
      uri: http://config-server:8888
      profile: dev
      label: main
```

### 为什么需要单独的配置文件

```
加载顺序：
bootstrap.yml 先于 application.yml 加载
     ↓
Spring Cloud 组件需要读取配置
     ↓
如果配置在 application.yml 中，此时还没加载
     ↓
配置失效！
```

## Bootstrap.yml vs Application.yml

| 维度 | bootstrap.yml | application.yml |
|-----|-----|-----|
| **加载时机** | 应用启动最早阶段 | ApplicationContext 初始化后 |
| **用途** | Spring Cloud 配置、加密属性 | 业务配置 |
| **优先级** | 高（先加载） | 低（后加载） |
| **是否可覆盖** | 可以被 application.yml 覆盖 | 不能覆盖 bootstrap.yml |
| **适用场景** | 配置中心、服务注册 | 数据库、日志、业务开关 |

## Spring Boot 2.4+ 的变化

Spring Boot 2.4 之后，`bootstrap.yml` 的默认启用行为被改变了：

### 旧行为（Spring Boot 2.4 之前）

`bootstrap.yml` 默认启用，所有 Spring Cloud 项目都会加载。

### 新行为（Spring Boot 2.4+）

**默认不再启用**。如果需要使用 `bootstrap.yml`，需要显式开启：

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-bootstrap</artifactId>
</dependency>
```

或者在 `application.yml` 中配置：

```yaml
spring:
  cloud:
    bootstrap:
      enabled: true
```

## 现代配置方式：application.yml

在 Spring Boot 2.4+ 中，推荐把所有配置放在 `application.yml` 中：

### 单文件方式

```yaml
# application.yml
spring:
  application:
    name: user-service
  config:
    import: optional:file:./config/application-prod.yml  # Spring Boot 2.4+ 导入机制
```

### Spring Cloud 配置

```yaml
# application.yml - Spring Boot 2.4+ 写法
spring:
  application:
    name: user-service
  cloud:
    config:
      uri: http://config-server:8888
      profile: dev
      label: main
```

## 配置导入（Spring Boot 2.4+）

Spring Boot 2.4 引入了 `spring.config.import` 配置导入机制：

```yaml
# application.yml
spring:
  config:
    import: optional:file:./config/application-prod.yml
```

支持多种数据源：

```yaml
spring:
  config:
    import: |
      optional:file:./config/database.yml
      optional:file:./config/redis.yml
      optional:classpath:application-local.yml
```

### 与 bootstrap.yml 的对比

| 特性 | bootstrap.yml | spring.config.import |
|-----|-----|-----|
| 加载时机 | 更早 | 与 application.yml 同期 |
| 启用方式 | 自动（需引入 spring-cloud-starter-bootstrap） | 自动 |
| 覆盖机制 | 被 application.yml 覆盖 | 按 import 顺序覆盖 |
| 适用场景 | Spring Cloud 1.x/2.x | Spring Boot 2.4+ / Spring Cloud 2020+ |

## 实战：Spring Cloud 配置迁移

### 从 bootstrap.yml 迁移到 application.yml

**旧写法（Spring Cloud 2020 之前）**：

```yaml
# bootstrap.yml
spring:
  application:
    name: user-service
  cloud:
    config:
      uri: http://config-server:8888
```

**新写法（Spring Cloud 2020+）**：

```yaml
# application.yml
spring:
  application:
    name: user-service
  cloud:
    config:
      uri: http://config-server:8888
```

**注意**：不再需要 `bootstrap.yml`，所有配置放在 `application.yml` 中即可。

## 加载顺序完整图

```
Spring Boot 2.4 之前：
┌─────────────┐
│ bootstrap.yml │  ← 最先加载（Spring Cloud 配置）
└─────────────┘
       ↓
┌─────────────┐
│application.yml│
└─────────────┘
       ↓
┌─────────────┐
│application-{profile}.yml│  ← profile 覆盖
└─────────────┘

Spring Boot 2.4+：
┌─────────────────────────────────────┐
│           application.yml            │
│         + spring.config.import       │  ← 一起加载
└─────────────────────────────────────┘
       ↓
┌─────────────────────────────────────┐
│      application-{profile}.yml      │  ← profile 覆盖
└─────────────────────────────────────┘
```

## 常见问题

### Q：bootstrap.yml 和 application.yml 同时存在会怎样？

A：`application.yml` 的配置会覆盖 `bootstrap.yml` 的同名配置。但推荐不要同时存在，统一使用 `application.yml`。

### Q：Spring Cloud 项目必须用 bootstrap.yml 吗？

A：Spring Cloud 2020 之后，不再需要 `bootstrap.yml`。使用 Spring Boot 2.4+ 时，所有配置放在 `application.yml` 即可。

### Q：如何决定配置放在哪个文件？

**旧标准**：
- `bootstrap.yml`：Spring Cloud 相关配置
- `application.yml`：业务配置

**新标准**：
- 统一放在 `application.yml`
- 使用 `spring.config.import` 导入额外配置

## 多环境配置组合

### 使用 profile 组合

```yaml
# application.yml
spring:
  profiles:
    active: dev,common

# application-dev.yml
server:
  port: 8080

# application-common.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/common
```

### 使用 import 组合

```yaml
# application.yml
spring:
  config:
    import: |
      optional:classpath:application-common.yml
      optional:classpath:application-dev.yml
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| bootstrap.yml 和 application.yml 的区别？ | 加载时机 |
| Spring Boot 2.4+ 有什么变化？ | 新特性理解 |
| 为什么 Spring Cloud 需要 bootstrap.yml？ | Spring Cloud 原理 |
| 如何迁移到 Spring Boot 2.4+ 的配置方式？ | 迁移实践 |

---

> 如果你还在用 `bootstrap.yml`，建议尽快迁移到 Spring Boot 2.4+ 的 `spring.config.import` 方式。这不仅是最佳实践，也是 Spring 官方推荐的方向。
