# 设计抢票系统（12306）

每年春运，12306 都是全中国最难访问的网站之一。

开售前 5 分钟，你反复刷新页面——「余票不足」。

开售那一刻，你狂点购票——「系统正忙，请稍后」。

10 分钟后，你终于进去了，票没了。

**这就是抢票系统的终极难题：如何在海量并发下，保证购票公平，同时系统不崩溃？**


## 一、问题分析

### 1.1 抢票 vs 秒杀

```
┌─────────────────────────────────────────────────────┐
│                  抢票 vs 秒杀                         │
├─────────────────────────────────────────────────────┤
│                                                     │
│  相同点                                              │
│  ├── 都是高并发场景                                  │
│  ├── 都需要防超卖                                    │
│  └── 都有限流保护                                    │
│                                                     │
│  不同点                                              │
│  ├── 票是动态的（随时可能退票、改签）                │
│  ├── 座位选择（同一车次可能有上百种座位组合）         │
│  ├── 路径规划（多站上车、跨车次换乘）                │
│  └── 复杂的业务规则（学生票、儿童票等）              │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 核心挑战

```
1. 库存复杂度：
   - 一列火车 1000+ 座位
   - 起点到终点之间的每个车站都有余票
   - 座位在 A 站卖出后，B-C 站之间就不能再卖

2. 数据一致性：
   - 分布式环境下，多台服务器可能同时卖出同一张票
   - 需要分布式锁或乐观锁

3. 性能要求：
   - 12306 峰值 QPS 超过 50 万
   - 查询和下单混在一起，互相影响
```


## 二、容量估算

### 2.1 数据规模

```
节假日抢票场景：
- 参与用户：千万级
- 峰值 QPS：50 万/秒（查询 + 下单）
- 车次数量：数万列
- 座位数量：每列 1000+ 座位

数据量：
- 车次表：10 万条
- 座位库存：每车次 1000 条座位状态
- 订单表：每年数亿订单
```

### 2.2 存储设计

```
Redis 存储（高频访问）：
- 余票数量：seats:available:{trainId}:{date}
- 座位状态：seat:status:{trainId}:{carriage}:{seatNo}

MySQL 存储（持久化）：
- 车次信息表
- 订单表
- 用户表
```


## 三、高层设计

```
┌──────────────────────────────────────────────────────────────────┐
│                         用户请求                                   │
│                   查询余票 / 购买车票                              │
└──────────────────────────────────────────────────────────────────┘
                                │
                     ┌───────────▼───────────┐
                     │     12306 前端        │
                     │  (静态资源 CDN 加速)    │
                     └───────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌───────▼───────┐ ┌───────▼───────┐
     │   查询服务集群   │ │   下单服务集群  │ │   支付服务集群  │
     │  (CDN + Redis) │ │  (分布式锁)    │ │  (一致性要求高) │
     └────────┬────────┘ └───────┬───────┘ └───────────────┘
              │                   │
              └─────────┬─────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
   ┌──────▼──────┐ ┌───▼────┐ ┌─────▼─────┐
   │  Redis集群   │ │  MQ    │ │  MySQL集群 │
   │ (余票缓存)   │ │(异步下单)│ │  (订单存储) │
   └─────────────┘ └────────┘ └───────────┘
```


## 四、核心设计

### 4.1 座位库存模型

抢票最难的是**座位库存**。一个座位从 A 站到 B 站，中间不能被其他人购买：

```java
/**
 * 座位库存模型
 *
 * 问题：A 站→D 站卖了，B→C 还能卖吗？
 * 答案是：不能，因为 B→C 的座位被 A→D 的乘客占用了
 *
 * 解决方案：区段锁
 * - 将座位按区段划分
 * - 如果 A→D 卖了，A-D 之间的所有区段都不能再卖
 */
public class TrainSeatService {

    /**
     * 座位区段模型
     *
     * 思路：把座位拆分成多个区段
     * 例如：A-B, B-C, C-D 三个区段
     * 如果卖 A-D，需要锁住 A-B, B-C, C-D 三个区段
     */
    public static class SeatSection {
        private String trainId;
        private String carriageNo;   // 车厢号
        private String seatNo;       // 座位号
        private String startStation;  // 出发站
        private String endStation;   // 终点站

        // 区段内所有区段（A→D 包含 A-B, B-C, C-D）
        public List<SeatSection> getSubSections() {
            List<SeatSection> subSections = new ArrayList<>();
            List<Station> stations = getStationList(startStation, endStation);

            for (int i = 0; i < stations.size() - 1; i++) {
                SeatSection section = new SeatSection();
                section.setTrainId(trainId);
                section.setCarriageNo(carriageNo);
                section.setSeatNo(seatNo);
                section.setStartStation(stations.get(i));
                section.setEndStation(stations.get(i + 1));
                subSections.add(section);
            }
            return subSections;
        }
    }

    /**
     * 检查座位是否可用
     *
     * @return true 表示可用，false 表示已被占用
     */
    public boolean isSeatAvailable(String trainId, String carriageNo,
                                  String seatNo, String fromStation, String toStation) {
        // 1. 获取所有区段
        List<SeatSection> sections = new SeatSection()
            .setTrainId(trainId)
            .setCarriageNo(carriageNo)
            .setSeatNo(seatNo)
            .setStartStation(fromStation)
            .setEndStation(toStation)
            .getSubSections();

        // 2. 检查每个区段是否可用
        for (SeatSection section : sections) {
            String key = buildSeatKey(section);
            Boolean available = redis.opsForValue().get(key);

            if (Boolean.FALSE.equals(available)) {
                return false; // 该区段已被占用
            }
        }

        return true;
    }

    /**
     * 锁定座位（多区段原子操作）
     *
     * 使用 Lua 脚本保证原子性
     */
    public boolean lockSeat(String trainId, String carriageNo, String seatNo,
                           String fromStation, String toStation, String orderId) {
        List<SeatSection> sections = new SeatSection()
            .setTrainId(trainId)
            .setStartStation(fromStation)
            .setEndStation(toStation)
            .getSubSections();

        // Lua 脚本：批量设置区段为已锁定
        String luaScript = """
            for i, key in ipairs(KEYS) do
                local current = redis.call('GET', key)
                if current and current ~= ARGV[1] then
                    -- 已被其他人锁定
                    return 0
                end
            end
            -- 所有区段都可锁定，批量设置
            for i, key in ipairs(KEYS) do
                redis.call('SET', key, ARGV[1])
                redis.call('EXPIRE', key, 900)  -- 15分钟锁定期
            end
            return 1
            """;

        List<String> keys = sections.stream()
            .map(this::buildSeatKey)
            .collect(Collectors.toList());

        Long result = redis.execute(
            new DefaultRedisScript<>(luaScript, Long.class),
            keys,
            orderId
        );

        return result != null && result == 1;
    }

    /**
     * 解锁座位（释放锁或完成购买）
     */
    public void unlockSeat(String trainId, String carriageNo, String seatNo,
                           String fromStation, String toStation) {
        List<SeatSection> sections = new SeatSection()
            .setTrainId(trainId)
            .setStartStation(fromStation)
            .setEndStation(toStation)
            .getSubSections();

        for (SeatSection section : sections) {
            String key = buildSeatKey(section);
            redis.delete(key);
        }
    }

    private String buildSeatKey(SeatSection section) {
        return String.format("seat:%s:%s:%s:%s-%s",
            section.getTrainId(),
            section.getCarriageNo(),
            section.getSeatNo(),
            section.getStartStation(),
            section.getEndStation()
        );
    }
}
```

### 4.2 分布式锁下单

```java
/**
 * 抢票下单服务
 *
 * 使用分布式锁保证同一用户不会重复下单
 */
public class TicketOrderService {

    private TrainSeatService seatService;
    private OrderMapper orderMapper;
    private RedissonClient redisson;

    /**
     * 抢票下单
     */
    @Transactional
    public OrderResult grabTicket(GrabTicketRequest request) {
        String userId = request.getUserId();
        String trainId = request.getTrainId();
        String fromStation = request.getFromStation();
        String toStation = request.getToStation();

        // 1. 分布式锁：防止同一用户重复下单
        String lockKey = "lock:grab:" + userId + ":" + trainId;
        RLock lock = redisson.getLock(lockKey);

        try {
            // 尝试获取锁，最多等待 0 秒，锁定 10 秒
            if (!lock.tryLock(0, 10, TimeUnit.SECONDS)) {
                return OrderResult.fail("操作太频繁，请稍后");
            }

            // 2. 检查是否已有未支付订单
            if (hasUnpaidOrder(userId, trainId)) {
                return OrderResult.fail("您有待支付订单，请先处理");
            }

            // 3. 选择可用座位
            List<SeatInfo> availableSeats = seatService.findAvailableSeats(
                trainId, fromStation, toStation
            );

            if (availableSeats.isEmpty()) {
                return OrderResult.fail("暂无余票");
            }

            // 4. 尝试锁定座位
            SeatInfo selectedSeat = availableSeats.get(0);
            String orderId = generateOrderId();

            boolean locked = seatService.lockSeat(
                trainId,
                selectedSeat.getCarriageNo(),
                selectedSeat.getSeatNo(),
                fromStation,
                toStation,
                orderId
            );

            if (!locked) {
                return OrderResult.fail("座位已被抢占，请重试");
            }

            // 5. 创建订单（待支付状态）
            Order order = createOrder(request, selectedSeat, orderId);

            // 6. 发送延迟消息（15分钟不支付则取消）
            delayQueue.sendCancelMessage(orderId, Duration.ofMinutes(15));

            return OrderResult.success(order);

        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return OrderResult.fail("系统繁忙");
        } finally {
            lock.unlock();
        }
    }

    /**
     * 支付成功，确认座位
     */
    public void confirmSeat(String orderId) {
        Order order = orderMapper.selectById(orderId);
        order.setStatus("已支付");
        orderMapper.update(order);

        // 删除延迟取消消息（座位已确认，不再取消）
        delayQueue.removeCancelMessage(orderId);
    }

    /**
     * 取消订单，释放座位
     */
    public void cancelOrder(String orderId) {
        Order order = orderMapper.selectById(orderId);

        if ("已支付".equals(order.getStatus())) {
            throw new BusinessException("已支付订单无法取消");
        }

        // 释放座位
        seatService.unlockSeat(
            order.getTrainId(),
            order.getCarriageNo(),
            order.getSeatNo(),
            order.getFromStation(),
            order.getToStation()
        );

        order.setStatus("已取消");
        orderMapper.update(order);
    }
}
```

### 4.3 余票查询优化

```java
/**
 * 余票查询服务
 *
 * 查询是读多写少的场景，重点优化读取性能
 */
public class TicketQueryService {

    private RedisTemplate<String, Object> redis;

    /**
     * 查询余票数量
     *
     * 为什么不用精确座位查询？
     * - 用户只关心有没有票，不关心具体座位
     * - 精确查询太慢，需要扫描所有座位
     */
    public TicketCount queryAvailableCount(String trainId, String fromStation, String toStation) {
        String cacheKey = "ticket:count:" + trainId + ":" + fromStation + ":" + toStation;

        // 1. 先查缓存
        Integer count = (Integer) redis.opsForValue().get(cacheKey);
        if (count != null) {
            return new TicketCount(count, true);
        }

        // 2. 缓存未命中，查询数据库
        count = calculateAvailableCount(trainId, fromStation, toStation);

        // 3. 回填缓存（短期过期，活动期间频繁更新）
        redis.opsForValue().set(cacheKey, count, Duration.ofSeconds(30));

        return new TicketCount(count, false);
    }

    /**
     * 实时查询座位详情
     */
    public List<SeatInfo> querySeatDetails(String trainId, String fromStation, String toStation) {
        // 查询所有可用座位
        return seatService.findAvailableSeats(trainId, fromStation, toStation);
    }

    /**
     * 计算可用余票数
     *
     * 核心算法：
     * 1. 遍历所有座位
     * 2. 检查每个座位的所有区段是否可用
     * 3. 统计可用区段数量
     */
    private int calculateAvailableCount(String trainId, String fromStation, String toStation) {
        // 简化实现：实际需要更复杂的算法
        // 计算从 fromStation 到 toStation 之间的可用座位数
        List<Station> route = getRoute(trainId);
        int fromIndex = route.indexOf(fromStation);
        int toIndex = route.indexOf(toStation);

        int totalSeats = 1000; // 假设每列火车 1000 个座位
        int bookedSeats = countBookedSeats(trainId, fromIndex, toIndex);

        return totalSeats - bookedSeats;
    }
}
```

### 4.4 排队系统

```java
/**
 * 抢票排队系统
 *
 * 场景：高峰期请求过多，超出系统处理能力
 * 解决方案：让用户排队，控制并发
 */
public class TicketQueueService {

    private RedisTemplate<String, Object> redis;
    private static final int MAX_CONCURRENT = 10000; // 同时处理的最大请求数

    /**
     * 加入排队队列
     *
     * @return 队列位置，null 表示直接可以购买
     */
    public Integer joinQueue(String userId, String trainId) {
        String queueKey = "queue:seats:" + trainId;
        String positionKey = "queue:position:" + userId + ":" + trainId;

        // 检查是否已经在队列中
        Integer existing = (Integer) redis.opsForValue().get(positionKey);
        if (existing != null) {
            return existing;
        }

        // 获取当前队列长度
        Long position = redis.opsForList().rightPush(queueKey, userId);

        // 计算预估等待时间（粗略估算）
        int estimatedWait = (int) (position / MAX_CONCURRENT) * 2; // 每万人次约2分钟

        // 设置位置和过期时间
        redis.opsForValue().set(positionKey, position.intValue(), Duration.ofMinutes(30));

        return position.intValue();
    }

    /**
     * 查询排队状态
     */
    public QueueStatus checkQueueStatus(String userId, String trainId) {
        String queueKey = "queue:seats:" + trainId;

        // 获取队列长度
        Long queueSize = redis.opsForList().size(queueKey);

        // 获取用户当前位置
        Long position = redis.opsForList().indexOf(queueKey, userId);

        if (position == null || position < 0) {
            // 不在队列中，说明已经处理过
            return new QueueStatus(QueueState.CAN_ORDER, 0, 0);
        }

        // 判断是否轮到
        if (position < MAX_CONCURRENT) {
            return new QueueStatus(QueueState.CAN_ORDER, position.intValue(), 0);
        } else {
            int estimatedWait = (int) ((position - MAX_CONCURRENT) / MAX_CONCURRENT) * 2;
            return new QueueStatus(QueueState.WAITING, position.intValue(), estimatedWait);
        }
    }

    /**
     * 离开队列（下单成功后调用）
     */
    public void leaveQueue(String userId, String trainId) {
        String queueKey = "queue:seats:" + trainId;
        redis.opsForList().remove(queueKey, 1, userId);
    }
}

/**
 * 队列状态
 */
public record QueueStatus(QueueState state, int position, int estimatedWaitMinutes) {}

public enum QueueState {
    CAN_ORDER,  // 可以下单
    WAITING,    // 等待中
}
```


## 五、延伸问题

### 问题一：如何防止黄牛党？

```
方案：
1. 实名制购票：一人一证一票
2. 购票限制：每张身份证每天最多购买 N 张票
3. 验证码：购票时需要识别图形验证码
4. 风控系统：识别异常账号和 IP
5. 侯补购票：官方候补，挤压黄牛空间
```

### 问题二：如何处理退票和改签？

```
退票：
1. 用户退票 → 释放座位 → 座位变为可用
2. 侯补队列中有用户 → 自动分配

改签：
1. 原座位释放
2. 目标车次检查余票
3. 锁定新座位
4. 差价退还/补缴
```

### 问题三：如何保证高可用？

```
方案：
1. 读写分离：查询走从库，下单走主库
2. 热点隔离：抢票高峰期，临时扩容
3. 降级熔断：系统过载时，降级非核心功能
4. 多级缓存：Redis + 本地缓存 + CDN
```


## 六、总结

```
┌─────────────────────────────────────────────────────┐
│              抢票系统核心知识点                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  座位模型                                            │
│  ├── 区段锁：解决多区段复用问题                       │
│  └── Lua 脚本：批量锁的原子性                        │
│                                                     │
│  下单流程                                            │
│  ├── 分布式锁：防止重复下单                          │
│  ├── 座位锁定：15 分钟有效期                        │
│  └── 延迟队列：超时自动释放                          │
│                                                     │
│  性能优化                                            │
│  ├── 余票缓存：减少数据库查询                        │
│  ├── 排队系统：控制并发压力                          │
│  └── 读写分离：查询和下单分离                        │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能解释区段锁的原理
- 能画出完整的购票流程图
- 能说出座位超卖的原因和解决方案
- 能分析 12306 为什么这么难做
