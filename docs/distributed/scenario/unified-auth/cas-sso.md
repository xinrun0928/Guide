# CAS 单点登录原理与流程

你在 A 网站登录了，打开 B 网站，发现——咦，已经登录了？

这听起来很自然，但你有没有想过：**A 网站是怎么「告诉」B 网站用户已经登录的？**

这就是 SSO（Single Sign-On，单点登录）要解决的问题。

## SSO 的定义

单点登录的核心思想很简单：**一次登录，多处访问。**

用户在一个系统登录后，访问其他相关系统，无需再次输入用户名密码。这不仅提升了用户体验，更重要的是——**减少了用户在不同系统使用不同密码带来的安全风险。**

## CAS 的核心流程

CAS（Central Authentication Service，中心认证服务）是 SSO 最经典的实现方案。它的工作流程可以用一句话概括：**「认证中心」统一验证，「各个系统」验证票据。**

### 第一步：用户访问 A 系统，未登录

```
用户 → 访问 A 系统 /home
A 系统检查 Session → 发现未登录
A 系统 → 重定向到 CAS Server，带着 service 参数
```

A 系统告诉 CAS：「有个用户想访问我，你先帮我验证一下。」

### 第二步：CAS Server 验证用户，创建 TGC

```
CAS Server → 显示登录页面
用户输入用户名、密码 → CAS Server 验证
验证通过 → 创建 TGT（Ticket Granting Ticket）和 TGC（Cookie）
```

TGT 是 CAS 服务端存储的用户票据，TGC 是浏览器 Cookie。两者配合，让 CAS 记住「这个浏览器已经登录过了」。

### 第三步：用户带着 ST 回到 A 系统

```
CAS Server → 生成 ST（Service Ticket）
重定向回 A 系统，带着 ST 参数
A 系统收到 ST → 校验 ST 有效性（CAS Server 返回）
验证通过 → 创建 A 系统的 Session，用户成功登录
```

ST（Service Ticket）是一次性的，用完即废。它的存在时间很短，通常是一次 HTTP 请求的时间。

### 第四步：用户访问 B 系统

```
用户 → 访问 B 系统 /order
B 系统检查 Session → 发现未登录
B 系统 → 重定向到 CAS Server，带着 service 参数
CAS Server → 发现浏览器已有 TGC → 直接生成 ST
重定向回 B 系统，带着 ST 参数
B 系统验证 ST → 登录成功
```

注意第四步的关键差异：**用户不需要重新输入密码**，因为 CAS 已经通过 TGC 认识了这个浏览器。

## CAS 的三个核心票据

理解 CAS，必须理解这三个票据的关系：

| 票据 | 全称 | 存储位置 | 用途 |
|-----|------|---------|-----|
| TGC | Ticket Granting Cookie | 浏览器 Cookie | 标识用户的登录状态 |
| TGT | Ticket Granting Ticket | CAS Server 内存/Redis | 生成 ST 的凭证 |
| ST | Service Ticket | 无（一次性） | 各系统验证用户身份 |

TGT 和 TGC 的关系是：TGC 是 TGT 的「钥匙」，浏览器带着 TGC 访问 CAS，CAS 用 TGC 换取 TGT，再用 TGT 生成 ST。

## CAS 的优点

**成熟开源**：CAS 是 Yale 大学发起的一套开源项目，社区活跃，文档完善。

**支持代理模式**：CAS 支持代理认证，一个系统可以代替用户去访问另一个系统的资源。想象一下：你的邮件系统代理用户去访问日历系统获取日程。

**安全性高**：ST 一次性使用，即使被截获也无法重复利用。

**多协议支持**：除了 CAS 协议，还支持 OAuth2、SAML 等协议。

## CAS vs OAuth2

很多人容易混淆 CAS 和 OAuth2，它们的定位不同：

| 对比 | CAS | OAuth2 |
|-----|-----|--------|
| 定位 | 企业内网单点登录 | 开放平台授权 |
| 关注点 | 认证（你是谁） | 授权（你能访问什么） |
| Token | ST（一次性） | Access Token（可刷新） |
| 复杂度 | 相对简单 | 灵活但复杂 |
| 适用场景 | 企业内部多系统 | 第三方应用授权 |

简单来说：**CAS 解决的是「用户登录多个系统」的问题，OAuth2 解决的是「第三方应用访问用户数据」的问题。**

两者解决的问题不同，不要混用。

## 面试追问方向

- CAS 的 ST 为什么设计成一次性的？（答：防止 ST 被截获后冒用）
- CAS 如何实现登出？（答：销毁 TGT，各系统收到通知后清除 Session）
- CAS 如何支持多域名？（答：通过 TGC 跨域，各系统配置信任域）
- CAS 的性能瓶颈在哪？（答：每次验证都需要 CAS Server 网络通信）

如果你对 OAuth2 在微服务中的使用感兴趣，可以继续阅读 [OAuth 2.0 在微服务中的使用](/distributed/scenario/unified-auth/oauth2-microservice)。

一次登录，多处访问——这听起来简单，背后是精心设计的票据机制在支撑。
