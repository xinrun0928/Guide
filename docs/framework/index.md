# 常用框架

## 为什么需要框架？

没有框架的时代，一个简单的 Web 项目你需要手动管理：

- HTTP 请求怎么解析？
- 数据库连接怎么创建和释放？
- 事务怎么控制？
- 线程怎么管理？

每个项目都在重复发明轮子，代码质量参差不齐，维护成本极高。

框架的出现，就是把**通用的、复杂的、危险的基础设施封装起来**，让开发者专注于业务逻辑。

---

## Java 框架生态全景图

Java 是企业级开发的老大哥，而 Spring 是 Java 生态的绝对核心。整个框架生态可以划分为几个层次：

### 第一层：核心框架

| 框架 | 定位 | 解决的问题 |
|-----|------|---------|
| Spring Framework | 核心容器 | IoC、AOP、事务、Bean 管理 |
| Spring Boot | 快速启动 | 自动配置、起步依赖、内嵌服务器 |
| Spring MVC | Web 层 | 请求处理、参数绑定、视图解析 |

### 第二层：数据访问层

| 框架 | 定位 | 解决的问题 |
|-----|------|---------|
| JDBC | 底层抽象 | 数据库连接、SQL 执行 |
| MyBatis | 半自动 ORM | SQL 管理、映射配置 |
| MyBatis Plus | MyBatis 增强 | CRUD 封装、分页插件 |
| Hibernate / JPA | 全自动 ORM | 对象关系映射 |

### 第三层：企业级扩展

| 框架 | 定位 | 解决的问题 |
|-----|------|---------|
| Spring Security | 安全框架 | 认证、授权、OAuth2 |
| Shiro | 轻量安全 | 认证、授权、会话管理 |
| Spring Session | 会话管理 | 分布式会话、Session 共享 |

### 第四层：微服务与分布式

| 框架 | 定位 | 解决的问题 |
|-----|------|---------|
| Spring Cloud | 微服务生态 | 服务注册、配置中心、网关 |
| Spring Cloud Alibaba | 国产微服务 | Nacos、Sentinel、Seata |
| Dubbo | RPC 框架 | 服务调用、负载均衡 |

---

## 框架演进时间线

```
2002  →  Spring 前身（Interface21）
2004  →  Spring 1.0 发布，XML 配置时代
2006  →  Spring 2.0，自定义命名空间
2009  →  Spring 3.0，注解配置兴起
2013  →  Spring 4.0，全面支持 Java 8
2014  →  Spring Boot 1.0，颠覆性起步体验
2017  →  Spring 5.0，响应式编程
2019  →  Spring Boot 2.0，Spring Cloud Greenwich
2022  →  Spring Boot 3.0，Java 17+ 时代
```

每个版本的演进，背后都是对开发体验和性能的极致追求。

---

## Spring Framework：框架中的框架

Spring Framework 是整个 Java 框架生态的基石。它的核心是 **IoC 容器**和 **AOP**：

- **IoC（控制反转）**：把对象的创建和依赖管理交给容器，不再需要 `new` 来 `new` 去
- **AOP（面向切面编程）**：把日志、事务、安全等横切关注点抽离出来，统一管理

Spring Boot 在 Spring Framework 基础上，**消灭了所有 XML 配置**，实现了「零配置启动」。你只需要一个 `main` 方法，几行配置，一个 JAR 包，就能跑起来。

Spring Cloud 则把 Spring Boot 带入了微服务时代——服务注册与发现、配置中心、网关、熔断降级、链路追踪，所有微服务需要的组件，Spring Cloud 全家桶都能提供。

---

## 学习路线建议

```
第一步：Spring Framework 核心（IoC、AOP、Bean）
        ↓
第二步：Spring MVC（请求处理、参数绑定、视图解析）
        ↓
第三步：Spring Boot（自动配置、起步依赖）
        ↓
第四步：数据访问（MyBatis / JPA）
        ↓
第五步：Spring Security（认证、授权）
        ↓
第六步：Spring Cloud（微服务全家桶）
```

每一层都有它的核心概念和源码原理。面试不会只问你「会不会用」，更会问「为什么这样设计」。

---

## 面试高频考点

框架部分是 Java 面试的重头戏，以下是高频考点：

| 分类 | 高频问题 |
|-----|---------|
| Spring IoC | Bean 生命周期？循环依赖怎么解决？三级缓存是什么？ |
| Spring AOP | JDK 代理和 CGLIB 区别？Spring 如何选择？事务失效场景？ |
| Spring Boot | 自动配置原理？@SpringBootApplication 做了什么？ |
| MyBatis | 一级缓存和二级缓存？#{} 和 ${} 区别？Executor 有几种？ |
| Spring Security | 过滤器链顺序？认证流程？JWT 如何集成？ |
| Spring Cloud | 注册中心选型？Feign 原理？网关如何限流？ |

---

## 延伸阅读

- [Spring 核心概念：IoC 与依赖注入](/framework/spring/ioc)
- [Spring Boot 自动配置原理](/framework/springboot/autoconfig)
- [MyBatis 整体架构](/framework/mybatis/architecture)
- [Spring Security 认证与授权核心流程](/framework/springsecurity/core-flow)
- [Shiro 架构：三大核心组件](/framework/shiro/architecture)
