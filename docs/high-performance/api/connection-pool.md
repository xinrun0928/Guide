# 连接池配置：HTTP Client、数据库连接池、Redis 连接池

你有没有遇到过这种诡异的情况：

- 接口响应时间忽快忽慢，但数据库 CPU 和内存都很空闲
- 系统刚启动时很慢，运行一段时间后反而变快了
- 压测时性能很好，生产环境却频繁超时

大概率是**连接池配置出了问题**。

连接池是性能优化的基础设施——配置合理，系统跑得飞起；配置不当，再好的代码也白搭。

---

## 一、连接池的本质

在说具体配置之前，我们先理解连接池为什么存在。

### 1.1 建立连接的成本

```java
/**
 * 估算不同类型连接建立的耗时
 */
public class ConnectionCostAnalysis {

    public static void main(String[] args) throws Exception {
        System.out.println("========== 连接建立成本分析 ==========");
        System.out.println();

        // TCP 连接建立：约 1-5ms（本地）到 50ms+（跨机房）
        System.out.println("1. TCP 三次握手:");
        System.out.println("   本地: ~1ms");
        System.out.println("   同机房: ~5ms");
        System.out.println("   跨机房: ~50ms");
        System.out.println("   跨地域: ~100ms+");
        System.out.println();

        // TLS 握手：额外 1-2 RTT
        System.out.println("2. TLS 握手 (HTTPS):");
        System.out.println("   额外耗时: ~20-100ms");
        System.out.println();

        // 数据库连接：更复杂
        System.out.println("3. 数据库连接:");
        System.out.println("   连接建立: ~10-50ms");
        System.out.println("   认证鉴权: ~5-10ms");
        System.out.println("   连接池分配: ~1ms");
        System.out.println();

        System.out.println("结论:");
        System.out.println("  假设每次 API 调用需要 3 次数据库查询");
        System.out.println("  无连接池: 3 * 30ms = 90ms (仅建连)");
        System.out.println("  有连接池: 0ms (复用现有连接)");
    }
}
```

**连接池的核心价值**：把「每次用完就扔」变成「用完放回去，下次继续用」，省掉反复建连的开销。

### 1.2 连接池工作原理

```
┌─────────────────────────────────────────────────────┐
│                    连接池                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │Connection│ │Connection│ │Connection│ │Connection│    │
│  │   #1    │ │   #2    │ │   #3    │ │   #4    │    │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘    │
│       │           │           │           │          │
└───────┼───────────┼───────────┼───────────┼──────────┘
        │           │           │           │
        └───────────┴─────┬─────┴───────────┘
                          │
                    ┌─────▼─────┐
                    │  应用代码   │
                    └───────────┘

工作流程:
1. 请求到来，从池中获取连接
2. 连接可用，直接使用
3. 连接不可用，等待或新建
4. 使用完毕，归还连接池
```

---

## 二、HTTP Client 连接池

### 2.1 Apache HttpClient 配置

```java
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.conn.ssl.SSLConnectionSocketFactory;
import org.apache.http.ssl.SSLContextBuilder;

public class HttpClientPoolConfig {

    public static CloseableHttpClient createOptimizedClient() {
        // 连接池管理器
        PoolingHttpClientConnectionManager connectionManager = new PoolingHttpClientConnectionManager();

        // 核心配置
        connectionManager.setMaxTotal(200);              // 最大连接数
        connectionManager.setDefaultMaxPerRoute(50);    // 每个路由(域名)最大连接数
        connectionManager.setValidateAfterInactivity(2000); // 空闲连接检查间隔(ms)

        // 连接获取超时
        RequestConfig requestConfig = RequestConfig.custom()
                .setConnectTimeout(3000)                 // 建立连接超时: 3s
                .setSocketTimeout(30000)                 // Socket 读写超时: 30s
                .setConnectionRequestTimeout(5000)        // 从连接池获取连接超时: 5s
                .build();

        return HttpClients.custom()
                .setConnectionManager(connectionManager)
                .setDefaultRequestConfig(requestConfig)
                .setRetryHandler((exception, executionCount, context) -> {
                    // 不重试，建立新连接的开销太大
                    return false;
                })
                .build();
    }

    /**
     * 调优参数说明
     */
    public static void main(String[] args) {
        System.out.println("========== HTTP 连接池调优参数 ==========");
        System.out.println();
        System.out.println("maxTotal (最大连接数):");
        System.out.println("  = 并发上限 × 每请求连接数 × 备用系数");
        System.out.println("  示例: 100并发 × 1连接 × 2 = 200");
        System.out.println();
        System.out.println("defaultMaxPerRoute (单路由最大连接):");
        System.out.println("  = maxTotal × 0.25 (经验值)");
        System.out.println("  防止一个域名耗尽所有连接");
        System.out.println();
        System.out.println("连接泄漏检查:");
        System.out.println("  必须使用 try-with-resources 或 finally 释放连接");
    }
}
```

### 2.2 常见问题与解决

```java
/**
 * HTTP 连接池常见问题
 */
public class HttpPoolPitfalls {

    // 问题1: 连接泄漏
    public String badRequestExample(CloseableHttpClient client, String url) throws Exception {
        // 错误: 没有释放连接
        HttpGet request = new HttpGet(url);
        HttpResponse response = client.execute(request);  // 连接借出
        // 如果这里抛异常，连接就泄漏了
        return EntityUtils.toString(response.getEntity());
        // 归还语句永远不会执行
    }

    // 问题2: 连接池耗尽
    public String goodRequestExample(CloseableHttpClient client, String url) throws Exception {
        // 正确: 使用 try-with-resources
        try (CloseableHttpResponse response = client.execute(new HttpGet(url))) {
            return EntityUtils.toString(response.getEntity());
        } // 无论成功还是异常，连接都会被释放
    }

    // 问题3: DNS 变化不生效
    public void dnsCachingIssue() {
        System.out.println("问题: JVM 默认缓存 DNS 解析结果");
        System.out.println("解决:");
        System.out.println("  - 使用 HttpClient 时配置 DNS 刷新");
        System.out.println("  - 或设置: -Dnetworkaddress.cache.ttl=0");
    }
}
```

### 2.3 OkHttp 连接池

```java
import okhttp3.OkHttpClient;
import okhttp3.ConnectionPool;
import java.util.concurrent.TimeUnit;

public class OkHttpPoolConfig {

    public static OkHttpClient createClient() {
        return new OkHttpClient.Builder()
                // 连接池配置
                .connectionPool(new ConnectionPool(
                        50,             // 最大连接数
                        5,              // 空闲存活时间(分钟)
                        TimeUnit.MINUTES
                ))
                // 连接超时
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                // 复用连接
                .retryOnConnectionFailure(true)
                .build();
    }
}
```

---

## 三、数据库连接池

### 3.1 HikariCP 配置

HikariCP 是目前性能最好的数据库连接池，相比 Druid、C3P0 等有显著优势。

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import javax.sql.DataSource;

public class HikariConfigExample {

    public static DataSource createDataSource() {
        HikariConfig config = new HikariConfig();

        // 基础配置
        config.setJdbcUrl("jdbc:mysql://localhost:3306/mydb");
        config.setUsername("root");
        config.setPassword("password");
        config.setDriverClassName("com.mysql.cj.jdbc.Driver");

        // 连接池大小 (关键参数!)
        config.setMaximumPoolSize(20);    // 最大连接数
        config.setMinimumIdle(5);         // 最小空闲连接

        // 超时配置
        config.setConnectionTimeout(30000);   // 获取连接超时: 30s
        config.setIdleTimeout(600000);        // 空闲连接超时: 10分钟
        config.setMaxLifetime(1800000);       // 连接最大生命周期: 30分钟

        // 连接测试
        config.setConnectionTestQuery("SELECT 1");
        config.setValidationTimeout(5000);     // 连接验证超时: 5s

        // 性能优化
        config.setAutoCommit(true);
        config.setCachePrepStmts(true);         // 开启预编译语句缓存
        config.setPrepStmtCacheSize(250);      // 预编译语句缓存大小
        config.setPrepStmtCacheSqlLimit(2048); // 单条 SQL 最大长度

        return new HikariDataSource(config);
    }

    /**
     * 连接池大小计算公式
     */
    public static void main(String[] args) {
        System.out.println("========== 连接池大小计算 ==========");
        System.out.println();

        // 经验公式: connections = (core_count * 2) + effective_spindle_count
        // core_count: CPU 核心数
        // effective_spindle_count: 磁盘数量 (SSD 视为 1)

        int cpuCores = Runtime.getRuntime().availableProcessors();
        int calculated = (cpuCores * 2) + 1;

        System.out.printf("CPU 核心数: %d%n", cpuCores);
        System.out.printf("推荐连接数: %d%n", calculated);
        System.out.println();
        System.out.println("注意:");
        System.out.println("  - 这是经验值，具体需要根据压测调整");
        System.out.println("  - 连接数过多会导致上下文切换开销");
        System.out.println("  - 连接数过少会造成请求排队");
    }
}
```

### 3.2 连接池调优实战

```java
import com.zaxxer.hikari.HikariDataSource;
import com.zaxxer.hikari.HikariPoolMXBean;
import javax.management.JMX;

/**
 * 连接池监控与调优
 */
public class ConnectionPoolMonitoring {

    public static void main(String[] args) {
        HikariDataSource ds = (HikariDataSource) createDataSource();

        // 获取连接池统计信息
        HikariPoolMXBean poolBean = ds.getHikariPoolMXBean();

        System.out.println("========== 连接池状态 ==========");
        System.out.printf("活跃连接: %d%n", poolBean.getActiveConnections());
        System.out.printf("空闲连接: %d%n", poolBean.getIdleConnections());
        System.out.printf("等待连接线程: %d%n", poolBean.getThreadsAwaitingConnection());
        System.out.printf("总连接数: %d%n", poolBean.getTotalConnections());
        System.out.println();

        // 判断是否需要调参
        int waiting = poolBean.getThreadsAwaitingConnection();
        if (waiting > 0) {
            System.out.println("⚠️ 有线程在等待连接，建议:");
            System.out.println("  1. 增加 maximumPoolSize");
            System.out.println("  2. 检查 SQL 执行时间是否过长");
            System.out.println("  3. 考虑使用读写分离分散压力");
        }
    }

    // SQL 执行时间过长会导致连接占用
    public void checkSlowQuery() {
        System.out.println("慢查询特征:");
        System.out.println("  - 全表扫描查询");
        System.out.println("  - 缺少索引的 JOIN");
        System.out.println("  - 大数据量事务");
        System.out.println();
        System.out.println("优化方向:");
        System.out.println("  1. 添加合适的索引");
        System.out.println("  2. 优化 SQL 语句");
        System.out.println("  3. 读写分离");
        System.out.println("  4. 分库分表");
    }

    private static DataSource createDataSource() {
        // 见上方示例
        return null;
    }
}
```

---

## 四、Redis 连接池

### 4.1 Lettuce 连接池配置

Lettuce 是 Spring Boot 2.x 默认的 Redis 客户端，支持连接池。

```java
import io.lettuce.core.RedisClient;
import io.lettuce.core.resource.ClientResources;
import io.lettuce.core.resource.DefaultClientResources;
import io.lettuce.core.RedisURI;
import io.lettuce.core.api.StatefulRedisConnection;
import io.lettuce.core.api.sync.RedisCommands;
import io.lettuce.core.codec.StringCodec;
import io.lettuce.core.pool.ConnectionPool;
import io.lettuce.core.pool.ConnectionPoolConfig;
import io.lettuce.core.pool.StatefulRedisConnectionPool;

public class RedisPoolConfig {

    public static RedisClient createRedisClient() {
        // 创建共享的 ClientResources
        ClientResources resources = DefaultClientResources.builder()
                .ioThreadPoolSize(4)    // I/O 线程数
                .computationThreadPoolSize(4) // 计算线程池大小
                .build();

        RedisURI uri = RedisURI.builder()
                .withHost("localhost")
                .withPort(6379)
                .withPassword("password")
                .withDatabase(0)
                .build();

        return RedisClient.create(resources, uri);
    }

    public static StatefulRedisConnectionPool&lt;String&gt; createConnectionPool(
            RedisClient client) {

        ConnectionPoolConfig poolConfig = ConnectionPoolConfig.builder()
                .maxTotal(50)           // 最大连接数
                .maxIdle(20)            // 最大空闲连接
                .minIdle(5)             // 最小空闲连接
                .maxWaitElapsed(TimeUnit.SECONDS.toMillis(30))  // 最大等待时间
                .testOnBorrow(true)      // 借用时测试连接
                .testWhileIdle(true)    // 空闲时测试连接
                .build();

        return new StatefulRedisConnectionPool&lt;&gt;(client, poolConfig);
    }

    public static void main(String[] args) {
        System.out.println("========== Redis 连接池要点 ==========");
        System.out.println();
        System.out.println("与数据库连接池的区别:");
        System.out.println("  - Redis 是单线程模型，一个连接可处理所有命令");
        System.out.println("  - 连接池不需要太大，10-20 个通常足够");
        System.out.println("  - 大量并发时，瓶颈在 Redis 单线程，不在连接数");
        System.out.println();
        System.out.println("Lettuce vs Jedis:");
        System.out.println("  - Lettuce: 支持异步/响应式，连接复用更高效");
        System.out.println("  - Jedis: 简单易用，但连接管理较弱");
    }
}
```

### 4.2 Spring Boot 配置

```yaml
# application.yml
spring:
  redis:
    # Lettuce 连接池配置
    lettuce:
      pool:
        max-active: 50       # 最大连接数
        max-idle: 20        # 最大空闲
        min-idle: 5         # 最小空闲
        max-wait: 3000ms    # 获取连接最大等待时间

  # Druid 连接池配置 (如果使用 Druid)
  datasource:
    druid:
      max-active: 20
      min-idle: 5
      initial-size: 5
      max-wait: 60000
      validation-query: SELECT 1
      test-while-idle: true
```

### 4.3 常见问题

```java
/**
 * Redis 连接池问题诊断
 */
public class RedisConnectionPitfalls {

    public void commonIssues() {
        System.out.println("========== Redis 连接池常见问题 ==========");
        System.out.println();

        System.out.println("1. 连接池耗尽:");
        System.out.println("   症状: redis.clients.jedis.exceptions.JedisConnectionException:");
        System.out.println("         Could not get a resource from the pool");
        System.out.println("   原因: Redis 操作阻塞或连接泄漏");
        System.out.println("   解决: 检查 Redis 命令复杂度，增加连接数");
        System.out.println();

        System.out.println("2. 连接泄漏:");
        System.out.println("   原因: 使用 try-with-resources 但未正确关闭");
        System.out.println("   解决: JedisPooled 等包装类已自动管理");
        System.out.println();

        System.out.println("3. 熔断导致的雪崩:");
        System.out.println("   原因: Redis 不可用时大量请求打到数据库");
        System.out.println("   解决: 引入 Sentinel/Cluster 高可用");
    }
}
```

---

## 五、综合调优建议

### 5.1 监控指标

| 指标 | HTTP Client | 数据库 | Redis |
|-----|-------------|--------|-------|
| 活跃连接数 | `pool.getTotal()` | `HikariPoolMXBean.getActiveConnections()` | `cluster.getActiveConnections()` |
| 空闲连接数 | `pool.getIdle()` | `getIdleConnections()` | `getIdleConnections()` |
| 等待线程数 | - | `getThreadsAwaitingConnection()` | - |
| 连接获取超时 | `connectionRequestTimeout` | `connectionTimeout` | `maxWaitElapsed` |
| 平均等待时间 | - | JMX 监控 | - |

### 5.2 调优顺序

```
1. 先确保连接池配置合理（不是越大越好）
   ↓
2. 监控连接池使用率
   ↓
3. 如果频繁等待 → 增加连接数或优化 SQL
   ↓
4. 如果连接空闲多 → 减小连接数节省资源
   ↓
5. 持续监控，持续优化
```

---

## 留给你的问题

连接池配置的黄金法则是：**最小化连接数，最大化复用率**。

但现实中，你可能遇到这样的场景：系统白天流量低，晚上流量高。如果连接池设置得太小，晚上会排队；如果设置得太大，白天会浪费资源。

**你有什么办法让连接池能够「自适应」流量变化，而不是固定配置？**

提示：可以考虑动态调整连接池大小，或者使用弹性伸缩策略。
