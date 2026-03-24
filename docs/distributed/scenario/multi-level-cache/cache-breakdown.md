# 缓存击穿：互斥锁 + 逻辑过期双检方案

穿透、击穿、雪崩——三个名字听起来差不多，但问题完全不同。

**穿透**：数据库和缓存都没有，请求穿过缓存直接打 DB。

**击穿**：缓存过期，但数据库也没有（这是穿透），或者缓存过期，大量请求同时涌入查 DB（这是击穿）。

**雪崩**：大量缓存同时过期。

今天重点说击穿。

## 击穿的本质

击穿的核心问题是：**大量请求同时访问一个缓存过期的热点 key。**

```
用户抢购 → 缓存里有商品信息 → 所有用户都在查缓存
某个时刻 → 缓存过期 → 所有用户同时查数据库 → 数据库被打爆
```

问题出在「同时」两个字。如果请求分散在不同时间，即使缓存过期，也不会有问题。但如果请求集中，比如零点抢购，所有人同时进来，缓存刚好过期——这就是击穿。

## 方案一：互斥锁

核心思路：**只让一个线程去查数据库，其他线程等着。**

```java
public Product getProduct(Long id) {
    String key = "product:" + id;

    // 第一步：查缓存
    Product cached = redis.get(key);
    if (cached != null) {
        return cached;
    }

    // 第二步：尝试获取锁
    String lockKey = "lock:product:" + id;
    String lockValue = UUID.randomUUID().toString();
    boolean lockAcquired = redis.set(lockKey, lockValue, "NX", "PX", 3000);

    if (lockAcquired) {
        try {
            // 获得锁，去查数据库
            Product product = productMapper.selectById(id);

            // 写入缓存
            if (product != null) {
                redis.setex(key, 3600, JSON.toJSONString(product));
            }

            return product;
        } finally {
            // 释放锁
            redis.del(lockKey);
        }
    } else {
        // 没获得锁，短暂等待后重试
        Thread.sleep(50);
        return getProduct(id);  // 递归重试
    }
}
```

### 互斥锁的问题

1. **性能损耗**：等待的线程在空转 CPU
2. **死锁风险**：如果持有锁的线程崩溃了，锁永远不会释放（所以要用 TTL）
3. **效率低**：等待的线程白等了 50ms，即使缓存已经重建好了

## 方案二：逻辑过期

核心思路：**缓存永不过期，额外记录一个「逻辑过期时间」。**

```java
@Data
public class ProductCache {
    private Product data;
    private Long logicExpireTime;  // 逻辑过期时间
}
```

```java
public Product getProduct(Long id) {
    String key = "product:" + id;

    // 第一步：查缓存
    String cacheValue = redis.get(key);
    ProductCache cache = JSON.parseObject(cacheValue, ProductCache.class);

    if (cache != null) {
        // 第二步：检查逻辑过期
        if (cache.getLogicExpireTime() > System.currentTimeMillis()) {
            // 没过期，直接返回
            return cache.getData();
        } else {
            // 过期了，尝试获取锁
            String lockKey = "lock:product:" + id;
            if (redis.set(lockKey, "1", "NX", "PX", 1000)) {
                // 获得锁，开启异步线程重建缓存
                executor.submit(() -> rebuildCache(id));
            }
        }
    }

    // 没命中缓存，查询数据库
    Product product = productMapper.selectById(id);

    // 重建缓存
    rebuildCache(id);

    return product;
}

private void rebuildCache(Long id) {
    Product product = productMapper.selectById(id);
    ProductCache cache = new ProductCache();
    cache.setData(product);
    cache.setLogicExpireTime(System.currentTimeMillis() + 30 * 60 * 1000L);  // 30 分钟后逻辑过期
    redis.setex("product:" + id, 24 * 3600, JSON.toJSONString(cache));
}
```

### 逻辑过期的优点

1. **无等待**：所有线程都能立即返回旧数据（虽然可能过期）
2. **只有一个线程重建**：其他线程不用等待
3. **性能好**：大部分请求不会有任何阻塞

### 逻辑过期的缺点

1. **返回脏数据**：在缓存重建期间，返回的是过期的旧数据
2. **实现复杂**：需要额外的逻辑过期字段
3. **内存占用大**：缓存数据 + 逻辑过期时间

## 双检锁：两种方案的结合

最优解：**用互斥锁保证数据一致性，用逻辑过期保证性能。**

```java
public Product getProduct(Long id) {
    String key = "product:" + id;
    String cacheValue = redis.get(key);
    ProductCache cache = JSON.parseObject(cacheValue, ProductCache.class);

    if (cache != null) {
        // 检查逻辑过期
        if (cache.getLogicExpireTime() > System.currentTimeMillis()) {
            return cache.getData();
        }

        // 逻辑过期，尝试获取锁
        String lockKey = "lock:product:" + id;
        boolean lockAcquired = redis.set(lockKey, "1", "NX", "PX", 1000);

        if (lockAcquired) {
            try {
                // 再次检查缓存（可能有其他线程已经重建了）
                cacheValue = redis.get(key);
                cache = JSON.parseObject(cacheValue, ProductCache.class);
                if (cache.getLogicExpireTime() > System.currentTimeMillis()) {
                    return cache.getData();
                }

                // 真的过期了，重建缓存
                return rebuildCache(id);
            } finally {
                redis.del(lockKey);
            }
        }
    }

    // 缓存未命中
    return rebuildCache(id);
}
```

## 两种方案的取舍

| 方案 | 数据一致性 | 性能 | 实现复杂度 | 适用场景 |
|-----|----------|------|----------|---------|
| 互斥锁 | 强一致 | 低（有等待） | 低 | 数据一致性要求高 |
| 逻辑过期 | 最终一致 | 高（无等待） | 高 | 允许短暂脏读 |
| 双检锁 | 最终一致 | 高 | 中 | 推荐方案 |

实际项目中，**双检锁是最常用的方案**。它平衡了一致性和性能。

## 面试追问方向

- 互斥锁的等待时间怎么设置？（答：50-100ms，太短会增加数据库压力，太长用户体验差）
- 逻辑过期的逻辑过期时间怎么设置？（答：通常比 TTL 短，保证大部分请求命中时数据未过期）
- 互斥锁和分布式锁的区别？（答：互斥锁是单机版，多线程竞争；分布式锁是跨机器，多进程竞争）
- 击穿和穿透的区别？（答：击穿是缓存过期，穿透是缓存和数据库都没有）

## 小结

击穿和穿透，名字很像，问题完全不同：

- **穿透**：缓存和 DB 都没有，解决用布隆过滤器
- **击穿**：热点缓存过期，解决用互斥锁或逻辑过期
- **雪崩**：大量缓存同时过期，解决用过期时间随机化

理解每种问题的本质，才能对症下药。
