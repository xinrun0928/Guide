# OAuth 2.0：第三方应用授权的艺术

你用过「使用 Google 登录」吗？用过「微信授权登录」吗？

你有没有想过：为什么这些平台愿意让你用自己的账号登录别的网站？他们图什么？

这就是 OAuth 2.0 要解决的问题——**在不泄露密码的前提下，让第三方应用访问你的资源**。

## OAuth 2.0 解决什么问题

### 危险的场景

你想用一个待办事项 App，它需要读取你的 Google Calendar。

**原始做法**：App 直接问你要 Google 账号密码。

**问题**：
- App 现在有了你 Google 账号的完整权限
- App 可以读取你 Google 账户的所有信息
- 如果 App 被黑，密码就泄露了
- 你无法撤销 App 的权限，只能改密码
- 改密码后，所有授权 App 都失效

### OAuth 的解决方案

OAuth 的核心思想是**引入「授权层」**：

```
你（资源所有者）
    ↓ 授权
Google（授权服务器）→ 发放「访问令牌」
    ↑ 验证令牌
App（客户端）→ 用令牌访问你的日历数据
```

App 拿到的是**受限的访问令牌**，不是你的密码。你可以：
- 查看 App 有权访问什么
- 随时撤销权限
- 设置权限的有效期

## OAuth 2.0 的四种授权模式

### 1. 授权码模式（Authorization Code）

最安全、最完整的模式，适合有后端服务器的应用。

```
1. 用户点击「使用 Google 登录」
2. App 跳转到 Google 授权页面
3. 用户点击「授权」
4. Google 跳转回 App，回传「授权码」
5. App 后端用授权码换「访问令牌」
6. App 用访问令牌调用 Google API
```

```java
// Spring Security OAuth2 Client 配置
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .oauth2Login(oauth2 -> oauth2
                .authorizationEndpoint(authorization -> 
                    authorization.baseUri("/oauth2/authorization/google"))
                .redirectionEndpoint(redirection -> 
                    redirection.baseUri("/login/oauth2/code/*"))
                .userInfoEndpoint(userInfo -> 
                    userInfo.userService(oauth2UserService))
            )
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/error").permitAll()
                .anyRequest().authenticated()
            );
        return http.build();
    }
}
```

**为什么安全？**
- 授权码换取令牌的过程在后端完成
- 令牌不会经过浏览器
- 可以验证 client_secret

### 2. PKCE 模式（Proof Key for Code Exchange）

适合移动端和 SPA（没有后端的 Web 应用）。

```java
// PKCE 流程：移动端示例
public class OAuthPKCE {
    
    // 1. 生成 code_verifier 和 code_challenge
    public static void main(String[] args) {
        String codeVerifier = generateRandomString(64);
        String codeChallenge = sha256Base64Url(codeVerifier);
        
        // 2. 构建授权 URL
        String authUrl = "https://authorization-server.com/authorize?" +
            "client_id=my-app" +
            "&response_type=code" +
            "&redirect_uri=myapp://callback" +
            "&scope=read" +
            "&code_challenge=" + codeChallenge +
            "&code_challenge_method=S256";
        
        // 3. 用户授权后，用 code_verifier 换令牌
        String tokenResponse = exchangeCode(code, codeVerifier);
    }
    
    private static String sha256Base64Url(String input) {
        // S256 方法：SHA-256 + Base64URL 编码
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes());
            return Base64.getUrlEncoder().withoutPadding().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
```

**为什么需要 PKCE？**
- 没有后端意味着无法保守 client_secret
- PKCE 用动态的 code_verifier 替代静态的 client_secret
- 即使授权码被截获，没有 code_verifier 也无法换令牌

### 3. 隐式授权模式（Implicit）- 已废弃

早期的简化模式，access_token 直接在 URL 中返回：

```
# 危险！Token 暴露在浏览器历史记录中
https://app.com/callback#access_token=xxx&token_type=bearer
```

这个模式已被 OAuth 2.1 废弃，不再使用。

### 4. 客户端凭证模式（Client Credentials）

服务器之间的 API 调用，不需要用户参与。

```java
// 服务间调用示例
public class ServiceToServiceAuth {
    
    private static final String CLIENT_ID = "my-microservice";
    private static final String CLIENT_SECRET = "service-secret";
    
    /**
     * 获取服务令牌
     */
    public String getServiceToken() {
        RestTemplate rest = new RestTemplate();
        
        // 用 client_credentials 换取 access_token
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);
        headers.setBasic(CLIENT_ID, CLIENT_SECRET);
        
        MultiValueMap<String, String> body = new MultiValueMap<>();
        body.add("grant_type", "client_credentials");
        body.add("scope", "read write");
        
        HttpEntity<MultiValueMap<String, String>> request = 
            new HttpEntity<>(body, headers);
        
        ResponseEntity<Map> response = rest.postForEntity(
            "https://auth-server.com/token",
            request,
            Map.class
        );
        
        return (String) response.getBody().get("access_token");
    }
}
```

## OAuth 2.0 的安全最佳实践

### 1. 使用 state 参数防止 CSRF

```java
// 授权请求时生成 state
String state = UUID.randomUUID().toString();
session.setAttribute("oauth_state", state);

String authUrl = "https://auth-server.com/authorize?" +
    "state=" + state + "...";

// 回调时验证 state
String returnedState = request.getParameter("state");
String storedState = (String) session.getAttribute("oauth_state");
if (!returnedState.equals(storedState)) {
    throw new SecurityException("State mismatch - possible CSRF attack");
}
```

### 2. 令牌安全存储

| 存储位置 | 安全性 | 适用场景 |
|---------|--------|----------|
| HttpOnly Cookie | ⭐⭐⭐⭐⭐ | Web 应用后端认证 |
| Secure Storage (Keychain) | ⭐⭐⭐⭐⭐ | 移动端原生应用 |
| Session Storage | ⭐⭐⭐ | 单页应用（SPA） |
| Local Storage | ⭐⭐ | 尽量避免 |
| URL 参数 | ⭐ | 绝对禁止 |

### 3. 令牌有效期控制

```java
// 令牌配置示例
@Configuration
public class TokenConfig {
    
    @Bean
    public JwtDecoder jwtDecoder() {
        return NimbusJwtDecoder.withJwkSetUri("https://auth-server.com/.well-known/jwks.json")
            .build();
    }
}

// 访问令牌：短期（15分钟 - 1小时）
// 刷新令牌：长期（1天 - 30天）
// 授权码：一次性（60秒内必须使用）
```

## OAuth 2.0 vs OAuth 1.0

| 对比项 | OAuth 1.0 | OAuth 2.0 |
|-------|----------|----------|
| 签名复杂度 | 高（HMAC-SHA1） | 低（HTTPS + 密钥） |
| 授权流程 | 复杂，需多次跳转 | 简洁灵活 |
| Token 类型 | 只有访问令牌 | 访问令牌 + 刷新令牌 |
| HTTPS 要求 | 不强制 | 强制 |
| 兼容性 | 差 | 好 |

## 面试追问方向

1. **OAuth 2.0 和 SSO 的区别？** —— OAuth 是授权（能做什么），SSO 是认证（你是谁）；OAuth 2.0 可用于实现 SSO
2. **授权码模式为什么最安全？** —— 令牌交换在后端，不暴露给浏览器
3. **PKCE 解决了什么问题？** —— 防止没有后端的应用被授权码拦截攻击
4. **隐式授权为什么被废弃？** —— Token 直接暴露在 URL 中，风险太高
5. **Refresh Token 丢失了怎么办？** —— 攻击者可用 Refresh Token 续期，需要实现令牌撤销机制

> "OAuth 2.0 是现代互联网的授权基础设施。理解它的四种模式和安全边界，才能设计出既便捷又安全的第三方授权系统。"
