# BeanFactoryPostProcessor 与属性占位符替换

你有没有想过这个问题：Spring 启动时，`@Value("${spring.datasource.url}")` 是怎么变成具体的数据库 URL 的？

`${...}` 占位符是在什么时候被替换的？为什么配置写在 `application.yml` 里，Java 代码就能直接用？

这一切，都和 `BeanFactoryPostProcessor` 有关。

## 什么是 BeanFactoryPostProcessor？

`BeanFactoryPostProcessor` 是 Spring 提供的扩展接口，允许在 Bean 实例化之前修改 BeanDefinition：

```java
@FunctionalInterface
public interface BeanFactoryPostProcessor {
    
    // 在 BeanFactory 刷新后、Bean 实例化前调用
    void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) 
        throws BeansException;
}
```

**特点**：
- 操作的**BeanDefinition**，不是 Bean 实例
- 在 Bean 实例化之前调用
- 可以修改 Bean 的属性、作用域、构造器参数等

## 处理时机

```
BeanFactoryPostProcessor 调用时机：

BeanDefinition 注册完成
         │
         ▼
BeanFactoryPostProcessor.postProcessBeanFactory()
         │
         ├── 修改 BeanDefinition
         ├── 替换属性占位符 ${...}
         ├── 注册新的 BeanDefinition
         └── ...
         │
         ▼
Bean 实例化开始
```

## BeanFactoryPostProcessor vs BeanPostProcessor

这是两个非常容易混淆的概念：

| 维度 | BeanFactoryPostProcessor | BeanPostProcessor |
|-----|------------------------|-------------------|
| **操作对象** | BeanDefinition | Bean 实例 |
| **调用时机** | Bean 实例化前 | Bean 实例化后、初始化前后 |
| **主要用途** | 修改 Bean 定义、解析配置 | 依赖注入、AOP 代理 |
| **典型实现** | `ConfigurationClassPostProcessor`、`PropertyPlaceholderConfigurer` | `AutowiredAnnotationBeanPostProcessor`、`AnnotationAwareAspectJAutoProxyCreator` |

## 内置的 BeanFactoryPostProcessor

### 1. ConfigurationClassPostProcessor

这是 Spring 最核心的 `BeanFactoryPostProcessor`，负责解析 `@Configuration` 类：

```java
// 在 postProcessBeanFactory 中：
// 1. 解析 @Configuration 类
// 2. 处理 @ComponentScan
// 3. 处理 @Bean 方法
// 4. 处理 @Import
// 5. 处理 @ImportResource
```

### 2. PropertySourcesPlaceholderConfigurer

负责解析 `${...}` 占位符：

```java
// 它会把：
// @Value("${spring.datasource.url}")
// 变成：
// @Value("jdbc:mysql://localhost:3306/mydb")
```

### 3. PropertyOverrideConfigurer

允许用配置文件覆盖 Bean 的属性值。

## 属性占位符的工作原理

### 配置示例

```yaml
# application.yml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/mydb
    username: root
    password: 123456
```

```java
@Service
public class DataSourceConfig {
    
    @Value("${spring.datasource.url}")
    private String url;
    
    @Value("${spring.datasource.username}")
    private String username;
    
    @Value("${spring.datasource.password}")
    private String password;
}
```

### 工作原理

`PropertySourcesPlaceholderConfigurer` 的处理流程：

```java
public class PropertySourcesPlaceholderConfigurer 
        extends PropertyResourceConfigurer 
        implements BeanFactoryPostProcessor {
    
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory) 
            throws BeansException {
        try {
            // 1. 加载属性源（从 yml/properties 文件）
            PropertySources propertySources = resolveProperties();
            
            // 2. 遍历所有 BeanDefinition
            String[] beanNames = beanFactory.getBeanDefinitionNames();
            for (String beanName : beanNames) {
                BeanDefinition bd = beanFactory.getBeanDefinition(beanName);
                
                // 3. 替换 BeanDefinition 中的占位符
                MutablePropertyValues pvs = bd.getPropertyValues();
                for (PropertyValue pv : pvs.getPropertyValues()) {
                    Object value = pv.getValue();
                    if (value instanceof String) {
                        String strValue = (String) value;
                        // 替换 ${...} 为实际值
                        String resolvedValue = resolvePlaceholder(strValue, propertySources);
                        pvs.add(propertyName, resolvedValue);
                    }
                }
            }
        }
        catch (IOException ex) {
            throw new BeanInitializationException("Could not load properties", ex);
        }
    }
}
```

### 替换时机

占位符替换发生在**BeanDefinition 层面**，而不是 Bean 实例层面：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        占位符替换时机                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  阶段一：BeanDefinition 注册                                            │
│  → 扫描 @Component 等注解，生成 BeanDefinition                          │
│  → 此时 @Value("${...}") 还是字符串 "${...}"                           │
│                                                                         │
│  阶段二：BeanFactoryPostProcessor 执行                                  │
│  → PropertySourcesPlaceholderConfigurer 替换占位符                      │
│  → BeanDefinition 中的 "${...}" 被替换为实际值                         │
│                                                                         │
│  阶段三：Bean 实例化                                                    │
│  → Spring 使用替换后的值创建 Bean 实例                                  │
│  → @Value 注入的是实际值，不是占位符                                     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 自定义 BeanFactoryPostProcessor

### 示例一：动态注册 Bean

```java
@Component
public class DynamicBeanRegistrar implements BeanFactoryPostProcessor {
    
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory)
            throws BeansException {
        
        // 根据条件动态注册 Bean
        if (shouldRegisterCustomBean()) {
            // 创建 BeanDefinition
            BeanDefinitionBuilder builder = BeanDefinitionBuilder
                .genericBeanDefinition(CustomService.class);
            builder.addPropertyValue("name", "dynamic");
            builder.setScope(BeanDefinition.SCOPE_SINGLETON);
            
            // 注册到容器
            beanFactory.registerBeanDefinition("customService", builder.getBeanDefinition());
        }
    }
}
```

### 示例二：修改 Bean 属性

```java
@Component
public class EnvironmentBasedBeanModifier implements BeanFactoryPostProcessor {
    
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory)
            throws BeansException {
        
        // 在测试环境下，改变某些 Bean 的配置
        String profile = beanFactory.getBean("environment", Environment.class)
            .getActiveProfiles()[0];
        
        if ("test".equals(profile)) {
            BeanDefinition bd = beanFactory.getBeanDefinition("dataSource");
            MutablePropertyValues pvs = bd.getPropertyValues();
            pvs.addPropertyValue("url", "jdbc:h2:mem:testdb");
            pvs.addPropertyValue("username", "sa");
            pvs.addPropertyValue("password", "");
        }
    }
}
```

### 示例三：基于配置文件批量注册

```java
@Component
public class ExternalBeanRegistrar implements BeanFactoryPostProcessor {
    
    @Value("classpath:external-beans.properties")
    private Resource resource;
    
    @Override
    public void postProcessBeanFactory(ConfigurableListableBeanFactory beanFactory)
            throws BeansException {
        
        Properties properties = PropertiesLoaderUtils.loadProperties(resource);
        
        for (String beanName : properties.stringPropertyNames()) {
            String className = properties.getProperty(beanName);
            try {
                Class&lt;?&gt; clazz = Class.forName(className);
                BeanDefinitionBuilder builder = BeanDefinitionBuilder
                    .genericBeanDefinition(clazz);
                beanFactory.registerBeanDefinition(beanName, builder.getBeanDefinition());
            }
            catch (ClassNotFoundException e) {
                throw new RuntimeException("Cannot find class: " + className, e);
            }
        }
    }
}
```

## BeanDefinitionRegistryPostProcessor

这是一个更强大的接口，继承自 `BeanFactoryPostProcessor`：

```java
public interface BeanDefinitionRegistryPostProcessor extends BeanFactoryPostProcessor {
    
    // 在标准 BeanFactoryPostProcessor.postProcessBeanFactory() 之前调用
    // 专门用于注册新的 BeanDefinition
    void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) 
        throws BeansException;
}
```

### 执行顺序

```
BeanFactoryPostProcessor 执行顺序：

1. BeanDefinitionRegistryPostProcessor.postProcessBeanDefinitionRegistry()
   → 注册新的 BeanDefinition

2. BeanDefinitionRegistryPostProcessor.postProcessBeanFactory()
   → 处理已注册的 BeanDefinition

3. BeanFactoryPostProcessor.postProcessBeanFactory()
   → 处理 BeanDefinition
```

### 示例：MyBatis 集成

MyBatis-Spring 就是通过 `BeanDefinitionRegistryPostProcessor` 来注册 Mapper：

```java
public class MapperScannerConfigurer 
        implements BeanDefinitionRegistryPostProcessor {
    
    @Override
    public void postProcessBeanDefinitionRegistry(BeanDefinitionRegistry registry) {
        // 扫描 Mapper 接口
        ClassPathMapperScanner scanner = new ClassPathMapperScanner(registry);
        scanner.scan(basePackage);
        // 注册 MapperFactoryBean 的 BeanDefinition
    }
}
```

## Spring Boot 中的自动配置

Spring Boot 的自动配置也是基于 `BeanFactoryPostProcessor`：

```java
@Configuration
public class EnableAutoConfigurationConfiguration {
    
    @Bean
    public AutoConfigurationImportSelector autoConfigurationImportSelector() {
        return new AutoConfigurationImportSelector();
    }
}

// AutoConfigurationImportSelector 实现了 BeanFactoryPostProcessor
// 在 postProcessBeanFactory() 中：
// 1. 读取 META-INF/spring.factories
// 2. 加载自动配置类
// 3. 注册为 BeanDefinition
```

## 面试核心问题

### Q1：BeanFactoryPostProcessor 和 BeanPostProcessor 的区别？

| 维度 | BeanFactoryPostProcessor | BeanPostProcessor |
|-----|------------------------|-------------------|
| 时机 | Bean 实例化前 | Bean 实例化后 |
| 操作对象 | BeanDefinition | Bean 实例 |
| 典型用途 | 修改 Bean 定义、解析配置 | 依赖注入、AOP 代理 |

### Q2：${...} 占位符是在什么时候被替换的？

在 `BeanFactoryPostProcessor.postProcessBeanFactory()` 阶段，由 `PropertySourcesPlaceholderConfigurer` 替换。

### Q3：如何动态注册 Bean？

实现 `BeanDefinitionRegistryPostProcessor`，在 `postProcessBeanDefinitionRegistry()` 中调用 `registry.registerBeanDefinition()`。

### Q4：Spring Boot 自动配置是如何工作的？

通过 `AutoConfigurationImportSelector`（实现了 `BeanFactoryPostProcessor`），读取 `spring.factories` 中的自动配置类，注册为 BeanDefinition。

## 总结

`BeanFactoryPostProcessor` 是 Spring 框架的核心扩展机制：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BeanFactoryPostProcessor 家族                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  BeanFactoryPostProcessor                                               │
│         │                                                             │
│         ├── BeanDefinitionRegistryPostProcessor                        │
│         │         │                                                   │
│         │         └── 注册新的 BeanDefinition                          │
│         │                                                             │
│         └── PropertySourcesPlaceholderConfigurer                       │
│                   │                                                   │
│                   └── 替换 ${...} 占位符                               │
│                                                                         │
│  执行顺序：                                                             │
│  1. BeanDefinitionRegistryPostProcessor.postProcessBeanDefinitionRegistry│
│  2. BeanDefinitionRegistryPostProcessor.postProcessBeanFactory()      │
│  3. BeanFactoryPostProcessor.postProcessBeanFactory()                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

理解这个机制，你就能理解 Spring 的配置解析和自动配置原理。

---

**下节预告**：[FactoryBean 与 @Bean 注解解析](/framework/spring/factory-bean) —— FactoryBean 和 BeanFactory 有什么区别？@Bean 是如何被解析的？
