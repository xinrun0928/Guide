# 服务弹性降级：核心链路识别与降级策略

双十一零点，你的系统承受不住了。

商品详情页还能访问，但评论、推荐、分享这些功能已经超时了。

你怎么办？

把整个系统都关掉？还是让它撑一会，尽量保持核心功能可用？

你需要——**降级**。

## 弹性的定义

弹性的核心是：**系统在部分组件故障时，仍能提供服务**。

不是追求 100% 可用，而是**在有限的资源下，保证核心功能可用**。

## 核心链路识别

降级的第一步是**识别核心链路**。

### 什么是核心链路？

```
用户下单流程：
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ 商品详情 │ → │ 库存扣减 │ → │ 订单创建 │ → │ 支付    │
└─────────┘   └─────────┘   └─────────┘   └─────────┘

核心链路：商品 → 库存 → 订单 → 支付
非核心链路：评论、推荐、分享、积分、消息通知
```

### 核心链路的特点

1. **没有它业务无法完成**：下单流程中断
2. **用户付费意愿强**：支付功能必须可用
3. **数据一致性要求高**：库存、订单数据必须准确

### 非核心链路的特点

1. **没有它业务可以继续**：下单可以没有评论
2. **用户体验相关**：评论功能不影响下单
3. **可以延迟处理**：消息通知可以异步

## 降级策略的分级

降级不是一刀切，而是分级的。

### 一级降级：关闭非核心功能

```
关闭：评论、推荐、分享、积分、消息通知
保留：商品详情、库存、订单、支付
```

```java
@Configuration
public class FeatureSwitch {

    public static final String COMMENT_ENABLED = "feature.comment.enabled";
    public static final String RECOMMEND_ENABLED = "feature.recommend.enabled";
    public static final String SHARE_ENABLED = "feature.share.enabled";
}

@Service
public class CommentService {

    @Autowired
    private ConfigService configService;

    public List&lt;Comment&gt; getComments(Long productId) {
        // 一级降级：功能开关
        if (!configService.isEnabled(FeatureSwitch.COMMENT_ENABLED)) {
            return Collections.emptyList();
        }
        return commentRepository.findByProductId(productId);
    }
}
```

### 二级降级：返回缓存数据

```java
@Service
public class RecommendService {

    @Autowired
    private RedisTemplate redisTemplate;

    @Autowired
    private ConfigService configService;

    public List&lt;Product&gt; getRecommend(Long userId) {
        // 二级降级：缓存兜底
        String cacheKey = "recommend:" + userId;
        List&lt;Product&gt; cached = redisTemplate.opsForList().range(cacheKey, 0, 9);

        if (CollectionUtils.isNotEmpty(cached)) {
            return cached;
        }

        // 缓存也没有，返回默认推荐
        return getDefaultRecommend();
    }

    private List&lt;Product&gt; getDefaultRecommend() {
        // 返回热门商品或空列表
        return productRepository.findHotProducts(10);
    }
}
```

### 三级降级：返回静态默认值

```java
@Service
public class ProductDetailService {

    public ProductDetail getProductDetail(Long productId) {
        try {
            return getFromDatabase(productId);
        } catch (Exception e) {
            // 三级降级：返回静态默认值
            return getStaticFallback(productId);
        }
    }

    private ProductDetail getStaticFallback(Long productId) {
        ProductDetail fallback = new ProductDetail();
        fallback.setProductId(productId);
        fallback.setName("商品名称");
        fallback.setPrice(0.01);
        fallback.setMessage("商品信息暂不可用");
        return fallback;
    }
}
```

### 四级降级：限流 + 排队

```java
@Service
public class OrderService {

    private static final int MAX_QUEUE_SIZE = 1000;
    private static final int MAX_CONCURRENT = 100;
    private AtomicInteger currentCount = new AtomicInteger(0);
    private LinkedBlockingQueue&lt;Order&gt; orderQueue = new LinkedBlockingQueue&lt;&gt;(MAX_QUEUE_SIZE);

    public String createOrder(Order order) {
        // 四级降级：限流 + 排队
        if (currentCount.get() >= MAX_CONCURRENT) {
            // 尝试加入队列
            if (!orderQueue.offer(order)) {
                throw new OrderException("系统繁忙，请稍后再试");
            }
            return "订单已加入队列，等待处理";
        }

        // 正常处理
        currentCount.incrementAndGet();
        try {
            return doCreateOrder(order);
        } finally {
            currentCount.decrementAndGet();
        }
    }
}
```

## 降级的自动化

手动降级太慢，需要自动化。

### Sentinel 降级规则

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void initDegradeRules() {
        List&lt;DegradeRule&gt; rules = new ArrayList&lt;&gt;();

        // 慢调用比例降级
        DegradeRule slowRule = new DegradeRule("CommentService:getComments")
            .setGrade(CircuitBreakerStrategy.SLOW_REQUEST_RATIO.getType())
            .setCount(0.5)  // 慢调用比例 50%
            .setSlowRatioThreshold(500)  // RT 超过 500ms 算慢调用
            .setMinRequestAmount(5)  // 最小请求数
            .setStatIntervalMs(10000)  // 10 秒窗口
            .setTimeWindow(10);  // 降级持续 10 秒
        rules.add(slowRule);

        // 异常比例降级
        DegradeRule errorRule = new DegradeRule("CommentService:getComments")
            .setGrade(CircuitBreakerStrategy.ERROR_RATIO.getType())
            .setCount(0.3)  // 异常比例 30%
            .setMinRequestAmount(5)
            .setTimeWindow(10);
        rules.add(errorRule);

        DegradeRuleManager.loadRules(rules);
    }
}
```

### 降级后的自动恢复

```java
@Service
public class DegradeRecoveryService {

    @Autowired
    private ConfigService configService;

    // 定时检查是否需要恢复
    @Scheduled(fixedRate = 30000)
    public void checkAndRecover() {
        if (isSystemHealthy()) {
            recoverFeatures();
        }
    }

    private boolean isSystemHealthy() {
        // 检查 CPU、内存、QPS、错误率等指标
        double cpu = metricsService.getCpuUsage();
        double errorRate = metricsService.getErrorRate();
        return cpu < 0.7 && errorRate < 0.05;
    }

    private void recoverFeatures() {
        // 按优先级恢复功能
        configService.enable(FeatureSwitch.COMMENT_ENABLED);
        configService.enable(FeatureSwitch.RECOMMEND_ENABLED);
        configService.enable(FeatureSwitch.SHARE_ENABLED);
    }
}
```

## 面试追问方向

- 如何识别核心链路？（答：分析业务流程，识别没有它业务无法完成的路径）
- 降级和熔断的区别？（答：降级是降低功能，熔断是停止调用）
- 降级后数据一致性问题怎么处理？（答：降级期间数据暂存，恢复后补偿）
- 如何避免降级后忘记恢复？（答：自动恢复机制 + 告警）

## 小结

服务弹性降级的核心是分层降级：

1. **一级降级**：关闭非核心功能
2. **二级降级**：返回缓存数据
3. **三级降级**：返回静态默认值
4. **四级降级**：限流 + 排队

降级的目的是**在系统压力下，保证核心链路可用**，而不是追求 100% 功能完整。
