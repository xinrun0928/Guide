# 密码安全：最后的防线

2019 年，RockYou 泄露了 1400 万个密码。

分析这些密码后，安全专家发现：
- 10% 的用户使用「123456」
- 3% 的用户使用自己的用户名
- 最常见的密码：123456、password、12345678、qwerty

**密码，是用户账户安全的最后一道防线。**

但这道防线，往往是最薄弱的环节。

## 密码为什么重要

### 密码攻击的类型

```
┌─────────────────────────────────────────────────────────────┐
│                     密码攻击类型                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 暴力破解（Brute Force）                                  │
│     尝试所有可能的组合                                        │
│     aaaa → aaab → aaac → ...                                │
│     时间：10^8 种组合 × 每秒 10^6 次 = 100 秒               │
│                                                             │
│  2. 字典攻击（Dictionary Attack）                            │
│     尝试常见密码列表                                          │
│     password, 123456, admin, iloveyou, ...                  │
│     大部分人在这个列表里                                       │
│                                                             │
│  3. 彩虹表攻击（Rainbow Table）                              │
│     预计算哈希表                                              │
│     直接查表找原始密码                                         │
│                                                             │
│  4. 凭证填充（Credential Stuffing）                         │
│     用其他网站泄露的密码尝试登录                               │
│     密码复用是最大的威胁                                       │
│                                                             │
│  5. 网络钓鱼（Phishing）                                     │
│     伪造登录页面骗取密码                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 密码存储：不是你想的那样

### 错误的做法

```java
// ❌ 绝对禁止的密码存储方式

// 1. 明文存储
public void savePassword(String username, String password) {
    db.execute("INSERT INTO users VALUES (?, ?)", username, password);
    // 数据库里存的是明文！一旦泄露，所有密码都暴露
}

// 2. 可逆加密
public void savePassword(String username, String password) {
    String encrypted = encrypt(password);  // 用密钥加密
    db.execute("INSERT INTO users VALUES (?, ?)", username, encrypted);
    // 密钥泄露 = 密码泄露
}

// 3. 简单哈希
public void savePassword(String username, String password) {
    String hash = md5(password);  // MD5 已被攻破
    db.execute("INSERT INTO users VALUES (?, ?)", username, hash);
    // 彩虹表攻击直接破解
}

// 4. 无盐哈希
public void savePassword(String username, String password) {
    String hash = sha256(password);  // 没有盐
    db.execute("INSERT INTO users VALUES (?, ?)", username, hash);
    // 相同密码有相同哈希，彩虹表可破
}
```

### 正确的做法：专业密码哈希

```java
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class PasswordConfig {
    
    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt：自适应哈希，自带盐
        // 工作因子可调整（默认 10），自动防止时序攻击
        return new BCryptPasswordEncoder(12);
    }
}

@Service
public class UserService {
    
    @Autowired
    private PasswordEncoder passwordEncoder;
    
    /**
     * 注册用户：密码哈希
     */
    public void register(String username, String password) {
        // 密码哈希：自动加盐，防止时序攻击
        String hashedPassword = passwordEncoder.encode(password);
        
        // 存储哈希值，不是明文
        User user = new User();
        user.setUsername(username);
        user.setPasswordHash(hashedPassword);
        userRepository.save(user);
    }
    
    /**
     * 登录验证
     */
    public boolean login(String username, String password) {
        User user = userRepository.findByUsername(username);
        if (user == null) {
            return false;
        }
        
        // 验证密码：BCrypt 会自动处理盐
        return passwordEncoder.matches(password, user.getPasswordHash());
    }
}
```

## BCrypt 的工作原理

BCrypt 是专为密码哈希设计的算法：

```
BCrypt(password, cost_factor=12):
    1. 生成随机盐（salt）
    2. 使用 Blowfish 加密算法
    3. 进行 2^cost_factor 次迭代
    4. 返回：$2a$12$随机盐哈希值

示例输出：
$2a$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5GyY4UG7sKaWS

解读：
$2a$      → 算法版本
12$       → 工作因子（2^12 = 4096 次迭代）
LQv3c...  → 22 字符的盐
Y5GyY4... → 31 字符的哈希值
```

**为什么 BCrypt 是安全的？**

- **自适应**：工作因子可调整，随着硬件变快而增大
- **自带盐**：不需要单独存储盐，每个哈希都有不同的盐
- **专为密码设计**：计算成本高，GPU 也难以加速

## 密码强度策略

### 1. 强制复杂度

```java
public class PasswordStrengthValidator {
    
    /**
     * 验证密码强度
     */
    public ValidationResult validate(String password) {
        List<String> errors = new ArrayList<>();
        
        // 最小长度
        if (password.length() < 8) {
            errors.add("密码长度至少 8 位");
        }
        
        // 最大长度（防止 DoS 攻击）
        if (password.length() > 128) {
            errors.add("密码长度不能超过 128 位");
        }
        
        // 必须包含大写字母
        if (!password.matches(".*[A-Z].*")) {
            errors.add("必须包含大写字母");
        }
        
        // 必须包含小写字母
        if (!password.matches(".*[a-z].*")) {
            errors.add("必须包含小写字母");
        }
        
        // 必须包含数字
        if (!password.matches(".*\\d.*")) {
            errors.add("必须包含数字");
        }
        
        // 必须包含特殊字符
        if (!password.matches(".*[!@#$%^&*(),.?\":{}|<>].*")) {
            errors.add("必须包含特殊字符");
        }
        
        // 检查常见密码
        if (isCommonPassword(password)) {
            errors.add("密码太常见，请使用更复杂的密码");
        }
        
        // 检查键盘序列
        if (hasKeyboardPattern(password)) {
            errors.add("不允许键盘序列模式");
        }
        
        return new ValidationResult(errors.isEmpty(), errors);
    }
    
    private boolean isCommonPassword(String password) {
        Set<String> common = Set.of(
            "password", "123456", "12345678", "qwerty",
            "abc123", "monkey", "1234567", "letmein"
        );
        return common.contains(password.toLowerCase());
    }
    
    private boolean hasKeyboardPattern(String password) {
        String[] patterns = {"qwerty", "asdfgh", "zxcvbn", "123456", "098765"};
        String lower = password.toLowerCase();
        for (String pattern : patterns) {
            if (lower.contains(pattern)) {
                return true;
            }
        }
        return false;
    }
}
```

### 2. 密码生成器

```java
public class SecurePasswordGenerator {
    
    private static final String LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
    private static final String UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    private static final String DIGITS = "0123456789";
    private static final String SPECIAL = "!@#$%^&*()_+-=[]{}|;:,.<>?";
    
    /**
     * 生成安全随机密码
     */
    public static String generate(int length, boolean includeSpecial) {
        String chars = LOWERCASE + UPPERCASE + DIGITS;
        if (includeSpecial) {
            chars += SPECIAL;
        }
        
        SecureRandom random = new SecureRandom();
        StringBuilder password = new StringBuilder();
        
        // 确保包含每种字符
        password.append(randomChar(LOWERCASE, random));
        password.append(randomChar(UPPERCASE, random));
        password.append(randomChar(DIGITS, random));
        if (includeSpecial) {
            password.append(randomChar(SPECIAL, random));
        }
        
        // 填充剩余长度
        while (password.length() < length) {
            password.append(randomChar(chars, random));
        }
        
        // 打乱顺序
        return shuffle(password.toString(), random);
    }
    
    private static char randomChar(String chars, SecureRandom random) {
        return chars.charAt(random.nextInt(chars.length()));
    }
    
    private static String shuffle(String input, SecureRandom random) {
        char[] chars = input.toCharArray();
        for (int i = chars.length - 1; i > 0; i--) {
            int j = random.nextInt(i + 1);
            char temp = chars[i];
            chars[i] = chars[j];
            chars[j] = temp;
        }
        return new String(chars);
    }
}
```

## 多因素认证（MFA）

单因素密码不足以保护重要账户，**MFA（多因素认证）** 是关键：

### 因素类型

```
┌─────────────────────────────────────────────────────────────┐
│  三种认证因素                                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  你知道的（知识）          你拥有的（持有）       你是什么（生物）  │
│  ↓                        ↓                      ↓        │
│  密码                      手机                   指纹        │
│  PIN                      硬件令牌               面部识别     │
│  安全问题                  智能卡                 虹膜         │
│                           短信验证码             声纹         │
│                                                             │
│  ⚠️ 不同类型的因素组合才叫 MFA！                           │
│  两个密码 ≠ MFA，是单因素！                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### TOTP 实现

```java
public class TOTPService {
    
    private static final int TIME_STEP = 30;  // 30 秒有效期
    private static final int CODE_DIGITS = 6;
    
    /**
     * 生成 TOTP
     * TOTP = HMAC-SHA1(密钥, floor(当前时间 / 30))
     */
    public String generateTOTP(String secret) {
        long counter = System.currentTimeMillis() / 1000 / TIME_STEP;
        byte[] counterBytes = ByteBuffer.allocate(8).putLong(counter).array();
        
        // HMAC-SHA1
        Mac mac = Mac.getInstance("HmacSHA1");
        SecretKeySpec keySpec = new SecretKeySpec(
            BaseEncoding.base32().decode(secret), "RAW"
        );
        mac.init(keySpec);
        byte[] hash = mac.doFinal(counterBytes);
        
        // 动态截断
        int offset = hash[hash.length - 1] & 0x0F;
        int binary = ((hash[offset] & 0x7F) << 24)
                   | ((hash[offset + 1] & 0xFF) << 16)
                   | ((hash[offset + 2] & 0xFF) << 8)
                   | (hash[offset + 3] & 0xFF);
        
        // 取后 6 位
        int totp = binary % (int) Math.pow(10, CODE_DIGITS);
        return String.format("%0" + CODE_DIGITS + "d", totp);
    }
    
    /**
     * 验证 TOTP
     * 允许前后 1 个时间窗口（±30 秒）
     */
    public boolean verifyTOTP(String secret, String code) {
        String expected = generateTOTP(secret);
        return MessageDigest.isEqual(expected.getBytes(), code.getBytes());
    }
}
```

## 密码找回的安全

密码找回是最容易被攻击的环节：

### 安全的密码重置流程

```java
public class PasswordResetService {
    
    @Autowired
    private EmailService emailService;
    
    @Autowired
    private RedisTemplate<String, String> redisTemplate;
    
    private static final long RESET_TOKEN_EXPIRY = 15 * 60;  // 15 分钟
    
    /**
     * 发起密码重置
     */
    public void requestReset(String email) {
        User user = userRepository.findByEmail(email);
        if (user == null) {
            // 安全：不要告诉用户邮箱是否存在
            return;
        }
        
        // 生成一次性令牌
        String token = generateSecureToken();
        
        // 存储到 Redis，设置过期时间
        String key = "pwd_reset:" + token;
        redisTemplate.opsForValue().set(key, user.getId().toString(), 
                                        Duration.ofSeconds(RESET_TOKEN_EXPIRY));
        
        // 发送重置邮件
        String resetLink = "https://example.com/reset?token=" + token;
        emailService.send(user.getEmail(), "密码重置", 
                         "点击链接重置密码：" + resetLink + 
                         "（15 分钟内有效）");
    }
    
    /**
     * 执行密码重置
     */
    public boolean resetPassword(String token, String newPassword) {
        String key = "pwd_reset:" + token;
        String userId = redisTemplate.opsForValue().get(key);
        
        if (userId == null) {
            return false;  // 令牌无效或已过期
        }
        
        // 删除令牌（一次性使用）
        redisTemplate.delete(key);
        
        // 更新密码
        User user = userRepository.findById(Long.parseLong(userId));
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        userRepository.save(user);
        
        // 使所有现有会话失效
        sessionService.invalidateAllSessions(user.getId());
        
        return true;
    }
}
```

## 面试追问方向

1. **密码为什么要哈希存储而不是加密？** —— 哈希不可逆，加密可逆；哈希不需要密钥
2. **BCrypt 和 SHA-256 的区别？** —— BCrypt 有自适应工作因子、防 GPU 加速，内置盐
3. **彩虹表攻击怎么防御？** —— 加盐，使彩虹表失效；使用专业密码哈希算法
4. **为什么不要限制密码长度？** —— 限制太短限制安全性；限制太长可能 DoS 攻击
5. **MFA 的最佳实践？** —— 短信验证码不安全（SIM 劫持），推荐 TOTP 或硬件令牌

> "密码是用户账户的最后防线。理解密码安全的原理，才能设计出既安全又易用的认证系统。"
