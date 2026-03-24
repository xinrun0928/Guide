# Cache Aside vs Read/Write Through vs Write Behind

面试官：「缓存和数据库怎么保持一致？」

你：「Cache-Aside 模式。」

面试官：「还有呢？」

你：「……」

今天来聊聊缓存的三种经典模式。

## 三种缓存模式概览

```
┌─────────────────────────────────────────────────────────────────┐
│                      三种缓存读写模式                              │
│                                                                 │
│   Cache-Aside          Read/Write Through      Write Behind      │
│   ──────────           ─────────────────       ────────────      │
│                                                                 │
│   应用同时和缓存、        应用只和缓存交互，         应用只写缓存，    │
│   数据库交互              缓存负责和数据库交互        异步写回数据库   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 模式一：Cache-Aside（旁路缓存）

### 读流程

```
1. 应用 ──▶ 缓存：GET key
2. 缓存 ──▶ 应用：未命中
3. 应用 ──▶ 数据库：SELECT
4. 数据库 ──▶ 应用：返回数据
5. 应用 ──▶ 缓存：SET key data
6. 应用返回数据
```

### 写流程

```
1. 应用 ──▶ 数据库：UPDATE
2. 数据库 ──▶ 应用：成功
3. 应用 ──▶ 缓存：DEL key
4. 应用返回成功
```

### 代码实现

```java
/**
 * Cache-Aside 模式
 * 
 * 特点：应用层负责管理缓存和数据库的交互
 */
public class CacheAsidePattern {
    
    private Jedis jedis;
    
    /**
     * 读取
     */
    public &lt;T&gt; T read(String key, Class&lt;T&gt; clazz, Supplier&lt;T&gt; dbLoader) {
        // 1. 先查缓存
        String cacheValue = jedis.get(key);
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, clazz);
        }
        
        // 2. 缓存未命中，查数据库
        T data = dbLoader.get();
        
        // 3. 回填缓存
        if (data != null) {
            jedis.setex(key, 30 * 60, JSON.toJSONString(data));
        }
        
        return data;
    }
    
    /**
     * 写入
     */
    public void write(String key, Runnable dbWriter) {
        // 1. 先更新数据库
        dbWriter.run();
        
        // 2. 删除缓存（不是更新！）
        jedis.del(key);
    }
}
```

### 适用场景

| 场景 | 适用性 |
|-----|--------|
| 读多写少 | ✅ 推荐 |
| 写多读少 | ⚠️ 写频繁时，缓存命中率低 |
| 一致性要求高 | ⚠️ 需要额外处理 |

### 优缺点

| 优点 | 缺点 |
|-----|------|
| 实现简单 | 应用层代码复杂 |
| 缓存策略灵活 | 需要处理各种边界情况 |
| 读性能好 | 写一致性需要额外保证 |

## 模式二：Read/Write Through（读写穿透）

### Read Through

```
1. 应用 ──▶ 缓存：GET key
2. 缓存：未命中，自动查数据库
3. 缓存 ──▶ 数据库：SELECT
4. 缓存 ◀── 数据库：返回数据
5. 缓存 ──▶ 应用：返回数据
```

### Write Through

```
1. 应用 ──▶ 缓存：SET key data
2. 缓存：自动更新数据库
3. 缓存 ──▶ 数据库：UPDATE
4. 缓存 ◀── 数据库：成功
5. 缓存 ──▶ 应用：成功
```

### 代码实现

```java
/**
 * Write-Through 缓存实现
 * 
 * 特点：缓存是数据的唯一来源，数据库由缓存自动维护
 */
public class WriteThroughCache&lt;K, V&gt; {
    
    private Map&lt;K, V&gt; cache = new ConcurrentHashMap&lt;&gt;();
    private Function&lt;K, V&gt; dbLoader;
    private BiConsumer&lt;K, V&gt; dbWriter;
    
    public WriteThroughCache(Function&lt;K, V&gt; dbLoader, BiConsumer&lt;K, V&gt; dbWriter) {
        this.dbLoader = dbLoader;
        this.dbWriter = dbWriter;
    }
    
    /**
     * 读取（Read Through）
     */
    public V get(K key) {
        // 1. 先查缓存
        V value = cache.get(key);
        if (value != null) {
            return value;
        }
        
        // 2. 缓存未命中，从数据库加载
        value = dbLoader.apply(key);
        
        // 3. 存入缓存
        if (value != null) {
            cache.put(key, value);
        }
        
        return value;
    }
    
    /**
     * 写入（Write Through）
     */
    public void put(K key, V value) {
        // 1. 写入缓存
        cache.put(key, value);
        
        // 2. 同步写入数据库
        dbWriter.accept(key, value);
    }
}
```

### 适用场景

| 场景 | 适用性 |
|-----|--------|
| 数据一致性要求高 | ✅ 推荐 |
| 写操作不频繁 | ✅ 推荐 |
| 缓存层可作为主存储 | ⚠️ 需要缓存支持 |

### 优缺点

| 优点 | 缺点 |
|-----|------|
| 应用层代码简洁 | 缓存需要支持写穿透 |
| 数据一致性自动保证 | 写操作延迟较高 |
| 架构清晰 | 缓存成为关键依赖 |

## 模式三：Write Behind（异步写回）

### 写流程

```
1. 应用 ──▶ 缓存：SET key data
2. 缓存 ──▶ 应用：成功（立即返回）
3. 缓存：异步写入数据库
```

### 代码实现

```java
/**
 * Write Behind 模式
 * 
 * 特点：高写入性能，数据最终一致
 */
public class WriteBehindCache&lt;K, V&gt; {
    
    private Map&lt;K, V&gt; cache = new ConcurrentHashMap&lt;&gt;();
    private BlockingQueue&lt;WriteOperation&lt;K, V&gt;&gt; writeQueue;
    private BiConsumer&lt;K, V&gt; dbWriter;
    
    public WriteBehindCache(BiConsumer&lt;K, V&gt; dbWriter, int queueSize) {
        this.dbWriter = dbWriter;
        this.writeQueue = new LinkedBlockingQueue&lt;&gt;(queueSize);
        startBackgroundWriter();
    }
    
    /**
     * 写入（异步）
     */
    public void put(K key, V value) {
        // 1. 立即写入缓存
        cache.put(key, value);
        
        // 2. 放入写队列
        writeQueue.offer(new WriteOperation&lt;&gt;(OperationType.PUT, key, value));
    }
    
    /**
     * 删除
     */
    public void remove(K key) {
        // 1. 立即删除缓存
        cache.remove(key);
        
        // 2. 放入写队列
        writeQueue.offer(new WriteOperation&lt;&gt;(OperationType.DELETE, key, null));
    }
    
    /**
     * 后台批量写回
     */
    private void startBackgroundWriter() {
        Thread writerThread = new Thread(() -> {
            List&lt;WriteOperation&lt;K, V&gt;&gt; batch = new ArrayList&lt;&gt;();
            
            while (true) {
                try {
                    // 收集一批数据（最多 100 条或等待 1 秒）
                    writeQueue.drainTo(batch, 100);
                    
                    if (!batch.isEmpty()) {
                        // 批量写入数据库
                        batchWrite(batch);
                        batch.clear();
                    } else {
                        Thread.sleep(100);
                    }
                } catch (Exception e) {
                    log.error("Write Behind 写入失败", e);
                }
            }
        });
        writerThread.start();
    }
    
    /**
     * 批量写入
     */
    private void batchWrite(List&lt;WriteOperation&lt;K, V&gt;&gt; operations) {
        // 按 key 合并，只保留最新操作
        Map&lt;K, WriteOperation&lt;K, V&gt;&gt; merged = new LinkedHashMap&lt;&gt;();
        for (WriteOperation&lt;K, V&gt; op : operations) {
            merged.put(op.getKey(), op);
        }
        
        // 执行合并后的操作
        for (WriteOperation&lt;K, V&gt; op : merged.values()) {
            if (op.getType() == OperationType.DELETE) {
                dbWriter.accept(op.getKey(), null);  // 删除操作
            } else {
                dbWriter.accept(op.getKey(), op.getValue());  // 写入操作
            }
        }
    }
}
```

### 适用场景

| 场景 | 适用性 |
|-----|--------|
| 高并发写入 | ✅ 推荐 |
| 允许短暂不一致 | ✅ 推荐 |
| 日志、统计等 | ✅ 推荐 |
| 金融交易 | ❌ 不适用 |
| 库存扣减 | ❌ 不适用 |

### 优缺点

| 优点 | 缺点 |
|-----|------|
| 写入性能极高 | 数据最终一致，非强一致 |
| 减少数据库压力 | 系统宕机可能丢数据 |
| 适合高并发场景 | 实现复杂 |

## 三种模式对比

| 维度 | Cache-Aside | Read/Write Through | Write Behind |
|-----|-------------|--------------------|--------------|
| **一致性** | 最终一致 | 强一致 | 最终一致 |
| **性能** | 读快，写一般 | 读写一般 | 写快 |
| **复杂度** | 中 | 中 | 高 |
| **数据安全性** | 好 | 好 | 一般 |
| **应用代码** | 复杂 | 简单 | 中等 |
| **缓存依赖** | 低 | 高 | 高 |

## 如何选择？

### 选择决策树

```
业务场景是什么？
        │
        ├─ 读多写少，需要高性能读取？
        │       └─→ Cache-Aside
        │
        ├─ 写多读少，需要高性能写入？
        │       └─→ Write Behind
        │
        ├─ 数据一致性要求很高？
        │       └─→ Write Through
        │
        └─ 通用场景？
                └─→ Cache-Aside
```

### 实际案例

#### 案例一：用户信息缓存

```
场景：用户很少修改信息，频繁读取
模式：Cache-Aside
原因：读多写少，Cache-Aside 最适合
```

```java
// Cache-Aside
public User getUser(String userId) {
    String cacheKey = "user:" + userId;
    String cacheValue = jedis.get(cacheKey);
    if (cacheValue != null) {
        return JSON.parseObject(cacheValue, User.class);
    }
    
    User user = db.findUser(userId);
    jedis.setex(cacheKey, 60 * 60, JSON.toJSONString(user));
    return user;
}
```

#### 案例二：配置中心

```
场景：配置读取频繁，配置修改较少
模式：Cache-Aside + 变更通知
原因：需要强一致性，变更时主动推送到缓存
```

#### 案例三：日志收集系统

```
场景：每秒写入上万条日志
模式：Write Behind
原因：写入量极大，需要批量写数据库
```

## 混合模式

实际项目中，可能会混合使用多种模式：

```java
/**
 * 混合模式：Cache-Aside + Write Behind
 * 
 * 读：Cache-Aside
 * 写：Write Behind（写入队列，批量写库）
 */
public class HybridCachePattern {
    
    // 读操作：Cache-Aside
    public Object read(String key) {
        // ... Cache-Aside 实现
    }
    
    // 写操作：Write Behind
    public void write(String key, Object value) {
        // 1. 立即更新缓存
        cache.put(key, value);
        
        // 2. 放入写队列
        writeQueue.offer(new WriteOperation(key, value));
    }
}
```

## 总结

| 模式 | 一致性 | 性能 | 适用场景 |
|-----|-------|------|---------|
| Cache-Aside | 最终一致 | 读快 | 读多写少 |
| Read/Write Through | 强一致 | 读写一般 | 一致性要求高 |
| Write Behind | 最终一致 | 写快 | 高并发写入 |

## 留给你的问题

Write Behind 模式虽然性能高，但如果系统突然宕机，写队列中的数据会丢失。

**如何设计一个可靠的 Write Behind 系统，保证在系统宕机时也能恢复未写入的数据？提示：考虑 WAL（Write-Ahead Logging）。**
