# AOP 核心概念：切点、切面、通知、连接点

你有没有遇到过这样的场景：需要在所有 Service 方法前后加上日志，或者需要在所有 Controller 方法执行前检查权限？

如果你选择直接在每个方法里写，你会发现代码变成了这样：

```java
public class UserServiceImpl {
    public void addUser(User user) {
        log.info("开始添加用户");
        // 权限校验
        checkPermission();
        // 业务逻辑
        // ...
        log.info("添加用户完成");
    }

    public void deleteUser(Long id) {
        log.info("开始删除用户");
        checkPermission();
        // 业务逻辑
        // ...
        log.info("删除用户完成");
    }
}
```

一个简单的业务方法，被日志和权限校验包围了四圈。这就是所谓的「横切关注点」——它横切了所有的业务方法，却又不是业务逻辑本身。

**AOP（面向切面编程）就是来解决这个问题的。**

## 四大核心概念

AOP 的核心就是四个概念：连接点（Join Point）、切点（Pointcut）、通知（Advice）、切面（Aspect）。

### 1. 连接点（Join Point）

> 「在哪里执行？」

连接点是指程序执行的某个位置，**可能被拦截的地方**。

在 Spring AOP 中，连接点始终是**方法执行**。一个类里有多少个方法，理论上就有多少个连接点。

```java
public class OrderService {
    public void createOrder() {}  // 这是一个连接点
    public void cancelOrder(Long id) {}  // 这也是一个连接点
    public Order getOrder(Long id) {}  // 这还是一个连接点
}
```

### 2. 切点（Pointcut）

> 「具体拦截哪一个？」

切点是连接点的定义，**精确指定哪些连接点需要被拦截**。

如果说连接点是「所有方法」，那切点就是「所有方法中，符合某个条件的那些」。

```java
// 切点表达式：拦截 UserService 中所有以 find 开头的方法
@Pointcut("execution(* com.example.UserService.find*(..))")
public void pointcutForFindMethods() {}
```

常见的切点表达式：

| 表达式 | 含义 |
|-------|------|
| `execution(* com.example.UserService.*(..))` | UserService 的所有方法 |
| `execution(* com.example..*.save*(..))` | com.example 包下所有以 save 开头的方法 |
| `within(com.example.service.*)` | service 包下的所有类 |
| `annotation(@Transactional)` | 所有标注了 @Transactional 的方法 |
| `bean(userService)` |名为 userService 的 Bean |
| `bean(*Service)` | 所有以 Service 结尾的 Bean |

### 3. 通知（Advice）

> 「拦截后做什么？」

通知定义了**拦截到连接点后要执行的逻辑**。

```java
@Aspect
@Component
public class LoggingAspect {

    // 方法执行前执行
    @Before("execution(* com.example..*.save*(..))")
    public void beforeSave(JoinPoint joinPoint) {
        log.info("准备保存数据: {}", joinPoint.getSignature());
    }

    // 方法执行后执行（无论成功还是异常都执行）
    @After("execution(* com.example..*.save*(..))")
    public void afterSave(JoinPoint joinPoint) {
        log.info("保存操作完成: {}", joinPoint.getSignature());
    }

    // 方法成功返回后执行
    @AfterReturning(pointcut = "execution(* com.example..*.save*(..))", returning = "result")
    public void afterReturningSave(JoinPoint joinPoint, Object result) {
        log.info("保存成功，返回值: {}", result);
    }

    // 方法抛出异常后执行
    @AfterThrowing(pointcut = "execution(* com.example..*.save*(..))", throwing = "ex")
    public void afterThrowingSave(JoinPoint joinPoint, Exception ex) {
        log.error("保存失败: {}", ex.getMessage());
    }

    // 环绕通知：可以控制方法何时开始、何时结束
    @Around("execution(* com.example..*.save*(..))")
    public Object aroundSave(ProceedingJoinPoint pjp) throws Throwable {
        log.info("环绕通知 - 开始");
        long start = System.currentTimeMillis();

        // 执行目标方法
        Object result = pjp.proceed();

        long end = System.currentTimeMillis();
        log.info("环绕通知 - 结束，耗时: {} ms", end - start);
        return result;
    }
}
```

五种通知的执行时机：

```
                    ┌─────────────────────────────────────┐
                    │            目标方法执行              │
                    │                                     │
   @Before ───────► │                                     │
                    │                                     │
   ┌─────────────────┼─────────────────────────────────────┼─────────────────┐
   │                 │                                     │                 │
   │   @Around       │           目标方法体                 │   @Around       │
   │   (前置部分)    │                                     │   (后置部分)    │
   │                 └─────────────────────────────────────┤                 │
   │                                                          │                 │
   │                                                          ▼                 │
   │                                                    @AfterReturning        │
   │                                                          │                 │
   │                                                          │ (或)            │
   │                                                          ▼                 │
   │                                                    @AfterThrowing         │
   │                 ┌─────────────────────────────────────┤                 │
   │                 │                                     │                 │
   └─────────────────►│            @After                  │◄────────────────┘
                     │          (finally)                  │
                     └─────────────────────────────────────┘
```

### 4. 切面（Aspect）

> 「谁来组织？」

切面是通知和切点的组合，**定义了拦截什么（切点）+ 拦截后做什么（通知）**。

```java
@Aspect  // 声明这是一个切面
@Component
public class PerformanceAspect {

    // 切点：拦截所有 Service 层的方法
    @Pointcut("execution(* com.example..service..*(..))")
    public void serviceLayer() {}

    // 通知：性能监控
    @Around("serviceLayer()")
    public Object monitorPerformance(ProceedingJoinPoint pjp) throws Throwable {
        long start = System.currentTimeMillis();
        Object result = pjp.proceed();
        long cost = System.currentTimeMillis() - start;

        if (cost > 1000) {
            log.warn("方法执行超过 1 秒: {}，耗时: {} ms",
                    pjp.getSignature(), cost);
        }
        return result;
    }
}
```

## 概念关系图

```
┌─────────────────────────────────────────────────────────────────┐
│                         AOP 核心概念关系                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────┐                                                   │
│  │   切面     │  ← 组织了「切点 + 通知」                          │
│  │  (Aspect) │                                                   │
│  └─────┬─────┘                                                   │
│        │                                                         │
│        ├──────────────────┬──────────────────┐                   │
│        ▼                  ▼                  ▼                   │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐                │
│  │   切点     │    │   通知    │    │  连接点    │                │
│  │ (Pointcut)│    │  (Advice) │    │(JoinPoint)│                │
│  └───────────┘    └───────────┘    └───────────┘                │
│        │                  │                                     │
│   「拦截哪些」         「拦截后做什么」                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 实际应用示例

### 日志切面

```java
@Aspect
@Component
@Order(1)  // 多个切面时的执行顺序，数字越小优先级越高
public class LoggingAspect {

    @Pointcut("execution(* com.example..service..*(..))")
    public void serviceMethods() {}

    @Before("serviceMethods()")
    public void logBefore(JoinPoint jp) {
        log.info(">>> 调用方法: {}.{}", 
                jp.getTarget().getClass().getSimpleName(),
                jp.getSignature().getName());
    }

    @AfterReturning(pointcut = "serviceMethods()", returning = "result")
    public void logAfterReturning(JoinPoint jp, Object result) {
        log.info("<<< 方法返回: {}.{} = {}",
                jp.getTarget().getClass().getSimpleName(),
                jp.getSignature().getName(),
                result);
    }
}
```

### 权限校验切面

```java
@Aspect
@Component
public class PermissionAspect {

    @Pointcut("@annotation(RequirePermission)")
    public void permissionRequired() {}

    @Around("permissionRequired()")
    public Object checkPermission(ProceedingJoinPoint pjp) throws Throwable {
        // 获取方法上的注解
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        Method method = signature.getMethod();
        RequirePermission annotation = method.getAnnotation(RequirePermission.class);

        // 检查权限
        String[] requiredPermissions = annotation.value();
        if (!hasPermission(requiredPermissions)) {
            throw new SecurityException("没有权限访问此方法");
        }

        return pjp.proceed();
    }
}
```

## 面试核心问题

### Q1：AOP 的四大核心概念是什么？

| 概念 | 作用 | 类比 |
|-----|------|-----|
| **Join Point** | 连接点，程序执行的位置 | 公路上的所有路口 |
| **Pointcut** | 切点，具体拦截哪些连接点 | 指定要收费的路口 |
| **Advice** | 通知，拦截后执行的逻辑 | 收费的动作 |
| **Aspect** | 切面，切点 + 通知的组合 | 收费站的完整设计 |

### Q2：Spring AOP 和 AspectJ 的区别？

| 特性 | Spring AOP | AspectJ |
|-----|-----------|--------|
| 织入时机 | 运行时代理 | 编译时/加载时织入 |
| 连接点 | 仅方法执行 | 字段、构造函数、静态块等 |
| 切点表达式 | 部分支持 | 完全支持 |
| 性能 | 有额外开销 | 无额外开销 |
| 配置 | 简单 | 复杂 |

### Q3：@Around 和其他通知的区别？

`@Around` 可以完全控制目标方法的执行——可以决定是否调用 `proceed()`，可以修改参数，可以修改返回值。其他通知（@Before、@After 等）只是被动地被调用。

---

**下节预告**：[JDK 动态代理 vs CGLIB 动态代理](/framework/spring/jdk-cglib) —— 深入理解 Spring AOP 底层两种代理技术的原理和区别。
