# @SpringBootApplication 注解解析

你有没有数过，一个 `@SpringBootApplication` 注解，背后藏着多少层注解？

答案是 **5 层**。

今天，我们把这 5 层注解逐一拆解，看看 Spring Boot 是如何通过「注解组合」来实现自动配置的。

## 注解层级图

```java
@SpringBootApplication
├── @SpringBootConfiguration
│   └── @Configuration
└── @EnableAutoConfiguration
│   ├── @AutoConfigurationPackage
│   │   └── @Import(AutoConfigurationPackages.Registrar.class)
│   └── @Import(AutoConfigurationImportSelector.class)
│       └── AutoConfigurationEntry
└── @ComponentScan
    ├── excludeFilters
    └── includeFilters
```

每一层都有其存在的意义，我们逐层解析。

## 第一层：@SpringBootConfiguration

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Configuration
public @interface SpringBootConfiguration {
}
```

**作用**：标记这是 Spring Boot 的配置类。

它本质上就是 `@Configuration`，所以 `@SpringBootConfiguration` 能做的事，`@Configuration` 都能做。

**为什么要单独定义？**

为了语义清晰：`@Configuration` 是 Spring 的注解，`@SpringBootConfiguration` 是 Spring Boot 的注解。当你在一个 Spring Boot 项目里看到 `@SpringBootConfiguration`，就知道这是启动类所在的配置类。

## 第二层：@EnableAutoConfiguration

这是**自动配置**的入口，也是最重要的注解。

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@AutoConfigurationPackage
@Import(AutoConfigurationImportSelector.class)
public @interface EnableAutoConfiguration {
    // 指定要排除的自动配置类
    Class<?>[] exclude() default {};
    String[] excludeName() default {};
}
```

它做了两件事：

### 2.1 @AutoConfigurationPackage：标记主类所在包

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Import(AutoConfigurationPackages.Registrar.class)
public @interface AutoConfigurationPackage {
}
```

`@Import(AutoConfigurationPackages.Registrar.class)` 会把**主类所在的包名**注册为「自动配置的包路径」。

后续 Spring Boot 会在这个包及其子包下扫描 `@Component`、`@Configuration` 等注解标记的类。

**这就是为什么 Spring Boot 要求启动类放在根包下**——放在根包，子包都能被扫描到。

### 2.2 @Import(AutoConfigurationImportSelector.class)：导入自动配置选择器

这是**自动配置的核心**。

`AutoConfigurationImportSelector` 实现了 `DeferredImportSelector` 接口，它会在 `BeanFactoryPostProcessor` 阶段被执行。

它的核心逻辑在 `selectImports()` 方法中：

```java
@Override
public String[] selectImports(AnnotationMetadata annotationMetadata) {
    if (!isEnabled(annotationMetadata)) {
        return NO_IMPORTS;
    }
    // 获取自动配置条目
    AutoConfigurationEntry autoConfigurationEntry = 
        getAutoConfigurationEntry(annotationMetadata);
    return StringUtils.toStringArray(autoConfigurationEntry.getConfigurations());
}

protected AutoConfigurationEntry getAutoConfigurationEntry(
        AnnotationMetadata annotationMetadata) {
    // 1. 获取启用属性，默认 true
    if (!isEnabled(annotationMetadata)) {
        return EMPTY_ENTRY;
    }
    
    // 2. 获取需要排除的配置
    AnnotationAttributes attributes = getAttributes(annotationMetadata);
    
    // 3. 核心：从 META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
    // 或者 META-INF/spring.factories 中加载所有自动配置类
    List<String> configurations = getCandidateConfigurations(
        annotationMetadata, attributes);
    
    // 4. 去重
    configurations = removeDuplicates(configurations);
    
    // 5. 根据 @EnableAutoConfiguration 的 exclude/excludeName 排除
    Set<String> exclusions = getExclusions(annotationMetadata, attributes);
    configurations.removeAll(exclusions);
    
    // 6. 应用过滤规则（@ConditionalOnClass 等）
    configurations = getConfigurationClassFilter().filter(configurations);
    
    // 7. 发布 AutoConfigurationImportEvent 事件
    fireAutoConfigurationImportEvents(configurations, exclusions);
    
    return new AutoConfigurationEntry(configurations, exclusions);
}
```

关键在于第 3 步：**从哪里加载自动配置类？**

## 第三层：@ComponentScan

```java
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Repeatable(ComponentScans.class)
public @interface ComponentScan {
    // 扫描的基础包，默认是主类所在包
    String basePackages() default {};
    
    // 要扫描的类
    Class<?>[] basePackageClasses() default {};
    
    // 排除规则
    ComponentScan.Filter[] excludeFilters() default {};
    
    // 包含规则
    ComponentScan.Filter[] includeFilters() default {};
}
```

**作用**：扫描并注册 `@Component`、`@Service`、`@Repository`、`@Controller` 等注解标记的 Bean。

**默认值**：扫描 `@SpringBootApplication` 所在包及其子包。

```java
// 等价于
@ComponentScan(basePackages = "com.example")
```

这就是为什么启动类放在根包 `com.example` 下，`@Service`、`@Repository` 放在子包 `com.example.service` 下就能被扫描到。

### excludeFilters 排除 FilterAutoConfiguration

你可能注意到，启动类上会有这样的配置：

```java
@SpringBootApplication(exclude = {DataSourceAutoConfiguration.class})
```

这里的 `exclude` 参数，最终会传递给 `@ComponentScan` 的 `excludeFilters`，排除特定的自动配置类。

## 第四层：自动配置类的结构

每一个自动配置类（如 `DataSourceAutoConfiguration`），都遵循同样的模式：

```java
@Configuration
@ConditionalOnClass(DataSource.class)           // 条件：classpath 下有 DataSource
@ConditionalOnMissingBean(DataSource.class)     // 条件：没有自定义的 DataSource Bean
@EnableConfigurationProperties(DataSourceProperties.class)  // 启用配置属性
@AutoConfigureAfter(HikariDataSourceAutoConfiguration.class) // 在某个自动配置之后执行
public class DataSourceAutoConfiguration {
    
    @Bean
    @ConditionalOnMissingBean
    public DataSource dataSource(DataSourceProperties properties) {
        // 创建 DataSource
        return properties.initializeDataSourceBuilder().build();
    }
}
```

这是一个**典型的自动配置类结构**：
- `@Configuration`：表明这是一个配置类
- `@ConditionalOnClass`：条件装配，只有满足条件才生效
- `@ConditionalOnMissingBean`：只有没有用户自定义 Bean 时才生效
- `@EnableConfigurationProperties`：启用配置属性类
- `@AutoConfigureAfter`：指定执行顺序

## 第五层：条件注解

自动配置的核心是**条件装配**。Spring Boot 定义了一系列条件注解：

| 注解 | 含义 |
|-----|-----|
| `@ConditionalOnClass` | classpath 下存在指定类时才生效 |
| `@ConditionalOnMissingClass` | classpath 下不存在指定类时才生效 |
| `@ConditionalOnBean` | 容器中存在指定 Bean 时才生效 |
| `@ConditionalOnMissingBean` | 容器中不存在指定 Bean 时才生效 |
| `@ConditionalOnProperty` | 配置属性满足条件时才生效 |
| `@ConditionalOnWebApplication` | 是 Web 应用时才生效 |
| `@ConditionalOnExpression` | SpEL 表达式为 true 时才生效 |

**例子**：

```java
@Configuration
@ConditionalOnClass(WebMvc.class)           // 只有引入 spring-boot-starter-web 才生效
@ConditionalOnMissingBean(ViewResolver.class)  // 用户没自定义才生效
@EnableConfigurationProperties(WebMvcProperties.class)
public class WebMvcAutoConfiguration {
    // ...
}
```

## 完整的注解链路

```
@SpringBootApplication
│
├── @SpringBootConfiguration
│   └── @Configuration  // 标记为配置类
│
├── @EnableAutoConfiguration
│   ├── @AutoConfigurationPackage
│   │   └── @Import(AutoConfigurationPackages.Registrar.class)
│   │       // 作用：扫描主类所在包
│   │
│   └── @Import(AutoConfigurationImportSelector.class)
│       // 作用：导入自动配置类
│
└── @ComponentScan
    // 作用：扫描 @Component、@Service、@Controller 等
```

## 为什么@SpringBootApplication不能扫描兄弟包？

假设你的项目结构是这样的：

```
com.example
├── Application.java          // 启动类
├── controller
│   └── UserController.java
└── service
    └── UserService.java
```

这种情况，`@ComponentScan` 默认会扫描 `com.example` 及其子包，`controller` 和 `service` 都能被扫描到。

但如果你的启动类放在 `com.example` 包下，而 `UserService` 放在 `com.other.service` 包下：

```
com.example
└── Application.java

com.other.service
└── UserService.java
```

`UserService` 不会被扫描到，因为 `@ComponentScan` 默认只扫描主类所在包。

**解决方案**：

```java
@SpringBootApplication
@ComponentScan(basePackages = {"com.example", "com.other"})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| @SpringBootApplication 是由哪几个注解组成的？ | 注解组合原理 |
| @EnableAutoConfiguration 做了什么？ | 自动配置入口 |
| AutoConfigurationImportSelector 的 selectImports() 做了什么？ | 自动配置加载机制 |
| 为什么启动类要放在根包下？ | @ComponentScan 的默认行为 |
| @ConditionalOnMissingBean 的意义是什么？ | 自动配置与用户配置的优先级 |

---

> 理解 `@SpringBootApplication` 的注解组合，是理解 Spring Boot 自动配置的钥匙。每一层注解都有其存在的意义：标记配置类、启用自动配置、扫描组件——三者缺一不可。
