# 多级降级方案：页面降级、请求拦截、数据聚合降级

你有没有想过：当系统压力过大时，是让整个系统崩溃，还是让部分功能「优雅地消失」？

这就像一艘正在下沉的船，与其让所有人一起遇难，不如先把非核心舱室灌水，保住核心动力系统。

多级降级，就是这种「丢车保帅」的策略。

## 降级的层次划分

### 一级：非核心功能降级

```
┌─────────────────────────────────────────────────────────────┐
│                      系统正常状态                              │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐           │
│  │ 商品浏览 │ │  用户登录 │ │  购物车  │ │  订单管理 │           │
│  │  ✅ 正常 │ │  ✅ 正常 │ │  ✅ 正常 │ │  ✅ 正常 │           │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘           │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                       │
│  │ 推荐系统 │ │ 积分系统 │ │ 评价系统 │                       │
│  │  ✅ 正常 │ │  ✅ 正常 │ │  ✅ 正常 │                       │
│  └─────────┘ └─────────┘ └─────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```
┌─────────────────────────────────────────────────────────────┐
│                    一级降级：关闭非核心功能                      │
│                                                             │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │
│  │ 商品浏览 │ │  用户登录 │ │  购物车  │ │  订单管理 │         │
│  │  ✅ 正常 │ │  ✅ 正常 │ │  ✅ 正常 │ │  ✅ 正常 │         │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘         │
│                         │                                   │
│                         ▼                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                       │
│  │ 推荐系统 │ │ 积分系统 │ │ 评价系统 │                       │
│  │  ⬇️ 降级  │ │  ⬇️ 降级  │ │  ⬇️ 降级  │                       │
│  └─────────┘ └─────────┘ └─────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 二级：数据降级

```
┌─────────────────────────────────────────────────────────────┐
│                    二级降级：数据简化                          │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   商品详情页                           │   │
│  │                                                     │   │
│  │  商品名称：iPhone 15 Pro ✅                          │   │
│  │  价格：¥7999 ✅                                     │   │
│  │  库存：充足 ✅                                       │   │
│  │  ──────────────────────────────────────────────    │   │
│  │  推荐商品：⏸️ 暂时不显示                             │   │
│  │  用户评价：⏸️ 暂时不显示                             │   │
│  │  商品详情：简化版（去掉图片、视频、SKU详情） ✅         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 三级：页面降级

```
┌─────────────────────────────────────────────────────────────┐
│                    三级降级：静态页面兜底                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                     │   │
│  │           😢 系统繁忙，请稍后再试                      │   │
│  │                                                     │   │
│  │           ╭─────────────────────────╮               │   │
│  │           │   [返回首页]  [刷新页面]  │               │   │
│  │           ╰─────────────────────────╯               │   │
│  │                                                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 四级：服务拒绝

```java
// 当系统压力极大时，直接拒绝请求
if (systemLoad.isCritical()) {
    return Response.builder()
        .code(503)
        .message("系统繁忙，当前请求已被限流，请稍后重试")
        .retryAfter(30)  // 告诉客户端 30 秒后重试
        .build();
}
```

## 页面级降级

### 静态兜底页面

当服务端完全不可用时，返回静态 HTML 页面。

```java
@Controller
public class DegradeController {

    @RequestMapping("/degrade/fallback")
    public String degradeFallback(HttpServletRequest request) {
        // 根据错误类型返回不同的兜底页面
        String errorType = request.getParameter("type");

        switch (errorType) {
            case "timeout":
                return "forward:/static/fallback/timeout.html";
            case "overload":
                return "forward:/static/fallback/overload.html";
            case "unavailable":
                return "forward:/static/fallback/unavailable.html";
            default:
                return "forward:/static/fallback/generic.html";
        }
    }
}
```

```html
&lt;!-- static/fallback/overload.html --&gt;
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
    &lt;title&gt;系统繁忙&lt;/title&gt;
    &lt;style&gt;
        .container {
            text-align: center;
            padding: 100px 20px;
        }
        .message {
            font-size: 24px;
            color: #666;
            margin: 20px 0;
        }
        .btn {
            background: #007bff;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            margin: 0 10px;
        }
    &lt;/style&gt;
&lt;/head&gt;
&lt;body&gt;
    &lt;div class="container"&gt;
        &lt;h1&gt;😢 系统繁忙&lt;/h1&gt;
        &lt;p class="message"&gt;当前访问人数较多，请稍后再试&lt;/p&gt;
        &lt;p&gt;预计恢复时间：&lt;span id="retry-after"&gt;30&lt;/span&gt; 秒&lt;/p&gt;
        &lt;button class="btn" onclick="location.reload()"&gt;刷新页面&lt;/button&gt;
        &lt;button class="btn" onclick="location.href='/'"&gt;返回首页&lt;/button&gt;
    &lt;/div&gt;
    &lt;script&gt;
        // 自动倒计时
        let count = 30;
        setInterval(() =&gt; {
            count--;
            document.getElementById('retry-after').textContent = count;
            if (count &lt;= 0) location.reload();
        }, 1000);
    &lt;/script&gt;
&lt;/body&gt;
&lt;/html&gt;
```

### 服务端渲染降级

```java
@Service
public class ProductPageService {

    private final ProductService productService;
    private final ReviewService reviewService;
    private final RecommendationService recommendationService;

    /**
     * 获取商品详情页数据
     * 多级降级：如果某个服务不可用，返回简化数据
     */
    public ProductPageData getProductPage(Long productId) {
        ProductPageData data = new ProductPageData();

        // 1. 核心数据：必须获取
        try {
            data.setProduct(productService.getProduct(productId));
        } catch (Exception e) {
            log.error("获取商品信息失败: {}", e.getMessage());
            throw new ProductUnavailableException();
        }

        // 2. 库存数据：可降级
        try {
            data.setInventory(inventoryService.getInventory(productId));
        } catch (Exception e) {
            log.warn("获取库存信息失败，降级: {}", e.getMessage());
            data.setInventory(InventoryData.degraded());
        }

        // 3. 评论数据：可降级
        try {
            data.setReviews(reviewService.getReviews(productId, 10));
        } catch (Exception e) {
            log.warn("获取评论信息失败，降级: {}", e.getMessage());
            data.setReviews(Collections.emptyList());
            data.setReviewsDegraded(true);
        }

        // 4. 推荐数据：可降级
        try {
            data.setRecommendations(recommendationService.getRecommendations(productId));
        } catch (Exception e) {
            log.warn("获取推荐信息失败，降级: {}", e.getMessage());
            data.setRecommendations(Collections.emptyList());
            data.setRecommendationsDegraded(true);
        }

        return data;
    }
}
```

## 请求级降级

### 请求拦截降级

在网关层根据条件拦截请求。

```java
@Component
public class LoadSheddingFilter {

    private final AtomicReference&lt;DegradeLevel&gt; currentLevel = new AtomicReference&lt;&gt;(
        DegradeLevel.NONE
    );

    @Autowired
    private SystemMonitor systemMonitor;

    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, WebFilterChain chain) {
        DegradeLevel level = currentLevel.get();

        // 检查是否需要降级
        if (level == DegradeLevel.NONE) {
            return chain.filter(exchange);
        }

        // 根据降级级别处理
        switch (level) {
            case REJECT_LOW_PRIORITY:
                // 拒绝低优先级请求
                if (!isHighPriority(exchange)) {
                    return buildDegradeResponse(exchange, "系统繁忙");
                }
                break;

            case REJECT_NON_VIP:
                // 拒绝非 VIP 用户
                if (!isVipUser(exchange)) {
                    return buildDegradeResponse(exchange, "仅 VIP 用户可用");
                }
                break;

            case REJECT_ALL:
                // 拒绝所有请求
                return buildDegradeResponse(exchange, "系统维护中");
        }

        return chain.filter(exchange);
    }

    private boolean isHighPriority(ServerWebExchange exchange) {
        String priority = exchange.getRequest().getHeaders()
            .getFirst("X-Request-Priority");
        return "HIGH".equals(priority);
    }

    private boolean isVipUser(ServerWebExchange exchange) {
        String userId = getUserId(exchange);
        return userId != null && vipService.isVip(userId);
    }

    private Mono&lt;Void&gt; buildDegradeResponse(ServerWebExchange exchange, String message) {
        exchange.getResponse().setStatusCode(HttpStatus.SERVICE_UNAVAILABLE);
        exchange.getResponse().getHeaders().add("Retry-After", "30");

        byte[] bytes = ("{\"code\":503,\"message\":\"" + message + "\"}").getBytes();
        DataBuffer buffer = exchange.getResponse().bufferFactory().wrap(bytes);

        return exchange.getResponse().writeWith(Mono.just(buffer));
    }

    public enum DegradeLevel {
        NONE,                    // 正常
        REJECT_LOW_PRIORITY,     // 拒绝低优先级请求
        REJECT_NON_VIP,          // 拒绝非 VIP 用户
        REJECT_ALL               // 拒绝所有请求
    }
}
```

### 注解驱动的降级

```java
/**
 * 降级注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface Degradable {
    /**
     * 降级级别
     */
    DegradeLevel level() default DegradeLevel.L1;

    /**
     * 降级时返回的提示信息
     */
    String message() default "服务降级中，请稍后重试";

    /**
     * 降级方法名
     */
    String fallbackMethod() default "";
}

/**
 * 降级级别枚举
 */
public enum DegradeLevel {
    L1_DISABLE_RECOMMEND(1),   // 禁用推荐功能
    L2_DISABLE_REVIEW(2),       // 禁用评论功能
    L3_DISABLE_COMMENT(3),      // 禁用评论功能
    L4_STATIC_DATA(4),         // 返回静态数据
    L5_FALLBACK(5);            // 完全降级
}

/**
 * 降级切面
 */
@Aspect
@Component
public class DegradeAspect {

    @Autowired
    private DegradeManager degradeManager;

    @Around("@annotation(degradable)")
    public Object around(ProceedingJoinPoint point, Degradable degradable) throws Throwable {
        DegradeLevel currentLevel = degradeManager.getCurrentLevel();

        if (currentLevel.getValue() >= degradable.level().getValue()) {
            log.info("触发降级: level={}, method={}",
                currentLevel, point.getSignature().getName());

            if (!"".equals(degradable.fallbackMethod())) {
                return invokeFallback(point, degradable.fallbackMethod());
            }

            return buildDegradeResponse(degradable.message());
        }

        return point.proceed();
    }
}
```

```java
// 使用示例
@Service
public class ProductService {

    @Degradable(level = DegradeLevel.L1_DISABLE_RECOMMEND,
                message = "推荐服务暂时不可用")
    public List&lt;Product&gt; getRecommendations(Long userId) {
        return recommendationService.getForUser(userId);
    }

    @Degradable(level = DegradeLevel.L2_DISABLE_REVIEW,
                message = "评论功能暂时不可用")
    public List&lt;Review&gt; getProductReviews(Long productId) {
        return reviewService.getReviews(productId);
    }
}
```

## 数据聚合降级

### 分层数据获取

```java
@Service
public class OrderDetailService {

    /**
     * 获取订单详情（多级降级）
     *
     * 优先级：数据库 > 缓存 > 降级数据
     */
    public OrderDetail getOrderDetail(Long orderId) {
        // 级别 1：尝试从数据库获取
        try {
            OrderDetail detail = fetchFromDatabase(orderId);
            cacheOrderDetail(orderId, detail);
            return detail;
        } catch (Exception e) {
            log.warn("从数据库获取订单详情失败: {}", e.getMessage());
        }

        // 级别 2：尝试从缓存获取
        try {
            OrderDetail cached = getFromCache(orderId);
            if (cached != null) {
                log.info("从缓存降级返回订单详情: orderId={}", orderId);
                return cached;
            }
        } catch (Exception e) {
            log.warn("从缓存获取订单详情失败: {}", e.getMessage());
        }

        // 级别 3：返回降级数据
        return getDegradedOrderDetail(orderId);
    }

    private OrderDetail fetchFromDatabase(Long orderId) {
        // 正常逻辑
        Order order = orderMapper.selectById(orderId);
        OrderDetail detail = buildOrderDetail(order);
        return detail;
    }

    private void cacheOrderDetail(Long orderId, OrderDetail detail) {
        // 更新缓存，设置较长的过期时间
        cacheTemplate.opsForValue().set(
            "order:detail:" + orderId,
            detail,
            1, TimeUnit.HOURS
        );
    }

    private OrderDetail getFromCache(Long orderId) {
        return cacheTemplate.opsForValue().get("order:detail:" + orderId);
    }

    private OrderDetail getDegradedOrderDetail(Long orderId) {
        // 返回最小化数据
        return OrderDetail.builder()
            .orderId(orderId)
            .status("QUERYING")
            .message("订单详情加载中，请稍后刷新")
            .build();
    }
}
```

### 异步数据降级

```java
@Service
public class ProductDetailService {

    @Autowired
    private ProductMapper productMapper;
    @Autowired
    private AsyncService asyncService;

    /**
     * 获取商品详情（核心数据同步 + 非核心数据异步）
     */
    public ProductDetail getProductDetail(Long productId) {
        ProductDetail detail = new ProductDetail();

        // 1. 核心数据：同步获取（必须成功）
        Product product = productMapper.selectById(productId);
        if (product == null) {
            throw new ProductNotFoundException(productId);
        }
        detail.setProduct(product);

        // 2. 推荐数据：异步获取，降级时不阻塞主流程
        asyncService.fetchRecommendations(productId)
            .thenAccept(recommendations -&gt; detail.setRecommendations(recommendations))
            .exceptionally(ex -&gt; {
                log.warn("异步获取推荐失败: {}", ex.getMessage());
                detail.setRecommendations(Collections.emptyList());
                return null;
            });

        // 3. 评论数据：异步获取
        asyncService.fetchReviews(productId)
            .thenAccept(reviews -&gt; detail.setReviews(reviews))
            .exceptionally(ex -&gt; {
                log.warn("异步获取评论失败: {}", ex.getMessage());
                detail.setReviews(Collections.emptyList());
                return null;
            });

        // 4. 销售数据：异步获取
        asyncService.fetchSalesData(productId)
            .thenAccept(sales -&gt; detail.setSalesData(sales))
            .exceptionally(ex -&gt; {
                log.warn("异步获取销售数据失败: {}", ex.getMessage());
                return null;
            });

        return detail;
    }
}
```

## 降级配置中心

### 动态降级开关

```java
@Configuration
public class DegradeConfiguration {

    @Bean
    public DegradeProperties degradeProperties(ConfigCenter configCenter) {
        DegradeProperties props = new DegradeProperties();

        // 监听配置变化
        configCenter.addListener("/degrade/config", event -> {
            DegradeConfig config = JSON.parseObject(
                event.getNewValue(),
                DegradeConfig.class
            );
            props.update(config);
            log.info("降级配置已更新: {}", config);
        });

        return props;
    }
}

@Data
public class DegradeProperties {

    private volatile boolean recommendationEnabled = true;
    private volatile boolean reviewEnabled = true;
    private volatile boolean searchEnabled = true;
    private volatile boolean commentEnabled = true;
    private volatile boolean promotionEnabled = true;

    // 降级阈值
    private volatile double cpuThreshold = 0.8;
    private volatile double memoryThreshold = 0.85;
    private volatile int threadPoolQueueSizeThreshold = 1000;

    public void update(DegradeConfig config) {
        this.recommendationEnabled = config.isRecommendationEnabled();
        this.reviewEnabled = config.isReviewEnabled();
        this.searchEnabled = config.isSearchEnabled();
        this.commentEnabled = config.isCommentEnabled();
        this.promotionEnabled = config.isPromotionEnabled();
        this.cpuThreshold = config.getCpuThreshold();
        this.memoryThreshold = config.getMemoryThreshold();
    }
}
```

### 降级管理 API

```java
@RestController
@RequestMapping("/admin/degrade")
public class DegradeAdminController {

    @Autowired
    private DegradeManager degradeManager;

    /**
     * 获取降级状态
     */
    @GetMapping("/status")
    public Response&lt;DegradeStatus&gt; getStatus() {
        return Response.success(degradeManager.getStatus());
    }

    /**
     * 手动触发降级
     */
    @PostMapping("/enable")
    public Response&lt;String&gt; enableDegrade(
            @RequestParam String level,
            @RequestParam(required = false) String service) {

        degradeManager.enableDegrade(DegradeLevel.valueOf(level), service);
        return Response.success("降级已开启: " + level);
    }

    /**
     * 关闭降级
     */
    @PostMapping("/disable")
    public Response&lt;String&gt; disableDegrade(@RequestParam(required = false) String service) {
        degradeManager.disableDegrade(service);
        return Response.success("降级已关闭");
    }

    /**
     * 获取降级配置
     */
    @GetMapping("/config")
    public Response&lt;DegradeConfig&gt; getConfig() {
        return Response.success(degradeManager.getConfig());
    }

    /**
     * 更新降级配置
     */
    @PostMapping("/config")
    public Response&lt;String&gt; updateConfig(@RequestBody DegradeConfig config) {
        degradeManager.updateConfig(config);
        return Response.success("配置已更新");
    }
}
```

## 降级最佳实践

### 1. 降级要有监控

```java
@Aspect
@Component
public class DegradeMonitorAspect {

    @Autowired
    private MetricsService metricsService;

    @Around("@annotation(Degradable)")
    public Object monitorDegrade(ProceedingJoinPoint point) throws Throwable {
        long start = System.currentTimeMillis();

        try {
            return point.proceed();
        } catch (DegradeException e) {
            metricsService.increment("degrade.count",
                Tags.of("method", point.getSignature().getName()));
            throw e;
        } finally {
            long duration = System.currentTimeMillis() - start;
            metricsService.record("degrade.latency", duration,
                Tags.of("method", point.getSignature().getName()));
        }
    }
}
```

### 2. 降级要有告警

```java
@Service
public class DegradeAlertService {

    @Autowired
    private AlertManager alertManager;
    @Autowired
    private DegradeManager degradeManager;

    @Scheduled(fixedRate = 10000)
    public void checkDegrade() {
        DegradeStatus status = degradeManager.getStatus();

        if (status.isDegraded()) {
            Alert alert = Alert.builder()
                .level(AlertLevel.WARNING)
                .title("服务降级告警")
                .message(String.format(
                    "服务已进入降级状态\n" +
                    "降级级别: %s\n" +
                    "降级服务: %s\n" +
                    "触发时间: %s",
                    status.getLevel(),
                    status.getDegradedServices(),
                    status.getDegradeTime()
                ))
                .build();

            alertManager.send(alert);
        }
    }
}
```

### 3. 降级要可回滚

```java
@Service
public class DegradeManager {

    private final Stack&lt;DegradeSnapshot&gt; history = new Stack&lt;&gt;();

    public void enableDegrade(DegradeLevel level, String service) {
        // 保存快照，用于回滚
        DegradeSnapshot snapshot = new DegradeSnapshot(level, service, Instant.now());
        history.push(snapshot);

        // 执行降级
        doDegrade(level, service);

        log.info("降级已开启: level={}, service={}", level, service);
    }

    public void rollback() {
        if (history.isEmpty()) {
            return;
        }

        DegradeSnapshot snapshot = history.pop();
        doRecovery(snapshot.getService());

        log.info("降级已回滚: service={}", snapshot.getService());
    }
}
```

---

**思考题：**

1. 假设你在负责一个电商系统，需要设计降级策略。核心功能（登录、下单、支付）和非核心功能（推荐、评价、积分）的降级优先级如何划分？

2. 降级配置是存放在代码中还是配置中心？为什么？如果放在配置中心，如何处理配置下发延迟的问题？

3. 如何判断降级后系统是否恢复了？自动恢复的阈值如何设定？设置得过高或过低会有什么后果？

4. 多级降级中，如何保证降级后的数据一致性？比如用户下单成功后，推荐系统被降级了，用户看到的推荐为空，这个可以接受吗？
