# 性能优化 Checklist

性能优化清单，让你不遗漏任何角落。

很多人做性能优化，眉毛胡子一把抓，结果优化了半天，效果微乎其微。

这篇文章是一份清单，按模块分类，列出性能优化需要检查的关键点。把它贴在墙上，或者设为 IDE 注释，每次做优化的时候对照检查。

## 数据库优化 Checklist

数据库往往是系统性能的第一杀手。优化数据库，性价比最高。

### SQL 优化

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 索引是否建立 | 查询字段是否有索引 | ⭐⭐⭐ |
| [ ] 索引是否命中 | 用 EXPLAIN 检查是否走索引 | ⭐⭐⭐ |
| [ ] 避免 SELECT * | 只查询需要的字段 | ⭐⭐ |
| [ ] 避免 N+1 查询 | 批量查询替代循环查询 | ⭐⭐⭐ |
| [ ] 分页优化 | 用游标分页替代 OFFSET | ⭐⭐ |
| [ ] 避免大事务 | 拆分长事务，减小锁范围 | ⭐⭐ |
| [ ] 批量操作 | 批量 INSERT/UPDATE | ⭐⭐ |

### 索引优化

```sql
-- 检查索引使用情况
EXPLAIN SELECT * FROM orders WHERE user_id = 123;

-- 联合索引检查（最左前缀原则）
-- 如果有 idx(a, b, c)，这些查询能命中：
-- ✓ WHERE a = 1
-- ✓ WHERE a = 1 AND b = 2
-- ✓ WHERE a = 1 AND b = 2 AND c = 3
-- ✗ WHERE b = 2
-- ✗ WHERE c = 3
```

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 联合索引字段顺序 | 区分度高的字段放前面 | ⭐⭐⭐ |
| [ ] 索引覆盖 | SELECT 字段都在索引中 | ⭐⭐ |
| [ ] 前缀索引 | 字符串字段是否需要前缀索引 | ⭐ |
| [ ] 索引冗余 | 是否有重复索引 | ⭐ |
| [ ] 索引失效 | LIKE 以 % 开头、函数操作等 | ⭐⭐⭐ |

### 表结构优化

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 字段类型 | 用合适的数据类型，避免浪费 | ⭐⭐ |
| [ ] 垂直拆分 | 冷热字段分离 | ⭐ |
| [ ] 水平拆分 | 大表按时间/业务拆分 | ⭐⭐ |
| [ ] 避免 NULL | NOT NULL 字段有默认值 | ⭐ |

### 连接池优化

```java
// Druid 连接池配置
DruidDataSource dataSource = new DruidDataSource();
dataSource.setInitialSize(10);           // 初始连接数
dataSource.setMinIdle(10);                // 最小空闲连接
dataSource.setMaxActive(100);             // 最大连接数
dataSource.setMaxWait(60000);            // 获取连接超时
dataSource.setTimeBetweenEvictionRunsMillis(60000); // 清理线程间隔
dataSource.setMinEvictableIdleTimeMillis(300000);   // 最小空闲时间
dataSource.setValidationQuery("SELECT 1"); // 连接验证
```

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 连接数配置 | 根据并发量合理设置 | ⭐⭐⭐ |
| [ ] 超时配置 | 设置合理的获取/归还超时 | ⭐⭐ |
| [ ] 预检机制 | 申请连接前检测是否可用 | ⭐⭐ |
| [ ] 定期清理 | 配置空闲连接回收 | ⭐⭐ |

## 缓存优化 Checklist

缓存是性能优化的大杀器，用得好能提升几个数量级。但缓存也是双刃剑，用不好会引入数据不一致问题。

### 缓存策略

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 缓存穿透 | 接口层做校验，布隆过滤器拦截 | ⭐⭐⭐ |
| [ ] 缓存击穿 | 互斥锁或逻辑过期 | ⭐⭐⭐ |
| [ ] 缓存雪崩 | 多 key 过期时间随机化 | ⭐⭐ |
| [ ] 缓存一致性 | Cache Aside 模式 | ⭐⭐⭐ |
| [ ] 缓存过期策略 | LRU / LFU / TTL | ⭐⭐ |

### 缓存使用模式

```java
public class CacheTemplate {

    private final RedisTemplate redisTemplate;

    /**
     * Cache Aside 模式：读多写少场景
     * 读：缓存命中返回，未命中查 DB 并写入缓存
     * 写：先更新 DB，再删除缓存（不是更新缓存）
     */
    public <T> T query(String key, Supplier<T> dbLoader, Class<T> type, long ttl) {
        // 1. 先查缓存
        T cached = redisTemplate.opsForValue().get(key);
        if (cached != null) {
            return cached;
        }

        // 2. 缓存未命中，查数据库
        T result = dbLoader.get();
        if (result != null) {
            // 3. 写入缓存（设置过期时间，防止雪崩）
            redisTemplate.opsForValue().set(key, result, ttl + ThreadLocalRandom.current().nextLong(10000));
        }

        return result;
    }
}
```

### Redis 优化

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 连接池配置 | JedisPool / Lettuce 连接池参数 | ⭐⭐⭐ |
| [ ] 序列化方式 | JSON / JDK / ProtoBuf 效率对比 | ⭐⭐ |
| [ ] 大 key 处理 | 拆分大 Hash / 大 List | ⭐⭐ |
| [ ] 热 key 处理 | 打散到多个节点，本地缓存兜底 | ⭐⭐ |
| [ ] Pipeline 使用 | 批量操作减少网络往返 | ⭐⭐ |
| [ ] Lua 脚本 | 保证原子性操作 | ⭐⭐ |

```java
// 大 key 拆分示例
// 原始：大 Hash 存储用户信息，key 膨胀
// 优化：拆分为多个小 Hash

// 优化前
redisTemplate.opsForHash().putAll("user:10001", userMap); // 一个 hash 存所有字段

// 优化后：按字段分组
redisTemplate.opsForHash().put("user:10001:profile", "name", "张三");
redisTemplate.opsForHash().put("user:10001:profile", "avatar", "url");
redisTemplate.opsForHash().put("user:10001:stats", "followers", "1000");
redisTemplate.opsForHash().put("user:10001:stats", "following", "500");
```

## 代码优化 Checklist

### 集合操作

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 集合初始化容量 | HashMap/ArrayList 预设容量 | ⭐⭐ |
| [ ] 遍历方式 | fori / forEach / iterator 效率对比 | ⭐ |
| [ ] 集合类型选择 | HashMap vs ConcurrentHashMap | ⭐⭐ |
| [ ] 避免在循环中 new 对象 | 对象池复用 | ⭐⭐ |

```java
// 集合初始化容量预估
// HashMap: 期望元素数 / 0.75 + 1
Map<String, String> map = new HashMap<>(133); // 预估存 100 个元素

// ArrayList: 预估容量
List<String> list = new ArrayList<>(1000);

// 避免在循环中创建对象
public class ObjectPool {
    private static final ThreadLocal<StringBuilder> BUFFER = ThreadLocal.withInitial(StringBuilder::new);

    public String join(List<String> parts) {
        StringBuilder sb = BUFFER.get();
        sb.setLength(0); // 复用 StringBuilder
        for (String part : parts) {
            if (sb.length() > 0) sb.append(",");
            sb.append(part);
        }
        return sb.toString();
    }
}
```

### 字符串操作

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] String 拼接 | 循环内用 StringBuilder | ⭐⭐ |
| [ ] 字符串判空 | 用 Apache Commons StringUtils | ⭐ |
| [ ] 正则表达式 | Pattern 预编译 | ⭐⭐ |

```java
// Pattern 预编译
public class RegexPatterns {
    // 预编译正则表达式
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
        "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$");

    private static final Pattern PHONE_PATTERN = Pattern.compile(
        "^1[3-9]\\d{9}$");

    public static boolean isValidEmail(String email) {
        return EMAIL_PATTERN.matcher(email).matches();
    }
}
```

### 并发编程

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 锁粒度 | 减小 synchronized 范围 | ⭐⭐⭐ |
| [ ] 锁选择 | synchronized vs ReentrantLock | ⭐⭐ |
| [ ] ThreadLocal 清理 | 使用完及时 remove | ⭐⭐ |
| [ ] 线程池配置 | 核心线程数、最大线程数、队列选择 | ⭐⭐⭐ |
| [ ] 避免死锁 | 统一加锁顺序 | ⭐⭐⭐ |

```java
// 线程池配置示例
public class ThreadPoolConfig {

    public static ExecutorService createIOIntensivePool() {
        // IO 密集型：线程数 = CPU 核心数 * 2
        int cores = Runtime.getRuntime().availableProcessors();
        return new ThreadPoolExecutor(
            cores * 2,           // 核心线程数
            cores * 4,           // 最大线程数
            60, TimeUnit.SECONDS, // 空闲线程存活时间
            new LinkedBlockingQueue<>(1000), // 队列容量
            new ThreadFactoryBuilder().setNameFormat("io-pool-%d").build(),
            new ThreadPoolExecutor.CallerRunsPolicy() // 拒绝策略：调用者执行
        );
    }

    public static ExecutorService createCPUIntensivePool() {
        // CPU 密集型：线程数 = CPU 核心数 + 1
        int cores = Runtime.getRuntime().availableProcessors();
        return new ThreadPoolExecutor(
            cores + 1,
            cores + 1,
            0, TimeUnit.MILLISECONDS,
            new LinkedBlockingQueue<>(),
            new ThreadFactoryBuilder().setNameFormat("cpu-pool-%d").build()
        );
    }
}
```

## JVM 优化 Checklist

### 内存配置

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 堆大小配置 | -Xms = -Xmx 生产环境建议 | ⭐⭐⭐ |
| [ ] 新生代/老年代比例 | -XX:NewRatio 默认 2 | ⭐⭐ |
| [ ] Eden/Survivor 比例 | -XX:SurvivorRatio 默认 8 | ⭐⭐ |
| [ ] 大对象直接进入老年代 | -XX:PretenureSizeThreshold | ⭐⭐ |

```bash
# JVM 内存配置示例
JAVA_OPTS="-Xms4g -Xmx4g \
  -XX:NewRatio=2 \
  -XX:SurvivorRatio=8 \
  -XX:MaxTenuringThreshold=15 \
  -XX:PretenureSizeThreshold=2m \
  -XX:+UseG1GC"
```

### GC 配置

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] GC 日志 | -Xlog:gc 开启日志 | ⭐⭐ |
| [ ] GC 频率监控 | FGC 过于频繁需要优化 | ⭐⭐⭐ |
| [ ] GC 时间监控 | Major GC 时间过长需要优化 | ⭐⭐⭐ |
| [ ] GC 选择 | G1 / ZGC / Shenandoah | ⭐⭐ |

### 常用 JVM 诊断命令

```bash
# 查看 JVM 内存使用
jmap -heap <pid>

# 查看对象分布
jmap -histo <pid> | head -30

# 生成堆 dump（内存溢出时）
jmap -dump:format=b,file=heap.hprof <pid>

# 查看 GC 情况
jstat -gcutil <pid> 1000

# JVM 参数检查
jinfo -flags <pid>
```

## 网络优化 Checklist

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] HTTP 连接池 | RestTemplate / OkHttp 连接池配置 | ⭐⭐ |
| [ ] 连接超时 | 设置合理的超时时间 | ⭐⭐ |
| [ ] DNS 缓存 | 应用层 DNS 缓存 | ⭐ |
| [ ] 长连接 | HTTP/2、WebSocket 等 | ⭐⭐ |
| [ ] 连接复用 | HTTP Keep-Alive | ⭐⭐ |

```java
// OkHttp 连接池配置
public class OkHttpClientFactory {

    public static OkHttpClient create() {
        // 连接池：最大空闲连接数 5，存活时间 5 分钟
        ConnectionPool pool = new ConnectionPool(
            5,              // 最大空闲连接数
            5, TimeUnit.MINUTES, // 空闲连接存活时间
            true
        );

        return new OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)    // 连接超时
            .readTimeout(30, TimeUnit.SECONDS)        // 读取超时
            .writeTimeout(30, TimeUnit.SECONDS)       // 写入超时
            .connectionPool(pool)                     // 连接池
            .retryOnConnectionFailure(true)          // 失败重试
            .build();
    }
}
```

## 日志优化 Checklist

| 检查项 | 说明 | 优先级 |
|-------|------|-------|
| [ ] 日志级别 | 生产环境 INFO/WARN | ⭐⭐ |
| [ ] 异步日志 | Log4j2 AsyncLogger | ⭐⭐ |
| [ ] 日志格式 | 避免字符串拼接 | ⭐ |
| [ ] 敏感信息 | 日志脱敏 | ⭐⭐⭐ |
| [ ] 日志滚动 | 按大小/时间滚动 | ⭐⭐ |

```java
// SLF4J 参数化日志（避免字符串拼接）
private static final Logger log = LoggerFactory.getLogger(Service.class);

// 低效写法：字符串拼接
log.debug("用户 " + userId + " 登录成功");

// 高效写法：参数化日志（未达 DEBUG 级别时不拼接）
log.debug("用户 {} 登录成功", userId);
```

## 总结

性能优化不是一蹴而就的，是一个持续迭代的过程。

这份 checklist 不是一次性检查完，而是：

1. **优化前**：对照检查，制定优化计划
2. **优化后**：验证效果，确保真的优化了
3. **日常巡检**：定期检查，防止性能退化

记住：**测量驱动优化，不要凭直觉优化。**

---

## 思考题

1. 对照这份 checklist，你最近做的项目，有多少项是「未检查」的？这些未检查项中，哪些最可能成为性能瓶颈？

2. 假设你只能优化 3 个点，你会选哪 3 个？为什么？

3. 性能优化完成后，如何防止代码演进过程中性能退化？有没有机制可以自动检测？
