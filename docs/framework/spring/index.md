# Spring Framework 总览

想象一下：你接手一个老项目，打开代码，映入眼帘的是这样的代码：

```java
public class OrderService {
    private UserService userService = new UserServiceImpl();
    private PaymentService paymentService = new PaymentServiceImpl();
    private NotificationService notificationService = new NotificationServiceImpl();

    public void createOrder() {
        // 业务逻辑
    }
}
```

看起来没问题？但仔细想想：如果 `UserServiceImpl` 的构造函数变了，你得改 `OrderService`；如果想换个 `UserService` 的实现（比如加缓存的版本），你得改 `OrderService`；如果 `UserService` 依赖了其他服务，你得在 `OrderService` 里手动创建整条依赖链……

这就是**强耦合**的代价。而 Spring Framework，就是来解决这个问题的。

## 从手动「造零件」到工厂「取零件」

在没有 Spring 的时代，对象的创建和依赖管理全靠程序员手动完成：

```java
// 强耦合：UserService 变了，OrderService 也要跟着变
UserService userService = new UserServiceImpl();
OrderService orderService = new OrderService(userService);
```

有了 Spring IoC 容器之后，你只需要告诉容器：「我需要一个 `OrderService`，它的 `userService` 依赖由你来解决」：

```java
@Service
public class OrderService {
    @Autowired
    private UserService userService; // 容器自动注入

    public void createOrder() {
        userService.checkUser();
        // 业务逻辑
    }
}
```

至于 `UserService` 的实现类是哪个、依赖从哪里来，统统不用你操心。这就是**控制反转（Inversion of Control）**的思想——把对象创建和依赖管理的权力，从程序员手中转移给容器。

## Spring 生态全景图

Spring 并不是一个单一的框架，而是一个庞大的生态系统：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Spring 生态全家桶                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │ Spring MVC    │    │ Spring WebFlux│    │  Spring Boot  │    │
│  │ (Web 层)      │    │ (响应式 Web)  │    │  (快速开发)   │    │
│  └───────────────┘    └───────────────┘    └───────────────┘    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                      Spring Framework                    │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │  │
│  │  │  IoC    │ │   AOP   │ │  MVC    │ │  事务   │  ...     │  │
│  │  │ 容器    │ │  面向切面│ │  Web    │ │  管理   │         │  │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐    │
│  │ Spring Data   │    │Spring Security│    │ Spring Cloud  │    │
│  │ (数据访问)    │    │  (安全认证)   │    │  (微服务)     │    │
│  └───────────────┘    └───────────────┘    └───────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 核心层：Spring Framework

这是整个 Spring 的根基，提供了最核心的功能：

| 模块 | 作用 |
|-----|-----|
| **Spring Core** | IoC 容器和依赖注入核心 |
| **Spring AOP** | 面向切面编程支持 |
| **Spring Beans** | Bean 的创建、管理和生命周期 |
| **Spring Context** | 应用程序上下文，扩展了 BeanFactory |
| **Spring Expression Language (SpEL)** | 强大的表达式语言 |

### Web 层

- **Spring MVC**：经典的 Servlet 栈 Web 框架，适合同步请求处理
- **Spring WebFlux**：反应式 Web 框架，支持异步非阻塞处理

### 快速开发层

- **Spring Boot**：让你用最少的配置跑起一个 Spring 应用
- **Spring Cloud**：基于 Spring Boot 的微服务解决方案

### 数据访问层

- **Spring Data**：统一的数据访问抽象，支持 JPA、MongoDB、Redis 等
- **Spring JDBC**：简化 JDBC 操作
- **Spring Transaction**：统一的事务管理

### 安全层

- **Spring Security**：全面的安全框架，支持认证、授权、OAuth2 等

## Spring Framework 的模块化设计

Spring Framework 被打造成一个模块化的架构，你可以按需引入：

```xml
<!-- 最小依赖：只需要 Core -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-core</artifactId>
</dependency>

<!-- Web 开发 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-web</artifactId>
</dependency>

<!-- 完整 Web MVC -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-webmvc</artifactId>
</dependency>

<!-- 事务管理 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-tx</artifactId>
</dependency>

<!-- 数据库访问 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-jdbc</artifactId>
</dependency>
```

这种按需引入的方式，避免了引入整个 Spring 的庞大体积——你可以只用一个精简的 IoC 容器，也可以搭建一个完整的企业级应用。

## 从 Spring 到 Spring Boot：进化的逻辑

为什么现在大家都在用 Spring Boot，而不是直接用 Spring Framework？

用一个比喻来解释：

> 想象你要开一家餐厅。
>
> **用 Spring Framework**：你得自己买炉子、买抽油烟机、布置水电、装修厨房……
> **用 Spring Boot**：已经有了一个配套齐全的厨房，你只需要专心做菜。

Spring Boot 并没有替代 Spring，它是在 Spring 基础上的**自动化配置层**，解决了 Spring Framework 的几个痛点：

1. **配置繁琐**：以前一个 Web 应用要配几十个 XML，现在一个 `application.yml` 就够了
2. **依赖混乱**：版本冲突、依赖遗漏让人头疼，Starter 依赖帮你一键搞定
3. **部署麻烦**：内置 Tomcat/Jetty，不用打包成 WAR 发布到应用服务器

## 知识体系导航

接下来的章节，我们将深入 Spring Framework 的核心：

### 第一部分：Spring 核心概念
理解 IoC 容器、Bean 生命周期、依赖注入——这是 Spring 的根基

### 第二部分：IoC 容器原理
从源码层面理解 Spring 如何创建和管理 Bean

### 第三部分：Spring AOP
掌握面向切面编程，解锁事务、日志等高级功能

### 第四部分：Spring MVC
搞懂 Web 请求的处理流程

### 第五部分：Spring 注解与配置
灵活运用 Spring 的各种配置方式

### 第六部分：Spring 高级特性
事件机制、资源加载、国际化等扩展功能

## 面试考点提示

Spring 是 Java 后端面试的重灾区，以下问题几乎必问：

- IoC 和 DI 的区别是什么？
- BeanFactory 和 ApplicationContext 有什么区别？
- Bean 的生命周期有哪些阶段？
- 循环依赖是怎么解决的？
- Spring AOP 的原理是什么？JDK 代理和 CGLIB 代理的区别？
- @Transactional 什么时候会失效？

这些问题，都会在后续章节中逐一解答。

---

**下节预告**：[Spring 架构总览与模块划分](/framework/spring/architecture) —— 深入了解 Spring Framework 的模块化设计，理解各模块之间的依赖关系。
