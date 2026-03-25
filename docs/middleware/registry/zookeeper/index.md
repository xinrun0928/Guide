# ZooKeeper：分布式协调的「瑞士军刀」

想象一下，你需要协调 100 台服务器完成一项任务——谁先执行、谁后执行、谁失败了要重试。

如果让你自己设计这套协调机制，你打算怎么做？

**ZooKeeper 告诉你：用文件系统的思路，就能解决分布式协调的大部分问题。**

ZooKeeper 是 Apache 基金会的顶级项目，最初诞生于 Hadoop 生态，现在已经成为分布式协调领域的「瑞士军刀」——从 Kafka 到 HBase，从 Dubbo 到 Sentinel，几乎所有分布式中间件都用它做协调服务。

## 什么是 ZooKeeper？

ZooKeeper 是一个分布式协调服务，它的核心是一个**类似文件系统的树形数据结构**。

但它不是用来存储文件的，而是用来存储**协调信息**——谁在运行、谁在等待、谁持有锁。

```
/
├── /config                    # 配置节点
│   ├── /config/database       # 数据库配置
│   └── /config/app            # 应用配置
├── /services                  # 服务节点
│   ├── /services/order        # 订单服务实例列表
│   └── /services/payment      # 支付服务实例列表
└── /locks                     # 分布式锁节点
    └── /locks/order-lock      # 订单操作锁
```

**ZooKeeper 的核心能力：**

- **统一命名服务**：给服务起个名字，通过名字找到服务
- **配置管理**：集中管理配置，变更实时通知
- **分布式锁**：抢锁、排序、等待通知
- **Leader 选举**：谁当老大，其他节点听谁的
- **服务发现**：哪些实例在线，实时感知上下线

## 快速开始

```java
// ZooKeeper 连接
ZooKeeper zk = new ZooKeeper(
    "localhost:2181",      // 连接地址
    3000,                  // 超时时间（毫秒）
    event -> {}            // 事件监听
);

// 创建节点
zk.create("/config/app", "maxCount=100".getBytes(),
    ZooDefs.Ids.OPEN_ACL_UNSAFE, CreateMode.PERSISTENT);

// 读取数据
byte[] data = zk.getData("/config/app", false, null);
String config = new String(data);

// 监听变化
zk.getData("/config/app", event -> {
    if (event.getType() == Event.EventType.NodeDataChanged) {
        // 配置变更，刷新本地缓存
        refreshConfig();
    }
}, null);
```

## 核心概念

理解 ZooKeeper，先理解三个核心概念：

| 概念 | 说明 | 类比 |
|-----|-----|-----|
| **ZNode** | 数据存储单元，类比文件系统节点 | 文件或目录 |
| **版本号** | 乐观锁的基础，CAS 操作的依据 | 文件的修改版本 |
| **Watch** | 数据变化的实时通知 | 文件监视器 |

详细原理请阅读：

- [ZooKeeper 核心概念](/middleware/registry/zookeeper-core)

## 分布式锁

ZooKeeper 最经典的应用场景之一就是**分布式锁**。

为什么需要分布式锁？因为多台机器共享资源时，需要互斥访问。

```
线程 A（机器 1）           线程 B（机器 2）
     │                         │
     │── 创建临时顺序节点 ───→ │
     │                         │
     │── 检查自己是不是最小 ─→ │── 创建临时顺序节点 ──→│
     │◀── 是，获得锁 ─────────│
     │                         │── 检查自己是不是最小
     │                         │◀── 否，监听前一个节点
     │                         │
     │── 释放锁（删除节点）──→ │
     │                         │◀── 收到通知，获得锁
```

详细实现请阅读：

- [ZooKeeper 分布式锁实现](/middleware/registry/zookeeper-lock)

## 脑裂问题

分布式系统中最危险的问题之一：**网络分区导致一个集群分裂成两个「独立」的集群**。

两个「Leader」同时存在，数据不一致。

ZooKeeper 使用 **过半机制** 来避免脑裂：只有获得超过半数节点投票的才能成为 Leader。

```
集群有 5 台机器：
- 要成为 Leader，必须获得至少 3 票
- 网络分区后，一侧最多 3 台，一侧最多 2 台
- 只有 3 台的那侧能选出 Leader
- 2 台的那侧无法选出 Leader，服务暂停
- 不会有两个 Leader 同时存在
```

详细分析请阅读：

- [ZooKeeper 脑裂问题与解决方案](/middleware/registry/zookeeper-brain-split)

## 使用场景

ZooKeeper 适合什么场景？

| 场景 | 推荐指数 | 说明 |
|-----|--------|-----|
| **中间件协调** | ⭐⭐⭐⭐⭐ | Kafka、HBase、Dubbo 等标配 |
| **分布式锁** | ⭐⭐⭐⭐⭐ | 成熟方案，社区验证 |
| **Leader 选举** | ⭐⭐⭐⭐⭐ | 天然支持，简洁可靠 |
| **配置管理** | ⭐⭐⭐ | 可以用，但功能较弱 |
| **服务注册发现** | ⭐⭐ | 不推荐，功能太简单 |
| **大规模微服务** | ⭐ | ZooKeeper 不适合万级服务实例 |

**什么时候用 ZooKeeper？**

- 已有 ZooKeeper 集群（Kafka、HBase 生态）
- 需要分布式锁或 Leader 选举
- 服务实例数量 < 5000
- 需要强一致性

**什么时候不用 ZooKeeper？**

- 纯微服务注册发现（用 Nacos）
- 需要配置中心（用 Nacos/Apollo）
- 大规模服务实例（用 Nacos/Consul）
- 多语言技术栈（用 Consul）

## 面试追问

**Q：ZooKeeper 的一致性模型是什么？**

A：ZooKeeper 是 CP 模型。写操作必须经过 Leader，过半节点确认才算成功。在网络分区时，可能不可用。

**Q：ZooKeeper 和 etcd 有什么区别？**

A：两者都是分布式协调服务，但定位不同：
- ZooKeeper：专精协调，配套完善（锁、选举）
- etcd：轻量级 kv，强调可用性和 Raft 协议（Kubernetes 标配）

**Q：ZooKeeper 如何保证高可用？**

A：集群部署 + 过半机制。通常部署奇数台（3、5、7），挂掉不超过半数节点就能继续服务。

---

**留给你的问题：**

假设 ZooKeeper 集群有 5 台机器，其中 2 台因为网络故障和其他 3 台断开连接。

断开的 2 台会怎么样？它们能继续提供服务吗？

这涉及到 ZooKeeper 的「过半机制」设计，理解这个问题，你就理解了 ZooKeeper 高可用的本质。
