# Canal 集群部署与高可用

单实例的 Canal 能不能用于生产？

**能，但不能用于核心业务。**

Canal Server 挂了，binlog 消费就断了；Canal Client 挂了，数据同步就停了。

这一节，我们来聊聊 Canal 的高可用方案——怎么做到「挂了也能跑」。

---

## Canal 高可用原理

Canal 的高可用基于一个简单思想：**多实例 + 服务发现**。

```
┌─────────────┐     ┌─────────────┐
│  Zookeeper  │     │  Zookeeper  │
│   节点 1    │     │   节点 2    │
└──────┬──────┘     └──────┬──────┘
       │                   │
       └────────┬──────────┘
                │
       ┌────────▼────────┐
       │  Canal Server 1  │
       │    (Running)     │──▶ 消费数据
       └──────────────────┘
                │
       ┌────────▼────────┐
       │  Canal Server 2  │
       │   (Standby)      │
       └──────────────────┘
                │
       ┌────────▼────────┐
       │  Canal Server 3  │
       │   (Standby)      │
       └──────────────────┘
```

**核心机制：**

1. 多个 Canal Server 实例注册到 Zookeeper
2. 每个 Server 持有不同的 position（互不冲突）
3. Client 通过 Zookeeper 发现当前可用的 Server
4. 某个 Server 挂了，Client 自动切换到其他 Server

---

## 架构组件

Canal 高可用集群由以下组件组成：

| 组件 | 作用 | 数量 |
|-----|------|-----|
| MySQL Master | binlog 来源 | 1+ |
| Canal Server | 接收并解析 binlog | 2+ |
| Zookeeper | 服务注册与选举 | 3+ (奇数) |
| Canal Client | 消费解析后的数据 | N |

**Zookeeper 为什么要是奇数？**

Zookeeper 需要过半机制才能正常工作。奇数节点比偶数节点更节省资源——3 节点和 4 节点的容错能力相同，但 3 节点更便宜。

---

## Zookeeper 集群部署

### 安装 Zookeeper

```bash
# 下载
wget https://archive.apache.org/dist/zookeeper/zookeeper-3.7.0/apache-zookeeper-3.7.0-bin.tar.gz
tar -zxvf apache-zookeeper-3.7.0-bin.tar.gz -C /opt/
```

### 配置 zoo.cfg

```properties
# 每个节点的 zoo.cfg
tickTime=2000
initLimit=10
syncLimit=5
dataDir=/opt/zookeeper/data
clientPort=2181

# 集群节点
server.1=zk-node1:2888:3888
server.2=zk-node2:2888:3888
server.3=zk-node3:2888:3888
```

### 创建 myid 文件

在 dataDir 目录下，每个节点创建 `myid` 文件：

```bash
# zk-node1 上
echo 1 > /opt/zookeeper/data/myid

# zk-node2 上
echo 2 > /opt/zookeeper/data/myid

# zk-node3 上
echo 3 > /opt/zookeeper/data/myid
```

### 启动 Zookeeper

```bash
# 三台机器分别启动
/opt/zookeeper/bin/zkServer.sh start
/opt/zookeeper/bin/zkServer.sh status
```

---

## Canal Server 集群配置

### canal.properties 核心配置

```properties
# 集群模式：使用 Zookeeper 做协调
canal.serverMode=zookeeper

# Zookeeper 地址
canal.zkServers=zk-node1:2181,zk-node2:2181,zk-node3:2181

# canal server 的 netty 参数
canal.remoting.nettyAcceptSize=128
canal.remoting.nettyWorkerSize=0  # 0 = CPU 核数

# 默认的 instance 数量限制
canal.instance.global.spring.xmls=classpath:spring/*.xml

# admin 管理端口
canal.admin.manager=127.0.0.1:8309
```

### instance.properties 配置

```properties
# MySQL 连接
canal.instance.master.address=127.0.0.1:3306
canal.instance.master.journal.name=
canal.instance.master.position=

# 账户
canal.instance.dbUsername=canal
canal.instance.dbPassword=canal_password

# Zookeeper 中的节点命名
canal.instance.magic=100  # 唯一标识，同一 Server 上的不同 instance 要不同

# 持久化 position 到 Zookeeper
canal.instance.global.spring.xmls=classpath:spring/default-instance.xml
```

### 启动集群

```bash
# 在每个 Canal Server 节点上执行
./bin/startup.sh

# 查看日志
tail -f logs/canal/canal.log
```

---

## Client HA 模式

Canal Client 连接到集群时，需要使用 HA 模式连接器：

```java
public class CanalClientHA {
 public static void main(String[] args) {
 // HA 模式：连接 Zookeeper，自动发现可用的 Server
 // 不再使用 SingleConnector，而是用 ClusterConnector
 ClusterCanalConnector connector = CanalConnectors.newClusterConnector(
 "zk-node1:2181,zk-node2:2181,zk-node3:2181",  // Zookeeper 地址
 "example",           // destination（对应 Server 上的 instance 名）
 "canal",             // username
 "canal"              // password
 );

 try {
 connector.connect();
 connector.subscribe(".*\\..*");

 while (true) {
 Message message = connector.getWithoutAck(1000);
 if (message.getId() != -1) {
 List&lt;Entry&gt; entries = message.getEntries();
 if (entries.size() > 0) {
 entries.forEach(entry -> {
 // 处理 entry
 System.out.println(entry.getHeader());
 });
 }
 connector.ack(message.getId());
 }

 // 模拟处理耗时
 Thread.sleep(1000);
 }
 } catch (Exception e) {
 e.printStackTrace();
 } finally {
 connector.disconnect();
 }
 }
}
```

**HA 模式的自动切换机制：**

```
1. Client 启动时，从 Zookeeper 获取当前可用的 Server 列表
2. 尝试连接第一个 Server，如果连不上，尝试下一个
3. 连接成功后，订阅该 Server
4. 定期从 Zookeeper 感知 Server 变化
5. 如果当前 Server 挂了，Zookeeper 会通知 Client
6. Client 自动切换到其他可用的 Server
```

---

## Position 持久化与恢复

Canal 的 position（消费进度）是关键状态，必须持久化才能实现 HA。

### Position 存储位置

| 存储方式 | 配置项 | 说明 |
|---------|-------|-----|
| Zookeeper（推荐） | `canal.instance.storage.position.zk` | 集群模式下推荐 |
| MySQL | `canal.instance.storage.position.mysql` | 简单场景 |
| HDFS | `canal.instance.storage.position.hdfs` | 大数据场景 |

### Position 更新时机

```
时机一：Client ACK 时
时机二：Server 定期批量同步
时机三：Server 优雅关闭
```

**最佳实践：**

```java
// 不要每条消息都 ACK，批量 ACK 减少 Zookeeper 压力
int batchSize = 1000;
long batchId = -1;

while (true) {
 Message message = connector.getWithoutAck(batchSize);
 if (message.getEntries().size() >= batchSize) {
 // 达到批量大小时 ACK
 connector.ack(message.getId());
 }
}
```

### 故障恢复流程

```
1. Canal Server A 挂了
   └── Zookeeper 感知到 Server A 失联
       └── Server A 的 position 保留在 Zookeeper

2. Client 切换到 Server B
   └── Server B 从 Zookeeper 读取该 Client 的 position
       └── 从该 position 继续消费

3. 结论：数据不丢失，但可能有少量重复（取决于 ACK 时机）
```

---

## 常见 HA 问题

### 问题一：Zookeeper 选主抖动

**现象：** Zookeeper 网络抖动，导致 Canal Server 频繁切换。

**排查：**

```bash
# 检查 Zookeeper 日志
tail -f /opt/zookeeper/logs/zookeeper.out

# 检查网络延迟
ping zk-node1
```

**解决方案：**

- Zookeeper 节点间网络要稳定
- 适当调大 `tickTime` 和 `syncLimit`
- Canal Server 配置合理的重连参数

### 问题二：Position 冲突

**现象：** 多个 Client 消费同一批次数据。

**问题分析：** Canal 支持多 Client 并行消费，每个 Client 需要有不同的 `clientId`。

**正确配置：**

```java
// Client 1
CanalConnector connector1 = CanalConnectors.newClusterConnector(
 zkServers, "example", 100L, "canal", "canal");

// Client 2（clientId 不同）
CanalConnector connector2 = CanalConnectors.newClusterConnector(
 zkServers, "example", 101L, "canal", "canal");
```

**每个 Client 有独立的 position，互不干扰。**

### 问题三：DDL 期间位置丢失

**现象：** 表结构变更后，Client 消费位置错误。

**解决方案：**

```properties
# DDL 和 DML 分开处理
canal.instance.filter.ddl=true
canal.instance.filter.query.ddl=true
```

DDL 事件需要特殊处理，不要和 DML 混在一起。

---

## 生产环境部署架构

```
                    ┌──────────────────────────────────┐
                    │          用户业务系统              │
                    └───────────────┬──────────────────┘
                                    │
                    ┌───────────────▼──────────────────┐
                    │         Canal Client 集群          │
                    │   (多实例 + 负载均衡 + HA 切换)    │
                    └───────────────┬──────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
┌─────────▼─────────┐     ┌─────────▼─────────┐     ┌─────────▼─────────┐
│   Canal Server   │     │   Canal Server   │     │   Canal Server   │
│      节点 1       │     │      节点 2       │     │      节点 3       │
│  (Zookeeper 注册) │     │  (Zookeeper 注册) │     │  (Zookeeper 注册) │
└───────────────────┘     └───────────────────┘     └───────────────────┘
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────┐
                    │       Zookeeper 集群 (3节点)       │
                    │   (服务发现 + Position 存储)        │
                    └───────────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────────┐
                    │           MySQL Master            │
                    │         (binlog 来源)            │
                    └───────────────────────────────────┘
```

---

## 监控与运维

Canal 提供了 Admin API 用于监控：

```bash
# 查看 Server 状态
curl http://canal-server:8309/canal/admin/dev

# 查看 Instance 状态
curl http://canal-server:8309/canal/admin/instances

# 查看当前消费 lag
curl http://canal-server:8309/canal/admin/cluster
```

**关键监控指标：**

| 指标 | 含义 | 告警阈值 |
|-----|------|---------|
| `canal.receiver.lag` | binlog 接收延迟 | > 1 分钟 |
| `canal.parser.lag` | 解析延迟 | > 30 秒 |
| `canal.client.lag` | 消费延迟 | > 1 分钟 |

---

## 写在最后

Canal 的高可用，本质上是「状态共享 + 自动切换」——Position 存在 Zookeeper，Client 通过 Zookeeper 发现 Server，Server 挂了 Client 自动切换。

**但 HA 不是银弹。** 它解决的是「进程挂了怎么办」，但解决不了「MySQL 挂了怎么办」。如果 MySQL Master 不可用，你需要额外的方案（比如半同步复制、日志备份等）来保证 binlog 不丢失。

**留给你的问题：**

如果 MySQL 发生了主从切换（原来的 Master 变成 Slave），Canal 怎么自动感知并重新连接新的 Master？

这涉及到 MySQL GTID + Canal 自动切换机制，下一节我们来看 [Canal 应用场景：数据库实时同步、ES 索引更新、缓存更新](/middleware/canal/use-case)。
