# BeanPostProcessor 与前置/后置处理器

你知道吗？当你使用 `@Autowired`、`@Async`、`@Transactional` 这些注解时，它们的功能都是通过 `BeanPostProcessor` 来实现的。

Spring 正是通过这个扩展点，实现了大量的核心功能。

## 什么是 BeanPostProcessor？

`BeanPostProcessor` 是 Spring 提供的一个扩展接口，允许你在 Bean 初始化前后做一些自定义处理：

```java
public interface BeanPostProcessor {
    
    // 初始化之前调用
    Object postProcessBeforeInitialization(Object bean, String beanName) 
        throws BeansException;
    
    // 初始化之后调用
    Object postProcessAfterInitialization(Object bean, String beanName) 
        throws BeansException;
}
```

**特点**：
- `BeanPostProcessor` 会对**容器中所有 Bean** 生效
- 它是在 Bean 创建流程中被调用的
- 可以返回代理对象替换原始对象

## 两个方法的调用时机

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BeanPostProcessor 调用时机                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Bean 实例化                                                            │
│       │                                                                │
│       ▼                                                                │
│  属性填充（@Autowired 等）                                              │
│       │                                                                │
│       ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ BeanPostProcessor.postProcessBeforeInitialization()              │  │
│  │   ← 这里可以返回代理对象                                          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│       │                                                                │
│       ▼                                                                │
│  初始化方法                                                            │
│  ├── @PostConstruct                                                   │
│  ├── InitializingBean.afterPropertiesSet()                            │
│  └── 自定义 init-method                                               │
│       │                                                                │
│       ▼                                                                │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ BeanPostProcessor.postProcessAfterInitialization()               │  │
│  │   ← 这里也可以返回代理对象                                        │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│       │                                                                │
│       ▼                                                                │
│  Bean 就绪                                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 自定义 BeanPostProcessor

### 示例一：记录 Bean 初始化日志

```java
@Component
public class LoggingBeanPostProcessor implements BeanPostProcessor {
    
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        System.out.println("初始化之前: " + beanName);
        return bean;  // 返回原始对象，或返回代理对象
    }
    
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        System.out.println("初始化之后: " + beanName + " → " + bean.getClass().getName());
        return bean;
    }
}
```

### 示例二：创建代理对象

```java
@Component
public class TimingBeanPostProcessor implements BeanPostProcessor {
    
    @Override
    public Object postProcessBeforeInitialization(Object bean, String beanName) {
        // 这里返回的什么，Bean 就变成什么
        // 如果返回代理，Bean 就变成代理对象
        return bean;
    }
    
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        // 假设我们想给某些服务添加性能监控
        if (shouldProxy(beanName)) {
            return createProxy(bean);
        }
        return bean;
    }
    
    private boolean shouldProxy(String beanName) {
        // 只给 Service 层的 Bean 添加监控
        return beanName.endsWith("Service");
    }
}
```

## Spring 内置的 BeanPostProcessor

Spring 内置了很多 `BeanPostProcessor`，它们完成了 Spring 的核心功能：

### 1. AutowiredAnnotationBeanPostProcessor

处理 `@Autowired`、`@Value`、`@Inject` 注解：

```java
// 内部调用链：
postProcessProperties() / postProcessPropertyValues()
    → 查找带有 @Autowired 等注解的属性/方法
    → 解析依赖
    → 注入值
```

### 2. CommonAnnotationBeanPostProcessor

处理 JavaEE 通用注解：

- `@Resource`（依赖注入）
- `@PostConstruct`（初始化回调）
- `@PreDestroy`（销毁回调）

### 3. AnnotationAwareAspectJAutoProxyCreator

创建 AOP 代理：

```java
// 内部调用链：
postProcessBeforeInitialization()
postProcessAfterInitialization()
    → 检查 Bean 是否有匹配的切点
    → 如果有，创建代理对象
    → 返回代理对象替代原始对象
```

### 4. ApplicationContextAwareProcessor

注入各种 Aware 接口：

```java
// 处理以下 Aware 接口：
// - EnvironmentAware
// - EmbeddedValueResolverAware
// - ResourceLoaderAware
// - ApplicationEventPublisherAware
// - MessageSourceAware
// - ApplicationContextAware
```

### 5. RequiredAnnotationBeanPostProcessor

处理 `@Required` 注解（已过时）。

## InstantiationAwareBeanPostProcessor

这是一个特殊的 `BeanPostProcessor`，它增加了**实例化前**的处理能力：

```java
public interface InstantiationAwareBeanPostProcessor extends BeanPostProcessor {
    
    // 实例化之前调用
    Object postProcessBeforeInstantiation(Class&lt;?&gt; beanClass, String beanName)
        throws BeansException;
    
    // 实例化之后、属性填充之前调用
    boolean postProcessAfterInstantiation(Object bean, String beanName)
        throws BeansException;
    
    // 属性填充之前调用
    PropertyValues postProcessPropertyValues(
        PropertyValues pvs, PropertyDescriptor[] pds, 
        Object bean, String beanName) throws BeansException;
}
```

```
BeanPostProcessor 扩展方法：
                              │
                              ▼
postProcessBeforeInstantiation() ← InstantiationAwareBeanPostProcessor
                              │
                              ▼
                         实例化
                              │
                              ▼
postProcessAfterInstantiation() ← InstantiationAwareBeanPostProcessor
                              │
                              ▼
                         属性填充
                              │
                              ▼
postProcessPropertyValues() ← InstantiationAwareBeanPostProcessor
                              │
                              ▼
postProcessBeforeInitialization() ← BeanPostProcessor
                              │
                              ▼
                         初始化
                              │
                              ▼
postProcessAfterInitialization() ← BeanPostProcessor
```

## SmartInstantiationAwareBeanPostProcessor

更进一步，这个接口可以预测 Bean 的类型：

```java
public interface SmartInstantiationAwareBeanPostProcessor 
        extends InstantiationAwareBeanPostProcessor {
    
    // 预测 Bean 的类型
    Class&lt;?&gt; predictBeanType(Class&lt;?&gt; beanClass, String beanName) 
        throws BeansException;
    
    // 选择构造器
    Constructor&lt;?&gt;[] determineCandidateConstructors(
        Class&lt;?&gt; beanClass, String beanName) throws BeansException;
    
    // 获取早期引用
    Object getEarlyBeanReference(Object bean, String beanName) 
        throws BeansException;
}
```

`getEarlyBeanReference()` 是解决循环依赖的关键：

```java
@Override
public Object getEarlyBeanReference(Object bean, String beanName) {
    // 创建代理对象，用于解决循环依赖
    if (hasThisAspect(bean)) {
        return createAopProxy().getProxy(bean);
    }
    return bean;
}
```

## 实战：自定义注解处理器

假设我们想实现一个自定义注解 `@LogExecutionTime`，自动记录方法执行时间：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface LogExecutionTime {
}
```

**方案一：使用 AOP**（推荐）

```java
@Aspect
@Component
public class TimingAspect {
    
    @Around("@annotation(LogExecutionTime)")
    public Object logExecutionTime(ProceedingJoinPoint joinPoint) throws Throwable {
        long start = System.currentTimeMillis();
        
        Object result = joinPoint.proceed();
        
        long duration = System.currentTimeMillis() - start;
        System.out.println(joinPoint.getSignature() + " 执行时间: " + duration + "ms");
        
        return result;
    }
}
```

**方案二：使用 BeanPostProcessor**（不推荐，仅演示）

```java
@Component
public class TimingBeanPostProcessor implements BeanPostProcessor {
    
    @Override
    public Object postProcessAfterInitialization(Object bean, String beanName) {
        // 使用 JDK 动态代理包装
        return Proxy.newProxyInstance(
            bean.getClass().getClassLoader(),
            bean.getClass().getInterfaces(),
            (proxy, method, args) -> {
                if (method.isAnnotationPresent(LogExecutionTime.class)) {
                    long start = System.nanoTime();
                    Object result = method.invoke(bean, args);
                    long duration = System.nanoTime() - start;
                    System.out.println(method.getName() + " 执行时间: " + duration + "ns");
                    return result;
                }
                return method.invoke(bean, args);
            }
        );
    }
}
```

## 注意事项

### 1. 顺序很重要

如果多个 `BeanPostProcessor` 都想处理同一个 Bean，可以通过实现 `Ordered` 接口控制顺序：

```java
@Component
public class FirstBeanPostProcessor implements BeanPostProcessor, Ordered {
    
    @Override
    public int getOrder() {
        return 1;  // 数字越小，越先执行
    }
    // ...
}

@Component
public class SecondBeanPostProcessor implements BeanPostProcessor, Ordered {
    
    @Override
    public int getOrder() {
        return 2;  // 后执行
    }
    // ...
}
```

### 2. 不要在 BeanPostProcessor 中依赖未初始化的 Bean

```java
@Component
public class BadBeanPostProcessor implements BeanPostProcessor {
    
    @Autowired
    private ApplicationContext context;  // 可能在某些场景下出问题
    
    // ...
}
```

### 3. postProcessBeforeInitialization vs postProcessAfterInitialization

| 方法 | 时机 | 典型用途 |
|-----|-----|---------|
| `postProcessBeforeInitialization` | 初始化方法执行前 | 执行 `@PostConstruct`、Aware 回调 |
| `postProcessAfterInitialization` | 初始化方法执行后 | 创建 AOP 代理 |

## 面试核心问题

### Q1：BeanPostProcessor 的作用是什么？

`BeanPostProcessor` 是 Spring 的扩展点，允许在 Bean 初始化前后做自定义处理。它可以：
- 修改 Bean 的属性
- 返回代理对象替代原始对象
- 实现各种注解功能（@Autowired、@Async、@Transactional 等）

### Q2：BeanPostProcessor 和 BeanFactoryPostProcessor 的区别？

| 区别 | BeanFactoryPostProcessor | BeanPostProcessor |
|-----|------------------------|-------------------|
| 时机 | BeanDefinition 加载后、Bean 实例化前 | Bean 实例化后、初始化前后 |
| 操作对象 | BeanDefinition | Bean 实例 |
| 用途 | 修改 Bean 定义、解析配置类 | 依赖注入、AOP 代理 |

### Q3：Spring 是如何通过 BeanPostProcessor 实现 @Autowired 的？

`AutowiredAnnotationBeanPostProcessor.postProcessProperties()` 实现了 `@Autowired`：
1. 扫描带有 `@Autowired` 的字段和方法
2. 根据类型查找匹配的 Bean
3. 通过反射注入依赖

### Q4：BeanPostProcessor 的执行顺序可以控制吗？

可以。通过实现 `Ordered` 或 `PriorityOrdered` 接口，数字越小优先级越高。

## 总结

`BeanPostProcessor` 是 Spring 最核心的扩展机制之一：

```
Bean 创建流程中的扩展点：

实例化前 → postProcessBeforeInstantiation() [InstantiationAwareBeanPostProcessor]
     ↓
实例化 → 构造函数
     ↓
实例化后 → postProcessAfterInstantiation() [InstantiationAwareBeanPostProcessor]
     ↓
属性填充 → postProcessPropertyValues() [InstantiationAwareBeanPostProcessor]
     ↓
初始化前 → postProcessBeforeInitialization()
     ↓
初始化方法
     ↓
初始化后 → postProcessAfterInitialization()
```

掌握这个机制，你就能理解 Spring 的大部分魔法。

---

**下节预告**：[BeanFactoryPostProcessor 与属性占位符替换](/framework/spring/bfpp) —— 理解 Spring 如何修改 Bean 定义，以及 ${} 占位符是如何工作的。
