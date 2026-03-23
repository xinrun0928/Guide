# 缓存策略在系统设计中的应用

> 缓存是性能优化的第一把刀。用好了，系统 QPS 能提升 10 倍；用不好，数据不一致的坑能埋掉整个团队。

## 为什么需要缓存

一个典型的查询链路：

```
用户请求 → Tomcat → MySQL → 返回结果
```

如果每个请求都打一次数据库，在高并发下数据库直接崩溃。

加一层缓存之后：

```
用户请求 → Tomcat → Redis → 命中？直接返回
                              ↓ 未命中
                          MySQL → 回填缓存 → 返回
```

核心思想：**用内存换速度**。Redis 的读写 QPS 能达到 10 万+，而 MySQL 只有几千。


## 缓存读写策略

### Cache-Aside（旁路缓存，最常用）

**读**：先查缓存，命中则直接返回；未命中则查数据库，再回填缓存。

```java
public String getUser(String userId) {
    // 先查缓存
    String cached = redis.get("user:" + userId);
    if (cached != null) {
        return cached;
    }
    // 缓存未命中，查数据库
    String user = userDao.findById(userId);
    // 回填缓存，设置过期时间
    redis.setex("user:" + userId, 3600, user);
    return user;
}
```

**写**：先更新数据库，再删除缓存（而非更新缓存）。为什么是删除而不是更新？因为更新缓存可能在并发下产生脏数据。

```java
public void updateUser(String userId, String name) {
    // 先更新数据库
    userDao.update(userId, name);
    // 再删除缓存，让下次请求重新从 DB 加载
    redis.del("user:" + userId);
}
```


### Read-Through（读穿透）

缓存作为数据库的代理，读取操作直接交给缓存层，缓存负责从数据库加载数据。应用层代码更简洁，但对缓存中间件要求高。

### Write-Through（写穿透）

写入时同步更新缓存和数据库。数据一致性最好，但写性能差，实际用得少。

### Write-Behind（写回）

写入时只更新缓存，缓存异步批量写入数据库。性能最高，但风险也最大——缓存挂了数据可能丢失。


## 缓存常见问题

### 缓存穿透

**场景**：大量请求查询一个不存在的数据，缓存没有，数据库也没有，请求直接打到数据库。

**解决**：
1. **布隆过滤器**：将所有存在的 key 存入布隆过滤器，请求进来先过过滤器
2. **缓存空值**：把「查不到」的结果也缓存起来，短 TTL（如 60 秒）

```java
public String getUser(String userId) {
    if (!bloomFilter.mightContain(userId)) {
        return null; // 布隆过滤器说不存在，直接返回
    }
    String cached = redis.get("user:" + userId);
    if (cached != null) {
        return cached;
    }
    String user = userDao.findById(userId);
    if (user == null) {
        redis.setex("user:" + userId, 60, "NULL"); // 空值缓存
    } else {
        redis.setex("user:" + userId, 3600, user);
    }
    return user;
}
```

### 缓存击穿

**场景**：一个热点 key 过期瞬间，大量请求同时涌入查数据库。

**解决**：
- **互斥锁**：只有一个线程去加载数据库，其他线程等缓存重建
- **热点数据永不过期**：逻辑过期而非物理过期

```java
public String getUser(String userId) {
    String cached = redis.get("user:" + userId);
    if (cached != null) {
        return cached;
    }
    // 获取互斥锁，只有一个线程去加载数据库
    String lockKey = "lock:user:" + userId;
    String lock = redis.set(lockKey, "1", "NX", "EX", 10);
    if ("OK".equals(lock)) {
        try {
            String user = userDao.findById(userId);
            redis.setex("user:" + userId, 3600, user);
            return user;
        } finally {
            redis.del(lockKey);
        }
    } else {
        // 等待其他线程构建缓存，然后重试
        Thread.sleep(50);
        return getUser(userId);
    }
}
```

### 缓存雪崩

**场景**：大量缓存同时过期，或者缓存服务宕机，导致数据库被打爆。

**解决**：
- 过期时间加随机值：`ttl = baseTTL + random(0, 300)`
- 搭建 Redis 集群（主从 + 哨兵）
- 多级缓存：本地缓存 + 分布式缓存


## 缓存更新策略

| 策略 | 一致性 | 复杂度 | 适用场景 |
|------|--------|--------|----------|
| Cache-Aside | 较好 | 中 | 读多写少 |
| Read-Through | 好 | 高 | 读多 |
| Write-Through | 最好 | 高 | 写多 |
| Write-Behind | 差 | 中 | 写多 |
| 删除而非更新 | 较好 | 低 | 通用 |

**核心原则**：在分布式并发环境下，**先操作数据库，再操作缓存**，且优先选择「删除」而非「更新」。


## 面试延伸问题

**Q：为什么写操作是「删除缓存」而不是「更新缓存」？**

因为并发下可能出现数据不一致：线程 A 更新 DB，线程 B 也更新 DB，线程 A 更新缓存，线程 B 也更新缓存——但顺序可能反过来，导致缓存是旧数据。删除则不存在这个问题，下次读会重新加载。

**Q：Redis 和本地缓存（如 Caffeine）怎么选？**

| 维度 | Redis | 本地缓存 |
|------|-------|----------|
| 共享性 | 多实例共享 | 单实例私有 |
| 容量 | 大（可集群） | 小（受内存限制）|
| 一致性 | 好（集中管理）| 差（需要同步）|
| 适用 | 跨进程共享数据 | 极高频访问的本地数据 |


## 总结

缓存使用的核心口诀：

```
读：先缓存，后数据库；未命中先回填
写：先数据库，后删缓存（不更新）
防穿透：布隆过滤器 + 空值缓存
防击穿：互斥锁 + 热点永不过期
防雪崩：过期时间随机 + 多级缓存
```

缓存用对了，系统性能能提升一个数量级。用错了，数据一致性的问题能在凌晨三点叫醒你。
