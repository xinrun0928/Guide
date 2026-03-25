# ZooKeeper 核心概念

想象一下，如果让你设计一个系统，让分布式环境下的多台机器能够「协调」工作——互相知道对方的存在、感知对方的状态变化、甚至排队执行任务——你会怎么做？

很多人第一反应是「写一个消息队列」，或者「用数据库存状态」。但 ZooKeeper 告诉你：**一个类似文件系统的树形结构，就能解决分布式协调的大部分问题。**

这就是 ZooKeeper 的核心设计哲学。

## ZNode：ZooKeeper 的数据结构

ZooKeeper 的数据存储单元叫做 **ZNode**，你可以把它理解为「文件系统中的节点」。

和普通文件系统的节点一样，ZNode 也是树形结构：

```
/
├── /config                    # 配置节点
│   ├── /config/database       # 数据库配置
│   └── /config/app            # 应用配置
├── /services                  # 服务节点
│   ├── /services/order        # 订单服务
│   └── /services/payment      # 支付服务
└── /locks                     # 分布式锁节点
    └── /locks/order-lock      # 订单操作锁
```

每个 ZNode 都可以存储数据，并且可以有子节点。但它和文件系统的「文件」和「目录」有个关键区别：**ZNode 是为协调而生的**，它存储的数据量很小（通常限制在 1MB 以内），但每个节点都有完整的元信息。

### ZNode 的两种类型

ZNode 分为两种类型，理解它们的区别是掌握 ZooKeeper 的基础：

**持久节点（PERSISTENT）**

```java
// 创建持久节点，除非主动删除，否则一直存在
zk.create("/config/database", "mysql://localhost:3306".getBytes(),
    ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.PERSISTENT);
```

持久节点创建后，即使创建它的客户端断开连接，节点也不会消失。它就像刻在石板上的字，除非你亲手擦掉，否则永远在那。

**临时节点（EPHEMERAL）**

```java
// 创建临时节点，客户端断开连接后自动删除
zk.create("/services/order/instance-001", "192.168.1.100:8080".getBytes(),
    ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.EPHEMERAL);
```

临时节点是 ZooKeeper 实现服务发现的秘密武器。当一个服务实例启动时，它在 ZooKeeper 中创建一个临时节点；当这个实例宕机或网络断开时，连接自动消失，临时节点也随之删除。

这意味着什么？

**其他服务只需要盯着 ZooKeeper 中的节点列表，就知道哪些服务实例还活着。** 不需要心跳上报、不需要额外的健康检查，服务上线和下线自动反映在节点的变化上。

### 顺序节点：解决「先到先得」问题

除了持久和临时之分，ZNode 还有顺序和非顺序之分。

**顺序节点（SEQUENTIAL）**会在节点名后追加一个自增的数字：

```java
// 创建临时顺序节点
// 假设当前 /locks 下没有节点，创建后得到 /locks/lock-0000000001
zk.create("/locks/order-lock-", "".getBytes(),
    ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.EPHEMERAL_SEQUENTIAL);
```

这个特性在分布式锁中非常有用——谁创建的节点序号最小，谁就优先获得锁。具体实现我们会在[分布式锁实现](/middleware/registry/zookeeper-lock)中详细讲解。

### 四种组合

持久节点和临时节点，与顺序和非顺序组合，得到四种 ZNode 类型：

| 类型 | 说明 | 典型场景 |
|-----|-----|---------|
| PERSISTENT | 持久非顺序 | 配置文件、系统参数 |
| PERSISTENT_SEQUENTIAL | 持久顺序 | 分布式队列 |
| EPHEMERAL | 临时非顺序 | 临时配置、一次性任务 |
| EPHEMERAL_SEQUENTIAL | 临时顺序 | 分布式锁、选举 |

## 版本号：乐观锁的基石

每个 ZNode 都有三个版本号：

- **cversion**：子节点的版本号变化次数
- **mversion**：数据的版本号变化次数
- **aclVersion**：ACL 权限的版本号变化次数

最常用的是数据的版本号 `mversion`，它从 0 开始，每次更新数据时加 1。

这个版本号有什么用？

**实现乐观锁。** 假设你有一段配置，想要修改它：

```java
// 第一步：获取当前数据和版本
Stat stat = new Stat();
byte[] data = zk.getData("/config/app", false, stat);
int currentVersion = stat.getVersion();

// 第二步：修改数据（带版本检查）
try {
    // 只有版本号匹配时才能更新成功
    zk.setData("/config/app", newData, currentVersion);
} catch (BadVersionException e) {
    // 版本冲突，说明在你读取之后、写入之前，有其他人修改了数据
    // 需要重新读取、重新比较、重新写入
    handleConflict();
}
```

这叫做 **Check-And-Set（CAS）** 操作。如果两个客户端同时读取了相同版本的数据，先更新的那个成功，后更新的那个会收到版本冲突异常，然后重试。

**你可能会问：这和 Redis 的 WATCH 命令、数据库的乐观锁是不是很像？**

没错，这是分布式系统中处理并发修改的标准套路。ZooKeeper 用版本号提供了一种简单可靠的方案。

## ACL：权限控制

ZooKeeper 使用 **ACL（Access Control List）** 来控制节点的访问权限。

### 权限类型

ZooKeeper 定义了 5 种基本权限：

| 权限 | 说明 | 字符 |
|-----|-----|-----|
| CREATE | 创建子节点 | c |
| READ | 读取数据和子节点列表 | r |
| WRITE | 更新节点数据 | w |
| DELETE | 删除子节点 | d |
| ADMIN | 设置权限 | a |

### 认证方式

ZooKeeper 支持多种认证方式：

```java
// 方式一：world 认证，任何人都可以访问（默认方式）
zk.create("/public", data, ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.PERSISTENT);

// 方式二：auth 认证，使用当前连接的用户名密码
zk.addAuthInfo("digest", "admin:admin123".getBytes());
zk.create("/protected", data, ZooDefs.Ids.CREATOR_ALL_ACL_UNSAFE, CreateMode.PERSISTENT);

// 方式三：IP 认证，只允许特定 IP 访问
List&lt;ACL&gt; ipAcl = new ArrayList&lt;&gt;();
ipAcl.add(new ACL(Perms.ALL, new Id("ip", "192.168.1.0/24")));
zk.create("/internal", data, ipAcl, CreateMode.PERSISTENT);
```

### ACL 继承

子节点默认继承父节点的 ACL，但也支持单独设置：

```java
// 创建节点时指定 ACL
List&lt;ACL&gt; acl = new ArrayList&lt;&gt;();
acl.add(new ACL(Perms.READ | Perms.WRITE, new Id("auth", "user:pwd")));
zk.create("/restricted", data, acl, CreateMode.PERSISTENT);
```

在实际生产环境中，通常采用 **分层权限设计**：根节点权限最严格，子节点逐级放宽，或者根据业务域划分权限边界。

## Watch：实时感知的秘诀

终于到了 ZooKeeper 最独特的特性——**Watch 机制**。

想象一个场景：你在等一个快递，快递员不会一直给你打电话，他只会告诉你「包裹到了就去敲门」。Watch 就是 ZooKeeper 版本的「敲门通知」。

### Watch 的工作原理

Watch 有三个关键特性：

1. **一次性触发**：Watcher 收到通知后就失效了，想要继续监听必须重新注册
2. **客户端异步回调**：Watcher 触发后，ZooKeeper 会通知客户端，客户端自己决定怎么处理
3. **注册在读操作上**：Watch 不是写在节点上，而是注册在读取节点的请求上

```java
// 注册 Watch：监听节点数据变化
byte[] data = zk.getData("/config/app", new Watcher() {
    @Override
    public void process(WatchedEvent event) {
        if (event.getType() == Event.EventType.NodeDataChanged) {
            // 数据被修改了，重新获取最新值
            byte[] newData = zk.getData("/config/app", this, new Stat());
            applyConfig(new String(newData));
        }
    }
}, new Stat());

// 如果数据被修改，客户端会收到通知，然后重新读取并注册新的 Watch
```

### Watch 的触发流程

```
客户端 A 读取 /config/app 并注册 Watch
          ↓
    ZooKeeper 记录：/config/app 被客户端 A 监听
          ↓
客户端 B 修改 /config/app 的数据
          ↓
    ZooKeeper 通知：客户端 A，/config/app 的数据变了
          ↓
客户端 A 收到通知，重新读取数据（可选：再次注册 Watch）
```

### 监听的两种类型

Watch 分为两种，监听的内容不同：

```java
// 监听数据变化（exists 或 getData）
zk.exists("/config/app", watcher);  // 推荐：节点可能不存在时用
zk.getData("/config/app", watcher, stat);

// 监听子节点变化（getChildren）
zk.getChildren("/services/order", watcher);
```

这意味着你可以：
- 监听一个节点的**数据**是否变化
- 监听一个节点的**子节点列表**是否变化

### Watch 的注意事项

Watch 看起来很美好，但有几个坑需要注意：

**坑一：不可靠通知**

ZooKeeper 的 Watch 通知是**尽力而为**的。在极端情况下（比如网络分区），通知可能丢失。所以通常的实践是：

```java
// 不要完全依赖 Watch，定期全量同步
Watcher watcher = new Watcher() {
    @Override
    public void process(WatchedEvent event) {
        // 收到通知后，做一次全量同步
        refreshConfig();
        // 再次注册 Watch
        zk.exists("/config/app", this);
    }
};
```

**坑二：羊群效应**

如果一个节点有 1000 个客户端在 Watch，当节点变化时，ZooKeeper 要同时通知所有 1000 个客户端。这会造成短暂的尖峰负载。

解决方案是**分层 Watch**或**使用 Curator 库的高级特性**。

**坑三：一次性失效**

每次收到通知后，如果你想继续监听，必须**重新注册 Watch**。如果忘了注册，就会漏掉后续的变化。

## 总结

ZooKeeper 的核心概念就这三个：**ZNode 是数据结构，版本号是并发控制，Watch 是变更通知**。

但这只是开始。正是这三个简单概念的组合，让 ZooKeeper 能够实现分布式锁、配置管理、服务发现、选举机制等高级功能。

---

**留给你一个问题：**

假设你用 ZooKeeper 实现服务发现，有一个服务实例临时断开了连接，临时节点被删除了。但在节点删除通知发出之前，另一个服务尝试查询实例列表，它会看到已经下线的实例吗？

这个问题涉及到 ZooKeeper 的读一致性模型，我们后面会深入探讨。
