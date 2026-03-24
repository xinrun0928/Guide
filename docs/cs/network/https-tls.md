# HTTPS 加密原理：TLS 握手流程

你可能已经知道 HTTPS 比 HTTP 安全。但你有没有想过：

HTTPS 到底是怎么加密的？对称加密还是非对称加密？证书是用来做什么的？TLS 握手需要多少次网络往返？

今天，让我们彻底理解 HTTPS 的加密原理。

## 为什么需要 HTTPS？

### HTTP 的安全问题

```
HTTP 是明文传输：
客户端 ──── GET /account?password=123456 ────> 服务器
任何人都能截获这个请求：
- 窃听者：看到你的密码
- 篡改者：修改你的请求内容
- 伪装者：假装成银行网站
```

### HTTPS 的解决方案

```
HTTPS = HTTP + TLS/SSL
HTTPS = HTTP over TLS

客户端 ──── 加密的数据 ────> 服务器
           （只有服务器能解密）
```

## 加密算法基础

### 对称加密

```
密钥：同一个密钥用于加密和解密

加密：plaintext + key → ciphertext
解密：ciphertext + key → plaintext

优点：速度快
缺点：密钥传输困难

常见算法：AES、DES、3DES、ChaCha20
```

### 非对称加密

```
密钥：一对密钥（公钥 + 私钥）
公钥加密 → 私钥解密
私钥加密 → 公钥解密

优点：密钥传输安全
缺点：速度慢

常见算法：RSA、ECDSA、Ed25519
```

### 混合加密

HTTPS 使用混合加密：

```
1. 使用非对称加密交换对称密钥
   客户端 ──── 加密的随机数 ────> 服务器
   （用服务器公钥加密）

2. 使用对称加密传输实际数据
   双方用协商出的对称密钥加密通信
```

## TLS 握手流程

### TLS 1.2 握手（最常见）

```
┌─────────────────────────────────────────────────────────────┐
│                    TLS 1.2 握手过程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  客户端                                              服务器  │
│     │                                                     │
│     │  1. ClientHello                                    │
│     │  ─────────────────────────────────────────────────> │
│     │     支持的 TLS 版本                                  │
│     │     支持的加密套件列表                                │
│     │     客户端随机数                                     │
│     │     Session ID（用于会话恢复）                        │
│     │     SNI（服务器名称指示）                            │
│     │                                                     │
│     │                             2. ServerHello          │
│     │  <───────────────────────────────────────────────── │
│     │     选择的 TLS 版本                                  │
│     │     选择的加密套件                                    │
│     │     服务器随机数                                     │
│     │     Session ID                                      │
│     │                                                     │
│     │                             3. Certificate           │
│     │  <───────────────────────────────────────────────── │
│     │     服务器证书链                                     │
│     │                                                     │
│     │                             4. ServerHelloDone       │
│     │  <───────────────────────────────────────────────── │
│     │                                                     │
│     │  5. ClientKeyExchange                               │
│     │  ─────────────────────────────────────────────────> │
│     │     客户端随机数（用服务器公钥加密）                   │
│     │                                                     │
│     │  6. ChangeCipherSpec                                │
│     │  ─────────────────────────────────────────────────> │
│     │     告诉对方：之后的消息会加密                        │
│     │                                                     │
│     │  7. Finished                                        │
│     │  ─────────────────────────────────────────────────> │
│     │     加密的握手消息摘要                               │
│     │                                                     │
│     │                             8. ChangeCipherSpec      │
│     │  <───────────────────────────────────────────────── │
│     │                                                     │
│     │                             9. Finished              │
│     │  <───────────────────────────────────────────────── │
│     │                                                     │
│     │  ════════════════════════════════════════════      │
│     │           安全通信开始                               │
│     │  ════════════════════════════════════════════      │
│     │                                                     │
└─────────────────────────────────────────────────────────────┘

总计：2 RTT
```

### TLS 1.3 握手（更安全更快）

TLS 1.3 优化了握手流程，减少到 1 RTT：

```
┌─────────────────────────────────────────────────────────────┐
│                    TLS 1.3 握手过程                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  客户端                                              服务器  │
│     │                                                     │
│     │  1. ClientHello                                     │
│     │  ─────────────────────────────────────────────────> │
│     │     支持的 TLS 版本                                  │
│     │     支持的加密套件列表                                │
│     │     客户端随机数                                     │
│     │     支持的密钥共享算法（如 P-256）                    │
│     │                                                     │
│     │                             2. ServerHello          │
│     │  <───────────────────────────────────────────────── │
│     │     选择的加密套件                                    │
│     │     服务器随机数                                     │
│     │     服务器密钥共享（使用客户端建议的参数）              │
│     │                                                     │
│     │     3. Certificate                                  │
│     │  <───────────────────────────────────────────────── │
│     │     服务器证书链                                     │
│     │                                                     │
│     │     4. CertificateVerify                            │
│     │  <───────────────────────────────────────────────── │
│     │     用私钥签名的握手摘要                              │
│     │                                                     │
│     │     5. Finished                                     │
│     │  <───────────────────────────────────────────────── │
│     │     加密的握手消息摘要                               │
│     │                                                     │
│     │  6. Finished                                        │
│     │  ─────────────────────────────────────────────────> │
│     │                                                     │
│     │  ════════════════════════════════════════════      │
│     │           安全通信开始                               │
│     │  ════════════════════════════════════════════      │
│     │                                                     │
└─────────────────────────────────────────────────────────────┘

总计：1 RTT
```

### TLS 1.3 0-RTT 握手

如果之前建立过连接，可以使用缓存的密钥：

```
客户端                                              服务器
   │
   │  ClientHello + Early Data（0-RTT）
   │  ─────────────────────────────────────────────────> │
   │     使用保存的 PSK（Pre-Shared Key）加密            │
   │
   │     ServerHello + New Session Ticket
   │  <──────────────────────────────────────────────── │
   │     可以拒绝 Early Data（如果安全检查失败）           │
   │
   │  安全通信开始（部分数据已发送）
```

**注意**：0-RTT 有重放攻击风险，不适合敏感请求。

## 数字证书与 CA

### 为什么需要证书？

非对称加密的问题是：**如何确认公钥是服务器的，而不是伪造的？**

```
攻击场景：
1. 你访问银行网站
2. 攻击者截获你的请求，发送自己的公钥
3. 你用攻击者的公钥加密密码
4. 攻击者用私钥解密，拿到密码

证书的作用：证明「这个公钥确实属于 example.com」
```

### 证书内容

```
X.509 证书包含：
- 持有者信息（example.com）
- 公钥
- 颁发者信息（证书颁发机构）
- 证书有效期
- 证书签名
- ...
```

### 证书链

```
根证书（Root CA）：
- 浏览器/系统内置
- 最可信赖
- 数量有限（数百个）
    │
    │ 颁发
    ▼
中间证书（Intermediate CA）：
- 由根 CA 颁发
- 数量较多
- 实际签发服务器证书
    │
    │ 颁发
    ▼
服务器证书（End-Entity Certificate）：
- example.com
- 网站实际使用的证书
```

### 证书验证流程

```
浏览器收到服务器证书：
1. 提取证书链：[服务器证书] → [中间证书] → [根证书]
2. 用中间证书的公钥验证服务器证书签名
3. 用根证书的公钥验证中间证书签名
4. 检查证书是否过期
5. 检查证书是否被吊销
6. 检查域名是否匹配
7. 全部通过 → 信任该证书
```

## 加密套件

### 常见加密套件格式

```
TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256
│   │     │    │    │      │
│   │     │    │    │      └── 签名算法
│   │     │    │    └───────── AES-128-GCM（数据加密）
│   │     │    └─────────────── 密钥交换
│   │     └─────────────────────── 公钥算法
│   └────────────────────────────── 密钥交换算法
└────────────────────────────────── TLS 协议版本
```

### TLS 1.3 简化了加密套件

```
TLS 1.3 只支持 5 种加密套件：
- TLS_AES_128_GCM_SHA256
- TLS_AES_256_GCM_SHA384
- TLS_CHACHA20_POLY1305_SHA256
- TLS_AES_128_CCM_SHA256
- TLS_AES_128_CCM_8_SHA256

所有套件都支持前向保密（Forward Secrecy）
```

### 前向保密（Forward Secrecy）

```
普通 RSA 密钥交换：
- 服务器私钥固定
- 如果私钥泄露，历史通信都能解密
- 危险！

ECDHE 密钥交换：
- 每次连接使用临时密钥对
- 私钥不存储，长期密钥泄露不影响历史通信
- 安全！

TLS 1.3 要求必须支持前向保密
```

## Java 代码示例

### 使用 HttpsURLConnection

```java
import java.io.*;
import java.net.*;
import javax.net.ssl.*;
import java.security.cert.*;

public class HTTPSDemo {
    public static void main(String[] args) throws Exception {
        URL url = new URL("https://example.com");
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();

        // 启用 SSL/TLS
        conn.setRequestMethod("GET");

        // 获取证书信息
        SSLSocketFactory factory = conn.getSSLSocketFactory();
        SSLSession session = conn.getSSLPeerCertificates();

        System.out.println("连接的加密套件: " + session.getCipherSuite());
        System.out.println("协议版本: " + session.getProtocol());

        // 读取响应
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }
        }
    }
}
```

### 自定义 TrustManager（信任所有证书，仅用于测试）

```java
import javax.net.ssl.*;
import java.security.cert.*;
import java.security.KeyManagementException;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;

public class TrustAllCertsDemo {
    public static void main(String[] args) throws Exception {
        // 创建信任所有证书的 TrustManager
        TrustManager[] trustAllCerts = new TrustManager[]{
            new X509TrustManager() {
                public X509Certificate[] getAcceptedIssuers() {
                    return new X509Certificate[0];
                }

                public void checkClientTrusted(
                        X509Certificate[] certs, String authType) {
                }

                public void checkServerTrusted(
                        X509Certificate[] certs, String authType) {
                }
            }
        };

        // 创建 SSLContext
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, trustAllCerts, new SecureRandom());

        // 使用自定义 SSLContext
        SSLSocketFactory factory = sslContext.getSocketFactory();
        SSLSocket socket = (SSLSocket) factory.createSocket("example.com", 443);
        socket.startHandshake();

        System.out.println("连接已建立");
        socket.close();
    }
}
```

## 常见问题

### 问题一：证书错误

```
常见错误：
1. 证书过期 → 更新证书
2. 证书域名不匹配 → 检查域名配置
3. 证书链不完整 → 配置完整证书链
4. 自签名证书 → 浏览器不信任
```

### 问题二：TLS 版本过旧

```nginx
# Nginx 配置，禁用旧 TLS 版本
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:...;
ssl_prefer_server_ciphers on;
```

### 问题三：混合内容

```
HTTPS 页面加载 HTTP 资源 → 混合内容警告
解决：
1. 使用 HTTPS 加载所有资源
2. 使用相对路径 //example.com/resource
```

## 面试追问方向

- HTTPS 是如何加密的？对称加密还是非对称加密？
- TLS 握手流程是什么？需要多少次网络往返？
- 什么是数字证书？为什么需要证书？
- 什么是 CA？证书链是怎么工作的？
- 什么是前向保密？为什么重要？
- TLS 1.2 和 TLS 1.3 的区别是什么？
- 什么是 0-RTT？有什么安全风险？
- 什么是 SNI？为什么重要？
- HTTPS 有性能开销吗？如何优化？
- 什么是混合内容？如何避免？
