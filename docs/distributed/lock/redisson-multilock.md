# Redisson 联锁（MultiLock）与红锁（RedLock）

单节点 Redis 锁有一个致命问题：**如果 Master 挂了，锁就丢了**。

你可能想：「那我加个从库，主从复制，数据就备份了。」

问题是：**复制是异步的，Master 挂了，锁可能还没同步到 Slave**。

这就引出了分布式锁领域最经典的问题：**如何保证锁在 Redis 集群环境下的可靠性？**

Redisson 给了两种方案：**MultiLock（联锁）**和**RedLock（红锁）**。

## MultiLock（联锁）

### 什么是联锁

联锁的本质是：**同时获取多把锁，必须全部成功才算成功**。

场景：你需要同时锁定「商品库存」和「订单记录」两个资源，保证它们的一致性。

```java
RLock lock1 = redisson.getLock("product:stock:123");
RLock lock2 = redisson.getLock("order:record:456");

// 联锁：两把锁必须都拿到
RedissonMultiLock multiLock = new RedissonMultiLock(lock1, lock2);

multiLock.lock();
try {
    // 同时锁住了两个资源
    deductStock();
    createOrder();
} finally {
    multiLock.unlock();
}
```

### 联锁的语义

```
场景：扣减库存 + 创建订单（必须同时成功或同时失败）

不加联锁:
  时刻 T1: 扣减库存成功
  时刻 T2: Redis 挂了
  时刻 T3: 创建订单失败
  结果: 库存扣了，订单没创建 —— 数据不一致！

加联锁:
  时刻 T1: 获取库存锁 ✓
  时刻 T2: 获取订单锁 ✓
  时刻 T3: 扣减库存 ✓
  时刻 T4: 创建订单 ✓
  时刻 T5: 释放所有锁
  结果: 要么都成功，要么都失败
```

### Java 代码示例

```java
public class AtomicOperationService {
    
    private final RedissonClient redisson;
    
    /**
     * 同时锁定多个资源，保证操作的原子性
     */
    public void transferMoney(String fromAccount, String toAccount, BigDecimal amount) {
        // 获取两把锁
        RLock fromLock = redisson.getLock("account:lock:" + fromAccount);
        RLock toLock = redisson.getLock("account:lock:" + toAccount);
        
        // 组成联锁
        RedissonMultiLock multiLock = new RedissonMultiLock(fromLock, toLock);
        
        // 获取所有锁，最多等待 10 秒
        try {
            if (!multiLock.tryLock(10, 30, TimeUnit.SECONDS)) {
                throw new RuntimeException("获取锁失败，账户可能被其他操作占用");
            }
            
            // 执行业务逻辑
            deductBalance(fromAccount, amount);
            addBalance(toAccount, amount);
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("转账操作被中断");
        } finally {
            // 释放所有锁
            if (multiLock.isHeldByCurrentThread()) {
                multiLock.unlock();
            }
        }
    }
    
    private void deductBalance(String account, BigDecimal amount) {
        // 扣减余额
    }
    
    private void addBalance(String account, BigDecimal amount) {
        // 增加余额
    }
}
```

### 联锁的内部实现

```java
public class RedissonMultiLock implements RLock {
    
    private final RLock[] locks;
    
    public RedissonMultiLock(RLock... locks) {
        this.locks = locks;
    }
    
    @Override
    public boolean tryLock(long waitTime, long leaseTime, TimeUnit unit) throws InterruptedException {
        long startTime = System.currentTimeMillis();
        long waitTimeMillis = unit.toMillis(waitTime);
        
        // 按顺序尝试获取所有锁
        List&lt;RLock&gt; acquiredLocks = new ArrayList&lt;&gt;();
        
        for (RLock lock : locks) {
            long remainingTime = waitTimeMillis - (System.currentTimeMillis() - startTime);
            
            if (remainingTime <= 0) {
                break;  // 时间到了
            }
            
            // 尝试获取当前锁
            if (lock.tryLock(remainingTime, leaseTime, TimeUnit.MILLISECONDS)) {
                acquiredLocks.add(lock);
            } else {
                // 获取失败，释放已获取的锁
                breakAllLocks(acquiredLocks);
                return false;
            }
        }
        
        return acquiredLocks.size() == locks.length;
    }
    
    @Override
    public void unlock() {
        // 释放所有锁
        for (RLock lock : locks) {
            if (lock.isHeldByCurrentThread()) {
                lock.unlock();
            }
        }
    }
    
    private void breakAllLocks(List&lt;RLock&gt; locks) {
        for (RLock lock : locks) {
            try {
                lock.unlock();
            } catch (Exception ignored) {
            }
        }
    }
}
```

## RedLock（红锁）

### 为什么需要 RedLock

MultiLock 的问题是：**所有锁都在同一个 Redis 实例上**。

如果这个 Redis 挂了，MultiLock 毫无意义。

RedLock 的思路是：**向 N 个独立的 Redis 实例获取锁，超过半数成功才算成功**。

```
假设 N = 5（5 个独立的 Redis 实例）

客户端需要:
  向 5 个 Redis 实例都发起 SET NX 请求
  至少 3 个成功才能算获取锁成功
```

即使 2 个实例挂了，只要另外 3 个正常，锁依然有效。

### RedLock 算法

```
1. 获取当前时间戳（毫秒）
2. 依次向 N 个 Redis 实例获取锁
   - 使用相同的 key
   - 使用相同的随机值
   - 设置相同的 TTL
   - 每次获取有超时时间（如 5ms）
3. 计算获取锁花了多长时间
4. 判断是否成功:
   - 获取时间 < TTL（说明锁可能在大部分节点上还有效）
   - 成功获取的锁数量 >= N/2 + 1
5. 如果成功，锁的有效时间 = TTL - 获取时间
6. 如果失败，向所有节点释放锁
```

### Java 代码示例

```java
public class RedissonRedLockExample {
    
    public void useRedLock() {
        // 5 个独立的 Redisson 客户端（可以是 5 个不同机器上的 Redis）
        RedissonClient redis1 = createClient("192.168.1.1");
        RedissonClient redis2 = createClient("192.168.1.2");
        RedissonClient redis3 = createClient("192.168.1.3");
        RedissonClient redis4 = createClient("192.168.1.4");
        RedissonClient redis5 = createClient("192.168.1.5");
        
        // 创建 5 把锁
        RLock lock1 = redis1.getLock("myLock");
        RLock lock2 = redis2.getLock("myLock");
        RLock lock3 = redis3.getLock("myLock");
        RLock lock4 = redis4.getLock("myLock");
        RLock lock5 = redis5.getLock("myLock");
        
        // 组成红锁
        RedissonRedLock redLock = new RedissonRedLock(lock1, lock2, lock3, lock4, lock5);
        
        try {
            // 获取红锁，最多等待 10 秒，持有 30 秒
            if (redLock.tryLock(10, 30, TimeUnit.SECONDS)) {
                // 业务逻辑
                doSomething();
            } else {
                System.out.println("获取红锁失败");
            }
        } finally {
            if (redLock.isHeldByCurrentThread()) {
                redLock.unlock();
            }
        }
    }
    
    private RedissonClient createClient(String address) {
        Config config = new Config();
        config.useSingleServer().setAddress("redis://" + address + ":6379");
        return Redisson.create(config);
    }
}
```

### RedLock 的争议

RedLock 一经提出就引发了激烈争议。

**Martin Kleppmann（著名分布式系统专家）** 的批评：

1. **时钟漂移问题**：Redis 实例的时钟可能不同步，导致锁提前失效
2. **假设不成立**：RedLock 假设锁的生命周期可以用本地时钟测量，但分布式系统中时钟不可靠
3. **性能问题**：5 个 Redis 实例，任何一个延迟都会影响整体

**Redisson 作者（Antirez）的回应**：

1. 时钟漂移可以通过合理设置 TTL 来缓解
2. 如果你的 Redis 实例时钟漂移严重，应该先解决基础设施问题
3. RedLock 适用于「不想引入 ZooKeeper/etcd，但需要比单节点 Redis 更可靠的场景」

## 联锁 vs 红锁

| 特性 | MultiLock（联锁） | RedLock（红锁） |
|------|-------------------|-----------------|
| 目的 | 同时锁定多个资源 | 提高锁的可靠性 |
| 部署要求 | 多把锁可以是同一实例 | 必须 5 个独立实例 |
| 成功条件 | 所有锁都成功 | 超过半数成功 |
| 复杂度 | 低 | 高 |
| 适用场景 | 跨资源的原子操作 | 单资源的高可靠锁定 |

## 实际工程建议

**大多数场景：单节点 Redis + 主从自动切换足够**

现在的 Redis Sentinel 或 Redis Cluster 可以自动故障转移：
- Master 挂了，Sentinel 自动提升 Slave 为 Master
- 配合 Redisson 的看门狗机制，大部分场景够用

**RedLock 过于理想化**：
- 需要 5 个独立 Redis 实例（成本高）
- 实现复杂，维护成本高
- 争议较大，社区有不同声音

**真正需要 RedLock 的场景极少**：
- 金融交易级别的高可靠锁定
- 不能容忍任何锁丢失的业务

如果你的业务真的需要这种级别的可靠性，更好的选择是 **ZooKeeper** 或 **etcd**，它们的一致性协议比 RedLock 更成熟。

## 面试追问方向

- MultiLock 和 RedLock 的区别是什么？
- RedLock 需要几个 Redis 实例？为什么是 5 个？
- RedLock 解决了什么问题？有什么争议？
- 如果只有 2 个 Redis 实例，能用 RedLock 吗？
- RedLock 的性能和单节点 Redis 锁相比如何？

## 总结

MultiLock 和 RedLock 是 Redisson 提供的两种高级锁机制：

- **MultiLock**：一把锁同时锁多个资源，保证跨资源原子性
- **RedLock**：向多个独立 Redis 实例获取锁，提高单点可靠性

大多数业务用 Redisson 的单节点锁 + 主从自动切换就够了。

RedLock 听起来很美好，但争议很大，谨慎使用。
