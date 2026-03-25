# Spring 配置类详解：@Configuration 与 @Bean

还记得 XML 配置时代吗？

```xml
&lt;bean id="userService" class="com.example.UserServiceImpl"&gt;
    &lt;property name="userDao" ref="userDao"/&gt;
    &lt;property name="cacheManager" ref="cacheManager"/&gt;
&lt;/bean&gt;
```

写了半天，还容易出错。

Spring 3.0 引入了 Java Config，用注解和代码代替 XML 配置。代码即配置，配置即代码。

今天，彻底搞懂 Spring 的 Java 配置。

## @Configuration 的本质

### 什么是配置类？

```java
@Configuration
public class AppConfig {
    // 这里定义 Bean
}
```

`@Configuration` 标注的类，就像 XML 里的 `<beans>` 标签。类里的 `@Bean` 方法，就像 XML 里的 `<bean>` 标签。

### 配置类的等价 XML

```java
@Configuration
public class AppConfig {

    @Bean
    public UserService userService() {
        UserServiceImpl service = new UserServiceImpl();
        service.setUserDao(userDao());  // 调用另一个 @Bean 方法
        return service;
    }

    @Bean
    public UserDao userDao() {
        return new UserDaoImpl();
    }
}
```

等价于：

```xml
&lt;beans&gt;
    &lt;bean id="userDao" class="com.example.UserDaoImpl"/&gt;
    &lt;bean id="userService" class="com.example.UserServiceImpl"&gt;
        &lt;property name="userDao" ref="userDao"/&gt;
    &lt;/bean&gt;
&lt;/beans&gt;
```

## @Bean 注解详解

### 基本用法

```java
@Configuration
public class DataSourceConfig {

    // 默认为方法名作为 Bean 名称
    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://localhost:3306/test");
        config.setUsername("root");
        config.setPassword("password");
        return new HikariDataSource(config);
    }

    // 指定 Bean 名称
    @Bean(name = "myDataSource")
    public DataSource dataSource() {
        // ...
    }

    // 多个名称
    @Bean(name = {"dataSource", "ds"})
    public DataSource dataSource() {
        // ...
    }
}
```

### @Bean 的属性

```java
@Configuration
public class ComplexConfig {

    @Bean(
        name = "customBean",        // Bean 名称
        initMethod = "init",        // 初始化方法
        destroyMethod = "cleanup"    // 销毁方法
    )
    public MyService myService() {
        return new MyServiceImpl();
    }
}
```

### Bean 依赖注入

```java
@Configuration
public class ServiceConfig {

    // 方式一：直接调用 @Bean 方法
    @Bean
    public UserService userService() {
        return new UserServiceImpl(userDao());  // 自动注入
    }

    @Bean
    public UserDao userDao() {
        return new UserDaoImpl();
    }

    // 方式二：作为方法参数注入
    @Bean
    public OrderService orderService(UserDao userDao) {
        // Spring 会自动注入 userDao
        return new OrderServiceImpl(userDao);
    }

    // 方式三：@Autowired 注入
    @Bean
    public PaymentService paymentService() {
        PaymentServiceImpl service = new PaymentServiceImpl();
        // 需要添加 @Autowired 才能注入
        return service;
    }
}
```

## 配置类进阶

### @Configuration 的 proxyBeanMethods

这是理解 Spring 配置类的关键。

```java
@Configuration(proxyBeanMethods = true)  // 默认值
public class AppConfig {
    @Bean
    public A a() {
        return new A(b());  // 每次调用 b()，返回的是同一个 Bean
    }

    @Bean
    public B b() {
        return new B();
    }
}
```

```java
@Configuration(proxyBeanMethods = false)
public class AppConfig {
    @Bean
    public A a() {
        return new A(b());  // 每次调用 b()，创建新的 B 实例！
    }

    @Bean
    public B b() {
        return new B();
    }
}
```

| 配置 | 作用 |
|-----|------|
| `proxyBeanMethods = true` | 确保多次调用 @Bean 方法返回同一个 Bean |
| `proxyBeanMethods = false` | 每次调用 @Bean 方法创建新实例（轻量级） |

**什么时候用 `proxyBeanMethods = false`？**

```java
// 性能优化场景：配置类只是用来注册 Bean，不涉及 Bean 间依赖检查
@Configuration(proxyBeanMethods = false)
public class MyLiteConfig {
    @Bean
    public MyService myService() {
        return new MyService();
    }
}
```

### @Scope 与 @Lazy

```java
@Configuration
public class ScopedConfig {

    // 单例（默认）
    @Bean
    public SingletonService singletonService() {
        return new SingletonService();
    }

    // 原型：每次获取创建新实例
    @Bean
    @Scope("prototype")
    public PrototypeService prototypeService() {
        return new PrototypeService();
    }

    // 延迟初始化：第一次使用时才创建
    @Bean
    @Lazy
    public LazyService lazyService() {
        return new LazyService();
    }
}
```

### @Primary 和 @Profile

```java
@Configuration
public class DataSourceConfig {

    // 默认使用这个
    @Bean
    @Primary
    public DataSource primaryDataSource() {
        return new HikariDataSource();
    }

    @Bean
    @Profile("dev")
    public DataSource devDataSource() {
        // 开发环境数据源
        return new HikariDataSource();
    }

    @Bean
    @Profile("prod")
    public DataSource prodDataSource() {
        // 生产环境数据源
        return new HikariDataSource();
    }
}
```

## 条件装配

### @Conditional

根据条件决定是否创建 Bean：

```java
@Configuration
public class ConditionalConfig {

    // 只有当类路径中存在某个类时才创建
    @Bean
    @Conditional(OnClassCondition.class)
    public MyService myService() {
        return new MyServiceImpl();
    }
}

// 自定义条件
public class OnClassCondition implements Condition {
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        return ClassUtils.isPresent(
            "com.example.OptionalClass", 
            context.getClassLoader()
        );
    }
}
```

Spring Boot 提供了很多内置的 `@Conditional` 变体：

```java
@Configuration
public class AutoConfig {

    // 只有存在某个配置属性时才创建
    @Bean
    @ConditionalOnProperty(name = "app.feature.enabled", havingValue = "true")
    public FeatureService featureService() {
        return new FeatureService();
    }

    // 只有类路径中存在某个类时才创建
    @Bean
    @ConditionalOnClass(RedisTemplate.class)
    public CacheService cacheService() {
        return new RedisCacheService();
    }

    // 只有类路径中不存在某个类时才创建
    @Bean
    @ConditionalOnMissingBean(CacheService.class)
    public CacheService defaultCacheService() {
        return new SimpleCacheService();
    }

    // 只有某个 Bean 不存在时才创建
    @Bean
    @ConditionalOnMissingBean
    public MyService defaultMyService() {
        return new DefaultMyService();
    }

    // 只有应用是 Web 应用时才创建
    @Bean
    @ConditionalOnWebApplication(type = Type.SERVLET)
    public WebService webService() {
        return new WebService();
    }
}
```

## 配置类组件依赖

### @Import 导入配置类

```java
// 方式一：导入普通类
@Configuration
@Import({DataSourceConfig.class, ServiceConfig.class})
public class AppConfig {
}

// 方式二：导入 @Configuration 类
// DataSourceConfig 和 ServiceConfig 也是 @Configuration 类
@Configuration
@Import(DataSourceConfig.class)
public class AppConfig {
}
```

### @Import 与 ImportSelector

```java
// 自定义选择器
public class MyImportSelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        // 根据条件动态决定导入哪些类
        Map&lt;String, Object&gt; attributes = 
            importingClassMetadata.getAnnotationAttributes(EnableMyFeature.class.getName());
        
        if (attributes != null) {
            boolean enabled = (boolean) attributes.get("enabled");
            if (enabled) {
                return new String[] {
                    "com.example.MyFeatureAutoConfiguration"
                };
            }
        }
        return new String[0];
    }
}

// 使用
@Configuration
@Import(MyImportSelector.class)
public @interface EnableMyFeature {
    boolean enabled() default true;
}
```

### @Import 与 DeferredImportSelector

延迟导入，在所有 @Configuration 处理完后执行：

```java
public class MyDeferredImportSelector implements DeferredImportSelector {
    @Override
    public Class&lt;? extends DeferredImportSelector.Group&gt; getImportGroup() {
        return MyDeferredImportGroup.class;
    }

    public static class MyDeferredImportGroup implements Group {
        private final List&lt;Entry&gt; entries = new ArrayList&lt;&gt;();

        @Override
        public void addImport(String importClassName) {
            entries.add(new Entry(getOrder(), importClassName));
        }

        @Override
        public Iterator&lt;Entry&gt; iterator() {
            return entries.iterator();
        }

        @Override
        public int getOrder() {
            return Ordered.LOWEST_PRECEDENCE;
        }
    }
}
```

## 配置类的加载时机

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 配置类加载时机                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. @ComponentScan 扫描到 @Configuration 类                             │
│         │                                                               │
│         ▼                                                               │
│  2. @Import 导入配置类                                                  │
│         │                                                               │
│         ▼                                                               │
│  3. @Configuration + @EnableXXX 导入                                     │
│         │                                                               │
│         ▼                                                               │
│  4. Spring Boot 的 META-INF/spring.factories                            │
│         │                                                               │
│         ▼                                                               │
│  5. Spring Boot 的 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 最佳实践

### 1. 配置类分层

```java
// 数据源层
@Configuration
public class DataSourceConfiguration {
    @Bean
    public DataSource dataSource() { ... }
}

// 服务层
@Configuration
public class ServiceConfiguration {
    @Bean
    public UserService userService(DataSource dataSource) { ... }
}

// Web 层
@Configuration
public class WebConfiguration {
    @Bean
    public WebMvcConfigurer webMvcConfigurer() { ... }
}
```

### 2. 配置属性绑定

```java
@Configuration
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private int maxSize;
    private List&lt;String&gt; allowedOrigins;

    // getter/setter
}

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class AppConfig {
    // AppProperties 会自动注册为 Bean
}
```

### 3. 配置类替换 XML

```java
// XML 配置
/*
&lt;beans&gt;
    &lt;context:property-placeholder location="classpath:app.properties"/&gt;
    &lt;bean id="dataSource" class="com.zaxxer.hikari.HikariDataSource"&gt;
        &lt;property name="url" value="${jdbc.url}"/&gt;
        &lt;property name="username" value="${jdbc.username}"/&gt;
    &lt;/bean&gt;
&lt;/beans&gt;
*/

// Java Config
@Configuration
@PropertySource("classpath:app.properties")
public class DataSourceConfig {
    @Value("${jdbc.url}")
    private String url;

    @Value("${jdbc.username}")
    private String username;

    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url);
        config.setUsername(username);
        return new HikariDataSource(config);
    }
}
```

## 面试核心问题

### Q1：@Configuration 和 @Component 的区别？

| 特性 | @Configuration | @Component |
|-----|----------------|------------|
| 用途 | 定义配置类 | 定义组件 |
| Bean 管理 | 所有 @Bean 方法会被代理 | 直接实例化 |
| @Bean 调用 | 多次调用返回同一 Bean | 每次调用创建新实例 |
| 性能 | 略有开销（代理） | 更轻量 |

### Q2：为什么 @Bean 方法调用要谨慎？

当 `proxyBeanMethods = true` 时，Spring 会创建代理对象，确保 `@Bean` 方法被调用时返回的是容器中的单例 Bean。

当 `proxyBeanMethods = false` 时，方法调用会创建新实例，可能导致非预期结果。

### Q3：@Import 的执行顺序？

`@Import` 的执行在 `@ComponentScan` 之前。这让你可以先导入配置类，再被扫描。

---

**下节预告**：[组件扫描详解](/framework/spring/component-scan) —— 深入理解 @ComponentScan 的扫描规则和过滤条件。
