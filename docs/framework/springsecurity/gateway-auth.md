# Security 与微服务：Gateway 统一鉴权中心

你有没有想过这个问题：微服务架构下，每个服务都要做认证授权吗？

如果每个服务都独立做认证，会有什么问题？

今天，我们就来深入了解微服务架构下的统一鉴权中心设计方案。

---

## 微服务认证的挑战

### 独立认证的问题

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    微服务独立认证的问题                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  方案：每个微服务独立做认证                                              │
│                                                                          │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐        │
│  │用户服务 │      │订单服务 │      │商品服务 │      │支付服务 │        │
│  └────┬────┘      └────┬────┘      └────┬────┘      └────┬────┘        │
│       │                 │                 │                 │             │
│       ▼                 ▼                 ▼                 ▼             │
│  ┌─────────┐      ┌─────────┐      ┌─────────┐      ┌─────────┐        │
│  │认证逻辑 │      │认证逻辑 │      │认证逻辑 │      │认证逻辑 │        │
│  └─────────┘      └─────────┘      └─────────┘      └─────────┘        │
│                                                                          │
│  问题：                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. 代码重复：每个服务都要复制一套认证逻辑                       │   │
│  │ 2. 维护困难：认证逻辑变更需要修改所有服务                       │   │
│  │ 3. 性能问题：每个服务都要连接用户数据库                         │   │
│  │ 4. 安全风险：认证逻辑可能不一致                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 统一鉴权中心的优势

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    统一鉴权中心的优势                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  方案：网关层统一认证，微服务专注业务                                    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         Gateway                                │   │
│  │                                                                  │   │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │   │
│  │  │ 统一认证    │    │ 统一鉴权    │    │ Token 验证  │       │   │
│  │  └─────────────┘    └─────────────┘    └─────────────┘       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│       │                      │                      │                    │
│       ▼                      ▼                      ▼                    │
│  ┌─────────┐           ┌─────────┐           ┌─────────┐                │
│  │用户服务 │           │订单服务 │           │商品服务 │                │
│  │(无认证) │           │(无认证) │           │(无认证) │                │
│  └─────────┘           └─────────┘           └─────────┘                │
│                                                                          │
│  优势：                                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. 代码复用：认证逻辑只维护一份                                   │   │
│  │ 2. 性能优化：用户信息缓存，减少数据库查询                       │   │
│  │ 3. 安全可控：认证策略统一管理                                   │   │
│  │ 4. 架构清晰：微服务专注业务，网关专注安全                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 网关鉴权架构设计

### 整体架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        网关统一鉴权架构                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                        外部请求                                    │   │
│  └────────────────────────────┬───────────────────────────────────┘   │
│                                 │                                        │
│                                 ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         Spring Cloud Gateway                     │   │
│  │                                                                  │   │
│  │  ┌────────────────┐    ┌────────────────┐    ┌────────────┐ │   │
│  │  │ 路由转发       │    │ 统一认证       │    │ Token 验证  │ │   │
│  │  │                │───►│                │───►│              │ │   │
│  │  │ Dynamic Route │    │ LoginFilter    │    │ JwtFilter   │ │   │
│  │  └────────────────┘    └────────────────┘    └────────────┘ │   │
│  │                                                                  │   │
│  │  ┌────────────────┐    ┌────────────────┐    ┌────────────┐ │   │
│  │  │ 限流熔断       │    │ 统一鉴权       │    │ 审计日志    │ │   │
│  │  │                │    │                │    │              │ │   │
│  │  │ RateLimiter    │    │ AuthorityFilter │    │ AuditLog    │ │   │
│  │  └────────────────┘    └────────────────┘    └────────────┘ │   │
│  │                                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                 │                                        │
│        ┌────────────┬───────────┴────────────┬────────────┐           │
│        │            │                        │            │            │
│        ▼            ▼                        ▼            ▼            │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐                 │
│  │用户服务  │  │订单服务  │  │商品服务  │  │支付服务  │                 │
│  │         │  │         │  │         │  │         │                 │
│  │ /user/**│  │/order/**│  │/product**│  │/pay/** │                 │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 请求流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        请求鉴权完整流程                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. 请求到达网关                                                        │
│                                                                          │
│  2. Dynamic Route：路由匹配                                            │
│     /api/user/**  → user-service                                       │
│     /api/order/** → order-service                                      │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  3. LoginFilter：认证检查                                              │
│                                                                          │
│     ┌──────────────────────────────────────────────────────────────┐   │
│     │  如果是登录请求：                                            │   │
│     │       - 验证用户名密码                                        │   │
│     │       - 生成 Token                                            │   │
│     │       - 返回 Token                                            │   │
│     └──────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  4. JwtFilter：Token 验证                                              │
│                                                                          │
│     ┌──────────────────────────────────────────────────────────────┐   │
│     │  从请求头提取 Token                                           │   │
│     │       Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6...   │   │
│     │                                                                  │   │
│     │  验证 Token：                                                 │   │
│     │       - 签名验证                                                │   │
│     │       - 过期检查                                               │   │
│     │       - 黑名单检查                                             │   │
│     │                                                                  │   │
│     │  解析用户信息：                                                │   │
│     │       - userId                                                 │   │
│     │       - roles                                                   │   │
│     │       - permissions                                             │   │
│     │                                                                  │   │
│     │  将用户信息传递给下游服务                                       │   │
│     │       - Header: X-User-Id                                      │   │
│     │       - Header: X-User-Roles                                   │   │
│     └──────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  5. AuthorityFilter：权限检查                                           │
│                                                                          │
│     ┌──────────────────────────────────────────────────────────────┐   │
│     │  检查请求路径需要的权限                                         │   │
│     │       /api/user/delete → 需要 USER_DELETE                    │   │
│     │                                                                  │   │
│     │  检查用户是否拥有该权限                                         │   │
│     │       用户权限列表是否包含 USER_DELETE                        │   │
│     │                                                                  │   │
│     │  权限不足 → 返回 403                                           │   │
│     └──────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  6. 路由转发到下游服务                                                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Gateway 过滤器实现

### 1. JwtAuthenticationFilter

```java
@Component
public class JwtAuthenticationFilter implements GlobalFilter, Ordered {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private WhiteListService whiteListService;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getURI().getPath();
        
        // 1. 白名单检查（放行）
        if (whiteListService.isWhite(path)) {
            return chain.filter(exchange);
        }
        
        // 2. 获取 Token
        String token = extractToken(request);
        if (token == null) {
            return unauthorized(exchange, "未提供认证 Token");
        }
        
        try {
            // 3. 验证 Token
            Claims claims = jwtService.validateToken(token);
            
            // 4. 检查黑名单
            if (jwtService.isBlacklisted(token)) {
                return unauthorized(exchange, "Token 已失效");
            }
            
            // 5. 解析用户信息
            String userId = claims.getSubject();
            List&lt;String&gt; roles = claims.get("roles", List.class);
            List&lt;String&gt; permissions = claims.get("permissions", List.class);
            
            // 6. 构建新的请求，传递用户信息
            ServerHttpRequest modifiedRequest = request.mutate()
                .header("X-User-Id", userId)
                .header("X-User-Roles", String.join(",", roles))
                .header("X-User-Permissions", String.join(",", permissions))
                .build();
            
            return chain.filter(exchange.mutate().request(modifiedRequest).build());
            
        } catch (ExpiredJwtException e) {
            return unauthorized(exchange, "Token 已过期");
        } catch (JwtException e) {
            return unauthorized(exchange, "无效的 Token");
        }
    }
    
    private String extractToken(ServerHttpRequest request) {
        String bearerToken = request.getHeaders().getFirst("Authorization");
        if (bearerToken != null && bearerToken.startsWith("Bearer ")) {
            return bearerToken.substring(7);
        }
        return null;
    }
    
    private Mono&lt;Void&gt; unauthorized(ServerWebExchange exchange, String message) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.UNAUTHORIZED);
        response.getHeaders().add("Content-Type", "application/json");
        String body = String.format("{\"code\": 401, \"message\": \"%s\"}", message);
        return response.writeWith(Mono.just(response.bufferFactory().wrap(body.getBytes())));
    }
    
    @Override
    public int getOrder() {
        return -100;  // 优先级高，较早执行
    }
}
```

### 2. AuthorityFilter

```java
@Component
public class AuthorityFilter implements GlobalFilter, Ordered {
    
    @Autowired
    private PermissionService permissionService;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        ServerHttpRequest request = exchange.getRequest();
        String path = request.getURI().getPath();
        String method = request.getMethod().name();
        
        // 1. 获取用户权限
        String permissions = request.getHeaders().getFirst("X-User-Permissions");
        if (permissions == null) {
            // 未认证，由 JwtAuthenticationFilter 处理
            return chain.filter(exchange);
        }
        
        // 2. 查询该路径需要的权限
        String requiredPermission = permissionService.getRequiredPermission(path, method);
        if (requiredPermission == null) {
            // 该路径不需要权限检查
            return chain.filter(exchange);
        }
        
        // 3. 检查用户是否有权限
        List&lt;String&gt; userPermissions = Arrays.asList(permissions.split(","));
        if (!userPermissions.contains(requiredPermission)) {
            return forbidden(exchange, "权限不足");
        }
        
        return chain.filter(exchange);
    }
    
    private Mono&lt;Void&gt; forbidden(ServerWebExchange exchange, String message) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.FORBIDDEN);
        response.getHeaders().add("Content-Type", "application/json");
        String body = String.format("{\"code\": 403, \"message\": \"%s\"}", message);
        return response.writeWith(Mono.just(response.bufferFactory().wrap(body.getBytes())));
    }
    
    @Override
    public int getOrder() {
        return -90;  // 在 JwtAuthenticationFilter 之后执行
    }
}
```

### 3. RateLimiterFilter（限流）

```java
@Component
public class RateLimiterFilter implements GlobalFilter, Ordered {
    
    @Autowired
    private RedisRateLimiter rateLimiter;
    
    @Override
    public Mono&lt;Void&gt; filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        String userId = exchange.getRequest().getHeaders().getFirst("X-User-Id");
        String key = userId != null ? userId : exchange.getRequest().getRemoteAddress();
        
        return rateLimiter.isAllowed(key, "100").flatMap(allowed -> {
            if (allowed) {
                return chain.filter(exchange);
            }
            return tooManyRequests(exchange);
        });
    }
    
    private Mono&lt;Void&gt; tooManyRequests(ServerWebExchange exchange) {
        ServerHttpResponse response = exchange.getResponse();
        response.setStatusCode(HttpStatus.TOO_MANY_REQUESTS);
        response.getHeaders().add("Content-Type", "application/json");
        String body = "{\"code\": 429, \"message\": \"请求过于频繁，请稍后再试\"}";
        return response.writeWith(Mono.just(response.bufferFactory().wrap(body.getBytes())));
    }
    
    @Override
    public int getOrder() {
        return -80;
    }
}
```

---

## 配置文件

### application.yml

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: user-service
          uri: lb://user-service
          predicates:
            - Path=/api/user/**
          filters:
            - StripPrefix=1
            - name: RequestRateLimiter
              args:
                redis-rate-limiter.replenishRate: 100
                redis-rate-limiter.burstCapacity: 200
        
        - id: order-service
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - StripPrefix=1
        
        - id: auth-service
          uri: lb://auth-service
          predicates:
            - Path=/auth/**
      
      default-filters:
        - DedupeResponseHeader=Access-Control-Allow-Origin Access-Control-Allow-CREDENTIALS
```

---

## 微服务端获取用户信息

### UserContext

```java
public class UserContext {
    
    private static final ThreadLocal&lt;UserInfo&gt; userInfoHolder = new ThreadLocal&lt;&gt;();
    
    public static void setUser(UserInfo user) {
        userInfoHolder.set(user);
    }
    
    public static UserInfo getUser() {
        return userInfoHolder.get();
    }
    
    public static Long getUserId() {
        UserInfo user = getUser();
        return user != null ? user.getUserId() : null;
    }
    
    public static void clear() {
        userInfoHolder.remove();
    }
}

@Data
@Builder
public class UserInfo {
    private Long userId;
    private String username;
    private List&lt;String&gt; roles;
    private List&lt;String&gt; permissions;
}
```

### 微服务拦截器

```java
@Component
public class UserContextInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response, 
                            Object handler) {
        
        String userId = request.getHeader("X-User-Id");
        String roles = request.getHeader("X-User-Roles");
        String permissions = request.getHeader("X-User-Permissions");
        
        if (userId != null) {
            UserInfo userInfo = UserInfo.builder()
                .userId(Long.parseLong(userId))
                .roles(Arrays.asList(roles.split(",")))
                .permissions(Arrays.asList(permissions.split(",")))
                .build();
            
            UserContext.setUser(userInfo);
        }
        
        return true;
    }
    
    @Override
    public void afterCompletion(HttpServletRequest request, 
                                HttpServletResponse response, 
                                Object handler, 
                                Exception ex) {
        UserContext.clear();
    }
}
```

---

## 登录服务

### AuthController

```java
@RestController
@RequestMapping("/auth")
public class AuthController {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private UserDetailsService userDetailsService;
    
    @Autowired
    private RefreshTokenService refreshTokenService;
    
    @PostMapping("/login")
    public Result&lt;LoginResponse&gt; login(@RequestBody LoginRequest request) {
        // 1. 验证用户名密码
        UserDetails user = userDetailsService.loadUserByUsername(request.getUsername());
        
        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            return Result.fail("用户名或密码错误");
        }
        
        // 2. 生成 Token
        String accessToken = jwtService.generateAccessToken(user);
        String refreshToken = jwtService.generateRefreshToken(user);
        
        // 3. 存储 Refresh Token
        refreshTokenService.store(request.getUsername(), refreshToken);
        
        return Result.success(LoginResponse.builder()
            .accessToken(accessToken)
            .refreshToken(refreshToken)
            .tokenType("Bearer")
            .expiresIn(3600)
            .build());
    }
    
    @PostMapping("/refresh")
    public Result&lt;LoginResponse&gt; refresh(@RequestBody RefreshRequest request) {
        // 验证 Refresh Token
        Claims claims = jwtService.validateToken(request.getRefreshToken());
        
        String username = claims.getSubject();
        String storedToken = refreshTokenService.get(username);
        
        if (!request.getRefreshToken().equals(storedToken)) {
            return Result.fail("无效的 Refresh Token");
        }
        
        // 加载用户信息
        UserDetails user = userDetailsService.loadUserByUsername(username);
        
        // 生成新 Token
        String newAccessToken = jwtService.generateAccessToken(user);
        String newRefreshToken = jwtService.generateRefreshToken(user);
        
        // 更新 Refresh Token
        refreshTokenService.store(username, newRefreshToken);
        
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

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 微服务架构下如何做认证？ | 架构设计 | 本篇 |
| 网关统一鉴权的优势？ | 设计理解 | 本篇 |
| 微服务端如何获取用户信息？ | 实战能力 | 本篇 |
| Token 在网关层验证还是微服务端验证？ | 设计决策 | 本篇 |
| 如何实现服务间调用的认证？ | 进阶能力 | 服务间认证 |

---

## 总结

微服务统一鉴权中心的核心要点：

1. **架构优势**：网关统一认证，微服务专注业务
2. **过滤器链**：JwtFilter 验证 Token，AuthorityFilter 检查权限
3. **用户信息传递**：通过 Header 传递用户信息到下游服务
4. **微服务端**：通过拦截器获取用户信息
5. **登录服务**：独立认证服务生成 Token

网关鉴权是微服务安全架构的标准实践。

---

## 下一步

- 想了解更多微服务知识？→ [Spring Cloud 微服务](/framework/springcloud/index)
- 想了解 JWT 认证？→ [JWT 无状态认证流程设计](/framework/springsecurity/jwt-filter)
- 想了解其他安全机制？→ [CSRF 防护机制](/framework/springsecurity/csrf)
