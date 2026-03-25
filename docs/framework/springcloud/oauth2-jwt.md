# Spring Cloud 统一认证，Spring Security + OAuth2 + JWT

> 微服务时代，用户登录一次，各个服务都能识别你——这怎么实现？
>
> 统一认证，就是来解决这个问题的——一套登录，全网通行。

---

## 从一个问题开始

假设你有这样的场景：

```
┌─────────────────────────────────────────────────────────┐
│                    微服务认证问题                         │
│                                                          │
│  用户 ──► 网关 ──► 订单服务                             │
│           │            │                                │
│           │            │ 需要验证用户身份                │
│           │            ▼                                │
│           │      用户服务（验证 Token）                  │
│           │            │                                │
│           │            │ 需要验证权限                   │
│           │            ▼                                │
│           │      权限服务（查询权限）                   │
│                                                          │
│  问题：每个服务都要验证 Token，太麻烦了！                 │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**统一认证的思路**：把 Token 验证下沉到网关，服务专注于业务逻辑。

---

## OAuth2 协议

### 四种授权模式

| 模式 | 说明 | 适用场景 |
|---|---|---|
| Authorization Code | 授权码模式 | Web 应用（最安全） |
| Implicit | 隐式模式 | SPA 移动端（不推荐） |
| Password Credentials | 密码模式 | 信任的应用 |
| Client Credentials | 客户端模式 | 服务间认证 |

### 微服务场景的授权模式

微服务场景通常使用 **Client Credentials** 或 **Password Credentials** 模式：

```
┌─────────────────────────────────────────────────────────┐
│              Client Credentials 模式                     │
│                                                          │
│  ┌──────────┐    1. Client ID + Secret                │
│  │  服务 A    │ ──────────────────────────────────►   │
│  └──────────┘                                        │
│       │                                               │
│       │    2. Access Token                            │
│       │ ◄──────────────────────────────────────────  │
│       │                                               │
│       │    3. Access Token                            │
│       │ ──────────────────────────────────────────►   │
│       │                                    ┌──────────┐│
│       │                                    │  API    ││
│       │    4. 响应数据                      │  Gateway││
│       │ ◄──────────────────────────────────│  │      │
│       │                                    └──────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## JWT 令牌

### JWT 结构

JWT 由三部分组成，用 `.` 分隔：

```
┌─────────────────────────────────────────────────────────┐
│                    JWT 结构                              │
│                                                          │
│  Header.Payload.Signature                               │
│                                                          │
│  Header: {"alg": "HS256", "typ": "JWT"}                │
│  Payload: {"sub": "user123", "exp": 1704067200, ...} │
│  Signature: HMACSHA256(Header.Payload, secret)         │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Payload 常用字段

| 字段 | 说明 |
|---|---|
| sub | 用户 ID |
| exp | 过期时间 |
| iat | 签发时间 |
| roles | 用户角色 |
| permissions | 用户权限 |
| tenant_id | 租户 ID |

---

## 快速开始：搭建授权服务

### 1. 引入依赖

```xml
<dependencies>
    <!-- Spring Security OAuth2 -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-oauth2-resource-server</artifactId>
    </dependency>
    
    <!-- JWT -->
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
    
    <!-- Redis（存储 Token） -->
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-data-redis</artifactId>
    </dependency>
</dependencies>
```

### 2. 配置文件

```yaml
server:
  port: 8080

spring:
  datasource:
    url: jdbc:mysql://localhost:3306/auth_db
    username: root
    password: root
  
  redis:
    host: localhost
    port: 6379

# JWT 配置
jwt:
  secret: your-256-bit-secret-key-here-must-be-at-least-32-chars
  expiration: 86400000  # 24 小时
  issuer: auth-service
```

### 3. UserDetailsService 实现

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserMapper userMapper;
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在");
        }
        
        // 获取用户权限
        List&lt;String&gt; permissions = permissionMapper.findByUserId(user.getId());
        
        return new CustomUserDetails(user, permissions);
    }
}

@Data
public class CustomUserDetails implements UserDetails {
    private Long id;
    private String username;
    private String password;
    private boolean enabled;
    private List&lt;String&gt; permissions;
    
    @Override
    public Collection&lt;? extends GrantedAuthority&gt; getAuthorities() {
        return permissions.stream()
            .map(SimpleGrantedAuthority::new)
            .collect(Collectors.toList());
    }
    
    @Override
    public boolean isAccountNonExpired() { return true; }
    
    @Override
    public boolean isAccountNonLocked() { return true; }
    
    @Override
    public boolean isCredentialsNonExpired() { return true; }
    
    @Override
    public boolean isEnabled() { return enabled; }
}
```

### 4. JWT 工具类

```java
@Component
public class JwtTokenProvider {
    
    @Value("${jwt.secret}")
    private String jwtSecret;
    
    @Value("${jwt.expiration}")
    private long jwtExpiration;
    
    @Value("${jwt.issuer}")
    private String jwtIssuer;
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    /**
     * 生成 Token
     */
    public String generateToken(String username) {
        CustomUserDetails userDetails = (CustomUserDetails) 
            userDetailsService.loadUserByUsername(username);
        
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + jwtExpiration);
        
        return Jwts.builder()
            .setSubject(username)
            .setIssuer(jwtIssuer)
            .claim("userId", userDetails.getId())
            .claim("roles", userDetails.getAuthorities())
            .setIssuedAt(now)
            .setExpiration(expiryDate)
            .signWith(Keys.hmacShaKeyFor(jwtSecret.getBytes()), SignatureAlgorithm.HS256)
            .compact();
    }
    
    /**
     * 验证 Token
     */
    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(Keys.hmacShaKeyFor(jwtSecret.getBytes()))
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (JwtException | IllegalArgumentException e) {
            return false;
        }
    }
    
    /**
     * 获取用户名
     */
    public String getUsernameFromToken(String token) {
        Claims claims = Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(jwtSecret.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody();
        return claims.getSubject();
    }
    
    /**
     * 获取用户 ID
     */
    public Long getUserIdFromToken(String token) {
        Claims claims = Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(jwtSecret.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody();
        return claims.get("userId", Long.class);
    }
}
```

### 5. 认证接口

```java
@RestController
@RequestMapping("/auth")
@Slf4j
public class AuthController {
    
    @Autowired
    private AuthenticationManager authenticationManager;
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    /**
     * 用户登录
     */
    @PostMapping("/login")
    public Result&lt;LoginResponse&gt; login(@RequestBody @Valid LoginRequest request) {
        // 1. 验证用户名密码
        Authentication authentication = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.getUsername(),
                request.getPassword()
            )
        );
        
        // 2. 生成 Token
        String token = tokenProvider.generateToken(request.getUsername());
        
        // 3. 获取用户信息
        CustomUserDetails userDetails = (CustomUserDetails) 
            userDetailsService.loadUserByUsername(request.getUsername());
        
        return Result.ok(new LoginResponse(token, "Bearer", 86400, userDetails));
    }
    
    /**
     * 刷新 Token
     */
    @PostMapping("/refresh")
    public Result&lt;String&gt; refreshToken(@RequestHeader("Authorization") String authHeader) {
        String token = authHeader.substring(7);
        if (tokenProvider.validateToken(token)) {
            String username = tokenProvider.getUsernameFromToken(token);
            String newToken = tokenProvider.generateToken(username);
            return Result.ok(newToken);
        }
        return Result.fail(401, "Token 无效");
    }
}
```

### 6. Spring Security 配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private JwtAuthenticationFilter jwtAuthenticationFilter;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .sessionManagement()
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            .and()
            .authorizeRequests()
                .antMatchers("/auth/login", "/auth/register", "/health").permitAll()
                .anyRequest().authenticated()
            .and()
            .addFilterBefore(jwtAuthenticationFilter, 
                UsernamePasswordAuthenticationFilter.class);
        
        return http.build();
    }
    
    @Bean
    public AuthenticationManager authenticationManager(
            AuthenticationManagerBuilder auth) throws Exception {
        return auth
            .userDetailsService(userDetailsService)
            .passwordEncoder(passwordEncoder())
            .and()
            .build();
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
```

### 7. JWT 认证过滤器

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        String token = getTokenFromRequest(request);
        
        if (StringUtils.hasText(token) && tokenProvider.validateToken(token)) {
            String username = tokenProvider.getUsernameFromToken(token);
            UserDetails userDetails = userDetailsService.loadUserByUsername(username);
            
            UsernamePasswordAuthenticationToken authentication = 
                new UsernamePasswordAuthenticationToken(
                    userDetails, 
                    null, 
                    userDetails.getAuthorities()
                );
            authentication.setDetails(
                new WebAuthenticationDetailsSource().buildDetails(request)
            );
            
            SecurityContextHolder.getContext().setAuthentication(authentication);
        }
        
        filterChain.doFilter(request, response);
    }
    
    private String getTokenFromRequest(HttpServletRequest request) {
        String bearerToken = request.getHeader("Authorization");
        if (StringUtils.hasText(bearerToken) && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
}
```

---

## 网关集成

### 网关配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: auth-service
          uri: lb://auth-service
          predicates:
            - Path=/auth/**
        
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
```

### 全局认证过滤器

```java
@Component
@Slf4j
public class JwtAuthenticationGlobalFilter implements GlobalFilter {
    
    @Autowired
    private JwtTokenProvider tokenProvider;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String path = exchange.getRequest().getURI().getPath();
        
        // 跳过登录接口
        if (path.startsWith("/auth/")) {
            return chain.filter(exchange);
        }
        
        String token = getToken(exchange);
        
        if (StringUtils.hasText(token)) {
            try {
                if (tokenProvider.validateToken(token)) {
                    // 验证通过，添加用户信息到请求头
                    String username = tokenProvider.getUsernameFromToken(token);
                    Long userId = tokenProvider.getUserIdFromToken(token);
                    
                    ServerHttpRequest mutatedRequest = exchange.getRequest().mutate()
                        .header("X-User-Id", userId.toString())
                        .header("X-Username", username)
                        .build();
                    
                    return chain.filter(
                        exchange.mutate().request(mutatedRequest).build()
                    );
                }
            } catch (Exception e) {
                log.error("Token 验证失败", e);
            }
        }
        
        // Token 无效，返回 401
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        return response.setComplete();
    }
}
```

---

## 服务间认证

### Feign 传递 Token

```java
@Configuration
public class FeignConfig {
    
    @Autowired
    private HttpServletRequest request;
    
    @Bean
    public RequestInterceptor requestInterceptor() {
        return template -> {
            // 从请求头获取 Token
            String token = request.getHeader("Authorization");
            if (StringUtils.hasText(token)) {
                template.header("Authorization", token);
            }
        };
    }
}
```

### 服务内部调用

```java
@Service
public class InternalAuthService {
    
    /**
     * 生成内部服务调用的 Token
     */
    public String generateServiceToken(String serviceName) {
        Map&lt;String, Object&gt; claims = new HashMap&lt;&gt;();
        claims.put("service", serviceName);
        claims.put("type", "service");
        
        Date now = new Date();
        return Jwts.builder()
            .setClaims(claims)
            .setIssuedAt(now)
            .setExpiration(new Date(now.getTime() + 3600000))  // 1 小时
            .signWith(Keys.hmacShaKeyFor(serviceSecret.getBytes()), 
                SignatureAlgorithm.HS256)
            .compact();
    }
}
```

---

## Token 管理

### Redis 存储 Token

```java
@Service
public class TokenStore {
    
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;
    
    private static final String TOKEN_PREFIX = "auth:token:";
    private static final long DEFAULT_EXPIRE = 86400;  // 24 小时
    
    public void storeToken(String userId, String token) {
        String key = TOKEN_PREFIX + userId;
        redisTemplate.opsForValue().set(key, token, DEFAULT_EXPIRE, TimeUnit.SECONDS);
    }
    
    public boolean validateToken(String userId, String token) {
        String key = TOKEN_PREFIX + userId;
        String storedToken = redisTemplate.opsForValue().get(key);
        return token.equals(storedToken);
    }
    
    public void removeToken(String userId) {
        String key = TOKEN_PREFIX + userId;
        redisTemplate.delete(key);
    }
}
```

---

## 面试高频问题

### Q：OAuth2 和 JWT 是什么关系？

A：OAuth2 是**授权协议**，定义了如何获取访问令牌。JWT 是**令牌格式**，是一种自包含的令牌。OAuth2 可以使用 JWT 作为令牌实现。

### Q：Token 存在 Redis 和存在本地有什么区别？

A：**存在 Redis** 支持令牌失效（踢人下线），适合需要强制登出的场景。**存在本地**性能更好，但无法主动失效。

### Q：如何实现 Token 续期？

A：通常使用 **Refresh Token** 机制。Access Token 有效期短（如 1 小时），Refresh Token 有效期长（如 7 天）。Access Token 过期后，用 Refresh Token 换取新的 Access Token。

### Q：微服务间如何传递认证信息？

A：通过请求头传递 Token，或者使用服务间专用的 Token。Feign 可以配置拦截器自动传递 Token。

---

## 总结

统一认证方案的核心组件：

1. **OAuth2 协议**：标准授权框架
2. **JWT 令牌**：自包含的安全令牌
3. **Spring Security**：安全框架
4. **网关认证**：统一认证入口
5. **Redis TokenStore**：Token 管理

> 统一认证让微服务安全变得简单。把安全下沉到网关，服务专注于业务逻辑。
