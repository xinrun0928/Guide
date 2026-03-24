# 分布式 ID 生成算法：UUID、雪花算法（Snowflake）、Tweedie

双十一零点，你的订单号是「20231111000000000001」，下一秒的订单号是「20231111000000000002」——这看起来理所当然，对吧？

但如果订单系统部署在 10 台服务器上，每台机器都在生成订单号，你怎么保证这两台机器生成的 ID 不会重复？

**这才是分布式 ID 的本质问题：如何在分布式环境下生成全局唯一且有序的 ID。**

---

## 分布式 ID 的四大要求

在开始讲算法之前，先明确标准：

| 要求 | 说明 |
|-----|------|
| **全局唯一** | 跨机器、跨机房、跨数据中心都不重复 |
| **趋势递增** | 新 ID 比旧 ID 大（对索引友好，减少 B+ 树分裂） |
| **高性能** | QPS 要高，不能成为系统瓶颈 |
| **高可用** | 不能有单点故障 |

这四个要求有时候会互相矛盾，比如 UUID 天然唯一但无序，雪花算法有序但依赖时钟。选型就是在这几个约束下做 trade-off。

---

## UUID：最简单但不完美

UUID（Universally Unique Identifier）是最古老的分布式 ID 方案，格式是 128 位的十六进制字符串，形如：

```
550e8400-e29b-41d4-a716-446655440000
```

**UUID v1**：基于时间戳 + MAC 地址生成，趋势递增，但暴露了机器的 MAC 地址，有隐私风险。

**UUID v4**：基于随机数生成，完全不依赖任何中心化组件，但：

- **无序**：随机插入对数据库索引不友好
- **存储空间大**：36 个字符，比 8 字节的长整型大了 4.5 倍
- **查询效率低**：字符串比较比整数比较慢

```java
// UUID v4 的问题
public class UuidProblem {
    public static void main(String[] args) {
        String id1 = UUID.randomUUID().toString();
        String id2 = UUID.randomUUID().toString();
        // 字符串比较，索引效率低
        System.out.println(id1.compareTo(id2)); // 字符串字典序比较
    }
}
```

UUID 适合的场景：文件名、会话 ID、不需要排序的唯一标识。不适合作为订单号、交易流水号这类需要数据库存储和检索的 ID。

---

## 雪花算法（Snowflake）：工业级标准

Twitter 在 2014 年开源了 Snowflake，成为分布式 ID 领域的工业标准。它的核心思想是**把 64 位拆成多个段，每段表示不同的含义**：

```
+--------------------------------------------------------------------+
| 1bit 符号位 | 41bit 时间戳 | 10bit 机器ID | 12bit 序列号           |
+--------------------------------------------------------------------+
```

- **1bit**：固定为 0，因为 ID 要是非负数
- **41bit 时间戳**：毫秒级时间戳，可用 69 年（2^41 / (365*24*60*60*1000)）
- **10bit 机器 ID**：最多支持 1024 台机器
- **12bit 序列号**：每毫秒内每台机器最多生成 4096 个 ID

```java
public class SnowflakeIdGenerator {
    // 起始时间戳：2020-01-01
    private final long twepoch = 1577836800000L;

    // 各段的位数
    private final long workerIdBits = 10L;
    private final long sequenceBits = 12L;

    // 各段的最大值
    private final long maxWorkerId = ~(-1L << workerIdBits); // 1023
    private final long maxSequence = ~(-1L << sequenceBits); // 4095

    // 各段的位移
    private final long workerIdShift = sequenceBits;
    private final long timestampShift = workerIdBits + sequenceBits;

    private final long workerId;
    private long sequence = 0L;
    private long lastTimestamp = -1L;

    public SnowflakeIdGenerator(long workerId) {
        if (workerId > maxWorkerId || workerId < 0) {
            throw new IllegalArgumentException("Worker ID 超出范围");
        }
        this.workerId = workerId;
    }

    public synchronized long nextId() {
        long timestamp = timeGen();

        // 时钟回拨检测
        if (timestamp < lastTimestamp) {
            throw new RuntimeException("时钟回拨，不允许生成 ID");
        }

        // 同一毫秒内，序列号 +1
        if (timestamp == lastTimestamp) {
            sequence = (sequence + 1) & maxSequence;
            if (sequence == 0) {
                // 序列号用完，等下一毫秒
                timestamp = tilNextMillis(lastTimestamp);
            }
        } else {
            sequence = 0L;
        }

        lastTimestamp = timestamp;

        return ((timestamp - twepoch) << timestampShift)
                | (workerId << workerIdShift)
                | sequence;
    }

    protected long tilNextMillis(long lastTimestamp) {
        long timestamp = timeGen();
        while (timestamp <= lastTimestamp) {
            timestamp = timeGen();
        }
        return timestamp;
    }

    protected long timeGen() {
        return System.currentTimeMillis();
    }
}
```

雪花算法的优点：趋势递增、高性能（本地生成，无网络开销）、高可用（不依赖外部组件）。

---

## 雪花算法的三大问题

但雪花算法不是银弹，实际使用中有三个经典问题：

### 1. 时钟回拨

如果机器的时间被 NTP 回调到过去，`timestamp < lastTimestamp`，直接抛异常——**服务直接不可用**。

这是生产环境最常见的问题。

### 2. 依赖机器时钟

雪花算法强依赖本机时钟，如果时钟漂移严重，或者多台机器时钟不一致，都会出问题。

### 3. 趋势递增但不是严格递增

跨毫秒时 ID 会跳跃，中间可能有空洞。严格递增在某些场景下是必要的。

---

## 解决方案：Tweedle 与第三方框架

**Tweedle** 是对雪花算法的改进，引入了「本地时间 + 逻辑递增」机制，不再强依赖物理时钟，即使时钟回拨也能继续生成 ID（通过记录上次生成的逻辑时间）。

业界成熟的分布式 ID 框架：

| 框架 | 公司 | 特点 |
|-----|------|------|
| **美团 Leaf** | 美团 | 支持雪花算法 + 号段模式，双保险 |
| **百度 UidGenerator** | 百度 | 基于 RingBuffer，性能更高 |
| **滴滴 TicId** | 滴滴 | 解决了时钟依赖问题 |

```java
// 美团 Leaf 的号段模式核心思想
public class SegmentIdGenerator {
    private AtomicLong currentId = new AtomicLong(0);
    private AtomicLong maxId = new AtomicLong(0);
    private long step = 1000; // 每次从数据库领 1000 个 ID

    public long nextId() {
        if (currentId.get() >= maxId.get()) {
            // 领新的号段
            long newMax = currentId.get() + step;
            if (maxId.compareAndSet(maxId.get(), newMax)) {
                currentId.set(maxId.get() - step);
            }
        }
        return currentId.incrementAndGet();
    }
}
```

---

## 面试追问方向

面试官最常问的问题：**雪花算法时钟回拨怎么处理？**

标准答案分三个层次：

**第一层（能回答）：**
- 预留一个「兜底时间」：如果回拨时间在 5ms 内，等待时间追上后再生成
- 直接抛异常，服务降级

**第二层（能讲清楚）：**
- 使用美团 Leaf 的号段模式：每次从数据库领一段 ID，回拨不影响已领取的 ID
- 使用百度 UidGenerator 的 RingBuffer：用数组做环形 buffer，异步预加载

**第三层（能讲 trade-off）：**
- 没有完美的方案，只有适合业务的方案
- 时钟回拨是小概率事件，大部分公司用「检测到回拨就拒绝服务」就够了
- 如果业务不能容忍，再考虑号段模式（但号段模式的问题是 ID 不连续）

---

## 留给你的问题

雪花算法的时间戳部分用了 41 位，可以用 69 年。但实际业务中，69 年还没到，你的公司可能已经倒闭了。

所以真正的限制可能是：**机器 ID 只能用 10 位，最多 1024 台机器**。

如果你的系统要扩展到 1024 台机器以上怎么办？

这个问题值得你去看看美团 Leaf 和百度 UidGenerator 的源码。