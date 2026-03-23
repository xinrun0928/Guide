# 设计排行榜/热搜系统

你打开微博热搜，看到「某明星离婚」排第一，2.3 亿人正在讨论。

你打开抖音热榜，看到某个视频 500 万赞，稳居榜首。

你打开游戏排行榜，看到全服前 100 名玩家的实时排名。

这些功能背后，都是**排行榜系统**在支撑。

今天，我们来深入探讨如何设计一个高性能的排行榜系统。

---

## 一、需求分析

### 1.1 功能需求

```
┌─────────────────────────────────────────────────────────┐
│                    排行榜系统功能                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. 实时排名                                          │
│     用户积分变化 → 实时更新排名 → 立即可见              │
│                                                         │
│  2. 历史快照                                          │
│     每日/每周/每月存档 → 查看历史排名                  │
│                                                         │
│  3. 多维度排行                                        │
│     活跃榜、财富榜、战力榜... → 不同维度独立排名        │
│                                                         │
│  4. 周边数据                                          │
│     查看排名详情 → 同段位玩家 → 上升下降趋势           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 非功能需求

- **实时性**：积分变化后 1 秒内可见
- **高并发**：峰值 10 万 QPS
- **数据准确**：Top 100 必须精确，尾部可以允许误差
- **低延迟**：读取 < 50ms

---

## 二、容量估算

```java
/**
 * 排行榜系统容量估算
 */
public class RankingCapacityEstimation {
    
    public static void main(String[] args) {
        // 假设条件
        long totalUsers = 100_000_000;     // 1 亿用户
        long dailyActiveUsers = 10_000_000; // 1 千万日活
        long scoreUpdateQPS = 100_000;     // 每秒 10 万次积分更新
        
        // 存储估算
        // 每个用户需要存储：userId(8) + score(8) + rank(4) + metadata(32)
        long bytesPerUser = 56;
        long totalStorageGB = totalUsers * bytesPerUser / (1024L * 1024L * 1024L);
        
        System.out.println("总存储量: " + totalStorageGB + " GB");  // 约 5.5 GB
        
        // 读取 QPS
        // 假设每个活跃用户每分钟查看 5 次排行榜
        long readQPS = dailyActiveUsers * 5 / 60;
        System.out.println("读 QPS: " + readQPS);  // 约 83 万
    }
}
```

---

## 三、核心数据结构

### 3.1 有序集合（Sorted Set）

Redis 的 ZSet 是排行榜系统的核心数据结构。

```java
/**
 * 基于 Redis ZSet 的排行榜实现
 */
public class RedisRankingService {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 添加/更新用户分数
     * 
     * ZADD key score member
     * 时间复杂度：O(log(N))
     * 
     * 为什么用 O(log(N)) 而不是 O(1)？
     * 因为需要维护有序结构
     */
    public void updateScore(String rankingKey, long userId, double score) {
        String key = "ranking:" + rankingKey;
        redis.opsForZSet().add(key, String.valueOf(userId), score);
    }
    
    /**
     * 获取用户排名（从大到小）
     * 
     * ZREVRANK key member
     * 时间复杂度：O(log(N))
     * 
     * 注意：排名从 0 开始，第 1 名返回 0
     */
    public Long getUserRank(String rankingKey, long userId) {
        String key = "ranking:" + rankingKey;
        return redis.opsForZSet().reverseRank(key, String.valueOf(userId));
    }
    
    /**
     * 获取 Top N 用户
     * 
     * ZREVRANGE key start stop WITHSCORES
     * 时间复杂度：O(log(N) + M)，M 为返回的元素数量
     */
    public List<RankingEntry> getTopN(String rankingKey, int n) {
        String key = "ranking:" + rankingKey;
        
        Set<ZSetOperations.TypedTuple<String>> results = 
            redis.opsForZSet().reverseRangeWithScores(key, 0, n - 1);
        
        List<RankingEntry> entries = new ArrayList<>();
        int rank = 1;
        for (ZSetOperations.TypedTuple<String> tuple : results) {
            entries.add(new RankingEntry(
                rank++,
                Long.parseLong(tuple.getValue()),
                tuple.getScore()
            ));
        }
        
        return entries;
    }
    
    /**
     * 获取用户周围的排名
     * 
     * 查询用户排名，然后获取前后若干名
     */
    public List<RankingEntry> getAroundUser(String rankingKey, long userId, int range) {
        String key = "ranking:" + rankingKey;
        
        // 获取用户排名
        Long userRank = getUserRank(rankingKey, userId);
        if (userRank == null) {
            return Collections.emptyList();
        }
        
        // 获取前后 range 名的用户
        long start = Math.max(0, userRank - range);
        long end = userRank + range;
        
        Set<ZSetOperations.TypedTuple<String>> results = 
            redis.opsForZSet().reverseRangeWithScores(key, start, end);
        
        List<RankingEntry> entries = new ArrayList<>();
        int rank = (int) start + 1;
        for (ZSetOperations.TypedTuple<String> tuple : results) {
            entries.add(new RankingEntry(
                rank++,
                Long.parseLong(tuple.getValue()),
                tuple.getScore()
            ));
        }
        
        return entries;
    }
}
```

### 3.2 分数变化处理

```java
/**
 * 分数变化处理
 */
public class ScoreUpdateService {
    
    private RedisTemplate<String, String> redis;
    
    /**
     * 增加用户分数
     * 
     * ZINCRBY key increment member
     * 时间复杂度：O(log(N))
     */
    public double incrementScore(String rankingKey, long userId, double delta) {
        String key = "ranking:" + rankingKey;
        return redis.opsForZSet().incrementScore(key, String.valueOf(userId), delta);
    }
    
    /**
     * 批量更新分数（使用 Redis Pipeline）
     * 
     * 适用场景：每天凌晨重置排行榜，需要批量写入大量数据
     */
    public void batchUpdateScores(String rankingKey, Map<Long, Double> scores) {
        String key = "ranking:" + rankingKey;
        
        RedisCallback<Object> callback = connection -> {
            for (Map.Entry<Long, Double> entry : scores.entrySet()) {
                connection.zSetCommands().zAdd(
                    key.getBytes(),
                    entry.getValue(),
                    String.valueOf(entry.getKey()).getBytes()
                );
            }
            return null;
        };
        
        redis.executePipelined(callback);
    }
    
    /**
     * 删除用户（离开游戏等情况）
     */
    public void removeUser(String rankingKey, long userId) {
        String key = "ranking:" + rankingKey;
        redis.opsForZSet().remove(key, String.valueOf(userId));
    }
}
```

---

## 四、进阶设计

### 4.1 多维度排行榜

```java
/**
 * 多维度排行榜
 */
public class MultiDimensionRanking {
    
    /**
     * 排行榜维度定义
     */
    public static class RankingDimension {
        public static final String ACTIVE = "active";      // 活跃榜
        public static final String WEALTH = "wealth";      // 财富榜
        public static final String POWER = "power";         // 战力榜
        public static final String LIKE = "like";          // 点赞榜
    }
    
    /**
     * 更新多维度分数
     * 
     * 用户做了一个动作，需要更新多个维度的分数
     */
    public void updateMultiDimension(long userId, ScoreUpdate update) {
        // 1. 更新活跃分
        rankingService.incrementScore(RankingDimension.ACTIVE, 
            userId, update.getActiveDelta());
        
        // 2. 更新财富分（如果有充值）
        if (update.getWealthDelta() > 0) {
            rankingService.incrementScore(RankingDimension.WEALTH, 
                userId, update.getWealthDelta());
        }
        
        // 3. 更新战力分（如果涉及战斗）
        if (update.getPowerDelta() > 0) {
            rankingService.incrementScore(RankingDimension.POWER, 
                userId, update.getPowerDelta());
        }
    }
}
```

### 4.2 历史快照

```java
/**
 * 历史快照服务
 */
public class HistorySnapshotService {
    
    /**
     * 生成历史快照
     * 
     * 定时任务：每天凌晨 2 点执行
     */
    public void generateDailySnapshot(String dimension) {
        String sourceKey = "ranking:" + dimension;
        String snapshotKey = "ranking:snapshot:" + dimension + ":" + getYesterday();
        
        // 1. 复制当前排行榜到快照
        redisTemplate.copy(sourceKey, snapshotKey);
        
        // 2. 设置快照过期时间（保留 365 天）
        redisTemplate.expire(snapshotKey, Duration.ofDays(365));
    }
    
    /**
     * 查询历史排名
     */
    public Long getHistoryRank(String dimension, long userId, String date) {
        String snapshotKey = "ranking:snapshot:" + dimension + ":" + date;
        return rankingService.getUserRankByKey(snapshotKey, userId);
    }
    
    /**
     * 查询历史 Top N
     */
    public List<RankingEntry> getHistoryTopN(String dimension, String date, int n) {
        String snapshotKey = "ranking:snapshot:" + dimension + ":" + date;
        return rankingService.getTopNByKey(snapshotKey, n);
    }
}
```

### 4.3 分布式排行榜

当单机 Redis 扛不住时，需要分布式设计。

```java
/**
 * 分布式排行榜设计
 */
public class DistributedRankingService {
    
    /**
     * 分片策略
     * 
     * 将用户按照 ID 分到不同的 Redis 分片
     * 分片 Key = hash(userId) % 分片数
     * 
     * 问题：跨分片排名如何实现？
     * 解决：
     * 1. 维护一个全局排名（使用更少的数据）
     * 2. 或者只支持单分片内的排名查询
     */
    
    /**
     * 分片 Key 计算
     */
    public int getShardIndex(long userId, int totalShards) {
        return Math.abs(Long.hashCode(userId)) % totalShards;
    }
    
    /**
     * 获取用户排名（跨分片）
     * 
     * 适用于 Top 100 这种小范围查询
     */
    public Long getGlobalRank(String rankingKey, long userId, int totalShards) {
        // 1. 获取用户在当前分片的分数
        int shardIndex = getShardIndex(userId, totalShards);
        Double score = getUserScore(shardIndex, rankingKey, userId);
        
        if (score == null) {
            return null;
        }
        
        // 2. 统计分数更高的用户在所有分片的数量
        long count = 0;
        for (int i = 0; i < totalShards; i++) {
            // ZCOUNT key min max：统计分数在 [max, +∞) 的成员数量
            count += countHigherScore(i, rankingKey, score);
        }
        
        return count; // 分数比他高的人数 = 他的排名
    }
    
    /**
     * 获取 Top N 排行榜（跨分片）
     * 
     * 策略：
     * 1. 每个分片获取自己的 Top N
     * 2. 在应用层合并排序
     * 3. 取最终的 Top N
     */
    public List<RankingEntry> getGlobalTopN(String rankingKey, int n, int totalShards) {
        // 1. 每个分片获取 Top N * totalShards
        List<RankingEntry> allEntries = new ArrayList<>();
        for (int i = 0; i < totalShards; i++) {
            List<RankingEntry> shardTop = getShardTopN(i, rankingKey, n * totalShards);
            allEntries.addAll(shardTop);
        }
        
        // 2. 全局排序
        allEntries.sort((a, b) -> Double.compare(b.getScore(), a.getScore()));
        
        // 3. 取 Top N
        return allEntries.subList(0, Math.min(n, allEntries.size()));
    }
}
```

---

## 五、热搜系统设计

### 5.1 热搜的特殊性

```
热搜 vs 普通排行榜：

热搜的特点：
1. 数据变化极快（分钟级甚至秒级）
2. 话题生命周期短（几个小时到几天）
3. 实时性要求极高
4. 可能需要展示搜索量增量

普通排行榜的特点：
1. 数据相对稳定（小时级或天级变化）
2. 排名变化缓慢
3. 可以容忍一定的延迟
```

### 5.2 热搜实现

```java
/**
 * 热搜系统实现
 */
public class HotSearchService {
    
    /**
     * 记录搜索行为
     * 
     * 使用 Redis Sorted Set，分数为搜索时间戳
     */
    public void recordSearch(String keyword) {
        String hotKey = "hotsearch:daily:" + getToday();
        
        // ZINCRBY 增加搜索次数
        redis.opsForZSet().incrementScore(hotKey, keyword, 1);
        
        // 设置过期时间
        redis.expire(hotKey, Duration.ofDays(2));
    }
    
    /**
     * 获取实时热搜榜
     * 
     * 查询过去 N 分钟的搜索量
     */
    public List<HotSearchEntry> getHotSearch(int topN, int windowMinutes) {
        String hotKey = "hotsearch:daily:" + getToday();
        long windowStart = System.currentTimeMillis() - windowMinutes * 60 * 1000;
        
        // 获取窗口内的所有搜索，按分数排序
        Set<ZSetOperations.TypedTuple<String>> results = 
            redis.opsForZSet().reverseRangeWithScores(hotKey, 0, topN - 1);
        
        List<HotSearchEntry> entries = new ArrayList<>();
        int rank = 1;
        for (ZSetOperations.TypedTuple<String> tuple : results) {
            entries.add(new HotSearchEntry(
                rank++,
                tuple.getValue(),
                tuple.getScore().longValue()
            ));
        }
        
        return entries;
    }
    
    /**
     * 使用滑动窗口实现更精确的统计
     * 
     * 将时间划分为多个 bucket，每分钟一个
     * 查询时聚合多个 bucket 的数据
     */
    public List<HotSearchEntry> getHotSearchWithWindow(int topN) {
        List<String> keys = new ArrayList<>();
        long now = System.currentTimeMillis();
        
        // 获取最近 10 分钟的 key
        for (int i = 0; i < 10; i++) {
            long timestamp = now - i * 60 * 1000;
            keys.add("hotsearch:minute:" + timestamp);
        }
        
        // 使用 ZUNIONSTORE 聚合
        String tempKey = "hotsearch:temp:" + now;
        redis.opsForZSet().unionAndStore(keys.get(0), keys.subList(1, keys.size()), tempKey);
        
        // 获取结果
        Set<ZSetOperations.TypedTuple<String>> results = 
            redis.opsForZSet().reverseRangeWithScores(tempKey, 0, topN - 1);
        
        // 清理临时 key
        redis.delete(tempKey);
        
        // 返回结果...
        return null;
    }
}
```

---

## 六、面试追问方向

### 问题一：「如何处理排行榜的并发更新？」

**回答思路**：

```
Redis ZSet 的更新是原子的，使用 ZINCRBY 命令。
多个并发更新会累加，不会丢失。

如果需要更复杂的逻辑（如先判断分数再更新），可以使用 Lua 脚本保证原子性。
```

### 问题二：「如何实现排行榜的缓存？」

**回答思路**：

```
热点数据（如 Top 100）可以缓存到 CDN 或本地缓存。
更新时主动失效缓存。

注意：缓存的是展示数据，不是 Redis 数据本身。
```

### 问题三：「如何防止刷榜？」

**回答思路**：

```
1. IP 限流：同一个 IP 每分钟最多搜索 N 次
2. 用户认证：需要登录后才能搜索
3. 行为分析：检测异常行为模式
4. 人工审核：敏感话题人工干预
```

---

## 七、总结

```
┌─────────────────────────────────────────────────────────┐
│                   排行榜系统设计要点                      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  核心数据结构                                           │
│  ├── Redis ZSet：O(log N) 插入和查询                  │
│  ├── ZINCRBY：原子性增量更新                          │
│  └── ZREVRANK/ZREVRANGE：获取排名和 Top N             │
│                                                         │
│  进阶设计                                              │
│  ├── 多维度排行榜：多个 ZSet 分别存储                 │
│  ├── 历史快照：定时复制到快照 key                     │
│  └── 分布式分片：按用户 ID 分片                        │
│                                                         │
│  热搜特殊处理                                          │
│  ├── 滑动窗口：更精确的实时统计                       │
│  ├── 防刷机制：限流和风控                             │
│  └── 话题聚合：相似话题合并                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "排行榜系统的本质是：对海量数据进行有序化，并在实时性和性能之间找到平衡。"
