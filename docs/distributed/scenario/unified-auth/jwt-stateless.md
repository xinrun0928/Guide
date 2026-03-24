# 无状态 Token 方案：JWT 生成、刷新、注销与黑名单

你知道 JWT 最大的「坑」是什么吗？

不是它的性能，不是它的体积，而是——**它无法被主动撤销**。

JWT 是无状态的。服务端不存储任何信息，只靠签名验证。这意味着，一旦签发，在过期之前，**服务端没有任何手段让它失效**。

用户离职了，他的 Token 还在有效期。用户被禁用了，他依然可以访问。

这就是为什么，你需要一套完整的 Token 管理机制。

## JWT 的结构

JWT 由三部分组成，用 `.` 连接：

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

### 第一部分：Header

```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

Base64 编码后就是第一段。`alg` 表示签名算法，HS256 是对称加密，还有 RS256（非对称）等。

### 第二部分：Payload

```json
{
  "sub": "1234567890",
  "name": "John Doe",
  "iat": 1516239022,
  "exp": 1516242622,
  "iss": "auth-server",
  "version": 1
}
```

- `sub`：用户 ID
- `iat`：签发时间
- `exp`：过期时间
- `iss`：签发者
- `version`：Token 版本号（用于注销）

Base64 编码后是第二段。**Payload 是明文的，可以解码看到内容，所以不要存敏感信息。**

### 第三部分：Signature

```java
HMACSHA256(
  base64UrlEncode(header) + "." + base64UrlEncode(payload),
  secret
)
```

签名确保了 Payload 不可被篡改。如果 Payload 被修改，签名验证就会失败。

## JWT 的 Java 实现

使用 jjwt 库生成和验证 JWT：

```java
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-api</artifactId>
    <version>0.11.5</version>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-impl</artifactId>
    <version>0.11.5</version>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-jackson</artifactId>
    <version>0.11.5</version>
    <scope>runtime</scope>
</dependency>
```

### 生成 Token

```java
@Service
public class JwtService {

    private static final String SECRET = "your-256-bit-secret-key-here-must-be-long-enough";
    private static final long ACCESS_TOKEN_EXPIRATION = 15 * 60 * 1000; // 15分钟
    private static final long REFRESH_TOKEN_EXPIRATION = 7 * 24 * 60 * 60 * 1000; // 7天

    public String generateAccessToken(Long userId, String username, List&lt;String&gt; roles) {
        return Jwts.builder()
            .setSubject(userId.toString())
            .claim("username", username)
            .claim("roles", roles)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + ACCESS_TOKEN_EXPIRATION))
            .signWith(Keys.hmacShaKeyFor(SECRET.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }

    public String generateRefreshToken(Long userId, Integer tokenVersion) {
        return Jwts.builder()
            .setSubject(userId.toString())
            .claim("version", tokenVersion)
            .setIssuedAt(new Date())
            .setExpiration(new Date(System.currentTimeMillis() + REFRESH_TOKEN_EXPIRATION))
            .signWith(Keys.hmacShaKeyFor(SECRET.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }
}
```

### 验证 Token

```java
public Claims parseToken(String token) {
    try {
        return Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(SECRET.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody();
    } catch (ExpiredJwtException e) {
        throw new TokenExpiredException("Token 已过期");
    } catch (JwtException e) {
        throw new InvalidTokenException("无效的 Token");
    }
}
```

## Token 刷新策略

短期 Access Token + 长期 Refresh Token 的双 Token 策略，是业界最佳实践：

- **Access Token**：有效期短（15分钟），存放在内存中，用于 API 访问
- **Refresh Token**：有效期长（7天），可以持久化，用于获取新的 Access Token

```java
public class AuthResult {
    private String accessToken;
    private String refreshToken;
    private long expiresIn;

    // getters...
}

public AuthResult login(String username, String password) {
    // 验证用户名密码...
    User user = userService.authenticate(username, password);

    // 生成双 Token
    String accessToken = jwtService.generateAccessToken(
        user.getId(), user.getUsername(), user.getRoles());
    String refreshToken = jwtService.generateRefreshToken(
        user.getId(), user.getTokenVersion());

    return new AuthResult(accessToken, refreshToken, 15 * 60);
}

public String refreshAccessToken(String refreshToken) {
    // 验证 Refresh Token
    Claims claims = jwtService.parseToken(refreshToken);

    Long userId = Long.parseLong(claims.getSubject());
    Integer tokenVersion = claims.get("version", Integer.class);

    // 校验 Token 版本是否匹配（用户可能已注销）
    User user = userService.findById(userId);
    if (!user.getTokenVersion().equals(tokenVersion)) {
        throw new TokenRevokedException("Token 已失效，请重新登录");
    }

    // 生成新的 Access Token
    return jwtService.generateAccessToken(
        userId, user.getUsername(), user.getRoles());
}
```

## Token 注销的难题

终于到重点了。JWT 无法主动撤销，但业务上又必须支持注销。怎么办？

### 方案一：Token 黑名单

用户注销时，将 Token 加入 Redis 黑名单。验证时检查黑名单。

```java
@Service
public class TokenBlacklistService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String BLACKLIST_PREFIX = "jwt:blacklist:";

    public void blacklist(String token, long expirationMillis) {
        // Token 剩余有效期作为 Redis 过期时间
        redisTemplate.opsForValue().set(
            BLACKLIST_PREFIX + token,
            "1",
            expirationMillis,
            TimeUnit.MILLISECONDS
        );
    }

    public boolean isBlacklisted(String token) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_PREFIX + token));
    }
}
```

验证 Token 时：

```java
public Claims validateToken(String token) {
    // 先验证签名
    Claims claims = parseToken(token);

    // 再检查黑名单
    if (blacklistService.isBlacklisted(token)) {
        throw new TokenRevokedException("Token 已注销");
    }

    return claims;
}
```

### 方案二：Token 版本号

在 Payload 中加入 `version` 字段，用户注销时版本号 +1。所有旧 Token 立即失效。

```java
// 用户注销
public void logout(Long userId) {
    // Token 版本号 +1
    userService.incrementTokenVersion(userId);
}

// 验证 Token 时检查版本号
public Claims validateToken(String token) {
    Claims claims = parseToken(token);
    Long userId = Long.parseLong(claims.getSubject());
    Integer tokenVersion = claims.get("version", Integer.class);

    User user = userService.findById(userId);
    if (!user.getTokenVersion().equals(tokenVersion)) {
        throw new TokenRevokedException("Token 已失效");
    }

    return claims;
}
```

### 方案三：缩短 Access Token 有效期

配合黑名单方案，将 Access Token 有效期设置得很短（15分钟），即使不注销，Token 也会在较短时间内过期。

这种方案是黑名单方案的补充，**不是替代**。

## 三种注销方案的对比

| 方案 | 实现复杂度 | 即时性 | 存储开销 | 适用场景 |
|-----|----------|--------|---------|---------|
| 黑名单 | 中 | 立即生效 | 存所有 Token | 需要立即生效的注销 |
| 版本号 | 低 | 立即生效 | 只存版本号 | 普通用户注销 |
| 短期 Token | 低 | 有延迟（最长延迟 = Token 有效期） | 无 | 辅助方案 |

实际项目中，推荐**版本号 + 短期 Token**的组合，必要时加黑名单。

## 面试追问方向

- JWT 为什么不能用在前端存储敏感信息？（答：Payload 是 Base64 编码，可被解码）
- Access Token 存放在哪里？（答：前端存内存，不要存 localStorage 或 Cookie）
- Refresh Token 丢了怎么办？（答：结合设备指纹、IP 检测做风控）
- Token 过期了，用户正在操作怎么办？（答：前端拦截 401，调用刷新接口）

## 小结

JWT 无状态不代表「无管理」。一个完整的 Token 方案，需要考虑：

1. **生成**：用合适的签名算法，设置合理的有效期
2. **刷新**：双 Token 机制，Access Token 短期，Refresh Token 长期
3. **注销**：版本号 + 黑名单，即时失效
4. **验证**：签名验证 + 黑名单检查 + 版本号校验

没有完美的方案，只有适合业务的权衡。短期 Token + 定期刷新 + 必要时黑名单，是目前的主流选择。
