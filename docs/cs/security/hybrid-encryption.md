# 混合加密：鱼和熊掌兼得的艺术

你刚用 RSA 公钥加密了一段重要信息，发给对方。

然后你盯着屏幕上那一串字节，开始怀疑人生——**这加密速度，是不是有点太慢了？**

测试一下：加密 1MB 数据，RSA 用了整整 8 秒。而同等安全级别的 AES，只需要 0.01 秒。

800 倍的差距。这就是非对称加密的真实代价。

但如果我告诉你，有一种方法能让你既享受 RSA 的「安全传递密钥」能力，又拥有 AES 的「光速加密」性能——你信吗？

这就是**混合加密**。

## 混合加密的核心理念

非对称加密和对称加密各有优劣：

| | 对称加密 | 非对称加密 |
|--|---------|-----------|
| 速度 | 快 100-1000 倍 | 慢 |
| 密钥分发 | 困难（Chicken-Egg 问题） | 简单（公钥公开） |
| 适用场景 | 大量数据加密 | 密钥交换、签名 |

混合加密的思路很简单：**用非对称加密解决对称密钥的安全分发问题，用对称加密解决大量数据的加密效率问题。**

```
发送方：
1. 生成一个随机对称密钥（会话密钥）
2. 用对方的公钥加密这个对称密钥
3. 用对称密钥加密实际数据
4. 发送：加密后的对称密钥 + 加密后的数据

接收方：
1. 用自己的私钥解密出对称密钥
2. 用对称密钥解密数据
```

这样，整个过程只需要一次非对称加密（加密一个短密钥），之后的数据传输全部用对称加密。

## Java 混合加密实现

```java
import javax.crypto.*;
import java.security.*;
import java.util.Base64;

public class HybridEncryption {
    
    // 非对称加密算法
    private static final String RSA_ALGORITHM = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    // 对称加密算法
    private static final String AES_ALGORITHM = "AES/CBC/PKCS5Padding";
    
    /**
     * 混合加密：使用接收方的公钥加密对称密钥，再用对称密钥加密数据
     */
    public static byte[] hybridEncrypt(byte[] data, PublicKey publicKey) throws Exception {
        // 1. 生成随机对称密钥（会话密钥）
        KeyGenerator keyGen = KeyGenerator.getInstance("AES");
        keyGen.init(256);
        SecretKey sessionKey = keyGen.generateKey();
        
        // 2. 用 RSA 公钥加密对称密钥
        Cipher rsaCipher = Cipher.getInstance(RSA_ALGORITHM);
        rsaCipher.init(Cipher.ENCRYPT_MODE, publicKey);
        byte[] encryptedKey = rsaCipher.doFinal(sessionKey.getEncoded());
        
        // 3. 生成随机 IV
        byte[] iv = new byte[16];
        new SecureRandom().nextBytes(iv);
        
        // 4. 用 AES 对称密钥加密数据
        Cipher aesCipher = Cipher.getInstance(AES_ALGORITHM);
        aesCipher.init(Cipher.ENCRYPT_MODE, sessionKey, new IvParameterSpec(iv));
        byte[] encryptedData = aesCipher.doFinal(data);
        
        // 5. 拼接：加密后的密钥长度(4字节) + 密钥 + IV + 密文
        byte[] result = new byte[4 + encryptedKey.length + iv.length + encryptedData.length];
        
        // 写入密钥长度（大端序）
        result[0] = (byte) (encryptedKey.length >>> 24);
        result[1] = (byte) (encryptedKey.length >>> 16);
        result[2] = (byte) (encryptedKey.length >>> 8);
        result[3] = (byte) encryptedKey.length;
        
        // 写入密钥、IV、密文
        int offset = 4;
        System.arraycopy(encryptedKey, 0, result, offset, encryptedKey.length);
        offset += encryptedKey.length;
        System.arraycopy(iv, 0, result, offset, iv.length);
        offset += iv.length;
        System.arraycopy(encryptedData, 0, result, offset, encryptedData.length);
        
        return result;
    }
    
    /**
     * 混合解密：先用私钥解密对称密钥，再用对称密钥解密数据
     */
    public static byte[] hybridDecrypt(byte[] encrypted, PrivateKey privateKey) throws Exception {
        // 1. 读取加密后的密钥长度
        int keyLength = ((encrypted[0] & 0xFF) << 24) |
                        ((encrypted[1] & 0xFF) << 16) |
                        ((encrypted[2] & 0xFF) << 8) |
                        (encrypted[3] & 0xFF);
        
        // 2. 提取加密后的密钥、IV、密文
        int offset = 4;
        byte[] encryptedKey = new byte[keyLength];
        System.arraycopy(encrypted, offset, encryptedKey, 0, keyLength);
        offset += keyLength;
        
        byte[] iv = new byte[16];
        System.arraycopy(encrypted, offset, iv, 0, 16);
        offset += 16;
        
        byte[] encryptedData = new byte[encrypted.length - offset];
        System.arraycopy(encrypted, offset, encryptedData, 0, encryptedData.length);
        
        // 3. 用 RSA 私钥解密对称密钥
        Cipher rsaCipher = Cipher.getInstance(RSA_ALGORITHM);
        rsaCipher.init(Cipher.DECRYPT_MODE, privateKey);
        byte[] keyBytes = rsaCipher.doFinal(encryptedKey);
        
        // 4. 还原对称密钥
        SecretKey sessionKey = new SecretKeySpec(keyBytes, "AES");
        
        // 5. 用 AES 解密数据
        Cipher aesCipher = Cipher.getInstance(AES_ALGORITHM);
        aesCipher.init(Cipher.DECRYPT_MODE, sessionKey, new IvParameterSpec(iv));
        return aesCipher.doFinal(encryptedData);
    }
}
```

## 混合加密的进化：从 SSL 到 TLS

混合加密的思想贯穿了整个现代密码学应用。

### SSL/TLS 的握手过程

当你访问 HTTPS 网站时，背后就是混合加密：

1. **Client Hello**：客户端发送支持的加密套件列表
2. **Server Hello**：服务器选择加密套件，发送证书
3. **密钥交换**：双方协商出「会话密钥」
4. **Finished**：握手完成，后续数据用会话密钥加密

其中密钥交换步骤，就用了混合加密的思想——用非对称加密传递会话密钥。

### 常见的密钥交换算法

| 算法 | 原理 | 特点 |
|------|------|------|
| RSA Key Exchange | 客户端用服务器公钥加密随机数，服务器解密 | 不支持前向保密（ PFS） |
| DHE（Diffie-Hellman Ephemeral） | 双方协商密钥，支持前向保密 | 每会话新密钥，握手稍慢 |
| ECDHE | DH 的椭圆曲线版本，更高效 | 现代浏览器首选 |

**前向保密（PFS）** 是个关键概念：如果服务器的私钥泄露，没有前向保密的系统，所有历史会话都能被解密；有前向保密的系统，只有当前会话可能被影响。

## 混合加密的实际应用场景

### 1. 端到端加密聊天

Signal 协议（被 WhatsApp、Telegram Secret Chat 使用）的核心就是混合加密：

- 用非对称加密传递「消息密钥」
- 用对称加密（包含 AES-256、ChaCha20）加密实际消息
- 每条消息使用不同的密钥（密钥派生）

### 2. HTTPS 的完整流程

```java
// HTTPS 握手简化的 Java 表示
public class TLSDemo {
    public void connect() throws Exception {
        SSLContext context = SSLContext.getInstance("TLSv1.3");
        context.init(null, null, new SecureRandom());
        
        SSLSocketFactory factory = context.getSocketFactory();
        SSLSocket socket = (SSLSocket) factory.createSocket("example.com", 443);
        
        // TLS 1.3 握手自动完成：
        // 1. 证书验证（用 CA 公钥验证证书链）
        // 2. 密钥交换（ECDHE）
        // 3. 对称密钥协商
        // 4. 后续数据用 AES-256-GCM 加密
        
        socket.startHandshake(); // 触发握手
        // 现在可以通过 socket 安全通信了
    }
}
```

## 混合加密的最佳实践

### 1. 选择现代加密套件

```java
// Java 中配置 TLS
System.setProperty("https.protocols", "TLSv1.3");
System.setProperty("tls.enabledSignatureAlgorithms", "SHA256withRSA, SHA384withRSA");
```

推荐使用 TLS 1.3，它简化了握手过程，只用 1-RTT（一次往返），且默认启用前向保密。

### 2. 避免使用不安全的算法

```java
// 禁止使用的算法（在 JCA 配置中）
// RSA Key Exchange（不支持前向保密）
// 3DES（已淘汰）
// RC4（存在偏差攻击）
```

### 3. 密钥管理原则

```java
// 永远不要硬编码密钥
// 错误示例：
// private static final String KEY = "1234567890abcdef";

// 正确做法：从安全存储获取
char[] password = System.console().readPassword("Enter passphrase: ");
SecretKey key = deriveKey(password);
```

## 面试追问方向

1. **TLS 1.2 和 TLS 1.3 的区别？** —— 1.3 只有 1-RTT 握手，支持 0-RTT（但有重放风险），废弃了不安全的算法
2. **什么是前向保密？为什么重要？** —— 长期密钥泄露不影响历史会话，需要使用临时密钥交换（如 ECDHE）
3. **混合加密和直接用 RSA 加密有什么区别？** —— 混合加密用 RSA 传递对称密钥，利用了对称加密的速度优势
4. **ECDHE 的原理？** —— 基于 Diffie-Hellman 密钥交换的椭圆曲线版本，双方通过公开信息协商出共享秘密
5. **0-RTT 的风险？** —— TLS 1.3 的 0-RTT 模式存在重放攻击风险，不适合关键业务

> "混合加密是密码学的经典智慧：用非对称加密解决信任问题，用对称加密解决效率问题。理解这个思想，你就能看懂 HTTPS、Signal、乃至整个现代安全通信的底层逻辑。"
