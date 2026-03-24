# 多级缓存架构：本地缓存 + 分布式缓存 + CDN

「双十一」零点刚过，你盯着监控大屏，看着订单系统 QPS 从日常的 1000 飙到 50000。

数据库服务器的 CPU 已经打满，Redis 集群的延迟也开始飙升。

但隔壁组的老王，却稳如泰山。他的秘诀是什么？

——**多级缓存架构**。

---

## 为什么需要多级缓存？

单级缓存的瓶颈很明显：

**本地缓存**虽然快（内存访问，纳秒级），但：
- 无法跨 JVM 共享，每个节点都是信息孤岛
- 内存空间有限，装不下全量热点数据
- 节点扩缩容时，缓存失效导致「惊群效应」

**分布式缓存**虽然能共享：
- 但多一次网络往返，延迟从纳秒变成毫秒级
- Redis Cluster 故障时，影响范围是全局的

所以，我们需要**把两者结合起来**，再配合 CDN，形成「三层缓存体系」：

```
请求 → CDN（静态资源）→ 本地缓存（JVM）→ 分布式缓存（Redis）→ 数据库
```

越靠近用户，速度越快；越靠近数据源，准确性越高。

---

## CDN：离用户最近的缓存

CDN（Content Delivery Network，内容分发网络）是第一道缓存层，主要缓存**静态资源**：

- 图片、视频、CSS、JavaScript 等
- HTML 页面（可选，开启esi可以用）
- API 响应（部分场景）

### CDN 的工作原理

```
用户请求 → DNS 智能解析 → 最近 CDN 节点 → 缓存命中 → 直接返回
                                    ↓ 未命中
                              回源到业务服务器 → 缓存到 CDN 节点 → 返回
```

### CDN 缓存策略

```java
// CDN 响应头设置（以 Nginx 为例）
location ~* \.(jpg|png|css|js)$ {
    # 缓存时间 7 天
    expires 7d;
    
    # 启用 CDN 私有缓存（针对登录用户）
    add_header Cache-Control "public, max-age=604800";
    
    # 验证缓存有效性
    add_header ETag $upstream_http_etag;
    add_header Last-Modified $upstream_http_last_modified;
}
```

### CDN 适用场景

| 场景 | 效果 |
|---|---|
| 商品图片 | 用户量 × 图片大小，节省大量带宽 |
| JS/CSS | 浏览器缓存，CDN 节点分担请求 |
| 热点视频 | 点播类场景，CDN 命中率决定成本 |

**不适用场景**：个性化数据、实时性要求高的接口。

---

## 本地缓存：JVM 内的极速访问

本地缓存是第二层，存在于每个应用进程的 JVM 堆内存中。

### 本地缓存的优势

1. **零网络开销**：纯内存访问，延迟 < 1μs
2. **零序列化**：直接存储对象，无需 JSON/Protobuf 编解码
3. **简单可靠**：不依赖外部服务，不存在网络分区风险

### 本地缓存的劣势

1. **进程隔离**：每台机器的缓存是独立的，可能不一致
2. **内存有限**：不能缓存太多数据，否则影响 GC
3. **扩缩容问题**：新增节点时，本地缓存为空，瞬间压力打到下游

### 典型的本地缓存组件

关于各组件的详细对比，参见 [本地缓存：Caffeine、Guava Cache、Ehcache 对比](/high-performance/cache/local-cache)。

---

## 分布式缓存：跨节点的数据共享

分布式缓存是第三层，通常选择 Redis 或 Memcache。

### 为什么需要分布式缓存？

本地缓存解决不了的问题：
- 多台机器需要共享同一份数据
- 缓存空间需要远超单机的内存容量
- 需要缓存组件提供高可用保障

### 分布式缓存的特点

1. **容量可扩展**：集群模式可以横向扩容
2. **数据一致性**：通过一致性协议保证多节点数据一致
3. **高可用**：主从复制、哨兵、集群等机制

### 典型架构

```
应用服务器 → Redis Cluster → 数据分片（16384 个槽）
                         → 副本节点（从库）→ 读写分离
```

关于 Redis Cluster 与 Memcache 的对比，参见 [分布式缓存：Redis Cluster vs Memcache](/high-performance/cache/distributed-cache)。

---

## 多级缓存的协同策略

三层缓存不是简单的叠加，需要精心设计它们的协作方式。

### 读取流程

```
1. 请求到达，先查 CDN（静态资源）
2. CDN 未命中，查本地缓存（如 Caffeine）
3. 本地缓存未命中，查 Redis 分布式缓存
4. Redis 未命中，查数据库
5. 数据库返回后，按顺序回填：本地缓存 → Redis
```

```java
public String getProduct(Long productId) {
    // 第一层：本地缓存
    Product product = localCache.get(productId);
    if (product != null) {
        return product.getName();
    }
    
    // 第二层：分布式缓存
    product = redis.get("product:" + productId);
    if (product != null) {
        // 回填本地缓存
        localCache.put(productId, product);
        return product.getName();
    }
    
    // 第三层：数据库
    product = productDao.selectById(productId);
    if (product != null) {
        // 双写缓存
        redis.setex("product:" + productId, 3600, product);
        localCache.put(productId, product);
    }
    
    return product != null ? product.getName() : null;
}
```

### 写入流程

写入时，需要考虑缓存一致性问题，通常采用**Cache Aside 模式**：

1. 先更新数据库
2. 再删除缓存（而非更新）

为什么要删除而不是更新？因为删除操作是幂等的，更新操作在高并发下可能导致数据不一致。

关于一致性方案的详细讨论，参见 [缓存与数据库双写一致性：延时双删 + 订阅 binlog](/high-performance/cache/consistency)。

---

## 多级缓存的挑战与应对

### 挑战一：缓存雪崩

大量缓存同时过期，导致瞬间大量请求打到数据库。

**应对策略**：
- 过期时间加随机偏移量（`baseTime + Random.nextInt(300)`）
- 本地缓存永不过期，后台异步刷新
- 热点数据永久保留

### 挑战二：缓存不一致

多级缓存之间、本地缓存与分布式缓存之间，可能出现数据不一致。

**应对策略**：
- 设置合理的 TTL，让数据自动过期
- 数据变更时，主动失效相关缓存
- 敏感场景放弃本地缓存，只用分布式缓存

### 挑战三：热点数据集中

热门商品、明星塌房等突发事件，导致某些 key 访问量暴增。

**应对策略**：
- 本地缓存兜底，分担 Redis 压力
- Redis Cluster 做热点 key 探测和迁移
- 必要时降级服务，保护数据库

关于热点数据的处理，参见 [热点数据识别与预热](/high-performance/cache/hot-data)。

---

## 总结

多级缓存架构的核心思想是：**分层治理，各司其职**。

- CDN 扛住静态资源的流量
- 本地缓存扛住热点数据的访问
- 分布式缓存提供跨节点的数据共享

三层缓存配合使用，可以在大部分场景下把数据库 QPS 从 10000+ 降到 100 以内。

但多级缓存也带来了复杂度：一致性如何保证？雪崩如何避免？热点如何应对？这些问题，后面的文章会逐一展开。

---

## 留给你的问题

假设这样一个场景：商品详情页有**千人千面**的个性化推荐，用户 A 和用户 B 看到的商品信息大部分相同，但推荐模块不同。

这种情况下，本地缓存还能用吗？如果能用，应该怎么设计？

提示：可以从缓存粒度、缓存失效策略、内存占用等角度思考。
