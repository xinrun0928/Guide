# HBase 应用场景：实战案例分析

HBase 不是万能的，但在合适的场景下，它是最优选择。

今天我们来看看 HBase 的典型应用场景。

---

## 一、时序数据存储

### 场景描述

物联网传感器每秒产生大量数据，需要实时写入和历史查询。

```
典型数据：
- 传感器 ID、测量值、时间戳
- 每秒 10 万条写入
- 历史数据保留 1 年
- 支持按设备、按时间范围查询
```

### 解决方案

```java
// RowKey 设计：设备ID + 时间戳反转
public class SensorDataRowKey {
    // 时间戳反转：新数据在前面
    public static String design(String sensorId, long timestamp) {
        long reversedTime = Long.MAX_VALUE - timestamp;
        return String.format("%s_%014d", sensorId, reversedTime);
    }

    // 查询最近 24 小时的数据
    public static Scan createRecentScan(String sensorId) {
        Scan scan = new Scan();
        long now = System.currentTimeMillis();
        long start = now - 24 * 3600 * 1000;

        scan.withStartRow(Bytes.toBytes(design(sensorId, start)));
        scan.withStopRow(Bytes.toBytes(design(sensorId, now + 1)));
        return scan;
    }
}

// 表设计
// 1. 表名：sensor_data
// 2. 列族：data(value, timestamp)
// 3. RowKey：sensorId + reversedTimestamp
```

### 性能指标

```
写入：10 万条/秒
查询：P99 < 10ms
存储：1 年数据 ~ 10TB
```

---

## 二、消息系统

### 场景描述

聊天应用需要存储用户消息，支持按会话查询。

```
典型数据：
- 发送方、接收方、内容、时间
- 每天 1 亿条消息
- 支持按用户、按时间范围查询
- 需要多版本（消息修改）
```

### 解决方案

```java
// RowKey 设计：接收方 + 时间戳 + 发送方
public class MessageRowKey {
    public static String design(String receiverId, long timestamp, String senderId) {
        // 接收方在前，支持按接收方查询
        // 时间戳反转，新消息在前
        // 发送方区分同一时间的消息
        long reversedTime = Long.MAX_VALUE - timestamp;
        return String.format("%s_%014d_%s", receiverId, reversedTime, senderId);
    }
}

// 表设计
CREATE TABLE messages (
    msg_id VARCHAR PRIMARY KEY,
    receiver_id VARCHAR,
    sender_id VARCHAR,
    content VARCHAR,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
)
WITH (
    COLUMN_FAMILY = 'msg',
    DATA_BLOCK_ENCODING = 'PREFIX',
    COMPRESSION = 'SNAPPY'
);

// 查询用户的所有收件
SELECT * FROM messages
WHERE receiver_id = 'user_001'
ORDER BY created_at DESC
LIMIT 100;
```

---

## 三、Feed 流系统

### 场景描述

社交应用需要存储用户动态，支持用户主页 Feed 展示。

```
典型数据：
- 发布者、动态内容、点赞数、评论数
- 每天新增 500 万条动态
- 需要支持分页查询
```

### 解决方案

```java
// Feed 表设计
// RowKey: userId + reversedTimestamp + feedId
public class FeedRowKey {
    public static String design(String userId, long timestamp, String feedId) {
        long reversedTime = Long.MAX_VALUE - timestamp;
        return String.format("%s_%014d_%s", userId, reversedTime, feedId);
    }
}

// 关注表
public class FollowTable {
    // 存储用户关注列表
    // RowKey: userId
    // Column: followedUserId
}

// 写入 Feed
public void postFeed(String userId, String feedId, String content) {
    long timestamp = System.currentTimeMillis();

    // 1. 写入 Feed 表
    String feedRowKey = FeedRowKey.design(userId, timestamp, feedId);
    Put feedPut = new Put(Bytes.toBytes(feedRowKey));
    feedPut.addColumn(Bytes.toBytes("data"), Bytes.toBytes("content"), Bytes.toBytes(content));
    feedTable.put(feedPut);

    // 2. 写入所有粉丝的时间线（Push 模式）
    List<String> followers = getFollowers(userId);
    for (String follower : followers) {
        String timelineRowKey = TimelineRowKey.design(follower, timestamp, feedId);
        Put timelinePut = new Put(Bytes.toBytes(timelineRowKey));
        timelinePut.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("author"), Bytes.toBytes(userId));
        timelinePut.addColumn(Bytes.toBytes("data"), Bytes.toBytes("content"), Bytes.toBytes(content));
        timelineTable.put(timelinePut);
    }
}
```

---

## 四、对象存储

### 场景描述

文件管理系统需要存储文件元数据，支持按用户、按目录查询。

```
典型数据：
- 文件 ID、用户 ID、目录 ID、文件路径
- 文件名、大小、创建时间
- 支持目录树查询
```

### 解决方案

```
表设计：
1. 文件表：file_meta
   - RowKey: fileId
   - 列族：info(userId, dirId, name, size, createdAt)

2. 目录表：dir_tree
   - RowKey: parentDirId + childDirId
   - 列族：meta(name, type)

3. 用户文件索引：user_files
   - RowKey: userId + fileId
   - 列族：idx(dirId, name)
```

---

## 五、实时分析

### 场景描述

实时统计系统需要计算 DAU、留存、转化率等指标。

```
典型需求：
- 每小时计算 DAU
- 次日留存率
- 实时大盘数据
```

### 解决方案

```java
// 预聚合表设计
public class MetricsTable {
    // DAU 表
    // RowKey: date + userId
    // 查询：按天扫描即可

    // 留存表
    // RowKey: date + cohort + retainedUserId
    // 查询：按 cohort + date 范围扫描

    // 实时计数
    public void increment(String metric, long delta) {
        String rowKey = metric + "_" + LocalDate.now();
        Table table = getTable("metrics_counter");

        Append append = new Append(Bytes.toBytes(rowKey));
        append.addColumn(
            Bytes.toBytes("cnt"),
            Bytes.toBytes("value"),
            Bytes.toBytes(delta)
        );
        table.append(append);
    }
}
```

---

## 六、推荐系统

### 场景描述

存储用户行为特征，支持实时推荐计算。

```
典型数据：
- 用户 ID、行为类型、目标 ID、时间
- 用户特征向量
- 物品特征向量
```

### 解决方案

```
特征存储：
1. 用户特征表：user_features
   - RowKey: userId
   - 列族：features(行为1, 行为2, ..., 向量)

2. 物品特征表：item_features
   - RowKey: itemId
   - 列族：features(...)

特征更新：
- 定时批量更新用户特征
- 实时更新热点物品特征
```

---

## 选型决策树

```
┌─────────────────────────────────────────────────────────────┐
│                    HBase 选型决策树                          │
│                                                             │
│  数据量级？                                                  │
│  │                                                          │
│  ├─ < 1TB → MySQL                                          │
│  │                                                          │
│  ├─ 1TB - 100TB → 根据查询模式选择                          │
│  │   │                                                      │
│  │   ├─ 主键查询为主 → HBase                               │
│  │   └─ 复杂查询为主 → MySQL + 分库分表                     │
│  │                                                          │
│  └─ > 100TB → HBase                                        │
│      │                                                      │
│      ├─ 时序数据 → HBase (原生支持)                         │
│      ├─ 消息系统 → HBase (按用户分区)                       │
│      ├─ 对象存储 → HBase + OSS                             │
│      └─ 监控数据 → OpenTSDB / InfluxDB                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

- HBase 和其他 NoSQL 的选型依据是什么？
- 如何设计一个千万级用户的 Feed 系统？

下一节，我们来了解 HBase 的面试题汇总。
