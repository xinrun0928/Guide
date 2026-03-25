# AOP 应用场景：事务、日志、性能监控、权限校验

学会了 AOP 的概念和语法，终于到了实战环节。

AOP 在实际开发中有无数应用场景。这一节，我们来看看最常见的四个：事务管理、统一日志、性能监控、权限校验。

## 场景一：事务管理

这是 AOP 最经典的应用。

### 原始写法

```java
@Service
public class OrderService {

    @Autowired
    private TransactionTemplate transactionTemplate;

    public void createOrder(Order order) {
        transactionTemplate.executeWithoutResult(status -> {
            try {
                // 1. 创建订单
                orderMapper.insert(order);
                // 2. 扣减库存
                inventoryService.reduce(order.getProductId(), order.getQuantity());
                // 3. 发送通知
                notificationService.notify(order);
            } catch (Exception e) {
                status.setRollbackOnly();
                throw e;
            }
        });
    }
}
```

### AOP 写法

```java
// 定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Transactional {
}

// 定义切面
@Aspect
@Component
public class TransactionAspect {

    @Autowired
    private TransactionManager transactionManager;

    @Around("@annotation(transactional)")
    public Object around(ProceedingJoinPoint pjp, Transactional transactional) throws Throwable {
        TransactionStatus status = transactionManager.getTransaction(
            new DefaultTransactionDefinition());

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

// 使用
@Service
public class OrderService {

    @Transactional  // 简洁！
    public void createOrder(Order order) {
        orderMapper.insert(order);
        inventoryService.reduce(order.getProductId(), order.getQuantity());
        notificationService.notify(order);
    }
}
```

**对比**：代码从 12 行减少到 4 行，核心逻辑一目了然。

## 场景二：统一日志记录

### 原始写法

```java
@Service
public class UserService {

    public void createUser(User user) {
        log.info("创建用户开始: {}", user.getName());
        try {
            // 业务逻辑
            userMapper.insert(user);
            log.info("创建用户成功: {}", user.getName());
        } catch (Exception e) {
            log.error("创建用户失败: {}", user.getName(), e);
            throw e;
        }
    }

    public void deleteUser(Long id) {
        log.info("删除用户开始: id={}", id);
        try {
            // 业务逻辑
            userMapper.deleteById(id);
            log.info("删除用户成功: id={}", id);
        } catch (Exception e) {
            log.error("删除用户失败: id={}", id, e);
            throw e;
        }
    }
}
```

### AOP 写法

```java
// 定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface OperLog {
    String value();  // 操作描述
}

// 定义切面
@Aspect
@Component
@Slf4j
public class LoggingAspect {

    @Around("@annotation(operLog)")
    public Object around(ProceedingJoinPoint pjp, OperLog operLog) throws Throwable {
        String operation = operLog.value();
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        String className = signature.getDeclaringType().getSimpleName();
        String methodName = signature.getName();

        // 前置日志
        log.info("[{}] {}.{} 开始, 参数: {}",
            operation, className, methodName, Arrays.toString(pjp.getArgs()));

        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();

            // 成功日志
            log.info("[{}] {}.{} 成功, 耗时: {}ms",
                operation, className, methodName, System.currentTimeMillis() - start);
            return result;
        } catch (Exception e) {
            // 失败日志
            log.error("[{}] {}.{} 失败: {}",
                operation, className, methodName, e.getMessage(), e);
            throw e;
        }
    }
}

// 使用
@Service
public class UserService {

    @OperLog("创建用户")
    public void createUser(User user) {
        userMapper.insert(user);
    }

    @OperLog("删除用户")
    public void deleteUser(Long id) {
        userMapper.deleteById(id);
    }

    @OperLog("更新用户")
    public void updateUser(User user) {
        userMapper.updateById(user);
    }
}
```

**好处**：
1. 核心业务逻辑不再被日志代码污染
2. 所有方法的日志格式统一
3. 可以集中管理和修改

## 场景三：性能监控

### 需求

- 记录每个方法的执行时间
- 超过阈值的记录警告日志
- 关键方法慢查询追踪

### 实现

```java
// 定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Performance {
    long warnThreshold() default 1000;  // 警告阈值（毫秒）
}

// 定义切面
@Aspect
@Component
@Slf4j
public class PerformanceAspect {

    @Around("@annotation(performance)")
    public Object around(ProceedingJoinPoint pjp, Performance performance) throws Throwable {
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        String className = signature.getDeclaringType().getSimpleName();
        String methodName = signature.getName();

        long start = System.currentTimeMillis();
        try {
            return pjp.proceed();
        } finally {
            long duration = System.currentTimeMillis() - start;
            long warnThreshold = performance.warnThreshold();

            if (duration > warnThreshold) {
                log.warn("⚠️ [性能警告] {}.{} 执行耗时: {}ms (阈值: {}ms)",
                    className, methodName, duration, warnThreshold);
            } else {
                log.debug("{}.{} 执行耗时: {}ms", className, methodName, duration);
            }

            // 超过 5 秒的详细记录
            if (duration > 5000) {
                log.error("🚨 [严重慢查询] {}.{} 执行耗时: {}ms, 参数: {}",
                    className, methodName, duration, Arrays.toString(pjp.getArgs()));
            }
        }
    }
}

// 使用
@Service
public class OrderService {

    @Performance(warnThreshold = 500)  // 超过 500ms 警告
    public Page&lt;Order&gt; searchOrders(OrderQuery query) {
        return orderMapper.search(query);
    }

    @Performance(warnThreshold = 1000)  // 超过 1s 警告
    public OrderDetail getOrderDetail(Long orderId) {
        // 查询订单详情
    }

    @Performance  // 使用默认阈值 1000ms
    public void exportOrders(ExportQuery query) {
        // 导出订单
    }
}
```

### 日志输出示例

```
2024-01-15 10:00:01 [PerformanceAspect] INFO - orderService.searchOrders 执行耗时: 320ms
2024-01-15 10:00:05 [PerformanceAspect] WARN - ⚠️ [性能警告] orderService.getOrderDetail 执行耗时: 1500ms (阈值: 1000ms)
2024-01-15 10:01:00 [PerformanceAspect] ERROR - 🚨 [严重慢查询] orderService.exportOrders 执行耗时: 8500ms, 参数: [...]
```

## 场景四：权限校验

### 需求

- 接口需要登录才能访问
- 某些接口需要特定角色
- 某些接口需要特定权限

### 实现

```java
// 定义注解
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresPermission {
    String value();  // 权限码
}

// 定义切面
@Aspect
@Component
@Slf4j
public class SecurityAspect {

    @Autowired
    private UserContext userContext;  // 当前用户上下文

    @Around("@annotation(requiresPermission)")
    public Object around(ProceedingJoinPoint pjp, RequiresPermission requiresPermission) throws Throwable {
        String requiredPermission = requiresPermission.value();

        // 1. 检查是否登录
        if (!userContext.isAuthenticated()) {
            throw new UnauthorizedException("请先登录");
        }

        // 2. 检查是否有权限
        if (!userContext.hasPermission(requiredPermission)) {
            log.warn("权限不足: 需要权限 {}, 当前用户: {}",
                requiredPermission, userContext.getCurrentUser());
            throw new ForbiddenException("权限不足");
        }

        // 3. 继续执行
        return pjp.proceed();
    }
}

// 用户上下文
@Component
public class UserContext {

    private static final ThreadLocal&lt;User&gt; currentUser = new ThreadLocal&lt;&gt;();

    public boolean isAuthenticated() {
        return currentUser.get() != null;
    }

    public boolean hasPermission(String permission) {
        User user = currentUser.get();
        if (user == null) {
            return false;
        }
        // 检查用户权限
        return user.getPermissions().contains(permission);
    }

    public User getCurrentUser() {
        return currentUser.get();
    }
}

// 异常定义
public class UnauthorizedException extends RuntimeException {
    public UnauthorizedException(String message) {
        super(message);
    }
}

public class ForbiddenException extends RuntimeException {
    public ForbiddenException(String message) {
        super(message);
    }
}

// 使用
@RestController
@RequestMapping("/api/admin")
public class AdminController {

    @RequiresPermission("user:create")
    @PostMapping("/users")
    public Result&lt;User&gt; createUser(@RequestBody UserDTO dto) {
        // 只有拥有 user:create 权限才能访问
    }

    @RequiresPermission("user:delete")
    @DeleteMapping("/users/{id}")
    public Result&lt;Void&gt; deleteUser(@PathVariable Long id) {
        // 只有拥有 user:delete 权限才能访问
    }

    @RequiresPermission("role:assign")
    @PostMapping("/roles/assign")
    public Result&lt;Void&gt; assignRole(@RequestBody RoleAssignDTO dto) {
        // 只有拥有 role:assign 权限才能访问
    }
}
```

## 更多应用场景

### 1. 统一异常处理

```java
@Aspect
@Component
public class ExceptionHandleAspect {

    @AfterThrowing(
        pointcut = "execution(* com.example..*(..))",
        throwing = "e"
    )
    public void handleException(JoinPoint pjp, Exception e) {
        // 统一记录异常日志
        // 发送告警通知
        // 返回统一的错误响应
    }
}
```

### 2. 数据校验

```java
@Aspect
@Component
public class ValidationAspect {

    @Before("execution(* com.example.service..*.save*(..)) || execution(* com.example.service..*.update*(..))")
    public void validate(JoinPoint pjp) {
        Object[] args = pjp.getArgs();
        for (Object arg : args) {
            if (arg instanceof Validatable) {
                ((Validatable) arg).validate();
            }
        }
    }
}
```

### 3. 审计日志

```java
@Aspect
@Component
public class AuditAspect {

    @Around("@annotation(auditable)")
    public Object around(ProceedingJoinPoint pjp, Auditable auditable) throws Throwable {
        String action = auditable.value();
        User currentUser = getCurrentUser();

        // 记录操作前的状态
        Object beforeState = getState(pjp);

        Object result = pjp.proceed();

        // 记录审计日志
        AuditLog log = new AuditLog();
        log.setUser(currentUser.getUsername());
        log.setAction(action);
        log.setTarget(getTarget(pjp));
        log.setBeforeState(beforeState);
        log.setAfterState(result);
        log.setTimestamp(new Date());
        auditLogMapper.insert(log);

        return result;
    }
}
```

## 面试核心问题

### Q1：AOP 在实际开发中有哪些应用场景？

1. **事务管理**：@Transactional
2. **日志记录**：统一日志、审计日志
3. **性能监控**：方法执行时间监控
4. **权限校验**：接口权限控制
5. **异常处理**：统一异常处理
6. **缓存**：@Cacheable
7. **数据校验**：参数校验

### Q2：自定义注解 + AOP 的开发模式有什么好处？

1. **声明式**：用注解声明意图，代码更简洁
2. **可读性**：业务方法专注于业务逻辑
3. **可维护性**：增强逻辑集中管理
4. **可复用**：注解可以在多处复用

### Q3：如何设计一个好的 AOP 注解？

1. **语义清晰**：注解名称要表达意图
2. **参数简洁**：必要的参数，不需要的不要加
3. **默认值合理**：大多数场景可以直接使用
4. **文档完善**：说明使用场景和示例

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    AOP 应用场景总结                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  事务管理                                                  │
│    → @Transactional → 简化事务控制                         │
│                                                            │
│  统一日志                                                  │
│    → @OperLog → 统一记录操作日志                         │
│                                                            │
│  性能监控                                                  │
│    → @Performance → 方法耗时监控                          │
│                                                            │
│  权限校验                                                  │
│    → @RequiresPermission → 接口权限控制                   │
│                                                            │
│  设计模式：自定义注解 + AOP 切面 = 声明式增强              │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Spring 事务管理：@Transactional 原理](/framework/spring/transaction) —— 从源码层面理解 @Transactional 是如何工作的。
