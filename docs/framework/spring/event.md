# Spring 事件机制：解耦的艺术

你有没有遇到过这种场景？

用户注册成功后，需要发送欢迎邮件、初始化用户数据、记录审计日志、更新统计数据……

如果全部写在注册方法里，代码会变成这样：

```java
public void register(User user) {
    userRepository.save(user);
    emailService.sendWelcomeEmail(user);        // 发送邮件
    dataInitService.initUserData(user);         // 初始化数据
    auditService.log("USER_REGISTER", user);    // 审计日志
    statisticsService.updateUserCount();        // 统计数据
}
```

注册逻辑和这些额外操作强耦合了。

Spring 的**事件机制**，就是来解决这个问题的。

## 事件机制的整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 事件发布订阅流程                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  事件发布者（Publisher）                                                │
│         │                                                               │
│         ▼                                                               │
│  ApplicationEventPublisher                                             │
│         │                                                               │
│         ▼                                                               │
│  ApplicationEventMulticaster                                           │
│         │                                                               │
│         ▼                                                               │
│  事件监听器（Listener）                                                 │
│         │                                                               │
│         ▼                                                               │
│  事件处理器（Handler）                                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心概念

### 事件三要素

```
事件发布者（Publisher）
    │
    │ 发布事件
    ▼
ApplicationEvent（事件）
    │
    │ 携带信息
    ▼
ApplicationListener（监听器）
    │
    │ 处理事件
    ▼
业务逻辑（Handler）
```

## 自定义事件

### 定义事件类

```java
// 方式一：继承 ApplicationEvent
public class UserRegisteredEvent extends ApplicationEvent {
    private final User user;

    public UserRegisteredEvent(Object source, User user) {
        super(source);
        this.user = user;
    }

    public User getUser() {
        return user;
    }
}

// 方式二：使用 PayloadApplicationEvent（Spring 4.2+）
// 直接发布任意对象作为事件
```

### 发布事件

```java
@Service
public class UserService {

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    public void register(User user) {
        // 1. 保存用户
        userRepository.save(user);

        // 2. 发布事件
        eventPublisher.publishEvent(new UserRegisteredEvent(this, user));
    }
}
```

### 监听事件

```java
// 方式一：实现 ApplicationListener 接口
@Component
public class EmailService implements ApplicationListener&lt;UserRegisteredEvent&gt; {

    @Override
    public void onApplicationEvent(UserRegisteredEvent event) {
        User user = event.getUser();
        sendWelcomeEmail(user);
    }
}

// 方式二：使用 @EventListener 注解（Spring 4.2+）
@Component
public class AuditService {

    @EventListener
    public void handleUserRegistered(UserRegisteredEvent event) {
        User user = event.getUser();
        log.info("用户注册: {}", user.getUsername());
    }
}
```

## @EventListener 详解

### 基本用法

```java
@Component
public class UserEventHandler {

    @EventListener
    public void handleUserCreated(UserCreatedEvent event) {
        System.out.println("处理用户创建事件: " + event.getUser().getName());
    }

    @EventListener
    public void handleUserUpdated(UserUpdatedEvent event) {
        System.out.println("处理用户更新事件: " + event.getUser().getName());
    }

    @EventListener
    public void handleUserDeleted(UserDeletedEvent event) {
        System.out.println("处理用户删除事件: " + event.getUserId());
    }
}
```

### 条件监听

```java
@Component
public class ConditionalEventHandler {

    // 只有当条件满足时才处理
    @EventListener(condition = "#event.type == 'VIP'")
    public void handleVipUser(UserRegisteredEvent event) {
        // 只处理 VIP 用户
        sendVipWelcomePackage(event.getUser());
    }

    // 条件表达式中可以访问事件属性
    @EventListener(condition = "'create' == #event.action")
    public void handleCreateAction(BusinessEvent event) {
        // 只处理 create 动作
    }
}
```

### 注解属性说明

```java
@Component
public class AdvancedEventHandler {

    // 指定监听的事件类型
    @EventListener(
        classes = UserRegisteredEvent.class
    )
    public void handle1(Object event) {
        // 可以监听多个类型
    }

    // 指定事件来源
    @EventListener(
        classes = UserRegisteredEvent.class,
        sources = "userService"  // 只监听来自 userService Bean 的事件
    )

    public void handle2(UserRegisteredEvent event) {
    }

    // 指定处理顺序
    @EventListener
    @Order(Ordered.HIGHEST_PRECEDENCE)  // 最高优先级
    public void handleFirst(UserRegisteredEvent event) {
        // 第一个处理
    }
}
```

## 异步事件处理

### @Async 异步处理

```java
@Configuration
@EnableAsync
public class AsyncConfig {
}

@Component
public class AsyncEventHandler {

    @Async  // 异步处理，不阻塞主线程
    @EventListener
    public void handleUserRegistered(UserRegisteredEvent event) {
        // 异步发送邮件
        emailService.sendWelcomeEmail(event.getUser());
    }
}
```

### @TransactionalEventListener 事务事件

```java
@Component
public class TransactionalEventHandler {

    // 事件在事务提交后才处理
    @TransactionalEventListener(
        phase = TransactionPhase.AFTER_COMMIT
    )
    public void handleAfterCommit(UserRegisteredEvent event) {
        // 事务提交后执行
    }

    // 事务回滚时不处理
    @TransactionalEventListener(
        phase = TransactionPhase.BEFORE_COMMIT
    )
    public void handleBeforeCommit(UserRegisteredEvent event) {
        // 事务提交前执行
        // 如果抛出异常，事务会回滚
    }

    // 事务回滚时处理
    @TransactionalEventListener(
        phase = TransactionPhase.AFTER_ROLLBACK
    )
    public void handleAfterRollback(UserRegisteredEvent event) {
        // 事务回滚后执行
    }
}
```

`TransactionPhase` 可选值：

| 值 | 说明 |
|----|------|
| BEFORE_COMMIT | 事务提交前 |
| AFTER_COMMIT | 事务提交后（默认） |
| AFTER_ROLLBACK | 事务回滚后 |
| AFTER_COMPLETION | 事务完成后（提交或回滚） |

## 事件继承

### 父类事件

```java
// 基础事件
public class BusinessEvent extends ApplicationEvent {
    private final String action;
    public BusinessEvent(Object source, String action) {
        super(source);
        this.action = action;
    }
}

// 用户事件继承基础事件
public class UserEvent extends BusinessEvent {
    private final User user;
    public UserEvent(Object source, String action, User user) {
        super(source, action);
        this.user = user;
    }
}

// 监听器监听父类事件
@Component
public class EventHandler {

    @EventListener
    public void handleBusinessEvent(BusinessEvent event) {
        // 监听所有 BusinessEvent 及其子类事件
        System.out.println("业务事件: " + event.getAction());
    }
}
```

## 泛型事件

### 泛型事件类

```java
// 泛型事件
public class EntityEvent&lt;T&gt; extends ApplicationEvent {
    private final T entity;
    private final EntityOperation operation;

    public EntityEvent(Object source, T entity, EntityOperation operation) {
        super(source);
        this.entity = entity;
        this.operation = operation;
    }

    public T getEntity() { return entity; }
    public EntityOperation getOperation() { return operation; }
}

public enum EntityOperation {
    CREATED, UPDATED, DELETED
}
```

### 监听特定泛型

```java
@Component
public class GenericEventHandler {

    // 监听 User 类型的泛型事件
    @EventListener
    public void handleUserEvent(EntityEvent&lt;User&gt; event) {
        switch (event.getOperation()) {
            case CREATED:
                onUserCreated(event.getEntity());
                break;
            case UPDATED:
                onUserUpdated(event.getEntity());
                break;
            case DELETED:
                onUserDeleted(event.getEntity());
                break;
        }
    }

    // 监听 Order 类型的泛型事件
    @EventListener
    public void handleOrderEvent(EntityEvent&lt;Order&gt; event) {
        switch (event.getOperation()) {
            case CREATED:
                onOrderCreated(event.getEntity());
                break;
            // ...
        }
    }
}
```

## 事件发布者基类

### 扩展 ApplicationEventPublisherAware

```java
@Component
public class UserService implements ApplicationEventPublisherAware {

    private ApplicationEventPublisher eventPublisher;

    @Override
    public void setApplicationEventPublisher(ApplicationEventPublisher eventPublisher) {
        this.eventPublisher = eventPublisher;
    }

    public void register(User user) {
        userRepository.save(user);
        eventPublisher.publishEvent(new UserRegisteredEvent(this, user));
    }
}
```

### 使用 @RequiredArgsConstructor（Lombok）

```java
@Service
public class UserService {

    private final ApplicationEventPublisher eventPublisher;

    public void register(User user) {
        userRepository.save(user);
        eventPublisher.publishEvent(new UserRegisteredEvent(this, user));
    }
}
```

## 事件监听器顺序

```java
@Component
public class OrderedHandlers {

    @EventListener
    @Order(Ordered.HIGHEST_PRECEDENCE)  // 第一个执行
    public void handler1(MyEvent event) {
        System.out.println("Handler 1");
    }

    @EventListener
    @Order(Ordered.LOWEST_PRECEDENCE)  // 最后一个执行
    public void handler2(MyEvent event) {
        System.out.println("Handler 2");
    }

    @EventListener
    @Order(5)  // 指定优先级数值
    public void handler3(MyEvent event) {
        System.out.println("Handler 3");
    }
}
```

## 实际应用场景

### 场景一：用户注册后触发多个操作

```java
// 1. 定义事件
public class UserRegisteredEvent extends ApplicationEvent {
    private final User user;
    public UserRegisteredEvent(Object source, User user) {
        super(source);
        this.user = user;
    }
    public User getUser() { return user; }
}

// 2. 发布事件
@Service
public class UserService {
    @Autowired
    private ApplicationEventPublisher publisher;

    public void register(User user) {
        userRepository.save(user);
        publisher.publishEvent(new UserRegisteredEvent(this, user));
    }
}

// 3. 监听事件
@Component
public class EmailListener {
    @Async
    @EventListener
    public void sendWelcomeEmail(UserRegisteredEvent event) {
        emailService.send(event.getUser());
    }
}

@Component
public class AuditListener {
    @EventListener
    public void logUserRegistration(UserRegisteredEvent event) {
        auditService.log("USER_REGISTERED", event.getUser().getId());
    }
}

@Component
public class StatisticsListener {
    @EventListener
    public void updateStats(UserRegisteredEvent event) {
        statisticsService.incrementUserCount();
    }
}
```

### 场景二：缓存清除事件

```java
public class CacheClearEvent extends ApplicationEvent {
    private final String cacheName;
    private final Object key;

    public CacheClearEvent(Object source, String cacheName, Object key) {
        super(source);
        this.cacheName = cacheName;
        this.key = key;
    }
}

@Component
public class CacheEventListener {

    @EventListener
    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void clearCache(CacheClearEvent event) {
        if (event.getKey() != null) {
            cacheManager.evict(event.getCacheName(), event.getKey());
        } else {
            cacheManager.clear(event.getCacheName());
        }
    }
}

// 发布缓存清除事件
@Service
public class UserService {
    @Autowired
    private ApplicationEventPublisher publisher;

    public void updateUser(User user) {
        userRepository.save(user);
        publisher.publishEvent(new CacheClearEvent(this, "users", user.getId()));
    }
}
```

## Spring Boot 事件

Spring Boot 在启动过程中会发布多个事件：

| 事件 | 说明 |
|-----|------|
| ApplicationStartingEvent | 应用启动中 |
| ApplicationEnvironmentPreparedEvent | 环境准备完成 |
| ApplicationPreparedEvent | 应用准备完成 |
| ContextRefreshedEvent | 上下文刷新完成 |
| ApplicationReadyEvent | 应用就绪 |
| ApplicationFailedEvent | 应用启动失败 |

### 监听 Spring Boot 事件

```java
@Component
public class ApplicationStartupListener 
        implements ApplicationListener&lt;ApplicationReadyEvent&gt; {

    @Override
    public void onApplicationEvent(ApplicationReadyEvent event) {
        System.out.println("应用已启动完成");
    }
}

// 或使用 @EventListener
@Component
public class AnotherListener {

    @EventListener
    public void onApplicationReady(ApplicationReadyEvent event) {
        System.out.println("应用就绪，可以开始接收请求");
    }

    @EventListener
    public void onApplicationFailed(ApplicationFailedEvent event) {
        System.out.println("应用启动失败: " + event.getException());
    }
}
```

## 常见问题

### 1. 事件监听器未执行

```java
// 检查一：是否在 Spring 管理的 Bean 中
@Component
public class MyListener {
    @EventListener
    public void handle(Object event) { }  // 需要 Spring 扫描到
}

// 检查二：是否异步执行且异常未捕获
@Async
@EventListener
public void handleAsync(MyEvent event) {
    // 异常会吞掉，使用 try-catch
}
```

### 2. 事务中发布事件

```java
@Service
public class UserService {

    @Transactional
    public void register(User user) {
        userRepository.save(user);
        publisher.publishEvent(new UserRegisteredEvent(this, user));
        // 此时事件已发布，但事务还未提交
        // 监听器中使用 @TransactionalEventListener 确保事务提交后执行
    }
}
```

### 3. 事件顺序不确定

```java
// 如果需要严格顺序，使用 @Order
@Component
public class OrderedHandler {

    @EventListener
    @Order(1)
    public void first(MyEvent event) { }

    @EventListener
    @Order(2)
    public void second(MyEvent event) { }
}
```

## 面试核心问题

### Q1：Spring 事件机制的原理？

基于观察者模式，`ApplicationEventPublisher` 发布事件，`ApplicationEventMulticaster` 广播给所有 `ApplicationListener`，监听器收到通知后执行相应逻辑。

### Q2：@EventListener 和 ApplicationListener 的区别？

| 特性 | @EventListener | ApplicationListener |
|-----|---------------|---------------------|
| 配置 | 注解方式 | 实现接口 |
| 泛型支持 | 原生支持 | 需要处理泛型 |
| 条件监听 | 支持 condition | 需要自己判断 |

### Q3：@TransactionalEventListener 的作用？

确保事件监听器在事务的特定阶段执行（如事务提交后），避免事务未提交但监听器已经执行导致的脏数据问题。

---

**下节预告**：[Spring 资源加载](/framework/spring/resource) —— 深入理解 Resource 和 ResourceLoader，以及 classpath、文件系统、URL 等资源的统一访问。
