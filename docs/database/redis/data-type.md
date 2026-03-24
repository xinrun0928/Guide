# Redis 数据类型：String、Hash、List、Set、ZSet

99% 的面试官问完「Redis 支持哪些数据类型」，下一句就是：「那你实际用过哪些？」

光背答案是没用的，你需要理解**每种类型的底层实现、适用场景和性能特点**。

## Redis 数据类型全景图

Redis 提供了 8 种基础数据类型（Redis 7.0 又新增了 4 种）：

```
┌──────────────────────────────────────────────────────────────┐
│                        Redis 数据类型                         │
├──────────────────────────────────────────────────────────────┤
│  基础类型          │  容器类型           │  特殊类型           │
│  ─────────────    │  ─────────────     │  ─────────────     │
│  String (字符串)   │  Hash (哈希)       │  Bitmaps (位图)     │
│  List (列表)      │  Set (集合)        │  HyperLogLog        │
│                   │  ZSet (有序集合)   │  GEO (地理坐标)     │
│                   │                    │  Stream (流)        │
└──────────────────────────────────────────────────────────────┘
```

先来看最核心的 5 种基础类型。

## String：最简单，也最常用

### 内部实现

Redis 的 String 不是普通的字符串，而是 **SDS（Simple Dynamic String）**：

```c
// SDS 结构（简化版）
struct sdshdr {
    int len;        // 已使用长度
    int alloc;      // 总分配长度
    char flags;     // 类型标识
    char[] buf;     // 实际存储
};
```

SDS 的优势：
- **O(1) 获取长度**：直接读 `len` 字段
- **避免缓冲区溢出**：自动扩容
- **二进制安全**：可以存储任意二进制数据

### 常用命令

```java
// 基本操作
SET key value
GET key
MSET key1 value1 key2 value2  // 批量设置
MGET key1 key2                  // 批量获取

// 数值操作（原子递增）
INCR count      // 自增 1
INCRBY count 10 // 自增 10
DECR count      // 自减 1
DECRBY count 5  // 自减 5

// 其他操作
APPEND key "suffix"    // 追加
STRLEN key            // 长度
SETRANGE key 0 "abc"  // 覆盖
GETRANGE key 0 -1     // 截取
```

### Java 客户端示例

```java
import redis.clients.jedis.Jedis;

public class RedisStringDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 基本操作
            jedis.set("user:name", "张三");
            String name = jedis.get("user:name");
            System.out.println(name);  // 输出: 张三
            
            // 计数器：INCR 原子递增，适合并发场景
            jedis.set("page:views:20240101", "0");
            long views = jedis.incr("page:views:20240101");
            System.out.println("页面访问量: " + views);
            
            // 批量操作减少 RTT
            jedis.mset("key1", "v1", "key2", "v2", "key3", "v3");
            System.out.println(jedis.mget("key1", "key2", "key3"));
            
            // SETNX：分布式锁的基础
            // 只有 key 不存在时才设置成功
            jedis.setnx("lock:order:123", "worker-1");
            
            // 设置过期时间：缓存常用模式
            jedis.setex("session:abc123", 3600, "user_id_123");
        }
    }
}
```

### 适用场景

| 场景 | 说明 |
|-----|------|
| 缓存简单数据 | JSON 序列化后的对象 |
| 计数器 | 访问量、点赞数、库存 |
| 分布式锁 | SETNX + 过期时间 |
| 分布式 Session | 用户会话信息 |

### 注意事项

**String 类型的 value 最大 512MB**，但实际使用时：
- 小于 10KB：性能最优
- 大于 100KB：考虑压缩或拆分
- 存储大对象：用 Hash 替代

## Hash：结构化存储

### 内部实现

Hash 有两种编码方式：

| 场景 | 编码 | 说明 |
|-----|------|------|
| 字段少、值小 | ziplist | 内存紧凑，连续存储 |
| 字段多或值大 | hashtable | O(1) 查找，性能稳定 |

切换条件（redis.conf）：
```bash
hash-max-ziplist-entries 512   # 超过 512 个字段，转为 hashtable
hash-max-ziplist-value 64     # 单个值超过 64 字节，转为 hashtable
```

### 常用命令

```java
// 基本操作
HSET user:1001 name "张三" age "25" city "北京"
HGET user:1001 name
HMGET user:1001 name age
HGETALL user:1001              // 获取所有字段（注意：大 key 问题）

// 计数操作
HINCRBY user:1001 login_count 1

// 其他
HEXISTS user:1001 name         // 是否存在
HKEYS user:1001                // 所有字段名
HVALS user:1001                // 所有值
HLEN user:1001                 // 字段数量
HDEL user:1001 name            // 删除字段
```

### Java 客户端示例

```java
public class RedisHashDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 存储用户信息
            String userId = "1001";
            jedis.hset("user:" + userId, 
                Map.of(
                    "name", "张三",
                    "age", "25",
                    "city", "北京",
                    "followers", "1000"
                )
            );
            
            // 获取用户信息
            String name = jedis.hget("user:" + userId, "name");
            Map&lt;String, String&gt; user = jedis.hgetAll("user:" + userId);
            System.out.println("用户: " + user);
            
            // 字段计数
            jedis.hincrBy("user:" + userId, "followers", 1);
            
            // 用 Hash 替代 String 序列化：字段级操作
            // 比序列化后修改再写回更高效
        }
    }
}
```

### 适用场景

| 场景 | 优势 |
|-----|------|
| 对象存储 | 字段级读写，无需序列化/反序列化 |
| 配置缓存 | 修改单个配置项，不用重写整个对象 |
| 购物车 | 逐个操作商品数量 |

### String vs Hash 怎么选？

```java
public class HashOrString {
    
    /**
     * String + JSON 序列化：
     * - 适合整个对象一起读写的场景
     * - 减少 key 数量
     * - 修改一个字段需要反序列化、修改、序列化
     */
    public void useString() {
        // jedis.set("user:1001", JSON.toJSONString(user));
        // String json = jedis.get("user:1001");
    }
    
    /**
     * Hash：
     * - 适合字段级独立读写的场景
     * - 可以单独修改某个字段
     * - 字段数量不宜过多（建议 < 100）
     */
    public void useHash() {
        // jedis.hset("user:1001", "name", "张三");
        // String name = jedis.hget("user:1001", "name");
    }
}
```

## List：有序列表

### 内部实现

Redis 3.2 之前用 **ziplist + linkedlist**，之后统一用 **quicklist**：

```
quicklist = linkedlist of ziplist
```

```
┌─────────┬─────────┬─────────┬─────────┬─────────┐
│ ziplist │ ziplist │ ziplist │ ziplist │ ziplist │
│ (节点1) │ (节点2) │ (节点3) │ (节点4) │ (节点5) │
└─────────┴─────────┴─────────┴─────────┴─────────┘
     │           │           │           │
     └───────────┴───────────┴───────────┘
              linkedlist 链表
```

ziplist 内存紧凑，linkedlist 支持两端快速操作。**quicklist 兼顾了两者优点**。

### 常用命令

```java
// 两端操作
LPUSH mylist "a" "b" "c"   // 左推入，返回列表长度
RPUSH mylist "x" "y"      // 右推入
LPOP mylist               // 左弹出
RPOP mylist               // 右弹出

// 范围操作
LRANGE mylist 0 -1        // 获取所有元素
LINDEX mylist 0           // 按索引获取
LINSERT mylist BEFORE "b" "bb"  // 插入

// 阻塞操作
BLPOP mylist 0            // 阻塞左弹出（队列空时等待）
BRPOP mylist 0            // 阻塞右弹出

// 其他
LLEN mylist               // 长度
LTRIM mylist 0 99         // 修剪保留指定范围
```

### Java 客户端示例

```java
public class RedisListDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 1. 消息队列（生产者）
            jedis.lpush("queue:msg", "msg1", "msg2", "msg3");
            
            // 2. 消息队列（消费者）- 阻塞版本
            // BRPOP 返回 [key, value]
            List&lt;String&gt; result = jedis.brpop(0, "queue:msg");
            if (result != null) {
                String msg = result.get(1);
                System.out.println("收到消息: " + msg);
            }
            
            // 3. 最新消息列表（新浪微博模式）
            jedis.lpush("feed:user:1001", "msg1", "msg2", "msg3");
            // 只保留最新 100 条
            jedis.ltrim("feed:user:1001", 0, 99);
            // 获取最新 10 条
            List&lt;String&gt; feeds = jedis.lrange("feed:user:1001", 0, 9);
            
            // 4. 文章列表
            jedis.lpush("blog:posts", "post:1001", "post:1002");
            List&lt;String&gt; posts = jedis.lrange("blog:posts", 0, 9);
        }
    }
}
```

### 适用场景

| 场景 | 说明 |
|-----|------|
| 消息队列 | LPUSH + BRPOP 或 RPUSH + BLPOP |
| 时间线/Feed | LPUSH + LTRIM 保持最新 N 条 |
| 任务队列 | 异步任务分发 |
| 最新列表 | 排行榜最新参与者 |

### 注意事项

- List 可以存储 2^32 - 1 个元素
- **BLPOP/BRPOP 可以指定多个 key**，同时监控多个队列
- List 的元素是**字符串**，不是对象（需要序列化）

## Set：无序去重集合

### 内部实现

Set 有两种编码：

| 场景 | 编码 | 说明 |
|-----|------|------|
| 全整数、元素少 | intset | 内存紧凑，二分查找 |
| 其他情况 | hashtable | O(1) 查找 |

### 常用命令

```java
// 基本操作
SADD tags "java" "redis" "mysql"     // 添加（自动去重）
SREM tags "mysql"                     // 删除
SMEMBERS tags                         // 获取所有成员（无序）
SISMEMBER tags "java"                 // 是否存在

// 集合运算
SINTER tag1 tag2                      // 交集
SUNION tag1 tag2                      // 并集
SDIFF tag1 tag2                       // 差集（tag1 有而 tag2 没有的）

// 计数
SCARD tags                            // 集合大小

// 随机操作
SRANDMEMBER tags 2                    // 随机获取 2 个（不删除）
SPOP tags 1                          // 随机弹出 1 个（会删除）
```

### Java 客户端示例

```java
public class RedisSetDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 1. 标签系统
            jedis.sadd("tags:post:1001", "java", "redis", "interview");
            jedis.sadd("tags:post:1002", "java", "mysql", "optimization");
            
            // 找出同时有 java 和 redis 标签的文章
            Set&lt;String&gt; javaAndRedis = jedis.sinter("tags:post:1001", "tags:post:1002");
            System.out.println("Java + Redis: " + javaAndRedis);
            
            // 2. 抽奖系统
            jedis.sadd("lottery:participants", "user1", "user2", "user3", "user4", "user5");
            // 抽取 2 名中奖者
            Set&lt;String&gt; winners = jedis.srandmember("lottery:participants", 2);
            System.out.println("中奖者: " + winners);
            
            // 3. 关注关系（单向）
            jedis.sadd("followers:user:1001", "user001", "user002", "user003");
            jedis.sadd("following:user:1001", "user004", "user005");
            // 查询共同关注
            Set&lt;String&gt; commonFollow = jedis.sinter("following:user:1001", "following:user:1002");
            
            // 4. UV 统计（去重）
            jedis.sadd("uv:20240101", "ip1", "ip2", "ip3");
            long uv = jedis.scard("uv:20240101");
            System.out.println("UV: " + uv);
        }
    }
}
```

### 适用场景

| 场景 | 说明 |
|-----|------|
| 标签系统 | 文章打标签、共同标签计算 |
| 抽奖 | SRANDMEMBER 随机抽取 |
| 关注/粉丝 | 集合运算求共同关注 |
| 去重 | UV 统计、用户去重 |

## ZSet：有序去重集合

### 内部实现

ZSet 是 Redis 最复杂的数据结构，同样有两种编码：

| 编码 | 说明 | 切换条件 |
|-----|------|---------|
| ziplist | 内存紧凑，按分数排序 | 元素 < 128 且每个 < 64 字节 |
| skiplist + hashtable | O(log n) 操作，性能稳定 | 超过阈值时切换 |

面试高频考点：**为什么 ZSet 同时用跳表和哈希表？**

```java
/**
 * ZSet 的双重结构：
 * 
 * 1. 跳表（skiplist）：按分数排序，支持范围查询
 *    - ZRANGE, ZREVRANGE, ZRANGEBYSCORE
 *    - ZRANK, ZREVRANK
 * 
 * 2. 哈希表（hashtable）：按 member 查找分数
 *    - ZSCORE
 *    - ZREM
 * 
 * 为什么需要两个？
 * - 如果只用跳表：按 member 查找需要 O(n)
 * - 如果只用哈希表：范围查询需要遍历所有元素
 * - 两者结合：各有 O(1) 或 O(log n) 的最优操作
 */
```

### 常用命令

```java
// 基本操作
ZADD leaderboard 100 "user1" 200 "user2" 150 "user3"  // 添加
ZSCORE leaderboard "user1"              // 获取分数
ZRANK leaderboard "user1"               // 获取排名（从小到大）
ZREVRANK leaderboard "user1"            // 获取排名（从大到小）
ZREM leaderboard "user1"                 // 删除

// 范围查询
ZRANGE leaderboard 0 9 WITHSCORES       // 获取前 10 名
ZREVRANGE leaderboard 0 9 WITHSCORES   // 获取前 10 名（从大到小）
ZRANGEBYSCORE leaderboard 100 200       // 按分数范围查询

// 计数
ZCARD leaderboard                        // 集合大小
ZCOUNT leaderboard 100 200               // 分数在范围内的数量

// 其他
ZINCRBY leaderboard 50 "user1"           // 增加分数
ZUNIONSTORE dest 2 set1 set2            // 并集聚合
ZINTERSTORE dest 2 set1 set2            // 交集聚合
```

### Java 客户端示例

```java
public class RedisZSetDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 1. 排行榜系统
            String leaderboard = "leaderboard:202401";
            jedis.zadd(leaderboard, 1000, "user001");
            jedis.zadd(leaderboard, 2500, "user002");
            jedis.zadd(leaderboard, 500, "user003");
            jedis.zadd(leaderboard, 3000, "user004");
            
            // 获取用户排名（0-based，从高到低）
            Long rank = jedis.zrevrank(leaderboard, "user002");
            Double score = jedis.zscore(leaderboard, "user002");
            System.out.println("user002 排名: " + (rank + 1) + "，分数: " + score);
            
            // 获取 Top 10
            Set&lt;ZSet.Tuple&gt; top10 = jedis.zrevrangeWithScores(leaderboard, 0, 9);
            System.out.println("Top 10:");
            for (ZSet.Tuple tuple : top10) {
                System.out.println("  " + tuple.getElement() + ": " + tuple.getScore());
            }
            
            // 2. 延迟排行榜（最近活跃）
            String recentActivity = "recent:activity:20240101";
            long now = System.currentTimeMillis();
            jedis.zadd(recentActivity, now, "user001");
            jedis.zadd(recentActivity, now - 3600000, "user002"); // 1小时前
            
            // 获取最近 1 小时活跃用户
            long oneHourAgo = now - 3600000;
            Set&lt;String&gt; recentUsers = jedis.zrangeByScore(recentActivity, 
                String.valueOf(oneHourAgo), String.valueOf(now));
            
            // 3. 视频热度排行
            String videoHot = "video:hot:daily";
            jedis.zincrby(videoHot, 100, "video:1001");
            jedis.zincrby(videoHot, 50, "video:1002");
            
            // 每小时更新一次排行榜
            // cron job: zunionstore 合并多个视频热度到总榜
        }
    }
}
```

### 适用场景

| 场景 | 说明 |
|-----|------|
| 排行榜 | Top N、用户排名 |
| 延时队列 | 分数作为执行时间 |
| 去重 + 排序 | 有权重的标签推荐 |
| 滑动窗口 | 限制频率 |

## 类型选择指南

面对不同场景，如何选择数据类型？

| 需求 | 推荐类型 | 替代方案 |
|-----|---------|---------|
| 缓存对象 | String (JSON) / Hash | - |
| 计数器 | String (INCR) | - |
| 分布式锁 | String (SETNX) | - |
| 消息队列 | List | Stream |
| 标签系统 | Set | - |
| 排行榜 | ZSet | - |
| 最新列表 | List | - |
| 集合运算 | Set | - |

## 总结

Redis 的 5 种基础数据类型，看似简单，实则每个都有独特的适用场景：

- **String**：万金油，但别滥用（序列化大对象）
- **Hash**：结构化数据，字段级操作
- **List**：有序列表，消息队列
- **Set**：去重集合，标签/关系
- **ZSet**：有序去重，排行榜

## 面试追问方向

| 问题 | 考察点 |
|-----|-------|
| String 的最大长度是多少？ | 512MB，理解 SDS 动态扩容 |
| Hash 和 String 做缓存对象哪个好？ | 字段级操作 vs 整体序列化 |
| List 作为消息队列有什么问题？ | 无法避免重复消费、无法广播 |
| ZSet 的跳表和红黑树有什么区别？ | 实现复杂度、范围查询、插入性能 |
