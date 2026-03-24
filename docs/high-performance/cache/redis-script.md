# Redis 管道、事务、Lua 脚本性能对比

你用 Redis 批量插入 10000 条数据。

方案 A：逐条插入 → 耗时 10 秒
方案 B：管道插入 → 耗时 0.5 秒
方案 C：Lua 脚本 → 耗时 0.3 秒

同样都是 Redis 操作，为什么差距这么大？

因为它们的**语义和执行模式完全不同**。

---

## 三种机制概览

| 机制 | 原子性 | 网络往返 | 灵活性 | 适用场景 |
|------|--------|----------|--------|----------|
| Pipeline | ❌ 否 | 1 次（批量） | 高 | 批量读写 |
| Transaction | ✅ 是 | N 次（串行） | 中 | 简单批量 |
| Lua Script | ✅ 是 | 1 次 | 高 | 复杂业务逻辑 |

---

## Pipeline：批量网络优化

### 问题：RTT 瓶颈

```bash
# 逐条执行：1000 次 GET
# 每次 RTT（往返时间）= 0.5ms
# 总耗时 = 1000 × 0.5ms = 500ms

# 管道执行：1000 次 GET
# 1 次 RTT
# 总耗时 = 0.5ms
```

**Pipeline 的核心思想**：把 N 个命令打包成一次网络请求，减少 RTT。

```
普通模式：
客户端 ─── GET key1 ──▶ Redis
       ◀─── value1 ───
       ─── GET key2 ──▶ Redis
       ◀─── value2 ───
       ... (重复 N 次)

Pipeline 模式：
客户端 ─── MGET key1 key2 key3... ──▶ Redis
       ◀─── values (一次返回) ───
```

### Java 代码实现

```java
// 普通模式：逐条执行
public void insertUserScores(List&lt;UserScore&gt; scores) {
    for (UserScore score : scores) {
        String key = "score:" + score.getUserId();
        redisTemplate.opsForValue().set(key, score.getScore());
    }
}

// Pipeline 模式：批量执行
public void insertUserScoresWithPipeline(List&lt;UserScore&gt; scores) {
    // 1. 创建管道
    RedisCallback&lt;Object&gt; pipelineCallback = connection -&gt; {
        // 2. 将所有命令写入管道
        for (UserScore score : scores) {
            String key = "score:" + score.getUserId();
            connection.stringCommands().set(key.getBytes(), 
                score.getScore().toString().getBytes());
        }
        // 3. 执行管道
        return connection.pipeline().execute();
    };
    
    // 4. 执行
    redisTemplate.execute(pipelineCallback);
}

// Spring Data Redis 简化写法
public void insertUserScoresWithPipeline2(List&lt;UserScore&gt; scores) {
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -&gt; {
        for (UserScore score : scores) {
            String key = "score:" + score.getUserId();
            connection.stringCommands().set(
                key.getBytes(),
                score.getScore().toString().getBytes()
            );
        }
        return null;  // 返回 null 即可
    });
}
```

### Pipeline 性能对比

```java
// 性能测试
public void benchmarkPipeline() {
    int count = 10000;
    List&lt;String&gt; keys = IntStream.range(0, count)
        .mapToObj(i -&gt; "test:pipeline:" + i)
        .collect(Collectors.toList());
    
    // 普通模式
    long start1 = System.currentTimeMillis();
    for (String key : keys) {
        redisTemplate.opsForValue().set(key, "value");
    }
    long time1 = System.currentTimeMillis() - start1;
    
    // Pipeline 模式
    long start2 = System.currentTimeMillis();
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -&gt; {
        for (String key : keys) {
            connection.stringCommands().set(key.getBytes(), "value".getBytes());
        }
        return null;
    });
    long time2 = System.currentTimeMillis() - start2;
    
    System.out.println("普通模式: " + time1 + "ms");
    System.out.println("Pipeline: " + time2 + "ms");
    System.out.println("加速比: " + (double) time1 / time2 + "x");
}
```

### Pipeline 的注意事项

⚠️ **Pipeline 不保证原子性**：
- 命令打包发送，但不打包执行
- 如果 Redis 在执行过程中宕机，部分命令可能未执行

⚠️ **内存占用**：
- Pipeline 包含所有命令和响应
- 大量数据时要分批（每批 1000-5000 条）

```java
// 分批 Pipeline
public void batchPipeline(List&lt;String&gt; allKeys) {
    int batchSize = 1000;
    
    for (int i = 0; i &lt; allKeys.size(); i += batchSize) {
        List&lt;String&gt; batch = allKeys.subList(i, 
            Math.min(i + batchSize, allKeys.size()));
        
        redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -&gt; {
            for (String key : batch) {
                connection.stringCommands().set(key.getBytes(), "value".getBytes());
            }
            return null;
        });
    }
}
```

---

## Transaction：Redis 事务

### 基本命令

```bash
MULTI    # 开启事务
SET key1 value1
SET key2 value2
GET key1
EXEC     # 执行事务
```

### Java 代码实现

```java
// 方式 1：TransactionTemplate
public void transferWithTransaction(Long fromUserId, Long toUserId, int amount) {
    redisTemplate.execute(new SessionCallback&lt;Object&gt;() {
        @Override
        public Object execute(RedisOperations operations) throws DataAccessException {
            operations.multi();  // 开启事务
            
            // 队列中的命令
            String fromKey = "balance:" + fromUserId;
            String toKey = "balance:" + toUserId;
            
            operations.opsForValue().decrement(fromKey, amount);
            operations.opsForValue().increment(toKey, amount);
            
            return operations.exec();  // 执行事务
        }
    });
}

// 方式 2：@Transactional 注解（Spring）
@Transactional
public void transfer(Long fromUserId, Long toUserId, int amount) {
    String fromKey = "balance:" + fromUserId;
    String toKey = "balance:" + toUserId;
    
    redisTemplate.opsForValue().decrement(fromKey, amount);
    redisTemplate.opsForValue().increment(toKey, amount);
    // 无异常则自动 commit
}
```

### WATCH：乐观锁

```java
// 监视 key，如果 key 被修改则事务失败
public boolean deductStockWithWatch(Long productId, int count) {
    return redisTemplate.execute(new SessionCallback&lt;Boolean&gt;() {
        @Override
        public Boolean execute(RedisOperations operations) throws DataAccessException {
            String stockKey = "stock:" + productId;
            
            // WATCH 监视 stockKey
            operations.watch(stockKey);
            
            // 检查库存
            Integer stock = (Integer) operations.opsForValue().get(stockKey);
            if (stock == null || stock &lt; count) {
                operations.unwatch();  // 取消监视
                return false;
            }
            
            // 开启事务
            operations.multi();
            operations.opsForValue().decrement(stockKey, count);
            
            // exec：执行时检查 stockKey 是否被修改
            // 如果被修改，返回 null
            List&lt;Object&gt; results = operations.exec();
            
            return results != null;  // null 表示冲突
        }
    });
}
```

### Transaction vs Pipeline

| 特性 | Transaction | Pipeline |
|------|-------------|----------|
| 原子性 | ✅ 全部成功或全部失败 | ❌ 不保证 |
| 命令排队 | 是（但不执行） | 是 |
| 执行时机 | EXEC 时一次性执行 | 分开执行（打包发送） |
| 网络往返 | N 次（RTT × N） | 1 次 |
| 冲突检测 | WATCH 支持 | 不支持 |

---

## Lua 脚本：原子执行

### 为什么需要 Lua？

Transaction 的问题是：**MULTI 后每个命令还是要单独执行**，无法保证「读取后判断再写入」的原子性。

```java
// 希望实现：库存减 1，但库存不能为负
operations.multi();
operations.opsForValue().decrement(stockKey);  // ❌ 无法判断当前库存
operations.exec();
// 问题：无法在执行前判断库存是否足够
```

Lua 脚本可以**在服务端执行复杂逻辑**：

```lua
-- Lua 脚本：库存扣减（原子操作）
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local deduct = tonumber(ARGV[1])

if stock &lt; deduct then
    return -1  -- 库存不足
end

redis.call('DECRBY', KEYS[1], deduct)
return stock - deduct  -- 返回剩余库存
```

### Java 代码实现

```java
public class LuaStockService {
    
    private static final String DEDUCT_STOCK_SCRIPT = 
        "local stock = tonumber(redis.call('GET', KEYS[1]) or '0') " +
        "local deduct = tonumber(ARGV[1]) " +
        "if stock &lt; deduct then " +
        "   return -1 " +
        "end " +
        "redis.call('DECRBY', KEYS[1], deduct) " +
        "return stock - deduct";
    
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;
    private final DefaultRedisScript&lt;Long&gt; script;
    
    public LuaStockService(RedisTemplate&lt;String, Object&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;
        this.script = new DefaultRedisScript&lt;&gt;();
        script.setScriptText(DEDUCT_STOCK_SCRIPT);
        script.setResultType(Long.class);
    }
    
    public boolean deductStock(Long productId, int count) {
        String stockKey = "stock:" + productId;
        
        Long result = redisTemplate.execute(
            script,
            Collections.singletonList(stockKey),
            String.valueOf(count)
        );
        
        return result != null &amp;&amp; result &gt;= 0;
    }
}
```

### Lua 脚本的优势

| 优势 | 说明 |
|------|------|
| **原子性** | 整个脚本一次性执行，无中间状态 |
| **高性能** | 减少网络往返 |
| **灵活性** | 支持条件判断、循环等复杂逻辑 |
| **可复用** | 脚本缓存在 Redis 中，可复用 |

### Lua 脚本示例

#### 库存扣减 + 防重复购买

```lua
-- KEYS[1]: stock key
-- KEYS[2]: purchased set key
-- ARGV[1]: userId
-- ARGV[2]: 扣减数量

-- 1. 检查是否已购买
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then
    return -1  -- 已购买
end

-- 2. 检查库存
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
local deduct = tonumber(ARGV[2])
if stock &lt; deduct then
    return -2  -- 库存不足
end

-- 3. 扣减库存
redis.call('DECRBY', KEYS[1], deduct)

-- 4. 标记已购买
redis.call('SADD', KEYS[2], ARGV[1])

return stock - deduct
```

#### 限流器

```lua
-- KEYS[1]: 限流 key
-- ARGV[1]: 窗口大小（秒）
-- ARGV[2]: 最大请求数

local key = KEYS[1]
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])

local current = tonumber(redis.call('GET', key) or '0')

if current >= limit then
    return 0  -- 限流
end

current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end

return current  -- 返回当前计数
```

---

## 三种机制对比

| 维度 | Pipeline | Transaction | Lua 脚本 |
|------|----------|-------------|----------|
| **原子性** | ❌ 无 | ✅ 有（WATCH 可检测冲突） | ✅ 有 |
| **网络往返** | 1 次 | N 次 | 1 次 |
| **命令灵活性** | 高（可混合不同命令） | 中（部分命令不支持） | 高 |
| **执行顺序** | 按顺序执行 | 按顺序执行 | 按顺序执行 |
| **错误处理** | 无（批量执行） | 有（EXEC 返回结果） | 需手动处理 |
| **适用场景** | 批量读写 | 简单批量操作 | 复杂业务逻辑 |

---

## 性能实测

```java
@Test
public void performanceTest() {
    int count = 1000;
    
    // Pipeline
    long start1 = System.currentTimeMillis();
    batchPipeline(count);
    long pipelineTime = System.currentTimeMillis() - start1;
    
    // Transaction
    long start2 = System.currentTimeMillis();
    batchTransaction(count);
    long transactionTime = System.currentTimeMillis() - start2;
    
    System.out.println("Pipeline: " + pipelineTime + "ms");
    System.out.println("Transaction: " + transactionTime + "ms");
    System.out.println("加速比: " + (double) transactionTime / pipelineTime + "x");
}

private void batchPipeline(int count) {
    redisTemplate.executePipelined((RedisCallback&lt;Object&gt;) connection -&gt; {
        for (int i = 0; i &lt; count; i++) {
            connection.stringCommands().set(
                ("key:" + i).getBytes(), 
                "value".getBytes()
            );
        }
        return null;
    });
}

private void batchTransaction(int count) {
    redisTemplate.execute((RedisCallback&lt;Object&gt;) operations -&gt; {
        operations.multi();
        for (int i = 0; i &lt; count; i++) {
            operations.opsForValue().set("key:" + i, "value");
        }
        operations.exec();
        return null;
    });
}
```

典型结果：
```
Pipeline: ~50ms（1000 条）
Transaction: ~500ms（1000 条）
Pipeline 比 Transaction 快约 10 倍
```

---

## 选型指南

```
是否需要原子性？
├── 否 → Pipeline（批量读写）
└── 是 → 是否需要复杂逻辑？
          ├── 否 → Transaction（MULTI/EXEC）
          └── 是 → Lua 脚本
```

| 场景 | 推荐 |
|------|------|
| 批量预热缓存 | Pipeline |
| 批量更新用户积分 | Pipeline |
| 转账/扣款 | Lua 脚本 |
| 库存扣减 | Lua 脚本 |
| 限流 | Lua 脚本 |
| 简单的批量 SET | Transaction |

---

## 总结

三种机制各有适用场景：

| 机制 | 核心优势 | 注意事项 |
|------|----------|----------|
| Pipeline | 批量优化 RTT | 不保证原子性 |
| Transaction | 简单原子操作 | 每个命令单独执行，慢 |
| Lua 脚本 | 复杂逻辑原子执行 | 需要写 Lua 代码 |

**最佳实践**：
- 批量读取用 Pipeline
- 库存扣减、限流用 Lua 脚本
- 简单原子操作用 Transaction
- 混合场景用 Lua 脚本封装

---

## 留给你的问题

假设你需要实现一个**分布式延迟队列**：

需求：
1. 消息在指定时间后才能被消费
2. 消息只能被消费一次
3. 支持消息确认（ACK）
4. 高性能，支持万级 QPS

请思考：
1. 如何用 Redis 实现延迟队列？可以用哪种数据类型？
2. 「延迟执行」和「延迟消息」有什么区别？
3. 如何保证消息不重复消费？
4. 如果消费者挂了，未确认的消息应该如何处理？

提示：可以用 ZSet 实现延迟队列，score 作为执行时间戳。
