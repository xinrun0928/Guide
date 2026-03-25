# 自动配置原理

你知道吗，Spring Boot 项目启动时，会加载将近 200 个自动配置类。

但你可能只需要其中 10 个。那 Spring Boot 是怎么知道该加载哪些、不该加载哪些的？

答案就在这一节：**自动配置原理**。

## 自动配置的核心链路

先看一张图，理解整个自动配置的流程：

```
用户引入依赖
     ↓
Spring Boot 根据依赖推断需要哪些自动配置
     ↓
加载自动配置类（spring.factories / AutoConfiguration.imports）
     ↓
根据 @Conditional 条件注解筛选
     ↓
满足条件的配置生效，不满足的跳过
```

## @EnableAutoConfiguration 做了什么

`@EnableAutoConfiguration` 是自动配置的入口，它通过 `@Import` 引入了 `AutoConfigurationImportSelector`。

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

`AutoConfigurationImportSelector` 会返回一个需要导入的自动配置类数组：

```java
public class AutoConfigurationImportSelector 
    implements DeferredImportSelector {
    
    @Override
    public String[] selectImports(AnnotationMetadata annotationMetadata) {
        // 1. 获取所有候选自动配置类
        List<String> configurations = getCandidateConfigurations(
            annotationMetadata, attributes);
        // 2. 去重
        configurations = removeDuplicates(configurations);
        // 3. 根据 exclude 属性排除
        configurations.removeAll(getExclusions());
        // 4. 应用条件过滤
        configurations = filter(configurations);
        // 5. 返回需要导入的配置类
        return configurations.toArray(new String[0]);
    }
}
```

## 自动配置从哪里加载

关键问题：`getCandidateConfigurations()` 从哪里获取候选配置类？

### spring.factories（旧版，Spring Boot 2.7 之前）

Spring Boot 2.7 之前，自动配置类声明在 `META-INF/spring.factories` 文件中：

```properties
# META-INF/spring.factories
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration,\
org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration,\
org.springframework.boot.autoconfigure.data.jpa.JpaRepositoriesAutoConfiguration
```

### AutoConfiguration.imports（新版，Spring Boot 2.7+）

Spring Boot 2.7 之后，推荐使用 `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports` 文件：

```plaintext
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.autoconfigure.MyAutoConfiguration
com.example.autoconfigure.AnotherAutoConfiguration
```

这个新文件的优势是：
- 每行一个类，更易读
- 支持自动排序
- 不需要 key，只列出类名即可

## 条件注解：自动配置的过滤器

Spring Boot 定义了丰富的条件注解，只有满足条件的自动配置类才会生效：

### @ConditionalOnClass

只有当 classpath 下存在指定类时才生效。

```java
@Configuration
@ConditionalOnClass(DataSource.class)  // 只有引入了数据库驱动才生效
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {
    // ...
}
```

### @ConditionalOnMissingBean

只有当容器中没有用户自定义的 Bean 时才生效。

```java
@Bean
@ConditionalOnMissingBean  // 只有用户没有自定义 DataSource 才生效
public DataSource dataSource() {
    return new HikariDataSource();
}
```

**这是自动配置的核心原则**：用户自定义 Bean 的优先级高于自动配置。

### @ConditionalOnProperty

只有当配置属性满足条件时才生效。

```java
@Configuration
@ConditionalOnProperty(
    prefix = "spring.datasource",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true  // 缺少该属性也算匹配
)
public class DataSourceAutoConfiguration {
    // ...
}
```

### @ConditionalOnBean 与 @ConditionalOnMissingBean

```java
@Configuration
@ConditionalOnBean(type = "javax.sql.DataSource")  // 只有存在 DataSource Bean 才生效
public class JdbcTemplateAutoConfiguration {
    // ...
}
```

## 完整的自动配置类结构

以 `WebMvcAutoConfiguration` 为例，看看一个典型的自动配置类是什么样的：

```java
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)       // 必须是 Servlet Web 应用
@ConditionalOnClass({ WebMvcConfigurer.class })         // 必须引入 Spring MVC
@ConditionalOnMissingBean(WebMvcConfiguration.class)   // 用户没自定义才生效
@EnableConfigurationProperties(WebMvcProperties.class)  // 启用配置属性
@AutoConfigureAfter({ DispatcherServletAutoConfiguration.class })
public class WebMvcAutoConfiguration {
    
    // 定义了多个内部配置类
    @Configuration
    @Import(EnableWebMvcConfiguration.class)
    @EnableConfigurationProperties({ WebMvcProperties.class })
    @Order(0)
    public static class WebMvcAutoConfigurationAdapter 
        implements WebMvcConfigurer {
        // ...
    }
    
    // 定义 Bean
    @Bean
    @ConditionalOnMissingBean
    public RequestContextFilter requestContextFilter() {
        return new RequestContextFilter();
    }
}
```

## 自动配置的执行顺序

自动配置类之间可能有依赖关系，Spring Boot 用 `@AutoConfigureAfter` 和 `@AutoConfigureBefore` 来控制顺序：

```java
@Configuration
@AutoConfigureAfter(DataSourceAutoConfiguration.class)   // 在 DataSource 配置之后
@AutoConfigureBefore(WebMvcAutoConfiguration.class)      // 在 WebMvc 配置之前
public class TransactionAutoConfiguration {
    // ...
}
```

Spring Boot 2.7+ 的 `AutoConfiguration.imports` 文件也支持显式排序：

```plaintext
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
# 按顺序列出，先声明的先加载
com.example.autoconfigure.FirstAutoConfiguration
com.example.autoconfigure.SecondAutoConfiguration
```

## 排除自动配置

有三种方式排除自动配置：

### 方式一：@SpringBootApplication(exclude = ...)

```java
@SpringBootApplication(exclude = { DataSourceAutoConfiguration.class })
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 方式二：application.yml 中排除

```yaml
spring:
  autoconfigure:
    exclude:
      - org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration
      - org.springframework.boot.autoconfigure.web.servlet.WebMvcAutoConfiguration
```

### 方式三：@EnableAutoConfiguration(exclude = ...)

```java
@EnableAutoConfiguration(exclude = { DataSourceAutoConfiguration.class })
public class Application {
    // ...
}
```

## Debug 自动配置

想知道 Spring Boot 加载了哪些自动配置？开启 Debug 模式：

```yaml
debug: true
```

启动后，你会看到这样的输出：

```
=========================
AUTO-CONFIGURATION REPORT
=========================

Positive matches:
-----------------
    DataSourceAutoConfiguration matched:
      - @ConditionalOnClass found required class 'javax.sql.DataSource'
      - @ConditionalOnMissingBean found no existing Bean (OnBeanCondition)

Negative matches:
-----------------
    WebMvcAutoConfiguration did not match:
      - @ConditionalOnClass did not find required class 'org.springframework.web.servlet.DispatcherServlet' (OnClassCondition)
```

这份报告清晰地告诉你：
- **Positive matches**：哪些自动配置被加载了，以及原因
- **Negative matches**：哪些自动配置没有被加载，以及原因

## 自动配置与用户配置的关系

这是理解自动配置最关键的一点：**自动配置的 Bean 优先级低于用户自定义的 Bean**。

```java
// 自动配置
@Configuration
public class WebMvcAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public ViewResolver viewResolver() {
        // 只有用户没自定义才生效
        return new InternalResourceViewResolver();
    }
}

// 用户自定义
@SpringBootConfiguration
public class MyConfig {
    @Bean
    public ViewResolver viewResolver() {
        // 这个优先级更高，自动配置的那个不会生效
        return new MyCustomViewResolver();
    }
}
```

**原因**：`@ConditionalOnMissingBean` 注解保证了这一点——只有当容器中没有同类型的 Bean 时，自动配置才生效。

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| 自动配置是从哪个文件加载的？ | spring.factories vs AutoConfiguration.imports |
| @ConditionalOnMissingBean 的意义是什么？ | 自动配置与用户配置的优先级 |
| 如何排除不需要的自动配置？ | exclude 配置 |
| 如何 Debug 自动配置？ | debug 模式 |
| @AutoConfigureAfter 和 @Order 的区别？ | 配置顺序控制 |

---

> 自动配置是 Spring Boot 最核心的特性。理解了这一节，你就能回答「Spring Boot 是怎么知道要配置什么的」这个问题。核心就一句话：**根据条件注解，决定哪些配置生效**。
