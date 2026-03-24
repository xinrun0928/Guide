# Redis 排行榜：游戏排名的艺术

你有没有玩过游戏？

每次打开排行榜，看到自己的排名，是不是很有成就感？

这个排行榜是怎么实现的？

**Redis ZSet** 就是排行榜的秘密武器。

## 为什么用 Redis ZSet 做排行榜？

| 实现方式 | 查询排名 | 查询 Top N | 更新分数 | 数据量 |
|---------|---------|-----------|---------|--------|
| 数据库 | O(n) | O(n log n) | O(log n) | 有限 |
| Redis ZSet | O(log n) | O(log n + N) | O(log n) | 无限制 |

## 排行榜基础操作

### 创建排行榜

```java
public class LeaderboardDemo {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String LEADERBOARD_KEY = "game:leaderboard";

    /**
     * 添加玩家分数
     */
    public void addPlayerScore(String playerId, int score) {
        // ZADD 自动按分数排序
        jedis.zadd(LEADERBOARD_KEY, score, playerId);
    }

    /**
     * 增加分数
     */
    public void incrementScore(String playerId, int increment) {
        // ZINCRBY 在原分数基础上增加
        jedis.zincrby(LEADERBOARD_KEY, increment, playerId);
    }

    /**
     * 获取玩家排名（0-based）
     */
    public Long getPlayerRank(String playerId) {
        // ZREVRANK 从高到低排名
        return jedis.zrevrank(LEADERBOARD_KEY, playerId);
    }

    /**
     * 获取玩家排名（1-based，更友好）
     */
    public Long getPlayerRankDisplay(String playerId) {
        Long rank = jedis.zrevrank(LEADERBOARD_KEY, playerId);
        return rank != null ? rank + 1 : null;
    }

    /**
     * 获取玩家分数
     */
    public Double getPlayerScore(String playerId) {
        return jedis.zscore(LEADERBOARD_KEY, playerId);
    }
}
```

### 查询排行榜

```java
    /**
     * 获取 Top N 玩家
     */
    public List&lt;Player&gt; getTopN(int n) {
        // ZREVRANGE 从高到低获取
        Set&lt;ZSet.Tuple&gt; topPlayers =
            jedis.zrevrangeWithScores(LEADERBOARD_KEY, 0, n - 1);

        return convertToPlayerList(topPlayers);
    }

    /**
     * 获取指定排名范围的玩家
     */
    public List&lt;Player&gt; getRange(int start, int end) {
        Set&lt;ZSet.Tuple&gt; players =
            jedis.zrevrangeWithScores(LEADERBOARD_KEY, start, end);

        List&lt;Player&gt; result = new ArrayList&lt;&gt;();
        int rank = start + 1;

        for (ZSet.Tuple tuple : players) {
            result.add(new Player(
                tuple.getValue(),
                tuple.getScore().intValue(),
                rank++
            ));
        }

        return result;
    }

    /**
     * 获取分数区间的玩家
     */
    public List&lt;Player&gt; getPlayersByScoreRange(int minScore, int maxScore) {
        Set&lt;ZSet.Tuple&gt; players = jedis.zrevrangeByScoreWithScores(
            LEADERBOARD_KEY,
            maxScore,
            minScore
        );

        return convertToPlayerList(players);
    }

    private List&lt;Player&gt; convertToPlayerList(Set&lt;ZSet.Tuple&gt; tuples) {
        List&lt;Player&gt; result = new ArrayList&lt;&gt;();
        int rank = 1;

        for (ZSet.Tuple tuple : tuples) {
            result.add(new Player(
                tuple.getValue(),
                tuple.getScore().intValue(),
                rank++
            ));
        }

        return result;
    }
```

## 游戏排行榜实战

### 玩家数据模型

```java
public class Player {
    private String playerId;
    private String nickname;
    private int score;
    private int rank;
    private long lastUpdateTime;

    public Player(String playerId, int score, int rank) {
        this.playerId = playerId;
        this.score = score;
        this.rank = rank;
        this.lastUpdateTime = System.currentTimeMillis();
    }

    // getters and setters
}

public class PlayerData {
    private Jedis jedis;
    private static final String PLAYER_INFO_PREFIX = "player:info:";

    /**
     * 保存玩家信息
     */
    public void savePlayerInfo(Player player) {
        String key = PLAYER_INFO_PREFIX + player.getPlayerId();
        jedis.set(key, JSON.toJSONString(player));
    }

    /**
     * 获取玩家信息
     */
    public Player getPlayerInfo(String playerId) {
        String key = PLAYER_INFO_PREFIX + playerId;
        String json = jedis.get(key);
        return JSON.parseObject(json, Player.class);
    }
}
```

### 游戏服务

```java
@Service
public class GameLeaderboardService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private PlayerData playerData;

    // 排行榜 key
    private static final String LEADERBOARD_KEY = "game:weekly:leaderboard";

    /**
     * 记录玩家得分
     */
    public void recordScore(String playerId, int score) {
        // 1. 更新排行榜
        jedis.zadd(LEADERBOARD_KEY, score, playerId);

        // 2. 获取玩家当前排名
        Long rank = jedis.zrevrank(LEADERBOARD_KEY, playerId);

        // 3. 更新玩家信息
        Player player = playerData.getPlayerInfo(playerId);
        if (player != null) {
            player.setScore(score);
            player.setRank(rank != null ? rank.intValue() + 1 : 0);
            player.setLastUpdateTime(System.currentTimeMillis());
            playerData.savePlayerInfo(player);
        }
    }

    /**
     * 获取玩家排名详情
     */
    public PlayerRankInfo getPlayerRankInfo(String playerId) {
        // 获取排名
        Long rank = jedis.zrevrank(LEADERBOARD_KEY, playerId);

        // 获取分数
        Double score = jedis.zscore(LEADERBOARD_KEY, playerId);

        // 获取玩家信息
        Player player = playerData.getPlayerInfo(playerId);

        // 获取前一名和后一名
        String prevPlayerId = null;
        String nextPlayerId = null;

        if (rank != null && rank > 0) {
            Set&lt;String&gt; prevSet =
                jedis.zrevrange(LEADERBOARD_KEY, rank - 1, rank - 1);
            prevPlayerId = prevSet.isEmpty() ? null : prevSet.iterator().next();
        }

        Set&lt;String&gt; nextSet =
            jedis.zrevrange(LEADERBOARD_KEY, rank != null ? rank + 1 : 0, rank != null ? rank + 1 : 0);
        nextPlayerId = nextSet.isEmpty() ? null : nextSet.iterator().next();

        return new PlayerRankInfo(
            playerId,
            score != null ? score.intValue() : 0,
            rank != null ? rank.intValue() + 1 : 0,
            player,
            prevPlayerId,
            nextPlayerId
        );
    }

    /**
     * 获取 Top 100 排行榜
     */
    public List&lt;PlayerRankInfo&gt; getTop100() {
        Set&lt;ZSet.Tuple&gt; top =
            jedis.zrevrangeWithScores(LEADERBOARD_KEY, 0, 99);

        List&lt;PlayerRankInfo&gt; result = new ArrayList&lt;&gt;();
        int rank = 1;

        for (ZSet.Tuple tuple : top) {
            Player player = playerData.getPlayerInfo(tuple.getValue());
            result.add(new PlayerRankInfo(
                tuple.getValue(),
                tuple.getScore().intValue(),
                rank++,
                player,
                null,
                null
            ));
        }

        return result;
    }
}
```

## 多种排行榜

### 周榜、月榜、季榜

```java
public class MultiLeaderboardService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 获取排行榜 key（带时间维度）
     */
    public String getLeaderboardKey(String gameId, String period) {
        LocalDate now = LocalDate.now();

        switch (period) {
            case "daily":
                return String.format("game:%s:daily:%s", gameId, now);
            case "weekly":
                // 获取本周第一天
                LocalDate weekStart = now.with(java.time.DayOfWeek.MONDAY);
                return String.format("game:%s:weekly:%s", gameId, weekStart);
            case "monthly":
                return String.format("game:%s:monthly:%s:%s",
                    gameId, now.getYear(), now.getMonthValue());
            case "alltime":
            default:
                return String.format("game:%s:alltime", gameId);
        }
    }

    /**
     * 添加分数到指定排行榜
     */
    public void addScore(String gameId, String period,
                         String playerId, int score) {
        String key = getLeaderboardKey(gameId, period);
        jedis.zadd(key, score, playerId);
    }

    /**
     * 获取玩家的综合排名
     */
    public Map&lt;String, Integer&gt; getPlayerAllRankings(String gameId, String playerId) {
        Map&lt;String, Integer&gt; rankings = new HashMap&lt;&gt;();

        for (String period : Arrays.asList("daily", "weekly", "monthly", "alltime")) {
            String key = getLeaderboardKey(gameId, period);
            Long rank = jedis.zrevrank(key, playerId);
            rankings.put(period, rank != null ? rank.intValue() + 1 : null);
        }

        return rankings;
    }
}
```

### 多维度排行榜

```java
public class MultiDimensionLeaderboard {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 击杀排行榜
     */
    public void addKillScore(String playerId, int kills) {
        jedis.zincrby("leaderboard:kills", kills, playerId);
    }

    /**
     * 生存时间排行榜
     */
    public void addSurvivalScore(String playerId, int minutes) {
        jedis.zincrby("leaderboard:survival", minutes, playerId);
    }

    /**
     * 综合评分排行榜（击杀 × 10 + 生存时间）
     */
    public void addOverallScore(String playerId, int kills, int survivalMinutes) {
        jedis.zincrby("leaderboard:overall",
            kills * 10 + survivalMinutes, playerId);
    }

    /**
     * 获取玩家在多个维度的排名
     */
    public Map&lt;String, Integer&gt; getPlayerAllDimensionRanks(String playerId) {
        Map&lt;String, Integer&gt; ranks = new HashMap&lt;&gt;();

        String[] dimensions = {"kills", "survival", "overall"};
        for (String dim : dimensions) {
            String key = "leaderboard:" + dim;
            Long rank = jedis.zrevrank(key, playerId);
            ranks.put(dim, rank != null ? rank.intValue() + 1 : null);
        }

        return ranks;
    }
}
```

## 排行榜优化

### 1. 批量更新

```java
public class BatchLeaderboardUpdate {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 批量更新分数
     */
    public void batchUpdateScores(List&lt;ScoreEntry&gt; entries) {
        Pipeline pipeline = jedis.pipelined();

        for (ScoreEntry entry : entries) {
            pipeline.zadd("leaderboard:scores",
                entry.getScore(), entry.getPlayerId());
        }

        pipeline.sync();
    }

    /**
     * 获取排行榜（带分页）
     */
    public List&lt;Player&gt; getLeaderboardPage(int page, int pageSize) {
        int start = (page - 1) * pageSize;
        int end = start + pageSize - 1;

        Set&lt;ZSet.Tuple&gt; players =
            jedis.zrevrangeWithScores("leaderboard:scores", start, end);

        List&lt;Player&gt; result = new ArrayList&lt;&gt;();
        int rank = start + 1;

        for (ZSet.Tuple tuple : players) {
            result.add(new Player(
                tuple.getValue(),
                tuple.getScore().intValue(),
                rank++
            ));
        }

        return result;
    }
}
```

### 2. 排行榜缓存

```java
public class CachedLeaderboard {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private LoadingCache&lt;String, List&lt;Player&gt; localCache;

    public CachedLeaderboard() {
        // 本地缓存 10 秒
        this.localCache = CacheBuilder.newBuilder()
            .maximumSize(100)
            .expireAfterWrite(10, TimeUnit.SECONDS)
            .build(new CacheLoader&lt;String, List&lt;Player&gt;() {
                @Override
                public List&lt;Player&gt; load(String key) throws Exception {
                    return fetchTop100FromRedis();
                }
            });
    }

    /**
     * 获取 Top 100（优先从缓存获取）
     */
    public List&lt;Player&gt; getTop100() {
        try {
            return localCache.get("top100");
        } catch (ExecutionException e) {
            return fetchTop100FromRedis();
        }
    }

    private List&lt;Player&gt; fetchTop100FromRedis() {
        Set&lt;ZSet.Tuple&gt; tuples =
            jedis.zrevrangeWithScores("leaderboard:scores", 0, 99);

        List&lt;Player&gt; result = new ArrayList&lt;&gt;();
        int rank = 1;

        for (ZSet.Tuple tuple : tuples) {
            result.add(new Player(
                tuple.getValue(),
                tuple.getScore().intValue(),
                rank++
            ));
        }

        return result;
    }
}
```

## 面试追问方向

1. **Redis 排行榜如何处理并列排名？**

   Redis ZSet 不支持并列排名，同分数的玩家会按 member 的字典序排序。如果需要并列排名，可以在分数中加入小数值（如 score + 0.001 * random）来区分，或者在应用层处理并列逻辑。

2. **排行榜数据量很大怎么办？**

   - 使用 Redis Cluster 分片存储
   - 使用本地缓存减少 Redis 请求
   - 只保留 Top N 的详细数据，之外的数据归档
   - 使用 ZSCAN 遍历而非 ZRANGE

---

**核心记忆点**：Redis ZSet 是实现排行榜的最佳选择，通过 ZADD 更新分数、ZREVRANK 获取排名、ZREVRANGE 获取 Top N。实际应用中需要考虑多维度排行榜、时间维度（周榜、月榜）以及缓存优化。
