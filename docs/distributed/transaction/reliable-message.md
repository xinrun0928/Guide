# 可靠消息最终一致性方案

你有没有想过这个问题：

订单服务在本地事务里扣了库存，然后发了一条 MQ 消息。

本地事务提交成功了，但 MQ 消息发送失败了。

怎么办？

**可靠消息方案，就是来解决这个问题的。**

## 问题分析

本地事务成功后，消息必须被投递到下游。

这是分布式事务「最终一致性」的核心目标。

```
问题场景：
1. 本地事务执行：扣库存、创建订单 ✓
2. 发送 MQ 消息：OrderCreated ✗ （发送失败）

结果：库存扣了，订单创建了，但下游不知道
```

## 方案一：本地消息表

本地消息表是最经典的可靠消息方案。

核心思想：**把消息记录到本地数据库，和业务操作放在同一个事务里。**

```java
/**
 * 本地消息表方案
 */
public class OrderService {

    @Autowired
    private OrderDao orderDao;

    @Autowired
    private MessageDao messageDao;

    /**
     * 创建订单 + 记录消息（在同一个事务中）
     */
    @Transactional
    public void createOrder(Order order) {
        // 1. 扣库存（本地事务）
        inventoryService.decreaseStock(order.getProductId(), order.getCount());

        // 2. 创建订单（本地事务）
        orderDao.insert(order);

        // 3. 记录消息到本地消息表（与上面操作在同一个事务）
        // 这条消息的 state = 0（待发送）
        messageDao.insert(new Message(
            order.getId(),                    // 业务 ID
            "order.created",                  // 消息类型
            JSON.toJSONString(order),         // 消息内容
            0                                // 状态：0=待发送
        ));

        // 4. 事务提交：库存扣减 + 订单创建 + 消息记录 同时成功
    }
}
```

```sql
-- 本地消息表结构
CREATE TABLE local_message (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    biz_id VARCHAR(64) NOT NULL,           -- 业务 ID
    message_type VARCHAR(32) NOT NULL,      -- 消息类型
    message_content TEXT NOT NULL,          -- 消息内容
    state INT DEFAULT 0,                    -- 状态：0=待发送, 1=已发送, 2=发送失败
    retry_count INT DEFAULT 0,              -- 重试次数
    create_time DATETIME DEFAULT NOW(),
    update_time DATETIME DEFAULT NOW(),
    UNIQUE KEY uk_biz_type (biz_id, message_type)
);
```

```java
/**
 * 消息投递器（独立线程/定时任务）
 */
public class MessageSender {

    @Autowired
    private MessageDao messageDao;

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    /**
     * 定时扫描待发送消息
     */
    @Scheduled(fixedDelay = 1000)
    public void scanAndSend() {
        // 1. 查询待发送消息（state = 0）
        List&lt;Message&gt; messages = messageDao.selectPendingMessages(100);

        for (Message message : messages) {
            try {
                // 2. 发送 MQ 消息
                rocketMQTemplate.convertAndSend(
                    "order-topic",
                    message.getMessageType(),
                    message.getMessageContent()
                );

                // 3. 更新消息状态为「已发送」
                messageDao.updateState(message.getId(), 1);

            } catch (Exception e) {
                // 4. 发送失败，重试
                messageDao.incrementRetry(message.getId());

                if (message.getRetryCount() > 3) {
                    // 超过重试次数，标记为失败
                    messageDao.updateState(message.getId(), 2);
                }
            }
        }
    }
}
```

### 本地消息表方案的优点

1. **可靠投递**：消息和业务在同一个事务，成功率 100%
2. **实现简单**：不需要 MQ 特殊支持
3. **幂等性好**：消息表天然支持幂等

### 本地消息表方案的缺点

1. **业务侵入**：需要在业务表外新建消息表
2. **数据库负担**：频繁写入消息表
3. **延迟**：消息投递有延迟（轮询间隔）

## 方案二：RocketMQ 事务消息

RocketMQ 4.3+ 提供了原生的事务消息支持。

核心思想：**引入「半消息」机制，确保消息和本地事务的原子性。**

```java
/**
 * RocketMQ 事务消息生产者
 */
@Service
public class OrderTransactionProducer {

    @Autowired
    private RocketMQTemplate rocketMQTemplate;

    @Autowired
    private OrderService orderService;

    /**
     * 发送事务消息
     */
    public void sendOrderCreatedMessage(Order order) {
        // 1. 发送半消息（Half Message）
        // 半消息：不会被消费者看到，等 Producer 确认后才投递
        rocketMQTemplate.sendMessageInTransaction(
            "order-topic:order-created",
            MessageBuilder.withPayload(order)
                .setHeader("orderId", order.getId())
                .build(),
            order // 额外参数，传递给 executeLocalTransaction
        );
    }

    /**
     * 本地事务执行方法
     *
     * 这个方法会和半消息的发送在同一个事务中
     */
    public Transaction sendOrderInTransaction(Order order, Message msg) {
        try {
            // 1. 扣库存
            inventoryService.decreaseStock(order.getProductId(), order.getCount());

            // 2. 创建订单
            orderService.createOrder(order);

            // 3. 本地事务成功，提交半消息
            return Transaction.ROLLBACK_NONE; // 提交
            // 注意：这里不需要手动提交，RocketMQ 会自动提交

        } catch (Exception e) {
            // 4. 本地事务失败，回滚半消息
            return Transaction.ROLLBACK;
        }
    }
}
```

```java
/**
 * RocketMQ 事务消息监听器
 *
 * 处理「本地事务执行成功，但发送方崩溃」的情况
 */
@Component
@RocketMQTransactionListener
public class OrderTransactionListener implements RocketMQLocalTransactionListener {

    @Autowired
    private OrderService orderService;

    @Override
    public RocketMQLocalTransactionState executeLocalTransaction(Message msg, Object arg) {
        try {
            // 1. 执行本地事务
            Order order = (Order) arg;
            orderService.createOrder(order);

            // 2. 本地事务成功，提交半消息
            return RocketMQLocalTransactionState.COMMIT;

        } catch (Exception e) {
            // 3. 本地事务失败，回滚半消息
            return RocketMQLocalTransactionState.ROLLBACK;
        }
    }

    @Override
    public RocketMQLocalTransactionState checkLocalTransaction(Message msg) {
        // 4. 反查本地事务状态
        // 当发送方崩溃时，MQ 会回调这个方法
        String orderId = msg.getHeaders().get("orderId", String.class);

        Order order = orderService.getOrderById(orderId);

        if (order != null) {
            // 订单存在，说明本地事务成功，提交半消息
            return RocketMQLocalTransactionState.COMMIT;
        } else {
            // 订单不存在，说明本地事务失败，回滚半消息
            return RocketMQLocalTransactionState.ROLLBACK;
        }
    }
}
```

### RocketMQ 事务消息的执行流程

```
1. Producer 发送半消息（Half Message）给 Broker
      ↓
2. Broker 存储半消息，返回成功
      ↓
3. Producer 执行本地事务（扣库存、创建订单）
      ↓
   成功 → 返回 COMMIT，Broker 投递消息给 Consumer
   失败 → 返回 ROLLBACK，Broker 删除半消息
      ↓
4. 如果 Producer 崩溃：
      ↓
   Broker 回调 checkLocalTransaction 反查本地事务状态
      ↓
   根据反查结果决定 COMMIT 或 ROLLBACK
```

## 两种方案的对比

| 维度 | 本地消息表 | RocketMQ 事务消息 |
|------|-----------|-----------------|
| 实现复杂度 | 中等 | 较高 |
| MQ 支持 | 任何 MQ | 需要事务消息支持（RocketMQ/Kafka） |
| 业务侵入 | 需要消息表 | 需要实现 TransactionListener |
| 性能 | 较差（频繁写表） | 较好 |
| 可靠性 | 高 | 高 |
| 消息延迟 | 有延迟（轮询） | 几乎无延迟 |

## 面试追问方向

**追问 1：RocketMQ 事务消息的「半消息」是什么？**

半消息（Half Message）是 RocketMQ 的特殊消息类型：
- 存储在 Broker，但不会投递给 Consumer
- 只有 Producer 确认后，才会「变」成正常消息投递

类比：就像「挂号信」——收信人（Consumer）看不到内容，只有发信人（Producer）确认后才送达。

**追问 2：如果 MQ 事务消息的 checkLocalTransaction 也失败了怎么办？**

RocketMQ 会**无限重试** checkLocalTransaction。

所以：
1. checkLocalTransaction 的查询必须幂等
2. 查询条件必须明确（订单 ID）
3. 如果持续无法确认，RocketMQ 会回滚消息（不会卡死）

**追问 3：消息消费端如何保证幂等？**

消费端幂等的常用方法：
1. **数据库唯一约束**：消息 ID 作为唯一键，重复插入报错
2. **Redis 去重**：消息 ID 存入 Redis，重复消息跳过
3. **业务状态机**：订单状态只能「创建→支付→完成」，不能「创建→创建」

## 总结

可靠消息方案的核心目标：**本地事务成功后，消息一定被投递到下游。**

两种实现方式：

1. **本地消息表**：消息记录到本地数据库，和业务在同一个事务
2. **RocketMQ 事务消息**：半消息 + 本地事务 + 反查机制

选择建议：
- 有 RocketMQ/Kafka：直接用事务消息
- 没有：本地消息表是很好的替代方案
