# CAS 单点登录集成

你有没有遇到过这种情况：在公司内部，员工需要访问多个内部系统（OA、邮件、财务系统等），每个系统都要登录一遍，非常繁琐。

这就是「信息孤岛」问题——每个系统都有自己的认证体系，用户体验很差。

**CAS（Central Authentication Service）** 就是来解决这个问题的：一次登录，处处通行。

今天，我们就来深入了解 CAS 单点登录的原理和 Spring Security 集成方式。

---

## CAS 工作原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            CAS 工作原理                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   用户浏览器              CAS Server            应用 A          应用 B   │
│   ─────────              ──────────            ───────          ───────   │
│                                                                          │
│   第一次访问应用 A                                                        │
│   │                        │                    │               │      │
│   ├───────────────────────►│                    │               │      │
│   │                        │ 重定向到登录页面    │               │      │
│   │◄──────────────────────┤                    │               │      │
│   │                        │                    │               │      │
│   │ 输入用户名密码         │                    │               │      │
│   │──────────────────────►│                    │               │      │
│   │                        │                    │               │      │
│   │                        │ 验证成功           │               │      │
│   │                        │ 生成 TGC           │               │      │
│   │                        │ 生成 ST            │               │      │
│   │                        │                    │               │      │
│   │◄──────────────────────┤                    │               │      │
│   │ 带着 ST 重定向          │                    │               │      │
│   ├────────────────────────────────────────────►│               │      │
│   │                        │                    │               │      │
│   │                        │                    │ 用 ST 换 TicketGrantingCookie│
│   │                        │                    │───────────────►│      │
│   │                        │                    │               │      │
│   │                        │◄────────────────────│ ST 验证成功    │      │
│   │                        │                    │               │      │
│   │                        │                    │ 创建 Session  │      │
│   │◄────────────────────────────────────────────│               │      │
│   │ 登录成功，进入应用 A   │                    │               │      │
│                                                                          │
│   ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│   第二次访问应用 B                                                        │
│   │                        │                    │               │      │
│   ├───────────────────────────────────────────────────────────►│      │
│   │                        │                    │ 没有 Session   │      │
│   │                        │                    │               │      │
│   │                        │                    │ 携带 ST 跳转   │      │
│   │                        │◄──────────────────────────────────│      │
│   │                        │                    │               │      │
│   │                        │ TGC 有效，验证 ST  │               │      │
│   │                        │                    │               │      │
│   │◄───────────────────────────────────────────│───────────────┤      │
│   │ 带着新 ST 重定向       │                    │               │      │
│   ├───────────────────────────────────────────────────────────►│      │
│   │                        │                    │               │      │
│   │                        │                    │ 直接登录成功  │      │
│   │◄──────────────────────────────────────────────────────────┤      │
│   │ 登录成功，进入应用 B   │                    │               │      │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │ 关键概念：                                                    │     │
│   │ - TGC (Ticket Granting Cookie)：CAS Server 的 Cookie，标识用户 │     │
│   │ - ST (Service Ticket)：一次性票据，每个应用验证一次后作废     │     │
│   │ - TGT (Ticket Granting Ticket)：TGC 对应的服务端会话          │     │
│   └──────────────────────────────────────────────────────────────┘     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## CAS 核心概念

| 概念 | 全称 | 说明 |
|-----|------|------|
| CAS Server | Central Authentication Server | 认证中心，所有应用共享 |
| CAS Client | 应用方 | 集成 CAS Client 的应用 |
| TGC | Ticket Granting Cookie | CAS Server 的 Cookie，证明用户已登录 |
| TGT | Ticket Granting Ticket | TGC 对应的服务端会话 |
| ST | Service Ticket | 一次性票据，只能使用一次 |
| PT | Proxy Ticket | 代理票据，可用于跨服务调用 |

### 为什么需要一次性票据？

```
ST 只能用一次的好处：
1. 防止重放攻击：即使有人截获了 ST，也无法再次使用
2. 追溯审计：每次 ST 使用都有记录
3. 即时失效：用户登出后，ST 立即失效
```

---

## CAS 与 OAuth2 的区别

| 对比项 | CAS | OAuth2 |
|-------|-----|-------|
| 设计目标 | 单点登录 | 第三方授权 |
| 使用场景 | 企业内部多系统 | 开放平台 |
| Token 类型 | ST（一次性） | Access Token（可复用） |
| 协议复杂度 | 较简单 | 较复杂 |
| 适用规模 | 中小型 | 大型生态 |

---

## Spring Security CAS 集成

### 1. 添加依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.security&lt;/groupId&gt;
    &lt;artifactId&gt;spring-security-cas&lt;/artifactId&gt;
&lt;/dependency&gt;
```

### 2. 配置 application.yml

```yaml
cas:
  # CAS Server 地址
  server-url: https://cas.example.com
  # 应用回调地址（需要在 CAS Server 注册）
  service-url: http://localhost:8080/login/cas

spring:
  security:
    cas:
      # 票据验证地址
      validation-url: ${cas.server-url}/p3/serviceValidate
      # 登录地址
      login-url: ${cas.server-url}/login
      # 登出地址
      logout-url: ${cas.server-url}/logout
```

### 3. 配置 SecurityFilterChain

```java
@Configuration
@EnableWebSecurity
@EnableCasAuthentication
public class SecurityConfig {
    
    @Autowired
    private CasAuthenticationProvider casAuthenticationProvider;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/public/**").permitAll()
                .anyRequest().authenticated()
            )
            .cas(cas -> cas
                .serviceProperties(serviceProperties())
            )
            .addFilter(casAuthenticationFilter())
            .logout(logout -> logout
                .logoutUrl("/logout")
                .logoutSuccessUrl(casLogoutSuccessUrl())
            );
        
        return http.build();
    }
    
    @Bean
    public ServiceProperties serviceProperties() {
        ServiceProperties sp = new ServiceProperties();
        sp.setService(serviceUrl);
        sp.setSendRenew(false);  // 是否每次都要求重新登录
        return sp;
    }
    
    @Bean
    public CasAuthenticationFilter casAuthenticationFilter() {
        CasAuthenticationFilter filter = new CasAuthenticationFilter();
        filter.setServiceProperties(serviceProperties());
        filter.setAuthenticationManager(authenticationManager());
        return filter;
    }
    
    private String casLogoutSuccessUrl() {
        return casServerUrl + "/logout?service=" + serviceUrl;
    }
}
```

### 4. 配置 CAS 认证 Provider

```java
@Configuration
@EnableCasAuthentication
public class CasConfig {
    
    @Autowired
    private ServiceProperties serviceProperties;
    
    @Bean
    public CasAuthenticationProvider casAuthenticationProvider(
            TicketValidator ticketValidator,
            CasUserDetailsService userDetailsService) {
        
        CasAuthenticationProvider provider = new CasAuthenticationProvider();
        provider.setTicketValidator(ticketValidator);
        provider.setUserDetailsService(userDetailsService);
        provider.setKey("CasAuthenticationProvider");
        
        return provider;
    }
    
    @Bean
    public TicketValidator ticketValidator() {
        // CAS 3.x 使用 Cas30ServiceTicketValidator
        return new Cas30ServiceTicketValidator(casServerUrl);
    }
}
```

### 5. 自定义用户服务

```java
@Service
public class CasUserDetailsService implements UserDetailsService {
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // 1. 根据 CAS 返回的用户名查找本地用户
        User user = userRepository.findByUsername(username);
        
        if (user == null) {
            // 可选：自动创建用户
            user = createUserFromCas(username);
        }
        
        // 2. 返回 UserDetails
        return User.builder()
            .username(user.getUsername())
            .password("")  // CAS 不使用本地密码
            .authorities(user.getRoles().toArray(new String[0]))
            .build();
    }
    
    private User createUserFromCas(String username) {
        User user = new User();
        user.setUsername(username);
        user.setRoles(Collections.singleton("ROLE_USER"));
        return userRepository.save(user);
    }
}
```

---

## CAS 与数据库集成

### 从数据库加载用户权限

```java
@Service
public class DatabaseCasUserDetailsService implements UserDetailsService {
    
    @Autowired
    private UserMapper userMapper;
    
    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        // 1. 查询用户基本信息
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("用户不存在: " + username);
        }
        
        // 2. 查询用户角色
        List&lt;String&gt; roles = userMapper.findRolesByUsername(username);
        
        // 3. 构建 UserDetails
        return User.builder()
            .username(user.getUsername())
            .password(user.getPassword() != null ? user.getPassword() : "")
            .roles(roles.toArray(new String[0]))
            .build();
    }
}
```

---

## 高级配置

### 代理认证（Proxy Ticket）

某些场景下，应用 A 需要代表用户访问应用 B（用户授权），这时候需要使用代理票据：

```
┌─────────────────────────────────────────────────────────────────────┐
│                        代理认证流程                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  用户 ──► 应用 A ──► CAS Server                                       │
│                     │                                                │
│                     │ 请求代理授权                                   │
│                     ├────────────────────────────────────────────► │
│                     │                                                │
│                     │ 返回 PT（Proxy Ticket）                        │
│                     │◄───────────────────────────────────────────── │
│                     │                                                │
│                     │ 用 PT 访问应用 B                                │
│                     ├─────────────────────────────────────────────► │
│                     │                                                │
│                     │ 应用 B 验证 PT                                  │
│                     │ 提取代理用户身份                                 │
│                     │◄───────────────────────────────────────────── │
│                     │                                                │
│                     │ 返回用户数据                                    │
│                     │◄───────────────────────────────────────────── │
│                     │                                                │
│                     │ 应用 A 获取到用户数据                           │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

```java
@Configuration
public class CasProxyConfig {
    
    @Bean
    public Cas20ServiceTicketValidator ticketValidator() {
        Cas20ServiceTicketValidator validator = 
            new Cas20ServiceTicketValidator(casServerUrl);
        validator.setProxyCallbackUrl(proxyCallbackUrl);
        validator.setProxyGrantingTicketStorage(proxyGrantingTicketStorage());
        return validator;
    }
    
    @Bean
    public ProxyGrantingTicketStorage proxyGrantingTicketStorage() {
        // 使用内存存储，生产环境建议用 Redis
        return new ProxyGrantingTicketStorageImpl();
    }
    
    @Bean
    public Cas20ProxyTicketValidator proxyTicketValidator() {
        return new Cas20ProxyTicketValidator(casServerUrl);
    }
}
```

### 多 CAS Server 配置

如果公司有多个 CAS Server（如测试环境和生产环境）：

```java
@Configuration
public class MultiCasConfig {
    
    @Bean
    public ServiceProperties productionServiceProperties() {
        ServiceProperties sp = new ServiceProperties();
        sp.setService("http://app.example.com/login/cas");
        sp.setSendRenew(false);
        return sp;
    }
    
    @Bean
    public ServiceProperties testServiceProperties() {
        ServiceProperties sp = new ServiceProperties();
        sp.setService("http://app-test.example.com/login/cas");
        sp.setSendRenew(true);  // 测试环境每次都登录
        return sp;
    }
    
    @Bean
    public SecurityFilterChain productionFilterChain(HttpSecurity http) throws Exception {
        http
            .securityMatcher("/production/**")
            .authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
            .cas(cas -> cas
                .serviceProperties(productionServiceProperties())
            );
        
        return http.build();
    }
}
```

---

## CAS 登出

### 单点登出（Single Logout）

CAS 支持单点登出：当用户在任何一个应用登出时，其他应用也自动登出。

```java
@Configuration
public class CasLogoutConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .logout(logout -> logout
                .logoutUrl("/logout")
                .addLogoutHandler(casLogoutHandler())
                .logoutSuccessUrl(casLogoutUrl())
            );
        
        return http.build();
    }
    
    private LogoutHandler casLogoutHandler() {
        return new CasLogoutHandler(ticketRegistry);
    }
    
    private String casLogoutUrl() {
        return casServerUrl + "/logout?service=" + serviceUrl;
    }
}
```

### CAS Server 回调通知

CAS Server 会在用户登出时通知所有应用：

```java
@RestController
@RequestMapping("/logout/cas")
public class CasLogoutController {
    
    @GetMapping
    public void casLogout(HttpServletRequest request, HttpSession session) {
        // 清除本地 Session
        SecurityContextHolder.clearContext();
        session.invalidate();
    }
}
```

---

## CAS 安全配置

### 限制 Ticket 使用次数

```java
@Configuration
public class CasSecurityConfig {
    
    @Bean
    public ServiceProperties serviceProperties() {
        ServiceProperties sp = new ServiceProperties();
        sp.setService(serviceUrl);
        sp.setProxyAuthenticationEnabled(false);  // 禁用代理认证
        return sp;
    }
}
```

### 使用 HTTPS

生产环境必须使用 HTTPS：

```yaml
cas:
  server-url: https://cas.example.com  # 必须使用 HTTPS
  service-url: https://app.example.com/login/cas
```

---

## CAS 与其他 SSO 方案对比

| 方案 | 适用场景 | 复杂度 | 成熟度 |
|-----|---------|--------|--------|
| CAS | 企业内部系统 | ⭐⭐ | ⭐⭐⭐⭐⭐ |
| OAuth2 + OpenID Connect | 互联网应用 | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| SAML 2.0 | 企业应用 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| Keycloak | 通用 SSO | ⭐⭐⭐ | ⭐⭐⭐⭐ |

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| CAS 和 OAuth2 的区别？ | 概念辨析 | 本篇 |
| 什么是 ST？为什么 ST 只能用一次？ | 协议理解 | 本篇 |
| CAS 如何实现单点登出？ | 流程理解 | 本篇 |
| CAS 的 TGC 和 TGT 是什么关系？ | 概念理解 | 本篇 |
| 如何集成自定义用户数据源？ | 实战能力 | 本篇 |

---

## 总结

CAS 单点登录的核心要点：

1. **中心化认证**：所有应用共享一个 CAS Server
2. **票据机制**：TGC 标识用户会话，ST 用于应用验证
3. **一次登录，多处通行**：用户在 CAS 登录后，访问任何应用都无需再次登录
4. **单点登出**：在一个应用登出，其他应用也自动登出
5. **集成方式**：通过 Spring Security CAS 模块简化集成

对于企业内部多系统场景，CAS 是成熟可靠的 SSO 方案。

---

## 下一步

- 想了解更多登录方式？→ [表单登录](/framework/springsecurity/form-login)
- 想实现无状态认证？→ [JWT 无状态认证](/framework/springsecurity/jwt)
- 想学习权限模型？→ [RBAC 权限模型](/framework/springsecurity/rbac)
