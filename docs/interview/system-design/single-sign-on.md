# 单点登录（SSO）系统设计

---

## 场景切入：为什么输一次密码能用所有系统？

你在公司电脑上，登录了飞书文档。

然后打开内部 Wiki，不用再输密码。

打开运维平台，还是不用输密码。

打开代码仓库，依然不用输密码。

这就是**单点登录（Single Sign-On，简称 SSO）**。

但问题是：**这个「一次登录，处处通行」的魔法，是怎么实现的？**

---

## 需求分析：SSO 要解决什么问题？

SSO 的核心目标是：**用户只需登录一次，就可以访问所有相互信任的系统。**

### 核心问题

1. **身份认证**：如何验证用户身份？
2. **会话管理**：如何知道用户已经登录？
3. **跨域访问**：不同子域之间如何共享登录状态？
4. **安全防护**：如何防止身份伪造？

### 常见 SSO 协议

| 协议 | 特点 | 适用场景 |
|---|---|---|
| CAS | 简单，但跨域能力弱 | 单域名企业 |
| OAuth 2.0 | 授权而非认证，适合第三方登录 | 开放平台 |
| OIDC | OAuth 2.0 的超集，支持身份认证 | 现代 Web 应用 |
| SAML 2.0 | XML 格式，企业级 | 大型企业、跨国 |

---

## 容量估算

SSO 系统的容量评估相对简单：

| 指标 | 数值 |
|---|---|
| 日活用户 | 10 万 |
| 单次登录耗时 | 100ms |
| Token 校验 QPS | 1000/秒 |
| Session 存储 | 10 万 × 1KB = 100MB |

SSO 本身不是高并发系统，但**可用性要求极高**——SSO 挂了，所有系统都登录不了。

---

## 核心设计：Cookie + Session 方案

最简单的 SSO 实现，基于父域 Cookie。

```
主域名：example.com
子域名：wiki.example.com、oa.example.com、erp.example.com
```

### 原理

登录后，在父域写入 Cookie，所有子域共享。

```java
public class SSOController {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 登录接口
     * 核心思想：在父域写入 Cookie，这样所有子域都能读到
     */
    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest request, HttpServletResponse response) {
        // 1. 验证用户名密码
        User user = userService.authenticate(request.getUsername(), request.getPassword());
        if (user == null) {
            throw new AuthException("用户名或密码错误");
        }

        // 2. 生成 Session ID
        String sessionId = UUID.randomUUID().toString();

        // 3. 存储 Session 到 Redis（支持分布式）
        String sessionKey = "sso:session:" + sessionId;
        redisTemplate.opsForHash().putAll(sessionKey, Map.of(
            "userId", user.getId(),
            "username", user.getUsername(),
            "loginTime", System.currentTimeMillis()
        ));
        // 设置过期时间：7 天
        redisTemplate.expire(sessionKey, Duration.ofDays(7));

        // 4. 在父域写入 Cookie（关键！）
        // 这样 wiki.example.com、oa.example.com 都能读到
        Cookie cookie = new Cookie("SSO_SESSION", sessionId);
        cookie.setDomain(".example.com"); // 父域
        cookie.setPath("/");
        cookie.setMaxAge(7 * 24 * 60 * 60); // 7 天
        cookie.setHttpOnly(true); // 防止 XSS
        cookie.setSecure(true); // HTTPS only
        response.addCookie(cookie);

        return new LoginResponse(user.getId(), user.getUsername());
    }

    /**
     * 跨域验证：子域验证 Session
     */
    @GetMapping("/validate")
    public User validate(@CookieValue(value = "SSO_SESSION", required = false) String sessionId) {
        if (sessionId == null) {
            throw new AuthException("未登录");
        }

        String sessionKey = "sso:session:" + sessionId;
        Map&lt;Object, Object&gt; session = redisTemplate.opsForHash().entries(sessionKey);

        if (session.isEmpty()) {
            throw new AuthException("Session 已过期");
        }

        return new User(
            Long.valueOf(session.get("userId").toString()),
            session.get("username").toString()
        );
    }
}
```

---

## 核心设计：Token 方案（更通用）

Cookie 方案有局限——Cookie 不能跨域（不同父域）。

Token 方案更通用，适合多域名场景。

### 原理

```
用户 → 客户端 → SSO 服务：登录 → 返回 Token
用户 → 应用 A：携带 Token
应用 A → SSO 服务：校验 Token → 返回用户信息
```

```java
public class TokenSSOService {

    private final SecretKey secretKey;
    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 生成 JWT Token
     * 为什么用 JWT？因为它是无状态的，SSO 服务不需要存储 Token
     * 应用只需要用密钥验证签名即可
     */
    public String generateToken(Long userId, String username) {
        // 1. 构造 Header
        Map&lt;String, Object&gt; header = Map.of(
            "alg", "HS256",
            "typ", "JWT"
        );

        // 2. 构造 Payload
        Map&lt;String, Object&gt; payload = Map.of(
            "userId", userId,
            "username", username,
            "iat", System.currentTimeMillis() / 1000,
            "exp", (System.currentTimeMillis() + 7 * 24 * 60 * 60 * 1000L) / 1000
        );

        // 3. 生成签名
        String headerJson = new ObjectMapper().writeValueAsString(header);
        String payloadJson = new ObjectMapper().writeValueAsString(payload);
        String headerBase64 = Base64.getUrlEncoder().encodeToString(headerJson.getBytes());
        String payloadBase64 = Base64.getUrlEncoder().encodeToString(payloadJson.getBytes());
        String signature = sign(headerBase64 + "." + payloadBase64);

        return headerBase64 + "." + payloadBase64 + "." + signature;
    }

    /**
     * 验证 Token（各应用都可以本地验证，不需要调用 SSO 服务）
     */
    public UserInfo validateToken(String token) {
        String[] parts = token.split("\\.");
        if (parts.length != 3) {
            throw new AuthException("无效 Token");
        }

        // 1. 验证签名
        String expectedSignature = sign(parts[0] + "." + parts[1]);
        if (!expectedSignature.equals(parts[2])) {
            throw new AuthException("签名验证失败");
        }

        // 2. 解析 Payload
        String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]));
        Map&lt;String, Object&gt; payload = new ObjectMapper().readValue(payloadJson, Map.class);

        // 3. 检查过期
        long exp = Long.valueOf(payload.get("exp").toString());
        if (System.currentTimeMillis() / 1000 &gt; exp) {
            throw new AuthException("Token 已过期");
        }

        // 4. 检查黑名单（如果用户在别处修改了密码，需要让旧 Token 失效）
        String tokenId = parts[1]; // 用 payload 的 base64 作为 ID
        if (redisTemplate.hasKey("token:blacklist:" + tokenId)) {
            throw new AuthException("Token 已失效");
        }

        return new UserInfo(
            Long.valueOf(payload.get("userId").toString()),
            payload.get("username").toString()
        );
    }

    private String sign(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(secretKey);
            byte[] signature = mac.doFinal(data.getBytes());
            return Base64.getUrlEncoder().encodeToString(signature);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

## 核心设计：OAuth 2.0 + OIDC 方案（标准实现）

如果你的系统需要接入第三方登录（如 Google、GitHub），需要使用 OAuth 2.0 + OIDC。

### 流程

```
用户 → 应用：点击「用 Google 登录」
应用 → Google：重定向到授权页面
用户 → Google：输入账号密码，授权
Google → 应用：回调，带上授权码
应用 → Google：用授权码换 Token
Google → 应用：返回 ID Token
应用：验证 ID Token，建立本地 Session
```

```java
public class OAuth2SSOService {

    private final RestTemplate restTemplate;
    private final TokenSSOService tokenService;

    /**
     * 处理 OAuth 回调
     * 核心流程：用授权码换 Token，然后建立本地 Session
     */
    public UserInfo handleCallback(String code, String state) {
        // 1. 用授权码换 Token
        TokenResponse tokenResponse = exchangeCodeForToken(code);

        // 2. 验证 ID Token（关键！）
        // ID Token 是 JWT，包含用户身份信息，需要验证签名
        IdToken idToken = verifyIdToken(tokenResponse.getIdToken());

        // 3. 查找或创建本地用户
        User user = userService.findOrCreateByOAuthId(
            "google",
            idToken.getSubject(),
            idToken.getEmail(),
            idToken.getName()
        );

        // 4. 生成自己的 Token
        String token = tokenService.generateToken(user.getId(), user.getUsername());

        return new UserInfo(user.getId(), user.getUsername(), token);
    }

    /**
     * 验证 Google 的 ID Token
     * Google 的公钥可以从 well-known 端点获取
     */
    private IdToken verifyIdToken(String idTokenString) {
        String[] parts = idTokenString.split("\\.");
        String payloadJson = new String(Base64.getUrlDecoder().decode(parts[1]));

        // 这里应该验证签名，但简化处理
        // 实际生产中需要用 Google 的公钥验证
        return new ObjectMapper().readValue(payloadJson, IdToken.class);
    }

    /**
     * 用授权码换 Token
     */
    private TokenResponse exchangeCodeForToken(String code) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

        HttpEntity&lt;String&gt; request = new HttpEntity&lt;&gt;(
            "code=" + code +
            "&amp;client_id=" + GOOGLE_CLIENT_ID +
            "&amp;client_secret=" + GOOGLE_CLIENT_SECRET +
            "&amp;redirect_uri=" + REDIRECT_URI +
            "&amp;grant_type=authorization_code",
            headers
        );

        ResponseEntity&lt;TokenResponse&gt; response = restTemplate.postForEntity(
            "https://oauth2.googleapis.com/token",
            request,
            TokenResponse.class
        );

        return response.getBody();
    }
}
```

---

## 核心设计：单点登出

登录要统一，登出也要统一。

```java
public class LogoutController {

    private final RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 单点登出
     * 登出的挑战：用户的 Session 可能存在多个地方
     * 1. SSO 服务的 Session（Redis）
     * 2. 各应用的 Session（可能也在 Redis，但 key 不同）
     */
    @PostMapping("/logout")
    public void logout(HttpServletRequest request, HttpServletResponse response) {
        // 1. 清除 SSO Session
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if ("SSO_SESSION".equals(cookie.getName())) {
                    String sessionKey = "sso:session:" + cookie.getValue();
                    redisTemplate.delete(sessionKey);

                    // 清除 Cookie
                    cookie.setMaxAge(0);
                    cookie.setPath("/");
                    response.addCookie(cookie);
                }
            }
        }

        // 2. 广播登出事件（通知所有应用清除本地 Session）
        // 方式一：通过消息队列
        messageProducer.send("sso:logout", new LogoutEvent(userId, System.currentTimeMillis()));

        // 方式二：各应用主动轮询检查 Session 有效性
        // SSO 服务提供一个 /check 接口，各应用定期调用
    }

    /**
     * 通知应用登出的 Listener
     */
    @RabbitListener(queues = "sso.logout")
    public void handleLogoutEvent(LogoutEvent event) {
        // 各应用在这里清除本地 Session
        // 注意：这是异步的，可能有短暂的不一致窗口
        sessionService.invalidateByUserId(event.getUserId());
    }
}
```

---

## 延伸问题

### Q1：Session 和 Token 怎么选？

| 方案 | 优点 | 缺点 | 适用场景 |
|---|---|---|---|
| Session | 主动失效容易 | 需要共享存储 | 内网、单域名 |
| Token | 无状态、易扩展 | 被动失效困难 | 多域名、开放平台 |

### Q2：Token 怎么实现主动失效？

1. **黑名单**：把 Token ID 加入黑名单，校验时检查
2. **版本号**：用户表加 `token_version`，Token 携带版本号，改密码时 +1
3. **短期 Token**：Token 过期时间短（如 15 分钟），频繁刷新

### Q3：SSO 挂了怎么办？

1. **降级**：关闭 SSO，所有请求直接拒绝（安全但不友好）
2. **本地 Session**：各应用有本地 Fallback Session（复杂但可用）
3. **SSO 高可用**：SSO 本身做集群 + 跨机房容灾

---

## 总结

SSO 的核心就两点：

| 组件 | 作用 |
|---|---|
| Session 共享 | 通过父域 Cookie 或分布式 Session |
| Token 验证 | 无状态的 JWT 或有状态的 Session |

记住：**SSO 不是技术问题，是架构问题。**

你的系统有多少个？团队规模多大？安全要求多高？——这些问题的答案，决定了你应该选什么方案。
