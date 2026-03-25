# OAuth2 登录：QQ、微信、GitHub 第三方登录集成

你有没有想过，为什么很多网站可以用微信、QQ、GitHub 直接登录？

这背后就是 OAuth2 协议在起作用。

OAuth2（开放授权）允许用户授权第三方应用访问他们在其他服务上的信息，而无需提供用户名密码。

今天，我们就来深入了解如何在 Spring Security 中实现 OAuth2 登录。

---

## OAuth2 登录原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          OAuth2 登录流程                                  │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   用户浏览器                      我们的应用                   第三方平台 │
│   ──────────                    ────────────               ──────────── │
│                                                                          │
│   ┌─────────┐                                                          │
│   │访问网站  │                                                          │
│   └────┬────┘                                                          │
│        │                                                                │
│        │ 展示"用微信登录"                                              │
│        │                                                                │
│   ┌────┴────────────────────┐                                          │
│   │  用户点击"微信登录"      │                                          │
│   └────┬────────────────────┘                                          │
│        │                                                                │
│        │ 重定向到微信授权页面                                            │
│        │ /authorize?client_id=xxx&redirect_uri=yyy&scope=snsapi_base    │
│        ├───────────────────────────────────────────────────────────────► │
│        │                                                                │
│        │ 显示微信授权页面                                                │
│        │                                                                │
│   ┌────┴────┐                                                          │
│   │ 用户点击 │                                                          │
│   │ "确认授权" │                                                         │
│   └────┬────┘                                                          │
│        │                                                                │
│        │ 重定向回应用 + 授权码                                            │
│        │ /callback?code=xxxxx                                           │
│        │◄────────────────────────────────────────────────────────────── │
│        │                                                                │
│        │ 拿到授权码                                                      │
│        │                                                                │
│        │ 用授权码换 token                                               │
│        │ POST /oauth/token?code=xxx                                     │
│        ├───────────────────────────────────────────────────────────────► │
│        │                                                                │
│        │ 返回 access_token                                               │
│        │◄────────────────────────────────────────────────────────────── │
│        │                                                                │
│        │ 用 token 获取用户信息                                          │
│        │ GET /userinfo?access_token=xxx                                │
│        ├───────────────────────────────────────────────────────────────► │
│        │                                                                │
│        │ 返回用户信息（openid, nickname, headimgurl...）               │
│        │◄────────────────────────────────────────────────────────────── │
│        │                                                                │
│        │ 完成登录，创建本地账号                                          │
│        │                                                                │
│   ┌────┴────┐                                                          │
│   │ 登录成功 │                                                          │
│   │ 进入首页 │                                                          │
│   └─────────┘                                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Spring Security OAuth2 客户端

Spring Security 5.x 之后内置了 OAuth2 客户端支持：

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.boot&lt;/groupId&gt;
    &lt;artifactId&gt;spring-boot-starter-oauth2-client&lt;/artifactId&gt;
&lt;/dependency&gt;
```

---

## 配置 GitHub 登录

### 1. 在 GitHub 创建 OAuth App

1. 访问 https://github.com/settings/developers
2. 点击 "New OAuth App"
3. 填写信息：
   - Application name：你的应用名称
   - Homepage URL：http://localhost:8080
   - Authorization callback URL：http://localhost:8080/login/oauth2/code/github
4. 获取 Client ID 和 Client Secret

### 2. 配置文件

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          github:
            client-id: your-github-client-id
            client-secret: your-github-client-secret
            scope: read:user,user:email
        provider:
          github:
            authorization-uri: https://github.com/login/oauth/authorize
            token-uri: https://github.com/login/oauth/access_token
            user-info-uri: https://api.github.com/user
            user-name-attribute: login  # 用哪个字段作为用户名
```

### 3. 启动类配置

```java
@SpringBootApplication
@EnableWebSecurity
public class OAuth2Application {
    
    public static void main(String[] args) {
        SpringApplication.run(OAuth2Application.class, args);
    }
}
```

### 4. 自动登录

Spring Security OAuth2 客户端会自动处理整个登录流程，包括：

- 生成授权 URL
- 处理回调
- 获取用户信息
- 将用户信息映射为 OAuth2User

---

## 自定义 OAuth2 配置

### 完整配置示例

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login/**", "/error").permitAll()
                .anyRequest().authenticated()
            )
            // OAuth2 登录配置
            .oauth2Login(oauth2 -> oauth2
                // 自定义登录页面（可选，默认会生成）
                .loginPage("/oauth2/login")
                
                // 授权成功后的处理器
                .successHandler(oauth2AuthenticationSuccessHandler())
                
                // 授权失败后的处理器
                .failureHandler(oauth2AuthenticationFailureHandler())
                
                // 自定义 OAuth2User 的属性映射
                .userInfoEndpoint(userInfo -> userInfo
                    // GitHub
                    .userService(githubOAuth2UserService())
                    // 其他 provider 配置...
                )
            )
            // 如果不需要表单登录
            // .formLogin(Customizer.withDefaults())
        
        return http.build();
    }
}
```

### 自定义 UserService

```java
@Service
public class GithubOAuth2UserService implements OAuth2UserService&lt;OAuth2UserRequest, OAuth2User&gt; {
    
    private static final String GITHUB_USER_INFO_URL = "https://api.github.com/user";
    
    @Autowired
    private RestTemplateBuilder restTemplateBuilder;
    
    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2Error {
        
        // 1. 调用 GitHub API 获取用户信息
        String userInfoUrl = userRequest.getClientRegistration()
            .getProviderDetails()
            .getUserInfoEndpoint()
            .getUri();
        
        RestTemplate restTemplate = restTemplateBuilder.build();
        
        HttpHeaders headers = new HttpHeaders();
        headers.add("Authorization", "Bearer " + userRequest.getAccessToken().getTokenValue());
        
        HttpEntity&lt;Void&gt; entity = new HttpEntity&lt;&gt;(headers);
        ResponseEntity&lt;Map&gt; response = restTemplate.exchange(
            userInfoUrl,
            HttpMethod.GET,
            entity,
            Map.class
        );
        
        Map&lt;String, Object&gt; userAttributes = response.getBody();
        
        // 2. 提取需要的用户信息
        String githubId = String.valueOf(userAttributes.get("id"));
        String login = (String) userAttributes.get("login");
        String avatarUrl = (String) userAttributes.get("avatar_url");
        String email = (String) userAttributes.get("email");
        
        // 3. 查找或创建本地用户
        SocialUser user = findOrCreateUser("github", githubId, login, email, avatarUrl);
        
        // 4. 返回 OAuth2User
        return new SocialOAuth2User(user, userAttributes);
    }
    
    private SocialUser findOrCreateUser(String provider, String providerUserId,
                                        String username, String email, String avatar) {
        // 1. 查询是否已存在
        SocialUser user = socialUserRepository.findByProviderAndProviderUserId(provider, providerUserId);
        
        if (user != null) {
            // 更新用户信息
            user.setAvatar(avatar);
            return socialUserRepository.save(user);
        }
        
        // 2. 不存在，创建新用户
        user = new SocialUser();
        user.setProvider(provider);
        user.setProviderUserId(providerUserId);
        user.setUsername(username);
        user.setEmail(email);
        user.setAvatar(avatar);
        user.setRoles(Collections.singleton("ROLE_USER"));
        
        return socialUserRepository.save(user);
    }
}
```

---

## 集成 QQ 登录

### QQ 互联配置

QQ 登录使用的是 OAuth2.0，需要在 https://connect.qq.com/ 创建应用。

### QQ OAuth2 配置

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          qq:
            client-id: your-qq-app-id
            client-secret: your-qq-app-secret
            # QQ 登录不支持 scope
            scope:
            authorization-uri: https://graph.qq.com/oauth2.0/authorize
            token-uri: https://graph.qq.com/oauth2.0/token
            user-info-uri: https://graph.qq.com/oauth2.0/me?unionid=1
            user-name-attribute: nickname
            redirect-uri: http://localhost:8080/login/oauth2/code/qq
        provider:
          qq:
            authorization-uri: https://graph.qq.com/oauth2.0/authorize
            token-uri: https://graph.qq.com/oauth2.0/token
            user-info-uri: https://graph.qq.com/oauth2.0/me
```

### QQ UserService

```java
@Service
public class QqOAuth2UserService implements OAuth2UserService&lt;OAuth2UserRequest, OAuth2User&gt; {
    
    @Autowired
    private RestTemplateBuilder restTemplateBuilder;
    
    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2Error {
        // 1. 获取 OpenID（QQ 的用户唯一标识）
        String openId = getOpenId(userRequest);
        
        // 2. 获取用户基本信息
        Map&lt;String, Object&gt; userInfo = getUserInfo(userRequest, openId);
        
        // 3. 处理用户信息（QQ 返回的是 callback 格式）
        String nickname = (String) userInfo.get("nickname");
        String figureurl = (String) userInfo.get("figureurl_qq_2");
        
        // 4. 查找或创建本地用户
        SocialUser user = findOrCreateUser("qq", openId, nickname);
        
        return new SocialOAuth2User(user, userInfo);
    }
    
    private String getOpenId(OAuth2UserRequest request) {
        String url = "https://graph.qq.com/oauth2.0/me";
        
        RestTemplate restTemplate = restTemplateBuilder.build();
        String response = restTemplate.getForObject(
            UriComponentsBuilder.fromUriString(url)
                .queryParam("access_token", request.getAccessToken().getTokenValue())
                .build().toUriString(),
            String.class
        );
        
        // QQ 返回格式：callback({"client_id":"xxx","openid":"xxx"});
        String json = response.substring("callback(".length(), response.lastIndexOf(");"));
        JSONObject jsonObject = JSONObject.parseObject(json);
        return jsonObject.getString("openid");
    }
}
```

---

## 集成微信登录

### 微信开放平台配置

微信登录需要在 https://open.weixin.qq.com/ 创建应用。

### 微信 OAuth2 配置

```yaml
spring:
  security:
    oauth2:
      client:
        registration:
          wechat:
            client-id: your-wechat-app-id
            client-secret: your-wechat-app-secret
            scope: snsapi_login
            authorization-uri: https://open.weixin.qq.com/connect/qrconnect
            token-uri: https://api.weixin.qq.com/sns/oauth2/access_token
            user-info-uri: https://api.weixin.qq.com/sns/userinfo
            user-name-attribute: openid
            redirect-uri: http://localhost:8080/login/oauth2/code/wechat
        provider:
          wechat:
            authorization-uri: https://open.weixin.qq.com/connect/qrconnect
            token-uri: https://api.weixin.qq.com/sns/oauth2/access_token
            user-info-uri: https://api.weixin.qq.com/sns/userinfo
```

### 微信的坑

微信登录有两个需要注意的点：

1. **不支持 Authorization Code Flow**：微信使用的是改良版 OAuth2
2. **UnionID**：只有在绑定开放平台账号后，才能获取 UnionID（同一用户在微信不同应用下的唯一标识）

```java
@Service
public class WechatOAuth2UserService implements OAuth2UserService&lt;OAuth2UserRequest, OAuth2User&gt; {
    
    @Override
    public OAuth2User loadUser(OAuth2UserRequest userRequest) throws OAuth2Error {
        
        // 1. 用 access_token 获取用户信息
        String userInfoUrl = userRequest.getClientRegistration()
            .getProviderDetails()
            .getUserInfoEndpoint()
            .getUri();
        
        RestTemplate restTemplate = restTemplateBuilder.build();
        String url = userInfoUrl + "?access_token=" + 
            userRequest.getAccessToken().getTokenValue() + "&openid=" + 
            userRequest.getAccessToken().getAdditionalParameters().get("openid");
        
        Map&lt;String, Object&gt; userInfo = restTemplate.getForObject(url, Map.class);
        
        // 2. 提取用户信息
        String openid = (String) userInfo.get("openid");
        String nickname = (String) userInfo.get("nickname");
        String headimgurl = (String) userInfo.get("headimgurl");
        
        // 3. 查找或创建本地用户
        SocialUser user = findOrCreateUser("wechat", openid, nickname);
        
        return new SocialOAuth2User(user, userInfo);
    }
}
```

---

## OAuth2 登录成功处理

### 认证成功处理器

```java
@Component
public class OAuth2AuthenticationSuccessHandler 
    implements AuthenticationSuccessHandler {
    
    @Autowired
    private JwtService jwtService;
    
    @Autowired
    private SocialUserRepository socialUserRepository;
    
    @Override
    public void onAuthenticationSuccess(HttpServletRequest request,
                                        HttpServletResponse response,
                                        Authentication authentication) throws IOException {
        
        // 1. 获取 OAuth2User
        OAuth2User oAuth2User = (OAuth2User) authentication.getPrincipal();
        
        // 2. 生成 JWT Token
        String jwtToken = jwtService.generateToken(oAuth2User);
        
        // 3. 返回 Token
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        
        Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
        result.put("code", 200);
        result.put("message", "登录成功");
        result.put("token", jwtToken);
        result.put("user", extractUserInfo(oAuth2User));
        
        response.getWriter().write(new ObjectMapper().writeValueAsString(result));
    }
    
    private Map&lt;String, Object&gt; extractUserInfo(OAuth2User user) {
        Map&lt;String, Object&gt; info = new HashMap&lt;&gt;();
        info.put("username", user.getName());
        Map&lt;String, Object&gt; attrs = user.getAttributes();
        
        // 根据不同 provider 提取不同字段
        if (attrs.containsKey("login")) {  // GitHub
            info.put("avatar", attrs.get("avatar_url"));
            info.put("email", attrs.get("email"));
        } else if (attrs.containsKey("nickname")) {  // QQ/微信
            info.put("nickname", attrs.get("nickname"));
            info.put("avatar", attrs.get("figureurl_qq_2"));
        }
        
        return info;
    }
}
```

### 认证失败处理器

```java
@Component
public class OAuth2AuthenticationFailureHandler 
    implements AuthenticationFailureHandler {
    
    @Override
    public void onAuthenticationFailure(HttpServletRequest request,
                                       HttpServletResponse response,
                                       AuthenticationException exception) throws IOException {
        
        response.setContentType("application/json");
        response.setCharacterEncoding("UTF-8");
        
        Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
        result.put("code", 401);
        result.put("message", "第三方登录失败: " + exception.getMessage());
        
        response.getWriter().write(new ObjectMapper().writeValueAsString(result));
    }
}
```

---

## 社交用户数据模型

```sql
-- 社交账号表
CREATE TABLE social_user (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    provider VARCHAR(20) NOT NULL,          -- github, qq, wechat
    provider_user_id VARCHAR(100) NOT NULL,  -- 第三方平台的用户 ID
    username VARCHAR(50),
    email VARCHAR(100),
    avatar VARCHAR(500),
    roles VARCHAR(500),
    create_time DATETIME,
    update_time DATETIME,
    UNIQUE KEY uk_provider_user (provider, provider_user_id)
);

-- 关联表：一个用户可以绑定多个社交账号
CREATE TABLE user_social_account (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,                -- 本系统用户 ID
    social_user_id BIGINT NOT NULL,          -- 社交账号 ID
    create_time DATETIME,
    UNIQUE KEY uk_user_social (user_id, social_user_id)
);
```

---

## OAuth2 各平台对比

| 平台 | 授权 URL | Token URL | 用户信息 URL | 用户标识 |
|-----|---------|-----------|-------------|---------|
| GitHub | /login/oauth/authorize | /login/oauth/access_token | /user | login |
| QQ | /oauth2.0/authorize | /oauth2.0/token | /oauth2.0/me + /user/get_user_info | openid |
| 微信 | /connect/qrconnect | /sns/oauth2/access_token | /sns/userinfo | openid |
| 微博 | /oauth2/authorize | /oauth2/access_token | /2/users/show.json | uid |
| 支付宝 | /oauth2/publicKey_encrypt | /oauth2/token | /user/info/share | user_id |

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| OAuth2 和 SSO 的区别？ | 概念辨析 | CAS |
| OAuth2 的授权流程？ | 流程理解 | 本篇 |
| 什么是授权码模式？ | 协议理解 | 本篇 |
| 如何防止 Token 被盗用？ | 安全机制 | JWT 安全 |
| 如何实现多平台账号绑定？ | 实战能力 | 本篇 |

---

## 总结

OAuth2 登录的实现要点：

1. **核心流程**：授权 → 获取 Code → 换 Token → 获取用户信息
2. **Spring Security 支持**：内置 OAuth2 客户端，自动处理大部分流程
3. **自定义配置**：通过 `OAuth2UserService` 自定义用户信息获取和映射
4. **数据模型**：一个用户可绑定多个社交账号
5. **各平台差异**：GitHub、QQ、微信的 API 和返回格式各不相同

OAuth2 登录大大简化了用户的注册登录流程，是现代 Web 应用的标准配置。

---

## 下一步

- 想实现企业级单点登录？→ [CAS 单点登录集成](/framework/springsecurity/cas)
- 想了解 JWT 无状态认证？→ [JWT 生成与验证](/framework/springsecurity/jwt)
- 想实现 Token 防盗用？→ [Token 防盗用：设备指纹 + IP 绑定](/framework/springsecurity/jwt-security)
