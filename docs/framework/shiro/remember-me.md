# Shiro RememberMe 功能

你有没有注意到，很多网站都有一个「记住我」选项？

勾选后，即使关闭浏览器，下次打开网站也能自动登录。这是怎么实现的？

这一节，我们来学习 Shiro 的 RememberMe 功能。

## RememberMe 是什么？

RememberMe（记住我）是一种自动登录机制：

| 状态 | 说明 | isAuthenticated() | isRemembered() |
|-----|------|-------------------|----------------|
| **未登录** | 用户没有登录过 | false | false |
| **已认证** | 用户输入密码登录 | true | false |
| **已记住** | 用户勾选了「记住我」 | false | true |
| **两者都有** | 已登录且勾选了记住我 | true | true |

**关键区别**：
- `isAuthenticated()`：用户主动输入密码登录，可信度高
- `isRemembered()`：基于 Cookie 自动登录，可信度较低

## 原理：Cookie + 加密

RememberMe 的工作流程：

```
用户勾选「记住我」并登录
         │
         ▼
Server 生成加密的 Cookie
         │
         ▼
Cookie 发送到浏览器存储
         │
         ▼
用户再次访问
         │
         ▼
Shiro 过滤器读取 Cookie
         │
         ▼
解密并恢复用户身份
         │
         ▼
用户自动登录
```

## 快速上手

### 登录时启用 RememberMe

```java
@PostMapping("/login")
public String login(String username, String password, 
                    boolean rememberMe, Model model) {
    
    Subject subject = SecurityUtils.getSubject();
    
    if (!subject.isAuthenticated()) {
        UsernamePasswordToken token = 
            new UsernamePasswordToken(username, password);
        
        // 设置 RememberMe
        token.setRememberMe(rememberMe);
        
        try {
            subject.login(token);
            return "redirect:/index";
        } catch (AuthenticationException e) {
            model.addAttribute("error", "登录失败");
            return "login";
        }
    }
    
    return "redirect:/index";
}
```

### 前端表单

```html
<form action="/login" method="post">
    <input type="text" name="username" placeholder="用户名">
    <input type="password" name="password" placeholder="密码">
    <label>
        <input type="checkbox" name="rememberMe"> 记住我
    </label>
    <button type="submit">登录</button>
</form>
```

## RememberMe 配置

### 基础配置

```java
@Configuration
public class ShiroRememberMeConfig {
    
    @Bean
    public DefaultWebSecurityManager securityManager(
            Realm realm,
            RememberMeManager rememberMeManager) {
        
        DefaultWebSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        manager.setRememberMeManager(rememberMeManager);
        
        return manager;
    }
    
    @Bean
    public CookieRememberMeManager rememberMeManager() {
        CookieRememberMeManager manager = new CookieRememberMeManager();
        
        // 设置 Cookie
        SimpleCookie cookie = new SimpleCookie("rememberMe");
        cookie.setHttpOnly(true);        // 防止 XSS 读取
        cookie.setMaxAge(7 * 24 * 60 * 60);  // 7 天过期
        manager.setCookie(cookie);
        
        // 设置加密密钥（建议使用随机密钥）
        manager.setCipherKey(Base64.getDecoder().decode(
            "encryptedKeyHere1234567890AB"));
        
        return manager;
    }
}
```

### 生成加密密钥

```java
public class GenerateKey {
    
    public static void main(String[] args) {
        // 生成 16 字节的 AES 密钥
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(128);
        SecretKey key = keyGen.generateKey();
        String base64Key = Base64.getEncoder().encodeToString(key.getEncoded());
        System.out.println("Cipher Key: " + base64Key);
    }
}
```

## RememberMe 的安全性

### 安全配置要点

```java
@Bean
public CookieRememberMeManager rememberMeManager() {
    CookieRememberMeManager manager = new CookieRememberMeManager();
    
    // 1. 使用 HTTPS
    SimpleCookie cookie = new SimpleCookie("rememberMe");
    cookie.setHttpOnly(true);           // 防止 JavaScript 读取
    cookie.setSecure(true);             // 只在 HTTPS 下传输
    cookie.setSameSite(Cookie.SameSiteOptions.STRICT);  // CSRF 防护
    cookie.setMaxAge(7 * 24 * 60 * 60); // 合理的过期时间
    
    manager.setCookie(cookie);
    
    // 2. 使用强加密算法
    // Shiro 默认使用 AES-128-CBC 加密
    
    // 3. 设置签名密钥
    manager.setCipherKey(Base64.getDecoder().decode(
        "your32BytesBase64EncodedKey=="));
    
    return manager;
}
```

### 登录状态检查

在处理敏感操作时，需要检查是否是真正的认证状态：

```java
@PostMapping("/transfer")
public String transfer(Long toAccount, BigDecimal amount) {
    Subject subject = SecurityUtils.getSubject();
    
    // 敏感操作必须要求真正的登录状态
    if (!subject.isAuthenticated()) {
        throw new UnauthorizedException("请重新登录");
    }
    
    // 执行转账逻辑
    transferService.doTransfer(toAccount, amount);
    
    return "success";
}
```

### 权限控制

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    factory.setSecurityManager(manager);
    factory.setLoginUrl("/login");
    
    Map&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
    
    // anon：任何人可以访问（可能暴露敏感数据）
    filterChain.put("/index", "anon");
    filterChain.put("/product/list", "anon");
    
    // user：记住我或已认证都可以访问
    filterChain.put("/product/detail/**", "user");
    
    // authc：必须认证
    filterChain.put("/order/**", "authc");
    
    // admin：必须拥有 admin 角色
    filterChain.put("/admin/**", "roles[admin]");
    
    // sensitive：必须真正登录，不接受 RememberMe
    filterChain.put("/transfer/**", "authc");
    
    factory.setFilterChainDefinitionMap(filterChain);
    
    return factory;
}
```

## 登录后升级身份

如果用户通过 RememberMe 自动登录，后来又想访问敏感功能：

```java
@GetMapping("/account/security")
public String securitySettings() {
    Subject subject = SecurityUtils.getSubject();
    
    // 如果只是 RememberMe 状态，需要重新验证
    if (subject.isRemembered() && !subject.isAuthenticated()) {
        return "redirect:/relogin?callback=/account/security";
    }
    
    return "security-settings";
}
```

## 自定义 RememberMe 逻辑

如果需要更复杂的 RememberMe 逻辑：

```java
public class CustomRememberMeManager extends CookieRememberMeManager {
    
    @Override
    protected byte[] getEncryptionCipherKey() {
        // 从配置中心获取密钥
        return getKeyFromConfig("rememberMe.key");
    }
    
    @Override
    protected byte[] getSigningCipherKey() {
        return getKeyFromConfig("rememberMe.signKey");
    }
    
    @Override
    public Subject convertIdentitiesToSubject(Collection&lt;RememberMeIdentity&gt; identities) {
        // 自定义身份转换逻辑
        // 可以从数据库读取更多用户信息
        return super.convertIdentitiesToSubjects(identities);
    }
}
```

## 常见问题

### 问题一：RememberMe Cookie 被盗用怎么办？

**方案**：
1. 定期更换加密密钥
2. 记录 Cookie 使用的 IP 和 User-Agent
3. 异常登录时发送告警

```java
@Override
protected void onSuccessfulLogin(Subject subject, 
                                 AuthenticationToken token,
                                 AuthenticationInfo info) {
    // 记录登录信息
    LoginLog loginLog = new LoginLog();
    loginLog.setUserId(getUserId(subject));
    loginLog.setIpAddress(getCurrentIp());
    loginLog.setUserAgent(getCurrentUserAgent());
    loginLog.setLoginType("REMEMBER_ME");
    loginService.saveLoginLog(loginLog);
    
    // 异常检测
    if (isSuspiciousLogin(subject)) {
        sendSecurityAlert(subject);
    }
}
```

### 问题二：用户修改密码后 RememberMe 怎么办？

```java
public void changePassword(String oldPassword, String newPassword) {
    // 验证旧密码
    verifyPassword(oldPassword);
    
    // 更新密码
    updatePassword(newPassword);
    
    // 清除所有 RememberMe Cookie
    Subject subject = SecurityUtils.getSubject();
    RememberMeManager rememberMeManager = 
        ((DefaultWebSecurityManager) SecurityUtils.getSecurityManager())
            .getRememberMeManager();
    rememberMeManager.forgetIdentity(subject);
}
```

### 问题三：RememberMe 和 Session 冲突？

```
RememberMe Cookie 存在
         │
         ▼
Shiro 恢复 Subject
         │
         ▼
Session 被创建
         │
         ▼
Session 中的数据和数据库不一致？
```

**解决**：在 Subject 恢复时同步 Session 数据。

## 面试追问方向

**面试官可能会问**：

1. **RememberMe 和 Session 的区别？**
   - RememberMe 基于 Cookie，Session 基于服务端存储
   - RememberMe 可实现长期自动登录

2. **RememberMe 为什么不用于敏感操作？**
   - Cookie 可能被盗用
   - 无法验证用户当前是否在操作

3. **RememberMe 的加密机制？**
   - 使用 AES 加密
   - 存储用户 ID 和过期时间

4. **如何防止 RememberMe 被盗用？**
   - HTTPS 传输
   - HttpOnly Cookie
   - 记录登录日志

---

## 留给你的问题

RememberMe 用 Cookie 存储了用户身份，但如果 Cookie 都没了呢？

下一节，我们来学习 Shiro 与 Spring Boot 的集成——把所有的配置串联起来。
