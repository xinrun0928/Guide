# MySQL 读写分离与延迟优化

双十一零点，你下单买了件衣服，订单确认页面显示「下单成功」，但刷新一看，订单状态还是「待支付」。

怎么回事？是系统 Bug 吗？

**不是，这是读写分离的「延迟」在作怪。**

## 什么是读写分离？

读写分离是数据库扩展的经典策略：把读请求和写请求分散到不同的数据库实例上执行。

- **主库（Master）**：处理所有写操作，数据变更后同步到从库
- **从库（Slave/Replica）**：处理读操作，从主库同步数据

架构图：

```
                    ┌─────────────┐
                    │   应用层    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
         ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
         │  读库1  │  │  读库2  │  │  读库3  │
         └────┬────┘  └────┬────┘  └────┬────┘
              │            │            │
              └────────────┼────────────┘
                           │  主从同步
                    ┌──────▼──────┐
                    │   主库(写)   │
                    └─────────────┘
```

### 为什么要读写分离？

1. **分摊压力**：单库 QPS 有限，读请求往往远多于写请求
2. **提升性能**：读库可以水平扩展，不受主库限制
3. **增强可用性**：读库故障不影响写操作

## 主从同步原理

MySQL 的主从同步基于 binlog 实现：

1. **主库**：记录所有数据变更到 binlog
2. **Dump 线程**：主库的 Dump 线程读取 binlog，发送给从库
3. **I/O 线程**：从库的 I/O 线程接收 binlog，写入 relay log
4. **SQL 线程**：从库的 SQL 线程读取 relay log，执行 SQL

```sql
-- 主库查看 binlog 状态
SHOW MASTER STATUS;
-- 输出：File: mysql-bin.000001, Position: 1234

-- 从库查看同步状态
SHOW SLAVE STATUS\G
-- 关键字段：
--   Slave_IO_Running: Yes
--   Slave_SQL_Running: Yes
--   Seconds_Behind_Master: 0  (延迟秒数)
```

## 读写分离的延迟问题

开头的问题，根源在于：写操作完成后，从库还没来得及同步数据。

### 延迟的来源

| 来源 | 说明 | 影响程度 |
|---|---|---|
| 网络延迟 | binlog 传输耗时 | 较小，通常毫秒级 |
| 从库积压 | 从库处理能力不足 | 较大，可能秒级甚至分钟级 |
| 大事务 | 主库执行时间长 | 大事务同步时间长 |
| 并发复制 | SQL 线程 单线程执行 | 严重，多个大事务会排队 |

### MySQL 5.7 的并行复制

MySQL 5.7 引入了 **MTS（Multi-Threaded Slave）**，让 SQL 线程可以并行执行：

```sql
-- 查看并行复制配置
SHOW VARIABLES LIKE '%parallel%';

-- 设置并行复制策略
SET GLOBAL slave_parallel_type = 'LOGICAL_CLOCK';  -- 基于逻辑时钟
SET GLOBAL slave_parallel_workers = 8;  -- 并行 worker 数
```

**并行复制的原理**：

1. 同一数据库内的事务可以并行
2. 同一组事务可以并行（组提交优化）

```sql
-- 配置示例
slave_parallel_type = 'LOGICAL_CLOCK'
slave_parallel_workers = 8
slave_preserve_commit_order = ON  -- 保持提交顺序
```

### MySQL 8.0 的增强

MySQL 8.0 进一步优化了并行复制：

1. **writeset 并行复制**：不依赖数据库，基于事务修改的行
2. **binlog_transaction_dependency_tracking**：控制依赖追踪方式

```sql
-- MySQL 8.0 配置
slave_parallel_type = LOGICAL_CLOCK
binlog_transaction_dependency_tracking = WRITESET  -- 或 WRITESET_SESSION
transaction_write_set_extraction = XXHASH64
slave_parallel_workers = 16
```

## 延迟的解决方案

### 方案一：强制读主库

对于一致性要求高的场景，强制读主库：

```java
// 伪代码：使用注解标记需要读主库
@Transactional(readOnly = false)  // 读主库
public Order getOrder(Long orderId) {
    return orderMapper.selectById(orderId);
}

// 或者使用 AOP
@ReadFromMaster
public Order getOrder(Long orderId) {
    return orderMapper.selectById(orderId);
}
```

**适用场景**：
- 刚写入的数据马上需要读取
- 金融类交易系统
- 订单、支付等核心链路

### 方案二：延迟读取

对于可以容忍延迟的场景，延迟几百毫秒再读取：

```java
public Order getOrder(Long orderId) {
    try {
        Thread.sleep(100);  // 延迟 100ms
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
    return orderMapper.selectById(orderId);
}
```

**不推荐**：这种方式简单粗暴，无法保证效果。

### 方案三：应用层双写

写操作同时写入主库和读库：

```java
@Transactional
public void createOrder(Order order) {
    masterMapper.insert(order);      // 写主库
    replicaMapper.insert(order);    // 写读库
}
```

**问题**：
- 代码复杂度增加
- 多一次数据库交互
- 主从切换时需要改代码

### 方案四：客户端半同步复制

主库等待从库确认收到 binlog 后再返回成功：

```sql
-- 安装半同步插件
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';

-- 启用半同步
SET GLOBAL rpl_semi_sync_master_enabled = ON;
SET GLOBAL rpl_semi_sync_slave_enabled = ON;

-- 配置超时时间
SET GLOBAL rpl_semi_sync_master_timeout = 1000;  -- 1000ms
```

**特点**：
- 性能略有下降（等待网络）
- 数据安全性提高
- 超时后自动降级为异步

### 方案五：GTID + 自动切换

使用 GTID（Global Transaction Identifier）简化故障切换：

```sql
-- 启用 GTID
SET GLOBAL gtid_mode = ON;
SET GLOBAL enforce_gtid_consistency = ON;

-- GTID 自动定位
CHANGE MASTER TO 
    MASTER_AUTO_POSITION = 1;
```

**好处**：
- 无需知道 binlog 文件名和位置
- 自动识别已执行的事务
- 简化主从切换逻辑

## 读写延迟的监控

```sql
-- 查看从库延迟
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master: 0

-- 使用 Performance Schema 监控
SELECT 
    SOURCE_UUID,
    EVENT_COUNT,
    EXECUTION_TIME
FROM performance_schema.replication_connection_status;
```

```java
// 代码层面监控延迟
public boolean isReplicationHealthy() {
    Map<String, Object> result = jdbcTemplate.queryForMap(
        "SHOW SLAVE STATUS"
    );
    boolean ioRunning = "Yes".equals(result.get("Slave_IO_Running"));
    boolean sqlRunning = "Yes".equals(result.get("Slave_SQL_Running"));
    long lag = ((Number) result.get("Seconds_Behind_Master")).longValue();
    
    return ioRunning && sqlRunning && lag < 5;  // 延迟小于 5 秒
}
```

## 总结

读写分离是数据库扩展的必经之路，但延迟问题是必须面对的挑战：

1. **理解延迟来源**：网络、大事务、并发能力差异
2. **选择合适的解决方案**：强一致读主库、允许延迟读从库
3. **善用 MySQL 新特性**：并行复制、GTID、半同步复制
4. **持续监控**：关注延迟指标，及时告警

---

## 留给你的问题

假设有这样的业务场景：

- 用户发表文章后，立即展示「发表成功」页面
- 文章详情页允许少量延迟（用户可以接受几秒内的延迟）
- 用户的「我的文章」列表需要立即看到新文章
- 点赞数、阅读数等计数可以延迟展示

请思考：

1. 这个场景中，哪些操作需要读主库？哪些可以读从库？
2. 如果用「发表文章」来划分，你会如何设计？
3. 如果使用分布式数据库（如 TiDB），延迟问题是否还存在？为什么？

这道题的关键在于理解业务一致性需求和技术实现之间的权衡。
