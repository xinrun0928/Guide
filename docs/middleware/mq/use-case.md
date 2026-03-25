# 消息队列应用场景：异步解耦、削峰填谷、数据收集

双十一零点，你点了一下下单按钮。

页面转了 3 秒，提示「库存不足」。但你知道吗？在你点按钮的那一瞬间，系统背后发生了这些事：

```
你的下单请求
    │
    ├──► 校验用户资格（50ms）
    ├──► 创建订单（100ms）
    ├──► 扣减库存（80ms）
    ├──► 发送短信通知（200ms）
    ├──► 发送邮件通知（150ms）
    ├──► 更新搜索索引（300ms）
    ├──► 记录用户行为日志（50ms）
    ├──► 触发积分计算（100ms）
    └──► 触发大数据分析（500ms）
    
    总耗时：约 1.5 秒（如果是同步的话）
```

没有消息队列，你的下单接口要等所有这些操作完成才能返回。**这 1.5 秒的等待，就是用户体验的噩梦。**

---

## 场景一：异步解耦——让系统「松绑」

### 同步调用的痛苦

传统同步调用，系统之间「强耦合」：

```
用户下单 ──同步调用──► 库存系统 ──同步调用──► 支付系统 ──同步调用──► 物流系统
       │                       │                       │
       │                       │                       │
       │   任何一个系统挂了，整个链路都挂了   │
```

问题：
- 库存系统慢了，下单接口就慢了
- 物流系统挂了，支付系统也受影响
- 添加一个新系统，要改所有调用方代码

### 异步解耦的优雅

引入消息队列后：

```
用户下单 ──发送消息──► 消息队列 ──► 库存系统（异步）
                              ──► 支付系统（异步）
                              ──► 物流系统（异步）
                              ──► 通知系统（异步）
                              ──► 数据分析（异步）

下单接口响应时间：只需写入消息队列的时间 = 5ms
```

每个系统「订阅」自己关心的消息，互不干扰，**松耦合**。

### 真实案例：电商系统解耦

```java
// 下单服务：只管发消息，不关心谁处理
public class OrderService {

    private final RocketMQTemplate rocketMQTemplate;

    public OrderResult placeOrder(Order order) {
        // 1. 创建订单
        Order createdOrder = orderRepository.save(order);

        // 2. 发送消息，后续流程全部异步
        // 关键：发送消息是毫秒级的，远快于同步调用
        rocketMQTemplate.convertAndSend("order-created-topic", createdOrder);

        // 3. 立即返回下单成功
        return new OrderResult(createdOrder.getId(), "下单成功");
    }
}
```

```java
// 库存服务：订阅订单消息，独立处理
@RocketMQListener(topic = "order-created-topic")
public void handleOrderCreated(Order order) {
    // 扣减库存
    inventoryService.deduct(order.getItems());

    // 发送库存预警消息（如果库存不足）
    if (order.getItems().stream().anyMatch(Item::isLowStock)) {
        rocketMQTemplate.send("stock-warning-topic", new StockWarning(...));
    }
}
```

### 解耦带来的好处

| 维度 | 同步调用 | 异步解耦 |
|-----|---------|---------|
| 响应时间 | 所有下游耗时的总和 | 只加一次写入延迟（毫秒级） |
| 可用性 | 任何一环失败，全链路失败 | 下游失败不影响主流程 |
| 扩展性 | 添加下游要改上游代码 | 下游自主订阅，互不影响 |
| 维护性 | 依赖关系复杂 | 清晰的消息流，易于追踪 |

---

## 场景二：削峰填谷——让系统「平稳」

### 流量洪峰的冲击

```
时间线：
                    ★ 双十一零点
                    ★ 秒杀活动
                    ★ 整点抢购
                    
流量 │                                    ★★★★★★★
    │                            ★★★★★
    │                   ★★★★
    │         ★★★★
    │  ★★★★
    └────────────────────────────────────────────► 时间

正常流量下，系统游刃有余
峰值流量下，系统直接崩溃
```

问题：
- 瞬时 QPS 从 100 暴涨到 10000
- 数据库连接池耗尽
- 内存溢出
- 服务宕机

### 削峰填谷的智慧

消息队列就像一个**缓冲池**：

```
                    峰值流量
                       │
                       ▼
              ┌─────────────────┐
              │    消息队列      │
              │   （缓冲池）      │
              └────────┬─────────┘
                       │ 平稳的消费速率
                       ▼
              ┌─────────────────┐
              │   下游系统       │
              │  （按自身能力消费）│
              └─────────────────┘
```

### 真实案例：秒杀系统

```java
// 秒杀下单接口：接收请求，快速写入队列
public class SeckillService {

    private final KafkaTemplate&lt;String, SeckillRequest&gt; kafkaTemplate;

    /**
     * 秒杀下单
     * 核心：快速响应，不做实际处理
     */
    public Result&lt;String&gt; seckill(SeckillRequest request) {
        // 1. 基础校验（内存层完成，不访问数据库）
        if (!verifySeckill(request)) {
            return Result.fail("秒杀未开始或已结束");
        }

        // 2. 发送消息到队列
        kafkaTemplate.send("seckill-topic", request.getUserId(), request);

        // 3. 立即返回「排队中」
        return Result.success("排队中，请稍后查询结果");
    }
}
```

```java
// 秒杀处理服务：按自己的能力消费
public class SeckillConsumer {

    @KafkaListener(topics = "seckill-topic", concurrency = "3")
    public void processSeckill(SeckillRequest request) {
        // 1. 检查用户是否已购买（Redis 缓存）
        if (userHasBought(request.getUserId(), request.getGoodsId())) {
            return;
        }

        // 2. 扣减库存（Redis 原子操作）
        Long remainStock = redisTemplate.opsForValue()
            .decrement("stock:" + request.getGoodsId());

        // 3. 库存不足，直接返回
        if (remainStock &lt; 0) {
            redisTemplate.opsForValue()
                .increment("stock:" + request.getGoodsId());
            return;
        }

        // 4. 创建订单（数据库）
        createOrder(request);
    }
}
```

### 削峰效果对比

| 指标 | 无队列 | 有队列 |
|-----|-------|-------|
| 峰值 QPS | 10000 | 限流到 2000 |
| 响应时间 | 超时/失败 | < 50ms |
| 系统状态 | 宕机/雪崩 | 正常运行 |
| 用户体验 | 卡死/报错 | 排队提示 |

---

## 场景三：数据收集——构建统一数据管道

### 多源数据的问题

现代系统，数据来源五花八门：

```
用户行为数据 ──┐
埋点数据    ──┼──► 各自处理 ──► 数据重复、不一致
业务日志    ──┤
系统监控    ──┘
```

痛点：
- 每个业务系统都要对接多个数据消费者
- 数据格式不统一
- 难以追溯数据来源

### 消息队列构建数据总线

```
┌─────────────┐
│   App 端    │ ──► 点击、浏览、停留时间
└─────────────┘
        │
        ▼ 发送消息
┌─────────────────────────────────────────────┐
│                 消息队列                       │
│  ┌─────────────┐  ┌─────────────┐          │
│  │ user-action │  │  business   │          │
│  │   -topic    │  │   -topic    │          │
│  └──────┬──────┘  └──────┬──────┘          │
└─────────┼────────────────┼──────────────────┘
          │                │
    ┌─────┴─────┐    ┌─────┴─────┐
    ▼           ▼    ▼           ▼
┌───────┐  ┌───────┐  ┌───────┐  ┌───────┐
│实时大屏│  │数据仓库│  │推荐系统│  │风控系统│
└───────┘  └───────┘  └───────┘  └───────┘
```

### 真实案例：用户行为埋点

```java
// 业务代码：只需要发送消息
public class ProductDetailService {

    private final KafkaTemplate&lt;String, Object&gt; kafkaTemplate;

    public ProductVO getProductDetail(Long productId) {
        ProductVO product = productRepository.findById(productId);

        // 发送埋点消息：用户浏览了某个商品
        Map&lt;String, Object&gt; action = new HashMap&lt;&gt;();
        action.put("userId", getCurrentUserId());
        action.put("action", "view_product");
        action.put("productId", productId);
        action.put("timestamp", System.currentTimeMillis());
        action.put("stayDuration", measureStayDuration());

        // 异步发送，不影响主流程
        kafkaTemplate.send("user-action-topic", action);

        return product;
    }
}
```

### 数据收集的优势

| 特性 | 传统方式 | 消息队列方式 |
|-----|---------|-------------|
| 接入成本 | 每个消费者对接所有数据源 | 数据源只发一次，消费者按需订阅 |
| 实时性 | 批量定时上报 | 消息即发即消费 |
| 可追溯性 | 日志分散 | 消息队列保留历史，可回溯 |
| 扩展性 | 新增消费者改动大 | 新消费者自行订阅 |

---

## 三大场景对比

| 场景 | 核心价值 | 解决的问题 | 典型案例 |
|-----|---------|-----------|---------|
| 异步解耦 | 系统「松绑」 | 强依赖、可用性差 | 订单系统解耦 |
| 削峰填谷 | 流量「缓冲」 | 峰值压垮系统 | 秒杀系统 |
| 数据收集 | 数据「总线」 | 多源异构数据汇聚 | 埋点日志、监控 |

---

## 面试追问

**面试官可能会问：**

1. 「异步解耦后，如果消息丢了怎么办？」—— 这就引出了消息可靠性的问题
2. 「削峰填谷后，用户等待时间变长了，怎么处理？」—— 需要结合限流、补偿机制
3. 「数据收集场景下，数据延迟大了怎么监控？」—— 需要端到端延迟监控

消息队列虽好，但也不是万能药。**它解决的是「能不能异步」的问题，而「异步之后怎么保证正确性」，是另一个需要深入的话题。**
