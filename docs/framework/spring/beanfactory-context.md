# BeanFactory vs ApplicationContext

先问一个问题：你知道 Spring 启动的时候，输出的日志里有一句是什么吗？

```
[           main] o.s.i.C.AnnotationConfigApplicationContext : 
Starting SpringApplication...
```

注意到那个 `AnnotationConfigApplicationContext` 了吗？它不是 `BeanFactory`，而是 `ApplicationContext`。

那 `BeanFactory` 是什么？两者有什么区别？

## 一张图解释清楚

```
┌─────────────────────────────────────────────────────────────┐
│                        BeanFactory                          │
│              （Spring IoC 容器的根接口）                      │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                 最基础的功能：                        │   │
│   │  • getBean() - 获取 Bean                             │   │
│   │  • containsBean() - 是否包含某个 Bean                │   │
│   │  • getType() - 获取 Bean 类型                        │   │
│   │  • isSingleton() / isPrototype()                     │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承/扩展
                              │
┌─────────────────────────────────────────────────────────────┐
│                     ApplicationContext                       │
│                （功能增强版的容器）                          │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │  BeanFactory 的所有功能 +                            │   │
│   │                                                      │   │
│   │  • 国际化支持（MessageSource）                        │   │
│   │  • 事件传播机制（ApplicationEventPublisher）         │   │
│   │  • 资源加载（ResourceLoader）                        │   │
│   │  • 组件扫描（@ComponentScan）                        │   │
│   │  • 自动 BeanFactoryPostProcessor                    │   │
│   │  • 自动 BeanPostProcessor 注册                       │   │
│   │  • 懒加载 Bean 的预实例化                            │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 核心区别对比

| 特性 | BeanFactory | ApplicationContext |
|-----|-------------|-------------------|
| **加载时机** | 懒加载（使用时才创建 Bean） | 预加载（启动时创建所有单例 Bean） |
| **国际化** | 不支持 | 支持 `MessageSource` |
| **事件机制** | 不支持 | 支持 `ApplicationEvent` |
| **资源加载** | 需要手动实现 | 内置 `ResourceLoader` |
| **自动后置处理器** | 不会自动注册 | 自动注册 `BeanFactoryPostProcessor` |
| **自动后置处理器** | 不会自动注册 | 自动注册 `BeanPostProcessor` |
| **Web 应用** | 需要 XmlWebApplicationContext | 支持多种 Web 上下文 |
| **启动速度** | 快（按需加载） | 慢（预加载所有 Bean） |
| **内存占用** | 小（按需创建） | 大（一次性创建） |

## BeanFactory 的实现

`BeanFactory` 只是一个接口，真正干活的是它的实现类：

```java
// BeanFactory 接口定义
public interface BeanFactory {
    Object getBean(String name);
    &lt;T&gt; T getBean(Class&lt;T&gt; requiredType);
    &lt;T&gt; T getBean(String name, Class&lt;T&gt; requiredType);
    boolean containsBean(String name);
    boolean isSingleton(String name);
    boolean isPrototype(String name);
    Class&lt;? extends Object&gt; getType(String name);
    // ... 其他方法
}
```

### 常见的 BeanFactory 实现

```java
// 1. 最基本的实现，需要手动注册 Bean
XmlBeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));
UserService userService = factory.getBean(UserService.class);

// 2. 懒加载的 ListableBeanFactory
DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
// 手动注册 BeanDefinition
factory.registerBeanDefinition("userService", beanDefinition);
UserService userService = factory.getBean("userService", UserService.class);
```

## ApplicationContext 的实现

`ApplicationContext` 是 `BeanFactory` 的子接口，功能更强大：

```java
// ApplicationContext 继承关系
public interface ApplicationContext extends EnvironmentCapable, 
                                            ListableBeanFactory, 
                                            HierarchicalBeanFactory,
                                            MessageSource,
                                            ApplicationEventPublisher,
                                            ResourcePatternResolver {
    // ...
}
```

### 常见的 ApplicationContext 实现

```java
// 1. 注解配置上下文（最常用）
AnnotationConfigApplicationContext ctx = 
    new AnnotationConfigApplicationContext(AppConfig.class);
ctx.getBean(UserService.class);

// 2. XML 配置上下文
ClassPathXmlApplicationContext ctx = 
    new ClassPathXmlApplicationContext("beans.xml");

// 3. 组件扫描方式
AnnotationConfigApplicationContext ctx = 
    new AnnotationConfigApplicationContext();
ctx.scan("com.example");  // 扫描包
ctx.refresh();            // 刷新容器
ctx.getBean(UserService.class);

// 4. Web 应用上下文
AnnotationConfigServletWebServerApplicationContext  // Spring Boot
XmlServletConfigWebApplicationContext               // XML 配置的 Web 应用
```

## 关键区别：懒加载 vs 预加载

### BeanFactory 懒加载

```java
public class BeanFactoryTest {
    public static void main(String[] args) {
        // 此时不会创建任何 Bean
        XmlBeanFactory factory = new XmlBeanFactory(
            new ClassPathResource("beans.xml")
        );

        System.out.println("容器已创建，Bean 还没创建");

        // 只有调用 getBean() 时，才会真正创建 Bean
        UserService userService = factory.getBean(UserService.class);
        System.out.println("调用 getBean 后，Bean 才会创建");
    }
}
```

**日志输出**：
```
容器已创建，Bean 还没创建
调用 getBean 后，Bean 才会创建
```

### ApplicationContext 预加载

```java
public class ApplicationContextTest {
    public static void main(String[] args) {
        // 创建容器的瞬间，就会创建所有非懒加载的单例 Bean
        AnnotationConfigApplicationContext ctx = 
            new AnnotationConfigApplicationContext(AppConfig.class);

        System.out.println("容器已创建，所有单例 Bean 已就绪");
    }
}
```

**日志输出**：
```
# 容器创建时，会自动实例化所有单例 Bean
[           main] o.s.b.f.s.DefaultListableBeanFactory : 
Pre-instantiating singletons in BeanFactory ...
[           main] o.s.b.f.s.DefaultListableBeanFactory : 
Creating instance of bean 'userService'
[           main] o.s.b.f.s.DefaultListableBeanFactory : 
Creating instance of bean 'orderService'
容器已创建，所有单例 Bean 已就绪
```

## 国际化支持：BeanFactory 没有的能力

```java
// ApplicationContext 支持国际化
ApplicationContext ctx = new AnnotationConfigApplicationContext(AppConfig.class);

// 读取 messages_zh_CN.properties
String message = ctx.getMessage("user.notfound", new Object[]{"张三"}, Locale.CHINA);

// 读取 messages_en_US.properties
String messageEn = ctx.getMessage("user.notfound", new Object[]{"Zhang"}, Locale.US);
```

BeanFactory 想要国际化，必须自己实现 `MessageSource` 接口并手动注册。

## 事件机制：BeanFactory 没有的能力

```java
// 定义事件
public class OrderCreatedEvent extends ApplicationEvent {
    private final String orderId;
    public OrderCreatedEvent(Object source, String orderId) {
        super(source);
        this.orderId = orderId;
    }
}

// 发布事件
@Service
public class OrderService {
    @Autowired
    private ApplicationEventPublisher publisher;

    public void createOrder() {
        // 创建订单...
        publisher.publishEvent(new OrderCreatedEvent(this, "ORDER-001"));
    }
}

// 监听事件
@Component
public class OrderEventListener {
    @EventListener
    public void handleOrderCreated(OrderCreatedEvent event) {
        System.out.println("订单已创建：" + event.getOrderId());
        // 发送通知、更新缓存等
    }
}
```

BeanFactory 不支持这种事件机制。

## 自动 BeanFactoryPostProcessor 和 BeanPostProcessor

这是两者最容易被忽视的区别。

### BeanFactory 需要手动注册

```java
XmlBeanFactory factory = new XmlBeanFactory(new ClassPathResource("beans.xml"));

// 手动注册 BeanFactoryPostProcessor
PropertyPlaceholderConfigurer configurer = new PropertyPlaceholderConfigurer();
configurer.setLocation(new ClassPathResource("jdbc.properties"));
configurer.postProcessBeanFactory(factory);

// 手动注册 BeanPostProcessor
factory.addBeanPostProcessor(new MyBeanPostProcessor());
```

### ApplicationContext 自动处理

```java
AnnotationConfigApplicationContext ctx = 
    new AnnotationConfigApplicationContext(AppConfig.class);

// 以下处理器会自动注册并执行：
// 1. ConfigurationClassPostProcessor - 处理 @Configuration 类
// 2. AutowiredAnnotationBeanPostProcessor - 处理 @Autowired
// 3. RequiredAnnotationBeanPostProcessor - 处理 @Required
// 4. CommonAnnotationBeanPostProcessor - 处理 @PostConstruct, @PreDestroy
// 5. PropertyPlaceholderConfigurer - 处理 ${...} 占位符
```

## 什么场景用 BeanFactory？

虽然大多数场景用 ApplicationContext，但 BeanFactory 仍有用武之地：

### 场景一：资源受限环境

```java
// Android 或嵌入式系统，内存宝贵
// 使用 BeanFactory 懒加载，节省启动时的内存
BeanFactory factory = new XmlBeanFactory(resource);
```

### 场景二：需要细粒度控制

```java
DefaultListableBeanFactory factory = new DefaultListableBeanFactory();

// 手动注册，精确控制 Bean 的创建时机
factory.registerBeanDefinition("userService", 
    builderBeanDefinition(UserServiceImpl.class));

// 按需加载
if (needUserService) {
    UserService userService = factory.getBean(UserService.class);
}
```

### 场景三：动态修改 Bean 定义

```java
DefaultListableBeanFactory factory = new DefaultListableBeanFactory();
XmlBeanDefinitionReader reader = new XmlBeanDefinitionReader(factory);
reader.loadBeanDefinitions("beans.xml");

// 运行时可以修改 BeanDefinition
BeanDefinition bd = factory.getBeanDefinition("userService");
bd.setScope(BeanDefinition.SCOPE_PROTOTYPE);
```

## 什么场景用 ApplicationContext？

**几乎所有 Spring 应用都使用 ApplicationContext**，因为它提供了：

1. **完整的功能**：国际化、事件、资源加载
2. **开箱即用**：自动注册各种后置处理器
3. **更好的开发体验**：启动时就能发现配置错误
4. **Web 应用支持**：Spring MVC、Spring Boot 都基于它

## Spring Boot 中的 ApplicationContext

Spring Boot 自动配置了 `ApplicationContext`：

```java
// Spring Boot 内部创建的是 AnnotationConfigServletWebServerApplicationContext
// 它继承自 ApplicationContext
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

你可以通过 `ApplicationContext` 获取所有 Bean：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        ConfigurableApplicationContext ctx = SpringApplication.run(Application.class, args);

        // 获取所有 Bean 的名字
        String[] beanNames = ctx.getBeanDefinitionNames();
        Arrays.stream(beanNames).forEach(System.out::println);
    }
}
```

## 面试核心问题

### Q1：BeanFactory 和 ApplicationContext 的区别？

| 维度 | BeanFactory | ApplicationContext |
|-----|-------------|-------------------|
| 加载时机 | 懒加载 | 预加载 |
| 国际化和事件 | 不支持 | 支持 |
| 自动后置处理器 | 需要手动注册 | 自动注册 |
| 适用场景 | 资源受限、按需加载 | 绝大多数场景 |

### Q2：为什么 ApplicationContext 是启动时预加载？

预加载有两个目的：
1. **早发现问题**：配置错误在启动时就暴露，而不是运行到某个功能时才报错
2. **保证性能**：第一次请求时不需要等待 Bean 创建

### Q3：如何让 ApplicationContext 的单例 Bean 懒加载？

```java
// 方式一：@Lazy 注解
@Lazy
@Service
public class UserService {
    // 第一次使用时才创建
}

// 方式二：@Lazy 注入
@Autowired
@Lazy
private UserService userService;

// 方式三：配置全局懒加载
// application.yml
spring:
  main:
    lazy-initialization: true
```

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                      选择指南                               │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  绝大多数场景 → ApplicationContext                        │
│                                                            │
│  资源受限环境 → BeanFactory（XmlBeanFactory）              │
│                                                            │
│  需要细粒度控制 → DefaultListableBeanFactory               │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Spring Bean 生命周期全流程](/framework/spring/bean-lifecycle) —— 从 Bean 的实例化到销毁，Spring 在每个阶段做了什么？BeanPostProcessor 的回调时机？
