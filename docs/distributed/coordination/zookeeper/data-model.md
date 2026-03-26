# ZooKeeper 数据模型：ZNode 与版本号

你有没有想过，ZooKeeper 是怎么存储数据的？

很多人以为 ZooKeeper 就是个 KV 数据库，和 Redis 差不多。但当你真正去看它的数据模型时，会发现它更像一个「文件系统」——每个节点都有路径、有数据、有权限、还有版本。

这才是 ZooKeeper 最核心的设计。

## ZNode：ZooKeeper 的数据单元

ZooKeeper 的数据存储在一个**树形结构**中，每个节点叫 **ZNode**。这和 Linux 的文件系统很像，根节点是 `/`，子节点可以是 `/config`、`/registry` 这样的路径。

但 ZNode 和普通文件系统节点有个本质区别：**它既是文件，又是目录**。

你说它像文件吧，它可以存数据；你说它像目录吧，它可以挂载子节点。

```text
/
├── /config
│   ├── /config/database
│   └── /config/redis
├── /registry
│   └── /registry/service-a
└── /master
```

这就是 ZooKeeper 的 namespace，每个 ZNode 路径全局唯一。

## ZNode 的四种类型

ZooKeeper 支持四种类型的 ZNode，这个设计看似简单，却是很多分布式场景的基石。

### 持久节点（Persistent）

最普通的节点类型。创建后一直存在，除非你主动删除。

```java
// Curator API 创建持久节点
client.create().forPath("/config/db", "mysql://localhost:3306".getBytes());
```

适用场景：存储配置、注册长期服务、记录元数据。

### 临时节点（Ephemeral）

节点的生命周期绑定到**会话**。客户端连接断开（会话失效），节点自动删除。

```java
// 创建临时节点 - 服务注册常用
client.create()
    .withMode(CreateMode.EPHEMERAL)
    .forPath("/registry/service-a/192.168.1.1:8080", "metadata".getBytes());
```

适用场景：服务注册、健康检查（临时节点消失 = 服务下线）。

### 持久顺序节点（Persistent_Sequential）

在持久节点基础上，ZooKeeper 会自动在节点名后追加**递增序号**。

```
/registry/service-a/0000000001
/registry/service-a/0000000002
/registry/service-a/0000000003
```

适用场景：分布式队列、选举中的竞争记录。

### 临时顺序节点（Ephemeral_Sequential）

临时节点 + 顺序号。ZooKeeper 分布式锁的核心实现就靠它。

```
/locks/order-lock/0000000001  (客户端 A 创建)
/locks/order-lock/0000000002  (客户端 B 创建)
/locks/order-lock/0000000003  (客户端 C 创建)
```

序号最小的节点获得锁，释放时删除自己，下一个节点自动递补。

## ZNode 的数据结构

你以为 ZNode 只有路径和值？太天真了。

```java
// Stat 对象包含 ZNode 的完整元数据
public class Stat {
    long czxid;      // 创建时的事务 ID
    long mzxid;      // 最后修改的事务 ID
    long ctime;      // 创建时间（毫秒）
    long mtime;      // 最后修改时间（毫秒）
    long version;    // 数据版本号
    long cversion;   // 子节点版本号
    long aversion;   // ACL 版本号
    long ephemeralOwner;  // 如果是临时节点，存储 session ID
    int dataLength;  // 数据长度
    int numChildren; // 子节点数量
}
```

这里最关键的是**三个版本号**。

## 版本号机制：乐观锁的核心

ZooKeeper 的版本号不是简单的自增，它支持**乐观锁**。

当你 `setData` 时，可以指定版本号：

```java
// 只有版本号匹配时才更新（CAS 操作）
client.setData()
    .withVersion(5)  // 期望版本号是 5
    .forPath("/config/db", "new-value".getBytes());
// 如果当前版本不是 5，会抛出 BadVersionException
```

这意味着什么？

**你可以在不获取锁的情况下，完成原子的读-改-写操作。**

```java
// 模拟计数器原子递增
Stat stat = new Stat();
byte[] data = client.getData().storingStatIn(stat).forPath("/counter");
int value = Integer.parseInt(new String(data));
client.setData()
    .withVersion(stat.getVersion())
    .forPath("/counter", String.valueOf(value + 1).getBytes());
```

这就是分布式环境下的 CAS，比 Redis 的 WATCH MULTI EXEC 更底层。

## Curator CRUD 操作示例

实际开发中，我们用 Curator 来操作 ZooKeeper：

```java
// 创建节点
client.create()
    .withMode(CreateMode.PERSISTENT)
    .forPath("/config/db", "mysql://localhost:3306".getBytes());

// 读取数据
byte[] data = client.getData().forPath("/config/db");

// 读取数据 + 状态
Stat stat = new Stat();
byte[] data = client.getData().storingStatIn(stat).forPath("/config/db");
System.out.println("Version: " + stat.getVersion());

// 更新数据
client.setData().forPath("/config/db", "postgresql://localhost:5432".getBytes());

// 带版本更新（乐观锁）
try {
    client.setData()
        .withVersion(5)
        .forPath("/config/db", "new-value".getBytes());
} catch (BadVersionException e) {
    // 版本冲突，乐观锁失败
    System.out.println("数据已被其他客户端修改");
}

// 删除节点（必须无子节点）
client.delete().forPath("/config/db");

// 递归删除
client.delete().deletingChildrenIfNeeded().forPath("/registry");
```

## 版本号的实际应用

为什么 ZooKeeper 要设计版本号？它解决什么问题？

**配置变更的乐观锁**：多个应用实例同时修改配置时，只有第一个成功的生效，后续的检测到版本冲突后重试。

**分布式锁的公平性**：顺序节点通过版本号保证获取锁的顺序。

**数据一致性**：zxid（事务 ID）隐含版本号，选举时选数据最新的节点。

## 总结

ZooKeeper 的 ZNode 设计，看似简单却暗藏玄机：

- **四种类型**：持久/临时 × 有序/无序
- **元数据丰富**：版本号、时间戳、事务 ID
- **版本号即乐观锁**：实现无锁的 CAS 操作

理解这些基础，是掌握 ZooKeeper 所有高级特性的前提。

**面试追问方向：**
- ZNode 的四个类型分别适用于什么场景？
- 版本号冲突时 ZooKeeper 返回什么错误？
- 临时节点的生命周期和 session 是什么关系？
- 为什么 ZooKeeper 不适合存放大数据？