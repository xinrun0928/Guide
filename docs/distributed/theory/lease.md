# Lease 机制与租约

你租了一辆车，租期 24 小时。

这意味着：在接下来 24 小时内，这辆车归你用，别人不能开。24 小时后，如果我没续租，我得把车还给你。

**Lease（租约）的本质就是这个概念：在某个时间窗口内授予的访问权限承诺。**

这个概念看似简单，但在分布式系统中，它解决了一个非常棘手的问题。

---

## 为什么需要 Lease

分布式系统里有一个经典问题：**缓存一致性**。

假设有 3 台缓存服务器，缓存了同一份数据。当数据源（数据库）更新了数据，3 台缓存服务器怎么知道自己的缓存已经过期了？

最简单的做法：设置 TTL（Time To Live）。缓存数据 5 分钟后过期，5 分钟后重新从数据库读取。

但 TTL 有个问题：**数据源更新了，但缓存还没过期，这 5 分钟内所有请求读到的都是脏数据**。

Lease 的思路不同：缓存服务器持有的是「数据源授予的临时访问权」，**数据源可以随时撤销这个权限**。

```java
public class Lease {
    private final long issuedAt;       // 租约发放时间
    private final long durationMs;     // 租约有效期（毫秒）

    public Lease(long durationMs) {
        this.issuedAt = System.currentTimeMillis();
        this.durationMs = durationMs;
    }

    // 检查租约是否还有效
    public boolean isValid() {
        return System.currentTimeMillis() - issuedAt < durationMs;
    }

    // 剩余时间
    public long remainingMs() {
        return Math.max(0, durationMs - (System.currentTimeMillis() - issuedAt));
    }

    // 数据源撤销租约（模拟）
    public static Lease revoke() {
        // 返回一个已过期的租约
        return new Lease(-1);
    }
}
```

---

## Lease vs TTL：两个不同的概念

很多人把 Lease 和 TTL 混为一谈，这是错误的。

| 特性 | TTL | Lease |
|------|-----|-------|
| **发放方式** | 数据自己带着，过期时间写在数据里 | 数据源主动发放给持有者 |
| **过期含义** | 数据「已经」过期，持有者可能不知道 | 持有者知道「我的权限何时到期」 |
| **可撤销** | 不能撤销，只能等过期 | 可以主动撤销，立刻生效 |
| **主动通知** | 无 | 有（通过撤销通知） |

简单来说：**TTL 是被动的过期，Lease 是主动的授权**。

---

## Lease 的三个关键特性

### 1. 有时间限制

租约总是在时间窗口内有效的，过期后权限自动失效。这避免了「永久锁」导致的系统死锁。

### 2. 可验证

持有者可以随时检查自己的租约是否还有效，不需要询问数据源。

### 3. 可撤销

数据源可以在租约到期前主动撤销。撤销后，持有者立刻失去访问权限。

这三个特性组合起来，使得 Lease 非常适合做**分布式锁续期**。

---

## 应用场景

### 分布式缓存

当数据源（数据库）更新了数据，它会向所有持有相关缓存 Lease 的缓存服务器发送「撤销 Lease」消息。

```java
public class CacheManager {
    private Map<String, Lease> cachedLeases = new ConcurrentHashMap<>();
    private Map<String, Object> cachedData = new ConcurrentHashMap<>();

    // 客户端获取数据
    public Object get(String key) {
        Lease lease = cachedLeases.get(key);
        // 如果没有租约或租约已过期，从数据源读取
        if (lease == null || !lease.isValid()) {
            Object data = loadFromDatabase(key);
            cachedData.put(key, data);
            cachedLeases.put(key, new Lease(5 * 60 * 1000)); // 5分钟租约
            return data;
        }
        return cachedData.get(key);
    }

    // 数据源更新数据，主动撤销 Lease
    public void update(String key, Object newData) {
        cachedLeases.put(key, Lease.revoke()); // 立刻撤销
        // 实际场景中，需要通知所有缓存服务器
    }
}
```

### ZooKeeper 的 Session Lease

ZooKeeper 用 Lease 做会话管理。客户端与 ZooKeeper 保持心跳，心跳续期相当于「续租」。

```java
public class ZKSession {
    private long sessionId;
    private Lease sessionLease;
    private ScheduledExecutorService heartbeatExecutor;

    public void startHeartbeat() {
        heartbeatExecutor.scheduleAtFixedRate(() -> {
            // 心跳 = 续租
            sessionLease = new Lease(30 * 1000); // 新的 30 秒租约
            sendPing(); // 实际的心跳请求
        }, 0, 10, TimeUnit.SECONDS);
    }

    // 如果心跳中断，租约自动失效，ZooKeeper 知道客户端已离线
}
```

### Chubby 的租约锁

Google Chubby 是早期的分布式锁服务，它用租约实现锁的自动释放。如果锁持有者崩溃了，租约到期后锁自动释放，其他客户端可以获取锁。

---

## Lease 的容错处理

Lease 机制有一个容易被忽视的问题：**网络延迟导致的误判**。

场景：
1. 客户端持有 Lease，Lease 有效期到 T
2. T - 1ms，网络拥塞，续租消息还没到达
3. T + 1ms，客户端以为 Lease 已过期，但实际上数据源还认为它有效

这叫做「 Lease 误判」问题。

**解决方案**：

1. **预留缓冲时间**：租约有效期设为 30 秒，但客户端在 25 秒时就续租
2. **乐观续租**：即使认为 Lease 已过期，也尝试续租，服务器端做幂等处理
3. **延迟检测**：检测到 Lease 可能过期后，等待一个「争议期」再做判断

```java
public class LeaseWithBuffer {
    private static final long LEASE_DURATION_MS = 30_000;
    private static final long BUFFER_MS = 5_000; // 5秒缓冲

    private Lease currentLease;

    public void startRenewing() {
        // 在 Lease 到期前 5 秒开始续租
        long renewInterval = LEASE_DURATION_MS - BUFFER_MS;
        ScheduledExecutorService executor = Executors.newSingleThreadScheduledExecutor();
        executor.scheduleAtFixedRate(() -> {
            if (currentLease != null && currentLease.remainingMs() < BUFFER_MS) {
                renew();
            }
        }, renewInterval, renewInterval, TimeUnit.MILLISECONDS);
    }

    private void renew() {
        // 发送续租请求
    }
}
```

---

## 面试追问方向

**Lease 机制和分布式锁有什么区别？**

分布式锁关注的是「谁持有锁」，Lease 关注的是「授权在什么时间内有效」。

Lease 可以用来实现分布式锁（比如 Chubby），但 Lease 的用途更广：缓存一致性、Session 管理、资源分配都可以用。

**如果 Lease 持有者崩溃了，数据源怎么知道？**

数据源通过「超时」来判断。如果 Lease 到期了还没有收到持有者的任何消息，就认为持有者已经离线，主动撤销权限。

**Lease 机制能保证 CAP 中的哪个？**

Lease 机制本身不保证一致性或可用性，它只是一种「带时间限制的授权」机制。用 Lease 做缓存一致性时，如果数据源频繁撤销 Lease，会导致缓存命中率下降，但这不会导致系统不可用——CAP 取决于具体实现。

---

## 留给你的问题

Lease 机制的核心假设是：**时间同步是可靠的**。

但在分布式系统中，时间同步本身就是个问题（还记得之前讲的时钟问题吗？）。如果两台机器的时钟偏差超过 1 秒，Lease 的语义就会出现问题。

**你有什么想法，可以在时钟不完全同步的情况下，让 Lease 机制依然工作？**

提示：这和向量时钟的思想有某种相似之处。