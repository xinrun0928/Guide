# Shiro 认证流程：login() → SecurityUtils.getSubject()

用户登录，是我们接触最多的安全功能。

但你有没有想过：从用户输入用户名密码，到最终提示「登录成功」或「密码错误」，中间发生了什么？

今天，我们从源码角度，揭开 Shiro 认证流程的神秘面纱。

## 认证流程概览

先上一张流程图：

```
用户点击登录
     │
     ▼
┌────────────────────────────────────┐
│  SecurityUtils.getSubject()        │ 获取当前用户
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  subject.login(token)              │ 提交认证令牌
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  SecurityManager.login()          │ 委托给安全管理器
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  Authenticator.authenticate()      │ 调用认证器
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  ModularRealmAuthenticator         │ 支持多 Realm 认证
│    └─▶ Realm.doGetAuthenticationInfo() │ 获取认证信息
└────────────────────────────────────┘
     │
     ▼
┌────────────────────────────────────┐
│  CredentialsMatcher               │ 比对凭证（密码）
└────────────────────────────────────┘
     │
     ├─ 匹配成功 ─▶ 返回 AuthenticationInfo
     │
     └─ 匹配失败 ─▶ 抛出 AuthenticationException
```

## 从代码开始

### 第一步：获取 Subject

```java
// 几乎每个 Shiro 应用的第一行代码
Subject subject = SecurityUtils.getSubject();
```

`SecurityUtils` 是一个工具类，它从 `ThreadLocal` 中获取当前线程绑定的 SecurityManager：

```java
public class SecurityUtils {
    
    private static SecurityManager securityManager;
    
    public static Subject getSubject() {
        Subject subject = ThreadContext.getSubject();
        if (subject == null) {
            subject = new Subject.Builder().buildSubject();
            ThreadContext.bind(subject);
        }
        return subject;
    }
}
```

**关键点**：Shiro 通过 `ThreadLocal` 存储 Subject，这意味着每个线程都有独立的用户上下文。在 Web 环境下，Shiro 会通过 Filter 将 Session 中的 Subject 绑定到请求线程。

### 第二步：创建认证令牌

```java
// 用户提交的表单数据
String username = "admin";
String password = "123456";

// 创建认证令牌
UsernamePasswordToken token = new UsernamePasswordToken(username, password);

// 可选：记住我
token.setRememberMe(true);
```

`UsernamePasswordToken` 实现了 `AuthenticationToken` 接口：

```java
public class UsernamePasswordToken implements HostAuthenticationToken, Serializable {
    
    private String username;
    private char[] password;
    private boolean rememberMe;
    private String host;
    
    public UsernamePasswordToken(String username, String password) {
        this.username = username;
        this.password = password == null ? null : password.toCharArray();
    }
    
    // getUsername, getPassword, setRememberMe...
}
```

### 第三步：执行登录

```java
Subject subject = SecurityUtils.getSubject();

try {
    // 登录
    subject.login(token);
    // 登录成功
    System.out.println("登录成功");
} catch (UnknownAccountException e) {
    // 用户不存在
    System.out.println("用户不存在");
} catch (IncorrectCredentialsException e) {
    // 密码错误
    System.out.println("密码错误");
} catch (LockedAccountException e) {
    // 账户被锁定
    System.out.println("账户被锁定");
} catch (AuthenticationException e) {
    // 其他认证异常
    System.out.println("认证失败: " + e.getMessage());
}
```

**重要**：Shiro 的异常体系很完善，建议根据具体异常类型做用户体验优化。

## 深入源码：SecurityManager.login()

`subject.login()` 实际调用的是 `SecurityManager` 的方法：

```java
public class DefaultSecurityManager extends AuthenticatingSecurityManager {
    
    public AuthenticationInfo login(Subject subject, 
                                     AuthenticationToken token) 
            throws AuthenticationException {
        
        AuthenticationInfo info;
        try {
            // 调用 Authenticator 进行认证
            info = this.authenticator.authenticate(token);
        } catch (AuthenticationException ae) {
            // 认证失败，抛出异常
            throw ae;
        }
        
        // 认证成功，创建 Subject 状态
        Subject loggedIn = createSubject(token, info, subject);
        
        // 绑定到 ThreadLocal
        ThreadContext.bind(loggedIn);
        
        return info;
    }
}
```

## 深入源码：Authenticator.authenticate()

Shiro 默认使用 `ModularRealmAuthenticator`，它支持多 Realm 认证：

```java
public class ModularRealmAuthenticator extends AuthorizingRealm {
    
    public AuthenticationInfo authenticate(AuthenticationToken token) 
            throws AuthenticationException {
        
        // 1. 确保至少配置了一个 Realm
        assertRealmsConfigured();
        
        // 2. 获取所有配置的 Realm
        Collection&lt;Realm&gt; realms = getRealms();
        
        // 3. 调用认证策略
        return this.authenticationStrategy.doMultiRealmAuthentication(
            realms, token);
    }
}
```

### 认证策略

`AuthenticationStrategy` 接口定义了多 Realm 场景下的认证策略：

```java
public interface AuthenticationStrategy {
    // 在所有 Realm 认证之前调用
    AuthenticationInfo beforeAllAttempts(Collection&lt;? extends Realm&gt; realms, 
                                          AuthenticationToken token);
    
    // 在每个 Realm 认证之前调用
    AuthenticationInfo beforeAttempt(Realm realm, AuthenticationToken token, 
                                      AuthenticationInfo info);
    
    // 在每个 Realm 认证之后调用
    AuthenticationInfo afterAttempt(Realm realm, AuthenticationToken token, 
                                     AuthenticationInfo info, 
                                     Throwable t);
    
    // 在所有 Realm 认证之后调用
    AuthenticationInfo afterAllAttempts(AuthenticationToken token, 
                                         AuthenticationInfo info);
}
```

Shiro 内置三种策略：

| 策略 | 行为 | 使用场景 |
|-----|------|---------|
| `AtLeastOneSuccessfulStrategy` | 至少一个 Realm 成功 | 默认策略 |
| `FirstSuccessfulStrategy` | 第一个 Realm 成功即可 | 多数据源，优先使用主数据源 |
| `AllSuccessfulStrategy` | 所有 Realm 都必须成功 | 高安全场景 |

配置方式：

```java
ModularRealmAuthenticator authenticator = new ModularRealmAuthenticator();
authenticator.setAuthenticationStrategy(new FirstSuccessfulStrategy());
securityManager.setAuthenticator(authenticator);
```

## 核心：Realm.doGetAuthenticationInfo()

每个 Realm 都必须实现 `doGetAuthenticationInfo()` 方法，这是认证的核心：

```java
protected abstract AuthenticationInfo doGetAuthenticationInfo(
    AuthenticationToken token) throws AuthenticationException;
```

一个典型的实现：

```java
public class MyRealm extends AuthorizingRealm {
    
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        
        // 1. 获取用户名
        UsernamePasswordToken upToken = (UsernamePasswordToken) token;
        String username = upToken.getUsername();
        
        // 2. 边界检查
        if (username == null) {
            throw new AccountException("用户名不能为空");
        }
        
        // 3. 从数据库查询用户
        User user = userDAO.findByUsername(username);
        if (user == null) {
            throw new UnknownAccountException("用户不存在");
        }
        
        // 4. 检查账户状态
        if (user.isLocked()) {
            throw new LockedAccountException("账户已被锁定");
        }
        
        // 5. 返回认证信息（包含加密后的密码）
        // Shiro 会自动使用配置的 CredentialsMatcher 比对密码
        return new SimpleAuthenticationInfo(
            user.getUsername(),    // principal（用户身份）
            user.getPassword(),    // credentials（凭证）
            getName()              // realm name
        );
    }
}
```

### AuthenticationInfo 的结构

```java
public interface AuthenticationInfo extends Serializable {
    
    // 主要身份（通常是用户名）
    PrincipalCollection getPrincipals();
    
    // 凭证（通常是密码）
    Object getCredentials();
}
```

`SimpleAuthenticationInfo` 是常用实现：

```java
// 构造函数重载
public SimpleAuthenticationInfo(Object principal, Object credentials) {
    this.principals = new SimplePrincipalCollection(principal, getName());
    this.credentials = credentials;
}

public SimpleAuthenticationInfo(Object principal, Object credentials, String realmName) {
    this.principals = new SimplePrincipalCollection(principal, realmName);
    this.credentials = credentials;
}
```

## 密码比对：CredentialsMatcher

Realm 返回 `AuthenticationInfo` 后，Shiro 会自动调用 `CredentialsMatcher` 比对密码：

```java
public interface CredentialsMatcher {
    
    boolean doCredentialsMatch(AuthenticationToken token, 
                               AuthenticationInfo info);
}
```

### 常用实现

**1. SimpleCredentialsMatcher**（默认）

```java
// 简单比对，不加密
public boolean doCredentialsMatch(AuthenticationToken token, 
                                   AuthenticationInfo info) {
    Object tokenCredentials = getCredentials(token);
    Object accountCredentials = getCredentials(info);
    return equals(tokenCredentials, accountCredentials);
}
```

**2. HashedCredentialsMatcher**（推荐）

```java
// 使用哈希加密
HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
matcher.setHashAlgorithmName("MD5");  // 或 SHA-256
matcher.setHashIterations(1024);      // 迭代次数
matcher.setStoredCredentialsHexEncoded(true);
realm.setCredentialsMatcher(matcher);
```

关于密码加密的详细内容，我们会在后续章节展开。

## 完整登录代码示例

```java
@RestController
public class LoginController {
    
    @PostMapping("/login")
    public Result&lt;String&gt; login(@RequestParam String username, 
                                   @RequestParam String password) {
        
        Subject subject = SecurityUtils.getSubject();
        
        // 如果已经登录过，先登出
        if (subject.isAuthenticated()) {
            subject.logout();
        }
        
        // 创建令牌
        UsernamePasswordToken token = new UsernamePasswordToken(
            username, password);
        token.setRememberMe(true);
        
        try {
            // 执行登录
            subject.login(token);
            
            // 登录成功
            return Result.success("登录成功");
            
        } catch (UnknownAccountException e) {
            return Result.error("用户名不存在");
        } catch (IncorrectCredentialsException e) {
            return Result.error("密码错误");
        } catch (LockedAccountException e) {
            return Result.error("账户已被锁定");
        } catch (AuthenticationException e) {
            return Result.error("认证失败: " + e.getMessage());
        }
    }
    
    @PostMapping("/logout")
    public Result&lt;String&gt; logout() {
        Subject subject = SecurityUtils.getSubject();
        subject.logout();
        return Result.success("已退出登录");
    }
}
```

## 面试追问方向

**面试官可能会问**：

1. **Shiro 的认证流程是怎样的？**
   - 重点：Subject → SecurityManager → Authenticator → Realm → CredentialsMatcher

2. **如果配置多个 Realm，认证顺序是怎样的？**
   - 重点：`ModularRealmAuthenticator` 会遍历所有配置的 Realm

3. **Subject.isAuthenticated() 和 isRemembered() 的区别？**
   - `isAuthenticated()`：用户通过输入密码登录
   - `isRemembered()`：用户通过 RememberMe 功能自动登录

4. **密码为什么不能用明文存储？**
   - 防止数据库泄露后用户密码暴露
   - 支持盐值和多次哈希增加破解难度

---

## 留给你的问题

用户登录成功了，但 Shiro 把登录状态存在哪里？

——是 Session。下一节，我们会深入了解 Shiro 的会话管理机制。
