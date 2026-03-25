# 条件装配详解：@Conditional

你有没有遇到过这种场景？

本地开发用 H2 数据库，生产环境用 MySQL。以往的做法是改配置文件、打不同的包、部署到不同环境……

太麻烦了。

Spring 4.0 引入了 `@Conditional`，让你可以根据条件动态决定 Bean 是否创建。

## @Conditional 的本质

### 什么是条件装配？

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      条件装配示意图                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  @Conditional(WindowsCondition)                                        │
│  ┌─────────────────────────┐                                          │
│  │   WindowsDataSource     │  ← 只在 Windows 环境创建                 │
│  └─────────────────────────┘                                          │
│                                                                         │
│  @Conditional(LinuxCondition)                                         │
│  ┌─────────────────────────┐                                          │
│  │   LinuxDataSource       │  ← 只在 Linux 环境创建                   │
│  └─────────────────────────┘                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 基本用法

```java
// 1. 定义条件类
public class WindowsCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return System.getProperty("os.name").contains("Windows");
    }
}

// 2. 使用条件
@Configuration
public class DataSourceConfig {
    @Bean
    @Conditional(WindowsCondition.class)
    public DataSource windowsDataSource() {
        return new WindowsDataSource();
    }

    @Bean
    @Conditional(LinuxCondition.class)
    public DataSource linuxDataSource() {
        return new LinuxDataSource();
    }
}
```

## Condition 接口详解

### ConditionContext

```java
public interface ConditionContext {
    // 获取 Bean 定义注册表
    BeanDefinitionRegistry getRegistry();
    
    // 获取 Bean 工厂
    ConfigurableListableBeanFactory getBeanFactory();
    
    // 获取环境配置
    Environment getEnvironment();
    
    // 获取资源加载器
    ResourceLoader getResourceLoader();
    
    // 获取类加载器
    ClassLoader getClassLoader();
}
```

### AnnotatedTypeMetadata

```java
public interface AnnotatedTypeMetadata {
    // 获取标注的注解信息
    Map&lt;String, Object&gt; getAnnotationAttributes(String annotationName);
    
    // 获取所有标注的注解类型
    Set&lt;String&gt; getAnnotationTypes(String annotationName);
    
    // 判断是否标注了某个注解
    boolean isAnnotated(String annotationName);
}
```

### 条件示例

```java
// 条件：根据环境变量
public class EnvCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String env = context.getEnvironment().getProperty("spring.profiles.active");
        return "dev".equals(env);
    }
}

// 条件：根据类是否存在
public class ClassExistsCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return ClassUtils.isPresent(
            "com.example.OptionalClass",
            context.getClassLoader()
        );
    }
}

// 条件：根据 Bean 是否存在
public class BeanNotExistsCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return !context.getRegistry().containsBeanDefinition("myBean");
    }
}

// 条件：根据配置文件属性
public class PropertyCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        String value = context.getEnvironment().getProperty("app.feature.enabled");
        return "true".equals(value);
    }
}
```

## @Conditional 在注解中的应用

### 组合条件注解

```java
// 定义组合注解
@Conditional({WindowsCondition.class, MemoryCondition.class})
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
public @interface OnWindowsWithEnoughMemory {
}

// 使用
@Configuration
public class Config {
    @Bean
    @OnWindowsWithEnoughMemory
    public MyService myService() {
        return new MyService();
    }
}
```

### 元注解传递

```java
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(DatabaseCondition.class)
public @interface ConditionalOnDatabase {
    String value();
}

@Configuration
public class Config {
    @Bean
    @ConditionalOnDatabase("mysql")
    public DataSource mysqlDataSource() { ... }
}
```

## Spring Boot 中的 @Conditional

Spring Boot 在 `spring-boot-autoconfigure` 中定义了大量条件注解：

### 常用条件注解

| 注解 | 说明 |
|-----|------|
| `@ConditionalOnBean` | 容器中存在指定 Bean 时创建 |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean 时创建 |
| `@ConditionalOnClass` | 类路径中存在指定类时创建 |
| `@ConditionalOnMissingClass` | 类路径中不存在指定类时创建 |
| `@ConditionalOnProperty` | 配置属性满足条件时创建 |
| `@ConditionalOnWebApplication` | 是 Web 应用时创建 |
| `@ConditionalOnNotWebApplication` | 非 Web 应用时创建 |
| `@ConditionalOnJava` | JDK 版本满足时创建 |
| `@ConditionalOnExpression` | SpEL 表达式为 true 时创建 |

### @ConditionalOnBean 和 @ConditionalOnMissingBean

```java
@Configuration
public class CacheConfig {

    // 只有容器中没有 CacheManager 时才创建
    @Bean
    @ConditionalOnMissingBean(CacheManager.class)
    public CacheManager defaultCacheManager() {
        return new ConcurrentMapCacheManager();
    }
}
```

```java
@Configuration
public class AutoConfiguration {

    // 只有容器中存在 RedisTemplate 时才创建 RedisCacheManager
    @Bean
    @ConditionalOnBean(RedisTemplate.class)
    public CacheManager redisCacheManager(RedisTemplate&lt;Object, Object&gt; redisTemplate) {
        RedisCacheManager cacheManager = new RedisCacheManager(redisTemplate);
        return cacheManager;
    }
}
```

### @ConditionalOnClass 和 @ConditionalOnMissingClass

```java
@Configuration
public class DataSourceAutoConfiguration {

    // 只有类路径中存在 DruidDataSource 类时才加载此配置
    @Configuration
    @ConditionalOnClass(DruidDataSource.class)
    public class DruidDataSourceConfiguration {
        
        @Bean
        @ConditionalOnProperty(name = "spring.datasource.type", havingValue = "druid")
        public DataSource druidDataSource() {
            return new DruidDataSource();
        }
    }
}
```

### @ConditionalOnProperty

```java
@Configuration
public class FeatureConfig {

    // 配置 app.feature.enabled=true 时才创建
    @Bean
    @ConditionalOnProperty(name = "app.feature.enabled", havingValue = "true")
    public FeatureService featureService() {
        return new FeatureService();
    }

    // 支持多个属性
    @Bean
    @ConditionalOnProperty(name = {"app.cache.enabled", "app.cache.redis"})
    public CacheService redisCacheService() {
        return new RedisCacheService();
    }

    // 配置不存在时也创建（matchIfMissing = true）
    @Bean
    @ConditionalOnProperty(
        name = "app.default.enabled",
        havingValue = "true",
        matchIfMissing = true
    )
    public DefaultService defaultService() {
        return new DefaultService();
    }
}
```

### @ConditionalOnWebApplication

```java
@Configuration
public class WebConfig {

    // 只有 Web 应用才创建
    @Bean
    @ConditionalOnWebApplication(type = Type.SERVLET)
    public ServletFilter servletFilter() {
        return new MyServletFilter();
    }

    // 只有响应式 Web 应用才创建
    @Bean
    @ConditionalOnWebApplication(type = Type.REACTIVE)
    public WebFilter reactiveFilter() {
        return new MyReactiveFilter();
    }

    // 任何 Web 应用都创建
    @Bean
    @ConditionalOnWebApplication
    public WebService webService() {
        return new WebService();
    }
}
```

### @ConditionalOnExpression

```java
@Configuration
public class ExpressionConfig {

    // SpEL 表达式为 true 时创建
    @Bean
    @ConditionalOnExpression("${app.debug:true} and '${app.env}'.equals('dev')")
    public DebugService debugService() {
        return new DebugService();
    }

    // 引用 Bean
    @Bean
    @ConditionalOnExpression("@myService.enabled")
    public ConditionalService conditionalService() {
        return new ConditionalService();
    }
}
```

## 自定义条件注解

### 定义组合注解

```java
// 条件：JDK 版本
@Target({ElementType.TYPE, ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Conditional(OnJavaCondition.class)
public @interface ConditionalOnJava {
    JavaVersion value();
    
    Range range() default Range.INCLUSIVE;
    
    enum Range {
        LESS_THAN,
        INCLUSIVE,
        EXCLUSIVE
    }
}

// 条件实现
public class OnJavaCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        AnnotationAttributes attributes = 
            AnnotatedTypeMetadata.class.cast(metadata)
                .getAnnotationAttributes(ConditionalOnJava.class.getName());
        
        JavaVersion version = (JavaVersion) attributes.get("value");
        Range range = (Range) attributes.get("range");
        
        JavaVersion currentVersion = JavaVersion.current();
        // 比较版本...
        return true;
    }
}

// 使用
@Configuration
@ConditionalOnJava(value = JavaVersion.ELEVEN, range = Range.INCLUSIVE)
public class Java11Config {
    @Bean
    public MyService myService() {
        return new MyService();
    }
}
```

### 完整示例：数据库自动配置

```java
// 自动配置类
@Configuration
@ConditionalOnClass(DataSource.class)
@ConditionalOnProperty(name = "spring.datasource.enabled", havingValue = "true", matchIfMissing = true)
public class DataSourceAutoConfiguration {

    @Configuration
    @ConditionalOnClass(JdbcTemplate.class)
    public class JdbcTemplateConfiguration {
        @Bean
        @ConditionalOnMissingBean(JdbcTemplate.class)
        public JdbcTemplate jdbcTemplate(DataSource dataSource) {
            return new JdbcTemplate(dataSource);
        }
    }

    @Configuration
    @ConditionalOnClass(PlatformTransactionManager.class)
    @ConditionalOnBean(DataSource.class)
    public class DataSourceTransactionManagerConfiguration {
        @Bean
        @ConditionalOnMissingBean(PlatformTransactionManager.class)
        public DataSourceTransactionManager transactionManager(DataSource dataSource) {
            return new DataSourceTransactionManager(dataSource);
        }
    }
}
```

## 条件执行顺序

### @Conditional 优先级

```java
@Configuration
public class Config {
    // 如果 MyCondition1 不满足，后续 @ConditionalOnBean 不会生效
    @Bean
    @Conditional({MyCondition1.class, MyCondition2.class})
    @ConditionalOnBean(DataSource.class)  // 需要前面的条件满足
    public MyService myService() {
        return new MyService();
    }
}
```

### @Order 和 Ordered

条件注解本身不影响 Bean 的加载顺序，但 Bean 的创建顺序受依赖关系影响。

## 常见问题

### 1. 条件不满足时 Bean 不创建

```java
@Bean
@Conditional(MyCondition.class)
public MyService myService() {
    return new MyService();
}
// 条件不满足时，这个 Bean 不会被创建，也不会报错
```

### 2. @ConditionalOnMissingBean 的坑

```java
@Configuration
public class Config {
    // 这个 Bean 如果被用户手动注册，defaultCacheManager 不会创建
    @Bean
    @ConditionalOnMissingBean(CacheManager.class)
    public CacheManager defaultCacheManager() {
        return new ConcurrentMapCacheManager();
    }
}
```

### 3. 条件与 @Primary

```java
@Configuration
public class Config {
    // 条件满足时创建，并且是 Primary
    @Bean
    @ConditionalOnProperty(name = "app.use.default-ds", havingValue = "true")
    @Primary
    public DataSource defaultDataSource() {
        return new HikariDataSource();
    }
}
```

## 面试核心问题

### Q1：@Conditional 的执行时机？

在 Bean 定义的解析阶段执行，决定是否将 Bean 注册到容器。

### Q2：Spring Boot 自动配置的核心原理？

1. `@EnableAutoConfiguration` 启用自动配置
2. `spring.factories` 或 `AutoConfiguration.imports` 声明配置类
3. 配置类使用 `@Conditional*` 注解，根据条件决定是否生效
4. `@AutoConfigureAfter`/`@AutoConfigureBefore` 控制加载顺序

### Q3：@ConditionalOnMissingBean 和 @Bean 的执行顺序？

先扫描 `@ComponentScan` 中的 Bean（包括 `@Bean`），再执行自动配置。自动配置中的 `@ConditionalOnMissingBean` 会检查已注册的 Bean。

---

**下节预告**：[@Import 详解](/framework/spring/import) —— 深入理解 ImportSelector 和 DeferredImportSelector，以及批量导入配置类的原理。
