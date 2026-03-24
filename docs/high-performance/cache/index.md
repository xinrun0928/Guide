# 缓存与分布式缓存

你的系统上线了，最初一切正常。

随着用户量增长，数据库开始撑不住了。查询时间从 5ms 飙升到 200ms，用户开始抱怨：怎么越来越慢了？

你加了缓存，查询时间降到了 20ms。系统稳住了半年。

然后，缓存问题开始显现：

- 缓存挂了，数据库直接被打爆
- 缓存数据过期，大量请求同时穿透到数据库
- 缓存和数据库数据不一致，用户看到了脏数据
- 缓存命中率只有 30%，缓存形同虚设

**缓存是性能优化的利器，但用不好就是灾难的源泉。**

本模块系统讲解多级缓存架构、缓存策略与一致性、Redis 进阶知识，帮助你构建可靠高效的缓存体系。

---

## 模块速览

### 缓存基础与分层架构

| 文档 | 简介 |
|-----|-----|
| [本地缓存实战](/high-performance/cache/local-cache) | Caffeine、Guava Cache 本地缓存 |
| [多级缓存架构](/high-performance/cache/multi-level) | 本地缓存 + 分布式缓存 + CDN |
| [热点数据识别与处理](/high-performance/cache/hot-data) | 热 key 发现与解决方案 |

### 缓存策略与一致性

| 文档 | 简介 |
|-----|-----|
| [缓存读写模式](/high-performance/cache/read-write-pattern) | Cache Aside、Read/Write Through、Write Behind |
| [缓存一致性保障](/high-performance/cache/consistency) | 延时双删、订阅 binlog、最终一致性 |
| [缓存版本控制](/high-performance/cache/version-control) | 多版本并发控制 |

### Redis 进阶

| 文档 | 简介 |
|-----|-----|
| [Redis 数据类型与选择](/high-performance/cache/redis-datatype) | String、Hash、List、Set、ZSet |
| [Redis 过期策略与淘汰策略](/high-performance/cache/redis-eviction) | TTL、LRU、LFU 等 |
| [Redis 过期机制详解](/high-performance/cache/redis-expire) | 过期 key 的删除时机 |
| [Redis Lua 脚本应用](/high-performance/cache/redis-script) | 原子操作与分布式锁 |

### 缓存问题与应对

| 文档 | 简介 |
|-----|-----|
| [缓存穿透问题](/high-performance/cache/penetration) | 布隆过滤器、空值缓存 |
| [缓存击穿问题](/high-performance/cache/breakdown) | 互斥锁、永不过期 |
| [缓存雪崩问题](/high-performance/cache/avalanche) | 随机过期时间、服务熔断 |
| [分布式缓存架构](/high-performance/cache/distributed-cache) | Redis Cluster、Codis |

### 缓存高级主题

| 文档 | 简介 |
|-----|-----|
| [Caffeine 高性能缓存](/high-performance/cache/caffeine) | 命中率优化、W-TinyLFU 算法 |
| [缓存命中率优化](/high-performance/cache/hit-ratio) | 命中率分析与提升策略 |
| [缓存进阶指南](/high-performance/cache/advance) | 性能优化与最佳实践 |

---

## 为什么需要缓存？

缓存之所以有效，是因为计算机世界存在两个不变的原则：

**局部性原理**：最近访问的数据，很可能会再次被访问。

**80/20 法则**：80% 的访问请求，来自 20% 的数据。

利用这两个原则，我们可以把热点数据放在缓存里，减少对数据库的访问，从而大幅提升系统性能。

典型的性能提升：

| 场景 | 无缓存 | 有缓存 | 提升倍数 |
|-----|-------|-------|---------|
| 查询用户信息 | 50ms | 2ms | 25x |
| 查询商品列表 | 200ms | 5ms | 40x |
| 查询首页数据 | 300ms | 10ms | 30x |

---

## 缓存架构设计

### 第一层：本地缓存

本地缓存是最快的，访问时间在纳秒级别。

适用场景：数据量小、不经常变化、访问极其频繁的数据。

常见实现：Caffeine、Guava Cache。

### 第二层：分布式缓存

分布式缓存是跨进程的，访问时间在毫秒级别。

适用场景：需要在多个实例间共享的数据、需要持久化的数据。

常见实现：Redis、Memcached。

### 第三层：CDN

CDN 缓存静态资源，访问时间在毫秒级别。

适用场景：图片、视频、CSS、JS 等静态资源。

---

## 缓存一致性问题

使用缓存后，最大的挑战是如何保证缓存和数据库的数据一致性。

### 旁路缓存模式（Cache Aside）

这是最常用的模式：

```java
// 读取
Cache cache = getCache(key);
if (cache != null) {
    return cache;
}
Object value = db.get(key);
setCache(key, value);
return value;

// 更新
db.update(key, value);
deleteCache(key);
```

### 数据一致性的三种级别

| 级别 | 说明 | 实现难度 |
|-----|-----|---------|
| 强一致性 | 缓存和数据库实时一致 | 高，性能差 |
| 弱一致性 | 允许短暂不一致 | 中等 |
| 最终一致性 | 允许不一致，最终会一致 | 低，性能好 |

大多数场景下，**最终一致性**是最佳选择。

---

## 学习路径建议

### 入门：理解缓存基础

建议先学习**本地缓存**和**多级缓存架构**。

理解缓存的分层思想，知道什么数据适合放缓存，什么数据不适合。

### 进阶：掌握缓存策略

学习**缓存读写模式**和**缓存一致性**。

这是缓存的核心知识点。掌握 Cache Aside 模式，理解延时双删、订阅 binlog 等一致性保障方案。

### 高级：解决缓存问题

深入学习**缓存穿透、击穿、雪崩**的解决方案。

这三个问题是最常见的缓存异常情况，也是面试的高频考点。

### 精通：Redis 进阶

学习**Redis Lua 脚本**、**Caffeine 缓存**等高级特性。

这些是提升缓存系统性能和可靠性的关键技术。

---

## 延伸思考

缓存设计有三个核心问题：

**1. 缓存什么数据？**
答案：访问频繁、数据量适中、变化不频繁的数据。

**2. 缓存多久？**
答案：取决于数据的时效性要求。时效性要求越高，缓存时间越短。

**3. 缓存如何更新？**
答案：主动删除还是被动过期？强一致还是最终一致？

想清楚这三个问题，你的缓存设计就成功了一半。

**好的缓存设计，是性能提升的关键；坏的缓存设计，是系统崩溃的根源。**

下一模块，我们将探讨异步与消息处理——这是突破性能天花板的另一把钥匙。
