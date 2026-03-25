# Shiro 密码加密：HashedCredentialsMatcher 与盐值

你可能听说过这句话：**「永远不要明文存储用户密码」**。

但为什么要加密？怎么加密？加盐又是什么？

这一节，我们来彻底搞懂 Shiro 的密码加密机制。

## 为什么不存储明文密码？

如果数据库被拖库（泄露），明文密码意味着：
- 用户的银行卡密码、邮箱密码可能全部暴露
- 用户在多个平台使用相同密码的习惯会放大损失
- 公司面临法律风险和公关危机

所以，**密码必须加密存储**。

## 加密算法选型

### 对称加密 vs 哈希加密

| 类型 | 特点 | 代表算法 | 适合场景 |
|-----|------|---------|---------|
| **对称加密** | 加密和解密用同一把密钥 | AES、DES | 数据传输加密 |
| **哈希加密** | 单向的，无法反向解密 | MD5、SHA-256 | 密码存储 |

**密码存储必须用哈希**，因为我们只需要比对，不需要还原。

### 常见哈希算法对比

| 算法 | 输出长度 | 安全性 | 性能 | 建议 |
|-----|---------|-------|------|------|
| MD5 | 128 位 | 低（可被破解） | 快 | 不推荐 |
| SHA-1 | 160 位 | 低（已不推荐） | 快 | 不推荐 |
| SHA-256 | 256 位 | 中 | 中 | 勉强可用 |
| SHA-512 | 512 位 | 高 | 慢 | 推荐 |
| bcrypt | 可变 | 高 | 慢 | **强烈推荐** |
| Argon2 | 可变 | 高 | 慢 | **最佳推荐** |

## 基础概念：盐值

### 什么是盐值？

盐值（Salt）是一个随机字符串，在密码哈希前添加：

```
hash(password + salt)
```

### 为什么需要盐值？

**没有盐值**：
```
用户1: password → hash → abc123
用户2: password → hash → abc123
用户3: password → hash → abc123

攻击者一眼看出：三个用户的密码相同！
彩虹表可以快速破解常见密码。
```

**有盐值**：
```
用户1: password + zhangsan → hash → xxxx
用户2: password + lisi     → hash → yyyy
用户3: password + wangwu   → hash → zzzz

即使密码相同，存储的结果也不同。
彩虹表失效（表里没有这些组合）。
```

### 盐值的作用

1. **防止彩虹表攻击**：每个用户用不同的盐，彩虹表无法匹配
2. **防止相同密码露出相同指纹**：增加破解难度
3. **增加暴力破解成本**：每次破解都需要针对特定盐值

## Shiro 密码加密实现

### 核心组件：HashedCredentialsMatcher

```java
public class HashedCredentialsMatcher implements CredentialsMatcher {
    
    private String hashAlgorithm;      // 哈希算法
    private int hashIterations;         // 迭代次数
    private boolean storedCredentialsHexEncoded;  // 存储格式
    
    @Override
    public boolean doCredentialsMatch(AuthenticationToken token, 
                                      AuthenticationInfo info) {
        // 1. 获取用户输入的密码
        Object tokenCredentials = getCredentials(token);
        
        // 2. 获取数据库存储的密码
        Object accountCredentials = getCredentials(info);
        
        // 3. 比对两者
        return equals(tokenCredentials, accountCredentials);
    }
}
```

### 配置方式

```java
@Bean
public HashedCredentialsMatcher hashedCredentialsMatcher() {
    HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
    matcher.setHashAlgorithmName("SHA-256");     // 哈希算法
    matcher.setHashIterations(3);               // 迭代 3 次
    matcher.setStoredCredentialsHexEncoded(false);  // base64 编码
    return matcher;
}

@Bean
public CustomRealm customRealm() {
    CustomRealm realm = new CustomRealm();
    realm.setCredentialsMatcher(hashedCredentialsMatcher());
    return realm;
}
```

## 盐值配置

### 方式一：使用用户名作为盐值

```java
@Override
protected AuthenticationInfo doGetAuthenticationInfo(
        AuthenticationToken token) throws AuthenticationException {
    
    UsernamePasswordToken upToken = (UsernamePasswordToken) token;
    String username = upToken.getUsername();
    
    User user = userMapper.findByUsername(username);
    
    // 使用用户名作为盐值
    return new SimpleAuthenticationInfo(
        user.getUsername(),
        user.getPassword(),
        ByteSource.Util.bytes(user.getSalt()),  // 数据库中存储的盐值
        getName()
    );
}
```

### 方式二：使用随机盐值

生成密码时使用随机盐：

```java
public class PasswordEncoder {
    
    public String encode(String rawPassword) {
        // 1. 生成随机盐
        String salt = generateSalt();
        
        // 2. 计算哈希
        String hashedPassword = hash(rawPassword, salt);
        
        // 3. 返回 "盐值$哈希值" 格式
        return salt + "$" + hashedPassword;
    }
    
    private String generateSalt() {
        // 生成 16 字节的随机盐
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }
    
    private String hash(String password, String salt) {
        SimpleHash simpleHash = new SimpleHash(
            "SHA-256",
            password,
            salt,
            3
        );
        return simpleHash.toBase64();
    }
}
```

### 数据库存储格式

```sql
CREATE TABLE users (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(200) NOT NULL,  -- 格式：salt$hash
    create_time DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 完整示例

### PasswordUtils 工具类

```java
public class PasswordUtils {
    
    private static final String ALGORITHM = "SHA-256";
    private static final int ITERATIONS = 3;
    
    /**
     * 加密密码
     */
    public static String encryptPassword(String rawPassword, String salt) {
        SimpleHash hash = new SimpleHash(
            ALGORITHM,
            rawPassword,
            salt,
            ITERATIONS
        );
        return hash.toBase64();
    }
    
    /**
     * 验证密码
     */
    public static boolean matches(String rawPassword, String salt, 
                                   String storedPassword) {
        String encrypted = encryptPassword(rawPassword, salt);
        return encrypted.equals(storedPassword);
    }
    
    /**
     * 生成随机盐值
     */
    public static String generateSalt() {
        byte[] salt = new byte[16];
        new SecureRandom().nextBytes(salt);
        return Base64.getEncoder().encodeToString(salt);
    }
    
    /**
     * 注册时加密密码
     */
    public static void main(String[] args) {
        String salt = generateSalt();
        String password = "123456";
        String encrypted = encryptPassword(password, salt);
        System.out.println("Salt: " + salt);
        System.out.println("Encrypted: " + encrypted);
    }
}
```

### 自定义 Realm

```java
@Component
public class CustomRealm extends AuthorizingRealm {
    
    @Autowired
    private UserMapper userMapper;
    
    @Override
    protected AuthenticationInfo doGetAuthenticationInfo(
            AuthenticationToken token) throws AuthenticationException {
        
        UsernamePasswordToken upToken = (UsernamePasswordToken) token;
        String username = upToken.getUsername();
        
        User user = userMapper.findByUsername(username);
        if (user == null) {
            throw new UnknownAccountException("用户不存在");
        }
        
        // Realm 返回认证信息，包含盐值
        return new SimpleAuthenticationInfo(
            user.getUsername(),
            user.getPassword(),
            ByteSource.Util.bytes(user.getSalt()),
            getName()
        );
    }
    
    // ... 授权方法省略
}
```

### Shiro 配置

```java
@Configuration
public class ShiroConfig {
    
    @Bean
    public SecurityManager securityManager(CustomRealm customRealm) {
        DefaultSecurityManager manager = new DefaultWebSecurityManager();
        
        // 配置 HashedCredentialsMatcher
        HashedCredentialsMatcher matcher = new HashedCredentialsMatcher();
        matcher.setHashAlgorithmName("SHA-256");
        matcher.setHashIterations(3);
        matcher.setStoredCredentialsHexEncoded(false);  // base64 格式
        customRealm.setCredentialsMatcher(matcher);
        
        manager.setRealm(customRealm);
        return manager;
    }
}
```

## 密码迭代次数的选择

迭代次数越多，破解难度越大，但验证速度越慢。

| 迭代次数 | 破解难度 | 验证性能 | 建议场景 |
|---------|---------|---------|---------|
| 1 | 低 | 快 | 内部测试系统 |
| 3 | 中 | 中 | 一般应用 |
| 1024 | 高 | 较慢 | 高安全需求 |
| 10000+ | 极高 | 慢 | 金融系统 |

**实际建议**：
- 一般应用：迭代 3-10 次
- 高安全系统：迭代 1000-10000 次
- 如果能用 bcrypt/argon2，尽量使用（自适应哈希）

## 常见错误

### 错误一：只加密不解密

```java
// 错误：密码加密后无法比对
String encrypted = encrypt(password);
user.setPassword(encrypted);  // 存进去了

// 验证时怎么比对？无法比对！
```

**正确做法**：存储盐值，验证时用相同盐值加密后比对。

### 错误二：使用相同的盐值

```java
// 错误：所有用户用同一个盐
String SALT = "fixed_salt";
```

这样跟没加盐一样。

**正确做法**：每个用户用不同的随机盐。

### 错误三：使用弱算法

```java
// 错误：MD5 太弱
matcher.setHashAlgorithmName("MD5");
```

**正确做法**：使用 SHA-256 或更强的算法。

## 面试追问方向

**面试官可能会问**：

1. **密码为什么要加盐？**
   - 防止彩虹表攻击
   - 防止相同密码泄露相同指纹
   - 增加暴力破解成本

2. **MD5 加密的密码安全吗？**
   - 不安全，MD5 已被证明可被破解
   - 建议使用 SHA-256 或 bcrypt

3. **迭代次数越多越好吗？**
   - 不是，迭代次数越多，验证越慢
   - 需要在安全性和性能之间平衡

4. **Shiro 怎么知道用哪个盐值？**
   - Realm 返回的 AuthenticationInfo 中包含盐值
   - Shiro 使用 ByteSource 封装盐值

---

## 留给你的问题

密码加密搞定了，但用户登录后的会话状态呢？

下一节，我们来学习 Shiro 的 Session 管理——它可不依赖 Servlet 容器。
