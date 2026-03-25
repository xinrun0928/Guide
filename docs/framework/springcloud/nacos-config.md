# Nacos 配置中心，命名空间、Group、Data ID 三层隔离

> 你有没有过这种经历：凌晨 2 点改了一个配置，要登录 10 台服务器手动更新，第二天早上还要回滚——配置管理混乱，是微服务的第一杀手。
>
> Nacos 配置中心，就是让你在一台电脑上，改一处配置，自动同步到所有服务。

---

## 配置管理的痛点

在微服务架构中，配置管理面临三大挑战：

### 1. 配置分散

```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  订单服务    │  │  用户服务    │  │  支付服务    │
│  application│  │  application│  │  application│
│    .yml      │  │    .yml      │  │    .yml      │
│             │  │             │  │             │
│  数据库配置  │  │  数据库配置  │  │  数据库配置  │
│  Redis 配置  │  │  Redis 配置  │  │  第三方 key │
└─────────────┘  └─────────────┘  └─────────────┘
```

每个服务都有自己的配置文件，改一个数据库密码要登录所有服务修改。

### 2. 环境差异

- 开发环境：本地数据库
- 测试环境：测试数据库
- 生产环境：生产数据库

**同一套代码，如何切换不同配置？**

### 3. 配置变更困难

改了配置要重启服务？还是手动刷新？在大规模微服务下，这些都是噩梦。

---

## Nacos 配置中心架构

```
┌──────────────────────────────────────────────────────────────┐
│                        Nacos Server                           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                    配置存储层                            │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │  │
│  │  │ Namespace│  │  Group   │  │  Data ID │           │  │
│  │  │  命名空间 │  │   分组   │  │  配置ID  │           │  │
│  │  └──────────┘  └──────────┘  └──────────┘           │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
           │ 推送                   │ 拉取
           ▼                        ▼
┌────────────────────┐      ┌────────────────────┐
│     服务实例 1      │      │     服务实例 2      │
│   order-service    │      │   order-service    │
└────────────────────┘      └────────────────────┘
```

**三层隔离机制**：命名空间（环境）→ 分组（项目/业务线）→ Data ID（具体配置）

---

## Data ID 命名规则

Data ID 是 Nacos 配置的核心，它的命名遵循公式：

```
${prefix}-${spring.profiles.active}.${file-extension}
```

| 组成部分 | 说明 | 示例 |
|---|---|---|
| prefix | 默认是 spring.application.name | order-service |
| spring.profiles.active | 当前激活的环境 | prod / dev / test |
| file-extension | 配置文件格式 | yaml / yml / properties |

### 完整示例

| spring.application.name | spring.profiles.active | Data ID |
|---|---|---|
| order-service | prod | order-service-prod.yaml |
| order-service | dev | order-service-dev.yaml |
| order-service | test | order-service-test.yaml |
| order-service | （空） | order-service.yaml |

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Nacos 配置中心 -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    </dependency>
    
    <!-- Nacos 服务发现（通常一起使用） -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-discovery</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

**bootstrap.yml**（注意是 bootstrap，不是 application）：

```yaml
spring:
  application:
    name: order-service
  profiles:
    active: prod
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yaml
        namespace: dev  # 命名空间 ID
        group: ORDER_GROUP  # 分组名
        # 共享配置，多个服务共用的配置
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true
```

### 3. 读取配置

```java
@RestController
@RefreshScope  // 开启配置热刷新
public class OrderController {
    
    @Value("${order.timeout:5000}")  // 默认值 5000
    private int orderTimeout;
    
    @Value("${order.max-count:100}")
    private int maxCount;
    
    @GetMapping("/config")
    public String getConfig() {
        return "timeout=" + orderTimeout + ", maxCount=" + maxCount;
    }
}
```

### 4. Nacos 控制台创建配置

登录 `http://localhost:8848/nacos`，进入配置管理 → 配置列表 → 点击「+」创建：

```
Data ID: order-service-prod.yaml
Group: ORDER_GROUP
配置格式: YAML
配置内容:
```yaml
order:
  timeout: 10000
  max-count: 500
  retry-times: 3
database:
  url: jdbc:mysql://prod-mysql:3306/order_db
  password: ${DB_PASSWORD}  # 支持占位符
```

---

## 三层隔离详解

### 第一层：命名空间（Namespace）

**用于环境隔离**。最外层的隔离机制。

```yaml
spring:
  cloud:
    nacos:
      config:
        namespace: dev  # namespace id，不是名字
```

**典型用法**：

| Namespace ID | 用途 |
|---|---|
| public | 默认命名空间 |
| dev | 开发环境 |
| test | 测试环境 |
| prod | 生产环境 |

> **记忆技巧**：Namespace = 环境

### 第二层：分组（Group）

**用于项目/业务线隔离**。同一命名空间下，按项目分组。

```yaml
spring:
  cloud:
    nacos:
      config:
        group: ORDER_GROUP
```

**典型用法**：

| Group | 用途 |
|---|---|
| DEFAULT_GROUP | 默认分组 |
| ORDER_GROUP | 订单业务线 |
| USER_GROUP | 用户业务线 |
| PAYMENT_GROUP | 支付业务线 |

> **记忆技巧**：Group = 业务线

### 第三层：Data ID

**用于具体配置文件**。最终生效的配置文件。

```
order-service-prod.yaml
```

> **记忆技巧**：Data ID = 配置文件名

### 三层组合示例

```
Namespace: prod（生产环境）
  └─ Group: ORDER_GROUP（订单业务线）
       └─ Data ID: order-service-prod.yaml（订单服务配置）
```

---

## 共享配置（Shared Configs）

多个服务共用的配置，不需要在每个服务里重复定义：

### 1. 创建共享配置

在 Nacos 控制台创建 `common.yaml`：

```yaml
# 共享配置
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      maximum-pool-size: 20
      minimum-idle: 5

redis:
  host: ${REDIS_HOST:127.0.0.1}
  port: ${REDIS_PORT:6379}
  password: ${REDIS_PASSWORD:}
```

### 2. 引用共享配置

```yaml
spring:
  cloud:
    nacos:
      config:
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true  # 是否支持动态刷新
```

### 3. 加载优先级

当存在多个配置源时，按以下顺序加载（后者覆盖前者）：

```
1. 本地 application.yml
2. 共享配置（shared-configs）
3. Extension 配置（extension-configs）
4. 主 Data ID 配置（${name}-${profiles}.${ext}）
```

---

## 配置的优先级

当同一个配置项出现在多个地方时，按以下顺序生效：

| 优先级 | 配置源 | 说明 |
|---|---|---|
| 1（最高） | @RefreshScope + @Value | 代码中的 @Value 注解 |
| 2 | 主 Data ID | order-service-prod.yaml |
| 3 | Extension 配置 | extension-configs 中的配置 |
| 4 | 共享配置 | shared-configs 中的配置 |
| 5（最低） | 本地 application.yml | 本地配置文件 |

---

## 配置热刷新

### @RefreshScope 原理

```java
@RefreshScope
@RestController
public class OrderController {
    
    @Value("${order.timeout}")
    private int timeout;
    
    // timeout 变化后，这个值会自动更新
}
```

**原理**：

```
配置变更 → Nacos 推送通知 → Spring 重新创建 Bean → @Value 重新注入
```

**核心机制**：@RefreshScope 会创建一个代理对象，配置变化时销毁旧 Bean，创建新 Bean。

### 手动刷新

除了自动刷新，还可以手动触发：

```bash
# POST 请求到任意服务实例
curl -X POST http://localhost:8080/actuator/refresh
```

```java
// 监听配置变化
@NacosConfigListener
public void onConfigChanged(String config) {
    System.out.println("配置变化：" + config);
}
```

---

## 支持占位符和环境变量

### 占位符

```yaml
# Nacos 配置
order:
  db-url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/order_db
  redis-host: ${REDIS_HOST:127.0.0.1}
```

### 环境变量

```yaml
spring:
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_SERVER:127.0.0.1:8848}
```

---

## 常见问题

### Q：为什么用 bootstrap.yml 而不是 application.yml？

A：Spring Cloud 的配置加载顺序是：bootstrap.yml 先于 application.yml 加载。Nacos Config 的初始化需要先读取 Nacos 服务器地址等信息，这些配置必须在 application.yml 之前就准备好。

### Q：配置变更后，服务多久能感知？

A：Nacos 默认每 3 秒拉取一次配置。如果配置变化，服务会在**3 秒内**感知到。

### Q：如何查看服务加载了哪些配置？

A：

```bash
curl http://localhost:8080/actuator/env | grep nacos
```

### Q：共享配置和主配置冲突怎么办？

A：按优先级覆盖。主 Data ID 优先级最高，会覆盖共享配置中相同的配置项。

---

## 面试高频问题

### Q：Nacos 配置中心的核心概念是什么？

A：三层隔离机制——**命名空间（Namespace）**隔离环境、**分组（Group）**隔离项目、**Data ID** 标识具体配置。

### Q：@RefreshScope 的原理是什么？

A：它会创建一个 scoped bean，每次刷新时会销毁旧 Bean 并创建新 Bean，通过 @Value 注入的配置会重新解析。

### Q：如何实现配置的多环境切换？

A：通过 spring.profiles.active 指定环境，自动加载对应的 Data ID（order-service-dev.yaml、order-service-prod.yaml）。

### Q：Nacos 配置中心相比 Spring Cloud Config 有什么优势？

A：Nacos 同时是注册中心和配置中心，开箱即用，不需要额外部署 Git；提供控制台可视化编辑；支持配置变更实时推送。

---

## 总结

Nacos 配置中心解决了微服务配置管理的三大难题：

1. **集中管理**：一处配置，多处生效
2. **环境隔离**：Namespace + Group + Data ID 三层隔离
3. **热更新**：无需重启服务，配置自动刷新

> 配置管理是微服务治理的核心能力。学会 Nacos 配置中心，你就掌握了微服务配置的正确打开方式。
