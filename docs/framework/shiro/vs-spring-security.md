# Shiro 与 Spring Security 对比

「我应该用 Shiro 还是 Spring Security？」

这是每个 Java 开发者在项目选型时都会面临的问题。今天，我们来彻底搞清楚它们的差异。

## 先说结论

没有最好的框架，只有最适合的框架。让我先给你一张对比表，然后逐项分析：

| 对比维度 | Shiro | Spring Security |
|---------|-------|-----------------|
| **学习曲线** | 平缓，API 直观 | 陡峭，概念繁多 |
| **配置复杂度** | 简单，INI 文件即可 | 复杂，Java 配置多 |
| **与 Spring 整合** | 需要手动整合 | 原生无缝集成 |
| **OAuth2/SAML** | 不支持 | 原生支持 |
| **社区活跃度** | 一般（Apache 项目） | 活跃（Spring 生态） |
| **最新版本支持** | 更新较慢 | 与 Spring Boot 同步 |
| **适合项目规模** | 中小型 | 中大型 |

## 为什么 Spring Security 更复杂？

看一个最简单的 Spring Security 配置：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .requestMatchers("/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated()
            )
            .formLogin(form -> form
                .loginPage("/login")
                .permitAll()
            )
            .logout(logout -> logout.permitAll())
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
    
    @Bean
    public UserDetailsService userDetailsService() {
        return username -> userRepository.findByUsername(username)
            .map(user -> User.builder()
                .username(user.getUsername())
                .password(user.getPassword())
                .roles(user.getRoles().toArray(new String[0]))
                .build())
            .orElseThrow(() -> new UsernameNotFoundException("User not found"));
    }
}
```

再看一个最简单的 Shiro 配置：

```java
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(Realm realm) {
        DefaultWebSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        return manager;
    }
    
    @Bean
    public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
        ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
        factory.setSecurityManager(manager);
        factory.setLoginUrl("/login");
        factory.setFilterChainDefinitionMap(Map.of(
            "/public/**", "anon",
            "/admin/**", "roles[admin]",
            "/**", "authc"
        ));
        return factory;
    }
    
    @Bean
    public Realm realm() {
        return new IniRealm("classpath:shiro.ini");
    }
}
```

Shiro 的配置看起来更简洁，但这不意味着 Spring Security 不好——**复杂度往往意味着更多的能力**。

## 核心差异详解

### 1. 认证方式

**Spring Security**：
- 表单登录（默认）
- HTTP Basic/Digest
- OAuth2（支持 QQ、微信、GitHub 登录）
- CAS 单点登录
- LDAP 集成
- 自定义认证（AuthenticationProvider）

```java
// Spring Security OAuth2 登录配置
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.oauth2Login(oauth2 -> oauth2
        .loginPage("/login/oauth2")
        .authorizationEndpoint(authorization -> authorization
            .baseUri("/oauth2/authorization")
        )
    );
    return http.build();
}
```

**Shiro**：
- 表单登录
- HTTP Basic
- 自定义 Realm
- 无 OAuth2 原生支持（需要扩展）

### 2. 授权粒度

**Spring Security** 的授权更加精细：

```java
// 基于权限的动态授权
@PreAuthorize("hasAuthority('system:user:add') and @customPerm.check(authentication, #userId)")
public void assignRole(Long userId, List&lt;Long&gt; roleIds) {
    // 只有同时拥有 system:user:add 权限和自定义权限校验通过才能执行
}

// 基于表达式的授权
@Secured({"ROLE_ADMIN", "ROLE_USER"})
public void adminOnly() {}

// 方法级别的权限控制
@DenyAll
public void notAccessible() {}
```

**Shiro** 的授权同样强大，但语法不同：

```java
// 注解方式
@RequiresPermissions("system:user:add")
@RequiresRoles("admin")
public void assignRole(Long userId, List&lt;Long&gt; roleIds) {}

// 编程方式
if (subject.isPermitted("system:user:add")) {
    // 执行操作
}
```

### 3. Session 管理

**Spring Security** 的 Session 管理：

```java
@Configuration
public class SessionConfig {
    
    @Bean
    public SessionRegistry sessionRegistry() {
        return new HttpSessionSessionRegistry();
    }
}

// 配置 Session 策略
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.sessionManagement(session -> session
        .maximumSessions(1)  // 最多一个 session
        .maxSessionsPreventsLogin(true)  // 禁止新登录
        .sessionRegistry(sessionRegistry())
    );
    return http.build();
}
```

**Shiro** 的 Session 管理更加灵活：

```java
// 自定义 Session 存储到 Redis
DefaultWebSecurityManager manager = new DefaultWebSecurityManager();
CustomSessionDAO sessionDAO = new CustomSessionDAO();
sessionDAO.setActiveSessionsCacheName("shiro-activeSessions");

// 配置分布式 Session
RedisSessionDAO redisSessionDAO = new RedisSessionDAO();
redisSessionDAO.setRedisManager(redisManager);
manager.setSessionDAO(redisSessionDAO);
```

Shiro 的 Session 不依赖 Servlet 容器，在非 Web 环境也能工作。

### 4. 过滤器链

**Spring Security** 的过滤器链（部分）：

```
SecurityContextPersistenceFilter
→ HeaderWriterFilter
→ CorsFilter
→ LogoutFilter
→ UsernamePasswordAuthenticationFilter
→ RequestCacheAwareFilter
→ SecurityContextHolderAwareRequestFilter
→ AnonymousAuthenticationFilter
→ SessionManagementFilter
→ ExceptionTranslationFilter
→ FilterSecurityInterceptor
```

**Shiro** 的过滤器链：

```
OncePerRequestFilter
→ GenericFilterBean
→ AbstractFilter
→ NameableFilter
→ OncePerRequestFilter
→ AdviceFilter
→ PathMatchingFilter
→ AdviceFilter
→ Shiro 1.x: SecurityFilter
→ Shiro 2.x: ShiroFilter
```

Shiro 的过滤器链更简洁，但 Spring Security 的过滤器链更可控。

## 使用场景分析

### 选 Shiro 的场景

**场景一：快速交付的小型项目**

```java
// 一个登录功能，Shiro 只需要这几行
@PostMapping("/login")
public String login(String username, String password) {
    Subject subject = SecurityUtils.getSubject();
    try {
        subject.login(new UsernamePasswordToken(username, password));
        return "redirect:/index";
    } catch (AuthenticationException e) {
        return "redirect:/login?error";
    }
}
```

**场景二：非 Spring 环境**

Shiro 是纯 Java 项目，不依赖任何框架。如果你在维护一个老旧的 Servlet/JSP 项目，Shiro 是更好的选择。

**场景三：对 Session 有特殊需求**

如果需要在命令行应用、定时任务中管理用户会话，Shiro 的独立 Session 功能很有用。

### 选 Spring Security 的场景

**场景一：Spring Boot 微服务项目**

Spring Security 与 Spring Boot 深度集成，自动配置开箱即用。

```yaml
# Spring Security 只需要引入依赖
spring:
  security:
    user:
      name: admin
      password: {noop}admin
```

**场景二：需要 OAuth2 登录**

现在几乎每个项目都需要微信登录、GitHub 登录。Spring Security OAuth2 模块原生支持这些：

```java
// Spring Boot 3.x
@Bean
public ClientRegistrationRepository clientRegistrationRepository() {
    return new InMemoryClientRegistrationRepository(
        CommonOAuth2Provider.GITHUB.getBuilder("github")
            .clientId("your-client-id")
            .clientSecret("your-client-secret")
            .build()
    );
}
```

**场景三：复杂的企业权限模型**

Spring Security 的 `MethodSecurityExpressionHandler` 支持非常复杂的权限表达式：

```java
@PreAuthorize("@rbacService.hasPermission(authentication, #resource, 'WRITE')")
public Resource updateResource(Resource resource) {
    // 只有通过了复杂的权限表达式才能执行
}
```

## 迁移成本

如果你正在 Shiro 和 Spring Security 之间犹豫，考虑迁移成本：

| 迁移方向 | 成本 | 说明 |
|---------|------|-----|
| Shiro → Spring Security | **高** | 需要重写认证逻辑、权限模型、Session 管理 |
| Spring Security → Shiro | **中** | 需要重新配置过滤器链 |

一旦选择了 Shiro，更换框架的代价很大。在项目初期就要做好技术选型。

## 面试官想听到的答案

当面试官问你「Shiro 和 Spring Security 有什么区别」时，不要只背表格。

**好的回答思路**：

1. **先说共同点**：都是 Java 安全框架，都支持认证、授权、会话管理
2. **再说差异**：从项目背景、团队能力、功能需求角度分析
3. **给出建议**：根据具体场景推荐使用哪个

**最佳回答**：

> 「Shiro 和 Spring Security 都是优秀的安全框架。Shiro 简单易用，适合快速交付的中型项目；Spring Security 功能全面，适合 Spring 生态下的企业级应用。
>
> 如果项目是 Spring Boot 技术栈，且有 OAuth2、CAS 等需求，推荐 Spring Security；如果是一个独立的老项目，追求快速集成，Shiro 更合适。
>
> 实际上，我之前项目中用的是 Shiro，因为它配置简单，团队学习成本低。但如果让我重新选型，我会更倾向于 Spring Security，因为它的生态更完善，后续维护有保障。」

---

## 最后留个思考题

很多团队从 Shiro 迁移到 Spring Security，是因为 Shiro 更新太慢。

Apache Shiro 1.12.0 发布于 2022 年 2 月，距今已经快 4 年没有重大更新了。

**如果 Shiro 停止维护，你会选择迁移到 Spring Security 吗？迁移成本有多高？**

这个问题，值得你提前思考。
