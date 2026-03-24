# Redis 消息队列：轻量级队列实战

你可能用过 RabbitMQ、Kafka 这些专业的消息队列。

但如果你的业务规模不大，只是需要简单的消息队列功能，Redis 就能满足。

今天我们来聊聊 Redis 实现消息队列的几种方式。

## Redis 消息队列方案对比

| 方案 | 可靠性 | 功能 | 复杂度 | 适用场景 |
|------|--------|------|--------|---------|
| List | 低 | 基础 | 低 | 简单场景 |
| Pub/Sub | 低 | 广播 | 低 | 实时通知 |
| Stream | 高 | 完整 | 中 | 生产环境 |

## 方案一：List 实现队列

利用 List 的 LPUSH + BRPOP 实现队列。

### 生产者

```java
public class ListQueueProducer {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String QUEUE_KEY = "queue:orders";

    /**
     * 发送消息
     */
    public void sendMessage(String message) {
        // LPUSH 从左边入队
        jedis.lpush(QUEUE_KEY, message);
    }

    /**
     * 发送消息（带序列化）
     */
    public void sendOrder(Order order) {
        String json = JSON.toJSONString(order);
        jedis.lpush(QUEUE_KEY, json);
    }
}
```

### 消费者

```java
public class ListQueueConsumer {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String QUEUE_KEY = "queue:orders";

    /**
     * 消费消息（阻塞）
     */
    public String consume() {
        // BRPOP 阻塞等待，直到有消息或超时
        List&lt;String&gt; result = jedis.brpop(0, QUEUE_KEY);
        if (result != null && result.size() >= 2) {
            return result.get(1);
        }
        return null;
    }

    /**
     * 消费消息（带超时）
     */
    public String consumeWithTimeout(int timeoutSeconds) {
        List&lt;String&gt; result = jedis.brpop(timeoutSeconds, QUEUE_KEY);
        if (result != null && result.size() >= 2) {
            return result.get(1);
        }
        return null;
    }

    /**
     * 非阻塞消费
     */
    public String consumeNonBlocking() {
        // RPOP 从右边出队
        return jedis.rpop(QUEUE_KEY);
    }
}
```

### 完整示例

```java
public class OrderQueueService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String ORDER_QUEUE = "queue:orders";

    /**
     * 生产者：创建订单并发送消息
     */
    public void createOrder(Order order) {
        // 1. 保存订单
        String orderId = "ORD" + System.currentTimeMillis();
        order.setId(orderId);

        // 2. 发送到队列
        String message = JSON.toJSONString(order);
        jedis.lpush(ORDER_QUEUE, message);

        System.out.println("Order sent to queue: " + orderId);
    }

    /**
     * 消费者：处理订单
     */
    public void startConsumer() {
        while (true) {
            try {
                // 阻塞获取消息
                List&lt;String&gt; result = jedis.brpop(0, ORDER_QUEUE);
                if (result != null && result.size() >= 2) {
                    String message = result.get(1);
                    Order order = JSON.parseObject(message, Order.class);

                    // 处理订单
                    processOrder(order);
                }
            } catch (Exception e) {
                System.err.println("Error processing order: " + e.getMessage());
                // 简单重试
                try {
                    Thread.sleep(1000);
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }
    }

    private void processOrder(Order order) {
        System.out.println("Processing order: " + order.getId());
        // 实际处理逻辑：扣库存、发通知等
    }
}
```

## 方案二：Pub/Sub 发布订阅

Pub/Sub 是广播模式，一个消息可以被多个消费者接收。

### 消息发布

```java
public class PubSubDemo {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 发布消息到频道
     */
    public void publish(String channel, String message) {
        // PUBLISH 返回订阅者数量
        Long subscribers = jedis.publish(channel, message);
        System.out.println("Message sent to " + subscribers + " subscribers");
    }

    /**
     * 发布订单消息
     */
    public void publishOrderEvent(OrderEvent event) {
        String channel = getChannelByEventType(event.getType());
        String message = JSON.toJSONString(event);
        jedis.publish(channel, message);
    }

    private String getChannelByEventType(String eventType) {
        switch (eventType) {
            case "created":
                return "order:created";
            case "paid":
                return "order:paid";
            case "cancelled":
                return "order:cancelled";
            default:
                return "order:general";
        }
    }
}
```

### 消息订阅

```java
public class SubscribeDemo {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 订阅单个频道
     */
    public void subscribe(String channel) {
        // Subscribe 是阻塞的，通常在新线程中执行
        new Thread(() -> {
            Jedis subscriber = JedisPoolFactory.getJedis();
            subscriber.subscribe(new JedisPubSub() {
                @Override
                public void onMessage(String channel, String message) {
                    System.out.println("Received from " + channel + ": " + message);
                    // 处理消息
                }
            }, channel);
        }).start();
    }

    /**
     * 订阅多个频道
     */
    public void subscribeMultiple(String... channels) {
        new Thread(() -> {
            Jedis subscriber = JedisPoolFactory.getJedis();
            subscriber.subscribe(new JedisPubSub() {
                @Override
                public void onMessage(String channel, String message) {
                    System.out.println("Received from " + channel + ": " + message);
                }
            }, channels);
        }).start();
    }

    /**
     * 使用模式订阅
     */
    public void subscribePattern(String pattern) {
        new Thread(() -> {
            Jedis subscriber = JedisPoolFactory.getJedis();
            subscriber.psubscribe(new JedisPubSub() {
                @Override
                public void onPMessage(String pattern, String channel, String message) {
                    System.out.println("Pattern " + pattern +
                        ", channel " + channel + ": " + message);
                }
            }, pattern);
        }).start();
    }
}
```

### 完整示例：订单事件通知

```java
public class OrderEventService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 发布订单创建事件
     */
    public void onOrderCreated(Order order) {
        OrderEvent event = new OrderEvent("order:created", order);
        jedis.publish("order:created", JSON.toJSONString(event));

        // 同时更新统计
        jedis.incr("stats:orders:created");
    }

    /**
     * 发布订单支付事件
     */
    public void onOrderPaid(Order order) {
        OrderEvent event = new OrderEvent("order:paid", order);
        jedis.publish("order:paid", JSON.toJSONString(event));

        // 更新统计
        jedis.incr("stats:orders:paid");
        // 通知库存服务
        jedis.publish("inventory:notify", order.getId());
    }

    /**
     * 发布订单取消事件
     */
    public void onOrderCancelled(Order order, String reason) {
        OrderEvent event = new OrderEvent("order:cancelled", order);
        event.setReason(reason);
        jedis.publish("order:cancelled", JSON.toJSONString(event));
    }
}

/**
 * 订单事件订阅者
 */
public class OrderEventSubscribers {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 启动所有订阅者
     */
    public void startAll() {
        // 通知服务
        startNotificationSubscriber();
        // 统计服务
        startStatsSubscriber();
        // 库存服务
        startInventorySubscriber();
    }

    private void startNotificationSubscriber() {
        new Thread(() -> {
            jedis.subscribe(new JedisPubSub() {
                @Override
                public void onMessage(String channel, String message) {
                    OrderEvent event = JSON.parseObject(message, OrderEvent.class);
                    sendNotification(event);
                }
            }, "order:created", "order:paid", "order:cancelled");
        }).start();
    }

    private void sendNotification(OrderEvent event) {
        // 发送通知
        System.out.println("Sending notification for " + event.getType());
    }

    private void startStatsSubscriber() {
        // 统计逻辑
    }

    private void startInventorySubscriber() {
        jedis.psubscribe(new JedisPubSub() {
            @Override
            public void onPMessage(String pattern, String channel, String message) {
                System.out.println("Inventory update from " + channel);
            }
        }, "order:*");
    }
}
```

## 方案三：Stream（推荐）

Stream 是 Redis 5.0 引入的数据结构，功能最完整，推荐用于生产环境。

### 生产者

```java
public class StreamProducer {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String STREAM_KEY = "stream:orders";

    /**
     * 发送消息
     */
    public String sendMessage(Map&lt;String, String&gt; fields) {
        // XADD 自动生成消息 ID
        return jedis.xadd(STREAM_KEY, StreamEntryID.NEW_ENTRY, fields);
    }

    /**
     * 发送订单消息
     */
    public String sendOrder(Order order) {
        Map&lt;String, String&gt; fields = new HashMap&lt;&gt;();
        fields.put("orderId", order.getId());
        fields.put("userId", order.getUserId());
        fields.put("amount", String.valueOf(order.getAmount()));
        fields.put("status", order.getStatus());
        fields.put("timestamp", String.valueOf(System.currentTimeMillis()));

        return jedis.xadd(STREAM_KEY, StreamEntryID.NEW_ENTRY, fields);
    }

    /**
     * 发送消息（带最大长度）
     */
    public String sendWithMaxLen(Map&lt;String, String&gt; fields, int maxLen) {
        // 限制 Stream 长度，删除旧消息
        return jedis.xadd(STREAM_KEY,
            new XAddParams().maxLen(maxLen).近似模式(),
            StreamEntryID.NEW_ENTRY, fields);
    }
}
```

### 消费者

```java
public class StreamConsumer {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String STREAM_KEY = "stream:orders";
    private static final String GROUP = "order-processors";
    private static final String CONSUMER = "consumer-1";

    /**
     * 创建消费者组
     */
    public void createGroup() {
        try {
            // 从 Stream 开头开始消费
            jedis.xgroupCreate(STREAM_KEY, GROUP, StreamEntryID.LAST_ENTRY);
        } catch (JedisDataException e) {
            // 组已存在，忽略
            if (!e.getMessage().contains("BUSYGROUP")) {
                throw e;
            }
        }
    }

    /**
     * 消费消息（拉取）
     */
    public List&lt;Map&lt;String, String&gt;&gt; consume() {
        // XREADGROUP 从组中读取未处理的消息
        List&lt;Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt;&gt; result =
            jedis.xreadGroup(
                Consumer.from(GROUP, CONSUMER),
                new XReadGroupParams().count(10).block(1000),
                StreamOffset.create(STREAM_KEY, ReadOffset.last()));

        if (result == null || result.isEmpty()) {
            return Collections.emptyList();
        }

        List&lt;Map&lt;String, String&gt;&gt; messages = new ArrayList&lt;&gt;();

        for (Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt; streamData : result) {
            for (Map&lt;String, String&gt; fields : streamData.values()) {
                messages.add(fields);
            }
        }

        return messages;
    }

    /**
     * 手动确认消息
     */
    public void ack(String messageId) {
        jedis.xack(STREAM_KEY, GROUP, messageId);
    }

    /**
     * 完整消费流程
     */
    public void consumeLoop() {
        createGroup();

        while (true) {
            try {
                // 读取消息
                List&lt;Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt;&gt; streams =
                    jedis.xreadGroup(
                        Consumer.from(GROUP, CONSUMER),
                        new XReadGroupParams().count(10).block(2000),
                        StreamOffset.create(STREAM_KEY, ReadOffset.last()));

                if (streams == null || streams.isEmpty()) {
                    continue;
                }

                for (Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt; streamData : streams) {
                    for (Map&lt;String, String&gt; entry : streamData.values()) {
                        String messageId = entry.get("messageId");
                        Map&lt;String, String&gt; fields = new HashMap&lt;&gt;(entry);
                        fields.remove("messageId");

                        // 处理消息
                        processMessage(fields);

                        // 确认消息
                        ack(messageId);
                    }
                }
            } catch (Exception e) {
                System.err.println("Error: " + e.getMessage());
            }
        }
    }

    private void processMessage(Map&lt;String, String&gt; message) {
        System.out.println("Processing: " + message);
    }
}
```

### 完整示例：订单处理系统

```java
public class OrderProcessingSystem {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String STREAM_KEY = "stream:orders";
    private static final String GROUP = "processors";

    /**
     * 创建订单
     */
    public String createOrder(String userId, BigDecimal amount) {
        String orderId = "ORD" + System.currentTimeMillis();

        Map&lt;String, String&gt; order = new HashMap&lt;&gt;();
        order.put("orderId", orderId);
        order.put("userId", userId);
        order.put("amount", amount.toString());
        order.put("status", "pending");
        order.put("createdAt", String.valueOf(System.currentTimeMillis()));

        return jedis.xadd(STREAM_KEY, StreamEntryID.NEW_ENTRY, order);
    }

    /**
     * 订单处理服务
     */
    public void startProcessingService(String consumerName) {
        // 确保消费者组存在
        ensureGroup();

        while (true) {
            // 读取消息
            List&lt;Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt;&gt; results =
                jedis.xreadGroup(
                    Consumer.from(GROUP, consumerName),
                    new XReadGroupParams().count(1).block(1000),
                    StreamOffset.create(STREAM_KEY, ReadOffset.last()));

            if (results == null) continue;

            for (Map&lt;String, List&lt;Map&lt;String, String&gt;&gt;&gt; stream : results) {
                for (Map&lt;String, String&gt; message : stream.values()) {
                    try {
                        processOrder(message);
                        // 确认处理成功
                        jedis.xack(STREAM_KEY, GROUP, message.get("messageId"));
                    } catch (Exception e) {
                        // 处理失败，可以重试或记录死信
                        handleFailure(message, e);
                    }
                }
            }
        }
    }

    private void processOrder(Map&lt;String, String&gt; message) {
        String orderId = message.get("orderId");
        System.out.println("Processing order: " + orderId);

        // 1. 验证订单
        // 2. 扣减库存
        // 3. 发送通知
        // ...

        System.out.println("Order processed: " + orderId);
    }

    private void handleFailure(Map&lt;String, String&gt; message, Exception e) {
        // 记录失败日志
        System.err.println("Failed to process: " + message + ", error: " + e.getMessage());
    }

    private void ensureGroup() {
        try {
            jedis.xgroupCreate(STREAM_KEY, GROUP, StreamEntryID.LAST_ENTRY);
        } catch (JedisDataException e) {
            // 组已存在
        }
    }
}
```

## 方案对比与选择

```
简单队列（List）：
✓ 实现简单
✓ 性能高
✗ 不支持消息确认
✗ 不支持消息重试
→ 适用于内部工具、一次性任务

发布订阅（Pub/Sub）：
✓ 支持广播
✓ 实现简单
✗ 不支持消息持久化
✗ 消费者下线会丢失消息
→ 适用于实时通知、系统间消息

Stream：
✓ 支持消息持久化
✓ 支持消息确认
✓ 支持消费者组
✓ 支持消息回溯
✗ 实现复杂度稍高
→ 适用于生产环境
```

## 面试追问方向

1. **Redis 消息队列和 RabbitMQ 有什么区别？**

   RabbitMQ 是专业的消息中间件，功能更完善（事务、延迟消息、死信队列等），可靠性更高。Redis 消息队列适合轻量级场景，简单但可靠性不如 RabbitMQ。

2. **Stream 的消费者组有什么用？**

   消费者组允许多个消费者分担消息处理，每个消息只被组内一个消费者处理。类似于 Kafka 的 Consumer Group，实现负载均衡和消息分发。

---

**核心记忆点**：Redis 提供了三种消息队列实现方式。List 实现最简单但可靠性低；Pub/Sub 支持广播但消息不持久化；Stream（推荐）功能最完整，支持消息确认、消费者组、消息回溯，适合生产环境使用。
