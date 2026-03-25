# JWT 生成与验证：jjwt 库使用

你有没有想过，为什么越来越多的系统选择 JWT 而不是传统的 Session？

Session 的问题在于：需要服务端存储，分布式环境下需要同步 session，扩展困难。

而 JWT 的核心优势就是**无状态**——服务端不需要存储任何东西，Token 本身包含了所有需要的信息。

今天，我们就来深入了解 JWT 的生成与验证。

---

## JWT 是什么？

### JWT 的全称

JSON Web Token——一种基于 JSON 的开放标准（RFC 7519），用于在各方之间安全地传输信息。

### JWT 的结构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           JWT 结构                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9                                 │
│  .                                                             │
│  eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5 │
│  MjJ9                                                             │
│  .                                                             │
│  SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c                        │
│                                                                          │
│  ──────────────────────────────────────────────────────────────────   │
│                                                                          │
│  Header.Payload.Signature                                              │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Header（头部）                                                    │  │
│  │ {                                                               │  │
│  │   "alg": "HS256",  ← 签名算法                                   │  │
│  │   "typ": "JWT"      ← Token 类型                                 │  │
│  │ }                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Payload（载荷）                                                  │  │
│  │ {                                                               │  │
│  │   "sub": "1234567890",  ← Subject（用户标识）                   │  │
│  │   "name": "John Doe",     ← 自定义Claims                        │  │
│  │   "iat": 1516239022,      ← Issued At（签发时间）               │  │
│  │   "exp": 1516242622       ← Expiration（过期时间）              │  │
│  │ }                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Signature（签名）                                                │  │
│  │ HMACSHA256(                                                    │  │
│  │   base64UrlEncode(header) + "." +                              │  │
│  │   base64UrlEncode(payload),                                    │  │
│  │   secret                                                        │  │
│  │ )                                                               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## JWT 的标准 Claims

| Claim | 全称 | 说明 |
|-------|------|------|
| iss | Issuer | 签发者 |
| sub | Subject | 主题（用户标识） |
| aud | Audience | 受众 |
| exp | Expiration Time | 过期时间 |
| nbf | Not Before | 生效时间 |
| iat | Issued At | 签发时间 |
| jti | JWT ID | 唯一标识 |

### 自定义 Claims

除了标准 Claims，还可以添加自定义 Claims：

```json
{
  "sub": "1234567890",
  "name": "John Doe",
  "role": "ADMIN",
  "userId": 1001,
  "department": "技术部"
}
```

---

## jjwt 库使用

### 添加依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;io.jsonwebtoken&lt;/groupId&gt;
    &lt;artifactId&gt;jjwt-api&lt;/artifactId&gt;
    &lt;version&gt;0.12.5&lt;/version&gt;
&lt;/dependency&gt;
&lt;dependency&gt;
    &lt;groupId&gt;io.jsonwebtoken&lt;/groupId&gt;
    &lt;artifactId&gt;jjwt-impl&lt;/artifactId&gt;
    &lt;version&gt;0.12.5&lt;/version&gt;
    &lt;scope&gt;runtime&lt;/scope&gt;
&lt;/dependency&gt;
&lt;dependency&gt;
    &lt;groupId&gt;io.jsonwebtoken&lt;/groupId&gt;
    &lt;artifactId&gt;jjwt-jackson&lt;/artifactId&gt;
    &lt;version&gt;0.12.5&lt;/version&gt;
    &lt;scope&gt;runtime&lt;/scope&gt;
&lt;/dependency&gt;
```

### 生成 JWT

```java
@Service
public class JwtService {
    
    // 签名密钥
    private static final String SECRET_KEY = "your-256-bit-secret-key-here-must-be-long-enough";
    
    /**
     * 生成 JWT Token
     */
    public String generateToken(String username, Long userId, List&lt;String&gt; roles) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + 86400000);  // 24小时
        
        return Jwts.builder()
            // 1. 设置 Header
            .header()
                .add("alg", "HS256")
                .add("typ", "JWT")
                .and()
            // 2. 设置 Payload（Claims）
            .subject(username)
            .claim("userId", userId)
            .claim("roles", roles)
            // 3. 设置标准 Claims
            .issuedAt(now)
            .expiration(expiryDate)
            // 4. 设置签名
            .signWith(Keys.hmacShaKeyFor(SECRET_KEY.getBytes(StandardCharsets.UTF_8)))
            // 5. 生成
            .compact();
    }
}
```

### 解析 JWT

```java
@Service
public class JwtService {
    
    /**
     * 解析 Token 获取 Claims
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
            .verifyWith(Keys.hmacShaKeyFor(SECRET_KEY.getBytes(StandardCharsets.UTF_8)))
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }
    
    /**
     * 获取用户名
     */
    public String getUsername(String token) {
        Claims claims = parseToken(token);
        return claims.getSubject();
    }
    
    /**
     * 获取用户 ID
     */
    public Long getUserId(String token) {
        Claims claims = parseToken(token);
        return claims.get("userId", Long.class);
    }
    
    /**
     * 获取角色
     */
    @SuppressWarnings("unchecked")
    public List&lt;String&gt; getRoles(String token) {
        Claims claims = parseToken(token);
        return claims.get("roles", List.class);
    }
    
    /**
     * 检查 Token 是否过期
     */
    public boolean isTokenExpired(String token) {
        try {
            Claims claims = parseToken(token);
            return claims.getExpiration().before(new Date());
        } catch (ExpiredJwtException e) {
            return true;
        }
    }
}
```

### 验证 JWT

```java
@Service
public class JwtService {
    
    /**
     * 验证 Token
     */
    public boolean validateToken(String token) {
        try {
            Claims claims = parseToken(token);
            return !claims.getExpiration().before(new Date());
        } catch (JwtException e) {
            return false;
        }
    }
    
    /**
     * 验证 Token 并返回用户信息
     */
    public UserInfo validateAndGetUser(String token) {
        try {
            Claims claims = parseToken(token);
            
            // 检查是否过期
            if (claims.getExpiration().before(new Date())) {
                throw new TokenExpiredException("Token 已过期");
            }
            
            return UserInfo.builder()
                .username(claims.getSubject())
                .userId(claims.get("userId", Long.class))
                .roles(claims.get("roles", List.class))
                .build();
                
        } catch (ExpiredJwtException e) {
            throw new TokenExpiredException("Token 已过期");
        } catch (MalformedJwtException e) {
            throw new InvalidTokenException("Token 格式错误");
        } catch (JwtException e) {
            throw new InvalidTokenException("Token 无效");
        }
    }
}
```

---

## 使用 Builder 模式构建 Claims

### 定义用户信息类

```java
@Data
@Builder
public class UserInfo {
    private Long userId;
    private String username;
    private String email;
    private List&lt;String&gt; roles;
    private Map&lt;String, Object&gt; additionalClaims;
}
```

### 生成 Token 的完整示例

```java
@Service
public class JwtService {
    
    private static final long EXPIRATION_TIME = 86400000;  // 24小时
    private static final long REFRESH_EXPIRATION_TIME = 604800000;  // 7天
    
    private final Key key;
    
    public JwtService() {
        // 密钥至少需要 256 位
        this.key = Keys.hmacShaKeyFor(
            "your-256-bit-secret-key-here-must-be-long-enough-256-bits".getBytes()
        );
    }
    
    /**
     * 生成 Access Token（短期）
     */
    public String generateAccessToken(UserInfo user) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + EXPIRATION_TIME);
        
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("userId", user.getUserId())
            .claim("email", user.getEmail())
            .claim("roles", user.getRoles())
            // 添加自定义 Claims
            .claim("type", "access")
            .issuedAt(now)
            .expiration(expiry)
            // 添加 ID（用于 Token 注销）
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
    
    /**
     * 生成 Refresh Token（长期）
     */
    public String generateRefreshToken(UserInfo user) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + REFRESH_EXPIRATION_TIME);
        
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("userId", user.getUserId())
            .claim("type", "refresh")
            .issuedAt(now)
            .expiration(expiry)
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
}
```

---

## 异常处理

### JWT 异常类型

```java
public class JwtExceptionHandler {
    
    @ExceptionHandler(ExpiredJwtException.class)
    public Result&lt;Void&gt; handleExpired(ExpiredJwtException e) {
        return Result.fail(401, "Token 已过期，请重新登录");
    }
    
    @ExceptionHandler(MalformedJwtException.class)
    public Result&lt;Void&gt; handleMalformed(MalformedJwtException e) {
        return Result.fail(401, "Token 格式错误");
    }
    
    @ExceptionHandler(SignatureException.class)
    public Result&lt;Void&gt; handleSignature(SignatureException e) {
        return Result.fail(401, "Token 签名验证失败");
    }
    
    @ExceptionHandler(UnsupportedJwtException.class)
    public Result&lt;Void&gt; handleUnsupported(UnsupportedJwtException e) {
        return Result.fail(401, "不支持的 Token 格式");
    }
    
    @ExceptionHandler(IllegalArgumentException.class)
    public Result&lt;Void&gt; handleIllegal(IllegalArgumentException e) {
        return Result.fail(401, "Token 不能为空");
    }
}
```

---

## JWT 的安全问题

### 1. 密钥安全

```java
// ❌ 硬编码密钥（危险）
private static final String SECRET = "hardcoded-secret-key";

// ✅ 从配置文件读取
@Value("${jwt.secret}")
private String secret;

// ✅ 使用环境变量
private String secret = System.getenv("JWT_SECRET");

// ✅ 使用配置中心（如 Apollo、Nacos）
@Value("${jwt.secret}")
private String secret;
```

### 2. 使用 HTTPS

JWT 通过 HTTP 传输时，必须使用 HTTPS 防止中间人攻击。

```yaml
# application.yml
server:
  ssl:
    enabled: true
```

### 3. 敏感信息

```java
// ❌ 在 Payload 中存储敏感信息
.claim("password", user.getPassword())
.claim("creditCard", "1234-5678-9012-3456")

// ✅ 只存储必要信息
.claim("userId", user.getId())
.claim("email", user.getEmail())  // 公开的信息可以
```

---

## 完整示例

### JWT 工具类

```java
@Service
public class JwtService {
    
    private static final String SECRET = System.getenv("JWT_SECRET");
    private static final long ACCESS_EXPIRATION = 3600000;      // 1小时
    private static final long REFRESH_EXPIRATION = 604800000;   // 7天
    
    private final Key key;
    
    public JwtService() {
        this.key = Keys.hmacShaKeyFor(SECRET.getBytes(StandardCharsets.UTF_8));
    }
    
    /**
     * 生成 Access Token
     */
    public String generateAccessToken(UserDetails userDetails) {
        Map&lt;String, Object&gt; claims = new HashMap&lt;&gt;();
        claims.put("roles", userDetails.getAuthorities()
            .stream()
            .map(GrantedAuthority::getAuthority)
            .collect(Collectors.toList()));
        claims.put("type", "access");
        
        return createToken(claims, userDetails.getUsername(), ACCESS_EXPIRATION);
    }
    
    /**
     * 生成 Refresh Token
     */
    public String generateRefreshToken(UserDetails userDetails) {
        Map&lt;String, Object&gt; claims = new HashMap&lt;&gt;();
        claims.put("type", "refresh");
        
        return createToken(claims, userDetails.getUsername(), REFRESH_EXPIRATION);
    }
    
    private String createToken(Map&lt;String, Object&gt; claims, String subject, long expiration) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expiration);
        
        return Jwts.builder()
            .claims(claims)
            .subject(subject)
            .issuedAt(now)
            .expiration(expiryDate)
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
    
    /**
     * 验证并解析 Token
     */
    public Claims validateToken(String token) {
        return Jwts.parser()
            .verifyWith(key)
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }
    
    /**
     * 获取用户名
     */
    public String getUsernameFromToken(String token) {
        return validateToken(token).getSubject();
    }
    
    /**
     * 获取 Token ID（用于黑名单）
     */
    public String getTokenId(String token) {
        return validateToken(token).getId();
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| JWT 的结构是什么？ | 基础概念 | 本篇 |
| JWT 和 Session 的区别？ | 对比理解 | JWT vs Session |
| JWT 为什么不需要在服务端存储？ | 原理理解 | 本篇 |
| JWT 的安全问题有哪些？ | 安全意识 | 本篇 |
| Access Token 和 Refresh Token 的区别？ | 设计理解 | 本篇 |

---

## 总结

JWT 生成与验证的核心要点：

1. **JWT 结构**：Header.Payload.Signature
2. **jjwt 库**：提供简洁的 API 生成和解析 JWT
3. **标准 Claims**：iss、sub、aud、exp、nbf、iat、jti
4. **签名算法**：HS256 需要至少 256 位密钥
5. **安全要点**：密钥安全、HTTPS、不存敏感信息

JWT 是现代无状态认证的核心技术，理解其原理和使用方式至关重要。

---

## 下一步

- 想了解 JWT 在过滤器链中的使用？→ [JWT 无状态认证流程设计](/framework/springsecurity/jwt-filter)
- 想了解 Token 刷新机制？→ [JWT 刷新机制与黑名单注销](/framework/springsecurity/jwt-refresh)
- 想了解 Token 防盗用？→ [Token 防盗用：设备指纹 + IP 绑定](/framework/springsecurity/jwt-security)
