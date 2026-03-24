# Redisson 读写锁实现

你一定见过这样的代码：

```java
public class ConfigService {
    private String config;
    private final RLock lock = redisson.getLock("config:lock");

    public String getConfig() {
        lock.lock();
        try {
            return config;  // 读操作也要排队等锁
        } finally {
            lock.unlock();
        }
    }

    public void updateConfig(String newConfig) {
        lock.lock();
        try {
            config = newConfig;  // 写操作
        } finally {
            lock.unlock();
        }
    }
}
```

问题是：**读操作之间也要互斥吗？**

10 个线程同时读配置，它们互相之间完全不影响，为什么要排队等锁？

这就是**读写锁**存在的意义：**读读不互斥，读写互斥，写写互斥**。

## 读写锁的语义

| 组合 | 普通锁 | 读写锁 |
|------|--------|--------|
| 读 + 读 | 互斥 | 不互斥（并发读） |
| 读 + 写 | 互斥 | 互斥 |
| 写 + 写 | 互斥 | 互斥 |

为什么这样设计？

因为读操作不会改变共享资源，所以多个线程同时读是安全的。只有写操作会改变资源，所以写的时候不能有其他线程读写。

## 适用场景

读写锁最适合**读多写少**的场景：

- 配置中心：大量客户端读取配置，偶尔更新配置
- 缓存：大量请求读取缓存，偶尔更新缓存
- 元数据：频繁查询元数据，偶尔修改元数据

## Redisson 读写锁 API

```java
public interface RReadWriteLock {
    
    /**
     * 获取读锁
     */
    RLock readLock();
    
    /**
     * 获取写锁
     */
    RLock writeLock();
}
```

使用方式：

```java
RReadWriteLock rwLock = redisson.getReadWriteLock("myConfig");
RLock readLock = rwLock.readLock();
RLock writeLock = rwLock.writeLock();
```

## Java 代码示例

### 配置缓存的读写锁实现

```java
public class ConfigService {
    
    private final RedissonClient redisson;
    private volatile String cachedConfig;
    
    public ConfigService(RedissonClient redisson) {
        this.redisson = redisson;
    }
    
    /**
     * 读取配置（使用读锁）
     */
    public String getConfig(String key) {
        RReadWriteLock rwLock = redisson.getReadWriteLock("config:rw:" + key);
        RLock readLock = rwLock.readLock();
        
        readLock.lock();
        try {
            // 多个线程可以同时进入这里
            // 如果缓存有值，直接返回
            if (cachedConfig != null) {
                return cachedConfig;
            }
            
            // 缓存没有，释放读锁，获取写锁去加载
            readLock.unlock();
            
            // 获取写锁
            RLock writeLock = rwLock.writeLock();
            writeLock.lock();
            try {
                // 双重检查：可能其他线程已经加载了
                if (cachedConfig != null) {
                    return cachedConfig;
                }
                
                // 从数据库或远程加载配置
                cachedConfig = loadConfigFromDB(key);
                return cachedConfig;
                
            } finally {
                writeLock.unlock();
            }
            
        } finally {
            // 如果还在持有读锁，需要释放
            if (readLock.isHeldByCurrentThread()) {
                readLock.unlock();
            }
        }
    }
    
    /**
     * 更新配置（使用写锁）
     */
    public void updateConfig(String key, String newConfig) {
        RReadWriteLock rwLock = redisson.getReadWriteLock("config:rw:" + key);
        RLock writeLock = rwLock.writeLock();
        
        writeLock.lock();
        try {
            // 写入数据库
            updateConfigToDB(key, newConfig);
            // 更新缓存
            cachedConfig = newConfig;
        } finally {
            writeLock.unlock();
        }
    }
    
    private String loadConfigFromDB(String key) {
        // 模拟从数据库加载
        return "config_value";
    }
    
    private void updateConfigToDB(String key, String value) {
        // 模拟更新数据库
    }
}
```

### 简化版读写锁使用

如果不需要缓存预热，简化写法：

```java
public class SimpleReadWriteLockService {
    
    private final RedissonClient redisson;
    private final Map&lt;String, String&gt; data = new ConcurrentHashMap&lt;&gt;();
    
    /**
     * 读取数据
     */
    public String read(String key) {
        RReadWriteLock rwLock = redisson.getReadWriteLock("data:rw");
        RLock readLock = rwLock.readLock();
        
        readLock.lock();
        try {
            return data.get(key);
        } finally {
            readLock.unlock();
        }
    }
    
    /**
     * 写入数据
     */
    public void write(String key, String value) {
        RReadWriteLock rwLock = redisson.getReadWriteLock("data:rw");
        RLock writeLock = rwLock.writeLock();
        
        writeLock.lock();
        try {
            data.put(key, value);
        } finally {
            writeLock.unlock();
        }
    }
    
    /**
     * 批量读取
     */
    public Map&lt;String, String&gt; readAll() {
        RReadWriteLock rwLock = redisson.getReadWriteLock("data:rw");
        RLock readLock = rwLock.readLock();
        
        readLock.lock();
        try {
            return new HashMap&lt;&gt;(data);  // 返回副本
        } finally {
            readLock.unlock();
        }
    }
}
```

## Redis 中读写锁的实现

Redisson 的读写锁使用**两把锁 + 计数器**实现：

```
读锁名称: myRWLock:read
写锁名称: myRWLock:write
读计数:   myRWLock:read:holders
```

### 读锁获取逻辑

```lua
-- 多个线程可以同时获取读锁
-- 条件：没有线程持有写锁

if redis.call('exists', KEYS[2]) == 0 then  -- 写锁不存在
    redis.call('hincrby', KEYS[3], ARGV[1], 1)  -- 读计数 +1
    redis.call('pexpire', KEYS[3], ARGV[2])  -- 续期
    return 1
end

return 0  -- 有线程持有写锁，获取失败
```

### 写锁获取逻辑

```lua
-- 写锁是独占的
-- 条件：没有任何锁

if redis.call('exists', KEYS[1]) == 0 and 
   redis.call('exists', KEYS[2]) == 0 then  -- 读锁和写锁都不存在
    redis.call('hset', KEYS[1], ARGV[1], 1)  -- 设置写锁持有者
    redis.call('pexpire', KEYS[1], ARGV[2])
    return 1
end

return 0
```

### 读锁释放逻辑

```lua
-- 读计数 -1，计数归零时删除读锁

local count = redis.call('hincrby', KEYS[3], ARGV[1], -1)

if count == 0 then
    redis.call('del', KEYS[3])
end

return 1
```

## 读写锁的踩坑点

### 坑一：读锁释放后写锁等待的时序

```
时刻 T1: 线程A 获取读锁
时刻 T2: 线程B 获取读锁（可以，讀讀不互斥）
时刻 T3: 线程A 释放读锁
时刻 T4: 线程C 请求写锁（等待中...）
时刻 T5: 线程B 释放读锁
时刻 T6: 线程C 获取写锁
```

问题：**如果不断有读请求，写锁可能永远等待**。

这就是「写饥饿」问题。Redisson 默认不支持公平读写锁，如果需要公平读写锁，需要用信号量或队列实现。

### 坑二：不可重入

Redisson 的读写锁**不支持可重入**：

```java
RLock readLock1 = rwLock.readLock();
RLock readLock2 = rwLock.readLock();

readLock1.lock();
readLock2.lock();  // 会阻塞！因为不支持可重入读锁
```

### 坑三：读锁和写锁的 TTL 独立

读写锁的 TTL 是独立计算的：

```java
writeLock.lock();
// 写锁持有中...
writeLock.unlock();  // 只释放写锁

// 如果还有读锁持有者，写锁不能被重新获取
readLock.lock();
// 读锁持有中...
```

## 面试追问方向

- 读写锁和普通互斥锁的区别是什么？
- 什么场景适合用读写锁？
- Redisson 读写锁在 Redis 中是怎么实现的？
- 读写锁有没有可重入？
- 读写锁的「写饥饿」问题是什么？怎么解决？

## 总结

读写锁是**读多写少场景**的利器：

- **读锁**：多个线程同时获取，互相不阻塞
- **写锁**：独占，持有写锁时不能有其他读写操作

Redis 中通过**两把锁 + 读计数器**实现读写锁的语义。

使用读写锁时注意：
1. 不要在持有读锁时获取写锁（会死锁）
2. 读写锁不可重入
3. 高并发读 + 少量写场景下，性能提升明显
