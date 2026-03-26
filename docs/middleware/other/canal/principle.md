# Canal 工作原理：一场精心策划的「身份冒充」

MySQL 里有一条数据变了，你是怎么知道的？

轮询？每秒钟查一遍数据库？那得有多少资源浪费在「什么都没发生」的查询上。

改代码？每个业务都加一段「数据库变了通知我」的逻辑？那维护成本得多高。

今天介绍一个巧妙的思路：**不去「问」数据库，而是让数据库「主动告诉你」**。

这就是 Canal 的核心——**伪装成 MySQL 从节点，接收 binlog 变更**。

---

## binlog 是什么？

在说 Canal 之前，必须先搞懂 binlog。

你可以把 binlog 理解为 MySQL 的「操作记录本」。每次数据库有变更（INSERT、UPDATE、DELETE），MySQL 都会把操作记在这个本子上。

```
# binlog 里大概记录了这些内容
# 时间点 1: INSERT INTO user VALUES(1, '张三')
# 时间点 2: UPDATE user SET name='李四' WHERE id=1
# 时间点 3: DELETE FROM user WHERE id=1
```

binlog 有三种格式：

| 格式 | 说明 | 特点 |
|-----|------|-----|
| **STATEMENT** | 记录 SQL 语句 | 节省空间，但部分函数（如 NOW()）可能导致主从不一致 |
| **ROW** | 记录每行数据的变化 | 准确，但日志量大 |
| **MIXED** | 混用 STATEMENT 和 ROW | 默认选择，能用 STATEMENT 就用，不行就切换 ROW |

**生产环境强烈建议用 ROW 格式**。虽然日志量大一点，但准确性是底线——数据同步这种场景，宁可多占空间，不能丢数据。

---

## MySQL 主从复制原理

搞懂 binlog 之后，主从复制就很好理解了。

```
┌─────────────┐                    ┌─────────────┐
│   Master    │                    │   Slave     │
│             │                    │             │
│  ┌───────┐  │  ① 写入 binlog    │  ┌───────┐  │
│  │ binlog│──┼───────────────────┼─▶│ relay │  │
│  └───────┘  │                    │  │ log   │  │
│             │                    │  └───────┘  │
│  ┌───────┐  │  ② Dump 线程       │  ┌───────┐  │
│  │  SQL  │──┼───────────────────┼─▶│ I/O   │──┘
│  │ Thread│  │                    │  │ Thread│  │
│  └───────┘  │                    │  └───────┘  │
└─────────────┘                    └─────────────┘
```

**主从复制的核心流程：**

1. Master 接收写请求，执行 SQL，同时把变更写入 binlog
2. Master 的 Dump 线程把 binlog 内容「推送」给 Slave
3. Slave 的 I/O Thread 接收 binlog，写入 relay log（中转日志）
4. Slave 的 SQL Thread 读取 relay log，执行 SQL，完成数据同步

**关键点：Slave 是被动接收的，不是主动去拉。** Master 推多少，Slave 收多少。

---

## Canal 的核心原理

现在重点来了——Canal 是怎么「冒充」Slave 的？

Canal 模拟了 MySQL Slave 的行为：

```
┌─────────────┐                    ┌─────────────┐
│   Master    │                    │   Canal     │
│             │                    │  (伪装 Slave)│
│  ┌───────┐  │                    │  ┌───────┐  │
│  │ binlog│──┼────────────────────┼─▶│ binlog│  │
│  └───────┘  │                    │  │ parser│  │
│             │                    │  └───────┘  │
│  ┌───────┐  │                    │  ┌───────┐  │
│  │ Dump  │──┼────────────────────┼─▶│解析后  │  │
│  │ Thread│  │                    │  │的消息 │  │
│  └───────┘  │                    │  └───────┘  │
└─────────────┘                    └─────────────┘
```

Canal 干了三件事：

1. **伪装协议**：Canal 伪装成 MySQL Slave，向 Master 发送 COM_BINLOG_DUMP 命令
2. **接收 binlog**：Master 的 Dump 线程把 binlog 内容推送给 Canal
3. **解析消息**：Canal 把 binlog 解析成易懂的格式（JSON/Protobuf），供下游消费

**这就好比**：你在公司装了摄像头，它实时记录所有人的行动。Canal 不是去问每个人「你干了啥」，而是坐在监控室里，实时看着录像回放。

---

## Canal 架构解析

Canal 由三部分组成：

```
┌─────────────────────────────────────────────────────────┐
│                      Canal 整体架构                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐   │
│  │  Canal Server │   │  Canal Client │   │  目标系统   │   │
│  │             │   │              │   │            │   │
│  │ 伪装成 MySQL │   │ 消费解析后的 │   │ ES/Redis/  │   │
│  │ Slave，接收  │   │ 消息，推送给 │   │ Kafka/应用  │   │
│  │ binlog       │   │ 客户端      │   │             │   │
│  └─────────────┘   └─────────────┘   └─────────────┘   │
│         ↑                  ↑                           │
│         │                  │                           │
│         └──────────────────┴───────────────────────────│
│                    Server-Client 模式                   │
└─────────────────────────────────────────────────────────┘
```

### Canal Server

Canal Server 是核心组件，负责：

- 伪装成 MySQL Slave，与 MySQL Master 建立连接
- 接收 binlog 数据
- 解析 binlog，提取表结构变更和行数据变更
- 管理多个 Instance（实例），一个 Server 可以监听多个 MySQL

### Canal Instance

Instance 是 Server 内部的逻辑单元，每个 Instance 对应一个 MySQL 源：

```
一个 Canal Server
├── Instance A → 监听 MySQL A（订单库）
├── Instance B → 监听 MySQL B（用户库）
└── Instance C → 监听 MySQL C（商品库）
```

### Canal Client

Client 是消费端，订阅 Instance 获取的 binlog 数据：

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
 // 获取 binlog 消息（轮询方式）
 Message message = connector.getWithoutAck(batchSize);
 for (Entry entry : message.getEntries()) {
 // 解析 entry，entry 代表一条 binlog 事件
 String logFileName = entry.getHeader().getLogfileName();
 long logFileOffset = entry.getHeader().getLogfileOffset();
 String schemaName = entry.getHeader().getSchemaName();
 String tableName = entry.getHeader().getTableName();
 RowChange rowChange = RowChange.parseFrom(entry.getStoreValue());
 for (RowData rowData : rowChange.getRowDatasList()) {
 // 根据 rowChange.getEventType() 判断是 INSERT/UPDATE/DELETE
 System.out.println(schemaName + "." + tableName);
 }
 }
 connector.ack(message.getId());  // 确认消息
}
```

---

## binlog 事件类型

Canal 解析的 binlog 事件，主要有以下几种：

| 事件类型 | 说明 | Canal 中的 EventType |
|---------|------|---------------------|
| **QUERY** | 执行 SQL 前的查询事件 | QUERY |
| **TABLE_MAP** | 表结构定义 | CREATE / ALTER / RENAME |
| **WRITE_ROWS** | INSERT 语句 | INSERT |
| **UPDATE_ROWS** | UPDATE 语句 | UPDATE |
| **DELETE_ROWS** | DELETE 语句 | DELETE |
| **XID** | 事务提交标记 | TRANSACTIONEND |

一条典型的数据变更流程：

```
BEGIN
  └── TABLE_MAP (记录表结构)
  └── WRITE_ROWS / UPDATE_ROWS / DELETE_ROWS (记录数据变化)
XID (标记事务结束)
```

---

## Canal 的工作模式

Canal 支持两种工作模式：

### 模式一：直连模式

Client 直接连接 Server，适用于单实例场景：

```
MySQL → Canal Server → Canal Client → 应用
```

### 模式二：集群模式

Canal Server 部署成集群，Client 通过 Zookeeper/Nacos 做服务发现，实现高可用：

```
MySQL → Canal Server 集群 → Canal Client → 应用
         ↑  Zookeeper/Nacos 做协调
```

---

## 为什么不用轮询？

回到开头的问题：为什么不用轮询数据库？

**轮询的代价：**

- 每秒 N 次查询，数据库 CPU 飙升
- 99.99% 的查询都是「什么都没发生」
- 数据变更到感知到变更之间，有时间延迟

**Canal 的优势：**

- 零轮询，不浪费数据库资源
- 实时推送，延迟低（毫秒级）
- 只需开启 binlog，无需改业务代码

**但 Canal 也有代价：**

- MySQL 需要开启 binlog，有额外的磁盘 IO
- 网络传输 binlog 数据，有带宽成本
- 需要部署和维护 Canal 服务

这是一场 trade-off——如果你需要实时同步数据、监控变更，Canal 是值得的。

---

## 写在最后

Canal 的设计精髓在于「借力打力」——不侵入业务代码，不增加数据库负担，利用 MySQL 自身的复制机制完成数据变更的实时感知。

**留给你的问题：**

MySQL binlog 是顺序写入的，Canal 也是顺序接收的。但在实际业务中，消费端可能处理不过来——这时候该怎么办？

Canal 提供了两种解决方案：**Message ID 定位**和 **时间戳定位**。你更倾向于哪种？为什么？

下一节，我们来聊聊 [Canal 订阅模式与增量同步配置](/middleware/canal/subscribe)。
