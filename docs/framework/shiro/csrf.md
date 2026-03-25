# Shiro CSRF 防护与 URL 过滤策略

安全永远是 Web 应用的底线。

认证和授权做好了，但如果被 CSRF 攻击，一切努力可能付诸东流。

这一节，我们来学习 Shiro 的 CSRF 防护与 URL 过滤策略。

## CSRF 是什么？

CSRF（Cross-Site Request Forgery，跨站请求伪造）是一种攻击方式：

```
用户已登录银行网站 bank.com
         │
         ▼
攻击者诱骗用户访问 evil.com
         │
         ▼
evil.com 中暗藏请求：<img src="bank.com/transfer?to=hacker&amount=10000">
         │
         ▼
浏览器自动携带 bank.com 的 Cookie
         │
         ▼
银行服务器以为是用户操作，执行转账！
```

## Shiro 的 CSRF 防护

### 1. 使用 Shiro 的 FormAuthenticationFilter

`FormAuthenticationFilter` 默认会验证请求中的 Token：

```java
public class FormAuthenticationFilter extends AuthenticatingFilter {
    
    // 验证 CSRF Token
    protected boolean onAccessDenied(ServletRequest request, 
                                     ServletResponse response) throws Exception {
        
        // 获取请求中的 token 参数
        String token = WebUtils.getCleanParam(request, "csrf_token");
        
        // 获取 Session 中的 token
        String sessionToken = (String) 
            SecurityUtils.getSubject().getSession()
                .getAttribute("csrf_token");
        
        // 验证
        if (token == null || !token.equals(sessionToken)) {
            // CSRF 攻击，拒绝请求
            response.sendError(403);
            return false;
        }
        
        return super.onAccessDenied(request, response);
    }
}
```

### 2. Shiro 1.x 内置的 CsrfFilter

Shiro 1.12.0+ 内置了 CSRF 过滤器：

```java
// 启用 CSRF 过滤器
@Bean
public ShiroFilterChainDefinition shiroFilterChainDefinition() {
    DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
    
    // 公开接口不需要 CSRF
    chain.addPathDefinition("/login", "anon");
    
    // 其他请求启用 CSRF 保护
    chain.addPathDefinition("/**", "csrf");
    
    return chain;
}
```

## 自定义 CSRF 过滤器

### 生成 CSRF Token

```java
@Service
public class CsrfTokenService {
    
    /**
     * 生成 CSRF Token
     */
    public String generateToken(HttpSession session) {
        String token = UUID.randomUUID().toString().replace("-", "");
        session.setAttribute("csrf_token", token);
        return token;
    }
    
    /**
     * 验证 CSRF Token
     */
    public boolean validateToken(HttpSession session, String token) {
        String sessionToken = (String) session.getAttribute("csrf_token");
        return token != null && token.equals(sessionToken);
    }
}
```

### CSRF 过滤器实现

```java
public class CsrfFilter extends AdviceFilter {
    
    private CsrfTokenService csrfTokenService;
    
    @Override
    protected boolean preHandle(ServletRequest request, ServletResponse response) 
            throws Exception {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        
        // 1. 获取请求方法
        String method = httpRequest.getMethod().toUpperCase();
        
        // 2. GET、HEAD、OPTIONS 请求不需要验证
        if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method)) {
            return true;
        }
        
        // 3. 获取请求中的 Token
        String token = httpRequest.getHeader("X-CSRF-Token");
        if (token == null) {
            token = httpRequest.getParameter("_csrf");
        }
        
        // 4. 验证 Token
        if (!csrfTokenService.validateToken(
                httpRequest.getSession(false), token)) {
            
            httpResponse.setStatus(HttpServletResponse.SC_FORBIDDEN);
            httpResponse.setContentType("application/json;charset=UTF-8");
            httpResponse.getWriter().write(
                "{\"code\":403,\"msg\":\"CSRF验证失败\"}");
            return false;
        }
        
        return true;
    }
}
```

### 在 Shiro 中注册

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    factory.setSecurityManager(manager);
    
    // 注册 CSRF 过滤器
    Map<String, Filter> filters = new HashMap<>();
    filters.put("csrf", csrfFilter());
    factory.setFilters(filters);
    
    // 配置过滤器链
    Map<String, String> chain = new LinkedHashMap<>();
    chain.put("/login", "anon");
    chain.put("/static/**", "anon");
    chain.put("/**", "csrf,authc");
    
    factory.setFilterChainDefinitionMap(chain);
    
    return factory;
}

@Bean
public CsrfFilter csrfFilter() {
    CsrfFilter filter = new CsrfFilter();
    filter.setCsrfTokenService(csrfTokenService());
    return filter;
}
```

## 前端集成

### 生成 Token

```jsp
<%@ page contentType="text/html;charset=UTF-8" %>
<shiro:authenticated>
    <input type="hidden" name="_csrf" value="${csrf_token}" />
</shiro:authenticated>
```

### 页面模板（Thymeleaf）

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<head>
    <meta name="_csrf" th:content="${_csrf.token}"/>
    <meta name="_csrf_header" th:content="${_csrf.headerName}"/>
</head>
<body>
    <form action="/user/update" method="post">
        <input type="hidden" th:name="${_csrf.parameterName}" 
               th:value="${_csrf.token}" />
        <!-- 其他表单字段 -->
    </form>
    
    <script th:inline="javascript">
        // Ajax 请求携带 CSRF Token
        var csrfToken = $("meta[name='_csrf']").attr("content");
        var csrfHeader = $("meta[name='_csrf_header']").attr("content");
        
        $.ajaxSetup({
            beforeSend: function(xhr, settings) {
                xhr.setRequestHeader(csrfHeader, csrfToken);
            }
        });
    </script>
</body>
</html>
```

## URL 过滤策略

### 过滤链配置原则

```java
@Bean
public ShiroFilterChainDefinition shiroFilterChainDefinition() {
    DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
    
    // 1. 静态资源放行（最优先）
    chain.addPathDefinition("/static/**", "anon");
    chain.addPathDefinition("/css/**", "anon");
    chain.addPathDefinition("/js/**", "anon");
    chain.addPathDefinition("/images/**", "anon");
    
    // 2. 公开接口
    chain.addPathDefinition("/api/public/**", "anon");
    chain.addPathDefinition("/login", "anon");
    chain.addPathDefinition("/register", "anon");
    chain.addPathDefinition("/captcha", "anon");
    
    // 3. 登出
    chain.addPathDefinition("/logout", "logout");
    
    // 4. 需要特定角色的接口
    chain.addPathDefinition("/admin/**", "authc, roles[admin]");
    chain.addPathDefinition("/manager/**", "authc, roles[manager,admin]");
    
    // 5. 需要特定权限的接口
    chain.addPathDefinition("/user/create", "authc, perms[user:create]");
    chain.addPathDefinition("/user/delete/**", "authc, perms[user:delete]");
    
    // 6. 需要认证的接口（兜底）
    chain.addPathDefinition("/**", "authc");
    
    return chain;
}
```

### 过滤链配置要点

1. **顺序很重要**：配置顺序决定匹配顺序
2. **范围小的放前面**：如 `/admin/**` 放在 `/**` 前面
3. **静态资源放行**：避免每次请求都走认证逻辑

### 动态路径变量

对于 `/user/123` 这种动态路径，需要在代码中校验：

```java
@PostMapping("/user/{id}")
@RequiresPermissions("user:update")
public Result<Void> updateUser(@PathVariable Long id) {
    Subject subject = SecurityUtils.getSubject();
    
    // 获取当前用户
    String username = (String) subject.getPrincipal();
    User currentUser = userService.findByUsername(username);
    
    // 校验：只有本人或管理员才能修改
    if (!currentUser.getId().equals(id) && !subject.hasRole("admin")) {
        throw new UnauthorizedException("您没有权限修改此用户");
    }
    
    // 执行更新逻辑
    return Result.success();
}
```

## 常见攻击防护

### 1. XSS 防护

```java
public class XssFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request, 
                                    HttpServletResponse response, 
                                    FilterChain filterChain) 
            throws ServletException, IOException {
        
        // 使用包装器过滤 XSS
        filterChain.doFilter(new XssRequestWrapper(request), response);
    }
}

public class XssRequestWrapper extends HttpServletRequestWrapper {
    
    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        return xssEncode(value);
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
    
    private String xssEncode(String value) {
        if (value == null) {
            return null;
        }
        return value.replace("<", "&lt;")
                    .replace(">", "&gt;")
                    .replace("\"", "&quot;")
                    .replace("'", "&#x27;");
    }
}
```

### 2. SQL 注入防护

```java
// 使用参数化查询
@Select("SELECT * FROM users WHERE username = #{username}")
User findByUsername(@Param("username") String username);

// 禁止拼接 SQL
// 错误：
// "SELECT * FROM users WHERE username = '" + username + "'"
```

### 3. HTTP 头安全

```java
@Configuration
public class SecurityHeadersConfig {
    
    @Bean
    public FilterRegistrationBean<SecurityHeadersFilter> securityHeadersFilter() {
        FilterRegistrationBean<SecurityHeadersFilter> registration = 
            new FilterRegistrationBean<>();
        
        registration.setFilter(new SecurityHeadersFilter());
        registration.addUrlPatterns("/*");
        
        return registration;
    }
}

public class SecurityHeadersFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, 
                         FilterChain chain) throws IOException, ServletException {
        
        HttpServletResponse httpResponse = (HttpServletResponse) response;
        
        // 防止 XSS
        httpResponse.setHeader("X-Content-Type-Options", "nosniff");
        httpResponse.setHeader("X-XSS-Protection", "1; mode=block");
        
        // 防止点击劫持
        httpResponse.setHeader("X-Frame-Options", "DENY");
        
        // HTTPS 强制
        httpResponse.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
        
        // Content Security Policy
        httpResponse.setHeader("Content-Security-Policy", 
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
        
        chain.doFilter(request, response);
    }
}
```

## 安全配置清单

| 配置项 | 说明 | 建议 |
|-------|------|------|
| CSRF Token | 防止跨站请求伪造 | 必须启用 |
| HTTP Only Cookie | 防止 JavaScript 读取 | 必须启用 |
| Secure Cookie | 只在 HTTPS 下传输 | 必须启用 |
| X-Frame-Options | 防止点击劫持 | 必须启用 |
| X-Content-Type-Options | 防止 MIME 类型嗅探 | 必须启用 |
| HSTS | 强制使用 HTTPS | 推荐启用 |
| CSP | 内容安全策略 | 推荐启用 |

## 面试追问方向

**面试官可能会问**：

1. **什么是 CSRF？如何防护？**
   - CSRF 是跨站请求伪造
   - 防护方法：CSRF Token、Referer 验证、SameSite Cookie

2. **Shiro 的 CSRF 过滤器怎么配置？**
   - 在过滤链中添加 `csrf` 过滤器

3. **Cookie 的 SameSite 属性有什么作用？**
   - 防止 CSRF 攻击
   - `Strict`：完全禁止跨站
   - `Lax`：允许导航带来的 GET 请求
   - `None`：不限制（需要配合 Secure）

4. **XSS 和 CSRF 的区别？**
   - XSS：盗取用户信息
   - CSRF：伪造用户请求

---

## 留给你的问题

CSRF 防护只是 Web 安全的一小部分。

完整的 Web 安全还需要考虑什么？

下一节，我们来学习 Shiro 面试高频问题汇总——把 Shiro 的知识点串起来。
