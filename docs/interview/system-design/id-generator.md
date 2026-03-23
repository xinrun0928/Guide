# 设计分布式 ID 生成器

面试官问你：

「现在有 3 台 MySQL 服务器，每台都用了自增 ID 作为主键。问题是：怎么保证这 3 台机器生成的 ID 不重复？」

你可能会说：「用 UUID 啊！」

面试官又问：「UUID 是字符串，128 位，太长了。有没有办法生成一个整数 ID，保证全局唯一？」

这就是分布式 ID 生成器的核心问题。


## 一、问题分析

### 1.1 为什么不用 UUID？

```
UUID 的问题：
├── 128 位整数，太长（36 个字符）
├── 字符串，存储和索引效率低
├── 无序，导致 B+ 树索引页分裂
└── 不连续，业务含义弱

分布式 ID 的要求：
├── 全局唯一
├── 趋势递增（有利于索引）
├── 可反解（包含时间、机器信息）
└── 高性能（每秒生成 10万+）
```

### 1.2 常见方案对比

| 方案 | 唯一性 | 性能 | 有序性 | 复杂度 |
|---|---|---|---|---|
| UUID | ✅ | 快 | ❌ | 低 |
| 数据库自增 | ✅ | 中 | ✅ | 低 |
| 雪花算法 | ✅ | 快 | ✅ | 中 |
| Redis INCR | ✅ | 快 | ✅ | 中 |


## 二、雪花算法详解

### 2.1 雪花算法原理

```
┌─────────────────────────────────────────────────────┐
│                   64 位整数 ID                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  符号位   │   时间戳   │  机器ID   │   序列号        │
│  1 bit   │  41 bits  │ 10 bits  │  12 bits       │
│                                                     │
│  范围：                                             │
│  - 时间戳：2^41 ≈ 69 年                             │
│  - 机器 ID：2^10 = 1024                             │
│  - 序列号：2^12 = 4096/毫秒                         │
│                                                     │
└─────────────────────────────────────────────────────┘

公式：ID = (timestamp - CUSTOM_EPOCH) << 22 | machineId << 12 | sequence
```

### 2.2 Java 实现

```java
/**
 * 雪花算法实现
 *
 * 核心思想：
 * - 使用时间戳作为主维度，保证趋势递增
 * - 使用机器 ID 区分不同机器，保证空间唯一
 * - 使用序列号解决同一毫秒内多次生成的问题
 */
public class SnowflakeIdGenerator {

    // 起始时间戳：2020-01-01 00:00:00
    // 选择一个靠后的时间作为起点，留出更多时间空间
    private static final long CUSTOM_EPOCH = 1577836800000L;

    // 各部分占用的位数
    private static final int TIMESTAMP_BITS = 41;
    private static final int MACHINE_ID_BITS = 10;
    private static final int SEQUENCE_BITS = 12;

    // 各部分的最大值
    private static final long MAX_MACHINE_ID = ~(-1L << MACHINE_ID_BITS); // 1023
    private static final long MAX_SEQUENCE = ~(-1L << SEQUENCE_BITS); // 4095

    // 各部分的偏移量
    private static final int MACHINE_ID_SHIFT = SEQUENCE_BITS;
    private static final int TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_ID_BITS;

    // 状态变量
    private final long machineId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;

    // 序列号锁（防止多线程问题）
    private final ReentrantLock lock = new ReentrantLock();

    public SnowflakeIdGenerator(long machineId) {
        if (machineId < 0 || machineId > MAX_MACHINE_ID) {
            throw new IllegalArgumentException(
                "Machine ID must be between 0 and " + MAX_MACHINE_ID
            );
        }
        this.machineId = machineId;
    }

    /**
     * 生成下一个 ID
     *
     * 为什么要加锁？
     * - 多线程环境下，sequence 的读写需要同步
     * - 如果不加锁，可能出现两个线程拿到相同序列号的情况
     */
    public synchronized long nextId() {
        long currentTimestamp = getCurrentTimestamp();

        // 时间回拨检测
        if (currentTimestamp < lastTimestamp) {
            throw new ClockBackwardsException(
                "Clock moved backwards. Refusing to generate id."
            );
        }

        // 同一毫秒内，序列号递增
        if (currentTimestamp == lastTimestamp) {
            sequence = (sequence + 1) & MAX_SEQUENCE;
            // 序列号用完，等待下一毫秒
            if (sequence == 0) {
                currentTimestamp = waitNextMillis(currentTimestamp);
            }
        } else {
            // 新毫秒，序列号归零
            sequence = 0;
        }

        lastTimestamp = currentTimestamp;

        // 组装 ID
        // (时间戳差值) << 22 | (机器ID) << 12 | (序列号)
        return ((currentTimestamp - CUSTOM_EPOCH) << TIMESTAMP_SHIFT)
             | (machineId << MACHINE_ID_SHIFT)
             | sequence;
    }

    /**
     * 等待下一毫秒
     *
     * 为什么用 while 而不是 if？
     * - 如果等待后时间还没变，需要继续等待
     * - 防止极端情况下的时钟跳跃
     */
    private long waitNextMillis(long currentTimestamp) {
        while (currentTimestamp <= lastTimestamp) {
            currentTimestamp = getCurrentTimestamp();
        }
        return currentTimestamp;
    }

    /**
     * 获取当前时间戳
     *
     * 为什么不用 System.currentTimeMillis() 直接比较？
     * - 因为 synchronized 方法内多次调用会有微小误差
     * - 为了保证单调性，用一个变量缓存
     */
    private long getCurrentTimestamp() {
        return System.currentTimeMillis();
    }

    /**
     * 反解 ID（用于调试和日志）
     */
    public static IdInfo parseId(long id) {
        long timestamp = (id >> TIMESTAMP_SHIFT) + CUSTOM_EPOCH;
        long machineId = (id >> MACHINE_ID_SHIFT) & MAX_MACHINE_ID;
        long sequence = id & MAX_SEQUENCE;

        return new IdInfo(
            new Date(timestamp),
            machineId,
            sequence
        );
    }

    /**
     * ID 信息类
     */
    public record IdInfo(Date generateTime, long machineId, long sequence) {}
}
```

### 2.3 时钟回拨问题

```java
/**
 * 时钟回拨处理策略
 *
 * 时钟回拨的原因：
 * 1. NTP 同步导致时间突然变小
 * 2. 虚拟机挂起后恢复，时钟被回拨
 * 3. 容器漂移导致时钟跳跃
 */
public class SnowflakeWithBackup {

    private final SnowflakeIdGenerator primaryGenerator;

    // 方案一：等待回拨恢复（简单但可能阻塞）
    public static class WaitStrategy implements SnowflakeIdGenerator.ClockBackwardsException {
        // 等待时钟恢复，然后继续生成
        // 缺点：可能等待较长时间
    }

    // 方案二：扩展序列号位数（如果有余量）
    // 把 12 位序列号扩展到更多，给回拨预留空间

    // 方案三：使用上次生成的最大序列号（推荐）
    public static class MaxSequenceStrategy {

        private static final long CUSTOM_EPOCH = 1577836800000L;
        private static final int MACHINE_ID_BITS = 10;
        private static final int SEQUENCE_BITS = 12;

        // 使用时间戳的中间 41 位
        private static final int TIMESTAMP_SHIFT = SEQUENCE_BITS;

        // 上次生成的最大 ID（用于回拨时续接）
        private volatile long lastId = 0;
        private final ReentrantLock lock = new ReentrantLock();

        public long nextId(long machineId) {
            lock.lock();
            try {
                long currentTime = System.currentTimeMillis() - CUSTOM_EPOCH;
                long currentBase = currentTime << TIMESTAMP_SHIFT | (machineId << SEQUENCE_BITS);

                // 如果当前时间 < 上次时间（回拨），从上次位置继续
                if (currentBase <= (lastId >> TIMESTAMP_SHIFT)) {
                    // 在上次基础上 +1
                    return lastId + 1;
                }

                // 正常情况，从当前时间开始
                long newId = currentBase;
                lastId = newId;
                return newId;

            } finally {
                lock.unlock();
            }
        }
    }

    // 方案四：异或偏移（优雅降级）
    public static class XorStrategy {

        // 当发生回拨时，使用上次时间 + 1 的高位部分
        // 牺牲少量有序性，保证 ID 不重复
    }
}
```


## 三、数据库自增 ID 方案

### 3.1 批量获取 ID

```java
/**
 * 数据库批量 ID 生成
 *
 * 每次从数据库获取一批 ID，缓存在内存中
 * 优点：简单可靠
 * 缺点：需要额外的数据库表
 */
public class DatabaseIdGenerator {

    private DataSource dataSource;
    private static final int BATCH_SIZE = 1000;

    // 本地缓存
    private volatile long minId = 0;
    private volatile long maxId = 0;
    private volatile long currentId = 0;

    /**
     * 获取下一个 ID（从本地缓存）
     */
    public long nextId() {
        if (currentId >= maxId) {
            // 缓存用完，从数据库获取新批次
            refreshFromDatabase();
        }
        return currentId++;
    }

    /**
     * 从数据库批量获取 ID
     *
     * 为什么要用 UPDATE ... RETURNING？
     * - 原子操作，获取和更新在一次数据库交互中完成
     * - 避免多实例竞争时的 ID 冲突
     */
    @Transactional
    public void refreshFromDatabase() {
        // 使用悲观锁，确保多实例不会获取相同 ID 段
        Long newMaxId = jdbcTemplate.queryForObject("""
            UPDATE id_generator
            SET current_value = current_value + ?
            WHERE name = 'default'
            RETURNING current_value
            """, Long.class, BATCH_SIZE);

        minId = newMaxId - BATCH_SIZE + 1;
        maxId = newMaxId;
        currentId = minId;
    }

    /**
     * 双-buffer 优化
     *
     * 当 buffer1 用到一半时，异步加载 buffer2
     * 实现无感知切换
     */
    public static class DoubleBufferGenerator {

        private volatile int currentBuffer = 0;
        private volatile long[][] buffers = new long[2][BATCH_SIZE];
        private volatile int bufferIndex = 0;

        public long nextId() {
            if (bufferIndex >= BATCH_SIZE) {
                // 切换到另一个 buffer，异步加载新的
                switchBuffer();
            }
            return buffers[currentBuffer][bufferIndex++];
        }

        @Async
        public void preloadBuffer() {
            // 异步加载下一个 buffer
        }
    }
}
```


## 四、Redis 方案

```java
/**
 * Redis INCR 生成 ID
 *
 * 优点：高性能，支持集群
 * 缺点：依赖 Redis，可用性需要保障
 */
public class RedisIdGenerator {

    private StringRedisTemplate redis;

    private static final String KEY_PREFIX = "id:";

    /**
     * 基础版：单 key
     */
    public long nextId(String businessType) {
        String key = KEY_PREFIX + businessType;
        return redis.opsForValue().increment(key);
    }

    /**
     * 带时间前缀的 ID
     *
     * 例如：2024032410_000001
     * 结构：年月日时分_序列号
     * 优点：可读性好，便于按时间分表
     */
    public String nextIdWithTime(String businessType) {
        LocalDateTime now = LocalDateTime.now();
        String key = KEY_PREFIX + businessType + ":" +
                     now.format(DateTimeFormatter.ofPattern("yyyyMMddHHmm"));

        // 使用 Lua 脚本保证原子性
        String script = """
            local current = redis.call('INCR', KEYS[1])
            if current == 1 then
                redis.call('EXPIRE', KEYS[1], 120)
            end
            return current
            """;

        Long sequence = redis.execute(
            new DefaultRedisScript<>(script, Long.class),
            Collections.singletonList(key)
        );

        return String.format("%s_%06d",
            now.format(DateTimeFormatter.ofPattern("yyyyMMddHHmm")),
            sequence
        );
    }

    /**
     * 集群模式：多 Key 分段
     *
     * 不同机器使用不同的 Redis key 前缀，避免竞争
     */
    public static class ClusterGenerator {

        private StringRedisTemplate redis;
        private final long machineId;
        private static final long MACHINE_COUNT = 1024;

        public long nextId(String businessType) {
            String key = "id:" + businessType + ":" + (machineId % 10);

            // Lua 脚本：INCR + 过期时间
            String luaScript = """
                local current = redis.call('INCR', KEYS[1])
                if current == 1 then
                    redis.call('EXPIRE', KEYS[1], 60)
                end
                return current
                """;

            Long sequence = redis.execute(
                new DefaultRedisScript<>(luaScript, Long.class),
                Collections.singletonList(key)
            );

            // 组装完整 ID：machineId 放低位
            return (machineId << 20) | sequence;
        }
    }
}
```


## 五、延伸问题

### 问题一：如何实现唯一 ID 同时满足「单调递增」和「随机分布」？

```
场景：有时需要 ID 既能排序，又不能被推测（安全考虑）

方案：雪花 + 混淆
- 先生成雪花 ID
- 再对 ID 做可逆的位运算混淆
- 混淆后仍是 64 位整数，可排序
```

### 问题二：如何设计订单号？

```
订单号设计要点：
├── 可读性：包含业务含义（时间、业务类型）
├── 唯一性：全局唯一
├── 安全性：不暴露业务量
└── 可追溯：能反解出下单时间、渠道等

示例：20240324105533 + 渠道码(2位) + 随机码(4位) + 序列号(6位)
```

### 问题三：雪花算法的机器 ID 如何分配？

```
方案：
1. 配置中心统一分配（如 Zookeeper）
2. 启动时自注册，用 Redis SETNX 抢占
3. 容器环境：用容器 IP 取模或哈希

推荐：机器 IP 转数字，取低 10 位
```


## 六、总结

```
┌─────────────────────────────────────────────────────┐
│            分布式 ID 生成器核心知识点                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  雪花算法                                            │
│  ├── 64 位 = 1 位符号 + 41 位时间 + 10 位机器 + 12 位序列│
│  ├── 优点：本地生成，性能高，自增有序                  │
│  └── 挑战：时钟回拨问题                              │
│                                                     │
│  数据库方案                                          │
│  ├── 批量获取，减少数据库交互                         │
│  └── 双 buffer 优化，无感知切换                       │
│                                                     │
│  Redis 方案                                         │
│  ├── INCR 原子操作                                  │
│  └── Lua 脚本保证原子性                              │
│                                                     │
│  选型建议                                            │
│  ├── 一般场景：雪花算法（推荐）                       │
│  ├── 超高并发：Redis 集群                            │
│  └── 强一致性要求：数据库批量                         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能手写雪花算法核心代码
- 能分析时钟回拨的各种解决方案
- 能说出雪花算法的优缺点和适用场景
- 能设计一个带业务含义的订单号
