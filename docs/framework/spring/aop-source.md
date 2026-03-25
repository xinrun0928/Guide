# AOP 源码解析：ProxyFactory 与 JdkDynamicAopProxy

上一节我们理解了 Spring AOP 如何选择代理方式。这一节，我们深入源码，看看 Spring 是如何创建和管理代理对象的。

## 核心类概述

Spring AOP 的核心类：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Spring AOP 核心类                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ProxyCreatorSupport                                                    │
│       │                                                               │
│       ├── 持有 ProxyFactory                                           │
│       └── 创建 AopProxy                                                │
│                                                                         │
│  ProxyFactory（继承 ProxyCreatorSupport）                               │
│       │                                                               │
│       ├── 设置目标对象                                                 │
│       ├── 添加切面                                                     │
│       └── 创建代理                                                     │
│                                                                         │
│  AopProxy（接口）                                                      │
│       │                                                               │
│       ├── JdkDynamicAopProxy → JDK 动态代理                           │
│       └── ObjenesisCglibAopProxy → CGLIB 动态代理                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## ProxyFactory 的创建流程

### 完整示例

```java
// 1. 创建 ProxyFactory，并设置目标对象
ProxyFactory proxyFactory = new ProxyFactory();
proxyFactory.setTarget(new UserServiceImpl());

// 2. 添加代理接口（可选）
proxyFactory.addInterface(UserService.class);

// 3. 添加通知/切面
proxyFactory.addAdvice(new TransactionInterceptor());  // 通知
proxyFactory.addAspect(new LoggingAspect());         // 切面

// 4. 创建代理
UserService proxy = (UserService) proxyFactory.getProxy();
```

### ProxyFactory 内部结构

```java
public class ProxyFactory extends ProxyCreatorSupport {

    // 设置目标对象
    public void setTarget(Object target) {
        setTargetSource(new SingletonTargetSource(target));
    }

    // 添加通知
    public void addAdvice(Advice advice) {
        addAdvisor(0, new InstantiationModelAdvisor(advice));
    }

    // 添加切面
    public void addAspect(Object aspect) {
        Assert.notNull(aspect, "Aspect must not be null");
        AspectMetadata am = new AspectMetadata(aspect, aspect.getClass().getSimpleName());
        // 处理切面...
        addAdvisor(am.getAopAllianceAdvisor());
    }

    // 创建代理
    public Object getProxy() {
        return createAopProxy().getProxy();
    }
}
```

## AopProxy 的选择

### DefaultAopProxyFactory

```java
public class DefaultAopProxyFactory implements AopProxyFactory, Serializable {

    @Override
    public AopProxy createAopProxy(AdvisedSupport config) throws AopConfigException {
        // 判断条件
        if (config.isOptimize()
                || config.isProxyTargetClass()
                || hasNoUserSuppliedProxyInterfaces(config)) {
            // CGLIB 代理
            return new ObjenesisCglibAopProxy(config);
        }
        else {
            // JDK 代理
            return new JdkDynamicAopProxy(config);
        }
    }

    private boolean hasNoUserSuppliedProxyInterfaces(AdvisedSupport config) {
        Class&lt;?&gt;[] interfaces = config.getProxiedInterfaces();
        if (interfaces.length == 0) {
            return true;
        }
        // SpringProxy 除外
        if (interfaces.length == 1 && SpringProxy.class.isAssignableFrom(interfaces[0])) {
            return true;
        }
        return false;
    }
}
```

## JdkDynamicAopProxy 源码解析

### 核心代码

```java
class JdkDynamicAopProxy implements AopProxy, InvocationHandler, Serializable {

    private final AdvisedSupport advised;

    public JdkDynamicAopProxy(AdvisedSupport advised) {
        this.advised = advised;
    }

    @Override
    public Object getProxy() {
        return Proxy.newProxyInstance(
            getClass().getClassLoader(),
            advised.getProxiedInterfaces(),
            this
        );
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        // 1. 获取适用于此方法的拦截器链
        MethodInvocation invocation = new CglibMethodInvocation(
            proxy, method, args, target, methodMapping, new ArrayList&lt;&gt;(1));
        // 2. 通过拦截器链执行
        Object retVal = invocation.proceed();
        // 3. 返回结果
        return retVal;
    }
}
```

### invoke() 方法详解

```java
@Override
public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
    Object oldProxy = null;
    boolean setProxyContext = false;

    TargetSource targetSource = advised.targetSource;
    Object target = null;

    try {
        // 1. 处理 equals() 方法
        if (method.getName().equals("equals") && args.length == 0) {
            return equals(args[0]) ? Boolean.TRUE : Boolean.FALSE;
        }

        // 2. 处理 hashCode() 方法
        if (method.getName().equals("hashCode") && args.length == 0) {
            return hashCode();
        }

        // 3. 处理 toString() 方法
        if (method.getName().equals("toString") && args.length == 0) {
            return advised.getProxiedInterfaces()[0].getName();
        }

        // 4. 获取目标对象
        target = targetSource.getTarget();
        Class&lt;?&gt; targetClass = (target != null ? target.getClass() : null);

        // 5. 获取适用于此方法的拦截器链
        List&lt;Object&gt; chain = AopUtils.findAdvisedChain(targetClass, method, args);

        // 6. 如果有拦截器，执行拦截器链
        if (chain.isEmpty()) {
            // 没有拦截器，直接调用目标方法
            return method.invoke(target, args);
        }

        // 7. 创建 MethodInvocation 并执行
        ReflectiveMethodInvocation mi = new ReflectiveMethodInvocation(
            proxy, target, method, args, targetClass, chain);
        retVal = mi.proceed();

        // 8. 处理返回值
        if (retVal != null && retVal == target && 
            method.getName().equals("hashCode")) {
            retVal = Integer.valueOf(System.identityHashCode(proxy));
        }

        return retVal;
    }
    finally {
        // 释放资源
        if (target != null && !targetSource.isStatic()) {
            targetSource.releaseTarget(target);
        }
    }
}
```

## CglibAopProxy 源码解析

### 核心代码

```java
class CglibAopProxy implements AopProxy, Serializable {

    private final AdvisedSupport advised;

    public CglibAopProxy(AdvisedSupport advised) {
        this.advised = advised;
    }

    @Override
    public Object getProxy() {
        return getProxy(this.enhancedClassLoader);
    }

    @Override
    public Object getProxy(ClassLoader classLoader) {
        if (logger.isDebugEnabled()) {
            logger.debug("Creating CGLIB proxy: " + this.advised.getTargetSource());
        }

        // 创建 Enhancer
        Enhancer enhancer = createEnhancer();
        Class&lt;?&gt;[] types = this.advised.getProxyInterfaces();
        enhancer.setInterfaces(types);

        // 设置回调
        Callback callback = getCallback();
        enhancer.setCallbackFilter(new ProxyCallbackFilter(advised));

        // 创建代理
        return createProxy(enhancer, callback);
    }
}
```

### 创建拦截器

```java
private Callback getCallback() {
    return new DynamicAdvisedInterceptor(this.advised);
}

private static class DynamicAdvisedInterceptor implements MethodInterceptor {

    private final AdvisedSupport advised;

    public DynamicAdvisedInterceptor(AdvisedSupport advised) {
        this.advised = advised;
    }

    @Override
    public Object intercept(Object proxy, Method method, Object[] args, MethodProxy methodProxy) throws Throwable {
        // 获取拦截器链
        List&lt;Object&gt; chain = AopUtils.findAdvisedChain(
            advised.getTargetClass(), method, args);

        // 执行拦截器链
        if (chain.isEmpty()) {
            return methodProxy.invoke(proxy, args);
        }

        MethodInvocation invocation = new CglibMethodInvocation(
            proxy, method, args, advised.getTargetSource().getTarget(), methodProxy, chain);

        return invocation.proceed();
    }
}
```

## 拦截器链的执行

### ReflectiveMethodInvocation

```java
public class ReflectiveMethodInvocation implements MethodInvocation {

    @Override
    public Object proceed() throws Throwable {
        // 从索引 0 开始
        if (this.currentInterceptorIndex == this.interceptors.size() - 1) {
            // 所有拦截器都执行完毕，调用目标方法
            return method.invoke(target, this.arguments);
        }

        // 获取下一个拦截器
        MethodInterceptor interceptor = this.interceptors.get(++this.currentInterceptorIndex);

        // 执行拦截器
        return interceptor.invoke(this);
    }
}
```

### 拦截器链的执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       拦截器链执行流程                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  proceed() 被调用                                                       │
│         │                                                             │
│         ▼                                                             │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │ Interceptor[0].invoke(mi)                                        │  │
│  │         │                                                         │  │
│  │         ▼                                                         │  │
│  │  ┌─────────────────────────────────────────────────────────┐   │  │
│  │  │ Interceptor[1].invoke(mi)                                │   │  │
│  │  │         │                                                 │   │  │
│  │  │         ▼                                                 │   │  │
│  │  │  ┌─────────────────────────────────────────────────┐   │   │  │
│  │  │  │ ...Interceptor[n].invoke(mi)                      │   │   │  │
│  │  │  │         │                                       │   │   │  │
│  │  │  │         ▼                                       │   │   │  │
│  │  │  │  method.invoke(target, args) ← 目标方法       │   │   │  │
│  │  │  │         │                                       │   │   │  │
│  │  │  │         ▼                                       │   │   │  │
│  │  │  │  return result                                  │   │   │  │
│  │  │  └─────────────────────────────────────────────────┘   │   │  │
│  │  │         │                                                 │   │  │
│  │  │         ▼                                                 │   │  │
│  │  │  return result                                          │   │  │
│  │  └─────────────────────────────────────────────────────────┘   │  │
│  │         │                                                         │  │
│  │         ▼                                                         │  │
│  │  return result                                                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│         │                                                             │
│         ▼                                                             │
│  return result                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试核心问题

### Q1：Spring AOP 的代理创建流程是什么？

1. `ProxyFactory` 设置目标对象和切面
2. `createAopProxy()` 根据条件选择 JDK 或 CGLIB 代理
3. `getProxy()` 创建代理对象

### Q2：JdkDynamicAopProxy 的 invoke() 方法做了什么？

1. 处理 `equals()`、`hashCode()`、`toString()` 特殊方法
2. 获取适用于目标方法的拦截器链
3. 通过 `ReflectiveMethodInvocation.proceed()` 执行拦截器链
4. 返回结果

### Q3：拦截器链是如何执行的？

通过 `MethodInvocation.proceed()` 递归执行：
1. 从索引 0 开始
2. 执行当前拦截器的 `invoke()` 方法
3. 在拦截器内部调用 `proceed()`
4. 所有拦截器执行完后，调用目标方法

### Q4：为什么需要拦截器链？

拦截器链允许多个切面同时作用在一个方法上。每个切面可以决定：
- 在目标方法执行前做什么
- 是否执行目标方法
- 在目标方法执行后做什么
- 如何处理异常

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                   Spring AOP 代理创建流程                    │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  ProxyFactory                                            │
│       │                                                   │
│       ├── setTarget() 设置目标对象                        │
│       ├── addAdvice() 添加通知                            │
│       └── getProxy() 创建代理                             │
│                  │                                        │
│                  ▼                                        │
│  createAopProxy()                                        │
│       │                                                   │
│       ├── proxyTargetClass=true? → CGLIB                │
│       ├── 无接口? → CGLIB                               │
│       └── 其他 → JDK                                     │
│                  │                                        │
│                  ▼                                        │
│  JdkDynamicAopProxy / CglibAopProxy                     │
│       │                                                   │
│       └── getProxy() → 返回代理对象                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

理解这个流程，你就能理解 Spring AOP 的全部工作原理。

---

**下节预告**：[AspectJ 与 Spring AOP 对比](/framework/spring/aspectj-vs-aop) —— AspectJ 和 Spring AOP 有什么区别？各自适用什么场景？
