# 国密算法：中国密码标准的前世今生

2019 年，《密码法》正式施行。

这部法律明确规定：**关键信息基础设施必须使用商用密码进行保护。**

如果你在开发金融、政务、电信等领域的系统，「国密」不再是一个可选项，而是必选项。

但国密到底是什么？SM2、SM3、SM4，和我们熟悉的 RSA、SHA、AES 有什么关系？为什么要「重复造轮子」？

让我们从历史说起。

## 为什么要国密

### 1. 自主知识产权

国际通用的密码算法（RSA、AES、SHA）都来自美国。表面上「开放」「通用」，实际上存在几个问题：

- **后门风险**：算法设计者可能在其中留下后门
- **出口限制**：美国对加密技术出口有严格限制，高强度加密对外受限
- **依赖风险**：万一国际形势变化，算法被禁用怎么办

中国必须有自己的密码标准，才能真正掌握信息安全的主导权。

### 2. 合规要求

《密码法》、《网络安全法》、《数据安全法》对关键信息基础设施有明确的密码使用要求：

- 政务系统
- 金融系统
- 公共通信
- 能源、交通等基础设施

不满足国密要求，不仅是不合规，更是不安全。

## SM 系列算法

中国国家密码管理局发布了一系列商用密码算法，统称 **SM 系列**：

| 算法 | 类型 | 对应国际算法 | 用途 |
|------|------|-------------|------|
| SM1 | 对称加密 | AES | 数据加密（芯片实现，不公开） |
| SM2 | 公钥密码 | RSA/ECDSA | 数字签名、密钥交换 |
| SM3 | 哈希 | SHA-256 | 消息认证、完整性验证 |
| SM4 | 对称加密 | AES | 数据加密（公开算法） |
| SM9 | 身份密码 | IBC | 基于身份的密码系统 |

## SM2：国密公钥密码

SM2 是基于椭圆曲线的公钥密码算法，对应国际上的 ECDSA/ECDH。

### SM2 的数学基础

SM2 使用的是 **256 位的椭圆曲线**，曲线方程和参数由国家密码管理局指定：

```
曲线方程：y² = x³ + ax + b
曲线参数：由国家密码管理局发布
密钥长度：256 位
签名长度：64 字节
```

### SM2 的 Java 实现

```java
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.jce.spec.ECParameterSpec;
import org.bouncycastle.util.encoders.Hex;

import java.security.*;
import java.security.spec.PKCS8EncodedKeySpec;

public class SM2Demo {
    
    static {
        // 使用 BouncyCastle 实现国密算法
        Security.addProvider(new BouncyCastleProvider());
    }
    
    public static void main(String[] args) throws Exception {
        // 1. 生成 SM2 密钥对
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("SM2", "BC");
        keyGen.initialize(new ECParameterSpec(
            SM2Util.getDomainParameters() // SM2 曲线参数
        ));
        KeyPair keyPair = keyGen.generateKeyPair();
        
        // 2. SM2 签名
        String message = "这是一份电子合同，金额为 100 万元。";
        byte[] messageBytes = message.getBytes("UTF-8");
        
        Signature signature = Signature.getInstance("SM3withSM2", "BC");
        signature.initSign(keyPair.getPrivate());
        signature.update(messageBytes);
        byte[] signBytes = signature.sign();
        
        System.out.println("SM2 签名：" + Hex.toHexString(signBytes));
        System.out.println("签名长度：" + signBytes.length + " 字节");
        
        // 3. SM2 验签
        signature.initVerify(keyPair.getPublic());
        signature.update(messageBytes);
        boolean verified = signature.verify(signBytes);
        System.out.println("验签结果：" + (verified ? "通过 ✓" : "失败 ✗"));
        
        // 4. SM2 加密（密钥交换）
        // SM2 加密使用 ECIES 类似的机制
        Cipher cipher = Cipher.getInstance("SM2", "BC");
        cipher.init(Cipher.ENCRYPT_MODE, keyPair.getPublic());
        byte[] encrypted = cipher.doFinal(messageBytes);
        System.out.println("SM2 密文长度：" + encrypted.length + " 字节");
    }
}
```

### SM2 vs RSA：为什么 SM2 更优

| 对比项 | RSA-2048 | SM2-256 |
|-------|---------|---------|
| 密钥长度 | 2048 位 | 256 位 |
| 签名长度 | 256 字节 | 64 字节 |
| 签名速度 | 慢 | 快 10 倍 |
| 验签速度 | 慢 | 快 100 倍 |
| 安全级别 | 112 位安全 | 128 位安全 |

SM2 用更短的密钥提供了更高的安全级别和更好的性能。

## SM3：国密哈希

SM3 是中国国家密码管理局发布的哈希算法，对应 SHA-256。

### SM3 的特点

- 输出长度：256 位（32 字节）
- 安全性：与 SHA-256 相当
- 结构：基于 Merkle-Damgård 结构，使用 Davies-Meyer 压缩函数

```java
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.util.encoders.Hex;

import java.security.MessageDigest;

public class SM3Demo {
    
    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        
        String input = "Hello, 国密!";
        byte[] inputBytes = input.getBytes("UTF-8");
        
        // SM3 哈希
        MessageDigest sm3 = MessageDigest.getInstance("SM3", "BC");
        byte[] hash = sm3.digest(inputBytes);
        
        System.out.println("SM3 哈希：" + Hex.toHexString(hash));
        System.out.println("哈希长度：" + hash.length + " 字节");
        
        // 与 SHA-256 对比
        MessageDigest sha256 = MessageDigest.getInstance("SHA-256");
        byte[] sha256Hash = sha256.digest(inputBytes);
        System.out.println("SHA-256 哈希：" + Hex.toHexString(sha256Hash));
    }
}
```

## SM4：国密对称加密

SM4 是分组对称加密算法，对应 AES。最初叫 SMS4，2012 年正式发布时改为 SM4。

### SM4 的特点

- 分组长度：128 位
- 密钥长度：128 位
- 工作模式：ECB、CBC、CFB、OFB、CTR、GCM 等
- 性能：与 AES 相当

```java
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import javax.crypto.*;
import javax.crypto.spec.*;

public class SM4Demo {
    
    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        
        String plaintext = "敏感数据：银行卡号 1234567890123456";
        byte[] key = new byte[16]; // SM4 密钥
        byte[] iv = new byte[16];  // IV
        
        // 生成随机密钥和 IV
        new SecureRandom().nextBytes(key);
        new SecureRandom().nextBytes(iv);
        
        // SM4 CBC 加密
        Cipher cipher = Cipher.getInstance("SM4/CBC/PKCS5Padding", "BC");
        SecretKeySpec keySpec = new SecretKeySpec(key, "SM4");
        IvParameterSpec ivSpec = new IvParameterSpec(iv);
        
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, ivSpec);
        byte[] encrypted = cipher.doFinal(plaintext.getBytes("UTF-8"));
        
        // SM4 CBC 解密
        cipher.init(Cipher.DECRYPT_MODE, keySpec, ivSpec);
        byte[] decrypted = cipher.doFinal(encrypted);
        
        System.out.println("加密后长度：" + encrypted.length + " 字节");
        System.out.println("解密结果：" + new String(decrypted, "UTF-8"));
    }
}
```

## GMSSL：国密工具库

GMSSL 是开源的国密算法库，提供 C 语言实现：

```bash
# 安装 GMSSL
git clone https://github.com/guanzhi/GMSSL.git
cd GMSSL && ./config && make && make install

# 命令行使用
gmssl sm4 -enc -in file.txt -out file.enc -k key -iv iv
gmssl sm3 -in file.txt
gmssl sm2 -sign -in file.txt -out signature -keyform pem -key private.pem
```

Java 中推荐使用 BouncyCastle（已支持 SM2/SM3/SM4）。

## 国密合规：实际应用场景

### 1. HTTPS 国密改造

传统 HTTPS 使用 RSA/ECDSA 证书，国密 HTTPS 使用 SM2 证书：

```
浏览器 <---> 服务器（国密TLS）
          |
          +-- SM2 证书链
          +-- SM2 签名
          +-- SM4 加密
```

主流浏览器（360 浏览器、奇安信浏览器）和服务器（Nginx、Tengine）都已支持国密 TLS。

### 2. 电子签章

电子合同需要数字签名，国密场景下必须使用 SM2 签名 + SM3 哈希：

```java
// 合规的国密签名流程
public byte[] gmsign(String data, PrivateKey privateKey) throws Exception {
    // 1. 计算 SM3 哈希
    MessageDigest sm3 = MessageDigest.getInstance("SM3", "BC");
    byte[] hash = sm3.digest(data.getBytes("UTF-8"));
    
    // 2. SM2 签名
    Signature signature = Signature.getInstance("SM3withSM2", "BC");
    signature.initSign(privateKey);
    signature.update(data.getBytes("UTF-8"));
    return signature.sign();
}
```

### 3. 金融 IC 卡

金融 IC 卡使用 SM4 进行卡与终端的加密通信，使用 SM2 进行身份认证。

## 国密的面试追问方向

1. **国密和國際算法的区别？** —— 算法设计机构不同，但原理类似（SM2≈ECDSA, SM3≈SHA-256, SM4≈AES）
2. **为什么要有国密？** —— 自主知识产权、合规要求、避免依赖
3. **SM2 和 RSA 的性能对比？** —— SM2 更短、更快、更安全
4. **哪些场景必须使用国密？** —— 政务、金融、关键基础设施等
5. **国密 HTTPS 怎么实现？** —— 需要国密浏览器、国密证书、国密 TLS 握手

> "国密不是重复造轮子，而是掌握钥匙的权利。在信息安全领域，谁掌握密码标准，谁就掌握主动权。"
