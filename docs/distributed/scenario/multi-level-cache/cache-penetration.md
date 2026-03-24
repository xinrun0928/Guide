# 缓存穿透：布隆过滤器 + 空值缓存方案

你有没有遇到过这种情况：数据库被大量「不存在」的查询打爆了？

日志里全是 `SELECT * FROM product WHERE id = xxx` 的慢查询，但奇怪的是，这些 id 在数据库里根本不存在。

更奇怪的是，Redis 缓存里也没有这些 key。

这就是**缓存穿透**。

## 穿透的本质

```
正常请求：id=1 → 查缓存（命中） → 返回
正常请求：id=2 → 查缓存（未命中） → 查数据库 → 写入缓存 → 返回

穿透请求：id=999999 → 查缓存（未命中） → 查数据库（未命中） → 不写缓存 → 返回 null
                        ↑
                        每次都打数据库
```

问题的关键在于：**数据库和缓存里都没有这个数据**。

正常情况下，不存在的数据偶尔查询一次没什么。但如果有人故意构造大量不存在的 id（恶意攻击），每个请求都会穿过缓存，直接打到数据库。

数据库能承受的 QPS 是有限的，正常流量可能只有几千，被穿透后可能瞬间被打垮。

## 方案一：空值缓存

最简单粗暴的方案。

```java
public Product getProduct(Long id) {
    // 先查缓存
    Product cached = cache.get(id);
    if (cached != null) {
        return cached;
    }

    // 缓存未命中，查数据库
    Product product = productMapper.selectById(id);

    // 数据库也没有，缓存空值
    if (product == null) {
        cache.set(id, NULL_VALUE);  // 用一个特殊值表示 null
    } else {
        cache.set(id, product);
    }

    return product;
}
```

后续同样的请求，缓存命中，直接返回，不用查数据库。

### 空值缓存的问题

1. **浪费缓存空间**：大量无效数据占据了缓存，真正的热点数据可能被挤出去
2. **数据不一致**：如果数据后来有了，需要删除这个空值缓存
3. **无法区分「真的不存在」和「还没来得及回填」**

所以空值缓存只适合**短期防护**，真正有效的是布隆过滤器。

## 方案二：布隆过滤器

布隆过滤器的核心思想是：**用空间换时间，快速判断一个 key 是否可能存在。**

### 原理

布隆过滤器使用一个位数组和多个哈希函数：

```
假设有 3 个哈希函数：H1, H2, H3

添加 "user:100"：
H1("user:100") = 3  →  bit[3] = 1
H2("user:100") = 7  →  bit[7] = 1
H3("user:100") = 12 →  bit[12] = 1

添加 "user:200"：
H1("user:200") = 5  →  bit[5] = 1
H2("user:200") = 7  →  bit[7] = 1  (7 已经是 1 了)
H3("user:200") = 3  →  bit[3] = 1  (3 已经是 1 了)

查询 "user:100"：
H1 = 3 (1), H2 = 7 (1), H3 = 12 (1) → 全是 1 → 可能存在

查询 "user:999"：
H1 = 9 (0) → 有一个是 0 → 一定不存在
```

### 关键特性

**不存在 → 一定不存在**（不会漏判）

**存在 → 可能存在**（可能误判）

这是布隆过滤器的核心特点：**宁可误杀，不可放过**。

### 误判率控制

布隆过滤器的误判率由数组大小 `m` 和哈希函数数量 `k` 决定：

```
m = -n * ln(p) / (ln(2)²)
k = (m / n) * ln(2)
```

其中：
- `n` = 元素数量
- `p` = 目标误判率

例如，插入 100 万条数据，要求误判率 1%：

```java
long expectedInsertions = 1_000_000;
double fpp = 0.01;

BloomFilter&lt;String&gt; filter = BloomFilter.create(
    Funnels.stringFunnel(StandardCharsets.UTF_8),
    expectedInsertions,
    fpp
);
```

### 布隆过滤器的 Java 实现

使用 Guava 的布隆过滤器：

```java
@Service
public class ProductService {

    private BloomFilter&lt;String&gt; bloomFilter;

    @PostConstruct
    public void init() {
        // 初始化布隆过滤器
        // 从数据库加载所有已存在的 id
        bloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            10_000_000,   // 预估元素数
            0.01           // 误判率 1%
        );

        // 启动时加载所有商品 ID
        List&lt;Long&gt; allProductIds = productMapper.selectAllIds();
        allProductIds.forEach(id -> bloomFilter.put("product:" + id));
    }

    public Product getProduct(Long id) {
        String key = "product:" + id;

        // 第一步：布隆过滤器判断
        if (!bloomFilter.mightContain(key)) {
            // 布隆过滤器说不存在 → 一定不存在 → 直接返回
            return null;
        }

        // 第二步：查 Redis 缓存
        Product cached = redisCache.get(id);
        if (cached != null) {
            return cached;
        }

        // 第三步：查数据库
        Product product = productMapper.selectById(id);

        if (product != null) {
            redisCache.set(id, product);
        }

        return product;
    }
}
```

### 完整防护流程

```
请求 id=999999
        │
        ▼
┌─────────────────┐
│  布隆过滤器检查  │
└────────┬────────┘
         │
    mightContain?
         │
    ┌────┴────┐
    │         │
   Yes        No
    │         │
    ▼         ▼
查 Redis   直接返回 null
    │         (不查数据库)
  命中?
    │
┌───┴───┐
│       │
Yes      No
 │       │
 ▼       ▼
 返回   查 DB
```

## RedisBloom 布隆过滤器

Guava 的布隆过滤器是本地缓存，数据量大会占用 JVM 堆内存。在分布式场景下，可以用 RedisBloom。

```java
@Autowired
private RedisTemplate&lt;String, String&gt; redisTemplate;

public boolean mightExist(String key) {
    // 使用 Redis 的 BF.EXISTS 命令
    return Boolean.TRUE.equals(
        redisTemplate.execute(
            new RedisCallback&lt;Boolean&gt;() {
                @Override
                public Boolean doInRedis(RedisConnection connection) throws DataAccessException {
                    byte[] keyBytes = key.getBytes();
                    return connection.commands().bFExists(keyBytes, keyBytes);
                }
            }
        )
    );
}
```

### 布隆过滤器数据同步

布隆过滤器的数据需要和数据库保持同步：

1. **新增数据**：写入数据库后，添加到布隆过滤器
2. **删除数据**：从布隆过滤器删除（注意：布隆过滤器不支持删除）
3. **重建**：定期从数据库全量重建布隆过滤器

```java
// 异步添加（防止阻塞主流程）
@Async
public void addToBloomFilter(Long productId) {
    bloomFilter.put("product:" + productId);
}

// 定期重建
@Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
public void rebuildBloomFilter() {
    // 从数据库加载所有数据重建
    List&lt;Long&gt; allIds = productMapper.selectAllIds();

    BloomFilter&lt;String&gt; newFilter = BloomFilter.create(
        Funnels.stringFunnel(StandardCharsets.UTF_8),
        allIds.size() * 1.2,  // 预留 20% 空间
        0.01
    );

    allIds.forEach(id -> newFilter.put("product:" + id));

    this.bloomFilter = newFilter;
}
```

## 面试追问方向

- 布隆过滤器为什么不能删除？（答：删除会影响其他 key 的判断，可能产生假阴性）
- 布隆过滤器的空间占用怎么计算？（答：`m = -n * ln(p) / (ln(2)²)`）
- 如何解决布隆过滤器的误判问题？（答：布隆说过「存在就去查一下」，配合 Redis/DB 做二次确认）
- 布隆过滤器和缓存穿透、空值缓存的关系？（答：布隆过滤器做第一层过滤，空值缓存做第二层防护）

## 小结

缓存穿透的防护要分层：

1. **布隆过滤器**：快速判断 key 是否可能存在，「不存在就一定不存在」
2. **空值缓存**：短期防护「已知的空值」，节省后续查询
3. **限流**：如果穿透是恶意攻击，限流是第一道防线

布隆过滤器是当前最主流的方案，它的「宁可误杀、不可放过」特性，完美适配缓存穿透的场景。
