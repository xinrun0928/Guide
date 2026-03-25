# Spring Boot 面试高频问题汇总

Spring Boot 是 Java 后端面试的重头戏。

它考察的不只是会不会用，更考察对原理的理解。

这一节，我们把 Spring Boot 面试中最常问的问题一网打尽。

## 一、Spring Boot 基础

### Q1：Spring Boot 是什么？有什么特点？

Spring Boot 是 Spring 的子项目，用于简化 Spring 应用的创建和部署。

**特点**：
- 开箱即用：自动配置
- 嵌入式服务器：内置 Tomcat/Jetty
- 生产就绪：Actuator 监控
- 无 XML 配置：JavaConfig

### Q2：Spring Boot 和 Spring 的区别？

| 维度 | Spring | Spring Boot |
|-----|--------|-------------|
| 配置 | XML/注解 | 自动配置 |
| 依赖 | 手动管理 | Starter 自动管理 |
| 内嵌服务器 | 需要配置 | 内置 |
| 监控 | 需集成 | Actuator |
| 打包 | WAR | JAR |

### Q3：Spring Boot 的自动配置原理？

```java
// @SpringBootApplication = @Configuration + @EnableAutoConfiguration + @ComponentScan

// @EnableAutoConfiguration 启用自动配置

// 自动配置类通过 META-INF/spring.factories 加载
```

## 二、自动配置原理

### Q4：自动配置是如何实现的？

1. `@EnableAutoConfiguration` 启用自动配置
2. `spring-boot-autoconfigure` 中的配置类通过 `META-INF/spring.factories` 注册
3. `AutoConfigurationImportSelector` 读取配置文件
4. 通过 `@Conditional` 系列注解判断是否生效
5. 满足条件则自动配置 Bean

### Q5：@Conditional 注解有哪些？

| 注解 | 条件 |
|-----|------|
| `@ConditionalOnClass` | 类路径下有指定类 |
| `@ConditionalOnMissingClass` | 类路径下没有指定类 |
| `@ConditionalOnBean` | 容器中有指定 Bean |
| `@ConditionalOnMissingBean` | 容器中没有指定 Bean |
| `@ConditionalOnProperty` | 配置属性满足条件 |
| `@ConditionalOnWebApplication` | 是 Web 应用 |

### Q6：如何自定义自动配置？

1. 创建配置类
2. 使用 `@Configuration` + `@Conditional*` 注解
3. 在 `META-INF/spring.factories` 中注册

```java
@Configuration
@ConditionalOnClass(UserService.class)
@ConditionalOnMissingBean(UserService.class)
public class UserAutoConfiguration {
    @Bean
    public UserService userService() {
        return new UserService();
    }
}
```

```properties
# META-INF/spring.factories
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.config.UserAutoConfiguration
```

## 三、启动流程

### Q7：Spring Boot 启动流程？

```
1. 入口 main() 方法
2. 创建 SpringApplication 对象
3. 执行 run() 方法
   ├── 准备 Environment
   ├── 创建 ApplicationContext
   ├── 刷新 Context
   │   ├── 加载 Bean 定义
   │   ├── 执行 BeanFactoryPostProcessor
   │   ├── 注册 BeanPostProcessor
   │   └── 初始化单例 Bean
   └── 执行 Runner
4. 返回 ApplicationContext
```

### Q8：SpringApplication.run() 做了什么？

1. 准备环境（profiles、properties）
2. 创建 ApplicationContext
3. 准备上下文（设置 Environment、加载 Bean 定义）
4. 刷新上下文（初始化 Bean）
5. 刷新后处理（执行 Runner）

## 四、核心注解

### Q9：@SpringBootApplication 包含哪些注解？

```java
@SpringBootApplication
├── @SpringBootConfiguration
│   └── @Configuration（标记配置类）
├── @EnableAutoConfiguration
│   └── @Import(AutoConfigurationImportSelector.class)
└── @ComponentScan
    └── 扫描当前包及子包的组件
```

### Q10：@Configuration 和 @Component 的区别？

| 维度 | @Configuration | @Component |
|-----|---------------|------------|
| 本质 | 配置类 | 组件 |
| 代理 | CGLIB 代理 | 无 |
| 内部调用 | 每次调用都创建新 Bean | 同一个 Bean |

```java
@Configuration
public class Config {
    @Bean
    public A a() {
        return new A();
    }

    @Bean
    public B b() {
        return new B(a());  // 实际调用的是代理对象的 a()
    }
}
```

## 五、外部配置

### Q11：Spring Boot 配置文件的加载顺序？

```
1. 命令行参数
2. OS 环境变量
3. jar 包外的 application-{profile}.properties
4. jar 包内的 application-{profile}.properties
5. jar 包外的 application.properties
6. jar 包内的 application.properties
7. @PropertySource 注解
8. SpringApplication.setDefaultProperties
```

### Q12：@ConfigurationProperties 和 @Value 的区别？

| 维度 | @ConfigurationProperties | @Value |
|-----|--------------------------|--------|
| 批量绑定 | 支持 | 不支持 |
| 松散绑定 | 支持 | 不支持 |
| SpEL | 不支持 | 支持 |
| 元数据 | 支持 | 不支持 |
| 校验 | 支持（@Validated） | 不支持 |

## 六、Actuator

### Q13：Spring Boot Actuator 有什么用？

提供生产级别的监控和管理功能。

**常用端点**：

| 端点 | 说明 |
|-----|------|
| `/actuator/health` | 健康检查 |
| `/actuator/info` | 应用信息 |
| `/actuator/metrics` | 指标信息 |
| `/actuator/beans` | Bean 列表 |
| `/actuator/env` | 环境变量 |
| `/actuator/mappings` | URL 映射 |

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
  endpoint:
    health:
      show-details: always
```

## 七、起步依赖

### Q14：spring-boot-starter-web 包含哪些依赖？

```
spring-boot-starter-web
├── spring-boot-starter
│   ├── spring-boot
│   ├── spring-boot-autoconfigure
│   └── spring-boot-starter-logging
├── spring-boot-starter-tomcat
│   └── tomcat-embed-embedded-core
├── spring-web
│   ├── spring-web
│   └── spring-webmvc
└── jackson-databind
```

### Q15：如何排除自动配置？

```java
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})
```

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
```

## 八、日志

### Q16：Spring Boot 默认日志框架？

Logback，SLF4J 作为日志门面。

```yaml
logging:
  level:
    root: INFO
    com.example: DEBUG
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss} [%thread] %-5level %logger{36} - %msg%n"
  file:
    name: app.log
```

## 九、Profile

### Q17：Spring Boot 如何切换环境？

**方式一**：配置文件

```
application-dev.properties
application-prod.properties
```

**方式二**：YAML 多文档

```yaml
spring:
  config:
    activate:
      on-profile: dev
---
spring:
  config:
    activate:
      on-profile: prod
```

**方式三**：命令行

```bash
java -jar app.jar --spring.profiles.active=prod
```

## 十、面试追问

### 追问 1：Spring Boot 如何实现零配置？

通过 `@EnableAutoConfiguration` 和 `@ComponentScan` 自动扫描和配置。

### 追问 2：自动配置会不会影响性能？

不会。自动配置只在启动时执行一次，不影响运行时性能。

### 追问 3：Spring Boot 的启动时间优化？

1. 减少自动配置
2. 懒加载 `@Lazy`
3. 减少组件扫描
4. 使用 GraalVM 原生镜像

---

## 总结

```
┌─────────────────────────────────────────────┐
│           Spring Boot 面试重点               │
├─────────────────────────────────────────────┤
│                                             │
│  1. 基础概念                                 │
│     ├── Spring Boot 特点                    │
│     └── 与 Spring 的区别                    │
│                                             │
│  2. 自动配置                                │
│     ├── @Conditional 系列                   │
│     └── 自定义自动配置                      │
│                                             │
│  3. 启动流程                                │
│     ├── SpringApplication.run()              │
│     └── 刷新上下文流程                      │
│                                             │
│  4. 核心注解                                │
│     ├── @SpringBootApplication              │
│     └── @Configuration vs @Component        │
│                                             │
│  5. 外部配置                                │
│     ├── 配置加载顺序                        │
│     └── @ConfigurationProperties            │
│                                             │
└─────────────────────────────────────────────┘
```

---

到这里，Spring Boot 的核心内容就讲完了。我们学习了：

- CORS 跨域配置
- 拦截器与过滤器
- WebSocket 整合
- GraphQL 整合
- 面试高频问题

这些知识点覆盖了 Spring Boot 的大部分高级应用场景。如果你想进一步深入，可以查看官方文档或源码。
