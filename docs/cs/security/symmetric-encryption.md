# 对称加密：古老的密码箱与现代密码学

凌晨 3 点，你刚把用户密码用 MD5 哈希后存进数据库——等等，你确定这样够安全吗？

2013 年，LinkedIn 的 1.17 亿条密码被泄露。攻击者拿到的不只是一串哈希值，而是一份完整的「密码对照表」。因为 LinkedIn 只用了 SHA-1 没有加盐，攻击者只需要用常见密码的哈希值比对，就能破解出大量原始密码。

这就是对称加密和非专业加密的差别。

## 什么是对称加密

对称加密，可能是人类使用最久的加密方式。

古罗马的凯撒大帝，用字母偏移来传递军情——字母 A 变成 D，B 变成 E。这种「凯撒密码」，就是一种原始的对称加密：**加密和解密使用同一个密钥。**

现代对称加密的原理类似，只是复杂了无数倍。发送方用密钥把明文变成密文，接收方用同一个密钥把密文还原成明文。两端共享同一个秘密，这就是「对称」的含义。

```java
// Java 对称加密示例：AES
public class SymmetricEncryption {
    public static void main(String[] args) throws Exception {
        String plaintext = "Hello, 密码学!";
        byte[] key = "这是32位密钥!".getBytes("UTF-8"); // AES-256 需要 32 字节
        
        // 加密
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
        IvParameterSpec iv = new IvParameterSpec(new byte[16]); // 初始化向量
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, iv);
        byte[] encrypted = cipher.doFinal(plaintext.getBytes("UTF-8"));
        
        // 解密
        cipher.init(Cipher.DECRYPT_MODE, keySpec, iv);
        byte[] decrypted = cipher.doFinal(encrypted);
        System.out.println(new String(decrypted, "UTF-8")); // 输出: Hello, 密码学!
    }
}
```

## 主流对称加密算法

### DES：被淘汰的先驱

DES（Data Encryption Standard）诞生于 1977 年，曾经是加密界的黄金标准。但它的致命弱点是**密钥长度只有 56 位**——在现代计算能力面前，暴力破解只需要几小时。

1999 年，DES 被正式淘汰。现在你如果在代码里看到 DES，请立刻替换。

### 3DES：过渡方案

3DES 是 DES 的「三明治」版本，用三次 DES 加密来增加安全性。但它本质上是三个 DES 的叠加，安全但效率低——比 AES 慢约 3 倍。

现在 3DES 也已淘汰，迁移到 AES 是唯一选择。

### AES：现在和未来的标准

AES（Advanced Encryption Standard）于 2001 年成为美国联邦标准，目前是最广泛使用的对称加密算法。

AES 有三种密钥长度：

| 密钥长度 | 安全性 | 适用场景 |
|---------|--------|----------|
| AES-128 | 128 位 | 日常数据传输、文件加密 |
| AES-192 | 192 位 | 较敏感数据 |
| AES-256 | 256 位 | 高度敏感数据、国密合规 |

AES 的工作模式也很重要：

- **ECB（电子密码本）**：最简单但不安全，相同明文块产生相同密文块，泄露了数据模式
- **CBC（密码块链接）**：每个块加密前与前一个密文块异或，需要初始化向量 IV
- **CTR（计数器）**：支持并行加密，速度快，适合流式数据
- **GCM（伽罗瓦计数器模式）**：AEAD 模式，同时提供加密和认证

**实际应用中，永远不要使用 ECB 模式。** CBC + 随机 IV 是最常见的选择，GCM 如果可用则更好。

## 对称加密的优缺点

对称加密的最大优势是**快**。在相同安全级别下，对称加密比非对称加密快 100-1000 倍。这使得它非常适合加密大量数据。

但对称加密有一个根本问题：**密钥分发**。

想象一下：你和网友聊天，你如何把密钥安全地传给对方？你们还没有建立安全通道，传递密钥本身就成了一场冒险。

这就是非对称加密诞生的原因——解决密钥分发的难题。

## 实际应用中的最佳实践

### 1. 永远使用强密钥

```java
// 生成安全的随机密钥
SecureRandom secureRandom = new SecureRandom();
byte[] key = new byte[32]; // AES-256
secureRandom.nextBytes(key);
```

### 2. 每次加密使用新的随机 IV

```java
// 生成随机 IV
byte[] iv = new byte[16];
secureRandom.nextBytes(iv);
IvParameterSpec ivSpec = new IvParameterSpec(iv);
// IV 不需要保密，但每次必须不同
```

### 3. 验证加密结果

```java
// 使用后务必验证
if (!plaintext.equals(decrypted)) {
    throw new SecurityException("Decryption failed");
}
```

### 4. 完整的数据加密流程

```java
public byte[] encrypt(byte[] data, byte[] key) throws Exception {
    // 1. 生成随机 IV
    byte[] iv = new byte[16];
    new SecureRandom().nextBytes(iv);
    
    // 2. 创建 Cipher
    Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
    SecretKeySpec keySpec = new SecretKeySpec(key, "AES");
    cipher.init(Cipher.ENCRYPT_MODE, keySpec, new IvParameterSpec(iv));
    
    // 3. 加密数据
    byte[] encrypted = cipher.doFinal(data);
    
    // 4. 拼接 IV + 密文（IV 需要传递给解密方）
    byte[] result = new byte[iv.length + encrypted.length];
    System.arraycopy(iv, 0, result, 0, iv.length);
    System.arraycopy(encrypted, 0, result, iv.length, encrypted.length);
    
    return result;
}
```

## 面试追问方向

对称加密虽然基础，但面试官喜欢在这里挖深坑：

1. **为什么 AES 比 DES 更安全？** —— 从密钥长度、工作原理（替代-置换网络 vs Feistel 结构）角度回答
2. **ECB 为什么不安全？** —— 相同明文产生相同密文，泄露了数据模式
3. **CBC 模式的 IV 有什么要求？** —— 必须随机、不可预测、每次不同，但不需保密
4. **如果需要加密的数据超过一个块怎么办？** —— 引入工作模式（ CBC/CTR/GCM），ECB 无法处理多块
5. **GCM 和 CBC 的区别？** —— GCM 是 AEAD 模式，同时提供加密和认证

> "对称加密是现代密码学的基石，理解它的工作原理和安全边界，是每个工程师的必修课。"
