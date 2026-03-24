# 密钥交换：如何在窃听者面前传递秘密

两个人要通话，但电话被窃听了。

更糟糕的是，你们通话前从未联系过——你甚至不知道对方的真实身份。

这是密码学的核心困境：**在完全没有安全通道的情况下，如何建立安全通信？**

这个问题折磨了密码学家几十年，直到 Whitfield Diffie 和 Martin Hellman 在 1976 年找到了答案。

## 一个经典的思想实验

假设你和朋友在公共场所聊天，旁边站着一个窃听者。你们想约定一个只有你们知道的秘密，用来实现后续的安全通信。

但所有对话窃听者都能听到——你们该怎么办？

**Diffie-Hellman 密钥交换** 的天才方案：

```
公开约定：
- 一个大质数 p = 23（公开）
- 一个原根 g = 5（公开，也叫生成元）

各自选择秘密数字：
- 你选择 a = 4（只有你知道）
- 朋友选择 b = 3（只有朋友知道）

计算公开值：
- 你发送 A = g^a mod p = 5^4 mod 23 = 4
- 朋友发送 B = g^b mod p = 5^3 mod 23 = 10

计算共享密钥：
- 你计算：K = B^a mod p = 10^4 mod 23 = 18
- 朋友计算：K = A^b mod p = 4^3 mod 23 = 18

窃听者只能看到：p=23, g=5, A=4, B=10
他从这些信息计算出 a、b 或 K 是极其困难的
```

这就是 **DH 密钥交换** 的核心思想。

## Java 实现 DH 密钥交换

```java
import javax.crypto.*;
import javax.crypto.spec.*;
import java.security.*;
import java.security.spec.*;

public class DHKeyExchange {
    
    public static void main(String[] args) throws Exception {
        // ===== 模拟 Alice 和 Bob 的密钥交换 =====
        
        // 1. Alice 生成 DH 密钥对参数
        AlgorithmParameterGenerator paramGen = AlgorithmParameterGenerator.getInstance("DH");
        paramGen.init(2048); // DH-2048 位
        AlgorithmParameters params = paramGen.generateParameters();
        DHParameterSpec dhSpec = params.getParameterSpec(DHParameterSpec.class);
        
        // 2. Alice 生成密钥对
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("DH");
        keyGen.initialize(dhSpec);
        KeyPair aliceKeyPair = keyGen.generateKeyPair();
        
        // 3. Alice 把公钥发送给 Bob（可以明文传输）
        byte[] alicePublicKeyBytes = aliceKeyPair.getPublic().getEncoded();
        
        // 4. Bob 用 Alice 的公钥初始化 DH KeyAgreement
        KeyFactory bobKeyFactory = KeyFactory.getInstance("DH");
        X509EncodedKeySpec aliceKeySpec = new X509EncodedKeySpec(alicePublicKeyBytes);
        PublicKey alicePublicKey = bobKeyFactory.generatePublic(aliceKeySpec);
        
        // 5. Bob 生成自己的密钥对
        KeyPair bobKeyPair = KeyPairGenerator.getInstance("DH").generateKeyPair();
        
        // 6. Bob 用 Alice 公钥初始化协议
        KeyAgreement bobAgree = KeyAgreement.getInstance("DH");
        bobAgree.init(bobKeyPair.getPrivate());
        bobAgree.doPhase(alicePublicKey, true);
        
        // 7. Bob 计算共享密钥
        byte[] bobSharedSecret = bobAgree.generateSecret();
        
        // 8. Alice 侧：用自己的私钥完成协议
        KeyAgreement aliceAgree = KeyAgreement.getInstance("DH");
        aliceAgree.init(aliceKeyPair.getPrivate());
        aliceAgree.doPhase(bobKeyPair.getPublic(), true);
        byte[] aliceSharedSecret = aliceAgree.generateSecret();
        
        // 9. 验证：两边共享密钥相同
        System.out.println("Alice 共享密钥: " + bytesToHex(aliceSharedSecret));
        System.out.println("Bob 共享密钥:   " + bytesToHex(bobSharedSecret));
        System.out.println("密钥相同: " + MessageDigest.isEqual(aliceSharedSecret, bobSharedSecret));
        
        // 10. 派生会话密钥（从共享密钥派生出 AES 密钥）
        SecretKeyFactory keyFactory = SecretKeyFactory.getInstance("HKDF");
        HKDFParameterSpec hkdfSpec = HKDFParameterSpec.withSha256("AES-256", 
            "TLS 1.3 with DH".getBytes());
        keyFactory.init(hkdfSpec, aliceSharedSecret, new byte[32]);
        SecretKey sessionKey = keyFactory.generateSecret(new SecretKeySpec(new byte[32], "AES"));
        System.out.println("会话密钥: " + bytesToHex(sessionKey.getEncoded()));
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

## DH 的安全性：离散对数难题

DH 密钥交换的安全性基于**离散对数难题**：

- 已知 g、p 和 A = g^a mod p
- 求 a 在计算上不可行

当 p 足够大（2048 位或以上）时，即使使用超级计算机，求解离散对数也需要数十年。

这就是为什么 DH 算法使用大质数——不是为了复杂而复杂，而是数学上的安全性要求。

## DH 的进化：ECDHE

DH 的问题是密钥长度太长。DH-2048 的安全性需要约 2048 位密钥，而同样安全级别的 ECC 只需要 224 位。

**ECDHE（Elliptic Curve Diffie-Hellman Ephemeral）** 用椭圆曲线替代了 DH 的群运算：

| 算法 | 密钥长度 | 相当安全性 |
|------|---------|-----------|
| DH-2048 | 2048 位 | 112 位安全 |
| DH-3072 | 3072 位 | 128 位安全 |
| ECDHE-P256 | 256 位 | 128 位安全 |
| ECDHE-P384 | 384 位 | 192 位安全 |

TLS 1.3 默认使用 ECDHE，现代浏览器也只支持 ECDHE 类的密钥交换。

## 前向保密：为什么 ECDHE 是必需的

假设你和一个网站的所有通信都被记录了。五年后，网站的私钥泄露了——攻击者能解密你的历史通信吗？

如果使用 **RSA 密钥交换**（用服务器公钥加密随机数），答案是**能**。因为会话密钥是用服务器公钥加密传输的，拿到私钥就能解密。

但如果使用 **ECDHE**，答案是**不能**。因为 ECDHE 的会话密钥是双方临时协商的，私钥泄露不影响历史会话。

这就是**前向保密（PFS, Perfect Forward Secrecy）**的价值。ECDHE 每次握手都生成新的临时密钥对，即使长期密钥泄露，历史会话依然安全。

## TLS 中的密钥交换

TLS 1.3 的握手过程（ECDHE）：

```
Client                               Server
  |                                     |
  |------- ClientHello + 客户端公钥 ----->|
  |                                     |
  |                    ServerHello + 服务器公钥
  |                                     |
  |<------- 证书 + ServerHello ---------|
  |                                     |
  |======== 双方计算共享密钥 ============|
  |                                     |
  |------- Finished ------------------->|
  |<------- Finished -------------------|
  |                                     |
  |====== 加密通信开始 =======|
```

整个握手过程只需要 1-RTT（一次往返），比 TLS 1.2 的 2-RTT 快了一倍。

## 密钥交换的面试追问方向

1. **DH 和 RSA 密钥交换的区别？** —— DH 支持前向保密，RSA 不支持；DH 是协商，RSA 是传输
2. **什么是离散对数难题？** —— 已知 g、p、A，求 a 在计算上不可行
3. **ECDHE 为什么比 DH 更高效？** —— 椭圆曲线数学提供同等安全下更短的密钥
4. **前向保密为什么重要？** —— 防止长期密钥泄露后历史通信被解密
5. **TLS 1.3 握手比 1.2 快在哪？** —— 1-RTT vs 2-RTT，废弃了不安全的算法

> "密钥交换是现代安全通信的起点。理解 DH/ECDHE 的原理，你就能看懂 HTTPS 握手的每一步，理解为什么 TLS 1.3 是安全通信的未来。"
