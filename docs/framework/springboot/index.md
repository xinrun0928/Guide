# Spring Boot 总览

你是否有过这样的经历：新建一个 Spring 项目，配置了半天，还没开始写业务代码，就已经累了。

光是 pom.xml 就得写几十行依赖，web.xml 要配置，applicationContext.xml 要配置，事务要配置，视图解析器要配置……

Spring Boot 出现的意义，就是让「配置」这件事变得不再痛苦。

## Spring Boot 是什么

Spring Boot 是 Spring 官方为了解决「配置地狱」而生的框架。它的核心目标只有一个：**让 Spring 应用能够「零配置」运行**。

但「零配置」不代表没有配置，而是把「默认配置」做到极致——你不需要的配置，不需要写；你需要的功能，Spring Boot 帮你自动配置好了。

这就是 Spring Boot 的两大核心：**自动配置**和**起步依赖**。

## 三个关键词

### 1. 自动配置（Auto Configuration）

Spring Boot 会根据你引入的依赖，自动推断并配置你需要的一切。

引入了 `spring-boot-starter-web`？Tomcat、Spring MVC、JSON 转换器，全都有了。

引入了 `spring-boot-starter-data-redis`？RedisTemplate 给你配好，直接注入就能用。

这一切，都是自动配置在背后默默工作。

### 2. 起步依赖（Starter）

起步依赖本质上是一个「依赖集合」。以前你要手动引入十几个 jar，现在一个 starter 全搞定。

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
</dependency>
```

这个 starter 背后，实际上包含了 Spring MVC、Spring Core、Jackson、Hibernate Validator……你不需要知道它们各自是什么版本，会自动选择最兼容的版本组合。

### 3. 可执行 JAR（Executable JAR）

传统的 Spring 应用需要打包成 WAR，放到 Tomcat、Jetty 等容器中运行。

Spring Boot 把你整个应用（包括嵌入式服务器）打包成一个 JAR，直接 `java -jar` 就能跑。

```bash
java -jar myapp.jar
```

这就是「可执行 JAR」，也叫做「fat jar」或者「uber jar」。

## 模块总览

本模块涵盖 Spring Boot 核心知识：

### 基础原理

| 文档 | 内容 |
|-----|-----|
| [Spring Boot vs Spring](/framework/springboot/springboot-vs-spring) | 两者的区别，自动配置与起步依赖 |
| [Spring Boot 启动流程](/framework/springboot/startup-flow) | 从 main() 到应用启动，源码解析 |
| [@SpringBootApplication 注解](/framework/springboot/application-annotation) | 组合注解的层层拆解 |

### 自动配置

| 文档 | 内容 |
|-----|-----|
| [自动配置原理](/framework/springboot/autoconfig) | @EnableAutoConfiguration 与自动配置链 |
| [spring.factories vs AutoConfiguration.imports](/framework/springboot/auto-config-imports) | 两代自动配置文件的演进 |
| [条件注解](/framework/springboot/condition-annotation) | @ConditionalOnClass、@ConditionalOnBean 等 |

### 外部配置

| 文档 | 内容 |
|-----|-----|
| [外部化配置](/framework/springboot/external-config) | application.yml 与配置绑定 |
| [Bootstrap vs Application](/framework/springboot/bootstrap) | 两者的加载顺序与区别 |

### 自定义 Starter

| 文档 | 内容 |
|-----|-----|
| [自定义 Starter](/framework/springboot/custom-starter) | 从零开发一个生产级 Starter |
| [Starter 自动配置原理](/framework/springboot/starter-autoconfig) | 自动配置与条件装配 |

### 运维与监控

| 文档 | 内容 |
|-----|-----|
| [Actuator 监控端点](/framework/springboot/actuator) | 健康检查、指标监控 |
| [Banner 定制](/framework/springboot/banner) | 启动 Banner 的个性化设置 |
| [日志配置](/framework/springboot/logging) | Logback、SLF4J 与日志配置 |

### Web 开发

| 文档 | 内容 |
|-----|-----|
| [异常处理](/framework/springboot/error-handler) | ErrorController 与全局异常处理 |
| [静态资源](/framework/springboot/static-resource) | 静态资源配置与自定义 |
| [CORS 跨域](/framework/springboot/cors) | 跨域问题的多种解决方案 |
| [拦截器与过滤器](/framework/springboot/interceptor-filter) | 过滤器和拦截器的注册 |

### 高级整合

| 文档 | 内容 |
|-----|-----|
| [WebSocket](/framework/springboot/websocket) | 实时通信的实现 |
| [GraphQL](/framework/springboot/graphql) | API 查询语言的整合 |

### 面试

| 文档 | 内容 |
|-----|-----|
| [Spring Boot 面试高频题](/framework/springboot/interview-summary) | 常考点与回答思路 |

## 为什么选 Spring Boot

如果你还在犹豫是否学习 Spring Boot，这里有几个理由：

**开发效率提升 10 倍**：以前配置 Tomcat 需要 2 小时，现在 5 分钟就能跑起来。

**生态无缝整合**：Spring Boot + Spring Cloud = 分布式微服务；Spring Boot + Spring Data = 数据访问层；Spring Boot + Spring Security = 安全控制。

**运维友好**：`java -jar` 部署，配合 Docker，一行命令拉起整个服务。

**社区成熟**：Spring Boot 是目前最流行的 Java 框架，文档完善，社区活跃，遇到问题一搜就有答案。

## 学习路线

```
Spring 基础（IoC、AOP、MVC）
  ↓
Spring Boot 快速上手（hello world）
  ↓
自动配置原理（理解 @EnableAutoConfiguration）
  ↓
外部化配置（application.yml）
  ↓
自定义 Starter（理解自动配置的本质）
  ↓
运维与监控（Actuator）
  ↓
高级整合（WebSocket、GraphQL）
```

---

> 面试中，Spring Boot 的自动配置原理是高频考点。理解了这一块，你不仅能回答「Spring Boot 是怎么启动的」，更能回答「Spring Boot 是怎么知道要配置什么的」。
