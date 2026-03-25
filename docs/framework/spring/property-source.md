# Spring 属性注入：从 @Value 到 @PropertySource

你有没有遇到过这种场景：配置文件里写着数据库连接信息，代码里却要硬编码 `localhost:3306`。

一旦换个环境，改代码？改配置？

Spring 的属性注入机制，让你优雅地解决这个问题。

## 属性注入的整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Spring 属性注入架构                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  配置文件（application.yml / application.properties）                   │
│  自定义属性源（@PropertySource）                                        │
│         │                                                               │
│         ▼                                                               │
│  PropertySourcesPlaceholderConfigurer                                   │
│         │                                                               │
│         ▼                                                               │
│  ${placeholder} 解析                                                    │
│         │                                                               │
│         ▼                                                               │
│  @Value 注入值                                                          │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## @Value 注解详解

### 基本用法

```java
@Service
public class UserService {

    // 注入简单值
    @Value("Hello")
    private String simpleValue;

    // 注入系统属性
    @Value("${java.home}")
    private String javaHome;

    // 注入配置文件属性
    @Value("${app.name}")
    private String appName;

    // 注入带默认值的属性
    @Value("${app.timeout:3000}")
    private int timeout;
}
```

### @Value 的解析过程

```java
// 配置文件
# application.properties
app.name=MyApplication
app.version=1.0.0
app.timeout=5000

// 代码
@Configuration
public class AppConfig {
    @Bean
    public static PropertySourcesPlaceholderConfigurer configurer() {
        return new PropertySourcesPlaceholderConfigurer();
    }
}

@Service
public class MyService {
    @Value("${app.name}")
    private String name;  // 注入 "MyApplication"
}
```

Spring Boot 自动配置了 `PropertySourcesPlaceholderConfigurer`，无需手动注册。

## @PropertySource 注解

### 基本用法

```java
// 定义属性文件
// config/jdbc.properties
jdbc.url=jdbc:mysql://localhost:3306/test
jdbc.username=root
jdbc.password=password

// 配置类
@Configuration
@PropertySource("classpath:config/jdbc.properties")
public class JdbcConfig {
}
```

### 多个属性源

```java
@Configuration
@PropertySource("classpath:config/jdbc.properties")
@PropertySource("classpath:config/app.properties")
@PropertySource(value = "file:./config/custom.properties", ignoreResourceNotFound = true)
public class MultiPropertyConfig {
    // 可以注入任何属性源中的属性
}
```

### @PropertySource 属性

```java
@Configuration
@PropertySource(
    value = "classpath:config/app.properties",
    name = "appProperties",          // 属性源名称
    ignoreResourceNotFound = true,   // 忽略文件不存在
    encoding = "UTF-8"               // 文件编码
)
public class Config {
}
```

### 占位符解析

```java
@Configuration
@PropertySource("classpath:config/db.properties")
public class DbConfig {
    // 占位符引用其他属性
    @Value("${db.url}")
    private String url;
}

// db.properties
db.url=jdbc:mysql://${db.host:localhost}:${db.port:3306}/${db.name}
db.host=192.168.1.100
db.port=3306
db.name=testdb
```

## SpEL 表达式

`@Value` 支持 SpEL 表达式，功能强大：

### 简单表达式

```java
@Service
public class SpELService {

    // 算术运算
    @Value("#{10 * 2}")
    private int calculated;

    // 对象属性访问
    @Value("#{systemProperties['java.version']}")
    private String javaVersion;

    // 调用方法
    @Value("#{'Hello'.toUpperCase()}")
    private String upper;

    // 三元运算符
    @Value("#{systemProperties['debug'] == 'true' ? true : false}")
    private boolean debug;
}
```

### Bean 属性访问

```java
@Service
public class BeanService {

    // 访问其他 Bean 的属性
    @Value("#{myConfig.timeout}")
    private int timeout;

    // 访问其他 Bean 的方法
    @Value("#{myService.getName()}")
    private String name;

    // 调用静态方法
    @Value("#{T(java.lang.Math).random() * 100}")
    private double random;
}
```

### 集合操作

```java
@Service
public class CollectionService {

    // List 字面量
    @Value("#{{'a', 'b', 'c'}}")
    private List&lt;String&gt; list;

    // Map 字面量
    @Value("#{{'key1': 'value1', 'key2': 'value2'}}")
    private Map&lt;String, String&gt; map;

    // 从配置中读取列表
    @Value("#{'${app.servers}'.split(',')}")
    private List&lt;String&gt; servers;

    // 从 Map 中取值
    @Value("#{myConfig.servers['default']}")
    private String defaultServer;
}
```

## @ConfigurationProperties 绑定

### 基本用法

```java
// 定义配置属性类
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private int version;
    private List&lt;String&gt; servers = new ArrayList&lt;&gt;();
    private Map&lt;String, String&gt; config = new HashMap&lt;&gt;();

    // getter/setter
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    // ...
}

// 配置类
@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class AppConfig {
}

// 或者直接在属性类上加注解
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    // ...
}
```

### 配置文件

```yaml
# application.yml
app:
  name: MyApplication
  version: 1.0.0
  servers:
    - server1.example.com
    - server2.example.com
  config:
    timeout: 3000
    max-connections: 100
```

### 嵌套属性

```java
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private DatasourceProperties datasource;

    public static class DatasourceProperties {
        private String url;
        private String username;
        private String password;
        private PoolProperties pool = new PoolProperties();

        // getter/setter
    }

    public static class PoolProperties {
        private int maxSize = 10;
        private int minIdle = 5;

        // getter/setter
    }

    // getter/setter
}
```

```yaml
app:
  name: MyApplication
  datasource:
    url: jdbc:mysql://localhost:3306/test
    username: root
    password: password
    pool:
      max-size: 20
      min-idle: 5
```

## 属性验证

### @Validated 验证

```java
@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {
    @NotBlank
    private String name;

    @Min(1)
    @Max(65535)
    private int port;

    @Pattern(regexp = "^\\d{4}-\\d{2}-\\d{2}$")
    private String dateFormat;

    @Email
    private String adminEmail;

    // getter/setter
}
```

### 自定义验证器

```java
@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {
    @ValidIp
    private String ipAddress;

    @ValidNested
    private DatasourceProperties datasource;

    public static class DatasourceProperties {
        @NotBlank
        private String url;

        // getter/setter
    }
}

// 自定义验证器
@Target({ElementType.FIELD, ElementType.PARAMETER})
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = ValidIpValidator.class)
public @interface ValidIp {
    String message() default "Invalid IP address";
    Class&lt;?&gt;[] groups() default {};
    Class&lt;? extends Payload&gt;[] payload() default {};
}

public class ValidIpValidator implements ConstraintValidator&lt;ValidIp, String&gt; {
    @Override
    public boolean isValid(String value, ConstraintValidatorContext context) {
        if (value == null) return true;
        String pattern = "^((25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$";
        return value.matches(pattern);
    }
}
```

## 属性优先级

Spring 中的属性有优先级（从高到低）：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      属性优先级（从高到低）                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 命令行参数（--spring.config.location）                             │
│  2. OS 环境变量（set SPRING_CONFIG_ADDITIONAL_LOCATION=...）           │
│  3. 打包的 application.properties/yml                                  │
│  4. 非打包的 application.properties/yml                               │
│  5. @PropertySource 引入的属性                                        │
│  6. Spring Boot 默认属性                                              │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 多环境配置

```yaml
# application.yml - 主配置
spring:
  profiles:
    active: dev

# application-dev.yml - 开发环境
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/test_dev

# application-prod.yml - 生产环境
spring:
  datasource:
    url: jdbc:mysql://192.168.1.100:3306/test_prod
```

### 激活特定环境

```bash
# 命令行激活
java -jar app.jar --spring.profiles.active=prod

# 环境变量激活
export SPRING_PROFILES_ACTIVE=prod
```

## Environment 接口

### 读取属性

```java
@Service
public class EnvService {

    @Autowired
    private Environment env;

    public void readProperties() {
        // 获取属性
        String name = env.getProperty("app.name");
        String withDefault = env.getProperty("app.timeout", "5000");
        
        // 类型转换
        int timeout = env.getProperty("app.timeout", Integer.class, 3000);
        
        // 检查属性是否存在
        boolean exists = env.containsProperty("app.name");
        
        // 获取所有属性
        Map&lt;String, Object&gt; properties = env.getProperties();
    }
}
```

### PropertyResolver 接口

```java
// @Value 底层调用 PropertyResolver
@Service
public class PropService {

    @Autowired
    private ConfigurableEnvironment env;

    public void resolve() {
        // 占位符解析
        String resolved = env.resolvePlaceholders("${app.name:default}");
        
        // SpEL 解析
        String spel = env.resolveRequiredPlaceholders("#{'${app.name}'.toUpperCase()}");
    }
}
```

## 最佳实践

### 1. 配置属性类替代 @Value

```java
// 不推荐：每个属性都用 @Value
@Service
public class BadService {
    @Value("${app.name}") private String name;
    @Value("${app.version}") private String version;
    @Value("${app.timeout}") private int timeout;
    // ... 更多属性
}

// 推荐：使用 @ConfigurationProperties
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private String version;
    private int timeout;
    // ...
}

@Service
public class GoodService {
    @Autowired
    private AppProperties appProperties;
}
```

### 2. 属性分层管理

```java
// 按功能分层
@ConfigurationProperties(prefix = "app.datasource")
public class DatasourceProperties { }

@ConfigurationProperties(prefix = "app.cache")
public class CacheProperties { }

@ConfigurationProperties(prefix = "app.web")
public class WebProperties { }
```

### 3. 安全敏感属性

```java
@Configuration
@PropertySource("classpath:config/application.properties")
public class SecureConfig {
    @Value("${app.secret:}")
    private String secret;

    @Bean
    public static PropertySourcesPlaceholderConfigurer configurer() {
        PropertySourcesPlaceholderConfigurer configurer = new PropertySourcesPlaceholderConfigurer();
        configurer.setFileEncoding("UTF-8");
        return configurer;
    }
}
```

## 常见问题

### 1. @Value 注入为 null

```java
// 问题：@Configuration 类中没有配置 PropertySourcesPlaceholderConfigurer
@Configuration
public class BadConfig {
    @Bean
    public MyService myService() {
        return new MyService();
    }
}

// 解决：确保 Spring Boot 自动配置生效，或手动配置
@Configuration
public class GoodConfig {
    @Bean
    public static PropertySourcesPlaceholderConfigurer configurer() {
        return new PropertySourcesPlaceholderConfigurer();
    }
}
```

### 2. 属性占位符无法解析

```java
// 确保占位符语法正确
@Value("${app.name}")           // 正确
@Value("$app.name")             // 错误
@Value("{app.name}")            // 错误
```

### 3. YAML 中的属性名冲突

```yaml
# 后面的会覆盖前面的
app:
  name: first
app:
  name: second  # 会覆盖
```

## 面试核心问题

### Q1：@Value 和 @ConfigurationProperties 的区别？

| 特性 | @Value | @ConfigurationProperties |
|-----|--------|------------------------|
| 适用场景 | 简单值、SpEL 表达式 | 复杂配置对象 |
| 松散绑定 | 不支持 | 支持 |
| 属性验证 | 不支持 | 支持 `@Validated` |
| IDE 支持 | 无 | 有（代码提示） |
| 批量注入 | 不支持 | 支持 |

### Q2：Spring Boot 如何加载配置文件？

1. `bootstrap.yml/properties`（优先）
2. `application.yml/properties`
3. `@PropertySource` 指定的文件
4. 命令行参数

### Q3：如何实现配置属性类的属性验证？

```java
@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {
    @NotBlank
    private String name;

    @Min(1)
    private int port;
}
```

---

**下节预告**：[环境隔离与多环境配置](/framework/spring/profile) —— 深入理解 @Profile 的原理和最佳实践。
