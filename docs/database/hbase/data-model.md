# HBase 数据模型：稀疏列存储的艺术

很多人学 HBase，第一步就被它的数据模型搞懵。

表、列族、列限定符、Cell、版本……这些概念到底什么意思？

今天，我们把这些彻底讲清楚。

---

## HBase 数据模型概览

```
┌─────────────────────────────────────────────────────────────┐
│                    Table: t_message                           │
│                                                             │
│  RowKey           Column Family: meta                        │
│  ───────────────────────────────────────────────────────── │
│  msg_001         meta:from="user1"                        │
│                   meta:to="user2"                          │
│                   meta:timestamp="1709808000"              │
│                                                             │
│  msg_002         meta:from="user3"                        │
│                   meta:to="user1"                          │
│                   meta:timestamp="1709808100"              │
│                                                             │
│  msg_003         meta:from="user1"                        │
│                   meta:to="user4"                          │
│                   meta:content="Hello"                      │
│                   ← 只有这一行有 content 列，其他行是空的   │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心概念

### Table（表）

HBase 中的表，由多行组成。

### Row（行）

每行数据由 RowKey 唯一标识，按 RowKey 字典序排序。

### Column Family（列族）

列族是列的分组，必须在创建表时定义：

```java
// 定义两个列族
TableDescriptor table = TableDescriptorBuilder
    .newBuilder(tableName)
    .setColumnFamilies(
        ColumnFamilyDescriptorBuilder.of("info"),      // 用户基本信息
        ColumnFamilyDescriptorBuilder.of("behavior")   // 用户行为
    )
    .build();
```

**列族设计原则**：

- 列族数量不宜过多（建议 2-3 个）
- 经常一起访问的列放同一列族
- 冷数据列族可以单独设置更长的压缩

### Column Qualifier（列限定符）

列限定符是列族下的具体列，动态创建：

```java
// 列限定符：content、title、author
put.addColumn(Bytes.toBytes("article"),
              Bytes.toBytes("content"),  // 列限定符
              Bytes.toBytes("文章内容..."));

put.addColumn(Bytes.toBytes("article"),
              Bytes.toBytes("title"),
              Bytes.toBytes("HBase 入门"));
```

### Cell（单元格）

Cell = RowKey + Column Family + Column Qualifier + Timestamp

存储实际的值和版本：

```
msg_001/meta:content:1709808000 → "Hello World"
```

### Timestamp（时间戳）

版本号，默认为写入时间（毫秒），也可以手动指定：

```java
// 自动生成时间戳
put.addColumn(cf, cq, value);

// 手动指定时间戳
put.addColumn(cf, cq, timestamp, value);
```

---

## 多版本机制

HBase 支持列的多版本，版本数量可配置：

```java
// 创建列族时指定最大版本数
ColumnFamilyDescriptor cfd = ColumnFamilyDescriptorBuilder
    .of("info")
    .setMaxVersions(5)  // 保留最近 5 个版本
    .build();
```

### 多版本查询

```java
// 获取所有版本
Get get = new Get(rowKey);
get.addColumn(Bytes.toBytes("info"), Bytes.toBytes("name"));
get.setMaxVersions();  // 获取所有版本
// get.setMaxVersions(3);  // 获取最近 3 个版本

Result result = table.get(get);
List&lt;Cell&gt; cells = result.getColumnCells(
    Bytes.toBytes("info"),
    Bytes.toBytes("name")
);
// cells 包含多个版本的值
```

### 版本删除

```java
// 删除指定版本
Delete delete = new Delete(rowKey);
delete.addColumn(Bytes.toBytes("info"),
                 Bytes.toBytes("name"),
                 timestamp);  // 删除这个版本

// 删除最新版本（不指定时间戳）
Delete delete = new Delete(rowKey);
delete.addColumn(Bytes.toBytes("info"), Bytes.toBytes("name"));

// 删除所有版本（但保留列）
Delete delete = new Delete(rowKey);
delete.addColumns(Bytes.toBytes("info"), Bytes.toBytes("name"));
```

---

## 稀疏存储

HBase 是稀疏存储——空列不占空间。

```java
// 这行数据只有 2 列
Put put = new Put(Bytes.toBytes("doc_001"));
put.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("title"), Bytes.toBytes("文档1"));
put.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("author"), Bytes.toBytes("张三"));

// 这行数据有 5 列
Put put2 = new Put(Bytes.toBytes("doc_002"));
put2.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("title"), Bytes.toBytes("文档2"));
put2.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("author"), Bytes.toBytes("李四"));
put2.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("created"), Bytes.toBytes("2024-01-01"));
put2.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("status"), Bytes.toBytes("published"));
put2.addColumn(Bytes.toBytes("meta"), Bytes.toBytes("views"), Bytes.toBytes("1000"));
```

这两行数据共享表结构，但实际存储时，空列完全不占空间。

---

## 数据存储结构

### 逻辑视图 vs 物理视图

```
逻辑视图（用户看到的样子）：
┌─────────────────────────────────────────────────────────────┐
│ RowKey       CF:article                                     │
├─────────────────────────────────────────────────────────────┤
│ doc_001      content: "内容1"    title: "标题1"             │
│ doc_002      title: "标题2"     author: "作者2"            │
│ doc_003      content: "内容3"                               │
└─────────────────────────────────────────────────────────────┘

物理存储（实际存储的样子）：
┌─────────────────────────────────────────────────────────────┐
│ doc_001     article:content="内容1"                         │
│            article:title="标题1"                            │
├─────────────────────────────────────────────────────────────┤
│ doc_002     article:title="标题2"                          │
│            article:author="作者2"                          │
├─────────────────────────────────────────────────────────────┤
│ doc_003     article:content="内容3"                         │
└─────────────────────────────────────────────────────────────┘
```

---

## Java 完整示例

```java
public class HBaseDataModel {
    private final Table table;

    // 场景：消息系统
    public void saveMessage(Message message) throws IOException {
        // RowKey 设计：receiver + timestamp + sender，实现按用户和时间范围查询
        String rowKey = message.getReceiverId() + "_" +
                       message.getTimestamp() + "_" +
                       message.getSenderId();

        Put put = new Put(Bytes.toBytes(rowKey));

        // 元数据列族
        put.addColumn(Bytes.toBytes("meta"),
                     Bytes.toBytes("sender"),
                     Bytes.toBytes(message.getSenderId()));
        put.addColumn(Bytes.toBytes("meta"),
                     Bytes.toBytes("receiver"),
                     Bytes.toBytes(message.getReceiverId()));
        put.addColumn(Bytes.toBytes("meta"),
                     Bytes.toBytes("timestamp"),
                     Bytes.toBytes(message.getTimestamp()));

        // 内容列族
        put.addColumn(Bytes.toBytes("content"),
                     Bytes.toBytes("text"),
                     Bytes.toBytes(message.getText()));
        if (message.hasAttachment()) {
            put.addColumn(Bytes.toBytes("content"),
                         Bytes.toBytes("attachment_url"),
                         Bytes.toBytes(message.getAttachmentUrl()));
        }

        table.put(put);
    }

    // 获取用户的所有消息
    public List&lt;Message&gt; getUserMessages(String userId,
                                          long startTime,
                                          long endTime) throws IOException {
        // 扫描指定范围
        Scan scan = new Scan();

        // RowKey 前缀：用户ID
        String startRow = userId + "_" + startTime;
        String endRow = userId + "_" + endTime;
        scan.withStartRow(Bytes.toBytes(startRow));
        scan.withStopRow(Bytes.toBytes(endRow));

        // 只查询 meta 列族
        scan.addFamily(Bytes.toBytes("meta"));
        scan.addFamily(Bytes.toBytes("content"));

        ResultScanner scanner = table.getScanner(scan);
        List&lt;Message&gt; messages = new ArrayList&lt;&gt;();

        for (Result result : scanner) {
            messages.add(parseMessage(result));
        }

        return messages;
    }

    // 获取消息的多个历史版本
    public List&lt;String&gt; getMessageHistory(String rowKey) throws IOException {
        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes("content"), Bytes.toBytes("text"));
        get.setMaxVersions();  // 获取所有版本

        Result result = table.get(get);
        List&lt;String&gt; history = new ArrayList&lt;&gt;();

        for (Cell cell : result.getColumnCells(
                Bytes.toBytes("content"),
                Bytes.toBytes("text"))) {
            history.add(Bytes.toString(CellUtil.getValue(cell)));
        }

        return history;
    }
}
```

---

## 面试追问方向

- HBase 的稀疏存储有什么优势？
- HBase 如何实现多版本数据管理的？

下一节，我们来了解 HBase 的 RowKey 设计。
