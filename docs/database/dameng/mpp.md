# MPP：达梦的大规模并行处理架构

如果你的数据量从 1 亿增长到 100 亿，单机数据库已经跑不动了，怎么办？

加内存？加 CPU？加磁盘？

对不起，这是单机扩展的瓶颈。真正的答案是：**横向扩展（Scale Out），而不是纵向扩展（Scale Up）。**

达梦的 **MPP（Massively Parallel Processing，大规模并行处理）** 架构，就是为这种场景而生。

## MPP 是什么？

MPP 是将多个数据库节点组成集群，协同处理大规模数据查询的计算模式。

```
传统单机：
                    ┌─────────────────┐
                    │   单机数据库    │
                    │  ┌───────────┐  │
                    │  │   所有    │  │
                    │  │   数据    │  │
                    │  └───────────┘  │
                    └─────────────────┘

MPP 集群：
     ┌──────────┬──────────┬──────────┐
     │ 节点1    │ 节点2    │ 节点3    │     ┌──────────┐
     │ 数据分片1│ 数据分片2│ 数据分片3│     │ 控制节点  │
     │  CPU1   │  CPU2   │  CPU3   │────▶│(EP/CN)   │
     │  内存1  │  内存2  │  内存3  │     └──────────┘
     └──────────┴──────────┴──────────┘
            ↓              ↓              ↓
         数据分片1      数据分片2      数据分片3
```

## MPP 的核心概念

### EP（Executive Coordinator，查询协调节点）

负责接收 SQL 请求，生成执行计划，协调各数据节点并行计算。

```sql
-- EP 节点接收查询请求
SELECT customer_name, SUM(order_amount)
FROM orders
JOIN customers ON orders.cust_id = customers.id
WHERE order_date >= '2024-01-01'
GROUP BY customer_name;
```

### DN（Data Node，数据节点）

存储实际数据，执行本地查询。每个 DN 拥有部分数据（数据分片）。

```ini
# dmmpp.ini 配置
[GRP1]
EP_ADDRS = 192.168.1.10:5236,192.168.1.11:5236
MAL_INST_DUMP_FLAG = 1
MPP_SEQNO = 0
```

## 数据分布策略

### 哈希分布（Hash Distribution）

按指定列的哈希值分布数据。

```sql
-- 创建哈希分布表
CREATE TABLE orders (
    order_id BIGINT,
    cust_id BIGINT,
    order_amount DECIMAL(10,2),
    ...
)
DISTRIBUTE BY HASH(cust_id);  -- 按客户ID哈希分布
```

```
cust_id = 1001 → hash(1001) = 5 → DN2
cust_id = 1002 → hash(1002) = 3 → DN1
cust_id = 1003 → hash(1003) = 5 → DN2
同一客户的数据在同一节点
```

### 复制分布（Replicate Distribution）

小表复制到所有节点，避免跨节点关联。

```sql
-- 地区表复制到所有节点
CREATE TABLE region (
    region_id INT,
    region_name VARCHAR(50)
)
DISTRIBUTE BY REPLICATION;  -- 全量复制
```

### 随机分布（Random Distribution）

数据随机分布到各节点。

```sql
-- 创建随机分布表
CREATE TABLE logs (
    log_id BIGINT,
    log_content TEXT
)
DISTRIBUTE BY ROUNDROBIN;  -- 轮询分布
```

## MPP 查询执行流程

```java
// MPP 查询执行流程
public class MppQueryFlow {

    public void queryExecution(String sql) {
        // 1. 客户端连接到 EP 节点
        Connection epConnection = getEpConnection();

        // 2. EP 解析 SQL，生成并行执行计划
        // SELECT cust_name FROM orders o, customers c WHERE o.cust_id = c.id
        // 执行计划：
        //   - 全局聚合（GATHER）
        //   - 本地聚合（LOCAL AGGREGATE）
        //   - 分布式 JOIN

        // 3. EP 将任务分发到各个 DN
        // DN1: 本地查询 + 本地聚合
        // DN2: 本地查询 + 本地聚合
        // DN3: 本地查询 + 本地聚合

        // 4. 各 DN 并行执行
        // 5. 结果汇总到 EP
        // 6. EP 返回最终结果
    }
}
```

## MPP vs 单机 vs 集群

| 特性 | 单机数据库 | 主备集群 | MPP 集群 |
|-----|----------|---------|---------|
| 数据容量 | 受单机磁盘限制 | 受单机磁盘限制 | 多机磁盘之和 |
| 查询性能 | 单机 CPU/IO | 与单机相当 | 多机并行，线性提升 |
| 并发能力 | 受单机限制 | 受主库限制 | 多机并发 |
| 数据写入 | 单点 | 单点 | 多节点可并行 |
| 适用场景 | 中小型数据 | 高可用需求 | 大数据量 |
| 运维复杂度 | 低 | 中 | 高 |

## MPP 的适用场景

### 适用场景

- **数据仓库**：TB/PB 级数据分析
- **OLAP 查询**：复杂统计报表、多表关联
- **日志分析**：海量日志实时分析
- **ETL 处理**：大规模数据抽取转换加载

### 不适用场景

- **OLTP 业务**：高频小事务，单机足够
- **强事务需求**：跨节点事务性能差
- **低延迟要求**：MPP 查询延迟较高

```java
// 判断是否适合 MPP
public class MppSuitability {

    public boolean isSuitableForMpp(Query query) {
        // 数据量小于 1 亿条，单机足够
        if (query.getDataSize() < 100_000_000) {
            return false;
        }

        // 复杂分析查询，适合 MPP
        if (query.isAnalytical() && query.getJoinCount() > 3) {
            return true;
        }

        // 高并发 OLTP，不适合
        if (query.getTps() > 1000 && query.isTransactional()) {
            return false;
        }

        return false;
    }
}
```

## MPP 集群的运维

### 节点扩容

```sql
-- 查看节点状态
SELECT
    GROUP_ID,
    EP_SEQUENCE,
    EP_NAME,
    EP_STATUS
FROM V$MPP_EP_INFO;
```

### 数据重分布

```sql
-- 扩容后，需要重分布数据
ALTER TABLE orders REDISTRIBUTE BY HASH(cust_id);
```

### 跨节点查询优化

```sql
-- 避免跨节点大表关联（性能差）
SELECT * FROM large_table1 t1
JOIN large_table2 t2 ON t1.id = t2.id  -- 两个大表 JOIN，跨节点开销大

-- 优化：先本地关联，再汇总
WITH local_result AS (
    SELECT cust_id, SUM(amount) as total
    FROM orders
    GROUP BY cust_id
)
SELECT c.name, r.total
FROM local_result r
JOIN customers c ON r.cust_id = c.id;
```

## 面试追问方向

- MPP 和分库分表有什么区别？
- MPP 中如何处理跨节点 JOIN？
- MPP 集群中某个节点故障会怎样？

---

## 一句话总结

MPP 是大数据量的「加速器」：多机并行、线性扩展。但它不是万能药，OLTP 场景下反而可能帮倒忙。选对场景，才能发挥 MPP 的真正实力。
