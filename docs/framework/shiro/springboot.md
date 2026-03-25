# Shiro + Spring Boot 快速集成：ShiroFilterFactoryBean

理论讲完了，该动手实践了。

这一节，我们把 Shiro 集成到 Spring Boot 项目中，从零开始跑通登录流程。

## 快速开始

### 添加依赖

```xml
<dependency>
    <groupId>org.apache.shiro</groupId>
    <artifactId>shiro-spring-boot-web-starter</artifactId>
    <version>1.13.0</version>
</dependency>
```

`spring-boot-starter` 会自动引入：
- Shiro Core
- Shiro Web
- Shiro Spring 集成
- Spring Boot 自动配置

### 基础配置

在 `application.yml` 中添加配置：

```yaml
shiro:
  web:
    enabled: true
  loginUrl: /login
  successUrl: /index
  unauthorizedUrl: /403
  
  # Session 配置
  session:
    timeout: 1800000  # 30 分钟
    cookie:
      max-age: 1800000
```

### 创建 ShiroConfig

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(Realm realm) {
        DefaultWebSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        return manager;
    }
    
    @Bean
    public Realm realm() {
        // 使用之前定义的 CustomRealm
        return new CustomRealm();
    }
    
    @Bean
    public ShiroFilterChainDefinition shiroFilterChainDefinition() {
        DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
        
        chain.addPathDefinition("/static/**", "anon");
        chain.addPathDefinition("/login", "anon");
        chain.addPathDefinition("/logout", "logout");
        chain.addPathDefinition("/**", "authc");
        
        return chain;
    }
}
```

**一个最简单的 Shiro + Spring Boot 项目就跑起来了**。

## ShiroFilterFactoryBean 配置

`ShiroFilterFactoryBean` 是 Shiro 在 Spring Boot 中的入口，负责配置过滤规则。

### 基本配置

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    
    // 设置 SecurityManager
    factory.setSecurityManager(manager);
    
    // 设置登录页面
    factory.setLoginUrl("/login");
    
    // 设置登录成功后的跳转页面
    factory.setSuccessUrl("/index");
    
    // 设置未授权页面
    factory.setUnauthorizedUrl("/403");
    
    // 设置过滤器链
    factory.setFilterChainDefinitionMap(filterChainDefinitionMap());
    
    return factory;
}

private Map<String, String> filterChainDefinitionMap() {
    Map<String, String> filterChain = new LinkedHashMap<>();
    
    // 静态资源不过滤
    filterChain.put("/css/**", "anon");
    filterChain.put("/js/**", "anon");
    filterChain.put("/images/**", "anon");
    
    // 登录页面不过滤
    filterChain.put("/login", "anon");
    filterChain.put("/register", "anon");
    
    // 登出
    filterChain.put("/logout", "logout");
    
    // 其他请求需要认证
    filterChain.put("/**", "authc");
    
    return filterChain;
}
```

### 使用 Map Bean 配置

```java
@Bean
public ShiroFilterChainDefinition shiroFilterChainDefinition() {
    ShiroFilterChainDefinition chain = new DefaultShiroFilterChain();
    
    chain.addPathDefinition("/css/**", "anon");
    chain.addPathDefinition("/js/**", "anon");
    chain.addPathDefinition("/login", "anon");
    chain.addPathDefinition("/logout", "logout");
    chain.addPathDefinition("/**", "authc");
    
    return chain;
}
```

## 完整配置类

```java
@Configuration
public class ShiroConfig {
    
    /**
     * 配置 SecurityManager
     */
    @Bean
    public SecurityManager securityManager(Realm customRealm) {
        DefaultWebSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(customRealm);
        
        // 配置 SessionManager
        manager.setSessionManager(sessionManager());
        
        // 配置 RememberMeManager
        manager.setRememberMeManager(rememberMeManager());
        
        return manager;
    }
    
    /**
     * 自定义 Realm
     */
    @Bean
    public CustomRealm customRealm() {
        CustomRealm realm = new CustomRealm();
        
        // 配置缓存
        realm.setCacheManager(cacheManager());
        
        // 配置密码加密
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        realm.setCredentialsMatcher(matcher);
        
        return realm;
    }
    
    /**
     * SessionManager
     */
    @Bean
    public DefaultWebSessionManager sessionManager() {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);  // 30 分钟
        sessionManager.setSessionValidationSchedulerEnabled(true);
        sessionManager.setSessionDAO(sessionDAO());
        return sessionManager;
    }
    
    /**
     * SessionDAO
     */
    @Bean
    public SessionDAO sessionDAO() {
        EnterpriseCacheSessionDAO sessionDAO = new EnterpriseCacheSessionDAO();
        sessionDAO.setActiveSessionsCacheName("shiro-session");
        return sessionDAO;
    }
    
    /**
     * RememberMeManager
     */
    @Bean
    public CookieRememberMeManager rememberMeManager() {
        CookieRememberMeManager manager = new CookieRememberMeManager();
        
        SimpleCookie cookie = new SimpleCookie("rememberMe");
        cookie.setHttpOnly(true);
        cookie.setMaxAge(7 * 24 * 60 * 60);  // 7 天
        manager.setCookie(cookie);
        
        // 设置加密密钥
        manager.setCipherKey(Base64.getDecoder().decode(
            "YourBase64EncodedCipherKey=="));
        
        return manager;
    }
    
    /**
     * CacheManager
     */
    @Bean
    public CacheManager cacheManager() {
        return new EhCacheManager();
    }
    
    /**
     * Shiro 过滤器链
     */
    @Bean
    public ShiroFilterChainDefinition shiroFilterChainDefinition() {
        DefaultShiroFilterChain chain = new DefaultShiroFilterChain();
        
        chain.addPathDefinition("/static/**", "anon");
        chain.addPathDefinition("/login", "anon");
        chain.addPathDefinition("/logout", "logout");
        chain.addPathDefinition("/admin/**", "authc, roles[admin]");
        chain.addPathDefinition("/**", "authc");
        
        return chain;
    }
    
    /**
     * 开启 Shiro 注解
     */
    @Bean
    public AuthorizationAttributeSourceAdvisor authorizationAttributeSourceAdvisor(
            SecurityManager securityManager) {
        AuthorizationAttributeSourceAdvisor advisor = 
            new AuthorizationAttributeSourceAdvisor();
        advisor.setSecurityManager(securityManager);
        return advisor;
    }
    
    @Bean
    @ConditionalOnMissingBean
    public DefaultAdvisorAutoProxyCreator defaultAdvisorAutoProxyCreator() {
        DefaultAdvisorAutoProxyCreator creator = new DefaultAdvisorAutoProxyCreator();
        creator.setProxyTargetClass(true);
        return creator;
    }
}
```

## 登录控制器

```java
@Controller
public class LoginController {
    
    @Autowired
    private SecurityManager securityManager;
    
    @GetMapping("/login")
    public String loginPage() {
        return "login";
    }
    
    @PostMapping("/login")
    public String login(String username, String password, 
                        boolean rememberMe, Model model) {
        
        Subject subject = SecurityUtils.getSubject();
        
        if (!subject.isAuthenticated()) {
            UsernamePasswordToken token = 
                new UsernamePasswordToken(username, password, rememberMe);
            
            try {
                subject.login(token);
                
                // 登录成功后，可以重定向到之前请求的页面
                String callbackUrl = (String) 
                    subject.getSession().getAttribute("callbackUrl");
                if (callbackUrl != null) {
                    subject.getSession().removeAttribute("callbackUrl");
                    return "redirect:" + callbackUrl;
                }
                
                return "redirect:/index";
                
            } catch (AuthenticationException e) {
                model.addAttribute("error", "用户名或密码错误");
                return "login";
            }
        }
        
        return "redirect:/index";
    }
    
    @GetMapping("/logout")
    public String logout() {
        Subject subject = SecurityUtils.getSubject();
        subject.logout();
        return "redirect:/login";
    }
    
    @GetMapping("/403")
    public String unauthorized() {
        return "403";
    }
}
```

## 登录页面

```html
<!DOCTYPE html>
<html>
<head>
    <title>登录</title>
    <link rel="stylesheet" href="/css/login.css">
</head>
<body>
    <div class="login-container">
        <h2>用户登录</h2>
        
        <form action="/login" method="post">
            <div class="form-group">
                <label>用户名</label>
                <input type="text" name="username" required>
            </div>
            
            <div class="form-group">
                <label>密码</label>
                <input type="password" name="password" required>
            </div>
            
            <div class="form-group">
                <label>
                    <input type="checkbox" name="rememberMe"> 记住我
                </label>
            </div>
            
            <div class="form-group">
                <button type="submit">登录</button>
            </div>
            
            <div th:if="${error}" class="error" th:text="${error}">
                <!-- 错误信息 -->
            </div>
        </form>
    </div>
</body>
</html>
```

## 拦截器配置（可选）

如果需要更灵活的拦截控制，可以使用 Spring 的拦截器：

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new LoginInterceptor())
            .addPathPatterns("/**")
            .excludePathPatterns("/login", "/static/**");
    }
}

public class LoginInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response, 
                            Object handler) throws Exception {
        
        Subject subject = SecurityUtils.getSubject();
        
        if (!subject.isAuthenticated()) {
            // 保存原始请求
            subject.getSession().setAttribute("callbackUrl", 
                request.getRequestURI());
            
            response.sendRedirect("/login");
            return false;
        }
        
        return true;
    }
}
```

## 异常处理

```java
@ControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(AuthenticationException.class)
    public String handleAuthException(AuthenticationException e) {
        return "redirect:/login?error=" + e.getMessage();
    }
    
    @ExceptionHandler(UnauthorizedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public String handleUnauthorizedException(UnauthorizedException e) {
        return "403";
    }
}
```

## 常见问题

### 问题一：ShiroFilterFactoryBean 和 ShiroFilterChainDefinition 冲突

```java
// 错误：同时使用两种方式配置
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean() { ... }

@Bean
public ShiroFilterChainDefinition shiroFilterChainDefinition() { ... }
```

**正确**：选择一种方式，推荐使用 `ShiroFilterChainDefinition`。

### 问题二：注解不生效

```java
// 检查是否配置了这两个 Bean
@Bean
public AuthorizationAttributeSourceAdvisor advisor(SecurityManager manager) {
    return new AuthorizationAttributeSourceAdvisor() {{ setSecurityManager(manager); }};
}

@Bean
public DefaultAdvisorAutoProxyCreator proxyCreator() {
    return new DefaultAdvisorAutoProxyCreator() {{ setProxyTargetClass(true); }};
}
```

### 问题三：静态资源被拦截

```java
// 确保静态资源路径配置正确
chain.addPathDefinition("/static/**", "anon");
chain.addPathDefinition("/css/**", "anon");
chain.addPathDefinition("/js/**", "anon");
```

---

## 留给你的问题

ShiroFilterFactoryBean 里的 `anon`、`authc`、`logout` 是什么？

下一节，我们来学习 Shiro 的过滤器链——这些过滤器是如何协作的。
