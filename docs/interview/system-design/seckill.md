# 设计秒杀系统

凌晨零点，你守在手机前，准备抢购那款限量版的球鞋。

倒计时归零，你狂点屏幕——

「系统繁忙，请稍后重试」

「系统繁忙，请稍后重试」

「系统繁忙，请稍后重试」

10 分钟后，你终于进去了，商品已售罄。

**这就是秒杀系统要解决的问题：如何在极端流量下，保证系统不崩溃，同时公平地分配商品？**

---

## 一、问题分析

### 1.1 秒杀的挑战

```
┌─────────────────────────────────────────────────────┐
│                  秒杀系统特点                        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  流量特征                                            │
│  ├── 瞬间洪峰：活动开始瞬间，QPS 可能暴涨 1000 倍     │
│  ├── 持续时间短：通常只有几分钟                      │
│  └── 用户行为集中：所有人同时点击                    │
│                                                     │
│  技术挑战                                            │
│  ├── 高并发：系统要能扛住瞬间洪峰                    │
│  ├── 超卖问题：库存只有 100 件，不能卖出 101 件       │
│  ├── 公平性：不能让一个人抢多单                      │
│  └── 可用性：活动期间系统不能崩                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 非功能需求

| 指标 | 要求 |
|---|---|
| 可用性 | 99.99%（活动期间不能挂） |
| 响应时间 | < 200ms |
| QPS | 10万+ / 秒 |
| 准确性 | 零超卖 |

---

## 二、容量估算

### 2.1 数据规模

```
秒杀场景：
- 参与用户：100 万
- 同时在线：10 万
- 峰值 QPS：50 万/秒
- 商品数量：100 ~ 10000 件

库存扣减：
- 需要原子操作
- 不能超卖
```

### 2.2 存储估算

```
商品表：
- 商品基本信息（平时存储在 MySQL）

库存扣减：
- Redis 库存计数器（原子扣减）
- 下单后落库（MySQL）
```

---

## 三、高层设计

```
┌──────────────────────────────────────────────────────────────────┐
│                         用户请求                                   │
│                   POST /seckill/{skuId}                           │
└──────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
     ┌────────▼────────┐ ┌────▼────┐ ┌─────────▼─────────┐
     │    静态资源 CDN   │ │ API GW  │ │    活动页面前端    │
     └──────────────────┘ └─────────┘ └─────────────────────┘
                                │
                     ┌──────────▼──────────┐
                     │    负载均衡器         │
                     └──────────┬──────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                 │
     ┌────────▼────────┐ ┌──────▼──────┐ ┌──────▼──────┐
     │   秒杀服务集群   │ │  订单服务    │ │  库存服务    │
     │  (限流 + 校验)  │ │ (创建订单)  │ │ (原子扣减)  │
     └────────┬────────┘ └──────┬──────┘ └──────┬──────┘
              │                 │               │
              └────────┬─────────┴───────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
 ┌──────▼──────┐ ┌────▼────┐ ┌──────▼──────┐
 │  Redis      │ │  MQ     │ │   MySQL     │
 │ (库存预扣)  │ │(异步下单) │ │  (订单存储)  │
 └─────────────┘ └─────────┘ └──────────────┘
```

---

## 四、核心设计

### 4.1 库存预扣减

秒杀的核心是**库存扣减**。如果库存是 100 件，必须保证只卖出 100 单。

```java
/**
 * Redis 库存扣减
 *
 * 关键点：
 * 1. 原子操作：多个请求同时到达，不能出现超卖
 * 2. 快速失败：库存售罄后，快速返回，不再打到后端
 */
public class SeckillStockService {

    private StringRedisTemplate redis;

    /**
     * 扣减库存（Lua 脚本保证原子性）
     *
     * 为什么用 Lua 脚本？
     * - Redis 执行 Lua 脚本是原子的
     * - 可以在一个脚本里完成「检查-扣减」操作
     * - 避免先 GET 再 DECR 的竞态条件
     */
    public SeckillResult tryDeductStock(String skuId) {
        String stockKey = "seckill:stock:" + skuId;

        // Lua 脚本：检查库存 > 0 才能扣减
        String luaScript = """
            local stock = tonumber(redis.call('GET', KEYS[1]))
            if stock == nil or stock <= 0 then
                return -1  -- 库存不足
            end
            redis.call('DECR', KEYS[1])
            return stock - 1  -- 返回扣减后的库存
            """;

        DefaultRedisScript<Long> script = new DefaultRedisScript<>(luaScript, Long.class);
        Long result = redis.execute(script, Collections.singletonList(stockKey));

        if (result == null || result < 0) {
            return SeckillResult.SOLD_OUT; // 库存不足
        }

        return SeckillResult.SUCCESS; // 扣减成功
    }

    /**
     * 回补库存（取消订单时调用）
     */
    public void restoreStock(String skuId) {
        String stockKey = "seckill:stock:" + skuId;
        redis.opsForValue().increment(stockKey);
    }

    /**
     * 初始化秒杀库存
     *
     * 活动开始前，将库存从 MySQL 同步到 Redis
     */
    public void initStock(String skuId, int stock) {
        String stockKey = "seckill:stock:" + skuId;
        redis.opsForValue().set(stockKey, stock);
    }
}

/**
 * 秒杀结果
 */
public enum SeckillResult {
    SUCCESS,       // 成功
    SOLD_OUT,      // 已售罄
    REPEAT_ORDER,  // 重复下单
    SYSTEM_ERROR   // 系统错误
}
```

### 4.2 订单异步创建

扣减库存成功后，不能同步创建订单（太慢），要异步处理：

```java
/**
 * 秒杀订单服务
 */
public class SeckillOrderService {

    private RedisTemplate<String, Object> redis;
    private MQTemplate mq;

    /**
     * 预下单：发送创建订单消息
     *
     * 为什么用 MQ？
     * 1. 削峰填谷：瞬时大量请求，MQ 缓冲，订单服务慢慢处理
     * 2. 异步处理：用户快速得到反馈（库存已扣），订单异步创建
     * 3. 可靠投递：MQ 持久化，订单不丢失
     */
    public SeckillResult preCreateOrder(String skuId, String userId) {
        // 1. 检查是否已经下过单（防重复）
        String orderKey = "seckill:order:" + skuId + ":" + userId;
        Boolean exists = redis.opsForValue().setIfAbsent(orderKey, "1", Duration.ofHours(2));

        if (Boolean.FALSE.equals(exists)) {
            // 之前已经下过单
            return SeckillResult.REPEAT_ORDER;
        }

        // 2. 发送订单创建消息到 MQ
        SeckillOrderMessage message = new SeckillOrderMessage(skuId, userId, System.currentTimeMillis());
        mq.send("seckill:order:topic", message);

        return SeckillResult.SUCCESS;
    }

    /**
     * 订单消费者（异步处理）
     */
    @RabbitListener(queues = "seckill:order:queue")
    public void handleOrderMessage(SeckillOrderMessage message) {
        String skuId = message.getSkuId();
        String userId = message.getUserId();

        try {
            // 1. 查询商品信息
            Product product = productService.getProduct(skuId);

            // 2. 创建订单
            Order order = new Order();
            order.setSkuId(skuId);
            order.setUserId(userId);
            order.setPrice(product.getSeckillPrice());
            order.setStatus("待支付");
            order.setCreateTime(new Date());

            orderService.createOrder(order);

            // 3. 发送延迟消息（15分钟不支付则取消）
            delayQueue.sendOrderTimeout(order.getId(), Duration.ofMinutes(15));

        } catch (Exception e) {
            // 订单创建失败，回补库存
            stockService.restoreStock(skuId);
            // 删除用户下单记录，允许重新下单
            redis.delete("seckill:order:" + skuId + ":" + userId);

            log.error("创建秒杀订单失败: {}", message, e);
        }
    }
}

/**
 * 秒杀订单消息
 */
public class SeckillOrderMessage implements Serializable {
    private String skuId;
    private String userId;
    private long timestamp;

    // getter/setter
}
```

### 4.3 多层限流

```java
/**
 * 秒杀的限流策略
 *
 * 为什么需要多层限流？
 * - 单层限流容易被绕过
 * - 多层保护，层层过滤无效请求
 */
public class SeckillRateLimiter {

    private RedisTemplate<String, Object> redis;

    /**
     * 第一层：网关限流
     *
     * 基于令牌桶算法，限制总 QPS
     */
    public boolean tryAcquireFromGateway(String userId) {
        // 固定窗口限流：每秒最多 10 万请求
        String key = "ratelimit:gateway:" + (System.currentTimeMillis() / 1000);
        Long count = redis.opsForValue().increment(key);

        if (count != null && count > 100_000) {
            return false; // 被限流
        }

        redis.expire(key, Duration.ofSeconds(2));
        return true;
    }

    /**
     * 第二层：用户维度限流
     *
     * 防止同一用户刷接口
     */
    public boolean tryAcquireFromUser(String userId) {
        // 每个用户每秒最多请求 2 次
        String key = "ratelimit:user:" + userId;
        Long count = redis.opsForValue().increment(key);

        if (count != null && count > 2) {
            return false;
        }

        redis.expire(key, Duration.ofSeconds(1));
        return true;
    }

    /**
     * 第三层：验证码
     *
     * 在活动开始前，让用户输入验证码
     * 消耗时间，降低并发
     */
    public String generateCaptcha(String userId) {
        String captcha = String.format("%04d", new Random().nextInt(10000));
        redis.opsForValue().set(
            "captcha:" + userId,
            captcha,
            Duration.ofMinutes(5)
        );
        return captcha;
    }

    /**
     * 第四层：熔断降级
     *
     * 系统过载时，直接返回友好提示
     */
    public boolean isCircuitBroken() {
        String key = "circuit:seckill";
        String status = (String) redis.opsForValue().get(key);
        return "open".equals(status);
    }
}
```

### 4.4 完整秒杀流程

```java
/**
 * 秒杀 Controller
 */
public class SeckillController {

    private SeckillStockService stockService;
    private SeckillOrderService orderService;
    private SeckillRateLimiter rateLimiter;

    /**
     * 秒杀接口
     *
     * 完整流程：
     * 1. 熔断检查（系统过载直接拒绝）
     * 2. 用户限流（防止刷接口）
     * 3. 验证码校验（可选）
     * 4. 库存预扣减（Redis Lua）
     * 5. 发送订单创建消息（MQ）
     * 6. 返回秒杀成功
     */
    public SeckillResponse seckill(SeckillRequest request) {
        String userId = request.getUserId();
        String skuId = request.getSkuId();

        // 1. 熔断检查
        if (rateLimiter.isCircuitBroken()) {
            return SeckillResponse.fail("系统繁忙，请稍后重试");
        }

        // 2. 用户限流
        if (!rateLimiter.tryAcquireFromUser(userId)) {
            return SeckillResponse.fail("操作太频繁，请稍后重试");
        }

        // 3. 验证码校验（可选）
        if (request.getCaptcha() != null) {
            if (!verifyCaptcha(userId, request.getCaptcha())) {
                return SeckillResponse.fail("验证码错误");
            }
        }

        // 4. 库存扣减
        SeckillResult result = stockService.tryDeductStock(skuId);

        if (result == SeckillResult.SOLD_OUT) {
            return SeckillResponse.fail("商品已售罄");
        }

        if (result == SeckillResult.REPEAT_ORDER) {
            return SeckillResponse.fail("您已下单，请勿重复操作");
        }

        // 5. 发送订单创建消息
        SeckillResult orderResult = orderService.preCreateOrder(skuId, userId);

        if (orderResult != SeckillResult.SUCCESS) {
            // 订单创建失败，回补库存
            stockService.restoreStock(skuId);
            return SeckillResponse.fail("下单失败，请重试");
        }

        // 6. 返回成功
        return SeckillResponse.success("秒杀成功，请在 15 分钟内完成支付");
    }

    private boolean verifyCaptcha(String userId, String captcha) {
        // 验证码校验逻辑
        return true;
    }
}
```

---

## 五、延伸问题

### 问题一：如何保证不超卖？

```
方案：
1. Redis Lua 脚本：原子检查+扣减（推荐）
2. 数据库乐观锁：UPDATE SET stock = stock - 1 WHERE stock > 0
3. 数据库唯一索引：订单表加 (sku_id, user_id) 唯一索引
```

### 问题二：如何防止一个人抢多单？

```
方案：
1. Redis 记录用户下单：seckill:order:{skuId}:{userId}
2. 数据库唯一索引：订单表加 (sku_id, user_id) 唯一索引
3. 限购数量检查：下单前检查用户已购数量
```

### 问题三：如何应对突发流量？

```
方案：
1. 静态资源 CDN：商品图片、页面静态化
2. 请求合并：多个读请求合并为一个
3. 热点隔离：秒杀商品单独部署
4. 扩容：提前准备好机器，活动期间弹性扩容
```

---

## 六、总结

```
┌─────────────────────────────────────────────────────┐
│              秒杀系统核心知识点                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  核心问题                                            │
│  ├── 库存扣减：Redis Lua 原子操作                    │
│  ├── 订单创建：MQ 异步削峰                          │
│  └── 防止刷单：多层限流 + 验证码                    │
│                                                     │
│  限流策略                                            │
│  ├── 网关限流：总 QPS 控制                          │
│  ├── 用户限流：单用户请求频率                        │
│  └── 熔断降级：系统过载保护                         │
│                                                     │
│  数据一致性                                          │
│  ├── Redis 库存：最终一致性                        │
│  └── MySQL 订单：强一致性                          │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能画出完整的秒杀架构图
- 能解释 Redis Lua 脚本的原子性保证
- 能说出多es限流的设计思路
- 能分析 MQ 在秒杀中的作用
