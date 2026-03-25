# Starter 自动配置原理

你引入了一个 `spring-boot-starter-data-redis`，然后 `RedisTemplate` 就自动可以注入了——这是怎么做到的？

今天，我们深入理解 Starter 的自动配置原理。

## 整体流程

```
用户引入 starter 依赖
         ↓
Spring Boot 启动
         ↓
加载 spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
         ↓
获取所有候选自动配置类
         ↓
根据 @Conditional* 条件注解过滤
         ↓
满足条件的配置类被加载
         ↓
@Bean 方法被执行，Bean 被注册到容器
```

## 自动配置的入口

`@EnableAutoConfiguration` 是自动配置的起点，它引入了 `AutoConfigurationImportSelector`：

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import(AutoConfigurationImportSelector.class)
public @interface EnableAutoConfiguration {
    Class<?>[] exclude() default {};
    String[] excludeName() default {};
}
```

`AutoConfigurationImportSelector` 会在 Spring 启动时被执行：

```java
public class AutoConfigurationImportSelector 
    implements DeferredImportSelector {
    
    @Override
    public String[] selectImports(AnnotationMetadata annotationMetadata) {
        // 获取所有候选自动配置类
        List<String> configurations = getCandidateConfigurations(
            annotationMetadata, getAttributes(annotationMetadata));
        // 去重
        configurations = removeDuplicates(configurations);
        // 排除
        configurations = getExclusions(annotationMetadata, configurations);
        // 过滤
        configurations = filter(configurations);
        return configurations.toArray(new String[0]);
    }
}
```

## 自动配置从哪里来

### 1. Spring Boot 内置的自动配置

Spring Boot 的 `spring-boot-autoconfigure` jar 包中包含大量自动配置类：

```
spring-boot-autoconfigure-xxx.jar
└── META-INF/
    └── spring/
        └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

文件内容示例：

```plaintext
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
org.springframework.boot.autoconfigure.web.servlet.DispatcherServletAutoConfiguration
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration
org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration
...（近 200 个自动配置类）
```

### 2. 第三方 Starter 的自动配置

当你引入第三方 Starter 时，它的 jar 包中也包含自动配置：

```
third-party-starter.jar
└── META-INF/
    └── spring/
        └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

## 条件装配的核心

自动配置类的「智能」来自于条件注解。Spring Boot 会根据当前环境动态决定是否加载某个配置。

### 典型结构

```java
@Configuration
@ConditionalOnClass(RedisOperations.class)           // 1. 必须有 RedisOperations 类
@ConditionalOnMissingBean(RedisTemplate.class)       // 2. 用户没自定义才生效
@EnableConfigurationProperties(RedisProperties.class) // 3. 启用配置属性
@AutoConfigureAfter(DataSourceAutoConfiguration.class) // 4. 在数据源配置之后
public class RedisAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean(name = "redisTemplate")  // 只有没有同名的 Bean 才生效
    public RedisTemplate&lt;Object, Object&gt; redisTemplate(
            RedisConnectionFactory redisConnectionFactory) {
        // 创建 RedisTemplate
        RedisTemplate&lt;Object, Object&gt; template = new RedisTemplate&lt;&gt;();
        template.setConnectionFactory(redisConnectionFactory);
        // ...
        return template;
    }
}
```

### 条件注解的作用

| 注解 | 作用 |
|-----|-----|
| `@ConditionalOnClass` | 检查 classpath 是否有某个类 |
| `@ConditionalOnMissingBean` | 检查容器中是否没有某个 Bean |
| `@ConditionalOnProperty` | 检查配置属性是否满足条件 |
| `@ConditionalOnBean` | 检查容器中是否有某个 Bean |
| `@ConditionalOnWebApplication` | 检查是否是 Web 应用 |

## 配置属性的绑定

### Properties 类

```java
@ConfigurationProperties(prefix = "spring.data.redis")
public class RedisProperties {
    private String host = "localhost";
    private int port = 6379;
    private String password;
    private int database = 0;
    // ...
}
```

### 自动配置类中使用

```java
@Configuration
@EnableConfigurationProperties(RedisProperties.class)
public class RedisAutoConfiguration {
    
    private final RedisProperties properties;
    
    public RedisAutoConfiguration(RedisProperties properties) {
        this.properties = properties;
    }
    
    @Bean
    @ConditionalOnMissingBean
    public RedisConnectionFactory redisConnectionFactory() {
        // 使用 properties 创建连接工厂
        LettuceConnectionFactory factory = 
            new LettuceConnectionFactory(properties.getHost(), properties.getPort());
        factory.setPassword(properties.getPassword());
        factory.setDatabase(properties.getDatabase());
        return factory;
    }
}
```

## Bean 的注册过程

### 1. 解析配置类

Spring 在刷新容器时，会解析所有 `@Configuration` 类（包括自动配置类）。

### 2. 注册 @Bean 定义

```java
@Configuration
public class MyAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean
    public MyService myService() {
        return new MyService();
    }
}
```

这个 `@Bean` 方法会被解析为 `BeanDefinition`，注册到 `BeanFactory` 中。

### 3. 执行 @Bean 方法

在 `finishBeanFactoryInitialization()` 阶段，Spring 会实例化所有单例 Bean。

**关键点**：`@ConditionalOnMissingBean` 在这个阶段生效——只有当容器中没有同名 Bean 时，才会执行这个 `@Bean` 方法。

## 用户配置优先原则

这是自动配置最重要的原则：**用户自定义的 Bean 优先于自动配置**。

### 用户定义了 Bean

```java
@SpringBootApplication
public class Application {
    
    @Bean
    public RedisTemplate&lt;String, Object&gt; redisTemplate() {
        // 用户自定义的 RedisTemplate
        return new CustomRedisTemplate();
    }
}
```

### 自动配置失效

```java
// 自动配置类中
@Bean
@ConditionalOnMissingBean(name = "redisTemplate")  // 检测到已有 redisTemplate，跳过
public RedisTemplate&lt;String, Object&gt; redisTemplate() {
    // 这个方法不会执行
    return new DefaultRedisTemplate();
}
```

## 配置的加载顺序

自动配置类之间可能有依赖，Spring Boot 用 `@AutoConfigureAfter` 和 `@AutoConfigureBefore` 控制顺序：

```java
@Configuration
@AutoConfigureAfter(DataSourceAutoConfiguration.class)  // 在数据源配置之后
public class JpaAutoConfiguration {
    // ...
}
```

Spring Boot 2.7+ 的 `AutoConfiguration.imports` 文件也支持按顺序书写：

```plaintext
# 按顺序加载
com.example.autoconfigure.FirstAutoConfiguration
com.example.autoconfigure.SecondAutoConfiguration
com.example.autoconfigure.ThirdAutoConfiguration
```

## Debug 自动配置

### 开启 Debug 模式

```yaml
debug: true
```

### 查看报告

```
=========================
AUTO-CONFIGURATION REPORT
=========================

Positive matches:
-----------------
    RedisAutoConfiguration matched:
      - @ConditionalOnClass found required class 'org.springframework.data.redis.core.RedisOperations'
      - @ConditionalOnMissingBean found no existing Bean of type 'org.springframework.data.redis.core.RedisTemplate'

Negative matches:
-----------------
    TransactionAutoConfiguration did not match:
      - @ConditionalOnBean did not find a single Bean of type 'javax.sql.DataSource'
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| 自动配置的 Bean 和用户定义的 Bean，谁优先级高？ | 用户配置优先 |
| @ConditionalOnMissingBean 为什么重要？ | 自动配置原理 |
| @EnableConfigurationProperties 做了什么？ | 配置属性绑定 |
| 自动配置类是何时加载的？ | BeanFactoryPostProcessor |
| 如何让一个自动配置在另一个之后执行？ | @AutoConfigureAfter |

---

> 理解 Starter 的自动配置原理，你就能解释为什么引入一个依赖就能「开箱即用」——这不是魔法，是 Spring Boot 根据条件注解「智能推断」的结果。
