# ZooKeeper 分布式锁实现：临时顺序节点

如果 Redis 是用「速度」解决分布式锁问题，那 ZooKeeper 就是用「可靠性」来解决。

Redis 锁的最大问题是什么？

**锁可能丢失**。

Master 挂了，主从复制还没完成，锁就消失了。

ZooKeeper 的解决思路完全不同：**不用过期时间，用心跳检测**。

如果你崩溃了，我检测不到你的心跳，就自动帮你删除锁。

这就是 ZooKeeper 分布式锁的核心：**临时节点 + 顺序节点**。

## ZooKeeper 数据模型回顾

ZooKeeper 的数据存储结构叫 **ZNode**：

```
/
├── /zookeeper
│   └── /zookeeper/quota
├── /locks
│   ├── /locks/lock-0000000001  (临时顺序节点)
│   ├── /locks/lock-0000000002  (临时顺序节点)
│   └── /locks/lock-0000000003  (临时顺序节点)
└── /config
```

### 临时节点（Ephemeral Node）

临时节点的特点：
- 客户端连接时创建，断开连接时自动删除
- 不需要 TTL，靠心跳维持

```
客户端A 连接 ZooKeeper，创建临时节点 /locks/lock-1
客户端A 崩溃，断开连接
ZooKeeper 检测到心跳消失
ZooKeeper 自动删除 /locks/lock-1
```

这就是 ZooKeeper 锁的天然优势：**不会死锁**。

### 顺序节点（Sequential Node）

顺序节点的特点：
- 创建时自动分配递增编号
- 编号是有序的

```
创建 /locks/lock-  -> ZooKeeper 分配 0000000001
创建 /locks/lock-  -> ZooKeeper 分配 0000000002
创建 /locks/lock-  -> ZooKeeper 分配 0000000003
```

这就是 ZooKeeper 锁实现**公平锁**的基础。

## 临时顺序节点锁的实现原理

这是 ZooKeeper 分布式锁最经典的算法，理解了它就理解了一切。

### 算法流程

```
假设有 3 个客户端竞争同一把锁：客户端 A、B、C
```

**第一步：创建临时顺序节点**

```
客户端A: create("/locks/lock-", ephemeral=true, sequential=true) -> /locks/lock-0000000001
客户端B: create("/locks/lock-", ephemeral=true, sequential=true) -> /locks/lock-0000000002
客户端C: create("/locks/lock-", ephemeral=true, sequential=true) -> /locks/lock-0000000003
```

**第二步：获取所有子节点**

```
客户端A: getChildren("/locks") -> [lock-0000000001, lock-0000000002, lock-0000000003]
客户端B: getChildren("/locks") -> [lock-0000000001, lock-0000000002, lock-0000000003]
客户端C: getChildren("/locks") -> [lock-0000000001, lock-0000000002, lock-0000000003]
```

**第三步：判断自己是不是最小的**

```
客户端A: lock-0000000001 vs [0000000001, 0000000002, 0000000003]
        最小的是 0000000001，我就是最小的 ✓ 获取锁成功

客户端B: lock-0000000002 vs [0000000001, 0000000002, 0000000003]
        最小的是 0000000001，我不是最小的 ✗ 获取锁失败

客户端C: lock-0000000003 vs [0000000001, 0000000002, 0000000003]
        最小的是 0000000001，我不是最小的 ✗ 获取锁失败
```

**第四步：不是最小的，监听前一个节点**

```
客户端B: 监听 /locks/lock-0000000001 的删除事件
客户端C: 监听 /locks/lock-0000000002 的删除事件
```

**第五步：等待被唤醒**

```
客户端A 执行完毕，删除 /locks/lock-0000000001

客户端B 收到通知：「前一个节点被删除了」
客户端B 重新获取所有子节点
判断自己是不是最小的 -> 是！获取锁成功

客户端C 继续等待...
```

### 时序图

```
时间轴 ──────────────────────────────────────────────────────────►

客户端A:  创建节点 ──► 获取锁 ──► 执行任务 ──► 删除节点
客户端B:  创建节点          ──► 监听A ──► 被唤醒 ──► 获取锁 ──► ...
客户端C:  创建节点                         ──► 监听B ──► ...
```

这就是 ZooKeeper 锁的精髓：**通过监听前一个节点，实现排队和唤醒**。

## Java 代码实现（Curator）

ZooKeeper 原生 API 比较繁琐，实际项目用 Curator 框架：

```java
public class ZooKeeperLockExample {
    
    public void useCuratorLock() {
        // 创建 Curator 客户端
        RetryPolicy retryPolicy = new ExponentialBackoffRetry(1000, 3);
        CuratorFramework client = CuratorFrameworkFactory.newClient(
            "localhost:2181", 
            retryPolicy
        );
        client.start();
        
        try {
            // 创建可重入锁
            InterProcessMutex lock = new InterProcessMutex(client, "/locks/myLock");
            
            // 获取锁（阻塞等待）
            lock.acquire(30, TimeUnit.SECONDS);
            
            try {
                // 业务逻辑
                doSomething();
            } finally {
                // 释放锁
                lock.release();
            }
            
        } finally {
            client.close();
        }
    }
}
```

### 完整示例：订单服务

```java
public class OrderService {
    
    private final CuratorFramework client;
    private final String lockPath;
    
    public OrderService(CuratorFramework client, String lockPath) {
        this.client = client;
        this.lockPath = lockPath;
    }
    
    /**
     * 创建分布式锁
     */
    private InterProcessMutex createLock(String orderId) {
        return new InterProcessMutex(client, "/orders/lock/" + orderId);
    }
    
    /**
     * 处理订单
     */
    public void processOrder(Long orderId) {
        InterProcessMutex lock = createLock(orderId.toString());
        
        try {
            // 尝试获取锁，最多等待 10 秒
            if (!lock.acquire(10, TimeUnit.SECONDS)) {
                throw new RuntimeException("系统繁忙，请稍后重试");
            }
            
            // 执行业务逻辑
            checkInventory(orderId);
            createOrderRecord(orderId);
            deductInventory(orderId);
            
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new RuntimeException("订单处理被中断");
        } finally {
            try {
                // 释放锁
                lock.release();
            } catch (Exception e) {
                // 忽略释放异常
            }
        }
    }
}
```

### 批量获取锁

```java
public class BatchService {
    
    private final CuratorFramework client;
    
    /**
     * 同时获取多把锁
     */
    public void processMultipleOrders(List&lt;Long&gt; orderIds) throws Exception {
        // 创建多个锁
        List&lt;InterProcessMutex&gt; locks = orderIds.stream()
            .map(id -> new InterProcessMutex(client, "/orders/lock/" + id))
            .collect(Collectors.toList());
        
        // 组成锁集合
        InterProcessMultiLock multiLock = 
            new InterProcessMultiLock(locks.toArray(new InterProcessMutex[0]));
        
        try {
            // 获取所有锁
            if (!multiLock.acquire(30, TimeUnit.SECONDS)) {
                throw new RuntimeException("获取锁超时");
            }
            
            // 业务逻辑
            for (Long orderId : orderIds) {
                processOrder(orderId);
            }
            
        } finally {
            multiLock.release();
        }
    }
}
```

## ZooKeeper 锁的天然优势

### 1. 不会死锁

临时节点靠心跳维持，客户端崩溃时 ZooKeeper 自动删除节点：

```java
// 模拟客户端崩溃
try {
    lock.acquire();
    // 客户端崩溃，没有释放锁...
    // 但 ZooKeeper 检测不到心跳后会自动删除节点
} finally {
    lock.release();  // 这行永远不会执行
}
```

### 2. 天然公平锁

顺序节点保证了严格的 FIFO：

```
客户端A: lock-0000000001 最早创建，最先获取锁
客户端B: lock-0000000002 第二早创建，第二获取锁
客户端C: lock-0000000003 第三早创建，第三获取锁
```

### 3. 可见性保证

ZooKeeper 使用 ZAB 协议保证写操作的顺序性和可见性。

### 4. Watch 机制

ZooKeeper 的 Watch 机制是**一次性触发**的：

```java
// 注册 Watch
List&lt;String&gt; children = client.getChildren().usingWatcher(watchEvent -> {
    // 节点变化时收到通知
    System.out.println("节点发生变化：" + watchEvent);
}).forPath("/locks");

// 当节点变化时，Watch 只触发一次
// 需要重新注册 Watch
```

## ZooKeeper vs Redis

| 维度 | ZooKeeper | Redis |
|------|-----------|-------|
| 实现复杂度 | 高（需 Curator） | 低（Redisson 封装后很低） |
| 性能 | 低（千级 QPS） | 高（十万级 QPS） |
| 可靠性 | 高（ZAB 协议） | 中 |
| 锁释放 | 临时节点自动删除 | TTL 过期删除 |
| 公平锁 | 原生支持 | 需额外实现 |
| 适合场景 | 高可靠、低并发 | 高性能、中等可靠 |

## ZooKeeper 锁的缺点

### 1. 性能较差

每次获取锁都需要在 ZooKeeper 服务端创建节点、获取子节点列表、网络往返。

高并发场景下，ZooKeeper 锁会成为瓶颈。

### 2. 实现复杂

ZooKeeper 的 API 比较底层，需要处理连接状态、重连、Watcher 重复注册等问题。

实际项目中建议使用 Curator，它封装了这些细节。

### 3. 是分布式协调服务，不是专门的锁服务

ZooKeeper 设计目标是分布式协调，不是高性能锁服务。

用它做锁有点「大材小用」，但确实可靠。

## 面试追问方向

- ZooKeeper 分布式锁的原理是什么？
- 临时节点和永久节点有什么区别？
- 顺序节点是怎么保证有序的？
- ZooKeeper 的 Watch 机制是什么？有什么特点？
- ZooKeeper 锁为什么不会死锁？
- ZooKeeper 锁和 Redis 锁各有什么优缺点？

## 总结

ZooKeeper 分布式锁的核心是**临时顺序节点**：

- **临时节点**：客户端崩溃自动删除，不会死锁
- **顺序节点**：天然实现公平锁（FIFO）
- **Watch 机制**：监听前一个节点实现排队和唤醒

ZooKeeper 锁的最大优势是**可靠性**，最大劣势是**性能**。

选 ZooKeeper 还是 Redis，取决于你的业务场景：
- **高并发、性能优先**：选 Redis（用 Redisson）
- **强一致、可靠优先**：选 ZooKeeper（用 Curator）

一个有趣的事实：很多公司在业务早期用 Redis 锁，业务长大后换 ZooKeeper 或 etcd——不是因为 ZooKeeper 更好，而是因为业务量大了，对可靠性的要求高了。
