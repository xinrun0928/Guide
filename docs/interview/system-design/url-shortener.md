# 设计短链接系统（TinyURL）

想象这个场景：

你在手机上收到一条短信，里面有一个 200 字符的 URL，让你点击领取优惠券。

你会怎么做？

大概率，你直接关掉短信——这 URL 太长了，看起来就像钓鱼链接。

但如果是一条 12 字符的短链接呢？比如 `t.cn/Ab3xK2`，你会更有欲望点击。

**短链接系统，就是把长 URL 变成短链接的服务。** 它的核心价值不只是「短」，还有：

- 便于分享（短信、微博、微信限制字符数）
- 隐藏真实 URL（防止泄露敏感信息）
- 数据统计（点击量、时间段、设备类型）
- 美观易记


## 一、需求分析

### 1.1 功能需求

```
核心功能：
├── 生成短链接（长 URL → 短 URL）
├── 访问短链接（短 URL → 长 URL → 重定向）
├── 自定义短链接（可选，用户指定后缀）
├── 点击统计（时间、设备、地区）
└── 链接管理（编辑、删除、过期设置）
```

### 1.2 非功能需求

| 指标 | 要求 |
|---|---|
| 可用性 | 99.9%+，短链接失效直接影响业务 |
| 延迟 | 访问延迟 < 10ms |
| 并发 | 支持 10万+ QPS |
| 存储 | 支持数千亿条链接 |
| 唯一性 | 短链接全局唯一，永不冲突 |


## 二、容量估算

### 2.1 数据量估算

```
假设：
- 每天新增 1 亿条短链接
- 保留 5 年

存储量 = 1亿 × 365 × 5 = 1825 亿条

每条记录估算：
- 短码：8 字节
- 长 URL：500 字节（平均）
- 额外字段：100 字节
- 总计：约 600 字节/条

总存储：1825亿 × 600B ≈ 100TB
```

### 2.2 QPS 估算

```
写入 QPS：1亿 / 86400 ≈ 1000/s

读取 QPS：假设点击率 10:1
读取 QPS：1000 × 10 = 10000/s

峰值 QPS：平均 QPS × 3 ≈ 30000/s
```


## 三、高层设计

```
                    ┌─────────────┐
                    │   用户请求   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   负载均衡   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
       ┌──────▼──────┐ ┌───▼────┐ ┌────▼─────┐
       │  写服务集群  │ │读服务集群│ │API Gateway│
       └──────┬──────┘ └───┬────┘ └────┬─────┘
              │            │           │
              └────────────┼───────────┘
                           │
              ┌────────────┴────────────┐
              │                         │
       ┌──────▼──────┐           ┌──────▼──────┐
       │  Redis集群  │           │   MySQL集群  │
       │  (热点缓存) │           │  (主存储)    │
       └─────────────┘           └─────────────┘
```


## 四、核心设计

### 4.1 短码生成算法

短链接的核心是**如何把长 URL 变成短码**。这里有两种主流方案：

```java
/**
 * 短码生成策略
 */
public class ShortCodeGenerator {

    /**
     * 方案一：哈希 + Base62
     *
     * 对长 URL 做 MD5/SHA256，取前 8 位，映射到 Base62 (0-9a-zA-Z)
     * 缺点：可能冲突，需要查库确认
     */
    public static class HashBasedGenerator {

        private static final String BASE62_CHARS =
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

        private static final int SHORT_CODE_LENGTH = 8;

        public String generate(String longUrl) {
            try {
                // 1. 计算 MD5（128 位）
                MessageDigest md = MessageDigest.getInstance("MD5");
                byte[] digest = md.digest(longUrl.getBytes(StandardCharsets.UTF_8));

                // 2. 取前 8 字节，转换为 Base62
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < 8; i++) {
                    // 无符号转换，避免负数
                    int index = digest[i] & 0xFF;
                    sb.append(BASE62_CHARS.charAt(index % 62));
                }
                return sb.toString();

            } catch (NoSuchAlgorithmException e) {
                throw new RuntimeException(e);
            }
        }

        // 问题：如果两个不同的长 URL 哈希结果前 8 位相同怎么办？
        // 解决方案：存储时查库，如果有冲突，在 URL 后面加盐重试
    }

    /**
     * 方案二：分布式 ID（推荐）
     *
     * 使用雪花算法或数据库自增 ID，转为 Base62
     * 优点：绝对唯一，不需要查库
     */
    public static class IdBasedGenerator {

        private static final String BASE62_CHARS =
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

        private final AtomicLong idGenerator = new AtomicLong(100000);

        /**
         * ID 转 Base62
         *
         * 10 位数字 ID → 7 位 Base62 字符串
         * 例如：100000 → "uNkRE"
         */
        public String idToShortCode(long id) {
            StringBuilder sb = new StringBuilder();
            long temp = id;

            while (temp > 0) {
                sb.append(BASE62_CHARS.charAt((int) (temp % 62)));
                temp /= 62;
            }

            return sb.reverse().toString();
        }

        public String generate() {
            long id = idGenerator.incrementAndGet();
            return idToShortCode(id);
        }

        // 生成示例：
        // ID: 100000 → 短码: uNkRE
        // ID: 100001 → 短码: uNkRF
        // ID: 100010 → 短码: uNkRO
    }

    /**
     * 方案三：用户自定义 + 随机补齐
     *
     * 用户可以指定喜欢的后缀，如果已被占用则拒绝或建议替代
     */
    public static class CustomGenerator {

        private RedisTemplate<String, String> redis;

        /**
         * 注册自定义短码
         *
         * @return 实际可用的短码（可能被加了后缀）
         */
        public String registerCustom(String longUrl, String preferredCode) {
            // 1. 检查用户想要的短码是否可用
            String existing = redis.opsForValue().get("short:" + preferredCode);

            if (existing == null) {
                // 可用，直接注册
                redis.opsForValue().set("short:" + preferredCode, longUrl);
                return preferredCode;
            } else if (existing.equals(longUrl)) {
                // 已经被这个 URL 占用，返回原短码
                return preferredCode;
            } else {
                // 已被其他 URL 占用，返回错误或建议
                throw new CodeOccupiedException(preferredCode);
            }
        }
    }
}
```

### 4.2 存储设计

```java
/**
 * 短链接存储设计
 */
public class ShortLinkStorage {

    private RedisTemplate<String, String> redis;
    private JdbcTemplate jdbc;

    /**
     * 写入短链接
     *
     * 为什么要同时写 Redis 和 MySQL？
     * - Redis：热点数据，读取 QPS 高，内存访问
     * - MySQL：持久化存储，数据安全
     */
    public void createShortLink(String shortCode, String longUrl, User user) {
        // 1. 写入 MySQL（主存储）
        jdbc.update("""
            INSERT INTO short_links (short_code, long_url, user_id, created_at)
            VALUES (?, ?, ?, NOW())
            """, shortCode, longUrl, user.getId());

        // 2. 写入 Redis（热点缓存）
        // 热点短链接（如推广链接）放在 Redis，加速访问
        redis.opsForValue().set("s:" + shortCode, longUrl, Duration.ofDays(365));

        // 3. 记录用户-短码关系（方便管理）
        redis.opsForSet().add("u:" + user.getId(), shortCode);
    }

    /**
     * 读取长链接
     *
     * Cache-Aside 模式：先读 Redis，未命中读 MySQL
     */
    public String getLongUrl(String shortCode) {
        // 1. 先查 Redis
        String longUrl = redis.opsForValue().get("s:" + shortCode);
        if (longUrl != null) {
            return longUrl;
        }

        // 2. Redis 未命中，查 MySQL
        longUrl = jdbc.queryForObject(
            "SELECT long_url FROM short_links WHERE short_code = ?",
            String.class,
            shortCode
        );

        // 3. 回填 Redis（如果存在的话）
        if (longUrl != null) {
            redis.opsForValue().set("s:" + shortCode, longUrl, Duration.ofDays(30));
        }

        return longUrl;
    }

    /**
     * 点击量 +1（异步）
     *
     * 为什么用 Redis 而不是直接写 MySQL？
     * - 高并发下减少数据库压力
     * - 定期批量写入，减少磁盘 I/O
     */
    public void incrementClick(String shortCode) {
        // 使用 Redis HyperLogLog 统计独立访客
        redis.opsForHyperLogLog().add("pf:click:" + shortCode, UUID.randomUUID().toString());

        // 使用 Redis INCR 统计点击量（最终一致性允许小误差）
        redis.opsForValue().increment("cnt:click:" + shortCode);
    }
}
```

### 4.3 重定向设计

```java
/**
 * HTTP 重定向实现
 */
public class RedirectController {

    private ShortLinkService shortLinkService;

    /**
     * 短链接访问入口
     *
     * HTTP 301 vs 302：
     * - 301：永久重定向，浏览器会缓存，SEO 友好
     * - 302：临时重定向，每次都经过服务器，方便统计
     *
     * 选择：302（方便准确统计每次访问）
     */
    @GetMapping("/{shortCode}")
    public ResponseEntity<Void> redirect(@PathVariable String shortCode,
                                          HttpServletRequest request,
                                          HttpServletResponse response) {
        String longUrl = shortLinkService.getLongUrl(shortCode);

        if (longUrl == null) {
            // 短链接不存在或已过期
            return ResponseEntity.notFound().build();
        }

        // 记录点击（异步，不阻塞响应）
        shortLinkService.recordClickAsync(shortCode, request);

        // 302 临时重定向
        return ResponseEntity.status(HttpStatus.FOUND)
            .location(URI.create(longUrl))
            .build();
    }
}
```


## 五、延伸问题

### 问题一：如何防止恶意刷短链接？

```
方案：
1. 接口限流（每个 IP/用户每天最多创建 N 个）
2. 验证码（批量创建时触发）
3. 黑白名单（IP、域名过滤）
4. 内容审核（检查长 URL 是否合规）
```

### 问题二：如何实现短链接的过期删除？

```
方案：
1. 定期扫描：后台任务扫描过期链接，标记删除
2. 惰性删除：访问时检查，过期则返回 404
3. 延迟删除：过期后转入冷存储，N 天后彻底删除
```

### 问题三：如何支持地域/设备分流？

```
场景：同一短链接，不同用户看到不同页面

方案：
- 在长 URL 中嵌入参数：`https://example.com/page?from={device}`
- 或者使用短链接服务内置的分流逻辑
- 分析请求头（User-Agent、IP），返回不同重定向目标
```


## 六、总结

```
┌─────────────────────────────────────────────────────┐
│              短链接系统核心知识点                      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  短码生成                                            │
│  ├── 哈希 + Base62（简单，但可能冲突）                 │
│  └── ID + Base62（推荐，绝对唯一）                   │
│                                                     │
│  存储架构                                            │
│  ├── Redis（热点缓存，高 QPS）                       │
│  └── MySQL（持久化存储）                             │
│                                                     │
│  读取优化                                            │
│  └── Cache-Aside：先 Redis，再 MySQL                │
│                                                     │
│  点击统计                                            │
│  └── Redis INCR + HyperLogLog                       │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**面试加分点**：
- 能说清楚 Base62 编码原理
- 能分析为什么用 Redis + MySQL 双写
- 能解释 301 和 302 的区别和使用场景
