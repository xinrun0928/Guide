# 设计延迟消息队列

你有没有想过：

- 淘宝订单超时未支付，为什么会自动关闭？
- 美团外卖超时未接单，为什么会通知商家？
- 12306 抢票为什么能在 30 分钟内不付款就自动释放座位？

这些功能的背后，都是**延迟消息队列**在默默工作。

今天，我们来深入探讨如何设计一个延迟消息队列系统。

---

## 一、为什么需要延迟消息队列？

### 1.1 常见场景

```
┌─────────────────────────────────────────────────────────┐
│                   延迟消息的典型场景                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 订单超时处理                                        │
│     订单创建 → 30分钟后检查是否支付 → 未支付则关闭订单   │
│                                                         │
│  2. 消息重试                                            │
│     消息处理失败 → 延迟 N 秒后重试 → 最多重试 3 次     │
│                                                         │
│  3. 任务调度                                            │
│     预约下单 → 指定时间发送通知 → 用户收到提醒         │
│                                                         │
│  4. 限流降级                                            │
│     请求被限流 → 延迟处理 → 逐步放行请求               │
│                                                         │
│  5. 缓存预热                                            │
│     凌晨 2 点 → 预加载热点数据 → 早上高峰前完成       │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 实现方案的对比

```
方案一：定时轮询（不推荐）
- 定时扫描数据库，检查是否有超时订单
- 问题：数据库压力大，延迟不精确

方案二：JDK ScheduledExecutorService（不推荐）
- 单机可用，集群环境有问题
- 问题：任务分散在多台机器，不好管理

方案三：时间轮算法（推荐）
- 高效、精确、支持批量处理
- 问题：实现复杂，需要持久化支持

方案四：Redis ZSet（简单场景推荐）
- 利用 ZSet 的分数实现延迟队列
- 问题：不支持消息持久化，重启会丢失

方案五：RabbitMQ/RocketMQ 延迟插件（生产环境推荐）
- 消息队列原生支持
- 问题：延迟时间有限制（RabbitMQ 插件最大 2^32 毫秒）
```

---

## 二、核心数据结构：时间轮

### 2.1 时间轮原理

时间轮（TimeWheel）是一种高效的处理定时任务的数据结构，类似于时钟的转动。

```java
/**
 * 时间轮算法原理
 */
public class TimeWheelDemo {
    
    /**
     * 时间轮结构
     * 
     * 想象一个有 60 个格子的时钟，每秒转动一格：
     * 
     * 0  1  2  3  4  5  ...  58  59
     * |  |  |  |  |  |         |    |
     * +--+--+--+--+--+---------+----+
     *       ↑
     *       当前秒针指向 2
     * 
     * 每一格代表一个时间槽（slot），每秒移动一格
     * 任务可以注册到某个槽中，到达该槽时执行
     */
    public static class TimeWheel {
        
        // 时间轮槽数
        private final int wheelSize;
        
        // 每格代表的时间单位（毫秒）
        private final long tickDuration;
        
        // 时间轮的槽，每格一个链表
        private final List<TaskList> slots;
        
        // 当前指针位置
        private int currentSlot = 0;
        
        // 上一级时间轮（用于实现多层时间轮）
        private final TimeWheel overflowWheel;
        
        /**
         * 推进时间轮
         * 
         * 每 tickDuration 毫秒调用一次
         * 将当前槽的任务取出执行
         */
        public void advance() {
            // 1. 移动指针
            currentSlot = (currentSlot + 1) % wheelSize;
            
            // 2. 获取该槽的任务
            TaskList tasks = slots.get(currentSlot);
            
            // 3. 执行任务
            tasks.executeAll();
        }
        
        /**
         * 添加定时任务
         * 
         * @param delay 延迟时间（毫秒）
         */
        public boolean addTask(Runnable task, long delay) {
            // 计算任务应该放在哪个槽
            int slotIndex = (currentSlot + (int) (delay / tickDuration)) % wheelSize;
            
            // 如果延迟超过当前时间轮的容量，需要放到上级时间轮
            if (delay >= wheelSize * tickDuration && overflowWheel != null) {
                return overflowWheel.addTask(task, delay);
            }
            
            // 添加到对应槽
            slots.get(slotIndex).add(task);
            return true;
        }
    }
}
```

### 2.2 多层时间轮

单层时间轮有容量限制，为了支持更长的延迟，需要多层时间轮。

```java
/**
 * 多层时间轮
 */
public class MultiLevelTimeWheel {
    
    /**
     * 四层时间轮设计（类似 Redis 的实现）
     * 
     * 时间轮 1：秒级精度，60 个槽
     * 时间轮 2：分钟级精度，60 个槽
     * 时间轮 3：小时级精度，24 个槽
     * 时间轮 4：天级精度，30 个槽
     * 
     * 组合效果：
     * - 最小延迟：1 秒
     * - 最大延迟：60 × 60 × 24 × 30 = 2,592,000 秒 ≈ 30 天
     */
    public static class HashedWheelTimeWheel {
        
        // 第一层：秒级（0~59 秒）
        private final TimeWheel secondWheel;
        
        // 第二层：分钟级（0~59 分）
        private final TimeWheel minuteWheel;
        
        // 第三层：小时级（0~23 小时）
        private final TimeWheel hourWheel;
        
        // 第四层：天级（0~29 天）
        private final TimeWheel dayWheel;
        
        public HashedWheelTimeWheel() {
            // 第一层：每格 1 秒，共 60 格
            secondWheel = new TimeWheel(60, 1000);
            
            // 第二层：每格 1 分钟，共 60 格
            // 当第一层转满时，推动第二层
            minuteWheel = new TimeWheel(60, 60000, secondWheel);
            
            // 第三层：每格 1 小时，共 24 格
            hourWheel = new TimeWheel(24, 3600000, minuteWheel);
            
            // 第四层：每格 1 天，共 30 格
            dayWheel = new TimeWheel(30, 86400000, hourWheel);
        }
        
        /**
         * 添加延迟任务
         */
        public boolean addDelayTask(DelayTask task, long delayMs) {
            return secondWheel.addTask(task, delayMs);
        }
        
        /**
         * 时间轮推进（定时器线程调用）
         */
        public void advance() {
            secondWheel.advance();
        }
    }
}
```

---

## 三、Redis ZSet 实现延迟队列

对于简单的延迟队列场景，可以直接使用 Redis ZSet 实现。

```java
/**
 * 基于 Redis ZSet 的延迟队列
 */
public class RedisDelayQueue {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 延迟队列 Key
     */
    private static final String DELAY_QUEUE_KEY = "delay:queue:";
    
    /**
     * 添加延迟消息
     * 
     * @param messageId 消息 ID
     * @param delay 延迟时间（毫秒）
     * @param payload 消息内容
     */
    public void addDelayMessage(String messageId, long delay, String payload) {
        // 计算执行时间
        long executeTime = System.currentTimeMillis() + delay;
        
        // 添加到 ZSet，分数为执行时间戳
        String key = DELAY_QUEUE_KEY + messageId;
        redis.opsForZSet().add(key, payload, executeTime);
    }
    
    /**
     * 获取可执行的消息
     * 
     * @param batchSize 批量获取数量
     * @return 可执行的消息列表
     */
    public List<DelayMessage> pollExecutableMessages(int batchSize) {
        long now = System.currentTimeMillis();
        
        // 获取分数（执行时间）小于等于当前时间的所有消息
        Set<String> messages = redis.opsForZSet()
            .rangeByScore(DELAY_QUEUE_KEY, 0, now, 0, batchSize);
        
        List<DelayMessage> result = new ArrayList<>();
        
        for (String message : messages) {
            // 使用 Lua 脚本原子性删除，防止重复消费
            Long removed = redis.execute(
                new DefaultRedisScript<Long>(
                    "if redis.call('ZSCORE', KEYS[1], ARGV[1]) then " +
                    "return redis.call('ZREM', KEYS[1], ARGV[1]) " +
                    "else return 0 end",
                    Long.class
                ),
                Collections.singletonList(DELAY_QUEUE_KEY),
                message
            );
            
            if (removed != null && removed > 0) {
                result.add(parseMessage(message));
            }
        }
        
        return result;
    }
    
    /**
     * 轮询任务（需要后台线程执行）
     */
    public void startPolling() {
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        
        // 每 100 毫秒轮询一次
        scheduler.scheduleAtFixedRate(() -> {
            List<DelayMessage> messages = pollExecutableMessages(100);
            for (DelayMessage message : messages) {
                processMessage(message);
            }
        }, 0, 100, TimeUnit.MILLISECONDS);
    }
}
```

---

## 四、生产级延迟队列设计

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                   延迟队列整体架构                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────┐                                       │
│  │  生产者     │                                       │
│  └──────┬───────┘                                       │
│         │                                               │
│         ▼                                               │
│  ┌──────────────┐     ┌──────────────┐                 │
│  │  消息存储     │────▶│  延迟处理    │                 │
│  │  (MySQL)     │     │  (时间轮)    │                 │
│  └──────────────┘     └──────┬───────┘                 │
│                               │                         │
│                               ▼                         │
│                        ┌──────────────┐                 │
│                        │  消息投递    │                 │
│                        │  (MQ)       │                 │
│                        └──────┬───────┘                 │
│                               │                         │
│                               ▼                         │
│                        ┌──────────────┐                 │
│                        │  消费者     │                 │
│                        └──────────────┘                 │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.2 消息持久化

```java
/**
 * 延迟消息的数据库存储
 */
public class DelayMessagePersistence {
    
    /**
     * 延迟消息表
     */
    public static final String CREATE_TABLE = """
        CREATE TABLE delay_messages (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            message_id VARCHAR(64) NOT NULL UNIQUE,
            topic VARCHAR(128) NOT NULL,
            payload TEXT NOT NULL,
            execute_time BIGINT NOT NULL,
            status TINYINT DEFAULT 0 COMMENT '0-待执行 1-已投递 2-已消费',
            retry_count INT DEFAULT 0,
            max_retry INT DEFAULT 3,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            
            INDEX idx_execute_time_status (execute_time, status),
            INDEX idx_message_id (message_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """;
    
    /**
     * 消息状态枚举
     */
    public static class MessageStatus {
        public static final int PENDING = 0;   // 待执行
        public static final int DELIVERED = 1; // 已投递
        public static final int CONSUMED = 2;  // 已消费
    }
}
```

### 4.3 延迟消息投递器

```java
/**
 * 延迟消息投递器
 */
public class DelayMessageDispatcher {
    
    private ExecutorService executor;
    private DelayMessageRepository repository;
    private MessageQueue mq;
    
    /**
     * 启动投递器
     */
    public void start() {
        // 每秒扫描一次待执行的消息
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        
        scheduler.scheduleAtFixedRate(() -> {
            try {
                dispatchDelayMessages();
            } catch (Exception e) {
                log.error("Dispatch delay message error", e);
            }
        }, 0, 1, TimeUnit.SECONDS);
    }
    
    /**
     * 分发音延迟消息
     */
    private void dispatchDelayMessages() {
        long now = System.currentTimeMillis();
        
        // 1. 查询待执行且到期的消息
        List<DelayMessage> messages = repository.findExecutableMessages(now, 100);
        
        for (DelayMessage message : messages) {
            executor.submit(() -> {
                try {
                    // 2. 投递到消息队列
                    mq.send(message.getTopic(), message.getPayload());
                    
                    // 3. 更新状态为已投递
                    repository.updateStatus(message.getMessageId(), 
                        MessageStatus.DELIVERED);
                    
                } catch (Exception e) {
                    // 投递失败，标记重试
                    handleDeliveryFailure(message, e);
                }
            });
        }
    }
    
    /**
     * 处理投递失败
     */
    private void handleDeliveryFailure(DelayMessage message, Exception e) {
        int retryCount = message.getRetryCount() + 1;
        
        if (retryCount >= message.getMaxRetry()) {
            // 超过最大重试次数，标记失败
            log.error("Delay message delivery failed permanently: {}", message.getMessageId());
            repository.updateStatus(message.getMessageId(), MessageStatus.FAILED);
        } else {
            // 计算下次执行时间（指数退避）
            long nextDelay = calculateNextDelay(retryCount);
            long nextExecuteTime = System.currentTimeMillis() + nextDelay;
            
            repository.updateForRetry(message.getMessageId(), 
                nextExecuteTime, retryCount);
        }
    }
    
    /**
     * 计算下次重试延迟（指数退避）
     */
    private long calculateNextDelay(int retryCount) {
        // 1s, 2s, 4s, 8s, 16s ...
        return (long) Math.pow(2, retryCount - 1) * 1000;
    }
}
```

---

## 五、面试追问方向

### 问题一：「RocketMQ 如何实现延迟消息？」

**回答思路**：

```
RocketMQ 的延迟消息实现：

1. 消息不直接发送到消费者，而是发送到延迟队列
2. Broker 根据延迟级别，将消息投递到不同的 Level Queue
3. 定时任务检查消息是否到期，到期后投递到真实 Topic
4. 消费者从真实 Topic 消费

RocketMQ 支持的延迟级别：
- 1s, 5s, 10s, 30s, 1m, 2m, 3m, 4m, 5m, 6m, 7m, 8m, 9m, 10m, 
  20m, 30m, 1h, 2h
```

### 问题二：「如何保证消息不丢失？」

**回答思路**：

```
延迟消息丢失的场景：
1. 消息存储到数据库后，应用重启
2. 消息正在处理时，进程崩溃
3. 消息已投递到 MQ，但消费失败

保证不丢失的方案：
1. 消息持久化到数据库
2. 状态管理：待执行 → 已投递 → 已消费
3. 投递前更新状态
4. 消费者 ACK 确认
5. 定时补偿任务
```

### 问题三：「如何实现定时任务的精确触发？」

**回答思路**：

```
精确触发的挑战：
1. 定时任务本身有误差
2. 系统负载可能导致延迟
3. 多实例部署需要协调

解决方案：
1. 时间轮算法：精确到毫秒
2. 提前拉取 + 延迟执行
3. 分布式锁协调（防止重复执行）
4. 定时补偿机制
```

---

## 六、总结

```
┌─────────────────────────────────────────────────────────┐
│                延迟消息队列设计要点                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  核心算法                                              │
│  ├── 时间轮（TimeWheel）：高效定时任务处理              │
│  ├── 多层时间轮：支持更长的延迟                        │
│  └── Redis ZSet：简单场景实现                          │
│                                                         │
│  工程实现                                              │
│  ├── 消息持久化：防止消息丢失                         │
│  ├── 状态管理：跟踪消息生命周期                        │
│  ├── 重试机制：指数退避 + 最大重试                    │
│  └── 补偿任务：处理异常情况                            │
│                                                         │
│  选型建议                                              │
│  ├── 简单场景：Redis ZSet                            │
│  ├── 生产环境：RocketMQ 延迟消息                       │
│  ├── 自研系统：基于时间轮实现                         │
│  └── 强一致性：使用数据库 + 定时任务                    │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "延迟队列的本质是：在正确的时间，做正确的事。时间轮是实现它的艺术。"
