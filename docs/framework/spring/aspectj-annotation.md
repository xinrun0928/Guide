# @AspectJ 注解驱动的 AOP 配置

上一节我们对比了 Spring AOP 和 AspectJ。这一节，我们深入学习 @AspectJ 注解，写出专业的切面代码。

## @AspectJ 简介

@AspectJ 是 AspectJ 5 引入的注解方式，允许使用注解定义切面。它可以用在 Spring AOP 中。

```java
@Aspect
@Component
public class TransactionAspect {

    @Around("execution(* com.example.service..*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        // 事务逻辑
    }
}
```

## 启用 @AspectJ

### 方式一：Java 配置

```java
@Configuration
@EnableAspectJAutoProxy  // 启用 @AspectJ 支持
public class AppConfig {
}
```

### 方式二：XML 配置

```xml
<beans>
    <aop:aspectj-autoproxy/>
</beans>
```

## 定义切点

### @Pointcut 注解

```java
@Aspect
@Component
public class PointcutDefs {

    // 匹配所有 public 方法
    @Pointcut("execution(public * *(..))")
    public void publicMethod() {}

    // 匹配 Service 包下所有类的方法
    @Pointcut("execution(* com.example.service.*.*(..))")
    public void serviceMethod() {}

    // 匹配标注了 @Service 的类
    @Pointcut("@within(org.springframework.stereotype.Service)")
    public void serviceClass() {}

    // 组合切点
    @Pointcut("publicMethod() && serviceMethod()")
    public void publicServiceMethod() {}
}
```

### 常见切点表达式

#### execution 表达式

```java
// 匹配方法执行
@Pointcut("execution(public * *(..))")                    // 所有 public 方法
@Pointcut("execution(* com.example.service.*.*(..))")      // service 包下所有方法
@Pointcut("execution(* com.example..*.save*(..))")         // 子包下所有 save 开头的方法
@Pointcut("execution(* com.example.UserService+.save(..))") // UserService 及其子类的 save 方法

// 匹配构造方法
@Pointcut("execution(com.example.UserService.new(..))")     // UserService 的构造函数
```

#### within 表达式

```java
// 匹配指定包/类下的所有连接点
@Pointcut("within(com.example.service.*)")      // service 包下所有类
@Pointcut("within(com.example.service..*)")     // service 包及子包下所有类
@Pointcut("within(com.example.service.UserService)")  // UserService 类
@Pointcut("within(com.example.service.UserService+)")  // UserService 及其子类
```

#### this 和 target

```java
// 匹配代理对象是指定类型
@Pointcut("this(com.example.service.UserService)")     // 代理对象是 UserService
// 匹配目标对象是指定类型
@Pointpoint("target(com.example.service.UserService)")  // 目标对象是 UserService
```

#### @annotation 表达式

```java
// 匹配标注了指定注解的方法
@Pointcut("@annotation(org.springframework.transaction.annotation.Transactional)")
public void transactional() {}

// 使用
@Around("transactional()")
public Object around(ProceedingJoinPoint pjp) throws Throwable {
    // ...
}
```

#### @within 和 @target

```java
// 匹配标注了指定注解的类中的方法
@Pointcut("@within(org.springframework.stereotype.Service)")
public void serviceClass() {}

// 匹配运行时目标对象标注了指定注解
@Pointcut("@target(org.springframework.stereotype.Service)")
public void serviceClass() {}
```

#### @args

```java
// 匹配方法参数的类型标注了指定注解
@Pointcut("@args(com.example.annotation.Trackable)")
public void trackableArg() {}
```

#### bean 表达式

```java
// 匹配指定名称的 Bean
@Pointcut("bean(userService)")           // userService Bean
@Pointcut("bean(*Service)")             // 所有名称以 Service 结尾的 Bean
@Pointcut("bean(!userService)")         // 除了 userService 的所有 Bean
```

## 五种通知注解

### @Before 前置通知

```java
@Aspect
@Component
public class LoggingAspect {

    @Before("execution(* com.example.service..*.*(..))")
    public void before(JoinPoint joinPoint) {
        String method = joinPoint.getSignature().toShortString();
        Object[] args = joinPoint.getArgs();
        System.out.println("调用 " + method + "，参数：" + Arrays.toString(args));
    }

    // 带参数名
    @Before("execution(* com.example.service..*.save(..)) && args(name)")
    public void beforeSave(String name) {
        System.out.println("保存：" + name);
    }
}
```

### @After 后置通知

```java
@Aspect
@Component
public class LoggingAspect {

    @After("execution(* com.example.service..*.*(..))")
    public void after(JoinPoint joinPoint) {
        String method = joinPoint.getSignature().toShortString();
        System.out.println(method + " 执行完成");
    }
}
```

### @AfterReturning 返回通知

```java
@Aspect
@Component
public class LoggingAspect {

    @AfterReturning(
        pointcut = "execution(* com.example.service..*.*(..))",
        returning = "result"
    )
    public void afterReturning(JoinPoint joinPoint, Object result) {
        String method = joinPoint.getSignature().toShortString();
        System.out.println(method + " 返回：" + result);
    }

    // 限制返回类型
    @AfterReturning(
        pointcut = "execution(* com.example.service..*.find*(..))",
        returning = "result"
    )
    public void afterFindReturning(JoinPoint joinPoint, List&lt;?&gt; result) {
        System.out.println("查询到 " + result.size() + " 条记录");
    }
}
```

### @AfterThrowing 异常通知

```java
@Aspect
@Component
public class ExceptionAspect {

    @AfterThrowing(
        pointcut = "execution(* com.example.service..*.*(..))",
        throwing = "e"
    )
    public void afterThrowing(JoinPoint joinPoint, Exception e) {
        String method = joinPoint.getSignature().toShortString();
        System.out.println(method + " 抛出异常：" + e.getMessage());
        // 发送告警邮件
    }

    // 限制异常类型
    @AfterThrowing(
        pointcut = "execution(* com.example.service..*.save(..))",
        throwing = "e"
    )
    public void afterSaveThrowing(JoinPoint joinPoint, DataAccessException e) {
        // 只处理数据访问异常
    }
}
```

### @Around 环绕通知

```java
@Aspect
@Component
public class PerformanceAspect {

    @Around("execution(* com.example.service..*.*(..))")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.nanoTime();

        try {
            // 执行目标方法
            Object result = pjp.proceed();
            return result;
        } finally {
            long duration = System.nanoTime() - start;
            String method = pjp.getSignature().toShortString();
            if (duration > 1_000_000) {  // 超过 1ms 打印
                System.out.println(method + " 耗时：" + duration / 1_000_000 + "ms");
            }
        }
    }
}
```

## JoinPoint 对象

### 获取方法信息

```java
@Before("execution(* com.example.service..*.*(..))")
public void before(JoinPoint joinPoint) {
    // 方法签名
    Signature signature = joinPoint.getSignature();
    String methodName = signature.getName();           // 方法名
    String className = signature.getDeclaringTypeName();  // 类名

    // 方法参数
    Object[] args = joinPoint.getArgs();

    // 目标对象
    Object target = joinPoint.getTarget();

    // 代理对象
    Object proxy = joinPoint.getThis();
}
```

### ProceedingJoinPoint 特有方法

```java
@Around("execution(* com.example.service..*.*(..))")
public Object around(ProceedingJoinPoint pjp) throws Throwable {
    // 获取方法签名
    MethodSignature signature = (MethodSignature) pjp.getSignature();

    // 获取方法
    Method method = signature.getMethod();

    // 获取参数名
    String[] paramNames = signature.getParameterNames();

    // 获取参数值
    Object[] args = pjp.getArgs();

    // 获取绑定注解的值
    // @Before("... && args(name, id)")
    // public void before(String name, Long id) { }

    // 执行目标方法
    Object result = pjp.proceed();

    return result;
}
```

## 专业切面示例

### 事务切面

```java
@Aspect
@Component
public class TransactionAspect {

    @Autowired
    private PlatformTransactionManager transactionManager;

    @Around("@annotation(org.springframework.transaction.annotation.Transactional)")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        TransactionDefinition definition = new DefaultTransactionDefinition();
        TransactionStatus status = transactionManager.getTransaction(definition);

        try {
            Object result = pjp.proceed();
            transactionManager.commit(status);
            return result;
        } catch (Exception e) {
            transactionManager.rollback(status);
            throw e;
        }
    }
}
```

### 重试切面

```java
@Aspect
@Component
public class RetryAspect {

    @Around("@annotation(retry)")
    public Object around(ProceedingJoinPoint pjp, Retry retry) throws Throwable {
        int maxAttempts = retry.maxAttempts();
        long backoff = retry.backoff();

        for (int i = 1; i <= maxAttempts; i++) {
            try {
                return pjp.proceed();
            } catch (Exception e) {
                if (i == maxAttempts) {
                    throw e;
                }
                Thread.sleep(backoff);
            }
        }
        throw new RuntimeException("Should not reach here");
    }
}

// 自定义注解
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Retry {
    int maxAttempts() default 3;
    long backoff() default 1000;
}

// 使用
@Service
public class ExternalService {

    @Retry(maxAttempts = 5, backoff = 2000)
    public String callExternalApi() {
        // 可能失败的重试逻辑
    }
}
```

### 缓存切面

```java
@Aspect
@Component
public class CacheAspect {

    private Map&lt;String, Object&gt; cache = new ConcurrentHashMap<>();

    @Around("@annotation(cacheable)")
    public Object around(ProceedingJoinPoint pjp, Cacheable cacheable) throws Throwable {
        String key = buildKey(pjp, cacheable.key());

        // 命中缓存
        if (cache.containsKey(key)) {
            return cache.get(key);
        }

        // 执行方法
        Object result = pjp.proceed();

        // 放入缓存
        cache.put(key, result);
        return result;
    }

    private String buildKey(ProceedingJoinPoint pjp, String keyTemplate) {
        // 简化实现
        return keyTemplate + ":" + Arrays.toString(pjp.getArgs());
    }
}

// 自定义注解
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Cacheable {
    String key();
}
```

## 切面执行顺序

### @Order 注解

```java
@Aspect
@Component
@Order(1)  // 数字越小，越先执行
public class FirstAspect {
    @Before("execution(* com.example..*.*(..))")
    public void before() {
        System.out.println("FirstAspect - Before");
    }
}

@Aspect
@Component
@Order(2)
public class SecondAspect {
    @Before("execution(* com.example..*.*(..))")
    public void before() {
        System.out.println("SecondAspect - Before");
    }
}
```

### 通知执行顺序

```
同一切面内的通知顺序：
@Around("...") {
    │ ← 进入
    ├── @Before
    ├── proceed()
    ├── @AfterReturning 或 @AfterThrowing
    └── @After
    │ ← 退出
}
```

## 面试核心问题

### Q1：@AspectJ 有哪些通知类型？

| 注解 | 时机 |
|-----|-----|
| `@Before` | 目标方法执行前 |
| `@After` | 目标方法执行后（无论是否异常）|
| `@AfterReturning` | 目标方法正常返回后 |
| `@AfterThrowing` | 目标方法抛出异常后 |
| `@Around` | 包围目标方法 |

### Q2：@Pointcut 有什么作用？

定义可重用的切点表达式，可以被多个通知引用。

### Q3：JoinPoint 和 ProceedingJoinPoint 的区别？

- `JoinPoint`：只能获取信息，不能控制执行
- `ProceedingJoinPoint`：继承自 JoinPoint，可以调用 `proceed()` 执行目标方法

### Q4：如何获取方法参数名？

使用 `MethodSignature` 和 `ParameterNameDiscoverer`。

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    @AspectJ 注解总结                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  启用：@EnableAspectJAutoProxy                             │
│                                                            │
│  切点表达式：                                             │
│    execution / within / this / target                      │
│    @annotation / @within / @target / @args               │
│    bean                                                   │
│                                                            │
│  通知类型：                                                │
│    @Before / @After / @AfterReturning / @AfterThrowing    │
│    @Around                                               │
│                                                            │
│  核心对象：                                                │
│    JoinPoint / ProceedingJoinPoint                        │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[AOP 应用场景：事务、日志、性能监控、权限校验](/framework/spring/aop-usecase) —— 掌握 AOP 在实际开发中的应用场景。
