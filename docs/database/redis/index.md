# Redis

Redis 是互联网后端标配的缓存数据库，几乎所有高并发场景都离不开它。

但 Redis 绝不只是「缓存」这么简单——它的数据类型、持久化机制、过期策略、内存淘汰、集群模式，每一个拿出来都是面试高频考点。

---

## 模块内容

### Redis 基础

先理解 Redis 为什么快，以及它的核心数据类型。

- [Redis 为什么要用单线程？](/database/redis/why-single-thread)
- [Redis 6.0 之后的多线程：I/O 多路复用与命令执行](/database/redis/multi-thread)
- [Redis 数据类型：String、Hash、List、Set、ZSet](/database/redis/data-type)
- [Redis 对象系统：SDS、ziplist、quicklist、intset、dict](/database/redis/object-system)
- [Redis 跳跃表（ZSet 底层实现）](/database/redis/skiplist)
- [Redis HyperLogLog、Bitmap、GIS 模块](/database/redis/bitmap-hll)

### 持久化机制

数据不丢是底线，Redis 提供了两种持久化方案。

- [RDB 持久化：fork + copy-on-write 快照](/database/redis/rdb)
- [AOF 持久化：写后日志与三种同步策略](/database/redis/aof)
- [AOF 重写与混合持久化](/database/redis/aof-rewrite)
- [RDB vs AOF 如何选择](/database/redis/rdb-aof-compare)

### 缓存策略

缓存用不好，就是灾难。

- [缓存过期策略：TTL 与惰性删除 + 定期删除](/database/redis/expire-strategy)
- [内存淘汰策略：LRU、LFU、随机淘汰](/database/redis/eviction-policy)
- [缓存穿透：布隆过滤器与缓存空值](/database/redis/cache-penetration)
- [缓存击穿：互斥锁与热点数据永不过期](/database/redis/cache-breakdown)
- [缓存雪崩：过期时间随机 + 多级缓存](/database/redis/cache-avalanche)

### 高并发与集群

单机的天花板，决定了你需要集群。

- [Redis 主从复制：数据同步原理](/database/redis/replication)
- [Redis 哨兵（Sentinel）：故障自动切换](/database/redis/sentinel)
- [Redis Cluster：槽分片与哈希槽](/database/redis/cluster)
- [Redis 分区方案：客户端/代理/服务端分区](/database/redis/partition)
- [Redis 分布式锁：SET NX + Lua 与 Redisson](/database/redis/distributed-lock)

### 应用场景

用好 Redis 的前提是理解它的适用场景。

- [Redis 缓存实战：热点数据、分布式锁、会话缓存](/database/redis/cache-use-case)
- [Redis 计数器与排行榜：INC/INCRBY/ZINCRBY](/database/redis/counter-ranking)
- [Redis 延迟队列实现：ZSet + 定时轮询](/database/redis/delay-queue)
- [Redis 限流实现：滑动窗口与令牌桶](/database/redis/rate-limit)
- [Redis 附近的人：GEO 命令与地理空间索引](/database/redis/geo)

---

## 面试核心考点

| 高频考点 | 关联文档 |
|---|---|
| Redis 为什么快 | [单线程原理](/database/redis/why-single-thread)、[多线程](/database/redis/multi-thread) |
| 缓存三剑客 | [穿透](/database/redis/cache-penetration)、[击穿](/database/redis/cache-breakdown)、[雪崩](/database/redis/cache-avalanche) |
| 持久化对比 | [RDB vs AOF](/database/redis/rdb-aof-compare) |
| 分布式锁 | [分布式锁实现](/database/redis/distributed-lock) |
| 数据类型选择 | [数据类型](/database/redis/data-type)、[对象系统](/database/redis/object-system) |

---

## 留给你的问题

Redis 的持久化策略你会选择 AOF 还是 RDB？为什么？

AOF 持久化每次写操作都记录，RDB 定时生成快照。两种策略各有优缺点——AOF 更安全但文件更大，RDB 恢复快但可能丢数据。你在生产环境会怎么配置？
