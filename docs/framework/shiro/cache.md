# Shiro 缓存：EhCache / Redis + CacheManager

你知道 Shiro 认证授权最慢的环节是什么吗？

不是密码比对，而是**数据库查询**。

每次 `isPermitted()` 都要查一次数据库？如果有 1000 个并发用户，数据库直接爆炸。

这一节，我们来学习 Shiro 的缓存机制。

## 为什么要用缓存？

没有缓存的认证授权流程：

```
用户请求
    │
    ▼
Realm.doGetAuthorizationInfo() 
    │
    ▼
查询数据库获取权限
    │
    ▼
返回权限信息
```

**问题**：每次请求都要查数据库，性能很差。

有缓存的认证授权流程：

```
用户请求
    │
    ▼
检查缓存是否存在
    │
    ├─ 命中缓存 ──▶ 直接返回
    │
    └─ 未命中 ──▶ 查询数据库
                   │
                   ▼
              存入缓存
```

**优势**：大幅减少数据库查询，提升性能。

## Shiro 缓存架构

```
┌─────────────────────────────────────────────────────────────┐
│                       SecurityManager                         │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐   │
│   │                      CacheManager                     │   │
│   │                                                      │   │
│   │   ┌─────────────┐    ┌─────────────┐               │   │
│   │   │ Authorization│    │Authentication│               │   │
│   │   │    Cache     │    │    Cache    │               │   │
│   │   └─────────────┘    └─────────────┘               │   │
│   │         │                   │                       │   │
│   │         └─────────┬─────────┘                       │   │
│   │                   ▼                                  │   │
│   │         ┌─────────────────┐                        │   │
│   │         │   Cache Backend  │                        │   │
│   │         │  EhCache/Redis   │                        │   │
│   │         └─────────────────┘                        │   │
│   └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## EhCache 配置

### 添加依赖

```xml
<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-ehcache</artifactId>
    <version>1.13.0</version>
</dependency>
```

### ehcache.xml 配置

```xml
<?xml version="1.0" encoding="UTF-8"?>
<ehcache xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:noNamespaceSchemaLocation="http://ehcache.org/ehcache.xsd"
         updateCheck="false">

    <!-- 磁盘缓存位置 -->
    <diskStore path="java.io.tmpdir/shiro-ehcache"/>

    <!-- 授权信息缓存 -->
    <cache name="authorizationCache"
           eternal="false"
           timeToIdleSeconds="1800"      <!-- 空闲 30 分钟过期 -->
           timeToLiveSeconds="3600"       <!-- 存活 1 小时过期 -->
           maxEntriesLocalHeap="1000"     <!-- 最多 1000 条 -->
           maxEntriesLocalDisk="10000"
           overflowToDisk="true"
           diskPersistent="false"
           diskExpiryThreadIntervalSeconds="120"/>

    <!-- 认证信息缓存 -->
    <cache name="authenticationCache"
           eternal="false"
           timeToIdleSeconds="1800"
           timeToLiveSeconds="3600"
           maxEntriesLocalHeap="1000"
           maxEntriesLocalDisk="10000"
           overflowToDisk="true"/>

    <!-- Session 缓存 -->
    <cache name="shiro-activeSessionCache"
           eternal="false"
           timeToIdleSeconds="1800"
           timeToLiveSeconds="3600"
           maxEntriesLocalHeap="10000"
           maxEntriesLocalDisk="100000"
           overflowToDisk="true"/>
           
    <!-- 默认缓存 -->
    <defaultCache
           eternal="false"
           timeToIdleSeconds="1800"
           timeToLiveSeconds="3600"
           maxEntriesLocalHeap="1000"
           maxEntriesLocalDisk="10000"
           overflowToDisk="true"/>
</ehcache>
```

### Shiro 配置

```java
@Bean
public CacheManager cacheManager() {
    EhCacheManager cacheManager = new EhCacheManager();
    cacheManager.setCacheManagerConfigFile("classpath:ehcache.xml");
    return cacheManager;
}

@Bean
public SecurityManager securityManager(Realm realm, CacheManager cacheManager) {
    DefaultSecurityManager manager = new DefaultWebSecurityManager();
    
    // 配置 Realm
    realm.setCacheManager(cacheManager);
    manager.setRealm(realm);
    
    // 配置 CacheManager
    manager.setCacheManager(cacheManager);
    
    return manager;
}
```

## Redis 配置

### 添加依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-redis</artifactId>
    <version>4.5.3</version>
</dependency>
```

### Redis 配置类

```java
@Configuration
public class RedisConfig {
    
    @Bean
    public RedisManager redisManager(RedisConnectionFactory factory) {
        RedisManager redisManager = new RedisManager();
        redisManager.setRedisManager(new JedisRedisManager(factory));
        redisManager.setKeySerializer(new StringSerializer());
        redisManager.setValueSerializer(new GenericJackson2JsonRedisSerializer());
        redisManager.setExpire(3600);  // 默认过期时间 1 小时
        return redisManager;
    }
}
```

### Shiro 配置

```java
@Bean
public CacheManager cacheManager(RedisManager redisManager) {
    RedisCacheManager cacheManager = new RedisCacheManager();
    cacheManager.setRedisManager(redisManager);
    
    // 缓存过期时间（秒）
    cacheManager.setExpire(1800);  // 30 分钟
    
    // 全局缓存前缀
    cacheManager.setKeyPrefix("shiro:cache:");
    
    return cacheManager;
}

@Bean
public SecurityManager securityManager(Realm realm, CacheManager cacheManager) {
    DefaultSecurityManager manager = new DefaultWebSecurityManager();
    
    realm.setCacheManager(cacheManager);
    manager.setRealm(realm);
    manager.setCacheManager(cacheManager);
    
    return manager;
}
```

## 自定义 CacheManager

如果内置的不满足需求，可以自定义：

```java
public class CustomCacheManager implements CacheManager {
    
    private Cache<Object, Object> authorizationCache;
    private Cache<Object, Object> authenticationCache;
    
    @Override
    public <K, V> Cache<K, V> getCache(String name) throws CacheException {
        if ("authorizationCache".equals(name)) {
            if (authorizationCache == null) {
                authorizationCache = new CustomCache<>();
            }
            return (Cache<K, V>) authorizationCache;
        }
        // ... 其他缓存
        throw new CacheException("Unknown cache: " + name);
    }
}

public class CustomCache<K, V> implements Cache<K, V> {
    
    private Map<K, V> cache = new ConcurrentHashMap<>();
    private long ttlSeconds = 1800;  // 30 分钟
    
    @Override
    public V get(K key) throws CacheException {
        // 从 Map 获取
        return cache.get(key);
    }
    
    @Override
    public V put(K key, V value) throws CacheException {
        // 存入 Map
        return cache.put(key, value);
    }
    
    @Override
    public V remove(K key) throws CacheException {
        return cache.remove(key);
    }
    
    @Override
    public void clear() throws CacheException {
        cache.clear();
    }
    
    @Override
    public int size() {
        return cache.size();
    }
    
    @Override
    public Set<K> keys() {
        return cache.keySet();
    }
    
    @Override
    public Collection<V> values() {
        return cache.values();
    }
}
```

## Realm 中启用缓存

```java
@Component
public class CustomRealm extends AuthorizingRealm {
    
    @Autowired
    private UserMapper userMapper;
    
    /**
     * 设置缓存名称
     */
    public CustomRealm() {
        // 授权缓存名称
        setAuthorizationCacheName("authorizationCache");
        
        // 认证缓存名称
        setAuthenticationCacheName("authenticationCache");
    }
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        // 只有缓存未命中时才会执行此方法
        String username = (String) principals.getPrimaryPrincipal();
        
        // 查询数据库
        User user = userMapper.findByUsername(username);
        Set<String> roles = userMapper.findRolesByUsername(username);
        Set<String> permissions = userMapper.findPermissionsByUsername(username);
        
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        info.setRoles(roles);
        info.setStringPermissions(permissions);
        
        return info;
    }
    
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        // 只有缓存未命中时才会执行此方法
        UsernamePasswordToken upToken = (UsernamePasswordToken) token;
        String username = upToken.getUsername();
        
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UnknownAccountException("用户不存在");
        }
        
        return new SimpleAuthenticationInfo(
            user.getUsername(),
            user.getPassword(),
            ByteSource.Util.bytes(user.getSalt()),
            getName()
        );
    }
}
```

## 缓存清除

### 自动清除

当用户权限变更时，需要清除缓存：

```java
@Service
public class UserService {
    
    @Autowired
    private CustomRealm customRealm;
    
    @Autowired
    private CacheManager cacheManager;
    
    /**
     * 更新用户角色
     */
    public void updateUserRoles(Long userId, List<Long> roleIds) {
        // 1. 更新数据库
        userRoleMapper.updateUserRoles(userId, roleIds);
        
        // 2. 清除该用户的授权缓存
        String username = userMapper.findById(userId).getUsername();
        
        // 方式一：通过 Realm 清除
        customRealm.clearCachedAuthorizationInfo(
            SecurityUtils.getSubject().getPrincipals());
        
        // 方式二：通过 CacheManager 清除
        Cache<Object, AuthorizationInfo> cache = 
            cacheManager.getCache("authorizationCache");
        if (cache != null) {
            cache.remove(username);
        }
    }
    
    /**
     * 禁用用户
     */
    public void disableUser(Long userId) {
        // 更新数据库
        userMapper.disableUser(userId);
        
        // 清除该用户的认证缓存
        String username = userMapper.findById(userId).getUsername();
        
        Cache<Object, AuthenticationInfo> cache = 
            cacheManager.getCache("authenticationCache");
        if (cache != null) {
            cache.remove(username);
        }
    }
}
```

### 手动清除所有缓存

```java
public void clearAllAuthorizationCache() {
    Cache<Object, AuthorizationInfo> cache = 
        cacheManager.getCache("authorizationCache");
    if (cache != null) {
        cache.clear();
    }
}
```

## 缓存配置参数

### EhCache 参数

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| eternal | 是否永久缓存 | false |
| timeToIdleSeconds | 空闲过期时间（秒） | 0 |
| timeToLiveSeconds | 存活过期时间（秒） | 0 |
| maxEntriesLocalHeap | 最大缓存数量 | 0 |
| maxEntriesLocalDisk | 磁盘最大缓存数量 | 0 |
| overflowToDisk | 超过内存是否写入磁盘 | true |

### Redis 参数

| 参数 | 说明 |
|-----|------|
| expire | 过期时间（秒） |
| keyPrefix | 缓存 key 前缀 |
| managerImpl | Redis 管理器实现 |

## 面试追问方向

**面试官可能会问**：

1. **Shiro 的缓存是如何工作的？**
   - 通过 CacheManager 管理
   - 认证信息和授权信息分开缓存
   - 缓存 key 通常是用户身份标识

2. **权限变更后如何清除缓存？**
   - 调用 `Realm.clearCachedAuthorizationInfo()`
   - 直接操作 CacheManager 清除

3. **EhCache 和 Redis 缓存的区别？**
   - EhCache 是进程内缓存
   - Redis 是分布式缓存
   - 单体应用用 EhCache，分布式用 Redis

4. **缓存会带来什么问题？**
   - 缓存与数据库不一致
   - 缓存穿透、缓存雪崩
   - 需要做好缓存更新策略

---

## 留给你的问题

EhCache 是进程内缓存，在分布式环境下，每个节点的缓存是独立的。

那分布式 Session 怎么办？

下一节，我们来学习 Shiro Session + Redis 分布式会话共享。
