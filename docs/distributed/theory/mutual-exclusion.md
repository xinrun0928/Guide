# 分布式互斥：集中式算法、分布式算法、令牌环算法

你和邻居共用一个打印机。你打印的时候，他不能打印，否则纸张乱飞。

单机环境下，一把互斥锁就能解决。

**但如果是两台服务器共用一个打印机呢？**

进程 A 在服务器 1，进程 B 在服务器 2，它们没有共享内存，无法用传统的 mutex。

这就是分布式互斥要解决的问题：**如何在没有共享内存的多个进程之间，实现互斥访问共享资源。**

## 为什么单机互斥锁在分布式环境下无效？

```java
/**
 * 单机锁：在同一进程内有效
 */
public class SingleProcessLock {
    private final Object lock = new Object();
    
    public void doWork() {
        synchronized (lock) {
            // 只有一个进程能进入这里
        }
    }
}

/**
 * 分布式场景：
 * 进程 A 和进程 B 在不同的 JVM 中
 * 它们各自的 synchronized 锁互不影响！
 */
public class DistributedScenario {
    public static void main(String[] args) {
        // 进程 A
        ServerA a = new ServerA();
        a.start();
        
        // 进程 B
        ServerB b = new ServerB();
        b.start();
        
        // 问题：a.synchronized 和 b.synchronized 是两把完全独立的锁
        // 它们可以同时执行！
    }
}
```

## 三种分布式互斥算法

### 1. 集中式算法（中央协调者）

最简单的方案：选一个「老大」，所有请求都经过它批准。

```
工作流程：

1. 进程 A 想打印 → 发请求给 Coordinator
2. Coordinator 检查：打印机空闲 → 批准，发许可证
3. 进程 A 打印
4. 进程 B 想打印 → 发请求给 Coordinator
5. Coordinator 检查：打印机被占用 → 拒绝，让 B 等待
6. 进程 A 打印完毕 → 通知 Coordinator
7. Coordinator 通知 B：你现在可以打印了
```

```java
/**
 * 集中式互斥：中央协调者实现
 */
public class CentralizedMutex {
    
    private final Map&lt;String, String&gt; resourceOwner = new ConcurrentHashMap&lt;&gt;();
    private final Map&lt;String, Queue&lt;String&gt;&gt; waitingQueue = new ConcurrentHashMap&lt;&gt;();
    
    /**
     * 请求访问资源
     * 
     * @param processId 请求的进程 ID
     * @param resourceId 资源 ID
     * @return true 表示获得访问权，false 表示需要等待
     */
    public synchronized boolean request(String processId, String resourceId) {
        if (!resourceOwner.containsKey(resourceId)) {
            // 资源空闲，直接授权
            resourceOwner.put(resourceId, processId);
            System.out.println("资源 " + resourceId + " 授权给 " + processId);
            return true;
        } else {
            // 资源被占用，加入等待队列
            waitingQueue.computeIfAbsent(resourceId, k -&gt; new LinkedList&lt;&gt;())
                       .add(processId);
            System.out.println(processId + " 加入 " + resourceId + " 的等待队列");
            return false;
        }
    }
    
    /**
     * 释放资源
     */
    public synchronized void release(String processId, String resourceId) {
        if (resourceOwner.get(resourceId).equals(processId)) {
            resourceOwner.remove(resourceId);
            
            // 唤醒下一个等待者
            Queue&lt;String&gt; waiting = waitingQueue.get(resourceId);
            if (waiting != null &amp;&amp; !waiting.isEmpty()) {
                String next = waiting.poll();
                resourceOwner.put(resourceId, next);
                System.out.println("资源 " + resourceId + " 授权给等待中的 " + next);
                // 通知等待者（实际实现中需要发送消息）
                notifyProcess(next, resourceId);
            }
        }
    }
}

/**
 * 客户端实现
 */
public class ProcessClient {
    private final CentralizedMutex mutex;
    private final String processId;
    
    public ProcessClient(CentralizedMutex mutex, String processId) {
        this.mutex = mutex;
        this.processId = processId;
    }
    
    public void usePrinter() {
        String resourceId = "printer-1";
        
        // 1. 请求访问
        boolean granted = mutex.request(processId, resourceId);
        
        if (!granted) {
            // 2. 等待（阻塞）
            waitForPermission(resourceId);
        }
        
        // 3. 使用资源
        System.out.println(processId + " 开始使用打印机...");
        doPrint();
        System.out.println(processId + " 打印完成");
        
        // 4. 释放资源
        mutex.release(processId, resourceId);
    }
    
    private void doPrint() {
        try {
            Thread.sleep(1000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

**优点**：

- 实现简单，易于理解
- 只需要 3 条消息（请求、批准、释放）

**缺点**：

- 单点故障：协调者挂了，整个系统就死了
- 性能瓶颈：所有请求都经过协调者

**适用场景**：小规模系统、分布式锁（Redis 分布式锁的 redlock 算法就是集中式的变体）。

### 2. 分布式算法（Ricart-Agrawala）

不需要中央协调者，所有进程通过消息传递协商。

**核心思想**：使用时间戳决定优先级，谁的时间戳小谁先用。

```
工作流程：

1. 进程 A 想打印 → 发请求给所有其他进程（含 B）
   请求消息包含：进程 ID、资源 ID、时间戳

2. 进程 B 收到请求：
   - 如果 B 不用打印机 → 回复「OK」
   - 如果 B 在用打印机且 A 的时间戳更大 → 回复「OK」
   - 如果 B 在用打印机且 B 的时间戳更小 → 不回复，等用完再说

3. 进程 A 收到所有回复 → 开始打印

4. 进程 A 打印完毕 → 发释放消息给所有进程
   B 收到释放消息 → 可以开始用
```

```java
/**
 * Ricart-Agrawala 分布式互斥算法
 */
public class RicartAgrawalaMutex {
    
    private final String processId;
    private final Map&lt;String, Integer&gt;LamportClock = new ConcurrentHashMap&lt;&gt;();
    private final Set&lt;String&gt; deferredReplies = ConcurrentHashMap.newKeySet();
    private final Map&lt;String, String&gt; resourceState = new ConcurrentHashMap&lt;&gt;();
    
    /**
     * Lamport 时间戳：保证事件的全序
     */
    public void sendRequest(String resourceId) {
        // 1. 增加本地时钟
        incrementClock();
        
        // 2. 记录请求状态
        resourceState.put(resourceId, "REQUESTING");
        
        // 3. 发送请求给所有其他进程
        RequestMessage request = new RequestMessage(
            processId,
            resourceId,
            getClock()
        );
        
        for (String peer : getAllPeers()) {
            sendMessage(peer, request);
        }
        
        // 4. 等待所有回复
        waitForReplies();
    }
    
    /**
     * 处理收到的请求
     */
    public void onReceiveRequest(RequestMessage request) {
        // 更新时钟
        updateClock(request.getTimestamp());
        
        String requester = request.getProcessId();
        String resourceId = request.getResourceId();
        
        if (canGrant(request)) {
            // 发送同意回复
            sendMessage(requester, new ReplyMessage(processId));
        } else {
            // 延迟回复，加入队列
            deferredReplies.add(requester);
            recordDeferredRequest(request);
        }
    }
    
    /**
     * 判断是否应该立即同意
     */
    private boolean canGrant(RequestMessage request) {
        String resourceId = request.getResourceId();
        String state = resourceState.get(resourceId);
        
        // 如果资源空闲，或者当前请求优先级更高
        if (!"HELD".equals(state)) {
            return true;
        }
        
        // 比较时间戳
        RequestMessage myRequest = getMyPendingRequest(resourceId);
        return request.getTimestamp() &lt; myRequest.getTimestamp();
    }
    
    /**
     * 释放资源
     */
    public void release(String resourceId) {
        resourceState.put(resourceId, "RELEASED");
        
        // 发送释放消息，释放所有延迟的回复
        ReleaseMessage release = new ReleaseMessage(processId, resourceId);
        
        for (String deferred : getDeferredRequests(resourceId)) {
            sendMessage(deferred, new ReplyMessage(processId));
        }
    }
    
    public void onReceiveRelease(ReleaseMessage release) {
        removeDeferredRequest(release.getProcessId(), release.getResourceId());
    }
    
    private void incrementClock() {
        LamportClock.merge(processId, 1, (old, val) -&gt; val + 1);
    }
    
    private void updateClock(long receivedTimestamp) {
        LamportClock.compute(processId, (k, v) -&gt; 
            Math.max(v == null ? 0 : v, (int) receivedTimestamp) + 1);
    }
    
    private int getClock() {
        return LamportClock.getOrDefault(processId, 0);
    }
    
    // 其他辅助方法省略...
}
```

**优点**：

- 无单点故障
- 每个节点对等

**缺点**：

- 通信复杂度高：需要 N 条消息（N-1 个请求 + N-1 个回复）
- 如果某个节点故障，算法会卡住（需要故障检测）

**适用场景**：中小规模系统，不超过几十个节点。

### 3. 令牌环算法（Token Ring）

将进程组织成环形，每个进程只知道自己的邻居。

```
工作流程：

1. 初始化：令牌（token）在环中传递
2. 进程 A 收到令牌，且想打印 → 拿着令牌去打印
3. 进程 A 打印完毕 → 把令牌传给下一个邻居
4. 进程 B 收到令牌，但不想打印 → 直接传给下一个邻居
```

```java
/**
 * 令牌环算法实现
 */
public class TokenRingMutex {
    
    private final String processId;
    private final String nextProcessId;
    private boolean hasToken = false;
    
    public TokenRingMutex(String processId, String nextProcessId) {
        this.processId = processId;
        this.nextProcessId = nextProcessId;
    }
    
    /**
     * 请求资源（等待令牌）
     */
    public void acquire(String resourceId) {
        while (!hasToken) {
            // 等待接收令牌
            synchronized (this) {
                try {
                    wait();
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
        
        // 拿到令牌了，可以访问资源
        System.out.println(processId + " 获得令牌，开始使用 " + resourceId);
        useResource(resourceId);
    }
    
    /**
     * 处理收到的令牌
     */
    public void onReceiveToken() {
        if (!hasToken) {
            hasToken = true;
            synchronized (this) {
                notifyAll();
            }
        }
        // 如果已经有令牌（不应该收到），直接传递
    }
    
    /**
     * 释放资源，传递令牌
     */
    public void release(String resourceId) {
        System.out.println(processId + " 释放 " + resourceId + "，传递令牌");
        hasToken = false;
        sendTokenTo(nextProcessId);
    }
    
    /**
     * 使用资源
     */
    private void useResource(String resourceId) {
        try {
            Thread.sleep(1000); // 模拟使用
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    
    private void sendTokenTo(String targetProcess) {
        // 网络发送令牌
    }
}
```

**优点**：

- 无需集中协调
- 令牌丢失可以被检测（使用超时）

**缺点**：

- 令牌传递延迟：即使资源空闲，令牌也可能还在其他进程手里
- 高竞争时性能差

**适用场景**：高度竞争、资源访问频率不高的场景。

## 三种算法对比

| 特性 | 集中式算法 | 分布式算法 | 令牌环算法 |
|-----|---------|---------|---------|
| 通信复杂度 | O(3) | O(2N-2) | O(N) |
| 延迟 | 低 | 高 | 中 |
| 单点故障 | 有（协调者） | 无 | 无 |
| 适用规模 | 小 | 中 | 中 |
| 响应速度 | 快 | 快 | 慢 |
| 实现难度 | 低 | 高 | 中 |

## 工程实践：分布式锁

实际工程中，分布式互斥通常通过以下方式实现：

### ZooKeeper 实现

```java
/**
 * ZooKeeper 分布式锁实现
 * 本质上是集中式算法的变体
 */
public class ZooKeeperDistributedLock {
    
    private final ZooKeeper zk;
    private final String lockPath;
    
    /**
     * 获取锁
     * 使用临时顺序节点实现
     */
    public String acquire() throws InterruptedException, KeeperException {
        String nodeName = lockPath + "/lock-";
        
        // 1. 创建临时顺序节点
        String lockNode = zk.create(nodeName, new byte[0], 
            ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.EPHEMERAL_SEQUENTIAL);
        
        // 2. 获取所有子节点
        List&lt;String&gt; children = zk.getChildren(lockPath, false);
        
        // 3. 排序，检查自己是否最小
        Collections.sort(children);
        String myNodeName = lockNode.substring(lockNode.lastIndexOf('/') + 1);
        
        if (children.get(0).equals(myNodeName)) {
            // 最小，获得锁
            return lockNode;
        } else {
            // 不是最小，监听前一个节点
            String previousNode = lockPath + "/" + children.get(
                children.indexOf(myNodeName) - 1);
            
            CountDownLatch latch = new CountDownLatch(1);
            
            // 4. 前一个节点删除时，重新检查
            Stat stat = new Stat();
            zk.exists(previousNode, event -&gt; {
                if (event.getType() == Watcher.Event.EventType.NodeDeleted) {
                    latch.countDown();
                }
            }, stat);
            
            latch.await();
            return lockNode;
        }
    }
    
    /**
     * 释放锁
     */
    public void release(String lockNode) throws InterruptedException, KeeperException {
        zk.delete(lockNode, -1);
    }
}
```

### Redis 实现

```java
/**
 * Redis 分布式锁实现（SETNX + EXPIRE）
 * 本质上是集中式算法的变体
 */
public class RedisDistributedLock {
    
    private final Jedis jedis;
    private final String lockKey;
    private final String lockValue;
    
    public RedisDistributedLock(Jedis jedis, String lockKey) {
        this.jedis = jedis;
        this.lockKey = lockKey;
        this.lockValue = UUID.randomUUID().toString();
    }
    
    /**
     * 获取锁（SETNX + 过期时间）
     */
    public boolean acquire(long timeoutMs) {
        long endTime = System.currentTimeMillis() + timeoutMs;
        
        while (System.currentTimeMillis() &lt; endTime) {
            // SET key value NX PX timeout
            String result = jedis.set(lockKey, lockValue, 
                new SetParams().nx().px(timeoutMs));
            
            if ("OK".equals(result)) {
                return true;
            }
            
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        
        return false;
    }
    
    /**
     * 释放锁（Lua 脚本保证原子性）
     */
    public boolean release() {
        String script = 
            "if redis.call('get', KEYS[1]) == ARGV[1] then " +
            "    return redis.call('del', KEYS[1]) " +
            "else " +
            "    return 0 " +
            "end";
        
        Object result = jedis.eval(script, 
            Collections.singletonList(lockKey),
            Collections.singletonList(lockValue));
        
        return 1L.equals(result);
    }
}
```

## 总结

分布式互斥的三种经典算法：

1. **集中式算法**：简单高效，但有单点故障
2. **分布式算法**：无单点故障，但通信复杂
3. **令牌环算法**：适合特定拓扑，但延迟不可控

> "分布式互斥的核心矛盾是：没有共享内存，却要协调多个独立进程。不同的算法，本质上是不同的『协调成本』和『可靠性』之间的权衡。"
