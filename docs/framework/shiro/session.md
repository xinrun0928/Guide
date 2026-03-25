# Shiro Session 管理：SessionManager 与 SessionDAO

用户登录成功了，但登录状态存在哪？

很多同学会说「存在 Session 里」。但 Shiro 的 Session 和 HttpSession 有什么区别？

这一节，我们来深入理解 Shiro 的会话管理。

## Shiro Session vs HttpSession

| 特性 | Shiro Session | HttpSession |
|-----|--------------|-------------|
| **依赖容器** | 不依赖 | 依赖 Servlet 容器 |
| **使用范围** | Java SE 环境 | 仅 Web 环境 |
| **分布式支持** | 原生支持 | 需要 Redis/Session 同步 |
| **存储位置** | 可配置 | 仅内存 |
| **API 设计** | 更简洁 | 较繁琐 |

**Shiro 的 Session 是独立的**，这意味着你可以在命令行应用、定时任务中使用会话功能。

## Session 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Subject                              │
│                                                              │
│   subject.getSession()                                      │
│         │                                                   │
│         ▼                                                   │
│   ┌────────────────────────────────────┐                     │
│   │         SessionManager             │                     │
│   │                                    │                     │
│   │  ┌──────────────────────────────┐ │                     │
│   │  │       SessionDAO              │ │                     │
│   │  │                               │ │                     │
│   │  │  ┌─────────┐  ┌─────────┐    │ │                     │
│   │  │  │ Memory  │  │  Redis  │    │ │                     │
│   │  │  │ SessionDAO│  │ SessionDAO│ │ │                     │
│   │  │  └─────────┘  └─────────┘    │ │                     │
│   │  └──────────────────────────────┘ │                     │
│   └────────────────────────────────────┘                     │
└─────────────────────────────────────────────────────────────┘
```

## Session 接口

```java
public interface Session {
    
    // 获取会话 ID
    Serializable getId();
    
    // 获取会话创建时间
    Date getStartTimestamp();
    
    // 获取最后访问时间
    Date getLastAccessTime();
    
    // 获取超时时间（毫秒）
    long getTimeout() throws InvalidSessionException;
    
    // 设置超时时间
    void setTimeout(long maxIdleTimeInMillis) throws InvalidSessionException;
    
    // 停止会话
    void stop() throws InvalidSessionException;
    
    // 属性操作
    Object getAttribute(Object key) throws InvalidSessionException;
    void setAttribute(Object key, Object value) throws InvalidSessionException;
    Object removeAttribute(Object key) throws InvalidSessionException;
    
    // 获取所有属性 key
    Collection&lt;Object&gt; getAttributeKeys() throws InvalidSessionException;
}
```

## 快速上手

```java
Subject subject = SecurityUtils.getSubject();

// 获取 Session
Session session = subject.getSession();

// 存储数据
session.setAttribute("userId", 1001L);
session.setAttribute("username", "zhangsan");

// 读取数据
Long userId = (Long) session.getAttribute("userId");
String username = (String) session.getAttribute("username");

// 设置超时时间（30 分钟）
session.setTimeout(30 * 60 * 1000);

// 获取会话 ID
Serializable sessionId = session.getId();

// 删除数据
session.removeAttribute("tempData");

// 销毁会话
session.stop();
```

## SessionManager

SessionManager 是会话管理的核心，负责创建、删除和维护会话。

### 内置 SessionManager 实现

| 实现类 | 说明 | 使用场景 |
|-------|------|---------|
| `DefaultSessionManager` | 默认实现 | Java SE 环境 |
| `ServletContainerSessionManager` | 使用 Servlet 容器 | 传统 Web 项目 |
| `DefaultWebSessionManager` | Web 环境默认 | Spring Boot |
| `EnterpriseCacheSessionManager` | 使用缓存 | 需要集群会话同步 |

### 创建 Session

```java
// 方式一：通过 Subject 获取（常用）
Session session = subject.getSession();
Session session = subject.getSession(true);  // 不存在则创建

// 方式二：通过 SessionManager 创建
SessionManager sessionManager = new DefaultWebSessionManager();
Session session = sessionManager.start(new SimpleSession());
```

### 配置 SessionManager

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(Realm realm, SessionManager sessionManager) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        manager.setSessionManager(sessionManager);
        return manager;
    }
    
    @Bean
    public DefaultWebSessionManager sessionManager() {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        
        // 全局会话超时时间（毫秒），默认 30 分钟
        sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);
        
        // 是否启用会话验证（定期检查会话是否过期）
        sessionManager.setSessionValidationSchedulerEnabled(true);
        
        // 验证会话间隔（毫秒）
        sessionManager.setSessionValidationInterval(15 * 60 * 1000);
        
        // 设置 SessionDAO
        sessionManager.setSessionDAO(sessionDAO());
        
        return sessionManager;
    }
}
```

## SessionDAO

SessionDAO 负责 Session 数据的持久化。

### 内置 SessionDAO 实现

| 实现类 | 说明 |
|-------|------|
| `MemorySessionDAO` | 内存存储，默认实现 |
| `EnterpriseCacheSessionDAO` | 使用缓存存储 |
| `CustomSessionDAO` | 自定义实现 |

### MemorySessionDAO

默认实现，Session 存储在内存中：

```java
@Bean
public SessionDAO sessionDAO() {
    return new MemorySessionDAO();
}
```

### EnterpriseCacheSessionDAO

使用缓存（如 EhCache）存储：

```java
@Bean
public SessionDAO sessionDAO(CacheManager cacheManager) {
    EnterpriseCacheSessionDAO sessionDAO = new EnterpriseCacheSessionDAO();
    sessionDAO.setCacheManager(cacheManager);
    sessionDAO.setActiveSessionsCacheName("shiro-activeSessions");
    return sessionDAO;
}
```

### 自定义 SessionDAO

如果需要存储到 Redis 或数据库：

```java
public class RedisSessionDAO implements SessionDAO {
    
    private RedisTemplate&lt;String, Object&gt; redisTemplate;
    
    private static final String SESSION_PREFIX = "shiro:session:";
    
    @Override
    public Serializable create(Session session) {
        // 生成会话 ID
        Serializable sessionId = generateSessionId(session);
        
        // 存储到 Redis
        redisTemplate.opsForValue().set(
            SESSION_PREFIX + sessionId,
            session,
            30,
            TimeUnit.MINUTES
        );
        
        return sessionId;
    }
    
    @Override
    public Session readSession(Serializable sessionId) throws UnknownSessionException {
        Session session = (Session) redisTemplate.opsForValue()
            .get(SESSION_PREFIX + sessionId);
        if (session == null) {
            throw new UnknownSessionException("Session not found: " + sessionId);
        }
        return session;
    }
    
    @Override
    public void update(Session session) throws UnknownSessionException {
        // 更新过期时间
        redisTemplate.expire(
            SESSION_PREFIX + session.getId(),
            30,
            TimeUnit.MINUTES
        );
    }
    
    @Override
    public void delete(Session session) {
        redisTemplate.delete(SESSION_PREFIX + session.getId());
    }
    
    @Override
    public Collection&lt;Session&gt; getActiveSessions() {
        // 获取所有活跃会话
        Set&lt;String&gt; keys = redisTemplate.keys(SESSION_PREFIX + "*");
        return keys.stream()
            .map(key -> (Session) redisTemplate.opsForValue().get(key))
            .collect(Collectors.toList());
    }
}
```

## Web 环境配置

### Spring Boot 整合

```java
@Configuration
public class ShiroSessionConfig {
    
    @Bean
    public DefaultWebSessionManager sessionManager() {
        DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
        
        // 会话超时时间
        sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);
        
        // 是否启用会话验证调度
        sessionManager.setSessionValidationSchedulerEnabled(true);
        
        // 会话验证调度频率
        sessionManager.setSessionValidationInterval(15 * 60 * 1000);
        
        // 是否在请求结束时删除无效会话
        sessionManager.setDeleteInvalidSessions(true);
        
        return sessionManager;
    }
}
```

### URL 级别配置

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    factory.setSecurityManager(manager);
    factory.setLoginUrl("/login");
    factory.setSuccessUrl("/index");
    factory.setUnauthorizedUrl("/403");
    
    Map&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
    
    // 静态资源不过滤
    filterChain.put("/static/**", "anon");
    filterChain.put("/css/**", "anon");
    filterChain.put("/js/**", "anon");
    
    // 登录页面不过滤
    filterChain.put("/login", "anon");
    
    // 登出
    filterChain.put("/logout", "logout");
    
    // 其他请求需要认证
    filterChain.put("/**", "authc");
    
    factory.setFilterChainDefinitionMap(filterChain);
    
    return factory;
}
```

## 会话监听

### SessionListener

```java
public class CustomSessionListener implements SessionListener {
    
    @Override
    public void onStart(Session session) {
        System.out.println("会话创建: " + session.getId());
    }
    
    @Override
    public void onStop(Session session) {
        System.out.println("会话停止: " + session.getId());
    }
    
    @Override
    public void onExpiration(Session session) {
        System.out.println("会话过期: " + session.getId());
    }
}
```

### 配置监听器

```java
@Bean
public DefaultWebSessionManager sessionManager() {
    DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
    
    // 添加监听器
    sessionManager.setSessionListeners(Arrays.asList(
        new CustomSessionListener()
    ));
    
    return sessionManager;
}
```

## Session 存储用户信息

登录时将用户信息存入 Session：

```java
@PostMapping("/login")
public String login(String username, String password, Model model) {
    Subject subject = SecurityUtils.getSubject();
    
    if (!subject.isAuthenticated()) {
        UsernamePasswordToken token = 
            new UsernamePasswordToken(username, password);
        
        try {
            subject.login(token);
            
            // 将用户信息存入 Session
            User user = userService.findByUsername(username);
            Session session = subject.getSession();
            session.setAttribute("currentUser", user);
            session.setAttribute("userId", user.getId());
            
            return "redirect:/index";
        } catch (AuthenticationException e) {
            model.addAttribute("error", "登录失败");
            return "login";
        }
    }
    
    return "redirect:/index";
}
```

取出用户信息：

```java
@GetMapping("/profile")
public String profile(Model model) {
    Subject subject = SecurityUtils.getSubject();
    User user = (User) subject.getSession().getAttribute("currentUser");
    
    if (user == null) {
        return "redirect:/login";
    }
    
    model.addAttribute("user", user);
    return "profile";
}
```

## 分布式 Session

在分布式环境下，需要将会话存储到 Redis：

```java
@Bean
public DefaultWebSessionManager sessionManager(RedisSessionDAO redisSessionDAO) {
    DefaultWebSessionManager sessionManager = new DefaultWebSessionManager();
    sessionManager.setSessionDAO(redisSessionDAO);
    sessionManager.setGlobalSessionTimeout(30 * 60 * 1000);
    sessionManager.setSessionValidationSchedulerEnabled(true);
    return sessionManager;
}
```

具体 Redis 配置会在后续章节展开。

## 面试追问方向

**面试官可能会问**：

1. **Shiro Session 和 HttpSession 的区别？**
   - Shiro Session 不依赖 Servlet 容器
   - 可以存储在任何地方（内存、Redis、数据库）

2. **Session 过期后怎么处理的？**
   - Shiro 有 SessionValidationScheduler 定期检查
   - 过期后调用 SessionListener.onExpiration()

3. **如何实现分布式 Session？**
   - 实现自定义 SessionDAO
   - 使用 Redis 存储会话数据

4. **SessionDAO 的作用是什么？**
   - 负责 Session 的增删改查
   - 屏蔽存储细节

---

## 留给你的问题

Session 可以存储用户登录状态，但如果用户关闭浏览器，下次打开还需要重新登录吗？

这就是 RememberMe 要解决的问题。下一节，我们来学习 Shiro 的 RememberMe 功能。
