# Session 会话管理：超时处理与并发控制

你有没有遇到过这样的场景：用户登录后，第二天打开网站发现又要重新登录？

这很可能是因为 Session 超时配置的问题。

Session 管理是 Web 应用安全的重要组成部分。今天，我们就来深入了解 Spring Security 中的 Session 会话管理机制。

---

## Session 的生命周期

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Session 生命周期                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   用户登录                                                          │
│       │                                                             │
│       ▼                                                             │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ Server: 创建 Session 对象                                    │   │
│   │          ↓                                                   │   │
│   │          生成 Session ID                                      │   │
│   │          ↓                                                   │   │
│   │          保存用户认证信息到 Session                           │   │
│   │          ↓                                                   │   │
│   │          通过 Set-Cookie 头返回给浏览器                      │   │
│   └──────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ▼                                                             │
│   浏览器保存 Session ID 到 Cookie                                   │
│       │                                                             │
│       ▼                                                             │
│   后续请求携带 Cookie: JSESSIONID=xxx                              │
│       │                                                             │
│       ▼                                                             │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │ Server: 根据 Session ID 找到 Session                          │   │
│   │          ↓                                                   │   │
│   │          恢复用户认证状态                                     │   │
│   │          ↓                                                   │   │
│   │          更新最后访问时间                                     │   │
│   └──────────────────────────────────────────────────────────────┘   │
│       │                                                             │
│       ▼                                                             │
│   Session 超时 / 用户主动退出                                       │
│       │                                                             │
│       ▼                                                             │
│   Session 失效，认证状态丢失                                       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Session 的存储策略

Spring Security 支持多种 Session 存储策略：

| 策略 | 类 | 适用场景 |
|-----|---|---------|
| IF_REQUIRED | SessionCreationPolicy.IF_REQUIRED | **默认**，需要时创建 |
| NEVER | SessionCreationPolicy.NEVER | Spring 不创建，但使用已有 |
| STATELESS | SessionCreationPolicy.STATELESS | 不创建也不使用 Session（用于 JWT） |
| ALWAYS | SessionCreationPolicy.ALWAYS | 每次都创建新 Session |

### 配置 Session 存储策略

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                .sessionCreationPolicy(SessionCreationPolicy.IF_REQUIRED)
            );
        
        return http.build();
    }
}
```

### 与 JWT 的区别

```
┌──────────────────────────────────────────────────────────────────────────┐
│                      Session vs JWT 对比                                 │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Session 模式：                                                          │
│                                                                          │
│  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐                   │
│  │ Browser │───►│ Server │    │ Server │    │ Server │                   │
│  │        │    │ 收到请求│───►│ 找到   │───►│ 恢复   │                   │
│  │ Cookie │    │        │    │ Session │    │ 认证   │                   │
│  │ JSESS- │    │        │    │        │    │        │                   │
│  │ IONID  │    │        │    │ Session │    │        │                   │
│  └────────┘    └────────┘    │ 保存在  │    └────────┘                   │
│                              │ 服务器   │                                  │
│                              └────────┘                                  │
│                                                                          │
│  JWT 模式：                                                             │
│                                                                          │
│  ┌────────┐    ┌────────┐                                               │
│  │ Browser │───►│ Server │                                               │
│  │        │    │ 验证   │                                               │
│  │ Header │    │ Token  │                                               │
│  │ Bearer │    │        │                                               │
│  │ eyJ... │    │ 无状态 │                                               │
│  └────────┘    └────────┘                                               │
│                                                                          │
│  关键区别：                                                              │
│  - Session：状态存储在服务器                                            │
│  - JWT：状态存储在客户端                                                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Session 超时配置

### 1. Tomcat 配置

```xml
&lt;!-- server.xml --&gt;
&lt;Context path="/myapp" sessionTimeout="30"&gt;&lt;/Context&gt;
```

### 2. application.yml 配置

```yaml
server:
  servlet:
    session:
      # Session 超时时间（默认 30 分钟）
      timeout: 30m
      # Session Cookie 配置
      cookie:
        name: JSESSIONID
        http-only: true
        secure: false  # 生产环境应为 true
        # Cookie 有效期（单位：秒）
        max-age: -1    # -1 表示浏览器关闭时失效
```

### 3. Spring Security 配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                // 最大不活跃时间，超过则 Session 失效
                .maximumInterval(Duration.ofMinutes(30))
            );
        
        return http.build();
    }
}
```

### 超时后的行为

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                .invalidSessionUrl("/session/invalid")  // Session 失效后的跳转
            );
        
        return http.build();
    }
}
```

---

## 并发会话控制

### 为什么需要并发控制？

| 场景 | 问题 | 解决方案 |
|-----|------|---------|
| 用户在多个浏览器登录 | 无法控制 | 限制同一账号的会话数 |
| 用户在公共电脑登录 | 账户盗用风险 | 限制最大会话数 + 踢人 |
| 同一账号多人使用 | 账号共享 | 并发限制 |

### 配置最大会话数

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                // 最多允许 1 个会话（默认：后者踢掉前者）
                .maximumSessions(1)
            );
        
        return http.build();
    }
}
```

### 超过最大会话数的处理策略

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                .maximumSessions(1)
                // 策略一：拒绝新登录（后者无法登录）
                .maxSessionsPreventsLogin(true)
                
                // 策略二：踢掉之前的会话（默认）
                // .maxSessionsPreventsLogin(false)
                
                // 自定义过期处理
                .expiredSessionStrategy(event -&gt; {
                    HttpServletResponse response = event.getResponse();
                    response.setContentType("application/json");
                    response.getWriter().write("{\"code\": 401, \"message\": \"您的账号已在其他设备登录\"}");
                })
            );
        
        return http.build();
    }
}
```

### SessionRegistry：会话信息管理

```java
@Configuration
public class SecurityConfig {
    
    @Bean
    public SessionRegistry sessionRegistry() {
        return new SessionRegistryImpl();
    }
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                .maximumSessions(1)
                .sessionRegistry(sessionRegistry())
            );
        
        return http.build();
    }
}

// 使用 SessionRegistry
@Service
public class SessionService {
    
    @Autowired
    private SessionRegistry sessionRegistry;
    
    // 获取当前用户的所有会话
    public List&lt;SessionInformation&gt; getUserSessions(String username) {
        return sessionRegistry.getAllSessions(username, false);
    }
    
    // 强制下线某个会话
    public void expireSession(String sessionId) {
        SessionInformation info = sessionRegistry.getSessionInformation(sessionId);
        if (info != null) {
            info.expireNow();
        }
    }
    
    // 获取在线用户数
    public long getOnlineUserCount() {
        return sessionRegistry.getAllPrincipals().stream()
            .filter(p -&gt; !p.toString().equals("anonymousUser"))
            .count();
    }
}
```

---

## 固定会话攻击（Session Fixation）防护

### 什么是固定会话攻击？

```
攻击者步骤：
1. 诱使受害者访问网站，获取一个 Session ID（此时未登录）
2. 将这个 Session ID 发送给受害者
3. 受害者登录，Session ID 不变
4. 攻击者使用同样的 Session ID，也能访问受害者的账户
```

### Spring Security 的防护机制

Spring Security 默认在用户认证成功后，会创建新的 Session：

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .sessionManagement(session -> session
                // 防护策略
                .sessionFixation()
                    .newSession()  // 创建新 Session，旧 Session 的属性不会复制
                    // 或 .migrateSession()：复制旧 Session 属性到新 Session
                    // 或 .none()：不创建新 Session（不推荐）
            );
        
        return http.build();
    }
}
```

### 四种防护策略对比

| 策略 | 说明 | 安全性 |
|-----|------|-------|
| newSession() | 创建完全新的 Session，不复制旧数据 | ⭐⭐⭐⭐⭐ |
| migrateSession() | 创建新 Session，复制所有属性 | ⭐⭐⭐⭐ |
| changeSessionId() | 不创建新 Session，只改 Session ID（Servlet 3.1+） | ⭐⭐⭐⭐ |
| none() | 不做任何处理 | ❌ 不推荐 |

---

## 分布式 Session 管理

### 为什么要分布式 Session？

单台服务器的 Session 存在内存中，无法跨服务器共享。

```
负载均衡场景：
                              ┌─────────┐
                          ┌─►│ Server1 │  Session-A
┌────────┐              │   └─────────┘
│ Client │──────────────┤
└────────┘              │   ┌─────────┐
    │                └──►│ Server2 │  没有 Session-A
                         └─────────┘
```

### Redis Session 共享

```xml
&lt;!-- pom.xml --&gt;
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.session&lt;/groupId&gt;
    &lt;artifactId&gt;spring-session-data-redis&lt;/artifactId&gt;
&lt;/dependency&gt;
```

```java
// 启动类或配置类
@SpringBootApplication
@EnableRedisHttpSession  // 启用 Redis Session
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

```yaml
# application.yml
spring:
  session:
    store-type: redis
    redis:
      namespace: spring:session
  data:
    redis:
      host: localhost
      port: 6379
```

### Session 数据序列化

```java
// 自定义 Session 序列化（支持复杂对象）
@Configuration
public class SessionConfig {
    
    @Bean
    public CookieSerializer cookieSerializer() {
        DefaultCookieSerializer serializer = new DefaultCookieSerializer();
        serializer.setCookieName("SESSIONID");
        serializer.setCookiePath("/");
        serializer.setUseHttpOnlyCookie(true);
        serializer.setSameSite("Strict");  // CSRF 防护
        return serializer;
    }
    
    @Bean
    public RedisSerializer&lt;Object&gt; springSessionDefaultRedisSerializer() {
        return new GenericJackson2JsonRedisSerializer();
    }
}
```

### 分布式 Session 的安全问题

```
┌─────────────────────────────────────────────────────────────────────┐
│                      分布式 Session 安全                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. Session 数据加密                                                 │
│     - Redis 中的 Session 数据应该加密                                │
│     - 使用 JdkSerializationRedisSerializer 的默认值                 │
│                                                                      │
│  2. Cookie 安全                                                     │
│     - httpOnly: true（防止 XSS 读取）                                │
│     - secure: true（仅 HTTPS 传输）                                  │
│     - sameSite: Strict/Lax（防止 CSRF）                             │
│                                                                      │
│  3. Session ID 管理                                                 │
│     - 定期轮换 Session ID                                            │
│     - 登录后立即更换 Session ID                                      │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| Session 和 Cookie 的区别？ | 基础概念 | 本篇 |
| 如何实现单点登录？ | 架构设计 | CAS |
| 如何防止 Session 固定攻击？ | 安全机制 | 本篇 |
| 如何限制同一账号的并发会话数？ | 配置能力 | 本篇 |
| 分布式环境下 Session 如何共享？ | 架构设计 | Redis Session |
| Session 和 JWT 各自适用场景？ | 技术选型 | JWT 相关文档 |

---

## 总结

Session 管理是 Web 安全的重要组成部分：

1. **存储策略**：根据场景选择 IF_REQUIRED（传统）或 STATELESS（JWT）
2. **超时配置**：平衡用户体验与安全性，通常 30 分钟
3. **并发控制**：限制同一账号的会话数，防止账号共享
4. **攻击防护**：启用 Session Fixation 防护
5. **分布式场景**：使用 Redis 统一存储 Session

Session 和 JWT 没有绝对的优劣，关键是看业务场景。传统 Web 应用选 Session，API 服务选 JWT。

---

## 下一步

- 想了解无状态认证？→ [JWT 无状态认证流程设计](/framework/springsecurity/jwt-filter)
- 想实现免登录？→ [Remember-Me 功能](/framework/springsecurity/remember-me)
- 想实现单点登录？→ [CAS 单点登录集成](/framework/springsecurity/cas)
