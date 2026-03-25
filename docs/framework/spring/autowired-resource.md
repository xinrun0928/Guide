# @Autowired vs @Resource vs @Inject

三个注解都能注入依赖，到底用哪个？

先看一个实际场景：

```java
@Service
public class OrderService {

    // 这三种写法都能工作，但有什么区别？
    @Autowired
    private UserDao userDao1;

    @Resource
    private UserDao userDao2;

    @Inject
    private UserDao userDao3;
}
```

## 三者对比

| 特性 | @Autowired | @Resource | @Inject |
|-----|-----------|----------|---------|
| **来源** | Spring 自定义 | Java 标准 (JSR-250) | Java 标准 (JSR-330) |
| **包路径** | `org.springframework.beans.factory.annotation` | `javax.annotation` | `javax.inject` |
| **依赖包** | Spring 自带，无需额外依赖 | `javax.annotation-api` | `javax.inject` |
| **注入方式** | 构造器、Setter、字段 | Setter、字段 | 构造器、Setter、字段 |
| **按名称注入** | 配合 @Qualifier | 直接支持 name 属性 | 配合 @Named |
| **required 属性** | 支持 (默认 true) | 不支持 | 不支持 |
| **注入顺序** | 先按类型，再按名称 | 先按名称，再按类型 | 先按类型，再按名称 |

## @Autowired：Spring 的亲儿子

### 基本用法

```java
@Service
public class UserService {

    // 字段注入
    @Autowired
    private UserDao userDao;

    // Setter 注入
    private OrderDao orderDao;
    
    @Autowired
    public void setOrderDao(OrderDao orderDao) {
        this.orderDao = orderDao;
    }

    // 构造器注入（Spring 5+ 可省略 @Autowired）
    private PaymentService paymentService;
    
    @Autowired
    public UserService(PaymentService paymentService) {
        this.paymentService = paymentService;
    }
}
```

### 按名称注入

默认按**类型**注入。如果有多个相同类型的 Bean，需要配合 `@Qualifier`：

```java
@Service
public class UserService {

    // 注入名为 primaryUserDao 的 Bean
    @Autowired
    @Qualifier("primaryUserDao")
    private UserDao userDao;
}
```

### required 属性

```java
@Service
public class UserService {

    // 如果找不到 UserDao，启动时会报错
    @Autowired
    private UserDao userDao;  // required 默认是 true

    // 找不到也不报错（慎用！）
    @Autowired(required = false)
    private UserDao optionalUserDao;
}
```

### 集合注入

`@Autowired` 可以注入所有匹配类型的 Bean：

```java
@Service
public class UserService {

    // 注入所有 UserDao 实现
    @Autowired
    private List&lt;UserDao&gt; userDaos;

    // 注入所有 PaymentService 实现
    @Autowired
    private Map&lt;String, PaymentService&gt; paymentServices;
}
```

```java
// 当有多个实现时
@Component("aliPay")
public class AliPayService implements PaymentService {}

@Component("wechatPay")
public class WechatPayService implements PaymentService {}

// userService 中：
@Autowired
private Map&lt;String, PaymentService&gt; paymentServices;
// paymentServices = {"aliPay": AliPay实例, "wechatPay": WechatPay实例}
```

## @Resource：先名字后类型

### 基本用法

```java
@Service
public class UserService {

    // 先按名称 "userDao" 查找，找不到再按类型
    @Resource
    private UserDao userDao;

    // 指定名称
    @Resource(name = "primaryUserDao")
    private UserDao userDao;
}
```

### 与 @Autowired 的关键区别

```java
@Service
public class UserService {

    // @Autowired：先类型匹配，再名称匹配
    // @Resource：先名称匹配，再类型匹配
    
    // 这个字段叫 userDao
    @Autowired
    private UserDao userDao;  // Spring 先找 UserDao 类型，再找名为 userDao 的
    
    @Resource
    private UserDao userDao;   // Spring 先找名为 userDao 的，再找 UserDao 类型
}
```

### 指定 name 属性

```java
@Service
public class OrderService {

    // 明确指定要注入的 Bean 名称
    @Resource(name = "mysqlUserDao")
    private UserDao userDao;
}
```

## @Inject：Java 标准的注入

### 基本用法

需要额外引入依赖：

```xml
<dependency>
    <groupId>javax.inject</groupId>
    <artifactId>javax.inject</artifactId>
    <version>1</version>
</dependency>
```

```java
@Service
public class UserService {

    @Inject
    private UserDao userDao;

    // 按名称需要配合 @Named
    @Inject
    @Named("primaryUserDao")
    private UserDao userDao;
}
```

### 与 @Autowired 的区别

`@Inject` 没有 `required` 属性，如果找不到就报错：

```java
@Service
public class UserService {

    // @Inject 没有 required = false
    // 必须找到对应的 Bean，否则启动失败
    @Inject
    private UserDao userDao;
}
```

## 实际选择建议

### 场景一：Spring 项目，使用构造器注入

**推荐使用构造器注入，不带任何注解**（Spring 5+）：

```java
@Service
@RequiredArgsConstructor
public class UserService {
    private final UserDao userDao;
    private final PaymentService paymentService;
    // 不需要任何注解！
}
```

### 场景二：必须使用字段/Setter 注入

**推荐 @Autowired + @Qualifier**：

```java
@Service
public class UserService {
    
    @Autowired
    @Qualifier("primaryUserDao")
    private UserDao userDao;
}
```

### 场景三：需要兼容 JSR 标准（CDI）

**推荐 @Inject**：

- 如果项目需要与其他框架（如 Google Guice、Weld）兼容
- 如果追求 Java 标准的注解

### 场景四：只需要按名称注入

**推荐 @Resource**：

```java
@Service
public class UserService {
    // 简单明确，按名称注入
    @Resource
    private UserDao userDao;
}
```

## 常见问题

### 问题一：多个同类型 Bean 注入

```java
@Component("primaryUserDao")
public class PrimaryUserDao implements UserDao {}

@Component("backupUserDao")
public class BackupUserDao implements UserDao {}
```

**解决方案**：

```java
@Service
public class UserService {
    
    // 方式一：@Qualifier 指定名称
    @Autowired
    @Qualifier("primaryUserDao")
    private UserDao userDao;

    // 方式二：@Primary 标记默认实现
    @Component
    @Primary
    public class PrimaryUserDao implements UserDao {}
    
    // 方式三：@Resource 指定名称
    @Resource(name = "primaryUserDao")
    private UserDao userDao;
}
```

### 问题二：@Autowired 找不到 Bean 但不想报错

```java
@Service
public class UserService {

    // 方式一：required = false
    @Autowired(required = false)
    private OptionalFeatureService optionalService;

    // 方式二：Java 8 Optional（推荐）
    @Autowired
    private Optional&lt;OptionalFeatureService&gt; optionalService;
    
    // 方式三：@Nullable
    @Autowired
    @Nullable
    private OptionalFeatureService optionalService;
}
```

### 问题三：构造器注入 + 按名称 @Qualifier

```java
@Service
public class UserService {
    
    private final UserDao userDao;

    // 构造器 + @Qualifier
    @Autowired
    public UserService(@Qualifier("primaryUserDao") UserDao userDao) {
        this.userDao = userDao;
    }
}
```

## 执行顺序对比

### @Autowired

```
1. 按类型查找 Bean
2. 如果找到多个，按字段名 / 参数名作为 Bean 名称查找
3. 如果还找不到且 required=true，报错
4. 如果 required=false，使用 null
```

### @Resource

```
1. 按 name 属性查找 Bean
2. 如果没指定 name，按字段名 / setter 方法名作为 Bean 名称查找
3. 如果找不到，按类型查找
4. 如果还找不到，报错
```

### @Inject

```
1. 按类型查找 Bean
2. 如果找到多个，配合 @Named 按名称查找
3. 如果找不到，报错
```

## 面试核心问题

### Q1：@Autowired 和 @Resource 的区别？

| 区别 | @Autowired | @Resource |
|-----|-----------|----------|
| 来源 | Spring | Java 标准 JSR-250 |
| 查找顺序 | 先类型，后名称 | 先名称，后类型 |
| required 支持 | 支持 | 不支持 |
| 包依赖 | Spring 自带 | javax.annotation-api |

### Q2：@Autowired 如何按名称注入？

配合 `@Qualifier` 注解：

```java
@Autowired
@Qualifier("userDao")
private UserDao userDao;
```

### Q3：@Resource 找不到会怎样？

`@Resource` 会先按名称查找，找不到再按类型查找，如果都找不到会抛出 `NoSuchBeanDefinitionException`。

### Q4：@Inject 和 @Autowired 哪个更标准？

`@Inject` 是 Java 标准（JSR-330），更通用；
`@Autowired` 是 Spring 自带的，功能更丰富（`required`、`@Qualifier` 等）。

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    注入注解选择指南                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Spring 项目                                                │
│    → 构造器注入（无注解，Spring 5+）                        │
│    → 或 @Autowired + @Qualifier                            │
│                                                            │
│  需要兼容 JSR 标准                                          │
│    → @Inject + @Named                                      │
│                                                            │
│  只想按名称注入                                             │
│    → @Resource                                             │
│                                                            │
│  避免使用                                                   │
│    → 单独字段注入 @Autowired（无构造器/无 @Qualifier）      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Spring 启动流程源码解析](/framework/spring/startup-flow) —— 从 refresh() 方法开始，深入 Spring 容器初始化的每一步。
