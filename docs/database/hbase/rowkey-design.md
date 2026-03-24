# HBase RowKey 设计：数据访问的核心

HBase 只有一个索引：RowKey。

没有设计好 RowKey，就像在图书馆里找不到书一样——书再多也没用。

---

## RowKey 是什么？

RowKey 是每行数据的唯一标识，类比 MySQL 的主键：

```
RowKey: user_12345
       ↓
┌─────────────────────────────────────────────────────────────┐
│ info:name = "张三"                                          │
│ info:age = 25                                              │
│ info:email = "zhang@xx.com"                               │
└─────────────────────────────────────────────────────────────┘
```

**RowKey 的特点**：

- 按字典序排序（Lexicographic Order）
- 最大长度 64KB，建议不超过 16 字节
- 查询唯一路径：RowKey → Region → Store → HFile

---

## RowKey 设计原则

### 1. 散列原则：避免热点

**热点问题**：连续的 RowKey 导致所有写入打到同一个 Region。

```
错误示例：
RowKey = user_id (递增)
写入顺序: user_1, user_2, user_3, ...
         ↓
所有数据都写入 Region1（因为 RowKey 最近）

正确示例：
RowKey = MD5(user_id) + user_id
写入顺序: a3f2_user_1, 7b1c_user_2, 9d4e_user_3, ...
         ↓
数据分散到不同 Region
```

```java
// 哈希打散
public String hashRowKey(String userId) {
    String md5 = MD5(userId).substring(0, 8);
    return md5 + "_" + userId;
}
```

### 2. 唯一性原则

RowKey 必须唯一标识一行数据。

### 3. 长度原则

RowKey 越短越好，建议不超过 16 字节。

```
10 字节 RowKey：支持 1TB 数据
50 字节 RowKey：支持 10TB 数据（每次查询传输更多数据）
```

### 4. 查询优先级原则

把常用来查询的字段放在 RowKey 前缀。

---

## 常见 RowKey 设计模式

### 模式一：用户ID + 时间戳

适用场景：用户行为日志、消息系统

```java
// 格式：userId_timestamp
String rowKey = userId + "_" + timestamp;

// 优点：按用户查询快
// 缺点：用户数据可能集中在一个 Region
```

### 模式二：业务ID（天然散列）

适用场景：订单、商品等有唯一 ID 的实体

```java
// 直接用订单号
String rowKey = orderId;

// 优点：简单直接
// 缺点：如果 ID 递增，可能热点
```

### 模式三：组合字段

适用场景：需要多维度查询

```java
// 格式：region_category_productId
String rowKey = region + "_" + categoryId + "_" + productId;

// 优点：支持前缀匹配查询
// 缺点：字段顺序固定
```

### 模式四：哈希 + 业务字段

适用场景：避免热点 + 支持范围查询

```java
// 格式：MD5(region)_region_timestamp
String hash = MD5(region).substring(0, 4);
String rowKey = hash + "_" + region + "_" + timestamp;

// 支持按 region 范围查询：
// StartRow: MD5(region)_region_000000
// StopRow: MD5(region+1)_region+1_*
```

---

## 反范式设计

HBase 的 RowKey 设计常常打破关系型数据库的范式。

### 预聚合

把需要聚合计算的数据预先存储：

```java
// 场景：统计每个用户每天的登录次数

// 方案一：每次查询时聚合（慢）
// 每条登录记录一行，查询时 COUNT

// 方案二：预聚合（快）
// RowKey: userId_loginCount_20240315
// Value: 登录次数

public void incrementLoginCount(String userId, String date) {
    // 原子递增
    Table table = connection.getTable(TableName.valueOf("t_daily_stats"));
    byte[] rowKey = (userId + "_" + date).getBytes();

    Append append = new Append(rowKey);
    append.addColumn(Bytes.toBytes("stat"),
                     Bytes.toBytes("login_count"),
                     Bytes.toBytes("1"));
    table.append(append);
}
```

### 宽表设计

把关联数据冗余存储在同一行：

```java
// 场景：用户详情页需要展示用户信息 + 最近订单

// 反范式设计：把订单信息冗余到用户表
String rowKey = "user_" + userId;

// 同一行存储用户信息和最近 10 条订单摘要
Row:
  user:info:name = "张三"
  user:info:email = "zhang@xx.com"
  user:order_0 = "order_001:商品A:100元"
  user:order_1 = "order_002:商品B:200元"
  ...
  user:order_9 = "order_010:商品J:50元"

// 查询一次，获取所有需要的数据
```

---

## RowKey 设计案例

### 案例一：消息系统

```java
// 需求：
// 1. 按用户查询收到的消息
// 2. 按用户查询发送的消息
// 3. 支持分页

// 方案：两个表 or 反范式

// 表1：收件箱（按收件人分区）
// RowKey: receiverId_timestamp_senderId
// 查询：getMessagesByReceiver(userId, startTime, endTime)

// 表2：发件箱（按发件人分区）
// RowKey: senderId_timestamp_receiverId
// 查询：getMessagesBySender(userId, startTime, endTime)

// 或者：一个表，通过列族区分收/发
// RowKey: receiverId_timestamp
// inbox:msg:xxx = 消息内容
// outbox:msg:xxx = 消息内容
```

### 案例二：监控系统

```java
// 需求：
// 1. 按主机查询指标
// 2. 按指标类型查询
// 3. 按时间范围查询

// 方案：两层 RowKey

// 方案A：按主机索引
// RowKey: host_timestamp_metric
// 查询：getMetricsByHost(host, startTime, endTime)

// 方案B：按指标索引
// RowKey: metric_host_timestamp
// 查询：getMetricsByType(metric, startTime, endTime)

// 方案C：时间桶（预分区）
// RowKey: bucketID_host_metric
// bucketID = timestamp / (15分钟)
// 自动按时间分区，避免热点
```

### 案例三：社交 Feed 系统

```java
// 需求：获取用户的朋友圈最新动态

// 方案：Push 模式
// 当用户发消息时，主动写入所有好友的时间线

public void postMessage(String userId, String content) {
    // 1. 写入发件箱
    String outboxRowKey = outboxRowKey(userId, timestamp);
    table.put(buildOutboxPut(outboxRowKey, content));

    // 2. 写入所有好友的时间线
    List&lt;String&gt; friends = getFriends(userId);
    for (String friendId : friends) {
        String feedRowKey = feedRowKey(friendId, timestamp);
        table.put(buildFeedPut(feedRowKey, userId, content));
    }
}

// 查询用户时间线：直接 scan 用户的时间线表
public List&lt;Feed&gt; getUserFeed(String userId, int limit) {
    Scan scan = new Scan();
    scan.withStartRow(feedRowKey(userId, Long.MAX_VALUE));
    scan.setLimit(limit);
    // ...
}
```

---

## Java RowKey 工具类

```java
public class RowKeyUtil {

    // MD5 哈希打散
    public static String hash(String id) {
        return MD5(id).substring(0, 8);
    }

    // 组合字段
    public static String combine(String... parts) {
        return String.join("_", parts);
    }

    // 时间戳转字节（固定长度）
    public static byte[] timestampBytes(long timestamp) {
        return Bytes.toBytes(Long.MAX_VALUE - timestamp);
    }

    // 解析组合 RowKey
    public static String[] parse(String rowKey, String separator) {
        return rowKey.split(separator);
    }

    // 生成监控指标 RowKey（按主机+时间桶）
    public static String metricRowKey(String host, long timestamp, String metric) {
        int bucket = (int) (timestamp / (15 * 60 * 1000));  // 15分钟桶
        return combine(
            hash(host),
            host,
            String.format("%010d", bucket),
            metric
        );
    }

    // 生成消息 RowKey（收件箱）
    public static String inboxRowKey(String receiverId, long timestamp, String senderId) {
        return combine(receiverId,
                      String.format("%013d", Long.MAX_VALUE - timestamp),
                      senderId);
    }
}
```

---

## 面试追问方向

- HBase 的热点问题是怎么产生的？如何解决？
- 为什么建议 RowKey 不要超过 16 字节？

下一节，我们来了解 HBase 的 CAP 特性。
