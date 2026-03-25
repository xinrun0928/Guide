# 表单登录：UsernamePasswordAuthenticationFilter 流程

你有没有想过，从点击登录按钮到进入首页，这中间 Spring Security 到底做了什么？

大多数人只知道配置一个 `.formLogin()`，然后写一个 Controller 接收用户名和密码。

但如果你想自定义登录逻辑（比如添加验证码、第三方登录、手机号登录），就必须深入理解 `UsernamePasswordAuthenticationFilter` 的工作原理。

今天，我们就来把这个流程讲透。

---

## 表单登录的完整流程

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           表单登录完整流程图                                 │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   用户浏览器                        Spring Security                          │
│   ─────────                        ──────────────                           │
│                                                                            │
│   ┌──────────────┐                                                       │
│   │ 登录页面     │  ① GET /login                                          │
│   │ &lt;form&gt;       │◄────────────────────────────────── 显示登录页         │
│   │   username   │                                                       │
│   │   password   │                                                       │
│   │   [登录]     │                                                       │
│   └──────┬───────┘                                                       │
│          │                                                                │
│          │ ② POST /login (username, password)                             │
│          │   _csrf_token=xxx                                               │
│          └─────────────────────────────────► 过滤器链                      │
│                                                   │                        │
│                                                   ▼                        │
│                                    ┌────────────────────────┐             │
│                                    │ UsernamePassword        │             │
│                                    │ AuthenticationFilter    │             │
│                                    │                        │             │
│                                    │ 1. 提取用户名和密码      │             │
│                                    │ 2. 构造 Authentication   │             │
│                                    │ 3. 调用 AuthenticationMgr │             │
│                                    └───────────┬────────────┘             │
│                                                │                          │
│                                                ▼                          │
│                                    ┌────────────────────────┐             │
│                                    │ AuthenticationProvider │             │
│                                    │                        │             │
│                                    │ 1. 加载 UserDetails     │             │
│                                    │ 2. 验证密码            │             │
│                                    │ 3. 检查账户状态         │             │
│                                    └───────────┬────────────┘             │
│                                                │                          │
│                              ┌─────────────────┼─────────────────┐       │
│                              │ 认证成功         │ 认证失败         │       │
│                              ▼                 ▼                  │       │
│                      ┌──────────────┐   ┌──────────────┐          │       │
│                      │ 保存 Security │   │ 抛异常        │          │       │
│                      │ Context      │   │ BadCred...   │          │       │
│                      └──────┬───────┘   └──────┬───────┘          │       │
│                             │                  │                  │       │
│                             ▼                  ▼                  │       │
│                      ┌────────────────────────────────┐            │       │
│                      │     跳转逻辑                     │            │       │
│                      │                                │            │       │
│                      │  defaultSuccessUrl → /home    │            │       │
│                      │  failureUrl → /login?error    │            │       │
│                      └────────────────────────────────┘            │       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## UsernamePasswordAuthenticationFilter 详解

### 过滤器源码解析

```java
public class UsernamePasswordAuthenticationFilter extends AbstractAuthenticationProcessingFilter {
    
    // 默认拦截的 URL
    public static final DEFAULT_FILTER_PROCESS_URI = "/login";
    
    // 请求参数名
    public static final SPRING_SECURITY_FORM_USERNAME_KEY = "username";
    public static final SPRING_SECURITY_FORM_PASSWORD_KEY = "password";
    
    // 核心方法：尝试认证
    @Override
    public Authentication attemptAuthentication(
            HttpServletRequest request, 
            HttpServletResponse response) throws AuthenticationException {
        
        // 1. 只处理 POST 请求
        if (!request.getMethod().equals("POST")) {
            throw new AuthenticationServiceException(
                "Authentication method not supported: " + request.getMethod());
        }
        
        // 2. 提取用户名
        String username = obtainUsername(request);
        if (StringUtils.isEmpty(username)) {
            username = "";
        }
        
        // 3. 提取密码
        String password = obtainPassword(request);
        if (StringUtils.isEmpty(password)) {
            password = "";
        }
        
        // 4. 去除首尾空格
        username = username.trim();
        password = password.trim();
        
        // 5. 构造未认证的 Authentication Token
        UsernamePasswordAuthenticationToken authRequest = 
            new UsernamePasswordAuthenticationToken(username, password);
        
        // 6. 设置详细信息（可选）
        setDetails(request, authRequest);
        
        // 7. 交给 AuthenticationManager 认证
        return this.getAuthenticationManager().authenticate(authRequest);
    }
}
```

### 认证成功处理

```java
// 认证成功的默认处理
public void setAuthenticationSuccessHandler(
        AuthenticationSuccessHandler successHandler) {
    this.successHandler = successHandler;
}
```

Spring Security 提供了几种内置的成功处理器：

```java
// 1. SimpleUrlAuthenticationSuccessHandler：跳转到指定页面
.formLogin(form -> form
    .successUrl("/home")  // 登录成功后跳转到 /home
)

// 2. SavedRequestAwareAuthenticationSuccessHandler：跳转回原始请求
.formLogin(form -> form
    .successHandler(new SavedRequestAwareAuthenticationSuccessHandler())
    // 用户访问 /admin 被拦截 → 跳转登录 → 登录成功后跳转 /admin
)

// 3. 自定义处理器
.formLogin(form -> form
    .successHandler((request, response, authentication) -> {
        // 返回 JSON 而不是跳转页面（API 场景）
        response.setContentType("application/json");
        response.getWriter().write("{\"code\": 0, \"message\": \"登录成功\"}");
    })
)
```

### 认证失败处理

```java
// 认证失败的默认处理
public void setAuthenticationFailureHandler(
        AuthenticationFailureHandler failureHandler) {
    this.failureHandler = failureHandler;
}
```

```java
// 1. SimpleUrlAuthenticationFailureHandler：跳转到错误页面
.formLogin(form -> form
    .failureUrl("/login?error")  // 登录失败后跳转到 /login 页面，显示错误
)

// 2. 自定义处理器
.formLogin(form -> form
    .failureHandler((request, response, exception) -> {
        String errorMsg;
        if (exception instanceof BadCredentialsException) {
            errorMsg = "用户名或密码错误";
        } else if (exception instanceof LockedException) {
            errorMsg = "账户已被锁定";
        } else if (exception instanceof DisabledException) {
            errorMsg = "账户已被禁用";
        } else {
            errorMsg = "登录失败";
        }
        
        response.setContentType("application/json");
        response.getWriter().write("{\"code\": 401, \"message\": \"" + errorMsg + "\"}");
    })
)
```

---

## 自定义登录配置

### 基础配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/register").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                // 自定义登录页路径
                .loginPage("/login")
                // 处理登录请求的 URL（Spring Security 会自动处理）
                .loginProcessingUrl("/doLogin")
                // 用户名参数名（对应表单的 name 属性）
                .usernameParameter("username")
                // 密码参数名
                .passwordParameter("password")
                // 登录成功跳转
                .defaultSuccessUrl("/home", true)
                // 登录失败跳转
                .failureUrl("/login?error")
                // 允许所有人访问登录页
                .permitAll()
            )
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl("/login?logout")
                .permitAll()
            )
            .csrf(csrf -> csrf.disable());  // API 场景可禁用
        
        return http.build();
    }
}
```

### 登录页面 HTML

```html
&lt;!-- Thymeleaf 模板 --&gt;
&lt;!DOCTYPE html&gt;
&lt;html xmlns:th="http://www.thymeleaf.org"&gt;
&lt;head&gt;
    &lt;title&gt;登录&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
    &lt;h1&gt;用户登录&lt;/h1&gt;
    
    &lt;!-- 错误信息 --&gt;
    &lt;p th:if="${param.error}" style="color: red"&gt;
        用户名或密码错误
    &lt;/p&gt;
    &lt;p th:if="${param.logout}" style="color: green"&gt;
        已退出登录
    &lt;/p&gt;
    
    &lt;!-- 登录表单 --&gt;
    &lt;form th:action="@{/doLogin}" method="post"&gt;
        &lt;div&gt;
            &lt;label&gt;用户名:&lt;/label&gt;
            &lt;input type="text" name="username" required/&gt;
        &lt;/div&gt;
        &lt;div&gt;
            &lt;label&gt;密码:&lt;/label&gt;
            &lt;input type="password" name="password" required/&gt;
        &lt;/div&gt;
        &lt;!-- CSRF Token（如果启用了 CSRF） --&gt;
        &lt;input type="hidden" th:name="${_csrf.parameterName}" 
               th:value="${_csrf.token}"/&gt;
        &lt;button type="submit"&gt;登录&lt;/button&gt;
    &lt;/form&gt;
&lt;/body&gt;
&lt;/html&gt;
```

---

## 高级配置：自定义认证逻辑

### 添加验证码校验

```java
// 验证码过滤器
public class CaptchaFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) 
        throws ServletException, IOException {
        
        // 只对登录请求做验证码校验
        if ("/doLogin".equals(request.getRequestURI()) && "POST".equals(request.getMethod())) {
            
            String captcha = request.getParameter("captcha");
            String sessionCaptcha = (String) request.getSession()
                .getAttribute("captcha");
            
            // 忽略大小写比较
            if (captcha == null || !captcha.equalsIgnoreCase(sessionCaptcha)) {
                response.sendRedirect("/login?error=captcha");
                return;
            }
        }
        
        filterChain.doFilter(request, response);
    }
}

// 配置到 SecurityFilterChain
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .addFilterBefore(captchaFilter(), UsernamePasswordAuthenticationFilter.class)
            // 或者使用验证码服务验证
            .addFilterBefore(new CaptchaValidationFilter(
                captchaService, 
                "/doLogin"
            ), UsernamePasswordAuthenticationFilter.class)
            // ... 其他配置
        ;
        return http.build();
    }
}
```

### 同一用户多设备登录控制

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                // 最大会话数 = 1
                .maximumSessions(1)
                // 超过后拒绝登录
                .maxSessionsPreventsLogin(true)
                // 自定义过期策略
                .expiredSessionStrategy(event -> {
                    event.getResponse().sendRedirect("/login?expired");
                })
            );
        
        return http.build();
    }
    
    @Bean
    public SessionRegistry sessionRegistry() {
        return new SessionRegistryImpl();
    }
}
```

### 登录限流

```java
// 登录限流过滤器
public class LoginRateLimitFilter extends OncePerRequestFilter {
    
    private final Map&lt;String, AtomicInteger&gt; attempts = new ConcurrentHashMap&lt;&gt;();
    private static final int MAX_ATTEMPTS = 5;
    private static final long LOCK_TIME = 15 * 60 * 1000; // 15分钟
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) 
        throws ServletException, IOException {
        
        if ("/doLogin".equals(request.getRequestURI()) && "POST".equals(request.getMethod())) {
            String username = request.getParameter("username");
            
            AtomicInteger count = attempts.computeIfAbsent(username, k -&gt; new AtomicInteger(0));
            
            if (count.incrementAndGet() &gt; MAX_ATTEMPTS) {
                response.setStatus(429);
                response.getWriter().write("{\"error\": \"登录尝试次数过多，请15分钟后再试\"}");
                return;
            }
        }
        
        filterChain.doFilter(request, response);
    }
}
```

---

## 前后端分离场景下的登录

### 后端返回 JSON

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login").permitAll()
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginProcessingUrl("/api/login")
                .successHandler((request, response, auth) -&gt; {
                    response.setContentType("application/json");
                    response.setCharacterEncoding("UTF-8");
                    Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
                    result.put("code", 200);
                    result.put("message", "登录成功");
                    result.put("username", auth.getName());
                    result.put("authorities", auth.getAuthorities());
                    response.getWriter().write(new ObjectMapper().writeValueAsString(result));
                })
                .failureHandler((request, response, ex) -&gt; {
                    response.setContentType("application/json");
                    response.setCharacterEncoding("UTF-8");
                    Map&lt;String, Object&gt; result = new HashMap&lt;&gt;();
                    result.put("code", 401);
                    result.put("message", "用户名或密码错误");
                    response.getWriter().write(new ObjectMapper().writeValueAsString(result));
                })
                .permitAll()
            )
            .csrf(csrf -> csrf.disable())
            .sessionManagement(session -&gt; session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
            );
        
        return http.build();
    }
}
```

### 登录接口响应示例

```json
// 登录成功
{
    "code": 200,
    "message": "登录成功",
    "username": "admin",
    "authorities": [
        {"authority": "ROLE_ADMIN"}
    ],
    "sessionId": "ABC123..."
}

// 登录失败
{
    "code": 401,
    "message": "用户名或密码错误"
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| UsernamePasswordAuthenticationFilter 的工作流程？ | 流程理解 | 本篇 |
| 登录成功/失败后如何自定义跳转逻辑？ | 配置能力 | 本篇 |
| 如何添加验证码校验？ | 扩展能力 | 本篇 |
| 前后端分离如何处理登录？ | 架构设计 | 本篇 |
| 如何实现登录限流？ | 安全实战 | 本篇 |
| CSRF Token 在表单登录中起什么作用？ | 安全机制 | CSRF 防护 |

---

## 总结

表单登录的核心流程：

1. **过滤器拦截**：`UsernamePasswordAuthenticationFilter` 捕获 POST /login 请求
2. **提取凭证**：获取用户名和密码
3. **构造 Token**：`UsernamePasswordAuthenticationToken`（未认证状态）
4. **认证调度**：`AuthenticationManager` 找到合适的 `AuthenticationProvider`
5. **密码校验**：`DaoAuthenticationProvider` 调用 `UserDetailsService` + `PasswordEncoder`
6. **状态检查**：检查账户是否启用、是否锁定等
7. **结果处理**：成功跳转或失败跳转

理解了这个流程，你就可以在此基础上添加验证码、限流、第三方登录等各种扩展功能。

---

## 下一步

- 想了解会话管理？→ [Session 会话管理](/framework/springsecurity/session)
- 想实现「记住我」？→ [Remember-Me 功能](/framework/springsecurity/remember-me)
- 想实现短信登录？→ [短信验证码登录](/framework/springsecurity/sms-login)
- 想实现无状态认证？→ [JWT 无状态认证](/framework/springsecurity/jwt-filter)
