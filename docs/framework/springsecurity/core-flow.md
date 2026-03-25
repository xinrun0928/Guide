# Spring Security 认证与授权核心流程

你有没有想过，当你在登录框输入用户名和密码，点击登录按钮之后，Spring Security 背后到底发生了什么？

大多数人会说：「就是验证用户名密码是否正确呗。」

但如果你深入追问：密码存在哪里？加密方式是什么？登录状态怎么保持？权限信息怎么传递？——很多人就答不上来了。

今天，我们就来揭开 Spring Security 认证授权的神秘面纱。

---

## 核心概念：Authentication 与 Authorization

在深入源码之前，必须先把两个核心概念搞清楚：

| 概念 | 全称 | 含义 | 类比 |
|-----|------|------|-----|
| Authentication | 认证 | **你是谁**？验证用户身份 | 出示身份证 |
| Authorization | 授权 | **你能做什么**？判断用户权限 | 景区门票（只有买了票才能进） |

> 很多人容易搞混这两个概念。简单记忆：**先认证（证明你是谁），再授权（决定你能做什么）**。

---

## 认证流程：六步走

Spring Security 的认证流程，可以用一句话概括：

**「过滤器捕获请求 → AuthenticationManager 调度 → AuthenticationProvider 具体验证 → SecurityContext 存储结果 → 过滤器放行/拦截」**

下面我们一步步拆解：

### 第一步：过滤器捕获请求

当用户提交登录表单时，请求首先被 `UsernamePasswordAuthenticationFilter` 捕获：

```java
public class UsernamePasswordAuthenticationFilter extends AbstractAuthenticationProcessingFilter {
    
    public Authentication attemptAuthentication(HttpServletRequest request,
                                                HttpServletResponse response) {
        // 1. 从请求中提取用户名和密码
        String username = obtainUsername(request);
        String password = obtainPassword(request);
        
        // 2. 封装成 UsernamePasswordAuthenticationToken（未认证状态）
        UsernamePasswordAuthenticationToken authRequest = 
            new UsernamePasswordAuthenticationToken(username, password);
        
        // 3. 交给 AuthenticationManager 处理
        return this.getAuthenticationManager().authenticate(authRequest);
    }
}
```

关键点：`UsernamePasswordAuthenticationToken` 有两个构造方法，状态不同：

```java
// 未认证状态（第一阶段）：只有用户名密码
new UsernamePasswordAuthenticationToken(username, password);

// 已认证状态（第二阶段）：包含用户信息和权限
new UsernamePasswordAuthenticationToken(
    principal,     // 用户信息（UserDetails）
    credentials,  // 凭证（通常为空）
    authorities    // 权限列表
);
```

### 第二步：AuthenticationManager 调度

`AuthenticationManager` 是认证的总入口，它本身不做事，而是找到合适的 `AuthenticationProvider` 来处理：

```java
public interface AuthenticationManager {
    Authentication authenticate(Authentication authentication) 
        throws AuthenticationException;
}

// Spring Security 默认实现：尝试所有 Provider，直到有一个成功
public class ProviderManager implements AuthenticationManager {
    private List&lt;AuthenticationProvider&gt; providers;
    
    @Override
    public Authentication authenticate(Authentication authentication) {
        for (AuthenticationProvider provider : providers) {
            if (provider.supports(authToken.getClass())) {
                result = provider.authenticate(authToken);
                // 成功则返回，失败会继续尝试其他 Provider
            }
        }
        return result;
    }
}
```

### 第三步：AuthenticationProvider 具体验证

`AuthenticationProvider` 才是真正做事的人。最常用的是 `DaoAuthenticationProvider`：

```java
public class DaoAuthenticationProvider extends AbstractUserDetailsAuthenticationProvider {
    
    @Override
    protected void additionalAuthenticationChecks(
            UserDetails userDetails,
            UsernamePasswordAuthenticationToken authentication) {
        
        // 密码校验：使用 PasswordEncoder
        String providedPassword = authentication.getCredentials().toString();
        String storedPassword = userDetails.getPassword();
        
        if (!passwordEncoder.matches(providedPassword, storedPassword)) {
            throw new BadCredentialsException("密码错误");
        }
    }
}
```

### 第四步：UserDetailsService 加载用户

密码校验之前，需要先通过 `UserDetailsService` 加载用户信息：

```java
public interface UserDetailsService {
    // 根据用户名加载用户信息
    UserDetails loadUserByUsername(String username) throws UsernameNotFoundException;
}

// 常见的实现：JdbcDaoImpl, InMemoryUserDetailsManager
// 自定义实现：从数据库加载
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserMapper userMapper;
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }
        
        // 转换为 Spring Security 需要的 UserDetails
        return org.springframework.security.core.userdetails.User
            .withUsername(user.getUsername())
            .password(user.getPassword())
            .authorities("ROLE_USER")
            .build();
    }
}
```

### 第五步：SecurityContext 存储结果

认证成功后，结果会被存储到 `SecurityContext` 中，供后续请求使用：

```java
// 认证成功后，SecurityContext 被填充
SecurityContext context = SecurityContextHolder.createEmptyContext();
context.setAuthentication(authentication);  // 放入已认证的 Authentication
SecurityContextHolder.setContext(context);

// SecurityContext 的存储策略（默认是线程级别）
SecurityContextHolder.setStrategyName(
    SecurityContextHolder.GLOBAL_SESSION_STRATEGY
);
```

### 第六步：过滤器决定放行或拦截

认证完成后，`FilterSecurityInterceptor`（最后一个安全过滤器）根据认证结果决定是否放行：

```java
public class FilterSecurityInterceptor extends AbstractSecurityInterceptor 
    implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        
        // 1. 获取认证信息
        Authentication authenticated = SecurityContextHolder
            .getContext().getAuthentication();
        
        // 2. 访问决策：用户是否有权限访问该资源
        AccessDecisionResult result = accessDecisionManager.decide(
            authenticated, 
            object,      // 拦截的请求
            attributes    // 该请求需要的权限
        );
        
        // 3. 决策通过，放行
        chain.doFilter(request, response);
    }
}
```

---

## 授权流程：权限校验三要素

认证解决的是「你是谁」，授权解决的「你能做什么」。

Spring Security 的授权依赖于三个核心组件：

| 组件 | 作用 | 可扩展点 |
|-----|------|---------|
| SecurityMetadataSource | 加载资源对应的权限要求 | 从数据库/配置文件加载 |
| AccessDecisionManager | 决策是否允许访问 | 自定义投票器 |
| AccessDecisionVoter | 投票判断 | 自定义投票逻辑 |

### 默认决策流程

```java
// AffirmativeBased：任意一个 Voter 通过即可
public class AffirmativeBased extends AbstractAccessDecisionManager {
    
    @Override
    public void decide(Authentication authentication, 
                       Object object, 
                       List&lt;ConfigAttribute&gt; attributes) {
        for (AccessDecisionVoter&lt;?&gt; voter : getDecisionVoters()) {
            int result = voter.vote(authentication, object, attributes);
            if (result == ACCESS_GRANTED) {
                return;  // 有 Voter 同意，直接放行
            }
        }
        // 所有 Voter 都拒绝，抛异常
        throw new AccessDeniedException("无权限访问");
    }
}
```

---

## 完整请求生命周期

把上面的流程串起来，就是一次完整请求在 Spring Security 中的生命周期：

```
┌─────────────────────────────────────────────────────────────────────┐
│                          HTTP 请求                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. Security Context 初始化（SecurityContextPersistenceFilter）      │
│    - 为请求创建空的 SecurityContext                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. Session 并发控制（ConcurrentSessionFilter）                      │
│    - 检查同一用户是否超过最大会话数                                  │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 认证信息处理                                                     │
│    ┌────────────────────────────────────────────────────────────┐   │
│    │ 3.1 Remember-Me 认证（RememberMeAuthenticationFilter）    │   │
│    │     - 如果没有表单认证，检查 Cookie 中的 token              │   │
│    └────────────────────────────────────────────────────────────┘   │
│    ┌────────────────────────────────────────────────────────────┐   │
│    │ 3.2 表单认证（UsernamePasswordAuthenticationFilter）        │   │
│    │     - 登录请求 → AuthenticationManager → UserDetailsService│   │
│    │     - 认证成功 → SecurityContextHolder 保存结果             │   │
│    └────────────────────────────────────────────────────────────┘   │
│    ┌────────────────────────────────────────────────────────────┐   │
│    │ 3.3 匿名认证（AnonymousAuthenticationFilter）              │   │
│    │     - 如果前面都没有认证，创建一个匿名 Authentication        │   │
│    └────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. 权限校验（FilterSecurityInterceptor）                            │
│    - 从 SecurityMetadataSource 加载资源需要的权限                   │
│    - AccessDecisionManager 决策是否放行                              │
│    - 拒绝 → AccessDeniedException → 403 页面或自定义处理           │
│    - 放行 → 继续下一个过滤器                                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 业务逻辑（Controller / Service）                                │
│    - 此时 Authentication 已包含完整用户信息和权限                   │
│    - 可通过 SecurityContextHolder 获取当前用户                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 代码获取当前用户

认证授权完成后，在业务代码中如何获取当前用户？

```java
// 方式一：通过 SecurityContextHolder（最常用）
Authentication authentication = SecurityContextHolder
    .getContext().getAuthentication();
String username = authentication.getName();
Collection&lt;? extends GrantedAuthority&gt; authorities = authentication.getAuthorities();

// 方式二：通过 @AuthenticationPrincipal 注解
@GetMapping("/current")
public String currentUser(@AuthenticationPrincipal UserDetails user) {
    return user.getUsername();
}

// 方式三：通过 Principal 接口
@GetMapping("/profile")
public String profile(Principal principal) {
    return principal.getName();
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| Authentication 和 Authorization 的区别？ | 概念辨析 | 本篇 |
| 认证失败后抛出什么异常？ | 异常体系 | 自定义异常处理 |
| 如何自定义认证流程？ | 扩展点 | UserDetailsService |
| 匿名用户和未认证用户的区别？ | 认证状态 | AnonymousAuthenticationFilter |
| 多个 AuthenticationProvider 的执行顺序？ | 配置 | ProviderManager |

---

## 总结

Spring Security 的认证授权流程，核心就三件事：

1. **认证**：过滤器捕获 → AuthenticationManager 调度 → Provider 验证 → SecurityContext 存储
2. **授权**：SecurityMetadataSource 加载权限 → AccessDecisionManager 决策 → 放行或拒绝
3. **上下文传递**：SecurityContext 通过 ThreadLocal 在请求间传递

理解了这个核心流程，再去看过滤器链、注解配置、OAuth2 登录，都会简单很多。

---

## 下一步

- 想深入理解过滤器链？→ [Spring Security 过滤器链](/framework/springsecurity/filter-chain)
- 想自定义登录逻辑？→ [UserDetailsService 与自定义认证](/framework/springsecurity/userdetails)
- 想了解权限注解？→ [@PreAuthorize 与权限控制](/framework/springsecurity/preauthorize)
