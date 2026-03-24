# Redisson 信号量（Semaphore）与 CountDownLatch

你有没有想过这样的场景：

- 餐厅有 50 个座位，不能让 51 个人同时进来
- 线程池有 10 个线程，但有 100 个任务要执行
- 批量处理 1000 条数据，等所有数据都处理完了再汇总

这些场景的核心问题是：**限制并发数**或**等待一组任务完成**。

Java SE 里有 `Semaphore` 和 `CountDownLatch`，Redisson 把它们也搬到了 Redis 上。

## 信号量（Semaphore）

### 什么是信号量

信号量（Semaphore）控制**同时访问某个资源的线程数量**。

```
信号量计数 = 5
线程A: 获取 -> 计数变为 4 ✓
线程B: 获取 -> 计数变为 3 ✓
线程C: 获取 -> 计数变为 2 ✓
线程D: 获取 -> 计数变为 1 ✓
线程E: 获取 -> 计数变为 0 ✓
线程F: 获取 -> 计数为 0，阻塞等待...
```

每当一个线程「获取」信号量，计数减 1。计数为 0 时，其他线程必须等待。

### RedissonSemaphore API

```java
public interface RSemaphore extends Expirable {
    
    /**
     * 获取信号量，阻塞直到成功
     */
    void acquire();
    
    /**
     * 获取信号量，最多等待指定时间
     * @param permits 获取的数量
     */
    void acquire(long permits);
    
    /**
     * 尝试获取信号量，非阻塞
     * @return 是否获取成功
     */
    boolean tryAcquire();
    
    /**
     * 尝试获取信号量
     * @param permits 数量
     * @param waitTime 等待时间
     * @param unit 时间单位
     * @return 是否获取成功
     */
    boolean tryAcquire(long permits, long waitTime, TimeUnit unit);
    
    /**
     * 释放信号量，计数增加
     */
    void release();
    
    /**
     * 释放信号量
     * @param permits 数量
     */
    void release(long permits);
    
    /**
     * 获取当前可用计数
     */
    int availablePermits();
}
```

### 场景一：连接池限流

模拟一个数据库连接池，限制最多 5 个并发连接：

```java
public class ConnectionPool {
    
    private final RedissonClient redisson;
    
    public ConnectionPool(RedissonClient redisson) {
        this.redisson = redisson;
    }
    
    public &lt;T&gt; T executeWithConnection(ConnectionCallback&lt;T&gt; callback) {
        RSemaphore semaphore = redisson.getSemaphore("db:connection:pool");
        
        try {
            // 获取连接许可（阻塞直到有空闲连接）
            semaphore.acquire();
            
            try {
                // 模拟获取数据库连接
                Connection conn = getConnection();
                return callback.execute(conn);
            } finally {
                // 释放连接
                semaphore.release();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("获取连接被中断", e);
        }
    }
    
    private Connection getConnection() {
        return new Connection();  // 模拟
    }
    
    @FunctionalInterface
    public interface ConnectionCallback&lt;T&gt; {
        T execute(Connection conn);
    }
}
```

初始化连接池：

```java
// 在应用启动时设置信号量初始值
RSemaphore semaphore = redisson.getSemaphore("db:connection:pool");
semaphore.trySetPermits(5);  // 最多 5 个并发连接
```

### 场景二：接口并发数限制

限制某个接口最多 100 并发：

```java
public class RateLimiter {
    
    private final RedissonClient redisson;
    private static final int MAX_CONCURRENT = 100;
    
    public RateLimiter(RedissonClient redisson) {
        this.redisson = redisson;
    }
    
    public &lt;T&gt; T execute(String endpoint, Supplier&lt;T&gt; task) {
        RSemaphore semaphore = redisson.getSemaphore("rate:limit:" + endpoint);
        
        // 初始化信号量
        semaphore.trySetPermits(MAX_CONCURRENT);
        
        if (!semaphore.tryAcquire(5, TimeUnit.SECONDS)) {
            throw new TooManyRequestsException("请求过于频繁，请稍后重试");
        }
        
        try {
            return task.get();
        } finally {
            semaphore.release();
        }
    }
}
```

### Redis 内部实现

```lua
-- 获取信号量
-- KEYS[1] = 信号量 key
-- ARGV[1] = 申请的数量

local current = tonumber(redis.call('get', KEYS[1]) or 0)
local permits = tonumber(ARGV[1])

if current >= permits then
    return 0  -- 库存不足
end

current = current + permits
redis.call('set', KEYS[1], current)
return 1
```

## CountDownLatch

### 什么是 CountDownLatch

CountDownLatch 是一种**倒计时门闩**机制。

```
计数 = 3
线程A: await() -> 阻塞，等待计数归零
线程B: countDown() -> 计数变为 2
线程C: countDown() -> 计数变为 1
线程D: countDown() -> 计数变为 0，线程A 被唤醒
```

N 个线程调用 `countDown()` 后，等待的线程才会继续执行。

### RedissonCountDownLatch API

```java
public interface RCountDownLatch extends Expirable {
    
    /**
     * 等待计数归零
     * @throws InterruptedException 如果等待被中断
     */
    void await() throws InterruptedException;
    
    /**
     * 等待计数归零
     * @param timeout 最大等待时间
     * @param unit 时间单位
     * @return 是否等到计数归零（false 表示超时）
     */
    boolean await(long timeout, TimeUnit unit) throws InterruptedException;
    
    /**
     * 计数减 1
     */
    void countDown();
    
    /**
     * 获取当前计数
     */
    long getCount();
}
```

### 场景一：批量任务完成后汇总

```java
public class BatchProcessor {
    
    private final RedissonClient redisson;
    
    public BatchProcessor(RedissonClient redisson) {
        this.redisson = redisson;
    }
    
    /**
     * 批量处理任务，等待所有任务完成后汇总结果
     */
    public BatchResult processBatch(List&lt;Task&gt; tasks) {
        String latchKey = "batch:latch:" + UUID.randomUUID();
        RCountDownLatch latch = redisson.getCountDownLatch(latchKey);
        
        // 初始化计数为任务数量
        latch.trySetCount(tasks.size());
        
        List&lt;TaskResult&gt; results = Collections.synchronizedList(new ArrayList&lt;&gt;());
        
        // 提交所有任务
        for (Task task : tasks) {
            executor.submit(() -> {
                try {
                    TaskResult result = processTask(task);
                    results.add(result);
                } finally {
                    latch.countDown();  // 任务完成，计数 -1
                }
            });
        }
        
        try {
            // 等待所有任务完成
            latch.await(5, TimeUnit.MINUTES);
            return new BatchResult(results, true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return new BatchResult(results, false);
        }
    }
    
    private TaskResult processTask(Task task) {
        // 处理任务
        return new TaskResult();
    }
}
```

### 场景二：服务启动时等待依赖服务

```java
public class ServiceStarter {
    
    private final RedissonClient redisson;
    
    /**
     * 等待依赖服务就绪
     */
    public void waitForDependencies(List&lt;String&gt; serviceNames) throws InterruptedException {
        String latchKey = "service:startup:latch";
        RCountDownLatch latch = redisson.getCountDownLatch(latchKey);
        
        latch.trySetCount(serviceNames.size());
        
        // 各服务启动后调用
        for (String service : serviceNames) {
            RCountDownLatch serviceLatch = redisson.getCountDownLatch("service:" + service);
            serviceLatch.countDown();
        }
        
        // 等待所有服务就绪
        if (!latch.await(30, TimeUnit.SECONDS)) {
            throw new ServiceStartupException("部分服务启动超时");
        }
    }
}
```

### Redis 内部实现

```lua
-- countDown
local count = redis.call('decr', KEYS[1])

if count <= 0 then
    redis.call('del', KEYS[1])
end

return count
```

## Semaphore vs CountDownLatch

| 特性 | Semaphore | CountDownLatch |
|------|-----------|----------------|
| 用途 | 限流，控制并发数 | 等待一组任务完成 |
| 计数变化 | 手动 acquire/release | 只减不减（countDown） |
| 能否重置 | 不能 | 不能 |
| 可重复使用 | 可以（释放后计数恢复） | 不能（计数归零后失效） |
| 典型场景 | 连接池、接口限流 | 批量任务汇总、服务启动等待 |

## 常见问题

### Q: Semaphore 计数为 0 后会怎样？

A: 所有 `acquire()` 都会阻塞，直到有 `release()` 增加计数。

### Q: CountDownLatch 计数归零后能重用吗？

A: 不能。计数归零后 `await()` 会立即返回，之后的 `countDown()` 不起作用。如果需要重用，用 Semaphore。

### Q: 如果持有 Semaphore 的线程崩溃了怎么办？

A: 计数不会自动恢复，这就是「信号量泄漏」。解决方案是给 Semaphore 设置 TTL，或者使用看门狗机制。

## 面试追问方向

- Semaphore 和 synchronized/Lock 有什么区别？
- Semaphore 可以实现公平和非公平吗？
- CountDownLatch 和 Thread.join() 有什么区别？
- 如果 CountDownLatch 的计数配置错了（比实际任务数多），会怎样？

## 总结

Semaphore 和 CountDownLatch 是分布式环境下控制并发和等待的工具：

- **Semaphore**：限流神器，控制同时执行的最大并发数
- **CountDownLatch**：等待 N 个线程完成后再继续，适合批量任务汇总

这两个工具看似简单，但在实际业务中用途广泛——限流、批量处理、服务协调，都离不开它们。
