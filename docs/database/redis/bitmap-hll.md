# Redis HyperLogLog、Bitmap、GIS 模块

除了基础的 5 种数据类型，Redis 还提供了几个「隐藏神器」——

- **HyperLogLog**：用 12KB 的内存统计上亿级 UV
- **Bitmap**：用 bit 位做高效位运算
- **GIS**：地理信息查询，附近的人

这些数据类型有什么用？怎么用？一起来看看。

## HyperLogLog：概率算法统计算法

### 痛点：如何统计上亿用户的 UV？

用 Set？100 万用户就需要约 80MB 内存。
用 Hash？同样需要大量内存。

有没有一种方法，可以用很少的内存，统计大量数据的基数（去重数量）？

**HyperLogLog** 就是答案。

### 核心原理

HyperLogLog 基于一个有趣的数学现象：**抛硬币的数学期望**。

```java
/**
 * 抛硬币游戏：
 * 
 * 如果你一直抛硬币，直到出现连续 K 次正面
 * 记录抛掷次数 N
 * 
 * 理论推导：
 * 出现连续 K 次正面的期望是 2^k 次
 * 
 * 反过来想：
 * 如果我看到连续 K 次正面，说明我抛了约 2^k 次
 * 
 * 所以：2^k ≈ N
 * 取对数：k ≈ log₂(N)
 * 
 * 这就是 HyperLogLog 的核心：
 * 通过观察「最大连续正面数」来估算总抛掷次数
 */
```

实际应用中，Redis 用的是 **K-bit prefix of hash** 代替抛硬币：

```java
/**
 * Redis HyperLogLog 步骤：
 * 
 * 1. 对每个元素计算 Hash（64 位）
 * 2. 取前 14 位作为桶编号（2^14 = 16384 个桶）
 * 3. 取后 50 位，找到第一个 1 的位置（0-50）
 * 4. 更新对应桶的值为 max(当前值, 第一个1的位置)
 * 
 * 例如 hash("user:1001") = 0b0001...0100
 * 后 50 位中，第一个 1 在第 3 位（从右往左数）
 * 更新 bucket[hash % 16384] = max(bucket[...], 3)
 */
```

### Redis HyperLogLog 操作

```java
// 添加元素
PFADD uv:20240101 "user1" "user2" "user3"  // 添加用户 ID
PFADD uv:20240101 "user1"                   // 重复的会被忽略

// 统计基数
PFCOUNT uv:20240101                          // 返回近似 UV

// 合并多个 HyperLogLog
PFMERGE uv:20240101-03 uv:20240101 uv:20240102 uv:20240103
PFCOUNT uv:20240101-03                       // 合并后的统计
```

### Java 客户端示例

```java
public class RedisHyperLogLogDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            String key = "hll:daily:uv:20240101";
            
            // 模拟添加用户访问记录
            for (int i = 0; i < 1000000; i++) {
                jedis.pfadd(key, "user:" + i);
            }
            
            // 统计 UV
            long uv = jedis.pfcount(key);
            System.out.println("HyperLogLog 统计 UV: " + uv);
            
            // 对比 Set 的结果
            String setKey = "set:daily:uv:20240101";
            for (int i = 0; i < 1000000; i++) {
                jedis.sadd(setKey, "user:" + i);
            }
            long actualUv = jedis.scard(setKey);
            System.out.println("Set 统计 UV: " + actualUv);
            
            // 误差率约 0.81%，可接受
            double errorRate = Math.abs(uv - actualUv) * 100.0 / actualUv;
            System.out.println("误差率: " + String.format("%.2f", errorRate) + "%");
        }
    }
}
```

### HyperLogLog 的内存与精度

| 指标 | 值 |
|-----|-----|
| 内存占用 | 固定 12KB |
| 最大计数 | 2^64 ≈ 18 万亿 |
| 标准误差 | 约 0.81% |
| 元素数量要求 | 无限制 |

**12KB 就能统计 2^64 个元素，误差只有 0.81%！**

这得益于概率算法的神奇特性：

```java
/**
 * 空间换时间的极致：
 * 
 * 普通计数：每个元素占用空间
 *   - 1 亿用户 × 10 字节 = 1GB
 * 
 * HyperLogLog：固定 12KB
 *   - 16384 桶 × 6 位/桶 = 12KB
 *   - 误差 ≈ 1.04 / sqrt(16384) ≈ 0.81%
 * 
 * 误差计算公式：
 *   error ≈ 1.04 / sqrt(m)
 *   其中 m = 桶数量 = 2^p，p = 前 p 位作为桶编号
 * 
 * Redis 使用 p=14，所以：
 *   m = 2^14 = 16384
 *   error ≈ 1.04 / 128 ≈ 0.81%
 */
```

### 适用场景

| 场景 | 说明 |
|-----|------|
| UV 统计 | 日活、月活、DAU/WAU/MAU |
| 独立 IP 统计 | 网站独立访问 IP |
| 独立搜索词统计 | 用户搜索去重 |

### 不适用场景

- 需要 100% 精确的去重计数
- 数据量较小（用 Set 更精确）

## Bitmap：位图操作

### 什么是 Bitmap？

Bitmap 是一种用 bit 位存储数据的数据结构：

```java
/**
 * Bitmap 原理：
 * 
 * 一个字节 = 8 个 bit
 * bit 的值只能是 0 或 1
 * 
 * 例如存储用户签到：
 * 第 0 位 = 1：1月1日签到
 * 第 1 位 = 1：1月2日签到
 * 第 31 位 = 1：2月1日签到
 * 
 * 优势：
 * - 每个用户每月只占 31 bit = 4 字节
 * - 100 万用户一个月 = 4MB
 * - 比 Set（~100MB）节省 25 倍
 */
```

### Redis Bitmap 操作

```java
// 设置某个偏移量的 bit 值
SETBIT sign:user:1001:202401 0 1   // 1月1日签到（偏移量0）
SETBIT sign:user:1001:202401 6 1   // 1月7日签到（偏移量6）

// 获取某个偏移量的 bit 值
GETBIT sign:user:1001:202401 0      // 返回 1

// 统计 bit = 1 的数量
BITCOUNT sign:user:1001:202401     // 本月签到天数

// 多个 Bitmap 运算
BITOP AND result key1 key2         // 交集
BITOP OR result key1 key2          // 并集
BITOP XOR result key1 key2         // 对称差集

// 查找第一个 0 或 1
BITPOS sign:user:1001:202401 0    // 第一个未签到日
```

### Java 客户端示例

```java
public class RedisBitmapDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            String userId = "1001";
            String yearMonth = "202401";
            String key = "sign:user:" + userId + ":" + yearMonth;
            
            // 1. 用户签到
            // 假设今天是 1 月 7 日（偏移量 6）
            int dayOfMonth = 7;
            jedis.setbit(key, dayOfMonth - 1, "1");
            
            // 2. 检查是否签到
            boolean isSigned = jedis.getbit(key, dayOfMonth - 1) == 1;
            System.out.println("今日签到: " + isSigned);
            
            // 3. 统计本月签到天数
            long signDays = jedis.bitcount(key);
            System.out.println("本月签到天数: " + signDays);
            
            // 4. 连续签到计算
            // BITFIELD 获取连续多位的值
            long[] bits = jedis.bitfield(key, "GET", 
                new Object[] {"i8", -(dayOfMonth - 1), dayOfMonth - 1});
            
            // 5. 统计所有用户的签到率
            // 假设用户 ID 从 1 到 100000
            long signedCount = 0;
            for (int i = 1; i <= 100000; i++) {
                String userKey = "sign:user:" + i + ":" + yearMonth;
                signedCount += jedis.bitcount(userKey) > 0 ? 1 : 0;
            }
            double signRate = signedCount * 100.0 / 100000;
            System.out.println("签到率: " + String.format("%.2f", signRate) + "%");
        }
    }
}
```

### Bitmap 的实际应用

#### 场景一：每日签到

```java
public class DailySign {
    
    /**
     * 签到系统设计：
     * 
     * Key 格式：sign:user:{userId}:{yyyyMM}
     * 偏移量：dayOfMonth - 1（0-30）
     * 
     * 优势：
     * - 内存极省：每个用户每月 31 bit
     * - 查询快：O(1) 获取签到状态
     * - 统计方便：BITCOUNT 计算签到天数
     */
    
    /**
     * 连续签到计算：
     * 从当前日期往前数，连续有多少个 1
     */
    public int getContinuousSignDays(Jedis jedis, int userId) {
        String key = "sign:user:" + userId + ":" + 
            new SimpleDateFormat("yyyyMM").format(new Date());
        
        int dayOfMonth = Calendar.getInstance().get(Calendar.DAY_OF_MONTH);
        long[] bits = jedis.bitfield(key, "GET", 
            new Object[] {"u" + dayOfMonth, 0});
        
        int count = 0;
        for (int i = 0; i < dayOfMonth; i++) {
            if (((bits[0] >> i) & 1) == 1) {
                count++;
            } else {
                break;
            }
        }
        return count;
    }
}
```

#### 场景二：用户活跃统计

```java
public class UserActivity {
    
    /**
     * 统计用户是否活跃（过去 7 天）
     * Key: active:user:{userId}
     * 每天占一个 bit，滚动更新
     */
    
    /**
     * 布隆过滤器的变种：海量用户标记
     * 
     * 假设有 1 亿用户，每个用户一个 bit
     * 只需要 100MB 内存
     * 
     * 用于：
     * - 新用户识别（是否是新用户）
     * - 黑名单过滤
     * - 活跃用户标记
     */
}
```

### Bitmap 的限制

| 限制 | 说明 |
|-----|------|
| 最大偏移量 | 2^32 - 1（约 42 亿） |
| 内存计算 | 最大 512MB |
| 适用场景 | 离散、小偏移量 |

```java
/**
 * Bitmap 内存计算：
 * 
 * SETBIT key 4294967295 1  // 设置最大偏移量
 * 
 * 需要的内存 = (4294967295 / 8) + 1 byte ≈ 512MB
 * 
 * 如果偏移量很大，内存会爆炸
 * 建议：
 * - 用户 ID 用哈希映射：offset = hash(userId) % 1_000_000_000
 * - 或者用多个 key 分桶
 */
```

## GIS：地理信息

Redis 3.2 引入了 GIS 功能，支持地理坐标存储和查询。

### 基本操作

```java
// 添加地理位置
GEOADD company:locations 116.404 39.915 "天安门"
GEOADD company:locations 116.408 39.910 "故宫"
GEOADD company:locations 116.380 39.920 "西单"

GEOADD users:locations (116.404 39.915) user001  // 添加用户位置

// 获取位置坐标
GEOPOS company:locations "天安门"  // 返回 116.404 39.915

// 计算两点距离
GEODIST company:locations "天安门" "故宫" km  // 返回距离（公里）

// 获取指定坐标附近 N 公里内的成员
GEORADIUS company:locations 116.404 39.915 5 km WITHDIST COUNT 10 ASC
GEORADIUSBYMEMBER company:locations "天安门" 5 km
```

### Java 客户端示例

```java
public class RedisGeoDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 1. 添加门店位置
            jedis.geoadd("stores:beijing",
                116.404, 39.915, "store001",  // 天安门附近
                116.408, 39.910, "store002",  // 故宫附近
                116.380, 39.920, "store003"   // 西单附近
            );
            
            // 2. 用户查找附近门店
            double userLon = 116.405;
            double userLat = 39.918;
            double radiusKm = 5.0;
            
            // 返回附近 5km 内的门店，按距离排序
            List&lt;GeoRadiusResponse&gt; nearby = jedis.georadius(
                "stores:beijing",
                userLon, userLat,
                radiusKm,
                GeoUnit.KM,
                GeoRadiusParam.geoRadiusParam()
                    .withCoord()      // 返回坐标
                    .withDist()       // 返回距离
                    .sortAscending()  // 按距离升序
            );
            
            System.out.println("附近门店：");
            for (GeoRadiusResponse r : nearby) {
                String name = new String(r.getMember());
                double dist = r.getDistance();
                GeoCoordinate coord = r.getCoordinate();
                System.out.printf("  %s: %.2fkm (%f, %f)%n", 
                    name, dist, coord.getLongitude(), coord.getLatitude());
            }
            
            // 3. 计算两个门店之间的距离
            double dist = jedis.geodist("stores:beijing", "store001", "store002", GeoUnit.M);
            System.out.println("store001 到 store002 距离: " + dist + " 米");
            
            // 4. 获取用户自己的位置
            List&lt;GeoCoordinate&gt; userPos = jedis.geopos("users:locations", "user001");
            if (userPos != null && !userPos.isEmpty() && userPos.get(0) != null) {
                GeoCoordinate pos = userPos.get(0);
                System.out.println("用户位置: " + pos.getLongitude() + ", " + pos.getLatitude());
            }
        }
    }
}
```

### GIS 的底层原理

Redis GIS 底层使用 **有序集合（ZSet）**，将地理坐标编码为 score：

```java
/**
 * Redis GIS 实现原理：
 * 
 * 1. GEOADD 命令：
 *    - 将经纬度编码为一个 52 位的整数
 *    - 存储到 ZSet，member 是标识，score 是编码值
 *    - 使用 ZREM 删除时，直接用 ZSet 的删除逻辑
 * 
 * 2. 编码算法（Geohash）：
 *    - 经度 [-180, 180]，纬度 [-90, 90]
 *    - 分别用二进制划分区间，逐步精确
 *    - 交织经纬度编码
 * 
 * 3. GEORADIUS 查询：
 *    - 先计算查询范围的 Geohash 范围
 *    - 用 ZRANGEBYSCORE 筛选
 *    - 计算距离，过滤不满足条件的
 * 
 * 4. 为什么用 ZSet？
 *    - 支持范围查询（ZRANGEBYSCORE）
 *    - 支持距离排序（score 有序）
 *    - 可以复用 ZSet 的所有操作
 */
```

### 附近的人实现

```java
public class NearByPeople {
    
    /**
     * 附近的人功能设计：
     * 
     * 方案一：GeoHash 精确匹配
     * - 将地图划分为网格
     * - 每个网格一个 ZSet key
     * - 查询时定位到多个邻近网格
     * 
     * 方案二：Redis GEORADIUS（推荐）
     * - 直接使用 Redis 原生 GIS
     * - 自动处理距离计算
     * - 适合小规模（几千个目标点）
     * 
     * 方案三：大规模优化
     * - 先用粗粒度过滤（GeoHash 前几位）
     * - 再精确计算距离
     */
    
    public List&lt;String&gt; findNearByUsers(Jedis jedis, 
            double lon, double lat, double radiusKm, int limit) {
        
        // 先查找附近 10km 内的用户（粗筛）
        List&lt;GeoRadiusResponse&gt; candidates = jedis.georadius(
            "users:locations",
            lon, lat,
            radiusKm * 2,  // 扩大范围
            GeoUnit.KM,
            GeoRadiusParam.geoRadiusParam()
                .sortAscending()
        );
        
        // 再精确计算距离，过滤
        List&lt;String&gt; result = new ArrayList&lt;&gt;();
        for (GeoRadiusResponse r : candidates) {
            if (r.getDistance() <= radiusKm && result.size() < limit) {
                result.add(new String(r.getMember()));
            }
        }
        return result;
    }
}
```

### GIS 适用场景

| 场景 | 说明 |
|-----|------|
| 附近门店 | 查找附近的商家、服务点 |
| 附近的人 | 社交应用中的附近用户 |
| 骑手位置 | 外卖配送中的骑手跟踪 |
| 地理围栏 | 进入/离开某个区域通知 |

## 三种特殊类型对比

| 类型 | 内存占用 | 精度 | 适用场景 |
|-----|---------|-----|---------|
| HyperLogLog | 12KB | 0.81% 误差 | 大规模去重统计 |
| Bitmap | bit/用户 | 100% | 用户标记、签到、活跃统计 |
| GIS | 约 50 字节/点 | 米级 | 地理位置查询 |

## 总结

Redis 的特殊数据类型，个个都是性能优化的利器：

- **HyperLogLog**：概率算法，12KB 统计上亿数据
- **Bitmap**：位级操作，签到、活跃统计神器
- **GIS**：地理坐标，附近的人/门店

## 留给你的问题

假设你要实现一个**日活跃用户（DAU）**统计系统：

- 每天约 1000 万用户访问
- 需要支持实时查询当前 DAU
- 需要支持历史 DAU 查询

**你会选择哪种 Redis 数据结构？HyperLogLog、Bitmap 还是普通 Set？为什么？有什么坑需要注意？**
