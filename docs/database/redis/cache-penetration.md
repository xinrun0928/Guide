# 缓存穿透：布隆过滤器 + 缓存空值

用户访问一个不存在的商品详情页。
请求直接打到数据库，数据库被压垮。

这就是**缓存穿透**。

## 什么是缓存穿透？

缓存穿透是指：**查询一个不存在的数据，由于缓存和数据库都没有，请求直接打到数据库**。

```
正常流程：
┌─────────┐    ┌─────────┐    ┌─────────┐
│  请求   │───▶│  缓存   │───▶│  数据库  │
│         │    │  命中   │    │  (不查)  │
└─────────┘    └─────────┘    └─────────┘

缓存穿透：
┌─────────┐    ┌─────────┐    ┌─────────┐
│  请求   │───▶│  缓存   │───▶│  数据库  │
│         │    │ (未命中) │    │  (查询)  │
└─────────┘    └─────────┘    └─────────┘
                   ✗
        每次都查数据库！
```

## 穿透的危害

| 危害 | 说明 |
|-----|------|
| 数据库压力 | 大量无效请求打到数据库 |
| 性能下降 | 数据库响应慢，影响正常业务 |
| 雪崩风险 | 数据库崩溃导致整个系统不可用 |
| 资源浪费 | CPU、内存被消耗 |

## 为什么会发生穿透？

### 场景一：恶意攻击

攻击者使用大量不存在的 ID 请求：

```
请求：product:-1, product:-2, product:-9999999
原因：试探系统、压垮服务
```

### 场景二：业务逻辑

```
商品下架后，URL 仍然可访问
用户点击 → 查询数据库 → 返回空
缓存没有 → 继续查数据库
```

### 场景三：数据误删

```
误删了数据库中的商品
但缓存已过期
用户查询 → 缓存未命中 → 查询数据库 → 返回空
```

## 解决方案

### 方案一：缓存空值

**原理**：将空结果也缓存起来，下次查询直接命中。

```java
/**
 * 缓存空值方案
 * 
 * 优点：实现简单，效果明显
 * 缺点：浪费缓存空间（空值也占空间）
 */
public String getProduct(String productId) {
    // 1. 查询缓存
    String cacheKey = "product:" + productId;
    String cacheValue = redis.get(cacheKey);
    
    if (cacheValue != null) {
        // 2. 命中缓存
        return cacheValue;
    }
    
    // 3. 查询数据库
    Product product = db.findProduct(productId);
    
    if (product == null) {
        // 4. 数据库也没有，缓存空值
        // 注意：空值要有过期时间，否则正常数据恢复后仍然查不到
        redis.setex(cacheKey, 5 * 60, "NULL");  // 空值缓存 5 分钟
        return null;
    }
    
    // 5. 缓存正常数据
    redis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
    return JSON.toJSONString(product);
}
```

### 方案二：布隆过滤器

**原理**：用布隆过滤器判断数据是否存在，只对存在的数据查询缓存和数据库。

```java
/**
 * 布隆过滤器原理：
 * 
 * 1. 初始化：将所有存在的 key 插入布隆过滤器
 * 2. 查询时：先检查布隆过滤器
 *    - 不存在 → 直接返回，不查数据库
 *    - 可能存在 → 查缓存，再查数据库
 * 
 * 特点：
 * - 空间效率高
 * - 可能有误判（false positive）
 * - 不可能有漏判（false negative）
 */
public class BloomFilterDemo {
    
    // Guava 的布隆过滤器
    private BloomFilter<String> bloomFilter;
    
    /**
     * 初始化布隆过滤器（系统启动时）
     */
    public void init() {
        // 从数据库加载所有存在的商品 ID
        List&lt;String&gt; allProductIds = db.getAllProductIds();
        
        bloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            1000000,  // 预计数据量
            0.01      // 误判率 1%
        );
        
        for (String productId : allProductIds) {
            bloomFilter.put(productId);
        }
    }
    
    /**
     * 查询商品
     */
    public Product getProduct(String productId) {
        // 1. 检查布隆过滤器
        if (!bloomFilter.mightContain(productId)) {
            // 2. 布隆过滤器判断不存在，直接返回
            return null;
        }
        
        // 3. 布隆过滤器说可能存在，查缓存
        String cacheKey = "product:" + productId;
        String cacheValue = redis.get(cacheKey);
        
        if (cacheValue != null) {
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 4. 查数据库
        Product product = db.findProduct(productId);
        
        if (product != null) {
            redis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
        }
        
        return product;
    }
}
```

### 方案三：布隆过滤器 + 缓存空值（最佳实践）

两种方案结合，取长补短：

```java
public class Cache穿透防护 {
    
    private BloomFilter&lt;String&gt; bloomFilter;
    private Jedis jedis;
    
    /**
     * 查询商品（双重防护）
     */
    public Product getProduct(String productId) {
        String cacheKey = "product:" + productId;
        
        // 第一层：布隆过滤器过滤明显不存在的数据
        if (!bloomFilter.mightContain(productId)) {
            // 布隆过滤器说一定不存在
            return null;
        }
        
        // 第二层：查缓存（包含空值）
        String cacheValue = jedis.get(cacheKey);
        
        if (cacheValue != null) {
            if ("NULL".equals(cacheValue)) {
                // 空值缓存，说明之前查过且数据库也没有
                return null;
            }
            return JSON.parseObject(cacheValue, Product.class);
        }
        
        // 第三层：查数据库
        Product product = db.findProduct(productId);
        
        if (product != null) {
            // 缓存正常数据
            jedis.setex(cacheKey, 30 * 60, JSON.toJSONString(product));
        } else {
            // 缓存空值，但时间短一些（避免长期占用）
            jedis.setex(cacheKey, 2 * 60, "NULL");
        }
        
        return product;
    }
    
    /**
     * 商品新增时，添加到布隆过滤器
     */
    public void addProduct(Product product) {
        bloomFilter.put(product.getId());
    }
    
    /**
     * 商品删除时，从布隆过滤器移除
     * 注意：布隆过滤器不支持删除单个元素
     * 解决：重建布隆过滤器 或 使用带删除功能的变体（如 Cuckoo Filter）
     */
    public void removeProduct(String productId) {
        // 方案 1：重建整个布隆过滤器（数据量小时可用）
        rebuildBloomFilter();
    }
}
```

## 方案对比

| 方案 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| 缓存空值 | 实现简单，效果明显 | 浪费空间，数据不一致风险 | 数据量较小 |
| 布隆过滤器 | 空间效率高 | 有误判，不支持删除 | 数据量很大 |
| 组合方案 | 双重防护，最完善 | 实现稍复杂 | 生产环境推荐 |

## 布隆过滤器的实现

### RedisBloom 模块

Redis 4.0+ 可以使用 RedisBloom 模块：

```bash
# 安装 RedisBloom
docker run -d --name redis-bloom redis/redis-stack:latest

# 添加元素
BF.ADD products -1
BF.ADD products -2

# 检查元素
BF.EXISTS products -1    # 1（可能存在）
BF.EXISTS products 999  # 0（一定不存在）

# 批量添加
BF.MADD products -3 -4 -5

# 批量检查
BF.MEXISTS products -1 -3 -999
```

### Java 客户端

```java
import com.redislabs.redisgraph.RedisGraph;
import com.redislabs.modules.rebloom.JedisFilter;

public class RedisBloomDemo {
    
    private Jedis jedis;
    private static final String FILTER_NAME = "products";
    
    /**
     * 初始化布隆过滤器
     */
    public void init() {
        // 添加已存在的商品 ID
        List&lt;String&gt; existingIds = getExistingProductIds();
        
        jedis.bf().add(FILTER_NAME, existingIds.toArray(new String[0]));
    }
    
    /**
     * 检查是否存在
     */
    public boolean mightExist(String productId) {
        return jedis.bf().exists(FILTER_NAME, productId);
    }
    
    /**
     * 批量检查
     */
    public List&lt;String&gt; filterNotExists(List&lt;String&gt; ids) {
        // 过滤掉布隆过滤器认为存在的
        return ids.stream()
            .filter(id -> !mightExist(id))
            .collect(Collectors.toList());
    }
}
```

### Guava 实现

```java
import com.google.common.hash.BloomFilter;
import com.google.common.hash.Funnels;

public class GuavaBloomFilterDemo {
    
    private BloomFilter&lt;String&gt; bloomFilter;
    
    /**
     * 初始化
     */
    public void init(int expectedInsertions) {
        bloomFilter = BloomFilter.create(
            Funnels.stringFunnel(StandardCharsets.UTF_8),
            expectedInsertions,  // 预计元素数量
            0.01                // 误判率
        );
    }
    
    /**
     * 添加元素
     */
    public void put(String id) {
        bloomFilter.put(id);
    }
    
    /**
     * 检查元素
     */
    public boolean mightContain(String id) {
        return bloomFilter.mightContain(id);
    }
}
```

## 布隆过滤器的参数选择

| 参数 | 说明 | 计算公式 |
|-----|------|---------|
| n | 预计元素数量 | 根据业务预估 |
| p | 误判率 | 业务可接受的值 |
| m | 所需 bit 数 | -n * ln(p) / (ln(2)^2) |
| k | 哈希函数数量 | (m / n) * ln(2) |

```java
/**
 * 布隆过滤器参数计算
 */
public class BloomFilterCalculator {
    
    /**
     * 计算所需内存
     */
    public static void main(String[] args) {
        int n = 10000000;  // 1000 万元素
        double p = 0.01;    // 1% 误判率
        
        // 所需 bit 数
        double m = -n * Math.log(p) / (Math.log(2) * Math.log(2));
        
        // 所需内存（字节）
        double memoryMB = m / 8 / 1024 / 1024;
        
        System.out.println("预计元素数量: " + n);
        System.out.println("误判率: " + (p * 100) + "%");
        System.out.println("所需 bit 数: " + (long)m);
        System.out.println("所需内存: " + String.format("%.2f MB", memoryMB));
        
        // 不同误判率的内存对比
        System.out.println("\n不同误判率的内存对比：");
        for (double fp : new double[]{0.01, 0.001, 0.0001}) {
            double m2 = -n * Math.log(fp) / (Math.log(2) * Math.log(2));
            double mem = m2 / 8 / 1024 / 1024;
            System.out.printf("  误判率 %.2f%%: %.2f MB%n", fp * 100, mem);
        }
    }
}
```

输出：
```
预计元素数量: 10000000
误判率: 1.0%
所需 bit 数: 95850588
所需内存: 11.44 MB

不同误判率的内存对比：
  误判率 1.00%: 11.44 MB
  误判率 0.10%: 17.28 MB
  误判率 0.01%: 23.12 MB
```

## 总结

缓存穿透是常见的安全问题：

- **危害**：数据库压力增大，可能导致系统崩溃
- **原因**：查询不存在的数据
- **方案**：缓存空值、布隆过滤器、组合使用
- **选型**：数据量大用布隆过滤器，数据量小用缓存空值

## 留给你的问题

布隆过滤器有一个特性：**只能添加，不能删除**。

**如果你的业务需要删除已下架的商品，布隆过滤器如何处理这种情况？有什么替代方案？**
