# 依赖注入源码：setAutowiredField() 过程

你有没有想过这个问题：当你写 `@Autowired private UserDao userDao;` 时，Spring 是怎么知道要注入哪个 UserDao 的？

为什么有多个实现时会报错？为什么有时注入的是 null？

今天，我们从源码层面，理解依赖注入的全过程。

## 依赖注入的入口

回顾 Bean 创建流程：

```java
protected Object doCreateBean(String beanName, RootBeanDefinition mbd, Object[] args) {
    // 1. 实例化
    BeanWrapper instanceWrapper = createBeanInstance(beanName, mbd, args);
    
    // 2. 加入三级缓存
    addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
    
    // 3. 属性填充 ← 这里做依赖注入
    populateBean(beanName, mbd, instanceWrapper);
    
    // 4. 初始化
    Object exposedObject = initializeBean(beanName, bean, mbd);
    
    return exposedObject;
}
```

`populateBean()` 是属性填充的核心方法，依赖注入就在这里发生。

## populateBean() 的完整流程

```java
protected void populateBean(String beanName, RootBeanDefinition mbd, BeanWrapper bw) {
    
    // 1. 实例化后置处理器（ InstantiationAwareBeanPostProcessor.postProcessAfterInstantiation()）
    // 返回 false 会跳过属性填充
    if (!mbd.isSynthetic() && hasInstantiationAwareBeanPostProcessors()) {
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                if (!ibp.postProcessAfterInstantiation(bw.getWrappedInstance(), beanName)) {
                    return;  // 跳过属性填充
                }
            }
        }
    }
    
    // 2. 获取属性值来源
    PropertyValues pvs = (mbd.hasPropertyValues() ? mbd.getPropertyValues() : null);
    
    // 3. 自动注入（按名称或按类型）
    if (mbd.getResolvedAutowireMode() == AUTOWIRE_BY_NAME || 
        mbd.getResolvedAutowireMode() == AUTOWIRE_BY_TYPE) {
        MutablePropertyValues mpvs = new MutablePropertyValues(pvs);
        
        // 按名称 autowire
        if (mbd.getResolvedAutowireMode() == AUTOWIRE_BY_NAME) {
            autowireByName(beanName, mbd, bw, mpvs);
        }
        
        // 按类型 autowire
        if (mbd.getResolvedAutowireMode() == AUTOWIRE_BY_TYPE) {
            autowireByType(beanName, mbd, bw, mpvs);
        }
        
        pvs = mpvs;
    }
    
    // 4. 属性填充后置处理器（处理 @Autowired、@Resource 等）
    if (hasInstantiationAwareBeanPostProcessors()) {
        PropertyValues pvsToUse = null;
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                // 这里处理 @Autowired 等注解
                pvsToUse = ibp.postProcessPropertyValues(pvs, pds, bw.getWrappedInstance(), beanName);
                if (pvsToUse == null) {
                    return;
                }
            }
        }
        pvs = pvsToUse;
    }
    
    // 5. 设置属性值
    if (pvs != null) {
        applyPropertyValues(beanName, mbd, bw, pvs);
    }
}
```

## AutowiredAnnotationBeanPostProcessor

Spring 使用 `AutowiredAnnotationBeanPostProcessor` 处理 `@Autowired`、`@Value`、`@Inject` 注解：

```java
public class AutowiredAnnotationBeanPostProcessor 
        extends InstantiationAwareBeanPostProcessorAdapter 
        implements MergedBeanDefinitionPostProcessor {
    
    // 存储所有带 @Autowired 的字段和方法
    private final Map&lt;Member, InjectionMetadata&gt; injectionMetadataCache = 
        new ConcurrentHashMap&lt;&gt;(256);
}
```

### 核心方法：postProcessPropertyValues()

```java
@Override
public PropertyValues postProcessPropertyValues(
        PropertyValues pvs, PropertyDescriptor[] pds, 
        Object bean, String beanName) throws BeansException {
    
    // 1. 获取注入元数据（字段和方法）
    InjectionMetadata metadata = findAutowiringMetadata(beanName, bean.getClass(), pvs);
    
    try {
        // 2. 执行注入
        metadata.inject(bean, beanName, pvs);
    }
    catch (BeanCreationException ex) {
        throw ex;
    }
    catch (Throwable ex) {
        throw new BeanCreationException(beanName, "Injection of @" +
            "Autowired dependencies failed", ex);
    }
    
    return pvs;
}
```

### findAutowiringMetadata() — 查找注入点

```java
private InjectionMetadata findAutowiringMetadata(String beanName, Class&lt;?&gt; clazz, 
        PropertyValues pvs) {
    
    // 1. 先查缓存
    String cacheKey = (String) (beanName != null ? beanName : clazz.getName());
    InjectionMetadata metadata = this.injectionMetadataCache.get(cacheKey);
    
    if (needsRefresh(metadata, clazz)) {
        synchronized (this.injectionMetadataCache) {
            metadata = this.injectionMetadataCache.get(cacheKey);
            if (needsRefresh(metadata, clazz)) {
                if (metadata != null) {
                    metadata.clear(pvs);
                }
                // 2. 构建注入元数据
                metadata = buildAutowiringMetadata(clazz);
                // 3. 放入缓存
                this.injectionMetadataCache.put(cacheKey, metadata);
            }
        }
    }
    return metadata;
}
```

### buildAutowiringMetadata() — 构建注入元数据

```java
private InjectionMetadata buildAutowiringMetadata(Class&lt;?&gt; clazz) {
    List&lt;InjectionMetadata.InjectedElement&gt; elements = new ArrayList&lt;&gt;();
    Class&lt;?&gt; targetClass = clazz;
    
    do {
        final List&lt;InjectionMetadata.InjectedElement&gt; currElements = new ArrayList&lt;&gt;();
        
        // 1. 处理字段
        ReflectionUtils.doWithLocalFields(targetClass, field -> {
            if (field.isAnnotationPresent(AutowiredAnnotationBeanPostProcessor.AutowiredAnnotation.class)) {
                if (Modifier.isStatic(field.getModifiers())) {
                    throw new BeanCreationException("Autowired annotation cannot be used on static fields");
                }
                // 创建注入元素
                currElements.add(new AutowiredFieldElement(field, true));
            }
        });
        
        // 2. 处理方法
        ReflectionUtils.doWithLocalMethods(targetClass, method -> {
            Method bridgedMethod = BridgeMethodResolver.findBridgedMethod(method);
            if (!bridgedMethod.isBridge() && 
                method.equals(bridgedMethod) &&
                method.isAnnotationPresent(AutowiredAnnotationBeanPostProcessor.AutowiredAnnotation.class)) {
                if (Modifier.isStatic(method.getModifiers())) {
                    throw new BeanCreationException("Autowired annotation cannot be used on static methods");
                }
                if (method.getParameterCount() == 0) {
                    throw new BeanCreationException("Autowired annotation requires at least one parameter");
                }
                // 创建注入元素
                currElements.add(new AutowiredMethodElement(method, true));
            }
        });
        
        elements.addAll(0, currElements);
        targetClass = targetClass.getSuperclass();
    }
    while (targetClass != null && targetClass != Object.class);
    
    return new InjectionMetadata(clazz, elements);
}
```

## InjectionMetadata.inject() — 执行注入

```java
public void inject(Object target, String beanName, PropertyValues pvs) throws Throwable {
    for (InjectedElement element : this.injectedElements) {
        element.inject(target, beanName, pvs);
    }
}
```

### AutowiredFieldElement — 字段注入

```java
private class AutowiredFieldElement extends InjectionMetadata.InjectedElement {
    
    private final boolean required;
    private volatile boolean cached;
    private volatile Object cachedFieldValue;
    
    @Override
    protected void inject(Object bean, String beanName, PropertyValues pvs) throws Throwable {
        Field field = (Field) this.member;
        Object value;
        
        // 1. 尝试从缓存获取（加速）
        if (this.cached) {
            value = resolveCachedArgument(beanName);
        }
        else {
            // 2. 创建依赖描述符
            DependencyDescriptor desc = new DependencyDescriptor(field, this.required);
            desc.setContainingClass(bean.getClass());
            
            // 3. 解析依赖
            value = beanFactory.resolveDependency(desc, beanName, autowiredBeanNames, typeConverter);
            
            // 4. 缓存
            this.cachedFieldValue = desc;
            this.cached = true;
        }
        
        // 5. 反射设置值
        ReflectionUtils.makeAccessible(field);
        field.set(bean, value);
    }
}
```

### AutowiredMethodElement — 方法注入

```java
private class AutowiredMethodElement extends InjectionMetadata.InjectedElement {
    
    private final boolean required;
    private volatile Object[] cachedMethodArguments;
    
    @Override
    protected void inject(Object bean, String beanName, PropertyValues pvs) throws Throwable {
        Method method = (Method) this.member;
        Object[] arguments;
        
        if (this.cached) {
            arguments = resolveCachedArguments(beanName);
        }
        else {
            // 1. 获取方法参数
            Class&lt;?&gt;[] paramTypes = method.getParameterTypes();
            arguments = new Object[paramTypes.length];
            
            for (int i = 0; i < arguments.length; i++) {
                DependencyDescriptor paramDesc = new DependencyDescriptor(
                    new MethodParameter(method, i), this.required);
                
                // 2. 解析每个参数
                arguments[i] = beanFactory.resolveDependency(paramDesc, beanName, 
                    autowiredBeanNames, typeConverter);
            }
            
            this.cachedMethodArguments = arguments;
        }
        
        // 3. 反射调用方法
        ReflectionUtils.makeAccessible(method);
        method.invoke(bean, arguments);
    }
}
```

## resolveDependency() — 解析依赖

这是依赖解析的核心方法：

```java
@Override
public Object resolveDependency(DependencyDescriptor descriptor, 
        String requestingBeanName, Set&lt;String&gt; autowiredBeanNames, 
        TypeConverter typeConverter) throws BeansException {
    
    // 1. 处理 Optional&lt;T&gt;
    if (descriptor.getDependencyType() == Optional.class) {
        return resolveOptionalDependency(descriptor, requestingBeanName, typeConverter);
    }
    
    // 2. 处理 ObjectFactory / Provider
    if (ObjectFactory.class == descriptor.getDependencyType() ||
        ObjectProvider.class == descriptor.getDependencyType()) {
        return new DependencyObjectProvider(descriptor, beanFactory);
    }
    
    // 3. 处理数组、集合类型
    if (descriptor.getDependencyType().isArray()) {
        return resolveArrayDependency(descriptor, requestingBeanName, typeConverter);
    }
    
    if (Collection.class.isAssignableFrom(descriptor.getDependencyType())) {
        return resolveCollectionDependency(descriptor, requestingBeanName, typeConverter);
    }
    
    // 4. 普通类型：按类型查找
    Map&lt;String, Object&gt; matchingBeans = findAutowireCandidates(
        requestingBeanName, descriptor.getDependencyType(), descriptor);
    
    // 5. 没有找到
    if (matchingBeans.isEmpty()) {
        if (descriptor.isRequired()) {
            raiseNoSuchBeanException(descriptor, requestingBeanName);
        }
        return null;
    }
    
    // 6. 找到一个，直接返回
    if (matchingBeans.size() == 1) {
        String beanName = matchingBeans.keySet().iterator().next();
        return matchingBeans.get(beanName);
    }
    
    // 7. 找到多个，使用 @Primary 或 @Qualifier 决定
    if (matchingBeans.size() > 1) {
        return resolveMultipleCandidates(matchingBeans, descriptor, requestingBeanName);
    }
    
    return null;
}
```

### findAutowireCandidates() — 查找候选 Bean

```java
protected Map&lt;String, Object&gt; findAutowireCandidates(
        String beanName, Class&lt;?&gt; requiredType, 
        DependencyDescriptor descriptor) {
    
    Map&lt;String, Object&gt; result = new LinkedHashMap&lt;&gt;(matchingBeans.size() + fallbackMatches);
    
    // 1. 按类型查找所有 Bean
    for (Map.Entry&lt;String, Object&gt; entry : getBeanFactory().getBeansOfType(requiredType, false, false).entrySet()) {
        result.put(entry.getKey(), entry.getValue());
    }
    
    // 2. 处理 @Primary
    String primaryBeanName = determinePrimaryCandidate(result);
    if (primaryBeanName != null) {
        // 标记 @Primary 的 Bean
    }
    
    // 3. 处理 @Qualifier
    if (hasQualifier(descriptor)) {
        // 根据 @Qualifier 过滤
    }
    
    return result;
}
```

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       依赖注入完整流程                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  populateBean()                                                        │
│       │                                                               │
│       ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ postProcessPropertyValues()                                     │  │
│  │         │                                                       │  │
│  │         ▼                                                       │  │
│  │  findAutowiringMetadata()                                       │  │
│  │         │                                                       │  │
│  │         ├── 查找 @Autowired 字段                                 │  │
│  │         └── 查找 @Autowired 方法                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│       │                                                               │
│       ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ metadata.inject()                                                │  │
│  │         │                                                       │  │
│  │         ├── AutowiredFieldElement.inject()                      │  │
│  │         │         │                                             │  │
│  │         │         ▼                                             │  │
│  │         │    resolveDependency()                                 │  │
│  │         │         │                                             │  │
│  │         │         ├── findAutowireCandidates() ← 按类型查找     │  │
│  │         │         ├── resolveMultipleCandidates() ← 多候选处理  │  │
│  │         │         └── field.set(bean, value) ← 反射注入         │  │
│  │         │                                                       │  │
│  │         └── AutowiredMethodElement.inject()                      │  │
│  │                   │                                             │  │
│  │                   └── method.invoke(bean, args) ← 反射调用     │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 多个候选 Bean 时如何选择？

### 有 @Qualifier

```java
@Service
public class OrderService {
    @Autowired
    @Qualifier("primaryUserDao")  // 指定名称
    private UserDao userDao;
}
```

### 有 @Primary

```java
@Component
@Primary
public class PrimaryUserDao implements UserDao {}

@Component
public class BackupUserDao implements UserDao {}

// OrderService 中：
@Autowired
private UserDao userDao;  // 注入 PrimaryUserDao
```

### 都没有，报错

```
No qualifying bean of type 'com.example.UserDao' available:
  expected single matching bean but found 2: primaryUserDao,backupUserDao
```

## 面试核心问题

### Q1：@Autowired 注解是如何被处理的？

通过 `AutowiredAnnotationBeanPostProcessor.postProcessPropertyValues()`：
1. 查找所有带 `@Autowired` 的字段和方法
2. 解析依赖（按类型查找 Bean）
3. 反射设置字段值或调用方法

### Q2：多个同类型 Bean 时如何选择？

1. 先看 `@Qualifier` 指定名称
2. 再看 `@Primary` 标记的
3. 都没有则报错

### Q3：resolveDependency() 方法的作用是什么？

根据 `DependencyDescriptor` 解析出对应的 Bean：
- 如果是 `Optional`，返回 `Optional.empty()` 或 `Optional.of(bean)`
- 如果是 `ObjectFactory`，返回工厂
- 如果是数组/集合，返回所有匹配的 Bean
- 如果是普通类型，返回一个或抛出异常

### Q4：依赖注入是在哪个阶段发生的？

在 `populateBean()` 阶段，属性填充时发生。

## 总结

依赖注入是一个精心设计的过程：

```
查找注入点 → 解析依赖 → 注入值

查找注入点：
  AutowiredAnnotationBeanPostProcessor
    → findAutowiringMetadata()
    → buildAutowiringMetadata()

解析依赖：
  resolveDependency()
    → findAutowireCandidates()
    → 处理 @Qualifier / @Primary
    → 多候选处理

注入值：
  field.set() / method.invoke()
```

理解这个过程，你就能理解 Spring 的依赖注入机制。

---

**下节预告**：[AOP 核心概念：切点、切面、通知、连接点](/framework/spring/aop-concept) —— 理解 AOP 的四大核心概念，打开 Spring 高级功能的大门。
