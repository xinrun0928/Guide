# 数字签名：数字世界的签字画押

你收到一份电子合同，对方说「这是我签的字」。

你怎么验证？

在纸上签合同，有笔迹鉴定专家。但在数字世界，复制粘贴就能完美复制签名，任何人都能「签署」任何文件。

数字签名，就是为了解决**「这确实是我本人发的」**这个问题。

## 签名是为了解决什么问题

现实世界的签名有两个作用：

1. **认证**：确认是本人签署的
2. **不可抵赖**：签署人不能否认自己签过

数字签名必须解决同样的问题。在密码学里，这意味着：

- **只有我能生成这个签名**（认证）
- **任何人都能验证这个签名**（公开验证）
- **我不能否认我签过**（不可抵赖）

非对称加密天然提供了这个能力——用私钥签名，用公钥验证。

## 数字签名的工作原理

```
签名过程：
1. 计算文件的哈希值
2. 用私钥加密哈希值 = 签名
3. 发送：原文 + 签名

验证过程：
1. 用公钥解密签名，得到哈希值 A
2. 计算原文的哈希值，得到哈希值 B
3. 比较 A 和 B：如果相同，签名有效
```

```java
import java.security.*;
import java.security.spec.*;
import java.util.Base64;

public class DigitalSignatureDemo {
    
    public static void main(String[] args) throws Exception {
        // 1. 生成密钥对
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048);
        KeyPair keyPair = keyGen.generateKeyPair();
        
        String message = "本协议金额为 100 万元，甲方不得反悔。";
        
        // 2. 签名
        byte[] signature = sign(message, keyPair.getPrivate());
        System.out.println("签名：" + Base64.getEncoder().encodeToString(signature));
        
        // 3. 验证（用公钥验证）
        boolean valid = verify(message, signature, keyPair.getPublic());
        System.out.println("签名验证结果：" + (valid ? "有效 ✓" : "无效 ✗"));
        
        // 4. 篡改后验证
        String tamperedMessage = "本协议金额为 900 万元，甲方不得反悔。";
        boolean tamperedValid = verify(tamperedMessage, signature, keyPair.getPublic());
        System.out.println("篡改后验证：" + (tamperedValid ? "有效" : "无效 ✗"));
    }
    
    /**
     * 数字签名：用私钥签名
     */
    public static byte[] sign(String message, PrivateKey privateKey) throws Exception {
        // 1. 计算消息哈希
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(message.getBytes("UTF-8"));
        
        // 2. 用私钥加密哈希（签名）
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(privateKey);
        signature.update(message.getBytes("UTF-8"));
        return signature.sign();
    }
    
    /**
     * 验证签名：用公钥验证
     */
    public static boolean verify(String message, byte[] signature, PublicKey publicKey) 
            throws Exception {
        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initVerify(publicKey);
        sig.update(message.getBytes("UTF-8"));
        return sig.verify(signature);
    }
}
```

**关键点：签名的是哈希值，不是原文。**

如果直接用私钥加密原文，大文件会非常慢。用哈希代替，既保证完整性（哈希抗碰撞），又保证效率。

## 数字签名的实际应用

### 1. 代码签名

你从官网下载了一个软件，Windows 弹出「发布者未知」警告——这就是数字签名在起作用。

软件发布者用自己的私钥给软件签名，Windows 用发布者的公钥验证签名。如果签名有效且证书可信，Windows 就信任这个软件。

```
软件签名 = 代码哈希 + 发布者私钥签名
验证 = 发布者公钥验签 + 比对代码哈希
```

### 2. 文档签名

PDF、Word 文档都支持数字签名。签署后的文档：
- 任何修改都会导致签名失效
- 签名者的身份可以被验证
- 签署时间由可信时间戳保证

### 3. 代码提交签名（Git）

Git 支持 GPG 签名提交：

```bash
# 签署提交
git commit -S -m "feat: add new feature"

# 查看签名状态
git log --show-signature
```

签名验证确保提交确实来自声称的作者。

## 签名算法的选择

| 算法 | 原理 | 特点 |
|------|------|------|
| RSA with SHA-256 | RSA 加密哈希值 | 兼容性最好，签名较长 |
| ECDSA (P-256/P-384) | 椭圆曲线签名 | 更短、更快，是 RSA 的现代替代 |
| EdDSA | Edwards 曲线签名 | 更快速、更安全，如 Curve25519 |
| SM2withSM3 | 国密签名算法 | 中国合规标准 |

## 签名 vs 加密：最容易混淆的概念

很多人搞混签名和加密，它们是完全不同的概念：

| | 数字签名 | 加密 |
|--|---------|------|
| 目的 | 认证 + 完整性 | 机密性 |
| 使用密钥 | 私钥签名 | 公钥加密 |
| 验证密钥 | 公钥验证 | 私钥解密 |
| 可逆性 | 不可逆 | 可逆 |
| 谁关心 | 接收方想确认来源 | 只有接收方能看 |

**可以同时签名和加密：**

```
发送方：
1. 对原文签名（用自己的私钥）
2. 用接收方的公钥加密（原文 + 签名）

接收方：
1. 用自己的私钥解密
2. 用发送方的公钥验证签名
```

## 数字签名的局限

数字签名不是万能的，它有两个关键局限：

### 1. 公钥验证问题

你用公钥验证了签名，但**你怎么确定公钥是真的？**

这就是证书的意义——由可信的 CA 机构证明「这个公钥属于这个人」。

### 2. 时间戳问题

签名是瞬间的，但文档可能被人「重放」。

比如你签了一份合同，攻击者截获了签名，几年后再放出去。需要**可信时间戳**（TSA）来证明签名的时间。

## 面试追问方向

1. **数字签名和手写签名的区别？** —— 数字签名是数学计算，不可伪造；手写签名依赖物理特征，可被模仿
2. **为什么签名用哈希而不是原文？** —— 效率和一致性（原文太大，哈希固定长度）
3. **ECDSA 和 RSA 签名的区别？** —— 密钥长度、签名长度、计算速度、兼容性
4. **签名能保证机密性吗？** —— 不能，签名是公开验证的；需要加密才能保证机密性
5. **什么是签名重放攻击？** —— 截获有效签名后再次使用，需要时间戳或一次性随机数防止

> "数字签名让「签字画押」在数字世界成为可能。理解它的原理和应用，是理解 HTTPS、区块链、数字证书的基石。"
