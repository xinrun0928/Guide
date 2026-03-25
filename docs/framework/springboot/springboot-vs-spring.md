# Spring Boot vs Spring

2014 年，Spring Boot 1.0 发布。

彼时，Spring 框架已经走过了十年。作为 Java 企业级开发的事实标准，Spring 的功能强大毋庸置疑——但它的配置复杂程度，也让无数开发者望而却步。

于是，Spring Boot 来了。

## 故事：从「配置地狱」说起

让我们先回顾一下，在没有 Spring Boot 的年代，一个最基本的 Spring MVC 项目需要什么配置：

**pom.xml**：
```xml
<!-- Spring MVC 依赖 -->
<dependency>
    <groupId>org.springframework</groupId>
    <artifactId>spring-webmvc</artifactId>
    <version>5.3.20</version>
</dependency>
<!-- Jackson JSON -->
<dependency>
    <groupId>com.fasterxml.jackson.core</groupId>
    <artifactId>jackson-databind</artifactId>
    <version>2.13.3</version>
</dependency>
<!-- Servlet API -->
<dependency>
    <groupId>javax.servlet</groupId>
    <artifactId>javax.servlet-api</artifactId>
    <version>4.0.1</version>
</dependency>
<!-- 版本管理是个大坑，你得手动确保版本兼容性 -->
```

**web.xml**：
```xml
<servlet>
    <servlet-name>dispatcher</servlet-name>
    <servlet-class>org.springframework.web.servlet.DispatcherServlet</servlet-class>
    <init-param>
        <param-name>contextConfigLocation</param-name>
        <param-value>/WEB-INF/spring-mvc.xml</param-value>
    </init-param>
    <load-on-startup>1</load-on-startup>
</servlet>
<servlet-mapping>
    <servlet-name>dispatcher</servlet-name>
    <url-pattern>/</url-pattern>
</servlet-mapping>
```

**spring-mvc.xml**：
```xml
<!-- 组件扫描 -->
<context:component-scan base-package="com.example.controller"/>
<!-- 注解驱动 -->
<mvc:annotation-driven/>
<!-- 视图解析器 -->
<bean class="org.springframework.web.servlet.view.InternalResourceViewResolver">
    <property name="prefix" value="/WEB-INF/views/"/>
    <property name="suffix" value=".jsp"/>
</bean>
<!-- JSON 消息转换器 -->
<bean class="org.springframework.http.converter.json.MappingJackson2HttpMessageConverter"/>
```

这还只是最基础的配置。真正的项目里，还有数据库配置、事务配置、AOP 配置、Security 配置……

**结论**：在 Spring Boot 出现之前，配置比业务代码还多是常态。

## Spring Boot 的答案

Spring Boot 用两个核心武器解决了这个问题：

### 1. 起步依赖（Starter）

你不再需要记住要引入哪些 jar、版本号是多少。只需要引入一个 starter：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

这一个依赖，背后包含了：
- spring-webmvc
- spring-beans
- spring-context
- jackson-databind
- hibernate-validator
- tomcat-embed-core
- logback-classic
- ……以及它们的传递依赖

你不需要知道具体版本号，spring-boot-starter-parent 会帮你管理版本。

### 2. 自动配置（Auto Configuration）

你不再需要写 XML。Spring Boot 会根据你引入的依赖，自动配置你需要的一切。

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

```java
@RestController
public class UserController {
    @GetMapping("/user/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
}
```

直接运行，就能访问 `/user/{id}` 接口。Tomcat 已经启动好了，JSON 序列化已经配置好了，视图解析器也配置好了。

## 核心对比

| 对比维度 | Spring | Spring Boot |
|-----|----|-----|
| **配置方式** | XML 为主 | 注解 + Java Config |
| **依赖管理** | 手动管理版本 | starter + parent 版本管理 |
| **部署方式** | WAR 包到外部容器 | 可执行 JAR，内嵌容器 |
| **应用启动** | 需要部署到 Tomcat/Jetty | `java -jar` 直接运行 |
| **配置量** | 大量 XML 配置 | 约定优于配置 |
| **监控** | 需要手动集成 | Actuator 开箱即用 |

## 本质区别

说到这里，你可能会有一个疑问：**Spring Boot 是不是 Spring 的替代品？**

答案是：**不是。**

Spring Boot 是基于 Spring 的**脚手架框架**，它的底层依然是 Spring IoC、Spring AOP、Spring MVC。

Spring Boot 没有重新发明任何东西，它只是在 Spring 基础上做了两件事：

1. **把你需要手动写的配置，变成默认配置**
2. **把启动服务器、加载配置这些事情自动化**

换句话说，Spring Boot = Spring + 自动配置 + 起步依赖 + 可执行 JAR。

## 什么时候用 Spring？什么时候用 Spring Boot？

**用 Spring Boot**：
- 新项目，从零开始
- 微服务架构
- 需要快速开发、快速迭代
- 团队规模不大，不需要精细控制

**用 Spring（纯 XML 配置）**：
- 老项目，需要维护历史代码
- 对配置有特殊要求，需要精细控制
- 遗留系统，不方便迁移

**现实情况**：2014 年之后新建的项目，几乎清一色都是 Spring Boot。Spring 的 XML 配置方式，基本已经成为历史。

## Spring Boot 的代价

说了这么多 Spring Boot 的好处，它有没有缺点？

**有。**

1. **黑盒化**：配置都自动化了，如果你不理解原理，出问题很难排查。
2. **定制化门槛高**：想改默认行为？需要理解自动配置机制才行。
3. **起步依赖的复杂性**：一个 starter 可能引入几十个传递依赖，jar 包体积膨胀。

所以，理解 Spring Boot 的自动配置原理，是每个 Java 工程师的必修课。

## 总结

Spring Boot 不是 Spring 的替代品，而是 Spring 的**增强版**。

它解决的问题是：**让开发者把精力放在业务代码上，而不是配置上。**

但「不写配置」不代表「不需要理解配置」。Spring Boot 的自动配置是一把双刃剑——用好了，开发效率翻倍；用不好，问题排查如同海底捞针。

理解 Spring Boot 的底层原理，才是真正掌握它的开始。

---

> 面试中，经常会问到「Spring Boot 和 Spring 的区别」。回答时不要只说「Spring Boot 更简单」，要能从「自动配置原理」「起步依赖」「可执行 JAR」三个维度展开，才算合格。
