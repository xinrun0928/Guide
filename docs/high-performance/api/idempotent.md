# 接口幂等性实现方案汇总

你有没有遇到过这种尴尬的情况：

- 用户点了「提交订单」，结果网络超时，用户又点了一次
- 结果：两笔订单，扣了两次钱
- 用户投诉，客服头大，程序员背锅

这不是 bug，这是**接口没有做幂等性处理**。

幂等性（Idempotency）是指：**同一个接口，调用一次和调用多次的结果是一样的。** 无论你调用 1 次、2 次、100 次，只要参数相同，结果就应该相同。

今天我们就来聊聊，如何实现接口幂等性。

---

## 一、幂等性的本质

### 1.1 什么操作是幂等的？

```java
public class IdempotencyExamples {

    public static void main(String[] args) {
        System.out.println("========== 幂等性判断 ==========");
        System.out.println();

        System.out.println("✅ 幂等操作:");
        System.out.println("  - GET 查询: 读多少次都不会改变数据");
        System.out.println("  - PUT 更新: 同样的数据更新多次，结果一样");
        System.out.println("  - DELETE 删除: 删除已删除的资源，结果一样");
        System.out.println("  - 生成唯一 Token: 每次调用生成不同的 Token");
        System.out.println();

        System.out.println("❌ 非幂等操作:");
        System.out.println("  - POST 创建: 每次调用创建新资源");
        System.out.println("  - DELETE 删除计数: 每次减 1");
        System.out.println("  - 余额扣款: 每次都扣钱");
        System.out.println("  - 库存扣减: 每次都减库存");
        System.out.println();

        System.out.println("⚠️ 视情况而定:");
        System.out.println("  - POST 转账: 如果有幂等键，可能幂等");
        System.out.println("  - POST 支付: 预下单 + 实际扣款可能分开处理");
    }
}
```

### 1.2 幂等性的使用场景

```java
public class IdempotencyScenarios {

    public static void main(String[] args) {
        System.out.println("========== 需要幂等性的场景 ==========");
        System.out.println();

        System.out.println("1. 网络超时重试:");
        System.out.println("   用户点击 → 网络超时 → 前端重试");
        System.out.println("   → 如果接口幂等，不会创建多笔订单");
        System.out.println();

        System.out.println("2. 消息队列消费:");
        System.out.println("   消息消费 → 处理失败 → 消息重试");
        System.out.println("   → 如果接口幂等，不会重复处理");
        System.out.println();

        System.out.println("3. 分布式事务:");
        System.out.println("   TCC/Saga 模式中，参与者需要实现幂等");
        System.out.println("   → 防止分支事务重复执行");
        System.out.println();

        System.out.println("4. 浏览器后退:");
        System.out.println("   用户提交 → 页面跳转 → 用户点后退");
        System.out.println("   → 如果接口幂等，不会重复提交");
        System.out.println();

        System.out.println("5. 第三方回调:");
        System.out.println("   支付回调 → 网络抖动 → 重复回调");
        System.out.println("   → 支付系统需要幂等处理");
    }
}
```

---

## 二、幂等 Token 方案

### 2.1 核心原理

```java
/**
 * 幂等 Token 方案原理
 */
public class IdempotencyTokenPrinciple {

    public static void main(String[] args) {
        System.out.println("========== 幂等 Token 方案 ==========");
        System.out.println();

        System.out.println("流程:");
        System.out.println("┌──────────────────────────────────────────────┐");
        System.out.println("│  1. 客户端请求幂等 Token                      │");
        System.out.println("│     POST /api/token  →  返回 token=uuid     │");
        System.out.println("│                                              │");
        System.out.println("│  2. 客户端带着 Token 调用业务接口            │");
        System.out.println("│     POST /api/order  Header: X-Idempotency-Token: uuid │");
        System.out.println("│                                              │");
        System.out.println("│  3. 服务端处理请求                           │");
        System.out.println("│     - 检查 Token 是否已使用                   │");
        System.out.println("│     - 未使用: 标记 Token，执行业务，存储结果  │");
        System.out.println("│     - 已使用: 直接返回上次结果               │");
        System.out.println("└──────────────────────────────────────────────┘");
    }
}
```

### 2.2 Token 服务实现

```java
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class IdempotencyTokenService {

    // 生产环境应使用 Redis 或数据库
    private final ConcurrentHashMap&lt;String, IdempotencyRecord&gt; tokenStore;

    public IdempotencyTokenService() {
        this.tokenStore = new ConcurrentHashMap&lt;&gt;();
    }

    /**
     * 生成幂等 Token
     */
    public String generateToken(String userId, String action) {
        String token = UUID.randomUUID().toString();
        IdempotencyRecord record = new IdempotencyRecord();
        record.setToken(token);
        record.setUserId(userId);
        record.setAction(action);
        record.setStatus(TokenStatus.CREATED);
        record.setCreatedAt(System.currentTimeMillis());

        tokenStore.put(token, record);
        return token;
    }

    /**
     * 尝试获取 Token 锁（原子操作）
     * 返回 true 表示首次获取，可以执行
     * 返回 false 表示已被其他请求获取
     */
    public boolean tryAcquire(String token) {
        IdempotencyRecord record = tokenStore.get(token);
        if (record == null) {
            return false; // Token 不存在
        }

        // CAS 操作，确保原子性
        return record.getStatus() == TokenStatus.CREATED
                && record.compareAndSetStatus(TokenStatus.CREATED, TokenStatus.PROCESSING);
    }

    /**
     * 标记 Token 处理完成
     */
    public void markCompleted(String token, Object result) {
        IdempotencyRecord record = tokenStore.get(token);
        if (record != null) {
            record.setStatus(TokenStatus.COMPLETED);
            record.setResult(result);
            record.setCompletedAt(System.currentTimeMillis());
        }
    }

    /**
     * 标记 Token 失败
     */
    public void markFailed(String token, String error) {
        IdempotencyRecord record = tokenStore.get(token);
        if (record != null) {
            record.setStatus(TokenStatus.FAILED);
            record.setError(error);
        }
    }

    /**
     * 获取已完成的处理结果
     */
    public Object getResult(String token) {
        IdempotencyRecord record = tokenStore.get(token);
        return record != null ? record.getResult() : null;
    }

    /**
     * 获取 Token 状态
     */
    public TokenStatus getStatus(String token) {
        IdempotencyRecord record = tokenStore.get(token);
        return record != null ? record.getStatus() : null;
    }
}

@Data
class IdempotencyRecord {
    private String token;
    private String userId;
    private String action;
    private TokenStatus status;
    private Object result;
    private String error;
    private long createdAt;
    private long completedAt;

    private volatile int statusValue = 0;

    public boolean compareAndSetStatus(TokenStatus expect, TokenStatus update) {
        if (this.status == expect) {
            this.status = update;
            return true;
        }
        return false;
    }
}

enum TokenStatus {
    CREATED,    // 刚创建
    PROCESSING, // 处理中
    COMPLETED,  // 处理完成
    FAILED      // 处理失败
}
```

### 2.3 业务接口使用示例

```java
@Service
@Slf4j
public class OrderService {

    @Autowired
    private IdempotencyTokenService tokenService;

    /**
     * 创建订单（幂等实现）
     */
    public Order createOrder(CreateOrderRequest request) {
        String idempotencyToken = request.getIdempotencyToken();

        // 1. 检查 Token 状态
        TokenStatus status = tokenService.getStatus(idempotencyToken);
        if (status == TokenStatus.COMPLETED) {
            log.info("重复请求，直接返回结果, token={}", idempotencyToken);
            return (Order) tokenService.getResult(idempotencyToken);
        }

        if (status == TokenStatus.PROCESSING) {
            throw new IdempotencyConflictException("请求正在处理中");
        }

        // 2. 尝试获取执行权限
        if (!tokenService.tryAcquire(idempotencyToken)) {
            throw new IdempotencyInvalidException("Token 无效");
        }

        try {
            // 3. 执行业务逻辑
            Order order = doCreateOrder(request);

            // 4. 标记完成
            tokenService.markCompleted(idempotencyToken, order);

            return order;
        } catch (Exception e) {
            // 5. 标记失败
            tokenService.markFailed(idempotencyToken, e.getMessage());
            throw e;
        }
    }

    private Order doCreateOrder(CreateOrderRequest request) {
        // 实际的创建订单逻辑
        return new Order();
    }
}
```

---

## 三、数据库唯一索引方案

### 3.1 原理

利用数据库唯一索引的特性，确保同一业务标识只有一条记录。

```sql
-- 创建唯一索引
CREATE UNIQUE INDEX idx_order_idempotency_key
ON orders (user_id, idempotency_key);

-- 或者联合唯一索引
ALTER TABLE orders ADD CONSTRAINT uk_idempotency
UNIQUE (biz_type, idempotency_key);
```

### 3.2 实现

```java
@Service
@Slf4j
public class OrderServiceWithUniqueIndex {

    @Autowired
    private OrderMapper orderMapper;

    /**
     * 创建订单（基于唯一索引的幂等方案）
     */
    @Transactional
    public Order createOrder(IdempotentOrderRequest request) {
        try {
            Order order = convertToOrder(request);
            orderMapper.insertSelective(order);
            return order;
        } catch (DuplicateKeyException e) {
            // 唯一键冲突，说明订单已存在
            log.info("订单已存在, idempotencyKey={}", request.getIdempotencyKey());
            return orderMapper.selectByIdempotencyKey(request.getIdempotencyKey());
        }
    }
}

@Data
public class IdempotentOrderRequest {
    private String idempotencyKey;  // 业务幂等键
    private Long userId;
    private List&lt;OrderItem&gt; items;
    private BigDecimal amount;
}

@Mapper
public interface OrderMapper {

    @Insert("INSERT INTO orders (idempotency_key, user_id, amount, status, created_at) " +
            "VALUES (#{idempotencyKey}, #{userId}, #{amount}, #{status}, #{createdAt})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insertSelective(Order order);

    @Select("SELECT * FROM orders WHERE idempotency_key = #{idempotencyKey}")
    Order selectByIdempotencyKey(@Param("idempotencyKey") String idempotencyKey);
}
```

---

## 四、乐观锁方案

### 4.1 版本号控制

```java
/**
 * 乐观锁实现幂等
 */
@Service
public class InventoryService {

    @Autowired
    private InventoryMapper inventoryMapper;

    /**
     * 扣减库存（乐观锁 + 幂等）
     */
    public boolean deductStock(Long productId, Integer quantity) {
        // 重试次数
        int maxRetries = 3;

        for (int i = 0; i < maxRetries; i++) {
            Inventory inventory = inventoryMapper.selectByProductId(productId);
            if (inventory == null) {
                throw new BusinessException("商品不存在");
            }

            // 检查库存是否足够
            if (inventory.getStock() &lt; quantity) {
                throw new BusinessException("库存不足");
            }

            // 更新时检查版本号
            int rows = inventoryMapper.updateStockWithVersion(
                    productId,
                    quantity,
                    inventory.getVersion()
            );

            if (rows > 0) {
                return true; // 更新成功
            }

            // 版本号不匹配，说明有并发修改，版本号已被更新
            // 重试
        }

        throw new BusinessException("扣减库存失败，请重试");
    }
}

@Mapper
public interface InventoryMapper {

    @Select("SELECT * FROM inventory WHERE product_id = #{productId}")
    Inventory selectByProductId(Long productId);

    @Update("UPDATE inventory " +
            "SET stock = stock - #{quantity}, version = version + 1 " +
            "WHERE product_id = #{productId} AND version = #{version} " +
            "AND stock >= #{quantity}")
    int updateStockWithVersion(
            @Param("productId") Long productId,
            @Param("quantity") Integer quantity,
            @Param("version") Integer version
    );
}
```

### 4.2 扣款场景

```java
@Service
@Slf4j
public class AccountService {

    /**
     * 账户扣款（幂等实现）
     * 使用「预扣款 + 最终扣款」两阶段模式
     */
    @Transactional
    public void deduct(AccountDeductRequest request) {
        String idempotencyKey = request.getIdempotencyKey();

        // 1. 检查是否已处理
        TransactionRecord existing = transactionMapper.selectByIdempotencyKey(idempotencyKey);
        if (existing != null) {
            if (existing.getStatus() == TransactionStatus.SUCCESS) {
                log.info("交易已成功处理, key={}", idempotencyKey);
                return;
            }
            if (existing.getStatus() == TransactionStatus.FAILED) {
                log.info("交易已失败, key={}", idempotencyKey);
                return;
            }
        }

        // 2. 创建交易记录
        TransactionRecord record = new TransactionRecord();
        record.setIdempotencyKey(idempotencyKey);
        record.setAccountId(request.getAccountId());
        record.setAmount(request.getAmount());
        record.setStatus(TransactionStatus.PENDING);
        transactionMapper.insert(record);

        try {
            // 3. 执行扣款（乐观锁）
            int rows = accountMapper.deductBalanceWithOptimisticLock(
                    request.getAccountId(),
                    request.getAmount(),
                    record.getVersion()
            );

            if (rows == 0) {
                // 余额不足或版本冲突
                record.setStatus(TransactionStatus.FAILED);
                transactionMapper.updateByPrimaryKey(record);
                throw new InsufficientBalanceException("余额不足");
            }

            // 4. 标记成功
            record.setStatus(TransactionStatus.SUCCESS);
            transactionMapper.updateByPrimaryKey(record);

        } catch (Exception e) {
            record.setStatus(TransactionStatus.FAILED);
            transactionMapper.updateByPrimaryKey(record);
            throw e;
        }
    }
}
```

---

## 五、Redis 分布式锁方案

### 5.1 基础实现

```java
@Service
public class DistributedLockService {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private static final String LOCK_PREFIX = "lock:";

    /**
     * 获取分布式锁
     */
    public String acquireLock(String key, long expireMs) {
        String lockKey = LOCK_PREFIX + key;
        String lockValue = UUID.randomUUID().toString();

        Boolean success = redisTemplate.opsForValue()
                .setIfAbsent(lockKey, lockValue, Duration.ofMillis(expireMs));

        if (Boolean.TRUE.equals(success)) {
            return lockValue;
        }
        return null;
    }

    /**
     * 释放分布式锁
     */
    public boolean releaseLock(String key, String lockValue) {
        String lockKey = LOCK_PREFIX + key;
        String currentValue = redisTemplate.opsForValue().get(lockKey);

        // 只释放自己持有的锁
        if (lockValue.equals(currentValue)) {
            return Boolean.TRUE.equals(redisTemplate.delete(lockKey));
        }
        return false;
    }

    /**
     * 获取锁（带重试）
     */
    public String acquireLockWithRetry(String key, long expireMs, int retryTimes) {
        for (int i = 0; i &lt; retryTimes; i++) {
            String lockValue = acquireLock(key, expireMs);
            if (lockValue != null) {
                return lockValue;
            }
            try {
                Thread.sleep(100); // 等待 100ms
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return null;
    }
}
```

### 5.2 幂等接口实现

```java
@Service
@Slf4j
public class PaymentService {

    @Autowired
    private DistributedLockService lockService;
    @Autowired
    private PaymentMapper paymentMapper;
    @Autowired
    private RedisTemplate&lt;String, Object&gt; redisTemplate;

    private static final long LOCK_EXPIRE_MS = 5000;

    /**
     * 发起支付（幂等）
     */
    public PaymentResult initiatePayment(PaymentRequest request) {
        String idempotencyKey = request.getIdempotencyKey();
        String lockKey = "payment:" + idempotencyKey;

        // 1. 尝试获取锁
        String lockValue = lockService.acquireLockWithRetry(lockKey, LOCK_EXPIRE_MS, 3);

        if (lockValue == null) {
            throw new ConcurrentRequestException("请求正在处理中，请稍后");
        }

        try {
            // 2. 检查是否已处理
            PaymentResult cachedResult = (PaymentResult) redisTemplate.opsForValue()
                    .get("payment:result:" + idempotencyKey);
            if (cachedResult != null) {
                log.info("返回缓存的支付结果, key={}", idempotencyKey);
                return cachedResult;
            }

            // 3. 执行业务
            PaymentResult result = doPayment(request);

            // 4. 缓存结果
            redisTemplate.opsForValue().set(
                    "payment:result:" + idempotencyKey,
                    result,
                    Duration.ofHours(24)
            );

            return result;
        } finally {
            // 5. 释放锁
            lockService.releaseLock(lockKey, lockValue);
        }
    }

    private PaymentResult doPayment(PaymentRequest request) {
        // 实际支付逻辑
        return new PaymentResult();
    }
}
```

---

## 六、消息队列幂等性

### 6.1 消费端幂等

```java
@Service
@Slf4j
public class OrderMessageConsumer {

    @Autowired
    private OrderService orderService;
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;

    private static final String PROCESSED_KEY_PREFIX = "msg:processed:";

    /**
     * 消费订单创建消息
     */
    @KafkaListener(topics = "order-created")
    public void consumeOrderCreated(String message) {
        OrderMessage orderMessage = parseMessage(message);
        String messageId = orderMessage.getMessageId();

        // 1. 检查是否已处理
        String processed = redisTemplate.opsForValue().get(PROCESSED_KEY_PREFIX + messageId);
        if ("1".equals(processed)) {
            log.info("消息已处理，跳过, messageId={}", messageId);
            return;
        }

        // 2. 执行业务
        try {
            orderService.processOrderMessage(orderMessage);

            // 3. 标记已处理
            // 设置合理过期时间，避免 Redis 占用过多
            redisTemplate.opsForValue().set(
                    PROCESSED_KEY_PREFIX + messageId,
                    "1",
                    Duration.ofDays(7)
            );
        } catch (Exception e) {
            log.error("处理消息失败, messageId={}", messageId, e);
            // 根据业务需求决定是否抛出异常触发重试
            throw e;
        }
    }

    private OrderMessage parseMessage(String message) {
        ObjectMapper mapper = new ObjectMapper();
        return mapper.readValue(message, OrderMessage.class);
    }
}
```

### 6.2 RocketMQ 事务消息

```java
@Service
public class OrderTransactionService {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    /**
     * 发送事务消息
     */
    public void createOrderWithTransaction(CreateOrderRequest request) {
        String transactionId = UUID.randomUUID().toString();

        // 构建消息
        OrderMessage message = new OrderMessage();
        message.setTransactionId(transactionId);
        message.setOrderRequest(request);

        // 发送事务消息
        rocketMQTemplate.asyncSend("order-topic", message, new OrderTransactionListener(), 3000);
    }
}

/**
 * 事务消息监听器
 */
@Component
@Slf4j
public class OrderTransactionListener implements TransactionListener {

    @Autowired
    private OrderService orderService;

    @Override
    public LocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        OrderMessage orderMessage = parseMessage(new String(msg.getBody()));

        try {
            // 执行业务
            orderService.createOrder(orderMessage.getOrderRequest());
            return LocalTransactionState.COMMIT_MESSAGE;
        } catch (Exception e) {
            log.error("本地事务执行失败", e);
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
    }

    @Override
    public LocalTransactionState checkLocalTransaction(MessageExt msg) {
        String transactionId = msg.getTransactionId();

        // 检查本地事务状态
        TransactionStatus status = transactionService.getStatus(transactionId);

        if (status == TransactionStatus.COMMITTED) {
            return LocalTransactionState.COMMIT_MESSAGE;
        } else if (status == TransactionStatus.FAILED) {
            return LocalTransactionState.ROLLBACK_MESSAGE;
        }
        return LocalTransactionState.UNKNOWN;
    }

    private OrderMessage parseMessage(byte[] body) {
        // 解析消息
        return null;
    }
}
```

---

## 七、方案对比

```java
public class IdempotencyCompare {

    public static void main(String[] args) {
        System.out.println("========== 幂等方案对比 ==========");
        System.out.println();

        System.out.println("┌──────────────┬──────────┬──────────┬──────────┬────────────┐");
        System.out.println("│   方案       │ 实现难度 │ 性能     │ 可靠性   │ 适用场景   │");
        System.out.println("├──────────────┼──────────┼──────────┼──────────┼────────────┤");
        System.out.println("│ Token 方案   │ 中等     │ 高       │ 高       │ 通用       │");
        System.out.println("│ 唯一索引     │ 低       │ 高       │ 高       │ 数据库写入 │");
        System.out.println("│ 乐观锁       │ 中等     │ 中等     │ 中等     │ 并发更新   │");
        System.out.println("│ 分布式锁     │ 中等     │ 中等     │ 高       │ 分布式场景 │");
        System.out.println("│ 消息去重     │ 中等     │ 高       │ 高       │ MQ 消费    │");
        System.out.println("└──────────────┴──────────┴──────────┴──────────┴────────────┘");
        System.out.println();

        System.out.println("选型建议:");
        System.out.println("  1. HTTP 接口 → Token 方案（最灵活）");
        System.out.println("  2. 数据库写入 → 唯一索引（最简单）");
        System.out.println("  3. 高并发扣减 → 乐观锁（性能好）");
        System.out.println("  4. 跨服务调用 → 分布式锁（可靠性高）");
        System.out.println("  5. 消息消费 → 消息去重（业务幂等）");
    }
}
```

---

## 留给你的问题

幂等性是分布式系统的基础能力，但实现起来并不简单。

有几个问题值得思考：

1. **Token 方案中，如果业务处理成功了，但标记完成时失败了怎么办？** 重试会导致什么问题？
2. **乐观锁方案中，重试次数用完了还是没有更新成功怎么办？** 这时候用户的钱扣了吗？
3. **分布式锁方案中，如果锁过期了但业务还在执行怎么办？** 如何防止锁被其他请求获取？

这些问题没有标准答案，但理解它们能帮助你设计更健壮的幂等方案。

**你的系统遇到过幂等性问题吗？最后是怎么解决的？**
