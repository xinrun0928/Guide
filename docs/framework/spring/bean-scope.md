# Spring Bean 作用域：singleton、prototype、request、session

你知道吗？Spring 默认创建的 Bean 是**单例**的。

这意味着：无论你 `getBean()` 多少次，Spring 返回的都是同一个对象。

这和我们平时的认知有点不一样——我们习惯性地认为「每次用 `new` 创建对象」，但 Spring 改变了这个规则。

## 六种作用域一览

Spring Framework 定义了六种作用域：

| 作用域 | 说明 | 适用环境 |
|-------|-----|---------|
| **singleton** | 每个容器只有一个实例（默认） | 普通 Bean |
| **prototype** | 每次请求创建一个新实例 | 有状态的 Bean |
| **request** | 每个 HTTP 请求创建一个新实例 | Web 应用 |
| **session** | 每个 HTTP Session 创建一个新实例 | Web 应用 |
| **application** | 每个 ServletContext 创建一个新实例 | Web 应用 |
| **websocket** | 每个 WebSocket 创建一个新实例 | WebSocket 应用 |

## singleton vs prototype：核心区别

### singleton（单例）

```java
@Service
public class UserService {
    // 这个 Bean 在整个容器中只有一个实例
}

public class Main {
    public static void main(String[] args) {
        AnnotationConfigApplicationContext ctx = 
            new AnnotationConfigApplicationContext(AppConfig.class);

        // 两次获取，返回同一个对象
        UserService s1 = ctx.getBean(UserService.class);
        UserService s2 = ctx.getBean(UserService.class);

        System.out.println(s1 == s2);  // true
    }
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                    Singleton 作用域                          │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Spring IoC Container                   │   │
│   │                                                     │   │
│   │         ┌──────────────────────┐                   │   │
│   │         │   UserService        │                   │   │
│   │         │   (单例对象)          │                   │   │
│   │         └──────────┬───────────┘                   │   │
│   │                    │                               │   │
│   │         ┌──────────┴───────────┐                   │   │
│   │         ▼          ▼           ▼                   │   │
│   │        getBean()  getBean()  getBean()             │   │
│   │          │          │           │                  │   │
│   │          ▼          ▼           ▼                  │   │
│   │         [s1]       [s1]        [s1]  ← 同一个对象    │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### prototype（原型）

```java
@Service
@Scope("prototype")
public class OrderService {
    // 每次请求都创建新实例
}

public class Main {
    public static void main(String[] args) {
        AnnotationConfigApplicationContext ctx = 
            new AnnotationConfigApplicationContext(AppConfig.class);

        // 每次获取，都是新对象
        OrderService o1 = ctx.getBean(OrderService.class);
        OrderService o2 = ctx.getBean(OrderService.class);

        System.out.println(o1 == o2);  // false
    }
}
```

```
┌─────────────────────────────────────────────────────────────┐
│                   Prototype 作用域                          │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │              Spring IoC Container                   │   │
│   │                                                     │   │
│   │    getBean() → ┌────────────────────┐              │   │
│   │    getBean() → │  OrderService #1  │              │   │
│   │    getBean() → └────────────────────┘              │   │
│   │                    │                               │   │
│   │         ┌──────────┴───────────┐                   │   │
│   │         ▼          ▼           ▼                   │   │
│   │       [o1]        [o2]        [o3]  ← 不同对象     │   │
│   │                                                     │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 为什么默认是 singleton？

### 优点：性能与资源

1. **减少对象创建开销**：只创建一次，多次使用
2. **减少内存占用**：一个对象 vs N 个对象
3. **缓存命中率高**：常用对象驻留在内存中

### 缺点：线程安全问题

```java
@Service
public class UserService {
    // 单例模式下，所有线程共享这个变量
    private int count = 0;

    public void addCount() {
        count++;  // 线程不安全！
    }
}
```

**解决方案**：
- 把变量变成局部变量
- 使用 `ThreadLocal` 存储线程本地数据
- 改成 `prototype` 作用域（但会有性能开销）

### 适用场景

| 作用域 | 适用场景 | 不适用场景 |
|-------|---------|-----------|
| **singleton** | 无状态的 Bean（Service、Repository、Controller）| 有状态、需要保持独立性的对象 |
| **prototype** | 有状态的 Bean、需要独立状态的场景 | 高并发场景（创建开销大）|

## request 作用域

每个 HTTP 请求创建一个新实例，请求结束后销毁。

```java
@Controller
@RequestScope  // 等价于 @Scope("request")
public class UserController {

    // 每个请求都有独立的 requestId
    private String requestId = UUID.randomUUID().toString();

    @GetMapping("/test")
    public String test() {
        System.out.println("Request ID: " + requestId);
        return requestId;
    }
}
```

**使用场景**：
- 需要追踪请求日志
- 每个请求有独立的上下文
- 防止请求间的数据污染

### 在单例 Bean 中注入 request Bean

单例 Bean 中无法直接注入 request 作用域的 Bean（因为 request Bean 在请求时才创建）。

解决方案：使用 `ObjectFactory` 或 `Provider`：

```java
@Service
public class SingletonService {

    // 方式一：ObjectFactory
    @Autowired
    private ObjectFactory&lt;RequestScopeBean&gt; requestScopeBeanFactory;

    public void doSomething() {
        // 每次调用都获取当前请求的 Bean
        RequestScopeBean bean = requestScopeBeanFactory.getObject();
        bean.doRequestWork();
    }

    // 方式二：@Autowired + Provider&lt;T&gt;
    @Autowired
    private Provider&lt;RequestScopeBean&gt; requestScopeBeanProvider;

    public void doSomething2() {
        RequestScopeBean bean = requestScopeBeanProvider.get();
        bean.doRequestWork();
    }
}
```

## session 作用域

每个 HTTP Session 创建一个新实例。

```java
@Controller
@SessionScope  // 等价于 @Scope("session")
public class UserSessionController {

    // 每个 session 都有独立的购物车
    private List&lt;Product&gt; cart = new ArrayList&lt;&gt;();

    public void addToCart(Product product) {
        cart.add(product);
    }

    public List&lt;Product&gt; getCart() {
        return cart;
    }
}
```

**使用场景**：
- 用户登录信息
- 购物车数据
- 用户偏好设置

## application 作用域

每个 ServletContext（整个 Web 应用）创建一个实例。

```java
@Component
@ApplicationScope  // 等价于 @Scope("application")
public class AppStatistics {
    // 整个应用共享一份统计数据
    private AtomicLong requestCount = new AtomicLong(0);

    public void incrementRequestCount() {
        requestCount.incrementAndGet();
    }

    public long getRequestCount() {
        return requestCount.get();
    }
}
```

**注意**：
- `application` 作用域不等同于单例
- 单例（singleton）是**每个 Spring 容器**一个实例
- application 是**每个 ServletContext** 一个实例
- 如果部署了多个 Spring Boot 应用，每个应用都有独立的实例

## 作用域与依赖注入

### 单例注入原型（Singleton → Prototype）

这是最常见的需求：**单例 Bean 需要每次调用时获得新的对象**。

错误方式：

```java
@Service
public class BadService {
    // 这样只会注入一次，之后不会变
    @Autowired
    private PrototypeBean prototypeBean;
}
```

正确方式：

```java
@Service
public class GoodService {

    // 方式一：ObjectFactory
    @Autowired
    private ObjectFactory&lt;PrototypeBean&gt; prototypeBeanFactory;

    public void doWork() {
        // 每次调用 getObject() 都返回新实例
        PrototypeBean bean = prototypeBeanFactory.getObject();
        bean.work();
    }

    // 方式二：@Lookup（Spring 内置方法注入）
    @Autowired
    private ApplicationContext context;

    // 方式三：@Scope + proxyMode
    @Bean
    @Scope(value = "prototype", proxyMode = ScopedProxyMode.TARGET_CLASS)
    public PrototypeBean prototypeBean() {
        return new PrototypeBean();
    }
}
```

### 原型注入单例（Prototype → Singleton）

原型 Bean 注入单例 Bean 是安全的，单例 Bean 的引用在原型 Bean 中始终有效。

## 作用域与生命周期

| 作用域 | 实例化时机 | 销毁时机 | 容器关闭时 |
|-------|----------|--------|----------|
| **singleton** | 容器启动时 | 容器关闭时 | 统一销毁 |
| **prototype** | `getBean()` 时 | GC 回收 | **不销毁**，由用户负责 |
| **request** | HTTP 请求时 | 请求结束时 | 不销毁 |
| **session** | Session 创建时 | Session 过期/销毁 | 不销毁 |

**重要**：prototype 作用域的 Bean，**容器不会管理其生命周期**。

```java
@Service
@Scope("prototype")
public class PrototypeBean {
    private Resource resource;

    @PostConstruct
    public void init() {
        // 这个方法会被调用
        resource = loadResource();
    }

    @PreDestroy
    public void destroy() {
        // ❌ 这个方法永远不会被调用！
        // prototype Bean 销毁需要用户手动处理
        resource.close();
    }
}
```

## 自定义作用域

如果内置作用域不满足需求，可以实现 `Scope` 接口自定义：

```java
public class ThreadLocalScope implements Scope {
    private final ThreadLocal&lt;Map&lt;String, Object&gt;&gt; threadLocal = ThreadLocal.withInitial(HashMap::new);

    @Override
    public Object get(String name, ObjectFactory&lt;?&gt; objectFactory) {
        Map&lt;String, Object&gt; scope = threadLocal.get();
        Object instance = scope.get(name);
        if (instance == null) {
            instance = objectFactory.getObject();
            scope.put(name, instance);
        }
        return instance;
    }

    @Override
    public Object remove(String name) {
        return threadLocal.get().remove(name);
    }

    @Override
    public void registerDestructionCallback(String name, Runnable callback) {
        // 注册销毁回调
    }

    @Override
    public Object resolveContextualObject(String key) {
        return null;
    }

    @Override
    public String getConversationId() {
        return null;
    }
}

// 注册自定义作用域
@Bean
public BeanFactoryPostProcessor scopeConfigurer() {
    return beanFactory -> {
        ((ConfigurableListableBeanFactory) beanFactory)
            .registerScope("thread-local", new ThreadLocalScope());
    };
}
```

## 面试核心问题

### Q1：Spring 默认的作用域是什么？

`singleton`。这是 Spring 默认的 Bean 作用域。

### Q2：prototype 作用域的 Bean 会自动销毁吗？

**不会**。prototype 作用域的 Bean，容器只负责创建，不负责销毁。需要在使用完毕后由用户手动释放资源。

### Q3：singleton Bean 中如何注入 prototype Bean？

使用 `ObjectFactory< T >`、`Provider< T >` 或 `@Lookup` 方法注入。

### Q4：request、session、application 作用域只能用 Web 环境吗？

是的。这三个作用域是 Spring Web 提供的，需要 `RequestContextListener` 或 `RequestContextFilter` 支持。

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                      作用域选择指南                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  singleton    → 无状态 Bean，默认选择                      │
│  prototype    → 有状态 Bean、需要独立实例                   │
│  request      → Web 请求级别，需要隔离                      │
│  session      → 用户会话级别，如购物车、登录信息            │
│  application  → 全应用共享，如统计数据                      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Bean 循环依赖：三级缓存与解决过程](/framework/spring/circular-dependency) —— 当 A 依赖 B、B 依赖 A 时，Spring 是如何破局的？
