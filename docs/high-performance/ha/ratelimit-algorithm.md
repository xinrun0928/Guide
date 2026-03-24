# 限流算法对比：固定窗口、滑动窗口、漏桶、令牌桶

双十一零点，你正准备下单。

页面上转圈圈，你以为是网络卡了，其实是你的请求被限流了。

「系统繁忙，请稍后再试」——这句话背后，是限流算法在发挥作用。

但问题是：**限流算法那么多，到底该用哪个？**

## 为什么需要限流

限流不是刁难用户，是保护系统的最后一道防线。

```
用户流量 → 限流器 → 保护 → 后端服务
              ▲
              │
        当流量超过系统承受能力时
        主动拒绝部分请求
```

**限流的目标**：
1. 保护系统不被过载打死
2. 保证服务质量（响应时间）
3. 公平分配资源
4. 防止恶意攻击

## 四种限流算法

### 1. 固定窗口（Fixed Window）

#### 原理

将时间划分为固定大小的窗口，在每个窗口内限制请求数量。

```
时间线：
|---------|---------|---------|---------|
0        1s       2s       3s       4s
  窗口1      窗口2      窗口3      窗口4

每个窗口内，最多处理 N 个请求
```

#### 实现

```java
public class FixedWindowRateLimiter {
    private final int maxRequests;
    private final long windowSizeMs;
    private AtomicInteger count = new AtomicInteger(0);
    private volatile long windowStart = System.currentTimeMillis();

    public FixedWindowRateLimiter(int maxRequests, long windowSizeMs) {
        this.maxRequests = maxRequests;
        this.windowSizeMs = windowSizeMs;
    }

    public boolean tryAcquire() {
        long now = System.currentTimeMillis();
        long elapsed = now - windowStart;

        // 窗口结束，重置
        if (elapsed >= windowSizeMs) {
            synchronized (this) {
                if (now - windowStart >= windowSizeMs) {
                    count.set(0);
                    windowStart = now;
                }
            }
        }

        return count.incrementAndGet() <= maxRequests;
    }
}
```

#### 问题

固定窗口有一个致命缺陷：**临界突变**。

```
假设限流：每秒 100 请求

窗口 1: [0s-1s)  收到了 100 个请求（全部通过）
窗口 2: [1s-2s)  收到了 100 个请求（全部通过）

看起来正常？错！

在 0.99s 时刻，突然涌入 100 个请求
在 1.0s 时刻，又涌入 100 个请求

这 200 个请求集中在 0.02 秒内
系统直接被打爆
```

#### 特点

- **优点**：实现简单，内存占用低
- **缺点**：存在临界突变问题，无法精确控制速率

### 2. 滑动窗口（Sliding Window）

#### 原理

滑动窗口是固定窗口的改进版，将时间线划分为更细粒度的小窗口。

```
固定窗口（1s 窗口）：
|---------|---------|---------|
0        1s       2s       3s

滑动窗口（细分 + 权重）：
|---30%---|---30%---|---30%---|---10%---|
0        0.3s     0.6s     0.9s     1s

当前时刻 0.9s，过去 1s 内的请求数：
= 30% × 窗口1 + 30% × 窗口2 + 30% × 窗口3 + 10% × 窗口4
```

#### 实现

```java
public class SlidingWindowRateLimiter {
    private final int maxRequests;
    private final long windowSizeMs;
    private final int bucketCount;
    private final AtomicInteger[] buckets;
    private final AtomicInteger currentBucket = new AtomicInteger(0);
    private volatile long lastBucketReset = System.currentTimeMillis();

    public SlidingWindowRateLimiter(int maxRequests, long windowSizeMs, int bucketCount) {
        this.maxRequests = maxRequests;
        this.windowSizeMs = windowSizeMs;
        this.bucketCount = bucketCount;

        this.buckets = new AtomicInteger[bucketCount];
        for (int i = 0; i < bucketCount; i++) {
            buckets[i] = new AtomicInteger(0);
        }
    }

    public boolean tryAcquire() {
        long now = System.currentTimeMillis();
        long elapsed = now - lastBucketReset;

        // 滑动到下一个时间桶
        if (elapsed >= windowSizeMs / bucketCount) {
            synchronized (this) {
                if (now - lastBucketReset >= windowSizeMs / bucketCount) {
                    int nextBucket = (currentBucket.get() + 1) % bucketCount;
                    buckets[nextBucket].set(0);
                    currentBucket.set(nextBucket);
                    lastBucketReset = now;
                }
            }
        }

        // 统计过去 windowSizeMs 内的请求数
        int total = 0;
        for (AtomicInteger bucket : buckets) {
            total += bucket.get();
        }

        if (total >= maxRequests) {
            return false;
        }

        buckets[currentBucket.get()].incrementAndGet();
        return true;
    }
}
```

#### 简化版：基于 Redis ZSet

```lua
-- Lua 脚本：滑动窗口限流
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])  -- 窗口大小（毫秒）
local limit = tonumber(ARGV[3])   -- 限流阈值

-- 删除过期数据
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)

-- 计算当前窗口内请求数
local count = redis.call('ZCARD', key)

if count < limit then
    -- 添加新请求
    redis.call('ZADD', key, now, now .. '-' .. math.random())
    redis.call('EXPIRE', key, window / 1000 + 1)
    return 1  -- 允许
else
    return 0  -- 拒绝
end
```

#### 特点

- **优点**：平滑过渡，精度高
- **缺点**：实现复杂，内存占用较高

### 3. 漏桶（Leaky Bucket）

#### 原理

把请求想象成水滴，请求进入漏桶，漏桶以固定速率漏水。

```
         请求
           ↓
    ┌─────────────┐
    │    漏桶     │ ← 有容量上限
    │   ○ ○ ○ ○  │
    │ ○ ○ ○ ○ ○ ○│
    └──────┬──────┘
           │ 固定速率漏出
           ↓
      处理请求
```

#### 实现

```java
public class LeakyBucketRateLimiter {
    private final long capacity;        // 桶容量
    private final double leakRate;      // 漏水速率（个/毫秒）
    private double water = 0;           // 当前水量
    private long lastLeakTime = System.currentTimeMillis();

    public LeakyBucketRateLimiter(long capacity, double requestsPerSecond) {
        this.capacity = capacity;
        this.leakRate = requestsPerSecond / 1000.0;  // 转换为每秒/毫秒
    }

    public synchronized boolean tryAcquire() {
        // 先漏水
        long now = System.currentTimeMillis();
        long elapsed = now - lastLeakTime;
        double leaked = elapsed * leakRate;

        water = Math.max(0, water - leaked);
        lastLeakTime = now;

        // 检查桶是否有空间
        if (water < capacity) {
            water++;
            return true;
        }

        return false;
    }
}
```

#### 特点

- **优点**：输出速率恒定，适合流量整形
- **缺点**：请求堆积在桶中，如果桶满则直接丢弃

### 4. 令牌桶（Token Bucket）

#### 原理

以固定速率往桶里放令牌，只有拿到令牌的请求才能处理。

```
         令牌
           ↓
    ┌─────────────┐
    │    令牌桶    │ ← 容量上限
    │   ● ● ● ●  │
    │ ● ● ● ● ● ●│
    └──────┬──────┘
           │ 取令牌
           ↓
      处理请求

令牌以固定速率放入
桶满时令牌溢出（不累积）
```

#### 实现

```java
public class TokenBucketRateLimiter {
    private final long capacity;           // 桶容量
    private final double refillRate;        // 令牌补充速率（个/毫秒）
    private volatile double tokens;         // 当前令牌数
    private volatile long lastRefillTime = System.currentTimeMillis();

    public TokenBucketRateLimiter(long capacity, double requestsPerSecond) {
        this.capacity = capacity;
        this.refillRate = requestsPerSecond / 1000.0;
        this.tokens = capacity;  // 初始满桶
    }

    public synchronized boolean tryAcquire() {
        refill();

        if (tokens >= 1) {
            tokens -= 1;
            return true;
        }

        return false;
    }

    public synchronized boolean tryAcquire(int permits) {
        refill();

        if (tokens >= permits) {
            tokens -= permits;
            return true;
        }

        return false;
    }

    private void refill() {
        long now = System.currentTimeMillis();
        double elapsed = now - lastRefillTime;
        double added = elapsed * refillRate;

        tokens = Math.min(capacity, tokens + added);
        lastRefillTime = now;
    }
}
```

#### 特点

- **优点**：允许突发流量，同时限制平均速率
- **缺点**：实现稍复杂

### Guava 实现

```java
import com.google.common.util.concurrent.RateLimiter;

public class GuavaRateLimiterExample {
    // 每秒允许 100 个请求
    private final RateLimiter limiter = RateLimiter.create(100);

    public void handleRequest(Request request) {
        // 阻塞直到获取到令牌
        limiter.acquire();

        // 执行业务逻辑
        doProcess(request);
    }

    public void handleRequestWithTimeout(Request request, long timeoutMs) {
        // 尝试获取令牌，最多等待 timeoutMs
        if (limiter.tryAcquire(timeoutMs, TimeUnit.MILLISECONDS)) {
            doProcess(request);
        } else {
            throw new RateLimitExceededException();
        }
    }
}
```

## 算法对比

| 维度 | 固定窗口 | 滑动窗口 | 漏桶 | 令牌桶 |
|------|----------|----------|------|--------|
| 实现复杂度 | 低 | 中 | 中 | 中 |
| 内存占用 | 低 | 中 | 低 | 低 |
| 限流精度 | 低 | 高 | 高 | 高 |
| 突发支持 | 不支持 | 不支持 | 不支持 | 支持 |
| 输出平滑 | 一般 | 好 | 非常平滑 | 好 |
| 临界问题 | 有 | 无 | 无 | 无 |

## 场景选择

### 固定窗口
- 简单场景
- 偶尔的突发可以接受
- 示例：简单的接口限流

### 滑动窗口
- 需要较高精度
- 不允许突发
- 示例：API 限流

### 漏桶
- 需要严格控制输出速率
- 不允许突发
- 示例：对外 API 调用、第三方接口调用

### 令牌桶
- 需要允许适度突发
- 控制平均速率
- 示例：用户请求限流

## 组合策略

实际应用中，通常组合多种策略：

```java
public class MultiLayerRateLimiter {

    // 第一层：令牌桶（控制总量）
    private final TokenBucketRateLimiter globalLimiter =
        new TokenBucketRateLimiter(10000, 10000);  // 每秒 1 万请求

    // 第二层：滑动窗口（用户维度）
    private final Map<String, SlidingWindowRateLimiter> userLimiters =
        new ConcurrentHashMap<>();

    // 第三层：固定窗口（接口维度）
    private final Map<String, FixedWindowRateLimiter> apiLimiters =
        new ConcurrentHashMap<>();

    public boolean tryAcquire(String userId, String api) {
        // 全局限流
        if (!globalLimiter.tryAcquire()) {
            return false;
        }

        // 用户限流
        SlidingWindowRateLimiter userLimiter = userLimiters.computeIfAbsent(
            userId, k -> new SlidingWindowRateLimiter(100, 1000, 10));
        if (!userLimiter.tryAcquire()) {
            return false;
        }

        // 接口限流
        FixedWindowRateLimiter apiLimiter = apiLimiters.computeIfAbsent(
            api, k -> new FixedWindowRateLimiter(1000, 1000));
        return apiLimiter.tryAcquire();
    }
}
```

---

**思考题：**

假设你的系统在双十一期间需要限流，平时每秒 1000 请求，双十一峰值可能达到每秒 50000 请求。

问题：
1. 如果使用令牌桶限流，桶容量设置为多少合适？补充速率设置为多少？
2. 如果使用漏桶限流，请求会被堆积在桶中，如果桶也满了怎么办？
3. 如果让你设计一个「弹性限流」——平时宽松，活动期间严格，你会怎么做？
4. 限流后的请求该如何处理？直接拒绝？排队？还是返回特定错误码？

提示：考虑用户体验、系统保护、以及业务连续性。
