# 服务限流：单机限流与分布式限流

你有没有想过这个问题：

你的服务每秒能处理 1000 个请求，但突然涌入了 10000 个请求。

如果什么都不做，结果就是：

1. 服务器 CPU 飙升
2. 响应时间暴增
3. 数据库连接池耗尽
4. 系统崩溃

这就是**流量洪峰**，限流就是来解决这个问题的。

## 为什么需要限流

限流的核心目标：**保护系统不被流量冲垮**。

```
流量来源：
1. 用户流量：秒杀、促销、热点事件
2. 爬虫流量：恶意爬取、资源消耗
3. 恶意流量：DDOS 攻击
4. 业务流量：正常业务增长
```

## 限流维度

### 1. QPS（Queries Per Second）

每秒请求数。

```java
// QPS 限流
public class QpsRateLimiter {
    private AtomicInteger count = new AtomicInteger(0);
    private final int maxQps;

    public boolean tryAcquire() {
        int current = count.incrementAndGet();
        if (current > maxQps) {
            count.decrementAndGet();
            return false;
        }
        return true;
    }
}
```

### 2. 并发数

同时处理的请求数。

```java
// 并发数限流
public class ConcurrencyLimiter {
    private Semaphore semaphore;

    public ConcurrencyLimiter(int maxConcurrency) {
        semaphore = new Semaphore(maxConcurrency);
    }

    public void execute(Runnable task) throws InterruptedException {
        semaphore.acquire();
        try {
            task.run();
        } finally {
            semaphore.release();
        }
    }
}
```

### 3. 连接数

TCP 连接数限制。

```java
// Tomcat 连接数配置
server:
  tomcat:
    max-threads: 200
    max-connections: 10000
```

## 限流算法

### 1. 计数器算法

最简单，用一个计数器统计请求数。

```java
public class CounterLimiter {
    private AtomicInteger count = new AtomicInteger(0);
    private long windowStart = System.currentTimeMillis();
    private final int maxRequests;
    private final long windowSize; // 窗口大小（毫秒）

    public boolean tryAcquire() {
        long now = System.currentTimeMillis();

        // 窗口过期，重置
        if (now - windowStart > windowSize) {
            count.set(0);
            windowStart = now;
        }

        return count.incrementAndGet() <= maxRequests;
    }
}
```

**问题**：临界突变。

```
假设窗口大小 1 秒，限流 100。

0.9s 时：99 个请求通过
1.0s 时：计数器重置
1.1s 时：又来了 99 个请求

在 0.2s 内，有 198 个请求通过（超过 100）
```

### 2. 滑动窗口算法

解决计数器算法的临界突变问题。

```java
public class SlidingWindowLimiter {
    private final long[] timestamps;
    private final int windowCount;
    private final long windowSizeInMillis;
    private int index = 0;

    public SlidingWindowLimiter(int windowCount, long windowSizeInMillis) {
        this.windowCount = windowCount;
        this.windowSizeInMillis = windowSizeInMillis;
        this.timestamps = new long[windowCount];
    }

    public synchronized boolean tryAcquire() {
        long now = System.currentTimeMillis();
        long windowStart = now - windowSizeInMillis;

        // 清理过期时间戳
        int validCount = 0;
        for (int i = 0; i < windowCount; i++) {
            if (timestamps[i] > windowStart) {
                validCount++;
            } else {
                timestamps[i] = 0;
            }
        }

        if (validCount < windowCount) {
            timestamps[index] = now;
            index = (index + 1) % windowCount;
            return true;
        }
        return false;
    }
}
```

### 3. 漏桶算法

以恒定速率处理请求。

```java
public class LeakyBucketLimiter {
    private long water = 0; // 当前水量
    private long lastTime = System.currentTimeMillis();
    private final long capacity; // 桶容量
    private final long rate; // 漏出速率（毫升/毫秒）

    public synchronized boolean tryAcquire(long requestWater) {
        long now = System.currentTimeMillis();

        // 计算漏出的水量
        long elapsed = now - lastTime;
        water = Math.max(0, water - elapsed * rate);
        lastTime = now;

        // 检查是否能加入
        if (water + requestWater <= capacity) {
            water += requestWater;
            return true;
        }
        return false;
    }
}
```

**特点**：输出速率恒定，但桶满时拒绝请求。

### 4. 令牌桶算法

以恒定速率生成令牌。

```java
public class TokenBucketLimiter {
    private double tokens;
    private long lastTime = System.currentTimeMillis();
    private final double maxTokens;
    private final double refillRate; // 每毫秒补充的令牌数

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
        double delta = (now - lastTime) * refillRate;
        tokens = Math.min(maxTokens, tokens + delta);
        lastTime = now;
    }
}
```

**特点**：允许突发流量，但有上限。

## 单机限流 vs 分布式限流

### 单机限流

```java
// 单机限流：Guava RateLimiter
RateLimiter limiter = RateLimiter.create(100); // 每秒 100 个令牌
limiter.acquire(); // 获取令牌
```

### 分布式限流

单机限流无法跨机器统计，分布式限流需要全局计数器。

```java
// Redis + Lua 实现分布式限流
String luaScript = """
    local key = KEYS[1]
    local limit = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])

    local current = tonumber(redis.call('get', key) or '0')

    if current + 1 > limit then
        return 0
    else
        redis.call('incr', key)
        if current == 0 then
            redis.call('expire', key, window)
        end
        return 1
    end
    """;
```

## 限流策略

### 1. 拒绝

直接拒绝请求。

```java
if (!limiter.tryAcquire()) {
    return ResponseEntity.status(429).body("请求过于频繁");
}
```

### 2. 降级

返回默认值。

```java
if (!limiter.tryAcquire()) {
    return getDefaultData();
}
```

### 3. 排队

等待令牌。

```java
// 最多等待 1 秒
limiter.acquire(1, 1, TimeUnit.SECONDS);
```

## 总结

限流是系统保护的重要手段：

- **限流维度**：QPS、并发数、连接数
- **限流算法**：计数器、滑动窗口、漏桶、令牌桶
- **单机 vs 分布式**：单机用内存，分布式用 Redis
- **限流策略**：拒绝、降级、排队

好的限流策略，能让系统在流量洪峰中「稳如泰山」。

**面试追问方向：**
- 令牌桶和漏桶的区别是什么？
- 如何实现滑动窗口限流？
- 分布式限流如何保证一致性？
- 如何设计一个多维度的限流策略？