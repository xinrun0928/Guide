# 接口流量削峰：消息队列 + 令牌桶 / 漏桶算法

双十一零点，你的系统收到了 100 万下单请求。

但你的系统每秒只能处理 10 万订单。

剩下的 90 万用户，你要放弃吗？

不，你需要——**削峰**。

## 削峰的本质

削峰的核心是**把瞬时高峰流量变成平稳流量**。

```
原始流量：
┌──────────────────┐
│  峰值 100 万/s   │ ← 双十一零点
│  谷值 1 万/s    │ ← 零点后
└──────────────────┘

削峰后流量：
┌──────────────────┐
│  平稳 10 万/s   │ ← 持续一小时
└──────────────────┘
```

用户下单体验：

- 不削峰：90 万用户下单失败，体验极差
- 削峰：90 万用户排队等待，最终都能下单

## 消息队列削峰

消息队列是削峰最常用的手段。

### 削峰原理

```
用户下单 → 写入 MQ → 返回"下单成功，排队中"
MQ 消费者 → 按自己速度消费 → 处理订单
```

### RocketMQ 削峰

```java
@Service
public class OrderService {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    public String createOrder(Order order) {
        // 写入下单队列
        order.setOrderId(UUID.randomUUID().toString());
        order.setStatus(OrderStatus.PENDING);
        order.setCreateTime(new Date());

        rocketMQTemplate.asyncSend("order:create", order, new SendCallback() {
            @Override
            public void onSuccess(SendResult sendResult) {
                // 发送成功
            }

            @Override
            public void onException(Throwable e) {
                // 发送失败，需要重试或记录
            }
        });

        return order.getOrderId();
    }
}

@Service
public class OrderConsumer {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private InventoryService inventoryService;

    @Autowired
    private PaymentService paymentService;

    @RocketMQMessageListener(topic = "order:create", consumerGroup = "order-consumer-group")
    public void processOrder(Order order, ConsumeContext context) {
        try {
            // 扣减库存
            inventoryService.deduct(order);
            // 创建支付单
            paymentService.createPayment(order);
            // 更新订单状态
            order.setStatus(OrderStatus.PAID);
            orderRepository.save(order);
        } catch (Exception e) {
            // 失败，重试
            order.setStatus(OrderStatus.FAILED);
            orderRepository.save(order);
            throw e;
        }
    }
}
```

### 削峰 + 限流

削峰不是无限排队，需要配合限流：

```java
@RocketMQMessageListener(topic = "order:create", consumerGroup = "order-consumer-group",
                         consumeThreadPoolCoreSize = 100,  // 并发消费
                         consumeMessageBatchMaxSize = 10)  // 批量消费
```

## 令牌桶削峰

令牌桶的核心是**允许突发流量，但限制长期平均速率**。

```java
@Service
public class TokenBucketService {

    private RateLimiter rateLimiter;

    @PostConstruct
    public void init() {
        // 每秒产生 1000 个令牌
        rateLimiter = RateLimiter.create(1000);
    }

    public boolean tryAcquire() {
        // 获取一个令牌，如果没有则立即返回 false
        return rateLimiter.tryAcquire();
    }

    public void acquire() {
        // 获取一个令牌，如果没有则阻塞等待
        rateLimiter.acquire();
    }
}

@Service
public class OrderService {

    @Autowired
    private TokenBucketService tokenBucketService;

    public void createOrder(Order order) {
        // 尝试获取令牌
        if (!tokenBucketService.tryAcquire()) {
            // 获取失败，返回友好提示
            throw new OrderException("系统繁忙，请稍后再试");
        }

        // 获取成功，处理订单
        doCreateOrder(order);
    }
}
```

### Guava RateLimiter 原理

```
令牌桶结构：

         ┌──────────┐
令牌 ──▶  │  桶      │ ──▶ 请求获取
         │ (最大100) │
         └──────────┘

每秒补充 100 个令牌
```

RateLimiter 保证：

- 长期来看，每秒最多处理 1000 个请求
- 短期内，允许突发（桶里最多存 100 个令牌）

## 漏桶削峰

漏桶的核心是**严格控制输出速率，不允许突发**。

```java
public class LeakyBucket {

    private final long capacity;      // 桶容量
    private final long leakRate;      // 漏出速率（个/秒）
    private long water;               // 当前水量
    private long lastLeakTime;        // 上次漏水时间

    public LeakyBucket(long capacity, long leakRate) {
        this.capacity = capacity;
        this.leakRate = leakRate;
        this.lastLeakTime = System.currentTimeMillis();
    }

    public synchronized boolean tryProcess() {
        leak();

        if (water < capacity) {
            water++;
            return true;  // 加入桶
        }

        return false;  // 桶满了
    }

    private void leak() {
        long now = System.currentTimeMillis();
        long elapsed = now - lastLeakTime;
        long leaked = (elapsed * leakRate) / 1000;

        water = Math.max(0, water - leaked);
        lastLeakTime = now;
    }
}
```

### 令牌桶 vs 漏桶

| 特性 | 令牌桶 | 漏桶 |
|-----|-------|------|
| 输出速率 | 可突发 | 恒定 |
| 突发能力 | 有（桶容量） | 无 |
| 适用场景 | 允许突发 | 不允许突发 |
| 实现复杂度 | 简单 | 复杂 |
| 典型工具 | Guava RateLimiter | 手写 |

## 削峰 + 降级

削峰后的降级策略：

1. **返回排队号**：告诉用户排队位置
2. **延迟处理**：告知用户稍后查看
3. **部分降级**：关闭非核心功能，保留核心下单

```java
@Service
public class OrderService {

    public OrderResult createOrder(Order order) {
        // 尝试写入 MQ
        try {
            String orderId = mqService.sendOrder(order);
            return new OrderResult(orderId, "排队中，预计等待 " + getWaitTime() + " 分钟");
        } catch (MQException e) {
            // MQ 满了，降级处理
            return handleOrderFallback(order);
        }
    }

    private OrderResult handleOrderFallback(Order order) {
        // 方案 1：直接返回失败
        // return new OrderResult(null, "系统繁忙");

        // 方案 2：降级到数据库
        order.setStatus(OrderStatus.FALLBACK);
        orderRepository.save(order);
        return new OrderResult(order.getOrderId(), "已降级处理");
    }
}
```

## 面试追问方向

- 令牌桶和漏桶的区别？（答：令牌桶允许突发，漏桶输出恒定）
- 削峰后用户等待时间过长怎么办？（答：提供排队号、实时进度查询、提前告知等待时间）
- MQ 消费失败怎么办？（答：重试、死信队列、人工处理）
- 削峰和限流的区别？（答：削峰把高峰拉平，限流把超过阈值的请求拒绝）

## 小结

削峰是应对瞬时高峰流量的有效手段：

1. **MQ 削峰**：异步处理，高峰变平稳
2. **令牌桶**：允许突发，限制长期速率
3. **漏桶**：恒定输出，不允许突发
4. **降级策略**：削峰失败时的兜底方案

削峰不是拒绝请求，而是**让每个请求都有机会被处理**。
