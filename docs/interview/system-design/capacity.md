# 如何进行容量规划与性能评估

你的系统能抗住双十一吗？

这是每个工程师在活动前都会被问到的问题。

但很多人在被问到时才慌慌张张去压测，结果发现扛不住。

**容量规划应该是在系统设计时就做好的，而不是等到出了问题才想起。**

## 场景切入

容量规划的核心问题：

```
我要设计一个系统，它需要支持多少用户？
每台服务器能处理多少请求？
我需要多少台服务器？
数据库能支撑多大的数据量？
```

回答这些问题，需要系统的容量规划能力。

## 容量规划步骤

### 第一步：需求分析

```
假设目标：
- 日活用户：1000 万
- 日均订单量：100 万
- 峰值 QPS：10 万
- 数据存储：5 年
```

### 第二步：性能指标计算

```java
public class CapacityCalculator {

    // 估算每日请求量
    public long calculateDailyRequests(long dau, int avgRequestsPerUser) {
        return dau * avgRequestsPerUser;
    }

    // 估算峰值 QPS
    public long calculatePeakQPS(long dailyRequests) {
        // 估算日活集中在几个小时（假设 8 小时）
        long avgQPS = dailyRequests / (8 * 3600);

        // 峰值 QPS 通常是平均的 3-10 倍
        return avgQPS * 5;
    }

    // 估算存储量
    public long calculateStorage(long dailyOrders, int years, int avgRecordSize) {
        return dailyOrders * 365 * years * avgRecordSize;
    }
}
```

### 第三步：单节点能力评估

每种资源的处理能力：

| 资源 | 典型能力 |
|-----|---------|
| CPU（8 核） | 5000-10000 QPS |
| 内存 | 取决于数据大小 |
| 网络 | 100MB/s |
| 磁盘（SSD） | 5000-10000 IOPS |
| MySQL | 3000-5000 QPS（简单查询） |
| Redis | 10-20 万 QPS |

```java
public class NodeCapacityAssessment {

    // 估算单台应用服务器的 QPS
    public int estimateServerQPS(ServerConfig config) {
        int cpuCores = config.getCpuCores();
        int threadsPerCore = 100;

        // 简单估算：每个 CPU 核心 100 线程
        int totalThreads = cpuCores * threadsPerCore;

        // 每个请求平均耗时 50ms
        int avgLatencyMs = 50;

        // QPS = 线程数 / (平均延迟 / 1000)
        return totalThreads / (avgLatencyMs / 1000.0);
    }

    // 估算单台 MySQL 的 QPS
    public int estimateMySQLQPS(MySQLConfig config) {
        // 简单查询：3000-5000 QPS
        // 复杂查询：1000-2000 QPS
        // 写入操作：500-1000 QPS
        return 3000;
    }

    // 估算 Redis 的 QPS
    public int estimateRedisQPS(RedisConfig config) {
        // Redis 单节点：10-20 万 QPS
        return 100_000;
    }
}
```

### 第四步：集群规模计算

```java
public class ClusterSizing {

    public int calculateServerCount(long peakQPS, int qpsPerServer) {
        // 考虑冗余：实际需要 × 1.5
        return (int) Math.ceil(peakQPS * 1.5 / qpsPerServer);
    }

    public int calculateMySQLShards(long dailyOrders, int ordersPerShard) {
        // 考虑增长：预留 3 倍余量
        return (int) Math.ceil(dailyOrders * 3.0 / ordersPerShard);
    }

    public int calculateRedisNodes(long memoryPerDay, int memoryPerNode) {
        // 考虑冗余：实际需要 × 2
        return (int) Math.ceil(memoryPerDay * 2.0 / memoryPerNode);
    }
}
```

## 性能评估方法

### 1. 基准测试

```java
public class BenchmarkTest {

    @Test
    public void apiBenchmark() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(100);
        CountDownLatch latch = new CountDownLatch(10000);

        AtomicLong totalLatency = new AtomicLong(0);
        AtomicInteger errorCount = new AtomicInteger(0);
        LongAdder successCount = new LongAdder();

        long startTime = System.currentTimeMillis();

        for (int i = 0; i < 10000; i++) {
            executor.submit(() -> {
                try {
                    long requestStart = System.currentTimeMillis();
                    Response response = httpClient.execute(request);
                    long latency = System.currentTimeMillis() - requestStart;

                    totalLatency.addAndGet(latency);
                    successCount.increment();
                } catch (Exception e) {
                    errorCount.incrementAndGet();
                } finally {
                    latch.countDown();
                }
            });
        }

        latch.await();

        long duration = System.currentTimeMillis() - startTime;
        long totalRequests = successCount.sum() + errorCount.get();

        // 输出结果
        System.out.println("总请求数: " + totalRequests);
        System.out.println("QPS: " + totalRequests * 1000 / duration);
        System.out.println("平均延迟: " + totalLatency.get() / totalRequests + "ms");
        System.out.println("错误率: " + errorCount.get() * 100.0 / totalRequests + "%");
    }
}
```

### 2. 性能测试类型

| 类型 | 说明 | 目的 |
|-----|------|------|
| 基准测试 | 单一模块测试 | 了解单节点能力 |
| 容量测试 | 逐步增加压力 | 找到系统上限 |
| 稳定性测试 | 长时间运行 | 验证长时间稳定性 |
| 峰值测试 | 模拟峰值流量 | 验证峰值处理能力 |

### 3. 性能瓶颈定位

```java
public class PerformanceProfiler {

    // 使用 APM 工具定位瓶颈
    // 常见的瓶颈点：

    // 1. CPU 瓶颈
    // - 表现：CPU 使用率高，请求延迟随负载线性增加
    // - 解决：增加机器、代码优化

    // 2. 内存瓶颈
    // - 表现：GC 频繁、FULL GC 增多
    // - 解决：减少内存占用、优化 GC

    // 3. IO 瓶颈
    // - 表现：IO 等待高、CPU IO Wait 高
    // - 解决：异步 IO、缓存、SSD

    // 4. 网络瓶颈
    // - 表现：带宽占满、连接数不足
    // - 解决：压缩、CDN、增加带宽

    // 5. 数据库瓶颈
    // - 表现：连接池耗尽、查询超时
    // - 解决：读写分离、分库分表、优化 SQL
}
```

## 常见场景容量规划

### 场景一：Web 应用

```
假设：
- DAU：100 万
- 人均请求：50 次/天
- 峰值 QPS：10 倍

计算：
- 日请求量：5000 万
- 峰值 QPS：5000 万 / (8×3600) × 10 ≈ 1.7 万

服务器需求：
- 单台服务器 QPS：5000
- 需要服务器：1.7 万 / 5000 × 1.5 ≈ 5 台
```

### 场景二：数据库

```
假设：
- 日订单量：100 万
- 单条订单记录：1KB
- 需要存储：1 年

计算：
- 存储需求：100 万 × 365 × 1KB ≈ 365 GB

单库容量：
- MySQL 单库：2TB（建议不超过 1TB）
- 需要分库：1 个库足够

如果数据量增长 10 倍：
- 需要分库：至少 4 个库
- 或者分表：每库 100 张表，每表 1000 万
```

### 场景三：缓存

```
假设：
- 热点数据：10 GB
- 需要冗余：2 倍

计算：
- Redis 内存需求：20 GB
- 单台 Redis：64 GB
- 需要 Redis：1 台（主从）

如果内存需求 200 GB：
- 需要 Redis 集群：4 台
```

## 性能调优经验

### 1. 应用层优化

```java
// 连接池优化
@Configuration
public class ConnectionPoolConfig {
    @Bean
    public HikariDataSource dataSource() {
        HikariConfig config = new HikariConfig();

        // 连接池大小 = CPU 核心数 × 2
        // 太大：连接竞争；太小：资源浪费
        config.setMaximumPoolSize(32);
        config.setMinimumIdle(10);

        // 连接超时
        config.setConnectionTimeout(30000);
        config.setIdleTimeout(600000);

        return new HikariDataSource(config);
    }
}
```

### 2. 数据库优化

```sql
-- 添加合适的索引
CREATE INDEX idx_order_user_time ON orders(user_id, created_at);

-- 优化慢查询
EXPLAIN SELECT * FROM orders WHERE user_id = ? AND created_at > ?;

-- 分页优化：使用游标分页
SELECT * FROM orders
WHERE id < #{lastId}
ORDER BY id DESC
LIMIT 20;
```

### 3. 缓存优化

```java
// 热点数据预加载
@PostConstruct
public void warmUpCache() {
    // 在系统启动时加载热点数据
    List<Product> hotProducts = productDao.findHotProducts();
    for (Product product : hotProducts) {
        redis.opsForValue().set("product:" + product.getId(), product);
    }
}
```

## 面试追问

### 追问一：如何评估一个 SQL 的性能？

1. **使用 EXPLAIN**：查看执行计划
2. **检查索引**：是否走索引
3. **检查类型**：全表扫描还是索引扫描
4. **检查 rows**：扫描行数是否合理

### 追问二：如何确定线程池大小？

```java
// 公式：线程数 = CPU 核心数 × (1 + IO 等待时间 / CPU 计算时间)

// CPU 密集型：线程数 = CPU 核心数 + 1
// IO 密集型：线程数 = CPU 核心数 × 2
// 混合型：线程数 = CPU 核心数 × (1 + 等待时间 / 计算时间)

// 实际调优：用压测找到最优值
```

### 追问三：如何评估是否需要分库分表？

| 数据量 | 单表行数 | 建议 |
|-------|---------|------|
| < 1000 万 | < 500 万 | 优化索引即可 |
| 1000 万 - 5000 万 | 500-1000 万 | 开始考虑分表 |
| 5000 万以上 | > 1000 万 | 必须分库分表 |

## 总结

容量规划的核心：

1. **需求分析**：明确目标用户量、请求量
2. **指标计算**：QPS、存储量、网络带宽
3. **能力评估**：单节点的处理能力
4. **规模计算**：需要多少台机器
5. **压测验证**：实际压测验证估算

容量规划不是一次性的工作，而是持续的过程：

1. **上线前**：评估容量
2. **上线后**：监控实际使用
3. **增长前**：提前扩容
4. **瓶颈时**：优化或扩容

**好的容量规划让你的系统有条不紊地增长，差的容量规划让你的系统随时可能崩溃。**
