# Spring Bean 生命周期全流程

你有没有想过这个问题：当你写了一个 `@Service` 类，Spring 到底是怎么把它变成一个可用的 Bean 的？

它要经历哪些阶段？每个阶段可以做什么？什么时候可以干预它的创建过程？

这些问题，都涉及到 Spring Bean 的**生命周期**。

## 生命周期的完整流程

Spring Bean 从创建到销毁，完整经历以下阶段：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Spring Bean 生命周期                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段一：BeanDefinition 合并                                       │  │
│  │   → 将父 BeanDefinition 和子 BeanDefinition 合并                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段二：Bean 实例化                                               │  │
│  │   → 构造函数实例化 或 工厂方法实例化                               │  │
│  │   → 此时只是对象诞生，属性还没注入                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段三：属性填充（依赖注入）                                       │  │
│  │   → @Autowired、@Value、@Resource 等注解处理                     │  │
│  │   → 设置普通属性、关联 Bean                                       │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段四：Bean 初始化                                                │  │
│  │   │                                                             │  │
│  │   ├── BeanPostProcessor.postProcessBeforeInitialization()      │  │
│  │   │                                                             │  │
│  │   ├── @PostConstruct 标注的方法                                  │  │
│  │   │                                                             │  │
│  │   ├── InitializingBean.afterPropertiesSet()                    │  │
│  │   │                                                             │  │
│  │   ├── 自定义 init-method                                        │  │
│  │   │                                                             │  │
│  │   └── BeanPostProcessor.postProcessAfterInitialization()       │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段五：Bean 就绪                                                  │  │
│  │   → Bean 已经可以被使用了                                         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段六：Bean 销毁                                                  │  │
│  │   │                                                             │  │
│  │   ├── @PreDestroy 标注的方法                                    │  │
│  │   │                                                             │  │
│  │   ├── DisposableBean.destroy()                                 │  │
│  │   │                                                             │  │
│  │   └── 自定义 destroy-method                                     │  │
│  │                                                             │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 各阶段详解

### 阶段一：BeanDefinition 合并

Spring 支持 Bean 的继承（child-bean 或 @Primary），在实例化之前需要合并：

```java
// XML 配置示例
<bean id="baseBean" class="com.example.BaseService" abstract="true">
    <property name="baseName" value="Base"/>
</bean>

<bean id="userService" parent="baseBean" class="com.example.UserService">
    <!-- 会继承 baseName 属性 -->
</bean>
```

### 阶段二：Bean 实例化

这一步只是调用构造函数创建对象，**属性还没有注入**：

```java
public class UserServiceImpl implements UserService {

    private UserDao userDao;  // 此时还是 null！

    public UserServiceImpl() {
        System.out.println("构造函数执行，UserDao 还是 null：" + userDao);
    }

    public void setUserDao(UserDao userDao) {
        System.out.println("设置 UserDao：" + userDao);
        this.userDao = userDao;
    }
}
```

### 阶段三：属性填充

属性填充就是依赖注入的过程：

```java
@Service
public class UserServiceImpl implements UserService {

    @Autowired
    private UserDao userDao;  // 容器自动注入

    @Value("${app.name}")
    private String appName;   // 注入配置值
}
```

### 阶段四：初始化

初始化阶段有多个回调点，按顺序执行：

```java
@Service
public class UserServiceImpl implements UserService, InitializingBean {

    private UserDao userDao;

    // 1. 属性注入后调用（通过 @Autowired 的 setter）
    @Autowired
    public void setUserDao(UserDao userDao) {
        this.userDao = userDao;
    }

    // 2. @PostConstruct - 初始化前的最后准备
    @PostConstruct
    public void init() {
        System.out.println("@PostConstruct: 初始化逻辑");
        // 比如：建立连接、预加载数据、验证配置
    }

    // 3. InitializingBean - 另一种初始化回调
    @Override
    public void afterPropertiesSet() throws Exception {
        System.out.println("InitializingBean.afterPropertiesSet: 验证依赖");
        // 比如：检查必要的依赖是否注入
        if (userDao == null) {
            throw new IllegalStateException("userDao must not be null");
        }
    }

    // 4. 自定义 init-method（通过 XML 的 init-method 或 @Bean(initMethod=...)）
    public void customInit() {
        System.out.println("custom init-method: 自定义初始化");
    }
}
```

### 阶段五：BeanPostProcessor 的回调

`BeanPostProcessor` 是 Spring 提供的扩展点，可以在初始化前后做额外处理：

```java
public class MyBeanPostProcessor implements BeanPostProcessor {

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        System.out.println("Before initialization: " + beanName);
        // 可以返回代理对象，替换原始对象
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        System.out.println("After initialization: " + beanName);
        return bean;
    }
}
```

### 阶段六：Bean 销毁

容器关闭时，会按顺序调用销毁方法：

```java
@Service
public class UserServiceImpl implements UserService, DisposableBean {

    private Connection connection;

    // 1. @PreDestroy - 销毁前的清理
    @PreDestroy
    public void cleanup() {
        System.out.println("@PreDestroy: 释放资源");
        if (connection != null) {
            connection.close();
        }
    }

    // 2. DisposableBean - 另一种销毁回调
    @Override
    public void destroy() throws Exception {
        System.out.println("DisposableBean.destroy: 清理逻辑");
    }

    // 3. 自定义 destroy-method
    public void customDestroy() {
        System.out.println("custom destroy-method: 自定义销毁");
    }
}
```

## 完整代码示例

创建一个完整的 Bean，展示所有生命周期阶段：

```java
@Component
@Scope("singleton")
public class UserServiceImpl implements UserService, 
                                      InitializingBean, 
                                      DisposableBean {

    private UserDao userDao;

    // ============ 构造阶段 ============
    public UserServiceImpl() {
        System.out.println("1. 构造函数执行");
    }

    // ============ 属性注入阶段 ============
    @Autowired
    public void setUserDao(UserDao userDao) {
        System.out.println("2. 属性注入: " + userDao);
        this.userDao = userDao;
    }

    // ============ 初始化阶段 ============
    @PostConstruct
    public void postConstruct() {
        System.out.println("3. @PostConstruct");
    }

    @Override
    public void afterPropertiesSet() throws Exception {
        System.out.println("4. InitializingBean.afterPropertiesSet");
    }

    // ============ 销毁阶段 ============
    @PreDestroy
    public void preDestroy() {
        System.out.println("5. @PreDestroy");
    }

    @Override
    public void destroy() throws Exception {
        System.out.println("6. DisposableBean.destroy");
    }
}
```

**启动容器时的输出**：

```
1. 构造函数执行
2. 属性注入: com.example.UserDaoImpl@1234abcd
3. @PostConstruct
4. InitializingBean.afterPropertiesSet
```

**关闭容器时的输出**：

```
5. @PreDestroy
6. DisposableBean.destroy
```

## BeanPostProcessor 的特殊时机

`BeanPostProcessor` 的 `postProcessBeforeInitialization` 和 `postProcessAfterInitialization` 会在**所有 Bean** 的初始化前后被调用：

```java
@Configuration
public class AppConfig {

    // 注册自定义 BeanPostProcessor
    @Bean
    public BeanPostProcessor myBeanPostProcessor() {
        return new MyBeanPostProcessor();
    }
}

public class MyBeanPostProcessor implements BeanPostProcessor {

    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        // 会在 userService、orderService、paymentService 等所有 Bean
        // 的 @PostConstruct 之前被调用
        return bean;
    }

    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        // 会在所有 Bean 的初始化方法之后被调用
        return bean;
    }
}
```

### 常见的内置 BeanPostProcessor

Spring 内置了很多 BeanPostProcessor：

| BeanPostProcessor | 作用 |
|-------------------|------|
| `AutowiredAnnotationBeanPostProcessor` | 处理 `@Autowired`、`@Value` 注入 |
| `CommonAnnotationBeanPostProcessor` | 处理 `@PostConstruct`、`@PreDestroy`、`@Resource` |
| `RequiredAnnotationBeanPostProcessor` | 处理 `@Required`（已过时）|
| `AnnotationAwareAspectJAutoProxyCreator` | 创建 AOP 代理 |
| `ApplicationContextAwareProcessor` | 注入 `ApplicationContext` 等aware 接口 |

## 初始化方法的执行顺序

当一个 Bean 同时实现了多种初始化机制时，顺序是：

```
BeanPostProcessor.postProcessBeforeInitialization
         │
         ▼
    @PostConstruct
         │
         ▼
    InitializingBean.afterPropertiesSet()
         │
         ▼
    自定义 init-method
         │
         ▼
BeanPostProcessor.postProcessAfterInitialization
```

**优先级**：`@PostConstruct` > `InitializingBean` > `init-method`

## 销毁方法的执行顺序

```
@PreDestroy
         │
         ▼
    DisposableBean.destroy()
         │
         ▼
    自定义 destroy-method
```

**优先级**：`@PreDestroy` > `DisposableBean` > `destroy-method`

## 面试核心问题

### Q1：Bean 的生命周期有哪些阶段？

完整阶段：
1. BeanDefinition 合并
2. 实例化（构造函数）
3. 属性填充（依赖注入）
4. 初始化（多个回调点）
5. Bean 就绪
6. 销毁

### Q2：@PostConstruct 和 @PreDestroy 在哪个阶段执行？

- `@PostConstruct` 在**初始化阶段**，属性注入之后、其他初始化回调之前
- `@PreDestroy` 在**销毁阶段**，最先执行

### Q3：InitializingBean 和 init-method 哪个先执行？

`InitializingBean.afterPropertiesSet()` 先于 `init-method` 执行。

### Q4：BeanPostProcessor 的作用是什么？

它是一个扩展点，会对**所有 Bean** 在初始化前后做统一处理。典型应用：
- `@Autowired` 注解的处理（`AutowiredAnnotationBeanPostProcessor`）
- AOP 代理的创建（`AnnotationAwareAspectJAutoProxyCreator`）

## 总结

Bean 的生命周期分为三大阶段：

| 阶段 | 核心操作 | 可干预方式 |
|-----|---------|-----------|
| **创建阶段** | 实例化 → 属性填充 | `BeanFactoryPostProcessor` 可修改 BeanDefinition |
| **初始化阶段** | 多个回调点 | `@PostConstruct`、`InitializingBean`、`init-method` |
| **销毁阶段** | 多个回调点 | `@PreDestroy`、`DisposableBean`、`destroy-method` |

理解生命周期，才能在合适的时机做正确的事。

---

**下节预告**：[Spring Bean 作用域：singleton、prototype、request、session](/framework/spring/bean-scope) —— 理解不同作用域下 Bean 的创建时机和内存管理策略。
