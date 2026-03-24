# Redis Session 管理：分布式会话的利器

你有没有遇到过这种情况：

用户刚登录，下一秒又要重新登录。

可能是因为负载均衡把请求路由到了另一台服务器，而那台服务器没有用户的登录信息。

**Redis Session** 就是来解决这个问题的。

## 为什么需要分布式 Session？

传统模式下，Session 存储在应用服务器的内存中：

```
用户登录 → 服务器 A 创建 Session → 存储在 A 的内存
              ↓
        请求被路由到服务器 B
              ↓
        B 没有 Session → 用户需要重新登录
```

## Redis Session 方案

使用 Redis 存储 Session，所有服务器共享：

```
用户登录 → 服务器 A 创建 Session → 存储在 Redis
              ↓
        请求被路由到服务器 B
              ↓
        B 从 Redis 读取 Session → 正常访问
```

## Spring Boot + Redis Session

### Maven 依赖

```xml
<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.session</groupId>
        <artifactId>spring-session-data-redis</artifactId>
    </dependency>
</dependencies>
```

### 配置类

```java
@Configuration
@EnableRedisHttpSession(maxInactiveIntervalInSeconds = 3600)
public class RedisSessionConfig {
    // Redis 连接配置会在 application.yml 中配置
}
```

### application.yml

```yaml
spring:
  redis:
    host: localhost
    port: 6379
    password: password
    lettuce:
      pool:
        max-active: 8
        max-idle: 8
        min-idle: 0
  session:
    store-type: redis
    redis:
      namespace: spring:session
```

### Session 使用

```java
@RestController
@RequestMapping("/user")
public class UserController {

    /**
     * 用户登录
     */
    @PostMapping("/login")
    public String login(HttpServletRequest request,
                        @RequestParam String username,
                        @RequestParam String password) {
        // 验证用户
        User user = userService.authenticate(username, password);

        if (user != null) {
            // 创建 Session
            HttpSession session = request.getSession();
            // 存储用户信息
            session.setAttribute("userId", user.getId());
            session.setAttribute("username", user.getUsername());
            session.setAttribute("role", user.getRole());

            return "Login success";
        }

        return "Login failed";
    }

    /**
     * 获取当前用户信息
     */
    @GetMapping("/info")
    public User getUserInfo(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }

        Long userId = (Long) session.getAttribute("userId");
        String username = (String) session.getAttribute("username");

        return new User(userId, username);
    }

    /**
     * 修改用户信息
     */
    @PostMapping("/update")
    public String updateUser(HttpServletRequest request,
                            @RequestParam String username) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            session.setAttribute("username", username);
            return "Update success";
        }
        return "Not logged in";
    }

    /**
     * 登出
     */
    @PostMapping("/logout")
    public String logout(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session != null) {
            // 使 Session 失效
            session.invalidate();
        }
        return "Logout success";
    }
}
```

## Redis Session 的结构

Session 存储在 Redis 中的结构：

```
Key: spring:session:sessions:abc123def456
Type: Hash
Fields:
  session:attr:userId → "123"
  session:attr:username → "zhangsan"
  session:attr:role → "admin"
  session:creationTime → "1609459200000"
  session:lastAccessedTime → "1609462800000"
  session:maxInactiveInterval → "3600"

TTL: 3600 秒（1 小时）
```

## 手动管理 Session

如果不用 Spring Session，也可以手动操作：

```java
public class RedisSessionManager {
    private Jedis jedis = JedisPoolFactory.getJedis();
    private static final String SESSION_PREFIX = "session:";
    private static final int SESSION_TTL = 3600;  // 1 小时

    /**
     * 创建 Session
     */
    public String createSession(String userId, Map&lt;String, String&gt; userInfo) {
        String sessionId = UUID.randomUUID().toString();
        String key = SESSION_PREFIX + sessionId;

        // 存储用户信息
        Map&lt;String, String&gt; sessionData = new HashMap&lt;&gt;();
        sessionData.put("userId", userId);
        sessionData.putAll(userInfo);
        sessionData.put("createTime", String.valueOf(System.currentTimeMillis()));

        jedis.hset(key, sessionData);
        jedis.expire(key, SESSION_TTL);

        return sessionId;
    }

    /**
     * 获取 Session
     */
    public Map&lt;String, String&gt; getSession(String sessionId) {
        String key = SESSION_PREFIX + sessionId;
        Map&lt;String, String&gt; session = jedis.hgetAll(key);

        if (session != null && !session.isEmpty()) {
            // 刷新 TTL
            jedis.expire(key, SESSION_TTL);
        }

        return session;
    }

    /**
     * 更新 Session
     */
    public void updateSession(String sessionId, String field, String value) {
        String key = SESSION_PREFIX + sessionId;
        jedis.hset(key, field, value);
        jedis.expire(key, SESSION_TTL);
    }

    /**
     * 删除 Session（登出）
     */
    public void deleteSession(String sessionId) {
        String key = SESSION_PREFIX + sessionId;
        jedis.del(key);
    }

    /**
     * 验证 Session 是否有效
     */
    public boolean validateSession(String sessionId) {
        String key = SESSION_PREFIX + sessionId;
        return jedis.exists(key);
    }
}
```

## Session 集群配置

### 主从复制

```yaml
# application.yml
spring:
  redis:
    host: master-host
    port: 6379
    slave-of:
      host: slave-host
      port: 6379
```

### Redis Sentinel

```yaml
spring:
  redis:
    sentinel:
      master: mymaster
      nodes: 192.168.1.101:26379,192.168.1.102:26379,192.168.1.103:26379
```

### Redis Cluster

```yaml
spring:
  redis:
    cluster:
      nodes: 192.168.1.101:6379,192.168.1.102:6379,192.168.1.103:6379,\
              192.168.1.104:6379,192.168.1.105:6379,192.168.1.106:6379
```

## Session 安全

### 1. Session ID 安全

```java
public class SessionSecurityManager {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 生成安全的 Session ID
     */
    public String generateSecureSessionId() {
        // 使用 UUID + 随机数
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);

        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    /**
     * 验证 Session 来源
     */
    public boolean validateSessionOrigin(String sessionId, String clientIp) {
        String key = "session:origin:" + sessionId;
        String storedIp = jedis.get(key);

        if (storedIp == null) {
            // 首次访问，记录 IP
            jedis.setex(key, 3600, clientIp);
            return true;
        }

        return storedIp.equals(clientIp);
    }
}
```

### 2. Session 固定攻击防护

```java
public class SessionFixationProtection {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 用户登录时重新生成 Session ID
     */
    public String regenerateSession(String oldSessionId, String userId) {
        // 获取旧 Session 数据
        Map&lt;String, String&gt; oldData = getSession(oldSessionId);

        // 删除旧 Session
        deleteSession(oldSessionId);

        // 创建新 Session
        Map&lt;String, String&gt; newData = new HashMap&lt;&gt;();
        newData.put("userId", userId);
        newData.put("loginTime", String.valueOf(System.currentTimeMillis()));

        return createSession(userId, newData);
    }
}
```

## 性能优化

### 1. 压缩 Session 数据

```java
public class CompressedSessionManager {
    private Jedis jedis = JedisPoolFactory.getJedis();

    /**
     * 存储压缩后的 Session
     */
    public void setCompressedSession(String sessionId, Map&lt;String, Object&gt; data)
            throws IOException {
        String key = "session:" + sessionId;

        // 序列化为 JSON
        String json = JSON.toJSONString(data);

        // GZIP 压缩
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        GZIPOutputStream gzip = new GZIPOutputStream(bos);
        gzip.write(json.getBytes("UTF-8"));
        gzip.finish();

        jedis.set(key.getBytes(), bos.toByteArray());
        jedis.expire(key, 3600);
    }
}
```

### 2. 只存储必要的数据

```java
public class MinimalSessionManager {
    /**
     * 最小化 Session 数据
     */
    public Map&lt;String, String&gt; minimizeUserData(User user) {
        Map&lt;String, String&gt; sessionData = new HashMap&lt;&gt;();

        // 只存储必要的信息
        sessionData.put("userId", String.valueOf(user.getId()));
        sessionData.put("username", user.getUsername());
        // 不要存储整个 User 对象

        return sessionData;
    }
}
```

## 面试追问方向

1. **Session 存储在 Redis 和存储在 Cookie 中有什么区别？**

   Cookie 存储在客户端，数据量有限（4KB），安全性较低（可被篡改）。Redis Session 存储在服务端，数据量可以很大，安全性高，但需要额外的 Redis 服务。

2. **如何实现 Session 共享？**

   通过将 Session 存储在 Redis 中实现。所有应用服务器连接同一个 Redis，Session 自然就共享了。Spring Session 提供了开箱即用的解决方案。

---

**核心记忆点**：Redis Session 将 Session 数据存储在 Redis 中，实现分布式共享。使用 Spring Session 可以零代码实现 Session 管理。Session 存储的用户信息要最小化，只存必要的数据。
