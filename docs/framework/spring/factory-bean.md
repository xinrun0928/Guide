# FactoryBean 与 @Bean 注解解析

面试官问你：「FactoryBean 和 BeanFactory 有什么区别？」

你可能会想：FactoryBean 是不是就是 BeanFactory？它们是不是同一个东西？

不，它们完全不是一回事。

## BeanFactory vs FactoryBean

这是两个完全不同的概念：

| 概念 | 作用 |
|-----|-----|
| **BeanFactory** | Spring IoC 容器的顶级接口，负责创建和管理 Bean |
| **FactoryBean** | 一种特殊的 Bean，用于创建复杂 Bean 或需要编程式创建的 Bean |

```
┌─────────────────────────────────────────────────────────────┐
│                      BeanFactory                            │
│         Spring IoC 容器的根接口                              │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  getBean()                                           │   │
│   │  containsBean()                                      │   │
│   │  createBean()                                        │   │
│   │  ...                                                 │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ 创建
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      FactoryBean                            │
│         一个特殊的 Bean，用来创建其他 Bean                    │
│                                                              │
│   public interface FactoryBean&lt;T&gt; {                         │
│       T getObject();  // 返回要创建的 Bean                   │
│       Class&lt;?&gt; getObjectType();  // 返回类型                 │
│       boolean isSingleton();  // 是否单例                    │
│   }                                                         │
└─────────────────────────────────────────────────────────────┘
```

## FactoryBean 的使用场景

### 场景一：创建复杂对象

有些对象的创建过程非常复杂，不适合用简单的构造函数：

```java
// 场景：创建一个 SqlSessionFactory
// 它需要 DataSource、mapper 路径、配置等
public class SqlSessionFactoryBean implements FactoryBean&lt;SqlSessionFactory&gt; {
    
    private DataSource dataSource;
    private String mapperLocations;
    private Configuration configuration;
    
    @Override
    public SqlSessionFactory getObject() throws Exception {
        SqlSessionFactoryBuilder builder = new SqlSessionFactoryBuilder();
        InputStream inputStream = getConfigInputStream();
        return builder.build(inputStream, getEnvironment());
    }
    
    @Override
    public Class&lt;SqlSessionFactory&gt; getObjectType() {
        return SqlSessionFactory.class;
    }
    
    @Override
    public boolean isSingleton() {
        return true;
    }
}
```

### 场景二：创建代理对象

```java
// 场景：创建一个动态代理
public class JdkProxyFactoryBean implements FactoryBean&lt;Object&gt; {
    
    private Object target;
    private Class&lt;?&gt;[] interfaces;
    
    @Override
    public Object getObject() throws Exception {
        return Proxy.newProxyInstance(
            getClass().getClassLoader(),
            interfaces,
            (proxy, method, args) -> {
                // 增强逻辑
                System.out.println("Before: " + method.getName());
                Object result = method.invoke(target, args);
                System.out.println("After: " + method.getName());
                return result;
            }
        );
    }
    
    @Override
    public Class&lt;?&gt; getObjectType() {
        return interfaces.length > 0 ? interfaces[0] : Object.class;
    }
    
    @Override
    public boolean isSingleton() {
        return true;
    }
}
```

### 场景三：创建泛型 Bean

```java
// 场景：根据泛型类型创建 Bean
public class GenericFactoryBean&lt;T&gt; implements FactoryBean&lt;T&gt; {
    
    private Class&lt;T&gt; type;
    
    public GenericFactoryBean(Class&lt;T&gt; type) {
        this.type = type;
    }
    
    @Override
    public T getObject() throws Exception {
        return type.getDeclaredConstructor().newInstance();
    }
    
    @Override
    public Class&lt;T&gt; getObjectType() {
        return type;
    }
    
    @Override
    public boolean isSingleton() {
        return false;
    }
}
```

## 如何获取 FactoryBean 本身

如果想获取 `FactoryBean` 本身，而不是它创建的 Bean，需要在 beanName 前加 `&`：

```java
@Autowired
private ApplicationContext context;

public void test() {
    // 获取 userService Bean（FactoryBean 创建的对象）
    Object bean = context.getBean("sqlSessionFactory");
    
    // 获取 SqlSessionFactoryBean 本身（FactoryBean）
    Object factory = context.getBean("&sqlSessionFactory");
}
```

## FactoryBean 在 Spring 源码中的应用

### 1. ProxyFactoryBean

Spring AOP 使用 `ProxyFactoryBean` 创建代理：

```java
// Spring AOP 内部实现
public class ProxyFactoryBean implements FactoryBean&lt;Object&gt;, TargetSource {
    
    private ProxyFactory proxyFactory;
    
    @Override
    public Object getObject() {
        // 根据配置创建 JDK 代理或 CGLIB 代理
        return proxyFactory.getProxy();
    }
}
```

### 2. ScheduledRegistrar

Spring Scheduling 使用 `ScheduledRegistrar` 注册定时任务：

```java
// Spring 内部使用 FactoryBean 来包装定时任务
public class ScheduledAnnotationBeanPostProcessor 
        implements BeanPostProcessor {
    
    // 它会处理 @Scheduled 注解的方法
    // 然后创建一个 FactoryBean 来封装
}
```

### 3. MapperFactoryBean（MyBatis）

MyBatis-Spring 使用 `MapperFactoryBean` 创建 Mapper 代理：

```java
// MyBatis-Spring 内部实现
public class MapperFactoryBean&lt;T&gt; extends SqlSessionDaoSupport 
        implements FactoryBean&lt;T&gt; {
    
    private Class&lt;T&gt; mapperInterface;
    
    @Override
    public T getObject() {
        // 使用 SqlSession 获取 Mapper 代理
        return getSqlSession().getMapper(mapperInterface);
    }
}
```

## @Bean 注解解析

`@Bean` 注解是如何被解析的？让我们看看 `ConfigurationClassPostProcessor` 的处理流程：

### @Bean 注解的定义

```java
@Target({ElementType.METHOD, ElementType.ANNOTATION_TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Bean {
    String[] name() default {};
    Class&lt;?&gt;[] destroyMethod() default AbstractBeanDefinition.INFER_METHOD;
    Autowire autowire() default Autowire.NO;
}
```

### 解析流程

`@Configuration` 类中的 `@Bean` 方法会被 `ConfigurationClassBeanDefinitionReader` 处理：

```java
// 在 ConfigurationClassBeanDefinitionReader 中
private void loadBeanDefinitionsForConfigurationClass(
        ConfigurationClass configClass, TrackedConditionEvaluationOutput trackedConditionEvaluator) {
    
    // 处理 @Bean 方法
    for (BeanMethod beanMethod : configClass.getBeanMethods()) {
        loadBeanDefinitionForBeanMethod(beanMethod);
    }
}

private void loadBeanDefinitionForBeanMethod(BeanMethod beanMethod) {
    // 1. 创建 BeanDefinition
    AbstractBeanDefinition bd = BeanDefinitionBuilder
        .genericBeanDefinition()
        .setFactoryMethodName(beanMethod.getMethod().getName())
        .setFactoryBeanName(beanMethod.getConfigurationClass().getBeanName())
        .getBeanDefinition();
    
    // 2. 设置属性（@Bean 方法的参数会自动作为依赖）
    // 3. 注册到容器
    this.readerContext.getRegistry().registerBeanDefinition(beanName, bd);
}
```

### @Bean 的执行时机

```java
@Configuration
public class AppConfig {
    
    @Bean
    public UserService userService() {
        // 这个方法在什么时候调用？
        return new UserServiceImpl();
    }
    
    @Bean
    public OrderService orderService() {
        // 这里的 userService() 是新创建的还是容器中的？
        return new OrderService(userService());
    }
}
```

**关键点**：
- `@Bean` 方法默认是**单例**的（Spring 5.1+）
- 调用 `@Bean` 方法时，如果参数是容器中的 Bean，会自动注入
- 可以使用 `proxyBeanMethods = false` 禁用代理，提高性能

### proxyBeanMethods 的影响

```java
@Configuration(proxyBeanMethods = true)  // 默认为 true
public class AppConfig {
    
    @Bean
    public UserService userService() {
        return new UserServiceImpl();
    }
    
    @Bean
    public OrderService orderService() {
        // proxyBeanMethods = true：调用代理方法，保证返回单例
        // proxyBeanMethods = false：直接调用方法，每次创建新实例
        return new OrderService(userService());
    }
}
```

## @Bean vs @Component

| 特性 | @Bean | @Component |
|-----|-----|-----------|
| 位置 | 配置类方法上 | 类上 |
| 灵活性 | 适合第三方库、复杂创建逻辑 | 适合自定义类 |
| 命名 | 默认方法名，可自定义 | 默认类名首字母小写 |
| 依赖注入 | 方法参数自动注入 | 字段/Settter 注入 |
| 条件控制 | 可配合 @Conditional | 可配合 @Conditional |
| 作用域 | 默认单例 | 默认单例，可配置 |

### 选择建议

```java
// 适合用 @Bean 的场景
@Configuration
public class ThirdPartyConfig {
    
    // 第三方库的类，没有源码，无法加 @Component
    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplateBuilder()
            .setConnectTimeout(Duration.ofSeconds(5))
            .build();
    }
    
    // 需要精确控制的 Bean
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return mapper;
    }
}

// 适合用 @Component 的场景
@Service  // 自定义业务类
public class UserServiceImpl implements UserService {
    // ...
}
```

## 面试核心问题

### Q1：FactoryBean 和 BeanFactory 的区别？

| 区别 | BeanFactory | FactoryBean |
|-----|------------|-------------|
| 本质 | Spring IoC 容器的接口 | 一种特殊的 Bean |
| 作用 | 创建和管理所有 Bean | 创建复杂 Bean |
| 典型方法 | `getBean()` | `getObject()` |

### Q2：如何获取 FactoryBean 本身？

使用 `&` 前缀：`context.getBean("&beanName")`

### Q3：@Bean 方法的参数是如何注入的？

`ConfigurationClassBeanDefinitionReader` 会分析 `@Bean` 方法的参数，从容器中查找匹配的 Bean 并自动注入。

### Q4：proxyBeanMethods 有什么作用？

当 `proxyBeanMethods = true`（默认）时，Spring 会为 `@Configuration` 类创建一个代理，确保 `@Bean` 方法返回单例。当 `false` 时，直接调用方法。

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    FactoryBean vs @Bean                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  FactoryBean：                                             │
│    → 一个接口，用于创建复杂 Bean                           │
│    → 需要实现 getObject()、getObjectType()、isSingleton()   │
│    → 获取本身用 & 前缀                                     │
│                                                            │
│  @Bean：                                                   │
│    → 注解，标注在配置类方法上                              │
│    → 用于注册 BeanDefinition                              │
│    → 方法参数自动注入依赖                                  │
│                                                            │
│  选择建议：                                                │
│    → 第三方库、复杂创建逻辑 → @Bean                        │
│    → 需要工厂模式、动态代理 → FactoryBean                  │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[依赖注入源码：setAutowiredField() 过程](/framework/spring/di-source) —— 从源码层面理解 @Autowired 是如何注入依赖的。
