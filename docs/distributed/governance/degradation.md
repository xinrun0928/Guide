# 服务降级：多级降级策略与兜底方案

你有没有想过这个问题：

双十一零点，服务器扛不住了。

这时候你有几个选择：

1. 什么都不做 → 所有请求超时 → 用户体验极差 → 系统崩溃
2. 关闭部分功能 → 只保留核心功能 → 核心流程可用 → 系统稳住

选择 2，就是**降级**。

降级的本质：**牺牲部分功能，保证核心功能可用**。

## 降级的本质

降级不是「放弃治疗」，而是「战略收缩」。

```
核心功能：下单、支付
非核心功能：评论、推荐、统计
```

当系统扛不住时，优先保证核心功能，关闭非核心功能。

## 多级降级策略

降级策略可以分多个级别：

### 级别一：页面降级

返回缓存页面或默认页面。

```java
@GetMapping("/product/{id}")
public String getProduct(@PathVariable Long id) {
    try {
        return productService.getProduct(id);
    } catch (Exception e) {
        // 返回缓存页面
        return getCachedProduct(id);
    }
}
```

### 级别二：写操作降级

停止写入，转为消息队列异步处理。

```java
public void createOrder(Order order) {
    try {
        // 尝试直接写入
        orderDao.insert(order);
    } catch (Exception e) {
        // 降级：写入消息队列
        mqProducer.send("order-topic", order);
        // 异步处理，不影响主流程
    }
}
```

### 级别三：读操作降级

返回缓存数据或默认值。

```java
public Product getProduct(Long id) {
    try {
        // 尝试查询数据库
        return productDao.findById(id);
    } catch (Exception e) {
        // 降级：返回缓存数据
        Product cached = redisTemplate.opsForValue().get("product:" + id);
        if (cached != null) {
            return cached;
        }
        // 再降级：返回默认值
        return Product.DEFAULT;
    }
}
```

### 级别四：非核心服务降级

直接返回空或错误码。

```java
public OrderDetail getOrderDetail(Long orderId) {
    OrderDetail detail = new OrderDetail();
    detail.setOrder(orderService.getOrder(orderId));

    // 评论服务降级
    try {
        detail.setComments(commentService.getComments(orderId));
    } catch (Exception e) {
        detail.setComments(Collections.emptyList());
    }

    // 推荐服务降级
    try {
        detail.setRecommendations(recommendService.getRecommendations(orderId));
    } catch (Exception e) {
        detail.setRecommendations(Collections.emptyList());
    }

    return detail;
}
```

## 降级 vs 熔断

很多人容易混淆降级和熔断。

```
熔断：是「保护」，防止故障蔓延
降级：是「妥协」，牺牲非核心功能
```

两者的关系：

```
熔断触发 → 调用降级方法
```

熔断是手段，降级是目的。

## 降级的实现方式

### Hystrix 的 @HystrixCommand

```java
@Service
public class UserService {

    @Autowired
    private RestTemplate restTemplate;

    @HystrixCommand(
        fallbackMethod = "getDefaultUser",
        commandProperties = {
            @HystrixProperty(name = "execution.isolation.thread.timeoutInMilliseconds", value = "1000")
        }
    )
    public User getUser(Long id) {
        return restTemplate.getForObject("http://user-service/users/" + id, User.class);
    }

    // 降级方法
    public User getDefaultUser(Long id) {
        return User.builder()
            .id(id)
            .name("默认用户")
            .build();
    }
}
```

### Sentinel 的 @SentinelResource

```java
@Service
public class ProductService {

    @SentinelResource(
        value = "getProduct",
        fallback = "getProductFallback"
    )
    public Product getProduct(Long id) {
        return productDao.findById(id);
    }

    public Product getProductFallback(Long id, Throwable t) {
        log.error("Product query failed, id={}", id, t);
        return Product.DEFAULT;
    }
}
```

### Spring Cloud OpenFeign 的降级

```java
@FeignClient(
    name = "user-service",
    fallback = UserClientFallback.class
)
public interface UserClient {
    @GetMapping("/users/{id}")
    User getUser(@PathVariable("id") Long id);
}

@Component
public class UserClientFallback implements UserClient {
    @Override
    public User getUser(Long id) {
        return User.builder()
            .id(id)
            .name("默认用户")
            .build();
    }
}
```

## 降级策略的触发条件

什么时候触发降级？

```java
// 条件一：服务响应慢
if (responseTime > threshold) {
    // 降级非核心功能
}

// 条件二：服务错误率高
if (errorRate > threshold) {
    // 降级非核心功能
}

// 条件三：系统资源紧张
if (cpu > 90% || memory > 90%) {
    // 降级非核心功能
}

// 条件四：业务高峰期
if (isPeakHour()) {
    // 降级非核心功能
}
```

## 降级的最佳实践

### 1. 明确核心功能

```
核心功能：下单、支付、登录
非核心功能：评论、推荐、统计
```

### 2. 设计降级开关

```java
@ConfigurationProperties(prefix = "feature")
public class FeatureToggle {
    private boolean commentEnabled = true;
    private boolean recommendationEnabled = true;
    private boolean statisticsEnabled = true;
}
```

### 3. 分级降级

```
第一级：关闭推荐服务
第二级：关闭评论服务
第三级：关闭统计服务
第四级：返回缓存页面
```

### 4. 降级后要恢复

```java
// 监控降级后的指标
// 自动恢复或手动恢复

if (metrics.recovered()) {
    enableFeature("comment");
}
```

## 总结

降级是系统保护的最后一道防线：

- **多级降级**：页面 → 写操作 → 读操作 → 非核心服务
- **降级触发**：响应慢、错误率高、资源紧张、高峰期
- **降级实现**：Hystrix/Sentinel/OpenFeign
- **核心原则**：保证核心功能，牺牲非核心功能

好的降级策略，能让系统在极端情况下「优雅降级」而不是「崩溃」。

**面试追问方向：**
- 降级和熔断有什么区别？
- 如何设计一个多级降级策略？
- 降级后如何恢复？
- Hystrix 和 Sentinel 的降级有什么不同？