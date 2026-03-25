# Nacos 热更新，@RefreshScope 与配置动态刷新

> 改个配置要重启所有服务？双十一前紧急关闭某个功能？运维半夜爬起来改配置？
>
> 配置热更新，让你在 Nacos 控制台点一下，所有服务瞬间生效——不用重启，不用运维。

---

## 场景切入：双十一前的紧急需求

凌晨 12 点，你刚准备睡觉，老板发来消息：

> 「某个营销接口流量太大，先关掉，明天上午再开。」

没有热更新？你需要：

1. 登录 10 台服务器
2. 修改配置
3. 重启 10 个服务实例
4. 确认每个服务都启动成功
5. 祈祷别出问题

**有了热更新，你只需要：**

1. 打开 Nacos 控制台
2. 找到对应配置
3. 改一个开关
4. 完成

**3 秒钟搞定。**

---

## @RefreshScope 原理

### 基本用法

```java
@RestController
@RefreshScope  // 开启配置热刷新
public class OrderController {
    
    @Value("${order.enabled:true}")
    private boolean orderEnabled;
    
    @Value("${order.max-items:100}")
    private int maxItems;
    
    @GetMapping("/create")
    public Result&lt;Order&gt; createOrder() {
        if (!orderEnabled) {
            return Result.fail("下单功能已关闭");
        }
        // 业务逻辑
        return Result.ok(orderService.create());
    }
}
```

### 原理揭秘

@RefreshScope 背后，是 Spring Cloud 的 Scope 机制：

```
┌─────────────────────────────────────────────────────────────┐
│                    @RefreshScope 工作原理                     │
│                                                              │
│  1. 首次加载                                                  │
│     @Value → 注入值 → 创建 Bean                               │
│                                                              │
│  2. 配置变更                                                  │
│     Nacos 推送变更事件 → ContextRefresher.refresh()           │
│                                                              │
│  3. Bean 重建                                                 │
│     销毁旧 Bean → 重新解析 @Value → 创建新 Bean                │
│                                                              │
│  4. 新值生效                                                  │
│     后续请求使用新 Bean                                       │
└─────────────────────────────────────────────────────────────┘
```

**核心代码**：

```java
// 简化版原理
public class RefreshScope extends AbstractScope {
    
    @Override
    public BeanWrapper resolve(String beanName, RootBeanDefinition mbd) {
        // 1. 销毁旧 Bean
        destroy(beanName);
        
        // 2. 创建新 Bean（会重新解析 @Value）
        return create(beanName, mbd);
    }
}
```

---

## 配置变更监听

### 方式一：@NacosConfigListener

监听特定配置的变化：

```java
@Service
public class OrderConfigService {
    
    @NacosConfigListener(dataId = "order-service.yaml", groupId = "ORDER_GROUP")
    public void onConfigChanged(String config) {
        // config 是变更后的完整配置内容
        System.out.println("订单配置变更：" + config);
        
        // 解析并应用新配置
        Properties props = Nacos.getConfig(config);
        applyConfig(props);
    }
}
```

### 方式二：@NacosConfigurationProperties

绑定配置到 Java Bean：

```java
@Data
@ConfigurationProperties(prefix = "order")
@NacosConfigurationProperties(dataId = "order-service.yaml", autoRefreshed = true)
public class OrderProperties {
    
    private boolean enabled = true;
    private int maxItems = 100;
    private int timeout = 5000;
}
```

```java
@RestController
@RefreshScope
public class OrderController {
    
    @Autowired
    private OrderProperties orderProperties;
    
    @GetMapping("/config")
    public OrderProperties getConfig() {
        return orderProperties;  // 自动刷新
    }
}
```

### 方式三：EnvironmentChangeEvent

监听 Spring 环境变更：

```java
@Service
public class EnvironmentService {
    
    @EventListener
    public void onEnvironmentChange(EnvironmentChangeEvent event) {
        // 获取变化的 key
        Set&lt;String&gt; keys = event.getKeys();
        System.out.println("配置变更：" + keys);
        
        // 重新加载相关配置
        for (String key : keys) {
            if (key.startsWith("order.")) {
                reloadOrderConfig(key);
            }
        }
    }
}
```

---

## 手动刷新与自动刷新

### 自动刷新（推荐）

Nacos 客户端默认每 3 秒轮询一次配置：

```yaml
spring:
  cloud:
    nacos:
      config:
        refresh-enabled: true  # 默认 true，开启自动刷新
        # 轮询间隔（默认 3000ms）
        # config-retry-time: 3000
```

### 手动刷新

通过 Actuator 端点触发：

```bash
# 刷新单个服务
curl -X POST http://localhost:8080/actuator/refresh

# 响应
{
    "order.timeout": "修改后的值",
    "order.max-items": "修改后的值"
}
```

```java
// 自定义刷新端点
@PostMapping("/refresh")
public String refresh(@RequestParam(required = false) String dataId) {
    if (dataId == null) {
        contextRefresher.refresh();
    } else {
        // 刷新指定配置
        nacosConfigManager.getConfigService()
            .addListener(dataId, group, new Listener() {
                @Override
                public void receiveConfigInfo(String config) {
                    // 处理配置
                }
            });
    }
    return "refreshed";
}
```

### 广播刷新（配合 Bus）

利用 Spring Cloud Bus 广播刷新事件：

```bash
# 向某个服务发送刷新请求
curl -X POST http://localhost:8080/actuator/busrefresh
```

---

## Bean 重建的影响

### @RefreshScope 的副作用

每次刷新，**整个 Bean 会被重新创建**。这意味着：

1. **@Autowired 的 Bean 会被重新注入**
2. **@PostConstruct 会被再次执行**
3. **数据库连接池会被重建**
4. **如果有状态，会话信息会丢失**

### 解决方案

#### 1. 使用 @ConfigurationProperties 代替 @Value

```java
// 方案一：@ConfigurationProperties 更优雅
@Data
@Component
@ConfigurationProperties(prefix = "order")
public class OrderProperties {
    private int timeout = 5000;
    private int maxItems = 100;
}
```

#### 2. 使用 @NacosValue 替代 @Value

```java
// 方案二：@NacosValue 自动刷新
@NacosValue(value = "${order.timeout:5000}", autoRefreshed = true)
private int timeout;
```

#### 3. 懒加载关键 Bean

```java
// 方案三：关键 Bean 不用 @RefreshScope
@Service
public class OrderService {
    
    @Autowired
    private OrderProperties properties;  // 外部 Bean
    
    public void process() {
        // properties 自动拿到最新值
    }
}
```

---

## 配置刷新实战

### 场景一：功能开关

```yaml
# Nacos 配置
feature:
  new-order-page: false
  flash-sale: true
```

```java
@RefreshScope
@RestController
public class OrderController {
    
    @Value("${feature.new-order-page:false}")
    private boolean newOrderPage;
    
    @GetMapping("/order")
    public String orderPage() {
        if (newOrderPage) {
            return "new-order-page";  // 新页面
        }
        return "old-order-page";  // 旧页面
    }
}
```

**双十一凌晨，一行配置切换新旧页面。**

### 场景二：限流阈值动态调整

```yaml
# Nacos 配置
sentinel:
  qps-limit: 1000
  rt-threshold: 500
```

```java
@Data
@Component
@ConfigurationProperties(prefix = "sentinel")
public class SentinelProperties {
    private int qpsLimit = 1000;
    private int rtThreshold = 500;
}
```

```java
// 配合 Sentinel 动态更新限流规则
@Service
public class SentinelRuleService {
    
    @Autowired
    private SentinelProperties properties;
    
    @PostConstruct
    public void initRules() {
        // 初始化限流规则
        updateRules();
    }
    
    @EventListener(classes = EnvironmentChangeEvent.class)
    public void onEnvChange() {
        updateRules();  // 配置变化时更新规则
    }
    
    private void updateRules() {
        FlowRule rule = new FlowRule();
        rule.setCount(properties.getQpsLimit());
        FlowRuleManager.loadRules(Collections.singletonList(rule));
    }
}
```

### 场景三：数据库配置变更

```yaml
# Nacos 配置
spring:
  datasource:
    hikari:
      maximum-pool-size: 50
      minimum-idle: 10
```

> **警告**：数据库连接池配置变更需要重启服务才能生效，@RefreshScope 无法刷新 datasource Bean。

---

## 性能与最佳实践

### 刷新频率控制

```yaml
spring:
  cloud:
    nacos:
      config:
        # 轮询间隔，默认 3000ms
        config-retry-time: ${CONFIG_RETRY_INTERVAL:3000}
        # 最大重试次数，默认 3
        max-retry: 3
```

### 避免频繁刷新

```java
// 不好：每次配置变化都重建整个 Bean
@RefreshScope
public class ComplexService {
    // 包含复杂初始化逻辑
}

// 好：只刷新必要的配置 Bean
@Configuration
public class Config {
    
    @Bean
    @RefreshScope
    public OrderProperties orderProperties() {
        return new OrderProperties();
    }
    
    @Bean
    public OrderService orderService() {
        return new OrderService();  // 不需要刷新
    }
}
```

---

## 面试高频问题

### Q：@RefreshScope 的原理是什么？

A：基于 Spring 的 Scope 机制。每次刷新时，Bean 会被销毁并重新创建，@Value 注解会被重新解析。如果 Bean 包含复杂初始化逻辑，性能影响会比较大。

### Q：哪些配置可以热更新？

A：

1. **@Value 注解的配置**
2. **@ConfigurationProperties 绑定的配置**
3. **通过 @NacosConfigurationProperties 绑定的配置**

**不能热更新的**：

1. @Autowired 的其他 @Bean
2. 数据库连接池配置
3. Spring Boot 核心配置（如 server.port）

### Q：@RefreshScope 会影响性能吗？

A：会有一定影响。每次刷新会重建 Bean，如果 Bean 初始化成本高（如创建连接池），会影响响应时间。建议只对需要热更新的配置使用 @RefreshScope。

### Q：如何避免 Bean 重建带来的问题？

A：

1. 使用 @ConfigurationProperties 替代 @Value
2. 将配置 Bean 和业务 Bean 分离
3. 使用 @NacosValue 的 autoRefreshed 属性
4. 关键资源（如数据库连接）使用懒加载

---

## 总结

配置热更新让微服务配置管理更加灵活：

1. **@RefreshScope**：Bean 级别的配置刷新
2. **@NacosConfigListener**：监听配置变化
3. **@ConfigurationProperties**：优雅的配置绑定
4. **配合 Spring Cloud Bus**：实现全局配置广播

> 热更新是微服务运维的利器。用好它，可以让配置变更像发消息一样简单。
