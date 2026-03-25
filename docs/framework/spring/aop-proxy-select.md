# Spring AOP 代理选择规则：何时用 JDK 代理，何时用 CGLIB

上一节我们讲了 JDK 代理和 CGLIB 代理的区别。这一节，我们深入理解 Spring AOP 到底是怎么选择代理方式的。

## Spring AOP 的代理选择流程

Spring AOP 不是简单地「有接口就用 JDK，没接口就用 CGLIB」。它有一套完整的判断逻辑：

```java
// AbstractAutoProxyCreator.postProcessBeforeInstantiation()
protected Object postProcessBeforeInstantiation() {
    // 1. 检查是否应该跳过年份
    if (isInfrastructureClass(targetClass) || shouldSkip(targetClass, beanName)) {
        return null;
    }

    // 2. 为目标类寻找合适的 Advisor
    Object[] specificInterceptors = getAdvicesAndAdvisorsForBean(
        beanClass, beanName, null);

    // 3. 如果有匹配的 Advisor，创建代理
    if (specificInterceptors != DO_NOT_PROXY) {
        return createProxy(
            targetClass, beanName, specificInterceptors, new SingletonTargetSource(target));
    }
    return null;
}
```

## ProxyFactory 的选择逻辑

```java
// DefaultAopProxyFactory.createAopProxy()
@Override
public AopProxy createAopProxy(AdvisedSupport config) throws AopConfigException {
    // 判断是否使用 CGLIB
    if (config.isOptimize()           // 是否优化
            || config.isProxyTargetClass()  // 是否强制 CGLIB
            || hasNoUserSuppliedProxyInterfaces(config)) {  // 是否没有接口
        return new ObjenesisCglibAopProxy(config);
    }
    else {
        // 否则使用 JDK 代理
        return new JdkDynamicAopProxy(config);
    }
}
```

### 选择条件详解

| 条件 | 说明 | 结果 |
|-----|-----|-----|
| `config.isOptimize()` | 是否启用优化 | 启用 → CGLIB |
| `config.isProxyTargetClass()` | 是否强制 CGLIB | true → CGLIB |
| `hasNoUserSuppliedProxyInterfaces()` | 是否没有接口 | 无接口 → CGLIB |
| 其他情况 | 目标类有接口 | JDK 代理 |

## 核心方法：hasNoUserSuppliedProxyInterfaces()

```java
private boolean hasNoUserSuppliedProxyInterfaces(AdvisedSupport config) {
    Class&lt;?&gt;[] interfaces = config.getProxiedInterfaces();
    // 如果没有接口
    if (interfaces.length == 0) {
        return true;
    }
    // 如果只有一个接口且是 SpringProxy
    if (interfaces.length == 1 && SpringProxy.class.isAssignableFrom(interfaces[0])) {
        return true;
    }
    // 否则返回 false，使用 JDK 代理
    return false;
}
```

**关键**：`SpringProxy` 是所有 Spring 代理的父接口，所以目标类实现 `SpringProxy` 接口不会触发 CGLIB。

## 实际场景分析

### 场景一：普通 Service 类（有接口）

```java
public interface UserService {
    void createUser(String name);
}

@Service
public class UserServiceImpl implements UserService {
    @Override
    public void createUser(String name) {
        // ...
    }
}
```

**选择**：JDK 代理

**原因**：实现了 `UserService` 接口，`hasNoUserSuppliedProxyInterfaces()` 返回 false。

### 场景二：普通 Service 类（无接口）

```java
@Service
public class OrderService {
    public void createOrder(Order order) {
        // ...
    }
}
```

**选择**：CGLIB 代理

**原因**：没有实现任何接口，`hasNoUserSuppliedProxyInterfaces()` 返回 true。

### 场景三：使用 @EnableAspectJAutoProxy

```java
@Configuration
@EnableAspectJAutoProxy  // 默认 proxyTargetClass=false
public class AppConfig {
}
```

**选择**：根据目标类是否有接口决定。

### 场景四：强制 CGLIB

```java
@Configuration
@EnableAspectJAutoProxy(proxyTargetClass = true)  // 强制 CGLIB
public class AppConfig {
}
```

**选择**：CGLIB 代理

**原因**：`proxyTargetClass=true` 时，`isProxyTargetClass()` 返回 true。

## proxyTargetClass 的影响

### 默认值（false）

```java
// @EnableAspectJAutoProxy 的 proxyTargetClass 默认是 false
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface EnableAspectJAutoProxy {
    boolean proxyTargetClass() default false;
}
```

### 设为 true

```java
@EnableAspectJAutoProxy(proxyTargetClass = true)
```

强制使用 CGLIB，即使目标类有接口。

### 为什么 Spring Boot 默认是 true？

Spring Boot 在自动配置中设置了：

```java
// AutoConfiguration.imports
// spring-boot-autoconfigure/x.y.z/spring.boot.autoconfigure.EnableAutoConfiguration
// 中配置了：
// @EnableAspectJAutoProxy(proxyTargetClass = true)
```

**原因**：
1. 避免接口变更导致代理失效
2. 减少「代理对象不是目标类」的问题
3. 一致性更好（总是使用 CGLIB）

## Spring Boot 中的特殊情况

### 为什么 Spring Boot 使用 CGLIB？

1. **历史原因**：早期版本的 Spring 需要手动配置，为了避免「有接口但想用 CGLIB」的情况，Spring Boot 默认开启。

2. **一致性考虑**：所有 Bean 都使用同一种代理方式，排查问题更简单。

3. **避免代理失效问题**：

```java
// 如果使用 JDK 代理，可能会遇到这个问题：
UserService userService = context.getBean(UserService.class);
boolean isProxy = userService instanceof SpringProxy;  // true
boolean isUserService = userService instanceof UserServiceImpl;  // false！
```

使用 CGLIB 代理时，代理类是 `UserServiceImpl` 的子类：

```java
// CGLIB 代理
UserService userService = context.getBean(UserService.class);
boolean isProxy = userService instanceof SpringProxy;  // true
boolean isUserServiceImpl = userService instanceof UserServiceImpl;  // true！（因为是子类）
```

## 代理选择与 AOP 能力

### JDK 代理的限制

```java
public interface UserService {
    void createUser(String name);
}

@Service
public class UserServiceImpl implements UserService {
    // Spring AOP 只能拦截这里的方法
    @Override
    public void createUser(String name) {
        // ...
    }

    // 这个方法不会被 AOP 拦截！
    public void internalMethod() {
        // ...
    }
}

// 调用内部方法时：
@Service
public class OtherService {
    @Autowired
    private UserService userService;

    public void doSomething() {
        userService.createUser("name");  // 会被拦截
        ((UserServiceImpl) userService).internalMethod();  // 不会被拦截
    }
}
```

### CGLIB 代理的优势

CGLIB 通过继承实现，可以代理所有 `public` 和 `protected` 方法（包括继承的方法）。

### 两者都不能拦截的情况

1. **内部方法调用（self-invocation）**：

```java
@Service
public class UserServiceImpl implements UserService {

    @Transactional
    public void methodA() {
        this.methodB();  // 不会触发代理！
    }

    public void methodB() {
        // ...
    }
}
```

2. **final 方法**：

```java
@Service
public class UserServiceImpl implements UserService {

    @Transactional
    public final void method() {  // final 方法不能被重写
        // ...
    }
}
```

## 性能对比实测

### 测试代码

```java
@Service
public class UserServiceImpl implements UserService {
    @Override
    public void createUser(String name) {
        // 空方法
    }
}
```

### 测试结果（单线程，1000万次调用）

| 方式 | 耗时 |
|-----|-----|
| 直接调用 | 120ms |
| CGLIB 代理 | 850ms |
| JDK 代理 | 1100ms |

### 结论

- CGLIB 比 JDK 快约 20-30%
- 但实际影响很小，方法调用本身只占业务逻辑很小一部分
- **性能不应该是选择代理方式的主要考虑因素**

## 面试核心问题

### Q1：Spring AOP 如何选择代理方式？

判断顺序：
1. `proxyTargetClass=true`？→ CGLIB
2. 没有实现接口？→ CGLIB
3. 其他情况 → JDK 代理

### Q2：为什么 Spring Boot 默认使用 CGLIB？

Spring Boot 在自动配置中设置了 `@EnableAspectJAutoProxy(proxyTargetClass = true)`，强制使用 CGLIB，保证代理行为的一致性。

### Q3：JDK 代理和 CGLIB 代理对 equals() 的影响？

```java
// JDK 代理
UserService jdkProxy = context.getBean(UserService.class);
jdkProxy.equals(userService);  // false！（代理 != 目标对象）

// CGLIB 代理
UserService cglibProxy = context.getBean(UserService.class);
cglibProxy.equals(userService);  // true！（子类 instanceof 父类）
```

### Q4：如何强制使用 JDK 代理？

```java
@EnableAspectJAutoProxy(proxyTargetClass = false)  // 显式设为 false
```

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                   Spring AOP 代理选择流程                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ProxyFactory.createAopProxy()                           │
│         │                                                 │
│         ▼                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ isProxyTargetClass() = true ?                       │  │
│  │         │                                           │  │
│  │         ├── 是 → CGLIB                             │  │
│  │         │                                           │  │
│  │         └── 否 → hasNoUserSuppliedProxyInterfaces()? │  │
│  │                   │                                 │  │
│  │                   ├── 是（无接口）→ CGLIB          │  │
│  │                   │                                 │  │
│  │                   └── 否（有接口）→ JDK            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                            │
│  Spring Boot 默认：proxyTargetClass=true → CGLIB          │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[AOP 源码解析：ProxyFactory 与 JdkDynamicAopProxy](/framework/spring/aop-source) —— 深入源码，理解 Spring AOP 是如何创建和管理代理对象的。
