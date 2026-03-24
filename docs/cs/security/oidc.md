# OIDC：让身份认证更简单

你用微信登录了一个第三方 App，微信显示了授权页面。

但等等——微信怎么知道你是谁？第三方 App 怎么知道你的微信昵称、头像？

OAuth 2.0 只解决了「授权」问题——App 拿到了访问你数据的权限，但 App 不知道**你是谁**。

这就是 OIDC（OpenID Connect）诞生的原因——在 OAuth 2.0 基础上，添加身份认证层。

## OIDC 是什么

### OAuth 2.0 的局限

```
OAuth 2.0 授权流程：
App 说："我想访问用户的 Google Calendar"
Google 问："你确定要授权吗？"
用户说："授权"
Google 说："好，给你访问令牌"

App 拿到令牌后：
→ 能访问 Calendar API
→ 但不知道这是谁在登录
→ 无法拿到用户的基本信息（邮箱、姓名）
```

### OIDC 的解决方案

OIDC 在 OAuth 2.0 基础上添加了**身份层（ID Token）**：

```
OIDC 授权流程：
App 说："我想知道用户是谁，以及访问他的 Google Calendar"
Google 问："你确定要登录并授权吗？"
用户说："登录并授权"
Google 说："好，给你 ID Token（身份）和 Access Token（数据）"

App 拿到令牌后：
→ ID Token：知道这是谁（用户 ID、邮箱、姓名）
→ Access Token：能访问 Calendar API
```

OIDC 本质上是：
- **OAuth 2.0 的超集** —— 所有 OAuth 2.0 流程都兼容
- **身份认证协议** —— 在授权基础上增加了用户身份信息
- **基于 JWT** —— ID Token 使用 JWT 格式

## OIDC 的核心概念

### 1. ID Token vs Access Token

| | ID Token | Access Token |
|--|---------|--------------|
| 用途 | 证明用户身份 | 访问资源 API |
| 格式 | JWT | 不固定（通常是 opaque） |
| 谁验证 | App 自己 | 资源服务器 |
| 内容 | 用户身份信息 | API 访问权限 |
| 时效 | 通常较短（1小时） | 短（1小时） |

### 2. ID Token 的结构

```java
// JWT 解码示例
import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.interfaces.DecodedJWT;

public class OIDCTokenDemo {
    
    public static void main(String[] args) {
        // ID Token 示例（已解码）
        String idToken = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...";
        
        DecodedJWT jwt = JWT.decode(idToken);
        
        // Header
        System.out.println("算法: " + jwt.getAlgorithm()); // RS256
        System.out.println("类型: " + jwt.getType()); // JWT
        
        // Payload - 标准声明
        System.out.println("签发者: " + jwt.getIssuer()); // https://accounts.google.com
        System.out.println("受众: " + jwt.getAudience().get(0)); // client_id
        System.out.println("过期时间: " + jwt.getExpiresAt());
        System.out.println("签发时间: " + jwt.getIssuedAt());
        
        // Payload - OIDC 声明
        System.out.println("用户唯一标识: " + jwt.getSubject()); // sub
        System.out.println("邮箱: " + jwt.getClaim("email").asString());
        System.out.println("邮箱已验证: " + jwt.getClaim("email_verified").asBoolean());
        System.out.println("姓名: " + jwt.getClaim("name").asString());
        System.out.println("头像: " + jwt.getClaim("picture").asString());
    }
}
```

ID Token 的 Payload 包含三类声明：

**标准声明（Standard Claims）**：
- `iss`：签发者
- `sub`：用户唯一标识
- `aud`：受众（client_id）
- `exp`：过期时间
- `iat`：签发时间

**OIDC 约定声明**：
- `email`：用户邮箱
- `email_verified`：邮箱是否已验证
- `name`：用户全名
- `picture`：头像 URL

**自定义声明**：由签发者自行定义

### 3. UserInfo Endpoint

ID Token 为了保持精简，可能不包含所有用户信息。OIDC 提供了 UserInfo Endpoint 获取完整信息：

```java
// 获取用户完整信息
public UserInfo getUserInfo(String accessToken) {
    RestTemplate rest = new RestTemplate();
    
    HttpHeaders headers = new HttpHeaders();
    headers.setBearerAuth(accessToken);
    
    HttpEntity<Void> request = new HttpEntity<>(headers);
    
    // 调用 UserInfo Endpoint
    ResponseEntity<Map> response = rest.exchange(
        "https://openid-provider.com/userinfo",
        HttpMethod.GET,
        request,
        Map.class
    );
    
    Map<String, Object> userInfo = response.getBody();
    
    return new UserInfo(
        (String) userInfo.get("sub"),
        (String) userInfo.get("name"),
        (String) userInfo.get("email"),
        (String) userInfo.get("picture")
    );
}
```

## OIDC 的授权流程

### 标准 OIDC 授权码流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 用户点击「登录」                                          │
│     App → 重定向到 IdP 授权页面                                │
│     https://idp.example.com/authorize?                       │
│       response_type=code&id_token_hint=...&nonce=...&        │
│       scope=openid profile email                              │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. 用户认证（IdP 负责）                                      │
│     输入用户名密码 / 生物识别 / MFA...                          │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. IdP 返回授权码                                            │
│     https://app.example.com/callback?code=xxx                │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. App 后端换令牌                                           │
│     POST /token                                              │
│     grant_type=authorization_code&code=xxx                  │
│     ↓                                                        │
│     返回:                                                     │
│     {                                                         │
│       "access_token": "xxx",  // 访问 API                    │
│       "id_token": "xxx",      // 身份证明                     │
│       "token_type": "Bearer",                                │
│       "expires_in": 3600                                     │
│     }                                                         │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. App 验证 ID Token                                        │
│     - 验证签名（IdP 公钥）                                     │
│     - 验证 iss、aud、exp、nonce                              │
│     - 提取用户信息                                            │
└─────────────────────────────────────────────────────────────┘
```

### Nonce：防止重放攻击

OIDC 请求中的 `nonce` 参数用于防止重放攻击：

```java
// 生成 nonce
String nonce = UUID.randomUUID().toString();
session.setAttribute("oidc_nonce", nonce);

// 授权请求
String authUrl = "https://idp.example.com/authorize?" +
    "client_id=my-app" +
    "&response_type=code" +
    "&scope=openid profile email" +
    "&redirect_uri=https://app.example.com/callback" +
    "&nonce=" + nonce;

// 验证 nonce（在 ID Token 中）
String idToken = getIdTokenFromCallback();
JWT jwt = JWT.decode(idToken);
String tokenNonce = jwt.getClaim("nonce").asString();
if (!nonce.equals(tokenNonce)) {
    throw new SecurityException("Nonce mismatch - possible replay attack");
}
```

## 主流 OIDC 提供者

### 1. Keycloak

开源的企业级身份和访问管理解决方案：

```yaml
# Docker 部署 Keycloak
version: '3'
services:
  keycloak:
    image: quay.io/keycloak/keycloak:21.0
    environment:
      KEYCLOAK_ADMIN: admin
      KEYCLOAK_ADMIN_PASSWORD: admin
    command: start-dev
    ports:
      - "8080:8080"
```

### 2. Auth0

云身份平台，托管服务，开箱即用：

```java
// Auth0 Java SDK
AuthAPI authAPI = AuthAPI.context()
    .setDomain("your-tenant.auth0.com")
    .setClientId("your-client-id")
    .setClientSecret("your-client-secret")
    .build();

// 获取令牌
TokenRequest request = authAPI.requestToken("https://your-tenant.auth0.com/oauth/token");
Tokens tokens = request.execute();
String idToken = tokens.getIdToken();
```

### 3. Okta

企业级身份云平台：

```java
// Okta Spring Boot Starter
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/", "/login/**", "/css/**").permitAll()
            .anyRequest().authenticated()
        )
        .oauth2Login(oauth2 -> oauth2
            .loginPage("/oauth2/authorization/okta")
        )
        .oauth2ResourceServer(oauth2 -> oauth2
            .jwt(jwt -> jwt
                .decoder(jwtDecoder())
            )
        );
    return http.build();
}
```

## OIDC 与 OAuth 2.0 的选择

| 场景 | 推荐方案 | 原因 |
|------|---------|------|
| 只需要知道「用户是谁」 | OIDC | 专门解决身份问题 |
| 需要访问第三方 API | OAuth 2.0 | ID Token 不包含 API 权限 |
| 既有身份需求，又有 API 需求 | OIDC | OIDC 是 OAuth 2.0 超集 |
| 服务间 API 调用 | OAuth 2.0 Client Credentials | 不涉及用户身份 |

## 面试追问方向

1. **OIDC 和 OAuth 2.0 的区别？** —— OIDC 在 OAuth 2.0 基础上增加了身份层，OAuth 是授权协议，OIDC 是身份认证协议
2. **ID Token 和 Access Token 的区别？** —— ID Token 证明身份（App 验证），Access Token 访问资源（API 验证）
3. **Nonce 的作用？** —— 防止授权码被重放攻击，确保 ID Token 和授权请求一一对应
4. **OIDC 为什么用 JWT 而不是 opaque token？** —— JWT 自包含、可验证，App 可以自己解析而不需要调用 IdP
5. **OIDC 能实现 SSO 吗？** —— 可以，多个应用使用同一个 IdP，登录一次获取 ID Token 后可在多个应用间共享

> "OIDC 让身份认证变得简单而标准。它站在 OAuth 2.0 的肩膀上，为开发者提供了开箱即用的身份解决方案。"
