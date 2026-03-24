# TLS：互联网安全的基石

你访问银行网站时，浏览器地址栏显示一把锁，旁边写着「安全」。

这把锁的背后，就是 **TLS（Transport Layer Security，传输层安全协议）**。

没有 TLS，你输入的密码、银行卡号、聊天内容——所有数据都在裸奔，任何人都能窃听、篡改。

TLS 就是互联网安全通信的基石。

## TLS 的前世今生

```
SSL（Secure Sockets Layer）：
- SSL 1.0：从未公开发布
- SSL 2.0：1994 年，2011 年被废弃
- SSL 3.0：1996 年，2020 年被废弃

TLS：
- TLS 1.0（SSL 3.1）：1999 年，已废弃
- TLS 1.1（SSL 3.2）：2006 年，已废弃
- TLS 1.2（SSL 3.3）：2008 年，推荐使用
- TLS 1.3：2018 年，当前标准
```

TLS 1.3 相比 1.2 的改进：

- **握手简化**：从 2-RTT 变成 1-RTT（更快）
- **废除不安全算法**：移除 MD5、SHA-1、3DES、RC4
- **前向保密**：默认启用 ECDHE
- **0-RTT**：可选的零往返模式（但有重放风险）

## TLS 的核心功能

```
┌─────────────────────────────────────────────────────────────┐
│                    TLS 提供三大保障                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 机密性（Encryption）                                    │
│     数据加密传输，第三方无法窃听                               │
│                                                             │
│  2. 完整性（Integrity）                                     │
│     数据被篡改能被发现                                       │
│                                                             │
│  3. 认证（Authentication）                                  │
│     验证服务器身份，防止假冒                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## TLS 1.3 握手过程

TLS 握手是建立安全连接的核心过程：

```
┌─────────────────────────────────────────────────────────────┐
│                 TLS 1.3 握手（1-RTT）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  客户端                              服务器                  │
│                                                             │
│  │                                    │                    │
│  │──── ClientHello ──────────────────▶│                    │
│  │    支持的密码套件                   │                    │
│  │    客户端椭圆曲线参数               │                    │
│  │    客户端 DH 公钥                   │                    │
│  │                                    │                    │
│  │◀─── ServerHello ───────────────────│                    │
│  │    选中的密码套件                   │                    │
│  │    服务器 DH 公钥                   │                    │
│  │                                    │                    │
│  │◀─── 证书 + 证书验证 ──────────────│                    │
│  │    服务器签名                       │                    │
│  │                                    │                    │
│  │◀─── ServerFinished ───────────────│                    │
│  │    握手消息摘要                     │                    │
│  │                                    │                    │
│  │──── Finished ──────────────────────▶│                    │
│  │    握手消息摘要                     │                    │
│  │                                    │                    │
│  │══════════ 加密通信开始 ════════════│                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ClientHello 关键参数

```
ClientHello 包含：
1. TLS 版本：TLS 1.3
2. 客户端随机数：32 字节，用于生成会话密钥
3. Session ID：用于会话恢复
4. 支持的密码套件：如 TLS_AES_128_GCM_SHA256
5. 支持的签名算法：如 RSA+SHA256, ECDSA+SHA256
6. 支持的椭圆曲线：如 X25519, secp256r1
7. ALPN：应用层协议协商（HTTP/2, HTTP/3）
```

### 密钥派生

TLS 1.3 使用 HKDF 派生密钥：

```java
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.*;
import java.security.*;
import java.util.Base64;

public class TLSKeyDerivation {
    
    public static void main(String[] args) throws Exception {
        // 模拟 TLS 1.3 密钥派生
        
        // 1. ECDHE 密钥交换（双方各自生成密钥对）
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("X25519");
        KeyPair clientKeyPair = keyGen.generateKeyPair();
        KeyPair serverKeyPair = keyGen.generateKeyPair();
        
        // 2. 双方计算共享密钥
        KeyAgreement clientAgree = KeyAgreement.getInstance("X25519");
        clientAgree.init(clientKeyPair.getPrivate());
        clientAgree.doPhase(serverKeyPair.getPublic(), true);
        byte[] sharedSecret = clientAgree.generateSecret();
        
        // 3. 使用 HKDF 派生密钥
        // HKDF = HKDF-Extract + HKDF-Expand
        // Extract：从共享密钥提取伪随机密钥
        // Expand：从伪随机密钥派生出具体密钥
        
        KeyGenerator hkdf = KeyGenerator.getInstance("HKDF256");
        
        // 主密钥 = HKDF-Extract(固定盐, ECDH 共享密钥)
        byte[] salt = new byte[32];  // 固定盐
        SecretKey masterKey = hkdf.generateKey();
        
        // 派生出多个密钥
        // - server_write_key：服务器加密密钥
        // - client_write_key：客户端加密密钥
        // - server_write_iv：服务器 IV
        // - client_write_iv：客户端 IV
        
        System.out.println("共享密钥: " + Base64.getEncoder().encodeToString(sharedSecret));
        System.out.println("密钥派生完成");
    }
}
```

## TLS 1.3 vs TLS 1.2

| 特性 | TLS 1.2 | TLS 1.3 |
|------|---------|---------|
| 握手次数 | 2-RTT | 1-RTT |
| 0-RTT | 支持但复杂 | 支持 |
| RSA 密钥交换 | 支持 | 不支持 |
| 3DES | 支持 | 不支持 |
| SHA-1 | 支持 | 不支持 |
| RC4 | 支持 | 不支持 |
| 前向保密 | 可选 | 必须 |
| 密钥更新 | 需要重新握手 | 0-RTT 更新 |

## 密码套件

TLS 1.3 简化了密码套件，只保留 5 个：

```
TLS_AES_128_GCM_SHA256
TLS_AES_256_GCM_SHA384
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_CCM_SHA256
TLS_AES_128_CCM_8_SHA256
```

格式：`加密算法_模式_AEAD或哈希`

```
AES_256_GCM：
- AES-256：密钥长度 256 位
- GCM：Galois/Counter Mode，同时加密和认证

CHACHA20_POLY1305：
- 更适合移动设备（CPU 友好）
- 没有 AES 的硬件加速也能高效运行
```

## Java TLS 配置

```java
import javax.net.ssl.*;
import java.security.*;
import java.security.cert.*;

public class TLSConfig {
    
    /**
     * 配置 TLS 1.3（Java 11+）
     */
    public SSLContext createTLS13Context() throws NoSuchAlgorithmException {
        SSLContext sslContext = SSLContext.getInstance("TLSv1.3");
        
        // 密钥管理器：验证证书
        KeyManagerFactory kmf = KeyManagerFactory.getInstance(
            KeyManagerFactory.getDefaultAlgorithm()
        );
        kmf.init(null, null);
        
        // 信任管理器：验证服务器证书
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init((KeyStore) null);  // 使用系统默认的 CA 证书
        
        sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), new SecureRandom());
        
        return sslContext;
    }
    
    /**
     * 配置 HTTPS 连接
     */
    public HttpsURLConnection createHTTPSConnection(URL url) throws Exception {
        SSLContext sslContext = createTLS13Context();
        
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.setSSLSocketFactory(sslContext.getSocketFactory());
        
        // 验证主机名
        conn.setHostnameVerifier((hostname, session) -> {
            // 使用默认的主机名验证
            HttpsURLConnection.setDefaultHostnameVerifier(
                new DefaultHostnameVerifier()
            );
            return true;
        });
        
        return conn;
    }
}
```

## 证书与 CA

### 证书链验证

```
浏览器验证证书链：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  终端实体证书（yoursite.com）                                │
│      │                                                      │
│      │ 签发者：中间 CA                                       │
│      ▼                                                      │
│  中间 CA 证书                                                │
│      │                                                      │
│      │ 签发者：根 CA                                        │
│      ▼                                                      │
│  根 CA 证书（浏览器内置）                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘

验证过程：
1. 浏览器有根 CA 的公钥（内置）
2. 用根 CA 公钥验证中间 CA 证书签名
3. 用中间 CA 公钥验证网站证书签名
4. 验证网站证书的域名、有效期、吊销状态
```

### 自签名证书配置

```java
import javax.net.ssl.*;
import java.io.*;
import java.security.*;
import java.security.cert.*;
import java.util.Base64;
import java.security.MessageDigest;

public class SelfSignedCertificate {
    
    /**
     * 生成自签名证书（仅用于测试）
     */
    public SSLContext createSelfSignedContext() throws Exception {
        // 1. 生成密钥对
        KeyPairGenerator keyGen = KeyPairGenerator.getInstance("RSA");
        keyGen.initialize(2048);
        KeyPair keyPair = keyGen.generateKeyPair();
        
        // 2. 创建自签名证书
        byte[] certBytes = generateSelfSignedCertificate(keyPair);
        
        // 3. 创建 KeyStore
        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        keyStore.load(null, null);
        keyStore.setKeyEntry("server", keyPair.getPrivate(), "changeit".toCharArray(),
            new Certificate[]{generateCertificate(certBytes)});
        
        // 4. 创建 TrustStore（信任自己的证书）
        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        trustStore.load(null, null);
        trustStore.setCertificateEntry("server", generateCertificate(certBytes));
        
        // 5. 初始化 SSLContext
        KeyManagerFactory kmf = KeyManagerFactory.getInstance("SunX509");
        kmf.init(keyStore, "changeit".toCharArray());
        
        TrustManagerFactory tmf = TrustManagerFactory.getInstance("SunX509");
        tmf.init(trustStore);
        
        SSLContext sslContext = SSLContext.getInstance("TLSv1.3");
        sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);
        
        return sslContext;
    }
    
    private byte[] generateSelfSignedCertificate(KeyPair keyPair) throws Exception {
        // 使用 keytool 或 openssl 生成：
        // keytool -genkeypair -alias server -keyalg RSA -keystore keystore.jks
        // keytool -exportcert -alias server -keystore keystore.jks -file server.crt
        return new byte[0];  // 占位
    }
    
    private Certificate generateCertificate(byte[] bytes) throws Exception {
        return null;  // 占位
    }
}
```

## TLS 常见问题

### 1. 证书错误

```
常见错误：
- 证书过期
- 证书域名不匹配
- 证书链不完整
- 自签名证书

解决方案：
- 及时续期证书
- 使用 Let's Encrypt 免费证书
- 配置完整的证书链
```

### 2. TLS 版本降级

```
攻击场景：中间人强制使用低版本 TLS
防护：禁用旧版本 TLS（1.0、1.1）
```

### 3. 混合内容

```
HTTPS 页面加载 HTTP 资源
风险：HTTP 资源可被中间人篡改
解决：使用 HTTPS 或相对 URL
```

## 面试追问方向

1. **TLS 1.3 相比 1.2 改进了什么？** —— 1-RTT 握手、废弃不安全算法、默认前向保密
2. **前向保密为什么重要？** —— 长期密钥泄露不影响历史会话
3. **证书链验证的原理？** —— 从根 CA 到终端证书，逐级验证签名
4. **0-RTT 的风险？** —— 存在重放攻击风险，不适合关键业务
5. **TLS 和 SSL 的区别？** —— TLS 是 SSL 的继任者，SSL 已废弃

> "TLS 是互联网安全的基石。理解它的握手过程和密钥派生，是理解 HTTPS 安全通信的关键。"
