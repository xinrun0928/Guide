# 身份认证：你是谁？

凌晨 2 点，你收到一条短信：「您的银行账户在异地登录，请点击链接确认。」

你点不点？

在互联网世界，「证明你是你」是一个古老而核心的问题。身份认证（Authentication），就是回答这个问题。

但身份认证远不止输入密码那么简单。从古老的口令到现代的生物识别，从单机验证到联邦登录，它经历了漫长的进化。

## 身份认证的三要素

身份认证的本质是验证**你是谁**。在安全领域，这通常通过三种「证据」来证明：

### 1. 你知道什么（Something You Know）

密码、PIN、安全问题。这是最传统的认证方式。

优点：简单、成本低。
缺点：容易泄露、容易被钓鱼、容易被猜测。

### 2. 你有什么（Something You Have）

手机、U 盾、硬件令牌。动态令牌（OTP）是典型代表。

```
// TOTP（Time-based OTP）算法
public class TOTP {
    public static void main(String[] args) {
        // TOTP = HMAC-SHA1(密钥, 时间戳 / 30秒)
        long timeStep = System.currentTimeMillis() / 30000;
        byte[] key = getSecretKey(); // 从安全存储获取密钥
        
        // Google Authenticator 使用的就是 TOTP
        System.out.println("当前动态码: " + generateTOTP(key, timeStep));
    }
}
```

优点：不易被钓鱼、独立于密码。
缺点：可能丢失、需要额外设备。

### 3. 你是什么（Something You Are）

指纹、虹膜、面部识别。生物认证是最终极的方式。

优点：无法伪造、不需要记忆。
缺点：隐私问题、误识率、活体检测挑战。

**真正的安全系统会组合多种认证因素**，这叫多因素认证（MFA）。

## 认证的演进：从 Session 到 JWT

### 传统 Session 认证

```
用户登录 → 服务器创建 Session，存储在内存/Redis → 返回 Session ID → 浏览器存 Cookie → 后续请求带上 Cookie → 服务器验证 Session
```

```java
// Spring Session 认证示例
@RestController
public class AuthController {
    
    @PostMapping("/login")
    public Result login(@RequestBody LoginRequest request, HttpSession session) {
        User user = userService.authenticate(request.getUsername(), request.getPassword());
        
        // 登录成功，存储用户信息到 Session
        session.setAttribute("userId", user.getId());
        session.setAttribute("username", user.getUsername());
        
        return Result.success("登录成功");
    }
    
    @GetMapping("/profile")
    public Result profile(HttpSession session) {
        Long userId = (Long) session.getAttribute("userId");
        if (userId == null) {
            return Result.error("未登录");
        }
        User user = userService.findById(userId);
        return Result.success(user);
    }
}
```

Session 的问题：
- 服务器需要存储 Session，水平扩展麻烦
- Session 跨域共享困难
- 容易被 CSRF 攻击

### JWT：去中心化的认证方案

JWT（JSON Web Token）把用户信息编码进 Token，服务器不需要存储：

```java
import io.jsonwebtoken.*;

public class JwtAuth {
    // 签名密钥
    private static final String SECRET = "your-256-bit-secret-key-here";
    private static final long EXPIRATION = 86400000; // 24小时
    
    /**
     * 生成 JWT Token
     */
    public static String generateToken(Long userId, String username) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + EXPIRATION);
        
        return Jwts.builder()
            .subject(String.valueOf(userId))
            .claim("username", username)
            .issuedAt(now)
            .expiration(expiry)
            .signWith(Keys.hmacShaKeyFor(SECRET.getBytes()))
            .compact();
    }
    
    /**
     * 验证并解析 Token
     */
    public static Claims parseToken(String token) {
        return Jwts.parser()
            .verifyWith(Keys.hmacShaKeyFor(SECRET.getBytes()))
            .build()
            .parseSignedClaims(token)
            .getPayload();
    }
    
    /**
     * 登录接口
     */
    @PostMapping("/login")
    public Result login(@RequestBody LoginRequest request) {
        User user = userService.authenticate(request.getUsername(), request.getPassword());
        
        String token = generateToken(user.getId(), user.getUsername());
        return Result.success(Map.of("token", token));
    }
    
    /**
     * 需要认证的接口
     */
    @GetMapping("/profile")
    public Result profile(@RequestHeader("Authorization") String authHeader) {
        String token = authHeader.substring("Bearer ".length());
        Claims claims = parseToken(token);
        Long userId = Long.parseLong(claims.getSubject());
        
        User user = userService.findById(userId);
        return Result.success(user);
    }
}
```

JWT 的优势：
- 无状态，服务器不需要存储
- 天然支持分布式和微服务
- 跨域认证简单

JWT 的风险：
- Token 泄露 = 账户被盗（无法撤销）
- Token 太长会增加请求开销
- 无法主动「登出」

## OAuth 2.0：第三方授权

你一定见过「使用微信登录」「使用 Google 登录」——这就是 OAuth 2.0。

OAuth 不是认证协议，而是**授权协议**——它解决的是「如何授权第三方应用访问我的资源」。

### 为什么需要 OAuth？

想象一下：你想用一个健身 App，它需要读取你的微信运动数据。

**危险的做法**：在健身 App 输入微信账号密码。

**OAuth 的做法**：健身 App 请求微信授权，但不获取你的密码。

### OAuth 2.0 的核心角色

```
Resource Owner（资源所有者）  →  你
Client（客户端）              →  健身 App
Authorization Server（授权服务器）→  微信
Resource Server（资源服务器）  →  微信的接口服务器
```

### 四种授权模式

| 模式 | 适用场景 | 安全性 |
|------|---------|--------|
| Authorization Code | 有后端服务器的 Web 应用 | ⭐⭐⭐⭐⭐ 最安全 |
| PKCE | 移动端/SPA（无后端） | ⭐⭐⭐⭐ 安全 |
| Implicit | 不推荐，已废弃 | ⭐⭐ 不安全 |
| Client Credentials | 服务器之间的 API 调用 | ⭐⭐⭐ |

## 面试追问方向

1. **Cookie 和 Session 的区别？** —— Cookie 存客户端，Session 存服务器；Session 更安全但扩展性差
2. **Session  fixation 攻击是什么？** —— 攻击者预先设定 Session ID，用户登录后攻击者使用同一 Session ID 劫持
3. **JWT 为什么不能存敏感信息？** —— Base64 编码可解码，Token 泄露无法撤销
4. **Refresh Token 和 Access Token 的区别？** —— Access Token 短期有效，Refresh Token 长期有效用于续期
5. **MFA 为什么重要？** —— 密码泄露不等于账户被盗，还需要第二因素

> "身份认证是安全的基石。理解各种认证方案的优缺点，才能在安全和体验之间找到平衡。"
