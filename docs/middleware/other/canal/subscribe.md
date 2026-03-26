# Canal 订阅模式与增量同步配置

上一节我们聊了 Canal 的核心原理——伪装成 MySQL Slave 接收 binlog。

但光有原理不够，你得知道怎么用起来：**怎么配置 Canal？怎么订阅我想监听的表？怎么处理增量数据？**

这一节，全是实操。

---

## MySQL 端配置

Canal 的前提是 MySQL 必须开启 binlog。如果没开，一切都是空谈。

### 开启 binlog

在 MySQL 配置文件 `my.cnf` 中添加：

```ini
[mysqld]
# 开启 binlog
log-bin=mysql-bin
# binlog 格式，强烈建议用 ROW
binlog-format=ROW
# server id 必须唯一，Canal 用这个 ID 标识自己
server-id=1
# binlog 过期时间（天）
expire_logs_days=7
```

修改完成后，重启 MySQL 使配置生效：

```sql
-- 验证 binlog 是否开启
SHOW VARIABLES LIKE 'log_bin';
SHOW VARIABLES LIKE 'binlog_format';
SHOW VARIABLES LIKE 'server_id';
```

**重要：Canal 的 server-id 必须和 MySQL 中已有的 server-id 不冲突。** 如果有多台 Canal 实例，每台的 server-id 都要不同。

### 创建 Canal 专用账户

不要用 root 账户做 Canal 同步，这是基本的安全规范：

```sql
-- 创建专用账户
CREATE USER 'canal'@'%' IDENTIFIED BY 'canal_password';

-- 授予 REPLICATION 权限
GRANT SELECT, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'canal'@'%';

-- 刷新权限
FLUSH PRIVILEGES;
```

---

## Canal Server 安装与配置

### 下载与解压

```bash
# 下载 Canal（以 1.1.5 版本为例）
wget https://github.com/alibaba/canal/releases/download/canal-1.1.5/canal.deployer-1.1.5.tar.gz

# 解压
mkdir /opt/canal
tar -zxvf canal.deployer-1.1.5.tar.gz -C /opt/canal
```

### 配置 instance

Canal 通过 `conf/` 目录管理实例配置。每个实例对应一个 MySQL 源：

```
canal
├── conf
│   ├── canal.properties    # Canal Server 全局配置
│   ├── instance.properties # 单实例配置（deprecated，保留兼容）
│   └── example
│       └── instance.properties  # example 实例配置
```

最常用的方式是每个 MySQL 源一个独立的 instance 目录：

```
conf/
└── mysql订单库/      # 自定义实例名
    └── instance.properties
```

### instance.properties 配置

```properties
# MySQL 连接信息
canal.instance.master.address=127.0.0.1:3306
canal.instance.master.journal.name=
canal.instance.master.position=
canal.instance.master.timestamp=

# 专用账户（刚才创建的）
canal.instance.dbUsername=canal
canal.instance.dbPassword=canal_password

# 字符集
canal.instance.connectionCharset=UTF-8

# 过滤规则（正则表达式）
# 监听所有表：.*\\..*
# 只监听某个库：test\\..*
# 只监听某张表：test\\.user
canal.instance.filter.regex=.*\\..*

# 如果用 Gtid 模式
canal.instance.gtidon=false
```

### 启动 Canal Server

```bash
# 启动
./bin/startup.sh

# 查看日志
tail -f logs/canal/canal.log
tail -f logs/example/example.log
```

---

## 订阅模式：精准定位你想监听的数据

Canal 支持三种订阅模式，决定了「从哪个位置开始读取 binlog」。

### 模式一：按 GTID 订阅

GTID（Global Transaction Identifier）是 MySQL 5.6+ 引入的特性，每个事务都有唯一 ID。

**优势：**

- 切换主从时，无需关心 position 坐标
- 事务 ID 连续，不易丢数据

```properties
canal.instance.gtidon=true
# 指定 GTID 订阅位置
canal.instance.gtid.missing.node=
```

**适用场景：** MySQL 5.6+ 且开启了 GTID 模式。

### 模式二：按 position 订阅

position 是 binlog 文件名 + 偏移量，经典方式：

```properties
# 指定从哪个 binlog 文件开始
canal.instance.master.journal.name=mysql-bin.000001
# 指定从哪个位置开始
canal.instance.master.position=12345
# 指定时间戳（优先级低于 position）
canal.instance.master.timestamp=
```

**适用场景：** MySQL 5.5 或不想用 GTID 的场景。

### 模式三：动态订阅（推荐）

Canal 支持从当前最新位置开始订阅，无需手动指定：

```properties
# 不指定 journal.name 和 position，Canal 会从最新位置开始
canal.instance.master.journal.name=
canal.instance.master.position=
```

**这是最常用的方式。** 新部署的 Canal，从现在开始监听即可。

---

## 表过滤规则

不是所有表的变更都需要监听，Canal 提供了强大的过滤规则。

### 过滤语法

```properties
# 语法格式：database.table
# 支持正则表达式

# 监听所有表
canal.instance.filter.regex=.*\\..*

# 监听某个库的所有表
canal.instance.filter.regex=mydb\\..*

# 监听某张具体表
canal.instance.filter.regex=mydb\\.user

# 监听多张表（逗号分隔）
canal.instance.filter.regex=mydb\\.user,mydb\\.order

# 监听多张表（支持模糊匹配）
canal.instance.filter.regex=mydb\\.user,mydb\\.order.*
```

### 黑名单排除

除了白名单（regex），还支持黑名单（black）：

```properties
# 先匹配 regex，再排除 black
canal.instance.filter.black.regex=mydb\\.internal_table
```

**过滤规则的匹配顺序：** 先检查是否在黑名单中，再检查是否匹配白名单。

---

## Client 端消费：处理增量数据

Canal Server 收到 binlog 后，需要 Client 来消费。来看一个完整的 Java Client 示例。

### Maven 依赖

```xml
<dependency>
 <groupId>com.alibaba.otter</groupId>
 <artifactId>canal.client</artifactId>
 <version>1.1.5</version>
</dependency>
```

### 完整消费示例

```java
public class CanalClient {
 public static void main(String[] args) {
 // 1. 创建连接
 CanalConnector connector = CanalConnectors.newSingleConnector(
 new InetSocketAddress("127.0.0.1", 11111),
 "example",      // instance 名称
 "canal",        // username
 "canal"         // password
 );

 int batchSize = 1000;
 long batchId = -1;

 try {
 connector.connect();
 // 2. 订阅表（支持正则）
 connector.subscribe("mydb\\..*");
 // 不订阅任何表
 // connector.unsubscribe();

 while (true) {
 // 3. 拉取消息（带超时）
 Message message = connector.getWithoutAck(batchSize);
 batchId = message.getId();
 List&lt;Entry&gt; entries = message.getEntries();

 if (entries.size() == 0) {
 // 没有新数据，休息一下
 try {
 Thread.sleep(1000);
 } catch (InterruptedException e) {
 e.printStackTrace();
 }
 } else {
 // 4. 处理每条消息
 for (Entry entry : entries) {
 handleEntry(entry);
 }
 // 5. 确认消费
 connector.ack(batchId);
 }
 }
 } catch (Exception e) {
 e.printStackTrace();
 } finally {
 connector.disconnect();
 }
 }

 private static void handleEntry(Entry entry) {
 // 解析表结构信息
 TableChange tableChange = entry.getStoreValue();
 TableMeta表 meta = tableChange.getTableMeta();
 String schemaName = meta.getSchemaName();
 String tableName = meta.getTableName();

 // 遍历行数据变更
 for (RowChange rowChange : entry.getRowChangesList()) {
 EventType eventType = rowChange.getEventType();
 long timestamp = rowChange.getExecutionTime();

 System.out.println(schemaName + "." + tableName
 + " >>> " + eventType + ", timestamp=" + timestamp);

 for (RowData rowData : rowChange.getRowDatasList()) {
 // 根据事件类型处理
 switch (eventType) {
 case INSERT:
 // 新增：rowData.getAfterColumnsList() 是新数据
 handleInsert(rowData.getAfterColumnsList());
 break;
 case UPDATE:
 // 更新：rowData.getBeforeColumnsList() 是旧数据
 // rowData.getAfterColumnsList() 是新数据
 handleUpdate(rowData.getBeforeColumnsList(),
 rowData.getAfterColumnsList());
 break;
 case DELETE:
 // 删除：rowData.getBeforeColumnsList() 是被删除的数据
 handleDelete(rowData.getBeforeColumnsList());
 break;
 default:
 break;
 }
 }
 }
 }

 private static void handleInsert(List&lt;Column&gt; columns) {
 // 打印新插入的数据
 columns.forEach(col ->
 System.out.println(col.getName() + "=" + col.getValue()));
 }
}
```

---

## 增量同步的常见问题

### 问题一：消费延迟

**现象：** binlog 产生很久之后，Client 才收到消息。

**排查方向：**

- Canal Server 是否资源不足（CPU/内存）？
- Client 消费逻辑是否太慢？
- 网络是否有瓶颈？

**解决方案：**

```java
// 提高批量大小，减少网络往返
int batchSize = 5000;

// 多线程并行处理（注意幂等性）
ExecutorService executor = Executors.newFixedThreadPool(10);
```

### 问题二：消息丢失

**现象：** 确认消费后重启，数据重复了。

**问题分析：** 确认时机不对。ACK 应该在数据真正处理完成后发送，而不是收到数据就 ACK。

**正确做法：**

```java
try {
 // 业务处理
 processData(message);

 // 处理成功后再 ACK
 connector.ack(batchId);
} catch (Exception e) {
 // 处理失败，不 ACK（消息会重发）
 connector.rollback(batchId);
}
```

### 问题三：DDL 变更处理

**现象：** 表结构变了，Client 解析失败。

**Canal 处理 DDL 的方式：**

```java
if (rowChange.getEventType() == EventType.ALTER) {
 // 处理 DDL 语句
 String ddlSql = rowChange.getSql();
 System.out.println("DDL: " + ddlSql);
 // 更新本地表结构缓存
 updateLocalSchema(ddlSql);
}
```

**建议：** DDL 和 DML 分开处理。DDL 更新本地 schema，DML 处理数据变更。

---

## 生产环境配置建议

| 配置项 | 推荐值 | 说明 |
|-------|-------|-----|
| `canal.instance.memory.buffer.size` | 8192 | 内存缓冲区大小，越大性能越好 |
| `canal.instance.transaction.size` | 1024 | 事务合并大小，大事务拆分成小批次 |
| `canal.instance.filter.regex` | 按需配置 | 不要监听不必要的表 |
| `canal.instance.network.soTimeout` | 60000 | 网络超时时间（毫秒） |

---

## 写在最后

订阅模式决定了 Canal 从哪里开始监听，过滤规则决定了监听哪些表，Client 消费逻辑决定了拿到数据后怎么用。

**三者的配合，是 Canal 使用的核心。**

**留给你的问题：**

如果 Canal 挂了，重启后从哪个位置继续消费？如果要支持断点续传，你会怎么设计？

答案和 Canal 的 position 持久化机制有关。下一节，我们来聊聊 [Canal 集群部署与高可用](/middleware/canal/ha)。
