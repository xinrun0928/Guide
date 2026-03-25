# Spring Security 过滤器链

你有没有想过这个问题：为什么 Spring Security 的配置叫 `SecurityFilterChain`？Filter（过滤器）和 Chain（链）分别代表什么？

很多人在学 Spring Security 时，直接跳过了过滤器链的原理，结果配置了一大堆 `addFilterBefore` / `addFilterAfter`，却不知道自己加到了哪里。

今天，我们就来揭开过滤器链的神秘面纱。

---

## 过滤器链的本质

Spring Security 的安全控制，**全部依赖 Servlet Filter 实现**。

Filter 是 Java Web 开发中最基础的组件，它可以在请求到达 Servlet 之前拦截处理，也可以在响应返回之前做后置处理。

Spring Security 的过滤器链，就是一连串 Filter 的有序组合：

```
请求 → [Filter1] → [Filter2] → [Filter3] → ... → [FilterN] → Servlet
              ↑
         每个 Filter 都可以：
         1. 放行（chain.doFilter）
         2. 拦截（返回错误响应）
         3. 修改请求/响应
```

---

## Spring Security 默认过滤器链

Spring Security 6.x 默认配置的过滤器链，按顺序如下：

### 第一阶段：安全上下文初始化

```
┌────────────────────────────────────────────────────────────────────┐
│ SecurityContextPersistenceFilter                                   │
│                                                                    │
│ 作用：为每个请求创建独立的 SecurityContext                          │
│                                                                    │
│ - 第一个访问的请求：创建空的 SecurityContext                        │
│ - 后续请求：从 Session 中恢复 SecurityContext                       │
│ - 请求结束：如果是 HTTP Session 模式，会保存到 Session               │
│                                                                    │
│ 关键点：如果使用 JWT 无状态认证，这个 Filter 的行为需要覆盖          │
└────────────────────────────────────────────────────────────────────┘
```

### 第二阶段：认证相关过滤器

```
┌────────────────────────────────────────────────────────────────────┐
│ LogoutFilter                                                       │
│                                                                    │
│ 作用：处理登出请求                                                  │
│                                                                    │
│ 默认拦截路径：/logout                                               │
│ 处理逻辑：                                                          │
│   1. 清除 SecurityContext                                           │
│   2. 销毁 Session                                                   │
│   3. 清除 Remember-Me Cookie                                       │
│   4. 重定向到登录页或自定义页面                                     │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ UsernamePasswordAuthenticationFilter                               │
│                                                                    │
│ 作用：处理表单登录                                                  │
│                                                                    │
│ 默认拦截路径：/login（POST）                                        │
│ 处理逻辑：                                                          │
│   1. 从请求中提取 username 和 password                              │
│   2. 封装成 UsernamePasswordAuthenticationToken                     │
│   3. 交给 AuthenticationManager 认证                                │
│   4. 认证成功：保存到 SecurityContext + Session                     │
│   5. 认证失败：清除 SecurityContext                                 │
│                                                                    │
│ 可自定义：登录路径、用户名参数名、密码参数名、成功/失败处理器        │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ ConcurrentSessionFilter                                             │
│                                                                    │
│ 作用：控制同一账号的并发会话数                                       │
│                                                                    │
│ 检查逻辑：                                                          │
│   1. 每次认证成功后，检查当前用户的会话数                            │
│   2. 如果超过最大会话数：                                          │
│      - 默认：踢掉之前的会话（后者挤掉前者）                         │
│      - 配置 errorIfMaximumExceeded = true：拒绝登录                │
│                                                                    │
│ 依赖 SessionRegistry 管理会话信息                                   │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ RememberMeAuthenticationFilter                                      │
│                                                                    │
│ 作用：处理"记住我"功能                                              │
│                                                                    │
│ 触发条件：                                                          │
│   1. 用户没有通过常规认证（Session 中无 Authentication）           │
│   2. 请求中携带 Remember-Me Cookie                                 │
│                                                                    │
│ 处理逻辑：                                                          │
│   1. 从 Cookie 中提取 token                                        │
│   2. 验证 token 合法性（签名 + 过期时间）                           │
│   3. 通过 token 从数据库/内存获取用户信息                           │
│   4. 构建已认证的 Authentication                                    │
│   5. 保存到 SecurityContext                                         │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ AnonymousAuthenticationFilter                                       │
│                                                                    │
│ 作用：为未认证请求创建匿名 Authentication                           │
│                                                                    │
│ 为什么需要匿名 Authentication？                                     │
│   - SecurityMetadataSource 需要判断：资源要求什么权限               │
│   - 匿名用户 vs 已认证用户 vs 已记住用户 → 权限要求不同             │
│   - 匿名 Authentication 的 authorities 中只有一个 ANONYMOUS 角色    │
│                                                                    │
│ 配置方式：                                                          │
│   .anonymous()
│       .authorities("ROLE_ANONYMOUS")
│       .principal("anonymousUser")                                  │
└────────────────────────────────────────────────────────────────────┘
```

### 第三阶段：授权相关过滤器

```
┌────────────────────────────────────────────────────────────────────┐
│ ExceptionTranslationFilter                                          │
│                                                                    │
│ 作用：捕获安全相关的异常，转换为 HTTP 响应                          │
│                                                                    │
│ 处理的异常：                                                         │
│   - AuthenticationException → 401 / 跳转到登录页                   │
│   - AccessDeniedException → 403 / 自定义 403 页面                  │
│                                                                    │
│ 关键点：这个 Filter 在 AuthorizationFilter 之后执行                 │
└────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────┐
│ AuthorizationFilter（Spring Security 6.x 新名，原 SecurityInterceptor│
│                                                                    │
│ 作用：核心授权决策                                                  │
│                                                                    │
│ 执行流程：                                                          │
│   1. 获取当前请求对应的权限配置（ConfigAttribute）                   │
│   2. 获取当前用户的 Authentication                                  │
│   3. 调用 AccessDecisionManager 决策                               │
│   4. 决策通过：放行                                                 │
│   5. 决策拒绝：抛 AccessDeniedException                            │
│                                                                    │
│ 决策流程图：                                                        │
│                                                                    │
│   用户访问 /admin/user                      SecurityMetadataSource │
│         │                                   ┌─────────────────┐     │
│         │──────────→ 获取所需权限 ────────→│ /admin/* → ROLE_ADMIN ││
│         │                                   └─────────────────┘     │
│         │                                          │                │
│         │                    ┌──────────────────────┘                │
│         ▼                    ▼                                       │
│   AccessDecisionManager ◄────┐                                        │
│   ┌────────────────────────────────────┐                              │
│   │ WebExpressionVoter                 │                              │
│   │   hasRole('ADMIN')  ──→ ?         │                              │
│   └────────────────────────────────────┘                              │
│                    │                                                  │
│                    ▼                                                  │
│              决策结果                                                 │
│         ┌─────────┴─────────┐                                        │
│         ▼                   ▼                                        │
│    ACCESS_GRANTED      ACCESS_DENIED                                 │
│         │                   │                                         │
│         ▼                   ▼                                         │
│    放行请求            抛 AccessDeniedException                       │
└────────────────────────────────────────────────────────────────────┘
```

---

## SecurityFilterChain：过滤器链的组装

`SecurityFilterChain` 是 Spring Security 6.x 中的核心接口，它定义了「一条」完整的过滤器链：

```java
public interface SecurityFilterChain {
    // 返回该链包含的所有过滤器
    List&lt;Filter&gt; getFilters();
    
    // 判断这个请求是否使用该过滤器链
    boolean matches(HttpServletRequest request);
}
```

为什么需要这个接口？因为 Spring Security 支持**多条**过滤器链，针对不同的请求走不同的链。

### 多过滤器链的场景

```
请求路径：/api/**
    │
    ▼
Matcher：SecurityFilterChain[0].matches("/api/**") = true
    │
    ▼
    ┌──────────────────────────────────────────┐
    │ 过滤器链 0：API 专用链                      │
    │ - JWT 认证过滤器（替代表单登录）           │
    │ - 无 CSRF 防护                            │
    │ - CORS 配置                               │
    └──────────────────────────────────────────┘
    
────────────────────────────────────────────────

请求路径：/admin/**
    │
    ▼
Matcher：SecurityFilterChain[1].matches("/admin/**") = true
    │
    ▼
    ┌──────────────────────────────────────────┐
    │ 过滤器链 1：后台管理链                      │
    │ - 表单登录 + Session                      │
    │ - 需要 CSRF 防护                          │
    │ - 需要更强壮的认证                        │
    └──────────────────────────────────────────┘

────────────────────────────────────────────────

请求路径：/static/**
    │
    ▼
Matcher：SecurityFilterChain[2].matches("/static/**") = false
    │
    ▼
    ┌──────────────────────────────────────────┐
    │ 默认链：静态资源                           │
    │ - 跳过认证（permitAll）                   │
    └──────────────────────────────────────────┘
```

### 自定义 SecurityFilterChain

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 1. 配置过滤器链
            .addFilterBefore(myCustomFilter(), BasicAuthenticationFilter.class)
            .addFilterAfter(corsFilter(), ChannelProcessingFilter.class)
            
            // 2. 配置哪些路径需要认证
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            
            // 3. 配置登录方式
            .formLogin(form -> form
                .loginPage("/login")
                .defaultSuccessUrl("/home")
            );
        
        return http.build();
    }
}
```

---

## FilterChainProxy：过滤器链的分派器

`FilterChainProxy` 是 Spring Security 的入口 Filter，它的作用是：根据请求找到对应的 `SecurityFilterChain`，然后执行这条链上的所有过滤器：

```java
public class FilterChainProxy extends GenericFilterBean {
    
    private List&lt;SecurityFilterChain&gt; filterChains;
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        
        // 1. 找到匹配的过滤器链
        SecurityFilterChain chainToUse = null;
        for (SecurityFilterChain filterChain : filterChains) {
            if (filterChain.matches(httpRequest)) {
                chainToUse = filterChain;
                break;
            }
        }
        
        // 2. 如果没有匹配的链，使用默认行为
        if (chainToUse == null) {
            chainToUse = noFilterChain;
        }
        
        // 3. 执行该链上的所有过滤器
        chainToUse.getFilters().forEach(filter -> {
            filter.doFilter(request, response, chainToUse);
        });
    }
}
```

### 过滤器链的匹配顺序

`FilterChainProxy` 是按 **first-match** 策略匹配的——第一个匹配的过滤器链生效。

这意味着：**更具体的路径要放在前面，更通用的路径要放在后面**。

```java
// 错误顺序：/api/** 会先匹配，后面的 /api/admin/** 永远不会被匹配
.filterChains(
    apiSecurityFilterChain(),   // 匹配 /api/**
    adminSecurityFilterChain()  // 想匹配 /api/admin/**，但永远到不了
);

// 正确顺序：更具体的放在前面
.filterChains(
    adminSecurityFilterChain(), // 先匹配 /api/admin/**
    apiSecurityFilterChain()     // 再匹配 /api/**
);
```

---

## DelegatingFilterProxy：Spring 与 Servlet 的桥梁

`DelegatingFilterProxy` 是 Spring MVC 提供的，不是 Spring Security 的核心。

它的作用是：**让标准 Servlet Filter 能够委托给 Spring Bean 来处理**：

```
请求 → DelegatingFilterProxy → FilterChainProxy → SecurityFilterChain → Servlet
              │                     ↑
              │                     │
              │              实际处理逻辑在 Spring Bean 中
              │
              ↓
      找名为 "springSecurityFilterChain" 的 Bean
```

Spring Boot 自动配置会自动注册这个 Filter，所以大多数情况下你不需要关心它。

---

## 过滤器链执行顺序图

完整版 Spring Security 过滤器链执行顺序：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Spring Security Filter Chain                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 1. WebAsyncManagerIntegrationFilter                                │  │
│  │    - 集成 WebAsyncManager，支持异步请求的 SecurityContext 传递       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 2. SecurityContextPersistenceFilter                               │  │
│  │    - 从 Session 恢复/创建 SecurityContext                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 3. HeaderWriterFilter                                              │  │
│  │    - 添加安全相关的 HTTP 头（X-Frame-Options, CSP 等）              │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 4. CorsFilter                                                      │  │
│  │    - 处理跨域请求                                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 5. LogoutFilter                                                     │  │
│  │    - 处理登出请求                                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 6. UsernamePasswordAuthenticationFilter                            │  │
│  │    - 处理表单登录                                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 7. ConcurrentSessionFilter                                          │  │
│  │    - 控制并发会话                                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 8. BasicAuthenticationFilter                                        │  │
│  │    - 处理 HTTP Basic 认证                                           │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 9. RequestCacheAwareFilter                                          │  │
│  │    - 保存/恢复 请求缓存（用于登录后跳转原页面）                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 10. SecurityContextHolderAwareRequestFilter                        │  │
│  │     - 包装 HttpServletRequest，支持 Security 相关的增强方法          │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 11. AnonymousAuthenticationFilter                                  │  │
│  │     - 为未认证请求创建匿名 Authentication                            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 12. SessionManagementFilter                                         │  │
│  │     - Session 管理（固定会话攻击防护等）                            │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 13. ExceptionTranslationFilter                                      │  │
│  │     - 转换安全异常为 HTTP 响应                                      │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 14. AuthorizationFilter                                             │  │
│  │     - 权限校验，最终放行或拒绝                                       │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    │                                    │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ 15. FilterSecurityInterceptor                                       │  │
│  │     - Spring Security 5.x 中的权限拦截器（6.x 已合并到 AuthorizationFilter）│
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 自定义过滤器的添加位置

Spring Security 提供了几个添加自定义过滤器的位置：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 方式一：在某个过滤器之前添加
            .addFilterBefore(captchaFilter(), UsernamePasswordAuthenticationFilter.class)
            
            // 方式二：在某个过滤器之后添加
            .addFilterAfter(corsFilter(), SecurityContextHolderAwareRequestFilter.class)
            
            // 方式三：替换某个过滤器
            .addFilterAt(jwtFilter(), UsernamePasswordAuthenticationFilter.class)
            
            // 方式四：只添加一次（用于自定义认证过滤器）
            .addFilter(new JwtAuthenticationFilter());
        
        return http.build();
    }
}
```

| 方法 | 位置 | 场景 |
|-----|------|-----|
| addFilterBefore | 在指定过滤器之前 | 验证码、请求日志等 |
| addFilterAfter | 在指定过滤器之后 | 修改响应、审计日志等 |
| addFilterAt | 替换指定过滤器 | 完全接管某个过滤器的职责 |

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| Spring Security 有多少个默认过滤器？顺序是什么？ | 过滤器链记忆 | 本篇 |
| 为什么过滤器链的顺序很重要？ | 理解 Filter 机制 | 本篇 |
| FilterChainProxy 和 SecurityFilterChain 的区别？ | 架构理解 | 本篇 |
| 如何自定义一个过滤器并加入链中？ | 实战能力 | JWT 过滤器 |
| 如果想跳过所有过滤器访问某个接口，怎么配置？ | 配置能力 | permitAll |

---

## 总结

Spring Security 的过滤器链，是理解整个框架的钥匙：

1. **FilterChainProxy** 是入口，根据请求匹配对应的 SecurityFilterChain
2. **SecurityFilterChain** 是一组有序的 Filter，按顺序执行
3. **过滤器链可以有多条**，通过 matches() 方法匹配不同的请求
4. **顺序很重要**：更具体的过滤器链要放在前面

理解了过滤器链，再去看自定义认证、JWT 集成、OAuth2 登录，都会清晰很多。

---

## 下一步

- 想深入理解配置方式？→ [WebSecurityConfigurerAdapter 配置演进](/framework/springsecurity/config-adapter)
- 想实现无状态认证？→ [JWT 无状态认证流程设计](/framework/springsecurity/jwt-filter)
- 想了解完整认证流程？→ [认证与授权核心流程](/framework/springsecurity/core-flow)
