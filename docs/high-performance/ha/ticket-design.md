# 高可用架构案例：12306 抢票系统

你有没有经历过 12306 抢票？

每到春运，12306 的访问量就会爆发式增长。2019 年春运期间，12306 单日访问量超过 1500 亿次，峰值 QPS 超过 40 万。

这个数字比很多互联网公司全年的访问量还多。

今天我们就来聊聊：如何设计一个能扛住这种流量的抢票系统。

## 抢票系统的特点

### 和普通商品抢购的区别

| 特征 | 普通商品抢购 | 12306 抢票 |
|------|------------|------------|
| 库存 | 固定数量，卖完即止 | 动态变化（有退票、改签） |
| 时效 | 通常几分钟到几小时 | 可能持续几周 |
| 并发 | 集中在开始的几分钟 | 持续性高并发 |
| 冲突 | 商品级别竞争 | 座位级别竞争（座位 A 和座位 B 是不同的） |
| 约束 | 每人限买一件 | 同一车次限买 5 张 |
| 地域 | 无 | 需要考虑出发地和目的地 |

### 核心挑战

```
抢票流程：
1. 查询余票 ──▶ 余票计算复杂（区间票）
2. 选择座位 ──▶ 座位图实时状态
3. 提交订单 ──▶ 锁票
4. 支付 ──▶ 时限支付
5. 出票 ──▶ 完成购票
```

1. **余票计算**：同一车次，不同区间共享库存。比如北京到上海的票和石家庄到郑州的票共享库存。
2. **座位选择**：座位状态实时变化，多人同时抢同一座位。
3. **订单超时**：锁票后需要在规定时间内支付，否则释放座位。
4. **高并发查询**：查询余票的请求量远超下单请求量。

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         用户请求                                  │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         │                    │                    │             │
│         ▼                    ▼                    ▼             │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐       │
│   │  CDN      │        │  DNS     │        │  防火墙   │       │
│   │  静态资源  │        │  智能解析 │        │  DDoS防护 │       │
│   └───────────┘        └───────────┘        └───────────┘       │
│                              │                                   │
│                              ▼                                   │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                    接入层（网关）                          │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│   │   │  用户认证    │  │  限流       │  │  验证码     │   │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│   └────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                    查询服务集群                           │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│   │   │  余票查询    │  │  列车查询    │  │  车站查询   │   │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│   └────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│   ┌────────────────────────────────────────────────────────┐   │
│   │                    订单服务集群                         │   │
│   │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│   │   │  锁票       │  │  订单创建    │  │  支付处理   │   │   │
│   │   └──────────────┘  └──────────────┘  └──────────────┘   │   │
│   └────────────────────────────────────────────────────────┘   │
│                              │                                   │
│         ┌────────────────────┼────────────────────┐             │
│         ▼                    ▼                    ▼             │
│   ┌───────────┐        ┌───────────┐        ┌───────────┐     │
│   │  Redis    │        │  MQ       │        │  MySQL    │     │
│   │  座位缓存  │        │  订单队列  │        │  订单存储  │     │
│   └───────────┘        └───────────┘        └───────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 分层设计

```java
/**
 * 12306 系统分层架构
 */
public class TicketSystemArchitecture {

    /**
     * 第一层：查询层
     * 职责：处理余票查询、列车查询等读操作
     * 特点：读多写少，需要高并发
     */
    class QueryLayer {
        // 余票查询（Redis 缓存）
        // 列车信息查询
        // 车站信息查询
        // 历史订单查询
    }

    /**
     * 第二层：订单层
     * 职责：处理抢票、下单等写操作
     * 特点：写多读少，需要强一致性
     */
    class OrderLayer {
        // 座位预占（Redis）
        // 订单创建
        // 支付处理
        // 取消/退票
    }

    /**
     * 第三层：数据层
     * 职责：数据持久化存储
     * 特点：高可靠，强一致性
     */
    class DataLayer {
        // MySQL 订单存储
        // Redis 座位缓存
        // MQ 异步处理
        // 分布式锁
    }
}
```

## 核心模块设计

### 1. 余票计算

#### 区间票共享模型

```
车次 G1234：
┌─────────────────────────────────────────────────────────┐
│ 北京 ──▶ 天津 ──▶ 济南 ──▶ 南京 ──▶ 上海              │
│                                                         │
│ 假设全车 100 个座位：                                     │
│                                                         │
│ 北京-天津区间：100 张票（全部可用）                         │
│ 北京-济南区间：100 张票（全部可用）                         │
│ ...                                                     │
│ 天津-南京区间：需要计算 天津已售 + 济南已售 的座位不共享     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

```java
@Service
public class TicketCalculationService {

    @Autowired
    private RedisTemplate<String, String> redisTemplate;

    /**
     * 计算区间余票
     */
    public int calculateRemaining(String trainNo, String fromStation,
                                  String toStation, String date) {
        // 获取车次总座位数
        int totalSeats = getTotalSeats(trainNo);

        // 获取已售座位（按区间）
        int soldFrom = getSoldCount(trainNo, fromStation, date);
        int soldTo = getSoldCount(trainNo, toStation, date);

        // 余票 = 总座位 - 占用区间座位
        // 占用 = max(起点站已售, 终点站已售)
        int occupied = Math.max(soldFrom, soldTo);
        int remaining = totalSeats - occupied;

        return Math.max(0, remaining);
    }

    /**
     * 优化：使用 Redis Bitmap 存储已售座位
     */
    public int getSoldCount(String trainNo, String station, String date) {
        String key = "sold:" + trainNo + ":" + date + ":" + station;

        Long count = redisTemplate.opsForSet().size(key);
        return count != null ? count.intValue() : 0;
    }
}
```

#### 余票缓存

```java
@Service
public class TicketCacheService {

    private static final String TICKET_CACHE_KEY = "ticket:cache:";
    private static final long CACHE_EXPIRE_SECONDS = 30;  // 缓存 30 秒

    /**
     * 缓存余票信息
     */
    public void cacheRemaining(TicketInfo ticket) {
        String key = TICKET_CACHE_KEY + ticket.getCacheKey();

        redisTemplate.opsForValue().set(key, JSON.toJSONString(ticket),
            CACHE_EXPIRE_SECONDS, TimeUnit.SECONDS);
    }

    /**
     * 获取缓存的余票
     */
    public TicketInfo getCachedRemaining(String trainNo, String from,
                                         String to, String date) {
        String key = TICKET_CACHE_KEY + buildCacheKey(trainNo, from, to, date);

        String cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            return JSON.parseObject(cached, TicketInfo.class);
        }

        return null;
    }

    /**
     * 缓存预热（提前加载热点车次）
     */
    @Scheduled(fixedRate = 60000)  // 每分钟
    public void warmupCache() {
        // 加载未来 3 天的热门车次余票
        for (String trainNo : hotTrains) {
            warmupTrain(trainNo);
        }
    }

    private void warmupTrain(String trainNo) {
        // 预计算各区间余票
        List<String> stations = getStations(trainNo);
        String date = getNextDay();

        for (int i = 0; i < stations.size(); i++) {
            for (int j = i + 1; j < stations.size(); j++) {
                TicketInfo ticket = calculateTicket(trainNo, stations.get(i),
                    stations.get(j), date);
                cacheRemaining(ticket);
            }
        }
    }
}
```

### 2. 座位选择与锁票

#### 座位状态管理

```java
@Service
public class SeatService {

    private static final String SEAT_KEY_PREFIX = "seat:";
    private static final int LOCK_TIMEOUT_SECONDS = 300;  // 锁票 5 分钟

    /**
     * 锁票：原子操作
     */
    public LockResult lockSeat(LockRequest request) {
        String seatKey = buildSeatKey(request);
        String userKey = "lock:user:" + request.getUserId();

        // 使用 Lua 脚本保证原子性
        String luaScript =
            "local seatKey = KEYS[1] " +
            "local userKey = KEYS[2] " +
            "local seat = redis.call('GET', seatKey) " +

            "if seat and seat ~= 'AVAILABLE' then " +
            "    return {0, seat} " +  // 座位已被占用
            "end " +

            // 锁座位
            "redis.call('SET', seatKey, ARGV[1], 'EX', ARGV[2]) " +
            "redis.call('SET', userKey, seatKey, 'EX', ARGV[2]) " +

            "return {1, 'AVAILABLE'}";  // 锁成功

        DefaultRedisScript<List> script = new DefaultRedisScript<>();
        script.setScriptText(luaScript);
        script.setResultType(List.class);

        List result = redisTemplate.execute(script,
            List.of(seatKey, userKey),
            request.getUserId(), LOCK_TIMEOUT_SECONDS);

        return parseLockResult(result);
    }

    /**
     * 释放座位（超时或取消）
     */
    public void releaseSeat(String trainNo, String date, int carriage,
                           String seatNo, String userId) {
        String seatKey = buildSeatKey(trainNo, date, carriage, seatNo);

        // 只释放自己锁定的座位
        String currentLock = redisTemplate.opsForValue().get(seatKey);
        if (request.getUserId().equals(currentLock)) {
            redisTemplate.delete(seatKey);
        }
    }

    /**
     * 确认座位（支付成功）
     */
    public void confirmSeat(String trainNo, String date, int carriage,
                           String seatNo, String userId) {
        String seatKey = buildSeatKey(trainNo, date, carriage, seatNo);

        // 确认后永久占用
        redisTemplate.opsForValue().set(seatKey, "SOLD:" + userId);
    }

    /**
     * 查询座位状态
     */
    public SeatStatus querySeatStatus(String trainNo, String date, int carriage) {
        String pattern = SEAT_KEY_PREFIX + trainNo + ":" + date + ":" + carriage + ":*";

        Map<String, String> seats = redisTemplate.opsForHash().entries(pattern);

        // 解析座位状态
        List<SeatInfo> seatList = new ArrayList<>();
        for (Map.Entry<String, String> entry : seats.entrySet()) {
            String seatNo = extractSeatNo(entry.getKey());
            String status = entry.getValue();
            seatList.add(SeatInfo.builder()
                .seatNo(seatNo)
                .status(parseStatus(status))
                .lockUser(getLockUser(status))
                .build());
        }

        return SeatStatus.builder()
            .carriage(carriage)
            .seats(seatList)
            .build();
    }

    private String buildSeatKey(LockRequest request) {
        return SEAT_KEY_PREFIX + request.getTrainNo() + ":" +
               request.getDate() + ":" + request.getCarriage() + ":" +
               request.getSeatNo();
    }
}
```

#### 座位图展示

```java
@Service
public class SeatMapService {

    /**
     * 生成座位图
     */
    public SeatMap generateSeatMap(String trainNo, String date, int carriage) {
        // 从缓存获取座位状态
        List<SeatInfo> seats = seatService.getSeatsByCarriage(trainNo, date, carriage);

        // 座位布局
        // A B  C D F (过道在 C/D 之间)
        List<List<SeatInfo>> layout = new ArrayList<>();
        List<SeatInfo> row = new ArrayList<>();

        for (int i = 0; i < seats.size(); i++) {
            row.add(seats.get(i));
            if ((i + 1) % 5 == 2) {  // 过道位置
                row.add(SeatInfo.empty("AISLE"));
            }
            if ((i + 1) % 5 == 0) {
                layout.add(row);
                row = new ArrayList<>();
            }
        }

        return SeatMap.builder()
            .trainNo(trainNo)
            .date(date)
            .carriage(carriage)
            .layout(layout)
            .build();
    }
}
```

### 3. 订单处理

#### 订单创建流程

```java
@Service
public class OrderService {

    @Autowired
    private SeatService seatService;
    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private MQTemplate mqTemplate;

    /**
     * 创建订单
     */
    @Transactional
    public OrderResult createOrder(OrderRequest request) {
        // 1. 锁座位
        LockResult lockResult = seatService.lockSeat(request);
        if (!lockResult.isSuccess()) {
            return OrderResult.failed("座位已被占用");
        }

        try {
            // 2. 创建订单
            Order order = Order.builder()
                .orderNo(generateOrderNo())
                .userId(request.getUserId())
                .trainNo(request.getTrainNo())
                .date(request.getDate())
                .fromStation(request.getFromStation())
                .toStation(request.getToStation())
                .carriage(request.getCarriage())
                .seatNo(request.getSeatNo())
                .passengers(request.getPassengers())
                .price(calculatePrice(request))
                .status(OrderStatus.UNPAID)
                .createTime(new Date())
                .expireTime(DateUtils.addMinutes(new Date(), 30))  // 30 分钟支付
                .build();

            orderMapper.insert(order);

            // 3. 发送超时检查消息
            mqTemplate.sendDelay("order.timeout", order.getOrderNo(),
                30 * 60 * 1000);  // 30 分钟后检查

            return OrderResult.success(order);

        } catch (Exception e) {
            // 释放座位
            seatService.releaseSeat(request.getTrainNo(), request.getDate(),
                request.getCarriage(), request.getSeatNo(), request.getUserId());
            throw e;
        }
    }

    /**
     * 支付订单
     */
    public PaymentResult pay(String orderNo, PaymentMethod method) {
        Order order = orderMapper.selectByOrderNo(orderNo);

        if (order == null) {
            return PaymentResult.failed("订单不存在");
        }

        if (order.getStatus() != OrderStatus.UNPAID) {
            return PaymentResult.failed("订单状态不正确");
        }

        if (order.isExpired()) {
            // 订单超时，取消
            cancelOrder(orderNo);
            return PaymentResult.failed("订单已超时");
        }

        // 扣款
        PaymentResult payment = paymentService.deduct(order.getUserId(),
            order.getPrice(), method);

        if (payment.isSuccess()) {
            // 确认座位
            seatService.confirmSeat(order.getTrainNo(), order.getDate(),
                order.getCarriage(), order.getSeatNo(), order.getUserId());

            // 更新订单状态
            orderMapper.updateStatus(order.getId(), OrderStatus.PAID);

            return PaymentResult.success("支付成功");
        }

        return payment;
    }

    /**
     * 订单超时处理
     */
    @RabbitListener(queues = "order.timeout")
    public void handleOrderTimeout(String orderNo) {
        Order order = orderMapper.selectByOrderNo(orderNo);

        if (order != null && order.getStatus() == OrderStatus.UNPAID) {
            // 取消订单
            cancelOrder(orderNo);
        }
    }

    private void cancelOrder(String orderNo) {
        Order order = orderMapper.selectByOrderNo(orderNo);

        // 释放座位
        seatService.releaseSeat(order.getTrainNo(), order.getDate(),
            order.getCarriage(), order.getSeatNo(), order.getUserId());

        // 更新订单状态
        orderMapper.updateStatus(order.getId(), OrderStatus.CANCELLED_TIMEOUT);

        log.info("订单超时取消: orderNo={}", orderNo);
    }
}
```

### 4. 流量控制

#### 多级限流

```java
@Service
public class TicketRateLimiter {

    /**
     * 查询限流（允许较高 QPS）
     */
    public boolean allowQuery(String userId) {
        String key = "rate:query:" + userId;
        Long count = redisTemplate.opsForValue().increment(key);

        if (count == 1) {
            redisTemplate.expire(key, 1, TimeUnit.MINUTES);
        }

        return count <= 600;  // 每分钟 600 次查询
    }

    /**
     * 下单限流（严格限制）
     */
    public boolean allowOrder(String userId) {
        String key = "rate:order:" + userId;
        Long count = redisTemplate.opsForValue().increment(key);

        if (count == 1) {
            redisTemplate.expire(key, 1, TimeUnit.MINUTES);
        }

        return count <= 5;  // 每分钟 5 次下单
    }

    /**
     * 座位锁限流
     */
    public boolean allowLock(String userId, String trainNo) {
        // 检查用户是否已有未完成订单
        String userOrderKey = "order:pending:" + userId;
        if (Boolean.TRUE.equals(redisTemplate.hasKey(userOrderKey))) {
            return false;  // 已有未完成订单，不能再锁
        }

        // 检查座位锁频率
        String lockKey = "rate:lock:" + userId + ":" + trainNo;
        Long count = redisTemplate.opsForValue().increment(lockKey);

        if (count == 1) {
            redisTemplate.expire(lockKey, 10, TimeUnit.SECONDS);
        }

        return count <= 3;  // 每 10 秒每车次 3 次锁票
    }
}
```

#### 人机验证

```java
@Service
public class CaptchaService {

    /**
     * 生成行为验证
     */
    public Captcha generateCaptcha(String userId, String action) {
        // 根据用户历史行为生成不同难度的验证码
        CaptchaLevel level = determineLevel(userId);

        switch (level) {
            case SIMPLE:
                return generateSimpleCaptcha();
            case MEDIUM:
                return generateSliderCaptcha();
            case HARD:
                return generateImageCaptcha();
            default:
                return generateSimpleCaptcha();
        }
    }

    /**
     * 根据用户行为动态调整验证级别
     */
    private CaptchaLevel determineLevel(String userId) {
        // 检查请求频率
        long queryCount = getQueryCount(userId);
        long orderCount = getOrderCount(userId);

        // 正常用户行为
        if (queryCount < 100 && orderCount < 10) {
            return CaptchaLevel.NONE;
        }

        // 频繁查询但不下单
        if (queryCount > 500 && orderCount < 5) {
            return CaptchaLevel.HARD;
        }

        return CaptchaLevel.MEDIUM;
    }
}
```

## 高可用设计

### 1. 读写分离

```
读请求（90%）：
├── 余票查询 → Redis 缓存
├── 列车查询 → CDN + Redis
└── 订单查询 → MySQL 读库

写请求（10%）：
├── 锁票 → Redis 分布式锁
├── 下单 → MySQL 主库
└── 支付 → 独立支付服务
```

### 2. 降级策略

```java
@Service
public class DegradeService {

    private volatile boolean seatLockEnabled = true;
    private volatile boolean paymentEnabled = true;

    /**
     * 查询降级：缓存失效时返回静态数据
     */
    public TicketInfo getTicketWithDegrade(String trainNo, String from, String to) {
        try {
            return ticketService.getTicket(trainNo, from, to);
        } catch (Exception e) {
            log.warn("余票查询降级: {}", trainNo);
            return TicketInfo.degraded(trainNo, from, to);
        }
    }

    /**
     * 锁票降级：Redis 不可用时使用消息队列
     */
    public LockResult lockSeatWithDegrade(LockRequest request) {
        if (seatLockEnabled) {
            try {
                return seatService.lockSeat(request);
            } catch (Exception e) {
                log.warn("Redis 锁票失败，切换到 MQ 模式");
                seatLockEnabled = false;
            }
        }

        // 降级到消息队列
        return mqLockService.lockSeat(request);
    }
}
```

### 3. 监控告警

```java
@Service
public class TicketMonitorService {

    @Autowired
    private MeterRegistry meterRegistry;

    /**
     * 记录各项指标
     */
    public void recordQuery(String trainNo, long latency, boolean hit) {
        Counter.builder("ticket.query")
            .tag("train_no", trainNo)
            .tag("result", hit ? "hit" : "miss")
            .register(meterRegistry)
            .increment();

        Timer.builder("ticket.query.latency")
            .tag("train_no", trainNo)
            .register(meterRegistry)
            .record(latency, TimeUnit.MILLISECONDS);
    }

    public void recordLock(String trainNo, boolean success) {
        Counter.builder("ticket.lock")
            .tag("train_no", trainNo)
            .tag("result", success ? "success" : "fail")
            .register(meterRegistry)
            .increment();
    }

    public void recordOrder(String status) {
        Counter.builder("ticket.order")
            .tag("status", status)
            .register(meterRegistry)
            .increment();
    }

    /**
     * 异常告警
     */
    @Scheduled(fixedRate = 30000)
    public void checkAnomalies() {
        // 检查锁票失败率
        double lockFailRate = getLockFailRate();
        if (lockFailRate > 0.5) {
            alertManager.send(Alert.builder()
                .level(AlertLevel.CRITICAL)
                .title("锁票失败率过高")
                .message("当前失败率: " + (lockFailRate * 100) + "%")
                .build());
        }

        // 检查超时订单
        long timeoutOrders = getTimeoutOrderCount();
        if (timeoutOrders > 1000) {
            alertManager.send(Alert.builder()
                .level(AlertLevel.WARNING)
                .title("超时订单积压")
                .message("超时订单数: " + timeoutOrders)
                .build());
        }
    }
}
```

## 和秒杀系统的区别

| 维度 | 秒杀系统 | 12306 抢票 |
|------|---------|------------|
| **库存模型** | 固定库存 | 区间共享，动态变化 |
| **座位粒度** | 商品级别 | 座位级别（更细） |
| **并发特点** | 瞬间峰值 | 持续性高并发 |
| **约束条件** | 简单（每人一件） | 复杂（限张、车次、区间） |
| **超时机制** | 通常无 | 必须有（锁票限时） |
| **查询压力** | 相对较小 | 极大（查多买少） |
| **核心问题** | 不超卖 | 不超卖 + 座位分配 |

---

**思考题：**

1. 12306 的余票计算非常复杂，同一车次不同区间共享座位库存。如果让你设计这个算法，如何在保证准确性的同时提高性能？

2. 锁票超时后，座位会被释放。但此时可能有大量用户在等待这个座位，如何设计「候补购票」机制来提高用户体验？

3. 如何防止黄牛党抢票？现有的限流和验证码机制够用吗？还有什么更好的方案？

4. 12306 的查询压力远大于下单压力，如何设计查询和下单的隔离策略，确保下单不受查询影响？
