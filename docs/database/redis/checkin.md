# Redis 签到系统：用户活跃度统计

你有没有见过这种功能：

> 「每日签到」
> 「连续签到 7 天获得奖励」
> 「本月签到天数统计」

这些功能是怎么实现的？

**Redis BitMap** 就是签到系统的秘密武器。

## 为什么用 BitMap 做签到？

假设有 1000 万用户，每天签到记录需要多少空间？

| 方案 | 空间 |
|------|------|
| 关系数据库（每天一条记录） | 1000 万条/天 |
| Set（每天一个 Set） | 每天约 10MB |
| BitMap | **每天约 1.2MB** |

计算公式：`10000000 用户 ÷ 8 位/字节 ÷ 1024 ÷ 1024 ≈ 1.2 MB`

## BitMap 签到原理

```
用户 ID：0, 1, 2, 3, 4, 5, 6, 7, ...
Bit 位：   1, 0, 1, 1, 0, 1, 0, 0, ...
           ↑                   ↑
         用户 0 签到           用户 2 签到

用户 0 的签到状态：bit[0] = 1
用户 1 的签到状态：bit[1] = 0
用户 2 的签到状态：bit[2] = 1
```

## 基础签到功能

### 数据模型

```java
public class SignInService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 用户签到
     */
    public boolean signIn(String userId, LocalDate date) {
        // key: user:sign:{userId}
        // offset: 距离基准日期的天数
        String key = "user:sign:" + userId;
        long offset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), date);

        // SETBIT 返回旧值
        Long oldValue = jedis.setbit(key, offset, true);

        // 如果旧值已经是 1，说明今天已经签到
        return oldValue != 1;
    }

    /**
     * 检查用户是否签到
     */
    public boolean isSigned(String userId, LocalDate date) {
        String key = "user:sign:" + userId;
        long offset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), date);

        return jedis.getbit(key, offset);
    }

    /**
     * 获取用户签到次数
     */
    public long getSignInCount(String userId) {
        String key = "user:sign:" + userId;
        return jedis.bitcount(key);
    }
}
```

## 连续签到计算

### 计算连续签到天数

```java
public class ContinuousSignInService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 计算连续签到天数
     */
    public int getContinuousDays(String userId) {
        String key = "user:sign:" + userId;

        // 从今天往前数
        LocalDate today = LocalDate.now();
        int count = 0;
        long offset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), today);

        // 逐位检查
        while (jedis.getbit(key, offset - count)) {
            count++;
        }

        return count;
    }

    /**
     * 计算本月连续签到天数
     */
    public int getMonthContinuousDays(String userId) {
        String key = "user:sign:" + userId;

        LocalDate today = LocalDate.now();
        LocalDate monthStart = today.withDayOfMonth(1);

        long startOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), monthStart);
        long todayOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), today);

        int count = 0;
        for (long i = todayOffset; i >= startOffset; i--) {
            if (jedis.getbit(key, i)) {
                count++;
            } else {
                break;
            }
        }

        return count;
    }
}
```

## 签到排行榜

### 按签到天数排名

```java
public class SignInRankingService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录用户签到（使用有序集合）
     */
    public void recordSignIn(String userId) {
        LocalDate today = LocalDate.now();

        // 有序集合：key = "sign:ranking:{date}"，分数 = 签到天数
        String rankingKey = "sign:ranking:" + today;
        String monthKey = "sign:ranking:" +
            today.getYear() + "-" + today.getMonthValue();

        // 更新今日排名
        jedis.zincrby(rankingKey, 1, userId);

        // 更新本月排名
        jedis.zincrby(monthKey, 1, userId);

        // 设置过期时间
        jedis.expire(rankingKey, 86400 * 2);  // 2 天过期
        jedis.expire(monthKey, 86400 * 35);  // 35 天过期
    }

    /**
     * 获取今日签到排行榜
     */
    public List&lt;UserRank&gt; getTodayRanking(int topN) {
        String key = "sign:ranking:" + LocalDate.now();
        return getRanking(key, topN);
    }

    /**
     * 获取本月签到排行榜
     */
    public List&lt;UserRank&gt; getMonthRanking(int topN) {
        LocalDate today = LocalDate.now();
        String key = "sign:ranking:" +
            today.getYear() + "-" + today.getMonthValue();
        return getRanking(key, topN);
    }

    private List&lt;UserRank&gt; getRanking(String key, int topN) {
        // 按分数降序
        Set&lt;ZSet.Tuple&gt; results =
            jedis.zrevrangeWithScores(key, 0, topN - 1);

        List&lt;UserRank&gt; rankings = new ArrayList&lt;&gt;();
        int rank = 1;

        for (ZSet.Tuple tuple : results) {
            rankings.add(new UserRank(
                tuple.getValue(),
                (int) tuple.getScore(),
                rank++
            ));
        }

        return rankings;
    }

    /**
     * 获取用户排名
     */
    public Integer getUserRank(String userId) {
        LocalDate today = LocalDate.now();
        String key = "sign:ranking:" + today;

        Long rank = jedis.zrevrank(key, userId);
        return rank != null ? rank.intValue() + 1 : null;
    }
}
```

## 签到统计

### 月度签到统计

```java
public class SignInStatsService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 获取月度签到统计
     */
    public MonthlySignInStats getMonthlyStats(String userId, int year, int month) {
        String key = "user:sign:" + userId;
        LocalDate monthStart = LocalDate.of(year, month, 1);
        LocalDate monthEnd = monthStart.plusMonths(1).minusDays(1);

        long startOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), monthStart);
        long endOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), monthEnd);

        // 获取整月的签到情况
        String[] keys = {key};
        long[] offsets = new long[(int) (endOffset - startOffset + 1)];
        BitArray expected = new BitArray((int) (endOffset - startOffset + 1));

        for (int i = 0; i < offsets.length; i++) {
            offsets[i] = startOffset + i;
        }

        // 计算本月签到天数
        long signInDays = jedis.bitcount(key, startOffset, endOffset);

        // 计算连续签到天数
        int continuousDays = 0;
        for (long i = endOffset; i >= startOffset; i--) {
            if (jedis.getbit(key, i)) {
                continuousDays++;
            } else {
                break;
            }
        }

        return new MonthlySignInStats(signInDays, continuousDays, year, month);
    }

    /**
     * 获取用户签到日历
     */
    public List&lt;LocalDate&gt; getSignInCalendar(String userId, int year, int month) {
        String key = "user:sign:" + userId;
        LocalDate monthStart = LocalDate.of(year, month, 1);
        LocalDate monthEnd = monthStart.plusMonths(1).minusDays(1);

        long startOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), monthStart);
        long endOffset = ChronoUnit.DAYS.between(
            LocalDate.of(2020, 1, 1), monthEnd);

        List&lt;LocalDate&gt; signInDates = new ArrayList&lt;&gt;();

        for (long i = startOffset; i <= endOffset; i++) {
            if (jedis.getbit(key, i)) {
                signInDates.add(LocalDate.of(2020, 1, 1).plusDays(i));
            }
        }

        return signInDates;
    }
}
```

## 完整签到系统

### 签到服务

```java
@Service
public class SignInSystem {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private SignInService signInService;
    private ContinuousSignInService continuousService;
    private SignInRankingService rankingService;

    /**
     * 执行签到
     */
    public SignInResult signIn(String userId) {
        LocalDate today = LocalDate.now();

        // 检查今天是否已签到
        if (signInService.isSigned(userId, today)) {
            return new SignInResult(false, "今天已经签到过了");
        }

        // 执行签到
        signInService.signIn(userId, today);

        // 更新排行榜
        rankingService.recordSignIn(userId);

        // 计算连续签到天数
        int continuousDays = continuousService.getContinuousDays(userId);

        // 计算本月签到天数
        long monthDays = signInService.getSignInCount(userId);

        // 检查奖励
        String reward = checkReward(continuousDays);

        return new SignInResult(true, continuousDays, monthDays, reward);
    }

    /**
     * 检查奖励
     */
    private String checkReward(int continuousDays) {
        if (continuousDays == 7) {
            return "连续签到 7 天，获得奖励 A";
        } else if (continuousDays == 30) {
            return "连续签到 30 天，获得奖励 B";
        } else if (continuousDays % 7 == 0) {
            return "连续签到 " + continuousDays + " 天，获得奖励";
        }
        return null;
    }

    /**
     * 获取签到状态
     */
    public SignInStatus getSignInStatus(String userId) {
        LocalDate today = LocalDate.now();

        boolean signedToday = signInService.isSigned(userId, today);
        int continuousDays = continuousService.getContinuousDays(userId);

        return new SignInStatus(signedToday, continuousDays);
    }
}
```

### 签到数据模型

```java
public class SignInResult {
    private boolean success;
    private String message;
    private int continuousDays;
    private long monthDays;
    private String reward;

    public SignInResult(boolean success, String message) {
        this.success = success;
        this.message = message;
    }

    public SignInResult(boolean success, int continuousDays,
                       long monthDays, String reward) {
        this.success = success;
        this.continuousDays = continuousDays;
        this.monthDays = monthDays;
        this.reward = reward;
        this.message = "签到成功";
    }
}

public class SignInStatus {
    private boolean signedToday;
    private int continuousDays;

    public SignInStatus(boolean signedToday, int continuousDays) {
        this.signedToday = signedToday;
        this.continuousDays = continuousDays;
    }
}

public class MonthlySignInStats {
    private long signInDays;
    private int continuousDays;
    private int year;
    private int month;

    public MonthlySignInStats(long signInDays, int continuousDays,
                              int year, int month) {
        this.signInDays = signInDays;
        this.continuousDays = continuousDays;
        this.year = year;
        this.month = month;
    }
}
```

## 签到系统优化

### 1. 使用 BitMap 统计全站签到

```java
public class SiteWideSignInStats {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 记录用户签到（全站点 BitMap）
     */
    public void recordUserSignIn(String userId, LocalDate date) {
        String key = "sign:sitewide:" + date;
        // userId 转成数字
        long userIdNum = Long.parseLong(userId);
        jedis.setbit(key, userIdNum, true);
    }

    /**
     * 获取某天签到人数
     */
    public long getSignInCount(LocalDate date) {
        String key = "sign:sitewide:" + date;
        return jedis.bitcount(key);
    }

    /**
     * 获取多天活跃人数
     */
    public long getMultiDayActiveCount(LocalDate... dates) {
        if (dates.length == 0) {
            return 0;
        }

        String[] keys = new String[dates.length];
        for (int i = 0; i < dates.length; i++) {
            keys[i] = "sign:sitewide:" + dates[i];
        }

        // BITOP AND 计算多天同时签到的人数
        String destKey = "sign:temp:" + System.currentTimeMillis();
        jedis.bitop(BitOP.AND, destKey, keys);

        long count = jedis.bitcount(destKey);
        jedis.del(destKey);

        return count;
    }
}
```

### 2. 异步记录签到日志

```java
public class AsyncSignInLogger {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 异步记录签到日志
     */
    public void logSignInAsync(String userId, LocalDate date) {
        // 使用 List 存储日志
        String key = "log:signin:" + date;

        Map&lt;String, String&gt; log = new HashMap&lt;&gt;();
        log.put("userId", userId);
        log.put("timestamp", String.valueOf(System.currentTimeMillis()));
        log.put("date", date.toString());

        jedis.lpush(key, JSON.toJSONString(log));
    }
}
```

## 面试追问方向

1. **BitMap 签到如何处理大量用户的查询性能？**

   每个用户的签到数据是独立的，不存在热点问题。如果需要统计全站点签到人数，可以使用 BitMap 按天存储所有人的签到状态，通过 BITCOUNT 快速统计。

2. **BitMap 签到的缺点是什么？**

   - userId 必须是数字（或可以映射到数字）
   - 如果 userId 跨度很大（如手机号），会浪费大量空间
   - 需要提前预估用户量，预分配空间

---

**核心记忆点**：Redis BitMap 是签到系统的理想选择，每个用户每天只需 1 bit 空间。通过 SETBIT 签到、GETBIT 检查、BITCOUNT 统计。可以结合有序集合实现排行榜功能。
