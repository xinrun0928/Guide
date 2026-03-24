# 非对称加密：打开潘多拉的密码盒

你有没有想过这个问题：

两个人隔着半个地球要安全通信，密钥怎么送过去？

派人送？可能被截获。
打电话？可能被窃听。
发邮件？可能被篡改。

这听起来像是一个无解的问题——**在对称加密的世界里，确实无解。**

直到 1976 年，Whitfield Diffie 和 Martin Hellman 发表了《密码学的新方向》，提出了非对称加密的概念，彻底改变了密码学的游戏规则。

## 非对称加密的核心思想

对称加密的问题在于：加密和解密用同一把钥匙。你要安全传递密钥，但传递密钥本身就不安全。

非对称加密的天才之处在于：**加密和解密用不同的钥匙。**

- **公钥（Public Key）**：公开给所有人，就像你的邮箱地址
- **私钥（Private Key）**：严格保密，只有你自己知道，就像邮箱密码

公钥加密的信息，只有私钥能解密。私钥加密的信息，也只有公钥能验证。

这意味着：**你不需要安全传递密钥，只需要安全传递「锁」——而锁是可以公开的。**

## RSA：非对称加密的祖师爷

RSA 是目前最广泛使用的非对称加密算法，由 Ron Rivest、Adi Shamir 和 Leonard Adleman 在 1977 年提出。

RSA 的安全性建立在**大数分解难题**上：

- 选两个大质数 p 和 q，计算 N = p × q
- N 是公开的，但从 N 反推 p 和 q 是极其困难的
- 当 N 大到足够大时（2048 位或以上），即使使用超级计算机也需要数十年

```java
import java.security.*;
import java.util.Base64;

public class RSAExample {
    public static void main(String[] args) throws Exception {
        // 1. 生成密钥对
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048); // 密钥长度
        KeyPair keyPair = keyGen.generateKeyPair();
        
        PublicKey publicKey = keyPair.getPublic();
        PrivateKey privateKey = keyPair.getPrivate();
        
        // 2. 公钥加密
        String message = "敏感信息：银行卡密码 123456";
        Cipher cipher = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        cipher.init(Cipher.ENCRYPT_MODE, publicKey);
        byte[] encrypted = cipher.doFinal(message.getBytes("UTF-8"));
        
        // 3. 私钥解密
        cipher.init(Cipher.DECRYPT_MODE, privateKey);
        byte[] decrypted = cipher.doFinal(encrypted);
        System.out.println(new String(decrypted, "UTF-8"));
        
        // 4. 私钥签名
        Signature signature = Signature.getInstance("SHA256withRSA");
        signature.initSign(privateKey);
        signature.update(message.getBytes("UTF-8"));
        byte[] signBytes = signature.sign();
        
        // 5. 公钥验签
        signature.initVerify(publicKey);
        signature.update(message.getBytes("UTF-8"));
        boolean verified = signature.verify(signBytes);
        System.out.println("签名验证: " + verified);
    }
}
```

## RSA 的工作模式

### 加密 vs 签名

RSA 有两个核心用途：

**加密（Encryption）**：用公钥加密，保护数据机密性
- 发送方用接收方的公钥加密
- 只有持有对应私钥的接收方能解密

**签名（Signature）**：用私钥签名，验证数据来源和完整性
- 发送方用自己的私钥签名
- 任何持有对应公钥的人都能验证
- 但只有发送方能产生这个签名

| 操作 | 使用密钥 | 目的 |
|------|---------|------|
| 加密 | 公钥 | 机密性——只有私钥持有者能看 |
| 解密 | 私钥 | 机密性 |
| 签名 | 私钥 | 认证+完整性——证明「这是我发的」 |
| 验签 | 公钥 | 认证+完整性 |

## 主流非对称加密算法

### RSA：最经典的选择

- 密钥长度：2048 位是当前最低标准，4096 位用于高安全场景
- 优点：兼容性最好，几乎所有系统都支持
- 缺点：加密/解密速度慢，不适合大量数据

### ECC：更轻量的选择

椭圆曲线密码学（Elliptic Curve Cryptography）用更短的密钥提供同等安全性：

| RSA 密钥长度 | ECC 密钥长度 | 相当安全性 |
|-------------|-------------|-----------|
| 2048 位 | 224 位 | 相当 |
| 3072 位 | 256 位 | 相当 |
| 7680 位 | 384 位 | 相当 |

ECC 的优势在移动设备和 IoT 场景中尤为明显——更短的密钥意味着更低的计算和存储开销。

### 国密 SM2

SM2 是中国国家密码管理局发布的椭圆曲线公钥密码算法，性能与 RSA-2048 相当，需要在合规系统中使用。

## 非对称加密的致命缺陷

非对称加密很强大，但有一个根本问题：**慢**。

非对称加密的数学运算（如 RSA 的大数模幂运算）比对称加密慢 100-1000 倍。加密 1MB 数据可能需要几秒钟。

实际应用中，**从来不会用非对称加密直接加密大文件**。解决方案是混合加密——用非对称加密传递对称密钥，用对称密钥加密实际数据。这正是 TLS 的核心思想。

## 中间人攻击：非对称加密的阴影

非对称加密解决了密钥分发问题，但又引入了新问题：**你怎么确定公钥是真的？**

攻击者可以伪造公钥！想象这个场景：

1. 你想访问银行网站，获取了「银行公钥」
2. 攻击者截获了请求，返回了「攻击者公钥」
3. 你用「攻击者公钥」加密敏感信息
4. 攻击者用「攻击者私钥」解密，拿到信息
5. 攻击者再用「银行公钥」加密，转发给银行

整个过程中，你和银行都以为在安全通信，但中间藏着一个「中间人」。

这就是 TLS 需要证书和 CA（证书颁发机构）的原因——**建立一个可信的公钥分发体系**。

## 面试追问方向

1. **RSA 的数学原理是什么？** —— 欧拉函数、模幂运算、离散对数
2. **RSA 为什么慢？** —— 大数模幂运算是计算密集型，而对称加密是位运算
3. **ECC 为什么能用更短的密钥提供同等安全？** —— 椭圆曲线离散对数问题的计算难度更高
4. **如何防止中间人攻击？** —— 证书体系、CA 验证、证书链验证
5. **非对称加密除了加密还有什么用途？** —— 数字签名、密钥交换、身份认证

> "非对称加密是现代互联网安全的基石。从 HTTPS 到数字签名，从区块链到电子合同，它的身影无处不在。"
