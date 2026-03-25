# @Import 详解：批量导入配置类

你有没有想过这个问题：Spring Boot 是怎么自动配置那么多组件的？

`spring-boot-autoconfigure` 里有几百个配置类，Spring 是怎么把它们全部加载进来的？

答案就是 `@Import` 和它的两个重要变体：`ImportSelector` 和 `DeferredImportSelector`。

## @Import 的基本用法

### 导入普通类

```java
// 普通类（非 @Configuration）
public class MyComponent {
    public void doSomething() {
        System.out.println("MyComponent is working!");
    }
}

// 配置类
@Configuration
@Import(MyComponent.class)  // 导入普通类
public class AppConfig {
}

// 测试
public class Test {
    public static void main(String[] args) {
        AnnotationConfigApplicationContext context = 
            new AnnotationConfigApplicationContext(AppConfig.class);
        
        // 直接获取导入的类（不是 Bean！）
        MyComponent component = context.getBean(MyComponent.class);
        component.doSomething();
    }
}
```

### 导入 @Configuration 类

```java
// 数据源配置
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource dataSource() {
        return new HikariDataSource();
    }
}

// 服务配置
@Configuration
public class ServiceConfig {
    @Bean
    public UserService userService() {
        return new UserServiceImpl();
    }
}

// 主配置
@Configuration
@Import({DataSourceConfig.class, ServiceConfig.class})
public class AppConfig {
}
```

等价于 XML 配置：

```xml
&lt;beans&gt;
    &lt;bean class="com.example.DataSourceConfig"/&gt;
    &lt;bean class="com.example.ServiceConfig"/&gt;
&lt;/beans&gt;
```

## ImportSelector 接口

`ImportSelector` 让你可以根据条件动态决定导入哪些类。

### 基本用法

```java
// 1. 定义 ImportSelector
public class MyImportSelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        // 根据条件返回要导入的类名数组
        return new String[] {
            "com.example.ConfigA",
            "com.example.ConfigB"
        };
    }
}

// 2. 使用
@Configuration
@Import(MyImportSelector.class)
public class AppConfig {
}
```

### 实战：根据环境导入配置

```java
public class ProfileImportSelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        // 获取被导入注解的属性
        Map&lt;String, Object&gt; attributes = 
            importingClassMetadata.getAnnotationAttributes(
                EnableMyFeature.class.getName()
            );
        
        if (attributes == null) {
            return new String[0];
        }
        
        String profile = (String) attributes.get("profile");
        
        // 根据 profile 返回不同配置
        if ("dev".equals(profile)) {
            return new String[] {
                "com.example.config.DevDataSourceConfig",
                "com.example.config.DevCacheConfig"
            };
        } else if ("prod".equals(profile)) {
            return new String[] {
                "com.example.config.ProdDataSourceConfig",
                "com.example.config.ProdCacheConfig"
            };
        }
        
        return new String[0];
    }
}

// 自定义注解
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Import(ProfileImportSelector.class)
public @interface EnableMyFeature {
    String profile() default "dev";
}

// 使用
@Configuration
@EnableMyFeature(profile = "dev")
public class AppConfig {
}
```

### 获取被导入注解的信息

```java
public class ConditionalImportSelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        // 获取导入此配置类的类的注解信息
        Map&lt;String, Object&gt; annotationAttributes = 
            importingClassMetadata.getAnnotationAttributes(
                "com.example.EnableSomething"
            );
        
        if (annotationAttributes == null) {
            return new String[0];
        }
        
        // 获取注解属性
        String value = (String) annotationAttributes.get("value");
        boolean enabled = (boolean) annotationAttributes.get("enabled");
        
        // 根据属性决定导入哪些配置
        if (enabled) {
            return new String[] {
                "com.example.EnabledConfig"
            };
        } else {
            return new String[0];
        }
    }
}
```

## DeferredImportSelector 接口

`DeferredImportSelector` 在所有 `@Configuration` 处理完之后才执行导入，用于实现 Spring Boot 的自动配置。

### 基本用法

```java
public class MyDeferredImportSelector implements DeferredImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        // 返回要导入的类名
        return new String[] {
            "com.example.DeferredConfig"
        };
    }
}
```

### ImportSelector vs DeferredImportSelector

| 特性 | ImportSelector | DeferredImportSelector |
|-----|-----------------|----------------------|
| 执行时机 | 在配置类处理时立即执行 | 所有配置类处理完后执行 |
| 排序支持 | 不支持 | 支持 `getOrder()` 方法 |
| 使用场景 | 条件导入 | 自动配置、偏好配置 |

### 分组处理

```java
public class MyDeferredImportSelector implements DeferredImportSelector {

    // 指定分组
    @Override
    public Class&lt;? extends Group&gt; getImportGroup() {
        return MyDeferredImportGroup.class;
    }

    // 分组类
    public static class MyDeferredImportGroup implements Group {
        private final List&lt;Entry&gt; entries = new ArrayList&lt;&gt;();

        @Override
        public void addImport(String importClassName) {
            // 收集导入的类
            entries.add(new Entry(getOrder(), importClassName));
        }

        @Override
        public Iterator&lt;Entry&gt; iterator() {
            // 按顺序迭代
            return entries.iterator();
        }

        @Override
        public int getOrder() {
            // 定义分组优先级
            return Ordered.LOWEST_PRECEDENCE;
        }
    }
}
```

## 实战：实现自动配置

### 定义配置类

```java
// 自动配置类
@Configuration
@ConditionalOnClass(MyService.class)
@ConditionalOnProperty(name = "app.my-service.enabled", havingValue = "true", matchIfMissing = true)
public class MyServiceAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    public MyService myService() {
        return new MyServiceImpl();
    }

    @Bean
    @ConditionalOnMissingBean
    public MyServiceConfig myServiceConfig() {
        return new MyServiceConfig();
    }
}
```

### 使用 @AutoConfiguration

```java
@Configuration
@AutoConfiguration
@ConditionalOnClass(MyService.class)
public class MyServiceAutoConfiguration {
    // ...
}
```

### 在 spring.factories 中注册

```properties
# META-INF/spring.factories（Spring Boot 2.7 之前）
org.springframework.boot.autoconfigure.EnableAutoConfiguration=\
com.example.autoconfigure.MyServiceAutoConfiguration,\
com.example.autoconfigure.OtherServiceAutoConfiguration
```

### 在 auto-configuration.imports 中注册

```text
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports（Spring Boot 3.0+）
com.example.autoconfigure.MyServiceAutoConfiguration
com.example.autoconfigure.OtherServiceAutoConfiguration
```

### 排除自动配置

```java
// 方式一：@SpringBootApplication 排除
@SpringBootApplication(exclude = {MyServiceAutoConfiguration.class})

// 方式二：配置文件排除
spring:
  autoconfigure:
    exclude:
      - com.example.autoconfigure.MyServiceAutoConfiguration
```

## @Import 进阶用法

### 导入多个选择器

```java
@Configuration
@Import({MyImportSelector.class, AnotherImportSelector.class})
public class AppConfig {
}
```

### 组合使用

```java
@Configuration
@Import({DataSourceConfig.class, MyImportSelector.class})
@ComponentScan(basePackages = "com.example")
public class AppConfig {
}
```

### 自定义注解 + @Import

```java
// 1. 定义注解
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Import({MyImportSelector.class, MyDeferredImportSelector.class})
public @interface EnableMyFeature {
    String value() default "";
    boolean enabled() default true;
}

// 2. ImportSelector 实现
public class MyImportSelector implements ImportSelector {
    @Override
    public String[] selectImports(AnnotationMetadata importingClassMetadata) {
        AnnotationAttributes attributes = AnnotationAttributes.fromMap(
            importingClassMetadata.getAnnotationAttributes(
                EnableMyFeature.class.getName()
            )
        );
        
        if (attributes == null || !attributes.getBoolean("enabled")) {
            return new String[0];
        }
        
        return new String[] {
            "com.example.config.FeatureConfig"
        };
    }
}

// 3. 使用
@Configuration
@EnableMyFeature(value = "advanced", enabled = true)
public class AppConfig {
}
```

## @AutoConfiguration 注解

Spring Boot 2.4 引入了 `@AutoConfiguration`，简化自动配置的定义：

```java
// 旧写法（@Configuration + spring.factories）
@Configuration
@ConditionalOnClass(MyService.class)
public class MyServiceAutoConfiguration {
    @Bean
    public MyService myService() {
        return new MyServiceImpl();
    }
}

// 新写法（@AutoConfiguration）
@AutoConfiguration
@ConditionalOnClass(MyService.class)
public class MyServiceAutoConfiguration {
    @Bean
    @ConditionalOnMissingBean
    public MyService myService() {
        return new MyServiceImpl();
    }
}
```

### @AutoConfiguration 属性

```java
@AutoConfiguration(
    after = {DataSourceAutoConfiguration.class},    // 在指定配置之后加载
    before = {OtherAutoConfiguration.class},         // 在指定配置之前加载
    proxyBeanMethods = false                          // 不代理方法
)
public class MyServiceAutoConfiguration {
    // ...
}
```

## 常见问题

### 1. @Import 和 @ComponentScan 的区别？

| 特性 | @Import | @ComponentScan |
|-----|---------|----------------|
| 导入方式 | 指定类名导入 | 扫描包导入 |
| 灵活性 | 动态决定导入哪些类 | 扫描包下所有组件 |
| 执行时机 | 在配置类加载时执行 | 在配置类加载后执行 |
| 适用场景 | 自动配置、条件导入 | 自定义组件 |

### 2. ImportSelector 返回的类必须有无参构造函数吗？

是的，返回的类必须有无参构造函数，因为 Spring 需要通过反射实例化这些类。

### 3. DeferredImportSelector 有什么用？

主要用途是实现「偏好配置」——在所有配置处理完后，根据用户配置选择性地导入某些配置类。

典型应用是 Spring Boot 的 `@EnableAutoConfiguration` 和自动配置机制。

## 面试核心问题

### Q1：@Import 的作用？

`@Import` 可以导入三类内容：
- 普通类：作为 Bean 注册到容器
- `@Configuration` 类：执行该配置类中的所有 `@Bean` 方法
- `ImportSelector` 实现类：动态决定导入哪些配置类

### Q2：ImportSelector 和 DeferredImportSelector 的区别？

| 特性 | ImportSelector | DeferredImportSelector |
|-----|----------------|----------------------|
| 执行时机 | 配置类处理时立即执行 | 所有配置类处理完后执行 |
| 排序 | 不支持 | 支持 `getOrder()` |
| 应用 | 条件导入 | 自动配置 |

### Q3：Spring Boot 自动配置的原理？

1. `@SpringBootApplication` 包含 `@EnableAutoConfiguration`
2. `spring.factories` 或 `AutoConfiguration.imports` 声明配置类
3. `AutoConfigurationImportSelector`（DeferredImportSelector）选择导入配置
4. 配置类使用 `@Conditional*` 控制是否生效

---

**下节预告**：[属性注入详解](/framework/spring/property-source) —— 深入理解 @Value 和 @PropertySource，以及配置属性绑定的原理。
