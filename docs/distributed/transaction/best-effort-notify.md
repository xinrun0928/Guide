# 最大努力通知方案

你有没有收过这种通知：

银行扣款了，但 app 没推送消息。
等了 5 分钟，推送来了。
又等了 10 分钟，又推了一条。

**这就是最大努力通知——它不保证你一定收到，但保证它会努力通知。**

## 最大努力通知 vs 可靠消息

很多同学会把「最大努力通知」和「可靠消息」搞混。

其实区别很简单：

```
可靠消息：保证「发送方」一定发送成功
最大努力通知：保证「接收方」收到通知（通知方尽力）

类比：
- 可靠消息 = 快递小哥必须把包裹送到
- 最大努力通知 = 快递小哥会多次尝试，但你不开门就只能算了
```

## 核心机制

最大努力通知有三个核心机制：

```
1. 重复通知：同一通知会发送多次
2. 指数退避：每次重试的间隔越来越长
3. 衰减通知：通知次数逐渐减少，直到放弃
```

```java
/**
 * 最大努力通知服务
 */
public class BestEffortNotifyService {
    
    /**
     * 通知配置
     * 
     * 策略：第 1 次立即，第 2 次 10s，第 3 次 1min，第 4 次 10min，第 5 次 1h
     */
    private static final long[] RETRY_INTERVALS = {
        0L,           // 第 1 次：立即
        10_000L,      // 第 2 次：10 秒
        60_000L,      // 第 3 次：1 分钟
        600_000L,     // 第 4 次：10 分钟
        3_600_000L    // 第 5 次：1 小时
    };
    
    private static final int MAX_RETRY_COUNT = 5;
    
    @Autowired
    private NotifyDao notifyDao;
    
    @Autowired
    private HttpClient httpClient;
    
    /**
     * 发送通知
     */
    public void sendNotify(NotifyRequest request) {
        // 1. 记录通知任务
        NotifyTask task = new NotifyTask();
        task.setBizId(request.getBizId());
        task.setNotifyUrl(request.getNotifyUrl());
        task.setNotifyData(JSON.toJSONString(request.getData()));
        task.setRetryCount(0);
        task.setState(NotifyState.WAITING);
        
        notifyDao.insert(task);
        
        // 2. 立即发送第一次
        doNotify(task);
    }
    
    /**
     * 执行通知
     */
    private void doNotify(NotifyTask task) {
        try {
            // 发送 HTTP POST 请求
            HttpResponse response = httpClient.post(
                task.getNotifyUrl(),
                task.getNotifyData()
            );
            
            // 3. 检查响应
            if (response.isSuccess()) {
                // 通知成功
                task.setState(NotifyState.SUCCESS);
                notifyDao.update(task);
            } else {
                // 通知失败，尝试重试
                scheduleRetry(task);
            }
            
        } catch (Exception e) {
            // 网络异常，尝试重试
            scheduleRetry(task);
        }
    }
    
    /**
     * 调度重试
     */
    private void scheduleRetry(NotifyTask task) {
        int retryCount = task.getRetryCount() + 1;
        
        if (retryCount > MAX_RETRY_COUNT) {
            // 超过最大重试次数，放弃
            task.setState(NotifyState.FAILED);
            notifyDao.update(task);
            return;
        }
        
        // 计算下次重试时间
        long delay = RETRY_INTERVALS[retryCount];
        
        // 延迟执行
        scheduler.schedule(() -> {
            task.setRetryCount(retryCount);
            doNotify(task);
        }, delay, TimeUnit.MILLISECONDS);
    }
}
```

```sql
-- 通知任务表
CREATE TABLE notify_task (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    biz_id VARCHAR(64) NOT NULL,           -- 业务 ID（如支付流水号）
    notify_url VARCHAR(512) NOT NULL,       -- 回调地址
    notify_data TEXT NOT NULL,              -- 通知内容
    retry_count INT DEFAULT 0,              -- 已重试次数
    state INT DEFAULT 0,                    -- 状态：0=待通知, 1=成功, 2=失败
    create_time DATETIME DEFAULT NOW(),
    update_time DATETIME DEFAULT NOW()
);
```

## 典型应用场景

### 场景一：支付回调

```
支付回调是最典型的最大努力通知场景：

1. 用户支付成功
2. 第三方支付平台通知商家服务器
3. 商家服务器处理业务逻辑
4. 返回 success 给支付平台

问题：如果步骤 4 返回的不是 success，支付平台会一直重试
```

```java
/**
 * 支付回调接口
 */
@RestController
@RequestMapping("/callback/payment")
public class PaymentCallbackController {
    
    @Autowired
    private PaymentService paymentService;
    
    /**
     * 接收支付回调
     * 
     * 注意：这个接口必须幂等！
     */
    @PostMapping("/notify")
    public String onNotify(@RequestBody PaymentCallbackRequest request) {
        try {
            // 1. 验签：验证回调是否来自支付平台
            if (!verifySign(request)) {
                return "fail";
            }
            
            // 2. 处理支付结果（幂等）
            paymentService.handlePaymentResult(request.getOrderId(), request.getStatus());
            
            // 3. 返回 success
            // 只有返回 success，支付平台才停止重试
            return "success";
            
        } catch (Exception e) {
            // 返回非 success，支付平台会继续重试
            return "fail";
        }
    }
    
    /**
     * 幂等处理
     */
    public void handlePaymentResult(String orderId, String status) {
        // 查询订单状态
        Order order = orderDao.selectByOrderId(orderId);
        
        // 如果已经处理过，直接返回
        if ("PAID".equals(order.getStatus())) {
            return;
        }
        
        // 更新订单状态
        if ("SUCCESS".equals(status)) {
            orderDao.updateStatus(orderId, "PAID");
        } else {
            orderDao.updateStatus(orderId, "FAILED");
        }
    }
}
```

### 场景二：订单状态同步

```
订单状态同步也是最大努力通知：

1. A 系统更新了订单状态
2. 需要通知 B 系统同步状态
3. B 系统可能暂时不可用

A 系统会不断重试，直到 B 系统成功接收
```

## 通知接口的幂等设计

最大努力通知的前提是：**通知接口必须幂等。**

因为通知方会重复发送多次，接收方必须能正确处理重复通知。

```java
/**
 * 通知接口幂等实现
 */
public class IdempotentNotifyHandler {
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    /**
     * 幂等处理
     * 
     * 使用 Redis 的 SETNX 实现
     */
    public boolean handleNotify(String bizId, String notifyData) {
        String key = "notify:" + bizId;
        
        // 1. 尝试加锁（SETNX）
        Boolean locked = redisTemplate.opsForValue().setIfAbsent(
            key,
            notifyData,
            24,
            TimeUnit.HOURS
        );
        
        if (!Boolean.TRUE.equals(locked)) {
            // 2. 如果已经处理过，直接返回成功（幂等）
            String existingData = redisTemplate.opsForValue().get(key);
            
            if (notifyData.equals(existingData)) {
                // 内容相同，说明是重复通知，返回成功
                return true;
            } else {
                // 内容不同，说明 bizId 冲突，需要处理
                throw new BizIdConflictException("bizId 冲突：" + bizId);
            }
        }
        
        // 3. 处理通知
        return processNotify(bizId, notifyData);
    }
}
```

## 最大努力通知的局限性

### 1. 不保证最终一定成功

如果接收方持续不可用，或者接口返回错误，最终会放弃通知。

```
失败场景：
1. 接收方接口始终返回 500 错误
2. 达到最大重试次数后，放弃通知
3. 商家不知道这笔订单已经支付
```

### 2. 不保证通知顺序

通知可能会乱序到达。

```
场景：
1. 第 1 次通知：订单创建
2. 第 2 次通知：订单取消
3. 第 3 次通知：订单创建（重试）

接收方必须能处理乱序：第 3 次到达时，订单已经是「已取消」状态
```

### 3. 需要接收方配合

最大努力通知需要接收方配合：
- 接口必须幂等
- 接口必须正确响应
- 如果接收方不响应，通知方也没办法

## 与可靠消息的对比

| 维度 | 最大努力通知 | 可靠消息 |
|------|------------|---------|
| 方向 | 通知方 → 接收方 | 发送方 → 消费者 |
| 保证 | 不保证最终成功 | 保证最终成功 |
| 重试策略 | 有上限 | 无限重试 |
| 适用场景 | 回调场景 | 异步解耦 |

## 面试追问方向

**追问 1：通知接口超时了，怎么办？**

分两种情况：
1. **通知方超时**：收到超时响应，认为通知失败，会重试
2. **接收方超时**：接收方可能已经处理了请求

解决方案：**接收方接口必须幂等**，无论超时多少次，处理结果都一样。

**追问 2：如何设计通知的重试策略？**

原则：
1. **指数退避**：间隔逐渐增大，避免压垮接收方
2. **设置上限**：超过次数就放弃，避免无限重试
3. **记录日志**：放弃后需要人工介入或告警

**追问 3：通知失败了，需要人工补偿吗？**

根据业务决定：
- 支付场景：必须人工补偿
- 普通通知：可选择放弃或人工处理

## 总结

最大努力通知的核心特点：

1. **尽力而为**：多次尝试，但不保证最终成功
2. **指数退避**：间隔递增，避免压垮接收方
3. **衰减放弃**：超过次数就放弃
4. **幂等前提**：通知接口必须幂等

适用场景：
- 支付回调
- 订单状态同步
- 任何「主动通知」的场景
