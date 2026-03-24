# ZooKeeper 应用场景：配置管理、命名服务、分布式锁、Master 选举

你有没有想过这个问题：

Kafka 的 Controller 选举、Dubbo 的服务注册、Hadoop 的 NameNode 高可用……这些大名鼎鼎的中间件，都用到了同一个组件——ZooKeeper。

但 ZooKeeper 凭什么？

它的核心竞争力是什么？什么场景适合用 ZooKeeper，什么场景不适合？

今天，我们来聊聊 ZooKeeper 的四大经典应用场景。

## 配置管理：集中式配置中心

最常见的场景：**配置变更后，多个应用实例需要实时感知**。

传统方案：每个实例加载本地配置文件，改配置需要重启所有实例。

ZooKeeper 方案：

```java
// 1. 配置写入 ZooKeeper
client.setData().forPath("/config/database", "mysql://localhost:3306".getBytes());

// 2. 应用实例监听配置变更
client.getData()
    .usingWatcher(event -> {
        if (event.getType() == EventType.NodeDataChanged) {
            // 配置变更，重新加载
            byte[] newData = client.getData().forPath("/config/database");
            reloadConfig(new String(newData));
        }
    })
    .forPath("/config/database");
```

**为什么 ZooKeeper 适合做配置中心？**

- Watch 机制天然支持配置变更推送
- 临时节点适合动态扩缩容场景
- 版本号支持配置回滚

**但 ZooKeeper 不是万能的**：

- 单次变更数据量建议 < 1MB
- 不适合存储大量配置（应该用 MySQL + ZooKeeper 通知）

## 命名服务：全局唯一 ID 生成

分布式系统中，经常需要生成全局唯一的 ID。

方案一：UUID。足够唯一，但无序、长度大。

方案二：Snowflake。依赖时间戳，需要独立的 ID 生成服务。

方案三：**ZooKeeper 顺序节点**。

```java
// 利用 ZooKeeper 的顺序节点特性
String path = client.create()
    .withMode(CreateMode.EPHEMERAL_SEQUENTIAL)
    .forPath("/registry/id-", "".getBytes());

// path = "/registry/id-0000000001"
// 提取序号作为全局 ID
long globalId = Long.parseLong(path.substring(path.lastIndexOf("-") + 1));
```

**为什么可行？**

- ZooKeeper 保证序号全局递增
- 临时节点自动清理，不用担心 ID 冲突
- 序号可以预取，提高性能

## Master 选举：抢注 leader 节点

分布式系统中，经常需要选出一个「主」节点来执行特定任务。

核心思路：**临时节点 + Watch**。

```java
public class MasterElection {

    private static final String MASTER_PATH = "/election/master";

    public void runForMaster(LeaderLatch latch) throws Exception {
        latch.start();
        latch.await();  // 阻塞直到成为 Leader

        System.out.println("我当选为 Master 了！");

        // 执行 Master 任务
        doMasterTask();
    }

    public void watchMaster(Watcher watcher) throws Exception {
        // Watch 之前的 master
        while (true) {
            try {
                client.checkExists()
                    .usingWatcher(watcher)
                    .forPath(MASTER_PATH);
                break;  // master 存在，监听其删除事件
            } catch (NoNodeException e) {
                // master 不存在，尝试抢注
                try {
                    client.create()
                        .withMode(CreateMode.EPHEMERAL)
                        .forPath(MASTER_PATH);
                    System.out.println("抢注成功，我是新的 Master");
                    return;
                } catch (NodeExistsException ignored) {
                    // 被别人抢了，继续监听
                }
            }
        }
    }
}
```

**选举流程**：

```
1. 启动时，所有节点尝试创建 /election/master
2. 第一个成功的成为 Master（创建 EPHEMERAL 节点成功）
3. 失败的节点 Watch /election/master
4. Master 宕机 → 节点消失 → 所有等待者收到通知
5. 再次抢注，第二名成为新的 Master
```

## 分布式锁：临时顺序节点的妙用

这是 ZooKeeper 最经典的应用场景。

### 加锁原理

```java
public class ZookeeperLock {

    private String lockPath;

    public boolean tryLock() {
        // 1. 创建临时顺序节点
        lockPath = client.create()
            .withMode(CreateMode.EPHEMERAL_SEQUENTIAL)
            .forPath("/locks/order-", "".getBytes());

        // 2. 获取所有子节点
        List&lt;String&gt; children = client.getChildren()
            .forPath("/locks");

        // 3. 按序号排序
        Collections.sort(children);
        String myName = lockPath.substring("/locks/".length());

        // 4. 如果自己是序号最小的，获得锁
        if (myName.equals(children.get(0))) {
            return true;
        } else {
            // 5. 否则监听前一个节点
            String prevNode = "/locks/" + children.get(
                children.indexOf(myName) - 1
            );
            client.checkExists()
                .usingWatcher(e -> {
                    if (e.getType() == EventType.NodeDeleted) {
                        // 前一个节点删除，重新竞争
                        tryLock();
                    }
                })
                .forPath(prevNode);
            return false;
        }
    }

    public void unlock() {
        // 释放锁：删除自己的节点
        client.delete().forPath(lockPath);
    }
}
```

### 锁的公平性

临时顺序节点保证**公平锁**：每个节点按创建顺序获得锁。

```
节点 A 创建 /locks/order-0000000001
节点 B 创建 /locks/order-0000000002
节点 C 创建 /locks/order-0000000003

锁释放顺序：A → B → C（A 删除后 B 获得锁）
```

## 分布式队列：FIFO 消息队列

利用顺序节点实现简单的 FIFO 队列：

```java
// 生产者：入队
public void enqueue(String message) {
    client.create()
        .withMode(CreateMode.PERSISTENT_SEQUENTIAL)
        .forPath("/queue/msg-", message.getBytes());
}

// 消费者：出队（获取序号最小的）
public String dequeue() {
    List&lt;String&gt; children = client.getChildren().forPath("/queue");
    Collections.sort(children);

    if (!children.isEmpty()) {
        String minNode = children.get(0);
        byte[] data = client.getData().forPath("/queue/" + minNode);
        client.delete().forPath("/queue/" + minNode);
        return new String(data);
    }
    return null;
}
```

## 选型建议：什么时候用 ZooKeeper？

### ZooKeeper 擅长

- **小数据、高可靠**：配置、元数据、锁、选举
- **需要强一致性**：写操作需要原子性
- **需要 Watch 通知**：实时感知变更
- **成熟稳定优先**：金融、交易系统

### ZooKeeper 不擅长

- **大数据量**：每次变更全量推送，数据应 < 1MB
- **高并发写入**：写操作需要 Leader，存在瓶颈
- **服务注册发现**（相对）：Nacos、Eureka 更适合
- **需要复杂查询**：不支持条件查询

### 替代方案对比

| 场景 | ZooKeeper | etcd | Consul | Nacos |
|------|-----------|------|--------|-------|
| 配置管理 | ✅ | ✅ | ✅ | ✅ |
| 服务注册 | ⚠️ | ✅ | ✅ | ✅ |
| 分布式锁 | ✅ | ✅ | ✅ | ✅ |
| Leader 选举 | ✅ | ✅ | ✅ | ✅ |
| 服务发现 | ❌ | ⚠️ | ✅ | ✅ |

## 总结

ZooKeeper 的核心能力，在于提供了一个**可靠、有序、通知及时**的协调服务：

- **配置管理**：Watch 机制 + 临时节点 = 动态配置
- **命名服务**：顺序节点 = 全局唯一 ID
- **分布式锁**：临时顺序节点 = 公平锁
- **Master 选举**：临时节点 + Watch = 自动抢注

选对场景，才能发挥 ZooKeeper 的最大价值。

**面试追问方向：**
- ZooKeeper 分布式锁和 Redis 分布式锁各有什么优缺点？
- 如何用 ZooKeeper 实现一个可重入锁？
- ZooKeeper 的 Watch 机制在高并发下有什么问题？
- 如果 ZooKeeper 集群不可用，依赖它的服务会怎样？