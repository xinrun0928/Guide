# ZooKeeper 分布式锁实现

凌晨 3 点，秒杀活动即将开始。

你的系统有 10 台服务器，要保证同一件商品，同一个用户只能下单一次。

怎么实现？

用数据库？行锁太重，秒杀的高并发会把数据库打爆。

用 Redis？Redis 是单线程的，看起来没问题——但如果 Redis  master 宕机，主从切换时的那几秒钟，锁可能丢失。

**有没有一种方案，既能保证强一致性，又足够简单可靠？**

这就是 ZooKeeper 分布式锁的价值。

## 分布式锁的本质

在单机环境中，我们用 `synchronized` 或 `ReentrantLock` 来做线程间的互斥。锁的本质是：**同一时刻，只有一个执行流能进入临界区。**

在分布式环境中，进程跑在不同的机器上，锁必须是一种「共享的」「一致的」「可靠的」存在。ZooKeeper 天然提供了这种能力。

分布式锁需要满足几个条件：

1. **互斥性**：同一时刻只有一个客户端能获得锁
2. **不会死锁**：即使获得锁的客户端崩溃，其他客户端最终也能获得锁
3. **不会饥饿**：公平锁保证先到先得
4. **容错性**：只要 ZooKeeper 集群正常，锁就能正常工作

## 临时顺序节点：分布式锁的核心

在[ZooKeeper 核心概念](/middleware/registry/zookeeper-core)中，我们介绍了四种 ZNode 类型。其中 **临时顺序节点（EPHEMERAL_SEQUENTIAL）** 是实现分布式锁的关键。

简单来说：

```
锁节点 /locks/order-lock 下创建临时顺序子节点：
/locks/order-lock/lock-0000000001  ← Client A 创建
/locks/order-lock/lock-0000000002  ← Client B 创建
/locks/order-lock/lock-0000000003  ← Client C 创建
```

**序号最小的那个节点，就是锁的持有者。** Client A 的序号是 1，最小，所以它获得了锁。

其他客户端只需要**监听自己前面那个节点**就行了：

- Client B 监听 `/locks/order-lock/lock-0000000001`
- Client C 监听 `/locks/order-lock/lock-0000000002`

当前面的节点被删除（锁释放）时，ZooKeeper 通知后面的客户端，它就可以去获取锁了。

这就像排队买奶茶：**你不需要一直问「到我了没」，服务员会叫你的号。**

## 锁获取：先到先得

```java
public class ZooKeeperLock implements AutoCloseable {
    private final ZooKeeper zk;
    private final String lockPath;
    private final String nodeName;
    private final String fullPath;
    private final CountDownLatch latch = new CountDownLatch(1);

    public ZooKeeperLock(ZooKeeper zk, String lockPath, String lockName) {
        this.zk = zk;
        this.lockPath = lockPath;
        this.nodeName = lockName;
        // 创建临时顺序节点
        this.fullPath = zk.create(
            lockPath + "/" + lockName + "-",
            new byte[0],
            ZooDefs.Ids.OPEN_ACL_UNSAFE,
            CreateMode.EPHEMERAL_SEQUENTIAL
        );
    }

    // 尝试获取锁
    public boolean tryLock(long timeout, TimeUnit unit) throws InterruptedException {
        // 获取锁路径下的所有子节点
        List&lt;String&gt; children = zk.getChildren(lockPath, false);
        children.sort(String::compareTo);

        // 当前节点在列表中的位置
        String myNodeName = fullPath.substring(fullPath.lastIndexOf("/") + 1);
        int index = Collections.binarySearch(children, myNodeName);

        if (index == 0) {
            // 我是序号最小的，获得锁
            return true;
        } else {
            // 监听前一个节点
            String previousNode = children.get(index - 1);
            String previousPath = lockPath + "/" + previousNode;

            // 注册 Watch 等待前一个节点删除
            Stat stat = zk.exists(previousPath, event -> {
                if (event.getType() == Event.EventType.NodeDeleted) {
                    latch.countDown();  // 前一个节点没了，我可以尝试获取锁
                }
            });

            if (stat != null) {
                // 前一个节点还存在，等待
                return latch.await(timeout, unit);
            } else {
                // 前一个节点已经不存在了（可能被删除），递归重试
                return tryLock(timeout, unit);
            }
        }
    }

    // 释放锁
    @Override
    public void close() throws InterruptedException {
        zk.delete(fullPath, -1);
    }
}
```

**这段代码的核心逻辑是什么？**

1. 创建临时顺序节点，得到自己的序号
2. 获取所有子节点，按序号排序
3. 如果自己是最小的，就获得锁
4. 如果不是最小的，就监听自己前面的那个节点
5. 前面节点删除时，收到通知，再次尝试获取

**为什么要监听前一个节点，而不是监听父节点？**

因为 Watch 机制只能监听**数据变化**或**子节点列表变化**，不能精确监听「某个节点被删除」。

但如果我监听前一个节点的存在性（`exists`），当前一个节点被删除时，我可以精确地知道「轮到我了」。

## 锁释放：自动清理

锁释放非常简单——只需要删除自己创建的节点：

```java
// 方式一：使用 try-finally 确保释放
ZooKeeperLock lock = new ZooKeeperLock(zk, "/locks", "order");
try {
    lock.tryLock(30, TimeUnit.SECONDS);
    // 执行业务逻辑
    processOrder();
} finally {
    lock.close();
}

// 方式二：使用 Curator 框架
InterProcessMutex mutex = new InterProcessMutex(zkClient, "/locks/order");
mutex.acquire(30, TimeUnit.SECONDS);
try {
    processOrder();
} finally {
    mutex.release();
}
```

**临时节点的优势在这里体现：** 如果获得锁的客户端崩溃了，ZooKeeper 会自动删除它的临时节点，锁自动释放，其他客户端继续竞争。

**这解决了什么问题？**

如果你用普通节点实现锁，客户端崩溃后节点还在，其他客户端永远等不到通知。用临时节点，锁会自动「归还」。

## 羊群效应：分布式锁的性能陷阱

上面的实现有一个问题：**惊群效应（Herd Effect）**。

假设有 1000 个客户端在等待锁。当锁释放时，ZooKeeper 需要：

1. 删除最小的节点
2. 通知第二小的节点（1000 - 1 = 999 个客户端收到无用的「子节点列表变化」通知）
3. 第二小的客户端获得锁，其他 998 个客户端继续等待

**问题在于：锁释放时，1000 个 Watcher 被触发。** 这会造成 ZooKeeper 服务器的瞬时压力。

解决方案有几种：

**方案一：随机退避**

```java
// 获取锁失败后，随机等待一段时间再重试
Thread.sleep(new Random().nextInt(1000));
return tryLock(timeout, unit);
```

**方案二：分层锁**

不用一个大锁，而是用多个小锁分散压力。比如按用户 ID 分片：

```
/locks/user-001
/locks/user-002
...
/locks/user-100
```

用户 1 的锁和用户 2 的锁互不影响。

**方案三：使用 Curator 的 InterProcessMutex**

Curator 是 ZooKeeper 的高级客户端，它实现了多种分布式锁，其中 `InterProcessMutex` 采用了优化的等待策略：

```java
InterProcessMutex mutex = new InterProcessMutex(zkClient, "/distributed-lock");
// 获取锁（内部实现了公平锁的逻辑）
mutex.acquire();
// 释放锁
mutex.release();
```

Curator 的实现会更复杂，但性能更好，建议在生产环境使用。

## 公平锁 vs 非公平锁

上面实现的锁是**公平锁**——严格按照创建节点的顺序获取锁。

如果你想实现**非公平锁**（谁抢到算谁的），可以去掉顺序特性：

```java
// 创建临时非顺序节点
String lockPath = zk.create(
    lockPath + "/" + lockName,
    new byte[0],
    ZooDefs.Ids.OPEN_ACL_UNSAFE,
    CreateMode.EPHEMERAL  // 注意：不是 EPHEMERAL_SEQUENTIAL
);

// 尝试获取锁：如果节点已存在，说明锁被占用
Stat stat = zk.exists(lockPath, watcher);
return stat == null;  // 能创建成功就获得锁，失败就监听
```

非公平锁的优点是**响应更快**（不需要排队），缺点是可能产生饥饿。

## 读写锁的实现

ZooKeeper 也能实现读写锁，思路是：

- **写锁**：创建临时顺序节点，监听所有比自己序号小的节点
- **读锁**：创建临时顺序节点，监听所有比自己序号小的**写节点**

```java
public class ZooKeeperReadWriteLock {
    private final String lockPath;
    private final String nodePrefix;

    public String acquireReadLock() {
        // 读锁的节点名以 "R-" 开头
        String node = createNode("R-");
        // 监听比自己序号小的所有写锁
        return waitForLock(node, LockType.READ);
    }

    public String acquireWriteLock() {
        // 写锁的节点名以 "W-" 开头
        String node = createNode("W-");
        // 监听所有比自己序号小的节点（不管是读还是写）
        return waitForLock(node, LockType.WRITE);
    }
}
```

读写锁的核心是**区分读写请求**：写操作需要独占，读操作可以并发。

## 总结

用 ZooKeeper 实现分布式锁，核心就是**临时顺序节点 + Watch 机制**：

1. 创建临时顺序节点获取「排队序号」
2. 判断自己是否最小，最小则获得锁
3. 否则监听前一个节点，等待通知
4. 获得通知后，重新判断
5. 释放锁时删除自己的节点

这个方案的优势是**可靠性高**：基于 ZooKeeper 的强一致性，任何节点崩溃都不会导致死锁。

但它也有局限：**性能不如 Redis**。因为每次锁竞争都需要在 ZooKeeper 中创建节点、获取子节点列表，而 ZooKeeper 是单线程处理请求的。

所以在选择方案时，你需要权衡：**是要强一致（选 ZooKeeper），还是要高性能（选 Redis）？**

---

**留给你一个问题：**

在上面的实现中，锁获取成功后会返回 `true`，然后执行业务逻辑。但在 `tryLock` 返回 `true` 和实际获得锁之间，有一个微小的时间窗口吗？

如果有，这个窗口会导致什么问题？
