# Spring Security 面试高频问题汇总

Spring Security 是 Java 后端开发面试中的高频考点，几乎每场面试都会问到。

今天，我们来全面梳理 Spring Security 的面试高频问题。

---

## 一、基础概念类

### 1. Authentication 和 Authorization 的区别？

| 概念 | 全称 | 问题 | 类比 |
|-----|------|------|-----|
| Authentication | 认证 | **你是谁？** | 出示身份证 |
| Authorization | 授权 | **你能做什么？** | 景区门票 |

**回答要点**：
- Authentication 验证用户身份（登录）
- Authorization 判断用户权限（访问控制）
- 先认证，后授权

### 2. Spring Security 的核心组件有哪些？

1. **SecurityFilterChain**：定义安全过滤链
2. **AuthenticationManager**：认证管理器
3. **AuthenticationProvider**：认证提供者
4. **UserDetailsService**：加载用户信息
5. **PasswordEncoder**：密码加密
6. **AccessDecisionManager**：权限决策

### 3. Spring Security 的工作流程是什么？

```
请求 → FilterChain → AuthenticationManager → AuthenticationProvider → UserDetailsService
  ↓
密码校验
  ↓
SecurityContextHolder 设置 Authentication
  ↓
AccessDecisionManager 权限决策
  ↓
请求放行或拒绝
```

---

## 二、过滤器链类

### 4. Spring Security 有多少个默认过滤器？按什么顺序执行？

Spring Security 默认有约 15 个过滤器，按顺序执行：

| 顺序 | 过滤器 | 作用 |
|-----|-------|------|
| 1 | SecurityContextPersistenceFilter | 初始化 SecurityContext |
| 2 | LogoutFilter | 处理登出 |
| 3 | UsernamePasswordAuthenticationFilter | 表单登录 |
| 4 | RememberMeFilter | 记住我 |
| 5 | AnonymousAuthenticationFilter | 匿名认证 |
| 6 | SessionManagementFilter | Session 管理 |
| 7 | ExceptionTranslationFilter | 异常转换 |
| 8 | FilterSecurityInterceptor | 权限拦截 |

### 5. SecurityFilterChain 和 FilterChainProxy 的区别？

- **FilterChainProxy**：是真正的 Filter，入口点，根据请求匹配对应的 SecurityFilterChain
- **SecurityFilterChain**：是一组 Filter 的集合，通过 `matches()` 方法判断是否处理某个请求

### 6. 过滤器链的顺序为什么重要？

First-match 策略：第一个匹配的过滤器链生效。

```java
// 错误：/api/** 会先匹配，/api/admin/** 永远匹配不到
.filterChains(
    apiFilterChain(),   // 匹配 /api/**
    adminFilterChain()   // 永远到不了
);

// 正确：更具体的放在前面
.filterChains(
    adminFilterChain(), // 先匹配 /api/admin/**
    apiFilterChain()     // 再匹配 /api/**
);
```

---

## 三、认证机制类

### 7. UserDetailsService 和 AuthenticationProvider 的关系？

```
UserDetailsService：加载用户信息（根据用户名查数据库）
    ↓
AuthenticationProvider：执行具体认证（校验密码）
    ↓
AuthenticationManager：协调多个 AuthenticationProvider
```

### 8. PasswordEncoder 的加密原理？为什么推荐 BCrypt？

- BCrypt 是自适应哈希函数
- 内置盐值（自动生成）
- 可配置工作因子（2^cost），增加计算成本
- 彩虹表攻击无效

### 9. Session 和 JWT 的区别？各适用场景？

| 对比项 | Session | JWT |
|-------|---------|-----|
| 存储位置 | 服务端 | 客户端 |
| 状态 | 有状态 | 无状态 |
| 扩展性 | 困难（需要同步） | 简单（Token 自包含） |
| 适用场景 | 传统 Web | API / 前后端分离 |

### 10. 如何实现单点登录？

1. **CAS**：中心化认证，适合企业内部系统
2. **OAuth2 + OpenID Connect**：第三方授权，适合互联网应用
3. **分布式 Session**：Session 存储在 Redis，适合微服务

---

## 四、授权机制类

### 11. hasRole() 和 hasAuthority() 的区别？

```java
// hasRole() 自动加 ROLE_ 前缀
.hasRole("ADMIN")  // 等价于 hasAuthority("ROLE_ADMIN")

// hasAuthority() 精确匹配
.hasAuthority("ADMIN")  // 匹配 AUTHORITY_ADMIN
```

### 12. @PreAuthorize 和 @Secured 的区别？

| 对比项 | @PreAuthorize | @Secured |
|-------|-------------|----------|
| SpEL 支持 | ✅ | ❌ |
| 复杂条件 | 支持 | 不支持 |
| 粒度控制 | 更细 | 较粗 |

### 13. RBAC 权限模型是什么？

```
用户 ──► 用户角色关系 ──► 角色 ──► 角色权限关系 ──► 权限
```

通过角色作为中间层，简化权限管理。

### 14. 如何自定义权限决策逻辑？

```java
// 1. 实现 AccessDecisionVoter
public class CustomVoter implements AccessDecisionVoter&lt;Object&gt; {
    @Override
    public int vote(Authentication auth, Object obj, Collection&lt;ConfigAttribute&gt; attrs) {
        // 自定义投票逻辑
        return ACCESS_GRANTED;
    }
}

// 2. 配置到 AccessDecisionManager
@Bean
public AccessDecisionManager accessDecisionManager() {
    return new AffirmativeBased(Arrays.asList(
        new WebExpressionVoter(),
        new CustomVoter()
    ));
}
```

---

## 五、安全机制类

### 15. CSRF 攻击的原理？如何防护？

**原理**：恶意网站诱导用户向目标网站发送请求，利用用户的 Cookie 身份。

**防护**：在表单中添加 CSRF Token。

```html
&lt;input type="hidden" name="_csrf" value="${_csrf.token}"/&gt;
```

### 16. XSS 攻击的原理？如何防护？

**原理**：在网页中注入恶意 JavaScript 代码。

**防护**：
1. 输入过滤
2. 输出转义
3. Content Security Policy (CSP)

### 17. 什么场景下可以禁用 CSRF？

- 纯 API 服务（无 Cookie 认证）
- 使用 JWT 等 Token 认证
- 微服务内部调用

---

## 六、实战应用类

### 18. 如何实现多个 AuthenticationProvider？

```java
@Bean
public AuthenticationManager authenticationManager(
        AuthenticationConfiguration config) throws Exception {
    
    ProviderManager providerManager = (ProviderManager) config.getAuthenticationManager();
    providerManager.getProviders().add(customAuthenticationProvider());
    
    return providerManager;
}
```

### 19. 如何实现多方式登录（用户名 + 短信 + 第三方）？

1. 实现多个 AuthenticationProvider（UsernamePasswordAuthenticationProvider、SmsAuthenticationProvider、OAuth2AuthenticationProvider）
2. 添加对应的 Filter 到过滤器链
3. AuthenticationManager 会尝试所有 Provider

### 20. 如何在微服务架构下统一鉴权？

1. **网关层统一认证**：JWT Filter 在 Gateway 层统一验证
2. **用户信息传递**：通过 Header 传递用户信息到下游服务
3. **微服务端简化**：只需要解析 Header，不需要独立认证

---

## 七、Spring Security 6.x 类

### 21. WebSecurityConfigurerAdapter 为什么被移除？

- Lambda DSL 更简洁
- 配置更灵活
- 减少继承层级

### 22. 5.x 到 6.x 的 breaking changes？

| 5.x | 6.x |
|-----|-----|
| `WebSecurityConfigurerAdapter` | `@Bean` + Lambda DSL |
| `antMatchers()` | `requestMatchers()` |
| `authorizeRequests()` | `authorizeHttpRequests()` |
| `@EnableGlobalMethodSecurity` | `@EnableMethodSecurity` |

### 23. Lambda DSL 相比之前的写法有什么优势？

```java
// 之前
.sessionManagement()
    .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
    .maximumSessions(1);

// Lambda DSL
.sessionManagement(session -> session
    .sessionCreationPolicy(SessionCreationPolicy.STATELESS)
    .maximumSessions(1)
);
```

优势：配置更集中、可读性更好、IDE 支持更好。

---

## 八、综合设计类

### 24. 如何设计一个完整的权限系统？

1. **数据模型**：用户-角色-权限（RBAC）
2. **认证机制**：用户名密码 + 短信 + 第三方登录
3. **授权机制**：URL 权限 + 方法权限 + 数据权限
4. **安全防护**：CSRF + XSS + CORS
5. **Token 管理**：JWT + 刷新 + 黑名单

### 25. Session 被盗用了怎么办？

1. **登录异常检测**：异地登录、新设备登录告警
2. **Token 短期化**：Access Token 有效期短
3. **设备指纹**：绑定设备信息
4. **IP 绑定**：记录登录 IP

### 26. 如何防止暴力破解登录？

1. **图形验证码**
2. **短信验证码**
3. **登录限流**
4. **账户锁定**：连续失败 N 次后锁定

---

## 面试技巧

### 1. 回答要完整

不仅要说出结论，还要说明原因：

```java
// ❌ 简单回答
BCrypt 更安全

// ✅ 完整回答
BCrypt 是自适应哈希函数，内置盐值防止彩虹表攻击，
可以配置工作因子增加计算成本，即使硬件提升也能保持安全性。
```

### 2. 结合实际场景

面试官喜欢听到实际经验：

```java
// ❌ 背书式回答
CSRF 可以通过 Token 防护

// ✅ 结合场景
在传统 Web 表单场景下，需要开启 CSRF Token。
但如果是前后端分离的 API 项目，使用 JWT 认证，通常会禁用 CSRF，
因为攻击者无法获取 Token。
```

### 3. 展示深度理解

能够回答追问：

```
面试官：Spring Security 的过滤器链是如何组装的？
回答：SecurityFilterChain 定义了一组 Filter，FilterChainProxy 根据请求路径
匹配对应的 SecurityFilterChain，然后依次执行链中的 Filter。

面试官：为什么这样设计？
回答：这样可以支持多套安全配置，针对不同路径使用不同的认证方式，
比如 /api/** 用 JWT，/admin/** 用表单登录。
```

---

## 总结

Spring Security 面试的核心知识点：

1. **认证授权概念**：Authentication vs Authorization
2. **过滤器链**：SecurityFilterChain、FilterChainProxy、过滤器顺序
3. **认证机制**：UserDetailsService、AuthenticationProvider、PasswordEncoder
4. **授权机制**：hasRole vs hasAuthority、@PreAuthorize、AccessDecisionManager
5. **安全防护**：CSRF、XSS、CORS
6. **版本差异**：6.x 的 breaking changes 和 Lambda DSL

建议：理解原理，多实践，结合项目经验回答。

---

## 相关文档

- [认证与授权核心流程](/framework/springsecurity/core-flow)
- [过滤器链](/framework/springsecurity/filter-chain)
- [JWT 无状态认证](/framework/springsecurity/jwt-filter)
- [RBAC 权限模型](/framework/springsecurity/rbac)
- [Spring Security 6.x 新特性](/framework/springsecurity/v6)
