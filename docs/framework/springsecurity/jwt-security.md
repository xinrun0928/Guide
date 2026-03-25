# Token 防盗用：设备指纹 + IP 绑定

你有没有想过这个问题：JWT Token 泄露了怎么办？

虽然 Token 有过期时间，但如果攻击者拿到了有效的 Token，就能在过期前冒充用户。

今天，我们就来深入了解如何通过设备指纹和 IP 绑定来增强 Token 的安全性。

---

## Token 盗用的风险

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Token 盗用场景                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  场景一：Token 被窃取                                                   │
│                                                                          │
│  用户 A 登录 ──► 获取 Token ──► Token 被攻击者获取                        │
│                                              │                           │
│                                              ▼                           │
│                                      攻击者使用 Token                    │
│                                      冒充用户 A 操作                     │
│                                                                          │
│  场景二：Token 被重放                                                   │
│                                                                          │
│  用户 A 发起请求 ──► Token 被截获                                       │
│                                     │                                   │
│                                     ▼                                   │
│                             攻击者重放请求                               │
│                             多次执行相同操作                             │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  问题：JWT 无法感知 Token 被盗                                          │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ JWT 是签名的，服务端无法修改                                       │   │
│  │                                                                  │   │
│  │ 攻击者拿到的 Token，只要没过期就能正常使用                        │   │
│  │                                                                  │   │
│  │ 用户 A 不知道 Token 被偷了                                        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 设备指纹

### 什么是设备指纹？

设备指纹是一组用于唯一标识设备的特征值：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         设备指纹组成                                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  浏览器特征：                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ - User-Agent：浏览器和系统信息                                    │   │
│  │ - Accept-Language：语言设置                                      │   │
│  │ - Accept-Encoding：编码支持                                      │   │
│  │ - Screen Resolution：屏幕分辨率                                  │   │
│  │ - Timezone：时区设置                                             │   │
│  │ - Canvas Fingerprint：Canvas 渲染特征                            │   │
│  │ - WebGL Renderer：显卡信息                                       │   │
│  │ - Installed Fonts：字体列表                                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  设备特征：                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ - IP 地址                                                         │   │
│  │ - Device ID（移动设备）                                          │   │
│  │ - MAC 地址（局域网）                                             │   │
│  │ - 地理位置（GPS / IP 定位）                                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 设备指纹生成

```java
@Service
public class DeviceFingerprintService {
    
    /**
     * 生成设备指纹
     */
    public String generateFingerprint(HttpServletRequest request) {
        List&lt;String&gt; factors = new ArrayList&lt;&gt;();
        
        // 1. User-Agent
        factors.add(request.getHeader("User-Agent"));
        
        // 2. IP 地址
        factors.add(getClientIp(request));
        
        // 3. Accept-Language
        factors.add(request.getHeader("Accept-Language"));
        
        // 4. 屏幕分辨率（前端传入）
        String screen = request.getHeader("X-Screen-Resolution");
        if (screen != null) {
            factors.add(screen);
        }
        
        // 5. 时区（前端传入）
        String timezone = request.getHeader("X-Timezone");
        if (timezone != null) {
            factors.add(timezone);
        }
        
        // 6. Canvas Fingerprint（前端计算后传入）
        String canvasFp = request.getHeader("X-Canvas-Fingerprint");
        if (canvasFp != null) {
            factors.add(canvasFp);
        }
        
        // 合并并哈希
        String combined = String.join("|", factors);
        return sha256(combined);
    }
    
    /**
     * 获取客户端真实 IP
     */
    public String getClientIp(HttpServletRequest request) {
        String ip = request.getHeader("X-Forwarded-For");
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }
        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }
        
        // 多个 IP 时取第一个
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }
        
        return ip;
    }
    
    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

## Token 中绑定设备指纹

### 生成 Token 时绑定

```java
@Service
public class JwtService {
    
    /**
     * 生成 Token（包含设备指纹和 IP）
     */
    public String generateToken(UserDetails user, String deviceFingerprint, String clientIp) {
        Date now = new Date();
        Date expiry = new Date(now.getTime() + ACCESS_TOKEN_EXPIRATION);
        
        return Jwts.builder()
            .subject(user.getUsername())
            .claim("userId", getUserId(user))
            .claim("deviceFingerprint", deviceFingerprint)
            .claim("clientIp", clientIp)
            .claim("roles", extractRoles(user))
            .issuedAt(now)
            .expiration(expiry)
            .id(UUID.randomUUID().toString())
            .signWith(key)
            .compact();
    }
}
```

### 验证 Token 时检查

```java
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {
    
    @Autowired
    private DeviceFingerprintService fingerprintService;
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) {
        
        String token = extractToken(request);
        
        if (token != null) {
            try {
                Claims claims = jwtService.validateToken(token);
                
                // 1. 检查设备指纹
                String storedFingerprint = claims.get("deviceFingerprint", String.class);
                String currentFingerprint = fingerprintService.generateFingerprint(request);
                
                if (!storedFingerprint.equals(currentFingerprint)) {
                    // 设备指纹不匹配，可能是 Token 被盗用
                    log.warn("Device fingerprint mismatch for user: {}", claims.getSubject());
                    securityAlertService.sendAlert(claims.getSubject(), "设备指纹异常");
                    
                    // 可以选择拒绝访问或降级处理
                    // throw new SecurityException("设备指纹不匹配");
                }
                
                // 2. 检查 IP 地址
                String storedIp = claims.get("clientIp", String.class);
                String currentIp = fingerprintService.getClientIp(request);
                
                // IP 变化处理（可选，有些场景下 IP 会变）
                // if (!storedIp.equals(currentIp)) {
                //     // IP 变化告警
                // }
                
                // 3. 继续认证流程...
                
            } catch (JwtException e) {
                // Token 验证失败
                response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
                return;
            }
        }
        
        filterChain.doFilter(request, response);
    }
}
```

---

## 异常检测与告警

### 登录异常检测

```java
@Service
public class SecurityAlertService {
    
    @Autowired
    private AlertRepository alertRepository;
    
    @Autowired
    private EmailService emailService;
    
    @Autowired
    private SmsService smsService;
    
    /**
     * 发送安全告警
     */
    public void sendAlert(String username, String alertType) {
        User user = userRepository.findByUsername(username);
        
        // 1. 记录告警
        SecurityAlert alert = SecurityAlert.builder()
            .username(username)
            .alertType(alertType)
            .ipAddress(getCurrentIp())
            .userAgent(getCurrentUserAgent())
            .createdAt(new Date())
            .build();
        alertRepository.save(alert);
        
        // 2. 发送通知（根据配置）
        if (alertType.contains("设备指纹")) {
            // 设备异常，通过其他渠道通知
            smsService.send(user.getPhone(), "检测到您的账号在新设备登录，如非本人操作请立即修改密码");
        }
        
        if (alertType.contains("异地登录")) {
            // 异地登录告警
            emailService.send(user.getEmail(), 
                "检测到您的账号在异地登录，IP: " + getCurrentIp());
        }
    }
    
    /**
     * 检查登录异常
     */
    public void checkLoginAnomaly(String username, String ip) {
        // 1. 检查是否异地登录
        List&lt;String&gt; recentIps = getRecentLoginIps(username);
        if (!recentIps.contains(ip) && !recentIps.isEmpty()) {
            sendAlert(username, "异地登录: " + ip);
        }
        
        // 2. 检查是否新设备
        String fingerprint = deviceFingerprintService.generateFingerprint(request);
        List&lt;String&gt; knownDevices = getKnownDevices(username);
        if (!knownDevices.contains(fingerprint)) {
            sendAlert(username, "新设备登录");
        }
        
        // 3. 检查登录频率
        long loginCount = getRecentLoginCount(username, Duration.ofMinutes(5));
        if (loginCount > 5) {
            sendAlert(username, "异常登录频率");
        }
    }
}
```

---

## 风险控制模型

### 风险评分

```java
@Service
public class RiskControlService {
    
    /**
     * 计算请求风险分数
     * 
     * @return 风险分数 0-100
     */
    public int calculateRiskScore(HttpServletRequest request, String username) {
        int score = 0;
        
        // 1. IP 风险
        score += calculateIpRisk(request, username);
        
        // 2. 设备风险
        score += calculateDeviceRisk(request, username);
        
        // 3. 行为风险
        score += calculateBehaviorRisk(request, username);
        
        // 4. 时间风险
        score += calculateTimeRisk();
        
        return Math.min(score, 100);
    }
    
    /**
     * IP 风险评估
     */
    private int calculateIpRisk(HttpServletRequest request, String username) {
        String currentIp = fingerprintService.getClientIp(request);
        List&lt;String&gt; knownIps = getKnownIps(username);
        
        // IP 从未见过
        if (!knownIps.contains(currentIp) && !knownIps.isEmpty()) {
            return 30;
        }
        
        // IP 在黑名单
        if (ipBlacklistService.isBlacklisted(currentIp)) {
            return 100;
        }
        
        // IP 风险库
        if (ipRiskService.isHighRiskIp(currentIp)) {
            return 50;
        }
        
        return 0;
    }
    
    /**
     * 设备风险评估
     */
    private int calculateDeviceRisk(HttpServletRequest request, String username) {
        String fingerprint = fingerprintService.generateFingerprint(request);
        
        // 新设备
        if (!isKnownDevice(username, fingerprint)) {
            return 20;
        }
        
        return 0;
    }
    
    /**
     * 行为风险评估
     */
    private int calculateBehaviorRisk(HttpServletRequest request, String username) {
        // 短时间内大量请求
        long requestCount = getRequestCount(username, Duration.ofMinutes(1));
        if (requestCount > 100) {
            return 30;
        }
        
        // 敏感操作
        String uri = request.getRequestURI();
        if (uri.contains("/transfer") || uri.contains("/password")) {
            // 敏感操作需要更高信任度
            return 10;
        }
        
        return 0;
    }
    
    /**
     * 根据风险分数处理请求
     */
    public RiskAction handleRequest(HttpServletRequest request, String username) {
        int riskScore = calculateRiskScore(request, username);
        
        if (riskScore < 30) {
            // 低风险，放行
            return RiskAction.ALLOW;
        } else if (riskScore < 60) {
            // 中风险，需要额外验证
            return RiskAction.VERIFY;
        } else {
            // 高风险，拒绝
            securityAlertService.sendAlert(username, "高风险请求被拦截");
            return RiskAction.DENY;
        }
    }
}

public enum RiskAction {
    ALLOW,   // 放行
    VERIFY,  // 需要额外验证（如验证码）
    DENY     // 拒绝
}
```

---

## 前端配合

### 生成设备指纹

```javascript
// 前端生成设备指纹
async function generateDeviceFingerprint() {
    const components = [];
    
    // User-Agent
    components.push(navigator.userAgent);
    
    // 屏幕分辨率
    components.push(`${window.screen.width}x${window.screen.height}`);
    
    // 时区
    components.push(Intl.DateTimeFormat().resolvedOptions().timeZone);
    
    // 语言
    components.push(navigator.language);
    
    // Canvas Fingerprint
    try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('fingerprint', 2, 2);
        components.push(canvas.toDataURL());
    } catch (e) {
        components.push('canvas-not-available');
    }
    
    // WebGL 渲染器
    try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
            components.push(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL));
        }
    } catch (e) {
        components.push('webgl-not-available');
    }
    
    // 合并并哈希
    const combined = components.join('|');
    const hash = await crypto.subtle.digest('SHA-256', 
        new TextEncoder().encode(combined));
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 登录时发送设备指纹
async function login(username, password) {
    const fingerprint = await generateDeviceFingerprint();
    
    const response = await fetch('/auth/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Device-Fingerprint': fingerprint
        },
        body: JSON.stringify({ username, password })
    });
    
    return response.json();
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 如何防止 Token 被盗用？ | 安全机制 | 本篇 |
| 什么是设备指纹？ | 概念理解 | 本篇 |
| 如何实现登录异常检测？ | 实战能力 | 本篇 |
| 风险控制的模型是什么？ | 设计能力 | 本篇 |
| 如何平衡安全性与用户体验？ | 设计能力 | 本篇 |

---

## 总结

Token 防盗用的核心要点：

1. **设备指纹**：综合多种特征生成唯一标识
2. **IP 绑定**：Token 中记录签发时的 IP
3. **异常检测**：监控登录地点、设备、行为
4. **风险评分**：综合评估请求风险等级
5. **及时告警**：发现异常时通知用户

安全性和用户体验需要平衡，不要过度限制导致正常用户无法使用。

---

## 下一步

- 想了解 CSRF 防护？→ [CSRF 防护机制](/framework/springsecurity/csrf)
- 想了解 CORS 配置？→ [CORS 跨域与 Security 配置](/framework/springsecurity/cors)
- 想了解微服务安全？→ [Gateway 统一鉴权中心](/framework/springsecurity/gateway-auth)
