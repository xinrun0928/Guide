# MySQL 高并发场景优化：热点行问题

12306 抢票、秒杀活动、限时抢购……这些场景有一个共同特点：**大量请求竞争同一批数据**。

当 10000 个用户同时抢购 100 件商品时，同一行数据要被更新 10000 次。这在 MySQL 中，会发生什么？

**答案是：9999 个请求在排队等待，只有 1 个能成功。**

这就是经典的「热点行」问题。

## 为什么热点行会成为瓶颈？

InnoDB 的行锁机制保证了并发更新的数据一致性。但当多个事务竞争同一行时：

1. 第一个事务获得行锁，开始执行
2. 其他事务等待锁释放
3. 等待的事务越多，排队时间越长
4. 更糟糕的是，等待的事务会占用连接资源

```sql
-- 查看锁等待情况
SELECT 
    r.trx_id,
    r.trx_mysql_thread_id,
    r.trx_state,
    r.trx_started,
    r.trx_rows_locked,
    l.lock_index,
    l.lock_table
FROM information_schema.INNODB_LOCK_WAITS w
JOIN information_schema.INNODB_TRX r ON w.blocking_trx_id = r.trx_id
JOIN information_schema.INNODB_LOCKS l ON w.requested_lock_id = l.lock_id;
```

## 解决方案一：分布式锁

最直接的思路：用分布式锁控制并发，只有一个请求能「抢到锁」，然后去更新数据库。

```java
public boolean seckill(Long productId, Long userId) {
    // 获取分布式锁
    String lockKey = "seckill:product:" + productId;
    String lockValue = userId + ":" + System.currentTimeMillis();
    
    Boolean acquired = redisTemplate.opsForValue()
        .setIfAbsent(lockKey, lockValue, 10, TimeUnit.SECONDS);
    
    if (!acquired) {
        throw new BusinessException("系统繁忙，请稍后重试");
    }
    
    try {
        // 查询库存
        Product product = productMapper.selectById(productId);
        if (product.getStock() <= 0) {
            return false;  // 已售罄
        }
        
        // 扣减库存
        productMapper.decreaseStock(productId, 1);
        return true;
    } finally {
        redisTemplate.delete(lockKey);
    }
}
```

**问题**：
- 锁的实现有复杂度
- 分布式锁本身可能成为瓶颈
- 如果锁服务不可用，整个系统都受影响

## 解决方案二：乐观锁 + 重试

乐观锁的核心思想：**先检查再更新，更新失败就重试**。

```java
public boolean seckill(Long productId, Long userId) {
    int retryCount = 3;
    
    while (retryCount > 0) {
        // 查询当前库存和版本号
        Product product = productMapper.selectById(productId);
        if (product.getStock() <= 0) {
            return false;
        }
        
        // 乐观锁更新：WHERE stock = 1 AND version = ?
        int affectedRows = productMapper.decreaseStockWithVersion(
            productId, 
            product.getVersion()
        );
        
        if (affectedRows > 0) {
            return true;  // 更新成功
        }
        
        retryCount--;
        // 重试前短暂等待
        try {
            Thread.sleep(50);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    
    return false;
}
```

```sql
-- Mapper 层
UPDATE product_stock
SET stock = stock - 1, version = version + 1
WHERE id = #{productId}
  AND version = #{version}
  AND stock > 0
```

**优点**：
- 无锁实现，性能好
- 没有分布式锁的复杂性

**缺点**：
- 高并发下大量重试，浪费资源
- 如果热点商品库存很多，冲突会非常多

## 解决方案三：批量扣减

换个思路：**不要一行一行扣，一次扣完所有库存**。

```java
public List<SeckillResult> batchSeckill(List<SeckillRequest> requests) {
    // 一次性查询所有相关商品
    Set<Long> productIds = requests.stream()
        .map(SeckillRequest::getProductId)
        .collect(Collectors.toSet());
    
    Map<Long, Product> productMap = productMapper
        .selectByIds(productIds)
        .stream()
        .collect(Collectors.toMap(Product::getId, p -> p));
    
    List<SeckillResult> results = new ArrayList<>();
    
    for (SeckillRequest request : requests) {
        Product product = productMap.get(request.getProductId());
        
        if (product == null) {
            results.add(new SeckillResult(request.getUserId(), "商品不存在"));
            continue;
        }
        
        if (product.getStock() <= 0) {
            results.add(new SeckillResult(request.getUserId(), "已售罄"));
            continue;
        }
        
        // 更新库存（原子操作）
        int updated = productMapper.decreaseStock(productId, 1);
        if (updated > 0) {
            results.add(new SeckillResult(request.getUserId(), "成功"));
        } else {
            results.add(new SeckillResult(request.getUserId(), "已售罄"));
        }
    }
    
    return results;
}
```

```sql
-- 批量扣减 SQL
UPDATE product_stock
SET stock = stock - 1
WHERE id = #{id} AND stock > 0
```

## 解决方案四：数据库设计优化

### 减少锁竞争：分段库存

把一行库存拆成多行，比如 100 件商品拆成 10 行，每行 10 件：

```sql
-- 库存表设计
CREATE TABLE product_stock (
    id BIGINT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    stock BIGINT NOT NULL,
    warehouse_code VARCHAR(20) NOT NULL,  -- 仓库代码
    INDEX idx_product (product_id)
);

-- 初始化：100 件商品，拆成 10 行
INSERT INTO product_stock VALUES
(1, 10001, 10, 'WH01'),
(2, 10001, 10, 'WH02'),
(3, 10001, 10, 'WH03'),
...
(10, 10001, 10, 'WH10');
```

```java
// 查询时随机选择一个仓库
public boolean seckill(Long productId) {
    Long warehouseId = (long) (Math.random() * 10 + 1);
    
    return productMapper.decreaseStockByWarehouse(productId, warehouseId, 1) > 0;
}
```

```sql
-- 更新时指定仓库
UPDATE product_stock
SET stock = stock - 1
WHERE id = #{warehouseId}
  AND product_id = #{productId}
  AND stock > 0
```

**效果**：锁的竞争被分散到 10 个不同的行，并发能力提升 10 倍。

### 异步化：先扣库存，后发消息

```java
public void seckill(Long productId, Long userId) {
    // 先记录请求，返回排队中
    SeckillRequest request = new SeckillRequest(productId, userId);
    requestMapper.insert(request);
    
    // 发送消息到消息队列
    mqTemplate.convertAndSend("seckill", productId, userId);
}

// 消息消费者
@RabbitListener(queues = "seckill")
public void handleSeckill(Long productId, Long userId) {
    // 异步扣减库存
    productMapper.decreaseStock(productId, 1);
}
```

**优点**：
- 请求立即返回，用户体验好
- 削峰填谷，保护数据库

**缺点**：
- 异步处理，可能出现超卖（需要额外控制）
- 用户不能立即知道结果

## 热点行的监控

```sql
-- 查看当前锁等待
SELECT 
    blocking_trx_id,
    blocking_thread_id,
    requesting_trx_id,
    requesting_thread_id,
    lock_mode,
    lock_type
FROM information_schema.INNODB_LOCK_WAITS;

-- 查看事务状态
SELECT 
    trx_id,
    trx_state,
    trx_mysql_thread_id,
    trx_started,
    trx_rows_locked,
    trx_query
FROM information_schema.INNODB_TRX
WHERE trx_state = 'LOCK WAIT';

-- 查看具体的锁
SELECT 
    lock_id,
    lock_trx_id,
    lock_mode,
    lock_type,
    lock_index,
    lock_space,
    lock_page,
    lock_record
FROM information_schema.INNODB_LOCKS;
```

## 总结

热点行问题是高并发系统的常见挑战，解决思路有以下几条：

1. **减少锁范围**：分段库存、分散热点
2. **乐观并发控制**：版本号机制，减少阻塞
3. **异步化处理**：削峰填谷，保护数据库
4. **缓存层**：用 Redis 扛住大部分读请求

---

## 留给你的问题

假设有这样的场景：

- 热门商品的详情页，每天有 1000 万次访问
- 商品的库存只有 100 件
- 需要保证不超卖，同时用户不能等太久

请思考：

1. 如果库存扣减使用乐观锁，高并发下会发生什么？大量用户会看到什么提示？
2. 如果用分段库存优化，段数设置为多少合适？太少效果不明显，太多有什么问题？
3. 如果让你设计一个完整的秒杀系统，你会如何组合以上方案？

这道题的关键在于理解不同方案的适用场景，以及如何根据业务特点选择最优解。
