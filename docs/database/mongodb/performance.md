# MongoDB 常见性能瓶颈与优化思路

MongoDB 跑着跑着就慢了？写入延迟变高？查询超时？

这一篇，我来总结 MongoDB 常见的性能瓶颈和对应的优化方案。

## 性能问题定位流程

```
发现问题
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  诊断步骤                                                  │
│  1. mongostat 查看整体状态                                │
│  2. mongotop 查看集合级别耗时                            │
│  3. Profiler 查看慢查询                                   │
│  4. explain() 分析执行计划                               │
│  5. serverStatus 查看资源使用                             │
└──────────────────────────────────────────────────────────┘
    │
    ▼
定位瓶颈
    │
    ├─→ I/O 瓶颈 → SSD / 增加内存 / 减少读取
    ├─→ CPU 瓶颈 → 优化查询 / 增加索引
    ├─→ 内存瓶颈 → 增加 Cache / 优化内存使用
    ├─→ 锁瓶颈 → 减少锁竞争 / 优化数据模型
    └─→ 网络瓶颈 → 优化连接 / 减少传输
```

## 瓶颈 1：I/O 瓶颈

### 症状

```bash
# mongostat 输出
insert  query update delete getmore command % idx miss    flushes  vsize   res qrw  arw
*0     *0    *0    *0     0     2|0  0        100      10       2GB 2GB q100 r0 0|0
# % idx miss = 100 表示索引未命中率 100%，大量磁盘 I/O
```

### 原因

| 原因 | 说明 |
|-----|------|
| 热数据超出 Cache | 热点数据无法全部缓存在内存 |
| 缺少索引 | 全表扫描，大量磁盘读取 |
| 随机写入 | Journal、数据文件随机写入 |
| 机械硬盘 | SSD 才能满足高并发 I/O |

### 解决方案

```javascript
// 1. 增加 WiredTiger Cache
mongod --wiredTigerCacheSizeGB=16

// 2. 添加索引
db.orders.createIndex({userId: 1, createdAt: -1})

// 3. 使用 SSD
// 生产环境必须使用 SSD

// 4. 优化查询，减少读取量
db.orders.find({userId: "123"})
  .projection({orderId: 1, amount: 1, _id: 0})  // 只返回必要字段
```

## 瓶颈 2：锁竞争

### 症状

```bash
# mongostat 输出
qrw  arw
50   30
# 读写队列长度持续很高
```

### 原因

| 原因 | 说明 |
|-----|------|
| 写入热点 | 单个集合大量写入 |
| 长事务 | 长时间占用锁 |
| 缺少索引 | 写入时需要扫描大量文档 |

### 解决方案

```javascript
// 1. 减少单次写入量
// 差：单条插入
for (let i = 0; i < 1000; i++) {
  db.logs.insertOne({data: i})  // 每次都加锁
}

// 好：批量插入
db.logs.insertMany(docs)  // 一次锁操作

// 2. 使用无序写入
db.collection.insertMany(docs, {ordered: false})

// 3. 减少长事务
// 检查是否有超时事务
db.currentOp({secs_running: {$gt: 30}})
```

## 瓶颈 3：内存不足

### 症状

```javascript
// serverStatus wiredTiger.cache
{
  "percentage of maximum bytes used": "95%",  // Cache 使用率接近 100%
  "pages evicted": 10000,                       // 淘汰页面数持续增长
}
```

### 原因

| 原因 | 说明 |
|-----|------|
| Cache 配置太小 | WiredTiger Cache 没有足够的内存 |
| 热数据太大 | 工作集大于 Cache 大小 |
| 连接太多 | 每个连接占用内存 |

### 解决方案

```javascript
// 1. 增加 Cache 大小
mongod --wiredTigerCacheSizeGB=16

// 2. 监控并优化热数据
// 确保常用查询的数据在内存中

// 3. 控制连接数
db.adminCommand({
  setParameter: 1,
  maxIncomingConnections: 10000
})

// 4. 使用投影减少数据传输
db.orders.find({userId: "123"})
  .projection({only: "needed fields"})
```

## 瓶颈 4：慢查询

### 症状

```javascript
// Profiler 输出
{
  "op": "query",
  "ns": "myapp.orders",
  "millis": 5000,  // 查询耗时 5 秒
  "command": {...}
}
```

### 原因

| 原因 | 说明 |
|-----|------|
| 缺少索引 | 全表扫描 |
| 索引不合适 | 索引字段顺序不对 |
| 深度分页 | skip 大量数据 |
| 关联查询 | $lookup 无索引 |

### 解决方案

```javascript
// 1. 分析慢查询
db.orders.find({userId: "123"}).explain("executionStats")

// 检查：
// - COLLSCAN（全表扫描）→ 添加索引
// - totalDocsExamined >> nReturned → 优化查询条件

// 2. 添加合适的索引
db.orders.createIndex({userId: 1, createdAt: -1})

// 3. 优化分页
// 差：深度分页
db.orders.find().skip(100000).limit(10)

// 好：游标分页
const lastId = pageData[pageData.length - 1]._id
db.orders.find({_id: {$gt: lastId}}).limit(10)

// 4. 确保 $lookup 关联字段有索引
db.orders.createIndex({userId: 1})  // 外键索引
```

## 瓶颈 5：写入性能差

### 症状

```bash
# mongostat 输出
insert  query update delete getmore command
100    0     0     0     0     10
# 写入只有 100/s，明显低于预期
```

### 原因

| 原因 | 说明 |
|-----|------|
| 磁盘 I/O 慢 | 写入需要等待磁盘 |
| Journal 刷盘频繁 | 每次写入都要刷盘 |
| 索引维护 | 每次写入更新索引 |
| 锁竞争 | 写入热点 |

### 解决方案

```javascript
// 1. 使用 SSD
// 2. 批量写入
const docs = Array.from({length: 1000}, (_, i) => ({data: i}))
db.orders.insertMany(docs)

// 3. 减少索引
// 差：每个字段都建索引
db.collection.createIndex({field1: 1})
db.collection.createIndex({field2: 1})
db.collection.createIndex({field3: 1})

// 好：只建必要的索引
db.collection.createIndex({queryField1: 1, queryField2: 1})

// 4. 使用哈希分片分散写入
sh.shardCollection("myapp.orders", {orderId: "hashed"})
```

## 瓶颈 6：副本同步延迟

### 症状

```javascript
// 从节点延迟
rs.printSecondaryReplicationInfo()

// 输出
{
  "syncedTo": "Mon Mar 15 2024 10:00:00 GMT+0800",
  "behind": "0 seconds"  // 0 秒延迟，正常
}

// 如果 behind > 0，说明有延迟
```

### 原因

| 原因 | 说明 |
|-----|------|
| 网络慢 | 主从之间网络延迟 |
| 从节点性能差 | CPU、内存、磁盘瓶颈 |
| 写入量大 | 主节点写入太快，从节点跟不上 |
| Oplog 太小 | 从节点追赶时 oplog 被覆盖 |

### 解决方案

```javascript
// 1. 增加 oplog 大小
db.adminCommand({replSetResizeOplog: 1, size: 20480})

// 2. 提升从节点性能
// - 增加内存
// - 使用 SSD
// - 减少主节点写入量

// 3. 网络优化
// - 确保主从之间网络通畅
// - 减少网络延迟

// 4. 读写分离
// 将只读请求路由到从节点
db.orders.find().readPref("secondary")
```

## 性能优化检查清单

### 查询优化

| 检查项 | 操作 |
|-------|------|
| [ ] 查询使用索引 | `explain()` 查看 IXSCAN |
| [ ] 投影只返回必要字段 | 添加 `.projection()` |
| [ ] 避免深度分页 | 使用游标分页 |
| [ ] 避免前缀通配正则 | `^xxx` 可以，`xxx$` 不行 |

### 写入优化

| 检查项 | 操作 |
|-------|------|
| [ ] 批量写入 | `insertMany()` |
| [ ] 无序写入 | `{ordered: false}` |
| [ ] 必要的索引 | 只建查询需要的索引 |
| [ ] 写入分散 | 哈希分片 |

### 内存优化

| 检查项 | 操作 |
|-------|------|
| [ ] Cache 大小合适 | 50% RAM |
| [ ] 热数据在内存 | 监控 Cache 命中率 |
| [ ] 无内存泄漏 | 监控内存增长 |

### 连接优化

| 检查项 | 操作 |
|-------|------|
| [ ] 连接池合理 | 不要太大或太小 |
| [ ] 无连接泄漏 | 监控连接数 |
| [ ] 合适的超时 | `socketTimeoutMS` |

## Java 性能优化代码

```java
public class PerformanceOptimization {
    public static void main(String[] args) {
        // 1. 连接池配置
        MongoClientSettings settings = MongoClientSettings.builder()
            .applyToConnectionPoolSettings(builder -> {
                builder.maxSize(100)
                    .minSize(10)
                    .maxWaitTime(5, TimeUnit.SECONDS)
                    .maxConnectionIdleTime(10, TimeUnit.MINUTES);
            })
            .applyToSocketSettings(builder -> {
                builder.connectTimeout(5, TimeUnit.SECONDS)
                    .readTimeout(30, TimeUnit.SECONDS);
            })
            .build();

        try (MongoClient client = MongoClients.create(settings)) {
            MongoCollection&lt;Document&gt; collection =
                client.getDatabase("myapp").getCollection("orders");

            // 2. 批量写入
            List&lt;Document&gt; batch = new ArrayList<>();
            for (int i = 0; i < 1000; i++) {
                batch.add(new Document("orderId", i).append("amount", i * 10));
            }
            collection.insertMany(batch,
                new InsertManyOptions().ordered(false));

            // 3. 查询优化 - 投影
            collection.find(eq("userId", "123"))
                .projection(fields(include("orderId", "amount"), excludeId()));

            // 4. 游标分页
            Bson lastId = null;
            for (int page = 0; page < 10; page++) {
                Bson query = lastId != null
                    ? and(eq("userId", "123"), gt("_id", lastId))
                    : eq("userId", "123");

                FindIterable&lt;Document&gt; results = collection
                    .find(query)
                    .sort(descending("_id"))
                    .limit(20);

                for (Document doc : results) {
                    lastId = doc.get("_id");
                    // 处理文档
                }
            }
        }
    }
}
```

## 总结

常见性能瓶颈与优化：

| 瓶颈 | 症状 | 解决方案 |
|-----|------|---------|
| I/O | idx miss 高 | SSD / 增加内存 / 加索引 |
| 锁竞争 | qrw/arw 高 | 批量写入 / 减少锁持有时间 |
| 内存不足 | Cache 使用率 > 90% | 增加 Cache |
| 慢查询 | query millis 高 | 分析执行计划 / 加索引 |
| 写入差 | insert 低 | SSD / 批量写入 / 减少索引 |
| 复制延迟 | behind > 0 | 增加 oplog / 提升从节点 |

**优化原则**：
1. 先定位瓶颈，再针对性优化
2. 监控先行，用数据说话
3. 改动要小，验证要全
4. 持续监控，防止退化

---

**下一步，你可以：**

- 学习 [MongoDB Spring Data MongoDB 集成](/database/mongodb/spring-data)
- 了解 [MongoDB 数据备份与恢复](/database/mongodb/backup)
- 掌握 [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare)
