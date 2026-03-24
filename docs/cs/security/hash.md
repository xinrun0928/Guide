# 哈希：不可逆的数学魔术

你登录网站时，输入密码后点提交，服务器怎么验证？

如果服务器存了你的明文密码，数据库被黑的那一刻，所有用户密码都泄露了。

正确的做法是：**服务器只存密码的哈希值。** 你输入密码，服务器计算哈希，与存储的哈希比对。

但这里有个问题：MD5、SHA-1、SHA-256，它们到底有什么区别？为什么密码哈希不用普通的加密算法？

要回答这些问题，我们需要理解哈希的本质。

## 哈希是什么

哈希（Hash），也叫散列函数，是一个把任意长度的数据转换成**固定长度摘要**的函数。

```java
import java.security.MessageDigest;

public class HashDemo {
    public static void main(String[] args) throws Exception {
        String input = "Hello, 哈希!";
        
        // 不同哈希算法的输出
        System.out.println("MD5:    " + hash("MD5", input));
        System.out.println("SHA-1:  " + hash("SHA-1", input));
        System.out.println("SHA-256:" + hash("SHA-256", input));
        System.out.println("SHA-512:" + hash("SHA-512", input));
        
        // 输出长度对比
        System.out.println("\n哈希长度对比:");
        System.out.println("MD5:    " + hash("MD5", input).length() + " 字符 (128位)");
        System.out.println("SHA-1:  " + hash("SHA-1", input).length() + " 字符 (160位)");
        System.out.println("SHA-256:" + hash("SHA-256", input).length() + " 字符 (256位)");
        System.out.println("SHA-512:" + hash("SHA-512", input).length() + " 字符 (512位)");
    }
    
    private static String hash(String algorithm, String input) throws Exception {
        MessageDigest digest = MessageDigest.getInstance(algorithm);
        byte[] hashBytes = digest.digest(input.getBytes("UTF-8"));
        return bytesToHex(hashBytes);
    }
    
    private static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder();
        for (byte b : bytes) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    }
}
```

运行结果类似：

```
MD5:    a4c1e3fb2e3d4f5a6b7c8d9e0f1a2b3c
SHA-1:  a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4
SHA-256: 2f5a8b3c9d1e4f6a7b8c2d9e3f5a1b4c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a
SHA-512: 8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2
```

## 哈希的三大特性

好的哈希函数必须满足三个特性：

### 1. 单向性（One-way）

给定哈希值 h，找到原始输入 m 使得 `hash(m) = h` 在计算上不可行。

也就是说，**哈希是单向的，只能正向计算，不能反向推导**。这和加密不同——加密是为了解密，而哈希不是为了还原。

### 2. 抗碰撞性（Collision Resistance）

找到两个不同的输入 m1 和 m2，使得 `hash(m1) = hash(m2)` 在计算上不可行。

碰撞是必然存在的（因为输入无限，输出有限），但关键是**找到碰撞在计算上不可行**。

### 3. 抗原像性（Preimage Resistance）

给定哈希值 h，找到原始输入 m 在计算上不可行。

注意：抗原像和抗碰撞不同。抗原像是说「给定哈希值，不能反推原始输入」；抗碰撞是说「不能找到两个有相同哈希值的不同输入」。

## 常见哈希算法对比

| 算法 | 输出长度 | 状态 | 适用场景 |
|------|---------|------|----------|
| MD5 | 128 位 | ❌ 不安全 | 已被攻破，不推荐任何场景 |
| SHA-1 | 160 位 | ❌ 不安全 | 已被攻破，仅用于兼容性 |
| SHA-256 | 256 位 | ✅ 安全 | 密码存储、数字签名 |
| SHA-512 | 512 位 | ✅ 安全 | 高安全场景 |
| SHA-3 | 256/512 位 | ✅ 安全 | 替代 SHA-2 的选择 |
| SM3 | 256 位 | ✅ 安全 | 国密合规 |

MD5 和 SHA-1 的碰撞已被实际攻破。2017 年，Google 宣布攻破 SHA-1，展示了两个 PDF 文件有相同 SHA-1 哈希值。

## 哈希在密码存储中的应用

直接用 SHA-256 存密码够吗？不够。

攻击者有「彩虹表」——预先计算好的哈希-密码对照表。如果你的密码很常见，直接查表就能破解。

**加盐（Salt）** 是解决方案：每个用户使用唯一的随机盐值。

```java
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

public class PasswordHashing {
    
    private static final int SALT_LENGTH = 16;
    private static final int HASH_ITERATIONS = 100000; // PBKDF2 迭代次数
    
    /**
     * 安全的密码哈希：使用盐 + 多次哈希
     */
    public static String hashPassword(String password) {
        try {
            // 1. 生成随机盐
            SecureRandom random = new SecureRandom();
            byte[] salt = new byte[SALT_LENGTH];
            random.nextBytes(salt);
            String saltString = Base64.getEncoder().encodeToString(salt);
            
            // 2. 使用 PBKDF2 进行密钥派生
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, 
                                              HASH_ITERATIONS, 256);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] hash = factory.generateSecret(spec).getEncoded();
            String hashString = Base64.getEncoder().encodeToString(hash);
            
            // 3. 存储格式：迭代次数$盐$哈希
            return HASH_ITERATIONS + "$" + saltString + "$" + hashString;
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
    
    /**
     * 验证密码
     */
    public static boolean verifyPassword(String password, String storedHash) {
        try {
            // 1. 解析存储的哈希
            String[] parts = storedHash.split("\\$");
            int iterations = Integer.parseInt(parts[0]);
            byte[] salt = Base64.getDecoder().decode(parts[1]);
            byte[] hash = Base64.getDecoder().decode(parts[2]);
            
            // 2. 用相同参数计算哈希
            PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt,
                                              iterations, 256);
            SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
            byte[] testHash = factory.generateSecret(spec).getEncoded();
            
            // 3. 比较哈希值（使用 constant-time 比较防止时序攻击）
            return MessageDigest.isEqual(hash, testHash);
        } catch (Exception e) {
            return false;
        }
    }
}
```

**为什么用 PBKDF2 而不是简单哈希？**

简单哈希的问题是快——现代 GPU 每秒能计算数十亿次 SHA-256。PBKDF2 通过迭代计算，让每次哈希都需要大量计算，有效对抗暴力破解。

其他密码哈希方案还有 bcrypt、scrypt、Argon2（Argon2 是 Password Hashing Competition 的赢家）。

## 哈希的面试追问方向

1. **MD5 为什么被淘汰？** —— 已被攻破，可找到碰撞，实际场景如数字签名被伪造
2. **SHA-1 和 SHA-256 的区别？** —— 输出长度、安全强度、性能差异
3. **为什么密码存储要用盐？** —— 防止彩虹表攻击、确保相同密码有不同哈希
4. **哈希和加密的区别？** —— 哈希不可逆，加密可逆；哈希用于完整性验证，加密用于机密性
5. **什么是时序攻击？** —— 通过测量比较时间差异推断密码，需要 constant-time 比较

> "哈希是密码学的瑞士军刀——看似简单，用途广泛。理解它的特性和局限，是掌握安全编程的第一步。"
