# 幂等性设计：唯一索引、Token 机制、分布式锁

你有过这种经历吗？

网上购物，点击「确认支付」后页面卡住了。你等不及，又点了一次。结果——银行发来两条扣款短信。

这是最典型的**幂等性问题**。

幂等性（Idempotency），听起来是个高大上的概念，其实很简单：**同一个操作执行一次和执行多次，结果是一样的**。

就像按下电灯开关：按一次灯亮了，再按一次灯还是亮的（不会灭掉）。这就是幂等的。

但在计算机系统中，很多操作天然不是幂等的：`i++`、`扣款`、`发货`……这些操作执行多次，会产生不同的结果。

## 什么是幂等性

### 定义

幂等性指一个操作执行一次和执行多次的效果相同。

| 操作类型 | 幂等性 | 原因 |
|---------|-------|------|
| `SELECT * FROM user WHERE id = 1` | ✅ 幂等 | 查询不会改变数据 |
| `UPDATE user SET balance = 100 WHERE id = 1` | ✅ 幂等 | 设置为固定值，无论执行多少次结果相同 |
| `UPDATE user SET balance = balance - 10 WHERE id = 1` | ❌ 非幂等 | 每次执行都会扣减 |
| `INSERT INTO order (...) VALUES (...)` | ❌ 非幂等 | 多次插入产生多条记录 |
| `DELETE FROM order WHERE id = 1` | ✅ 幂等 | 删除一次和删除多次结果相同 |
| `POST /api/pay` | ❌ 非幂等 | 多次调用会多次扣款 |

### 为什么需要幂等性

```
用户点击「支付」
    │
    ▼
┌─────────────────────────────────────────┐
│           支付请求                        │
│                                         │
│  请求发出 ──▶ 网络超时                    │
│      │                                  │
│      ▼                                  │
│  请求超时 ──▶ 重试                        │
│      │                                  │
│      ▼                                  │
│  重试成功 ──▶ 重复扣款！                  │
│                                         │
└─────────────────────────────────────────┘
```

**常见触发场景**：
- 网络超时导致客户端重试
- 用户重复点击按钮
- 消息队列重复消费
- 异步回调重复通知
- 分布式事务中的补偿操作

## 幂等性实现方案

### 方案一：唯一索引

利用数据库唯一索引的特性，保证数据唯一性。

#### 订单幂等

```sql
-- 创建订单表，带唯一索引
CREATE TABLE orders (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(64) NOT NULL UNIQUE,  -- 订单号，唯一索引
    user_id BIGINT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 创建订单号唯一索引
CREATE UNIQUE INDEX idx_order_no ON orders(order_no);
```

```java
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;

    /**
     * 创建订单（幂等实现）
     * 使用订单号作为幂等键
     */
    public Order createOrder(OrderRequest request) {
        // 生成订单号（通常由客户端生成，保证全局唯一）
        String orderNo = request.getOrderNo();

        try {
            Order order = Order.builder()
                .orderNo(orderNo)
                .userId(request.getUserId())
                .amount(request.getAmount())
                .status(OrderStatus.PENDING)
                .build();

            orderMapper.insert(order);
            return order;

        } catch (DuplicateKeyException e) {
            // 唯一索引冲突，说明订单已存在，直接返回
            log.info("订单已存在: orderNo={}", orderNo);
            return orderMapper.selectByOrderNo(orderNo);
        }
    }
}
```

#### 支付幂等

```sql
-- 支付记录表
CREATE TABLE payment_records (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    payment_no VARCHAR(64) NOT NULL UNIQUE,  -- 支付流水号，唯一
    order_no VARCHAR(64) NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    pay_time TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_payment_no ON payment_records(payment_no);
```

```java
@Service
public class PaymentService {

    @Autowired
    private PaymentMapper paymentMapper;

    @Transactional
    public PaymentResult pay(String paymentNo, BigDecimal amount) {
        // 1. 检查支付记录是否已存在
        PaymentRecord existing = paymentMapper.selectByPaymentNo(paymentNo);

        if (existing != null) {
            // 已支付，直接返回
            if ("SUCCESS".equals(existing.getStatus())) {
                return PaymentResult.success(existing);
            }
            // 支付中或其他状态，根据业务处理
            return PaymentResult.processing();
        }

        // 2. 创建支付记录
        PaymentRecord record = PaymentRecord.builder()
            .paymentNo(paymentNo)
            .amount(amount)
            .status("PENDING")
            .build();

        try {
            paymentMapper.insert(record);
        } catch (DuplicateKeyException e) {
            // 并发情况下，另一个请求已经创建了记录
            return paymentMapper.selectByPaymentNo(paymentNo);
        }

        // 3. 调用第三方支付接口
        ThirdPartyResult result = thirdPartyPay.pay(paymentNo, amount);

        // 4. 更新支付状态
        if (result.isSuccess()) {
            paymentMapper.updateStatus(paymentNo, "SUCCESS");
            return PaymentResult.success(result);
        } else {
            paymentMapper.updateStatus(paymentNo, "FAILED");
            return PaymentResult.failed(result.getMessage());
        }
    }
}
```

### 方案二：Token 机制

服务端生成唯一的 Token，客户端携带 Token 进行操作。

#### 实现流程

```
客户端                          服务端
  │                               │
  │  1. 获取 Token                │
  │ ─────────────────────────────▶│
  │                               │
  │  ◀─────────────────────────────│  返回 Token (UUID)
  │                               │
  │  2. 携带 Token发起请求          │
  │ ─────────────────────────────▶│
  │                               │
  │                          验证Token
  │                          执行操作
  │                          删除Token
  │                               │
  │  ◀─────────────────────────────│  返回结果
  │                               │
```

#### Token 服务实现

```java
@Service
public class IdempotentTokenService {

    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;

    private static final String TOKEN_PREFIX = "idempotent:token:";
    private static final long TOKEN_EXPIRE_SECONDS = 3600;  // 1 小时

    /**
     * 生成幂等 Token
     */
    public String generateToken() {
        String token = UUID.randomUUID().toString().replace("-", "");
        redisTemplate.opsForValue().set(
            TOKEN_PREFIX + token,
            "PENDING",
            TOKEN_EXPIRE_SECONDS,
            TimeUnit.SECONDS
        );
        return token;
    }

    /**
     * 验证并使用 Token
     * @return true 表示首次使用，false 表示重复使用
     */
    public boolean validateAndConsumeToken(String token) {
        if (token == null) {
            return false;
        }

        String key = TOKEN_PREFIX + token;

        // 使用 SETNX 保证原子性
        // 成功设置（返回 true）说明是首次使用
        // 已存在（返回 false）说明已使用过
        Boolean result = redisTemplate.opsForValue()
            .setIfAbsent(key, "USED", TOKEN_EXPIRE_SECONDS, TimeUnit.SECONDS);

        return Boolean.TRUE.equals(result);
    }

    /**
     * 释放 Token（用于失败回滚）
     */
    public void releaseToken(String token) {
        if (token != null) {
            redisTemplate.delete(TOKEN_PREFIX + token);
        }
    }
}
```

#### 控制器层实现

```java
@RestController
@RequestMapping("/api/order")
public class OrderController {

    @Autowired
    private IdempotentTokenService tokenService;

    @Autowired
    private OrderService orderService;

    /**
     * 获取幂等 Token
     */
    @GetMapping("/token")
    public Response&lt;String&gt; getToken() {
        String token = tokenService.generateToken();
        return Response.success(token);
    }

    /**
     * 创建订单（需要先获取 Token）
     */
    @PostMapping("/create")
    public Response&lt;Order&gt; createOrder(
            @RequestHeader("X-Idempotent-Token") String token,
            @RequestBody OrderRequest request) {

        // 验证 Token
        if (!tokenService.validateAndConsumeToken(token)) {
            return Response.error("请勿重复提交");
        }

        try {
            Order order = orderService.createOrder(request);
            return Response.success(order);
        } catch (Exception e) {
            // 失败时释放 Token，允许重试
            tokenService.releaseToken(token);
            throw e;
        }
    }
}
```

#### 前端实现

```java
// 前端代码示例（JavaScript）
class OrderService {
    async createOrder(orderData) {
        // 1. 先获取 Token
        const tokenResponse = await fetch('/api/order/token');
        const { data: token } = await tokenResponse.json();

        // 2. 携带 Token 创建订单
        const response = await fetch('/api/order/create', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Idempotent-Token': token
            },
            body: JSON.stringify(orderData)
        });

        return response.json();
    }
}
```

### 方案三：分布式锁

使用分布式锁防止并发重复操作。

```java
@Service
public class IdempotentLockService {

    @Autowired
    private RedissonClient redissonClient;

    private static final long LOCK_TIMEOUT = 10;  // 锁超时 10 秒

    /**
     * 执行幂等操作
     * @param key 幂等键（如订单号、支付流水号）
     * @param action 要执行的操作
     */
    public &lt;T&gt; T executeWithLock(String key, Supplier&lt;T&gt; action) {
        RLock lock = redissonClient.getLock("idempotent:" + key);

        try {
            // 尝试获取锁，最多等待 0 秒，锁定 10 秒
            boolean locked = lock.tryLock(0, LOCK_TIMEOUT, TimeUnit.SECONDS);

            if (!locked) {
                throw new DuplicatedRequestException("请求正在处理中，请勿重复提交");
            }

            // 执行操作
            return action.get();

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new SystemException("系统繁忙，请稍后重试");
        } finally {
            // 业务完成后释放锁
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
}
```

#### 结合 Redis 的完整实现

```java
@Service
public class PaymentServiceWithLock {

    @Autowired
    private RedissonClient redissonClient;
    @Autowired
    private PaymentMapper paymentMapper;
    @Autowired
    private ThirdPartyPayService thirdPartyPay;

    public PaymentResult pay(String orderNo, BigDecimal amount) {
        String lockKey = "pay:lock:" + orderNo;
        RLock lock = redissonClient.getLock(lockKey);

        try {
            // 获取锁（等待 0 秒，锁定 30 秒）
            boolean locked = lock.tryLock(0, 30, TimeUnit.SECONDS);
            if (!locked) {
                return PaymentResult.processing("支付正在处理中");
            }

            // 加锁成功，开始处理
            return doPay(orderNo, amount);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return PaymentResult.failed("系统繁忙");
        } finally {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }

    private PaymentResult doPay(String orderNo, BigDecimal amount) {
        // 1. 检查支付状态（幂等）
        PaymentRecord existing = paymentMapper.selectByOrderNo(orderNo);
        if (existing != null) {
            return PaymentResult.fromRecord(existing);
        }

        // 2. 创建支付记录
        String paymentNo = generatePaymentNo();
        PaymentRecord record = PaymentRecord.builder()
            .paymentNo(paymentNo)
            .orderNo(orderNo)
            .amount(amount)
            .status("PENDING")
            .build();
        paymentMapper.insert(record);

        // 3. 调用第三方支付
        ThirdPartyResult result = thirdPartyPay.pay(paymentNo, amount);

        // 4. 更新状态
        String status = result.isSuccess() ? "SUCCESS" : "FAILED";
        paymentMapper.updateStatus(paymentNo, status);

        return PaymentResult.builder()
            .paymentNo(paymentNo)
            .status(status)
            .message(result.getMessage())
            .build();
    }
}
```

### 方案四：乐观锁

使用版本号实现乐观锁。

```java
// 数据库设计
CREATE TABLE account (
    id BIGINT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    balance DECIMAL(10, 2) NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 0  -- 版本号
);

-- 乐观锁更新
UPDATE account
SET balance = balance - #{amount},
    version = version + 1
WHERE id = #{id}
  AND version = #{version}
  AND balance >= #{amount}
```

```java
@Service
public class AccountService {

    @Autowired
    private AccountMapper accountMapper;

    /**
     * 扣款（乐观锁实现）
     */
    public boolean deduct(Long accountId, BigDecimal amount) {
        int updated = 0;
        int retryCount = 0;
        final int maxRetries = 3;

        while (retryCount &lt; maxRetries) {
            // 1. 获取当前账户信息
            Account account = accountMapper.selectById(accountId);

            // 2. 检查余额
            if (account.getBalance().compareTo(amount) &lt; 0) {
                throw new InsufficientBalanceException("余额不足");
            }

            // 3. 乐观锁更新
            updated = accountMapper.deductWithOptimisticLock(
                accountId,
                amount,
                account.getVersion()
            );

            if (updated > 0) {
                return true;  // 扣款成功
            }

            retryCount++;
            log.warn("乐观锁更新失败，重试第 {} 次", retryCount);
        }

        throw new ConcurrentUpdateException("扣款失败，请重试");
    }
}

// Mapper
@Update("UPDATE account " +
       "SET balance = balance - #{amount}, " +
       "    version = version + 1 " +
       "WHERE id = #{id} " +
       "  AND version = #{version} " +
       "  AND balance >= #{amount}")
int deductWithOptimisticLock(@Param("id") Long id,
                              @Param("amount") BigDecimal amount,
                              @Param("version") Integer version);
```

## 幂等性设计原则

### 1. 选择合适的幂等键

幂等键的选择很重要：
- **全局唯一**：在整个系统中不能重复
- **业务相关**：通常选择订单号、支付流水号、用户 ID + 业务类型等
- **可追溯**：能从幂等键追溯到业务

```java
// 好的幂等键
String paymentNo = userId + ":" + orderId + ":" + System.currentTimeMillis();
String idempotentKey = "扣款:" + userId + ":" + orderId + ":" + bizType;

// 不好的幂等键（可能重复）
String badKey = userId;  // 太简单，可能不够唯一
String worseKey = "createOrder";  // 完全没有区分度
```

### 2. 幂等性要覆盖所有入口

幂等性需要在所有可能的重复入口处实现：
- HTTP 接口重试
- 消息队列消费
- 定时任务补偿
- 异步回调
- 后台管理系统操作

### 3. 区分「处理中」和「已完成」

```java
// 状态设计
public enum OrderStatus {
    PENDING,      // 待处理
    PROCESSING,   // 处理中（防止并发）
    SUCCESS,      // 成功
    FAILED,       // 失败
    CANCELLED     // 已取消
}

// 查询时返回当前状态
public Order query(String orderNo) {
    Order order = orderMapper.selectByOrderNo(orderNo);
    if (order != null) {
        return order;
    }
    // 注意：不存在和「正在创建中」要区分
    // 可以通过分布式锁或状态机来区分
}
```

### 4. 幂等性和事务的配合

```java
@Transactional
public void createOrder(OrderRequest request) {
    // 1. 先检查是否已存在（幂等）
    if (orderMapper.existsByOrderNo(request.getOrderNo())) {
        return;  // 已存在，直接返回
    }

    // 2. 创建订单
    Order order = buildOrder(request);
    orderMapper.insert(order);

    // 3. 扣减库存（需要在事务内）
    inventoryService.deduct(request.getItems());

    // 4. 发送消息（异步）
    messageProducer.send("order.created", order);
}
```

## 幂等性方案对比

| 方案 | 适用场景 | 优点 | 缺点 |
|------|---------|------|------|
| **唯一索引** | 数据库操作 | 实现简单，性能好 | 只适合单机数据库 |
| **Token 机制** | HTTP 接口 | 实现灵活，可控性强 | 需要额外的 Token 服务 |
| **分布式锁** | 并发控制 | 功能强大，可组合 | 实现复杂，有性能开销 |
| **乐观锁** | 数据更新 | 无锁实现，性能高 | 需要重试，有冲突 |
| **状态机** | 状态流转 | 逻辑清晰 | 只适合有明确状态的场景 |

---

**思考题：**

1. 用户下单流程涉及：创建订单、扣减库存、扣减余额、发送消息。如果每个步骤都可能重复执行，如何设计一个完整的幂等方案？

2. 乐观锁在高并发场景下可能导致大量重试，如何优化？能否结合其他方案？

3. 分布式锁和 Token 机制都能实现幂等，它们有什么区别？什么时候用锁，什么时候用 Token？

4. 消息队列消费如何保证幂等？比如同一个订单创建消息被消费了两次，如何避免创建两条订单？
