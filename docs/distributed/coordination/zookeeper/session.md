# ZooKeeper 会话机制与会话恢复

你有没有想过这个问题：

分布式系统中，服务重启是家常便饭。如果 ZooKeeper 客户端重启了，它之前创建的临时节点会不会消失？

答案是：**看情况**。

如果 session 没过期——临时节点还在，业务无感知。如果 session 过期了——临时节点全部删除，服务「被下线」。

理解这个机制，是用好 ZooKeeper 的关键。

## Session：客户端与服务器的桥梁

Session 是客户端与 ZooKeeper 服务器之间的**逻辑连接**。不是 TCP 物理连接，而是建立在 TCP 之上的会话概念。

```java
// 客户端创建连接时，就建立了一个 Session
CuratorFramework client = CuratorFrameworkFactory.newClient(
    "localhost:2181",
    3000,  // sessionTimeout
    3000,  // connectionTimeout
    new ExponentialBackoffRetry(1000, 3)
);
client.start();
```

Session 有三个核心属性：

```java
// Session 的关键配置
sessionTimeout = 30000;   // 会话超时时间（毫秒）
connectionTimeout = 3000; // 连接超时时间
```

## Session 的状态机

Session 不是「活着」就是「死了」，中间有一系列状态：

```java
public enum KeeperState {
    Disconnected,   // 未连接
    Connected,      // 已连接
    Connecting,      // 正在连接
    ConnectedReadOnly,  // 只读连接（过半节点不可用时）
    Expired,        // 会话过期
    AuthFailed      // 认证失败
}
```

状态流转：

```
Connecting → Connected → (网络抖动) → Disconnected → Connecting → Connected
                                    ↓
                                Expired (超时未重连成功)
```

**关键点**：Disconnected 不等于 Session 失效。只要在 sessionTimeout 内重新连上，Session 还在。

## 心跳维持 Session

客户端通过**心跳**维持 Session。

```java
// 客户端会定期发送心跳（PING）
// 服务端在 sessionTimeout 时间内没收到心跳，才判定 Session 过期
// ZooKeeper 服务端控制超时，客户端只需要保持连接即可
```

这个设计很巧妙：**Session 生命周期的控制权在服务端**，客户端只需要维持 TCP 连接。

## Session 恢复：断线重连的秘密

当网络抖动导致 Disconnected 时，会发生什么？

```java
// 场景：网络抖动 10 秒后恢复
// sessionTimeout = 30 秒

// 1. 网络断开 → Disconnected 状态
// 2. 客户端尝试重连 → Connecting 状态
// 3. 10 秒后网络恢复 → Connected 状态
// 4. Session 完好如初，临时节点一个没少
```

Session 恢复的核心机制：

1. **Session ID 不变**：服务器端通过 Session ID 识别同一个 Session
2. **临时节点不丢失**：Session 未过期，临时节点还在
3. **Watch 自动重新注册**：之前注册的 Watch 状态也会恢复

```java
// Curator 客户端的断线重连是透明的
client.getConnectionStateListenable().addListener((client, newState) -> {
    switch (newState) {
        case RECONNECTED:
            System.out.println("重连成功，Session 已恢复");
            break;
        case LOST:
            System.out.println("Session 已过期");
            break;
        case SUSPENDED:
            System.out.println("连接中断，正在重试");
            break;
    }
});
```

## Session 与临时节点的关系

这是最容易踩坑的地方。

**临时节点的生命周期绑定到 Session**，不是进程：

```java
// 创建临时节点
client.create()
    .withMode(CreateMode.EPHEMERAL)
    .forPath("/registry/service-a/192.168.1.1:8080");

// Session 过期（断开 30 秒）
// → 临时节点被自动删除
// → 其他客户端 Watch 到 NodeDeleted
// → 触发服务下线逻辑
```

**但如果是客户端正常关闭呢？**

```java
// 正常关闭
client.close();
// ZooKeeper 客户端在关闭前会主动删除该 Session 创建的所有临时节点
// 这是「优雅下线」，临时节点会被立即删除
```

**Session ID 的生成**：

```java
// Session ID 是 64 位长整数
// 格式：时间戳 + 机器信息 + 计数的组合
// 客户端重连时使用同一个 Session ID，服务端识别为同一个会话
```

## 为什么 Session 超时这么重要？

Session 超时时间（sessionTimeout）的设置需要权衡：

- **太短**：网络抖动时容易误判 Session 失效，临时节点被误删
- **太长**：故障节点占用的 Session 资源迟迟不释放，影响整体吞吐

官方建议：最小 2 * tickTime，最大 20 * tickTime（默认 tickTime = 2000ms）。

```java
// ZooKeeper 配置文件
tickTime=2000
initLimit=10      // Follower 启动时与 Leader 同步的 tick 数
syncLimit=5       // Leader 与 Follower 同步的 tick 数
dataDir=/data     # 存储快照目录
clientTimeout=30000  # sessionTimeout
```

## 总结

ZooKeeper 的 Session 机制，是一个「容错设计」的典范：

- **Session 状态机**：Connected / Disconnected / Expired
- **心跳维持**：服务端控制超时，客户端维持 TCP 连接
- **断线重连**：Session ID 不变，临时节点恢复，Watch 恢复
- **临时节点依赖**：Session 失效 = 临时节点消失

理解 Session 机制，才能设计出健壮的分布式协调服务。

**面试追问方向：**
- Session 过期后，服务器端会立即删除临时节点吗？
- ZooKeeper 客户端如何检测 Session 失效？
- 如果客户端进程僵死但 TCP 连接还在，临时节点会被删除吗？
- sessionTimeout 设置过长会有什么影响？