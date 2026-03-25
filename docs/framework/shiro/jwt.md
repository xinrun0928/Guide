# Shiro 实现 JWT 无状态认证

Session 在很多场景下很好用，但它有几个固有问题：

- 需要在服务端存储 Session 数据
- 分布式环境下需要 Redis 共享
- 扩展性受限

如果你开发的是 RESTful API，或者追求极致的可扩展性，**JWT** 可能是更好的选择。

这一节，我们来学习如何用 Shiro 实现 JWT 无状态认证。

## JWT vs Session

| 特性 | JWT | Session |
|-----|-----|---------|
| **存储位置** | 客户端（Token） | 服务端（内存/Redis） |
| **状态** | 无状态 | 有状态 |
| **扩展性** | 简单（不需要同步） | 复杂（需要 Session 共享） |
| **跨域** | 原生支持 | 需要特殊处理 |
| **Token 长度** | 较长 | 短 |
| **注销/过期控制** | 困难（需要黑名单） | 简单（删除 Session 即可） |

## JWT 结构

```
Header.Payload.Signature
```

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        请求流程                              │
│                                                              │
│  ┌─────────┐                                               │
│  │  Client │  携带 JWT Token                               │
│  └────┬────┘                                               │
│       │                                                     │
│       ▼                                                     │
│  ┌────────────────────────────────────┐                    │
│  │      JwtFilter（Shiro 过滤器）      │                    │
│  │                                     │                    │
│  │  1. 提取 Token                     │                    │
│  │  2. 验证 Token                     │                    │
│  │  3. 创建 Subject                   │                    │
│  └────────────────────────────────────┘                    │
│       │                                                     │
│       ▼                                                     │
│  ┌────────────────────────────────────┐                    │
│  │         业务逻辑                    │                    │
│  │   （不需要 Session，纯粹验证）       │                    │
│  └────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

## 实现步骤

### 1. 添加依赖

```xml
<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-spring-boot-web-starter</artifactId>
    <version>1.13.0</version>
</dependency>

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

### 2. JWT 工具类

```java
@Component
public class JwtUtils {
    
    // 签名密钥
    private static final String SECRET_KEY = "YourSecretKeyForJwtTokenGeneration2024";
    
    // Token 过期时间（毫秒）
    private static final long EXPIRE_TIME = 30 * 60 * 1000;  // 30 分钟
    
    // 生成 Token
    public String generateToken(String username, Map<String, Object> claims) {
        Date now = new Date();
        Date expiration = new Date(now.getTime() + EXPIRE_TIME);
        
        return Jwts.builder()
            .setSubject(username)
            .addClaims(claims != null ? claims : new HashMap<>())
            .setIssuedAt(now)
            .setExpiration(expiration)
            .signWith(Keys.hmacShaKeyFor(SECRET_KEY.getBytes()), 
                      SignatureAlgorithm.HS256)
            .compact();
    }
    
    // 验证 Token
    public boolean validateToken(String token) {
        try {
            Jwts.parserBuilder()
                .setSigningKey(Keys.hmacShaKeyFor(SECRET_KEY.getBytes()))
                .build()
                .parseClaimsJws(token);
            return true;
        } catch (JwtException e) {
            return false;
        }
    }
    
    // 获取用户名
    public String getUsername(String token) {
        Claims claims = getClaims(token);
        return claims.getSubject();
    }
    
    // 获取 Claims
    public Claims getClaims(String token) {
        return Jwts.parserBuilder()
            .setSigningKey(Keys.hmacShaKeyFor(SECRET_KEY.getBytes()))
            .build()
            .parseClaimsJws(token)
            .getBody();
    }
    
    // 判断是否过期
    public boolean isTokenExpired(String token) {
        try {
            Claims claims = getClaims(token);
            return claims.getExpiration().before(new Date());
        } catch (JwtException e) {
            return true;
        }
    }
    
    // 刷新 Token
    public String refreshToken(String token) {
        Claims claims = getClaims(token);
        return generateToken(claims.getSubject(), claims);
    }
}
```

### 3. JWT Token 类

```java
public class JwtToken implements AuthenticationToken {
    
    private String token;
    
    public JwtToken(String token) {
        this.token = token;
    }
    
    @Override
    public Object getPrincipal() {
        return getUsername();
    }
    
    @Override
    public Object getCredentials() {
        return token;
    }
    
    public String getToken() {
        return token;
    }
    
    public String getUsername() {
        try {
            // 解析 Token 获取用户名
            return new JwtUtils().getUsername(token);
        } catch (Exception e) {
            return null;
        }
    }
}
```

### 4. JWT 过滤器

```java
public class JwtFilter extends AuthenticatingFilter {
    
    @Autowired
    private JwtUtils jwtUtils;
    
    @Override
    protected AuthenticationToken createToken(ServletRequest request, 
                                            ServletResponse response) 
            throws Exception {
        // 从请求头获取 Token
        String token = getToken((HttpServletRequest) request);
        
        if (token == null || !jwtUtils.validateToken(token)) {
            return null;
        }
        
        return new JwtToken(token);
    }
    
    @Override
    protected boolean onAccessDenied(ServletRequest request, 
                                     ServletResponse response) throws Exception {
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        httpResponse.setContentType("application/json;charset=UTF-8");
        httpResponse.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        httpResponse.getWriter().write("{\"code\":401,\"msg\":\"未登录或Token已过期\"}");
        return false;
    }
    
    @Override
    protected boolean onLoginSuccess(AuthenticationToken token, 
                                     Subject subject, 
                                     ServletRequest request, 
                                     ServletResponse response) throws Exception {
        // JWT 登录成功后不需要额外处理
        return true;
    }
    
    @Override
    protected boolean onLoginFailure(AuthenticationToken token, 
                                     AuthenticationException e, 
                                     ServletRequest request, 
                                     ServletResponse response) {
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        httpResponse.setContentType("application/json;charset=UTF-8");
        httpResponse.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        try {
            httpResponse.getWriter().write("{\"code\":401,\"msg\":\"登录失败:\" + e.getMessage()}");
        } catch (IOException ex) {
            // ignore
        }
        return false;
    }
    
    @Override
    protected boolean isAccessAllowed(ServletRequest request, 
                                      ServletResponse response, 
                                      Object mappedValue) {
        // 放行 OPTIONS 请求
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        if ("OPTIONS".equalsIgnoreCase(httpRequest.getMethod())) {
            return true;
        }
        
        // 检查 Token 是否存在且有效
        String token = getToken(httpRequest);
        return token != null && jwtUtils.validateToken(token);
    }
    
    // 从请求头提取 Token
    private String getToken(HttpServletRequest request) {
        String token = request.getHeader("Authorization");
        if (token != null && token.startsWith("Bearer ")) {
            return token.substring(7);
        }
        return null;
    }
}
```

### 5. JWT Realm

```java
@Component
public class JwtRealm extends AuthorizingRealm {
    
    @Autowired
    private UserService userService;
    
    @Override
    public boolean supports(AuthenticationToken token) {
        return token instanceof JwtToken;
    }
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        
        String username = (String) principals.getPrimaryPrincipal();
        
        // 查询用户权限
        User user = userService.findByUsername(username);
        Set<String> roles = userService.getRolesByUsername(username);
        Set<String> permissions = userService.getPermissionsByUsername(username);
        
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        info.setRoles(roles);
        info.setStringPermissions(permissions);
        
        return info;
    }
    
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        
        JwtToken jwtToken = (JwtToken) token;
        String username = jwtToken.getUsername();
        
        if (username == null) {
            throw new UnknownAccountException("Token无效");
        }
        
        User user = userService.findByUsername(username);
        if (user == null) {
            throw new UnknownAccountException("用户不存在");
        }
        
        return new SimpleAuthenticationInfo(
            username,
            "",  // JWT 场景下不需要密码
            getName()
        );
    }
}
```

### 6. Shiro 配置

```java
@Configuration
public class ShiroJwtConfig {
    
    @Autowired
    private JwtRealm jwtRealm;
    
    @Autowired
    private JwtUtils jwtUtils;
    
    @Bean
    public SecurityManager securityManager() {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        
        // 设置 Realm
        manager.setRealm(jwtRealm);
        
        return manager;
    }
    
    @Bean
    public ShiroFilterChainDefinition shiroFilterChainDefinition() {
        DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
        
        // 公开接口
        chain.addPathDefinition("/api/public/**", "anon");
        chain.addPathDefinition("/api/login", "anon");
        
        // 带有 JWT 过滤器的链
        chain.addPathDefinition("/**", "jwt");
        
        return chain;
    }
    
    @Bean
    public JwtFilter jwtFilter() {
        JwtFilter filter = new JwtFilter();
        filter.setSecurityManager(securityManager());
        filter.setJwtUtils(jwtUtils);
        return filter;
    }
    
    @Bean
    public AuthorizationAttributeSourceAdvisor advisor(SecurityManager securityManager) {
        AuthorizationAttributeSourceAdvisor advisor = 
            new AuthorizationAttributeSourceAdvisor();
        advisor.setSecurityManager(securityManager);
        return advisor;
    }
}
```

### 7. 登录控制器

```java
@RestController
@RequestMapping("/api")
public class AuthController {
    
    @Autowired
    private JwtUtils jwtUtils;
    
    @Autowired
    private UserService userService;
    
    @PostMapping("/login")
    public Result<String> login(@RequestParam String username, 
                                 @RequestParam String password) {
        
        // 验证用户名密码
        User user = userService.findByUsername(username);
        if (user == null || !passwordEncoder.matches(password, user.getPassword())) {
            return Result.error("用户名或密码错误");
        }
        
        // 生成 Token
        Map<String, Object> claims = new HashMap<>();
        claims.put("userId", user.getId());
        claims.put("roles", userService.getRolesByUsername(username));
        
        String token = jwtUtils.generateToken(username, claims);
        
        return Result.success(token);
    }
    
    @PostMapping("/logout")
    public Result<String> logout(HttpServletRequest request) {
        // JWT 场景下，logout 由客户端删除 Token
        return Result.success("已退出登录");
    }
    
    @GetMapping("/user/info")
    @RequiresAuthentication
    public Result<User> getUserInfo() {
        Subject subject = SecurityUtils.getSubject();
        String username = (String) subject.getPrincipal();
        
        User user = userService.findByUsername(username);
        user.setPassword(null);  // 不返回密码
        return Result.success(user);
    }
}
```

## 前端使用

```javascript
// 登录
async function login(username, password) {
    const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: `username=${username}&password=${password}`
    });
    
    const result = await response.json();
    
    if (result.code === 200) {
        // 保存 Token
        localStorage.setItem('token', result.data);
    }
    
    return result;
}

// 请求封装
async function request(url, options = {}) {
    const token = localStorage.getItem('token');
    
    const defaultOptions = {
        headers: {
            'Authorization': token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json'
        }
    };
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers
        }
    };
    
    const response = await fetch(url, mergedOptions);
    
    if (response.status === 401) {
        // Token 过期，跳转登录
        localStorage.removeItem('token');
        window.location.href = '/login';
        return;
    }
    
    return response.json();
}

// 使用
async function getUserInfo() {
    return request('/api/user/info');
}
```

## Token 刷新机制

### 双 Token 方案

```java
public class JwtUtils {
    
    // Access Token 过期时间
    private static final long ACCESS_EXPIRE = 30 * 60 * 1000;  // 30 分钟
    
    // Refresh Token 过期时间
    private static final long REFRESH_EXPIRE = 7 * 24 * 60 * 60 * 1000;  // 7 天
    
    public Map<String, String> generateTokenPair(String username) {
        Map<String, String> tokens = new HashMap<>();
        
        // Access Token
        tokens.put("accessToken", generateAccessToken(username));
        
        // Refresh Token
        tokens.put("refreshToken", generateRefreshToken(username));
        
        return tokens;
    }
    
    public String refreshAccessToken(String refreshToken) {
        if (!validateToken(refreshToken)) {
            throw new JwtException("Refresh Token 无效");
        }
        
        Claims claims = getClaims(refreshToken);
        return generateAccessToken(claims.getSubject());
    }
}
```

### 刷新流程

```
1. Access Token 过期
         │
         ▼
2. 客户端使用 Refresh Token 请求刷新接口
         │
         ▼
3. 服务端验证 Refresh Token
         │
         ├─ 有效：生成新的 Access Token
         │
         └─ 无效：要求重新登录
```

## 面试追问方向

**面试官可能会问**：

1. **JWT 和 Session 哪个更好？**
   - 没有绝对答案，视场景而定
   - 需要服务端控制 Token 失效用 Session
   - 无状态、高扩展性用 JWT

2. **JWT 有什么缺点？**
   - Token 泄露无法阻止
   - Token 过期无法主动撤销
   - Token 体积较大

3. **如何实现 JWT 的主动注销？**
   - 使用黑名单
   - 存入 Redis

4. **JWT 安全吗？**
   - 签名机制保证不被篡改
   - 但可能被窃取
   - 需要 HTTPS 传输

---

## 留给你的问题

JWT 可以携带用户身份，但权限信息呢？每次都要查数据库？

下一节，我们来学习 Shiro 的权限数据模型——如何设计用户-角色-权限的树状结构。
