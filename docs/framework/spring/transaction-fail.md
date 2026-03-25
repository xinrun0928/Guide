# Spring 事务失效场景与解决方案

你一定遇到过这种情况：明明加了 `@Transactional`，但数据还是没回滚！

这通常是因为踩了 Spring 事务的「坑」。今天，我们来盘点事务失效的各种场景及解决方案。

## 事务失效场景一览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      事务失效场景                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ❌ 场景一：非 public 方法                                             │
│  ❌ 场景二：内部方法调用（self-invocation）                            │
│  ❌ 场景三：异常被 catch 捕获                                          │
│  ❌ 场景四：异常类型不匹配                                             │
│  ❌ 场景五：传播行为导致未开启事务                                     │
│  ❌ 场景六：多数据源未配置事务管理器                                     │
│  ❌ 场景七：rollbackFor 配置错误                                        │
│  ❌ 场景八：同类代理问题                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 场景一：非 public 方法

### 问题代码

```java
@Service
public class UserService {
    
    // ❌ 失效：private 方法不会被代理
    @Transactional
    private void createUser(User user) {
        userMapper.insert(user);
    }
    
    // ✅ 正确：public 方法
    @Transactional
    public void updateUser(User user) {
        userMapper.update(user);
    }
}
```

### 原因

Spring AOP 是基于代理的，只有 public 方法才会被代理。private 方法无法被拦截。

### 解决方案

```java
@Service
public class UserService {
    
    // ✅ 正确：使用 public 方法
    @Transactional
    public void createUser(User user) {
        // 业务逻辑
        doCreateUser(user);
    }
    
    private void doCreateUser(User user) {
        // 具体实现
        userMapper.insert(user);
    }
}
```

## 场景二：内部方法调用（self-invocation）

### 问题代码

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        // ❌ 失效：this 调用不走代理
        this.saveOrder(order);
        this.reduceStock(order);
    }
    
    @Transactional
    public void saveOrder(Order order) {
        orderMapper.insert(order);
    }
    
    @Transactional
    public void reduceStock(Order order) {
        inventoryMapper.reduce(order.getProductId());
    }
}
```

### 原因

`this.saveOrder()` 调用的是目标对象的方法，不是代理对象的方法，不会经过 `TransactionInterceptor`。

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      内部调用不经过代理                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  客户端 → 代理对象 → 目标对象 → this.method()                        │
│                          ↑                                              │
│                     直接调用，不经过代理                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 解决方案

#### 方案一：注入自身

```java
@Service
public class OrderService {
    
    @Autowired
    private OrderService self;  // 注入自身代理
    
    @Transactional
    public void createOrder(Order order) {
        // ✅ 通过代理调用
        self.saveOrder(order);
        self.reduceStock(order);
    }
    
    @Transactional
    public void saveOrder(Order order) {
        orderMapper.insert(order);
    }
}
```

#### 方案二：使用 AopContext

```java
@Service
public class OrderService {
    
    public void createOrder(Order order) {
        // ✅ 通过代理调用
        ((OrderService) AopContext.currentProxy()).saveOrder(order);
    }
    
    @Transactional
    public void saveOrder(Order order) {
        orderMapper.insert(order);
    }
}
```

需要在配置中启用：`@EnableAspectJAutoProxy(exposeProxy = true)`

#### 方案三：拆分为两个服务

```java
@Service
public class OrderService {
    
    @Autowired
    private OrderService self;
    @Autowired
    private StockService stockService;
    
    @Transactional
    public void createOrder(Order order) {
        self.saveOrder(order);  // 在同一个 Bean 内
        stockService.reduceStock(order);  // 调用其他 Bean
    }
}

@Service
public class StockService {
    
    @Transactional
    public void reduceStock(Long productId) {
        // 走代理
    }
}
```

## 场景三：异常被 catch 捕获

### 问题代码

```java
@Service
public class UserService {
    
    @Transactional
    public void createUser(User user) {
        try {
            userMapper.insert(user);
            // ❌ 失效：异常被捕获，事务管理器看不到异常
        } catch (Exception e) {
            log.error("创建用户失败", e);
        }
    }
}
```

### 原因

Spring 事务依靠异常来判断是否回滚。异常被 catch 后，事务管理器看不到异常，认为方法正常执行完成，就会提交事务。

### 解决方案

#### 方案一：重新抛出异常

```java
@Service
public class UserService {
    
    @Transactional
    public void createUser(User user) {
        try {
            userMapper.insert(user);
        } catch (Exception e) {
            log.error("创建用户失败", e);
            throw e;  // ✅ 重新抛出，让事务管理器看到
        }
    }
}
```

#### 方案二：手动回滚

```java
@Service
public class UserService {
    
    @Autowired
    private TransactionTemplate transactionTemplate;
    
    public void createUser(User user) {
        transactionTemplate.executeWithoutResult(status -> {
            try {
                userMapper.insert(user);
            } catch (Exception e) {
                log.error("创建用户失败", e);
                status.setRollbackOnly();  // ✅ 手动标记回滚
            }
        });
    }
}
```

## 场景四：异常类型不匹配

### 问题代码

```java
@Service
public class UserService {
    
    // ❌ 默认只回滚 RuntimeException 和 Error
    @Transactional
    public void createUser(User user) throws IOException {
        throw new IOException("IO 错误");  // IOException 是受检异常，不会回滚
    }
}
```

### 原因

Spring 默认的回滚规则：
- ✅ 回滚：`RuntimeException`、`Error`
- ❌ 不回滚：`Exception`（受检异常）

### 解决方案

```java
@Service
public class UserService {
    
    // ✅ 指定回滚的异常类型
    @Transactional(rollbackFor = IOException.class)
    public void createUser(User user) throws IOException {
        throw new IOException("IO 错误");
    }
    
    // ✅ 指定不回滚的异常类型
    @Transactional(noRollbackFor = BusinessException.class)
    public void handleBusiness(BusinessException e) {
        // 业务异常不回滚
    }
    
    // ✅ 多种异常
    @Transactional(rollbackFor = {IOException.class, SQLException.class})
    public void createUser(User user) throws Exception {
        // ...
    }
}
```

## 场景五：传播行为导致未开启事务

### 问题代码

```java
@Service
public class A {
    
    @Transactional
    public void methodA() {
        // 开启事务 T1
        b.methodB();  // REQUIRES_NEW，创建新事务 T2
    }
}

@Service
public class B {
    
    // ❌ SUPPORTS 如果没有外部事务，就以非事务运行
    @Transactional(propagation = Propagation.SUPPORTS)
    public void methodB() {
        // 如果外部没有事务，这里也不会开启事务
    }
}
```

### 解决方案

```java
@Service
public class B {
    
    // ✅ 使用 REQUIRED，确保有事务
    @Transactional(propagation = Propagation.REQUIRED)
    public void methodB() {
        // 加入外部事务，或创建新事务
    }
}
```

## 场景六：多数据源未配置事务管理器

### 问题代码

```java
// 配置了两个数据源
@Configuration
public class DataSourceConfig {
    
    @Bean
    @Primary
    public DataSource dataSource1() {
        return DataSourceBuilder.create().url("jdbc:mysql://localhost:3306/db1").build();
    }
    
    @Bean
    public DataSource dataSource2() {
        return DataSourceBuilder.create().url("jdbc:mysql://localhost:3306/db2").build();
    }
}

// 使用第二个数据源，但没指定事务管理器
@Service
public class SomeService {
    
    @Transactional  // ❌ 使用默认的 @Primary 数据源的事务管理器
    public void doSomething() {
        // 使用 dataSource2，但没有对应的事务管理器
    }
}
```

### 解决方案

```java
// 方案一：使用 @Transactional 指定事务管理器
@Service
public class SomeService {
    
    @Transactional("dataSource2TransactionManager")
    public void doSomething() {
        // 使用 dataSource2 的事务管理器
    }
}

// 方案二：使用 TransactionTemplate
@Service
public class SomeService {
    
    @Autowired
    @Qualifier("dataSource2TransactionManager")
    private TransactionTemplate transactionTemplate;
    
    public void doSomething() {
        transactionTemplate.execute(status -> {
            // 业务逻辑
            return null;
        });
    }
}
```

## 场景七：同类代理问题

### 问题代码

```java
@Service
public class UserService {
    
    @Transactional
    public void method1() {
        // 业务逻辑
    }
    
    // 同一个类内的方法调用
    public void method2() {
        // ❌ 直接调用 method1，不会走代理
        this.method1();
    }
}
```

### 原因

与场景二相同，内部方法调用不走代理。

### 解决方案

参考场景二的解决方案。

## 场景八：异步方法事务

### 问题代码

```java
@Service
public class UserService {
    
    @Async
    @Transactional
    public void asyncCreateUser(User user) {
        // ❌ 失效：异步方法在子线程执行，事务上下文丢失
        userMapper.insert(user);
    }
}
```

### 原因

`@Async` 方法在子线程中执行，而事务上下文存储在 ThreadLocal 中，子线程无法获取。

### 解决方案

```java
@Service
public class UserService {
    
    @Autowired
    private TransactionTemplate transactionTemplate;
    
    @Async
    public void asyncCreateUser(User user) {
        // ✅ 在子线程中显式开启事务
        transactionTemplate.executeWithoutResult(status -> {
            userMapper.insert(user);
        });
    }
}
```

## 事务失效检查清单

```
┌────────────────────────────────────────────────────────────┐
│                 事务失效检查清单                           │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  □ 1. 方法是否是 public？                                 │
│  □ 2. 是否有内部方法调用（this.method()）？                │
│  □ 3. 异常是否被 catch 了？                               │
│  □ 4. 异常是否是 RuntimeException 或 Error？               │
│  □ 5. 传播行为是否正确？                                  │
│  □ 6. 是否是多数据源场景？                                │
│  □ 7. 是否是异步方法？                                    │
│  □ 8. 是否正确配置了 rollbackFor？                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

## 面试核心问题

### Q1：@Transactional 失效的原因有哪些？

1. 非 public 方法
2. 内部方法调用
3. 异常被 catch
4. 异常类型不匹配
5. 传播行为错误
6. 多数据源未配置事务管理器
7. 异步方法

### Q2：为什么内部方法调用不会触发事务？

因为 `this.method()` 调用的是目标对象的方法，不是代理对象的方法，不会经过 `TransactionInterceptor`。

### Q3：为什么异步方法事务失效？

因为 `@Async` 方法在子线程执行，事务上下文存储在 ThreadLocal 中，子线程无法获取。

## 总结

Spring 事务的「坑」很多，记住以下原则：

```
┌────────────────────────────────────────────────────────────┐
│                   事务正确使用原则                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  1. 使用 public 方法                                       │
│  2. 避免内部方法调用，或注入自身代理                       │
│  3. 不要 catch 后不重新抛出                               │
│  4. 受检异常要配置 rollbackFor                            │
│  5. 确保传播行为正确                                       │
│  6. 多数据源要指定事务管理器                              │
│  7. 异步方法要显式使用 TransactionTemplate                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Spring MVC 请求处理流程](/framework/spring/mvc-flow) —— 从 DispatcherServlet 到 View 渲染，Spring MVC 是如何处理请求的？
