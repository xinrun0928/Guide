# Redis GEO：地理位置功能实战

你有没有想过这样的功能：

> 「附近的人」
> 「附近的餐厅」
> 「附近的共享单车」

这些「附近 XXX」的功能是怎么实现的？

**Redis GEO** 就是来解决这个问题的。

## Redis GEO 是什么？

Redis GEO 是 Redis 3.2 引入的功能，基于 **GeoHash 算法** 实现地理位置存储和查询。

它让你可以：
- 存储地理位置（经纬度）
- 计算两个位置的距离
- 查找附近的位置

## 基本操作

### 添加地理位置

```java
public class GeoDemo {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String GEO_KEY = "geo:locations";

    /**
     * 添加单个位置
     */
    public void addLocation(String member, double longitude, double latitude) {
        // GEOADD key longitude latitude member
        jedis.geoadd(GEO_KEY, longitude, latitude, member);
    }

    /**
     * 添加多个位置
     */
    public void addLocations(Map&lt;String, GeoCoordinate&gt; locations) {
        GeoAddParams params = new GeoAddParams();
        for (Map.Entry&lt;String, GeoCoordinate&gt; entry : locations.entrySet()) {
            params.addParameter(
                new GeoCoordinate(entry.getValue().getLongitude(),
                    entry.getValue().getLatitude()),
                entry.getKey()
            );
        }
        jedis.geoadd(GEO_KEY, params);
    }

    /**
     * 添加城市位置
     */
    public void addCities() {
        // 添加一些城市（经度, 纬度, 城市名）
        jedis.geoadd(GEO_KEY, 116.4074, 39.9042, "beijing");    // 北京
        jedis.geoadd(GEO_KEY, 121.4737, 31.2304, "shanghai");  // 上海
        jedis.geoadd(GEO_KEY, 113.2644, 23.1291, "guangzhou"); // 广州
        jedis.geoadd(GEO_KEY, 114.0859, 22.5470, "shenzhen");  // 深圳
        jedis.geoadd(GEO_KEY, 120.1551, 30.2741, "hangzhou");  // 杭州
    }
}
```

### 获取位置信息

```java
    /**
     * 获取位置的经纬度
     */
    public List&lt;GeoCoordinate&gt; getPosition(String... members) {
        // GEOPOS key member [member ...]
        List&lt;GeoCoordinate&gt; positions = jedis.geopos(GEO_KEY, members);
        return positions;
    }

    /**
     * 获取单个位置
     */
    public GeoCoordinate getPosition(String member) {
        List&lt;GeoCoordinate&gt; positions = jedis.geopos(GEO_KEY, member);
        if (positions != null && !positions.isEmpty()) {
            return positions.get(0);
        }
        return null;
    }
```

### 计算距离

```java
    /**
     * 计算两个位置之间的距离
     */
    public double getDistance(String member1, String member2) {
        // GEODIST key member1 member2 [unit]
        // unit: m(米), km(千米), mi(英里), ft(英尺)
        Double distance = jedis.geodist(GEO_KEY, member1, member2, GeoUnit.KM);
        return distance != null ? distance : 0;
    }

    /**
     * 计算多个距离
     */
    public void printDistances() {
        double distance = getDistance("beijing", "shanghai");
        System.out.println("北京到上海的距离: " + distance + " km");

        distance = getDistance("beijing", "shenzhen");
        System.out.println("北京到深圳的距离: " + distance + " km");

        distance = getDistance("shanghai", "hangzhou");
        System.out.println("上海到杭州的距离: " + distance + " km");
    }
```

### 查找附近的位置

```java
    /**
     * 查找附近的位置
     */
    public List&lt;GeoRadiusResponse&gt; nearby(String member, double radius, GeoUnit unit) {
        // GEORADIUS key longitude latitude radius unit [OPTIONS]
        List&lt;GeoRadiusResponse&gt; results =
            jedis.georadius(GEO_KEY, 116.4074, 39.9042, radius, unit,
                GeoRadiusParam.geoRadiusParam().withCoord().withDist().sortAscending());

        return results;
    }

    /**
     * 查找附近的餐厅
     */
    public List&lt;GeoRadiusResponse&gt; nearbyRestaurants(
            double longitude, double latitude, double radiusKm) {

        String key = "geo:restaurants";
        return jedis.georadius(key, longitude, latitude, radiusKm, GeoUnit.KM,
            GeoRadiusParam.geoRadiusParam()
                .withCoord()      // 返回经纬度
                .withDist()       // 返回距离
                .sortAscending()  // 按距离升序
                .count(20));      // 限制返回数量
    }
```

## 实战：附近的人

### 数据模型

```java
public class NearbyPeopleService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String GEO_KEY = "geo:users";

    /**
     * 用户签到（更新位置）
     */
    public void updateUserLocation(String userId, double longitude, double latitude) {
        jedis.geoadd(GEO_KEY, longitude, latitude, userId);
    }

    /**
     * 获取用户位置
     */
    public GeoCoordinate getUserLocation(String userId) {
        List&lt;GeoCoordinate&gt; positions = jedis.geopos(GEO_KEY, userId);
        if (positions != null && !positions.isEmpty()) {
            return positions.get(0);
        }
        return null;
    }

    /**
     * 查找附近的人
     */
    public List&lt;NearbyUser&gt; findNearbyUsers(
            String userId, double radiusKm, int limit) {

        // 获取自己的位置
        GeoCoordinate myPosition = getUserLocation(userId);
        if (myPosition == null) {
            return Collections.emptyList();
        }

        // 查找附近的人
        List&lt;GeoRadiusResponse&gt; results = jedis.georadius(
            GEO_KEY,
            myPosition.getLongitude(),
            myPosition.getLatitude(),
            radiusKm,
            GeoUnit.KM,
            GeoRadiusParam.geoRadiusParam()
                .withCoord()
                .withDist()
                .sortAscending()
                .count(limit));

        List&lt;NearbyUser&gt; nearbyUsers = new ArrayList&lt;&gt;();
        for (GeoRadiusResponse result : results) {
            // 排除自己
            if (userId.equals(result.getMember())) {
                continue;
            }

            nearbyUsers.add(new NearbyUser(
                result.getMember(),
                result.getDistance(),
                result.getCoordinate()
            ));
        }

        return nearbyUsers;
    }
}

public class NearbyUser {
    private String userId;
    private double distance;  // 距离（千米）
    private GeoCoordinate coordinate;

    public NearbyUser(String userId, double distance, GeoCoordinate coordinate) {
        this.userId = userId;
        this.distance = distance;
        this.coordinate = coordinate;
    }
}
```

### 完整服务

```java
@Service
public class LocationService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String USER_LOCATION_KEY = "geo:users";

    /**
     * 更新用户位置
     */
    public void updateLocation(String userId, double longitude, double latitude) {
        // 1. 更新 GEO 数据
        jedis.geoadd(USER_LOCATION_KEY, longitude, latitude, userId);

        // 2. 更新缓存（可选，用于快速查询）
        String cacheKey = "user:location:" + userId;
        Map&lt;String, String&gt; location = new HashMap&lt;&gt;();
        location.put("longitude", String.valueOf(longitude));
        location.put("latitude", String.valueOf(latitude));
        location.put("updateTime", String.valueOf(System.currentTimeMillis()));
        jedis.hset(cacheKey, location);
        jedis.expire(cacheKey, 86400);  // 24小时过期
    }

    /**
     * 查找附近用户
     */
    public List&lt;UserLocation&gt; searchNearbyUsers(
            double longitude, double latitude,
            double radiusKm, int limit) {

        List&lt;GeoRadiusResponse&gt; results = jedis.georadius(
            USER_LOCATION_KEY,
            longitude,
            latitude,
            radiusKm,
            GeoUnit.KM,
            GeoRadiusParam.geoRadiusParam()
                .withCoord()
                .withDist()
                .sortAscending()
                .count(limit));

        return convertToUserLocations(results);
    }

    /**
     * 获取用户之间的距离
     */
    public double getDistanceBetweenUsers(String userId1, String userId2) {
        Double distance = jedis.geodist(USER_LOCATION_KEY, userId1, userId2, GeoUnit.KM);
        return distance != null ? distance : -1;
    }

    private List&lt;UserLocation&gt; convertToUserLocations(
            List&lt;GeoRadiusResponse&gt; results) {

        List&lt;UserLocation&gt; locations = new ArrayList&lt;&gt;();
        for (GeoRadiusResponse r : results) {
            UserLocation ul = new UserLocation();
            ul.setUserId(r.getMember());
            ul.setDistance(r.getDistance());
            ul.setLongitude(r.getCoordinate().getLongitude());
            ul.setLatitude(r.getCoordinate().getLatitude());
            locations.add(ul);
        }
        return locations;
    }
}
```

## 实战：附近的共享单车

```java
public class BikeSharingService {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String BIKE_GEO_KEY = "geo:bikes";

    /**
     * 投放单车
     */
    public void addBike(String bikeId, double longitude, double latitude) {
        jedis.geoadd(BIKE_GEO_KEY, longitude, latitude, bikeId);
    }

    /**
     * 查找附近的可用单车
     */
    public List&lt;BikeInfo&gt; findNearbyAvailableBikes(
            double longitude, double latitude,
            double radiusKm) {

        // 假设可用单车的 key 存储在另一个 Set 中
        Set&lt;String&gt; availableBikes = jedis.smembers("bikes:available");

        List&lt;BikeInfo&gt; result = new ArrayList&lt;&gt;();

        for (String bikeId : availableBikes) {
            List&lt;GeoCoordinate&gt; positions = jedis.geopos(BIKE_GEO_KEY, bikeId);
            if (positions == null || positions.isEmpty()) {
                continue;
            }

            GeoCoordinate coord = positions.get(0);

            // 计算距离
            Double distance = calculateDistance(
                latitude, longitude,
                coord.getLatitude(), coord.getLongitude(),
                GeoUnit.KM);

            if (distance <= radiusKm) {
                BikeInfo bike = new BikeInfo();
                bike.setBikeId(bikeId);
                bike.setDistance(distance);
                bike.setLongitude(coord.getLongitude());
                bike.setLatitude(coord.getLatitude());
                result.add(bike);
            }
        }

        // 按距离排序
        result.sort(Comparator.comparingDouble(BikeInfo::getDistance));

        return result;
    }

    /**
     * 使用单车
     */
    public void useBike(String bikeId, String userId) {
        // 从可用列表移除
        jedis.srem("bikes:available", bikeId);
        // 添加到使用中列表
        jedis.sadd("bikes:using:" + userId, bikeId);
    }

    /**
     * 还车
     */
    public void returnBike(String bikeId, double longitude, double latitude) {
        // 更新位置
        jedis.geoadd(BIKE_GEO_KEY, longitude, latitude, bikeId);
        // 添加到可用列表
        jedis.sadd("bikes:available", bikeId);
    }

    /**
     * 计算两点间距离（简化版）
     */
    private Double calculateDistance(
            double lat1, double lon1,
            double lat2, double lon2,
            GeoUnit unit) {

        // 使用 Redis GEODIST 计算
        Double distance = jedis.geodist(
            "geo:calc",  // 临时 key
            "p1", "p2", unit);

        return distance;
    }
}
```

## GeoHash 算法原理

### GeoHash 是什么？

GeoHash 是将二维的经纬度编码成一维的字符串。

```
经纬度 → GeoHash → 字符串

(39.9042, 116.4074) → "wx4g0b0" → 附近的人
```

### GeoHash 的特性

```
精度：
- 1 位：范围约 5000km × 5000km
- 2 位：范围约 1250km × 1250km
- 3 位：范围约 156km × 156km
- 4 位：范围约 39km × 39km
- 5 位：范围约 5km × 5km
- 6 位：范围约 1.2km × 1.2km
```

### 为什么用 GeoHash？

```
问题：如何快速找到附近的人？

朴素方案：计算每个人到我的距离
→ O(n)，太慢

GeoHash 方案：
1. 把地图分成格子
2. 只查询相邻格子的人
3. 再精确计算距离
→ O(1) 或 O(k)，k 是附近格子数
```

## 性能优化

### 1. 使用 Redis Cluster

```java
public class GeoClusterService {
    /**
     * 按城市分桶
     */
    public void addBikeByCity(String city, String bikeId,
                             double longitude, double latitude) {
        String key = "geo:bikes:" + city;
        jedis.geoadd(key, longitude, latitude, bikeId);
    }

    /**
     * 在指定城市查找附近的单车
     */
    public List&lt;GeoRadiusResponse&gt; findBikesInCity(
            String city, double longitude, double latitude,
            double radiusKm) {

        String key = "geo:bikes:" + city;
        return jedis.georadius(
            key, longitude, latitude, radiusKm, GeoUnit.KM,
            GeoRadiusParam.geoRadiusParam().withDist().sortAscending());
    }
}
```

### 2. 定期清理过期数据

```java
public class GeoCleanupService {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 清理长期不活跃的地理位置
     */
    public void cleanupInactiveUsers(int daysThreshold) {
        // 获取所有用户
        Set&lt;String&gt; allUsers = jedis.zrange("geo:users:active", 0, -1);

        for (String userId : allUsers) {
            // 检查最后活跃时间
            String lastActiveKey = "user:lastactive:" + userId;
            String lastActive = jedis.get(lastActiveKey);

            if (lastActive != null) {
                long lastActiveTime = Long.parseLong(lastActive);
                long now = System.currentTimeMillis();
                long days = (now - lastActiveTime) / (1000 * 60 * 60 * 24);

                if (days > daysThreshold) {
                    // 从 GEO 中移除
                    jedis.zrem("geo:users:active", userId);
                    System.out.println("Removed inactive user: " + userId);
                }
            }
        }
    }
}
```

## 面试追问方向

1. **Redis GEO 的底层实现是什么？**

   Redis GEO 底层使用有序集合（ZSet）实现，每个位置存储为一个 member，分数是 GeoHash 编码。这样可以利用 ZSet 的范围查询功能高效地查找附近的位置。

2. **GeoHash 的缺点是什么？**

   - 边界问题：附近的位置可能在不同的 GeoHash 格子中，需要查询相邻格子
   - 精度问题：GeoHash 是有损压缩，不能精确表示位置
   - 数据量：大量位置时，GeoHash 格子可能很大

---

**核心记忆点**：Redis GEO 基于 GeoHash 算法实现地理位置功能。通过 GEOADD 添加位置、GEORADIUS 查找附近位置、GEODIST 计算距离。适合「附近的人」「附近的单车」等场景。
