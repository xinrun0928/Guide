# 设计 Twitter/微博时间线推送系统

先想一个问题：

你打开微博首页，信息流刷出来的速度是「秒级」的——你关注了 5000 人，他们每分钟可能发布上百条新微博。

**系统是如何在这么短的时间内，把你的时间线「组装」出来的？**

---

## 一、问题分析

### 1.1 两种时间线模式

```
┌─────────────────────────────────────────────────────┐
│                 推模式（Push）                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  用户发微博 → 推送到所有粉丝的「收件箱」               │
│                                                     │
│  优点：读取快，用户请求直接返回                       │
│  缺点：写入压力大（大 V 发一条，推送 1000万用户）      │
│                                                     │
│  适用：粉丝数相对均衡的产品                           │
│                                                     │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                 拉模式（Pull）                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  用户请求 → 聚合关注列表 → 拉取所有微博 → 排序返回    │
│                                                     │
│  优点：读取压力大时可水平扩展                         │
│  缺点：读取慢，需要合并多个数据源                      │
│                                                     │
│  适用：粉丝差异大的产品（如微博大 V）                  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 1.2 微博的选择：混合模式

```
普通用户：推模式（写入到粉丝收件箱）
大 V 用户：拉模式（读取时实时聚合）

为什么这样设计？
- 普通用户发微博，粉丝少，推送成本可控
- 大 V 发微博，粉丝多，如果每个粉丝都推送，写入会爆炸
```

---

## 二、需求分析

### 2.1 功能需求

```
时间线服务
├── 获取关注动态（首页信息流）
├── 发布微博（写入时间线）
├── 下拉刷新（获取最新内容）
├── 上拉加载更多（分页）
└── 未读数提醒（红点）
```

### 2.2 非功能需求

| 指标 | 要求 |
|---|---|
| 响应时间 | P99 < 200ms |
| 可用性 | 99.9% |
| 吞吐量 | 10万+ QPS |
| 时效性 | 关注的人发微博，< 1 分钟可见 |

---

## 三、容量估算

### 3.1 数据量

```
用户规模：1 亿用户
平均关注数：200 人
平均粉丝数：200 人
大 V 阈值：粉丝 > 10万

每日微博量：1 亿条
热点微博（被转发）：约 1000 万条
```

### 3.2 存储估算

```
用户收件箱：
- 1 亿用户 × 平均 200 条微博 × 500 字节/条
- ≈ 1TB（只需保留最近 200 条）

发件箱（发出去的微博）：
- 1 亿条/天 × 365 天 = 3650 亿条
- 需要分表存储
```

---

## 四、高层设计

```
┌──────────────────────────────────────────────────────────┐
│                        用户请求                            │
│                   GET /api/feed                           │
└─────────────────────────┬────────────────────────────────┘
                          │
              ┌────────────▼────────────┐
              │       API Gateway       │
              │    (认证、限流、路由)     │
              └────────────┬────────────┘
                          │
              ┌────────────▼────────────┐
              │      Feed Service        │
              │   (时间线组装服务)         │
              └────────────┬────────────┘
                          │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
┌────────▼────────┐ ┌──────▼──────┐ ┌───────▼──────┐
│  收件箱 Redis   │ │   微博服务   │ │  用户关系服务  │
│ (用户已拉取的)   │ │  (微博存储)  │ │ (关注列表)    │
└─────────────────┘ └─────────────┘ └───────────────┘
```

---

## 五、核心设计

### 5.1 推模式：写扩散

```java
/**
 * 推模式：写扩散
 *
 * 发微博时，将微博 ID 写入所有粉丝的收件箱
 */
public class PushTimelineService {

    private RedisTemplate<String, Object> redis;
    private MessageQueue mq;

    /**
     * 发布微博（推送给粉丝）
     */
    public void publish(Weibo weibo, User author) {
        // 1. 保存微博内容
        weiboService.save(weibo);

        // 2. 获取粉丝列表
        List<Long> followers = followService.getFollowers(author.getId());

        // 3. 推送消息到 MQ，异步处理
        // 为什么用 MQ？
        // - 粉丝量大，同步推送会超时
        // - 削峰填谷，保护系统
        for (List<Long> batch : Lists.partition(followers, 1000)) {
            mq.send("timeline:push", new PushMessage(weibo.getId(), batch));
        }
    }

    /**
     * 消费推送消息，写入粉丝收件箱
     */
    @KafkaListener(topics = "timeline:push")
    public void consumePushMessage(PushMessage message) {
        Long weiboId = message.getWeiboId();
        List<Long> followers = message.getFollowers();

        for (Long followerId : followers) {
            // 收件箱使用 Redis ZSet（有序集合）
            // Key: timeline:{userId}
            // Score: 发布时间戳（用于排序）
            // Value: 微博 ID
            redis.opsForZSet().add(
                "timeline:" + followerId,
                weiboId.toString(),
                weibo.getCreateTime()
            );

            // 保留最近 200 条（防止收件箱过大）
            redis.opsForZSet().removeRange(
                "timeline:" + followerId,
                0,
                -201  // 移除排名 0 到 -201（保留前 200 条）
            );
        }
    }
}
```

### 5.2 拉模式：读扩散

```java
/**
 * 拉模式：读扩散
 *
 * 用户请求时，实时聚合关注列表的微博
 */
public class PullTimelineService {

    private WeiboMapper weiboMapper;
    private FollowMapper followMapper;

    /**
     * 获取时间线（拉模式）
     *
     * 问题：关注 5000 人，每人最近 20 条微博
     * → 需要合并 5000 × 20 = 10万 条数据
     * → 10万 条数据排序，耗时可能 > 1 秒
     *
     * 优化方案见下
     */
    public List<Weibo> getTimeline(Long userId, int page, int pageSize) {
        // 1. 获取关注列表
        List<Long> followingIds = followMapper.getFollowing(userId);

        // 2. 分批查询关注用户的微博
        // 问题：5000 个 IN 查询，数据库扛不住
        // 解决：限制只查最近 24 小时的数据，减少数据量
        LocalDateTime since = LocalDateTime.now().minusHours(24);
        List<Weibo> allWeibos = new ArrayList<>();

        // 分批查询，每批最多 100 个用户
        for (List<Long> batch : Lists.partition(followingIds, 100)) {
            List<Weibo> weibos = weiboMapper.findByAuthors(
                batch, since, pageSize * 3  // 多查一些，留有余量
            );
            allWeibos.addAll(weibos);
        }

        // 3. 合并排序（按时间倒序）
        return allWeibos.stream()
            .sorted(Comparator.comparing(Weibo::getCreateTime).reversed())
            .skip((long) (page - 1) * pageSize)
            .limit(pageSize)
            .collect(Collectors.toList());
    }
}
```

### 5.3 混合模式：最优解

```java
/**
 * 混合模式（微博实际方案）
 *
 * 普通用户 → 推模式（写扩散）
 * 大 V 用户 → 拉模式（读扩散）
 */
public class HybridTimelineService {

    private static final long BIG_V_THRESHOLD = 100_000; // 10万粉丝

    private PushTimelineService pushService;
    private PullTimelineService pullService;
    private WeiboMapper weiboMapper;

    /**
     * 获取时间线（混合模式）
     */
    public List<Weibo> getTimeline(Long userId, int page, int pageSize) {
        List<Weibo> result = new ArrayList<>();

        // 1. 先从收件箱获取「推送」过来的微博（推模式）
        List<Long> pushedWeiboIds = redis.opsForZSet().reverseRange(
            "timeline:" + userId, 0, 99  // 最近 100 条
        );

        if (!pushedWeiboIds.isEmpty()) {
            List<Weibo> pushedWeibos = weiboMapper.findByIds(pushedWeiboIds);
            // 按时间排序
            pushedWeibos.sort(Comparator.comparing(Weibo::getCreateTime).reversed());
            result.addAll(pushedWeibos);
        }

        // 2. 再「拉取」大 V 的微博（拉模式）
        // 大 V 定义：粉丝数 > 10万
        List<Long> bigVFollowing = followService.getBigVFollowing(userId);

        if (!bigVFollowing.isEmpty()) {
            List<Weibo> bigVWeibos = pullService.getBigVWeibos(
                bigVFollowing,
                page,
                pageSize - result.size()
            );
            result.addAll(bigVWeibos);
        }

        // 3. 去重 + 截取分页
        return result.stream()
            .distinct()
            .sorted(Comparator.comparing(Weibo::getCreateTime).reversed())
            .skip((long) (page - 1) * pageSize)
            .limit(pageSize)
            .collect(Collectors.toList());
    }

    /**
     * 发微博（自动选择模式）
     */
    public void publish(Weibo weibo, User author) {
        weiboService.save(weibo);

        long followerCount = followService.getFollowerCount(author.getId());

        if (followerCount < BIG_V_THRESHOLD) {
            // 普通用户：推模式
            pushService.pushToFollowers(weibo, author);
        }
        // 大 V 不推，等粉丝来拉
    }
}
```

### 5.4 缓存优化

```java
/**
 * 时间线缓存优化
 *
 * 核心思路：热点用户的微博缓存，减少数据库查询
 */
public class TimelineCache {

    private RedisTemplate<String, Object> redis;

    /**
     * 缓存热点微博
     *
     * 热点定义：24 小时内被访问 > 1000 次
     */
    public void cacheHotWeibo(Weibo weibo) {
        // 热点微博直接缓存内容
        redis.opsForValue().set(
            "weibo:content:" + weibo.getId(),
            weibo,
            Duration.ofHours(6)
        );

        // 更新热点微博 ID 列表
        redis.opsForZSet().add("weibo:hot", weibo.getId().toString(), weibo.getCreateTime());
    }

    /**
     * 获取微博内容（带缓存）
     */
    public Weibo getWeibo(Long weiboId) {
        // 1. 先查缓存
        Weibo cached = (Weibo) redis.opsForValue().get("weibo:content:" + weiboId);
        if (cached != null) {
            // 记录访问（用于热点检测）
            redis.opsForHyperLogLog().add("weibo:access", weiboId.toString());
            return cached;
        }

        // 2. 缓存未命中，查数据库
        Weibo weibo = weiboMapper.selectById(weiboId);
        if (weibo != null) {
            // 回填缓存
            cacheHotWeibo(weibo);
        }

        return weibo;
    }
}
```

---

## 六、延伸问题

### 问题一：如何实现「智能排序」？

```
不仅仅是时间排序，还有：

1. 互动权重（点赞、评论、转发）
2. 亲密度（与某用户互动越多，越容易看到）
3. 原创权重（原创 > 转发）
4. 视频/图片权重（多媒体 > 纯文字）

实现：微博的「热度」分数 = f(时间, 互动, 亲密度)
      最终排序：混合时间线和热度分数
```

### 问题二：如何实现「信息流翻页」？

```
方案一：游标翻页（推荐）
- 记录上次最后一条的 ID 和时间戳
- 下一页：WHERE create_time < last_timestamp AND id < last_id

方案二：偏移量翻页
- LIMIT 20 OFFSET 200
- 问题：OFFSET 越大，性能越差
```

### 问题三：大 V 发微博时，如何避免写入爆炸？

```
方案：
1. 粉丝分组：1万粉丝一组，异步分组推送
2. 热门检测：如果微博被转发，临时转为拉模式
3. 降级策略：超过 1000 万粉丝的大 V，不推只拉
```

---

## 七、总结

```
┌─────────────────────────────────────────────────────┐
│            时间线系统核心知识点                       │
├─────────────────────────────────────────────────────┤
│                                                     │
│  推拉模式                                            │
│  ├── 推模式（写扩散）：读快写慢                       │
│  ├── 拉模式（读扩散）：写快读慢                       │
│  └── 混合模式：普通用户推，大 V 拉 ← 微博方案         │
│                                                     │
│  存储结构                                            │
│  ├── 收件箱：Redis ZSet（按时间排序）                 │
│  └── 发件箱：MySQL 分表（按用户 ID）                 │
│                                                     │
│  性能优化                                            │
│  ├── 热点微博缓存                                    │
│  ├── 分批处理 + MQ 异步                              │
│  └── 大 V 隔离                                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能画清楚推拉模式的架构图
- 能分析为什么微博选择混合模式
- 能解释 Redis ZSet 在收件箱中的应用
- 能说出大 V 问题的解决方案
