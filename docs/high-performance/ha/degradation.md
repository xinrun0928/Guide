# 服务降级：多级降级策略与兜底方案

你有没有想过：当你的服务濒临崩溃时，是选择「硬扛」还是「优雅地放弃」？

很多系统在面对流量洪峰时，会选择硬扛——CPU 打满、内存耗尽、响应超时、最后直接宕机。用户看到的是白屏、报错、甚至整个系统不可用。

但真正的高可用系统，会选择**主动放弃**。

不是彻底放弃，而是「丢车保帅」——牺牲部分功能，保证核心功能可用；牺牲部分用户体验，保证服务不宕机。

这就是**服务降级**。

## 什么是服务降级

服务降级是指在系统压力过大、资源紧张或依赖服务不可用时，主动降低系统提供的服务级别，保证核心功能可用的策略。

打个比方：电商大促时，商品详情页的「推荐商品」「猜你喜欢」可以暂时不显示，但下单和支付功能必须保证。这就是降级——把非核心功能「关掉」，把资源留给核心流程。

### 降级 vs 熔断 vs 限流

这三个概念经常被混淆，它们是互补关系：

| 策略 | 触发条件 | 目的 | 位置 |
|------|---------|------|------|
| **限流** | 流量超过阈值 | 保护系统不被压垮 | 入口层 |
| **熔断** | 依赖服务故障 | 快速失败，防止级联故障 | 调用方 |
| **降级** | 系统压力或故障 | 保证核心功能，牺牲非核心 | 服务方 |

```
限流（入口保护）→ 熔断（调用保护）→ 降级（功能保护）
```

## 为什么要降级

### 1. 保护核心功能

当系统资源不足时，不是所有功能都同样重要。以电商系统为例：

```
核心功能（必须保证）：
├── 用户登录
├── 商品浏览
├── 下单支付
└── 订单查询

非核心功能（可以降级）：
├── 商品评价
├── 推荐系统
├── 积分系统
└── 消息通知
```

### 2. 防止雪崩效应

服务 A 调用服务 B，B 挂了，A 还在疯狂调用 B → A 也耗尽资源 → C 调用 A 也挂了 → 连锁反应...

降级可以在这条链的每个环节「剪断」，防止故障蔓延。

### 3. 提升用户体验

用户看到一个「功能暂时不可用」的提示，远比看到一个白屏或报错要好得多。

## 降级的层次

### 1. 页面级降级

当服务不可用时，返回一个友好的提示页面。

```
┌─────────────────────────────────────┐
│                                     │
│   😢 服务暂时繁忙                    │
│                                     │
│   正在努力恢复中...                  │
│   预计等待时间：5 分钟               │
│                                     │
│   [刷新页面]  [返回首页]            │
│                                     │
└─────────────────────────────────────┘
```

### 2. 业务级降级

根据业务重要性，选择性地关闭或简化功能。

```java
public class ProductService {

    private volatile boolean reviewEnabled = true;
    private volatile boolean recommendationEnabled = true;
    private volatile boolean searchEnabled = true;

    public ProductDetail getProductDetail(Long productId) {
        ProductDetail detail = productDao.getById(productId);

        // 评论系统降级
        if (reviewEnabled) {
            try {
                detail.setReviews(reviewService.getReviews(productId));
            } catch (Exception e) {
                log.warn("评论系统降级: {}", e.getMessage());
                detail.setReviews(Collections.emptyList());
            }
        }

        // 推荐系统降级
        if (recommendationEnabled) {
            try {
                detail.setRecommendations(
                    recommendationService.getRecommendations(productId));
            } catch (Exception e) {
                log.warn("推荐系统降级: {}", e.getMessage());
                detail.setRecommendations(Collections.emptyList());
            }
        }

        return detail;
    }
}
```

### 3. 数据级降级

返回缓存数据或默认值，而不是实时数据。

```java
public UserInfo getUserInfo(Long userId) {
    try {
        // 尝试从数据库获取最新数据
        UserInfo userInfo = userDao.getById(userId);
        // 更新缓存
        cache.set("user:" + userId, userInfo, 5, TimeUnit.MINUTES);
        return userInfo;
    } catch (Exception e) {
        // 数据库不可用，降级到缓存
        UserInfo cached = cache.get("user:" + userId);
        if (cached != null) {
            log.info("用户信息降级: 从缓存返回 userId={}", userId);
            return cached;
        }

        // 缓存也没有，返回最小化信息
        return UserInfo.builder()
            .userId(userId)
            .username("用户" + userId)
            .status("DEGRADED")
            .build();
    }
}
```

### 4. 请求级降级

根据请求特征，选择性处理。

```java
public Response handleRequest(Request request) {
    // 高并发期间，只处理 VIP 用户或重要请求
    if (systemLoad.isHigh()) {
        if (!request.isVip() && request.getPriority() < Priority.HIGH) {
            return Response.builder()
                .code("DEGRADED")
                .message("系统繁忙，请稍后再试")
                .build();
        }
    }

    return normalProcess(request);
}
```

## 降级策略

### 1. 自动降级

基于监控指标自动触发和恢复。

```java
public class AutoDegradeManager {

    private final MeterRegistry meterRegistry;
    private final AtomicBoolean degraded = new AtomicBoolean(false);

    // 定时检查系统指标
    @Scheduled(fixedRate = 10000)
    public void checkSystemMetrics() {
        double cpuUsage = meterRegistry.get("system.cpu.usage").gauge().value();
        double memoryUsage = meterRegistry.get("jvm.memory.used").gauge().value()
            / meterRegistry.get("jvm.memory.max").gauge().value();

        // CPU > 80% 或 内存 > 85%，触发降级
        if (cpuUsage > 0.8 || memoryUsage > 0.85) {
            if (degraded.compareAndSet(false, true)) {
                log.warn("触发自动降级: CPU={}, Memory={}", cpuUsage, memoryUsage);
                doDegrade();
            }
        } else if (degraded.get()) {
            // 指标恢复正常，自动恢复
            if (cpuUsage < 0.6 && memoryUsage < 0.7) {
                if (degraded.compareAndSet(true, false)) {
                    log.info("系统恢复正常，解除降级");
                    recovery();
                }
            }
        }
    }

    private void doDegrade() {
        // 关闭非核心服务
        recommendationService.disable();
        reviewService.disable();
        notifyService.disable();
    }

    private void recovery() {
        // 恢复服务
        recommendationService.enable();
        reviewService.enable();
        notifyService.enable();
    }
}
```

### 2. 手动降级

提供管理接口，允许运维人员手动触发降级。

```java
@RestController
@RequestMapping("/admin/degrade")
public class DegradeController {

    private final DegradeManager degradeManager;

    @PostMapping("/enable")
    public Response enableDegrade(@RequestParam String service) {
        degradeManager.degrade(service);
        return Response.success("降级已开启: " + service);
    }

    @PostMapping("/disable")
    public Response disableDegrade(@RequestParam String service) {
        degradeManager.recovery(service);
        return Response.success("服务已恢复: " + service);
    }

    @GetMapping("/status")
    public Response getDegradeStatus() {
        return Response.success(degradeManager.getStatus());
    }
}
```

### 3. 开关降级

使用配置中心动态控制降级。

```java
public class FeatureSwitchService {

    private final Config configCenter;

    public boolean isEnabled(String feature) {
        return configCenter.getBoolean("feature." + feature + ".enabled", true);
    }

    public String getFallback(String feature) {
        return configCenter.get("feature." + feature + ".fallback", "default");
    }
}

// 使用
if (featureSwitch.isEnabled("recommendation")) {
    // 正常逻辑
    recommendations = recommendationService.get(userId);
} else {
    // 降级逻辑
    recommendations = featureSwitch.getFallback("recommendation");
}
```

## 降级实现方式

### 1. 本地降级

将降级逻辑直接写在代码中。

```java
public class ProductService {

    public List&lt;Product&gt; getRecommendations(Long userId) {
        try {
            return remoteRecommendationService.getRecommendations(userId);
        } catch (Exception e) {
            // 本地降级：返回默认推荐
            return getLocalRecommendations();
        }
    }

    // 本地降级逻辑
    private List&lt;Product&gt; getLocalRecommendations() {
        // 简单的本地推荐逻辑
        return productDao.getPopularProducts(10);
    }
}
```

### 2. 注解降级

使用注解声明降级方法。

```java
@Aspect
@Component
public class DegradeAspect {

    @Autowired
    private DegradeConfig degradeConfig;

    @Around("@annotation(Degrade)")
    public Object degradeAround(ProceedingJoinPoint joinPoint) throws Throwable {
        Degrade degrade = joinPoint.getSignature()
            .getMethod()
            .getAnnotation(Degrade.class);

        try {
            return joinPoint.proceed();
        } catch (Exception e) {
            if (shouldDegrade(degrade, e)) {
                log.warn("触发降级: method={}, error={}",
                    joinPoint.getSignature().getName(), e.getMessage());
                return executeFallback(degrade.fallbackMethod(), joinPoint.getArgs());
            }
            throw e;
        }
    }

    private boolean shouldDegrade(Degrade degrade, Exception e) {
        // 检查异常类型是否符合降级条件
        for (Class&lt;? extends Exception&gt; clazz : degrade.ignoreExceptions()) {
            if (clazz.isInstance(e)) {
                return false;
            }
        }
        return true;
    }

    private Object executeFallback(String fallbackMethod, Object[] args) {
        // 调用降级方法
        // ...
        return null;
    }
}

// 使用
public class OrderService {

    @Degrade(fallbackMethod = "createOrderFallback",
             ignoreExceptions = {BusinessException.class})
    public Order createOrder(OrderRequest request) {
        return orderDao.create(request);
    }

    public Order createOrderFallback(OrderRequest request, Throwable e) {
        return Order.builder()
            .status("PENDING")
            .message("订单正在处理中")
            .build();
    }
}
```

### 3. 熔断器降级

与熔断器配合使用。

```java
public class RemoteServiceClient {

    private final CircuitBreaker circuitBreaker;
    private final RemoteService remoteService;

    public Response callRemote(String param) {
        return CheckedSupplier.of(() -> remoteService.call(param))
            .apply(circuitBreaker)
            .orElseGet(this::fallback);
    }

    private Response fallback() {
        log.warn("远程服务降级返回");
        return Response.builder()
            .code("DEGRADED")
            .data(getDefaultData())
            .build();
    }

    private Object getDefaultData() {
        // 返回降级数据
        return Collections.emptyMap();
    }
}
```

## 降级注意事项

### 1. 降级要有兜底

降级方法本身要能正常工作，不能降级方法里还有复杂的外部依赖。

```java
// 错误：降级方法里还调用了其他服务
public UserInfo getUserFallback(Long userId) {
    // 这个降级方法里又调用了用户服务，可能也有问题
    return anotherService.getUser(userId);
}

// 正确：降级方法只做简单处理
public UserInfo getUserFallback(Long userId) {
    return UserInfo.builder()
        .userId(userId)
        .username("用户" + userId)
        .build();
}
```

### 2. 降级要可监控

降级触发时，要有告警通知运维人员。

```java
public class DegradeManager {

    private final AlertManager alertManager;

    public void degrade(String service) {
        // 降级逻辑
        degradeService(service);

        // 发送告警
        alertManager.alert(Alert.builder()
            .level(AlertLevel.WARNING)
            .title("服务降级")
            .message("服务 " + service + " 已降级")
            .build());
    }
}
```

### 3. 降级要可回滚

降级操作要能快速恢复，不能「降下去就上不来了」。

### 4. 降级要考虑数据一致性

降级期间写入的数据，在恢复后要能正确处理。比如订单「pending」状态，降级恢复后要能继续处理。

## 降级最佳实践

### 分级降级策略

```
一级降级：关闭非核心功能
    ↓
二级降级：返回缓存数据
    ↓
三级降级：返回静态数据
    ↓
四级降级：返回友好提示
```

```java
public Response getProductDetail(Long productId) {
    try {
        // 一级：尝试正常获取
        return productService.getDetail(productId);
    } catch (Exception e) {
        try {
            // 二级：尝试从缓存获取
            return getFromCache(productId);
        } catch (Exception e2) {
            try {
                // 三级：返回静态数据
                return getStaticData(productId);
            } catch (Exception e3) {
                // 四级：返回友好提示
                return getDegradedResponse(productId);
            }
        }
    }
}
```

---

**思考题：**

假设你的电商系统在双十一大促期间，订单量暴增 10 倍，而服务器资源只能支撑 3 倍。

1. 如果让你设计降级策略，你会优先关闭哪些功能？优先级如何排序？
2. 降级期间，用户下单会看到什么提示？降级恢复后，这些「降级期间」的订单如何处理？
3. 如何避免降级期间的「雪后踏」问题——即降级恢复瞬间，大量积压请求同时涌入？
4. 如果让你实现一个「降级开关」，运维人员可以在界面上一键降级/恢复，需要考虑哪些技术细节？
