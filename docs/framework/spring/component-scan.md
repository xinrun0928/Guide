# 组件扫描详解：@ComponentScan

你有没有想过：为什么在类上加个 `@Service` 或 `@Repository`，Spring 就能自动创建 Bean？

这背后的功臣，就是**组件扫描（Component Scanning）**。

## 组件扫描的整体流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 组件扫描流程                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  @ComponentScan 扫描包                                                  │
│         │                                                               │
│         ▼                                                               │
│  扫描指定包及其子包                                                      │
│         │                                                               │
│         ▼                                                               │
│  发现 @Component/@Service/@Repository/@Controller                      │
│         │                                                               │
│         ▼                                                               │
│  创建 BeanDefinition                                                    │
│         │                                                               │
│         ▼                                                               │
│  注册到 BeanFactory                                                    │
│         │                                                               │
│         ▼                                                               │
│  实例化和依赖注入                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## @ComponentScan 基础用法

### 默认扫描

```java
@Configuration
@ComponentScan  // 默认扫描当前包及其子包
public class AppConfig {
}
```

等价于：

```java
@Configuration
@ComponentScan(basePackages = "com.example")  // 显式指定包
public class AppConfig {
}
```

### 扫描多个包

```java
@Configuration
@ComponentScan(basePackages = {
    "com.example.service",
    "com.example.repository",
    "com.example.controller"
})
public class AppConfig {
}
```

### 扫描指定类所在包

```java
@Configuration
@ComponentScan(basePackageClasses = {UserService.class, OrderService.class})
public class AppConfig {
}
```

会扫描 `UserService` 和 `OrderService` 所在的包。

## @Component 注解家族

Spring 提供了一组注解，用于标注不同层次的组件：

```java
// @Repository - 数据访问层
@Repository
public class UserDaoImpl implements UserDao {
}

// @Service - 业务逻辑层
@Service
public class UserServiceImpl implements UserService {
}

// @Controller - Web 层（Spring MVC）
@Controller
public class UserController {
}

// @RestController - RESTful Web 层
@RestController
public class UserRestController {
}

// @Configuration - 配置类
@Configuration
public class AppConfig {
}

// @Component - 通用组件
@Component
public class MyComponent {
}
```

这些注解的本质都是 `@Component`：

```java
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Service {
    // 实际上就是 @Component
    String value() default "";
}
```

## 自定义组件扫描

### includeFilters 和 excludeFilters

```java
@Configuration
@ComponentScan(
    basePackages = "com.example",
    // 只扫描带有特定注解的类
    includeFilters = {
        @Filter(type = FilterType.ANNOTATION, classes = {MyComponent.class}),
        @Filter(type = FilterType.ASSIGNABLE_TYPE, classes = {MyInterface.class})
    },
    // 排除特定类
    excludeFilters = {
        @Filter(type = FilterType.ANNOTATION, classes = {Controller.class}),
        @Filter(type = FilterType.REGEX, pattern = ".*Test")
    }
)
public class AppConfig {
}
```

### FilterType 过滤器类型

| FilterType | 说明 | 示例 |
|-----------|------|------|
| ANNOTATION | 按注解过滤 | `@Filter(ANNOTATION, classes = Repository.class)` |
| ASSIGNABLE_TYPE | 按类型过滤 | `@Filter(ASSIGNABLE_TYPE, classes = BaseDao.class)` |
| ASPECTJ | 按 AspectJ 表达式 | `@Filter(ASPECTJ, pattern = "com.example..*Service")` |
| REGEX | 按正则表达式 | `@Filter(REGEX, pattern = ".*Impl")` |
| CUSTOM | 自定义过滤器 | `@Filter(CUSTOM, classes = MyFilter.class)` |

### 自定义过滤器

```java
public class MyComponentFilter implements TypeFilter {
    @Override
    public boolean match(MetadataReader metadataReader, 
                         MetadataReaderFactory metadataReaderFactory) throws IOException {
        ClassMetadata classMetadata = metadataReader.getClassMetadata();
        AnnotationMetadata annotationMetadata = metadataReader.getAnnotationMetadata();
        
        // 自定义逻辑：只扫描类名以 "My" 开头的类
        return classMetadata.getClassName().startsWith("com.example.My");
    }
}

@Configuration
@ComponentScan(
    basePackages = "com.example",
    includeFilters = @Filter(type = FilterType.CUSTOM, classes = MyComponentFilter.class)
)
public class AppConfig {
}
```

## 组件命名规则

### 默认命名

默认使用类名的首字母小写作为 Bean 名称：

```java
@Service
public class UserServiceImpl { ... }
// Bean 名称：userServiceImpl
```

### 自定义命名

```java
@Service("userService")  // 指定名称
public class UserServiceImpl implements UserService { ... }

// @Component 别名
@Component("myComponent")
public class MyComponent { ... }
```

### 使用 @Qualifier 引用

```java
@Service("userService")
public class UserServiceImpl implements UserService { ... }

@Service("adminUserService")
public class AdminUserServiceImpl implements UserService { ... }

@Service
public class OrderService {
    // 默认按类型注入
    // 如果有多个同类型 Bean，需要用 @Qualifier 指定
    @Autowired
    @Qualifier("userService")
    private UserService userService;
}
```

## 组件扫描与懒加载

### @Lazy 延迟初始化

```java
@Lazy  // 类级别延迟
@Service
public class HeavyService { ... }

@Configuration
@ComponentScan
public class AppConfig {
    @Bean
    @Lazy  // Bean 级别延迟
    public HeavyBean heavyBean() {
        return new HeavyBean();
    }
}
```

### 配置全局懒加载

```java
@Configuration
@ComponentScan
public class AppConfig {
    @Bean
    public BeanFactoryPostProcessor beanFactoryPostProcessor() {
        return beanFactory -&gt; {
            // 设置所有 Bean 延迟初始化
            ((DefaultListableBeanFactory) beanFactory)
                .setBeanDefinitionPredicate(new LazyInitPredicate());
        };
    }
}
```

Spring Boot 2.x 全局懒加载：

```yaml
spring:
  main:
    lazy-initialization: true
```

## @ComponentScan 与 @Bean 的区别

| 特性 | @ComponentScan | @Bean |
|-----|----------------|------|
| 适用场景 | 第三方类、无法修改的类 | 自定义类、需要复杂初始化 |
| 位置 | 类级别注解 | 方法级别注解 |
| 命名 | 自动推导 | 显式指定 |
| 依赖注入 | 自动扫描字段和方法 | 显式注入参数 |

### 什么时候用 @Bean？

```java
// 场景一：第三方库的类
@Configuration
public class ThirdPartyConfig {
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        return mapper;
    }
}

// 场景二：需要复杂初始化的配置
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource dataSource() {
        HikariConfig config = new HikariConfig();
        config.setMaximumPoolSize(10);
        config.setMinimumIdle(5);
        // ... 复杂配置
        return new HikariDataSource(config);
    }
}

// 场景三：@Bean 方法组合
@Configuration
public class CompositeConfig {
    @Bean
    public A a() {
        return new A(b());  // 依赖另一个 @Bean
    }

    @Bean
    public B b() {
        return new B();
    }
}
```

### 什么时候用 @ComponentScan？

```java
// 场景一：自定义的 @Service/@Repository/@Controller
@Service
public class MyService { ... }

// 场景二：需要被代理的 Bean（@Transactional 等）
@Service
@Transactional
public class TransactionalService { ... }

// 场景三：需要组件扫描才能生效的注解
@Component
@RequiredArgsConstructor
public class LombokService { ... }
```

## @ComponentScan 与 XML 配置

### XML 等价配置

```xml
&lt;context:component-scan base-package="com.example"&gt;
    &lt;!-- 包含的过滤器 --&gt;
    &lt;context:include-filter type="annotation" expression="com.example.MyComponent"/&gt;
    
    &lt;!-- 排除的过滤器 --&gt;
    &lt;context:exclude-filter type="assignable" expression="com.example.TestService"/&gt;
&lt;/context:component-scan&gt;
```

### 启用注解配置

```xml
&lt;context:annotation-config/&gt;
&lt;context:component-scan base-package="com.example"/&gt;
```

## 扫描多个配置类

```java
// 主配置
@Configuration
@ComponentScan(basePackages = "com.example")
@Import({DataSourceConfig.class, ServiceConfig.class})
public class AppConfig {
}

// 数据源配置
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource dataSource() { ... }
}

// 服务配置
@Configuration
public class ServiceConfig {
    @Bean
    public UserService userService() { ... }
}
```

## 常见问题

### 1. 为什么扫描不到 Bean？

```java
// 问题：配置类和被扫描的类不在同一个包或其子包中
// 解决：确保配置类在根包，或使用 basePackages 指定扫描范围

@Configuration
@ComponentScan(basePackages = "com.example")  // 扫描 com.example 包
public class AppConfig {
    // AppConfig 必须在 com.example 包或其子包中
    // 才能扫描到 com.example 下的所有组件
}

// 或者把 AppConfig 放在根包
package com.example;

@Configuration
@ComponentScan  // 扫描 com.example 包
public class AppConfig {
}
```

### 2. 多个配置类的 Bean 冲突？

```java
// 解决：使用 @Primary 或 @Qualifier

// 配置类 A
@Configuration
public class ConfigA {
    @Bean
    @Primary
    public MyService myService() {
        return new MyServiceA();
    }
}

// 配置类 B
@Configuration
public class ConfigB {
    @Bean
    public MyService myService() {
        return new MyServiceB();
    }
}
```

### 3. 扫描和 @Bean 同时存在？

```java
@Configuration
@ComponentScan(basePackages = "com.example")  // 扫描 @Service/@Repository 等
public class AppConfig {
    @Bean  // @Bean 也会被注册
    public ThirdPartyService thirdPartyService() {
        return new ThirdPartyService();
    }
}
```

## 面试核心问题

### Q1：@ComponentScan 默认扫描哪些包？

默认扫描 `@ComponentScan` 标注类所在的包及其子包。

### Q2：@Component 和 @Bean 的区别？

| 特性 | @Component | @Bean |
|-----|-----------|------|
| 适用对象 | 自定义类 | 任何类，尤其是第三方类 |
| 位置 | 类上 | 方法上 |
| 懒加载 | `@Lazy` | `@Lazy` |
| 作用域 | 类级别 | Bean 级别 |

### Q3：如何排除特定组件？

```java
@ComponentScan(excludeFilters = {
    @Filter(type = ANNOTATION, classes = Repository.class),
    @Filter(type = REGEX, pattern = ".*Test")
})
```

---

**下节预告**：[条件装配详解](/framework/spring/conditional) —— 深入理解 @Conditional 的底层实现和 Spring Boot 自动配置的原理。
