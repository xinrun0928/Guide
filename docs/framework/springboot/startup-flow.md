# Spring Boot 启动流程源码解析

你有没有想过，当你写下这段代码时：

```java
@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

Spring Boot 到底做了什么？

今天，我们从源码角度，完整走一遍 Spring Boot 的启动流程。

## 启动入口：SpringApplication.run()

```java
public static ConfigurableApplicationContext run(Class<?> primarySource, String... args) {
    return new SpringApplication(primarySource).run(args);
}
```

这一步做了两件事：
1. 创建 `SpringApplication` 实例
2. 调用 `run()` 方法

```java
public SpringApplication(ResourceLoader resourceLoader, Class<?>... primarySources) {
    this.resourceLoader = resourceLoader;
    // 1. 判断应用类型：REACTIVE、SIMPLE、SERVLET
    this.webApplicationType = WebApplicationType.deduceFromClasspath();
    // 2. 设置Initializer（应用上下文初始化器）
    setInitializers((Collection) getSpringFactoriesInstances(ApplicationContextInitializer.class));
    // 3. 设置Listener（应用事件监听器）
    setListeners((Collection) getSpringFactoriesInstances(ApplicationListener.class));
    // 4. 推断主配置类（一般是 main 方法所在的类）
    this.mainApplicationClass = deduceMainApplicationClass();
}
```

## run() 方法：十二步启动流程

```java
public ConfigurableApplicationContext run(String... args) {
    // 1. 创建计时器
    StopWatch stopWatch = new StopWatch();
    stopWatch.start();
    
    // 2. 创建引导上下文（BootstrapContext）
    DefaultBootstrapContext bootstrapContext = createBootstrapContext();
    
    // 3. 配置Headless属性（无头模式，用于服务器环境）
    configureHeadlessProperty();
    
    // 4. 获取并启动监听器
    SpringApplicationRunListeners listeners = getRunListeners(args);
    listeners.starting(bootstrapContext, mainApplicationClass);
    
    // 5. 准备环境
    ConfigurableEnvironment environment = prepareEnvironment(listeners, bootstrapContext, args);
    
    // 6. 打印Banner
    Banner printedBanner = printBanner(environment);
    
    // 7. 创建应用上下文
    ContextFactory factory = ContextFactory.getInstance();
    ConfigurableApplicationContext context = factory.createContext(webApplicationType);
    
    // 8. 准备上下文
    prepareContext(bootstrapContext, context, environment, listeners, 
                   printedBanner, applicationArguments);
    
    // 9. 刷新上下文（核心！）
    refreshContext(context);
    
    // 10. 刷新后处理
    afterRefresh(context, applicationArguments);
    
    // 11. 停止计时器并记录启动时间
    stopWatch.stop();
    
    // 12. 发布应用 Started 事件
    listeners.started(context);
    
    // 13. 调用Runner
    callRunners(context, applicationArguments);
    
    return context;
}
```

## 核心步骤详解

### 第一步：判断应用类型

```java
private WebApplicationType deduceFromClasspath() {
    // 如果能找到 Spring WebFlux 相关类，说明是响应式应用
    if (ClassUtils.isPresent(WEBFLUX_INDICATOR_CLASS, null)
        && !ClassUtils.isPresent(WEBMVC_INDICATOR_CLASS, null)) {
        return WebApplicationType.REACTIVE;
    }
    // 如果能找到 Spring MVC 相关类，说明是 Servlet 应用
    for (String className : SERVLET_INDICATOR_CLASSES) {
        if (!ClassUtils.isPresent(className, null)) {
            return WebApplicationType.NONE;
        }
    }
    return WebApplicationType.SERVLET;
}
```

Spring Boot 会根据类路径判断应用类型：
- **SERVLET**：classpath 下有 Spring MVC（默认）
- **REACTIVE**：classpath 下有 Spring WebFlux，没有 Spring MVC
- **NONE**：既没有 Spring MVC 也没有 Spring WebFlux

### 第二步：获取 SpringFactories 实例

```java
private <T> Collection<T> getSpringFactoriesInstances(Class<T> type, 
        Class<?>[] parameterTypes, Object... args) {
    ClassLoader classLoader = getClassLoader();
    // 核心：从 META-INF/spring.factories 加载
    String names = StreamSupport
        .stream(factoryNames(type, classLoader).spliterator(), false)
        .distinct()
        .collect(Collectors.joining(","));
    // 实例化
    return createSpringFactoriesInstances(type, parameterTypes, classLoader, args);
}
```

这里会从 `META-INF/spring.factories` 文件中加载 `ApplicationContextInitializer` 和 `ApplicationListener`。

### 第三步：准备环境

```java
private ConfigurableEnvironment prepareEnvironment(
        SpringApplicationRunListeners listeners,
        DefaultBootstrapContext bootstrapContext,
        String[] args) {
    
    // 创建并配置 Environment
    ConfigurableEnvironment environment = getOrCreateEnvironment();
    configureEnvironment(environment, sourceArgs);
    
    // 触发 ConfigFileApplicationListener 加载配置文件
    ConfigurationPropertySources.attach(environment);
    listeners.environmentPrepared(bootstrapContext, environment);
    
    // 绑定 spring.main 属性
    bindSpringApplication(environment);
    
    return environment;
}
```

这一步会加载 `application.yml`、`application.properties` 等配置文件。

### 第四步：创建应用上下文

```java
ConfigurableApplicationContext context = factory.createContext(webApplicationType);

public ConfigurableApplicationContext createContext(WebApplicationType type) {
    if (type == WebApplicationType.SERVLET) {
        // Servlet 环境，创建 AnnotationConfigServletWebServerApplicationContext
        return new AnnotationConfigServletWebServerApplicationContext();
    } else if (type == WebApplicationType.REACTIVE) {
        // 响应式环境
        return new AnnotationConfigReactiveWebServerApplicationContext();
    }
    // 非 Web 环境
    return new AnnotationConfigApplicationContext();
}
```

根据应用类型创建不同的上下文容器。

### 第五步：刷新上下文（最核心）

```java
private void refreshContext(ConfigurableApplicationContext context) {
    // 这里是 Spring 的核心！会调用 AbstractApplicationContext.refresh()
    ((AbstractApplicationContext) context).refresh();
}
```

`refresh()` 方法是 Spring 的核心，我们单独讲解：

```java
public void refresh() throws BeansException {
    // 1. 预处理上下文
    prepareRefresh();
    
    // 2. 获取BeanFactory
    ConfigurableListableBeanFactory beanFactory = obtainFreshBeanFactory();
    
    // 3. 准备BeanFactory（注册BeanPostProcessor、作用域等）
    prepareBeanFactory(beanFactory);
    
    // 4. 子类扩展：允许在BeanFactory准备好后进行处理
    postProcessBeanFactory(beanFactory);
    
    // 5. 执行BeanFactoryPostProcessor
    invokeBeanFactoryPostProcessors(beanFactory);
    
    // 6. 注册BeanPostProcessor
    registerBeanPostProcessors(beanFactory);
    
    // 7. 初始化MessageSource
    initMessageSource();
    
    // 8. 初始化事件广播器
    initApplicationEventMulticaster();
    
    // 9. onRefresh钩子：创建WebServer
    onRefresh();
    
    // 10. 注册监听器
    registerListeners();
    
    // 11. 实例化所有非懒加载的单例Bean
    finishBeanFactoryInitialization(beanFactory);
    
    // 12. 发布ContextRefreshedEvent
    finishRefresh();
}
```

### onRefresh()：创建嵌入式服务器

```java
@Override
protected void onRefresh() {
    super.onRefresh();
    // 创建 WebServer（Tomcat/Jetty/Undertow）
    createWebServer();
}

private void createWebServer() {
    WebServer webServer = webServerFactory.getWebServer(
        ( servletContext -> {
            // 注册 DispatcherServlet
            DispatcherServlet dispatcherServlet = new DispatcherServlet();
            dispatcherServlet.init(servletContext);
        })
    );
    webServer.start();
}
```

这一步会：
1. 从 `META-INF/services` 加载 `WebServerFactory`（Tomcat/Jetty/Undertow）
2. 创建嵌入式服务器
3. 注册 DispatcherServlet
4. 启动服务器

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────┐
│                      SpringApplication.run()                     │
└─────────────────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │ 1. 创建计时器  │   │ 2. 引导上下文  │   │ 3. Headless   │
    └───────────────┘   └───────────────┘   └───────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │ 4. 启动监听器  │   │ 5. 准备环境    │   │ 6. 打印Banner │
    └───────────────┘   └───────────────┘   └───────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
    ┌───────────────────────────────────────────────────────┐
    │                   7. 创建上下文                        │
    └───────────────────────────────────────────────────────┘
                                │
                                ▼
    ┌───────────────────────────────────────────────────────┐
    │                   8. prepareContext()                  │
    │         (加载BeanDefinition、注册Bean等)                │
    └───────────────────────────────────────────────────────┘
                                │
                                ▼
    ┌───────────────────────────────────────────────────────┐
    │                9. refreshContext()                     │
    │                   (最核心的步骤)                        │
    │  ┌─────────────────────────────────────────────────┐  │
    │  │ • obtainFreshBeanFactory()                       │  │
    │  │ • invokeBeanFactoryPostProcessors()              │  │
    │  │ • registerBeanPostProcessors()                    │  │
    │  │ • onRefresh() → 创建嵌入式服务器                   │  │
    │  │ • finishBeanFactoryInitialization()              │  │
    │  └─────────────────────────────────────────────────┘  │
    └───────────────────────────────────────────────────────┘
                                │
            ┌───────────────────┼───────────────────┐
            ▼                   ▼                   ▼
    ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
    │ 10. 刷新后处理 │   │ 11. 停止计时器  │   │ 12. 发布Started│
    └───────────────┘   └───────────────┘   └───────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   13. callRunners()   │
                    │  (执行ApplicationRunner│
                    │   和CommandLineRunner) │
                    └───────────────────────┘
```

## 关键扩展点

Spring Boot 在启动过程中预留了多个扩展点：

### ApplicationRunner 与 CommandLineRunner

```java
@Component
public class MyRunner implements ApplicationRunner {
    @Override
    public void run(ApplicationArguments args) throws Exception {
        // 应用启动完成后执行
        System.out.println("应用启动完成！");
    }
}
```

这两个接口让你可以在应用完全启动后执行特定逻辑。

### ApplicationContextInitializer

```java
public class MyInitializer implements ApplicationContextInitializer {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        // 在上下文刷新之前执行
    }
}
```

需要在 `META-INF/spring.factories` 中注册。

### ApplicationListener

```java
@Component
public class MyListener implements ApplicationListener<ApplicationEvent> {
    @Override
    public void onApplicationEvent(ApplicationEvent event) {
        // 监听应用事件
    }
}
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| Spring Boot 启动流程分几个阶段？ | 对启动流程的整体认知 |
| refresh() 方法做了什么？ | Spring 核心原理 |
| 嵌入式服务器是如何创建的？ | WebServerFactory 加载机制 |
| BeanFactoryPostProcessor 和 BeanPostProcessor 的区别？ | Spring 生命周期 |
| 如何在应用启动后执行特定逻辑？ | ApplicationRunner |

---

> 理解 Spring Boot 的启动流程，是理解 Spring Boot 自动配置、事件机制、扩展机制的前提。这个流程看起来很长，但核心就是三件事：**准备环境、创建上下文、刷新上下文**。
