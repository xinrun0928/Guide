# Spring Boot 日志配置

你有没有遇到过这种场景：本地日志打印正常，生产环境日志却找不到？

这很可能是日志配置的问题。

Spring Boot 默认使用 Logback 作为日志框架，但它的默认配置往往不能满足生产环境的需求。今天，我们彻底搞定 Spring Boot 的日志配置。

## 日志框架选择

Spring Boot 支持多种日志框架：

| 框架 | 说明 |
|-----|-----|
| Logback | 默认，Spring Boot 推荐 |
| Log4j2 | 异步性能好，Spring Boot 官方支持 |
| JUL | JDK 原生，不推荐 |

Spring Boot 的默认顺序是：`Logback` → `Log4j2` → `JUL`。

## 默认日志配置

Spring Boot 默认配置已经足够开发使用：

```yaml
logging:
  level:
    root: INFO
    com.example: DEBUG
```

输出示例：

```
2024-01-15 10:30:15.123  INFO 12345 --- [main] com.example.Application    : Starting Application...
2024-01-15 10:30:15.456  DEBUG 12345 --- [main] com.example.UserService    : User query executed
2024-01-15 10:30:16.789  ERROR 12345 --- [main] com.example.UserService    : Database connection failed
```

## application.yml 日志配置

### 日志级别

```yaml
logging:
  level:
    root: INFO
    com.example: DEBUG
    com.example.service: INFO
    org.springframework.web: WARN
    org.hibernate: INFO
```

### 日志文件

```yaml
logging:
  file:
    name: logs/application.log
    max-size: 10MB
    max-history: 30
  logback:
    rollingpolicy:
      max-file-size: 10MB
      total-size-cap: 1GB
```

### 日志格式

```yaml
logging:
  pattern:
    console: "%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n"
    file: "%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{36} - %msg%n"
```

## logback-spring.xml 配置

对于更复杂的日志配置，需要使用 `logback-spring.xml` 文件。

### 基础配置

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <!-- 定义日志格式 -->
    <property name="LOG_PATTERN" 
        value="%d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{50} - %msg%n"/>
    <property name="LOG_FILE" value="logs/application.log"/>
    
    <!-- 控制台 Appender -->
    <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>${LOG_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
    </appender>
    
    <!-- 文件 Appender -->
    <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${LOG_FILE}</file>
        <encoder>
            <pattern>${LOG_PATTERN}</pattern>
            <charset>UTF-8</charset>
        </encoder>
        <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
            <fileNamePattern>logs/application-%d{yyyy-MM-dd}.%i.log</fileNamePattern>
            <maxFileSize>100MB</maxFileSize>
            <maxHistory>30</maxHistory>
            <totalSizeCap>3GB</totalSizeCap>
        </rollingPolicy>
    </appender>
    
    <!-- 异步 Appender -->
    <appender name="ASYNC_FILE" class="ch.qos.logback.classic.AsyncAppender">
        <discardingThreshold>0</discardingThreshold>
        <queueSize>256</queueSize>
        <appender-ref ref="FILE"/>
    </appender>
    
    <!-- 根日志 -->
    <root level="INFO">
        <appender-ref ref="CONSOLE"/>
        <appender-ref ref="ASYNC_FILE"/>
    </root>
    
    <!-- 指定包的日志级别 -->
    <logger name="com.example" level="DEBUG"/>
    <logger name="org.springframework" level="INFO"/>
</configuration>
```

### 多环境日志配置

Spring Boot 支持通过 spring profile 切换日志配置：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <springProfile name="dev">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
        </root>
    </springProfile>
    
    <springProfile name="prod">
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
            <appender-ref ref="FILE"/>
        </root>
    </springProfile>
</configuration>
```

## Log4j2 配置

如果使用 Log4j2，需要排除 Logback：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
    <exclusions>
        <exclusion>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-logging</artifactId>
        </exclusion>
    </exclusions>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-log4j2</artifactId>
</dependency>
```

### log4j2-spring.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<Configuration>
    <Properties>
        <Property name="LOG_PATTERN">
            %d{yyyy-MM-dd HH:mm:ss.SSS} %-5level [%thread] %logger{50} - %msg%n
        </Property>
    </Properties>
    
    <Appenders>
        <Console name="Console" target="SYSTEM_OUT">
            <PatternLayout pattern="${LOG_PATTERN}"/>
        </Console>
        
        <RollingFile name="File" 
            fileName="logs/application.log"
            filePattern="logs/application-%d{yyyy-MM-dd}.log">
            <PatternLayout pattern="${LOG_PATTERN}"/>
            <Policies>
                <TimeBasedTriggeringPolicy interval="1" modulate="true"/>
                <SizeBasedTriggeringPolicy size="100MB"/>
            </Policies>
            <DefaultRolloverStrategy max="30"/>
        </RollingFile>
        
        <!-- 异步 Appender -->
        <Async name="AsyncFile">
            <AppenderRef ref="File"/>
        </Async>
    </Appenders>
    
    <Loggers>
        <Root level="INFO">
            <AppenderRef ref="Console"/>
            <AppenderRef ref="AsyncFile"/>
        </Root>
    </Loggers>
</Configuration>
```

## SLF4J 使用

### 基本用法

```java
@RestController
public class UserController {
    
    private static final Logger logger = LoggerFactory.getLogger(UserController.class);
    
    @GetMapping("/user/{id}")
    public ResponseEntity&lt;User&gt; getUser(@PathVariable Long id) {
        logger.debug("Getting user with id: {}", id);
        
        try {
            User user = userService.findById(id);
            logger.info("User found: {}", user.getUsername());
            return ResponseEntity.ok(user);
        } catch (Exception e) {
            logger.error("Error getting user: {}", e.getMessage(), e);
            return ResponseEntity.notFound().build();
        }
    }
}
```

### 使用 Lombok 简化

```java
@RestController
@RequiredArgsConstructor
public class UserController {
    
    private final UserService userService;
    
    // Lombok 自动生成 log 字段
    @GetMapping("/user/{id}")
    public ResponseEntity&lt;User&gt; getUser(@PathVariable Long id) {
        log.debug("Getting user with id: {}", id);
        // ...
    }
}
```

### 占位符使用

```java
// 错误：字符串拼接，即使日志不打印也会执行
logger.debug("User: " + user);

// 正确：使用占位符，日志级别不够时不执行拼接
logger.debug("User: {}", user);

// 多个参数
logger.debug("User {} logged in from {}", username, ipAddress);

// 带异常
logger.error("Operation failed", exception);
```

## 性能优化

### 1. 异步日志

```xml
<appender name="ASYNC_FILE" class="ch.qos.logback.classic.AsyncAppender">
    <discardingThreshold>0</discardingThreshold>
    <queueSize>512</queueSize>
    <includeCallerData>false</includeCallerData>
    <appender-ref ref="FILE"/>
</appender>
```

**参数说明**：
- `discardingThreshold`：队列剩余容量低于此值时丢弃日志，0 表示不丢弃
- `queueSize`：阻塞队列大小，默认 256
- `includeCallerData`：是否包含调用位置数据，开销大，建议关闭

### 2. 避免在日志中执行方法

```java
// 错误：即使日志不打印，也会执行 toString()
logger.debug("User: {}", user.toString());

// 正确：只有日志打印时才执行 toString()
logger.debug("User: {}", user);
```

### 3. 使用条件日志

```java
// 如果日志级别不够，不会执行 isExpensiveOperation()
if (logger.isDebugEnabled()) {
    String result = expensiveOperation();
    logger.debug("Result: {}", result);
}
```

## 日志分组

```yaml
logging:
  group:
    spring: org.springframework,org.springframework.boot
    tomcat: org.apache.tomcat
    db: org.hibernate,org.springframework.jdbc
  level:
    spring: INFO
    tomcat: WARN
    db: DEBUG
```

## 自定义日志 Logger

```java
@RestController
public class OrderController {
    
    // 自定义 Logger 名称
    private static final Logger orderLogger = 
        LoggerFactory.getLogger("com.example.order");
    
    private static final Logger paymentLogger = 
        LoggerFactory.getLogger("com.example.payment");
    
    @PostMapping("/order")
    public ResponseEntity&lt;Order&gt; createOrder(@RequestBody OrderRequest request) {
        orderLogger.info("Creating order: {}", request);
        
        try {
            Order order = orderService.create(request);
            paymentLogger.info("Payment initiated for order: {}", order.getId());
            return ResponseEntity.ok(order);
        } catch (PaymentException e) {
            paymentLogger.error("Payment failed for order: {}", request, e);
            return ResponseEntity.badRequest().build();
        }
    }
}
```

```yaml
logging:
  level:
    com.example.order: INFO
    com.example.payment: WARN
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| Spring Boot 默认使用什么日志框架？ | 日志框架选择 |
| Logback 和 Log4j2 的区别？ | 日志框架对比 |
| 异步日志有什么优势？ | 性能优化 |
| 如何配置多环境日志？ | 日志配置 |
| 占位符 {} 和字符串拼接哪个好？ | 性能问题 |

---

> 日志是排查问题的第一手资料。好的日志配置，能让你在生产环境中快速定位问题；差的日志配置，会让你在问题面前束手无策。
