# Spring Cloud 多环境配置，Bootstrap + Nacos Namespace

> 开发环境、测试环境、生产环境——同一套代码，如何在不同环境使用不同配置？
>
> 多环境配置，就是来解决这个问题的。

---

## 从一个问题开始

假设你有这样的场景：

```
┌─────────────────────────────────────────────────────────┐
│                    多环境配置问题                         │
│                                                          │
│  开发环境                                                │
│  ├─ 数据库: localhost:3306                             │
│  ├─ Redis: localhost:6379                              │
│  └─ Nacos: 127.0.0.1:8848                             │
│                                                          │
│  测试环境                                                │
│  ├─ 数据库: test-mysql:3306                           │
│  ├─ Redis: test-redis:6379                            │
│  └─ Nacos: 192.168.1.100:8848                         │
│                                                          │
│  生产环境                                                │
│  ├─ 数据库: prod-mysql:3306                           │
│  ├─ Redis: prod-redis:6379                             │
│  └─ Nacos: 10.0.0.1:8848                              │
│                                                          │
│  问题：如何让同一套代码，在不同环境读取不同配置？         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**传统方式**：每个环境一套配置文件（application-dev.yml、application-test.yml、application-prod.yml）

**微服务方式**：Nacos Namespace + Bootstrap，统一管理多环境配置

---

## Nacos Namespace 隔离

### Namespace、Group、Data ID 三层结构

```
┌─────────────────────────────────────────────────────────┐
│                    Nacos 配置分层                         │
│                                                          │
│  Namespace（环境隔离）                                   │
│  ├─ dev（开发环境）                                     │
│  │   └─ Group: ORDER_GROUP                            │
│  │       └─ Data ID: order-service.yaml               │
│  │   └─ Group: USER_GROUP                             │
│  │       └─ Data ID: user-service.yaml                │
│  │                                                     │
│  ├─ test（测试环境）                                    │
│  │   └─ ...                                           │
│  │                                                     │
│  └─ prod（生产环境）                                    │
│      └─ ...                                           │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 创建 Namespace

在 Nacos 控制台 → 命名空间 → 新建命名空间：

```
命名空间 ID: dev  (或自动生成)
命名空间名: 开发环境
描述: 开发测试环境
```

---

## Bootstrap 配置

### 什么是 Bootstrap

Bootstrap 配置文件在应用启动时**最先加载**，用于配置应用的基础属性和服务发现/配置中心连接信息。

### bootstrap.yml

```yaml
spring:
  application:
    name: order-service  # 应用名，必填
  profiles:
    active: ${SPRING_PROFILES_ACTIVE:dev}  # 环境
  
  cloud:
    nacos:
      # 注册中心
      discovery:
        server-addr: ${NACOS_HOST:127.0.0.1}:${NACOS_PORT:8848}
        namespace: ${NACOS_NAMESPACE:dev}
        group: DEFAULT_GROUP
      
      # 配置中心
      config:
        server-addr: ${NACOS_HOST:127.0.0.1}:${NACOS_PORT:8848}
        namespace: ${NACOS_NAMESPACE:dev}
        group: DEFAULT_GROUP
        file-extension: yaml
        refresh-enabled: true

# 服务端口
server:
  port: ${SERVER_PORT:8080}

# 启用配置
spring.cloud.config.enabled: true
```

### 加载顺序

```
1. bootstrap.yml（最先加载）
   ↓
2. Nacos 配置中心读取配置
   ↓
3. application.yml（本地配置，会被 Nacos 配置覆盖）
```

---

## 多环境配置实战

### 1. Nacos 控制台配置

#### dev 环境配置

```
命名空间: dev
Data ID: order-service.yaml
Group: ORDER_GROUP
```

```yaml
# 数据库配置
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/order_db
    username: root
    password: root123

# Redis 配置
spring.redis:
  host: localhost
  port: 6379

# 日志级别
logging:
  level:
    com.example: DEBUG
```

#### test 环境配置

```
命名空间: test
Data ID: order-service.yaml
Group: ORDER_GROUP
```

```yaml
spring:
  datasource:
    url: jdbc:mysql://test-mysql:3306/order_db
    username: test
    password: test123

spring.redis:
  host: test-redis
  port: 6379

logging:
  level:
    com.example: INFO
```

#### prod 环境配置

```
命名空间: prod
Data ID: order-service.yaml
Group: ORDER_GROUP
```

```yaml
spring:
  datasource:
    url: jdbc:mysql://prod-mysql:3306/order_db
    username: prod
    password: ${DB_PASSWORD}  # 通过环境变量

spring.redis:
  host: prod-redis
  port: 6379
  password: ${REDIS_PASSWORD}

logging:
  level:
    com.example: WARN
```

### 2. 应用启动配置

#### 方式一：环境变量指定

```bash
# 启动 dev 环境
SPRING_PROFILES_ACTIVE=dev \
NACOS_HOST=127.0.0.1 \
NACOS_NAMESPACE=dev \
java -jar order-service.jar

# 启动 test 环境
SPRING_PROFILES_ACTIVE=test \
NACOS_HOST=192.168.1.100 \
NACOS_NAMESPACE=test \
java -jar order-service.jar

# 启动 prod 环境
SPRING_PROFILES_ACTIVE=prod \
NACOS_HOST=10.0.0.1 \
NACOS_NAMESPACE=prod \
DB_PASSWORD=xxx \
REDIS_PASSWORD=xxx \
java -jar order-service.jar
```

#### 方式二：Bootstrap profile

```yaml
# bootstrap-dev.yml
spring:
  cloud:
    nacos:
      discovery:
        namespace: dev
      config:
        namespace: dev

# bootstrap-test.yml
spring:
  cloud:
    nacos:
      discovery:
        namespace: test
      config:
        namespace: test

# bootstrap-prod.yml
spring:
  cloud:
    nacos:
      discovery:
        namespace: prod
      config:
        namespace: prod
```

启动时指定：

```bash
java -jar order-service.jar --spring.profiles.active=prod
```

#### 方式三：Docker 环境变量

```yaml
# docker-compose.yml
services:
  order-service:
    image: order-service:latest
    environment:
      - SPRING_PROFILES_ACTIVE=prod
      - NACOS_HOST=nacos-server
      - NACOS_NAMESPACE=prod
      - DB_PASSWORD=${DB_PASSWORD}
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    ports:
      - "8080:8080"
```

### 3. 配置优先级

```
命令行参数 > 环境变量 > bootstrap.yml > Nacos 配置
```

---

## 共享配置

### shared-configs

多个服务共享的配置：

```yaml
spring:
  cloud:
    nacos:
      config:
        # 共享配置列表
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true
          - data-id: datasource.yaml
            group: COMMON_GROUP
            refresh: false
          - data-id: redis.yaml
            group: COMMON_GROUP
            refresh: false
```

### extension-configs

扩展配置，优先级高于 shared-configs：

```yaml
spring:
  cloud:
    nacos:
      config:
        extension-configs:
          - data-id: ${spring.application.name}-custom.yaml
            group: CUSTOM_GROUP
            refresh: true
```

### 完整示例

```yaml
spring:
  cloud:
    nacos:
      config:
        server-addr: ${NACOS_HOST}:8848
        namespace: ${NACOS_NAMESPACE}
        group: DEFAULT_GROUP
        file-extension: yaml
        
        # 加载顺序：shared-configs → extension-configs → 主配置
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true
          - data-id: redis.yaml
            group: COMMON_GROUP
            refresh: false
        
        extension-configs:
          - data-id: ${spring.application.name}-db.yaml
            group: ${spring.cloud.nacos.config.group}
            refresh: true
```

---

## 多环境下的配置刷新

### Bus 自动刷新

所有环境的服务都需要引入 Spring Cloud Bus：

```yaml
spring:
  cloud:
    bus:
      enabled: true
```

### 刷新指定环境

```bash
# 刷新 dev 环境所有服务
curl -X POST "http://localhost:8080/actuator/busrefresh?destination=order-service:**"

# 刷新 prod 环境所有服务
curl -X POST "http://prod-gateway:8080/actuator/busrefresh?destination=order-service:**"
```

### Nacos Webhook 自动刷新

配置 Git Webhook，当配置变更时自动刷新：

```yaml
spring:
  cloud:
    nacos:
      config:
        # 开启配置变更监听
        watch:
          enabled: true
```

---

## 配置加密

### Nacos 配置加密

敏感配置使用加密存储：

```yaml
spring:
  datasource:
    password: ENC(加密后的密文)

# 使用 AES 加密
# plaintext = "root123"
# ciphertext = aesEncrypt(plaintext, key)
```

### 配置加解密类

```java
@Configuration
public class EncryptConfig {
    
    @Value("${encrypt.key}")
    private String encryptKey;
    
    @Bean
    public PropertySourceLocator propertySourceLocator() {
        return new NacosPropertySourceLocator();
    }
}
```

---

## 环境隔离最佳实践

### 1. 分层配置

```
┌─────────────────────────────────────────────────────────┐
│                    配置分层结构                           │
│                                                          │
│  命名空间（Namespace）= 环境                            │
│  ├─ dev                                               │
│  ├─ test                                              │
│  └─ prod                                              │
│                                                          │
│  分组（Group）= 服务分组                                │
│  ├─ DEFAULT_GROUP                                      │
│  ├─ ORDER_GROUP                                        │
│  └─ USER_GROUP                                        │
│                                                          │
│  Data ID = 服务配置                                     │
│  ├─ order-service.yaml                                │
│  ├─ user-service.yaml                                 │
│  └─ common.yaml（共享配置）                           │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 2. 环境变量命名规范

```bash
# 命名规范：环境_组件_属性
SPRING_PROFILES_ACTIVE=dev           # 环境
NACOS_HOST=127.0.0.1                 # Nacos
NACOS_PORT=8848
NACOS_NAMESPACE=dev
DB_HOST=localhost                     # 数据库
DB_PORT=3306
DB_NAME=order_db
DB_USERNAME=root
DB_PASSWORD=root123
REDIS_HOST=localhost                  # Redis
REDIS_PORT=6379
REDIS_PASSWORD=
```

### 3. 配置模板

提供环境变量配置模板，减少硬编码：

```yaml
# bootstrap.yml
spring:
  datasource:
    url: jdbc:mysql://${DB_HOST:localhost}:${DB_PORT:3306}/${DB_NAME:order_db}?useUnicode=true&characterEncoding=utf8
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:root}
    driver-class-name: com.mysql.cj.jdbc.Driver
```

---

## 常见问题

### Q：Bootstrap 和 application 的区别是什么？

A：**Bootstrap** 在应用启动最开始加载，用于配置应用基础属性和远程配置中心连接。**application** 是应用的主配置文件，加载时机晚于 Bootstrap。

### Q：如何保证不同环境的配置安全？

A：使用 Nacos 的命名空间隔离，dev/test 环境的账号不分配给开发人员。生产环境配置加密存储，密码通过环境变量注入。

### Q：如何在不同环境切换？

A：通过 `spring.profiles.active` 或 `NACOS_NAMESPACE` 环境变量切换。推荐使用环境变量，更灵活。

### Q：共享配置如何管理？

A：创建公共命名空间 COMMON，所有环境共享。共享配置变更需要谨慎，建议开启 refresh-enabled 并使用 @RefreshScope。

---

## 面试高频问题

### Q：Spring Cloud 如何实现多环境配置？

A：通过 **Namespace** 隔离不同环境（dev/test/prod），在 Bootstrap 配置中指定 `spring.cloud.nacos.config.namespace`。启动时通过环境变量 `NACOS_NAMESPACE` 指定环境。

### Q：Bootstrap 的作用是什么？

A：Bootstrap 是 Spring Cloud 配置的入口文件，**最先加载**，用于配置应用名称、服务发现和配置中心连接。只有连接上配置中心后，才能加载远程配置。

### Q：如何实现配置的热更新？

A：配合 **@RefreshScope** 注解和 **Spring Cloud Bus**。配置变更时，通过 Bus 广播刷新事件，所有服务实例自动重新加载配置。

### Q：多环境配置如何保证安全性？

A：生产环境配置加密存储，通过环境变量或密钥管理服务（如 Vault）注入敏感信息。不同环境使用不同的 Nacos 命名空间和访问权限。

---

## 总结

多环境配置的核心要点：

1. **Namespace 隔离环境**：dev/test/prod 使用不同命名空间
2. **Bootstrap 优先加载**：配置中心连接信息
3. **环境变量切换**：spring.profiles.active + NACOS_NAMESPACE
4. **共享配置**：common.yaml 被所有环境共享
5. **配置加密**：敏感信息加密存储

> 多环境配置让微服务在不同环境间切换变得简单。配置即代码，代码即配置。
