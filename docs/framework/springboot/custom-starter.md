# 自定义 Starter 开发

你有没有想过，为什么引入 `spring-boot-starter-web` 之后，`ObjectMapper`、`RestTemplate`、`WebMvcConfigurer` 就能自动配置好？

这就是 Spring Boot Starter 的魔力。

今天，我们从零开发一个生产级的自定义 Starter，学会了这个，你对 Spring Boot 的理解会更上一层楼。

## Starter 的组成

一个完整的 Starter 由两个模块组成：

```
my-starter/
├── my-starter                          # Starter 模块（供用户引入）
│   └── src/main/resources/
│       └── META-INF/
│           └── spring/
│               └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
│
└── my-starter-autoconfigure            # Auto Configure 模块（包含自动配置）
    └── src/main/java/
        └── com/example/autoconfigure/
            ├── MyAutoConfiguration.java
            └── properties/
                └── MyProperties.java
```

**为什么分开？**
- Starter 只需要声明依赖，不包含代码
- Auto Configure 包含具体实现和配置

## 步骤一：创建 Properties 配置类

```java
// MyProperties.java
package com.example.autoconfigure.properties;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "my")
public class MyProperties {
    
    private boolean enabled = true;
    private String name = "default";
    private int timeout = 3000;
    private List&lt;String&gt; servers = new ArrayList&lt;&gt;();
    
    public boolean isEnabled() {
        return enabled;
    }
    
    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }
    
    public String getName() {
        return name;
    }
    
    public void setName(String name) {
        this.name = name;
    }
    
    public int getTimeout() {
        return timeout;
    }
    
    public void setTimeout(int timeout) {
        this.timeout = timeout;
    }
    
    public List&lt;String&gt; getServers() {
        return servers;
    }
    
    public void setServers(List&lt;String&gt; servers) {
        this.servers = servers;
    }
}
```

## 步骤二：创建自动配置类

```java
// MyAutoConfiguration.java
package com.example.autoconfigure;

import com.example.autoconfigure.properties.MyProperties;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@ConditionalOnClass(MyService.class)              // classpath 下存在 MyService 才生效
@ConditionalOnProperty(prefix = "my", name = "enabled", havingValue = "true", matchIfMissing = true)
@EnableConfigurationProperties(MyProperties.class)  // 启用配置属性
public class MyAutoConfiguration {
    
    private final MyProperties properties;
    
    public MyAutoConfiguration(MyProperties properties) {
        this.properties = properties;
    }
    
    @Bean
    @ConditionalOnMissingBean  // 用户没自定义才生效
    public MyService myService() {
        return new MyService(properties.getName(), properties.getTimeout());
    }
}
```

## 步骤三：创建业务类

```java
// MyService.java
package com.example;

public class MyService {
    
    private final String name;
    private final int timeout;
    
    public MyService(String name, int timeout) {
        this.name = name;
        this.timeout = timeout;
    }
    
    public String getName() {
        return name;
    }
    
    public int getTimeout() {
        return timeout;
    }
    
    public String execute() {
        return "MyService [" + name + "] executed with timeout " + timeout;
    }
}
```

## 步骤四：注册自动配置

Spring Boot 2.7+ 使用 `AutoConfiguration.imports` 文件：

```
# META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
com.example.autoconfigure.MyAutoConfiguration
```

**注意**：文件路径和文件名必须完全正确。

## 步骤五：创建 Starter 模块

Starter 模块本身不包含代码，只负责引入 Auto Configure 模块：

```xml
<!-- my-starter/pom.xml -->
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    
    <groupId>com.example</groupId>
    <artifactId>my-starter</artifactId>
    <version>1.0.0</version>
    <packaging>jar</packaging>
    
    <dependencies>
        <!-- 引入自动配置模块 -->
        <dependency>
            <groupId>com.example</groupId>
            <artifactId>my-starter-autoconfigure</artifactId>
            <version>1.0.0</version>
        </dependency>
        
        <!-- 如果 Starter 需要传递依赖，在此声明 -->
    </dependencies>
</project>
```

## 完整项目结构

```
my-starter/
├── pom.xml                                  # 父 POM
├── my-starter/                              # Starter 模块
│   ├── pom.xml
│   └── src/main/resources/
│       └── META-INF/
│           └── spring/
│               └── org.springframework.boot.autoconfigure.AutoConfiguration.imports
│
└── my-starter-autoconfigure/               # Auto Configure 模块
    ├── pom.xml
    └── src/main/java/
        └── com/example/autoconfigure/
            ├── MyAutoConfiguration.java
            ├── MyService.java
            └── properties/
                └── MyProperties.java
```

## 用户如何使用

### 引入依赖

```xml
<dependency>
    <groupId>com.example</groupId>
    <artifactId>my-starter</artifactId>
    <version>1.0.0</version>
</dependency>
```

### 配置属性

```yaml
# application.yml
my:
  enabled: true
  name: my-service
  timeout: 5000
  servers:
    - server1.example.com
    - server2.example.com
```

### 直接使用

```java
@RestController
public class UserController {
    
    @Autowired
    private MyService myService;  // 直接注入，Spring Boot 已经自动配置好了
    
    @GetMapping("/test")
    public String test() {
        return myService.execute();
    }
}
```

## 自定义条件注解

如果默认的条件注解不够用，可以自定义：

### 定义条件注解

```java
@Target({ ElementType.TYPE, ElementType.METHOD })
@Retention(RetentionPolicy.RUNTIME)
@Documented
@Conditional(OnMyCondition.class)
public @interface ConditionalOnMy {
    String value() default "";
}
```

### 实现 Condition

```java
public class OnMyCondition implements Condition {
    
    @Override
    public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
        // 获取注解属性
        Map&lt;String, Object&gt; attributes = metadata.getAnnotationAttributes(ConditionalOnMy.class.getName());
        String value = (String) attributes.get("value");
        
        // 判断条件
        String property = context.getEnvironment().getProperty("my.custom.property");
        return value.equals(property);
    }
}
```

### 使用自定义条件

```java
@Configuration
@ConditionalOnMy("expected-value")
public class ConditionalAutoConfiguration {
    // ...
}
```

## 自动配置排除

用户可以通过以下方式排除自动配置：

### 方式一：exclude 参数

```java
@SpringBootApplication(exclude = {MyAutoConfiguration.class})
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### 方式二：application.yml

```yaml
spring:
  autoconfigure:
    exclude:
      - com.example.autoconfigure.MyAutoConfiguration
```

## Debug 自动配置

开启 Debug 模式，查看哪些自动配置生效了：

```yaml
debug: true
```

输出示例：

```
=========================
AUTO-CONFIGURATION REPORT
=========================

Positive matches:
-----------------
    MyAutoConfiguration matched:
      - @ConditionalOnClass found required class 'com.example.MyService'
      - @ConditionalOnProperty (my.enabled) matched (enabled true)
      - @ConditionalOnMissingBean found no existing Bean (OnBeanCondition)

Negative matches:
-----------------
    Unmatched:
      (None)
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| Starter 由哪几部分组成？ | 模块划分 |
| 为什么 Starter 和 Auto Configure 要分开？ | 设计原因 |
| 自动配置类必须放在特定包下吗？ | 包扫描机制 |
| 如何让用户自定义的 Bean 优先于自动配置？ | @ConditionalOnMissingBean |
| spring.factories 和 AutoConfiguration.imports 有什么区别？ | 配置方式演进 |

---

> 自定义 Starter 是理解 Spring Boot 自动配置的最佳方式。当你能够从零开发一个 Starter，你对 Spring Boot 的理解就已经超过了 90% 的开发者。
