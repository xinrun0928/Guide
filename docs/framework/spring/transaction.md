# Spring 事务管理：@Transactional 原理

你一定用过 `@Transactional` 注解：

```java
@Service
public class OrderService {

    @Transactional
    public void createOrder(Order order) {
        // 这段代码会在事务中执行
        // 出错自动回滚
    }
}
```

但你知道它是怎么实现的吗？为什么有时候 `@Transactional` 会失效？

今天，我们从源码层面理解 Spring 事务管理。

## 事务管理核心组件

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 事务管理架构                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  PlatformTransactionManager（事务管理器接口）                          │
│       │                                                               │
│       ├── DataSourceTransactionManager → JDBC 事务                    │
│       ├── JpaTransactionManager → JPA 事务                            │
│       ├── HibernateTransactionManager → Hibernate 事务                 │
│       ├── JtaTransactionManager → 分布式事务                          │
│       └── ...                                                        │
│                                                                         │
│  TransactionDefinition（事务定义）                                     │
│       │                                                               │
│       ├── 传播行为                                                   │
│       ├── 隔离级别                                                   │
│       ├── 超时时间                                                   │
│       └── 是否只读                                                   │
│                                                                         │
│  TransactionStatus（事务状态）                                         │
│       │                                                               │
│       ├── 是否新事务                                                  │
│       ├── 是否已完成                                                  │
│       └── 是否有保存点                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## @Transactional 的工作原理

### 1. 启用事务注解

```java
@Configuration
@EnableTransactionManagement  // 启用事务管理（Spring Boot 自动启用）
public class AppConfig {
}
```

### 2. TransactionInterceptor

Spring 使用 `TransactionInterceptor` 来实现事务：

```java
@Aspect
public class TransactionInterceptor extends TransactionAspectSupport 
        implements MethodInterceptor {
    
    @Override
    public Object invoke(MethodInvocation invocation) throws Throwable {
        // 执行目标方法在事务中
        return execute(invocation.getMethod(), invocation.getThis().getClass(), 
            invocation.getArguments());
    }
}
```

### 3. BeanFactoryTransactionAttributeSourceAdvisor

Spring 使用 Advisor 来匹配 `@Transactional` 方法：

```java
public class BeanFactoryTransactionAttributeSourceAdvisor extends AbstractBeanFactoryPointcutAdvisor {
    private final TransactionAttributeSource transactionAttributeSource = 
        new AnnotationTransactionAttributeSource();
    // 匹配标注了 @Transactional 的方法
}
```

## 事务执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      @Transactional 执行流程                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 调用方法                                                          │
│     │                                                               │
│     ▼                                                               │
│  2. 进入代理对象                                                     │
│     │                                                               │
│     ▼                                                               │
│  3. TransactionInterceptor.invoke()                                   │
│     │                                                               │
│     ▼                                                               │
│  4. 获取事务属性（@Transactional 配置）                              │
│     │                                                               │
│     ▼                                                               │
│  5. 获取 TransactionManager                                           │
│     │                                                               │
│     ▼                                                               │
│  6. 调用 proceed() 执行                                           │
│     │                                                               │
│     ├── 6.1 开启事务（getTransaction）                              │
│     │                                                               │
│     ├── 6.2 执行目标方法                                           │
│     │                                                               │
│     ├── 6.3 提交事务（commit）或回滚（rollback）                  │
│     │                                                               │
│     ▼                                                               │
│  7. 返回结果                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## TransactionInterceptor 源码

```java
public class TransactionInterceptor extends TransactionAspectSupport {
    
    @Override
    public Object invoke(MethodInvocation invocation) throws Throwable {
        // 获取目标类
        Class<?> targetClass = (invocation.getThis() != null ? 
            invocation.getThis().getClass() : null);
        
        // 调用父类方法执行事务
        return execute(invocation.getMethod(), targetClass, invocation.getArguments());
    }
}
```

### TransactionAspectSupport.execute()

```java
protected Object execute(Method method, Class<?> targetClass, Object[] arguments) {
    // 1. 获取事务管理器
    PlatformTransactionManager tm = determineTransactionManager();
    
    // 2. 获取事务属性
    TransactionAttribute txAttr = determineTransactionAttribute(method, targetClass);
    
    // 3. 获取事务名称
    StringJoiner joiner = new StringJoiner(".");
    if (txAttr.getName() != null) {
        joiner.add(txAttr.getName());
    }
    String transactionName = joiner.toString();
    
    // 4. 开启事务
    TransactionInfo txInfo = createTransactionIfNecessary(tm, txAttr, transactionName);
    
    Object retVal;
    try {
        // 5. 执行目标方法
        retVal = invocation.proceed();
    }
    catch (Throwable ex) {
        // 6. 异常处理：决定是否回滚
        completeTransactionAfterThrowing(txInfo, ex);
        throw ex;
    }
    finally {
        // 7. 清理事务信息
        cleanupTransactionInfo(txInfo);
    }
    
    // 8. 提交事务
    commitTransactionAfterReturning(txInfo);
    
    return retVal;
}
```

## 事务开启：getTransaction()

```java
@Override
public final TransactionStatus getTransaction(TransactionDefinition definition) throws TransactionException {
    // 1. 获取数据库连接
    Connection connection = DataSourceUtils.getConnection(dataSource);
    
    // 2. 判断是否已有事务
    if (connection.isTransactionActive()) {
        // 已有事务，根据传播行为决定如何处理
        // ...
    }
    
    // 3. 开启新事务
    if (definition.getIsolationLevel() != TransactionDefinition.ISOLATION_DEFAULT) {
        connection.setTransactionIsolation(definition.getIsolationLevel());
    }
    
    // 4. 设置自动提交为 false
    connection.setAutoCommit(false);
    
    // 5. 创建 TransactionStatus
    return new DataTransactionManagerTransactionStatus(/* ... */);
}
```

## 异常处理：回滚还是提交？

```java
protected void completeTransactionAfterThrowing(TransactionInfo txInfo, Throwable ex) {
    // 1. 如果没有事务，直接抛出异常
    if (txInfo == null || txInfo.hasTransaction() == false) {
        throw ex;
    }
    
    // 2. 判断是否应该回滚
    // rollbackOn(ex) 方法决定是否回滚
    if (txInfo.transactionAttribute.rollbackOn(ex)) {
        try {
            // 3. 回滚事务
            txInfo.getTransactionManager().rollback(txInfo.getTransactionStatus());
        }
        catch (Throwable ex2) {
            throw new RuntimeException("Rollback failed", ex2);
        }
    }
    else {
        try {
            // 4. 异常不在回滚规则中，提交事务
            txInfo.getTransactionManager().commit(txInfo.getTransactionStatus());
        }
        catch (Throwable ex2) {
            throw new RuntimeException("Commit failed", ex2);
        }
    }
}
```

### rollbackOn() 的默认规则

```java
@Override
public boolean rollbackOn(Throwable ex) {
    // 默认规则：RuntimeException 和 Error 自动回滚
    // 其他异常（受检异常）默认不回滚
    return (ex instanceof RuntimeException || ex instanceof Error);
}
```

### 自定义回滚规则

```java
@Service
public class OrderService {
    
    // 所有异常都回滚
    @Transactional(rollbackFor = Exception.class)
    public void method1() {
        throw new Exception("回滚");
    }
    
    // 只有特定异常回滚
    @Transactional(rollbackFor = OrderException.class)
    public void method2() {
        throw new OrderException("回滚");
    }
    
    // 特定异常不回滚
    @Transactional(noRollbackFor = OrderException.class)
    public void method3() {
        throw new OrderException("不回滚");
    }
}
```

## 事务隔离级别

```java
public enum Isolation {
    DEFAULT(TransactionDefinition.ISOLATION_DEFAULT),          // 数据库默认
    READ_UNCOMMITTED(TransactionDefinition.ISOLATION_READ_UNCOMMITTED),  // 读未提交
    READ_COMMITTED(TransactionDefinition.ISOLATION_READ_COMMITTED),      // 读已提交
    REPEATABLE_READ(TransactionDefinition.ISOLATION_REPEATABLE_READ),   // 可重复读
    SERIALIZABLE(TransactionDefinition.ISOLATION_SERIALIZABLE);         // 串行化
}
```

### MySQL 默认可重复读，Oracle 默认读已提交

## 事务传播行为

| 传播行为 | 说明 |
|---------|-----|
| REQUIRED | 如果有事务，加入该事务；没有则创建新事务 |
| REQUIRES_NEW | 挂起当前事务，创建新事务 |
| SUPPORTS | 如果有事务，加入该事务；没有则以非事务执行 |
| NOT_SUPPORTED | 以非事务执行，挂起当前事务 |
| MANDATORY | 必须在事务中执行，否则抛异常 |
| NEVER | 必须在非事务中执行，否则抛异常 |
| NESTED | 如果有事务，在嵌套事务中执行；没有则创建新事务 |

## 面试核心问题

### Q1：@Transactional 是怎么工作的？

Spring 使用 `TransactionInterceptor`（一个方法拦截器）和 `BeanFactoryTransactionAttributeSourceAdvisor`（一个切面Advisor）来实现 `@Transactional`。当调用标注了 `@Transactional` 的方法时，拦截器会：

1. 获取事务属性
2. 开启事务
3. 执行目标方法
4. 根据异常决定回滚或提交

### Q2：哪些情况下 @Transactional 会失效？

1. 方法不是 public
2. 内部方法调用（this.method()）
3. 异常被 catch 捕获
4. 异常类型不在回滚规则内
5. 事务传播行为导致没有开启事务

### Q3：为什么内部方法调用不会触发事务？

因为 `this.method()` 调用的是目标对象的方法，不是代理对象的方法，所以不会经过 `TransactionInterceptor`。

## 总结

@Transactionl 的工作原理是通过 AOP 拦截方法，在方法执行前后进行事务控制：

1. 方法前：开启事务
2. 方法后：提交或回滚

理解这个原理，你就能理解事务失效的原因。

---

**下节预告**：[Spring 事务传播行为 7 种详解](/framework/spring/transaction-propagation) —— 深入理解 7 种传播行为，以及它们在嵌套调用时的行为。
