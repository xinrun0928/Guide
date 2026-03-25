# Shiro session + Redis 分布式会话共享

单机部署时，Session 存在单机内存里，毫无问题。

但一旦扩展到多节点，Session 共享就成了噩梦——用户登录后，下次请求可能被路由到另一台服务器，Session 丢了，用户又要重新登录。

这一节，我们来解决这个问题。

## 问题分析

### 单体架构

```
用户请求
    │
    ▼
Server（Session 存在内存中）
    │
    ▼
一切正常 ✓
```

### 多节点架构（无 Session 共享）

```
用户登录 ──▶ Node A（Session 创建）
    │
    ▼
下次请求 ──▶ Node B（Session 不存在！）
    │
    ▼
用户需要重新登录 ✗
```

### 多节点架构（Redis Session 共享）

```
用户登录 ──▶ Node A
                │
                ▼
            Session 存入 Redis
                │
                ▼
下次请求 ──▶ Node B
                │
                ▼
            从 Redis 获取 Session
                │
                ▼
            Session 存在 ✓
```

## 解决方案

使用 shiro-redis 将 Session 存储到 Redis。

### 添加依赖

```xml
<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-redis</artifactId>
    <version>4.5.3</version>
</dependency>

<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>
```

### Redis 配置

```java
@Configuration
public class RedisConfig {
    
    @Bean
    public RedisTemplate<String, Object> redisTemplate(
            RedisConnectionFactory factory) {
        
        RedisTemplate<String, Object> template = new RedisTemplate<>();
        template.setConnectionFactory(factory);
        
        // 使用 JSON 序列化
        Jackson2JsonRedisSerializer<Object> serializer = 
            new Jackson2JsonRedisSerializer<>(Object.class);
        
        template.setKeySerializer(new StringRedisSerializer());
        template.setValueSerializer(serializer);
        template.setHashKeySerializer(new StringRedisSerializer());
        template.setHashValueSerializer(serializer);
        
        template.afterPropertiesSet();
        return template;
    }
}
```

### Shiro Session 配置

```java
@Configuration
public class ShiroRedisSessionConfig {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    @Bean
    public RedisSessionDAO redisSessionDAO() {
        RedisSessionDAO sessionDAO = new RedisSessionDAO();
        sessionDAO.setRedisManager(redisManager());
        return sessionDAO;
    }
    
    @Bean
    public RedisManager redisManager() {
        RedisManager redisManager = new RedisManager();
        
        // 使用 shiro-redis 提供的 RedisManager
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(100);
        poolConfig.setMaxIdle(20);
        poolConfig.setMinIdle(5);
        
        JedisPool jedisPool = new JedisPool(
            poolConfig, 
            "localhost", 
            6379, 
            2000, 
            "password"
        );
        
        // 使用 shiro-redis 的 JedisManager
        shiro-redis JedisManager jedisManager = new JedisManager();
        jedisManager.setJedisPool(jedisPool);
        
        redisManager.setRedisManager(jedisManager);
        
        // Session 过期时间（毫秒）
        redisManager.setExpire(1800000);  // 30 分钟
        
        return redisManager;
    }
    
    @Bean
    public DefaultWebSessionManager sessionManager(RedisSessionDAO sessionDAO) {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        
        // 使用 Redis SessionDAO
        sessionManager.setSessionDAO(sessionDAO);
        
        // 全局会话超时时间
        sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);
        
        // 是否在请求结束时删除无效 Session
        sessionManager.setDeleteInvalidSessions(true);
        
        // 会话验证调度
        sessionManager.setSessionValidationSchedulerEnabled(true);
        sessionManager.setSessionValidationInterval(15 * 60 * 1000);
        
        return sessionManager;
    }
}
```

### 完整 Shiro 配置

```java
@Configuration
public class ShiroConfig {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    @Bean
    public SecurityManager securityManager(Realm realm, SessionManager sessionManager) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        
        // Realm
        realm.setCacheManager(cacheManager());
        manager.setRealm(realm);
        
        // Session 管理
        manager.setSessionManager(sessionManager);
        
        // RememberMe
        manager.setRememberMeManager(rememberMeManager());
        
        return manager;
    }
    
    @Bean
    public CustomRealm realm() {
        CustomRealm realm = new CustomRealm();
        
        // 密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        realm.setCredentialsMatcher(matcher);
        
        return realm;
    }
    
    @Bean
    public CacheManager cacheManager() {
        // 使用 Redis 作为缓存
        RedisCacheManager cacheManager = new RedisCacheManager();
        cacheManager.setRedisManager(redisManager());
        cacheManager.setKeyPrefix("shiro:cache:");
        cacheManager.setExpire(1800);  // 30 分钟
        return cacheManager;
    }
    
    @Bean
    public RedisManager redisManager() {
        RedisManager redisManager = new RedisManager();
        
        JedisPool jedisPool = new JedisPool(
            new JedisPoolConfig(),
            "localhost",
            6379,
            2000,
            "password"
        );
        
        JedisManager jedisManager = new JedisManager();
        jedisManager.setJedisPool(jedisPool);
        
        redisManager.setRedisManager(jedisManager);
        redisManager.setExpire(1800);
        
        return redisManager;
    }
    
    @Bean
    public RedisSessionDAO redisSessionDAO() {
        RedisSessionDAO sessionDAO = new RedisSessionDAO();
        sessionDAO.setRedisManager(redisManager());
        return sessionDAO;
    }
    
    @Bean
    public DefaultWebSessionManager sessionManager() {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        sessionManager.setSessionDAO(redisSessionDAO());
        sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);
        sessionManager.setSessionValidationSchedulerEnabled(true);
        return sessionManager;
    }
    
    @Bean
    public RememberMeManager rememberMeManager() {
        CookieRememberMeManager manager = new CookieRememberMeManager();
        
        SimpleCookie cookie = new SimpleCookie("rememberMe");
        cookie.setHttpOnly(true);
        cookie.setMaxAge(7 * 24 * 60 * 60);  // 7 天
        manager.setCookie(cookie);
        
        manager.setCipherKey(Base64.getDecoder().decode(
            "YourBase64EncodedCipherKey=="));
        
        return manager;
    }
}
```

## Session 数据结构

存储在 Redis 中的 Session 数据结构：

```
Key: shiro:session:{sessionId}
Type: Hash
TTL: 1800 秒（30 分钟）

Fields:
  - session:attributes   → Session 属性（JSON）
  - session:startTimeout → 开始时间
  - session:lastAccessTime → 最后访问时间
  - session:expire       → 过期时间
```

### 查看 Session

```bash
# 查看所有 Session key
KEYS shiro:session:*

# 查看单个 Session
GET shiro:session:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

# 查看 Session 属性
HGETALL shiro:session:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## 分布式 Session 注意事项

### 1. Session 序列化问题

Session 中的对象必须可序列化：

```java
// 正确：实现 Serializable
public class User implements Serializable {
    private static final long serialVersionUID = 1L;
    private Long id;
    private String username;
    // ...
}

// 错误：未实现 Serializable
public class User {
    private Long id;
    private String username;
    // ...
}
```

### 2. Session 过期时间一致性

确保 Redis TTL 和 SessionManager 的超时时间一致：

```java
// SessionManager
sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);  // 30 分钟

// Redis
redisManager.setExpire(1800);  // 1800 秒 = 30 分钟
```

### 3. 分布式锁

高并发场景下，可能需要分布式锁保护 Session：

```java
@Service
public class DistributedSessionService {
    
    @Autowired
    private RedisTemplate<String, Object> redisTemplate;
    
    public void updateSession(String sessionId, String key, Object value) {
        String lockKey = "lock:session:" + sessionId;
        
        // 获取分布式锁
        Boolean locked = redisTemplate.opsForValue()
            .setIfAbsent(lockKey, "1", 10, TimeUnit.SECONDS);
        
        if (Boolean.TRUE.equals(locked)) {
            try {
                // 更新 Session
                redisTemplate.opsForHash().put(
                    "shiro:session:" + sessionId,
                    key,
                    value
                );
            } finally {
                // 释放锁
                redisTemplate.delete(lockKey);
            }
        }
    }
}
```

## Session 共享进阶

### 集群 Session 同步

如果不想用 Redis 存储 Session，也可以使用 Session 同步：

```java
@Bean
public DefaultWebSessionManager sessionManager() {
    DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
    
    // 使用集群 Session 管理
    EnterpriseCacheSessionDAO sessionDAO = new EnterpriseCacheSessionDAO();
    sessionDAO.setCacheManager(cacheManager());
    
    sessionManager.setSessionDAO(sessionDAO);
    
    return sessionManager;
}
```

### 多级缓存

```
┌─────────────────────────────────────────────────────┐
│                   Request                            │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│               Local Cache (Caffeine)                │
│              热点数据，本地缓存                       │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│               Redis Cache                            │
│             Session 共享存储                         │
└─────────────────────────────────────────────────────┘
```

## 常见问题

### 问题一：Session 频繁丢失

**可能原因**：
1. Redis 过期时间太短
2. Redis 连接不稳定
3. Session 序列化失败

**解决方案**：
- 增加 Redis TTL
- 检查网络连接
- 确保所有对象实现 Serializable

### 问题二：性能下降

**可能原因**：
1. Session 数据太大
2. Redis 序列化开销
3. 网络延迟

**解决方案**：
- 精简 Session 中的数据
- 使用高效的序列化方式（如 Kryo）
- 减少网络往返

### 问题三：分布式 Session 和 LocalSession 冲突

**原因**：同时配置了本地 Session 和 Redis Session。

**解决方案**：只使用 Redis Session。

## 面试追问方向

**面试官可能会问**：

1. **Session 共享有几种方案？**
   - Session 复制（WebSocket/广播）
   - Session 集中存储（Redis）
   - Cookie + 服务器签名
   - JWT 无状态

2. **Redis 存储 Session 的优势？**
   - 跨服务器共享
   - 支持过期时间
   - 支持集群

3. **Session 数据太大怎么办？**
   - 只存储必要数据
   - 使用压缩
   - 分层存储

4. **如何保证 Session 的原子性？**
   - 使用分布式锁
   - Redis 事务（MULTI/EXEC）

---

## 留给你的问题

分布式 Session 解决了集群部署问题，但在某些场景下，我们根本不想用 Session。

比如纯 API 项目，Token 比 Session 更轻量。

下一节，我们来学习 Shiro 如何实现 JWT 无状态认证。
