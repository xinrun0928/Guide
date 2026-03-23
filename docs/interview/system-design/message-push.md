# 消息推送系统设计

---

## 场景切入：为什么微信消息「秒到」？

你给朋友发了条微信，他手机「叮」一声，立刻收到了。

这个「叮」的背后，经历了什么？

从你的手机 → 微信服务器 → 朋友手机，全程不到 100ms。

这就是**消息推送系统**——把消息从服务器「推」到用户设备，而不是让用户去「拉」。

今天，我们来聊聊如何设计一个消息推送系统。

---

## 需求分析：消息推送有哪些类型？

| 类型 | 特点 | 例子 |
|---|---|---|
| 在线推送 | 用户在线，消息实时送达 | 微信消息 |
| 离线推送 | 用户不在线，消息暂存，上线后送达 | iOS APNs |
| 系统通知 | 运营类消息，可关闭 | 推送通知 |
| 透传消息 | 不弹通知，应用自行处理 | 地图导航更新 |

**核心挑战**：

1. **实时性**：消息要快，越快越好
2. **可靠性**：消息不能丢，不能重复
3. **海量连接**：百万级设备同时在线
4. **省电省流量**：不能让用户手机变成暖手宝

---

## 容量估算

假设设计一个千万日活的消息推送系统：

| 指标 | 数值 |
|---|---|
| 日活用户 | 1000 万 |
| 同时在线 | 500 万 |
| 消息发送 QPS | 10 万/秒 |
| 推送延迟要求 | <500ms |
| 设备存储 | 离线消息缓存 |

---

## 核心设计：整体架构

```
                    ┌─────────────────────────────────────┐
                    │           消息推送系统                │
                    └─────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────┐               ┌───────────────┐               ┌───────────────┐
│  消息接入层    │               │   消息路由层   │               │   设备连接层   │
│ (API Gateway) │               │   (Router)    │               │  (Conn Svcs)  │
└───────────────┘               └───────────────┘               └───────────────┘
        │                                 │                                 │
        ▼                                 ▼                                 ▼
┌───────────────┐               ┌───────────────┐               ┌───────────────┐
│   消息队列     │               │   消息存储     │               │   长连接池     │
│ (Kafka/MQ)   │               │  (Redis/DB)   │               │  (Netty)     │
└───────────────┘               └───────────────┘               └───────────────┘
```

---

## 核心设计：长连接管理

### 为什么用长连接？

| 方式 | 推送延迟 | 省电 | 实现复杂度 |
|---|---|---|---|
| 轮询（客户端定期拉取） | 高（取决于轮询间隔） | 差（始终唤醒 CPU） | 低 |
| 长连接（服务端推送） | 低（毫秒级） | 好（按需唤醒） | 高 |

**长连接的本质**：客户端和服务器保持 TCP 连接，服务器有消息时直接通过这条连接发送。

```java
public class PushServer {

    private final EventLoopGroup bossGroup = new NioEventLoopGroup();
    private final EventLoopGroup workerGroup = new NioEventLoopGroup();

    /**
     * 启动 Netty 服务器
     * 核心思想：单连接、多路复用——一个连接承载多个设备的消息
     */
    public void start(int port) {
        ServerBootstrap bootstrap = new ServerBootstrap();
        bootstrap.group(bossGroup, workerGroup)
            .channel(NioServerSocketChannel.class)
            .childHandler(new ChannelInitializer&lt;SocketChannel&gt;() {
                @Override
                protected void initChannel(SocketChannel ch) {
                    ch.pipeline().addLast(
                        new IdleStateHandler(60, 0, 0), // 60 秒没收到心跳就断开
                        new PushDecoder(),              // 自定义协议解码
                        new PushHandler()               // 业务处理
                    );
                }
            });

        bootstrap.bind(port).sync();
    }
}

/**
 * 推送消息处理器
 */
public class PushHandler extends ChannelInboundHandlerAdapter {

    private final ConcurrentHashMap&lt;String, Channel&gt; channelMap = new ConcurrentHashMap&lt;&gt;();

    @Override
    public void channelActive(ChannelHandlerContext ctx) {
        // 客户端连接时，解析设备 ID，建立映射关系
        String deviceId = parseDeviceId(ctx.channel());
        channelMap.put(deviceId, ctx.channel());
        log.info("设备连接: {}, 当前在线: {} 台", deviceId, channelMap.size());
    }

    @Override
    public void channelInactive(ChannelHandlerContext ctx) {
        // 客户端断开时，清理映射
        String deviceId = parseDeviceId(ctx.channel());
        channelMap.remove(deviceId);
        log.info("设备断开: {}, 当前在线: {} 台", deviceId, channelMap.size());
    }

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) {
        // 处理心跳、ack 等消息
        if (msg instanceof Heartbeat) {
            ctx.writeAndFlush(Heartbeat.ACK);
        } else if (msg instanceof MessageAck) {
            // 处理消息送达确认
            handleAck((MessageAck) msg);
        }
    }

    /**
     * 向指定设备推送消息
     */
    public void pushToDevice(String deviceId, PushMessage message) {
        Channel channel = channelMap.get(deviceId);
        if (channel != null &amp;&amp; channel.isActive()) {
            channel.writeAndFlush(message);
        } else {
            // 设备不在线，消息暂存离线库
            storeOffline(deviceId, message);
        }
    }
}
```

---

## 核心设计：消息路由

消息路由解决「消息发给谁」的问题。

```java
public class MessageRouter {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final PushServer pushServer;

    /**
     * 根据用户 ID 路由消息
     * 核心思想：用户可能多端登录，需要广播到所有设备
     */
    public void routeMessage(Long userId, PushMessage message) {
        // 1. 获取用户的所有在线设备
        Set&lt;String&gt; deviceIds = getUserDevices(userId);

        if (deviceIds.isEmpty()) {
            // 没有在线设备，存入离线库
            storeOffline(userId, message);
            return;
        }

        // 2. 向所有设备推送
        for (String deviceId : deviceIds) {
            pushServer.pushToDevice(deviceId, message);
        }

        // 3. 记录消息轨迹
        logMessageDelivery(userId, message, deviceIds.size());
    }

    /**
     * 获取用户的所有在线设备
     * 使用 Redis Set 存储：user:123:devices -> {device1, device2, device3}
     */
    private Set&lt;String&gt; getUserDevices(Long userId) {
        String key = "user:" + userId + ":devices";
        return redisTemplate.opsForSet().members(key);
    }
}
```

---

## 核心设计：消息可靠性

### 问题一：消息不能丢

消息从服务器到设备，中间可能经历网络波动。怎么保证不丢？

**方案：确认机制（ACK）**

```java
public class ReliablePush {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4);

    /**
     * 可靠推送流程
     * 1. 发送消息，等待 ACK
     * 2. 超时未 ACK，重试
     * 3. 重试 N 次后放弃，告警
     */
    public void sendReliable(String deviceId, PushMessage message) {
        // 1. 生成消息 ID（用于去重和 ACK）
        String messageId = UUID.randomUUID().toString();
        message.setMessageId(messageId);

        // 2. 发送消息
        pushServer.pushToDevice(deviceId, message);

        // 3. 开启重试定时器
        RetryTask task = new RetryTask(deviceId, message, 0);
        scheduler.schedule(task, 5, TimeUnit.SECONDS); // 5 秒后检查 ACK

        // 4. 记录发送状态
        redisTemplate.opsForHash().put("msg:pending", messageId,
            new PendingMessage(deviceId, message, System.currentTimeMillis()));
    }

    /**
     * 处理送达确认
     */
    public void handleAck(String messageId) {
        // 收到 ACK，从 pending 列表删除
        redisTemplate.opsForHash().delete("msg:pending", messageId);
    }

    /**
     * 重试任务
     */
    class RetryTask implements Runnable {
        private final String deviceId;
        private final PushMessage message;
        private final int retryCount;

        @Override
        public void run() {
            // 1. 检查是否已收到 ACK
            if (!redisTemplate.opsForHash().hasKey("msg:pending", message.getMessageId())) {
                return; // 已被 ACK，不再重试
            }

            // 2. 检查重试次数
            if (retryCount &gt;= 3) {
                log.warn("消息 {} 重试 3 次仍未送达，放弃", message.getMessageId());
                redisTemplate.opsForHash().delete("msg:pending", message.getMessageId());
                alert("消息送达失败: " + deviceId);
                return;
            }

            // 3. 重新发送
            pushServer.pushToDevice(deviceId, message);

            // 4. 继续重试
            scheduler.schedule(new RetryTask(deviceId, message, retryCount + 1),
                5 * (retryCount + 1), TimeUnit.SECONDS);
        }
    }
}
```

### 问题二：消息不能重复

网络波动可能导致消息发送两次。怎么去重？

```java
public class MessageDeduplicator {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 消息去重
     * 使用 Redis SETNX，相同的消息 ID 只处理一次
     * 为什么用 SETNX？因为它是原子操作，不会出现并发问题
     */
    public boolean tryAcquire(String messageId) {
        String key = "msg:dedup:" + messageId;
        Boolean success = redisTemplate.opsForValue().setIfAbsent(key, "1");
        if (Boolean.TRUE.equals(success)) {
            // 成功获取锁，设置过期时间（避免内存泄漏）
            redisTemplate.expire(key, Duration.ofDays(7));
            return true;
        }
        return false; // 已处理过
    }
}
```

---

## 核心设计：离线消息

用户不在线时，消息怎么存？

```java
public class OfflineMessageStore {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final MyBatisMapper&lt;OfflineMessage&gt; mapper;

    /**
     * 存储离线消息
     * 策略：Redis 存最近 100 条，MySQL 存完整历史
     * 为什么分层？因为 Redis 读写快，适合实时查询；MySQL 适合持久化
     */
    public void storeOffline(Long userId, PushMessage message) {
        String redisKey = "offline:" + userId;

        // 1. 存入 Redis List（最多存 100 条）
        redisTemplate.opsForList().leftPush(redisKey, message);
        redisTemplate.opsForList().trim(redisKey, 0, 99);
        redisTemplate.expire(redisKey, Duration.ofDays(7));

        // 2. 同步写入 MySQL（异步，防止阻塞）
        asyncExecutor.submit(() -&gt; {
            OfflineMessage record = new OfflineMessage();
            record.setUserId(userId);
            record.setMessageId(message.getMessageId());
            record.setContent(message.getContent());
            record.setCreateTime(message.getCreateTime());
            record.setStatus("UNREAD");
            mapper.insert(record);
        });
    }

    /**
     * 用户上线时，拉取离线消息
     */
    public List&lt;PushMessage&gt; fetchOfflineMessages(Long userId) {
        String redisKey = "offline:" + userId;

        // 1. 先从 Redis 拉
        List&lt;Object&gt; redisMessages = redisTemplate.opsForList().range(redisKey, 0, -1);
        if (redisMessages != null &amp;&amp; !redisMessages.isEmpty()) {
            redisTemplate.delete(redisKey);
            return redisMessages.stream()
                .map(obj -&gt; (PushMessage) obj)
                .collect(Collectors.toList());
        }

        // 2. Redis 没有，从 MySQL 拉
        List&lt;OfflineMessage&gt; dbMessages = mapper.selectByUserId(userId, "UNREAD");
        return dbMessages.stream()
            .map(this::toPushMessage)
            .collect(Collectors.toList());
    }
}
```

---

## 延伸问题

### Q1：如何实现消息已读未读？

消息已读是一个典型的 **CRDT（Conflict-free Replicated Data Type）** 问题。

方案：每条消息维护一个「已读设备列表」，设备上线时拉取未读消息，上报已读时更新列表。

### Q2：百万级长连接怎么管理？

1. **连接分片**：按设备 ID 哈希到不同 Netty 服务器
2. **连接复用**：减少连接数（如代理模式）
3. **协议优化**：使用 WebSocket 或 MQTT 等标准协议

### Q3：iOS 和 Android 推送有什么区别？

| 平台 | 推送方式 | 特点 |
|---|---|---|
| iOS | APNs（苹果服务器） | 必须经过苹果服务器，不能自己推 |
| Android | 厂商通道 / 自建 | 国内用厂商通道（华为、小米、OPPO），国外用 FCM |

---

## 总结

消息推送系统的核心组件：

| 组件 | 作用 |
|---|---|
| 长连接 | 实时双向通信 |
| 消息路由 | 找到用户的设备 |
| 可靠推送 | 消息不丢不重 |
| 离线存储 | 用户不在线时暂存 |

记住：**推送系统的核心是「连接」和「可靠」。**

连接稳，才能推送快；机制全，才能不丢消息。
