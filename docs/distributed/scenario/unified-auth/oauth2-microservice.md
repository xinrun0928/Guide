# OAuth 2.0 在微服务中的使用：授权服务与资源服务分离

OAuth 2.0 ，很多人听过，但总觉得它是「开放平台」才用的东西。

其实不然。OAuth 2.0 的四种授权模式，每一种都可以在微服务架构中找到用武之地。

关键在于理解它的核心思想：**不要把用户密码交给第三方应用，而是发行一个有限权限的「令牌」。**

## OAuth 2.0 的四种授权模式

### 1. 授权码模式（Authorization Code）

最完整、最安全的模式，适合有后端的应用。

```
用户 → 授权页面 → 授权码 → 后端换令牌 → 返回 Access Token
```

特点是令牌不经过浏览器，风险最低。但流程复杂，通常用于「第三方登录」场景。

### 2. 隐式授权模式（Implicit）

没有后端，直接返回 Access Token。不推荐，已被 OAuth 2.1 废弃。

### 3. 密码凭证模式（Password Credentials）

用户把用户名密码交给应用，应用拿这些凭证直接换令牌。

```
适用场景：受信任的第一方应用（如公司自己的移动端访问自己的后端）
```

这几乎是「伪装的登录」，适合迁移旧系统到 OAuth2 架构。

### 4. 客户端凭证模式（Client Credentials）

**这是微服务场景最常用的模式。**

没有用户参与，只有「客户端」（服务）对「服务端」（资源）的认证。

```
服务 A（客户端） → 用 ClientId + ClientSecret 换 Access Token → 访问服务 B（资源服务器）
```

## 微服务场景下的推荐方案

### 客户端凭证模式

微服务之间的调用，本质上是「机器对机器」的认证。用户不参与，最适合客户端凭证模式。

```java
// 服务 A 请求授权服务，获取 Access Token
@RestController
public class AuthController {

    @Value("${oauth2.client-id}")
    private String clientId;

    @Value("${oauth2.client-secret}")
    private String clientSecret;

    @Value("${oauth2.token-url}")
    private String tokenUrl;

    public String getAccessToken() {
        RestTemplate restTemplate = new RestTemplate();
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setBasicAuth(clientId, clientSecret);

        HttpEntity&lt;String&gt; request = new HttpEntity&lt;&gt;(
            "grant_type=client_credentials", headers);

        ResponseEntity&lt;Map&gt; response = restTemplate.exchange(
            tokenUrl, HttpMethod.POST, request, Map.class);

        return (String) response.getBody().get("access_token");
    }
}
```

## 授权服务与资源服务的职责

### 授权服务（Authorization Server）

授权服务是 OAuth2 架构的核心，负责：

1. **发行 Access Token**：验证客户端凭证，发行令牌
2. **管理 Client 凭证**：客户端的 ClientId 和 ClientSecret
3. **Token 刷新**：Access Token 过期后，用 Refresh Token 换取新的

```java
@Configuration
@EnableAuthorizationServer
public class AuthorizationServerConfig extends AuthorizationServerConfigurerAdapter {

    @Autowired
    private AuthenticationManager authenticationManager;

    @Override
    public void configure(ClientDetailsServiceConfigurer clients) throws Exception {
        clients.inMemory()
            .withClient("service-a")
            .secret("secret-a")
            .scopes("read", "write")
            .authorizedGrantTypes("client_credentials", "refresh_token");
    }

    @Override
    public void configure(AuthorizationServerEndpointsConfigurer endpoints) {
        endpoints.authenticationManager(authenticationManager)
                 .tokenStore(tokenStore());
    }

    @Bean
    public TokenStore tokenStore() {
        return new JwtTokenStore(jwtTokenEnhancer());
    }

    @Bean
    public JwtAccessTokenConverter jwtTokenEnhancer() {
        JwtAccessTokenConverter converter = new JwtAccessTokenConverter();
        converter.setSigningKey("my-signing-key");
        return converter;
    }
}
```

### 资源服务（Resource Server）

资源服务验证 Token，提取用户信息：

```java
@Configuration
@EnableResourceServer
public class ResourceServerConfig extends ResourceServerConfigurerAdapter {

    @Override
    public void configure(HttpSecurity http) throws Exception {
        http.authorizeRequests()
            .antMatchers("/public/**").permitAll()
            .antMatchers("/order/**").hasAuthority("SCOPE_read")
            .antMatchers("/admin/**").hasAuthority("SCOPE_write")
            .anyRequest().authenticated();
    }
}
```

## 权限控制的实现

微服务中，权限控制通常在 Controller 层用注解完成：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    // 只有拥有 read 权限才能访问
    @PreAuthorize("hasAuthority('SCOPE_read')")
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }

    // 只有拥有 write 权限才能访问
    @PreAuthorize("hasAuthority('SCOPE_write')")
    @PostMapping
    public User createUser(@RequestBody User user) {
        return userService.create(user);
    }

    // 只有管理员才能访问
    @PreAuthorize("hasRole('ADMIN')")
    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable Long id) {
        userService.delete(id);
    }
}
```

`@PreAuthorize` 在方法执行前进行权限校验，如果当前 Token 没有对应权限，直接拒绝请求。

## Token 撤销的实现

JWT 是无状态的，但实际业务中经常需要主动撤销 Token（比如用户修改密码、员工离职）。

结合 Redis 可以实现 Token 黑名单：

```java
@Service
public class TokenRevocationService {

    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String BLACKLIST_PREFIX = "token:blacklist:";

    // 将 Token 加入黑名单
    public void revoke(String token) {
        // 获取 Token 的剩余有效期，设置相同TTL的过期时间
        Date expiration = getExpiration(token);
        if (expiration != null) {
            long ttl = (expiration.getTime() - System.currentTimeMillis()) / 1000;
            if (ttl > 0) {
                redisTemplate.opsForValue().set(BLACKLIST_PREFIX + token, "1",
                    ttl, TimeUnit.SECONDS);
            }
        }
    }

    // 检查 Token 是否在黑名单
    public boolean isRevoked(String token) {
        return Boolean.TRUE.equals(redisTemplate.hasKey(BLACKLIST_PREFIX + token));
    }
}
```

资源服务验证 Token 时，同时检查黑名单：

```java
@Component
public class TokenValidator {

    @Autowired
    private TokenRevocationService revocationService;

    public boolean validate(String token) {
        // JWT 格式验证
        // 签名验证
        // 黑名单检查
        if (revocationService.isRevoked(token)) {
            throw new InvalidTokenException("Token has been revoked");
        }
        return true;
    }
}
```

## 面试追问方向

- OAuth2 的四种授权模式，分别适合什么场景？（答：授权码适合第三方登录，客户端凭证适合微服务互调）
- Access Token 和 Refresh Token 的区别？（答：Access Token 用于访问资源，有期限；Refresh Token 用于换新 Access Token，期限更长）
- 为什么 Access Token 推荐用 JWT？（答：无状态、可自包含信息、验证快）
- 微服务之间如何传递 Token？（答：通过 Header 传递，通常是 `Authorization: Bearer <token>`）

## 小结

OAuth 2.0 不是大厂的专属，它的设计思想——**发行有限权限的令牌，而不是共享用户密码**——适用于任何需要服务间认证的场景。

微服务架构下，推荐使用客户端凭证模式，让每个服务都有自己的身份，让授权服务统一发行和管理令牌。

下一次，当你的微服务需要调用其他服务时，不要再共享用户 Token 了——发行一个专属于这个调用的服务凭证吧。
