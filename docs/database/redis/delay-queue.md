# Redis 延时队列：订单超时处理的利器

你有没有遇到过这种场景：

> 用户下单后，30 分钟内没有支付，自动取消订单。
> 怎么实现？

定时轮询？太浪费资源。

用 RabbitMQ 的延时消息？太重了。

**Redis 延时队列**帮你解决这个问题。

## 延时队列是什么？

延时队列是一种特殊队列，元素不是立即可用的，而是需要等待指定时间后才可用。

```
┌────────────┐     10秒      ┌────────────┐
│ 订单1     │ ──────────────→ │ 队列头部   │
│ (10秒后)   │               │ (可消费)   │
└────────────┘               └────────────┘

┌────────────┐     30秒      ┌────────────┐
│ 订单2     │ ──────────────→ │            │
│ (30秒后)   │               │            │
└────────────┘               └────────────┘
```

## Redis 实现延时队列的方案

### 方案一：ZSet 实现延时队列

利用 ZSet 的分数特性，把执行时间戳作为分数。

```java
public class DelayQueueZSet {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String DELAY_QUEUE = "delay:queue:orders";

    /**
     * 添加延时任务
     */
    public void addDelayTask(String orderId, long delayMillis) {
        // 执行时间 = 当前时间 + 延时时间
        long executeTime = System.currentTimeMillis() + delayMillis;

        // 添加到 ZSet，分数为执行时间戳
        jedis.zadd(DELAY_QUEUE, executeTime, orderId);
    }

    /**
     * 消费延时任务
     */
    public String pollTask() {
        // 获取当前时间戳
        long now = System.currentTimeMillis();

        // 获取 ZSet 中分数 <= 当前时间的任务
        Set&lt;String&gt; tasks = jedis.zrangebyscore(DELAY_QUEUE, 0, now, 0, 1);

        if (tasks.isEmpty()) {
            return null;
        }

        // 取出第一个
        String taskId = tasks.iterator().next();

        // 删除任务（原子操作）
        if (jedis.zrem(DELAY_QUEUE, taskId) > 0) {
            return taskId;
        }

        return null;
    }

    /**
     * 完整的消费循环
     */
    public void consumeLoop() {
        while (true) {
            String taskId = pollTask();
            if (taskId != null) {
                // 处理任务
                System.out.println("Processing task: " + taskId);
                processOrder(taskId);
            } else {
                // 没有任务，短暂休眠
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    private void processOrder(String orderId) {
        // 订单处理逻辑
    }
}
```

### 方案二：轮询 + 分布式锁

```java
public class DelayQueueWithLock {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private RedissonClient redisson;

    /**
     * 添加延时任务
     */
    public void addDelayTask(String orderId, long delayMillis) {
        String taskKey = "task:" + orderId;
        long executeTime = System.currentTimeMillis() + delayMillis;

        // 存储任务数据和执行时间
        Map&lt;String, String&gt; task = new HashMap&lt;&gt;();
        task.put("orderId", orderId);
        task.put("executeTime", String.valueOf(executeTime));

        jedis.hset(taskKey, task);
        jedis.zadd("delay:tasks:zset", executeTime, orderId);
    }

    /**
     * 消费者
     */
    public void consume() {
        while (true) {
            // 获取需要执行的任务
            long now = System.currentTimeMillis();
            Set&lt;String&gt; taskIds = jedis.zrangebyscore(
                "delay:tasks:zset", 0, now, 0, 10);

            for (String taskId : taskIds) {
                String lockKey = "lock:task:" + taskId;
                RLock lock = redisson.getLock(lockKey);

                try {
                    // 尝试获取分布式锁
                    if (lock.tryLock(0, 10, TimeUnit.SECONDS)) {
                        try {
                            // 再次检查时间
                            Double executeTime = jedis.zscore(
                                "delay:tasks:zset", taskId);

                            if (executeTime != null
                                && executeTime <= System.currentTimeMillis()) {
                                // 执行任务
                                processTask(taskId);

                                // 删除任务
                                jedis.zrem("delay:tasks:zset", taskId);
                                jedis.del("task:" + taskId);
                            }
                        } finally {
                            lock.unlock();
                        }
                    }
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }

            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void processTask(String taskId) {
        // 处理任务
    }
}
```

## 订单超时取消实战

### 订单服务

```java
@Service
public class OrderService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String DELAY_QUEUE = "delay:queue:orders";
    private static final long ORDER_TIMEOUT = 30 * 60 * 1000;  // 30 分钟

    /**
     * 创建订单
     */
    public Order createOrder(String userId, List&lt;OrderItem&gt; items) {
        Order order = new Order();
        order.setId(generateOrderId());
        order.setUserId(userId);
        order.setStatus(OrderStatus.PENDING_PAYMENT);
        order.setCreateTime(System.currentTimeMillis());

        // 保存订单
        saveOrder(order);

        // 添加延时任务（30分钟后自动取消）
        addCancelTask(order.getId(), ORDER_TIMEOUT);

        return order;
    }

    /**
     * 添加取消任务到延时队列
     */
    public void addCancelTask(String orderId, long delayMillis) {
        long executeTime = System.currentTimeMillis() + delayMillis;
        jedis.zadd(DELAY_QUEUE, executeTime, orderId);
    }

    /**
     * 支付订单
     */
    public void payOrder(String orderId) {
        // 更新订单状态
        updateOrderStatus(orderId, OrderStatus.PAID);

        // 从延时队列中移除（如果还没执行）
        removeCancelTask(orderId);
    }

    private void removeCancelTask(String orderId) {
        jedis.zrem(DELAY_QUEUE, orderId);
    }

    private void saveOrder(Order order) {
        String key = "order:" + order.getId();
        jedis.set(key, JSON.toJSONString(order));
    }

    private void updateOrderStatus(String orderId, OrderStatus status) {
        String key = "order:" + orderId;
        Order order = JSON.parseObject(jedis.get(key), Order.class);
        order.setStatus(status);
        jedis.set(key, JSON.toJSONString(order));
    }

    private String generateOrderId() {
        return "ORD" + System.currentTimeMillis() + UUID.randomUUID().toString().substring(0, 8);
    }
}
```

### 延时队列消费者

```java
@Service
public class OrderCancelConsumer {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String DELAY_QUEUE = "delay:queue:orders";

    /**
     * 启动消费者
     */
    @PostConstruct
    public void start() {
        Thread consumer = new Thread(this::consume);
        consumer.setDaemon(true);
        consumer.start();
    }

    /**
     * 消费循环
     */
    private void consume() {
        while (true) {
            try {
                // 获取到期订单
                String orderId = pollExpiredOrder();
                if (orderId != null) {
                    processOrderTimeout(orderId);
                } else {
                    Thread.sleep(500);
                }
            } catch (Exception e) {
                log.error("Consume error", e);
            }
        }
    }

    /**
     * 获取并删除到期的订单
     */
    private String pollExpiredOrder() {
        long now = System.currentTimeMillis();

        // 获取到期的订单
        Set&lt;String&gt; orders = jedis.zrangebyscore(
            DELAY_QUEUE, 0, now, 0, 1);

        if (orders.isEmpty()) {
            return null;
        }

        String orderId = orders.iterator().next();

        // 原子性删除
        Long removed = jedis.zrem(DELAY_QUEUE, orderId);
        if (removed != null && removed > 0) {
            return orderId;
        }

        return null;
    }

    /**
     * 处理订单超时
     */
    private void processOrderTimeout(String orderId) {
        String orderKey = "order:" + orderId;
        String orderJson = jedis.get(orderKey);

        if (orderJson == null) {
            return;
        }

        Order order = JSON.parseObject(orderJson, Order.class);

        // 只有待支付状态才取消
        if (order.getStatus() == OrderStatus.PENDING_PAYMENT) {
            order.setStatus(OrderStatus.CANCELLED);
            order.setCancelTime(System.currentTimeMillis());
            order.setCancelReason("Payment timeout");

            jedis.set(orderKey, JSON.toJSONString(order));

            // 恢复库存
            restoreStock(order);

            System.out.println("Order cancelled: " + orderId);
        }
    }

    private void restoreStock(Order order) {
        // 恢复商品库存
    }
}
```

## 多级延时队列

如果需要支持不同延时的任务，可以用多级队列：

```java
public class MultiLevelDelayQueue {
    private Jedis jedis = JedisPoolFactory.getJedis();

    // 一级队列：秒级精度
    private static final String QUEUE_1S = "delay:queue:1s";
    // 二级队列：分钟级精度
    private static final String QUEUE_1M = "delay:queue:1m";
    // 三级队列：小时级精度
    private static final String QUEUE_1H = "delay:queue:1h";

    /**
     * 添加任务（自动选择队列）
     */
    public void addTask(String taskId, long delayMillis) {
        if (delayMillis <= 60000) {
            // 1分钟内，放到秒级队列
            jedis.zadd(QUEUE_1S, System.currentTimeMillis() + delayMillis, taskId);
        } else if (delayMillis <= 3600000) {
            // 1小时内，放到分钟级队列
            jedis.zadd(QUEUE_1M, System.currentTimeMillis() + delayMillis, taskId);
        } else {
            // 1小时以上，放到小时级队列
            jedis.zadd(QUEUE_1H, System.currentTimeMillis() + delayMillis, taskId);
        }
    }

    /**
     * 消费任务
     */
    public String pollTask() {
        long now = System.currentTimeMillis();

        // 按优先级尝试获取
        for (String queue : Arrays.asList(QUEUE_1S, QUEUE_1M, QUEUE_1H)) {
            Set&lt;String&gt; tasks = jedis.zrangebyscore(queue, 0, now, 0, 1);
            if (!tasks.isEmpty()) {
                String taskId = tasks.iterator().next();
                if (jedis.zrem(queue, taskId) > 0) {
                    return taskId;
                }
            }
        }

        return null;
    }
}
```

## 可靠性保证

### 1. 任务确认机制

```java
public class ReliableDelayQueue {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 添加任务（带确认）
     */
    public void addTask(String taskId, long delayMillis) {
        // 添加任务
        jedis.zadd("delay:tasks", System.currentTimeMillis() + delayMillis, taskId);
        // 记录任务状态
        jedis.hset("task:status", taskId, "pending");
    }

    /**
     * 获取任务（带确认）
     */
    public String fetchTask() {
        Set&lt;String&gt; tasks = jedis.zrangebyscore(
            "delay:tasks", 0, System.currentTimeMillis(), 0, 1);

        if (tasks.isEmpty()) {
            return null;
        }

        String taskId = tasks.iterator().next();

        // 标记为处理中
        jedis.hset("task:status", taskId, "processing");

        return taskId;
    }

    /**
     * 完成任务
     */
    public void completeTask(String taskId) {
        jedis.hset("task:status", taskId, "completed");
        jedis.zrem("delay:tasks", taskId);
    }

    /**
     * 重试任务
     */
    public void retryTask(String taskId, long delayMillis) {
        // 重新添加到延时队列
        jedis.zadd("delay:tasks", System.currentTimeMillis() + delayMillis, taskId);
        jedis.hset("task:status", taskId, "pending");
    }
}
```

## 面试追问方向

1. **Redis 延时队列和 RabbitMQ 延时消息有什么区别？**

   RabbitMQ 通过插件或死信队列实现延时消息，功能更完善，支持消息持久化、事务等。Redis 延时队列实现简单，性能高，但可靠性不如 MQ，适合对可靠性要求不高的场景。

2. **如何保证延时任务不丢失？**

   - 任务执行前标记为"处理中"
   - 执行完成后删除任务
   - 定期扫描"处理中"状态的任务进行重试
   - 可以配合分布式锁确保任务不被重复执行

---

**核心记忆点**：Redis 延时队列利用 ZSet 的分数特性实现延时任务。通过 ZRANGEBYSCORE 获取到期任务，用 ZREM 删除已完成任务。实际应用中需要考虑可靠性（任务确认、重试机制）。
