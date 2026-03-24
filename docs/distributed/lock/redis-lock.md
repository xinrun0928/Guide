# Redis 分布式锁：SETNX + EXPIRE 的原子性问题

你可能见过这样的代码：

```java
public class BadLockExample {
    private final Jedis jedis;

    public boolean lock(String key) {
        // 第一步：尝试获取锁
        Long result = jedis.setnx(key, "locked");
        if (result == 1) {
            // 第二步：设置过期时间
            jedis.expire(key, 30);
            return true;
        }
        return false;
    }
}
```

看起来很合理：`SETNX` 获取锁，`EXPIRE` 设置 TTL。功能上完全没问题。

但我想问你一个问题：**如果第一步成功（返回 1），第二步还没执行，进程突然崩溃了，怎么办？**

恭喜你，你的锁永远不会过期了。这就是经典的**死锁问题**。

## SETNX + EXPIRE 不是原子的

Redis 的每条命令都是原子的，但**两条命令组合在一起就不是原子的**了。

问题出在哪里？

```
时刻 T1: 客户端A 执行 SETNX key "A"，返回 1（成功）
时刻 T2: 客户端A 进程崩溃，还没来得及执行 EXPIRE
时刻 T3: key 永远存在，锁永远不会释放
时刻 T4: 客户端B 永远获取不到这把锁
```

这是一个经典的分布式系统问题：**命令之间的空隙（Gap）**。

## 解决方案一：Lua 脚本（Redis 2.6.12 之前）

把 SETNX 和 EXPIRE 合并成一条 Lua 脚本执行：

```lua
-- lock.lua
if redis.call('setnx', KEYS[1], ARGV[1]) == 1 then
    redis.call('expire', KEYS[1], ARGV[2])
    return 1
else
    return 0
end
```

```java
public boolean lock(Jedis jedis, String key, String value, int seconds) {
    String script = 
        "if redis.call('setnx', KEYS[1], ARGV[1]) == 1 then " +
        "    redis.call('expire', KEYS[1], ARGV[2]) " +
        "    return 1 " +
        "else " +
        "    return 0 " +
        "end";
    
    Long result = (Long) jedis.eval(script, 1, key, value, String.valueOf(seconds));
    return result != null && result == 1;
}
```

这样两步操作变成了一步，消除了 Gap。

## 解决方案二：SET 命令（Redis 2.6.12+，推荐）

Redis 2.6.12 引入了 SET 命令的扩展参数，可以一步到位：

```java
public boolean lock(Jedis jedis, String key, String value, int seconds) {
    // SET key value NX EX seconds
    // NX: 只有 key 不存在时才设置（等价于 SETNX）
    // EX: 设置过期时间（秒）
    String result = jedis.set(key, value, "NX", "EX", seconds);
    return "OK".equals(result);
}
```

这是目前**最推荐**的写法，一条命令搞定所有。

同样有 PX 选项设置毫秒级过期时间：

```java
jedis.set(key, value, "NX", "PX", 30000); // 30秒 TTL
```

## 为什么 SETNX 是原子的

Redis 采用**单线程模型**执行命令，任何时刻只有一个客户端能执行命令。

```
客户端A: SETNX key value
客户端B: SETNX key value
客户端C: GET key
```

Redis 会串行处理这些命令：

1. 处理客户端A的 SETNX，返回 1
2. 处理客户端B的 SETNX，返回 0（key 已存在）
3. 处理客户端C的 GET，返回 "value"

这就是 Redis 保证原子性的原理——**单线程 + 事件循环**，没有并发问题。

## 释放锁：必须验证持有者身份

获取锁只是第一步，释放锁更有讲究。

一个常见的错误：

```java
// 错误：直接删除 key，不管是谁持有的
public void unlock(Jedis jedis, String key) {
    jedis.del(key);  // ❌ 可能误删别人的锁
}
```

正确做法是**先检查后删除**，而且这个检查和删除必须是原子的：

```java
public void unlock(Jedis jedis, String key, String expectedValue) {
    String script = 
        "if redis.call('get', KEYS[1]) == ARGV[1] then " +
        "    return redis.call('del', KEYS[1]) " +
        "else " +
        "    return 0 " +
        "end";
    
    jedis.eval(script, 1, key, expectedValue);
}
```

为什么要这样？

考虑这个场景：

```
时刻 T1: 锁 TTL = 10秒
时刻 T2: 客户端A 获取锁，value = "A"
时刻 T3: 客户端A 还在执行，但锁过期了
时刻 T4: 客户端B 获取同一把锁，value = "B"
时刻 T5: 客户端A 执行完毕，执行 unlock
时刻 T6: 客户端A 删除了客户端B 的锁！
时刻 T7: 客户端C 获取锁
时刻 T8: 客户端B 和 客户端C 同时执行 —— 数据不一致
```

有了 Lua 脚本的检查，只有 value 匹配时才会删除，避免了误删。

## 完整的 Java 实现

```java
public class RedisDistributedLock implements AutoCloseable {
    
    private final JedisPool jedisPool;
    private final String lockKey;
    private final String lockValue;
    private final int expireSeconds;
    
    public RedisDistributedLock(JedisPool jedisPool, String lockKey, int expireSeconds) {
        this.jedisPool = jedisPool;
        this.lockKey = lockKey;
        this.lockValue = UUID.randomUUID().toString();  // 唯一标识
        this.expireSeconds = expireSeconds;
    }
    
    /**
     * 尝试获取锁
     * @return 是否获取成功
     */
    public boolean tryLock() {
        try (Jedis jedis = jedisPool.getResource()) {
            String result = jedis.set(
                lockKey, 
                lockValue, 
                "NX", 
                "EX", 
                expireSeconds
            );
            return "OK".equals(result);
        }
    }
    
    /**
     * 阻塞获取锁
     * @param timeout 最大等待时间
     * @return 是否获取成功
     */
    public boolean tryLock(long timeout, TimeUnit unit) {
        long deadline = System.currentTimeMillis() + unit.toMillis(timeout);
        while (System.currentTimeMillis() < deadline) {
            if (tryLock()) {
                return true;
            }
            try {
                Thread.sleep(50);  // 避免频繁请求
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
    
    /**
     * 释放锁（只释放自己持有的锁）
     */
    public void unlock() {
        try (Jedis jedis = jedisPool.getResource()) {
            String script = 
                "if redis.call('get', KEYS[1]) == ARGV[1] then " +
                "    return redis.call('del', KEYS[1]) " +
                "else " +
                "    return 0 " +
                "end";
            jedis.eval(script, 1, lockKey, lockValue);
        }
    }
    
    @Override
    public void close() {
        unlock();
    }
}
```

使用方式：

```java
try (RedisDistributedLock lock = new RedisDistributedLock(jedisPool, "order:lock", 30)) {
    if (lock.tryLock(10, TimeUnit.SECONDS)) {
        // 执行需要锁保护的业务
        processOrder();
    } else {
        throw new RuntimeException("获取锁失败，请稍后重试");
    }
} // 自动释放锁
```

## 锁值为什么要用 UUID

你可能注意到了，代码里用了 `UUID.randomUUID().toString()` 作为锁值，而不是简单的 "locked"。

这是因为：

1. **标识持有者**：释放锁时需要验证「我是否是这个锁的持有者」
2. **防止误删**：如果锁值是固定的 "locked"，任何客户端都可以删除任何锁
3. **支持可重入**：可重入锁需要计数，但单客户端场景下 UUID 足以区分

UUID 保证了全局唯一性，不同机器、不同进程生成的 UUID 几乎不会冲突。

## 面试高频追问

**Q: SETNX + EXPIRE 为什么不是原子的？**

A: 因为 Redis 是每条命令原子，不是多条命令组合原子。如果 SETNX 成功后进程崩溃，EXPIRE 没执行，锁永远不会过期。

**Q: SETNX 和 SET NX 有什么区别？**

A: SETNX 是独立的命令，成功返回 1，失败返回 0。SET NX 是 SET 命令的参数组合，功能类似，但 SET NX 多了原子设置 TTL 的能力。

**Q: 如果 SETNX 成功但 Redis 突然宕机了，锁也会丢失？**

A: 对的，这是 Redis 单节点锁的局限性。解决方案是：使用主从复制（但有延迟导致的问题），或者使用 RedLock 算法（向 5 个独立节点获取锁），或者换用 ZooKeeper/etcd。

**Q: 释放锁时为什么要用 Lua 脚本？**

A: 因为「检查 + 删除」不是原子操作。如果先检查再删除之间，锁过期了、被另一个客户端获取了，就会误删别人的锁。Lua 脚本在 Redis 端整体执行，保证原子性。

## 总结

Redis 分布式锁的核心要点：

1. **用 `SET key value NX EX seconds`** 而不是 SETNX + EXPIRE 分开执行
2. **锁值用 UUID**，用于释放时验证持有者身份
3. **释放锁用 Lua 脚本**，`GET + DEL` 合并为原子操作
4. **TTL 要合理**，既不能太短（业务还没执行完就释放），也不能太长（持有者崩溃后要等很久）

Redis 锁适合**追求性能、对可靠性要求不是极端高**的场景。如果对可靠性要求极高（如金融交易），建议用 ZooKeeper 或 etcd。
