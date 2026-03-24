# Redis 管道（Pipeline）与批量操作

你需要批量读取 10000 个用户的信息。如果一个个 get：

```java
for (Long userId : userIds) {
    String key = "user:" + userId;
    User user = (User) redisTemplate.opsForValue().get(key);
    result.add(user);
}
```

你知道这会发生什么吗？

每个 get 命令都包含：
- 客户端发送请求（网络往返）
- Redis 执行命令
- 服务端返回响应（网络往返）

10000 个命令 = 至少 10000 次网络往返。如果每次往返耗时 1ms，总耗时就是 10 秒。

**有更聪明的办法吗？**

## Redis Pipeline 的原理

Pipeline（管道）是 Redis 提供的一种批量执行命令的机制。它将多个命令打包在一起，客户端一次性发送，Redis 一次性返回所有结果。

```
普通模式：
Client → GET key1 → Redis → Client → GET key2 → Redis → Client → ...
          ↑ 往返 1ms           ↑ 往返 1ms           ↑ 往返 1ms

Pipeline 模式：
Client → GET key1 GET key2 GET key3 ... → Redis → [结果1 结果2 结果3 ...] → Client
          ↑ 往返 1ms                                ↑ 往返 1ms
```

**核心改变**：从 N 次网络往返，变成 1 次网络往返。

## Pipeline vs 普通命令

### 性能对比

```java
// 普通模式：逐个执行
long start1 = System.currentTimeMillis();
for (Long userId : userIds) {
    String key = "user:" + userId;
    redisTemplate.opsForValue().get(key);
}
long time1 = System.currentTimeMillis() - start1;

// Pipeline 模式：批量执行
long start2 = System.currentTimeMillis();
redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -> {
    for (Long userId : userIds) {
        String key = "user:" + userId;
        connection.stringCommands().get(key.getBytes());
    }
    return null;
});
long time2 = System.currentTimeMillis() - start2;

log.info("普通模式: {}ms, Pipeline模式: {}ms", time1, time2);
```

实测结果（10000 个 key）：

| 模式 | 耗时 | 提升 |
|---|---|---|
| 普通模式 | 10000ms+ | - |
| Pipeline | 100-200ms | 50-100 倍 |

### 注意事项

Pipeline 不是事务，它只是把多个命令打包发送。**命令之间没有原子性保证**。

```java
// Pipeline：非原子操作
redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -> {
    // 如果中间某个命令失败，后续命令仍会执行
    connection.stringCommands().set("key1".getBytes(), "value1".getBytes());
    connection.stringCommands().set("key2".getBytes(), "value2".getBytes());
    connection.stringCommands().set("key3".getBytes(), "value3".getBytes());
    return null;
});
```

## Pipeline 的正确使用方式

### Spring Data Redis

```java
// 方式一：使用 executePipelined
List&lt;Object&gt; results = redisTemplate.executePipelined(
    (RedisCallback&lt;Object&gt;) connection -> {
        for (Long userId : userIds) {
            String key = "user:" + userId;
            connection.stringCommands().get(key.getBytes());
        }
        return null;
    }
);

// 方式二：使用 RedisTemplate 的 opsForPipeline
try (SessionCallback&lt;Object&gt; session = redisTemplate.execute()) {
    List&lt;Object&gt; results = redisTemplate.getConnectionFactory()
        .getConnection()
        .pipelined();
    
    for (Long userId : userIds) {
        String key = "user:" + userId;
        ((Jedis) redisTemplate.getConnectionFactory()
            .getConnection())
            .get(key);
    }
}
```

### Jedis

```java
Jedis jedis = jedisPool.getResource();
try {
    Pipeline pipeline = jedis.pipelined();
    
    for (Long userId : userIds) {
        String key = "user:" + userId;
        pipeline.get(key);
    }
    
    // 执行并获取结果
    List&lt;Object&gt; results = pipeline.syncAndReturnAll();
} finally {
    jedis.close();
}
```

### Redisson

```java
RBatch batch = redissonClient.createBatch();
for (Long userId : userIds) {
    String key = "user:" + userId;
    batch.getMap(key).getAsync("name");
}
List&lt;Object&gt; results = batch.execute();
```

## 批量操作的场景

### 场景一：批量读取

```java
// 批量获取用户信息
public Map&lt;Long, User&gt; batchGetUsers(List&lt;Long&gt; userIds) {
    if (userIds == null || userIds.isEmpty()) {
        return Collections.emptyMap();
    }
    
    List&lt;Object&gt; results = redisTemplate.executePipelined(
        (RedisCallback&lt;Object&gt;) connection -> {
            for (Long userId : userIds) {
                String key = "user:" + userId;
                connection.stringCommands().get(key.getBytes());
            }
            return null;
        }
    );
    
    Map&lt;Long, User&gt; userMap = new HashMap&lt;&gt;();
    for (int i = 0; i < userIds.size(); i++) {
        String json = (String) results.get(i);
        if (json != null) {
            userMap.put(userIds.get(i), JSON.parseObject(json, User.class));
        }
    }
    
    return userMap;
}
```

### 场景二：批量写入

```java
// 批量保存用户信息
public void batchSaveUsers(Map&lt;Long, User&gt; userMap) {
    if (userMap == null || userMap.isEmpty()) {
        return;
    }
    
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -> {
        for (Map.Entry&lt;Long, User&gt; entry : userMap.entrySet()) {
            String key = "user:" + entry.getKey();
            String value = JSON.toJSONString(entry.getValue());
            connection.stringCommands().set(key.getBytes(), value.getBytes());
        }
        return null;
    });
}
```

### 场景三：批量删除

```java
// 批量删除 key
public void batchDelete(List&lt;String&gt; keys) {
    if (keys == null || keys.isEmpty()) {
        return;
    }
    
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -> {
        for (String key : keys) {
            connection.keyCommands().del(key.getBytes());
        }
        return null;
    });
}
```

### 场景四：批量设置过期时间

```java
// 批量设置过期时间
public void batchExpire(Map&lt;String, Long&gt; keyExpireMap) {
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -> {
        for (Map.Entry&lt;String, Long&gt; entry : keyExpireMap.entrySet()) {
            String key = entry.getKey();
            long expireSeconds = entry.getValue();
            connection.keyCommands().expire(key.getBytes(), expireSeconds);
        }
        return null;
    });
}
```

## Pipeline 的注意事项

### 1. 不要一次打包太多命令

Pipeline 虽然高效，但如果一次发送太多命令：

- 占用大量客户端内存
- Redis 处理时间变长
- 网络传输时间变长
- 如果 Redis 重启，部分命令可能丢失

**建议**：每批 1000-5000 个命令，分批执行。

```java
public void batchGetInChunks(List&lt;Long&gt; userIds) {
    List&lt;Object&gt; allResults = new ArrayList&lt;&gt;();
    
    // 分批处理，每批 1000 个
    List&lt;List&lt;Long&gt;&gt; chunks = Lists.partition(userIds, 1000);
    for (List&lt;Long&gt; chunk : chunks) {
        List&lt;Object&gt; results = redisTemplate.executePipelined(
            (RedisCallback&lt;Object&gt;) connection -> {
                for (Long userId : chunk) {
                    String key = "user:" + userId;
                    connection.stringCommands().get(key.getBytes());
                }
                return null;
            }
        );
        allResults.addAll(results);
    }
}
```

### 2. Pipeline 不支持事务

如果你需要原子性操作（要么都执行，要么都不执行），应该使用 Redis 事务：

```java
// Redis 事务
List&lt;Object&gt; results = redisTemplate.execute(new SessionCallback&lt;List&lt;Object&gt;&gt;() {
    @Override
    @SuppressWarnings("unchecked")
    public List&lt;Object&gt; execute(RedisOperations operations) throws DataAccessException {
        operations.multi();  // 开启事务
        for (Long userId : userIds) {
            String key = "user:" + userId;
            operations.opsForValue().get(key);
        }
        return operations.exec();  // 执行事务
    }
});
```

但事务模式下，命令不会立即执行，而是等 `exec()` 才一起执行，所以性能不如 Pipeline。

### 3. Pipeline 的返回顺序

Pipeline 返回的结果顺序与发送顺序一致。如果某个 key 不存在，对应位置返回 `null`。

## 批量操作的最佳实践

### 读取策略

```java
public Map&lt;Long, User&gt; getUsers(List&lt;Long&gt; userIds) {
    if (userIds == null || userIds.isEmpty()) {
        return Collections.emptyMap();
    }
    
    // 1. 先从 Redis Pipeline 批量获取
    Map&lt;Long, User&gt; cached = batchGetUsers(userIds);
    
    // 2. 找出未命中的 key
    List&lt;Long&gt; missIds = userIds.stream()
        .filter(id -> !cached.containsKey(id))
        .collect(Collectors.toList());
    
    // 3. 未命中的从数据库加载
    if (!missIds.isEmpty()) {
        Map&lt;Long, User&gt; fromDb = loadUsersFromDb(missIds);
        cached.putAll(fromDb);
        
        // 4. 回填 Redis（异步，不阻塞）
        CompletableFuture.runAsync(() -> batchSaveUsers(fromDb));
    }
    
    return cached;
}
```

### 写入策略

```java
public void saveUsers(Map&lt;Long, User&gt; userMap) {
    if (userMap == null || userMap.isEmpty()) {
        return;
    }
    
    // 批量写入 Redis
    batchSaveUsers(userMap);
    
    // 如果需要，同时写入数据库
    saveUsersToDb(userMap);
}
```

## 总结

Pipeline 是 Redis 批量操作的利器：

1. **核心优势**：将 N 次网络往返减少到 1 次，性能提升 50-100 倍
2. **适用场景**：批量读取、批量写入、批量删除
3. **注意事项**：不要一次打包太多命令，Pipeline 不是事务
4. **最佳实践**：分批处理 + 结合本地缓存

---

## 留给你的问题

假设你需要实现一个用户积分批量查询接口：

- 输入：1000 个用户 ID
- 输出：每个用户的积分
- 要求：响应时间 < 100ms

请思考：

1. 如果 Redis 有 1000 个用户积分 key，使用 Pipeline 批量获取，大约需要多长时间？（假设 Redis 命令执行 0.1ms，网络往返 1ms）
2. 如果要求响应时间 < 100ms，在网络延迟较高的情况下（如 10ms），Pipeline 还够用吗？有什么替代方案？
3. 如果用户积分需要实时准确（不允许本地缓存），还有什么优化手段？

这道题的关键在于理解网络延迟对系统性能的影响，以及如何通过架构优化来弥补。
