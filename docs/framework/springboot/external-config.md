# Spring Boot 外部化配置

你有没有遇到过这种情况：本地开发好好的，部署到服务器就挂了——因为数据库地址、Redis 配置不一样。

Spring Boot 的外部化配置，就是为了解决这个问题。

## 什么是外部化配置

**外部化配置**（Externalized Configuration） = 把配置从代码中分离出来，放在外面管理。

开发环境、测试环境、生产环境，用同一份代码，不同的配置。

## 配置加载顺序

Spring Boot 会按以下顺序加载配置（后面的覆盖前面的）：

```
1. 命令行参数
      ↓
2. SPRING_APPLICATION_JSON 中的属性
      ↓
3. ServletConfig/ServletContext 参数
      ↓
4. JAVA_OPTS / JAVA_TOOL_OPTIONS 环境变量
      ↓
5. 操作系统环境变量
      ↓
6. random.* 配置（RandomValuePropertySource）
      ↓
7. jar 包外部的 application-{profile}.properties / .yml
      ↓
8. jar 包内部的 application-{profile}.properties / .yml
      ↓
9. jar 包外部的 application.properties / .yml
      ↓
10. jar 包内部的 application.properties / .yml
      ↓
11. @PropertySource 注解
      ↓
12. SpringApplication.setDefaultProperties 设置的默认值
```

**结论**：命令行参数优先级最高，jar 包内部的默认配置优先级最低。

## application.yml 配置详解

### 基本配置

```yaml
server:
  port: 8080
  servlet:
    context-path: /api

spring:
  application:
    name: my-app

logging:
  level:
    root: INFO
    com.example: DEBUG
```

### 多环境配置

```yaml
# application-dev.yml - 开发环境
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/dev
    username: dev
    password: dev123

# application-prod.yml - 生产环境
spring:
  datasource:
    url: jdbc:mysql://prod-server:3306/prod
    username: prod
    password: ${DB_PASSWORD}  # 从环境变量读取
```

### 激活指定环境

```yaml
# application.yml
spring:
  profiles:
    active: dev  # 激活 dev 配置
```

或者通过命令行激活：

```bash
java -jar myapp.jar --spring.profiles.active=prod
```

## @ConfigurationProperties 绑定配置

### 基本用法

配置类：

```java
@Component
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private String version;
    private List&lt;String&gt; features = new ArrayList&lt;&gt;();
    
    // getter 和 setter
    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
    public String getVersion() { return version; }
    public void setVersion(String version) { this.version = version; }
    public List&lt;String&gt; getFeatures() { return features; }
    public void setFeatures(List&lt;String&gt; features) { this.features = features; }
}
```

配置文件：

```yaml
app:
  name: My Application
  version: 1.0.0
  features:
    - login
    - logout
    - search
```

### 启用配置属性

方式一：@EnableConfigurationProperties

```java
@SpringBootApplication
@EnableConfigurationProperties(AppProperties.class)
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

方式二：@ConfigurationPropertiesScan（Spring Boot 2.2+）

```java
@SpringBootApplication
@ConfigurationPropertiesScan
public class Application {
    // ...
}
```

### 嵌套配置

```java
@ConfigurationProperties(prefix = "app")
public class AppProperties {
    private String name;
    private User user = new User();
    private Map&lt;String, Feature&gt; features = new HashMap&lt;&gt;();
    
    public static class User {
        private String username;
        private String email;
        // getter 和 setter
    }
    
    public static class Feature {
        private String description;
        private boolean enabled;
        // getter 和 setter
    }
}
```

对应配置：

```yaml
app:
  name: My App
  user:
    username: admin
    email: admin@example.com
  features:
    login:
      description: 用户登录
      enabled: true
    payment:
      description: 支付功能
      enabled: false
```

## @Value 注入

### 基本用法

```java
@RestController
public class HelloController {
    
    @Value("${app.name}")
    private String appName;
    
    @Value("${server.port:8080}")  // 支持默认值
    private int port;
    
    @Value("${app.features.login:false}")
    private boolean loginEnabled;
    
    @GetMapping("/hello")
    public String hello() {
        return "Hello from " + appName + " on port " + port;
    }
}
```

### 注入 Map 和 List

```java
@Component
public class ConfigReader {
    
    // 注入 Map
    @Value("#{${app.features}}")
    private Map&lt;String, Boolean&gt; features;
    
    // 注入 List
    @Value("${app.tags}")
    private List&lt;String&gt; tags;
    
    // 注入数组
    @Value("${app.servers}")
    private String[] servers;
}
```

### SpEL 表达式

```java
@Component
public class SpELExamples {
    
    // 注入系统属性
    @Value("#{systemProperties['user.dir']}")
    private String userDir;
    
    // 注入环境变量
    @Value("#{environment['HOME']}")
    private String homeDir;
    
    // 计算表达式
    @Value("#{2 * 3}")
    private int twoTimesThree;
    
    // 方法调用
    @Value("#{'${app.name}'.toUpperCase()}")
    private String nameUpperCase;
}
```

## @ConfigurationProperties vs @Value

| 特性 | @ConfigurationProperties | @Value |
|-----|-----|-----|
| **绑定方式** | 批量绑定配置前缀 | 单个属性注入 |
| **代码风格** | POJO + getter/setter | 直接字段注入 |
| **IDE 支持** | 需要 Lombok 或手写 getter/setter | IDE 自动提示 |
| **宽松绑定** | 支持（`app-name` = `appName` = `appName`） | 不支持 |
| **SpEL 表达式** | 不支持 | 支持 |
| **默认值** | 无（需要代码指定） | 可以指定默认值 |
| **校验** | 支持 @Validated | 不支持 |
| **适用场景** | 配置类、业务代码 | 简单场景、一次性的值 |

**推荐**：在业务代码中使用 `@ConfigurationProperties`，在框架级别使用 `@Value`。

## 配置校验与松散绑定

### @Validated 校验

```java
@Component
@ConfigurationProperties(prefix = "app")
@Validated
public class AppProperties {
    
    @NotBlank
    private String name;
    
    @Min(1)
    @Max(65535)
    private int port;
    
    @Email
    private String contactEmail;
    
    @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}")
    private String version;
}
```

### 松散绑定

Spring Boot 支持多种命名风格自动映射：

```yaml
app:
  first-name: value    # 短横线
  firstName: value     # 驼峰
  first_name: value    # 下划线
  FIRST_NAME: value    # 全大写下划线
```

以上四种写法都会绑定到 `AppProperties.firstName` 字段。

## 配置加密

Spring Boot 不提供开箱即用的加密功能，需要引入 Jasypt：

```xml
<dependency>
    <groupId>com.github.ulisesbocchio</groupId>
    <artifactId>jasypt-spring-boot-starter</artifactId>
    <version>3.0.5</version>
</dependency>
```

使用加密密码：

```yaml
jasypt:
  encryptor:
    password: my-secret-password
    algorithm: PBEWithMD5AndDES

spring:
  datasource:
    password: ENC(加密后的密文)
```

命令行运行时传入密码：

```bash
java -Djasypt.encryptor.password=my-secret-password -jar myapp.jar
```

## 多环境配置切换

### profile 优先级

```bash
# 激活单个 profile
--spring.profiles.active=prod

# 激活多个 profile
--spring.profiles.active=prod,secure
```

### 环境变量方式

```bash
# Linux/Mac
export SPRING_PROFILES_ACTIVE=prod

# Windows
set SPRING_PROFILES_ACTIVE=prod
```

### 代码中获取激活的 profile

```java
@RestController
public class ProfileController {
    
    @Value("${spring.profiles.active}")
    private String activeProfile;
    
    @Autowired
    private Environment environment;
    
    @GetMapping("/profile")
    public String getProfile() {
        // 方式一：@Value 注入
        return activeProfile;
        
        // 方式二：Environment
        return Arrays.toString(environment.getActiveProfiles());
    }
}
```

## 运行时修改配置

### Spring Boot DevTools 实时重载

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-devtools</artifactId>
</dependency>
```

### Spring Boot Actuator 端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: env,configprops
  endpoint:
    env:
      post:
        enabled: true
```

调用端点修改配置：

```bash
curl -X POST http://localhost:8080/actuator/env \
  -H "Content-Type: application/json" \
  -d '{"name":"server.port","value":"9090"}'
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| 配置文件的加载顺序是怎样的？ | 外部化配置优先级 |
| @ConfigurationProperties 和 @Value 的区别？ | 适用场景 |
| 如何实现配置加密？ | Jasypt |
| 如何在运行时动态修改配置？ | Actuator |
| Spring Boot 的松散绑定是什么？ | 配置绑定规则 |

---

> 外部化配置是 Spring Boot「约定优于配置」理念的体现。掌握好这一章，你就能在不同环境间游刃有余——一套代码，多套配置，灵活切换。
