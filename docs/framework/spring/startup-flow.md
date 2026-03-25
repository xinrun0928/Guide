# Spring 启动流程源码解析

你有没有想过这个问题：当你调用 `SpringApplication.run()` 的时候，Spring 容器到底做了什么？

为什么启动一个 Spring Boot 应用要经过那么多步骤？`refresh()` 方法里藏了什么秘密？

今天，让我们深入源码，一探究竟。

## 从入口开始

Spring Boot 的启动入口：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

`SpringApplication.run()` 做了两件事：

1. 创建 `SpringApplication` 对象
2. 调用 `run()` 方法

```java
// SpringApplication.run() 核心代码
public static ConfigurableApplicationContext run(Class<?> primarySource, String[] args) {
    return new SpringApplication(primarySource).run(args);
}
```

## SpringApplication.run() 的完整流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SpringApplication.run() 流程                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 创建 SpringApplication                                              │
│     │  → 判断 Web 应用类型                                              │
│     │  → 加载 spring.factories 中的 ApplicationContextInitializer       │
│     │  → 加载 spring.factories 中的 ApplicationListener                │
│     │  → 推断主配置类（@SpringBootApplication 标注的类）                │
│     │                                                           │
│     ▼                                                           │
│  2. 执行 run() 方法                                                │
│     │                                                           │
│     ├── 创建引导上下文 BootstrapContext                              │
│     │                                                           │
│     ├── 配置 Headless 属性（无头模式）                              │
│     │                                                           │
│     ├── 获取并运行 BootstrapRegistryInitializers                    │
│     │                                                           │
│     ├── 创建 DefaultBootstrapContext                                │
│     │                                                           │
│     ├── 准备 Environment                                           │
│     │                                                           │
│     ├── 打印 Banner                                                │
│     │                                                           │
│     ├── 创建 ApplicationContext  ← 关键！                          │
│     │                                                           │
│     ├── 准备 Context（关键！）                                      │
│     │                                                           │
│     ├── 刷新 Context ← 最重要！refresh()                          │
│     │                                                           │
│     └── 执行 Runner                                                │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 创建 ApplicationContext

根据 Web 应用类型，创建不同的上下文：

```java
// SpringApplication.createApplicationContext()
protected ConfigurableApplicationContext createApplicationContext() {
    Class<?> contextClass = this.applicationContextClass;
    
    // 如果没有指定，根据类型创建
    if (contextClass == null) {
        switch (this.webApplicationType) {
            case SERVLET:
                // Spring MVC → AnnotationConfigServletWebServerApplicationContext
                contextClass = Class.forName(
                    "org.springframework.boot.web.servlet.context.AnnotationConfigServletWebServerApplicationContext");
                break;
            case REACTIVE:
                // Spring WebFlux → AnnotationConfigReactiveWebServerApplicationContext
                contextClass = Class.forName(
                    "org.springframework.boot.web.reactive.context.AnnotationConfigReactiveWebServerApplicationContext");
                break;
            case NONE:
                // 非 Web 应用 → AnnotationConfigApplicationContext
                contextClass = AnnotationConfigApplicationContext.class;
                break;
        }
    }
    return (ConfigurableApplicationContext) BeanUtils.instantiateClass(contextClass);
}
```

## 刷新上下文：核心中的核心

`refresh()` 是整个 Spring 启动流程中最关键的方法，它定义在 `AbstractApplicationContext` 中：

```java
@Override
public void refresh() throws BeansException, IllegalStateException {
    // 加锁，防止多线程同时刷新
    synchronized (this.startupShutdownMonitor) {
        
        // 1. 准备上下文
        prepareRefresh();
        
        // 2. 获取 BeanFactory（Bean 工厂）
        ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
        
        // 3. 准备 BeanFactory（注册 BeanPostProcessor、加载国际资源等）
        prepareBeanFactory(beanFactory);
        
        try {
            // 4. 允许子类扩展 BeanFactory
            postProcessBeanFactory(beanFactory);
            
            // 5. 执行 BeanFactoryPostProcessor ← 关键扩展点
            invokeBeanFactoryPostProcessors(beanFactory);
            
            // 6. 注册 BeanPostProcessor
            registerBeanPostProcessors(beanFactory);
            
            // 7. 初始化 MessageSource（国际化）
            initMessageSource();
            
            // 8. 初始化事件广播器
            initApplicationEventMulticaster();
            
            // 9. 初始化主题解析器
            onRefresh();
            
            // 10. 注册监听器
            registerListeners();
            
            // 11. 实例化所有非懒加载的单例 Bean ← 最关键！
            finishBeanFactoryInitialization(beanFactory);
            
            // 12. 完成刷新，发布 ContextRefreshedEvent
            finishRefresh();
        }
        catch (BeansException ex) {
            // 销毁已创建的 Bean
            destroyBeans();
            // 取消刷新
            cancelRefresh(ex);
            throw ex;
        }
        finally {
            // 重置反射缓存
            resetCommonCaches();
        }
    }
}
```

## 每一步详解

### 步骤 2：obtainFreshBeanFactory()

获取 BeanFactory，这一步会解析 Bean 定义：

```java
protected ConfigurableListableBeanFactory obtainFreshBeanFactory() {
    // 刷新 BeanFactory
    refreshBeanFactory();
    // 返回 BeanFactory
    return getBeanFactory();
}
```

对于 `GenericApplicationContext`：

```java
@Override
protected final void refreshBeanFactory() throws IllegalStateException {
    if (this.refreshed) {
        throw new IllegalStateException(
            "GenericApplicationContext does not support multiple refresh attempts");
    }
    this.beanFactory = new DefaultListableBeanFactory();
    this.refreshed = true;
}
```

### 步骤 5：invokeBeanFactoryPostProcessors()

执行 `BeanFactoryPostProcessor`，这是**第一个重要的扩展点**：

```java
protected void invokeBeanFactoryPostProcessors(ConfigurableListableBeanFactory beanFactory) {
    // 获取所有 BeanFactoryPostProcessor
    String[] postProcessorNames =
        beanFactory.getBeanNamesForType(BeanFactoryPostProcessor.class, true, false);
    
    // 先执行 PriorityOrdered 类型的
    List&lt;BeanFactoryPostProcessor&gt; priorityOrderedPostProcessors = new ArrayList&lt;&gt;();
    for (String ppName : postProcessorNames) {
        if (beanFactory.isTypeMatch(ppName, PriorityOrdered.class)) {
            priorityOrderedPostProcessors.add(beanFactory.getBean(ppName, BeanFactoryPostProcessor.class));
        }
    }
    sortPostProcessors(priorityOrderedPostProcessors);
    invokeBeanFactoryPostProcessors(priorityOrderedPostProcessors);
    
    // 再执行 Ordered 类型的
    // ...
    
    // 最后执行其他的
    // ...
}
```

**关键**：`ConfigurationClassPostProcessor` 就在这一步被调用，它负责解析 `@Configuration`、`@ComponentScan`、`@Bean` 等注解。

### 步骤 6：registerBeanPostProcessors()

注册 `BeanPostProcessor`，在 Bean 创建时会调用它们：

```java
protected void registerBeanPostProcessors(ConfigurableListableBeanFactory beanFactory) {
    String[] postProcessorNames = beanFactory.getBeanNamesForType(BeanPostProcessor.class, true, false);
    
    // 注册 BeanPostProcessorChecker
    beanFactory.addBeanPostProcessor(new BeanPostProcessorChecker(beanFactory));
    
    // 注册实现了 PriorityOrdered 接口的
    // 注册实现了 Ordered 接口的
    // 注册普通的
    // 注册内部的
}
```

**关键的内置 BeanPostProcessor**：

| 处理器 | 作用 |
|-------|------|
| `AutowiredAnnotationBeanPostProcessor` | 处理 `@Autowired`、`@Value` |
| `CommonAnnotationBeanPostProcessor` | 处理 `@Resource`、`@PostConstruct`、`@PreDestroy` |
| `AnnotationAwareAspectJAutoProxyCreator` | 创建 AOP 代理 |
| `RequiredAnnotationBeanPostProcessor` | 处理 `@Required` |

### 步骤 11：finishBeanFactoryInitialization()

**这是最关键的一步——实例化所有单例 Bean**：

```java
protected void finishBeanFactoryInitialization(ConfigurableListableBeanFactory beanFactory) {
    // 初始化 ConversionService（类型转换）
    if (beanFactory.containsBean("conversionService")) {
        beanFactory.setConversionService(
            beanFactory.getBean("conversionService", ConversionService.class));
    }
    
    // 注册 LoadTimeWeaverAwareProcessor
    // ...
    
    // 冻结 BeanDefinition（禁止再修改）
    beanFactory.freezeConfiguration();
    
    // 实例化所有非懒加载的单例 Bean ← 这里！
    beanFactory.preInstantiateSingletons();
}
```

### preInstantiateSingletons()

`DefaultListableBeanFactory.preInstantiateSingletons()` 的逻辑：

```java
@Override
public void preInstantiateSingletons() throws BeansException {
    // 获取所有 BeanDefinition 的名称
    List&lt;String&gt; beanNames = new ArrayList&lt;&gt;(this.beanDefinitionNames);
    
    // 遍历创建 Bean
    for (String beanName : beanNames) {
        // 获取合并后的 BeanDefinition
        RootBeanDefinition bd = getMergedLocalBeanDefinition(beanName);
        
        // 不是抽象类、是单例、不是懒加载
        if (!bd.isAbstract() && bd.isSingleton() && !bd.isLazyInit()) {
            // 创建 Bean
            if (isFactoryBean(beanName)) {
                // FactoryBean 特殊处理
                FactoryBean&lt;?&gt; factory = getBean("&" + beanName);
                // ...
            }
            else {
                // 普通的单例 Bean
                getBean(beanName);
            }
        }
    }
    
    // 触发所有 SmartInitializingSingleton 的 afterSingletonsInstantiated
    for (String beanName : beanNames) {
        Object singletonInstance = getSingleton(beanName);
        if (singletonInstance instanceof SmartInitializingSingleton) {
            ((SmartInitializingSingleton) singletonInstance).afterSingletonsInstantiated();
        }
    }
}
```

## 完整的启动流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Spring 容器启动完整流程                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SpringApplication.run()                                               │
│         │                                                             │
│         ├── 1. 创建 SpringApplication                                   │
│         │         │                                                   │
│         ├── 2. run() 方法                                             │
│         │         │                                                   │
│         │         ├── 创建 ApplicationContext                          │
│         │         │         │                                         │
│         │         │         └── prepareContext()                      │
│         │         │         │         │                               │
│         │         │         │         ├── 加载 BeanDefinition          │
│         │         │         │         ├── 应用 BootstrapInitializer     │
│         │         │         │         └── 应用 ApplicationContextInitializer│
│         │         │         │                                           │
│         │         │         └── refresh() ← 核心！                    │
│         │         │                   │                               │
│         │         │                   ├── prepareRefresh()              │
│         │         │                   ├── obtainFreshBeanFactory()      │
│         │         │                   ├── prepareBeanFactory()          │
│         │         │                   ├── postProcessBeanFactory()      │
│         │         │                   ├── invokeBeanFactoryPostProcessors│
│         │         │                   ├── registerBeanPostProcessors()  │
│         │         │                   ├── initMessageSource()          │
│         │         │                   ├── initApplicationEventMulticaster()│
│         │         │                   ├── onRefresh()                  │
│         │         │                   ├── registerListeners()          │
│         │         │                   ├── finishBeanFactoryInitialization()│
│         │         │                   └── finishRefresh()              │
│         │         │                                                       │
│         │         └── 执行 Runner                                       │
│         │                 │                                             │
│         │                 ├── ApplicationRunner                         │
│         │                 └── CommandLineRunner                         │
│         │                                                                 │
│         └── 返回 ConfigurableApplicationContext                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## BeanFactoryPostProcessor vs BeanPostProcessor

这是两个很容易混淆的概念：

| 概念 | 时机 | 作用 | 代表实现 |
|-----|-----|-----|---------|
| **BeanFactoryPostProcessor** | BeanDefinition 加载后，Bean 实例化前 | 修改 BeanDefinition | `ConfigurationClassPostProcessor`、`PropertyPlaceholderConfigurer` |
| **BeanPostProcessor** | Bean 实例化后，初始化前后 | 修改 Bean 实例或创建代理 | `AutowiredAnnotationBeanPostProcessor`、`AnnotationAwareAspectJAutoProxyCreator` |

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        处理时机对比                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  BeanDefinition ← BeanFactoryPostProcessor 在这里操作                  │
│       │                                                                │
│       ▼                                                                │
│  Bean 实例化                                                            │
│       │                                                                │
│       ├── BeanPostProcessor.postProcessBeforeInitialization()          │
│       │                                                                │
│       ├── 初始化方法（@PostConstruct、afterPropertiesSet 等）            │
│       │                                                                │
│       └── BeanPostProcessor.postProcessAfterInitialization() ← 代理在这│
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试核心问题

### Q1：Spring 启动流程中最关键的方法是什么？

`AbstractApplicationContext.refresh()` 方法。它完成了容器的全部初始化工作，包括 BeanDefinition 加载、BeanFactoryPostProcessor 执行、BeanPostProcessor 注册、单例 Bean 实例化等。

### Q2：BeanFactoryPostProcessor 和 BeanPostProcessor 的区别？

- **BeanFactoryPostProcessor** 在 BeanDefinition 加载后、Bean 实例化前执行，用于修改 BeanDefinition
- **BeanPostProcessor** 在 Bean 实例化后、初始化前后执行，用于修改 Bean 实例或创建代理

### Q3：Spring 是在什么时候实例化单例 Bean 的？

在 `refresh()` 的 `finishBeanFactoryInitialization()` 阶段，调用 `preInstantiateSingletons()` 实例化所有非懒加载的单例 Bean。

### Q4：Spring 如何确保 BeanPostProcessor 先注册？

在 `refresh()` 中，先调用 `registerBeanPostProcessors()` 注册所有 BeanPostProcessor，再调用 `finishBeanFactoryInitialization()` 实例化 Bean。这样确保 Bean 创建时已经有 BeanPostProcessor 可用。

## 总结

Spring 的启动流程是一个精心设计的过程：

```
SpringApplication.run()
        │
        ▼
createApplicationContext()
        │
        ▼
refresh() ← 核心方法
        │
        ├── BeanDefinition 加载
        ├── BeanFactoryPostProcessor 执行（解析 @Configuration 等）
        ├── BeanPostProcessor 注册
        └── 单例 Bean 实例化
```

理解这个流程，你才能真正掌握 Spring 的运行机制。

---

**下节预告**：[Bean 创建流程：实例化、属性填充、初始化](/framework/spring/bean-create) —— 从 getBean() 开始，一个 Bean 是如何被创建出来的？
