# 接口安全：签名验签、Token 认证、参数校验

你有没有想过这个问题：

你的 API 接口上线后，发现被大量爬虫抓取，被恶意攻击，甚至被未授权的第三方调用。

这是因为你的接口缺乏安全保障。

接口安全有三个支柱：**身份认证、完整性校验、防重放**。

## 接口安全的三大支柱

```
1. 身份认证：确认请求者是谁
2. 完整性校验：确认数据未被篡改
3. 防重放：确认请求不是旧请求的复制
```

## 签名验签

### 签名流程

```
1. 客户端：请求参数 + 时间戳 + 密钥 → MD5/SHA256 → 签名
2. 客户端：发送请求参数 + 签名 + 时间戳
3. 服务端：用相同算法验证签名
4. 服务端：检查时间戳是否过期
```

### 签名算法

```java
public class SignUtil {

    /**
     * 生成签名
     * @param params 请求参数
     * @param secret 密钥
     * @param timestamp 时间戳
     * @return 签名
     */
    public static String generateSign(Map&lt;String, String&gt; params, String secret, long timestamp) {
        // 1. 按字典序排序参数
        String sortedParams = params.entrySet().stream()
            .sorted(Map.Entry.comparingByKey())
            .map(e -> e.getKey() + "=" + e.getValue())
            .collect(Collectors.joining("&"));

        // 2. 拼接密钥
        String signString = sortedParams + "&timestamp=" + timestamp + "&secret=" + secret;

        // 3. SHA256 签名
        return sha256(signString);
    }

    /**
     * 验证签名
     */
    public static boolean verifySign(Map&lt;String, String&gt; params, String sign,
                                     String secret, long timestamp, long expireTime) {
        // 1. 检查时间戳是否过期
        if (System.currentTimeMillis() - timestamp > expireTime) {
            return false;
        }

        // 2. 计算签名
        String calculatedSign = generateSign(params, secret, timestamp);

        // 3. 比对签名
        return calculatedSign.equals(sign);
    }

    private static String sha256(String input) {
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

### 客户端调用

```java
public class ApiClient {

    private String appId;
    private String secret;

    public Response callApi(String url, Map&lt;String, String&gt; params) {
        // 1. 添加时间戳
        long timestamp = System.currentTimeMillis();
        params.put("appId", appId);
        params.put("timestamp", String.valueOf(timestamp));

        // 2. 生成签名
        String sign = SignUtil.generateSign(params, secret, timestamp);
        params.put("sign", sign);

        // 3. 发送请求
        return HttpClient.post(url, params);
    }
}
```

### 服务端验证

```java
@Component
public class SignInterceptor implements HandlerInterceptor {

    @Value("${api.sign.expire-time:300000}")
    private long expireTime;

    @Override
    public boolean preHandle(HttpServletRequest request,
                             HttpServletResponse response,
                             Object handler) throws Exception {
        String sign = request.getParameter("sign");
        String timestampStr = request.getParameter("timestamp");
        String appId = request.getParameter("appId");

        if (sign == null || timestampStr == null || appId == null) {
            response.getWriter().write("参数不完整");
            return false;
        }

        long timestamp = Long.parseLong(timestampStr);
        String secret = getSecretByAppId(appId);

        // 获取所有参数
        Map&lt;String, String&gt; params = new HashMap&lt;&gt;();
        request.getParameterMap().forEach((key, value) -> {
            params.put(key, value[0]);
        });

        // 验证签名
        if (!SignUtil.verifySign(params, sign, secret, timestamp, expireTime)) {
            response.getWriter().write("签名验证失败");
            return false;
        }

        return true;
    }
}
```

## Token 认证

### JWT 结构

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

三部分：Header.Payload.Signature

### JWT 实现

```java
public class JwtUtil {

    private static final String SECRET = "your-secret-key";
    private static final long EXPIRE_TIME = 86400000; // 24 小时

    public static String generateToken(User user) {
        Date now = new Date();
        Date expireDate = new Date(now.getTime() + EXPIRE_TIME);

        return Jwts.builder()
            .setSubject(user.getId().toString())
            .claim("username", user.getUsername())
            .claim("roles", user.getRoles())
            .setIssuedAt(now)
            .setExpiration(expireDate)
            .signWith(SignatureAlgorithm.HS256, SECRET.getBytes())
            .compact();
    }

    public static Claims parseToken(String token) {
        return Jwts.parser()
            .setSigningKey(SECRET.getBytes())
            .parseClaimsJws(token)
            .getBody();
    }

    public static boolean validateToken(String token) {
        try {
            parseToken(token);
            return true;
        } catch (Exception e) {
            return false;
        }
    }
}
```

### Spring Security 集成

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig extends WebSecurityConfigurerAdapter {

    @Override
    protected void configure(HttpSecurity http) throws Exception {
        http
            .csrf().disable()
            .authorizeRequests()
                .antMatchers("/api/public/**").permitAll()
                .antMatchers("/api/**").authenticated()
            .and()
            .addFilterBefore(new JwtAuthFilter(), UsernamePasswordAuthenticationFilter.class);
    }
}

@Component
public class JwtAuthFilter extends OncePerRequestFilter {

    @Autowired
    private JwtUtil jwtUtil;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain chain) throws ServletException, IOException {
        String token = request.getHeader("Authorization");

        if (token != null && token.startsWith("Bearer ")) {
            token = token.substring(7);

            if (jwtUtil.validateToken(token)) {
                Claims claims = jwtUtil.parseToken(token);
                String userId = claims.getSubject();
                // 设置认证信息
                SecurityContextHolder.getContext()
                    .setAuthentication(new UserIdAuthentication(userId));
            }
        }

        chain.doFilter(request, response);
    }
}
```

## 参数校验

### JSR-303 注解

```java
public class User {

    @NotNull(message = "用户名不能为空")
    @Size(min = 3, max = 20, message = "用户名长度 3-20 位")
    private String username;

    @NotBlank(message = "密码不能为空")
    @Size(min = 6, max = 20, message = "密码长度 6-20 位")
    private String password;

    @Email(message = "邮箱格式不正确")
    private String email;

    @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
    private String phone;

    @Min(value = 0, message = "年龄不能小于 0")
    @Max(value = 150, message = "年龄不能大于 150")
    private Integer age;
}
```

### 全局异常处理

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .map(FieldError::getDefaultMessage)
            .collect(Collectors.joining(", "));

        return Result.error(400, message);
    }

    @ExceptionHandler(BindException.class)
    public Result handleBindException(BindException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .map(FieldError::getDefaultMessage)
            .collect(Collectors.joining(", "));

        return Result.error(400, message);
    }
}
```

### Controller 使用

```java
@RestController
@RequestMapping("/api/user")
public class UserController {

    @PostMapping("/register")
    public Result register(@Valid @RequestBody User user) {
        userService.register(user);
        return Result.success();
    }

    @PostMapping("/login")
    public Result login(@Valid @RequestBody LoginRequest request) {
        String token = userService.login(request);
        return Result.success(Map.of("token", token));
    }
}
```

## 最佳实践

### 接口安全 checklist

```
1. HTTPS：所有接口使用 HTTPS
2. 签名验证：关键接口使用签名验签
3. Token 认证：用户相关接口使用 Token
4. 参数校验：所有入参进行校验
5. 限流：防止恶意刷接口
6. 日志：记录关键操作日志
7. 黑名单：封禁恶意 IP
```

### 密钥管理

```yaml
# 生产环境不要硬编码密钥
# 使用配置中心或密钥管理服务
spring:
  cloud:
    nacos:
      config:
        server-addr: localhost:8848
        data-id: api-secret
        group: SECRET_GROUP
```

## 总结

接口安全是系统的护城河：

- **签名验签**：防止数据篡改和重放攻击
- **Token 认证**：确认请求者身份
- **参数校验**：防止非法数据入侵

HTTPS + 签名 + Token + 参数校验 = 接口安全闭环。

**面试追问方向：**
- 签名算法中，为什么要把参数排序？
- 时间戳在防重放中的作用是什么？
- JWT 和 Session 各有什么优缺点？
- 如何防止 CSRF 攻击？