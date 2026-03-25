# Canal vs Maxwell vs Debezium 对比

做数据同步，Canal 不是唯一的选择。

Maxwell 和 Debezium 是两个主要的竞品，它们各有特点，适用于不同的场景。

怎么选？我们来掰开了聊。

---

## 三者概览

| 工具 | 开发语言 | 消息格式 | 配置复杂度 | 社区活跃度 |
|-----|---------|---------|----------|-----------|
| **Canal** | Java | JSON/Protobuf | 中等 | 阿里维护，社区一般 |
| **Maxwell** | Java | JSON | 简单 | 已停止维护（Databank 接手） |
| **Debezium** | Java | JSON/Avro | 较复杂 | 红帽支持，非常活跃 |

---

## 核心原理对比

### Canal：伪装 MySQL Slave

```
MySQL Master ──binlog──▶ Canal Server ──JSON──▶ 下游
```

Canal 模拟 MySQL Slave 协议，发送 `COM_BINLOG_DUMP` 命令接收 binlog。

**特点：**

- 纯 Java 实现，对 Java 生态友好
- 需要额外部署 Server 端
- 支持集群模式（Zookeeper 协调）

### Maxwell：伪装 MySQL Slave + 内嵌 HTTP Server

```
MySQL Master ──binlog──▶ Maxwell ──JSON──▶ Kafka/RabbitMQ
```

Maxwell 把 binlog 解析和消息发送集成在一个进程中，更轻量。

**特点：**

- 单进程运行，部署简单
- 消息直接发送到 Kafka/RabbitMQ
- 支持断点续传（通过 ZooKeeper 或 Kafka 存储 position）

### Debezium：基于 CDC（Change Data Capture）

```
MySQL ──binlog──▶ Debezium Server ──▶ Kafka ──▶ 下游
```

Debezium 是更通用的 CDC 框架，不仅支持 MySQL，还支持 PostgreSQL、MongoDB、SQL Server、Oracle 等。

**特点：**

- Kafka Connect 插件形式部署
- 支持多种数据库
- 与 Kafka 生态深度集成
- 支持 Schema Registry

---

## 功能对比

### 数据捕获能力

| 能力 | Canal | Maxwell | Debezium |
|-----|-------|---------|----------|
| **MySQL binlog** | ✅ | ✅ | ✅ |
| **PostgreSQL WAL** | ❌ | ❌ | ✅ |
| **MongoDB oplog** | ❌ | ❌ | ✅ |
| **SQL Server CDC** | ❌ | ❌ | ✅ |
| **Oracle** | ❌ | ❌ | ✅（商业版） |

### 消息格式

**Canal：**

```json
{
 "data": [{"id": "1", "name": "张三"}],
 "database": "shop",
 "table": "user",
 "type": "INSERT",
 "ts": 1678901234,
 "sql": "",
 "pkNames": ["id"]
}
```

**Maxwell：**

```json
{
 "database": "shop",
 "table": "user",
 "type": "insert",
 "data": {"id": 1, "name": "张三"},
 "ts": 1678901234,
 "xid": 12345,
 "commit": true
}
```

**Debezium：**

```json
{
 "before": null,
 "after": {"id": 1, "name": "张三"},
 "source": {
 "version": "1.9.0",
 "connector": "mysql",
 "name": "mysql-server",
 "ts_ms": 1678901234,
 "db": "shop",
 "table": "user"
 },
 "op": "c",  // c=create, u=update, d=delete, r=snapshot
 "ts_ms": 1678901234
}
```

**对比：** Debezium 的消息格式最规范，包含 `before` 和 `after`，方便做变更对比；Canal 和 Maxwell 的格式更简洁。

### 消息顺序保证

| 工具 | 顺序保证 | 说明 |
|-----|---------|------|
| **Canal** | 单分区有序 | 同一个表的变更有序 |
| **Maxwell** | 单分区有序 | 通过 maxwell.inserted_at 排序 |
| **Debezium** | 单分区有序 | 同一表 + 同一分区内有序 |

---

## 配置复杂度对比

### Canal 配置

需要三个部分：

1. MySQL 开启 binlog + 创建专用账户
2. Canal Server 部署 + 配置 instance
3. Client 端编写代码消费

```properties
# instance.properties（Canal）
canal.instance.master.address=127.0.0.1:3306
canal.instance.dbUsername=canal
canal.instance.dbPassword=canal_password
canal.instance.filter.regex=.*\\..*
```

### Maxwell 配置

单一进程，配置更简单：

```properties
# config.properties（Maxwell）
host=127.0.0.1
user=maxwell
password=maxwell_password
producer=kafka
kafka.bootstrap.servers=kafka:9092
kafka_topic=binlog_shop
```

### Debezium 配置

作为 Kafka Connect 插件运行，配置稍复杂：

```json
{
 "name": "mysql-connector",
 "config": {
 "connector.class": "io.debezium.connector.mysql.MySqlConnector",
 "tasks.max": "1",
 "database.hostname": "127.0.0.1",
 "database.port": "3306",
 "database.user": "debezium",
 "database.password": "debezium_password",
 "database.server.id": "184054",
 "topic.prefix": "mysql",
 "database.include.list": "shop",
 "schema.history.internal.kafka.bootstrap.servers": "kafka:9092",
 "schema.history.internal.kafka.topic": "schema-changes"
 }
}
```

---

## 高可用对比

| 特性 | Canal | Maxwell | Debezium |
|-----|-------|---------|----------|
| **集群模式** | ✅ Zookeeper | ✅ Kafka 存储 position | ✅ Kafka Connect |
| **故障恢复** | 自动切换 | 自动恢复 | 自动恢复 |
| **Schema 变更** | 支持 | 支持 | 支持（Schema History） |
| **GTID 支持** | ✅ | ❌ | ✅ |

**Debezium 的 Schema History 特性：**

Debezium 会把表结构变更记录到 Kafka Topic，保证 Consumer 能正确解析历史消息。这是 Canal 和 Maxwell 相对薄弱的地方。

---

## 性能对比

| 指标 | Canal | Maxwell | Debezium |
|-----|-------|---------|----------|
| **吞吐量** | 高 | 中等 | 高 |
| **延迟** | 低（毫秒级） | 低（毫秒级） | 低（毫秒级） |
| **资源占用** | 中等 | 较低 | 较高 |

**实测参考（单机，1 万 QPS 写入）：**

- Canal：CPU 占用 15-20%
- Maxwell：CPU 占用 10-15%
- Debezium：CPU 占用 20-25%（包含 Schema Registry）

---

## 选型指南

### 选择 Canal 的场景

1. **Java 技术栈为主**：Canal 是 Java 实现，与 Spring Boot 集成方便
2. **需要自建 Server**：不想依赖 Kafka Connect
3. **对 MySQL 有深度定制需求**：Canal 源码可定制

**Canal 的局限：** 只支持 MySQL，社区活跃度下降。

### 选择 Maxwell 的场景

1. **轻量级场景**：不想部署额外的 Server
2. **直接发 Kafka/RabbitMQ**：Maxwell 原生支持多种消息队列
3. **快速原型**：配置简单，能快速验证 CDC 方案

**Maxwell 的局限：** 已停止维护，选择需谨慎。

### 选择 Debezium 的场景

1. **多数据库支持**：不仅 MySQL，还有 PostgreSQL、MongoDB 等
2. **Kafka 生态深度集成**：使用 Kafka Connect 统一管理
3. **Schema 变更频繁**：Schema History 是刚需
4. **长期维护**：Debezium 由 Red Hat 支持，社区活跃

**Debezium 的局限：** 配置复杂，学习成本较高。

---

## 代码复杂度对比

### Canal Client

```java
CanalConnector connector = CanalConnectors.newSingleConnector(
 new InetSocketAddress("127.0.0.1", 11111), "example", "", "");
connector.connect();
connector.subscribe(".*\\..*");
while (true) {
 Message message = connector.getWithoutAck(1000);
 for (Entry entry : message.getEntries()) {
 printEntry(entry);
 }
 connector.ack(message.getId());
}
```

### Maxwell Client（通过 Kafka 消费）

```java
// Maxwell 直接发 Kafka，消费端就是普通 Kafka Consumer
KafkaConsumer&lt;String, String&gt; consumer = new KafkaConsumer&lt;&gt;(props);
consumer.subscribe(Collections.singletonList("binlog_shop"));
while (true) {
 ConsumerRecords&lt;String, String&gt; records = consumer.poll(Duration.ofMillis(1000));
 for (ConsumerRecord&lt;String, String&gt; record) {
 String json = record.value();
 // 解析 Maxwell JSON
 }
}
```

### Debezium Client（通过 Kafka 消费）

```java
// Debezium 直接发 Kafka，消费端也是普通 Kafka Consumer
// 但 Debezium 的消息格式更规范
KafkaConsumer&lt;String, JsonNode&gt; consumer = new KafkaConsumer&lt;&gt;(props);
consumer.subscribe(Collections.singletonList("mysql.mysql-server.shop.user"));
while (true) {
 ConsumerRecords&lt;String, JsonNode&gt; records = consumer.poll(Duration.ofMillis(1000));
 for (ConsumerRecord&lt;String, JsonNode&gt; record) {
 JsonNode payload = record.value();
 String op = payload.get("op").asText();  // c, u, d, r
 JsonNode before = payload.get("before");
 JsonNode after = payload.get("after");
 }
}
```

**对比：** Canal 需要写 Server-Client 代码；Maxwell 和 Debezium 只需消费 Kafka 消息。

---

## 维护状态对比

| 工具 | 最后更新时间 | 维护方 | 风险 |
|-----|------------|--------|-----|
| **Canal** | 2023 | 阿里巴巴 | 低（企业维护） |
| **Maxwell** | 2019（停止），2022（Databank 接手） | Zendesk → Databank | 中（社区接管，功能待发展） |
| **Debezium** | 持续更新 | Red Hat | 低（活跃社区） |

---

## 最终选型建议

```
                    ┌─────────────────────────────┐
                    │        数据同步工具选型        │
                    └─────────────┬───────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
              ▼                   ▼                   ▼
        只 MySQL？           需要轻量？           多数据库？
              │                   │                   │
       ┌──────┴──────┐            │            ┌──────┴──────┐
       ▼             ▼            ▼            ▼             ▼
   Java 技术栈    其他语言      快速验证      Kafka 生态    Schema 变更多
       │             │            │            │             │
       ▼             ▼            ▼            ▼             ▼
    Canal        Maxwell      Maxwell      Debezium       Debezium
   (推荐)        (谨慎)                     (推荐)
```

**总结：**

- **Canal**：Java 生态、MySQL 为主、需要 Canal Server 管理能力
- **Maxwell**：轻量、快速原型（注意维护状态）
- **Debezium**：多数据库、Kafka 生态、长期项目

---

## 面试高频问题

**Q1：为什么选 Canal 而不是 Debezium？**

核心差异在于「生态」和「场景」：

- 如果你只用 MySQL，且项目是 Java 技术栈，Canal 足够
- 如果你需要多数据库支持，或深度集成 Kafka，Debezium 更合适
- 如果你在选型阶段，**更推荐 Debezium**——社区活跃，功能全面

**Q2：Canal 的缺点是什么？**

1. 只支持 MySQL（Canal 4.x 开始支持 ClickHouse、PolarDB 等）
2. 社区活跃度下降
3. 配置相对复杂
4. Schema 变更处理不如 Debezium 完善

**Q3：Maxwell 停止维护了，还能用吗？**

能用，但不推荐新项目使用。如果已经在用，问题不大；如果要从零开始，建议考虑 Canal 或 Debezium。

---

## 写在最后

工具选型没有绝对的对错，只有「适不适合」。

Canal、Maxwell、Debezium 都能完成 CDC 的任务，区别在于：

- **Canal**：MySQL + Java + 自建 Server
- **Maxwell**：轻量 + 直接发 Kafka（注意维护状态）
- **Debezium**：多数据库 + Kafka 生态 + 长期项目

**留给你的问题：**

假设你正在做一个数据中台项目，需要从 MySQL、PostgreSQL、MongoDB 三种数据库实时同步数据到 ES 和 Kafka。你会怎么选择？

答案涉及多数据库支持、Kafka 集成复杂度、团队技术栈等多个因素。好好想想，下一个项目就是你做选型。
