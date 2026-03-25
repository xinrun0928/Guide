# 如何保证消息的幂等性消费？

你的系统遇到了这个问题：

用户下单后，扣了两次库存，发了两次短信，订单状态被更新了三遍。用户投诉：为什么我买了一件商品，你们发了三条通知？

这就是**消息重复消费**的问题。

网络抖动、消费者重启、Producer 重试……这些都会导致同一条消息被消费多次。**消息队列不保证「只消费一次」，它保证的是「至少消费一次」**。

所以，幂等性必须由消费者自己保证。

---

## 什么是幂等性？

幂等（Idempotent） = 多次执行 = 一次执行

```
幂等操作：
• 查询：查询 100 次 = 查询 1 次
• 插入：插入 100 次相同数据 = 插入 1 次（数据库有唯一索引）
• 更新：把 x 改成 y，100 次 = 1 次

非幂等操作：
• 扣减库存：扣 100 次 = 扣成负数
• 发送短信：发 100 次 = 用户收到 100 条短信
• 创建订单：创建 100 次 = 100 个订单
```

---

## 消息重复的来源

在讨论如何保证幂等之前，先看看消息为什么会重复。

### 来源一：Producer 端重试

```
Producer 发送消息 ──► Broker 收到 ──► 返回成功
         ↑
      超时了！以为失败
         │
         ▼
     重试发送 ──► Broker 又收到一次
     
结果：同一条消息被发送两次
```

### 来源二：Consumer 端超时

```
Consumer 消费消息 ──► 扣库存成功 ──► 提交 offset
                              ↑
                        超时了！
                        offset 没提交
                              │
                              ▼
                    Broker 以为没消费成功
                              │
                              ▼
                    消息重新投递给其他 Consumer
```

### 来源三：Rebalance 导致的消息转移

```
Consumer A 正在处理消息，还没提交 offset
                        │
                        │ Consumer A 挂了
                        ▼
              Coordinator 触发 Rebalance
                        │
                        ▼
              消息被重新分配给 Consumer B
                        │
                        ▼
              Consumer B 重新消费同一条消息
```

---

## 方案一：唯一键 + 去重表

核心思想：**记录已处理的消息 ID，处理前先查一下**。

### 原理

```
消息处理流程：
1. 收到消息，取出 messageId
2. 查去重表：messageId 是否存在？
   - 存在：说明处理过了，跳过
   - 不存在：继续处理
3. 业务处理成功
4. 写入去重表：messageId
```

### MySQL 去重表实现

```java
// 去重表结构
// CREATE TABLE message_dedup (
//     message_id VARCHAR(64) PRIMARY KEY,
//     status TINYINT DEFAULT 0,  -- 0: 处理中, 1: 已完成
//     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//     INDEX idx_created (created_at)
// );

@Service
public class IdempotentService {

    private final JdbcTemplate jdbcTemplate;

    /**
     * 尝试获取消息处理权
     * 返回 true 表示可以处理，返回 false 表示已被处理
     */
    public boolean tryAcquire(String messageId) {
        try {
            // 尝试插入，如果主键冲突则插入失败
            jdbcTemplate.update(
                "INSERT IGNORE INTO message_dedup (message_id, status) VALUES (?, 0)",
                messageId
            );
            // INSERT IGNORE：如果主键已存在，返回 0 行受影响
            // 插入成功返回 1，说明可以处理
            return true;
        } catch (DataAccessException e) {
            // 主键冲突，说明已经处理过了
            return false;
        }
    }

    /**
     * 标记消息处理完成
     */
    public void markCompleted(String messageId) {
        jdbcTemplate.update(
            "UPDATE message_dedup SET status = 1 WHERE message_id = ?",
            messageId
        );
    }
}

// 消费者使用
@KafkaListener(topics = "order-topic")
public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record) {
    String messageId = record.key();

    // 1. 尝试获取处理权
    if (!idempotentService.tryAcquire(messageId)) {
        log.info("消息已处理过，跳过: messageId={}", messageId);
        return;
    }

    try {
        // 2. 业务处理
        processOrder(record.value());

        // 3. 标记完成
        idempotentService.markCompleted(messageId);

    } catch (Exception e) {
        log.error("处理消息失败: messageId={}", messageId, e);
        // 不标记完成，下次还会被处理
        throw e;
    }
}
```

### 问题

| 问题 | 说明 | 解决 |
|-----|-----|-----|
| 性能开销 | 每次消费都要查库 | 加缓存、用异步 |
| 数据膨胀 | 去重表只增不减 | 定时清理历史数据 |

### 优化：异步批量写入

```java
public class AsyncIdempotentService {

    private final JdbcTemplate jdbcTemplate;
    private final BlockingQueue&lt;String&gt; pendingIds = new LinkedBlockingQueue&lt;&gt;();
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);

    @PostConstruct
    public void init() {
        // 批量写入，每 100ms 执行一次
        scheduler.scheduleAtFixedRate(() -> {
            List&lt;String&gt; batch = new ArrayList&lt;&gt;();
            pendingIds.drainTo(batch, 100);

            if (!batch.isEmpty()) {
                String sql = "INSERT IGNORE INTO message_dedup (message_id, status) VALUES " +
                    batch.stream().map(id -> "(?)").collect(Collectors.joining(","));
                jdbcTemplate.update(sql, batch.toArray());
            }
        }, 100, 100, TimeUnit.MILLISECONDS);
    }

    public boolean tryAcquire(String messageId) {
        // 先查 Redis 缓存
        Boolean exists = redisTemplate.hasKey("dedup:" + messageId);
        if (Boolean.TRUE.equals(exists)) {
            return false;
        }

        // 尝试加入批量队列
        boolean added = pendingIds.offer(messageId);
        // 如果队列满了，直接返回已处理（避免阻塞）
        return added;
    }

    public void markCompleted(String messageId) {
        redisTemplate.opsForValue().set("dedup:" + messageId, "1", 7, TimeUnit.DAYS);
    }
}
```

---

## 方案二：Redis 幂等

Redis 适合高性能场景，特别是**消息量大、去重要求快速响应**的情况。

### 基础实现

```java
@Service
public class RedisIdempotentService {

    private final StringRedisTemplate redisTemplate;
    private static final String DEDUP_KEY_PREFIX = "mq:dedup:";

    /**
     * 尝试获取消息处理权
     * 使用 SETNX + 过期时间
     */
    public boolean tryAcquire(String messageId) {
        String key = DEDUP_KEY_PREFIX + messageId;

        // SETNX：设置成功返回 true，设置失败返回 false
        // EX：设置过期时间，避免数据膨胀
        Boolean success = redisTemplate.opsForValue()
            .setIfAbsent(key, "1", 7, TimeUnit.DAYS);

        return Boolean.TRUE.equals(success);
    }
}
```

### 高并发场景：分段锁

```java
@Service
public class RedisSegmentIdempotentService {

    private final RedisTemplate&lt;String, String&gt; redisTemplate;
    private final RedissonClient redissonClient;

    /**
     * 分段锁实现
     * 适合处理突发的大量重复消息
     */
    public boolean tryAcquireWithLock(String messageId, long expireSeconds) {
        String dedupKey = "dedup:" + messageId;

        // 1. 先查缓存（快速路径）
        if (Boolean.TRUE.equals(redisTemplate.hasKey(dedupKey))) {
            return false;
        }

        // 2. 获取分布式锁（防止击穿）
        RLock lock = redissonClient.getLock("lock:" + messageId);
        try {
            // 3. 加锁（最多等 1 秒，锁自动 5 秒后释放）
            if (lock.tryLock(1, 5, TimeUnit.SECONDS)) {
                try {
                    // 4. 双重检查
                    if (Boolean.TRUE.equals(redisTemplate.hasKey(dedupKey))) {
                        return false;
                    }

                    // 5. 写入去重标记
                    redisTemplate.opsForValue()
                        .set(dedupKey, "1", expireSeconds, TimeUnit.SECONDS);
                    return true;
                } finally {
                    lock.unlock();
                }
            } else {
                // 获取锁失败，说明另一个实例正在处理
                return false;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return false;
        }
    }
}
```

---

## 方案三：业务状态机

对于**有明确状态流转的业务**，可以通过状态机天然实现幂等。

### 场景：订单支付

```
订单状态：待支付 ──► 支付中 ──► 已支付
                   │
             只有待支付才能转支付中
             重复支付直接返回成功（幂等）
```

```java
@Service
public class IdempotentPaymentService {

    /**
     * 幂等支付
     * 核心：使用乐观锁，只有状态符合预期才能更新
     */
    public boolean payOrder(String orderId, BigDecimal amount) {
        // 1. 查询订单状态
        Order order = orderRepository.findById(orderId);

        // 2. 幂等判断：状态已经是已支付，直接返回成功
        if (order.getStatus() == OrderStatus.PAID) {
            log.info("订单已支付，幂等返回: orderId={}", orderId);
            return true;
        }

        // 3. 状态校验：只有待支付才能转为支付中
        if (order.getStatus() != OrderStatus.PENDING) {
            log.warn("订单状态不允许支付: orderId={}, status={}",
                orderId, order.getStatus());
            return false;
        }

        // 4. 更新订单状态（乐观锁：只有状态对待支付才能更新）
        // UPDATE orders SET status = 'PAYING', version = version + 1
        // WHERE id = ? AND status = 'PENDING'
        int updated = orderRepository.updateStatusWithOptimisticLock(
            orderId,
            OrderStatus.PENDING,    // 预期状态
            OrderStatus.PAYING     // 新状态
        );

        if (updated == 0) {
            // 更新失败，可能是并发或状态已变化
            log.warn("订单状态更新失败，可能是并发: orderId={}", orderId);
            return false;
        }

        // 5. 执行支付
        paymentGateway.pay(orderId, amount);

        // 6. 更新为已支付
        orderRepository.updateStatusWithOptimisticLock(
            orderId,
            OrderStatus.PAYING,
            OrderStatus.PAID
        );

        return true;
    }
}
```

### 数据库乐观锁实现

```java
// 使用 version 字段实现乐观锁
@Entity
public class Order {
    @Id
    private String id;

    @Enumerated(EnumType.STRING)
    private OrderStatus status;

    @Version  // JPA 乐观锁注解
    private Long version;
}

@Repository
public interface OrderRepository extends JpaRepository&lt;Order, String&gt; {

    /**
     * 乐观锁更新
     * 只有当 id 和预期状态都匹配时才能更新
     */
    @Modifying
    @Query("UPDATE Order o SET o.status = :newStatus, o.version = o.version + 1 " +
           "WHERE o.id = :id AND o.status = :expectedStatus")
    int updateStatusWithOptimisticLock(
        @Param("id") String id,
        @Param("expectedStatus") OrderStatus expectedStatus,
        @Param("newStatus") OrderStatus newStatus
    );
}
```

---

## 方案四：Redis + MySQL 组合

最佳实践：**快速判断用 Redis，最终一致性用数据库**。

```java
@Service
public class HybridIdempotentService {

    private final StringRedisTemplate redisTemplate;
    private final JdbcTemplate jdbcTemplate;
    private static final String REDIS_PREFIX = "dedup:";
    private static final Duration REDIS_TTL = Duration.ofDays(7);

    /**
     * 两级去重：Redis 快速过滤 + MySQL 兜底
     */
    public boolean tryAcquire(String messageId) {
        // 1. 快速路径：Redis 判断
        String redisKey = REDIS_PREFIX + messageId;
        Boolean exists = redisTemplate.hasKey(redisKey);
        if (Boolean.TRUE.equals(exists)) {
            return false;
        }

        // 2. 兜底：MySQL 唯一键
        try {
            jdbcTemplate.update(
                "INSERT IGNORE INTO message_dedup (message_id, created_at) VALUES (?, NOW())",
                messageId
            );
        } catch (DataAccessException e) {
            // MySQL 主键冲突
            // 此时应该也在 Redis 中了（之前处理过的）
            // 为防止 Redis 过期后重复查库，补充写入 Redis
            redisTemplate.opsForValue().set(redisKey, "1", REDIS_TTL);
            return false;
        }

        // 3. 写入 Redis（后续请求快速过滤）
        redisTemplate.opsForValue().set(redisKey, "1", REDIS_TTL);
        return true;
    }

    /**
     * 清理过期数据（定时任务）
     */
    @Scheduled(fixedRate = 86400000)  // 每天执行一次
    public void cleanupExpiredData() {
        // 删除 MySQL 中的历史数据（保留 30 天）
        jdbcTemplate.update("DELETE FROM message_dedup WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)");

        // Redis TTL 自动过期，不需要手动清理
    }
}
```

---

## 方案对比

| 方案 | 实现难度 | 性能 | 适用场景 |
|-----|---------|-----|---------|
| MySQL 去重表 | 低 | 中 | 数据量适中 |
| Redis 去重 | 低 | 高 | 高并发场景 |
| 业务状态机 | 中 | 高 | 有明确状态流转的业务 |
| Redis + MySQL | 高 | 高 | 大流量、高可靠场景 |

---

## 实战：完整的幂等消费实现

```java
@Service
@Slf4j
public class IdempotentOrderConsumer {

    private final IdempotentService idempotentService;
    private final OrderService orderService;

    @KafkaListener(
        topics = "order-topic",
        groupId = "order-consumer",
        containerFactory = "manualAckFactory"
    )
    public void consumeOrder(ConsumerRecord&lt;String, OrderMessage&gt; record,
                              Acknowledgment acknowledgment) {
        String messageId = record.key();
        OrderMessage message = record.value();

        log.info("收到订单消息: messageId={}, orderId={}, action={}",
            messageId, message.getOrderId(), message.getAction());

        try {
            // 1. 幂等判断
            if (!idempotentService.tryAcquire(messageId)) {
                log.info("消息已处理过，跳过: messageId={}", messageId);
                acknowledgment.acknowledge();  // 也要 ack，否则会重复投递
                return;
            }

            // 2. 业务处理
            boolean success = orderService.processOrder(message);

            if (success) {
                // 3. 标记完成并确认消息
                idempotentService.markCompleted(messageId);
                acknowledgment.acknowledge();
                log.info("订单处理成功: messageId={}", messageId);
            } else {
                // 业务处理失败，不确认，等会重试
                // 可以抛异常触发重试机制
                throw new BusinessException("订单处理失败");
            }

        } catch (Exception e) {
            log.error("处理消息异常: messageId={}", messageId, e);
            // 失败时抛出异常，让重试机制处理
            throw new RuntimeException(e);
        }
    }
}
```

---

## 面试追问

**面试官可能会问：**

1. 「为什么消息队列不保证消息只消费一次？」—— 因为完全精确一次的代价太大，会严重影响性能
2. 「Redis 去重有什么风险？」—— Redis 宕机可能导致短暂的去重失效，需要 MySQL 兜底
3. 「乐观锁在高并发下有什么问题？」—— 大量重试导致 CPU 空转，适合低并发场景

幂等性不是一种配置，而是一种**编程习惯**。从设计之初就考虑幂等，比事后补救要高效得多。
