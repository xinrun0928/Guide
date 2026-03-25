# Shiro 架构：Subject、SecurityManager、Realms 三大组件

你知道 Shiro 为什么叫「Simple  but Powerful」吗？

答案藏在它的架构设计里。Shiro 用三个核心组件，构建了一个既简洁又强大的安全框架。

## 架构总览

先看一下 Shiro 的整体架构图：

```
┌─────────────────────────────────────────────────────────────┐
│                         Application                          │
│                                                              │
│    ┌─────────────────────────────────────────────────────┐  │
│    │                    Subject                            │  │
│    │   （当前用户：可以是浏览器用户、服务账户、cron 任务）   │  │
│    └─────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│    ┌─────────────────────────────────────────────────────┐  │
│    │               SecurityManager                         │  │
│    │                    （安全管理器）                      │  │
│    │  ┌───────────────┬───────────────┬───────────────┐   │  │
│    │  │ Authenticator │  Authorizer   │ SessionManager│   │  │
│    │  │   （认证器）   │  （授权器）   │  （会话管理）  │   │  │
│    │  └───────────────┴───────────────┴───────────────┘   │  │
│    └─────────────────────────────────────────────────────┘  │
│                              │                               │
│                              ▼                               │
│    ┌─────────────────────────────────────────────────────┐  │
│    │                     Realm                            │  │
│    │         （数据源：获取用户、角色、权限）              │  │
│    │  ┌───────────────┬───────────────┬───────────────┐  │  │
│    │  │ IniRealm      │ JDBCRealm     │ CustomRealm   │  │  │
│    │  └───────────────┴───────────────┴───────────────┘  │  │
│    └─────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

三层结构，每一层都有明确的职责。

## Subject：一切从「用户」开始

`Subject` 是 Shiro 中最重要的概念——它代表当前与软件交互的实体。

可以是：
- 使用浏览器的终端用户
- REST API 的调用方
- 定时任务的执行账户
- 甚至是另一个应用

`Subject` 的创建方式：

```java
// 获取当前登录用户
Subject currentUser = SecurityUtils.getSubject();

// 判断是否已认证
if (currentUser.isAuthenticated()) {
    // 获取用户名
    String username = (String) currentUser.getPrincipal();
}
```

为什么 Shiro 要用 `Subject` 而不是直接用 `User`？

因为「用户」这个词太具体了。Shiro 的设计哲学是：**一切与系统交互的实体，都可以是 Subject**。这种抽象让 Shiro 可以在任何环境下工作——Web 应用、桌面应用、微服务、定时任务。

## SecurityManager：安全管理的中央协调器

如果说 `Subject` 是前台，那么 `SecurityManager` 就是后台总调度。

它的职责：
1. **协调认证**：调用 Authenticator 处理登录
2. **处理授权**：调用 Authorizer 检查权限
3. **管理会话**：调用 SessionManager 创建和管理会话
4. **缓存管理**：通过 CacheManager 管理权限缓存
5. **事件传播**：确保 Subject 的状态变更正确传播

一个典型的 SecurityManager 配置：

```java
DefaultSecurityManager securityManager = new DefaultWebSecurityManager();

// 设置 Realm
securityManager.setRealm(myCustomRealm);

// 设置 Session Manager
securityManager.setSessionManager(sessionManager);

// 设置 Cache Manager
securityManager.setCacheManager(cacheManager);

// 绑定到 ThreadLocal
SecurityUtils.setSecurityManager(securityManager);
```

**重要**：在一个应用中，只需要一个 `SecurityManager` 实例。它是单例的。

## Authenticator：认证器

负责处理「登录」这个动作。

核心方法：

```java
public interface Authenticator {
    AuthenticationInfo authenticate(AuthenticationToken token) 
        throws AuthenticationException;
}
```

`AuthenticationToken` 封装了用户的凭证信息（用户名+密码），`AuthenticationInfo` 封装了从 Realm 返回的用户信息。

Shiro 默认使用 `ModularRealmAuthenticator`，它支持多 Realm 认证：

```java
ModularRealmAuthenticator authenticator = new ModularRealmAuthenticator();
// 认证策略：第一个成功就算成功
authenticator.setAuthenticationStrategy(new FirstSuccessfulStrategy());
// 或者：所有 Realm 都认证成功才算成功
// authenticator.setAuthenticationStrategy(new AtLeastOneSuccessfulStrategy());
```

## Authorizer：授权器

负责判断「用户能做什么」。

核心方法：

```java
public interface Authorizer {
    boolean isPermitted(PrincipalCollection principals, String permission);
    boolean hasRole(PrincipalCollection principals, String roleIdentifier);
}
```

两种授权方式：

| 方式 | 方法 | 示例 |
|-----|------|-----|
| **角色检查** | `hasRole()` | `subject.hasRole("admin")` |
| **权限检查** | `isPermitted()` | `subject.isPermitted("user:create")` |

为什么要两种方式？

- **角色**是粗粒度的，适合「管理员 vs 普通用户」这种二元划分
- **权限**是细粒度的，适合「用户模块的创建权限」这种精确控制

## SessionManager：会话管理器

Shiro 的 Session 概念和 HttpSession 类似，但更强大：

```java
// 获取会话
Session session = subject.getSession();
session.setAttribute("key", "value");

// 设置超时时间（毫秒）
session.setTimeout(30 * 60 * 1000);

// 获取会话 ID
Serializable sessionId = session.getId();
```

**Shiro 的 Session 不依赖 Servlet 容器**。这意味着：
1. 在非 Web 环境也能使用 Session
2. 可以轻松实现分布式 Session
3. Session 数据可以存储在任何地方（内存、Redis、数据库）

## Realm：数据源

Realm 是 Shiro 和你业务数据之间的桥梁。

它的职责：
- 从数据库/配置文件读取用户信息
- 读取用户的角色和权限
- 验证密码

一个最小的 Realm：

```java
public class MyRealm extends AuthorizingRealm {
    
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        // 获取用户名
        String username = (String) principals.getPrimaryPrincipal();
        
        // 从数据库查询角色和权限
        Set&lt;String&gt; roles = userService.getRoles(username);
        Set&lt;String&gt; permissions = userService.getPermissions(username);
        
        // 返回授权信息
        SimpleAuthorizationInfo info = new SimpleAuthorizationInfo();
        info.setRoles(roles);
        info.setStringPermissions(permissions);
        return info;
    }
    
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        // 获取用户名
        UsernamePasswordToken upToken = (UsernamePasswordToken) token;
        String username = upToken.getUsername();
        
        // 从数据库查询密码
        String password = userService.getPassword(username);
        
        // 返回认证信息
        return new SimpleAuthenticationInfo(username, password, getName());
    }
}
```

## 组件协作流程

当用户访问一个需要权限的接口时，Shiro 是这样工作的：

```
1. 控制器调用 subject.isPermitted("order:create")
                   │
                   ▼
2. Subject 委托给 SecurityManager
                   │
                   ▼
3. SecurityManager 调用 Authorizer
                   │
                   ▼
4. Authorizer 调用 CacheManager 检查缓存
                   │
                   ├─ 缓存命中 ──▶ 直接返回结果
                   │
                   └─ 缓存未命中 ──▶ 调用 Realm
                                      │
                                      ▼
                                 从数据库查询
                                      │
                                      ▼
                                 返回权限信息
                                      │
                                      ▼
                                 存入缓存
```

**面试追问方向：**

- Shiro 的 Realm 和 Spring Security 的 UserDetailsService 有什么区别？
- 如果配置多个 Realm，认证顺序是怎样的？
- SecurityManager 为什么要设置为单例？

## 架构设计的精髓

回顾 Shiro 的架构，你会发现一个设计原则：**接口隔离 + 组合模式**。

每个组件只关心自己的职责：
- Subject 负责「用户视角」的 API
- SecurityManager 负责协调
- Realm 负责数据

组件之间通过接口通信，可以灵活替换。这种设计让 Shiro 既保持简洁，又足够强大。

---

## 留给你的问题

`SecurityManager` 是整个 Shiro 的核心，但它本身不存储任何数据。

那它的数据从哪来？

——答案是 Realm。下一节，我们就来深入了解 Realm 的世界。
