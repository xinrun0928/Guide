# 跨机房数据同步方案：MySQL binlog + Canal + Kafka

MySQL 的主从同步，我们都知道。

但如果是从机房里同步数据到 ES、Redis、HBase 呢？

用主从复制？不合适。主从复制是 MySQL 内部的事，无法把数据同步到其他系统。

你需要的是——**CDC（Change Data Capture）**。

## 什么是 CDC

CDC 的核心思想是：**监听数据库的数据变更事件，把变更数据发送到下游系统。**

```
MySQL ──binlog──▶ Canal ──▶ Kafka ──▶ 消费者 ──▶ ES/Redis/HBase
```

数据同步链路：

1. MySQL 记录数据变更到 binlog
2. Canal 监听 binlog，解析变更事件
3. Canal 把事件发送到 Kafka
4. 消费者从 Kafka 消费事件，处理数据

## MySQL binlog

binlog 是 MySQL 的重做日志，记录了所有数据变更：

```sql
-- 查看 binlog 是否开启
SHOW VARIABLES LIKE 'log_bin';

-- 查看 binlog 文件列表
SHOW BINARY LOGS;

-- 查看 binlog 内容
SHOW BINLOG EVENTS IN 'binlog.000001';
```

binlog 有三种格式：

1. **Statement**：记录 SQL 语句
2. **Row**：记录数据行变更（推荐）
3. **Mixed**：混合模式

## Canal 的工作原理

Canal 是阿里开源的 MySQL binlog 增量订阅组件。

### 核心概念

- **Canal Server**：解析 binlog 的服务端
- **Canal Client**：消费 binlog 事件的客户端
- **Canal Adapter**：数据适配器，把 binlog 数据写入目标存储

```
MySQL ──▶ Canal Server ──▶ Canal Client ──▶ 业务处理
```

### Canal 安装配置

```yaml
# canal.properties
canal.destinations = example
server.id = 1

# instance.properties
canal.instance.master.address = 127.0.0.1:3306
canal.instance.dbUsername = canal
canal.instance.dbPassword = canal
canal.instance.filter.regex = .*\\..*
canal.mq.topic = binlog_data
```

### Canal Java Client

```java
public class CanalClient {

    private CanalConnector connector;

    public void subscribe(String filter) {
        connector.subscribe(filter);
    }

    public void process() {
        while (running) {
            Message message = connector.getWithoutAck(100);  // 获取 100 条消息

            for (Entry entry : message.getEntries()) {
                processEntry(entry);
            }

            connector.ack(message.getId());  // 确认
        }
    }

    private void processEntry(Entry entry) {
        RowChange rowChange = RowChange.parseFrom(entry.getStoreValue());

        for (RowData rowData : rowChange.getRowDatasList()) {
            if (rowChange.getEventType() == EventType.INSERT) {
                // 处理新增
                handleInsert(rowData);
            } else if (rowChange.getEventType() == EventType.UPDATE) {
                // 处理更新
                handleUpdate(rowData);
            } else if (rowChange.getEventType() == EventType.DELETE) {
                // 处理删除
                handleDelete(rowData);
            }
        }
    }
}
```

## Kafka 在数据同步中的角色

为什么要加 Kafka？

### Kafka 的优势

1. **解耦**：生产和消费分离，Canal 和消费者独立演进
2. **缓冲**：高峰期 Canal 生产的消息可以在 Kafka 中缓冲
3. **多消费者**：一条 binlog 消息可以同时发给多个消费者
4. **消息重放**：Kafka 保留消息历史，可以重新消费

### Kafka Topic 设计

```java
// Topic 命名规则
// {database}.{table}
// 例如：
// order.user       // 用户表
// order.product    // 商品表
// order.order_info // 订单表

// 按数据库和表名分区
public String getTopic(String schema, String table) {
    return schema + "." + table;
}
```

## 完整数据同步链路

```
MySQL ──binlog──▶ Canal Server ──▶ Kafka ──▶ 数据同步服务 ──▶ ES
                                              │
                                              └───────────────────▶ Redis
                                              │
                                              └───────────────────▶ HBase
                                              │
                                              └───────────────────▶ 另一个 MySQL
```

### 数据同步服务实现

```java
@Service
public class DataSyncService {

    @Autowired
    private ElasticsearchRestTemplate esTemplate;

    @Autowired
    private StringRedisTemplate redisTemplate;

    @Autowired
    private ProductMapper productMapper;

    public void syncToES(RowData rowData, EventType eventType) {
        Product product = convertToProduct(rowData);

        if (eventType == EventType.DELETE) {
            esTemplate.delete(product.getId().toString(), Product.class);
        } else {
            esTemplate.save(product);
        }
    }

    public void syncToRedis(RowData rowData, EventType eventType) {
        Product product = convertToProduct(rowData);
        String key = "product:" + product.getId();

        if (eventType == EventType.DELETE) {
            redisTemplate.delete(key);
        } else {
            redisTemplate.opsForValue().set(key, JSON.toJSONString(product));
        }
    }
}
```

## 数据同步的三大问题

### 1. 延迟

binlog 解析、Kafka 传输、消费者处理都需要时间。

解决方案：

- Canal 批量获取消息
- Kafka 分区并行消费
- 消费者多线程处理

### 2. 数据丢失

Canal 或 Kafka 故障导致消息丢失。

解决方案：

- Canal 开启 tcp 模式，保证消息不丢失
- Kafka 副本机制
- 消费者手动提交 offset

### 3. 数据重复

消费者处理失败导致重复消费。

解决方案：

- **幂等消费**：用唯一键判断是否已处理

```java
public void consume(Message message) {
    // 幂等处理：用主键判断是否已处理
    Product product = convertToProduct(message.getRowData());

    if (productMapper.exists(product.getId())) {
        productMapper.update(product);
    } else {
        productMapper.insert(product);
    }
}
```

## 面试追问方向

- binlog 的三种格式区别？（答：Statement 记录 SQL，Row 记录行变更，Mixed 混合）
- Canal 和 Debezium 区别？（答：Canal 只支持 MySQL，Debezium 支持多种数据库）
- 如何保证数据不丢失？（答：Canal 手动确认 + Kafka 副本 + 消费者手动 offset）
- 如何保证数据不重复？（答：幂等消费 + 唯一键判断）

## 小结

跨机房数据同步的核心链路：

1. **MySQL binlog**：数据变更的源头
2. **Canal**：解析 binlog 的组件
3. **Kafka**：消息中间件，解耦和缓冲
4. **消费者**：处理变更数据，写入目标系统

CDC 方案是现代数据架构的基础，它让数据流动起来，从数据库到搜索、从缓存到数据仓库。
