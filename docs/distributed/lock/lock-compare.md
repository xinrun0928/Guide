# Redis vs ZooKeeper vs etcd 分布式锁对比

分布式锁的世界里，有三大门派：

- **Redis 派**：速度快，但可靠性要自己保证
- **ZooKeeper 派**：可靠性高，但性能是瓶颈
- **etcd 派**：后起之秀，在 Kubernetes 生态如鱼得水

选哪个？

这是一个没有标准答案的问题。但我可以给你一个决策框架。

## 三种实现的横向对比

| 维度 | Redis | ZooKeeper | etcd |
|------|-------|-----------|------|
| **性能** | 最高（10万+ QPS） | 中等（千级 QPS） | 中等（万级 QPS） |
| **可靠性** | 中（单点有风险） | 高（ZAB 协议） | 高（Raft 协议） |
| **实现复杂度** | 中（Redisson 封装后低） | 高（需 Curator） | 中（gRPC 接口） |
| **锁释放机制** | TTL 过期 | 临时节点自动删除 | Lease 自动过期 |
| **公平锁** | 需额外实现 | 原生支持 | 需额外实现 |
| **可重入** | 原生支持 | 原生支持 | 支持 |
| **运维复杂度** | 低 | 高 | 中 |
| **适用场景** | 高性能、中等可靠 | 高可靠、低并发 | 高可靠、中并发 |

## Redis 锁

### 核心原理

Redis 锁基于 **SET NX + TTL**：

```java
// 获取锁
String result = jedis.set(lockKey, lockValue, "NX", "EX", 30);
boolean acquired = "OK".equals(result);

// 释放锁（Lua 脚本）
String script = 
    "if redis.call('get', KEYS[1]) == ARGV[1] then " +
    "    return redis.call('del', KEYS[1]) " +
    "else return 0 end";
jedis.eval(script, 1, lockKey, lockValue);
```

### 优点

| 优点 | 说明 |
|------|------|
| 性能高 | 单线程模型，纯内存操作 |
| 生态成熟 | Redisson 等库封装完善 |
| 成本低 | 单节点部署简单 |
| 社区活跃 | 大量实践案例 |

### 缺点

| 缺点 | 说明 |
|------|------|
| 单点问题 | 主从复制时锁可能丢失 |
| 依赖 TTL | 需要合理设置过期时间 |
| 不支持公平锁 | 需额外实现（Redisson 有） |

### 适用场景

- 电商秒杀
- 缓存更新
- 限时任务
- 高并发抢票

### 推荐实现

```java
// 使用 Redisson
RLock lock = redisson.getLock("myLock");
lock.lock();  // 看门狗自动续期
try {
    // 业务逻辑
} finally {
    lock.unlock();
}
```

## ZooKeeper 锁

### 核心原理

ZooKeeper 锁基于 **临时顺序节点**：

1. 创建临时顺序节点
2. 获取所有子节点
3. 判断自己是不是最小的
4. 如果是，获取锁成功
5. 如果不是，监听前一个节点

（详细原理见 [/distributed/lock/zookeeper-lock](/distributed/lock/zookeeper-lock)）

### 优点

| 优点 | 说明 |
|------|------|
| 可靠性高 | ZAB 协议保证一致性 |
| 不会死锁 | 临时节点，客户端崩溃自动删除 |
| 原生公平锁 | 顺序节点天然 FIFO |
| Watch 机制 | 可靠的事件通知 |

### 缺点

| 缺点 | 说明 |
|------|------|
| 性能低 | 每次加锁需要服务端交互 |
| 实现复杂 | ZooKeeper API 较底层 |
| 运维复杂 | ZooKeeper 集群本身需要维护 |

### 适用场景

- 配置变更抢主
- Leader 选举
- 分布式协调
- 高可靠分布式事务

### 推荐实现

```java
// 使用 Curator
InterProcessMutex lock = new InterProcessMutex(client, "/locks/myLock");
lock.acquire(30, TimeUnit.SECONDS);
try {
    // 业务逻辑
} finally {
    lock.release();
}
```

## etcd 锁

### 核心原理

etcd 锁基于 **Lease + MVCC**：

1. 创建 Lease（租约）
2. 在 Lease 下创建 key（带唯一值）
3. 获取所有 key，判断自己是不是最小的
4. 如果是，获取锁成功
5. 如果不是，监听前一个 key

etcd v3 的 API 基于 gRPC，性能比 ZooKeeper 好。

### 优点

| 优点 | 说明 |
|------|------|
| 可靠性高 | Raft 协议，工业级一致性 |
| 性能好 | etcd v3 优化后可达万级 QPS |
| Kubernetes 原生 | 云原生基础设施标配 |
| 支持 MVCC | 可以看到历史版本 |

### 缺点

| 缺点 | 说明 |
|------|------|
| API 较新 | 生态不如 Redis/ZooKeeper 成熟 |
| 学习成本 | gRPC 接口使用门槛 |
| 资源消耗 | 比 Redis 重 |

### 适用场景

- Kubernetes 集群内部锁
- 服务发现
- 配置管理
- Leader 选举

### 推荐实现

```java
// 使用 etcd-client
KV kvClient = client.getKVClient();
Lock lock = new Lock(kvClient, "/locks/myLock");

try {
    lock.lock();
    // 业务逻辑
} finally {
    lock.unlock();
}
```

## 选型决策树

```
开始
  │
  ├─► 性能要求极高（10万+ QPS）？
  │     │
  │     └─► 是 ──► Redis + Redisson
  │     │
  │     └─► 否
  │           │
  │           ▼
  ├─► 需要 Kubernetes 生态集成？
  │     │
  │     └─► 是 ──► etcd
  │     │
  │     └─► 否
  │           │
  │           ▼
  ├─► 需要金融级可靠性？
  │     │
  │     └─► 是 ──► ZooKeeper / etcd
  │     │
  │     └─► 否
  │           │
  │           ▼
  └─► 一般业务场景？
        │
        └─► Redis + Redisson（默认推荐）
```

## 真实业务场景选型

### 场景一：电商秒杀系统

**特点**：高并发、性能优先、允许少量超卖

**选型**：Redis + Redisson

```
理由：
- 10 万并发涌入，ZooKeeper 扛不住
- 秒杀场景允许少量超卖，Redis 锁足够
- Redisson 看门狗解决超时问题
```

### 场景二：库存扣减（严格一致）

**特点**：强一致性、不允许超卖

**选型**：ZooKeeper / etcd

```
理由：
- 库存超卖是严重事故，不能冒险
- ZooKeeper 的可靠性更让人安心
- 库存扣减本身并发不会特别高
```

### 场景三：配置更新抢主

**特点**：低并发、高可靠、需要公平锁

**选型**：ZooKeeper / etcd

```
理由：
- 配置更新频率低，性能不是瓶颈
- 多节点同时收到配置变更，必须有序
- ZooKeeper 顺序节点天然适合
```

### 场景四：Kubernetes 集群内协调

**特点**：云原生、多语言、可容忍延迟

**选型**：etcd（必须）

```
理由：
- Kubernetes 本身就依赖 etcd
- 不需要额外部署 ZooKeeper
- 团队已在 Kubernetes 生态内
```

### 场景五：分布式任务调度

**特点**：任务分配、高可靠、性能一般

**选型**：Redis / etcd

```
理由：
- 任务调度并发不会特别高
- 可靠性要求高
- Redis 在任务调度领域生态最成熟
```

## 混合使用策略

有些复杂系统会组合使用：

```
网关层：Redis 锁（高性能、防并发）
业务层：ZooKeeper 锁（高可靠、防数据冲突）
```

```
正常流程：Redis 锁快速拦截
Redis 锁失败：降级到 ZooKeeper 锁
```

这种分层策略可以兼顾性能和可靠性，但系统复杂度也会上升。

## 面试追问方向

- 三种分布式锁各有什么优缺点？
- 什么场景下必须用 ZooKeeper 而不是 Redis？
- Redis 锁的 TTL 设置有什么讲究？
- ZooKeeper 锁为什么性能不如 Redis？
- etcd 和 ZooKeeper 相比有什么优势？
- 如果让你设计一个分布式锁，你会怎么选型？

## 总结

三种分布式锁，没有绝对的好坏：

- **Redis**：性能之王，适合高性能场景，但需要自己保证可靠性
- **ZooKeeper**：可靠卫士，适合强一致场景，但性能是瓶颈
- **etcd**：云原生首选，在 Kubernetes 生态内无可替代

选型的本质是**权衡**：你愿意用可靠性换性能，还是用性能换可靠性？

一个简单的决策原则：
- **大多数业务场景**：Redis + Redisson（够用）
- **金融级可靠性**：ZooKeeper / etcd（更安心）
- **Kubernetes 生态**：etcd（原生集成）

记住，没有最好的锁，只有最适合业务场景的锁。
