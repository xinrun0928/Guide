# IniRealm 与 properties 方式配置用户权限

从一个最简单的场景开始：**我只有几个用户，不想连数据库，怎么配置？**

答案就是 IniRealm。

## 为什么需要 IniRealm？

在正式项目中，我们通常会连接数据库。但对于以下场景，IniRealm 非常有用：

- **Demo 项目**：快速演示 Shiro 功能
- **小型内部系统**：用户少，权限简单
- **测试环境**：不需要真实的数据库连接
- **学习阶段**：先跑通流程，再深入数据库

## INI 配置文件结构

Shiro 使用 INI 格式的配置文件，语法简单直观：

```ini
[users]
# 用户名 = 密码, 角色1, 角色2
admin = 123456, admin, user
zhangsan = 123456, user
lisi = 123456, guest

[roles]
# 角色 = 权限1, 权限2
admin = *
user = user:view, user:edit
guest = user:view
```

### 配置详解

**[users]** 部分定义用户：

```ini
# 格式：username = password, role1, role2, ...
zhangsan = 123456, admin, manager
```

| 组成部分 | 说明 |
|---------|------|
| `zhangsan` | 用户名 |
| `123456` | 密码（明文，可配置加密） |
| `admin, manager` | 拥有的角色列表 |

**[roles]** 部分定义角色：

```ini
# 格式：rolename = permission1, permission2, ...
admin = *
manager = user:*, order:*
user = user:view, user:edit
guest = user:view
```

| 通配符 | 含义 |
|-------|------|
| `*` | 所有权限 |
| `user:*` | user 模块的所有权限 |
| `user:view,user:edit` | user 模块的 view 和 edit 权限 |

## Java 代码配置

### 方式一：指定 INI 文件路径

```java
public class ShiroIniConfig {
    
    @Bean
    public SecurityManager securityManager() {
        // 从 classpath 加载 INI 文件
        IniRealm realm = new IniRealm("classpath:shiro.ini");
        
        DefaultSecurityManager securityManager = new DefaultWebSecurityManager();
        securityManager.setRealm(realm);
        
        return securityManager;
    }
    
    @Bean
    public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
        ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
        factory.setSecurityManager(manager);
        factory.setLoginUrl("/login");
        factory.setUnauthorizedUrl("/unauthorized");
        return factory;
    }
}
```

### 方式二：使用 Ini 类（不依赖文件）

```java
@Bean
public Realm iniRealm() {
    // 使用 Ini 类在代码中定义
    Ini ini = new Ini();
    ini.load("[users]\nzhangsan = 123456, admin");
    
    return new IniRealm(ini);
}
```

### 方式三：使用 ShiroFilterFactoryBean 的 iniDefineClause

```java
@Bean
public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
    ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
    factory.setSecurityManager(manager);
    
    // 定义 INI 配置
    LinkedHashMap&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
    filterChain.put("/static/**", "anon");
    filterChain.put("/login", "anon");
    filterChain.put("/**", "authc");
    
    factory.setFilterChainDefinitionMap(filterChain);
    
    return factory;
}
```

## 使用 Properties 文件配置用户

如果觉得 INI 格式不够直观，可以使用 properties 文件：

### 定义用户文件（users.properties）

```properties
# 用户名 = 密码
zhangsan = 123456
lisi = 123456
wangwu = 123456
```

### 定义角色文件（roles.properties）

```properties
# 角色 = 权限列表
admin = *
manager = user:*, order:*
user = user:view, user:edit, order:create, order:view
guest = user:view, order:view
```

### 加载 Properties 文件

```java
@Bean
public Realm propertiesRealm() {
    Ini ini = new Ini();
    
    // 加载 users.properties
    ini.loadFromPath("classpath:users.properties", 
        Ini.DEFAULT_SECTION_SEPARATOR, 
        Ini.DEFAULT_KEY_VALUE_SEPARATOR);
    
    // 创建 Realm
    IniRealm realm = new IniRealm(ini);
    
    // 如果密码是加密的，需要配置 CredentialsMatcher
    HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
    matcher.setHashAlgorithmName("MD5");
    matcher.setHashIterations(2);
    realm.setCredentialsMatcher(matcher);
    
    return realm;
}
```

## 密码加密配置

IniRealm 默认使用明文密码，但在生产环境中**绝对不要使用明文**。

### MD5 加密配置

```ini
[main]
# 配置密码加密
credentialsMatcher = org.apache.shiro.authc.credential.HashedCredentialsMatcher
credentialsMatcher.hashAlgorithmName = MD5
credentialsMatcher.hashIterations = 2
credentialsMatcher.storedCredentialsHexEncoded = true

[users]
# 密码使用 MD5("123456", salt="zhangsan") 的结果
# zhangsan = 098f6bcd4621d373cade4e832627b4f6, admin
zhangsan = 098f6bcd4621d373cade4e832627b4f6, admin
```

生成 MD5 哈希值的 Java 代码：

```java
public class PasswordEncoder {
    
    public static void main(String[] args) {
        String password = "123456";
        String salt = "zhangsan";  // 通常使用随机盐
        
        // 计算哈希
        SimpleHash hash = new SimpleHash(
            "MD5",
            password,
            salt,
            2  // 迭代次数
        );
        
        System.out.println("MD5 Hash: " + hash.toString());
    }
}
```

### 使用盐值增强安全性

```ini
[users]
# 格式：username = password[base64], role1, role2
# password 是 MD5(password + salt) 的结果
zhangsan = 098f6bcd4621d373cade4e832627b4f6, admin
```

```java
@Bean
public Realm iniRealm() {
    IniRealm realm = new IniRealm("classpath:shiro.ini");
    
    // 配置盐值加密
    HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
    matcher.setHashAlgorithmName("MD5");
    matcher.setHashIterations(2);
    matcher.setStoredCredentialsHexEncoded(true);
    
    // 设置盐值来源：使用用户名作为盐值
    matcher.setCredentialsMatcher(new HashedCredentialsMatcher("MD5") {{
        setHashIterations(2);
    }});
    
    realm.setCredentialsMatcher(matcher);
    
    return realm;
}
```

## 完整示例

### 项目结构

```
src/main/resources/
├── shiro.ini
└── shiro-realm.java
```

### shiro.ini

```ini
[users]
# 用户名 = 密码, 角色
admin = 123456, admin, user
zhangsan = 123456, manager
lisi = 123456, user
wangwu = 123456, guest

[roles]
# 角色 = 权限
admin = *
manager = user:*, order:*
user = user:view, user:edit, order:create, order:view
guest = user:view, order:view
```

### ShiroConfig.java

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager() {
        IniRealm realm = new IniRealm("classpath:shiro.ini");
        
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        manager.setRealm(realm);
        
        return manager;
    }
    
    @Bean
    public ShiroFilterFactoryBean shiroFilterFactoryBean(SecurityManager manager) {
        ShiroFilterFactoryBean factory = new ShiroFilterFactoryBean();
        factory.setSecurityManager(manager);
        factory.setLoginUrl("/login");
        factory.setUnauthorizedUrl("/403");
        
        // URL 过滤器链配置
        LinkedHashMap&lt;String, String&gt; filterChain = new LinkedHashMap&lt;&gt;();
        filterChain.put("/css/**", "anon");
        filterChain.put("/js/**", "anon");
        filterChain.put("/login", "anon");
        filterChain.put("/logout", "logout");
        filterChain.put("/admin/**", "roles[admin]");
        filterChain.put("/**", "authc");
        
        factory.setFilterChainDefinitionMap(filterChain);
        
        return factory;
    }
}
```

### LoginController.java

```java
@Controller
public class LoginController {
    
    @GetMapping("/login")
    public String loginPage() {
        return "login";
    }
    
    @PostMapping("/login")
    public String login(String username, String password, Model model) {
        Subject subject = SecurityUtils.getSubject();
        
        if (!subject.isAuthenticated()) {
            UsernamePasswordToken token = 
                new UsernamePasswordToken(username, password);
            
            try {
                subject.login(token);
                return "redirect:/index";
            } catch (AuthenticationException e) {
                model.addAttribute("error", "用户名或密码错误");
                return "login";
            }
        }
        
        return "redirect:/index";
    }
    
    @GetMapping("/logout")
    public String logout() {
        Subject subject = SecurityUtils.getSubject();
        subject.logout();
        return "redirect:/login";
    }
}
```

## IniRealm 的局限性

IniRealm 很方便，但它有明显的局限性：

| 局限性 | 说明 |
|-------|------|
| **不支持动态更新** | 修改 INI 文件后需要重启应用 |
| **不适合大量用户** | 用户多了配置文件会变得难以维护 |
| **不支持复杂的权限逻辑** | 如数据级别的权限控制 |
| **密码存储不够安全** | 即使加密也不如数据库安全 |

**实际项目中**，IniRealm 通常只用于：
- 开发测试阶段
- 用户数量固定的小型系统
- 学习 Shiro 原理

生产环境推荐使用 [JDBCRealm](/framework/shiro/jdbc-realm) 或 [自定义 Realm](/framework/shiro/custom-realm)。

---

## 留给你的问题

IniRealm 把用户和权限信息写在配置文件里，但真实项目的数据都在数据库里。

下一节，我们来看看 Shiro 如何连接数据库进行认证授权——JDBCRealm。
