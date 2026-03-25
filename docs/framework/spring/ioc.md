# Spring IoC 容器：控制反转与依赖注入

先问一个问题：**你的代码里，`new` 关键字出现了多少次？**

如果答案是「很多」，那么恭喜你，你正在经历 Spring 想要解决的核心问题。

## 一个「耦合地狱」的故事

假设你在写一个订单服务：

```java
@Service
public class OrderService {
    // 「我需要一个用户服务」
    private UserService userService = new UserServiceImpl();

    // 「我需要一个支付服务」
    private PaymentService paymentService = new AlipayServiceImpl();

    // 「我需要一个库存服务」
    private InventoryService inventoryService = new RedisInventoryService();
}
```

看起来很正常？但问题来了：

1. `UserServiceImpl` 构造函数变了？改 `OrderService`
2. 想把 `AlipayServiceImpl` 换成 `WechatPayServiceImpl`？改 `OrderService`
3. `UserServiceImpl` 依赖了 `CacheService`？改 `OrderService`

**一个订单服务的代码，要跟着所有依赖的服务一起变。** 这就是强耦合的代价。

## 控制反转：谁应该对「创建」负责？

> 传统方式：我创建我需要的
>
> ```java
> A a = new A();  // 我来 new
> B b = new B();  // 我来 new
> ```
>
> IoC 方式：别人创建，我只要用
>
> ```java
> @Autowired
> A a;  // 容器给我
>
> @Autowired
> B b;  // 容器给我
> ```

控制反转（Inversion of Control，IoC）是一种设计原则，它把**对象创建和依赖管理的控制权**，从应用程序代码转移到了框架或容器。

### IoC 不是新技术，而是设计思想

IoC 是一种思想，具体实现方式有多种：

| 实现方式 | 代表框架/技术 |
|---------|-------------|
| **依赖注入（DI）** | Spring、Guice、Dagger |
| **依赖查找（DL）** | JNDI、EJB |
| **模板方法模式** | JdbcTemplate、HibernateTemplate |
| **策略模式** | Servlet API |

Spring 选择的是**依赖注入（DI）**这种方式。

## 依赖注入：让容器来「装配」对象

依赖注入的核心思想是：**不是你自己去找依赖，而是让容器把依赖「塞」给你。**

### 构造器注入

```java
@Service
public class OrderService {
    private final UserService userService;
    private final PaymentService paymentService;

    // 依赖由容器通过构造器注入
    public OrderService(UserService userService, PaymentService paymentService) {
        this.userService = userService;
        this.paymentService = paymentService;
    }
}
```

**优点**：
- 依赖不可变（final）
- 强制要求依赖必须存在，测试友好
- 完全不支持循环依赖（能在编译期发现问题）

**缺点**：
- 构造器参数太多时，代码不美观

### Setter 注入

```java
@Service
public class OrderService {
    private UserService userService;

    // setter 方法，容器会调用它注入依赖
    @Autowired
    public void setUserService(UserService userService) {
        this.userService = userService;
    }
}
```

**优点**：
- 可选依赖（setter 可以不调用）
- 便于单元测试手动注入 mock 对象

**缺点**：
- 依赖可以在运行时变为 null
- 不如构造器注入那样明确

### 字段注入

```java
@Service
public class OrderService {
    // 直接在字段上标注
    @Autowired
    private UserService userService;
}
```

**不推荐使用**，原因：
- 违反了单一职责原则（类既负责业务逻辑，又负责依赖获取）
- 难以单元测试（无法直接构造对象）
- 无法声明不可变依赖

## IoC 容器做了什么？

用一个生活例子来类比：

> 假设你要组装一台电脑。
>
> **传统方式**：你自己去电脑城买 CPU、显卡、内存，然后自己组装。问题是：你得知道各个零件的型号、兼容性……
>
> **IoC 方式**：你告诉电脑店「我要一台电脑」，店里帮你选好零件、组装好，你直接拿走去用。

Spring IoC 容器就是那个「电脑店」，它负责：

1. **扫描和注册**：哪些类需要容器管理？（`@Service`、`@Component` 等注解）
2. **创建对象**：什么时候创建？创建几个？
3. **解决依赖**：A 依赖 B，B 依赖 C，容器帮你串起来
4. **生命周期管理**：创建后做初始化，销毁前做清理

## Bean 的定义与注册

Spring 用 `BeanDefinition` 来描述一个 Bean：

```java
public class OrderService {
    // Bean 的类型
    private String name = "orderService";

    // Bean 的作用域（单例还是原型）
    private String scope = "singleton";

    // Bean 依赖的其他 Bean
    private String[] dependsOn = {"userService", "paymentService"};

    // 懒加载？
    private boolean lazyInit = false;
}
```

注册 Bean 的几种方式：

### 1. XML 配置（古老方式）

```xml
<bean id="orderService" class="com.example.OrderService">
    <property name="userService" ref="userService"/>
</bean>
```

### 2. 注解方式（主流方式）

```java
@Service  // 注册为 Bean
public class OrderService {
    @Autowired  // 自动注入依赖
    private UserService userService;
}
```

### 3. Java 配置类方式

```java
@Configuration
public class AppConfig {
    @Bean
    public UserService userService() {
        return new UserServiceImpl();
    }

    @Bean
    public OrderService orderService() {
        // 手动指定依赖关系
        return new OrderService(userService());
    }
}
```

## 注入的完整流程

当 Spring 启动时，一次依赖注入的完整流程是这样的：

```
┌─────────────────────────────────────────────────────────────────┐
│                    Spring IoC 容器启动流程                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. 容器启动                                                   │
│     │                                                           │
│     ▼                                                           │
│  2. 扫描并注册 BeanDefinition                                   │
│     │  → @ComponentScan 扫描包                                  │
│     │  → @Bean 解析配置类                                        │
│     │  → 解析 XML &lt;bean&gt; 配置（如果有）                              │
│     │                                                           │
│     ▼                                                           │
│  3. BeanFactoryPostProcessor 处理                                │
│     │  → 修改 BeanDefinition（如属性占位符替换）                  │
│     │                                                           │
│     ▼                                                           │
│  4. 实例化 Bean                                                 │
│     │  → 循环遍历 BeanDefinition，按照依赖顺序创建                │
│     │                                                           │
│     ▼                                                           │
│  5. 属性填充（依赖注入）                                         │
│     │  → @Autowired / @Inject / @Resource                       │
│     │  → 构造器注入                                              │
│     │                                                           │
│     ▼                                                           │
│  6. 初始化                                                      │
│     │  → BeanPostProcessor.postProcessBeforeInitialization     │
│     │  → @PostConstruct                                          │
│     │  → InitializingBean.afterPropertiesSet()                  │
│     │  → BeanPostProcessor.postProcessAfterInitialization       │
│     │                                                           │
│     ▼                                                           │
│  7. Bean 就绪                                                  │
│     │                                                           │
└─────────────────────────────────────────────────────────────────┘
```

## 面试核心问题

### Q1：IoC 和 DI 是什么关系？

**IoC 是一种设计思想，DI 是 IoC 的一种具体实现。**

IoC 强调的是「控制权的转移」——对象不再自己创建依赖，而是把控制权交给外部。

DI 是实现 IoC 的具体方式——外部容器通过构造器、setter 或字段，把依赖「注入」进来。

### Q2：IoC 容器有什么好处？

1. **松耦合**：对象不需要知道依赖的具体实现
2. **易于测试**：可以轻松注入 mock 对象
3. **易于扩展**：换实现类不需要改业务代码
4. **单例管理**：容器统一管理 Bean 的生命周期

### Q3：BeanFactory 和 FactoryBean 有什么区别？

| 概念 | 作用 |
|-----|-----|
| **BeanFactory** | IoC 容器的顶级接口，负责创建和管理 Bean |
| **FactoryBean** | 一种特殊的 Bean，用于创建复杂 Bean 或需要编程式创建的 Bean |

```java
// BeanFactory 是「工厂」本身
ConfigurableBeanFactory factory = ...;

// FactoryBean 是「工厂里生产的某个产品」
// SqlSessionFactoryBean 用于创建 SqlSessionFactory
@Bean
public SqlSessionFactory sqlSessionFactory() {
    SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
    factoryBean.setDataSource(dataSource());
    return factoryBean.getObject();
}
```

## 总结

IoC（控制反转）和 DI（依赖注入）是 Spring 最核心的概念：

- **IoC** 是一种思想：把对象创建和依赖管理的控制权交给容器
- **DI** 是实现方式：容器通过构造器、setter 或字段把依赖注入进来
- **好处**：松耦合、易测试、易扩展

---

**下节预告**：[BeanFactory vs ApplicationContext](/framework/spring/beanfactory-context) —— 深入理解 Spring 的两种容器，了解为什么大多数场景下我们使用的是 ApplicationContext。
