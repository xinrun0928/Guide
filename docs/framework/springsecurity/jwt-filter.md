# JWT 无状态认证流程设计：过滤器链集成

你有没有想过，JWT 无状态认证到底是怎么工作的？

它和 Session 认证的核心区别是什么？如何在 Spring Security 的过滤器链中集成 JWT？

今天，我们就来深入了解 JWT 无状态认证的完整流程设计。

---

## Session vs JWT：核心区别

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Session vs JWT 对比                                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Session 认证：                                                         │
│                                                                          │
│  用户 ──► 登录 ──► Server 创建 Session ──► 返回 JSESSIONID              │
│              │                                                          │
│              ▼                                                          │
│  后续请求携带 JSESSIONID                                                │
│              │                                                          │
│              ▼                                                          │
│  Server 根据 JSESSIONID 查找 Session ──► 验证权限                       │
│                                                                          │
│  问题：                                                                  │
│  1. Session 存储在服务端，内存压力                                       │
│  2. 分布式环境下需要 Session 同步                                        │
│  3. 扩展困难                                                            │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────   │
│                                                                          │
│  JWT 认证：                                                             │
│                                                                          │
│  用户 ──► 登录 ──► Server 生成 JWT ──► 返回 Token                       │
│              │                                                          │
│              ▼                                                          │
│  后续请求携带 Authorization: Bearer Token                               │
│              │                                                          │
│              ▼                                                          │
│  Server 验证 JWT 签名 ──► 解析 Claims ──► 验证权限                      │
│              │                                                          │
│              ▼                                                          │
│  不需要存储！服务端无状态                                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## JWT 认证过滤器设计

### 核心组件

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     JWT 认证过滤器链                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ JwtAuthenticationFilter                                          │   │
│  │                                                                 │   │
│  │ 1. 从请求头提取 Token                                           │   │
│  │ 2. 验证 Token                                                   │   │
│  │ 3. 解析用户信息                                                 │   │
│  │ 4. 构造 Authentication                                          │   │
│  │ 5. 设置到 SecurityContext                                       │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### JwtAuthenticationFilter 实现

```java
/**
 * JWT 认证过滤器
 * 
 * 核心职责：从请求中提取 JWT，验证并转换为 Authentication
 */
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private UserDetailsService userDetailsService;
    
    private static final String AUTHORIZATION_HEADER = "Authorization";
    private static final String BEARER_PREFIX = "Bearer ";
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) 
        throws ServletException, IOException {
        
        // 1. 从请求头提取 Token
        String token = extractToken(request);
        
        if (token != null) {
            try {
                // 2. 验证并解析 Token
                Claims claims = jwtService.validateToken(token);
                
                // 3. 获取用户名
                String username = claims.getSubject();
                
                // 4. 如果当前没有认证
                if (username != null && 
                    SecurityContextHolder.getContext().getAuthentication() == null) {
                    
                    // 5. 加载用户详情
                    UserDetails userDetails = userDetailsService
                        .loadUserByUsername(username);
                    
                    // 6. 验证 Token 类型
                    String tokenType = claims.get("type", String.class);
                    if (!"access".equals(tokenType)) {
                        throw new JwtException("Invalid token type");
                    }
                    
                    // 7. 构造 Authentication
                    UsernamePasswordAuthenticationToken authentication =
                        new UsernamePasswordAuthenticationToken(
                            userDetails,
                            null,
                            userDetails.getAuthorities()
                        );
                    
                    // 8. 设置详情
                    authentication.setDetails(
                        new WebAuthenticationDetailsSource().buildDetails(request)
                    );
                    
                    // 9. 设置到 SecurityContext
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch (ExpiredJwtException e) {
                // Token 过期处理
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json");
                response.getWriter().write("{\"code\": 401, \"message\": \"Token 已过期\"}");
                return;
            } catch (JwtException e) {
                // Token 无效处理
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                response.setContentType("application/json");
                response.getWriter().write("{\"code\": 401, \"message\": \"Token 无效\"}");
                return;
            }
        }
        
        // 10. 继续过滤器链
        filterChain.doFilter(request, response);
    }
    
    /**
     * 从请求头提取 Token
     */
    private String extractToken(HttpServletRequest request) {
        String bearerToken = request.getHeader(AUTHORIZATION_HEADER);
        
        if (bearerToken != null && bearerToken.startsWith(BEARER_PREFIX)) {
            return bearerToken.substring(BEARER_PREFIX.length());
        }
        
        return null;
    }
}
```

---

## Spring Security 配置

### 安全配置

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {
    
    @Autowired
    private JwtAuthenticationFilter jwtAuthenticationFilter;
    
    @Autowired
    private JwtAuthenticationEntryPoint jwtAuthenticationEntryPoint;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 Session（无状态）
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
            )
            
            // 配置授权规则
            .authorizeHttpRequests(auth -> auth
                // 公开接口
                .requestMatchers("/auth/login", "/auth/register").permitAll()
                .requestMatchers("/auth/refresh").permitAll()
                
                // Swagger / API 文档
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll()
                
                // 需要认证的接口
                .requestMatchers("/api/**").authenticated()
                
                // 其他请求需要认证
                .anyRequest().authenticated()
            )
            
            // 添加 JWT 过滤器（在 UsernamePasswordAuthenticationFilter 之前）
            .addFilterBefore(jwtAuthenticationFilter, 
                UsernamePasswordAuthenticationFilter.class)
            
            // 异常处理
            .exceptionHandling(exception -> exception
                .authenticationEntryPoint(jwtAuthenticationEntryPoint)
            )
            
            // 禁用 CSRF（JWT 无状态场景）
            .csrf(csrf -> csrf.disable())
            
            // 禁用 CORS（统一在 Filter 中处理）
            .cors(cors -> cors.disable());
        
        return http.build();
    }
}
```

### 认证入口点

```java
/**
 * 认证入口点：当用户未认证时，统一返回 401
 */
@Component
public class JwtAuthenticationEntryPoint implements AuthenticationEntryPoint {
    
    @Override
    public void commence(HttpServletRequest request,
                        HttpServletResponse response,
                        AuthenticationException authException) throws IOException {
        
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        
        Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
        result.put("code", 401);
        result.put("message", "未认证，请先登录");
        result.put("path", request.getRequestURI());
        
        response.getWriter().write(new ObjectMapper().writeValueAsString(result));
    }
}
```

---

## 登录与 Token 生成

### 登录 Controller

```java
@RestController
@RequestMapping("/auth")
public class AuthController {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private AuthenticationManager authenticationManager;
    
    /**
     * 用户登录
     */
    @PostMapping("/login")
    public Result&lt;LoginResponse&gt; login(@RequestBody LoginRequest request) {
        // 1. 认证（验证用户名密码）
        Authentication authentication = authenticationManager.authenticate(
            new UsernamePasswordAuthenticationToken(
                request.getUsername(),
                request.getPassword()
            )
        );
        
        // 2. 获取用户信息
        UserDetails userDetails = (UserDetails) authentication.getPrincipal();
        
        // 3. 生成 Token
        String accessToken = jwtService.generateAccessToken(userDetails);
        String refreshToken = jwtService.generateRefreshToken(userDetails);
        
        // 4. 返回结果
        return Result.success(LoginResponse.builder()
            .accessToken(accessToken)
            .refreshToken(refreshToken)
            .tokenType("Bearer")
            .expiresIn(3600)
            .username(userDetails.getUsername())
            .build());
    }
    
    /**
     * 刷新 Token
     */
    @PostMapping("/refresh")
    public Result&lt;LoginResponse&gt; refresh(@RequestBody RefreshRequest request) {
        // 1. 验证 Refresh Token
        Claims claims = jwtService.validateToken(request.getRefreshToken());
        
        // 2. 检查类型
        if (!"refresh".equals(claims.get("type"))) {
            return Result.fail("无效的 Refresh Token");
        }
        
        // 3. 加载用户信息
        UserDetails userDetails = userDetailsService
            .loadUserByUsername(claims.getSubject());
        
        // 4. 生成新的 Access Token
        String newAccessToken = jwtService.generateAccessToken(userDetails);
        
        // 5. 可选：生成新的 Refresh Token（滑动过期）
        String newRefreshToken = jwtService.generateRefreshToken(userDetails);
        
        return Result.success(LoginResponse.builder()
            .accessToken(newAccessToken)
            .refreshToken(newRefreshToken)
            .tokenType("Bearer")
            .expiresIn(3600)
            .build());
    }
}
```

---

## 完整认证流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       JWT 无状态认证完整流程                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         登录流程                                   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  用户 ──► POST /auth/login {username, password}                        │
│                  │                                                      │
│                  ▼                                                      │
│          AuthenticationManager.authenticate()                           │
│                  │                                                      │
│                  ▼                                                      │
│          UserDetailsService.loadUserByUsername()                        │
│                  │                                                      │
│                  ▼                                                      │
│          PasswordEncoder.matches() 验证密码                              │
│                  │                                                      │
│                  ▼                                                      │
│          验证成功 ──► 生成 Access Token + Refresh Token                 │
│                  │                                                      │
│                  ▼                                                      │
│          返回给前端 {accessToken, refreshToken}                         │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         请求认证流程                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  用户 ──► GET /api/user {Authorization: Bearer xxx}                   │
│                  │                                                      │
│                  ▼                                                      │
│          JwtAuthenticationFilter.doFilter()                             │
│                  │                                                      │
│                  ▼                                                      │
│          提取 Token                                                      │
│                  │                                                      │
│                  ▼                                                      │
│          JWT 签名验证                                                   │
│                  │                                                      │
│                  ▼                                                      │
│          Claims 解析                                                    │
│                  │                                                      │
│                  ▼                                                      │
│          Token 类型检查（access/refresh）                               │
│                  │                                                      │
│                  ▼                                                      │
│          用户名获取 ──► UserDetailsService.loadUserByUsername()         │
│                  │                                                      │
│                  ▼                                                      │
│          构造 UsernamePasswordAuthenticationToken                      │
│                  │                                                      │
│                  ▼                                                      │
│          SecurityContextHolder.setAuthentication()                      │
│                  │                                                      │
│                  ▼                                                      │
│          后续 Filter 正常处理                                           │
│                  │                                                      │
│                  ▼                                                      │
│          Controller 获取当前用户 (@AuthenticationPrincipal)             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 多端登录与 Token 管理

### Token 存储

```java
@Service
public class TokenManagementService {
    
    // Token 到用户信息的映射（可存储到 Redis）
    private final Map&lt;String, TokenInfo&gt; tokenStore = new ConcurrentHashMap&lt;&gt;();
    
    /**
     * 存储 Token
     */
    public void storeToken(String token, TokenInfo info) {
        Claims claims = jwtService.validateToken(token);
        String jti = claims.getId();  // Token 唯一 ID
        
        TokenInfo tokenInfo = TokenInfo.builder()
            .jti(jti)
            .userId(info.getUserId())
            .username(info.getUsername())
            .deviceId(info.getDeviceId())
            .loginTime(new Date())
            .expiresAt(claims.getExpiration())
            .build();
        
        tokenStore.put(jti, tokenInfo);
    }
    
    /**
     * 验证 Token 是否有效
     */
    public boolean isTokenValid(String token) {
        try {
            Claims claims = jwtService.validateToken(token);
            String jti = claims.getId();
            return tokenStore.containsKey(jti);
        } catch (JwtException e) {
            return false;
        }
    }
    
    /**
     * 撤销 Token
     */
    public void revokeToken(String token) {
        try {
            Claims claims = jwtService.validateToken(token);
            String jti = claims.getId();
            tokenStore.remove(jti);
        } catch (JwtException e) {
            // Token 无效，忽略
        }
    }
    
    /**
     * 撤销用户的所有 Token（退出所有设备）
     */
    public void revokeAllUserTokens(Long userId) {
        tokenStore.entrySet().removeIf(
            entry -> userId.equals(entry.getValue().getUserId())
        );
    }
}
```

---

## 常见问题处理

### 问题一：Token 放在哪里？

```java
// 方式一：放在 Authorization Header（推荐）
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...

// 方式二：放在 Cookie
Cookie: token=eyJhbGciOiJIUzI1NiIs...

// 方式三：放在请求参数（不推荐，不安全）
GET /api/user?token=eyJhbGciOiJIUzI1NiIs...
```

### 问题二：如何获取当前用户？

```java
@RestController
@RequestMapping("/api/user")
public class UserController {
    
    // 方式一：通过 SecurityContext
    @GetMapping("/me")
    public UserInfo getCurrentUser1() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        String username = auth.getName();
        return userService.findByUsername(username);
    }
    
    // 方式二：通过 @AuthenticationPrincipal
    @GetMapping("/profile")
    public UserInfo getCurrentUser2(
            @AuthenticationPrincipal UserDetails user) {
        return userService.findByUsername(user.getUsername());
    }
    
    // 方式三：通过 @Principal
    @GetMapping("/info")
    public UserInfo getCurrentUser3(Principal principal) {
        return userService.findByUsername(principal.getName());
    }
}
```

### 问题三：如何处理 Token 过期？

```java
// 客户端收到 401 后，使用 Refresh Token 换取新的 Access Token
@PostMapping("/auth/refresh")
public Result&lt;TokenResponse&gt; refresh(@RequestBody RefreshRequest request) {
    // 验证 Refresh Token
    // 生成新的 Access Token
    // 返回新的 Token
}

// 前端代码示例
async function fetchWithRetry(url, options, maxRetries = 3) {
    const response = await fetch(url, options);
    
    if (response.status === 401) {
        // Token 过期，尝试刷新
        const refreshResponse = await fetch('/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refreshToken: getRefreshToken() })
        });
        
        if (refreshResponse.ok) {
            const { accessToken } = await refreshResponse.json();
            setAccessToken(accessToken);
            // 重试原请求
            return fetch(url, {
                ...options,
                headers: { ...options.headers, 'Authorization': `Bearer ${accessToken}` }
            });
        }
    }
    
    return response;
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| JWT 认证的完整流程是什么？ | 流程理解 | 本篇 |
| JWT 过滤器放在过滤器链的哪个位置？ | 配置理解 | 过滤器链 |
| JWT 无状态认证的优缺点？ | 设计理解 | 本篇 |
| 如何处理 Token 过期？ | 实战能力 | 本篇 |
| 如何实现 Token 撤销？ | 进阶能力 | JWT 刷新 |

---

## 总结

JWT 无状态认证的核心要点：

1. **核心思想**：服务端不存储 Token，Token 本身包含认证信息
2. **过滤器链**：JwtAuthenticationFilter 负责解析 Token 并设置 SecurityContext
3. **Session 管理**：设置 `SessionCreationPolicy.STATELESS`
4. **CSRF 处理**：无状态场景下可以禁用 CSRF
5. **异常处理**：统一返回 401 JSON 响应

JWT 认证特别适合前后端分离和微服务架构。

---

## 下一步

- 想了解 Token 刷新机制？→ [JWT 刷新机制与黑名单注销](/framework/springsecurity/jwt-refresh)
- 想了解 Token 安全？→ [Token 防盗用：设备指纹 + IP 绑定](/framework/springsecurity/jwt-security)
- 想了解其他安全机制？→ [CSRF 防护机制](/framework/springsecurity/csrf)
