# Spring Security

你知道吗？每年因为权限控制不当导致的数据泄露事件中，有相当一部分是因为没有正确配置安全框架。

Spring Security 是 Spring 生态中最核心的安全框架，它不仅仅是「登录功能」那么简单——它解决的是 **「谁可以做什么」** 这个最根本的问题。

从表单登录到 OAuth2，从 Session 会话到 JWT 无状态认证，从 CSRF 防护到细粒度权限控制——Spring Security 几乎涵盖了企业级应用安全的方方面面。

但正因为它功能强大、配置复杂，很多人对它是「既爱又恨」：爱它的功能完善，恨它的学习曲线陡峭。

这个模块，就是要把 Spring Security 讲透。

---

## 模块总览

### [🔐 认证与授权核心流程](/framework/springsecurity/core-flow)

Spring Security 的认证和授权是怎么工作的？从请求进来到最终放行，经历了哪些环节？

这一篇是整个模块的「总地图」，帮你建立完整的知识框架。

### [🔍 过滤器链](/framework/springsecurity/filter-chain)

Spring Security 本质上是一系列 Filter 的组合。你知道 `SecurityFilterChain` 是如何组装的？`FilterChainProxy` 又是如何分派的？

理解过滤器链，是理解 Spring Security 工作原理的钥匙。

### [⚙️ 配置方式演进](/framework/springsecurity/config-adapter)

从 `WebSecurityConfigurerAdapter` 到 Lambda DSL，Spring Security 6.x 的配置方式发生了翻天覆地的变化。

这一篇帮你理清配置方式的演进脉络，让你能看懂不同版本的代码。

### [👤 认证机制](/framework/springsecurity/userdetails)

`UserDetailsService` 是自定义登录认证的核心。你知道如何从数据库加载用户信息？如何实现「记住我」功能？

认证是安全的入口，这一步必须搞清楚。

### [🔑 密码加密](/framework/springsecurity/password-encoder)

密码应该怎么存？MD5 还安全吗？BCrypt 的工作因子是什么？

密码加密是入职第一课，也是最容易踩坑的地方。

### [📋 授权模型](/framework/springsecurity/authority-role)

Authority 和 Role 有什么区别？`hasRole()` 和 `hasAuthority()` 用哪个？

授权模型决定了权限系统的天花板，这一步设计不好，后面全是坑。

---

## 学习路线

```
零基础入门
  ↓
过滤器链与认证流程（理解原理）
  ↓
表单登录 + Session 管理（搞定登录）
  ↓
密码加密 + Remember-Me（完善认证）
  ↓
RBAC + 方法级权限（搞定授权）
  ↓
JWT 无状态认证（进阶实战）
  ↓
OAuth2 第三方登录（接入登录生态）
  ↓
微服务统一鉴权（分布式安全）
```

---

## 认证机制全景图

|| 认证方式 | 适用场景 | 复杂度 | 推荐度 |
|-----|---------|---------|--------|--------|
|| [表单登录](/framework/springsecurity/form-login) | 传统 Web 应用 | ⭐ | ⭐⭐⭐⭐⭐ |
|| [Session 会话](/framework/springsecurity/session) | 需要会话保持 | ⭐ | ⭐⭐⭐⭐⭐ |
|| [Remember-Me](/framework/springsecurity/remember-me) | 免登录功能 | ⭐⭐ | ⭐⭐⭐⭐ |
|| [短信登录](/framework/springsecurity/sms-login) | 移动端 | ⭐⭐ | ⭐⭐⭐⭐ |
|| [OAuth2 登录](/framework/springsecurity/oauth2-login) | 第三方登录 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
|| [CAS 单点登录](/framework/springsecurity/cas) | 多系统统一登录 | ⭐⭐⭐⭐ | ⭐⭐⭐ |
|| [JWT 无状态](/framework/springsecurity/jwt) | API / 移动端 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

---

## 授权与权限控制

### 注解方式

|| 注解 | 位置 | SpEL 支持 | 推荐度 |
|-----|------|------|-----------|--------|
|| @Secured | 方法 | ❌ | ⭐⭐⭐ |
|| @RolesAllowed | 方法 | ❌ | ⭐⭐⭐ |
|| @PreAuthorize | 方法/类 | ✅ | ⭐⭐⭐⭐⭐ |
|| @PostAuthorize | 方法 | ✅ | ⭐⭐⭐ |

### 动态权限决策

|| 场景 | 方案 | 说明 |
|-----|------|------|------|
|| 固定角色 | @PreAuthorize("hasRole('ADMIN')") | 简单场景 |
|| 动态权限 | 自定义 Voter | 需要查库 |
|| 树状权限 | 递归权限计算 | 复杂业务 |

---

## 安全防护体系

Spring Security 不只是认证授权，还提供了一系列安全防护：

|| 防护类型 | 配置方式 | 重要性 |
|---------|---------|--------|--------|
|| [CSRF 防护](/framework/springsecurity/csrf) | CSRF Token | ⭐⭐⭐⭐⭐ |
|| [CORS 跨域](/framework/springsecurity/cors) | @CrossOrigin / 配置 | ⭐⭐⭐⭐⭐ |
|| [XSS 防护](/framework/springsecurity/xss) | HttpFirewall | ⭐⭐⭐⭐ |
|| [JWT 防盗用](/framework/springsecurity/jwt-security) | 设备指纹 + IP 绑定 | ⭐⭐⭐⭐ |

---

## 版本差异

| 版本 | 重大变化 | 说明 |
|------|---------|------|
| 5.x | 密码编码器重构 | 推出 `PasswordEncoder` 接口 |
| 6.0 | 移除 WebSecurityConfigurerAdapter | 全面转向 Lambda DSL |
| 6.1+ | 默认禁用 CSRF 表单登录 | 更安全的默认配置 |

> Spring Security 6.x 有大量 breaking changes，如果你在维护旧项目，建议先看 [6.x 新特性](/framework/springsecurity/v6)。

---

## 相关模块

- [Shiro 权限框架](/framework/shiro/index) — 另一个选择，对比学习
- [JWT 生成与验证](/framework/springsecurity/jwt) — 无状态认证核心
- [Gateway 统一鉴权](/framework/springsecurity/gateway-auth) — 微服务安全
- [OAuth2 登录](/framework/springsecurity/oauth2-login) — 第三方登录

---

## 面试高频问题

| 问题 | 难度 | 涉及文档 |
|-----|------|---------|
| Spring Security 过滤器链的执行顺序？ | ⭐⭐ | [过滤器链](/framework/springsecurity/filter-chain) |
| Authentication 和 Authorization 的区别？ | ⭐ | [核心流程](/framework/springsecurity/core-flow) |
| Session 和 JWT 哪种更好？ | ⭐⭐⭐ | [Session](/framework/springsecurity/session) + [JWT](/framework/springsecurity/jwt) |
| 如何自定义一个认证流程？ | ⭐⭐ | [自定义认证](/framework/springsecurity/userdetails) |
| RBAC 权限模型是什么？ | ⭐⭐ | [RBAC](/framework/springsecurity/rbac) |
| CSRF 攻击的原理和防护方式？ | ⭐⭐⭐ | [CSRF](/framework/springsecurity/csrf) |

> 完整的面试问题汇总，请查看 [Spring Security 面试高频问题汇总](/framework/springsecurity/interview-summary)。
