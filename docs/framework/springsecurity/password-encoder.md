# PasswordEncoder：BCrypt 密码加密与盐值

你知道吗？2012 年的 LinkedIn 数据泄露事件中，650 万用户的密码是用 SHA-1 存储的，没有盐值。

结果呢？黑客只需要一张彩虹表，几秒钟就能破解大部分密码。

密码存储是系统安全的第一道防线。今天，我们就来深入了解 Spring Security 中的密码加密机制。

---

## 为什么不能明文存储密码？

| 存储方式 | 风险 | 说明 |
|---------|------|------|
| 明文 | ❌ 极度危险 | 数据库泄露 = 所有账户泄露 |
| MD5 / SHA-1 | ❌ 危险 | 可被彩虹表破解 |
| MD5 + 固定盐 | ⚠️ 较弱 | 盐值泄露后仍有风险 |
| BCrypt | ✅ 推荐 | 自适应哈希，安全性高 |
| PBKDF2 / Argon2 | ✅ 推荐 | 专业密码哈希算法 |

---

## PasswordEncoder 接口

Spring Security 提供了统一的密码加密接口：

```java
public interface PasswordEncoder {
    
    // 编码密码（加密）
    String encode(CharSequence rawPassword);
    
    // 校验密码是否匹配
    boolean matches(CharSequence rawPassword, String encodedPassword);
}
```

### Spring Security 内置的实现

| 实现类 | 算法 | 特点 |
|-------|------|------|
| BCryptPasswordEncoder | BCrypt | **推荐**，自适应强度 |
| Argon2PasswordEncoder | Argon2 | 最新标准，最强安全 |
| PBKDF2PasswordEncoder | PBKDF2 | NIST 推荐 |
| SCryptPasswordEncoder | SCrypt | 内存硬算法 |
| NoOpPasswordEncoder | 明文 | ❌ 仅测试用 |
| StandardStringPasswordEncoder | SHA-256 | 不推荐，已废弃 |

---

## BCrypt 密码加密详解

### BCrypt 的特点

BCrypt 是目前最推荐的密码哈希算法，它有三个显著特点：

1. **自适应**：可配置工作因子（默认 10），随着硬件提升可以增加强度
2. **内置盐值**：每次加密自动生成随机盐，不需要单独存储
3. **防暴力破解**：计算成本高，单次哈希可能需要数百毫秒

### BCrypt 的加密结果

```java
@Bean
public PasswordEncoder passwordEncoder() {
    return new BCryptPasswordEncoder();
}

// 每次加密结果都不同（因为盐值随机）
System.out.println(passwordEncoder.encode("123456"));
// 输出：$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi
// 输出：$2a$10$8K1p/a0dL2.XsvwCjT5s1OH4g5qXh1zGpJZ5vR0jW8p9mLqQvK6Wy
// 输出：$2a$10$xGz8E6v9K2.YsywCjS4r0pMH6j4dW8yJqL1wQ5vK0cE3nIuXmN9Wy
```

为什么每次结果都不同？因为 BCrypt 的加密结果包含了：

```
$2a$10$N.zmdr9k7uOCQb376NoUnuTJ8iAt6Z5EHsM8lE9lBOsl7iKTVKIUi
 │  │  │
 │  │  └── 31位 Salt + Hash（Base64编码）
 │  └───── 工作因子（cost factor），表示计算强度
 └───────── 算法版本
```

### 工作因子（Cost Factor）

工作因子决定了哈希的计算成本。公式：`cost = 2^cost_factor`

| 工作因子 | 迭代次数 | 典型耗时 | 建议场景 |
|---------|---------|---------|---------|
| 10 | 1024 | ~200ms | 默认值 |
| 12 | 4096 | ~700ms | 高安全场景 |
| 14 | 16384 | ~3s | 极高安全场景 |

```java
// 自定义工作因子
@Bean
public PasswordEncoder passwordEncoder() {
    // 工作因子 12，安全性更高但验证更慢
    return new BCryptPasswordEncoder(12);
}
```

> **注意**：工作因子越高，验证越慢。在登录场景中，用户等待时间会变长。通常 10-12 是合理的平衡。

---

## 密码加密在 Spring Security 中的使用

### 1. 注册时加密密码

```java
@Service
public class UserService {
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    public void register(UserDTO dto) {
        // 1. 创建用户
        User user = new User();
        user.setUsername(dto.getUsername());
        
        // 2. 密码加密存储
        user.setPassword(passwordEncoder.encode(dto.getPassword()));
        
        // 3. 保存用户
        userMapper.insert(user);
    }
}
```

### 2. 登录时验证密码

```java
@Service
public class CustomUserDetailsService implements UserDetailsService {
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    @Override
    public UserDetails loadUserByUsername(String username) {
        User user = userMapper.findByUsername(username);
        
        // 密码验证由 DaoAuthenticationProvider 自动完成
        // 这里只需要确保返回的 UserDetails 包含加密后的密码
        
        return User.builder()
            .username(user.getUsername())
            .password(user.getPassword())  // 数据库中已加密的密码
            .authorities("ROLE_USER")
            .build();
    }
}
```

### 3. 密码更新

```java
@Service
public class UserService {
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    // 修改密码
    public void changePassword(String username, String oldPwd, String newPwd) {
        User user = userMapper.findByUsername(username);
        
        // 验证旧密码
        if (!passwordEncoder.matches(oldPwd, user.getPassword())) {
            throw new BadCredentialsException("原密码错误");
        }
        
        // 更新为新密码（重新加密）
        user.setPassword(passwordEncoder.encode(newPwd));
        userMapper.update(user);
    }
    
    // 重置密码（管理员操作）
    public void resetPassword(Long userId, String newPassword) {
        User user = userMapper.findById(userId);
        user.setPassword(passwordEncoder.encode(newPassword));
        userMapper.update(user);
    }
}
```

---

## DelegatingPasswordEncoder：支持多种密码格式

如果系统需要从旧架构迁移，而旧系统用的是 MD5，怎么平滑过渡？

`DelegatingPasswordEncoder` 可以让你同时支持多种密码格式：

```java
@Configuration
public class SecurityConfig {
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        // 定义 ID 到 PasswordEncoder 的映射
        Map&lt;String, PasswordEncoder&gt; encoders = new HashMap&lt;&gt;();
        encoders.put("bcrypt", new BCryptPasswordEncoder());
        encoders.put("md5", new MessageDigestPasswordEncoder("MD5"));
        encoders.put("noop", NoOpPasswordEncoder.getInstance());
        
        // 默认使用 BCrypt
        return new DelegatingPasswordEncoder("bcrypt", encoders);
    }
}
```

### DelegatingPasswordEncoder 的密码格式

```
{id}encodedPassword

例如：
{bcrypt}$2a$10$...
{md5}5f4dcc3b5aa765d61d8327deb882cf99
{noop}plaintext
```

### 迁移策略

假设旧密码都是 MD5 存储的，可以这样迁移：

```java
@Service
public class LoginService {
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    public Authentication login(String username, String password) {
        User user = userMapper.findByUsername(username);
        
        // 判断密码是否需要迁移
        if (user.getPassword().startsWith("{md5}")) {
            // 老格式，先用 MD5 验证
            String md5Hash = "{md5}" + md5(password);
            if (md5Hash.equals(user.getPassword())) {
                // 验证成功，自动升级为 BCrypt
                user.setPassword(passwordEncoder.encode(password));
                userMapper.update(user);
                // 完成登录
            }
        } else {
            // 直接用 DelegatingPasswordEncoder 验证
            if (passwordEncoder.matches(password, user.getPassword())) {
                // 完成登录
            }
        }
    }
}
```

---

## 盐值（Salt）详解

### 什么是盐值？

盐值是一个随机字符串，和密码一起哈希，目的是防止彩虹表攻击。

```
没有盐：
  密码 "123456"  →  MD5  →  "e10adc3949ba59abbe56e057f20f883e"
  
有盐（salt = "random123"）：
  密码 "123456" + 盐 "random123"  →  MD5  →  "a1b2c3d4..."
  
  存储：{salt}hash = "{random123}a1b2c3d4..."
```

### BCrypt 如何处理盐值？

BCrypt 的盐值是**内置**在哈希结果中的，不需要单独存储。

```java
BCryptPasswordEncoder encoder = new BCryptPasswordEncoder();

// 每次生成不同的盐
String hash1 = encoder.encode("password");
String hash2 = encoder.encode("password");

// hash1 ≠ hash2（因为盐不同）
// 但 matches() 都能验证通过
encoder.matches("password", hash1);  // true
encoder.matches("password", hash2);  // true
```

### BCrypt 的盐值生成原理

```java
// BCrypt 生成随机盐
SecureRandom random = new SecureRandom();
byte[] salt = new byte[16];
random.nextBytes(salt);

// 盐值会编码后嵌入到最终的哈希字符串中
// 所以 BCryptPasswordEncoder.encode() 返回的字符串本身就包含了盐值
```

---

## 密码加密最佳实践

### 应该做的

```java
@Configuration
public class PasswordBestPractices {
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        // 1. 使用 BCrypt 或 Argon2
        return new BCryptPasswordEncoder(12);  // 工作因子 12
        
        // 或使用 Argon2（需要额外依赖）
        // return Argon2PasswordEncoder.defaults();
    }
}
```

### 不应该做的

```java
// ❌ 不要使用这些方式存储密码
public class BadExamples {
    
    // 明文存储
    void savePassword_plain(String password) {
        user.setPassword(password);  // 危险！
    }
    
    // MD5 哈希（无盐）
    void savePassword_md5(String password) {
        user.setPassword(md5(password));  // 危险！可被彩虹表破解
    }
    
    // 自定义哈希
    void savePassword_custom(String password) {
        // 不要自己发明加密算法
        user.setPassword(sha256(sha256(password) + "固定的盐"));  // 危险！
    }
}
```

### 密码强度要求

建议在注册时检查密码强度：

```java
@Service
public class PasswordValidator {
    
    public boolean isStrong(String password) {
        if (password == null || password.length() &lt; 8) {
            return false;
        }
        
        boolean hasUpper = false;
        boolean hasLower = false;
        boolean hasDigit = false;
        boolean hasSpecial = false;
        
        for (char c : password.toCharArray()) {
            if (Character.isUpperCase(c)) hasUpper = true;
            if (Character.isLowerCase(c)) hasLower = true;
            if (Character.isDigit(c)) hasDigit = true;
            if (!Character.isLetterOrDigit(c)) hasSpecial = true;
        }
        
        return hasUpper && hasLower && hasDigit && hasSpecial;
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| BCrypt 为什么比 MD5 更安全？ | 算法原理 | 本篇 |
| BCrypt 的工作因子是什么？有什么用？ | 参数理解 | 本篇 |
| 密码为什么不能解密？ | 哈希原理 | 本篇 |
| 如何实现密码迁移（从 MD5 到 BCrypt）？ | 迁移方案 | DelegatingPasswordEncoder |
| BCrypt 的盐值存在哪里？ | 实现细节 | 本篇 |
| 除了 BCrypt，还有什么推荐算法？ | 技术选型 | Argon2 / PBKDF2 |

---

## 总结

密码加密是安全系统的基石：

1. **不要明文存储**：数据库泄露 = 密码泄露
2. **使用 BCrypt**：自适应强度、内置盐值、防暴力破解
3. **工作因子适中**：10-12 是性能和安全性的平衡
4. **支持迁移**：通过 DelegatingPasswordEncoder 平滑升级
5. **配合密码强度检查**：从源头把控密码质量

记住：**密码安全不只是加密算法的问题，还包括传输安全、存储安全、访问控制等多个层面。**

---

## 下一步

- 想了解登录过滤器的工作原理？→ [表单登录流程](/framework/springsecurity/form-login)
- 想自定义认证逻辑？→ [UserDetailsService 与自定义认证](/framework/springsecurity/userdetails)
- 想了解会话管理？→ [Session 会话管理](/framework/springsecurity/session)
