# Canal：让数据库主动告诉你发生了什么

MySQL 里有一条数据变了，你是怎么知道的？

轮询？每秒钟查一遍数据库？那得有多少资源浪费在「什么都没发生」的查询上。

改代码？每个业务都加一段「数据库变了通知我」的逻辑？那维护成本得多高。

今天介绍一个巧妙的思路：**不去「问」数据库，而是让数据库「主动告诉你」**。

这就是 Canal 的核心——伪装成 MySQL 从节点，接收 binlog 变更，实时感知数据变化。

---

## 什么是 Canal？

Canal 是阿里巴巴开源的 MySQL binlog 增量订阅&消费组件。它的核心原理是：

**伪装成 MySQL Slave，向 Master 发送「给我推送 binlog」的命令，然后解析接收到的 binlog 数据，转成易懂的格式供下游消费。**

```
MySQL Master（写入数据）
       ↓ 写入 binlog
Canal（伪装成 Slave，接收 binlog）
       ↓ 解析 binlog
下游系统（ES/Redis/Kafka/业务应用）
```

这个设计有多巧妙？**它利用了 MySQL 自身的主从复制机制，不侵入业务代码，不增加数据库负担**。

---

## 为什么不直接轮询？

回到开头的问题：为什么不用轮询数据库？

| 方案 | 优点 | 缺点 |
|-----|------|------|
| 轮询数据库 | 实现简单 | 数据库压力大、延迟高、浪费资源 |
| 业务代码通知 | 实时性好 | 侵入性强、维护成本高 |
| **Canal** | **实时、低侵入、可复用** | **需要额外部署、MySQL 开启 binlog** |

Canal 的代价：
- MySQL 需要开启 binlog，有额外的磁盘 IO
- 需要部署和维护 Canal 服务
- 网络传输 binlog 数据，有带宽成本

但如果你需要**实时同步数据、监控变更**，这些代价是值得的。

---

## 快速入门

Canal 的使用非常简单，分为服务端和客户端：

### 服务端配置

```yaml
# canal.properties
canal.serverMode = tcp
canal.destinations = example

# instance.properties
canal.instance.master.address = 127.0.0.1:3306
canal.instance.dbUsername = canal
canal.instance.dbPassword = canal
canal.instance.filter.regex = .*\\..*
```

### 客户端消费

```java
// Canal Client 示例代码
CanalConnector connector = CanalConnectors.newSingleConnector(
    new InetSocketAddress("127.0.0.1", 11111),
    "example",  // instance 名称
    "",          // username
    ""           // password
);

connector.connect();
connector.subscribe(".*\\..*");  // 订阅所有表

while (running) {
    // 获取 binlog 消息
    Message message = connector.getWithoutAck(batchSize);
    for (Entry entry : message.getEntries()) {
        // 解析 entry，entry 代表一条 binlog 事件
        String tableName = entry.getHeader().getTableName();
        RowChange rowChange = RowChange.parseFrom(entry.getStoreValue());
        
        // 根据事件类型处理
        for (RowData rowData : rowChange.getRowDatasList()) {
            if (rowChange.getEventType() == EventType.UPDATE) {
                // 处理更新
                System.out.println("更新前的数据: " + rowData.getBeforeColumnsList());
                System.out.println("更新后的数据: " + rowData.getAfterColumnsList());
            }
        }
    }
    connector.ack(message.getId());
}
```

---

## 核心原理

Canal 的工作原理可以分为三步：

1. **伪装协议**：Canal 伪装成 MySQL Slave，向 Master 发送 COM_BINLOG_DUMP 命令
2. **接收 binlog**：Master 的 Dump 线程把 binlog 内容推送给 Canal
3. **解析消息**：Canal 把 binlog 解析成易懂的格式（JSON/Protobuf），供下游消费

**类比理解**：你在公司装了摄像头，它实时记录所有人的行动。Canal 不是去问每个人「你干了啥」，而是坐在监控室里，实时看着录像回放。

---

## 内容导航

### 原理入门

- [工作原理：一场精心策划的「身份冒充」](/middleware/canal/principle)
  深入理解 binlog、主从复制、Canal 伪装原理

### 进阶配置

- [订阅模式与增量同步配置](/middleware/canal/subscribe)
  如何精确订阅指定表？如何处理增量数据？

### 生产实践

- [集群高可用：如何保证 Canal 自身的高可用](/middleware/canal/ha)
  Canal Server 集群、故障自动切换、运维最佳实践

- [应用场景：Canal 能解决什么问题](/middleware/canal/use-case)
  ES 同步、Redis 缓存同步、数据异构、MQ 消息队列...

### 面试对比

- [Canal 对比：选型不再纠结](/middleware/canal/compare)
  Canal vs Debezium vs Maxwell，哪个更适合你？

---

## 典型应用场景

### 场景一：MySQL 数据同步到 Elasticsearch

搜索引擎需要全文检索能力，但数据在 MySQL 里。

```
MySQL → Canal → Kafka → 消费服务 → ES
```

Canal 订阅 MySQL binlog，实时将数据变更推送到 Kafka，消费服务再写入 ES。整个链路完全异步，不影响主库性能。

### 场景二：数据库变更触发缓存更新

读多写少场景，用 Redis 做缓存，但数据更新时怎么同步？

```java
// 传统方案：先更新数据库，再删除缓存
// 问题：删除失败怎么办？并发情况下有脏数据

// Canal 方案：监听 binlog，异步更新缓存
// 好处：数据库和缓存完全解耦，有重试机制
```

### 场景三：数据异构

将一个 MySQL 库的数据异构到多个不同存储：

- 订单数据 → MySQL（事务）+ ES（搜索）+ Hive（分析）
- 用户数据 → MySQL + Redis + MongoDB

Canal 一次订阅，多处消费，维护成本大大降低。

---

## 写在最后

Canal 的设计精髓在于「借力打力」——不侵入业务代码，不增加数据库负担，利用 MySQL 自身的复制机制完成数据变更的实时感知。

**留给你的问题：**

MySQL binlog 是顺序写入的，Canal 也是顺序接收的。但在实际业务中，消费端可能处理不过来——这时候该怎么办？

Canal 提供了两种解决方案：**Message ID 定位**和**时间戳定位**。你更倾向于哪种？为什么？

下一节，我们来深入聊聊 Canal 的订阅模式，看看如何精确控制要订阅的表和字段。
