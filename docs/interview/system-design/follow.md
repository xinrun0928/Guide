# 设计关注/粉丝系统

你刷微博时，关注了某个博主。

下一秒，他的粉丝数 +1，你的关注数 +1。

这看似简单的「关注」操作，背后藏着什么问题？

---

## 一、问题分析

### 1.1 功能需求

```
关注系统核心功能：
├── 关注 / 取消关注
├── 获取粉丝列表
├── 获取关注列表
├── 获取相互关注（互粉）
├── 获取关注数 / 粉丝数
└── 特别关注 / 黑名单
```

### 1.2 技术挑战

```
1. 数据规模：
   - 用户数：数亿
   - 关注关系：每个用户可能关注上千人
   - 动态更新：关注/取关操作频繁

2. 查询性能：
   - 粉丝列表需要分页
   - 需要按关注时间排序
   - 需要高效判断两人是否互相关注

3. 一致性：
   - 关注数和粉丝数必须同步更新
   - 不能出现「我关注了 100 人，但关注数显示 99」
```

---

## 二、容量估算

### 2.1 数据规模

```
假设：
- 用户数：10 亿
- 平均关注数：200 人
- 平均粉丝数：200 人

存储量：
- 关注关系：10亿 × 200 × 50字节 ≈ 10TB
- 需要分表存储

QPS：
- 关注操作：1万/秒
- 读取粉丝/关注列表：10万/秒
```

---

## 三、高层设计

```
┌──────────────────────────────────────────────────────────────────┐
│                         用户请求                                   │
│                   GET /api/followers/{userId}                      │
│                   POST /api/follow                               │
└──────────────────────────────────────────────────────────────────┘
                                │
                     ┌───────────▼───────────┐
                     │       API Gateway      │
                     └───────────┬───────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
     ┌────────▼────────┐ ┌───────▼───────┐ ┌───────▼───────┐
     │   关系服务集群   │ │  计数服务集群   │ │  Feed 服务    │
     │  (关注/取关)    │ │  (关注数/粉丝数) │ │  (时间线)     │
     └────────┬────────┘ └───────┬───────┘ └───────────────┘
              │                   │
              └─────────┬─────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
   ┌──────▼──────┐ ┌───▼────┐ ┌──────▼──────┐
   │  Redis     │ │  MQ    │ │   MySQL    │
   │ (热点关系)  │ │(异步更新)│ │  (关系存储)  │
   └─────────────┘ └────────┘ └─────────────┘
```

---

## 四、核心设计

### 4.1 关注关系存储

关注关系的存储需要解决两个问题：
1. 如何高效查询粉丝/关注列表？
2. 如何保证读写性能？

```java
/**
 * 关注关系服务
 *
 * 存储方案：
 * - MySQL：主存储，保证数据可靠
 * - Redis：热点数据缓存，加速读取
 */
public class FollowService {

    private FollowMapper followMapper;
    private UserService userService;
    private RedisTemplate<String, Object> redis;
    private MQTemplate mq;

    /**
     * 关注用户
     *
     * 流程：
     * 1. 检查关注关系是否存在
     * 2. 写入关注记录
     * 3. 发送消息，更新计数
     */
    @Transactional
    public FollowResult follow(String followerId, String followeeId) {
        // 1. 不能关注自己
        if (followerId.equals(followeeId)) {
            return FollowResult.fail("不能关注自己");
        }

        // 2. 检查是否已经关注
        if (isFollowing(followerId, followeeId)) {
            return FollowResult.fail("已经关注过了");
        }

        // 3. 检查对方是否在黑名单
        if (userService.isBlocked(followeeId, followerId)) {
            return FollowResult.fail("对方已将你拉黑");
        }

        // 4. 写入关注记录（MySQL）
        Follow follow = new Follow();
        follow.setFollowerId(followerId);
        follow.setFolloweeId(followeeId);
        follow.setCreatedAt(new Date());
        followMapper.insert(follow);

        // 5. 发送消息，更新关注数和粉丝数（异步）
        mq.send("follow:count:topic", new CountUpdateMessage(followerId, followeeId, "inc"));

        // 6. 更新缓存
        updateFollowCacheAsync(followerId, followeeId);

        return FollowResult.success();
    }

    /**
     * 取消关注
     */
    @Transactional
    public FollowResult unfollow(String followerId, String followeeId) {
        // 1. 检查关注关系是否存在
        if (!isFollowing(followerId, followeeId)) {
            return FollowResult.fail("未关注该用户");
        }

        // 2. 删除关注记录
        followMapper.delete(followerId, followeeId);

        // 3. 发送消息，更新计数
        mq.send("follow:count:topic", new CountUpdateMessage(followerId, followeeId, "dec"));

        // 4. 清除缓存
        clearFollowCache(followerId, followeeId);

        return FollowResult.success();
    }

    /**
     * 判断是否关注
     *
     * 为什么要用 Redis 缓存？
     * - 关注状态会被高频访问
     * - 判断「是否互关」需要快速查询
     */
    public boolean isFollowing(String followerId, String followeeId) {
        String cacheKey = "follow:" + followerId + ":" + followeeId;

        // 1. 先查缓存
        Boolean cached = (Boolean) redis.opsForValue().get(cacheKey);
        if (cached != null) {
            return cached;
        }

        // 2. 缓存未命中，查数据库
        int count = followMapper.countByFollowerAndFollowee(followerId, followeeId);
        boolean isFollowing = count > 0;

        // 3. 回填缓存（关注关系通常不会变，可以缓存久一点）
        redis.opsForValue().set(cacheKey, isFollowing, Duration.ofHours(24));

        return isFollowing;
    }
}
```

### 4.2 粉丝/关注列表

```java
/**
 * 粉丝/关注列表服务
 *
 * 需求：
 * 1. 分页查询
 * 2. 按关注时间倒序（最近关注的在前）
 * 3. 显示用户基本信息
 */
public class FollowListService {

    private FollowMapper followMapper;
    private UserService userService;
    private RedisTemplate<String, Object> redis;

    /**
     * 获取粉丝列表
     *
     * 分页策略：基于 ID 的游标分页（而非 OFFSET）
     * 原因：用户取关后，用 OFFSET 分页可能出现重复
     */
    public FollowListResult getFollowers(String userId, Long cursor, int limit) {
        // 1. 游标分页：使用关注 ID 作为游标
        // cursor = null 表示第一页，使用当前时间戳
        long cursorTime = cursor != null ? cursor : System.currentTimeMillis();

        List<Follow> follows = followMapper.selectFollowers(
            userId,
            cursorTime,
            limit + 1  // 多查一条，判断是否有下一页
        );

        // 2. 判断是否有下一页
        boolean hasMore = follows.size() > limit;
        if (hasMore) {
            follows = follows.subList(0, limit);
        }

        // 3. 获取下一页游标
        Long nextCursor = null;
        if (hasMore && !follows.isEmpty()) {
            Follow lastFollow = follows.get(follows.size() - 1);
            nextCursor = lastFollow.getCreatedAt().getTime();
        }

        // 4. 批量获取用户信息
        List<String> followerIds = follows.stream()
            .map(Follow::getFollowerId)
            .collect(Collectors.toList());

        Map<String, User> users = userService.batchGetUsers(followerIds);

        // 5. 组装结果
        List<FollowUser> followUsers = follows.stream()
            .map(f -> new FollowUser(
                users.get(f.getFollowerId()),
                f.getCreatedAt()
            ))
            .collect(Collectors.toList());

        return new FollowListResult(followUsers, nextCursor);
    }

    /**
     * 获取关注列表
     */
    public FollowListResult getFollowing(String userId, Long cursor, int limit) {
        long cursorTime = cursor != null ? cursor : System.currentTimeMillis();

        List<Follow> follows = followMapper.selectFollowing(
            userId,
            cursorTime,
            limit + 1
        );

        boolean hasMore = follows.size() > limit;
        if (hasMore) {
            follows = follows.subList(0, limit);
        }

        Long nextCursor = null;
        if (hasMore && !follows.isEmpty()) {
            nextCursor = follows.get(follows.size() - 1).getCreatedAt().getTime();
        }

        List<String> followeeIds = follows.stream()
            .map(Follow::getFolloweeId)
            .collect(Collectors.toList());

        Map<String, User> users = userService.batchGetUsers(followeeIds);

        List<FollowUser> followUsers = follows.stream()
            .map(f -> new FollowUser(
                users.get(f.getFolloweeId()),
                f.getCreatedAt()
            ))
            .collect(Collectors.toList());

        return new FollowListResult(followUsers, nextCursor);
    }

    /**
     * 获取共同关注
     *
     * 场景：看看我和他有多少共同关注
     */
    public List<User> getMutualFollows(String userId1, String userId2, int limit) {
        // 获取两人各自的关注列表
        List<String> following1 = followMapper.selectFollowingIds(userId1);
        List<String> following2 = followMapper.selectFollowingIds(userId2);

        // 求交集
        Set<String> intersection = new HashSet<>(following1);
        intersection.retainAll(following2);

        // 批量获取用户信息
        return userService.batchGetUsers(
            intersection.stream().limit(limit).collect(Collectors.toList())
        ).values().stream().collect(Collectors.toList());
    }
}

/**
 * 关注列表结果
 */
public record FollowListResult(List<FollowUser> users, Long nextCursor) {}

/**
 * 关注用户信息
 */
public record FollowUser(User user, Date followedAt) {}
```

### 4.3 计数服务

```java
/**
 * 关注数/粉丝数计数服务
 *
 * 为什么不用直接查询？
 * - 关注列表可能有上百万条，COUNT(*) 太慢
 * - 需要实时返回，高频访问
 *
 * 方案：单独维护计数
 */
public class CountService {

    private RedisTemplate<String, Object> redis;

    /**
     * 更新关注数和粉丝数
     *
     * 为什么用 MQ？
     * - 关注操作需要同步返回，不能被计数拖慢
     * - 计数更新可以异步，不影响主流程
     */
    @RabbitListener(queues = "follow:count:queue")
    public void handleCountUpdate(CountUpdateMessage message) {
        String userId = message.getUserId();
        String targetId = message.getTargetId();
        String type = message.getType();

        if ("inc".equals(type)) {
            // 增加粉丝数
            redis.opsForValue().increment("count:followers:" + targetId);
            // 增加关注数
            redis.opsForValue().increment("count:following:" + userId);
        } else {
            // 减少粉丝数
            redis.opsForValue().decrement("count:followers:" + targetId);
            // 减少关注数
            redis.opsForValue().decrement("count:following:" + userId);
        }
    }

    /**
     * 获取用户粉丝数
     */
    public long getFollowerCount(String userId) {
        String key = "count:followers:" + userId;
        Object count = redis.opsForValue().get(key);

        if (count == null) {
            // 缓存未命中，查数据库并回填
            long dbCount = followMapper.countFollowers(userId);
            redis.opsForValue().set(key, dbCount);
            return dbCount;
        }

        return (Long) count;
    }

    /**
     * 获取用户关注数
     */
    public long getFollowingCount(String userId) {
        String key = "count:following:" + userId;
        Object count = redis.opsForValue().get(key);

        if (count == null) {
            long dbCount = followMapper.countFollowing(userId);
            redis.opsForValue().set(key, dbCount);
            return dbCount;
        }

        return (Long) count;
    }

    /**
     * 判断是否互关
     *
     * 优化：使用 Redis Pipeline 减少网络往返
     */
    public boolean isMutualFollow(String userId1, String userId2) {
        // 两次 Redis 请求合并为一次 Pipeline
        List<Object> results = redis.executePipelined(new SessionCallback<Object>() {
            @Override
            public Object execute(RedisOperations operations) throws DataAccessException {
                operations.opsForValue().get("follow:" + userId1 + ":" + userId2);
                operations.opsForValue().get("follow:" + userId2 + ":" + userId1);
                return null;
            }
        });

        Boolean follow1 = (Boolean) results.get(0);
        Boolean follow2 = (Boolean) results.get(1);

        return Boolean.TRUE.equals(follow1) && Boolean.TRUE.equals(follow2);
    }
}
```

### 4.4 热点数据优化

```java
/**
 * 热点用户关注列表缓存
 *
 * 对于大 V（粉丝数 > 100万），关注列表无法实时查询
 * 需要特殊处理
 */
public class HotUserFollowService {

    private RedisTemplate<String, Object> redis;
    private FollowMapper followMapper;

    private static final long HOT_THRESHOLD = 1_000_000; // 100万粉丝

    /**
     * 获取大 V 的粉丝列表（只显示最近关注的）
     *
     * 不可能列出 1000 万粉丝，只能显示最近的一些
     */
    public List<FollowUser> getHotUserFollowers(String userId, int limit) {
        String cacheKey = "hot:followers:" + userId;

        // 1. 查缓存
        List<FollowUser> cached = redis.opsForList().range(cacheKey, 0, limit - 1);
        if (cached != null && !cached.isEmpty()) {
            return cached;
        }

        // 2. 缓存未命中，查最近关注的一批粉丝
        // 注意：不能按关注时间排序（太慢），只能查最近入库的
        List<Follow> recentFollows = followMapper.selectRecentFollowers(userId, limit);

        List<String> followerIds = recentFollows.stream()
            .map(Follow::getFollowerId)
            .collect(Collectors.toList());

        // 批量获取用户信息
        List<FollowUser> result = new ArrayList<>();
        for (Follow follow : recentFollows) {
            User user = userService.getUser(follow.getFollowerId());
            result.add(new FollowUser(user, follow.getCreatedAt()));
        }

        // 3. 回填缓存
        if (!result.isEmpty()) {
            redis.opsForList().rightPushAll(cacheKey, result);
            redis.expire(cacheKey, Duration.ofMinutes(5));
        }

        return result;
    }
}
```

---

## 五、延伸问题

### 问题一：如何防止恶意关注/取关？

```
方案：
1. 限流：每个用户每天最多关注/取关 N 次
2. 冷却时间：关注后需要等待一段时间才能取关
3. 关注上限：每个用户最多关注 5000 人
4. 风控系统：识别异常关注行为
```

### 问题二：如何实现「特别关注」？

```
方案：
1. 在关注表中添加 type 字段
2. type = 'normal' | 'special' | 'mutual'
3. 特别关注的动态优先展示
```

### 问题三：关注关系如何分库分表？

```
方案：
1. 按 follower_id 分片（适合查粉丝列表）
2. 按 followee_id 分片（适合查关注列表）
3. 混合分片：核心字段按 follower_id，查询字段按 followee_id
```

---

## 六、总结

```
┌─────────────────────────────────────────────────────┐
│              关注/粉丝系统核心知识点                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  关系存储                                            │
│  ├── MySQL：主存储，保证可靠性                      │
│  ├── Redis：热点缓存，加速查询                      │
│  └── 异步更新：MQ 解耦计数更新                      │
│                                                     │
│  分页策略                                            │
│  ├── 游标分页：基于 ID/时间戳                        │
│  └── 大 V 特殊处理：只显示最近关注                  │
│                                                     │
│  计数服务                                            │
│  ├── 独立维护计数，不做 COUNT(*)                    │
│  └── 异步更新，保证写入性能                        │
│                                                     │
│  防刷策略                                            │
│  ├── 关注上限：5000 人                              │
│  ├── 限流：每天 N 次                              │
│  └── 冷却时间                                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能解释为什么关注数要单独维护而不是 COUNT(*)
- 能设计大 V 的粉丝列表查询方案
- 能说出游标分页和 OFFSET 分页的区别
- 能分析 MQ 在关注系统中的作用
