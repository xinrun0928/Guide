# 缓存与数据库双写一致性：Cache Aside、Read Through、Write Through、Write Behind

缓存和数据库，哪个是「真」的？

这个问题听起来很傻，但回答不好的人很多。

**数据库是最终的数据源**，缓存只是加速层。这意味着，缓存里的数据可能过时，数据库里的数据永远是对的。

所以，保证缓存和数据库一致，就成了分布式系统最经典的问题之一。

## 为什么一致性问题不可避免

在单节点场景下，更新数据后再更新缓存，一致性很容易保证。

但分布式系统里，问题变复杂了：

1. **并发问题**：请求 A 更新 DB，请求 B 也在更新 DB，缓存更新顺序可能和 DB 更新顺序不一致
2. **主从延迟**：写主库、读从库，从库可能有延迟
3. **缓存失效**：缓存被删除后，还没来得及回填，请求就来了

没有完美的方案，只有业务能接受的权衡。

## Cache Aside（旁路缓存）

这是最常用、最推荐的方案。

### 读流程

```
查缓存 → 命中 → 返回
查缓存 → 未命中 → 查数据库 → 写缓存 → 返回
```

```java
public Product getProduct(Long id) {
    // 1. 先查缓存
    Product cached = cache.get(id);
    if (cached != null) {
        return cached;
    }

    // 2. 缓存未命中，查数据库
    Product product = productMapper.selectById(id);

    // 3. 写缓存
    if (product != null) {
        cache.set(id, product);
    }

    return product;
}
```

### 写流程

**先更新数据库，再删除缓存。** 不是更新缓存，是删除！

```java
public void updateProduct(Product product) {
    // 1. 先更新数据库
    productMapper.updateById(product);

    // 2. 删除缓存（不是更新！）
    cache.evict(product.getId());
}
```

### 为什么是删除不是更新？

因为**更新缓存的成本可能比删除更高**：

1. 如果缓存的数据需要复杂计算（如聚合查询），更新代价很大
2. 如果这个缓存后续不会被访问，更新就白做了
3. 删除只需要一次操作，更新可能涉及读写两次

而且，删除后下次查询自然回填，数据一定是最新的。

## Read Through（读穿透）

应用只感知缓存，缓存未命中时自动查数据库并回填。

```java
public interface ProductService {
    Product getProduct(Long id);
}

@Service
public class ProductCacheService implements ProductService {

    @Autowired
    private ProductRepository productRepository;

    @Override
    public Product getProduct(Long id) {
        // 应用只感知这层 Service，不知道有数据库
        Product product = cache.get(id);
        if (product == null) {
            product = productRepository.selectById(id);
            cache.set(id, product);
        }
        return product;
    }
}
```

**特点**：对应用透明，代码简单。但实现缓存层的库需要支持这个功能。

## Write Through（同步双写）

写操作同时写 DB 和缓存。

```java
public void updateProduct(Product product) {
    // 同时写 DB 和缓存
    productRepository.updateById(product);
    cache.set(product.getId(), product);
}
```

### 问题

1. **性能差**：两次写操作，必须等两个都成功才返回
2. **数据不一致风险**：如果 DB 成功、缓存失败，数据就乱了
3. **浪费资源**：如果数据后续没人读，白写了一次缓存

**适用场景**：对一致性要求极高、写入后立即会被读取的场景。

## Write Behind（异步写入）

先写缓存，异步批量写数据库。

```java
public void updateProduct(Product product) {
    // 先写缓存
    cache.set(product.getId(), product);

    // 异步写 DB（用 MQ 或定时任务）
    asyncWriteQueue.add(new WriteRequest(product));
}
```

### 优点

- **性能最高**：写缓存是内存操作，几乎瞬间完成
- **削峰填谷**：高峰时写缓存，低谷时批量写 DB

### 缺点

- **可能丢数据**：如果系统在缓存写入后、DB 写入前崩溃，数据会丢失
- **实现复杂**：需要处理写失败、幂等等问题

**适用场景**：对一致性要求不那么高、但对性能要求高的场景。如日志、统计指标、点赞数等。

## 四种策略对比

| 策略 | 一致性 | 性能 | 实现复杂度 | 数据安全性 |
|-----|-------|------|----------|-----------|
| Cache Aside | 最终一致 | 高 | 低 | 缓存失效时可能有短暂不一致 |
| Read Through | 最终一致 | 高 | 中 | 依赖缓存实现 |
| Write Through | 强一致 | 低 | 低 | 双重写入，有失败风险 |
| Write Behind | 弱一致 | 最高 | 高 | 可能丢数据 |

## Cache Aside 的深度思考

### 先删缓存 vs 先更新 DB

业界争论最多的问题。

**方案 A：先删缓存，再更新 DB**

```
1. 删除缓存
2. 更新数据库
```

问题：
1. 请求 A 删除缓存
2. 请求 B 查询，未命中，查 DB 得到旧值
3. 请求 B 写缓存（旧值）
4. 请求 A 更新 DB（新值）
结果：缓存是旧值，DB 是新值

**方案 B：先更新 DB，再删缓存**

```
1. 更新数据库
2. 删除缓存
```

问题：
1. 请求 A 更新 DB
2. 请求 B 查询，命中旧缓存
3. 请求 A 删除缓存
结果：可能返回旧值，但很快就会一致

**哪个更好？**

理论上，方案 B 更优。但实际操作中，两种方案都无法完全避免不一致，只是概率不同。

### 延迟双删

针对方案 B 的补救措施：

```java
public void updateProduct(Product product) {
    // 1. 先删除缓存
    cache.evict(product.getId());

    // 2. 更新数据库
    productRepository.updateById(product);

    // 3. 延迟一段时间后再删除缓存（异步）
    // 目的是让读请求携带的旧缓存有机会被删除
    delayQueue.add(() -> cache.evict(product.getId()));
}
```

延迟时间 = 读操作平均耗时 + 缓存写入耗时，通常几百毫秒。

## 面试追问方向

- 为什么 Cache Aside 写操作是删除缓存而不是更新？（答：删除代价更小，避免脏写）
- 如何处理缓存和数据库的主从延迟问题？（答：读主库、延迟双删、强制读主）
- Write Behind 丢数据的问题怎么解决？（答：写成功后再确认、持久化队列、分布式事务）

## 小结

没有银弹，只有权衡：

- **一致性要求高**：选 Cache Aside + 延迟双删
- **性能要求极高**：选 Write Behind，但接受可能丢数据
- **简单直接**：选 Write Through，但接受性能损失

大多数互联网场景，Cache Aside 是最优选择。理解它的原理和边界，比追求「完美方案」更重要。
