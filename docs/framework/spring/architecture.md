# Spring 架构总览与模块划分

你有没有想过这个问题：为什么 Spring Framework 能做到「既功能强大，又轻量可拆分」？

答案是：**模块化设计**。

Spring 并不是一个大一统的框架，而是一组模块的集合。每一个模块都有明确的职责，你可以像搭积木一样，选择需要的部分组合使用。

## Spring 模块全景图

Spring Framework 的模块结构大致如下：

```
┌────────────────────────────────────────────────────────────────────┐
│                        Spring Framework                            │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                     Spring Core Container                     │ │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌───────────┐ │ │
│  │  │ spring-    │ │  spring-   │ │  spring-   │ │  spring-  │ │ │
│  │  │   core     │ │   beans    │ │   context  │ │  expr     │ │ │
│  │  └────────────┘ └────────────┘ └────────────┘ └───────────┘ │ │
│  │      ▲             ▲             ▲             ▲          │ │
│  │      │             │             │             │          │ │
│  │      └─────────────┴─────────────┴─────────────┘          │ │
│  │                    核心依赖关系                             │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                          AOP                                 │ │
│  │  ┌────────────┐ ┌────────────┐ ┌─────────────────────────┐  │ │
│  │  │ spring-aop │ │ spring-    │ │   AspectJ Weaver         │  │ │
│  │  │            │ │ aspectj    │ │   (高级 AOP 支持)        │  │ │
│  │  └────────────┘ └────────────┘ └─────────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                      数据访问与集成                           │ │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌─────────────┐  │ │
│  │  │spring- │ │spring- │ │spring- │ │spring- │ │  spring-   │  │ │
│  │  │ jdbc   │ │  tx    │ │ orm    │ │  oxm   │ │  messaging  │  │ │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └─────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                        Web 层                                │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │ │
│  │  │  spring-web  │ │ spring-web-  │ │  Web Servlet /      │  │ │
│  │  │              │ │   servlet   │ │  Web Reactive        │  │ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                    测试与语言支持                             │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────┐  │ │
│  │  │ spring-test  │ │    CGLIB    │ │   ASM / Bytebud     │  │ │
│  │  │  (单元测试)   │ │ (字节码操作) │ │   (字节码解析)       │  │ │
│  │  └──────────────┘ └──────────────┘ └──────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

## 核心模块详解

### 1. Spring Core（核心模块）

这是 Spring 的心脏，所有其他模块都依赖它。

| 模块 | 职责 |
|-----|-----|
| **spring-core** | 提供框架的基本工具类：资源加载、类型转换、反射工具、IO 工具 |
| **spring-beans** | BeanFactory 的实现，Bean 的创建和管理 |
| **spring-context** | ApplicationContext 的实现，消息国际化、事件传播、资源加载 |
| **spring-expression** | SpEL 表达式语言，用于在配置文件和注解中编写复杂表达式 |

**核心依赖关系**：

```java
spring-context
    └── spring-beans
        └── spring-core
            └── (spring-jcl - Jakarta Commons Logging 替代品)

spring-expression
    └── spring-core
```

### 2. Spring AOP（面向切面编程）

| 模块 | 职责 |
|-----|-----|
| **spring-aop** | AOP 联盟接口的实现，代理创建 |
| **spring-aspects** | 集成 AspectJ，提供了更强大的 AOP 能力 |

**工作原理**：

```java
// Spring AOP 使用代理实现
// 方式一：JDK 动态代理（需要接口）
UserService proxy = (UserService) Proxy.newProxyInstance(
    classLoader,
    new Class[]{UserService.class},  // 必须有接口
    new InvocationHandler() {
        public Object invoke(Object proxy, Method method, Object[] args) {
            // 前置通知
            before();
            Object result = method.invoke(target, args);
            // 后置通知
            after();
            return result;
        }
    }
);

// 方式二：CGLIB 代理（不需要接口，生成子类）
UserService proxy = CglibAopProxy.createProxy(userService);
```

### 3. Spring 数据访问与集成

| 模块 | 职责 |
|-----|-----|
| **spring-jdbc** | JDBC 封装，去除样板式代码 |
| **spring-tx** | 声明式事务管理 |
| **spring-orm** | 集成 Hibernate、JPA 等 ORM 框架 |
| **spring-oxm** | 对象 XML 映射（ JAXB、XStream 等）|
| **spring-jms** | Java Message Service 消息服务 |

### 4. Spring Web 层

| 模块 | 职责 |
|-----|-----|
| **spring-web** | HTTP 层面的抽象：REST 客户端、文件上传、多部分请求 |
| **spring-webmvc** | MVC 框架（也叫 Spring MVC）|
| **spring-websocket** | WebSocket 支持 |
| **spring-webflux** | 响应式 Web 框架（WebFlux）|

## 模块依赖关系图

理解模块依赖关系，才能明白为什么有些配置是必须的：

```
                           spring-core
                              ▲
                              │
         ┌────────────────────┼────────────────────┐
         │                    │                    │
    spring-beans         spring-aop           spring-expression
         │                    │                    │
         ▼                    │                    │
    spring-context ──────────┴────────────────────┘
         │
         ├──► spring-context-support（缓存、邮件、任务调度）
         │
         ├──► spring-jdbc ──► spring-tx
         │
         ├──► spring-orm（Hibernate、JPA 集成）
         │
         ├──► spring-web
         │        │
         │        └──► spring-webmvc
         │        └──► spring-webflux
         │
         └──► spring-test（单元测试）
```

**关键理解**：

1. `spring-core` 是根基，所有模块都依赖它
2. `spring-beans` 依赖 `spring-core`，被 `spring-context` 继承
3. `spring-webmvc` 依赖 `spring-context`（所以 Web 应用可以用容器所有功能）
4. `spring-tx` 依赖 `spring-jdbc`，提供事务支持

## 最小依赖示例

如果你只想用 Spring 的 IoC 容器，不需要 Web 功能：

```xml
<!-- 最小集：IoC 容器 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-context</artifactId>
    <version>6.0.9</version>
</dependency>

<!-- spring-context 会自动引入 spring-beans 和 spring-core -->
```

## 典型 Web 应用依赖

一个典型的 Spring MVC Web 应用，至少需要：

```xml
<!-- IoC 容器 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-context</artifactId>
</dependency>

<!-- Web 层 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-web</artifactId>
</dependency>

<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-webmvc</artifactId>
</dependency>

<!-- 事务管理（几乎必用）-->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-tx</artifactId>
</dependency>

<!-- 数据库访问（如果用 JDBC）-->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-jdbc</artifactId>
</dependency>
```

## JAR 包结构与编译时模块化

Spring 5 之后引入了**编译时模块化**，每个模块都有独立的 JAR 包：

```
spring-core-6.0.9.jar
spring-beans-6.0.9.jar
spring-context-6.0.9.jar
spring-aop-6.0.9.jar
spring-web-6.0.9.jar
spring-webmvc-6.0.9.jar
...
```

同时提供了**汇总 JAR** 方便迁移：

```xml
<!-- 汇总所有模块的 JAR -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-jcl</artifactId>
</dependency>

<!-- 而不是分别引入 -->
<!-- <artifactId>spring-core</artifactId> 包含 jcl -->
```

## Spring 6.x 的变化

Spring 6.x 带来了几个重大变化：

1. **最低要求 JDK 17**：告别了 Java 8-16 的兼容包袱
2. **Jakarta EE 9+**：从 `javax.*` 迁移到 `jakarta.*`
3. **AOT 编译支持**：提前编译，提升启动速度，支持 GraalVM 原生镜像
4. **模块化 JDK**：更好地支持 Java Platform Module System (JPMS)

```java
// Spring 5.x
import javax.servlet.Servlet;

// Spring 6.x
import jakarta.servlet.Servlet;
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-------|
| spring-context 和 spring-beans 有什么区别？ | 模块依赖关系理解 |
| 为什么 spring-webmvc 依赖 spring-context？ | Web 与容器的集成 |
| Spring 6.x 为什么要迁移到 jakarta？ | 对 Java EE 历史演进的了解 |
| 如何只引入 IoC 容器，不引入 Web 功能？ | 理解按需引入的原则 |

---

**下节预告**：[Spring IoC 容器：控制反转与依赖注入](/framework/spring/ioc) —— 深入理解 IoC 的思想，从「对象自己创建依赖」到「容器注入依赖」的转变。
