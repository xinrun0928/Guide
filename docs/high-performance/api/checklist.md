# 接口性能优化 Checklist

想象一下这个场景：你的接口响应时间是 500ms，用户抱怨体验差。你开始优化——加缓存、改数据库索引、优化 SQL。折腾了一周，响应时间降到了 450ms。

**但等等，你确定找对方向了吗？**

性能优化的第一步，不是动手，而是系统性地诊断。很多时候，真正拖慢接口的不是你以为的那个环节。这份 Checklist，就是帮你快速定位瓶颈的「体检单」。

---

## 一、网络层检查

### 1.1 DNS 解析耗时

每次发起 HTTP 请求前，浏览器或客户端需要解析域名。如果 DNS 解析耗时过长，整个请求链条都会被拖慢。

```java
// 使用DnsResolver缓存DNS结果，避免重复解析
import java.net.InetAddress;
import java.util.concurrent.ConcurrentHashMap;

public class DnsCache {
    private static final ConcurrentHashMap&lt;String, InetAddress&gt; cache = new ConcurrentHashMap&lt;&gt;();
    private static final long TTL = 60_000; // 缓存60秒

    public static InetAddress resolve(String host) throws Exception {
        long now = System.currentTimeMillis();
        Entry entry = cache.get(host);

        if (entry != null && (now - entry.timestamp) < TTL) {
            return entry.address;
        }

        InetAddress address = InetAddress.getByName(host);
        cache.put(host, new Entry(address, now));
        return address;
    }

    private static class Entry {
        final InetAddress address;
        final long timestamp;

        Entry(InetAddress address, long timestamp) {
            this.address = address;
            this.timestamp = timestamp;
        }
    }
}
```

**检查项：**
- 是否使用了 CDN 预解析？
- DNS 缓存策略是否合理？
- 是否使用了 HTTP/2 或 HTTP/3 减少连接建立次数？

### 1.2 TCP 连接建立耗时

三次握手需要 1.5-2 个 RTT（Round Trip Time）。如果接口依赖多个下游服务，光建立连接就能耗掉几十毫秒。

```java
// 配置连接池，复用HTTP连接
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;

public class HttpClientFactory {
    public static CloseableHttpClient createOptimizedClient() {
        PoolingHttpClientConnectionManager cm = new PoolingHttpClientConnectionManager();
        cm.setMaxTotal(200);          // 最大连接数
        cm.setDefaultMaxPerRoute(50); // 每个路由最大连接数

        return HttpClients.custom()
                .setConnectionManager(cm)
                .setKeepAliveStrategy((response, context) -> 30_000) // Keep-Alive 30秒
                .build();
    }
}
```

**检查项：**
- 是否启用了 HTTP Keep-Alive？
- 连接池配置是否合理？
- 是否存在大量短连接？

---

## 二、数据传输层检查

### 2.1 响应体大小

一次接口调用返回 5MB 的 JSON 数据，网络传输就要几十秒。优化响应体大小，往往是最立竿见影的手段。

```java
// 使用GZIP压缩响应
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.GZIPOutputStream;

public class CompressionUtil {

    public static byte[] compressGzip(String data) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(bos)) {
            gzip.write(data.getBytes("UTF-8"));
        }
        return bos.toByteArray();
    }

    // 估算压缩效果
    public static void main(String[] args) throws IOException {
        String json = generateLargeJson(); // 假设这是待压缩的数据

        byte[] compressed = compressGzip(json);
        double ratio = (1 - (double) compressed.length / json.length()) * 100;

        System.out.printf("原始大小: %d bytes%n", json.length());
        System.out.printf("压缩后: %d bytes%n", compressed.length);
        System.out.printf("压缩率: %.1f%%%n", ratio);
    }
}
```

**检查项：**
- 是否开启了响应压缩（GZIP/Br/Zstd）？
- 是否存在 N+1 查询导致返回过多数据？
- 是否可以分页或懒加载？

### 2.2 序列化效率

JSON 序列化/反序列化是 CPU 密集型操作。选择高效的序列化方案，能显著降低延迟。

```java
// 对比JSON和Protobuf的序列化性能
public class SerializationBenchmark {

    public static void main(String[] args) throws Exception {
        User user = new User(1L, "张三", "zhangsan@example.com", 28);

        // JSON序列化
        long jsonStart = System.nanoTime();
        ObjectMapper mapper = new ObjectMapper();
        byte[] jsonBytes = mapper.writeValueAsBytes(user);
        long jsonTime = System.nanoTime() - jsonStart;

        // Protobuf序列化
        UserProto.User protoUser = UserProto.User.newBuilder()
                .setId(user.getId())
                .setName(user.getName())
                .setEmail(user.getEmail())
                .setAge(user.getAge())
                .build();
        long protoStart = System.nanoTime();
        byte[] protoBytes = protoUser.toByteArray();
        long protoTime = System.nanoTime() - protoStart;

        System.out.printf("JSON: %d bytes, %d μs%n", jsonBytes.length, jsonTime / 1000);
        System.out.printf("Protobuf: %d bytes, %d μs%n", protoBytes.length, protoTime / 1000);
    }
}
```

**检查项：**
- 是否使用了高效的序列化方案？
- 内部通信是否可以用 Protobuf/Kryo？
- 是否有不必要的深拷贝？

---

## 三、业务逻辑层检查

### 3.1 数据库查询

数据库往往是接口延迟的最大来源。90% 的性能问题，都出在 SQL 上。

```java
// 避免N+1查询，使用批量查询
@Service
public class OrderService {

    @Autowired
    private OrderMapper orderMapper;
    @Autowired
    private OrderItemMapper itemMapper;

    // 低效写法：N+1查询
    public List&lt;OrderVO&gt; getOrdersBad(Long userId) {
        List&lt;Order&gt; orders = orderMapper.findByUserId(userId);
        return orders.stream().map(order -> {
            List&lt;OrderItem&gt; items = itemMapper.findByOrderId(order.getId()); // N次查询
            return toVO(order, items);
        }).collect(Collectors.toList());
    }

    // 优化写法：批量查询
    public List&lt;OrderVO&gt; getOrdersGood(Long userId) {
        List&lt;Order&gt; orders = orderMapper.findByUserId(userId);
        if (orders.isEmpty()) {
            return Collections.emptyList();
        }

        // 一次查询获取所有订单项
        List&lt;Long&gt; orderIds = orders.stream().map(Order::getId).collect(Collectors.toList());
        Map&lt;Long, List&lt;OrderItem&gt;&gt; itemMap = itemMapper.findByOrderIds(orderIds)
                .stream()
                .collect(Collectors.groupingBy(OrderItem::getOrderId));

        return orders.stream()
                .map(order -> toVO(order, itemMap.getOrDefault(order.getId(), Collections.emptyList())))
                .collect(Collectors.toList());
    }
}
```

**检查项：**
- 是否有 N+1 查询问题？
- 索引是否命中？
- 是否可以用缓存减少数据库访问？
- SQL 是否存在不必要的全表扫描？

### 3.2 同步调用 vs 异步调用

一个接口依赖 5 个下游服务，每个服务响应时间 50ms。同步调用需要 250ms，异步调用只需要 50ms（取最大值）。

```java
// 使用CompletableFuture实现并行调用
@Service
public class UserDetailService {

    public UserDetail getUserDetail(Long userId) {
        // 串行调用：150ms+
        // User user = getUser(userId);
        // List&lt;Order&gt; orders = getOrders(userId);
        // List&lt;Address&gt; addresses = getAddresses(userId);

        // 并行调用：50ms+
        CompletableFuture&lt;User&gt; userFuture = CompletableFuture.supplyAsync(() -> getUser(userId));
        CompletableFuture&lt;List&lt;Order&gt;&gt; ordersFuture = CompletableFuture.supplyAsync(() -> getOrders(userId));
        CompletableFuture&lt;List&lt;Address&gt;&gt; addressesFuture = CompletableFuture.supplyAsync(() -> getAddresses(userId));

        CompletableFuture.allOf(userFuture, ordersFuture, addressesFuture).join();

        return new UserDetail(
                userFuture.get(),
                ordersFuture.get(),
                addressesFuture.get()
        );
    }
}
```

**检查项：**
- 接口中有多少同步下游调用可以改为并行？
- 是否可以用消息队列解耦非关键路径？
- 是否有不必要的串行依赖？

---

## 四、缓存层检查

### 4.1 多级缓存策略

```java
// 本地缓存 + 分布式缓存二级缓存
@Service
public class ProductCache {

    private final LoadingCache&lt;Long, Product&gt; localCache;
    private final RedisTemplate&lt;String, Product&gt; redisTemplate;

    public ProductCache(RedisTemplate&lt;String, Product&gt; redisTemplate) {
        this.redisTemplate = redisTemplate;

        // Guava本地缓存：热点数据快速访问
        this.localCache = CacheBuilder.newBuilder()
                .maximumSize(10_000)
                .expireAfterWrite(10, TimeUnit.SECONDS)
                .build(new CacheLoader&lt;Long, Product&gt;() {
                    @Override
                    public Product load(Long id) {
                        return loadFromRedis(id);
                    }
                });
    }

    public Product getProduct(Long id) {
        // L1: 本地缓存
        try {
            return localCache.get(id);
        } catch (ExecutionException e) {
            throw new RuntimeException(e);
        }
    }

    private Product loadFromRedis(Long id) {
        String key = "product:" + id;
        Product product = redisTemplate.opsForValue().get(key);

        if (product == null) {
            product = loadFromDatabase(id);
            redisTemplate.opsForValue().set(key, product, 1, TimeUnit.HOURS);
        }

        return product;
    }

    private Product loadFromDatabase(Long id) {
        // 从数据库加载
        return null;
    }
}
```

**检查项：**
- 热数据是否上了缓存？
- 缓存失效策略是否合理？
- 缓存穿透/击穿/雪崩是否防范？

---

## 五、JVM 层检查

### 5.1 GC 造成的停顿

GC 停顿可能导致接口响应时间抖动。生产环境的 GC 问题，往往在压测时发现不了。

```java
// 使用JVM参数优化GC
/*
# G1垃圾收集器配置
-XX:+UseG1GC
-XX:MaxGCPauseMillis=100          # 最大GC停顿时间
-XX:G1HeapRegionSize=4m          # Region大小
-XX:InitiatingHeapOccupancyPercent=45  # 触发Mixed GC的堆占用比例

# 日志配置
-Xlog:gc*:file=gc.log:time:filecount=5,filesize=10m
*/
```

**检查项：**
- 使用的 GC 收集器是否适合当前场景？
- Young 区是否足够大？
- 是否存在内存泄漏导致频繁 Full GC？
- GC 日志是否定期分析？

---

## 六、检查清单速查

| 层级 | 检查项 | 优先级 |
|-----|-----|:-----:|
| 网络 | DNS 解析优化 | P1 |
| 网络 | HTTP Keep-Alive | P1 |
| 网络 | HTTP/2 多路复用 | P1 |
| 传输 | 响应压缩 | P1 |
| 传输 | 高效序列化 | P1 |
| 业务 | 数据库索引 | P1 |
| 业务 | 缓存策略 | P1 |
| 业务 | 异步化改造 | P2 |
| 业务 | N+1 查询优化 | P1 |
| JVM | GC 优化 | P2 |

---

## 留给你的问题

一份 Checklist 能帮你找到问题，但解决问题的方案往往需要权衡。

比如：缓存可以提升性能，但会带来数据一致性风险；异步可以提升吞吐，但会增加系统复杂度。

**你现在的接口，最主要的瓶颈在哪？为了解决这个问题，你愿意付出多大的代价？**

这是一个没有标准答案的问题，但值得你认真思考。
