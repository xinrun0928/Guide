# Pipeline、事务（MULTI/EXEC）、Lua 脚本对比

面试官：「Pipeline、事务、Lua 脚本有什么区别？」

你：「都可以批量执行命令。」

面试官：「那有什么区别？」

你：「……」

今天来彻底搞清楚这三者的区别。

## 快速对比

| 特性 | Pipeline | 事务 | Lua 脚本 |
|-----|---------|------|---------|
| **原子性** | 无 | 有（但不支持回滚） | 有 |
| **执行方式** | 批量发送命令 | 批量执行命令 | 批量执行命令 |
| **结果可见性** | 每个命令立即返回 | EXEC 后才返回 | 脚本执行完返回 |
| **错误处理** | 需要自己判断 | DISCARD 回滚 | 可以条件判断 |
| **性能** | 最高 | 较高 | 较高 |
| **适用场景** | 无依赖的命令批量执行 | 需要原子性的批量操作 | 复杂逻辑 |

## Pipeline：批量发送命令

### 原理

```
普通模式：
命令1 ──▶ 等待响应 ──▶ 命令2 ──▶ 等待响应 ──▶ 命令3 ──▶ 等待响应
RTT      RTT       RTT

Pipeline 模式：
命令1 ──┐
命令2 ──┼──▶ 一次性发送 ──▶ 一次性返回所有响应
命令3 ──┘

RTT 减少为 1 次！
```

### 代码示例

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.Pipeline;

/**
 * Pipeline 使用示例
 */
public class PipelineDemo {
    
    private Jedis jedis;
    
    /**
     * 批量写入
     */
    public void batchSet() {
        Pipeline pipeline = jedis.pipelined();
        
        for (int i = 0; i < 1000; i++) {
            pipeline.set("key:" + i, "value:" + i);
        }
        
        // 执行并获取结果
        pipeline.sync();
    }
    
    /**
     * 批量读取
     */
    public void batchGet() {
        List<String> keys = Arrays.asList("key:1", "key:2", "key:3");
        
        Pipeline pipeline = jedis.pipelined();
        List&lt;Response&lt;String&gt;&gt; responses = new ArrayList&lt;&gt;();
        
        for (String key : keys) {
            responses.add(pipeline.get(key));
        }
        
        // 执行
        pipeline.sync();
        
        // 获取结果
        for (Response&lt;String&gt; response : responses) {
            String value = response.get();
            System.out.println(value);
        }
    }
    
    /**
     * Pipeline + 事务组合
     */
    public void pipelineWithTransaction() {
        Pipeline pipeline = jedis.pipelined();
        
        // WATCH 用于乐观锁
        pipeline.watch("user:1");
        
        // 开启事务
        pipeline.multi();
        pipeline.set("user:1", "new_value");
        pipeline.incr("user:1:count");
        
        // 执行
        List&lt;Object&gt; results = pipeline.exec();
        
        // unwatch
        pipeline.unwatch();
    }
}
```

### Pipeline 的特点

| 特点 | 说明 |
|-----|------|
| **原子性** | 无，多个命令独立执行 |
| **性能** | 最高，减少网络往返 |
| **用途** | 批量读写、性能优化 |
| **错误处理** | 命令失败不影响其他命令 |

## 事务（MULTI/EXEC）

### 原理

```
普通事务：
MULTI ──▶ 命令1 ──▶ 命令2 ──▶ 命令3 ──▶ EXEC
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ 批量执行    │
                                    │ 所有命令    │
                                    └─────────────┘
```

### 代码示例

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.Transaction;

/**
 * 事务使用示例
 */
public class TransactionDemo {
    
    private Jedis jedis;
    
    /**
     * 基本事务
     */
    public void basicTransaction() {
        Transaction tx = jedis.multi();
        
        try {
            tx.set("key1", "value1");
            tx.set("key2", "value2");
            tx.incr("counter");
            
            // 执行
            List&lt;Object&gt; results = tx.exec();
            
            // results 包含所有命令的返回值
            for (Object result : results) {
                System.out.println(result);
            }
        } catch (Exception e) {
            // 回滚
            tx.discard();
        }
    }
    
    /**
     * WATCH 用于乐观锁
     */
    public void optimisticLock() {
        // 监视 key
        jedis.watch("account:balance");
        
        // 获取当前值
        String balance = jedis.get("account:balance");
        int current = Integer.parseInt(balance);
        
        if (current < 100) {
            // 余额不足，取消监视
            jedis.unwatch();
            return;
        }
        
        // 开始事务
        Transaction tx = jedis.multi();
        tx.decrby("account:balance", 100);
        tx.incrby("account:pay", 100);
        
        // 执行
        // 如果监视的 key 在 WATCH 之后、EXEC 之前被修改，返回 null
        List&lt;Object&gt; results = tx.exec();
        
        if (results == null) {
            // 冲突，需要重试
            System.out.println("并发冲突，请重试");
        }
    }
    
    /**
     * 错误处理
     */
    public void errorHandling() {
        Transaction tx = jedis.multi();
        
        tx.set("key1", "value1");
        tx.incr("key1");  // 对 String 执行 INCR，Redis 会报错
        
        List&lt;Object&gt; results = tx.exec();
        
        // Redis 事务不支持回滚
        // 如果某个命令失败，前面的命令已经执行，不会撤销
        for (int i = 0; i < results.size(); i++) {
            if (results.get(i) instanceof Exception) {
                System.out.println("命令 " + i + " 失败: " + results.get(i));
            }
        }
    }
}
```

### 事务的特点

| 特点 | 说明 |
|-----|------|
| **原子性** | 有，EXEC 打包执行 |
| **回滚** | 不支持，只在 WATCH 冲突时返回空 |
| **乐观锁** | 支持（WATCH） |
| **错误处理** | 不回滚，但可以检测错误 |

### 为什么不支持回滚？

```
Redis 作者 antirez 的解释：

1. Redis 事务失败只有两种情况：
   - 命令入队时语法错误（可以预防）
   - EXEC 时命令失败（业务逻辑错误）
   
2. 为什么不回滚？
   - Redis 设计哲学：简单、高性能
   - 大部分错误是编程错误，可以在代码层面避免
   - 实现回滚会增加复杂度
```

## Lua 脚本

### 原理

```
Lua 脚本：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   if redis.call('EXISTS', KEYS[1]) == 0 then               │
│       redis.call('SET', KEYS[1], ARGV[1])                  │
│       return 1                                              │
│   else                                                       │
│       return 0                                              │
│   end                                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                     Redis 单线程执行
                              │
                              ▼
                         返回结果
```

### 代码示例

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.scripting.RedisScript;

/**
 * Lua 脚本使用示例
 */
public class LuaScriptDemo {
    
    private Jedis jedis;
    
    /**
     * 分布式锁（Lua 实现）
     */
    public boolean tryLock(String key, String value, int expireSeconds) {
        String script = 
            "if redis.call('SETNX', KEYS[1], ARGV[1]) == 1 then " +
            "    redis.call('EXPIRE', KEYS[1], ARGV[2]) " +
            "    return 1 " +
            "else " +
            "    return 0 " +
            "end";
        
        Long result = (Long) jedis.eval(
            script,
            1,                  // key 数量
            key,                 // KEYS[1]
            value,                // ARGV[1]
            String.valueOf(expireSeconds)  // ARGV[2]
        );
        
        return result == 1;
    }
    
    /**
     * 释放锁（Lua 实现）
     */
    public boolean unlock(String key, String value) {
        String script = 
            "if redis.call('GET', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('DEL', KEYS[1]) " +
            "else " +
            "    return 0 " +
            "end";
        
        Long result = (Long) jedis.eval(
            script,
            1,
            key,
            value
        );
        
        return result == 1;
    }
    
    /**
     * INCR 并设置上限
     */
    public long incrWithCap(String key, long max) {
        String script = 
            "local current = redis.call('INCR', KEYS[1]) " +
            "if current > tonumber(ARGV[1]) then " +
            "    redis.call('DECR', KEYS[1]) " +
            "    return -1 " +
            "end " +
            "return current";
        
        Long result = (Long) jedis.eval(
            script,
            1,
            key,
            String.valueOf(max)
        );
        
        return result;
    }
    
    /**
     * 预加载脚本（提高性能）
     */
    public void useScript() {
        // 脚本缓存
        RedisScript&lt;Long&gt; script = new DefaultRedisScript&lt;&gt;();
        script.setScriptText(
            "return redis.call('INCR', KEYS[1])"
        );
        script.setResultType(Long.class);
        
        // 执行
        Long result = jedis.execute(script, "counter");
    }
}
```

### Lua 脚本的特点

| 特点 | 说明 |
|-----|------|
| **原子性** | 完整脚本原子执行 |
| **可编程性** | 支持条件判断、循环 |
| **性能** | 脚本预编译后执行快 |
| **用途** | 复杂业务逻辑、需要条件判断的场景 |

## 三者对比详解

### Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        Pipeline 工作流程                           │
│                                                                 │
│   客户端                      Redis 服务端                        │
│                                                                 │
│   命令1 ─┐                                                        │
│   命令2 ─┼──▶ [RTT] ──▶ 批量接收 ──▶ 执行 ──▶ 批量返回           │
│   命令3 ─┘                                                        │
│                                                                 │
│   特点：                                                          │
│   - 命令独立执行，互不影响                                         │
│   - 没有原子性保证                                                 │
│   - 性能最优                                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**适用场景**：批量读写、数据聚合、统计计算

### 事务（MULTI/EXEC）

```
┌─────────────────────────────────────────────────────────────────┐
│                        事务工作流程                               │
│                                                                 │
│   客户端                      Redis 服务端                        │
│                                                                 │
│   MULTI                                                                 │
│   命令1 ──▶ 入队 ──▶ 入队 ──▶ 入队                              │
│   命令2 ──┘                                                        │
│   命令3 ──┘                                                        │
│   EXEC ──────────────────────────────────────────────────────────▶ │
│                              批量执行 ──▶ 返回结果                     │
│                                                                 │
│   特点：                                                          │
│   - 原子性（打包执行）                                            │
│   - 无回滚（命令失败继续执行）                                    │
│   - WATCH 支持乐观锁                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**适用场景**：需要批量执行的原子操作

### Lua 脚本

```
┌─────────────────────────────────────────────────────────────────┐
│                       Lua 脚本工作流程                            │
│                                                                 │
│   客户端                      Redis 服务端                        │
│                                                                 │
│   EVAL script 1 k1 v1 ──────────────────────────────────────────▶ │
│                                    ┌─────────────────────────┐   │
│                                    │                         │   │
│                                    │  Lua 虚拟机              │   │
│                                    │  执行脚本                │   │
│                                    │  - 条件判断             │   │
│                                    │  - 循环                 │   │
│                                    │  - Redis 命令调用        │   │
│                                    │                         │   │
│                                    └─────────────────────────┘   │
│                              返回结果 ◀─────────────────────────  │
│                                                                 │
│   特点：                                                          │
│   - 完整原子性                                                    │
│   - 可编程（支持复杂逻辑）                                        │
│   - 单线程执行，无竞争                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**适用场景**：分布式锁、限流、条件更新、复杂业务逻辑

## 性能对比

```java
/**
 * 性能测试
 */
public class PerformanceComparison {
    
    private Jedis jedis;
    
    /**
     * 测试：1000 次写操作
     */
    public void testWritePerformance() {
        // 普通模式：1000 次 RTT
        long start = System.currentTimeMillis();
        for (int i = 0; i < 1000; i++) {
            jedis.set("key:" + i, "value:" + i);
        }
        System.out.println("普通模式: " + (System.currentTimeMillis() - start) + "ms");
        
        // Pipeline：1 次 RTT
        start = System.currentTimeMillis();
        Pipeline pipeline = jedis.pipelined();
        for (int i = 0; i < 1000; i++) {
            pipeline.set("key:" + i, "value:" + i);
        }
        pipeline.sync();
        System.out.println("Pipeline: " + (System.currentTimeMillis() - start) + "ms");
        
        // Lua 脚本：需要循环调用
        // 不适合大量数据
    }
}

/**
 * 测试结果（近似）：
 * 
 * 普通模式: 500-1000ms
 * Pipeline: 50-100ms
 * 
 * Pipeline 快了约 10 倍
 */
```

## 总结

| 场景 | 推荐方案 |
|-----|---------|
| 批量读写，无依赖 | Pipeline |
| 原子性批量操作 | 事务 |
| 条件判断 + 原子性 | Lua 脚本 |
| 分布式锁 | Lua 脚本 或 Redisson |
| 计数器限流 | Lua 脚本 |

## 留给你的问题

Lua 脚本在 Redis 中是原子执行的，但 Lua 脚本执行时间过长会阻塞其他命令。

**如果 Lua 脚本执行时间超过 5 秒，会发生什么？有什么方案可以解决这个问题？**
