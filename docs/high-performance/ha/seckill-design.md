# 高可用架构案例：电商秒杀系统设计

2019 年双十一，天猫的订单峰值达到 54.4 万笔/秒。这个数字意味着什么？

如果用传统的方式处理，每个订单都要查库存、算优惠、扣库存、下订单……别说 54 万 TPS，给你 1 万 TPS，系统早就崩了。

今天我们就来聊聊：如何设计一个能扛住百万并发秒杀的系统。

## 秒杀系统的挑战

### 什么是秒杀

秒杀是一种限时促销活动，在极短的时间内以极低的价格出售限量商品。

```
秒杀活动的特点：
- 时间集中：可能集中在某个小时的某几分钟
- 流量巨大：瞬间流量是平时的 100-1000 倍
- 库存有限：商品数量有限，卖完即止
- 冲突严重：大量用户抢购有限商品
```

### 核心挑战

| 挑战 | 说明 |
|------|------|
| 高并发 | 瞬时流量巨大，系统资源紧张 |
| 资源冲突 | 大量请求抢购有限库存 |
| 业务复杂度 | 库存校验、优惠计算、订单创建 |
| 资金安全 | 支付环节不能出错 |
| 高可用 | 不能出现超卖、重复下单 |

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户请求                                  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐       │
│   │  CDN     │        │  LVS      │        │  防火墙   │       │
│   │  静态资源 │        │  负载均衡  │        │  安全防护 │       │
│   └───────────┘        └───────────┘        └───────────┘       │
│                              │                                   │
│                              ▼                                   │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                    接入层（网关）                          │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│   │   │  限流       │  │  风控       │  │  验证码     │   │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│   └────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                    秒杀服务集群                          │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│   │   │  秒杀活动    │  │  秒杀商品    │  │  订单服务   │   │   │
│   │   │  管理       │  │  查询       │  │            │   │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│   └────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐     │
│   │  Redis    │        │  MQ       │        │  MySQL    │     │
│   │  库存缓存  │        │  异步订单  │        │  订单存储  │     │
│   └───────────┘        └───────────┘        └───────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 分层设计

```java
/**
 * 秒杀系统的分层架构
 */
public class SeckillArchitecture {

    /**
     * 第一层：流量控制层
     * 职责：限制无效流量，保护系统
     */
    class FlowControlLayer {
        // CDN 缓存静态资源
        // LVS/Nginx 负载均衡
        // API 网关限流
        // 验证码/答题
    }

    /**
     * 第二层：业务处理层
     * 职责：处理秒杀核心逻辑
     */
    class BusinessLayer {
        // 秒杀活动查询
        // 库存预扣（Redis）
        // 订单创建
        // 消息队列
    }

    /**
     * 第三层：数据存储层
     * 职责：持久化存储
     */
    class DataLayer {
        // Redis 热点数据
        // MySQL 订单数据
        // 消息队列异步处理
    }
}
```

## 核心技术方案

### 1. 流量削峰

#### Redis 缓存 + 消息队列

```java
@Service
public class SeckillService {

    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;
    @Autowired
    private RabbitTemplate rabbitTemplate;

    private static final String STOCK_KEY_PREFIX = "seckill:stock:";
    private static final String ORDER_KEY_PREFIX = "seckill:order:";

    /**
     * 秒杀下单接口
     */
    public SeckillResult seckill(SeckillRequest request) {
        String productId = request.getProductId();
        String userId = request.getUserId();
        String stockKey = STOCK_KEY_PREFIX + productId;

        // 1. 检查活动是否开始
        if (!isSeckillStarted(productId)) {
            return SeckillResult.notStarted();
        }

        // 2. 检查活动是否结束
        if (isSeckillEnded(productId)) {
            return SeckillResult.ended();
        }

        // 3. 检查用户是否已购买
        String orderKey = ORDER_KEY_PREFIX + productId + ":" + userId;
        if (Boolean.TRUE.equals(redisTemplate.hasKey(orderKey))) {
            return SeckillResult.alreadyPurchased();
        }

        // 4. 预扣库存（原子操作）
        Long stock = redisTemplate.opsForValue().decrement(stockKey);
        if (stock == null || stock &lt; 0) {
            // 库存不足，恢复库存
            if (stock != null) {
                redisTemplate.opsForValue().increment(stockKey);
            }
            return SeckillResult.soldOut();
        }

        // 5. 创建订单消息
        SeckillOrder order = SeckillOrder.builder()
            .productId(productId)
            .userId(userId)
            .orderId(generateOrderId())
            .createTime(System.currentTimeMillis())
            .build();

        // 6. 发送到消息队列
        rabbitTemplate.convertAndSend("seckill.order", order);

        // 7. 记录用户购买标记
        redisTemplate.opsForValue().set(orderKey, order.getOrderId(),
            24, TimeUnit.HOURS);

        return SeckillResult.success(order.getOrderId());
    }

    /**
     * 异步处理订单
     */
    @RabbitListener(queues = "seckill.order")
    public void processOrder(SeckillOrder order) {
        try {
            // 创建正式订单
            create正式Order(order);

            // 扣减数据库库存
            deductDatabaseStock(order.getProductId());

        } catch (Exception e) {
            // 失败处理：恢复 Redis 库存
            redisTemplate.opsForValue().increment(
                STOCK_KEY_PREFIX + order.getProductId());
            log.error("订单处理失败: {}", order, e);
        }
    }
}
```

#### 验证码削峰

```java
@Service
public class CaptchaService {

    /**
     * 生成秒杀验证码
     */
    public CaptchaResult generateCaptcha(String productId, String userId) {
        // 生成数学题验证码
        int a = new Random().nextInt(100) + 1;
        int b = new Random().nextInt(100) + 1;
        int answer = a + b;

        String token = UUID.randomUUID().toString();
        String captcha = a + " + " + b + " = ?";

        // 验证码存入 Redis，设置 5 分钟过期
        redisTemplate.opsForValue().set(
            "captcha:" + token,
            String.valueOf(answer),
            5, TimeUnit.MINUTES
        );

        return CaptchaResult.builder()
            .token(token)
            .captcha(captcha)
            .build();
    }

    /**
     * 验证验证码
     */
    public boolean verifyCaptcha(String token, String answer) {
        String correct = redisTemplate.opsForValue().get("captcha:" + token);
        if (correct == null) {
            return false;
        }

        boolean match = correct.equals(answer);
        if (match) {
            redisTemplate.delete("captcha:" + token);
        }

        return match;
    }
}
```

### 2. 库存扣减

#### Lua 脚本保证原子性

```java
@Service
public class StockService {

    private static final String STOCK_KEY = "seckill:stock:";

    /**
     * 使用 Lua 脚本原子扣减库存
     */
    public boolean deductStock(String productId, int quantity) {
        String key = STOCK_KEY + productId;

        // Lua 脚本：检查库存并扣减
        String luaScript =
            "local stock = redis.call('GET', KEYS[1]) " +
            "if stock == false then " +
            "    return -1 " +  // 库存 key 不存在
            "end " +
            "stock = tonumber(stock) " +
            "if stock < tonumber(ARGV[1]) then " +
            "    return 0 " +  // 库存不足
            "end " +
            "redis.call('DECRBY', KEYS[1], ARGV[1]) " +
            "return stock - tonumber(ARGV[1])";  // 返回扣减后的库存

        DefaultRedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
        script.setScriptText(luaScript);
        script.setResultType(Long.class);

        Long result = redisTemplate.execute(script, List.of(key), String.valueOf(quantity));

        return result != null && result >= 0;
    }

    /**
     * 回补库存
     */
    public void restoreStock(String productId, int quantity) {
        String key = STOCK_KEY + productId;
        redisTemplate.opsForValue().increment(key, quantity);
    }
}
```

#### 库存预热

```java
@Service
public class StockWarmUpService {

    @Autowired
    private SeckillProductMapper productMapper;

    private static final String STOCK_KEY = "seckill:stock:";

    /**
     * 秒杀开始前预热库存到 Redis
     */
    public void warmUp(Long seckillId) {
        // 查询秒杀活动商品
        List&lt;SeckillProduct&gt; products = productMapper.selectBySeckillId(seckillId);

        for (SeckillProduct product : products) {
            String key = STOCK_KEY + product.getProductId();

            // 写入 Redis
            redisTemplate.opsForValue().set(key, String.valueOf(product.getStock()));

            // 设置活动结束时间
            redisTemplate.expireAt(key, product.getEndTime().toInstant());

            log.info("库存预热完成: productId={}, stock={}",
                product.getProductId(), product.getStock());
        }
    }
}
```

### 3. 订单处理

#### 异步订单创建

```java
@Service
public class AsyncOrderService {

    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private StockService stockService;

    /**
     * 异步创建订单
     */
    @Async("seckillOrderExecutor")
    @RabbitListener(queues = "seckill.order")
    public void createOrder(SeckillOrder seckillOrder) {
        try {
            // 1. 创建订单记录
            Order order = Order.builder()
                .orderNo(seckillOrder.getOrderId())
                .userId(seckillOrder.getUserId())
                .productId(seckillOrder.getProductId())
                .price(seckillOrder.getPrice())
                .status(OrderStatus.PENDING)
                .createTime(new Date())
                .build();

            orderMapper.insert(order);

            // 2. 扣减数据库库存
            stockService.deductDatabaseStock(seckillOrder.getProductId());

            // 3. 更新订单状态
            orderMapper.updateStatus(order.getId(), OrderStatus.CONFIRMED);

        } catch (DuplicateKeyException e) {
            // 幂等处理：订单已存在
            log.info("订单已存在: {}", seckillOrder.getOrderId());
        } catch (Exception e) {
            log.error("创建订单失败: {}", seckillOrder, e);

            // 回补 Redis 库存
            stockService.restoreStock(seckillOrder.getProductId(), 1);
        }
    }
}

@Configuration
public class AsyncConfig {
    @Bean("seckillOrderExecutor")
    public ThreadPoolTaskExecutor seckillOrderExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(20);
        executor.setMaxPoolSize(50);
        executor.setQueueCapacity(1000);
        executor.setThreadNamePrefix("seckill-order-");
        executor.initialize();
        return executor;
    }
}
```

### 4. 限流策略

#### 多级限流

```java
@Service
public class MultiLevelRateLimiter {

    /**
     * 第一级限流：IP 限流
     */
    public boolean ipRateLimit(String ip) {
        String key = "rate:ip:" + ip;
        Long count = redisTemplate.opsForValue().increment(key);

        if (count == 1) {
            redisTemplate.expire(key, 1, TimeUnit.MINUTES);
        }

        return count <= 1000;  // 每分钟每个 IP 最多 1000 次请求
    }

    /**
     * 第二级限流：用户限流
     */
    public boolean userRateLimit(String userId) {
        String key = "rate:user:" + userId;
        Long count = redisTemplate.opsForValue().increment(key);

        if (count == 1) {
            redisTemplate.expire(key, 1, TimeUnit.SECONDS);
        }

        return count <= 10;  // 每秒每个用户最多 10 次请求
    }

    /**
     * 第三级限流：商品限流
     */
    public boolean productRateLimit(String productId) {
        String key = "rate:product:" + productId;
        Long count = redisTemplate.opsForValue().increment(key);

        if (count == 1) {
            redisTemplate.expire(key, 1, TimeUnit.SECONDS);
        }

        return count <= 5000;  // 每秒每个商品最多 5000 次请求
    }
}
```

#### Sentinel 限流配置

```java
@Configuration
public class SentinelConfig {

    @PostConstruct
    public void init() {
        // 定义秒杀接口的限流规则
        List&lt;FlowRule&gt; rules = new ArrayList&lt;&gt;();

        FlowRule seckillRule = FlowRule.of("seckill")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setCount(100000)  // 10 万 QPS
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_DEFAULT);

        FlowRule orderRule = FlowRule.of("createOrder")
            .setGrade(RuleConstant.FLOW_GRADE_QPS)
            .setCount(50000)  // 5 万 QPS
            .setControlBehavior(RuleConstant.CONTROL_BEHAVIOR_QUEUE)
            .setQueueTimeout(5);  // 排队超时 5 秒

        rules.add(seckillRule);
        rules.add(orderRule);

        FlowRuleManager.loadRules(rules);
    }
}
```

### 5. 热点数据处理

#### 本地热点数据缓存

```java
@Service
public class HotDataCacheService {

    private final Map&lt;Long, Long&gt; localCache = new ConcurrentHashMap&lt;&gt;();
    private final long CACHE_SIZE = 10000;

    /**
     * 本地缓存热点库存
     */
    public void cacheStock(Long productId, Long stock) {
        // 限制本地缓存大小
        if (localCache.size() >= CACHE_SIZE) {
            localCache.remove(localCache.keySet().iterator().next());
        }
        localCache.put(productId, stock);
    }

    /**
     * 获取本地缓存的库存
     */
    public Long getLocalStock(Long productId) {
        return localCache.get(productId);
    }

    /**
     * 减少本地缓存库存
     */
    public boolean decrementLocalStock(Long productId) {
        Long stock = localCache.get(productId);
        if (stock == null || stock &lt;= 0) {
            return false;
        }
        localCache.put(productId, stock - 1);
        return true;
    }
}
```

## 高可用保障

### 1. 熔断降级

```java
@Service
public class SeckillFallbackService {

    @CircuitBreaker(name = "seckillService", fallbackMethod = "fallback")
    public SeckillResult seckill(SeckillRequest request) {
        return seckillService.seckill(request);
    }

    public SeckillResult fallback(SeckillRequest request, Throwable e) {
        log.error("秒杀服务熔断: {}", e.getMessage());

        return SeckillResult.builder()
            .success(false)
            .code(503)
            .message("系统繁忙，请稍后重试")
            .build();
    }
}
```

### 2. 幂等性保证

```java
@Service
public class IdempotentService {

    private static final String IDEMPOTENT_KEY = "seckill:idempotent:";

    /**
     * 检查并设置幂等标记
     */
    public boolean tryAcquire(String userId, String productId) {
        String key = IDEMPOTENT_KEY + productId + ":" + userId;

        // SETNX 保证原子性
        Boolean result = redisTemplate.opsForValue()
            .setIfAbsent(key, "1", 30, TimeUnit.MINUTES);

        return Boolean.TRUE.equals(result);
    }
}
```

### 3. 监控告警

```java
@Service
public class SeckillMonitorService {

    @Autowired
    private MeterRegistry meterRegistry;

    public void recordRequest(String productId, boolean success) {
        Counter.builder("seckill.requests")
            .tag("product_id", productId)
            .tag("result", success ? "success" : "fail")
            .register(meterRegistry)
            .increment();
    }

    public void recordStock(String productId, long stock) {
        Gauge.builder("seckill.stock", () -> stock)
            .tag("product_id", productId)
            .register(meterRegistry);
    }

    @Scheduled(fixedRate = 5000)
    public void checkAnomalies() {
        // 检查异常指标
        double errorRate = getErrorRate();
        if (errorRate > 0.1) {
            alertManager.send(Alert.builder()
                .level(AlertLevel.CRITICAL)
                .title("秒杀错误率异常")
                .message("当前错误率: " + (errorRate * 100) + "%")
                .build());
        }
    }
}
```

## 关键设计原则

### 1. 读写分离

```
读操作（大量）：
- 商品信息从缓存获取
- 库存信息从 Redis 获取
- 活动状态从缓存获取

写操作（少量）：
- 库存扣减在 Redis 原子操作
- 订单创建异步处理
- 数据库最终一致性
```

### 2. 异步处理

```
同步路径（用户等待）：
1. 验证请求
2. 检查库存（Redis）
3. 发送消息
4. 返回成功

异步路径（后台处理）：
1. 消费消息
2. 创建订单
3. 扣减数据库库存
4. 发送通知
```

### 3. 空间换时间

```
多级缓存：
L1: 本地缓存（热点商品）
L2: Redis 缓存（库存、活动状态）
L3: MySQL（最终数据）

预扣库存：
- 用户请求直接扣 Redis 库存
- 数据库库存异步扣减
- 库存回补机制保证一致性
```

---

**思考题：**

1. 如果 Redis 库存扣减成功了，但消息队列发送失败了怎么办？如何保证不超卖？

2. 秒杀的最终一致性如何保证？如果 Redis 库存和数据库库存不一致，应该以哪个为准？

3. 如何防止恶意刷单？IP 限流、用户限流、商品限流分别有什么局限性？

4. 如果秒杀活动即将结束，但还有大量请求在排队，这些请求应该如何处理？直接拒绝还是继续处理？
