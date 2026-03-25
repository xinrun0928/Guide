# Remember-Me 功能：Token 持久化与安全

你有没有注意过，很多网站登录页面都有一个「记住我」复选框？

勾选之后，即使关闭浏览器再打开，也不需要重新登录。这个功能是怎么实现的？背后又有哪些安全风险？

今天，我们就来深入了解 Spring Security 的 Remember-Me 功能。

---

## Remember-Me 的工作原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Remember-Me 工作原理                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  登录时：                                                                │
│                                                                          │
│  用户 ──► 勾选"记住我" ──► 登录成功                                       │
│                              │                                            │
│                              ▼                                            │
│                      Spring Security 生成 Token                          │
│                              │                                            │
│                              ▼                                            │
│                      Token = username + expiryTime +                     │
│                              signature(使用密钥签名)                      │
│                              │                                            │
│                              ▼                                            │
│                      保存到 Cookie                                       │
│                      ┌────────────────────────────────────────┐         │
│                      │ remember-me = base64(token);           │         │
│                      │ Cookie: remember-me=xxx                 │         │
│                      └────────────────────────────────────────┘         │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  后续访问（无 Session 时）：                                             │
│                                                                          │
│  用户 ──► 请求带上 Cookie                                               │
│                    │                                                    │
│                    ▼                                                    │
│            Spring Security 读取 Token                                   │
│                    │                                                    │
│                    ▼                                                    │
│            验证签名 + 检查过期时间                                       │
│                    │                                                    │
│            ┌───────┴───────┐                                           │
│            │ 验证通过        │ 验证失败                                  │
│            ▼                ▼                                          │
│      恢复用户认证状态      忽略 Token                                    │
│      相当于自动登录        回到登录页面                                 │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 两种实现方式

Spring Security 支持两种 Remember-Me 实现：

| 方式 | 类 | Token 存储 | 安全性 |
|-----|---|-----------|-------|
| 简单校验 | SimpleUrlPersistentRememberMeServices | Cookie | ⚠️ 仅签名防篡改 |
| 持久化 | PersistentTokenRepository | 数据库/Redis | ✅ 更安全 |

### 方式一：基于签名（默认）

Token 结构：
```
username:expiryTime:signature

例如：
admin:1677235200:signature(使用密钥加密)
```

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                // Token 有效期（秒），默认 2 周
                .tokenValiditySeconds(1209600)
                // 记住我 Cookie 的名称
                .rememberMeCookieName("remember-me")
                // 登录表单中"记住我"字段的名称
                .rememberMeParameter("remember-me")
                // 用于签名的密钥
                .key("mySecretKey")
            );
        
        return http.build();
    }
}
```

### 方式二：持久化存储（推荐生产环境）

Token 存储在数据库或 Redis 中，即使密钥泄露也无法伪造 Token。

#### 数据库存储

```sql
-- 创建 persistent_logins 表
CREATE TABLE persistent_logins (
    username VARCHAR(64) NOT NULL,
    series VARCHAR(64) PRIMARY KEY,  -- Token 系列号
    token VARCHAR(64) NOT NULL,       -- 当前 Token
    last_used TIMESTAMP NOT NULL      -- 最后使用时间
);
```

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Autowired
    private DataSource dataSource;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                .tokenRepository(persistentTokenRepository())
                .tokenValiditySeconds(1209600)  // 14 天
                .key("mySecretKey")
            );
        
        return http.build();
    }
    
    @Bean
    public PersistentTokenRepository persistentTokenRepository() {
        JdbcTokenRepositoryImpl tokenRepository = new JdbcTokenRepositoryImpl();
        tokenRepository.setDataSource(dataSource);
        // 第一次运行设为 true，自动创建表
        // 之后改为 false
        tokenRepository.setCreateTableOnStartup(false);
        return tokenRepository;
    }
}
```

#### Redis 存储

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.session&lt;/groupId&gt;
    &lt;artifactId&gt;spring-session-data-redis&lt;/artifactId&gt;
&lt;/dependency&gt;
```

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                .tokenRepository(persistentTokenRepository())
                .tokenValiditySeconds(1209600)
                .key("mySecretKey")
            );
        
        return http.build();
    }
    
    @Bean
    public PersistentTokenRepository persistentTokenRepository(
            RedisTemplate&lt;String, Object&gt; redisTemplate) {
        return new RedisTokenRepositoryImpl(redisTemplate);
    }
}
```

---

## 登录页面配置

### Thymeleaf 表单

```html
&lt;form th:action="@{/login}" method="post"&gt;
    &lt;div&gt;
        &lt;label&gt;用户名:&lt;/label&gt;
        &lt;input type="text" name="username" required/&gt;
    &lt;/div&gt;
    &lt;div&gt;
        &lt;label&gt;密码:&lt;/label&gt;
        &lt;input type="password" name="password" required/&gt;
    &lt;/div&gt;
    &lt;div&gt;
        &lt;!-- "记住我"复选框，name 必须与 rememberMeParameter 一致 --&gt;
        &lt;input type="checkbox" name="remember-me"/&gt; 记住我
    &lt;/div&gt;
    &lt;button type="submit"&gt;登录&lt;/button&gt;
&lt;/form&gt;
```

### 自定义 Cookie 名称

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                .rememberMeCookieName("auto-login")  // 默认是 remember-me
            );
        
        return http.build();
    }
}
```

```html
&lt;input type="checkbox" name="remember-me"/&gt; 下次自动登录
```

---

## Remember-Me 的安全机制

### Token 安全验证流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Remember-Me 安全验证                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. 解析 Cookie                                                      │
│     remember-me = base64(series + ":" + token)                       │
│                                                                      │
│  2. Base64 解码                                                      │
│     series = "abc123"                                                │
│     token = "xyz789"                                                 │
│                                                                      │
│  3. 查询数据库                                                       │
│     SELECT * FROM persistent_logins WHERE series = 'abc123'          │
│                                                                      │
│  4. 验证 Token                                                        │
│     ┌────────────────────────────────────────────────────────────┐   │
│     │ if (stored_token == token) {                               │   │
│     │     // Token 有效                                           │   │
│     │     update last_used = NOW();                               │   │
│     │ } else {                                                    │   │
│     │     // Token 被盗用！整个系列的所有 Token 失效               │   │
│     │     delete FROM persistent_logins WHERE series = 'abc123'; │   │
│     │ }                                                            │   │
│     └────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  5. 用户认证                                                          │
│     加载用户信息，构建 Authentication                                 │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 安全性保障措施

| 措施 | 说明 | 作用 |
|-----|------|-----|
| 签名防篡改 | Token 包含 HMAC 签名 | 防止客户端修改 Token |
| 系列号（Series） | 每个登录设备唯一 | 追踪 Token 来源 |
| Token 轮换 | 每次使用生成新 Token | 防止 Token 重放攻击 |
| 自动作废 | Token 不匹配时整个系列失效 | 防止 Token 被盗用 |

### Token 被盗用的处理

```java
@Service
public class TokenTheftService {
    
    @Autowired
    private PersistentTokenRepository tokenRepository;
    
    @Autowired
    private LoginAttemptService loginAttemptService;
    
    // 当检测到 Token 不匹配时调用
    public void handleTokenTheft(String series, String username) {
        // 1. 删除该用户的所有 Token（强制所有设备重新登录）
        tokenRepository.removeUserTokens(username);
        
        // 2. 记录安全事件
        log.warn("Token theft detected for user: {}, series: {}", username, series);
        
        // 3. 可选：发送告警邮件
        notifyUserAboutSecurityEvent(username);
        
        // 4. 可选：锁定账户一段时间
        loginAttemptService.lockAccount(username, Duration.ofHours(1));
    }
}
```

---

## 持久化 Token 的数据结构

### 数据库表结构

```sql
CREATE TABLE persistent_logins (
    username VARCHAR(64) NOT NULL,
    series VARCHAR(64) NOT NULL,
    token VARCHAR(64) NOT NULL,
    last_used TIMESTAMP NOT NULL,
    PRIMARY KEY (series)
);

-- 为查询添加索引
CREATE INDEX idx_persistent_logins_username ON persistent_logins(username);
```

### Token 的生命周期

```
用户登录（勾选记住我）
    │
    ▼
生成唯一的 Series（系列号，绑定到设备）
    │
    ▼
生成随机 Token
    │
    ▼
保存到数据库
┌─────────────────────────────────────────┐
│ username  │  series      │  token       │
│ admin     │  abc123      │  token1      │
└─────────────────────────────────────────┘
    │
    ▼
返回给浏览器（Cookie）

下次访问（Token 有效）
    │
    ▼
验证 Token 成功后，更新 Token
┌─────────────────────────────────────────┐
│ username  │  series      │  token       │ ← 换成新 token
│ admin     │  abc123      │  token2      │
└─────────────────────────────────────────┘
    │
    ▼
Cookie 更新（Series 不变，Token 变化）
```

---

## 高级配置

### 仅在特定条件下启用

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                .tokenValiditySeconds(1209600)
                .key("mySecretKey")
                // 仅在用户明确勾选时启用
                .useSecureCookie(false)  // 生产环境应为 true
                // 或者自定义启用条件
                // .rememberMeServices(rememberMeServices())
            );
        
        return http.build();
    }
}
```

### 自定义 Token 生成逻辑

```java
@Service
public class CustomPersistentTokenRepository implements PersistentTokenRepository {
    
    @Autowired
    private TokenStore tokenStore;
    
    @Override
    public void createNewToken(PersistentRememberMeToken token) {
        tokenStore.save(token);
    }
    
    @Override
    public void updateToken(String series, String tokenValue, Date lastUsed) {
        PersistentRememberMeToken token = tokenStore.get(series);
        if (token != null) {
            tokenStore.save(new PersistentRememberMeToken(
                token.getUsername(),
                series,
                tokenValue,
                lastUsed
            ));
        }
    }
    
    @Override
    public PersistentRememberMeToken getTokenForSeries(String seriesId) {
        return tokenStore.get(seriesId);
    }
    
    @Override
    public void removeUserTokens(String username) {
        tokenStore.deleteByUsername(username);
    }
}
```

### 禁用 Remember-Me

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .rememberMe(remember -> remember
                .disable()  // 完全禁用 Remember-Me
            );
        
        return http.build();
    }
}
```

---

## Remember-Me 与 CSRF

Remember-Me Cookie 同样受 CSRF 攻击威胁：

```
攻击场景：
1. 攻击者诱导已登录用户访问恶意页面
2. 恶意页面发起请求到 /logout（可能清除 Remember-Me Token）
3. 攻击者获取用户的 Remember-Me Cookie
4. 攻击者使用该 Cookie 登录用户账户
```

### 防护措施

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 确保 CSRF 保护开启
            .csrf(csrf -> csrf
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
            )
            // Remember-Me 配置
            .rememberMe(remember -> remember
                .key("mySecretKey")
            );
        
        return http.build();
    }
}
```

```html
&lt;!-- 登录表单需要包含 CSRF Token --&gt;
&lt;form th:action="@{/login}" method="post"&gt;
    &lt;input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}"/&gt;
    &lt;!-- ... --&gt;
&lt;/form&gt;
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| Remember-Me 的工作原理？ | 原理理解 | 本篇 |
| 简单签名和持久化存储的区别？ | 实现差异 | 本篇 |
| Token 被盗用后如何处理？ | 安全机制 | 本篇 |
| Remember-Me 如何防止 CSRF？ | 安全机制 | 本篇 |
| 如何自定义 Remember-Me 的 Token 生成逻辑？ | 扩展能力 | 本篇 |

---

## 总结

Remember-Me 功能的核心：

1. **两种实现**：简单签名（仅防篡改）vs 持久化存储（更安全）
2. **Token 结构**：Series（设备绑定）+ Token（随机值）
3. **安全机制**：签名验证、Token 轮换、自动作废
4. **被盗处理**：删除该用户所有 Token，强制重新登录
5. **配合 CSRF**：Remember-Me Cookie 同样需要 CSRF 保护

生产环境推荐使用持久化存储方式，可以追踪 Token 使用情况，也便于用户管理自己的登录设备。

---

## 下一步

- 想了解其他登录方式？→ [短信验证码登录](/framework/springsecurity/sms-login)
- 想实现第三方登录？→ [OAuth2 登录](/framework/springsecurity/oauth2-login)
- 想实现单点登录？→ [CAS 单点登录集成](/framework/springsecurity/cas)
