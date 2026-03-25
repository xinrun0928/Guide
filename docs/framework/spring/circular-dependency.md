# Bean 循环依赖：三级缓存与解决过程

先来一个问题：**如果 A 依赖 B，B 依赖 A，Spring 怎么创建这两个 Bean？**

这是一个经典的面试题，也是一个实际开发中会遇到的问题。

## 什么是循环依赖？

```java
@Service
public class A {
    @Autowired
    private B b;  // A 依赖 B

    public void doSomething() {
        b.doB();
    }
}

@Service
public class B {
    @Autowired
    private A a;  // B 依赖 A，循环了！

    public void doSomething() {
        a.doA();
    }
}
```

A 需要 B 才能创建，但 B 又需要 A 才能创建——鸡生蛋，蛋生鸡，无解。

等等，Spring 真的无解吗？

## Spring 的破局之道：三级缓存

Spring 使用**三级缓存**来解决循环依赖问题。

### 三级缓存的定义

```java
public class DefaultSingletonBeanRegistry extends SimpleAliasRegistry {
    
    // 一级缓存：存放完全初始化好的 Bean，可以直接使用
    private final Map&lt;String, Object&gt; singletonObjects = 
        new ConcurrentHashMap&lt;&gt;(256);

    // 二级缓存：存放早期暴露的 Bean（属性还没注入完成）
    private final Map&lt;String, Object&gt; earlySingletonObjects = 
        new ConcurrentHashMap&lt;&gt;(16);

    // 三级缓存：存放 Bean 工厂，用于创建早期 Bean
    private final Map&lt;String, ObjectFactory&lt;?&gt;&gt; singletonFactories = 
        new ConcurrentHashMap&lt;&gt;(16);
}
```

### 三级缓存的职责

```
┌─────────────────────────────────────────────────────────────────────┐
│                        三级缓存机制                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  第一级 (singletonObjects)                                          │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  完全初始化好的 Bean，属性注入完成，可以安全使用              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  第二级 (earlySingletonObjects)                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  早期暴露的 Bean，已实例化但属性还没注入，用于解决循环依赖    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  第三级 (singletonFactories)                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Bean 工厂对象，用于创建早期 Bean（创建代理的机会）          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 循环依赖解决流程

以 A → B → A 的循环依赖为例：

### 第一步：A 开始创建

```java
// 创建 A 的过程中
protected Object createBean(String beanName, RootBeanDefinition mbd, Object[] args) {
    // ...
    // 调用 getSingleton 获取（第一次肯定获取不到）
    Object singletonInstance = getSingleton(beanName);
    if (singletonInstance == null) {
        // 开始创建 A
        // 1. 先把 A 的工厂放入三级缓存
        addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
        // ...
    }
}
```

此时 A 还没创建完成，先放一个「工厂」到三级缓存：

```
singletonFactories: {"A" → ObjectFactory_A}
earlySingletonObjects: {}
singletonObjects: {}
```

### 第二步：A 尝试注入 B

```java
// A 的属性注入阶段
@Autowired
private B b;

// Spring 调用 setB() 注入
populateBean(beanName, mbd, instanceWrapper);

// 发现需要 B，开始创建 B
b = beanFactory.getBean(B.class);
```

### 第三步：B 开始创建

```java
// 创建 B 的过程中
protected Object doCreateBean(String beanName, RootBeanDefinition mbd, Object[] args) {
    // 同样先把 B 的工厂放入三级缓存
    addSingletonFactory(beanName, () -> getEarlyBeanReference(beanName, mbd, bean));
}

// B 开始注入属性，发现需要 A
@Autowired
private A a;
```

### 第四步：B 尝试获取 A（关键时刻！）

```java
// B 尝试获取 A
protected Object getSingleton(String beanName, boolean allowEarlyReference) {
    // 1. 先查一级缓存（完全初始化好的）
    Object singletonObject = singletonObjects.get(beanName);
    if (singletonObject == null && !isSingletonCurrentlyInCreation(beanName)) {
        // 2. 查二级缓存（早期暴露的）
        Object earlySingletonObject = earlySingletonObjects.get(beanName);
        if (earlySingletonObject == null) {
            // 3. 查三级缓存（工厂）
            ObjectFactory&lt;?&gt; singletonFactory = singletonFactories.get(beanName);
            if (singletonFactory != null) {
                // 从工厂获取早期 Bean
                earlySingletonObject = singletonFactory.getObject();
                // 放入二级缓存，移除三级缓存
                earlySingletonObjects.put(beanName, earlySingletonObject);
                singletonFactories.remove(beanName);
            }
        }
    }
    return earlySingletonObject;
}
```

**找到了！** A 的工厂还在三级缓存里，通过它拿到 A 的早期引用。

### 第五步：B 完成创建

B 成功注入了 A 的早期引用，继续完成自己的创建：

```
singletonFactories: {}
earlySingletonObjects: {"B" → B_instance}
singletonObjects: {}
```

### 第六步：A 获得 B

B 创建完成后，返回给 A，A 继续完成属性注入：

```
singletonFactories: {}
earlySingletonObjects: {}
singletonObjects: {"A" → A_instance, "B" → B_instance}
```

**循环依赖解决！**

## 为什么需要三级缓存？

你可能会问：**为什么不能只用一级缓存？**

### 二级缓存的作用：防止重复创建早期 Bean

```java
// 假设只有一级缓存
// A 创建中，需要 B
// B 创建中，需要 A
// 查一级缓存：A 正在创建，没有完成，不能用！
```

二级缓存存放**正在创建中但未完成的 Bean**，这样 B 获取 A 时，可以拿到 A 的「半成品」。

### 三级缓存的作用：创建代理的机会

更重要的是，三级缓存存储的是 `ObjectFactory`，而不是直接的对象实例。

这意味着 Spring 有机会在创建早期 Bean 时，返回一个**代理对象**：

```java
addSingletonFactory(beanName, () -> {
    // 在这里可以返回代理对象！
    // AnnotationAwareAspectJAutoProxyCreator 就在这里创建代理
    return getEarlyBeanReference(beanName, mbd, originalBean);
});
```

**关键点**：如果使用 AOP，循环依赖时会创建代理对象还是原始对象？答案是**取决于注入的方式**。

## JDK 7 vs JDK 8 的区别

在 Spring 5.x（对应 JDK 8+）中，循环依赖的处理没有太大变化。但有一个重要的优化：

### JDK 7 时代的 ThreadLocal 缓存

JDK 7 及之前，`ConcurrentHashMap` 的并发性能不如 JDK 8。

Spring 5.x 使用了更高效的 `ConcurrentHashMap`，配合更好的锁分段，提升了多线程下的 Bean 创建性能。

### JDK 8 的 ConcurrentHashMap 优化

JDK 8 的 `ConcurrentHashMap` 采用了 CAS + 分段锁，在 Bean 创建这种「读多写少」的场景下，性能更好。

## 构造器循环依赖：无解

**三级缓存只能解决 setter 注入和字段注入的循环依赖，无法解决构造器循环依赖。**

```java
@Service
public class A {
    private B b;
    
    // 构造器注入
    public A(B b) {
        this.b = b;
    }
}

@Service
public class B {
    private A a;
    
    // 构造器注入
    public B(A a) {
        this.a = a;
    }
}
```

**为什么构造器循环依赖无法解决？**

因为 Spring 必须先完整创建 A（调用构造器），才能创建 A 的 BeanDefinition。但构造器需要 B 作为参数……无解。

```
启动报错：
BeanCurrentlyInCreationException: Requested bean is currently in creation: 
  Is there an unresolvable circular reference?
```

### 解决方案

1. **用 setter 注入替代构造器注入**
2. **用 `@Lazy` 延迟注入**
3. **重构代码，消除循环依赖**

```java
// @Lazy 解决方案
@Service
public class A {
    private B b;

    public A(@Lazy B b) {
        this.b = b;
    }
}
```

`@Lazy` 会让 Spring 创建一个**代理对象**，真正使用时才去解析依赖：

```java
// 实际执行时：
// 1. 调用 b.doSomething()
// 2. 代理对象拦截，开始解析 B
// 3. 发现 B 需要 A，但 A 已经在创建中了（有早期引用）
// 4. 返回 A 的早期引用，完成 B 的创建
// 5. 继续完成 A 的创建
```

## prototype 作用域的循环依赖

**prototype 作用域的 Bean，每次获取都会创建新实例，且 Spring 不缓存它们。**

因此，**prototype 作用域的 Bean 不支持循环依赖**。

```java
@Scope("prototype")
@Service
public class A {
    @Autowired
    private B b;
}

@Scope("prototype")
@Service
public class B {
    @Autowired
    private A a;
}

// 获取时会报错：
// BeanCurrentlyInCreationException
```

## 三级缓存与 AOP

当 A 被代理时，循环依赖的处理会更加复杂：

```java
@Service
public class A {
    @Autowired
    private B b;
}

@Service
@Transactional
public class B {
    @Autowired
    private A a;
}
```

### 处理流程

1. 创建 A，放入三级缓存
2. A 注入 B，开始创建 B
3. B 需要 A，从三级缓存获取，但这次会创建**代理 A**
4. 代理 A 放入二级缓存
5. B 完成，创建代理 B
6. A 注入 B（完成）

Spring 必须确保：**循环依赖时，返回的早期引用和最终的 Bean 是同一个代理对象**。

## 面试核心问题

### Q1：Spring 如何解决循环依赖？

使用**三级缓存**：
- 一级缓存：存放完全初始化好的 Bean
- 二级缓存：存放早期暴露的 Bean（属性未注入完成）
- 三级缓存：存放 ObjectFactory，用于创建早期 Bean

当 A 依赖 B、B 依赖 A 时：
1. A 开始创建，工厂放入三级缓存
2. A 注入 B，B 开始创建
3. B 注入 A，从三级缓存获取工厂，创建 A 的早期引用
4. B 完成，A 获得 B 的引用，继续完成

### Q2：为什么需要二级缓存？

一级缓存存放完全初始化好的 Bean，循环依赖时 A 和 B 都没完成初始化，不能用。

二级缓存存放**正在创建中**的 Bean，供其他 Bean 获取使用。

### Q3：构造器循环依赖能解决吗？

**不能**。三级缓存只能解决 setter/字段注入的循环依赖。构造器注入必须在构造时完成依赖注入，无法延迟。

### Q4：prototype 作用域支持循环依赖吗？

**不支持**。prototype Bean 不被缓存，每次获取都创建新实例，无法通过缓存解决循环依赖。

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    循环依赖解决关键                         │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  三级缓存各司其职：                                         │
│  • 一级缓存：成品 Bean                                      │
│  • 二级缓存：半成品 Bean（防止重复创建）                    │
│  • 三级缓存：工厂对象（有机会创建代理）                     │
│                                                            │
│  循环依赖解决流程：                                         │
│  A 创建 → A 需要 B → B 创建 → B 需要 A                    │
│  → A 未完成但有早期引用 → B 完成 → A 完成                  │
│                                                            │
│  不能解决的情况：                                          │
│  • 构造器循环依赖                                          │
│  • prototype 作用域循环依赖                                │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[构造器注入 vs Setter 注入 vs 字段注入](/framework/spring/injection-type) —— 三种注入方式各有什么优缺点？如何选择？
