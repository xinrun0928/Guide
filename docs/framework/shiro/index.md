# Shiro：轻量级 Java 安全框架

想象一下：如果每个项目都要从零实现登录、权限校验、Session 管理，你会做多少重复工作？

这就是 Apache Shiro 存在的意义——它把 authentication（认证）、authorization（授权）、session 管理、加密等安全功能，封装成一套简洁易用的 API，让你可以专注业务逻辑。

## 为什么选择 Shiro？

大多数人对 Shiro 的第一印象是「简单」。

没错，Shiro 的学习曲线平缓，API 设计直观，半小时就能跑通登录流程。但 Shiro 的能力远不止于此：

| 能力维度 | Shiro 能做什么 |
|---------|---------------|
| **认证** | 支持用户名密码、LDAP、OAuth、CAS 等多种认证方式 |
| **授权** | 基于角色的访问控制（RBAC）和细粒度权限控制 |
| **会话管理** | Web 环境原生 Session 支持，非 Web 环境也有会话管理 |
| **加密** | 内置多种加密算法，支持盐值和多次哈希 |
| **缓存** | 支持 EhCache、Redis 等多种缓存实现 |
| **Web 支持** | 原生 URL 过滤和 JSP 标签库 |

## Shiro vs Spring Security

这是每个 Java 开发者都会问的问题：**选 Shiro 还是 Spring Security？**

没有标准答案，但有一些规律：

**选 Shiro 的场景：**
- 项目不需要 OAuth2、SAML 等企业级认证协议
- 希望快速集成，不想被复杂的配置淹没
- 需要在非 Spring 环境使用（如 Servlet/JSP 项目）
- 需要极简的安全解决方案

**选 Spring Security 的场景：**
- 项目已经是 Spring Boot/Spring Cloud 生态
- 需要 OAuth2、LDAP、CAS 等企业级功能
- 需要与 Spring Security OAuth 完美集成
- 团队对 Spring 技术栈更熟悉

两者各有优势，Shiro 以「小而美」著称，Spring Security 以「功能全面」见长。

## Shiro 核心模块

在深入学习之前，先看一下 Shiro 的整体架构：

```
┌─────────────────────────────────────────────────────┐
│                    Application                      │
│                                                     │
│   ┌─────────────┐     ┌─────────────────────┐     │
│   │   Subject   │────▶│  SecurityManager    │     │
│   └─────────────┘     └─────────────────────┘     │
│                              ▲                     │
│              ┌───────────────┼───────────────┐    │
│              ▼               ▼               ▼    │
│        ┌──────────┐   ┌──────────┐   ┌──────────┐ │
│        │  Authenticator│ │ Authorizer│   │  SessionManager │ │
│        └──────────┘   └──────────┘   └──────────┘ │
│              │               │               │     │
│              └───────────────┴───────────────┘    │
│                              │                     │
│                     ┌────────▼────────┐           │
│                     │      Realm      │           │
│                     └─────────────────┘           │
└─────────────────────────────────────────────────────┘
```

- **Subject**：当前操作用户，可以是人，也可以是服务
- **SecurityManager**：安全管理的核心，协调各个组件
- **Realm**：数据源，用于获取用户和权限信息

## 快速导航

想深入理解 Shiro？这里是你需要掌握的核心知识点：

### 基础入门
- [Shiro 架构：Subject、SecurityManager、Realms 三大组件](/framework/shiro/architecture)
- [Shiro 认证流程：login() → SecurityUtils.getSubject()](/framework/shiro/authentication)
- [Shiro 授权流程：isPermitted() 与 Permissions](/framework/shiro/authorization)

### 认证机制
- [IniRealm 与 properties 方式配置用户权限](/framework/shiro/ini-realm)
- [JDBCRealm 连接数据库实现认证授权](/framework/shiro/jdbc-realm)
- [自定义 Realm：继承 AuthorizingRealm](/framework/shiro/custom-realm)
- [Shiro 密码加密：HashedCredentialsMatcher 与盐值](/framework/shiro/credentials-matcher)

### 会话与缓存
- [Shiro Session 管理：SessionManager 与 SessionDAO](/framework/shiro/session)
- [Shiro RememberMe 功能](/framework/shiro/remember-me)
- [Shiro 缓存：EhCache / Redis + CacheManager](/framework/shiro/cache)

### Spring Boot 集成
- [Shiro + Spring Boot 快速集成](/framework/shiro/springboot)
- [Shiro 过滤器链：anon、authc、roles、perms](/framework/shiro/filter-chain)
- [Shiro 注解：@RequiresAuthentication / @RequiresRoles](/framework/shiro/annotation)
- [Shiro JSP 标签库](/framework/shiro/jsp-tag)

### 分布式与安全
- [Shiro session + Redis 分布式会话共享](/framework/shiro/session-redis)
- [Shiro 实现 JWT 无状态认证](/framework/shiro/jwt)
- [Shiro 权限数据模型：用户-角色-权限树状结构](/framework/shiro/permission-model)
- [Shiro CSRF 防护与 URL 过滤策略](/framework/shiro/csrf)

## 最后留个思考题

Shiro 的官方定位是「Simple  but Powerful」——简单但强大。

但你有没有想过：**「简单」和「功能强大」这两个目标，有时候是矛盾的？**

Shiro 是如何做到这一点的？

当你读完这个系列，就会找到答案。
