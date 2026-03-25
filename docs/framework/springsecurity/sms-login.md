# 短信验证码登录：AuthenticationProvider 自定义扩展

你有没有想过，为什么很多电商网站的登录方式是「手机号 + 短信验证码」而不是传统的「用户名 + 密码」？

答案很简单：**短信登录更方便，用户不需要记密码；而且验证码一次一用，安全性更高。**

今天，我们就来深入了解如何在 Spring Security 中实现短信验证码登录。

---

## 短信登录 vs 密码登录

```
┌─────────────────────────────────────────────────────────────────────┐
│                      短信登录 vs 密码登录                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  密码登录：                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  用户输入密码 ──► 与数据库密码比对 ──► 成功/失败              │   │
│  │                                                               │   │
│  │  优点：可离线验证                                             │   │
│  │  缺点：密码可能泄露、用户需记住                               │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  短信登录：                                                          │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  1. 输入手机号 ──► 2. 获取验证码 ──► 3. 提交验证码            │   │
│  │                                       │                      │   │
│  │                                       ▼                      │   │
│  │                          4. 验证验证码正确性                  │   │
│  │                                       │                      │   │
│  │                                       ▼                      │   │
│  │                          5. 成功/失败                         │   │
│  │                                                               │   │
│  │  优点：无需记密码、验证码一次一用                             │   │
│  │  缺点：依赖短信服务、成本较高、用户需带手机                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 短信登录的实现原理

### 核心思路

短信登录不是替换密码登录，而是新增一种认证方式。Spring Security 的 `AuthenticationProvider` 机制允许我们添加多种认证方式。

### 需要实现的关键组件

| 组件 | 作用 | 类比密码登录 |
|-----|------|-------------|
| SmsAuthenticationToken | 封装认证凭证 | UsernamePasswordAuthenticationToken |
| SmsAuthenticationFilter | 捕获登录请求 | UsernamePasswordAuthenticationFilter |
| SmsAuthenticationProvider | 执行认证逻辑 | DaoAuthenticationProvider |
| SmsCodeService | 发送短信验证码 | - |
| SmsCodeCache | 缓存验证码 | - |

---

## 自定义 SmsAuthenticationToken

```java
/**
 * 短信认证 Token
 * 
 * 与 UsernamePasswordAuthenticationToken 类似
 * 第一阶段：只有手机号（未认证）
 * 第二阶段：完整的 Authentication（已认证）
 */
public class SmsAuthenticationToken extends AbstractAuthenticationToken {
    
    private final Object principal;  // 手机号
    
    // 第一阶段构造方法：未认证状态
    public SmsAuthenticationToken(String mobile) {
        super(null);
        this.principal = mobile;
        setAuthenticated(false);  // 标记为未认证
    }
    
    // 第二阶段构造方法：已认证状态
    public SmsAuthenticationToken(Object principal, 
                                 Collection&lt;? extends GrantedAuthority&gt; authorities) {
        super(authorities);
        this.principal = principal;
        setAuthenticated(true);   // 标记为已认证
    }
    
    @Override
    public Object getCredentials() {
        // 短信登录不需要凭证（验证码已验证）
        return null;
    }
    
    @Override
    public Object getPrincipal() {
        return this.principal;
    }
}
```

---

## 自定义 SmsAuthenticationFilter

```java
/**
 * 短信认证过滤器
 * 
 * 拦截短信登录请求，提取手机号和验证码
 */
public class SmsAuthenticationFilter extends AbstractAuthenticationProcessingFilter {
    
    // 请求参数名
    private static final String MOBILE_PARAM = "mobile";
    private static final String SMS_CODE_PARAM = "smsCode";
    
    public SmsAuthenticationFilter() {
        // 拦截路径
        super(new AntPathRequestMatcher("/login/sms", "POST"));
    }
    
    @Override
    public Authentication attemptAuthentication(
            HttpServletRequest request,
            HttpServletResponse response) throws AuthenticationException {
        
        // 1. 提取手机号
        String mobile = request.getParameter(MOBILE_PARAM);
        if (mobile == null || mobile.isEmpty()) {
            throw new AuthenticationServiceException("手机号不能为空");
        }
        
        // 2. 提取短信验证码
        String smsCode = request.getParameter(SMS_CODE_PARAM);
        if (smsCode == null || smsCode.isEmpty()) {
            throw new AuthenticationServiceException("验证码不能为空");
        }
        
        // 3. 构造未认证的 Token
        SmsAuthenticationToken authRequest = new SmsAuthenticationToken(mobile);
        
        // 4. 设置验证码详情（用于 Provider 验证）
        setDetails(request, authRequest);
        
        // 5. 交给 AuthenticationManager 处理
        return this.getAuthenticationManager().authenticate(authRequest);
    }
    
    private void setDetails(HttpServletRequest request,
                           SmsAuthenticationToken authRequest) {
        authRequest.setDetails(
            authenticationDetailsSource.buildDetails(request)
        );
    }
}
```

---

## 自定义 SmsAuthenticationProvider

```java
/**
 * 短信认证 Provider
 * 
 * 验证短信验证码是否正确
 */
public class SmsAuthenticationProvider implements AuthenticationProvider {
    
    private UserDetailsService userDetailsService;
    
    public SmsAuthenticationProvider(UserDetailsService userDetailsService) {
        this.userDetailsService = userDetailsService;
    }
    
    @Override
    public Authentication authenticate(Authentication authentication) 
            throws AuthenticationException {
        
        // 1. 获取手机号
        String mobile = (String) authentication.getPrincipal();
        
        // 2. 验证短信验证码（在过滤器中已完成，这里只需校验是否通过）
        SmsAuthenticationToken smsToken = (SmsAuthenticationToken) authentication;
        if (!smsToken.isAuthenticated()) {
            throw new AuthenticationServiceException("验证码校验失败");
        }
        
        // 3. 通过手机号加载用户信息
        UserDetails userDetails = userDetailsService.loadUserByMobile(mobile);
        
        if (userDetails == null) {
            // 用户不存在，可以选择自动注册或抛出异常
            // 这里选择自动注册
            userDetails = autoRegister(mobile);
        }
        
        // 4. 构造已认证的 Token
        SmsAuthenticationToken authenticatedToken = 
            new SmsAuthenticationToken(
                userDetails,
                null,
                userDetails.getAuthorities()
            );
        
        return authenticatedToken;
    }
    
    @Override
    public boolean supports(Class&lt;?&gt; authentication) {
        // 只处理 SmsAuthenticationToken
        return SmsAuthenticationToken.class.isAssignableFrom(authentication);
    }
    
    // 自动注册新用户
    private UserDetails autoRegister(String mobile) {
        // 实际项目中应该调用 UserService 进行注册
        return User.builder()
            .username(mobile)
            .password("")  // 短信登录不需要密码
            .authorities("ROLE_USER")
            .build();
    }
}
```

---

## 短信验证码服务

```java
/**
 * 短信验证码服务
 */
@Service
public class SmsCodeService {
    
    // 使用 Redis 存储验证码
    @Autowired
    private RedisTemplate&lt;String, String&gt; redisTemplate;
    
    // 短信发送器（实际项目中注入第三方 SDK）
    @Autowired
    private SmsSender smsSender;
    
    private static final String SMS_CODE_PREFIX = "sms:code:";
    private static final long SMS_CODE_EXPIRE = 5 * 60;  // 5 分钟
    
    /**
     * 发送验证码
     */
    public void sendCode(String mobile) {
        // 1. 检查发送频率（如 60 秒内不能重复发送）
        String lastSendKey = SMS_CODE_PREFIX + "last:" + mobile;
        String lastSend = redisTemplate.opsForValue().get(lastSendKey);
        if (lastSend != null) {
            throw new RuntimeException("发送太频繁，请稍后再试");
        }
        
        // 2. 生成 6 位验证码
        String code = String.format("%06d", new Random().nextInt(1000000));
        
        // 3. 存储验证码（附带错误次数计数）
        String codeKey = SMS_CODE_PREFIX + mobile;
        Map&lt;String, String&gt; codeData = new HashMap&lt;&gt;();
        codeData.put("code", code);
        codeData.put("count", "0");
        redisTemplate.opsForHash().putAll(codeKey, codeData);
        redisTemplate.expire(codeKey, SMS_CODE_EXPIRE, TimeUnit.SECONDS);
        
        // 4. 记录最后发送时间
        redisTemplate.opsForValue().set(lastSendKey, "1", 60, TimeUnit.SECONDS);
        
        // 5. 发送短信
        smsSender.send(mobile, "您的验证码是：" + code + "，5分钟内有效");
    }
    
    /**
     * 验证验证码
     */
    public boolean verifyCode(String mobile, String code) {
        String codeKey = SMS_CODE_PREFIX + mobile;
        
        // 1. 检查验证码是否存在
        if (!Boolean.TRUE.equals(redisTemplate.hasKey(codeKey))) {
            return false;
        }
        
        // 2. 获取存储的验证码和错误次数
        Map&lt;Object, Object&gt; codeData = redisTemplate.opsForHash().entries(codeKey);
        String storedCode = (String) codeData.get("code");
        int errorCount = Integer.parseInt((String) codeData.get("count"));
        
        // 3. 检查错误次数
        if (errorCount >= 3) {
            // 错误次数过多，删除验证码
            redisTemplate.delete(codeKey);
            throw new RuntimeException("验证码错误次数过多，请重新获取");
        }
        
        // 4. 验证码匹配
        if (storedCode.equals(code)) {
            // 验证成功，删除验证码
            redisTemplate.delete(codeKey);
            return true;
        } else {
            // 验证失败，增加错误次数
            redisTemplate.opsForHash().increment(codeKey, "count", 1);
            return false;
        }
    }
}
```

---

## 配置 SecurityFilterChain

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private CustomUserDetailsService userDetailsService;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login/sms", "/sms/send").permitAll()
                .requestMatchers("/login/**").permitAll()
                .anyRequest().authenticated()
            )
            // 表单登录（用户名密码）
            .formLogin(form -> form
                .loginPage("/login")
                .loginProcessingUrl("/login")
                .permitAll()
            )
            // 短信登录（核心配置）
            .addFilterAfter(smsAuthenticationFilter(), 
                UsernamePasswordAuthenticationFilter.class)
            // CSRF（短信登录场景可适当放宽）
            .csrf(csrf -> csrf
                .ignoringRequestMatchers("/login/sms", "/sms/send")
            );
        
        return http.build();
    }
    
    @Bean
    public SmsAuthenticationFilter smsAuthenticationFilter() throws Exception {
        SmsAuthenticationFilter filter = new SmsAuthenticationFilter();
        filter.setAuthenticationManager(
            authenticationManager()
        );
        return filter;
    }
    
    @Bean
    public AuthenticationManager authenticationManager(
            AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
    
    @Bean
    public AuthenticationProvider smsAuthenticationProvider() {
        return new SmsAuthenticationProvider(userDetailsService);
    }
}
```

---

## 登录 Controller

```java
@RestController
public class AuthController {
    
    @Autowired
    private SmsCodeService smsCodeService;
    
    /**
     * 发送短信验证码
     */
    @PostMapping("/sms/send")
    public Result&lt;Void&gt; sendSmsCode(@RequestParam String mobile) {
        // 参数校验
        if (!isValidMobile(mobile)) {
            return Result.fail("手机号格式不正确");
        }
        
        try {
            smsCodeService.sendCode(mobile);
            return Result.success();
        } catch (RuntimeException e) {
            return Result.fail(e.getMessage());
        }
    }
    
    /**
     * 短信登录（由 SmsAuthenticationFilter 拦截处理）
     * 这里提供一个测试接口
     */
    @PostMapping("/login/sms")
    public Result&lt;Object&gt; smsLogin(
            @RequestParam String mobile,
            @RequestParam String smsCode) {
        // 注意：实际登录由 SmsAuthenticationFilter 处理
        // 这个 Controller 仅用于演示
        return Result.success("登录成功");
    }
    
    private boolean isValidMobile(String mobile) {
        return mobile != null && mobile.matches("^1[3-9]\\d{9}$");
    }
}
```

---

## 前端登录页面

```html
&lt;!-- 短信登录表单 --&gt;
&lt;div class="sms-login"&gt;
    &lt;h3&gt;短信验证码登录&lt;/h3&gt;
    &lt;form id="smsLoginForm"&gt;
        &lt;div&gt;
            &lt;label&gt;手机号:&lt;/label&gt;
            &lt;input type="text" name="mobile" id="mobile" placeholder="请输入手机号"/&gt;
        &lt;/div&gt;
        &lt;div&gt;
            &lt;label&gt;验证码:&lt;/label&gt;
            &lt;input type="text" name="smsCode" placeholder="请输入验证码"/&gt;
            &lt;button type="button" id="sendBtn" onclick="sendCode()"&gt;获取验证码&lt;/button&gt;
        &lt;/div&gt;
        &lt;button type="submit"&gt;登录&lt;/button&gt;
    &lt;/form&gt;
&lt;/div&gt;

&lt;script&gt;
// 发送验证码
function sendCode() {
    const mobile = document.getElementById('mobile').value;
    fetch('/sms/send?mobile=' + mobile, {
        method: 'POST'
    }).then(response => response.json())
      .then(data => {
          if (data.code === 200) {
              alert('验证码已发送');
              // 开始倒计时
              let countdown = 60;
              const btn = document.getElementById('sendBtn');
              const timer = setInterval(() =&gt; {
                  btn.disabled = true;
                  btn.textContent = countdown + '秒后重试';
                  countdown--;
                  if (countdown &lt; 0) {
                      clearInterval(timer);
                      btn.disabled = false;
                      btn.textContent = '获取验证码';
                  }
              }, 1000);
          } else {
              alert(data.message);
          }
      });
}

// 表单提交
document.getElementById('smsLoginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    const formData = new FormData(this);
    fetch('/login/sms', {
        method: 'POST',
        body: formData
    }).then(response => response.json())
      .then(data => {
          if (data.code === 200) {
              window.location.href = '/home';
          } else {
              alert(data.message);
          }
      });
});
&lt;/script&gt;
```

---

## 完整的认证流程图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          短信登录完整流程                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         阶段一：发送验证码                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  用户输入手机号 ──► 点击"获取验证码" ──► /sms/send                     │
│                                              │                          │
│                                              ▼                          │
│                                   SmsCodeService                        │
│                                              │                          │
│                                              ▼                          │
│                                   生成 6 位验证码                        │
│                                              │                          │
│                                              ▼                          │
│                                   存入 Redis（5分钟过期）               │
│                                              │                          │
│                                              ▼                          │
│                                   调用短信网关发送                       │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                         阶段二：提交登录                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  用户输入验证码 ──► 点击"登录" ──► POST /login/sms                      │
│                                              │                          │
│                                              ▼                          │
│  SmsAuthenticationFilter                      │                          │
│       │                                        │                          │
│       │ 提取 mobile 和 smsCode                  │                          │
│       │                                        │                          │
│       ▼                                        ▼                          │
│  SmsAuthenticationToken ──► AuthenticationManager                      │
│                                             │                            │
│                                             ▼                            │
│                                  SmsAuthenticationProvider              │
│                                             │                            │
│                                             ▼                            │
│                                  验证 Redis 中的验证码                    │
│                                             │                            │
│                                    ┌─────────┴─────────┐                 │
│                                    │ 验证通过           │ 验证失败        │
│                                    ▼                   ▼                 │
│                          加载用户信息           抛异常                    │
│                                    │                                       │
│                                    ▼                                       │
│                          返回已认证的 Authentication                      │
│                                    │                                       │
│                                    ▼                                       │
│                          保存到 SecurityContext                          │
│                                    │                                       │
│                                    ▼                                       │
│                          重定向到首页                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 短信登录和密码登录的区别？ | 原理理解 | 本篇 |
| 如何防止短信验证码被暴力破解？ | 安全机制 | 本篇 |
| 为什么要实现 AuthenticationProvider 而不是直接修改 Filter？ | 架构设计 | 本篇 |
| 验证码为什么要存在 Redis 而不是 Session？ | 技术选型 | 本篇 |
| 如何防止恶意刷短信？ | 安全实战 | 本篇 |

---

## 总结

短信登录的实现要点：

1. **核心组件**：SmsAuthenticationToken、Filter、Provider
2. **认证流程**：Filter 捕获请求 → Provider 验证 → SecurityContext 保存
3. **验证码存储**：Redis，支持过期、限流、错误计数
4. **安全措施**：发送频率限制、错误次数限制、一次性使用
5. **与表单登录共存**：通过不同的 Filter 拦截不同的登录路径

短信登录和密码登录可以共存于同一系统，用户可以根据场景选择不同的登录方式。

---

## 下一步

- 想实现第三方登录？→ [OAuth2 登录](/framework/springsecurity/oauth2-login)
- 想实现单点登录？→ [CAS 单点登录集成](/framework/springsecurity/cas)
- 想了解完整的认证体系？→ [认证与授权核心流程](/framework/springsecurity/core-flow)
