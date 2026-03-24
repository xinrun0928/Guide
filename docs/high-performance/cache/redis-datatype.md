# Redis 9 种数据类型与性能对比

你用 Redis 存 String，但别人用 Redis 存 List、Set、Hash...

同样都是 Redis，为什么性能差距那么大？

因为**数据类型选择错误，会让 Redis 从「极速」变成「蜗牛」**。

今天，我们来彻底搞清楚 Redis 的 9 种数据类型，以及它们的性能差异。

---

## Redis 数据类型一览

| 类型 | 底层实现 | 特点 | 典型场景 |
|------|----------|------|----------|
| **String** | SDS（简单动态字符串） | 最简单 | 缓存、计数器、分布式锁 |
| **Hash** | 压缩列表 / 字典 | field-value 对 | 对象存储、购物车 |
| **List** | 压缩列表 / 双向链表 | 有序、可重复 | 消息队列、最新动态 |
| **Set** | 整数集合 / 字典 | 无序、不重复 | 标签、好友关系 |
| **ZSet** | 压缩列表 / 跳表 + 字典 | 有序、不重复 | 排行榜、延迟队列 |
| **Bitmap** | 位图 | 按位操作 | 签到、用户在线状态 |
| **HyperLogLog** | 基数统计 | 概率算法 | UV 统计 |
| **Geospatial** | 有序集合 | 地理位置 | 附近的人、LBS |
| **Stream** | Radix Tree + 消息队列 | 消息流 | 消息队列、事件流 |

---

## String：最常用的类型

### 底层实现

Redis 使用 **SDS（Simple Dynamic String）** 存储字符串：

```
SDS 结构：
┌────────────┬───────────────────┬──────────────────────┐
│ len (4B)   │ free (4B)         │ chars[]              │
│ 已用长度    │ 剩余空间           │ 实际字符串数据         │
└────────────┴───────────────────┴──────────────────────┘

相比 C 字符串的优势：
- O(1) 获取长度（不需要遍历）
- 防止缓冲区溢出
- 空间预分配 + 惰性释放
```

### 性能特点

| 操作 | 时间复杂度 | 说明 |
|------|------------|------|
| SET | O(1) | 常数时间 |
| GET | O(1) | 常数时间 |
| MGET | O(n) | n 个 key |
| INCR | O(1) | 原子递增 |
| SETRANGE | O(n) | 范围写入 |

### 使用场景

```java
// 1. 普通缓存
redisTemplate.opsForValue().set("user:1001", userJson);

// 2. 计数器
redisTemplate.opsForValue().increment("page:view:20240101");

// 3. 分布式锁
redisTemplate.opsForValue().setIfAbsent("lock:order", "1", Duration.ofSeconds(10));

// 4. 分布式 session
redisTemplate.opsForValue().set("session:abc123", sessionJson, Duration.ofHours(2));
```

### 字符串的「编码」

```bash
# 查看 key 的编码类型
OBJECT ENCODING "user:1001"

# 可能的结果：
# "raw"      - 超过 44 字节
# "int"      - 纯数字字符串（特殊优化）
# "embstr"   - 44 字节以下（更高效的内存布局）
```

---

## Hash：对象存储

### 底层实现

Hash 有两种编码：
- **ziplist（压缩列表）**：元素少时用，内存紧凑
- **hashtable（字典）**：元素多时自动转换

```
ziplist：适合 < 512 个元素，每个 field/value < 64 字节
hashtable：无限制，但内存占用稍高
```

### 性能对比

| 操作 | ziplist | hashtable |
|------|---------|-----------|
| HGET | O(n) | O(1) |
| HSET | O(n) | O(1) |
| HGETALL | O(n) | O(n) |
| 内存占用 | 低 | 中 |
| 适用场景 | 少量字段 | 多字段 |

### 使用场景

```java
// 购物车：userId → {productId: count}
public void addToCart(Long userId, Long productId, int count) {
    String key = "cart:" + userId;
    
    if (count <= 0) {
        // 移除商品
        redisTemplate.opsForHash().delete(key, productId.toString());
    } else {
        // 添加/更新商品
        redisTemplate.opsForHash().put(key, productId.toString(), count);
    }
}

public Map&lt;Long, Integer&gt; getCart(Long userId) {
    String key = "cart:" + userId;
    Map&lt;Object, Object&gt; entries = redisTemplate.opsForHash().entries(key);
    
    return entries.entrySet().stream()
        .collect(Collectors.toMap(
            e -&gt; Long.parseLong(e.getKey().toString()),
            e -&gt; Integer.parseInt(e.getValue().toString())
        ));
}
```

### Hash vs String（JSON）

```java
// 方式 1：String 存储整个对象（JSON）
// 优点：简单，序列化/反序列化灵活
// 缺点：修改一个字段需要读取整个对象
String userJson = (String) redisTemplate.opsForValue().get("user:1001");
User user = JSON.parseObject(userJson);
user.setName("新名字");
redisTemplate.opsForValue().set("user:1001", JSON.toJSONString(user));

// 方式 2：Hash 存储对象字段
// 优点：可以单独修改字段
// 缺点：无法批量操作
redisTemplate.opsForHash().put("user:1001", "name", "新名字");
```

---

## List：消息队列

### 底层实现

- **ziplist**：元素少时用
- **linkedlist**：元素多时用

### 性能特点

| 操作 | 时间复杂度 | 说明 |
|------|------------|------|
| LPUSH/RPOP | O(1) | 左进右出（队列） |
| RPUSH/LPOP | O(1) | 右进左出 |
| LPUSH/LPUSH | O(1) | 左进左出（栈） |
| LINDEX | O(n) | 按索引获取（慎用） |
| LRANGE | O(start+n) | 范围获取 |

### 使用场景

```java
// 最新消息列表（类似微博 Timeline）
public void publishMessage(Long userId, String message) {
    String key = "timeline:" + userId;
    
    // LPUSH：左侧插入（最新在左边）
    redisTemplate.opsForList().leftPush(key, message);
    
    // 保留最新 100 条
    redisTemplate.opsForList().trim(key, 0, 99);
}

public List&lt;String&gt; getTimeline(Long userId, int page, int size) {
    String key = "timeline:" + userId;
    int start = page * size;
    
    return redisTemplate.opsForList().range(key, start, start + size - 1);
}
```

### List vs Stream

```java
// List 实现简单消息队列（生产一次，消费一次）
// 问题：无法确认消息是否被处理过

// Stream 实现可靠消息队列（支持消费确认）
// 优点：消息持久化、消费者组、确认机制
XADD mystream * sensor-id 1 temperature 25.5
XREADGROUP group1 consumer1 STREAMS mystream ">"
XACK mystream group1 $message-id
```

---

## Set：集合运算

### 底层实现

- **intset**：所有元素都是整数，且数量少
- **hashtable**：其他情况

### 性能特点

| 操作 | 时间复杂度 | 说明 |
|------|------------|------|
| SADD | O(1) | 添加元素 |
| SISMEMBER | O(1) | 存在性检查 |
| SINTER | O(n×m) | 交集（最慢） |
| SUNION | O(n) | 并集 |
| SDIFF | O(n) | 差集 |

### 使用场景

```java
// 标签系统：一个商品多个标签
redisTemplate.opsForSet().add("product:1001:tags", "手机", "5G", "旗舰");

// 判断是否包含某个标签
Boolean hasTag = redisTemplate.opsForSet()
    .isMember("product:1001:tags", "5G");

// 好友关系
redisTemplate.opsForSet().add("user:1001:friends", "1002", "1003", "1004");
redisTemplate.opsForSet().add("user:1002:friends", "1001", "1003");

// 共同好友
Set&lt;Object&gt; mutualFriends = redisTemplate.opsForSet()
    .intersect("user:1001:friends", "user:1002:friends");
```

---

## ZSet：排行榜

### 底层实现

- **ziplist**：元素少时用（内存紧凑，但操作 O(n)）
- **skiplist + dict**：元素多时用（跳表保证有序，字典保证 O(1) 查找）

### 为什么用跳表？

```
普通链表：O(n) 查找
跳表：O(log n) 查找（多级索引）

跳表结构：
Level 2:  1 ────────────────────────────→ 10
Level 1:  1 ─────→ 5 ─────→ 8 ─────→ 10
Level 0:  1 → 3 → 5 → 7 → 8 → 9 → 10

查找 7：从 Level 2 开始，逐步下沉
```

### 性能特点

| 操作 | 时间复杂度 | 说明 |
|------|------------|------|
| ZADD | O(log n) | 添加/更新 |
| ZRANGE | O(log n + m) | 按排名范围查 |
| ZREVRANGE | O(log n + m) | 倒序 |
| ZSCORE | O(1) | 获取分数 |
| ZRANK | O(log n) | 获取排名 |

### 使用场景

```java
// 实时排行榜
public void updateScore(Long userId, double score) {
    redisTemplate.opsForZSet().add("leaderboard", userId.toString(), score);
}

public List&lt;Long&gt; getTopN(int n) {
    Set&lt;Object&gt; top = redisTemplate.opsForZSet()
        .reverseRange("leaderboard", 0, n - 1);
    
    return top.stream()
        .map(Object::toString)
        .map(Long::parseLong)
        .collect(Collectors.toList());
}

public Long getRank(Long userId) {
    Long rank = redisTemplate.opsForZSet()
        .reverseRank("leaderboard", userId.toString());
    return rank != null ? rank + 1 : null;  // 排名从 1 开始
}
```

---

## Bitmap：位图操作

### 原理

用 bit 位存储数据，每个 bit 可以是 0 或 1。

```
用户签到（1 年 365 天）：
普通存储：365 个 bool = 365 字节
Bitmap 存储：365 bits ≈ 46 字节
节省 80% 空间！
```

### 使用场景

```java
// 用户签到
public void signIn(Long userId, LocalDate date) {
    String key = "sign:" + userId + ":" + date.format(DateTimeFormatter.ofPattern("yyyy"));
    int offset = date.getDayOfYear() - 1;  // 0-364
    
    redisTemplate.opsForValue().setBit(key, offset, true);
}

public boolean hasSignIn(Long userId, LocalDate date) {
    String key = "sign:" + userId + ":" + date.format(DateTimeFormatter.ofPattern("yyyy"));
    int offset = date.getDayOfYear() - 1;
    
    return Boolean.TRUE.equals(redisTemplate.opsForValue().getBit(key, offset));
}

public long getConsecutiveDays(Long userId, LocalDate date) {
    // 统计连续签到天数
    long count = 0;
    LocalDate current = date;
    
    while (hasSignIn(userId, current)) {
        count++;
        current = current.minusDays(1);
    }
    
    return count;
}
```

---

## HyperLogLog：基数统计

### 原理

用概率算法统计**不重复元素的数量**，标准误差 ≈ 0.81%。

```
存储 100 万用户 ID：
- 普通 Set：需要 ~100MB 内存
- HyperLogLog：只需要 ~12KB 内存
- 误差：0.81%，即 ±8100

适合场景：UV 统计、注册用户数统计
不适合场景：需要 100% 准确的数据
```

### 使用场景

```java
// UV 统计
public void recordVisit(String pageId, String visitorId) {
    redisTemplate.opsForHyperLogLog().add("uv:" + pageId, visitorId);
}

public long getUV(String pageId) {
    return redisTemplate.opsForHyperLogLog().size("uv:" + pageId);
}

// 合并多天数据
redisTemplate.opsForHyperLogLog().union("uv:week", 
    "uv:20240101", "uv:20240102", "uv:20240103");
```

---

## Stream：消息流

### 与 List 的区别

| 特性 | List | Stream |
|------|------|--------|
| 持久化 | 可选 | 默认持久化 |
| 消费者组 | 不支持 | 支持 |
| ACK 确认 | 不支持 | 支持 |
| 消息 ID | 无 | 自动生成（时间戳+序号） |
| 消费确认 | 无 | 支持 |

### 使用场景

```java
// 创建消费者组
redisTemplate.opsForStream().createGroup("orders", "order-processors", "0");

// 生产消息
Map&lt;String, Object&gt; fields = new HashMap&lt;&gt;();
fields.put("order_id", "ORDER001");
fields.put("amount", 100.00);
redisTemplate.opsForStream().add("orders", fields);

// 消费消息
StreamOffset&lt;String&gt; offset = StreamOffset.create("orders", ReadOffset.last());
List&lt;Map&gt; messages = redisTemplate.opsForStream().read(
    String.class, String.class,
    Consumer.from("consumer-1", "group-1"),
    StreamReadOptions.empty().count(10),
    offset
);

// 确认消息
for (Map message : messages) {
    // 处理消息
    processOrder(message);
    
    // ACK 确认
    String messageId = message.getId();
    redisTemplate.opsForStream().acknowledge("orders", "group-1", messageId);
}
```

---

## 性能对比总结

| 类型 | 写入性能 | 读取性能 | 内存效率 | 适用场景 |
|------|----------|----------|----------|----------|
| String | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 通用 |
| Hash | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 对象 |
| List | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 队列 |
| Set | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | 去重 |
| ZSet | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 排行 |
| Bitmap | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 状态 |
| HyperLogLog | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 统计 |
| Stream | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | 队列 |

---

## 总结

Redis 的 9 种数据类型各有特点：

| 场景 | 推荐类型 |
|------|----------|
| 简单缓存 | String |
| 用户信息 | Hash |
| 消息队列 | List / Stream |
| 标签/好友 | Set |
| 排行榜 | ZSet |
| 签到/状态 | Bitmap |
| UV 统计 | HyperLogLog |
| LBS 附近 | Geospatial |

**最佳实践**：
- 不要过度设计：能用 String 就不用 Hash
- 不要嵌套使用：Hash 嵌套 Hash 性能差
- 注意编码转换：元素少用 ziplist，多用 hashtable

---

## 留给你的问题

假设你需要实现一个**朋友圈 Timeline** 功能：

需求：
1. 每个用户有自己的 Timeline（最新动态）
2. 发布动态时，Timeline 需要更新
3. Timeline 按时间倒序
4. 需要支持分页加载

请思考：
1. 用 List、ZSet 还是 Stream 实现？为什么？
2. 如果用户关注了 1000 人，Timeline 如何聚合？
3. 如何实现「下拉刷新」和「上拉加载更多」？
4. 如果一个人发了 10000 条动态，Timeline 最多保留多少条？

提示：Timeline 是「读多写少」的场景，适合用推拉结合的模式。
