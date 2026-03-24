# MySQL 连接池优化：连接数设置与超时配置

你有没有遇到过这种情况：压测报告漂亮得很，QPS 能跑到 5000，但上线后业务高峰期数据库就开始雪崩？

仔细一看日志，99% 的时间都花在了**等待连接**上。

这就是连接池配置不当的典型后果。

## 为什么连接池如此重要？

数据库连接不像内存变量，不能随用随创建。每次建立连接都需要：

1. TCP 三次握手
2. MySQL 认证
3. 分配缓冲区
4. 建立物理链路

这个过程在本地网络下大约需要 1-3ms，在跨机房或跨国场景下可能达到 10-50ms。对于高并发系统来说，这完全是不可接受的。

连接池的核心思想是：**连接复用，用时借，用完还**。类似于水库的蓄水功能——平时储水，用时放水，避免「旱的旱死，涝的涝死」。

## 连接数的设置：太少不行，太多也有害

### 最小连接数（minimumIdle）

很多开发者习惯把最小连接数设为 0，认为这样可以节省资源。但这会导致一个尴尬的问题：**业务高峰期，第一个请求需要等待创建连接**。

对于延迟敏感的服务，这个等待时间是不可接受的。

**建议**：对于流量相对稳定的服务，最小连接数应该接近正常负载的一半。

### 最大连接数（maximumPoolSize）

这个值的设置是连接池调优的核心难题。

**太小的问题**：并发能力受限，请求排队等待。

**太大的问题**：
- 每个连接占用内存（MySQL 默认约 2MB/连接）
- 操作系统进程/线程数受限
- 数据库端连接数耗尽
- CPU 上下文切换开销增加

### 计算公式

一个经验公式：

```
最大连接数 ≈ (CPU 核心数 × 2) + 磁盘数
```

但这太笼统了。更精确的方法是：

```sql
-- 监控当前连接的平均活跃时间
SELECT 
    COUNT(*) AS total_connections,
    SUM(IF(command = 'Sleep', 1, 0)) AS idle_connections,
    SUM(IF(command != 'Sleep', 1, 0)) AS active_connections
FROM information_schema.PROCESSLIST;
```

观察正常负载下的活跃连接数，然后以此为基准，向上预留 2-3 倍的余量。

### Java 连接池配置示例（HikariCP）

```java
HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:mysql://localhost:3306/mydb");
config.setUsername("user");
config.setPassword("pass");

// 连接池大小：核心参数
config.setMaximumPoolSize(50);   // 最大连接数
config.setMinimumIdle(10);       // 最小空闲连接

// 超时配置
config.setConnectionTimeout(30000);  // 获取连接超时：30秒
config.setIdleTimeout(600000);      // 空闲超时：10分钟
config.setMaxLifetime(1800000);     // 连接最大生命周期：30分钟

// 连接验证
config.setConnectionTestQuery("SELECT 1");
config.setValidationTimeout(5000);   // 验证超时：5秒
```

## 超时配置：宁可失败，不要无限等待

超时配置是连接池中最容易被忽视，却最能影响系统健壮性的参数。

### 获取连接超时（connectionTimeout）

当连接池已满，新请求等待获取连接的最长时间。超过这个时间，直接抛出异常。

**设置太短**：正常业务波动可能导致大量失败
**设置太长**：请求堆积，可能引发雪崩

**建议值**：正常延迟的 3-5 倍。比如 P99 延迟是 100ms，这里可以设为 500ms。

### 空闲连接超时（idleTimeout）

空闲连接在池中保留的最长时间。超过这个时间，连接会被关闭。

**注意**：这个参数只有在连接数大于 `minimumIdle` 时才生效。

```java
// 空闲超时：5分钟
config.setIdleTimeout(300000);
```

### 连接最大生命周期（maxLifetime）

连接在池中存在的最长时间，不管是否空闲。这是一个安全措施，防止数据库端因为某些原因（如防火墙）主动断开了连接，而连接池还在使用。

**建议**：设置为数据库端 `wait_timeout` 的 80% 左右。

```sql
-- 查看数据库端的 wait_timeout
SHOW VARIABLES LIKE 'wait_timeout';
-- 通常是 28800 秒（8小时）
```

```java
config.setMaxLifetime(1800000);  // 30分钟，留有余量
```

## 实战：连接池问题排查

### 场景一：连接池耗尽

```
Cannot acquire connection from pool
```

排查步骤：

1. 检查连接池配置是否合理
2. 查看是否有慢查询占用连接
3. 分析连接的实际使用情况

```sql
-- 查看当前所有连接
SHOW PROCESSLIST;

-- 按用户聚合
SELECT 
    user, 
    COUNT(*) as cnt,
    GROUP_CONCAT(DISTINCT command) as commands
FROM information_schema.PROCESSLIST
GROUP BY user
ORDER BY cnt DESC;
```

### 场景二：连接泄漏

连接池中的连接数量逐渐增长，最终耗尽。通常是因为：
- 没有正确关闭 Connection
- 使用了 try-with-resources 但连接没有真正释放
- 查询时间过长，连接被占用

```java
// 错误示例：忘记关闭连接
public void badQuery() {
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM user");
    ResultSet rs = ps.executeQuery();
    // 没有关闭！每次调用都泄漏一个连接
    return processResult(rs);
}

// 正确示例
public List&lt;User&gt; goodQuery() {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("SELECT * FROM user");
         ResultSet rs = ps.executeQuery()) {
        return processResult(rs);
    }
}
```

### 场景三：连接超时抖动

业务高峰期，偶尔出现连接超时。可能的原因：

1. **连接数不足**：高峰期连接数达到上限
2. **慢查询**：某个查询占用连接时间过长
3. **网络抖动**：数据库和应用之间的网络延迟增加

```sql
-- 查看慢查询
SHOW GLOBAL STATUS LIKE 'Slow_queries';
SHOW VARIABLES LIKE 'long_query_time';

-- 查看当前执行的查询
SELECT 
    id, user, host, db, command, time, state, LEFT(info, 100) as info
FROM information_schema.PROCESSLIST
WHERE command != 'Sleep'
ORDER BY time DESC;
```

## 连接池调优检查清单

| 检查项 | 推荐值 | 说明 |
|---|---|---|
| maximumPoolSize | CPU核心数 × 2 ± 20% | 根据业务特性调整 |
| minimumIdle | 正常负载的 50% | 流量稳定时可接近最大 |
| connectionTimeout | P99延迟的 3-5 倍 | 毫秒级 |
| idleTimeout | 5-10 分钟 | 仅在 minIdle < maxPoolSize 时生效 |
| maxLifetime | wait_timeout × 0.8 | 留有余量 |

## 总结

连接池调优的核心目标是：**在资源占用和响应延迟之间找到平衡**。

记住几个关键点：

1. **连接数不是越大越好**：要结合 CPU、内存、数据库承载能力综合考虑
2. **超时配置要合理**：宁可快速失败，也不要无限等待
3. **监控是关键**：通过监控了解实际使用情况，才能做出正确的调整
4. **连接泄漏是隐性问题**：代码层面必须规范，确保连接正确释放

---

## 留给你的问题

假设你的系统有以下特征：

- 峰值 QPS：2000
- 每个请求平均需要 2 次数据库查询
- P99 延迟：50ms
- 数据库服务器：32 核 CPU，128GB 内存

请思考：这种情况下，连接池的 maximumPoolSize 应该设置为多少？为什么？

提示：连接池大小的设置不是简单的数学题，需要考虑业务特性、数据库处理能力、网络延迟等多个因素。
