# HBase 概述：NoSQL 时代的列式存储

2006 年，Google 发表了一篇论文：《Bigtable: A Distributed Storage System for Structured Data》。

这篇论文描述了一个新型存储系统的设计：分布式的、稀疏的、持久化的多维有序映射表。

两年后，Apache HBase 诞生了——它是 Bigtable 的开源实现。

---

## HBase 是什么？

HBase 是一个**面向列族**的 NoSQL 数据库，建在 HDFS 之上，为海量数据提供随机实时读写能力。

```
传统关系型数据库：
┌────────────────────────────────────────┐
│  id  │  name  │  age  │  email        │
├──────┼────────┼───────┼────────────────┤
│  1   │  张三  │  25   │  zhang@xx.com │
│  2   │  李四  │  30   │  li@xx.com    │
└────────────────────────────────────────┘
   每行固定列，空值也占位

HBase：
┌────────────────────────────────────────────────────────┐
│ RowKey       Column Family: info                       │
├────────────────────────────────────────────────────────┤
│ user_1      name: 张三   age: 25    email: zhang@xx   │
│ user_2      name: 李四   age: 30                     │
│             email: li@xx.com                          │
└────────────────────────────────────────────────────────┘
   稀疏存储，空值不占位
```

---

## HBase 的核心特点

### 1. 海量存储

| 维度 | HBase | MySQL |
|-----|-------|-------|
| 数据规模 | PB 级 | TB 级 |
| 行数 | 万亿级别 | 亿级别 |
| 表大小 | 100TB+ 轻松 | 超过 10TB 开始吃力 |

### 2. 高并发随机读写

```
写入：100万/秒  ← WAL + 内存 + 异步刷盘
读取：10万/秒  ← BlockCache + BloomFilter
```

### 3. 高可用

- 数据自动分片（Region 自动分裂和迁移）
- 多副本复制（默认 3 副本）
- Master 自动故障切换

### 4. 稀疏存储

空列不占存储空间，适合非结构化数据。

### 5. 多版本

```
同一 RowKey，同一列，可以有多个版本：
user_1  info:name   v1: "张三"
                    v2: "张四"    ← 最新版本
                    v3: "张三丰"  ← 更早的版本
```

---

## HBase 数据模型

### 核心概念

| 概念 | 说明 | 类比 MySQL |
|-----|------|-----------|
| Table | 表 | Table |
| Row | 一行数据 | Row |
| Column Family | 列族（列的分组）| - |
| Column Qualifier | 列限定符 | Column |
| Cell | 单元格（值+版本）| Cell |
| Timestamp | 版本号 | - |
| RowKey | 行键（主键）| Primary Key |

### 数据结构

```
Table (t_user)
│
├── RowKey: user_001
│   ├── Column Family: info
│   │   ├── info:name      → "张三"
│   │   ├── info:age       → "25"
│   │   └── info:email     → "zhang@xx.com"
│   └── Column Family: profile
│       ├── profile:avatar → "url/avatar.jpg"
│       └── profile:bio    → "这是一个简介"
│
└── RowKey: user_002
    └── ...
```

### RowKey 设计

RowKey 是 HBase 查询的灵魂：

```java
// RowKey 设计原则
public class RowKeyDesign {
    // 1. 散列：避免热点
    // 错误：顺序 RowKey 导致所有写入都打到同一个 Region
    // String rowKey = String.valueOf(userId);  // 递增

    // 正确：哈希打散
    String rowKey = MD5(userId).substring(0, 8) + userId;

    // 2. 组合多个字段
    String compositeKey = orderId + "_" + timestamp;

    // 3. 长度控制
    // RowKey 建议不超过 16 字节，过长影响性能
}
```

---

## HBase 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        HBase 架构                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                    Zookeeper                          │  │
│  │  - 元数据管理                                        │  │
│  │  - Master 选举                                       │  │
│  │  - Region 位置                                       │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │   HMaster   │  │  HMaster   │  │  HMaster   │       │
│  │  (主)      │  │  (备)      │  │  (备)      │       │
│  └──────┬──────┘  └─────────────┘  └─────────────┘       │
│         │                                                    │
│         ├─────────────────────────────────────────────────┐ │
│         │                                                 │ │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌──────▼──────┐    │
│  │ HRegionServer│  │ HRegionServer│  │HRegionServer│    │
│  │              │  │              │  │              │    │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │    │
│  │ │ Region1  │ │  │ │ Region2  │ │  │ │ Region3  │ │    │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │    │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │    │
│  │ │ Region4  │ │  │ │ Region5  │ │  │ │ Region6  │ │    │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │    │
│  └──────────────┘  └──────────────┘  └──────────────┘    │
│         │                                                    │
│         └────────────────┬────────────────────────────────┘ │
│                          │                                     │
│                          ↓                                     │
│              ┌───────────────────────┐                       │
│              │        HDFS           │                       │
│              │   (DataNode 节点)     │                       │
│              └───────────────────────┘                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## HBase vs 传统数据库

| 维度 | HBase | MySQL |
|-----|-------|-------|
| 数据模型 | 列族 NoSQL | 关系型 |
| 事务 | 单行事务 | ACID 事务 |
| 容量 | PB 级 | TB 级 |
| 写入 | 顺序追加，百万/s | 随机写入，万级/s |
| 读取 | KV 随机读取 | 复杂查询 |
| 索引 | 只有 RowKey | 多索引 |
| 一致性 | 最终一致 | 强一致 |

---

## HBase 适用场景

| 场景 | 说明 |
|-----|------|
| **时序数据** | IoT 传感器、日志、监控数据 |
| **消息系统** | 消息存储、消费记录 |
| **推荐系统** | 用户行为特征存储 |
| **时空数据** | GPS 轨迹、地理位置 |
| **对象存储** | 图片、元数据存储 |

**不适合场景**：

- 复杂关联查询（JOIN）
- 事务要求高（跨行操作）
- 需要多索引查询
- 小数据量、低并发

---

## Java 客户端示例

```java
import org.apache.hadoop.hbase.client.*;
import org.apache.hadoop.hbase.util.Bytes;

public class HBaseExample {
    private final Connection connection;

    // 创建表
    public void createTable() throws Exception {
        Admin admin = connection.getAdmin();
        TableName tableName = TableName.valueOf("t_user");

        if (admin.tableExists(tableName)) {
            return;
        }

        TableDescriptor table = TableDescriptorBuilder
            .newBuilder(tableName)
            .setColumnFamilies(
                ColumnFamilyDescriptorBuilder.of("info"),
                ColumnFamilyDescriptorBuilder.of("profile")
            )
            .build();

        admin.createTable(table);
    }

    // 写入数据
    public void putData() throws Exception {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        Put put = new Put(Bytes.toBytes("user_001"));
        put.addColumn(
            Bytes.toBytes("info"),
            Bytes.toBytes("name"),
            Bytes.toBytes("张三")
        );
        put.addColumn(
            Bytes.toBytes("info"),
            Bytes.toBytes("age"),
            Bytes.toBytes("25")
        );

        table.put(put);
    }

    // 读取数据
    public String getData(String rowKey, String cf, String cq) throws Exception {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        Get get = new Get(Bytes.toBytes(rowKey));
        get.addColumn(Bytes.toBytes(cf), Bytes.toBytes(cq));

        Result result = table.get(get);
        byte[] value = result.getValue(Bytes.toBytes(cf), Bytes.toBytes(cq));

        return Bytes.toString(value);
    }
}
```

---

## 面试追问方向

- HBase 和 HDFS 有什么区别？为什么 HBase 能支持随机读写？
- HBase 的 RowKey 设计为什么重要？

下一节，我们来深入了解 HBase 的架构。
