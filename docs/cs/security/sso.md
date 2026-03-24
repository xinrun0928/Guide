# SSO 单点登录：一次登录，处处通行

你在公司内部使用着一堆系统：邮件、OA、考勤、报销、代码仓库……

每一个都登录一次？你崩溃了。
每一个都用不同密码？你更崩溃了。

**SSO（Single Sign-On，单点登录）** 就是来解决这个问题的——一次登录，处处通行。

## SSO 解决什么问题

### 没有 SSO 的世界

```
用户 Alice 在公司使用：
- 邮件系统（exchange.company.com）
- OA 系统（oa.company.com）
- 代码仓库（gitlab.company.com）
- 财务系统（finance.company.com）

如果没有 SSO：
→ 每个系统都要注册账号
→ 每个系统都要记住密码
→ 离职时要逐个注销
→ 密码策略难以统一
→ 用户体验极差
```

### 有 SSO 的世界

```
如果有 SSO：
→ 只需登录一次
→ 所有系统自动识别身份
→ 一次注销，全部生效
→ 密码策略统一管理
→ 体验流畅
```

## SSO 的核心原理

SSO 的本质是**信任传递**：

```
用户访问 App A
    ↓ 未登录
重定向到 SSO 登录页
    ↓ 登录成功
SSO 生成 Ticket（凭证）
    ↓ 重定向回 App A
App A 验证 Ticket，获取用户身份
    ↓
用户访问 App B
    ↓ 已登录
App B 验证 Ticket，获取用户身份
    ↓
用户直接访问 App B，无需再次登录
```

## CAS：最经典的 SSO 协议

CAS（Central Authentication Service）是耶鲁大学开发的 SSO 协议，历史悠久，结构清晰。

### CAS 的工作流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 首次访问 App A                                           │
│     GET /protected-page                                      │
│     App A 发现没有 Session                                    │
│     重定向 → CAS Server:8443/login?service=https://app-a.com │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  2. CAS Server 登录页面                                      │
│     用户输入用户名密码                                        │
│     CAS Server 验证通过                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  3. CAS Server 返回 TGT（Ticket Granting Ticket）           │
│     同时重定向回 App A                                       │
│     https://app-a.com?ticket=ST-xxx-abc                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  4. App A 用 ST（Service Ticket）换用户信息                   │
│     POST /cas/validate?service=...&ticket=ST-xxx             │
│     CAS Server 返回：yes\nAlice\n                             │
│     App A 创建 Session                                       │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  5. 用户访问 App B                                           │
│     App B 发现没有 Session                                   │
│     重定向 → CAS Server:8443/login?service=https://app-b.com │
│     但 CAS Server 发现用户已有 TGT（Cookie）                  │
│     直接生成 ST，跳转回 App B                                 │
│     App B 验证 ST，创建 Session                              │
└─────────────────────────────────────────────────────────────┘
```

### CAS 的 Java 实现

```java
// Spring Boot CAS 集成
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Value("${cas.server-url-prefix}")
    private String casServerUrlPrefix;
    
    @Value("${cas.server-login-url}")
    private String casServerLoginUrl;
    
    @Value("${cas.client-host-url}")
    private String clientHostUrl;
    
    @Bean
    public CasAuthenticationFilter casAuthenticationFilter(
            AuthenticationManager authenticationManager) throws Exception {
        CasAuthenticationFilter filter = new CasAuthenticationFilter();
        filter.setAuthenticationManager(authenticationManager);
        filter.setServiceProperties(serviceProperties());
        return filter;
    }
    
    @Bean
    public ServiceProperties serviceProperties() {
        ServiceProperties sp = new ServiceProperties();
        sp.setService(clientHostUrl + "/login/cas");
        sp.setSendRenew(false); // true: 每次强制重新登录
        sp.setAuthenticateAllNodes(true);
        return sp;
    }
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login/cas", "/logout").permitAll()
                .anyRequest().authenticated()
            )
            .addFilterAt(casAuthenticationFilter(null), 
                UsernamePasswordAuthenticationFilter.class)
            .logout(logout -> logout
                .logoutSuccessUrl(casServerLogoutUrl + "?service=" + clientHostUrl)
            );
        return http.build();
    }
}
```

## OAuth 2.0 / OIDC 实现 SSO

现代 SSO 更多基于 OAuth 2.0 / OIDC 实现：

```
┌─────────────────────────────────────────────────────────────┐
│  基于 OIDC 的 SSO 流程                                        │
└─────────────────────────────────────────────────────────────┘

用户 → 访问 App A → 未登录 → 重定向到 IdP → 登录 → 返回 ID Token
                                                          ↓
用户 ← App A 获取用户信息 ← 验证 ID Token ← IdP 签发 ID Token
                                                          ↓
用户 → 访问 App B → 未登录 → 重定向到 IdP → IdP 发现已登录
                                                          ↓
用户 ← App B 获取用户信息 ← 验证 ID Token ← IdP 直接返回 ID Token
```

### 基于 OIDC 的 SSO 实现

```java
// Spring Security OAuth2 Login 实现 SSO
@Configuration
@EnableWebSecurity
public class OAuth2LoginConfig {
    
    @Bean
    public ClientRegistrationRepository clientRegistrationRepository() {
        return InMemoryClientRegistrationRepository
            .fromIdsYaml("classpath:oauth2-clients.yml");
    }
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/", "/login/**", "/error").permitAll()
                .anyRequest().authenticated()
            )
            .oauth2Login(oauth2 -> oauth2
                .clientRegistrationRepository(clientRegistrationRepository())
                .authorizedClientService(oauth2AuthorizedClientService())
            )
            .oauth2ResourceServer(oauth2 -> oauth2
                .jwt(jwt -> jwt
                    .jwtAuthenticationConverter(jwtAuthenticationConverter())
                )
            );
        return http.build();
    }
}
```

```yaml
# oauth2-clients.yml
spring:
  security:
    oauth2:
      client:
        registration:
          corporate-idp:
            client-id: sso-client
            client-secret: ${OIDC_CLIENT_SECRET}
            scope: openid,profile,email
            redirect-uri: "{baseUrl}/login/oauth2/code/{registrationId}"
        provider:
          corporate-idp:
            issuer-uri: https://idp.company.com
            authorization-uri: https://idp.company.com/oauth2/authorize
            token-uri: https://idp.company.com/oauth2/token
            user-info-uri: https://idp.company.com/userinfo
            jwk-set-uri: https://idp.company.com/.well-known/jwks.json
```

## SSO 的安全风险

### 1. 单点故障

SSO 服务器宕机 = 所有系统都不可登录。

**缓解措施**：
- SSO 服务器集群化
- 关键系统保留本地登录能力（紧急情况）
- 监控告警

### 2. 单点突破

攻击者攻破 SSO = 所有系统都被攻破。

**缓解措施**：
- SSO 系统额外安全加固
- 敏感系统启用 MFA
- 异常登录检测

### 3. Cookie 劫持

SSO 的 Cookie 被盗 = 攻击者假冒任何人。

**缓解措施**：
- HttpOnly、Secure、SameSite Cookie
- 定期 Token 刷新
- 异常登录检测（IP、设备变化）

## SAML：企业 SSO 的老牌选手

SAML（Security Assertion Markup Language）是 XML 格式的 SSO 协议，在企业环境（尤其是 Active Directory）中使用广泛。

```
SAML 流程：
┌─────────────────────────────────────────────────────────────┐
│  SP（Service Provider）           IdP（Identity Provider）   │
│  ┌─────────────────┐            ┌─────────────────────┐     │
│  │ App A           │            │ 企业 AD / Okta      │     │
│  └─────────────────┘            └─────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
      ↓                                              ↓
      │ 访问受保护资源                              │
      │                                              │
      │ ←─── 重定向，携带 SAML AuthnRequest ──────── │
      │                                              │
      │                    用户在 IdP 登录            │
      │                                              │
      │ ──── 返回 SAML Response（含断言） ──────────→│
      │                                              │
      ↓                                              ↓
  验证断言 → 创建 Session → 允许访问资源
```

## 面试追问方向

1. **CAS 和 OAuth 2.0 实现 SSO 的区别？** —— CAS 是专用 SSO 协议，OAuth 2.0 更通用；CAS 用 ST（Service Ticket），OAuth 用 Access Token
2. **SSO 和 OAuth 2.0 的关系？** —— OAuth 2.0 可用于实现 SSO，但 OAuth 2.0 本身是授权协议
3. **OIDC 和 SAML 的区别？** —— OIDC 基于 JSON/JWT，更现代；SAML 基于 XML，更老牌，企业集成多
4. **SSO 的 Cookie 如何跨域共享？** —— 不跨域！Cookie 只发给自己域名，SSO 用重定向 + Ticket/Token 传递身份
5. **SSO 登录后，Session 怎么管理？** —— 各 App 独立创建 Session，SSO 只负责身份认证

> "SSO 是企业安全的基石，也是用户体验的关键。理解 SSO 的原理和安全边界，才能设计出既便捷又安全的认证系统。"
