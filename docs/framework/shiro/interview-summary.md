# Shiro 面试高频问题汇总

经过这一系列的学习，你已经掌握了 Shiro 的核心知识点。

但这些知识点在面试中怎么回答？

这一节，我们来汇总 Shiro 面试的高频问题。

## 一、Shiro 基础问题

### 1.1 Shiro 的核心组件有哪些？

**标准回答**：

Shiro 有三大核心组件：

1. **Subject**：当前与系统交互的实体（用户、服务等）
2. **SecurityManager**：安全管理器，协调所有安全组件
3. **Realm**：数据源，提供用户、角色、权限数据

扩展回答：

```
Subject
    │
    ▼
SecurityManager
    │
    ├── Authenticator（认证器）
    ├── Authorizer（授权器）
    └── SessionManager（会话管理器）
            │
            ▼
        Realm（数据源）
```

### 1.2 Shiro 的认证流程是怎样的？

**标准回答**：

```
1. 用户提交用户名密码 → UsernamePasswordToken
2. Subject.login(token) → 委托给 SecurityManager
3. SecurityManager.login() → 调用 Authenticator.authenticate()
4. Authenticator → 遍历 Realm 执行 doGetAuthenticationInfo()
5. Realm 从数据源获取用户信息 → 返回 AuthenticationInfo
6. CredentialsMatcher 比对密码
7. 比对成功 → 创建 Subject 登录状态
8. 比对失败 → 抛出 AuthenticationException
```

### 1.3 Shiro 的授权流程是怎样的？

**标准回答**：

```
1. Subject.hasRole("admin") 或 isPermitted("user:create")
2. Subject 委托给 SecurityManager
3. SecurityManager 调用 Authorizer
4. Authorizer 检查缓存
5. 缓存命中 → 直接返回
6. 缓存未命中 → Realm.doGetAuthorizationInfo()
7. Realm 从数据库查询权限
8. 返回 AuthorizationInfo 并缓存
```

## 二、Realm 相关问题

### 2.1 Shiro 有哪些内置 Realm？

**标准回答**：

| Realm | 说明 |
|-------|------|
| `IniRealm` | 从 INI 文件读取用户和权限 |
| `JdbcRealm` | 从 JDBC 数据源读取用户和权限 |
| `PropertiesRealm` | 从 properties 文件读取 |
| `AuthorizingRealm` | 抽象基类，需要继承实现 |

### 2.2 自定义 Realm 需要重写哪些方法？

**标准回答**：

```java
public class CustomRealm extends AuthorizingRealm {
    
    // 认证：验证用户身份
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        // 1. 获取用户名
        // 2. 查询用户信息
        // 3. 返回 AuthenticationInfo
    }
    
    // 授权：获取用户权限
    @Override
    protected AuthorizationInfo doGetAuthorizationInfo(
            PrincipalCollection principals) {
        // 1. 获取用户名
        // 2. 查询角色和权限
        // 3. 返回 AuthorizationInfo
    }
}
```

### 2.3 Shiro 的 Realm 和 Spring Security 的 UserDetailsService 有什么区别？

**标准回答**：

| 对比 | Shiro Realm | Spring Security UserDetailsService |
|-----|-------------|----------------------------------|
| **职责** | 认证 + 授权 | 只负责用户信息加载 |
| **返回** | AuthenticationInfo + AuthorizationInfo | UserDetails |
| **粒度** | 统一的 Realm 接口 | 分离的 UserDetailsService + UserDetails |
| **灵活性** | 一个 Realm 处理所有 | 可以分离认证和权限逻辑 |

**本质相同**：都是安全框架与业务数据之间的桥梁。

## 三、认证授权问题

### 3.1 Shiro 的密码加密机制是怎样的？

**标准回答**：

Shiro 使用 `CredentialsMatcher` 进行密码比对：

```java
// 配置加密
HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
matcher.setHashAlgorithmName("SHA-256");
matcher.setHashIterations(3);
realm.setCredentialsMatcher(matcher);
```

密码加密存储时需要加盐：

```java
return new SimpleAuthenticationInfo(
    username,
    encryptedPassword,    // 加密后的密码
    ByteSource.Util.bytes(salt),  // 盐值
    realmName
);
```

### 3.2 hasRole 和 isPermitted 有什么区别？

**标准回答**：

| 方法 | 说明 | 粒度 |
|-----|------|------|
| `hasRole()` | 检查角色 | 粗粒度 |
| `isPermitted()` | 检查权限 | 细粒度 |

```java
// 粗粒度：检查是否管理员
if (subject.hasRole("admin")) {
    // 可以做任何事
}

// 细粒度：检查是否有特定权限
if (subject.isPermitted("user:create")) {
    // 只能创建用户
}
```

### 3.3 Shiro 的权限字符串格式是什么？

**标准回答**：

使用 Wildcard 权限格式：

```
module:action:instance

// 示例
user:create          → user 模块的 create 操作
user:create:1        → user 模块的 create 操作，操作 ID 为 1 的用户
user:*               → user 模块的所有操作
*:create             → 所有模块的 create 操作
```

## 四、Session 相关问题

### 4.1 Shiro Session 和 HttpSession 的区别？

**标准回答**：

| 对比 | Shiro Session | HttpSession |
|-----|---------------|-------------|
| **依赖** | 不依赖 Servlet 容器 | 依赖 Servlet 容器 |
| **环境** | 任何 Java 环境 | 仅 Web 环境 |
| **分布式** | 原生支持（Redis） | 需要额外配置 |
| **自定义** | 通过 SessionDAO | 不容易自定义 |

### 4.2 Shiro 如何实现分布式 Session？

**标准回答**：

1. 引入 shiro-redis 依赖
2. 配置 RedisSessionDAO
3. 将 Session 存储到 Redis

```java
@Bean
public RedisSessionDAO sessionDAO() {
    RedisSessionDAO sessionDAO = new RedisSessionDAO();
    sessionDAO.setRedisManager(redisManager());
    return sessionDAO;
}

@Bean
public DefaultWebSessionManager sessionManager() {
    DefaultWebSessionManager manager = new DefaultWebSessionManager();
    manager.setSessionDAO(sessionDAO());
    return manager;
}
```

### 4.3 RememberMe 是怎么工作的？

**标准回答**：

```
1. 用户登录时勾选「记住我」
2. Shiro 生成加密的 Cookie（包含用户身份信息）
3. Cookie 发送到浏览器存储
4. 用户下次访问，Shiro 读取 Cookie
5. 自动恢复用户身份（但不包含完整 Session）
```

## 五、过滤器相关问题

### 5.1 Shiro 的过滤器链是怎样的？

**标准回答**：

```
anon → authc → user → logout → perms → roles → ...
```

常用过滤器：

| 过滤器 | 说明 |
|-------|------|
| `anon` | 匿名访问 |
| `authc` | 需要认证 |
| `user` | 已认证或 RememberMe |
| `logout` | 登出 |
| `roles[xxx]` | 需要特定角色 |
| `perms[xxx]` | 需要特定权限 |

### 5.2 Shiro 和 Spring Security 怎么选？

**标准回答**：

| 场景 | 推荐 |
|-----|------|
| 快速开发中小型项目 | Shiro |
| 非 Spring 环境 | Shiro |
| Spring Boot 微服务 | Spring Security |
| 需要 OAuth2/CAS | Spring Security |
| 复杂的企业权限模型 | Spring Security |

## 六、缓存相关问题

### 6.1 Shiro 的缓存是怎么工作的？

**标准回答**：

```
1. 第一次授权查询 → 从数据库获取 → 存入缓存
2. 后续授权查询 → 从缓存获取 → 直接返回
3. 权限变更 → 清除缓存
```

### 6.2 Shiro 支持哪些缓存？

| 缓存 | 说明 |
|-----|------|
| EhCache | 进程内缓存 |
| Redis | 分布式缓存 |
| Memcached | 分布式缓存 |
| 自定义 CacheManager | 可扩展 |

## 七、综合问题

### 7.1 Shiro 的整体架构是怎样的？

**最佳回答**：

```
┌─────────────────────────────────────────────────────────────┐
│                         Application                          │
│                                                              │
│   ┌──────────────────────────────────────────────────────┐ │
│   │                    Subject                            │ │
│   │   主体：当前操作用户（人、服务、定时任务）              │ │
│   └──────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│   ┌──────────────────────────────────────────────────────┐ │
│   │                SecurityManager                         │ │
│   │                    安全管理器                          │ │
│   │  ┌─────────────┬─────────────┬─────────────┐         │ │
│   │  │Authenticator│  Authorizer │SessionManager│         │ │
│   │  │   认证器    │   授权器    │  会话管理器  │         │ │
│   │  └─────────────┴─────────────┴─────────────┘         │ │
│   └──────────────────────────────────────────────────────┘ │
│                            │                                │
│                            ▼                                │
│   ┌──────────────────────────────────────────────────────┐ │
│   │                      Realm                             │ │
│   │                    数据源                              │ │
│   │  ┌───────────┬───────────┬───────────┐               │ │
│   │  │ IniRealm  │JdbcRealm  │CustomRealm │               │ │
│   │  └───────────┴───────────┴───────────┘               │ │
│   └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Shiro 相比 Spring Security 有什么优势？

**标准回答**：

1. **简单易用**：API 设计直观，半小时上手
2. **轻量级**：不依赖 Spring，适用性广
3. **独立 Session**：不依赖容器，可在非 Web 环境使用
4. **配置简洁**：INI 文件即可配置
5. **学习曲线平缓**：概念少，容易理解

### 7.3 Shiro 的缺陷有哪些？

**标准回答**：

1. **社区活跃度低**：Apache 项目，更新较慢
2. **OAuth2 支持弱**：需要自行扩展
3. **文档较少**：相比 Spring Security
4. **不适合复杂场景**：企业级功能不如 Spring Security

## 八、场景设计问题

### 8.1 如何设计一个权限系统？

**参考回答**：

1. **数据模型**：用户-角色-权限五表设计
2. **认证**：Realm 从数据库验证用户
3. **授权**：基于角色和权限的访问控制
4. **会话**：Session 存储到 Redis 实现分布式
5. **缓存**：权限信息缓存减少数据库查询
6. **安全**：CSRF 防护、XSS 防护、HTTPS

### 8.2 如何实现动态权限配置？

**参考回答**：

1. 权限存储到数据库
2. Realm 动态查询
3. 权限变更时清除缓存
4. 使用过滤器链 + 注解双重控制

```java
// 过滤器链：URL 级别
filterChain.put("/admin/**", "authc, roles[admin]");

// 注解：方法级别
@RequiresPermissions("user:create")
public void createUser() {}
```

## 九、结尾

学完了 Shiro，你可能还会遇到这些问题：

1. **Shiro 停止维护了怎么办？**
   - 迁移到 Spring Security
   - 自行维护 Shiro fork

2. **Shiro 和 JWT 如何结合？**
   - 自定义 JwtFilter 替代 FormAuthenticationFilter
   - JWT 存储用户身份信息

3. **Shiro 的局限性在哪？**
   - 不支持 OAuth2、SAML 等协议
   - 不适合微服务架构的精细化权限控制

---

**最后一句话**：

> Shiro 的设计哲学是「Simple but Powerful」。掌握核心组件和认证授权流程，就能应对大部分面试问题。
