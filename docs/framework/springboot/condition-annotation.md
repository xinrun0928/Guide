# 条件注解

你是否有这样的疑惑：Spring Boot 的自动配置类那么多，为什么有些生效了，有些没生效？

答案藏在条件注解里。

`@ConditionalOnClass`、`@ConditionalOnBean`、`@ConditionalOnProperty`……这些注解就像「门卫」，只有满足条件的自动配置才被放行。

## 条件注解家族

Spring Boot 提供了一套完整的条件注解体系：

```
@Conditional
├── @ConditionalOnClass
├── @ConditionalOnMissingClass
├── @ConditionalOnBean
├── @ConditionalOnMissingBean
├── @ConditionalOnProperty
├── @ConditionalOnResource
├── @ConditionalOnWebApplication
├── @ConditionalOnNotWebApplication
├── @ConditionalOnExpression
└── @ConditionalOnSingleCandidate
```

## @ConditionalOnClass 与 @ConditionalOnMissingClass

**作用**：根据 classpath 下是否存在指定类来决定是否加载。

### 典型场景：检查依赖是否引入

```java
@Configuration
@ConditionalOnClass(DataSource.class)  // 只有引入了数据库驱动才生效
@ConditionalOnMissingBean(DataSource.class)
@EnableConfigurationProperties(DataSourceProperties.class)
public class DataSourceAutoConfiguration {
    // ...
}
```

**场景分析**：用户引入了 `spring-boot-starter-jdbc` 或 `spring-boot-starter-data-jpa`，classpath 下就有 `DataSource` 类，`DataSourceAutoConfiguration` 才生效。

### 反向检查：@ConditionalOnMissingClass

```java
@Configuration
@ConditionalOnMissingClass("com.fasterxml.jackson.databind.ObjectMapper") 
// 只有 classpath 下没有 Jackson 才生效
public class FastjsonAutoConfiguration {
    // ...
}
```

## @ConditionalOnBean 与 @ConditionalOnMissingBean

**作用**：根据容器中是否存在指定 Bean 来决定是否加载。

### 典型场景：用户没自定义才生效

```java
@Bean
@ConditionalOnMissingBean  // 只有容器中没有这个类型的 Bean 才生效
public ObjectMapper objectMapper() {
    return new ObjectMapper();
}
```

这是**自动配置的核心原则**：用户定义的 Bean 优先，自动配置兜底。

### 检查特定 Bean

```java
@Configuration
@ConditionalOnBean(type = "javax.sql.DataSource")  // 只有存在 DataSource Bean 才生效
public class JdbcTemplateAutoConfiguration {
    // ...
}
```

### 泛型支持

```java
@Configuration
@ConditionalOnBean(RedisConnectionFactory.class)  // 检查 Redis 连接工厂
public class RedisTemplateAutoConfiguration {
    // ...
}
```

## @ConditionalOnProperty

**作用**：根据配置属性值来决定是否加载。

### 基本用法

```java
@Configuration
@ConditionalOnProperty(
    prefix = "spring.redis",
    name = "enabled",
    havingValue = "true"
)
public class RedisAutoConfiguration {
    // ...
}
```

### matchIfMissing：缺少属性时的行为

```java
@Configuration
@ConditionalOnProperty(
    prefix = "spring.datasource",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true  // 缺少这个属性也认为是匹配的
)
public class DataSourceAutoConfiguration {
    // ...
}
```

### 多条件组合

```java
@Configuration
@ConditionalOnProperty(
    prefix = "spring.cache",
    name = "type",
    havingValue = "redis"
)
@ConditionalOnClass(RedisTemplate.class)
@ConditionalOnBean(RedisConnectionFactory.class)
public class RedisCacheAutoConfiguration {
    // ...
}
```

## @ConditionalOnWebApplication 与 @ConditionalOnNotWebApplication

**作用**：根据应用类型来决定是否加载。

### Web 应用专用配置

```java
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)  // Servlet Web 应用才生效
public class WebMvcAutoConfiguration {
    // ...
}
```

### 非 Web 应用配置

```java
@Configuration
@ConditionalOnNotWebApplication  // 非 Web 应用才生效
public class BatchAutoConfiguration {
    // ...
}
```

### Web 应用类型

```java
public enum Type {
    // 普通 Web 应用（Spring MVC）
    SERVLET,
    
    // 响应式 Web 应用（Spring WebFlux）
    REACTIVE,
    
    // 任何 Web 应用（SERVLET 或 REACTIVE）
    ANY
}
```

## @ConditionalOnExpression

**作用**：根据 SpEL 表达式来决定是否加载。

### 简单表达式

```java
@Configuration
@ConditionalOnExpression("${my.feature.enabled:false}")
public class FeatureAutoConfiguration {
    // ...
}
```

### 复杂表达式

```java
@Configuration
@ConditionalOnExpression(
    "'${spring.datasource.driver-class-name}'"
        .contains('mysql') || "'${spring.datasource.driver-class-name}'".contains('mariadb')
)
public class MySQLAutoConfiguration {
    // ...
}
```

## @ConditionalOnResource

**作用**：根据是否存在指定的资源文件来决定是否加载。

```java
@Configuration
@ConditionalOnResource(resources = "classpath:my-config.xml")
public class XmlConfigAutoConfiguration {
    // ...
}
```

**场景**：只有当 `my-config.xml` 存在时才加载。

## @ConditionalOnSingleCandidate

**作用**：只有当容器中只有一个指定类型的 Bean 时才生效。

```java
@Configuration
@ConditionalOnSingleCandidate(DataSource.class)
public class TransactionAutoConfiguration {
    // ...
}
```

**与 @ConditionalOnBean 的区别**：

- `@ConditionalOnBean`：只要存在任意一个就匹配
- `@ConditionalOnSingleCandidate`：必须恰好存在一个

## 组合条件：@Conditional

如果以上注解都不满足需求，可以使用 `@Conditional` 注解自定义条件：

### 定义条件类

```java
public class MyCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        // 自定义条件逻辑
        String property = context.getEnvironment()
            .getProperty("my.feature.enabled");
        return "true".equals(property);
    }
}
```

### 使用自定义条件

```java
@Configuration
@Conditional(MyCondition.class)
public class MyAutoConfiguration {
    // ...
}
```

## 常见自动配置的条件组合

### DataSourceAutoConfiguration

```java
@Configuration
@ConditionalOnClass({ DataSource.class, EmbeddedDatabaseType.class })
@ConditionalOnMissingBean(DataSource.class)
@EnableConfigurationProperties(DataSourceProperties.class)
@AutoConfigureAfter(HikariDataSourceAutoConfiguration.class)
public class DataSourceAutoConfiguration {
    // ...
}
```

### WebMvcAutoConfiguration

```java
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)
@ConditionalOnClass({ Servlet.class, DispatcherServlet.class, WebMvcConfigurer.class })
@ConditionalOnMissingBean(WebMvcConfigurationSupport.class)
@AutoConfigureAfter(WebMvcAutoConfiguration.class)
public class WebMvcAutoConfiguration {
    // ...
}
```

## Debug 条件匹配

开启 Debug 模式，查看条件匹配详情：

```yaml
debug: true
```

输出示例：

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
    RedisAutoConfiguration did not match:
      - @ConditionalOnBean did not find a single Bean (OnBeanCondition)

Exclusions:
-----------
    None
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| @ConditionalOnMissingBean 的意义是什么？ | 自动配置优先级 |
| 如何自定义条件注解？ | @Conditional |
| @ConditionalOnProperty 的 matchIfMissing 有什么用？ | 配置默认值 |
| 为什么一个自动配置可能不生效？ | 条件不满足 |
| @ConditionalOnBean 和 @ConditionalOnSingleCandidate 的区别？ | Bean 唯一性 |

---

> 条件注解是 Spring Boot 自动配置的「门卫」。理解它们，你就能解释为什么某个自动配置生效了、某个没生效——这是面试中展示深度理解的关键点。
