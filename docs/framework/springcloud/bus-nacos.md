# Spring Cloud Bus + Nacos 实现配置自动刷新

> Nacos 配置改了，但服务感知不到？一个个重启太麻烦？
>
> 这一讲，我们把 Spring Cloud Bus 和 Nacos 结合起来，实现配置变更的秒级自动刷新。

---

## 为什么需要这个组合

### Nacos 配置变更的默认行为

```
┌─────────────────────────────────────────────────────────┐
│               Nacos 配置变更默认流程                      │
│                                                          │
│  1. Nacos 控制台修改配置                                │
│           │                                              │
│           ▼                                              │
│  2. Nacos 推送变更通知                                   │
│           │                                              │
│           ▼                                              │
│  3. 服务本地缓存更新                                     │
│           │                                              │
│           ▼                                              │
│  4. @Value 注解下次使用时生效                            │
│           │                                              │
│           ▼                                              │
│  问题：已经注入的 Bean 不会自动重建                       │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**问题**：只有主动获取配置时，配置才会更新。已经通过 @Value 注入的 Bean 不会自动重建。

### 解决方案

**Nacos Watch + Spring Cloud Bus = 自动刷新**

```
Nacos 配置变更
       │
       ▼
┌─────────────────┐
│ Nacos Watch     │ 监听配置变更
│ ConfigListener  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Spring Cloud    │
│ Bus             │ 广播刷新事件
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────┐
│              所有服务实例                                 │
│                                                          │
│  ContextRefresher.refresh()                             │
│           │                                              │
│           ▼                                              │
│  @RefreshScope Bean 销毁并重建                           │
│           │                                              │
│           ▼                                              │
│  配置生效 ✓                                              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

## 快速开始

### 1. 引入依赖

```xml
<dependencies>
    <!-- Nacos Config -->
    <dependency>
        <groupId>com.alibaba.cloud</groupId>
        <artifactId>spring-cloud-starter-alibaba-nacos-config</artifactId>
    </dependency>
    
    <!-- Spring Cloud Bus RabbitMQ -->
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-bus-amqp</artifactId>
    </dependency>
    
    <!-- Actuator（刷新端点） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
spring:
  application:
    name: order-service
  
  cloud:
    # Nacos 配置中心
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yaml
        namespace: dev
        group: ORDER_GROUP
        refresh-enabled: true
      discovery:
        server-addr: 127.0.0.1:8848
    
    # Spring Cloud Bus
    bus:
      enabled: true
      trace:
        enabled: true
      # 刷新配置（Bus 1.x）
      bus-refresh:
        enabled: true
  
  # RabbitMQ 配置
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest

# 暴露 Actuator 端点
management:
  endpoints:
    web:
      exposure:
        include: health,info,busrefresh,bus-env,refresh
  endpoint:
    busrefresh:
      enabled: true
```

### 3. 启用配置刷新

```java
@SpringBootApplication
@EnableDiscoveryClient
@EnableFeignClients
public class OrderApplication {
    public static void main(String[] args) {
        SpringApplication.run(OrderApplication.class, args);
    }
}
```

```java
@RestController
@RefreshScope  // 关键：开启配置刷新
public class OrderController {
    
    @Value("${order.timeout:5000}")
    private int orderTimeout;
    
    @Value("${order.max-items:100}")
    private int maxItems;
    
    @GetMapping("/config")
    public Map&lt;String, Object&gt; getConfig() {
        Map&lt;String, Object&gt; config = new HashMap&lt;&gt;();
        config.put("timeout", orderTimeout);
        config.put("maxItems", maxItems);
        return config;
    }
}
```

---

## Nacos 控制台配置

### 1. 创建配置

在 Nacos 控制台创建：

```
Data ID: order-service.yaml
Group: ORDER_GROUP
配置格式: YAML
```

```yaml
order:
  timeout: 5000
  max-items: 100
  retry-times: 3
```

### 2. 触发刷新

**方式一：通过 Nacos 控制台**

在 Nacos 控制台修改配置后，点击「发布」旁边的「是否批量发布」选项，选择广播到所有实例。

**方式二：通过接口触发**

```bash
# 刷新所有服务
curl -X POST http://localhost:8080/actuator/busrefresh

# 刷新指定服务
curl -X POST "http://localhost:8080/actuator/busrefresh?destination=order-service:**"
```

**方式三：Nacos 监听自动触发**

Nacos 2.x 客户端会自动监听配置变更，配合 Bus 实现自动刷新。

---

## 进阶配置

### 1. 自定义刷新范围

```java
@Configuration
public class RefreshScopeConfig {
    
    @Autowired
    private ContextRefresher contextRefresher;
    
    @Autowired
    private Environment environment;
    
    /**
     * 只刷新特定前缀的配置
     */
    public void refreshOrderConfig() {
        Set&lt;String&gt; keys = contextRefresher.refresh();
        
        // 只处理 order 相关的配置
        keys.stream()
            .filter(k -&gt; k.startsWith("order."))
            .forEach(k -&gt; {
                String value = environment.getProperty(k);
                System.out.println("刷新配置: " + k + " = " + value);
            });
    }
}
```

### 2. 配置变更监听

```java
@Component
public class NacosConfigListener {
    
    @NacosConfigListener(dataId = "order-service.yaml", groupId = "ORDER_GROUP")
    public void onConfigChanged(String config) {
        System.out.println("配置变更: " + config);
        // 自定义处理逻辑
    }
}
```

### 3. 环境隔离

```yaml
spring:
  cloud:
    nacos:
      config:
        namespace: ${NACOS_NAMESPACE:dev}  # 通过环境变量指定
```

```
dev 命名空间 → 开发环境
test 命名空间 → 测试环境
prod 命名空间 → 生产环境
```

---

## 完整示例

### 项目结构

```
order-service/
├── pom.xml
├── src/main/
│   ├── java/com/example/order/
│   │   ├── OrderApplication.java
│   │   ├── controller/
│   │   │   └── OrderController.java
│   │   ├── service/
│   │   │   └── OrderService.java
│   │   └── config/
│   │       └── NacosConfig.java
│   └── resources/
│       └── bootstrap.yml
```

### bootstrap.yml

```yaml
spring:
  application:
    name: order-service
  cloud:
    nacos:
      config:
        server-addr: 127.0.0.1:8848
        file-extension: yaml
        namespace: dev
        group: ORDER_GROUP
        refresh-enabled: true
        # 共享配置
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true
    bus:
      enabled: true
      trace:
        enabled: true
  rabbitmq:
    host: localhost
    port: 5672

management:
  endpoints:
    web:
      exposure:
        include: health,info,busrefresh,refresh
```

### OrderController

```java
@RestController
@RequestMapping("/order")
@RefreshScope
@Slf4j
public class OrderController {
    
    @Value("${order.timeout:5000}")
    private int timeout;
    
    @Value("${order.max-items:100}")
    private int maxItems;
    
    @Autowired
    private OrderProperties orderProperties;
    
    @GetMapping("/config")
    public Result&lt;Map&lt;String, Object&gt;&gt; getConfig() {
        Map&lt;String, Object&gt; config = new HashMap&lt;&gt;();
        config.put("timeout", timeout);
        config.put("maxItems", maxItems);
        config.put("fromProperties", orderProperties);
        return Result.ok(config);
    }
    
    @PostMapping("/refresh")
    public Result&lt;String&gt; refresh() {
        log.info("手动刷新配置...");
        return Result.ok("配置刷新成功");
    }
}
```

### 测试步骤

1. **启动 Order 服务**（多个实例）
2. **Nacos 控制台创建配置**
3. **调用接口验证初始值**
4. **Nacos 控制台修改配置**
5. **调用接口验证新值**

```bash
# 查看实例 1 配置
curl http://localhost:8080/order/config

# 刷新配置
curl -X POST http://localhost:8080/actuator/busrefresh

# 再次查看配置
curl http://localhost:8080/order/config
```

---

## 常见问题

### Q：配置刷新了但值没变？

A：检查几个点：

1. 类上是否加了 `@RefreshScope`
2. 是否暴露了 `/actuator/busrefresh` 端点
3. RabbitMQ 是否正常

### Q：如何刷新多个配置？

A：配置共享配置后，共享配置的变更也会触发刷新：

```yaml
spring:
  cloud:
    nacos:
      config:
        shared-configs:
          - data-id: common.yaml
            group: COMMON_GROUP
            refresh: true
```

### Q：不想用 Bus，能否自动刷新？

A：可以。Nacos 2.x 客户端支持配置变更自动推送，配合 `@NacosConfigurationProperties` 可以实现无需 Bus 的自动刷新。

---

## 面试高频问题

### Q：Spring Cloud Bus 和 Nacos 的 @NacosConfigListener 有什么区别？

A：**@NacosConfigListener** 只在当前服务生效，**Bus** 可以广播到所有服务实例。如果只需要单个服务监听配置，用 @NacosConfigListener；如果需要所有服务同时刷新，用 Bus。

### Q：如何实现精确刷新（只刷新某些服务）？

A：通过 `destination` 参数：`?destination=order-service:8080` 只刷新 order-service 的 8080 实例。

### Q：刷新失败会影响业务吗？

A：不会。刷新只影响 @RefreshScope 的 Bean，不影响整个应用。失败的 Bean 会保持旧值。

---

## 总结

Spring Cloud Bus + Nacos 实现了配置变更的秒级自动刷新：

1. **Nacos**：配置存储和变更通知
2. **Spring Cloud Bus**：配置变更广播
3. **@RefreshScope**：配置 Bean 重建
4. **Actuator**：手动触发刷新

> 这套组合拳，让配置管理从「重启生效」变成了「秒级生效」，是微服务配置治理的黄金搭档。
