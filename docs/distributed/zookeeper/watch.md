# ZooKeeper 监听机制（Watch）：一次性触发原理

你有没有遇到过这种情况？

你在 ZooKeeper 上注册了一个监听，满心期待能「实时」感知数据变化，结果漏掉了几次更新。查了半天日志，发现问题出在：**你监听的节点在注册前就已经被改了**。

这不是 ZooKeeper 的 bug，是它的设计哲学。

## Watch 的核心语义：一次性触发

ZooKeeper 的 Watch 机制有一个容易被忽略的特性：**事件触发一次，立即失效**。

你可能觉得这是缺点，但换个角度想：如果每次变更都触发，那高并发场景下 Watch 回调岂不是会「炸」？

ZooKeeper 选择了一个务实的方案：**触发即失效，失效后想继续监听？重新注册**。

```java
// 注册 Watch
byte[] data = client.getData()
    .usingWatcher(watcher -> {
        System.out.println("节点数据变化了：" + watcher);
        // 注意：这里只触发一次
    })
    .forPath("/config/db");

// 第一次修改：触发回调
client.setData().forPath("/config/db", "value1".getBytes()); // 回调被触发

// 第二次修改：不触发（Watch 已失效）
client.setData().forPath("/config/db", "value2".getBytes()); // 无回调
```

## Watch 的五种事件类型

ZooKeeper 定义了五种 Watch 事件，覆盖了节点生命周期的各个环节：

| 事件类型 | 触发时机 |
|---------|---------|
| `None` | 客户端连接状态变化 |
| `NodeCreated` | 节点被创建 |
| `NodeDeleted` | 节点被删除 |
| `NodeDataChanged` | 节点数据被修改 |
| `NodeChildrenChanged` | 子节点列表发生变化 |

```java
// Watcher 接口
public class MyWatcher implements Watcher {
    @Override
    public void process(WatchedEvent event) {
        switch (event.getType()) {
            case NodeCreated:
                System.out.println("新节点创建: " + event.getPath());
                break;
            case NodeDeleted:
                System.out.println("节点被删除: " + event.getPath());
                break;
            case NodeDataChanged:
                System.out.println("节点数据变更: " + event.getPath());
                break;
            case NodeChildrenChanged:
                System.out.println("子节点列表变更: " + event.getPath());
                break;
            case None:
                System.out.println("连接状态变更: " + event.getState());
                break;
        }
    }
}
```

## Watch 的实现原理

为什么 ZooKeeper 要设计成「一次性触发」？这要从它的实现原理说起。

**传统的监听方案**：客户端和服务器保持长连接，服务器维护回调列表，每次变更主动推送。问题是：高并发下服务器压力大，需要管理大量回调状态。

**ZooKeeper 的方案**：

```
1. 客户端注册 Watch 时，请求携带监听路径
2. 服务器在响应中带上 Watch 事件（如果有）
3. 服务器在内存中标记「该路径有 Watch」
4. 变更发生时，服务器查找标记，发送事件给对应客户端
5. 事件发送后，清除标记（所以只触发一次）
```

关键洞察：**Watch 的状态由服务器维护，事件通过 TCP 连接异步推送，客户端只是被动接收**。

这就解释了为什么「漏听」是可能的——如果事件在 Watch 注册前就发生了，服务器会直接返回「无事件」，不会等你。

## 漏听问题：不可避免的设计权衡

漏听不是 bug，是 Trade-off。

```java
// 场景：两个客户端同时操作
// Client A                          // Client B
getData("/config", watch)           
                                    setData("/config", "v1")  // Watch 被触发并失效
                                    setData("/config", "v2")  // 漏听了！
getData("/config", watch)           // 重新注册 Watch
```

ZooKeeper 的「先后」是语义上的，不是因果上的。**真正的一致性保证来自 ZAB 协议，不是 Watch**。

## Watch 使用注意事项

**不要在回调中处理复杂逻辑**：

```java
// 错误示例
watcher = event -> {
    // 不要在这里做重操作
    doHeavyCalculation();  // 可能阻塞其他事件
    callRemoteService();   // 可能失败，导致雪崩
    updateZNode();         // 可能再次触发 Watch
};

// 正确做法：只做轻量操作，异步处理
watcher = event -> {
    // 只记录日志或更新内存状态
    log.info("配置变更，触发刷新");
    refreshLocalCache();
};
```

**Watch 注册在「读」操作上**：

```java
// getData 注册 NodeDataChanged
client.getData().usingWatcher(watcher).forPath("/path");

// getChildren 注册 NodeChildrenChanged
client.getChildren().usingWatcher(watcher).forPath("/path");

// exists 注册 NodeCreated + NodeDeleted + NodeDataChanged
client.checkExists().usingWatcher(watcher).forPath("/path");
```

## Curator 对 Watch 的封装

原生 Watch API 用起来繁琐，Curator 提供了更高级的封装。

### NodeCache：监听单个节点

```java
NodeCache cache = new NodeCache(client, "/config/db");
cache.getListenable().addListener(() -> {
    ChildData data = cache.getCurrentData();
    if (data != null) {
        System.out.println("节点数据: " + new String(data.getData()));
    }
});
cache.start();
// 启动后，每次节点变更都会收到通知（自动重新注册）
```

### PathChildrenCache：监听子节点列表

```java
PathChildrenCache cache = new PathChildrenCache(
    client, "/registry", true // 缓存数据
);
cache.getListenable().addListener((client, event) -> {
    switch (event.getType()) {
        case CHILD_ADDED:
            System.out.println("新增子节点: " + event.getData().getPath());
            break;
        case CHILD_UPDATED:
            System.out.println("子节点更新: " + event.getData().getPath());
            break;
        case CHILD_REMOVED:
            System.out.println("子节点删除: " + event.getData().getPath());
            break;
    }
});
cache.start();
```

**Curator 封装的本质**：在回调中自动重新注册 Watch，变「一次性」为「持续性」。

## 总结

ZooKeeper 的 Watch 机制，是一个有「个性」的设计：

- **一次性触发**：性能优先，不维护回调状态
- **事件推送**：服务器主动推送，不依赖轮询
- **可能漏听**：设计权衡，不是 bug
- **Curator 封装**：自动重注册，实现持续监听

理解 Watch 的设计哲学，才能用好它。

**面试追问方向：**
- 如何实现「持续监听」而不漏听？
- Curator 的 PathCache 是怎么自动重注册 Watch 的？
- Watch 和 ZooKeeper 的事务是什么关系？
- 为什么 Watch 只触发一次，而不是维护一个回调列表？