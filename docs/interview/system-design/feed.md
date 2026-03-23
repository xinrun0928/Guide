# 设计 Feed 流：拉模式 vs 推模式 vs 混合模式

你有没有想过：

- 刷抖音时，为什么能一直往下刷，永远看不到底？
- 为什么关注列表只有 100 人，但能看到 thousands 条内容？
- 为什么你关注的人发的内容，你需要刷新才能看到？

这些，都是 Feed 流系统在背后默默工作。

今天，我们来深入探讨 Feed 流系统的设计。

---

## 一、Feed 流的本质

### 1.1 什么是 Feed 流？

```
Feed 流（信息流）是一种展示动态更新的方式：
- 用户关注的内容按时间顺序展示
- 新内容不断涌现，用户持续消费
- 可以无限滚动

典型的 Feed 流产品：
- 微信朋友圈
- 微博
- 抖音
- Twitter
- Reddit
```

### 1.2 Feed 流 vs Timeline

```
很多人把 Feed 流和 Timeline 混为一谈，其实有区别：

Timeline（时间线）：
- 按时间倒序展示
- 用户关注的内容

Feed 流：
- 包含更多信息
- 可能是算法推荐的
- 可能包含广告
- 可能包含「你可能认识的人」

本文主要讨论 Timeline 的设计
```

---

## 二、三种实现模式

### 2.1 推模式（Push / Fanout）

```
核心思想：用户发内容时，主动推送给所有粉丝

用户 A 发了一条微博：
→ 系统遍历 A 的所有粉丝
→ 将这条微博写入每个粉丝的「收件箱」

读取时：
→ 直接从收件箱读取
```

```java
/**
 * 推模式实现
 */
public class PushFeedService {
    
    private MessageQueue mq;
    private FeedRepository feedRepo;
    
    /**
     * 发微博（推送给所有粉丝）
     */
    public void publishPost(long userId, Post post) {
        // 1. 保存帖子
        feedRepo.savePost(post);
        
        // 2. 获取粉丝列表
        List<Long> followers = followService.getFollowers(userId);
        
        // 3. 推送给每个粉丝（使用消息队列异步）
        for (Long followerId : followers) {
            mq.publish("fanout", new FanoutTask(followerId, post.getId()));
        }
    }
    
    /**
     * 消费者：写入粉丝的收件箱
     */
    @KafkaListener(topics = "fanout")
    public void handleFanout(FanoutTask task) {
        String inboxKey = "inbox:" + task.getFollowerId();
        long timestamp = System.currentTimeMillis();
        
        // ZADD inboxKey postId timestamp
        redis.opsForZSet().add(inboxKey, 
            String.valueOf(task.getPostId()), 
            timestamp);
    }
    
    /**
     * 获取 Feed 流
     */
    public List<Post> getFeed(long userId, int offset, int limit) {
        String inboxKey = "inbox:" + userId;
        
        // ZREVRANGE inboxKey offset limit
        Set<String> postIds = redis.opsForZSet()
            .reverseRange(inboxKey, offset, offset + limit - 1);
        
        // 获取帖子详情
        return feedRepo.getPostsByIds(postIds);
    }
}
```

**优缺点**：
- ✅ 读取速度快（直接读收件箱）
- ❌ 写入量大（大V发推，推送给亿级粉丝）
- ❌ 存储成本高（每条内容存储 N 份）

### 2.2 拉模式（Pull / Fanout on Read）

```
核心思想：读取时，聚合关注对象的内容

用户 A 刷新 Feed：
→ 获取 A 关注的所有人
→ 聚合这些人的最新内容
→ 排序后返回
```

```java
/**
 * 拉模式实现
 */
public class PullFeedService {
    
    private FeedRepository feedRepo;
    
    /**
     * 获取 Feed 流
     */
    public List<Post> getFeed(long userId, int offset, int limit) {
        // 1. 获取关注列表
        List<Long> following = followService.getFollowing(userId);
        
        // 2. 并行获取关注人的最新帖子
        List<Future<List<Post>>> futures = new ArrayList<>();
        for (Long followeeId : following) {
            futures.add(executor.submit(() -> 
                feedRepo.getLatestPosts(followeeId, 100)));
        }
        
        // 3. 收集所有帖子
        List<Post> allPosts = new ArrayList<>();
        for (Future<List<Post>> future : futures) {
            try {
                allPosts.addAll(future.get(100, TimeUnit.MILLISECONDS));
            } catch (Exception e) {
                // 超时忽略该用户
            }
        }
        
        // 4. 排序（按时间倒序）
        allPosts.sort((a, b) -> Long.compare(b.getCreatedAt(), a.getCreatedAt()));
        
        // 5. 分页
        return allPosts.subList(offset, 
            Math.min(offset + limit, allPosts.size()));
    }
}
```

**优缺点**：
- ✅ 写入简单（只存自己的内容）
- ❌ 读取慢（需要聚合大量数据）
- ❌ 无法支撑高并发读取

### 2.3 混合模式（Hybrid）

```
核心思想：根据用户类型和内容类型，选择推或拉

对普通用户：推模式
- 粉丝少，推送成本低
- 用户体验好

对大V用户：拉模式
- 粉丝多，推送成本高
- 让用户主动拉取
```

```java
/**
 * 混合模式实现
 */
public class HybridFeedService {
    
    private static final long HOT_USER_THRESHOLD = 100_000; // 粉丝数阈值
    
    /**
     * 发微博
     */
    public void publishPost(long userId, Post post) {
        // 1. 保存帖子
        feedRepo.savePost(post);
        
        // 2. 判断是否为热门用户
        long followerCount = followService.getFollowerCount(userId);
        
        if (followerCount < HOT_USER_THRESHOLD) {
            // 普通用户：推模式
            fanoutToFollowers(userId, post.getId());
        } else {
            // 大V：只推送给活跃粉丝
            fanoutToActiveFollowers(userId, post.getId());
        }
    }
    
    /**
     * 获取 Feed 流
     */
    public List<Post> getFeed(long userId, int offset, int limit) {
        List<Post> posts = new ArrayList<>();
        
        // 1. 获取推模式的内容（收件箱）
        List<Post> inboxPosts = getInboxPosts(userId, offset, limit);
        posts.addAll(inboxPosts);
        
        // 2. 获取拉模式的内容（大V的帖子）
        List<Long> hotFollowings = followService.getHotFollowings(userId);
        List<Post> hotPosts = pullHotPosts(hotFollowings);
        posts.addAll(hotPosts);
        
        // 3. 合并、排序、分页
        posts.sort((a, b) -> Long.compare(b.getCreatedAt(), a.getCreatedAt()));
        return posts.subList(0, Math.min(limit, posts.size()));
    }
    
    /**
     * 只推送给活跃粉丝
     */
    private void fanoutToActiveFollowers(long userId, long postId) {
        // 1. 获取粉丝列表
        List<Long> allFollowers = followService.getFollowers(userId);
        
        // 2. 过滤出活跃粉丝
        List<Long> activeFollowers = filterActiveFollowers(allFollowers);
        
        // 3. 推送
        for (Long followerId : activeFollowers) {
            pushToInbox(followerId, postId);
        }
        
        // 4. 标记非活跃粉丝有新内容
        markInactiveFollowersNewContent(allFollowers, activeFollowers);
    }
    
    /**
     * 过滤活跃粉丝
     */
    private List<Long> filterActiveFollowers(List<Long> followers) {
        // 最近 7 天登录过的粉丝
        return followers.stream()
            .filter(this::isActiveUser)
            .collect(Collectors.toList());
    }
}
```

---

## 三、缓存设计

### 3.1 Feed 缓存

```java
/**
 * Feed 缓存设计
 */
public class FeedCacheService {
    
    private RedisTemplate<String, Object> redis;
    
    /**
     * 缓存 Key 设计
     * 
     * 格式：feed:{userId}
     * 类型：ZSet
     * 分数：时间戳
     */
    private static final String FEED_KEY = "feed:%d";
    
    /**
     * 缓存 TTL
     */
    private static final Duration CACHE_TTL = Duration.ofDays(7);
    
    /**
     * 获取 Feed（带缓存）
     */
    public List<Post> getFeedWithCache(long userId, int offset, int limit) {
        String feedKey = String.format(FEED_KEY, userId);
        
        // 1. 尝试从缓存获取
        Set<Object> cached = redis.opsForZSet()
            .reverseRange(feedKey, offset, offset + limit - 1);
        
        if (cached != null && !cached.isEmpty()) {
            return feedRepo.getPostsByIds(cached);
        }
        
        // 2. 缓存未命中，重新计算
        List<Post> feed = hybridFeedService.getFeed(userId, offset, limit);
        
        // 3. 回填缓存
        if (!feed.isEmpty()) {
            for (Post post : feed) {
                redis.opsForZSet().add(feedKey,
                    String.valueOf(post.getId()),
                    post.getCreatedAt());
            }
            redis.expire(feedKey, CACHE_TTL);
        }
        
        return feed;
    }
    
    /**
     * 发布内容时失效缓存
     */
    public void invalidateFeed(long userId, long postId) {
        String feedKey = String.format(FEED_KEY, userId);
        
        // ZADD feedKey postId timestamp
        redis.opsForZSet().add(feedKey,
            String.valueOf(postId),
            System.currentTimeMillis());
    }
}
```

---

## 四、推、拉模式的权衡

### 4.1 核心指标对比

| 指标 | 推模式 | 拉模式 | 混合模式 |
|-----|--------|--------|---------|
| 读取速度 | 快 | 慢 | 中 |
| 写入速度 | 慢 | 快 | 中 |
| 存储成本 | 高 | 低 | 中 |
| 大V处理 | 困难 | 简单 | 适中 |
| 实时性 | 高 | 低 | 可控 |

### 4.2 选择依据

```
选择推模式：
- 粉丝数普遍较少
- 用户实时性要求高
- 系统写入性能足够

选择拉模式：
- 粉丝数差异大（有大V）
- 读取并发较低
- 可以容忍一定延迟

选择混合模式：
- 大多数场景下的最佳选择
- 可以根据用户类型动态调整
```

---

## 五、进阶功能

### 5.1 分页与无限滚动

```java
/**
 * Feed 分页实现
 */
public class FeedPaginationService {
    
    /**
     * 基于游标的分页
     * 
     * 使用时间戳作为游标，避免深度分页问题
     */
    public FeedResult getFeed(long userId, String cursor, int limit) {
        long timestamp = parseCursor(cursor);
        
        // 1. 获取游标之后的 N 条内容
        String feedKey = String.format("feed:%d", userId);
        
        // ZREVRANGEBYSCORE feedKey maxTimestamp minTimestamp
        Set<ZSetOperations.TypedTuple<String>> results = 
            redis.opsForZSet().reverseRangeByScoreWithScores(
                feedKey, 
                timestamp - 1,  // 游标位置不包含
                0,
                0, limit);
        
        // 2. 获取下一页游标
        String nextCursor = null;
        if (results.size() == limit) {
            Object lastScore = results.stream()
                .findFirst()
                .map(ZSetOperations.TypedTuple::getScore)
                .orElse(0L);
            nextCursor = createCursor(lastScore.longValue());
        }
        
        // 3. 转换为帖子
        List<Post> posts = convertToPosts(results);
        
        return new FeedResult(posts, nextCursor);
    }
    
    /**
     * 游标编码
     */
    private String createCursor(long timestamp) {
        return Base64.getEncoder().encodeToString(
            String.valueOf(timestamp).getBytes());
    }
}
```

### 5.2 已读标记

```java
/**
 * 已读标记
 */
public class ReadMarkService {
    
    /**
     * 标记已读
     */
    public void markAsRead(long userId, long postId) {
        String key = "read:" + userId;
        redis.opsForSet().add(key, String.valueOf(postId));
    }
    
    /**
     * 过滤已读内容
     */
    public List<Post> filterReadPosts(long userId, List<Post> posts) {
        String readKey = "read:" + userId;
        Set<String> readPosts = redis.opsForSet().members(readKey);
        
        return posts.stream()
            .filter(p -> !readPosts.contains(String.valueOf(p.getId())))
            .collect(Collectors.toList());
    }
}
```

---

## 六、面试追问方向

### 问题一：「如何处理大V发推的推送风暴？」

**回答思路**：

```
1. 只推送给活跃粉丝（最近 7 天登录）
2. 分批推送（控制推送速率）
3. 降级处理（系统压力大时停止推送，让用户拉取）
4. 异步队列（使用消息队列削峰）
```

### 问题二：「如何保证 Feed 流的顺序？」

**回答思路**：

```
1. 使用时间戳作为排序依据
2. 混合模式下，需要合并多个来源的内容
3. 使用优先级队列进行归并排序
4. 注意时钟同步问题（使用逻辑时钟）
```

### 问题三：「如何实现点赞后 Feed 立即更新？」

**回答思路**：

```
1. 点赞后发送消息到队列
2. 消费者更新 Feed 缓存
3. 如果用户在 Feed 页面，WebSocket 推送更新
4. 如果用户不在，在下次刷新时展示
```

---

## 七、总结

```
┌─────────────────────────────────────────────────────────┐
│                    Feed 流设计要点                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  三种模式                                              │
│  ├── 推模式：写入慢，读取快，适合粉丝均匀的场景        │
│  ├── 拉模式：写入快，读取慢，适合大V场景              │
│  └── 混合模式：动态平衡，生产环境推荐                 │
│                                                         │
│  核心实现                                              │
│  ├── Redis ZSet 存储 Feed                           │
│  ├── 分页使用游标而非 OFFSET                         │
│  └── 大V单独处理                                     │
│                                                         │
│  性能优化                                              │
│  ├── 缓存预热                                        │
│  ├── 热点数据分离                                    │
│  └── 异步处理                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

> "Feed 流设计的本质是：在写入成本和读取成本之间找到平衡，根据业务特点选择合适的数据流模式。"
