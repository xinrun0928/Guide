# Bean 创建流程：实例化、属性填充、初始化

上一节我们讲了 Spring 的启动流程，提到了 `refresh()` 方法是核心。

但你有没有想过：当 Spring 调用 `getBean()` 创建 Bean 时，到底发生了什么？

为什么有的 Bean 能自动注入依赖？为什么有的 Bean 会被代理？今天，让我们从源码层面理解 Bean 的创建过程。

## Bean 创建的完整流程

当 Spring 创建一个 Bean 时，它会经历以下三个核心阶段：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Bean 创建三阶段                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段一：实例化（Instantiation）                                   │  │
│  │   → 调用构造函数，创建 Java 对象                                  │  │
│  │   → 此时只有对象外壳，属性都是默认值                               │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段二：属性填充（Population）                                    │  │
│  │   → 注入 @Autowired、@Value 等标注的属性                          │  │
│  │   → 注入普通属性                                                  │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                │                                        │
│                                ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ 阶段三：初始化（Initialization）                                  │  │
│  │   → BeanPostProcessor.postProcessBeforeInitialization()        │  │
│  │   → @PostConstruct                                               │  │
│  │   → InitializingBean.afterPropertiesSet()                        │  │
│  │   → 自定义 init-method                                           │  │
│  │   → BeanPostProcessor.postProcessAfterInitialization()         │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 从 getBean() 开始

`getBean()` 是获取 Bean 的入口：

```java
public Object getBean(String name) throws BeansException {
    return doGetBean(name, null, null, false);
}
```

`doGetBean()` 是真正干活的方法：

```java
protected &lt;T&gt; T doGetBean(
        String name, Class&lt;T&gt; requiredType, Object[] args, boolean typeCheckOnly) {
    
    // 1. 转换 Bean 名称（去掉 & 前缀）
    String beanName = transformedBeanName(name);
    
    // 2. 尝试从缓存获取（解决循环依赖的关键）
    Object sharedInstance = getSingleton(beanName);
    if (sharedInstance != null && args == null) {
        // 缓存命中，返回
        return getObjectForBeanInstance(sharedInstance, name, beanName, null);
    }
    
    // 3. 缓存没有，创建新的 Bean
    // 检查是否存在循环依赖
    if (isPrototypeCurrentlyInCreation(beanName)) {
        throw new BeanCurrentlyInCreationException(beanName);
    }
    
    // 4. 获取父 BeanFactory
    BeanFactory parentBeanFactory = getParentBeanFactory();
    if (parentBeanFactory != null && !containsBeanDefinition(beanName)) {
        return parentBeanFactory.getBean(name, requiredType);
    }
    
    // 5. 创建 Bean ← 核心！
    if (mbd.isSingleton()) {
        // 单例：创建并缓存
        sharedInstance = getSingleton(beanName, () -> {
            return createBean(beanName, mbd, args);
        });
        return getObjectForBeanInstance(sharedInstance, name, beanName, mbd);
    }
    else if (mbd.isPrototype()) {
        // 原型：每次创建新实例
        Object prototypeInstance = createBean(beanName, mbd, args);
        return getObjectForBeanInstance(prototypeInstance, name, beanName, mbd);
    }
    // ...
}
```

## createBean()：核心创建逻辑

`createBean()` 是真正创建 Bean 的地方，它在 `AbstractAutowireCapableBeanFactory` 中：

```java
@Override
protected Object createBean(String beanName, RootBeanDefinition mbd, Object[] args)
        throws BeanCreationException {
    
    // 1. 解析 Bean 的类型（如果需要）
    Class&lt;?&gt; resolvedClass = resolveBeanClass(mbd, beanName);
    
    // 2. 方法覆写检查
    mbd.prepareMethodOverrides();
    
    // 3. 尝试使用 BeanPostProcessor 返回代理对象
    Object bean = resolveBeforeInstantiation(beanName, mbd);
    if (bean != null) {
        // 找到了代理，直接返回
        return bean;
    }
    
    // 4. 没有代理，正常创建
    Object beanInstance = doCreateBean(beanName, mbd, args);
    return beanInstance;
}
```

### resolveBeforeInstantiation()

在实例化之前，给 `BeanPostProcessor` 一个机会返回代理对象：

```java
protected Object resolveBeforeInstantiation(String beanName, RootBeanDefinition mbd) {
    Class&lt;?&gt; targetType = mbd.getTargetType();
    if (targetType != null) {
        // 应用后置处理器的前置通知
        if (!hasInstantiationAwareBeanPostProcessors()) {
            return null;
        }
        
        // 遍历 BeanPostProcessor
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                // 调用 postProcessBeforeInstantiation
                Object result = ibp.postProcessBeforeInstantiation(targetType, beanName);
                if (result != null) {
                    // 如果返回了对象，跳过实例化阶段
                    // 但仍会调用 postProcessAfterInitialization
                    result = applyBeanPostProcessorsAfterInitialization(result, beanName);
                    return result;
                }
            }
        }
    }
    return null;
}
```

**关键点**：如果某个 `InstantiationAwareBeanPostProcessor.postProcessBeforeInstantiation()` 返回了对象，Spring 会跳过实例化阶段，直接使用这个对象。

## doCreateBean()：三阶段的实现

`doCreateBean()` 是真正创建 Bean 的方法：

```java
protected Object doCreateBean(String beanName, RootBeanDefinition mbd, Object[] args)
        throws BeanCreationException {
    
    // 1. 实例化阶段
    BeanWrapper instanceWrapper = createBeanInstance(beanName, mbd, args);
    Object bean = instanceWrapper.getWrappedInstance();
    
    // 2. 加入三级缓存（解决循环依赖）
    addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
    
    // 3. 属性填充阶段
    populateBean(beanName, mbd, instanceWrapper);
    
    // 4. 初始化阶段
    Object exposedObject = initializeBean(beanName, bean, mbd);
    
    // 5. 注册销毁逻辑
    registerDisposableBeanIfNecessary(beanName, bean, mbd);
    
    return exposedObject;
}
```

### 阶段一：createBeanInstance() — 实例化

```java
protected BeanWrapper createBeanInstance(String beanName, RootBeanDefinition mbd, Object[] args) {
    // 1. 使用工厂方法创建
    if (mbd.getFactoryMethodName() != null) {
        return instantiateUsingFactoryMethod(beanName, mbd, args);
    }
    
    // 2. 使用构造器创建
    boolean resolved = mbd.isAutowireConstructor();
    if (resolved) {
        return autowireConstructor(beanName, mbd, null, args);
    }
    
    // 3. 使用默认构造器
    return instantiateBean(beanName, mbd);
}
```

`instantiateBean()` 使用 CGLIB 或反射创建实例：

```java
protected BeanWrapper instantiateBean(String beanName, RootBeanDefinition mbd) {
    try {
        Object beanInstance;
        
        if (System.getSecurityManager() != null) {
            // 安全模式
            beanInstance = AccessController.doPrivileged((PrivilegedAction&lt;Object&gt;) () -> {
                return this.beanUtils.instantiateClass(constructorToUse);
            }, getAccessControlContext());
        }
        else {
            // 普通模式：调用构造函数
            beanInstance = this.beanUtils.instantiateClass(constructorToUse, null);
        }
        
        return new BeanWrapperImpl(beanInstance);
    }
    catch (Throwable ex) {
        throw new BeanCreationException(mbd.getResourceDescription(), beanName, 
            "Instantiation of bean failed", ex);
    }
}
```

### 阶段二：populateBean() — 属性填充

实例化完成后，接下来是属性填充，也就是依赖注入：

```java
protected void populateBean(String beanName, RootBeanDefinition mbd, BeanWrapper bw) {
    // 1. 设置属性值之前的后置处理器
    if (!mbd.isSynthetic() && hasInstantiationAwareBeanPostProcessors()) {
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                // 如果返回 false，跳过属性填充
                if (!ibp.postProcessAfterInstantiation(bw.getWrappedInstance(), beanName)) {
                    continue;
                }
            }
        }
    }
    
    // 2. 获取属性值
    PropertyValues pvs = (mbd.hasPropertyValues() ? mbd.getPropertyValues() : null);
    
    // 3. 自动注入
    if (pvs == null) {
        if (mbd.getResolvedAutowireMode() == AUTOWIRE_BY_NAME || 
            mbd.getResolvedAutowireMode() == AUTOWIRE_BY_TYPE) {
            MutablePropertyValues mpvs = new MutablePropertyValues();
            // 自动注入 byName 或 byType
            autowireByName/ByType(...);
            pvs = mpvs;
        }
    }
    
    // 4. 属性值合并后的后置处理器
    if (pvs != null && hasInstantiationAwareBeanPostProcessors()) {
        for (BeanPostProcessor bp : getBeanPostProcessors()) {
            if (bp instanceof InstantiationAwareBeanPostProcessor) {
                InstantiationAwareBeanPostProcessor ibp = (InstantiationAwareBeanPostProcessor) bp;
                // 遍历 pvs，调用 postProcessPropertyValues
                pvs = ibp.postProcessPropertyValues(pvs, pds, bw.getWrappedInstance(), beanName);
                if (pvs == null) {
                    return;
                }
            }
        }
    }
    
    // 5. 设置属性值
    if (pvs != null) {
        applyPropertyValues(beanName, mbd, bw, pvs);
    }
}
```

**关键**：`AutowiredAnnotationBeanPostProcessor.postProcessPropertyValues()` 负责处理 `@Autowired`、`@Value`、`@Resource` 等注解。

### 阶段三：initializeBean() — 初始化

```java
protected Object initializeBean(String beanName, Object bean, RootBeanDefinition mbd) {
    // 1. 执行 Aware 接口回调
    if (System.getSecurityManager() != null) {
        AccessController.doPrivileged((PrivilegedAction&lt;Object&gt;) () -> {
            invokeAwareInterfaces(bean);
            return null;
        }, getAccessControlContext());
    }
    else {
        invokeAwareInterfaces(bean);
    }
    
    // 2. 执行前置处理器
    Object wrappedBean = bean;
    if (mbd == null || !mbd.isSynthetic()) {
        wrappedBean = applyBeanPostProcessorsBeforeInitialization(wrappedBean, beanName);
    }
    
    // 3. 执行初始化方法
    try {
        invokeInitMethods(beanName, wrappedBean, mbd);
    }
    catch (Throwable ex) {
        throw new BeanCreationException(...);
    }
    
    // 4. 执行后置处理器
    if (mbd == null || !mbd.isSynthetic()) {
        wrappedBean = applyBeanPostProcessorsAfterInitialization(wrappedBean, beanName);
    }
    
    return wrappedBean;
}
```

#### invokeAwareInterfaces() — Aware 回调

Spring 提供了一系列 Aware 接口，让 Bean 可以感知容器：

```java
private void invokeAwareInterfaces(Object bean) {
    if (bean instanceof Aware) {
        if (bean instanceof BeanNameAware) {
            ((BeanNameAware) bean).setBeanName(beanName);
        }
        if (bean instanceof BeanClassLoaderAware) {
            ((BeanClassLoaderAware) bean).setBeanClassLoader(getBeanClassLoader());
        }
        if (bean instanceof BeanFactoryAware) {
            ((BeanFactoryAware) bean).setBeanFactory(this);
        }
    }
    // 还有 ApplicationContextAware、EnvironmentAware 等
}
```

#### invokeInitMethods() — 初始化方法

```java
protected void invokeInitMethods(String beanName, Object bean, RootBeanDefinition mbd) {
    boolean isInitializingBean = (bean instanceof InitializingBean);
    
    // 1. 先调用 InitializingBean.afterPropertiesSet()
    if (isInitializingBean) {
        ((InitializingBean) bean).afterPropertiesSet();
    }
    
    // 2. 再调用自定义 init-method
    if (mbd.hasInitMethodName()) {
        String initMethodName = mbd.getInitMethodName();
        Method initMethod = mbd.getResolvedAutowireMode() == INFER_METHOD 
            ? null : ClassUtils.getMethod(ifc, initMethodName);
        if (initMethod != null) {
            ReflectionUtils.makeAccessible(initMethod);
            ReflectionUtils.invokeMethod(initMethod, bean);
        }
    }
}
```

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Bean 创建完整流程图                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  getBean("userService")                                                │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ doGetBean()                                                     │   │
│  │   ├── getSingleton() → 缓存中有？直接返回                        │   │
│  │   └── 没有 → createBean()                                      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ createBean()                                                    │   │
│  │   ├── resolveBeforeInstantiation() → 尝试返回代理               │   │
│  │   └── 没有代理 → doCreateBean()                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                                               │
│         ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ doCreateBean()                                                   │   │
│  │                                                                 │   │
│  │   ┌─────────────────────────────────────────────────────────┐   │   │
│  │   │ 阶段一：createBeanInstance() — 实例化                     │   │   │
│  │   │   ├── 工厂方法 → instantiateUsingFactoryMethod()         │   │   │
│  │   │   ├── 构造器 → autowireConstructor()                    │   │   │
│  │   │   └── 默认 → instantiateBean()（反射/CGLIB）            │   │   │
│  │   └─────────────────────────────────────────────────────────┘   │   │
│  │                            │                                   │   │
│  │                            ▼                                   │   │
│  │   ┌─────────────────────────────────────────────────────────┐   │   │
│  │   │ 阶段二：populateBean() — 属性填充                        │   │   │
│  │   │   └── 依赖注入：@Autowired、@Resource、@Value            │   │   │
│  │   └─────────────────────────────────────────────────────────┘   │   │
│  │                            │                                   │   │
│  │                            ▼                                   │   │
│  │   ┌─────────────────────────────────────────────────────────┐   │   │
│  │   │ 阶段三：initializeBean() — 初始化                        │   │   │
│  │   │   ├── invokeAwareInterfaces() → Aware 回调               │   │   │
│  │   │   ├── postProcessBeforeInitialization()                 │   │   │
│  │   │   ├── @PostConstruct                                   │   │   │
│  │   │   ├── InitializingBean.afterPropertiesSet()             │   │   │
│  │   │   ├── 自定义 init-method                                │   │   │
│  │   │   └── postProcessAfterInitialization()                 │   │   │
│  │   └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  │   ┌─────────────────────────────────────────────────────────┐   │   │
│  │   │ 收尾：registerDisposableBean()                          │   │   │
│  │   └─────────────────────────────────────────────────────────┘   │   │
│  │                                                                 │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│         │                                                               │
│         ▼                                                               │
│  返回完整的 Bean 实例                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试核心问题

### Q1：Bean 创建的三个阶段是什么？

1. **实例化**：调用构造函数创建对象
2. **属性填充**：注入依赖（@Autowired、@Resource 等）
3. **初始化**：执行Aware回调、@PostConstruct、InitializingBean 等

### Q2：BeanPostProcessor 在哪个阶段被调用？

- `postProcessBeforeInitialization()` 在初始化之前被调用
- `postProcessAfterInitialization()` 在初始化之后被调用

### Q3：Aware 接口的作用是什么？

让 Bean 可以感知到容器的存在，获得容器注入的信息：

- `BeanNameAware`：获得 Bean 的名称
- `BeanFactoryAware`：获得 BeanFactory
- `ApplicationContextAware`：获得 ApplicationContext

### Q4：Spring 如何决定使用哪个构造器创建 Bean？

1. 如果配置了工厂方法，使用工厂方法
2. 如果配置了 `@Autowired` 构造器，使用该构造器
3. 否则使用默认构造器

## 总结

Bean 的创建过程是一个精心设计的流程：

```
实例化 → 属性填充 → 初始化

实例化：
  反射/CGLIB → 创建空壳对象

属性填充：
  @Autowired/@Resource → 注入依赖

初始化：
  Aware回调 → 前置处理 → init方法 → 后置处理
```

理解这个流程，你就能理解 Spring 的各种扩展机制。

---

**下节预告**：[BeanPostProcessor 与前置/后置处理器](/framework/spring/bean-post-processor) —— 深入理解 Spring 的扩展点机制。
