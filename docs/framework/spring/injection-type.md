# 构造器注入 vs Setter 注入 vs 字段注入

面试官问你：「Spring 支持哪几种依赖注入方式？」

你可能会回答：「构造器注入、Setter 注入、字段注入。」

然后面试官追问：「那你平时用哪种？为什么？」

如果你只知道「哪种都行，看情况」，那这篇文章就是为你准备的。

## 三种注入方式一览

```java
@Service
public class UserServiceImpl implements UserService {

    // ============ 方式一：构造器注入 ============
    private final UserDao userDao;
    private final OrderDao orderDao;

    public UserServiceImpl(UserDao userDao, OrderDao orderDao) {
        this.userDao = userDao;
        this.orderDao = orderDao;
    }

    // ============ 方式二：Setter 注入 ============
    private CacheService cacheService;

    @Autowired
    public void setCacheService(CacheService cacheService) {
        this.cacheService = cacheService;
    }

    // ============ 方式三：字段注入 ============
    @Autowired
    private LogService logService;
}
```

## 构造器注入（Constructor Injection）

### 标准写法

```java
@Service
public class OrderService {
    private final UserService userService;
    private final PaymentService paymentService;
    private final NotificationService notificationService;

    // Spring 会自动注入这些依赖
    public OrderService(
            UserService userService,
            PaymentService paymentService,
            NotificationService notificationService) {
        this.userService = userService;
        this.paymentService = paymentService;
        this.paymentService = paymentService;
        this.notificationService = notificationService;
    }
}
```

### 优点

#### 1. 依赖不可变

```java
@Service
public class OrderService {
    private final UserService userService;  // final，保证不可变

    public OrderService(UserService userService) {
        this.userService = userService;  // 只能在构造时赋值一次
    }
}
```

`final` 字段保证了依赖一旦注入就不能再改变，这是**防御性编程**的体现。

#### 2. 强制要求依赖存在

```java
@Service
public class OrderService {
    private final UserService userService;

    public OrderService(UserService userService) {
        if (userService == null) {
            throw new IllegalArgumentException("userService must not be null");
        }
        this.userService = userService;
    }
}
```

构造器注入让**必选依赖**和**可选依赖**一目了然：
- 必选依赖：放在构造器参数中
- 可选依赖：使用 setter 或字段注入

#### 3. 在构造器中完成初始化逻辑

```java
@Service
public class UserService {
    private final UserDao userDao;
    private final String appName;

    public UserService(UserDao userDao, @Value("${app.name}") String appName) {
        this.userDao = userDao;
        this.appName = appName;
        
        // 可以在这里做初始化验证
        validateConfig(appName);
    }

    private void validateConfig(String appName) {
        if (appName == null || appName.isBlank()) {
            throw new IllegalStateException("app.name must be configured");
        }
    }
}
```

#### 4. 测试友好

```java
// 测试时，直接传入 mock 对象
@Test
public void testOrderCreation() {
    UserDao mockUserDao = mock(UserDao.class);
    PaymentService mockPayment = mock(PaymentService.class);
    
    OrderService orderService = new OrderService(mockUserDao, mockPayment);
    // 直接使用，不需要 Spring 容器
}
```

#### 5. 循环依赖问题提前暴露

```java
@Service
public class A {
    private final B b;

    public A(B b) {  // 构造器注入，如果 B 也依赖 A，编译时就可能报错
        this.b = b;
    }
}

@Service
public class B {
    private final A a;

    public B(A a) {
        this.a = a;
    }
}
```

**Spring 启动时报错**：

```
BeanCurrentlyInCreationException: Error creating bean 'a': 
  Requested bean is currently in creation: Is there an unresolvable circular reference?
```

循环依赖在启动时就能发现，而不是运行到某个功能时才报错。

### 缺点

当依赖过多时，构造器会变得很长：

```java
// 依赖很多时，构造器很长
public UserService(
        UserDao userDao,
        OrderDao orderDao,
        PaymentService paymentService,
        NotificationService notificationService,
        EmailService emailService,
        SmsService smsService,
        CacheService cacheService,
        ConfigService configService) {
    // ...
}
```

**解决方案**：
1. 拆分服务（单一职责）
2. 使用 Lombok `@RequiredArgsConstructor` 简化代码

```java
@Service
@RequiredArgsConstructor  // Lombok 自动生成构造器
public class UserServiceImpl implements UserService {
    private final UserDao userDao;
    private final OrderDao orderDao;
    private final PaymentService paymentService;
    // ...
}
```

## Setter 注入（Setter Injection）

### 标准写法

```java
@Service
public class NotificationService {

    // 可选依赖，使用 setter 注入
    private EmailService emailService;
    private SmsService smsService;

    @Autowired
    public void setEmailService(EmailService emailService) {
        this.emailService = emailService;
    }

    @Autowired
    public void setSmsService(SmsService smsService) {
        this.smsService = smsService;
    }

    public void notify(String message) {
        // 如果没有配置邮件服务，可能什么都不做
        if (emailService != null) {
            emailService.send(message);
        }
        // ...
    }
}
```

### 优点

1. **可选依赖**：setter 注入的依赖可以是 null
2. **可重新注入**：如果需要，可以调用 setter 替换依赖（适合测试或特殊场景）
3. **延迟加载**：依赖可以在使用时再注入

### 缺点

1. **依赖可能是 null**：使用时需要判断
2. **隐藏依赖**：构造器上没有参数，不知道这个 Bean 依赖什么
3. **线程安全问题**：非 final 字段在多线程下可能出问题

## 字段注入（Field Injection）

### 标准写法

```java
@Service
public class OrderService {

    @Autowired
    private UserService userService;

    @Autowired
    private PaymentService paymentService;
}
```

### 为什么不推荐字段注入？

#### 1. 违反单一职责原则

一个类既负责业务逻辑，又负责依赖获取。依赖是类的「输入」，应该通过构造器显式传入。

#### 2. 难以单元测试

```java
// 字段注入的类
@Service
public class OrderService {
    @Autowired
    private UserService userService;
}

// 测试困难：必须用反射或 Spring 测试上下文
@Test
public void testOrderCreation() {
    OrderService service = new OrderService();  // 可以创建
    // 但 userService 是 null！
    
    // 必须用反射设置
    ReflectionTestUtils.setField(service, "userService", mockUserService);
}
```

#### 3. 依赖不明确

```java
// 构造器注入：看一眼参数就知道依赖什么
public OrderService(UserService userService, PaymentService paymentService) {
    this.userService = userService;
    this.paymentService = paymentService;
}

// 字段注入：必须看完所有字段才知道依赖什么
@Service
public class OrderService {
    @Autowired private UserService userService;
    @Autowired private PaymentService paymentService;
    @Autowired private CacheService cacheService;
    @Autowired private ConfigService configService;
    // 到底依赖多少？得一个个看完
}
```

#### 4. 无法声明不可变依赖

字段注入无法使用 `final`，依赖随时可以被改变。

## 对比总结

| 特性 | 构造器注入 | Setter 注入 | 字段注入 |
|-----|----------|-------------|---------|
| **依赖不可变** | ✅ final | ❌ | ❌ |
| **强制要求依赖** | ✅ | ❌ 可选 | ❌ |
| **循环依赖检测** | ✅ 编译/启动时 | ❌ 运行时报错 | ❌ 运行时报错 |
| **单元测试** | ✅ 直接创建 | ✅ 可手动调用 setter | ❌ 需要反射 |
| **可选项支持** | ❌ 需配合 @Autowired(required=false) | ✅ 原生支持 | ❌ |
| **代码可读性** | ✅ 一目了然 | ⚠️ 一般 | ❌ 难以判断依赖 |
| **灵活性** | ⚠️ 低（依赖固定） | ✅ 高 | ✅ 高 |

## 最佳实践

### 规则一：优先使用构造器注入

```java
@Service
@RequiredArgsConstructor
public class OrderService {
    private final UserService userService;
    private final PaymentService paymentService;
    private final OrderRepository orderRepository;
}
```

### 规则二：可选依赖使用 @Autowired(required = false)

```java
@Service
@RequiredArgsConstructor
public class NotificationService {
    private final UserService userService;
    
    @Autowired(required = false)
    private SmsService smsService;  // 可选依赖
    
    @Autowired(required = false)
    private EmailService emailService;  // 可选依赖
}
```

### 规则三：只在测试代码中使用字段注入

```java
@SpringBootTest
class OrderServiceTest {
    
    @Autowired
    private OrderService orderService;  // 测试用，可以接受
    
    @MockBean
    private UserDao userDao;  // MockBean 自动注入
}
```

### 规则四：Lombok 简化构造器注入

```java
@Service
@RequiredArgsConstructor  // 生成包含所有 final 字段的构造器
public class UserServiceImpl implements UserService {
    private final UserDao userDao;
    private final OrderDao orderDao;
    // 不用写构造器，Lombok 自动生成
}
```

## Spring 官方推荐

Spring 官方从 4.x 开始就推荐**构造器注入**，并在 Spring Boot 2.0+ 的自动配置中默认使用。

从 Spring 5.0 开始，如果只有一个构造器，`@Autowired` 注解可以省略：

```java
// Spring 5+ 可以省略 @Autowired
@Service
public class UserService {
    private final UserDao userDao;

    public UserService(UserDao userDao) {
        this.userDao = userDao;
    }
}
```

## 面试核心问题

### Q1：三种注入方式有什么区别？

| 方式 | 特点 | 适用场景 |
|-----|-----|---------|
| **构造器注入** | 依赖不可变、强制必选、循环依赖暴露 | **首选**，用于必选依赖 |
| **Setter 注入** | 可选、可重注入 | 可选依赖 |
| **字段注入** | 简洁但隐藏依赖 | **不推荐** |

### Q2：为什么推荐构造器注入？

1. 依赖不可变（final）
2. 必选依赖和可选依赖一目了然
3. 循环依赖在启动时就暴露
4. 单元测试友好
5. 符合单一职责原则

### Q3：如何处理构造器注入参数过多的问题？

1. 重构服务，拆分成更小的服务
2. 使用 Lombok `@RequiredArgsConstructor`
3. 使用参数对象封装相关依赖

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    注入方式选择指南                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  首选：构造器注入                                           │
│    → 必选依赖                                              │
│    → 需要保证依赖不可变的场景                               │
│                                                            │
│  可选：Setter 注入                                          │
│    → 可选依赖                                              │
│    → 需要在运行时更换实现的场景                             │
│                                                            │
│  避免：字段注入                                             │
│    → 隐藏依赖，难以测试                                     │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[@Autowired vs @Resource vs @Inject](/framework/spring/autowired-resource) —— 三个注解有什么区别？分别用在什么场景？
