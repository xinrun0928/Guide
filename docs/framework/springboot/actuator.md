# Spring Boot Actuator 监控端点

你有没有想过：应用上线后，如何知道它是否健康？如何监控接口调用次数、数据库连接池状态？

Spring Boot Actuator 就是为这个而生的。

## Actuator 是什么

Actuator（执行器）是 Spring Boot 的监控和管理功能，它以 RESTful API 的形式暴露应用的内部信息。

引入依赖：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```

## 启用端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: "*"  # 暴露所有端点
  endpoint:
    health:
      show-details: always  # 显示健康详情
```

## 常用端点一览

| 端点 | 说明 |
|-----|-----|
| `/actuator/health` | 健康检查 |
| `/actuator/info` | 应用信息 |
| `/actuator/metrics` | 指标数据 |
| `/actuator/env` | 环境变量 |
| `/actuator/beans` | 所有 Bean |
| `/actuator/mappings` | URL 映射 |
| `/actuator/threaddump` | 线程快照 |
| `/actuator/heapdump` | 堆转储 |
| `/actuator/loggers` | 日志配置 |
| `/actuator/scheduledtasks` | 定时任务 |

## 健康检查端点

### 基本用法

```bash
curl http://localhost:8080/actuator/health
```

响应：

```json
{
  "status": "UP"
}
```

### 检查具体组件

```bash
curl http://localhost:8080/actuator/health/liveness
curl http://localhost:8080/actuator/health/readiness
```

### 自定义健康检查

```java
@Component
public class MyHealthIndicator implements HealthIndicator {
    
    @Override
    public Health health() {
        // 检查逻辑
        boolean isHealthy = checkMyService();
        
        if (isHealthy) {
            return Health.up()
                .withDetail("message", "Service is running")
                .build();
        } else {
            return Health.down()
                .withDetail("message", "Service is unavailable")
                .withException(new RuntimeException("Connection failed"))
                .build();
        }
    }
    
    private boolean checkMyService() {
        // 实际检查逻辑
        return true;
    }
}
```

### 组合多个健康指标

```java
@Component
public class DatabaseHealthIndicator implements HealthIndicator {
    
    @Autowired
    private DataSource dataSource;
    
    @Override
    public Health health() {
        try (Connection connection = dataSource.getConnection()) {
            return Health.up()
                .withDetail("database", connection.getCatalog())
                .withDetail("driver", connection.getMetaData().getDriverName())
                .build();
        } catch (SQLException e) {
            return Health.down()
                .withException(e)
                .build();
        }
    }
}
```

## 指标端点

### 查看所有指标

```bash
curl http://localhost:8080/actuator/metrics
```

响应：

```json
{
  "names": [
    "jvm.memory.used",
    "jvm.memory.max",
    "http.server.requests",
    "process.cpu.usage",
    "tomcat.sessions.active.current",
    "hikaricp.connections.active",
    "...")
}
```

### 查看具体指标

```bash
curl http://localhost:8080/actuator/metrics/jvm.memory.used
```

响应：

```json
{
  "name": "jvm.memory.used",
  "description": "JVM memory usage",
  "baseUnit": "bytes",
  "measurements": [
    {
      "statistic": "VALUE",
      "value": 158392384
    }
  ],
  "availableTags": [
    {
      "tag": "area",
      "values": ["heap", "nonheap"]
    },
    {
      "tag": "id",
      "values": ["PS Eden Space", "PS Survivor Space", "PS Old Gen"]
    }
  ]
}
```

### 自定义指标

```java
@RestController
public class UserController {
    
    private final MeterRegistry meterRegistry;
    
    public UserController(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }
    
    private final Counter userLoginCounter = meterRegistry.counter("user.login.count");
    
    @PostMapping("/login")
    public ResponseEntity&lt;String&gt; login(@RequestBody LoginRequest request) {
        // 登录逻辑
        userLoginCounter.increment();  // 计数器 +1
        return ResponseEntity.ok("Login success");
    }
}
```

### 统计接口耗时

```java
@RestController
public class OrderController {
    
    private final MeterRegistry meterRegistry;
    
    public OrderController(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
    }
    
    @GetMapping("/order/{id}")
    public ResponseEntity&lt;Order&gt; getOrder(@PathVariable Long id) {
        Timer.Sample sample = Timer.start(meterRegistry);
        try {
            Order order = orderService.findById(id);
            return ResponseEntity.ok(order);
        } finally {
            sample.stop(Timer.builder("order.query")
                .tag("status", "success")
                .register(meterRegistry));
        }
    }
}
```

## Bean 列表端点

```bash
# 查看所有 Bean
curl http://localhost:8080/actuator/beans

# 过滤某个 Bean
curl http://localhost:8080/actuator/beans | jq '.beans[] | select(.bean | startswith("user"))'
```

响应示例：

```json
{
  "contexts": {
    "application": {
      "beans": {
        "userController": {
          "scope": "singleton",
          "type": "com.example.UserController",
          "resource": "file:.../target/classes/com/example/UserController.class",
          "dependencies": [
            "userService",
            "meterRegistry"
          ]
        }
      }
    }
  }
}
```

## 线程快照端点

```bash
curl http://localhost:8080/actuator/threaddump
```

响应：

```json
{
  "threads": [
    {
      "name": "http-nio-8080-exec-1",
      "threadId": 36,
      "state": "RUNNABLE",
      "stackTrace": [...],
      "lockedMonitors": [],
      "lockedSynchronizers": [],
      "blockedTime": -1,
      "blockedCount": 0,
      "waitedTime": -1,
      "waitedCount": 0
    }
  ]
}
```

## 日志配置端点

```bash
# 查看日志级别
curl http://localhost:8080/actuator/loggers

# 修改日志级别（临时生效）
curl -X POST http://localhost:8080/actuator/loggers/com.example \
  -H "Content-Type: application/json" \
  -d '{"configuredLevel": "DEBUG"}'
```

## 定时任务端点

```bash
curl http://localhost:8080/actuator/scheduledtasks
```

响应：

```json
{
  "cronTasks": [
    {
      "runnable": {
        "target": "com.example.Scheduler.refresh()"
      },
      "expression": "0 0/5 * * * ?"
    }
  ],
  "fixedDelayTasks": [...],
  "fixedRateTasks": [...]
}
```

## 端点安全配置

### 开放部分端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info,metrics
        exclude: env,beans,threaddump
```

### 端点路径配置

```yaml
management:
  endpoints:
    web:
      base-path: /manage  # 修改端点前缀
  endpoint:
    health:
      path: health-check  # 修改单个端点路径
```

### 端点启用/禁用

```yaml
management:
  endpoint:
    health:
      enabled: true
    info:
      enabled: true
    shutdown:
      enabled: false  # 禁用关闭端点
```

### 安全配置

```java
@Configuration
public class ActuatorSecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .requestMatchers("/actuator/**").authenticated()
            )
            .httpBasic();
        return http.build();
    }
}
```

## 自定义 Info 端点

### 静态信息

```yaml
# application.yml
info:
  app:
    name: ${spring.application.name}
    version: 1.0.0
    description: 用户服务
  git:
    enabled: true  # 启用 git 信息
```

### 动态信息

```java
@Component
public class CustomInfoContributor implements InfoContributor {
    
    @Override
    public void contribute(Info.Builder builder) {
        builder.withDetail("custom", Map.of(
            "key1", "value1",
            "key2", "value2",
            "timestamp", LocalDateTime.now().toString()
        ));
    }
}
```

## Actuator 与 Prometheus 整合

### 引入依赖

```xml
<dependency>
    <groupId>io.micrometer</groupId>
    <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```

### 暴露 prometheus 端点

```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,prometheus,metrics
  metrics:
    tags:
      application: ${spring.application.name}
```

### 访问 Prometheus 格式的指标

```bash
curl http://localhost:8080/actuator/prometheus
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| Actuator 的健康检查是如何工作的？ | 健康指标 |
| 如何自定义健康检查？ | HealthIndicator |
| 如何保护 Actuator 端点？ | 安全配置 |
| Actuator 能监控哪些指标？ | 监控能力 |

---

> Actuator 是 Spring Boot 监控的基础设施。配合 Prometheus 和 Grafana，你可以搭建完整的应用监控体系——这是现代微服务架构的标配。
