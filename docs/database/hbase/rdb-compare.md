# HBase vs 关系型数据库：什么时候选谁？

很多人在选型时纠结：HBase 和 MySQL/Oracle 到底选哪个？

今天我们从多个维度对比，帮你做出选择。

---

## 核心对比

| 维度 | HBase | MySQL |
|-----|-------|-------|
| **数据模型** | 列族 NoSQL | 关系型 |
| **事务** | 单行 ACID | 多行 ACID |
| **容量** | PB 级 | TB 级 |
| **写入吞吐** | 100万+/秒 | 1万/秒 |
| **读取延迟** | 毫秒级 | 毫秒级 |
| **查询能力** | Scan + Filter | SQL |
| **索引** | RowKey 索引 | 多索引 |
| **扩展性** | 自动分片 | 手动分库分表 |
| **一致性** | 强一致 | 强一致 |

---

## 数据模型对比

### MySQL：固定 Schema

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY,
    name VARCHAR(100),
    age INT,
    email VARCHAR(255),
    created_at TIMESTAMP
);

-- 每行必须有所有列
-- 空值占存储空间
-- 需要 ALTER TABLE 修改结构
```

### HBase：动态 Schema

```
表创建时只需指定列族
实际列（Column Qualifier）可以动态添加

RowKey: user_001
├── info:name    = "张三"
├── info:age     = 25
└── info:email   = "zhang@xx.com"
    （没有定义的列自动为空，不占空间）
```

```java
// 动态添加列
Put put = new Put(Bytes.toBytes("user_001"));
put.addColumn(Bytes.toBytes("info"),
             Bytes.toBytes("phone"),
             Bytes.toBytes("13800138000"));
// 无需修改表结构
```

---

## 查询能力对比

### MySQL：SQL 强大

```sql
-- 复杂关联查询
SELECT u.name, COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.age > 18
GROUP BY u.id
ORDER BY order_count DESC
LIMIT 10;

-- 多索引支持
CREATE INDEX idx_age ON users(age);
CREATE INDEX idx_name_age ON users(name, age);
```

### HBase：简单但受限

```java
// 只能通过 RowKey 或 Scan 范围查询

// RowKey 查询（快）
Get get = new Get(Bytes.toBytes("user_001"));
Result result = table.get(get);

// 范围查询
Scan scan = new Scan();
scan.withStartRow(Bytes.toBytes("user_001"));
scan.withStopRow(Bytes.toBytes("user_010"));

// 过滤器查询（慢，需要全表扫描）
Filter filter = new RowFilter(
    CompareOperator.EQUAL,
    new RegexStringComparator(".*_001")
);
scan.setFilter(filter);
```

**HBase 的查询限制**：

- 不支持 JOIN（需要反范式设计）
- 不支持聚合（需要预聚合或用 Phoenix）
- 不支持复杂 WHERE 条件
- 唯一高效路径：RowKey → Region → HFile

---

## 事务能力对比

### MySQL：多行事务

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE user_id = 1;
UPDATE accounts SET balance = balance + 100 WHERE user_id = 2;
INSERT INTO transactions VALUES (1, 2, 100);
COMMIT;
-- 全成功或全失败
```

### HBase：单行事务

```java
// 单行原子操作（Check-And-Put）
Put put = new Put(Bytes.toBytes("user_001"));
put.addColumn(Bytes.toBytes("info"), Bytes.toBytes("balance"), Bytes.toBytes("1000"));

// 原子性：检查旧值再更新
Increment increment = new Increment(Bytes.toBytes("user_001"));
increment.addColumn(Bytes.toBytes("stat"), Bytes.toBytes("count"), 1L);
Result result = table.increment(increment);  // 原子递增
```

**跨行事务**：HBase 不支持，需要业务层自己实现（如 TCC）。

---

## 扩展性对比

### MySQL：垂直扩展 + 手动分片

```
MySQL 扩展路径：
1. 升级硬件（垂直扩展，有上限）
2. 分库分表（需要应用层改造）
3. 中间件（如 ShardingSphere）
```

### HBase：水平扩展（自动）

```
HBase 扩展路径：
1. 增加 RegionServer 节点
2. 数据自动均衡（Master 调度）
3. Region 自动分裂

新增节点 → HBase 检测到 → 自动迁移部分 Region → 均衡完成
```

---

## 选择决策树

```
数据量级？
│
├─ < 1TB → MySQL
│   需要复杂查询、事务、JOIN
│
├─ 1TB - 100TB → 根据业务选择
│   │ 
│   ├─ 高并发写入、稀疏数据 → HBase
│   │
│   └─ 需要事务、SQL → MySQL + 分库分表
│
└─ > 100TB → HBase
    海量数据、高并发写入
```

---

## 混合架构

实际项目中，HBase 和 MySQL 常常配合使用：

```
┌─────────────────────────────────────────────────────────────┐
│                        混合架构                               │
│                                                             │
│  MySQL (HBase)                                             │
│  ├── 用户主数据（ID、姓名、认证信息）                        │
│  ├── 订单主数据（订单ID、金额、状态）                        │
│  └── 商品主数据（SKU、价格、库存）                          │
│                                                             │
│  HBase                                                      │
│  ├── 用户行为日志（点击、浏览、收藏）                        │
│  ├── 消息详情（聊天记录）                                   │
│  ├── 订单明细（每个订单的行项目）                           │
│  └── 日志数据（访问日志、审计日志）                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 设计模式

```java
public class HybridDesign {
    private final Table hbaseTable;
    private final DataSource mysqlDs;

    // 场景：电商订单系统

    // MySQL 存储订单主表（事务性）
    public void createOrder(Order order) throws SQLException {
        try (Connection conn = mysqlDs.getConnection()) {
            conn.setAutoCommit(false);
            // 插入订单主记录
            // 更新商品库存（需要事务）
            // 扣减用户余额（需要事务）
            conn.commit();
        }
    }

    // HBase 存储订单详情（海量）
    public void saveOrderDetails(String orderId, List&lt;OrderItem&gt; items)
            throws IOException {
        for (OrderItem item : items) {
            // RowKey: orderId_itemId（预聚合设计）
            String rowKey = orderId + "_" + item.getItemId();

            Put put = new Put(Bytes.toBytes(rowKey));
            put.addColumn(Bytes.toBytes("item"),
                         Bytes.toBytes("product_id"),
                         Bytes.toBytes(item.getProductId()));
            put.addColumn(Bytes.toBytes("item"),
                         Bytes.toBytes("quantity"),
                         Bytes.toBytes(item.getQuantity()));
            hbaseTable.put(put);
        }
    }

    // 组合查询
    public OrderVO getOrderDetails(String orderId) throws Exception {
        // 1. 从 MySQL 获取订单主信息
        Order order = mysqlQuery(orderId);

        // 2. 从 HBase 获取订单明细
        Scan scan = new Scan();
        scan.withStartRow(Bytes.toBytes(orderId + "_"));
        scan.withStopRow(Bytes.toBytes(orderId + "_" + Character.MAX_VALUE));
        List&lt;OrderItem&gt; items = hbaseScan(scan);

        return new OrderVO(order, items);
    }
}
```

---

## 面试追问方向

- HBase 如何实现复杂的聚合查询？
- 如果要在 HBase 上实现 JOIN，有什么方案？

下一节，我们来了解 HBase 的存储结构 HFile。
