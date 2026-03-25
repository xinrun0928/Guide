# JWT 刷新机制与黑名单注销

你有没有想过这个问题：JWT 是无状态的，签发后无法撤销，那用户退出登录时 Token 怎么处理？

如果 Token 被盗，用户怎么「吊销」Token？

今天，我们就来深入了解 JWT 的刷新机制和黑名单注销方案。

---

## 为什么需要刷新机制？

### Access Token 短期化

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Token 短期化的必要性                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  问题：如果 Access Token 有效期太长                                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Access Token 有效期 = 7 天                                        │   │
│  │                                                                   │   │
│  │ 1. Token 泄露后，攻击者可以使用 7 天                              │   │
│  │ 2. 用户修改密码后，旧的 Token 仍然有效                            │   │
│  │ 3. 用户被禁用后，Token 仍然有效                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  解决方案：短期 Access Token + 长期 Refresh Token                         │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Access Token：有效期 1 小时                                        │   │
│  │ - 频繁使用，需要快速验证                                          │   │
│  │ - 泄露后影响时间有限                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ Refresh Token：有效期 7 天                                        │   │
│  │ - 不频繁使用，用于获取新的 Access Token                          │   │
│  │ - 存储更安全（可以存在服务端）                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 双 Token 机制

### Token 生成

```java
@Service
public class JwtService {
    
    // Access Token：1小时
    private static final long ACCESS_TOKEN_EXPIRATION = 3600000;
    
    // Refresh Token：7天
    private static final long REFRESH_TOKEN_EXPIRATION = 604800000;
    
    /**
     * 生成 Access Token
     */
    public String generateAccessToken(UserDetails user) {
        Map&lt;String, Object&gt; claims = new HashMap&lt;&gt;();
        claims.put("type", "access");
        claims.put("roles", extractRoles(user));
        
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("userId", getUserId(user))
            .claims(claims)
            .issuedAt(new Date())
            .expiration(new Date(System.currentTimeMillis() + ACCESS_TOKEN_EXPIRATION))
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
    
    /**
     * 生成 Refresh Token
     */
    public String generateRefreshToken(UserDetails user) {
        Map&lt;String, Object&gt; claims = new HashMap&lt;&gt;();
        claims.put("type", "refresh");
        
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("userId", getUserId(user))
            .claims(claims)
            .issuedAt(new Date())
            .expiration(new Date(System.currentTimeMillis() + REFRESH_TOKEN_EXPIRATION))
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
    
    /**
     * 登录时生成双 Token
     */
    public TokenPair generateTokenPair(UserDetails user) {
        return TokenPair.builder()
            .accessToken(generateAccessToken(user))
            .refreshToken(generateRefreshToken(user))
            .tokenType("Bearer")
            .expiresIn(ACCESS_TOKEN_EXPIRATION / 1000)  // 秒
            .build();
    }
}
```

### Token 刷新 API

```java
@RestController
@RequestMapping("/auth")
public class AuthController {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private RefreshTokenService refreshTokenService;
    
    /**
     * 刷新 Token
     */
    @PostMapping("/refresh")
    public Result&lt;TokenPair&gt; refresh(@RequestBody RefreshRequest request) {
        String refreshToken = request.getRefreshToken();
        
        try {
            // 1. 验证 Refresh Token
            Claims claims = jwtService.validateToken(refreshToken);
            
            // 2. 检查 Token 类型
            String type = claims.get("type", String.class);
            if (!"refresh".equals(type)) {
                return Result.fail("无效的 Refresh Token");
            }
            
            // 3. 检查 Token 是否在黑名单
            String jti = claims.getId();
            if (refreshTokenService.isBlacklisted(jti)) {
                return Result.fail("Token 已失效，请重新登录");
            }
            
            // 4. 加载用户信息
            UserDetails user = userDetailsService.loadUserByUsername(claims.getSubject());
            
            // 5. 生成新的 Token Pair
            TokenPair tokenPair = jwtService.generateTokenPair(user);
            
            // 6. 作废旧的 Refresh Token（可选：滑动过期）
            refreshTokenService.blacklist(jti);
            
            return Result.success(tokenPair);
            
        } catch (ExpiredJwtException e) {
            return Result.fail(401, "Refresh Token 已过期，请重新登录");
        } catch (JwtException e) {
            return Result.fail(401, "无效的 Refresh Token");
        }
    }
}
```

---

## 黑名单机制

### 为什么需要黑名单？

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         JWT 黑名单的必要性                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  JWT 的问题：                                                          │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ JWT 是签名的，签发后服务端无法修改                                │   │
│  │                                                                  │   │
│  │ 用户退出登录 ──► 服务端无法让 Token 失效                          │   │
│  │                                                                  │   │
│  │ 用户修改密码 ──► 旧 Token 仍然可以正常使用                       │   │
│  │                                                                  │   │
│  │ 用户被禁用 ──► 旧 Token 仍然可以正常使用                         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  解决方案：黑名单机制                                                   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 验证 Token 时，同时检查黑名单                                     │   │
│  │                                                                  │   │
│  │ 黑名单 = Token ID (jti) 的 Set                                  │   │
│  │                                                                  │   │
│  │ 存储介质：Redis（高并发 + 过期自动清理）                         │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### Redis 黑名单实现

```java
@Service
public class TokenBlacklistService {
    
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;
    
    private static final String BLACKLIST_PREFIX = "jwt:blacklist:";
    
    /**
     * 将 Token 加入黑名单
     */
    public void blacklist(String token) {
        try {
            Claims claims = jwtService.parseClaims(token);
            String jti = claims.getId();
            Date expiration = claims.getExpiration();
            
            // 计算剩余有效期
            long ttl = (expiration.getTime() - System.currentTimeMillis()) / 1000;
            
            if (ttl > 0) {
                // 设置过期时间，自动清理
                redisTemplate.opsForValue().set(
                    BLACKLIST_PREFIX + jti,
                    "1",
                    Duration.ofSeconds(ttl)
                );
            }
        } catch (JwtException e) {
            // Token 解析失败，忽略
        }
    }
    
    /**
     * 检查 Token 是否在黑名单
     */
    public boolean isBlacklisted(String token) {
        try {
            Claims claims = jwtService.parseClaims(token);
            String jti = claims.getId();
            return Boolean.TRUE.equals(
                redisTemplate.hasKey(BLACKLIST_PREFIX + jti)
            );
        } catch (JwtException e) {
            return true;  // 无法解析的 Token 当作黑名单
        }
    }
}
```

### 在过滤器中检查黑名单

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private TokenBlacklistService blacklistService;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) {
        
        String token = extractToken(request);
        
        if (token != null) {
            try {
                Claims claims = jwtService.validateToken(token);
                
                // 检查黑名单
                if (blacklistService.isBlacklisted(token)) {
                    throw new JwtException("Token 已失效");
                }
                
                // 继续认证流程...
                
            } catch (JwtException e) {
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                // ...
                return;
            }
        }
        
        filterChain.doFilter(request, response);
    }
}
```

---

## 退出登录

### 单点退出

```java
@RestController
@RequestMapping("/auth")
public class AuthController {
    
    /**
     * 退出登录（作废当前 Token）
     */
    @PostMapping("/logout")
    public Result&lt;Void&gt; logout(@RequestHeader("Authorization") String authHeader) {
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);
            blacklistService.blacklist(token);
        }
        return Result.success("退出成功");
    }
}
```

### 全设备退出

```java
@RestController
@RequestMapping("/auth")
public class AuthController {
    
    /**
     * 退出所有设备
     */
    @PostMapping("/logout/all")
    public Result&lt;Void&gt; logoutAll(@AuthenticationPrincipal UserDetails user) {
        // 撤销用户所有的 Refresh Token
        refreshTokenService.revokeAllUserTokens(user.getUsername());
        
        // 将所有 Access Token 加入黑名单（需要存储所有 Token）
        tokenService.blacklistAllUserTokens(user.getUsername());
        
        return Result.success("已在所有设备退出登录");
    }
}
```

---

## Refresh Token 存储

### 数据库存储

```sql
-- Refresh Token 存储表
CREATE TABLE refresh_token (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    token_hash VARCHAR(64) NOT NULL UNIQUE COMMENT 'Token 的 SHA-256 哈希',
    user_id BIGINT NOT NULL,
    device_id VARCHAR(100) COMMENT '设备标识',
    issued_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked TINYINT DEFAULT 0 COMMENT '是否已撤销',
    revoked_at DATETIME COMMENT '撤销时间',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    INDEX idx_user_id (user_id),
    INDEX idx_token_hash (token_hash),
    INDEX idx_expires_at (expires_at)
);
```

### Refresh Token 管理服务

```java
@Service
public class RefreshTokenService {
    
    @Autowired
    private RefreshTokenRepository refreshTokenRepository;
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    /**
     * 存储 Refresh Token
     */
    public void storeRefreshToken(String token, Long userId, String deviceId) {
        RefreshToken refreshToken = RefreshToken.builder()
            .tokenHash(hashToken(token))  // 存储哈希，不存储明文
            .userId(userId)
            .deviceId(deviceId)
            .issuedAt(new Date())
            .expiresAt(calculateExpiration(token))
            .build();
        
        refreshTokenRepository.save(refreshToken);
    }
    
    /**
     * 验证 Refresh Token
     */
    public boolean validateRefreshToken(String token) {
        String hash = hashToken(token);
        
        RefreshToken stored = refreshTokenRepository.findByTokenHash(hash);
        
        if (stored == null) {
            return false;
        }
        
        if (stored.getRevoked()) {
            // Token 已被撤销
            return false;
        }
        
        if (stored.getExpiresAt().before(new Date())) {
            // Token 已过期
            return false;
        }
        
        return true;
    }
    
    /**
     * 撤销 Refresh Token
     */
    public void revoke(String token) {
        String hash = hashToken(token);
        refreshTokenRepository.findByTokenHash(hash)
            .ifPresent(rt -> {
                rt.setRevoked(true);
                rt.setRevokedAt(new Date());
                refreshTokenRepository.save(rt);
            });
    }
    
    /**
     * 撤销用户的所有 Refresh Token
     */
    public void revokeAllUserTokens(Long userId) {
        refreshTokenRepository.revokeAllByUserId(userId);
    }
    
    /**
     * 清理过期 Token
     */
    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨3点
    public void cleanupExpiredTokens() {
        refreshTokenRepository.deleteExpiredTokens(new Date());
    }
    
    private String hashToken(String token) {
        return passwordEncoder.encode(token);
    }
    
    private Date calculateExpiration(String token) {
        // 从 Token 中解析过期时间
        return new Date(System.currentTimeMillis() + REFRESH_TOKEN_EXPIRATION);
    }
}
```

---

## 完整的 Token 生命周期

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Token 完整生命周期                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. 登录                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ user.login(username, password)                                   │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ authManager.authenticate()                                       │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ generateTokenPair(user) ──► Access Token + Refresh Token        │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ storeRefreshToken(refreshToken, userId) ──► DB/Redis            │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ return {accessToken, refreshToken}                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  2. 正常使用 Access Token                                               │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ request {Authorization: Bearer accessToken}                       │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ JwtAuthenticationFilter                                          │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ validateToken() + checkBlacklist()                              │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ SecurityContextHolder.setAuthentication()                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  3. Access Token 过期，刷新                                              │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ request {Authorization: Bearer expiredToken}                     │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ 返回 401，客户端使用 Refresh Token 刷新                          │   │
│  │         │                                                        │   │
│  │ POST /auth/refresh {refreshToken}                               │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ validateRefreshToken() ──► 检查是否有效                         │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ revoke(oldRefreshToken) ──► 作废旧 Token                        │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ generateTokenPair(user) ──► 新的 Access + Refresh               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  4. 退出登录                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ POST /auth/logout {Authorization: Bearer token}                  │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ blacklist(token) ──► Redis                                        │   │
│  │         │                                                        │   │
│  │         ▼                                                        │   │
│  │ revokeAllRefreshTokens(userId) ──► DB                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 为什么要使用双 Token？ | 设计理解 | 本篇 |
| 如何实现 Token 黑名单？ | 实战能力 | 本篇 |
| Refresh Token 存在哪里？ | 存储设计 | 本篇 |
| 如何实现全设备退出？ | 进阶能力 | 本篇 |
| 黑名单过多怎么办？ | 性能优化 | Redis |

---

## 总结

JWT 刷新机制的核心要点：

1. **双 Token**：短期 Access Token + 长期 Refresh Token
2. **黑名单**：存储已撤销的 Token ID（jti）
3. **存储位置**：Redis（高并发）或数据库（持久化）
4. **自动清理**：设置过期时间，自动清理过期黑名单
5. **全设备退出**：需要存储所有用户的 Token

JWT 的无状态是相对的——可以通过黑名单机制实现有状态的管理。

---

## 下一步

- 想了解 Token 安全？→ [Token 防盗用：设备指纹 + IP 绑定](/framework/springsecurity/jwt-security)
- 想了解其他安全机制？→ [CSRF 防护机制](/framework/springsecurity/csrf)
- 想了解微服务安全？→ [Gateway 统一鉴权中心](/framework/springsecurity/gateway-auth)
