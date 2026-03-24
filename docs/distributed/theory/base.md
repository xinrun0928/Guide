# BASE 理论：基本可用、软状态、最终一致性

CAP 理论告诉你：分区时必须在 C 和 A 之间选择。

但互联网公司的实践告诉你：这个选择太极端了。

你的用户既不想看到「服务不可用」，也不想看到「数据乱七八糟」。BASE 理论就是在 CAP 的「二选一」困境中，找到了一条中间路线。

## BASE 是 CAP 中 AP 的工程实践

BASE 最初由 eBay 的架构师提出，全称是：

```
Basically Available：基本可用
Soft state：软状态
Eventually consistent：最终一致性
```

如果说 ACID 是传统数据库的「完美主义」，那 BASE 就是分布式系统的「实用主义」。

**核心思想：放弃强一致性，追求在一定时间窗口内的最终一致性。**

这听起来像是「向现实妥协」，但实际上这是分布式系统唯一可行的道路。

## Basically Available：基本可用

「基本可用」不是说系统「凑合能用」，而是说：**系统在故障时，允许降级，但核心功能始终可用。**

### 降级策略

```java
/**
 * 降级策略示例：库存服务的降级方案
 */
public class InventoryService {
    
    /**
     * 正常情况：精确扣减库存
     */
    public Result deductStock(Long skuId, Integer quantity) {
        // 查询库存
        Integer stock = queryStock(skuId);
        if (stock &lt; quantity) {
            return Result.fail("库存不足");
        }
        // 扣减库存
        deductStockDirectly(skuId, quantity);
        return Result.success();
    }
    
    /**
     * 降级情况：使用乐观锁 + 限流
     * 允许超卖，但通过后续补偿处理
     */
    public Result deductStockDegraded(Long skuId, Integer quantity) {
        // 乐观扣减，不检查库存是否充足
        int updated = optimisticDeduct(skuId, quantity);
        if (updated == 0) {
            return Result.fail("系统繁忙，请稍后重试");
        }
        return Result.success();
    }
    
    /**
     * 熔断降级：完全不可用时的兜底
     * 返回「库存充足」，让用户继续下单，后续再检查
     */
    public Result fallbackDeduct(Long skuId, Integer quantity) {
        log.warn("库存服务不可用，使用降级策略");
        return Result.success("降级：订单已创建，库存后续确认");
    }
}
```

### 降级的两种形式

**形式一：功能降级**

双十一时，页面展示的库存数量可以「模糊化」——从「库存 100」变成「库存充足」，减少对库存系统的压力。

```
正常情况：精确库存数量
降级情况：库存状态（充足/紧张/售罄）
```

**形式二：延迟响应**

写入操作正常执行，但返回给用户的结果可能延迟更新。比如「订单创建成功」，但状态更新可能要几秒钟后。

## Soft State：软状态

「软状态」可能是 BASE 中最难理解的概念。

它指的是：**系统中的数据可以处于一种「中间状态」，这个状态是不确定的，但没关系。**

### 生活化类比

你在线下店买了一件衣服，付款成功后，店员说「请稍等，ERP 系统卡了一下，纸质小票稍后打印」。

这个「等待打印小票」的状态，就是软状态：

```
硬状态：衣服在你手里（确定的）
软状态：小票是否已打印（不确定的）
```

最终，小票一定会打印出来（最终一致性），但在那之前，你已经拿着衣服走了（业务继续）。

### 技术场景

```java
/**
 * 订单状态流转：体现软状态概念
 */
public class OrderState {
    
    /**
     * 订单的硬状态（数据最终会一致）：
     * - 已创建
     * - 已支付
     * - 已发货
     * - 已完成
     * - 已取消
     * 
     * 订单的软状态（中间不确定状态）：
     * - 支付中（第三方已扣款，但系统未确认）
     * - 发货中（仓库已发货，物流未揽收）
     * - 退款处理中（用户申请退款，审核未完成）
     */
    
    /**
     * 状态流转示例
     * 用户支付成功 → 系统收到回调 → 订单状态变为「支付中」（软状态）
     * 系统处理完成 → 订单状态变为「已支付」（硬状态）
     */
    public void handlePaymentCallback(PaymentCallback callback) {
        Order order = orderService.getOrder(callback.getOrderId());
        
        // 软状态：支付确认中
        order.setStatus("PAYMENT_PENDING");
        orderService.update(order);
        
        // 异步处理：更新库存、发送消息等
        asyncProcess(callback, () -&gt; {
            // 处理成功后
            order.setStatus("PAID");
            orderService.update(order);
        });
    }
}
```

## Eventually Consistent：最终一致性

「最终一致性」是 BASE 的核心：系统不保证立即一致，但保证在没有新写入的情况下，最终会达到一致状态。

### 不同级别的最终一致性

| 级别 | 说明 | 场景 |
|-----|------|-----|
| 因果一致性 | 如果 A 写了 X，然后告诉 B，B 读到 X | 社交feed、评论系统 |
| 读己之所写 | 你写的你能马上读到 | 用户资料更新 |
| 会话一致性 | 在同一个会话中保持一致 | 购物车、会话状态 |
| 单调读一致性 | 不会读到比之前更旧的版本 | 消息通知 |
| 单调写一致性 | 写操作顺序保证 | 日志写入 |

### 实现方式

```java
/**
 * 最终一致性实现：异步复制 + 版本号
 */
public class EventuallyConsistentStorage {
    
    /**
     * 数据版本号，用于检测冲突
     */
    private Map&lt;String, Long&gt; versionMap = new ConcurrentHashMap&lt;&gt;();
    
    /**
     * 写入：写入本地 + 异步同步到其他节点
     */
    public void write(String key, String value) {
        long newVersion = incrementVersion(key);
        
        // 1. 写入本地
        writeLocal(key, value, newVersion);
        
        // 2. 记录待同步日志
        syncLog.add(new SyncEntry(key, value, newVersion));
        
        // 3. 异步同步到其他节点
        asyncSyncToReplicas(syncLog);
    }
    
    /**
     * 读取：返回本地数据（可能不是最新）
     * 如果需要强一致，调用 syncAndRead()
     */
    public String read(String key) {
        return readLocal(key);
    }
    
    /**
     * 读取最新：强制同步后读取
     */
    public String readWithConsistency(String key) {
        // 等待本地版本与全局版本一致
        waitForSync(key);
        return readLocal(key);
    }
    
    private long incrementVersion(String key) {
        return versionMap.compute(key, (k, v) -&gt; v == null ? 1L : v + 1);
    }
}
```

## BASE vs CAP：关系图解

```
                    CAP 理论
           ┌─────────────────────┐
           │                     │
           ▼                     ▼
     强一致 (CP)            高可用 (AP)
           │                     │
           │                     │
           ▼                     ▼
    牺牲可用性保证一致    牺牲一致保证可用
           │                     │
           └─────────┬───────────┘
                     │
                     ▼
              BASE 理论
    ┌─────────────────────────────┐
    │                             │
    ▼                             ▼
  基本可用                      最终一致
  (降级策略)                  (异步同步)
```

简单说：**BASE 是 CAP 中 AP 的工程实现版本。**

CAP 告诉你「必须在 C 和 A 中选一个」，BASE 告诉你「选 A 的情况下，怎么工程化实现」。

## Java 代码示例：订单状态流转

```java
/**
 * 订单服务：BASE 理论的实际应用
 */
public class OrderService {
    
    private final Map&lt;Long, Order&gt; orderCache = new ConcurrentHashMap&lt;&gt;();
    private final MessageQueue mq = new MessageQueue();
    private final InventoryService inventoryService;
    
    /**
     * 创建订单：基本可用
     * 
     * 核心原则：
     * 1. 先保证订单能创建成功（可用性优先）
     * 2. 库存扣减异步进行（最终一致）
     * 3. 中间状态通过消息队列补偿
     */
    public Order createOrder(CreateOrderRequest request) {
        // 1. 订单状态：软状态（创建中）
        Order order = new Order();
        order.setId(generateOrderId());
        order.setStatus(OrderStatus.CREATING);
        order.setUserId(request.getUserId());
        order.setItems(request.getItems());
        order.setTotalAmount(request.getTotalAmount());
        
        // 2. 先保存订单（本地写入，立即成功）
        orderCache.put(order.getId(), order);
        orderRepository.save(order);
        
        // 3. 发送消息，异步扣减库存
        // 这里不等待库存确认，订单状态是「创建中」
        mq.send("inventory:deduct", new InventoryTask(order));
        
        // 4. 更新订单状态：创建成功（基本可用）
        order.setStatus(OrderStatus.CREATED);
        orderCache.put(order.getId(), order);
        
        return order;
    }
    
    /**
     * 处理库存回调：补偿机制
     */
    public void handleInventoryResult(InventoryResult result) {
        Order order = orderCache.get(result.getOrderId());
        if (order == null) {
            return;
        }
        
        if (result.isSuccess()) {
            // 库存扣减成功：更新为已支付等待发货
            order.setStatus(OrderStatus.PAID);
        } else {
            // 库存不足：取消订单
            order.setStatus(OrderStatus.CANCELLED);
            // 补偿：退回已扣金额
            refundService.refund(order);
        }
        
        orderCache.put(order.getId(), order);
        orderRepository.update(order);
    }
}
```

## 面试问题：如何回答「你们系统用 ACID 还是 BASE？」

这道题考察的是你对分布式系统设计的理解深度。参考回答：

> "我们系统采用了混合策略。核心业务（订单、支付、用户余额）使用强一致性，保证数据准确；辅助功能（浏览量、搜索推荐、日志）使用最终一致性，追求高可用。
>
> 具体来说，订单创建时采用『先创建、后确认』的策略——用户下单立即成功，库存扣减通过消息队列异步处理。这样即使高峰期库存服务压力很大，用户也不会感受到卡顿。如果库存不足，我们有补偿机制处理退款。
>
> 这种设计牺牲了『下单时立即知道库存是否充足』的强一致性，但换来了『订单服务始终可用』的体验。"

## 总结

BASE 理论是 CAP 的工程化落地：

1. **基本可用**：故障时降级，但不崩溃
2. **软状态**：允许中间状态，不追求立即一致
3. **最终一致**：不给用户承诺「马上」，但承诺「一定会」

> "BASE 理论教给我们的是：与其追求完美的强一致，不如追求可接受的最终一致。有时候，『差不多』比『做不到』好得多。"
