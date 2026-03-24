# Redis UV 统计：海量用户统计

你有没有见过这种统计：

> 「今日 UV：1,234,567」
> 「本周 UV：5,678,901」
> 「本月 UV：12,345,678」

UV（Unique Visitor）是指独立访客数。

如果用传统数据库存储每个访问记录，可能需要每天存储上千万条数据。

**Redis HyperLogLog** 可以用 **12KB 的内存**统计出精确度 **99%** 的 UV。

## 为什么用 HyperLogLog？

| 方案 | 内存占用 | 精度 | 性能 |
|------|---------|------|------|
| 精确去重（Set） | 用户数/8 字节 | 100% | 慢 |
| HyperLogLog | 固定 12KB | 99% | 快 |

HyperLogLog 通过概率算法，用固定的空间换取可接受的误差。

## 基本使用

### 添加访问记录

```java
public class UVStatisticsService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录访问
     */
    public long addVisitor(String date, String visitorId) {
        // PFADD key visitorId
        // 返回 1 表示新增加，0 表示已存在
        String key = "uv:" + date;
        return jedis.pfadd(key, visitorId);
    }

    /**
     * 记录访问（带时间粒度）
     */
    public void addVisitor(LocalDateTime dateTime, String visitorId) {
        // 按小时统计
        String key = String.format("uv:%s:%02d",
            dateTime.toLocalDate(),
            dateTime.getHour());
        jedis.pfadd(key, visitorId);
    }
}
```

### 统计 UV

```java
    /**
     * 获取日 UV
     */
    public long getDailyUV(LocalDate date) {
        String key = "uv:" + date;
        return jedis.pfcount(key);
    }

    /**
     * 获取小时 UV
     */
    public long getHourlyUV(LocalDate date, int hour) {
        String key = String.format("uv:%s:%02d", date, hour);
        return jedis.pfcount(key);
    }
```

## 合并统计

### 多天 UV 合并

```java
    /**
     * 合并多天 UV
     */
    public long getMergedUV(LocalDate... dates) {
        if (dates == null || dates.length == 0) {
            return 0;
        }

        String[] keys = new String[dates.length];
        for (int i = 0; i < dates.length; i++) {
            keys[i] = "uv:" + dates[i];
        }

        String destKey = "uv:merged:" + System.currentTimeMillis();

        // PFMERGE 合并多个 HyperLogLog
        jedis.pfmerge(destKey, keys);

        long count = jedis.pfcount(destKey);

        // 删除临时 key
        jedis.del(destKey);

        return count;
    }

    /**
     * 获取周 UV
     */
    public long getWeeklyUV(LocalDate endDate) {
        LocalDate startDate = endDate.minusDays(6);
        LocalDate[] dates = new LocalDate[7];

        for (int i = 0; i < 7; i++) {
            dates[i] = startDate.plusDays(i);
        }

        return getMergedUV(dates);
    }

    /**
     * 获取月 UV
     */
    public long getMonthlyUV(int year, int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        LocalDate end = start.plusMonths(1).minusDays(1);

        int days = end.getDayOfMonth();
        LocalDate[] dates = new LocalDate[days];

        for (int i = 0; i < days; i++) {
            dates[i] = start.plusDays(i);
        }

        return getMergedUV(dates);
    }
```

## 实时 UV 统计

### 完整统计服务

```java
@Service
public class RealTimeUVService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录访问
     */
    public void recordAccess(String visitorId) {
        LocalDateTime now = LocalDateTime.now();
        LocalDate date = now.toLocalDate();
        int hour = now.getHour();

        // 记录到多个粒度
        String dailyKey = "uv:daily:" + date;
        String hourlyKey = "uv:hourly:" + date + ":" + hour;

        jedis.pfadd(dailyKey, visitorId);
        jedis.pfadd(hourlyKey, visitorId);

        // 设置过期时间
        jedis.expire(dailyKey, 86400 * 35);  // 保留 35 天
        jedis.expire(hourlyKey, 86400 * 2);   // 保留 48 小时
    }

    /**
     * 获取实时 UV
     */
    public UVStats getCurrentUV() {
        LocalDate today = LocalDate.now();
        LocalDateTime now = LocalDateTime.now();

        long todayUV = getDailyUV(today);
        long thisHourUV = getHourlyUV(today, now.getHour());
        long yesterdayUV = getDailyUV(today.minusDays(1));
        long thisWeekUV = getWeeklyUV(today);
        long thisMonthUV = getMonthlyUV(
            today.getYear(), today.getMonthValue());

        return new UVStats(todayUV, thisHourUV, yesterdayUV,
            thisWeekUV, thisMonthUV);
    }

    private long getDailyUV(LocalDate date) {
        return jedis.pfcount("uv:daily:" + date);
    }

    private long getHourlyUV(LocalDate date, int hour) {
        return jedis.pfcount("uv:hourly:" + date + ":" + hour);
    }

    private long getWeeklyUV(LocalDate endDate) {
        LocalDate start = endDate.minusDays(6);
        String[] keys = new String[7];
        for (int i = 0; i < 7; i++) {
            keys[i] = "uv:daily:" + start.plusDays(i);
        }
        return mergeAndCount(keys);
    }

    private long getMonthlyUV(int year, int month) {
        LocalDate start = LocalDate.of(year, month, 1);
        int days = start.plusMonths(1).minusDays(1).getDayOfMonth();
        String[] keys = new String[days];
        for (int i = 0; i < days; i++) {
            keys[i] = "uv:daily:" + start.plusDays(i);
        }
        return mergeAndCount(keys);
    }

    private long mergeAndCount(String[] keys) {
        String destKey = "uv:merge:" + System.currentTimeMillis();
        jedis.pfmerge(destKey, keys);
        long count = jedis.pfcount(destKey);
        jedis.del(destKey);
        return count;
    }
}
```

### UV 统计结果

```java
public class UVStats {
    private long todayUV;
    private long thisHourUV;
    private long yesterdayUV;
    private long thisWeekUV;
    private long thisMonthUV;

    public UVStats(long todayUV, long thisHourUV, long yesterdayUV,
                   long thisWeekUV, long thisMonthUV) {
        this.todayUV = todayUV;
        this.thisHourUV = thisHourUV;
        this.yesterdayUV = yesterdayUV;
        this.thisWeekUV = thisWeekUV;
        this.thisMonthUV = thisMonthUV;
    }
}
```

## 用户行为分析

### 访问深度统计

```java
public class UserBehaviorAnalyzer {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录用户访问页面
     */
    public void recordPageView(String visitorId, String pageId) {
        String key = "pageviews:" + LocalDate.now();

        // 记录用户访问了哪些页面
        String userPagesKey = "user:pages:" + visitorId;
        jedis.sadd(userPagesKey, pageId);
        jedis.expire(userPagesKey, 86400 * 2);

        // 记录页面的访问量
        String pageViewsKey = "page:views:" + pageId;
        jedis.pfadd(pageViewsKey, visitorId);
    }

    /**
     * 获取页面 UV
     */
    public long getPageUV(String pageId) {
        String key = "page:views:" + pageId;
        return jedis.pfcount(key);
    }

    /**
     * 获取用户访问页面数
     */
    public long getUserPageCount(String visitorId) {
        String key = "user:pages:" + visitorId;
        return jedis.scard(key);
    }
}
```

### 来源统计

```java
public class SourceAnalyzer {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录访问来源
     */
    public void recordSource(String visitorId, String source) {
        String key = "uv:source:" + source + ":" + LocalDate.now();
        jedis.pfadd(key, visitorId);
        jedis.expire(key, 86400 * 35);
    }

    /**
     * 获取来源 UV 统计
     */
    public Map&lt;String, Long&gt; getSourceUVStats() {
        Map&lt;String, Long&gt; stats = new LinkedHashMap&lt;&gt;();
        String pattern = "uv:source:*:" + LocalDate.now();

        Set&lt;String&gt; keys = jedis.keys(pattern);
        for (String key : keys) {
            String source = key.split(":")[2];
            long uv = jedis.pfcount(key);
            stats.put(source, uv);
        }

        return stats;
    }
}
```

## HyperLogLog 原理（简述）

### 概率算法

```
HyperLogLog 基于一个有趣的数学现象：

抛硬币，记录连续正面出现的最大次数。

如果只抛 1 次，平均最大连续正面 ≈ 1
如果抛 2 次，平均最大连续正面 ≈ 1.5
如果抛 4 次，平均最大连续正面 ≈ 2
如果抛 2^n 次，平均最大连续正面 ≈ n

利用这个原理：
1. 对每个用户 ID 做哈希
2. 统计哈希值二进制中「连续 0」的最大长度
3. 估计独立用户数 ≈ 2^max_zero_count
```

### Redis 的实现

Redis 使用 **64 位哈希**，分成 **2^14 = 16384 个桶**。

每个桶记录该桶内所有哈希值中「连续 0」的最大长度。

最终计数公式：`UV ≈ 纠正系数 × 16384 × 2^avg(max_zero_count)`

## 性能对比

```java
public class PerformanceComparison {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 对比 HyperLogLog 和 Set 的内存占用
     */
    public void memoryComparison() {
        // 模拟 100 万用户
        int userCount = 1000000;

        // 使用 HyperLogLog
        String hllKey = "test:hll:" + System.currentTimeMillis();
        for (int i = 0; i < userCount; i++) {
            jedis.pfadd(hllKey, "user_" + i);
        }
        long hllMemory = estimateMemory(hllKey);
        long hllUV = jedis.pfcount(hllKey);

        // 使用 Set
        String setKey = "test:set:" + System.currentTimeMillis();
        for (int i = 0; i < userCount; i++) {
            jedis.sadd(setKey, "user_" + i);
        }
        long setMemory = estimateMemory(setKey);
        long setSize = jedis.scard(setKey);

        System.out.println("HyperLogLog:");
        System.out.println("  UV: " + hllUV);
        System.out.println("  Memory: " + hllMemory + " bytes");

        System.out.println("Set:");
        System.out.println("  Size: " + setSize);
        System.out.println("  Memory: " + setMemory + " bytes");

        System.out.println("Memory saved: " +
            (1 - (double) hllMemory / setMemory) * 100 + "%");

        // 清理
        jedis.del(hllKey, setKey);
    }

    private long estimateMemory(String key) {
        // 通过 OBJECT MEMORY USAGE 估算
        // 需要 Redis 4.0+
        Object memory = jedis.objectEncoding(key);
        // 简化实现
        return jedis.dbSize() * 50;  // 粗略估算
    }
}
```

## 面试追问方向

1. **HyperLogLog 的误差率是怎么产生的？**

   HyperLogLog 使用概率算法，通过哈希值的比特位来估计基数。误差主要来源于哈希碰撞和概率估计的偏差。标准误差约为 0.81%，这是可以接受的范围。

2. **HyperLogLog 和 BitMap 有什么区别？**

   BitMap 适用于 ID 是数字（或可以映射到数字）的场景，精度 100%；HyperLogLog 适用于 ID 是字符串的场景，精度约 99%，但内存固定 12KB。BitMap 适合活跃用户统计，HyperLogLog 适合 UV 统计。

---

**核心记忆点**：Redis HyperLogLog 使用固定 12KB 内存统计独立用户数，精度约 99%。通过 PFADD 添加用户、PFCOUNT 统计、PMERGE 合并多天数据。适合日活、月活、UV 统计等场景。
