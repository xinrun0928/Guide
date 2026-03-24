# 分布式系统性能指标：QPS、RT、并发数、TPS

你在双十一零点秒杀，一件商品 10000 件，1 秒售罄。

系统是怎么知道「扛不住」的？

不是靠直觉，是靠**性能指标**。

QPS、RT、并发数、TPS——这四个指标是分布式系统性能分析的基础。但很多人对它们的理解是模糊的。

**今天把这四个概念讲透。**

---

## QPS：每秒查询数

QPS（Queries Per Second）是**每秒处理的请求数量**。

```java
public class QPSCalculator {
    private final AtomicLong counter = new AtomicLong(0);
    private final long windowMs;

    public QPSCalculator(long windowMs) {
        this.windowMs = windowMs;
    }

    // 每来一个请求，计数 +1
    public void recordRequest() {
        counter.incrementAndGet();
    }

    // 计算窗口内的 QPS
    public double calculateQPS() {
        long count = counter.getAndSet(0);
        return count * 1000.0 / windowMs;
    }
}
```

QPS 衡量的是**系统的吞吐能力**。

- 10 QPS：每秒处理 10 个请求
- 10000 QPS：每秒处理 10000 个请求
- 100 万 QPS：像淘宝双十一的峰值

---

## RT：响应时间

RT（Response Time）是**单个请求从发起到收到响应的时间**。

RT 有三个重要指标：

### 平均响应时间（Average RT）

所有请求响应时间的平均值。

```java
public class AverageRT {
    private final AtomicLong totalTime = new AtomicLong(0);
    private final AtomicLong count = new AtomicLong(0);

    public void record(long rtMs) {
        totalTime.addAndGet(rtMs);
        count.incrementAndGet();
    }

    public double getAverage() {
        long c = count.get();
        return c == 0 ? 0 : totalTime.get() / (double) c;
    }
}
```

**平均响应时间的坑**：被极端值拉平，看不出真实情况。

### 分位值（P50/P90/P99）

| 分位值 | 含义 |
|--------|------|
| **P50** | 50% 的请求响应时间低于此值 |
| **P90** | 90% 的请求响应时间低于此值 |
| **P99** | 99% 的请求响应时间低于此值 |

```java
public class PercentileRT {
    private final LongAdder[] buckets;
    private final int bucketSize;
    private final int maxTime;

    public PercentileRT(int maxTimeMs, int bucketSize) {
        this.maxTime = maxTimeMs;
        this.bucketSize = bucketSize;
        this.buckets = new LongAdder[bucketSize + 1];
        for (int i = 0; i <= bucketSize; i++) {
            buckets[i] = new LongAdder();
        }
    }

    public void record(long rtMs) {
        int index = (int) Math.min(rtMs * bucketSize / maxTime, bucketSize);
        buckets[index].increment();
    }

    public double getPercentile(double p) {
        long total = 0;
        for (LongAdder bucket : buckets) {
            total += bucket.sum();
        }
        long target = (long) (total * p);
        long cumulative = 0;
        for (int i = 0; i <= bucketSize; i++) {
            cumulative += buckets[i].sum();
            if (cumulative >= target) {
                return (double) i * maxTime / bucketSize;
            }
        }
        return maxTime;
    }
}
```

**为什么要看 P99 而不是平均 RT？**

因为 P99 代表「最差的那 1%」，而最差的请求往往决定用户体验。

---

## 并发数（Concurrent Users）

并发数是**同时在处理中的请求数量**，也叫「并发连接数」。

关键点：**并发数和 QPS 不是一回事**。

```java
public class ConcurrencyDemo {
    public static void main(String[] args) {
        // 场景 1：QPS = 100，RT = 100ms
        // 并发数 = 100 * 0.1 = 10

        // 场景 2：QPS = 100，RT = 1000ms
        // 并发数 = 100 * 1 = 100

        // QPS 相同，RT 越长，并发数越高
    }
}
```

公式：**并发数 = QPS × 平均 RT（秒）**

这个公式揭示了一个重要关系：

- **低 QPS + 高 RT = 高并发**（比如复杂的数据库查询）
- **高 QPS + 低 RT = 低并发**（比如简单的缓存查询）

---

## TPS：每秒事务数

TPS（Transactions Per Second）**通常指业务事务数量**，和 QPS 有所区别。

| 场景 | QPS vs TPS |
|------|------------|
| 查询接口 | QPS = TPS（一个请求 = 一个事务） |
| 下单接口 | TPS = 1，但可能调用 5 个服务，QPS = 5 |
| 批量操作 | 1 个请求处理 100 条数据，QPS = 1，TPS = 100 |

在 OLTP（在线事务处理）场景下，TPS 是衡量数据库性能的核心指标。

---

## 性能拐点：当并发数超过容量

分布式系统有一个重要现象：**性能拐点**。

```
响应时间
    │
    │           /
    │          /
    │         /    ← 拐点之后 RT 急剧上升
    │        /
    │       /
    │      /
    │_____/____________________
         ↑        并发数
```

当并发数超过系统容量时：
- 请求开始排队
- RT 急剧上升
- 系统资源（线程池、连接池）耗尽
- 可能引发雪崩

---

## 性能压测方法：找到系统拐点

压测的目标是**找到系统的容量边界**。

### 阶梯式加压

```java
public class LoadTest {
    public static void main(String[] args) {
        // 从 100 并发开始，每阶段增加 100 并发
        for (int concurrency = 100; concurrency <= 1000; concurrency += 100) {
            System.out.println("测试并发数: " + concurrency);
            Metrics metrics = runLoadTest(concurrency, 60_000); // 运行 1 分钟

            System.out.println("QPS: " + metrics.getQPS());
            System.out.println("平均 RT: " + metrics.getAverageRT() + "ms");
            System.out.println("P99 RT: " + metrics.getP99RT() + "ms");

            // 如果 P99 RT 超过阈值，认为到达拐点
            if (metrics.getP99RT() > 500) {
                System.out.println("拐点到达！建议扩容或优化。");
                break;
            }
        }
    }
}
```

### 判断拐点的标准

| 指标 | 正常 | 拐点信号 |
|------|------|----------|
| P99 RT | < 100ms | > 500ms，持续上升 |
| 错误率 | < 0.1% | > 1%，持续上升 |
| CPU 使用率 | < 70% | > 90% |
| 线程活跃数 | 稳定 | 持续增长 |

---

## 性能调优的三个方向

### 方向一：增加资源

最简单粗暴的方式。

- 扩容：增加机器
- 升级：换更高配置的机器
- 垂直扩展 vs 水平扩展

### 方向二：优化链路

找到瓶颈点，针对性优化。

常见瓶颈：
- 数据库慢查询（加索引、SQL 优化）
- 外部 API 调用（缓存、异步化）
- 序列化/反序列化（换更快的序列化协议）

### 方向三：削峰填谷

把流量在时间维度上重新分配。

- 限流：拒绝超出容量的请求
- 排队：把请求放到消息队列，慢慢处理
- 异步化：用户请求立即返回，后台异步处理

---

## 面试追问方向

**QPS 和 TPS 的区别是什么？**

QPS 是查询数，TPS 是事务数。一个事务可能包含多个查询。

**P99 RT 和平均 RT 哪个更重要？**

P99 更重要。因为它代表「最差的那 1% 用户」体验，而这部分用户往往是核心用户。

**系统突然变慢了，怎么排查？**

1. 看监控：RT 分布、QPS、资源使用率
2. 看日志：有没有错误、慢查询
3. 看链路：哪个环节耗时最长
4. 做压测：确认是不是容量问题

**「系统能抗住 10000 QPS」这句话有什么坑？**

坑在于没说 RT。10000 QPS + RT 1ms 和 10000 QPS + RT 1000ms 是完全不同的系统。

---

## 留给你的问题

性能调优有个经典比喻：「用木桶理论找短板」。

系统性能取决于最慢的那个环节。你觉得，在你的系统里，最有可能的短板是什么？

是数据库？是缓存？是网络？是业务逻辑？

找到短板，才是性能优化的正确姿势。