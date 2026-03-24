# 数字证书与 CA 认证

HTTPS 的安全性建立在一个基础上：**你确信正在通信的服务器是真实的，而不是伪装的。**

这个「确信」来自数字证书和 CA（证书颁发机构）认证体系。

理解证书和 CA，是理解 HTTPS 安全的核心。

## 为什么需要证书？

### 中间人攻击（Man-in-the-Middle Attack）

```
没有证书的情况：

正常通信：
用户 ───────────────────────> 银行网站
       我的密码是 123456

中间人攻击：
用户 ── X ─────────────────> 攻击者
       我的密码是 123456
              ↓
攻击者 ─────────────────────> 银行网站
       我的密码是 123456

用户以为在和银行通信，实际在和攻击者通信
```

### 证书的作用

```
有证书的情况：
1. 服务器证明「我是 example.com，我的公钥是 xxx」
2. 证书由可信机构（CA）签发
3. 用户验证证书，确认服务器身份
4. 攻击者没有合法证书，无法伪装
```

## 证书结构

### X.509 证书格式

数字证书遵循 X.509 标准，包含以下信息：

```
┌─────────────────────────────────────────────────────────────┐
│                    X.509 证书结构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 证书持有者信息                                          │
│     - 域名（Subject）                                        │
│     - 组织信息                                              │
│     - 持有者公钥                                           │
│                                                             │
│  2. 颁发者信息                                              │
│     - 颁发者（Issuer）                                       │
│     - 颁发者公钥（隐含）                                    │
│                                                             │
│  3. 有效期                                                  │
│     - 生效日期                                              │
│     - 过期日期                                              │
│                                                             │
│  4. 序列号                                                 │
│     - CA 分配的唯一编号                                      │
│                                                             │
│  5. 签名算法                                                │
│     - 用于签发证书的算法                                     │
│                                                             │
│  6. 签名                                                    │
│     - CA 对上述内容的数字签名                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 实际证书示例

```bash
# 查看证书详情
$ openssl x509 -in certificate.pem -text -noout

Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            04:00:00:00:00:01:15:4b:5a:c3:94
        Signature Algorithm: sha256WithRSAEncryption
        Issuer: C=US, O=Let's Encrypt, CN=R3
        Validity
            Not Before: Jan  1 00:00:00 2026 GMT
            Not After : Apr  1 00:00:00 2026 GMT
        Subject: CN=example.com
        Subject Public Key Info:
            Public Key Algorithm: rsaEncryption
            RSA Public-Key: (2048 bit)
                Modulus:
                    00:e2:8b:47:a6:5c:... (公钥内容)
                Exponent: 65537 (0x10001)
        X509v3 extensions:
            X509v3 Key Usage:
                Digital Signature, Key Encipherment
            X509v3 Basic Constraints:
                CA:FALSE
            X509v3 Subject Alternative Name:
                DNS:example.com, DNS:www.example.com
```

## CA（证书颁发机构）

### CA 的层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                    CA 层次结构                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    根 CA（Root CA）                         │
│                    - 浏览器/系统内置                        │
│                    - 最可信的信任锚点                        │
│                    - 数量有限（数百个）                      │
│                           │                                 │
│                           │ 颁发                            │
│                           ▼                                 │
│                    中间 CA（Intermediate CA）                │
│                    - 由根 CA 颁发                           │
│                    - 数量较多                               │
│                    - 实际签发服务器证书                      │
│                           │                                 │
│                           │ 颁发                            │
│                           ▼                                 │
│                    服务器证书（End-Entity Certificate）      │
│                    - 网站实际使用的证书                      │
│                    - 有效期通常 1 年                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 证书链验证

```
浏览器验证 example.com 证书的流程：

1. 提取证书链：
   [example.com 证书]
         ↑
   [R3 中间证书]    ← example.com 证书由 R3 签发
         ↑
   [ISRG Root X1]   ← R3 由 ISRG Root X1 签发

2. 验证 example.com 证书：
   - 用 R3 的公钥验证签名
   - 检查域名是否匹配
   - 检查是否过期
   - 检查是否被吊销

3. 验证 R3 中间证书：
   - 用 ISRG Root X1 的公钥验证签名
   - 检查是否过期

4. 验证 ISRG Root X1：
   - 这是根证书
   - 浏览器内置，无需验证
```

### 根证书存储

```
操作系统存储根证书：
Windows：证书存储（certmgr.msc）
macOS：钥匙串访问
Linux：/etc/ssl/certs/ca-certificates.crt

浏览器也可能存储自己的根证书：
Chrome、Firefox 有独立的证书存储
```

## 证书类型

### 按验证级别分类

```
1. DV（Domain Validation）
   - 只验证域名所有权
   - 签发快（几分钟）
   - 适合个人网站
   - Let's Encrypt 免费签发
   - 图标：无或锁

2. OV（Organization Validation）
   - 验证域名 + 组织身份
   - 需要人工审核
   - 适合企业网站
   - 图标：锁 + 组织名称

3. EV（Extended Validation）
   - 最严格的验证
   - 浏览器地址栏显示绿色
   - 适合金融机构
   - 价格昂贵
   - 图标：绿色地址栏
```

### 按域名数量分类

```
1. 单域名证书
   - 只保护一个域名
   - example.com 或 www.example.com

2. 通配符证书
   - 保护主域名和所有子域名
   - *.example.com
   - 不包括顶级域名

3. 多域名证书（SAN）
   - 保护多个域名
   - example.com, example.org, www.example.net
```

## 证书签发流程

### 使用 Let's Encrypt（ACME 协议）

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 自动获取并配置证书
sudo certbot --nginx -d example.com -d www.example.com

# 证书自动续期（Let's Encrypt 有效期 90 天）
sudo certbot renew
```

### 手动签发流程

```
1. 生成私钥
   openssl genrsa -out server.key 2048

2. 生成 CSR（证书签名请求）
   openssl req -new -key server.key -out server.csr

3. 提交 CSR 给 CA
   CA 验证域名所有权

4. CA 签发证书
   CA 返回证书文件

5. 配置服务器使用证书
```

## 证书吊销

### 为什么要吊销证书？

```
证书可能需要吊销的情况：
1. 私钥泄露
2. 网站被入侵
3. CA 被攻击
4. 域名不再使用
```

### 吊销检查方式

```
1. CRL（Certificate Revocation List）
   - CA 发布被吊销证书的列表
   - 定期下载并检查
   - 缺点：列表可能很大，更新不及时

2. OCSP（Online Certificate Status Protocol）
   - 实时查询证书状态
   - 优点：实时
   - 缺点：需要向 CA 请求，隐私问题

3. OCSP Stapling
   - 服务器定期向 CA 查询
   - 服务器在 TLS 握手时「钉住」OCSP 响应
   - 浏览器不需要额外请求
```

```nginx
# Nginx 启用 OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8 8.8.4.4 valid=300s;
resolver_timeout 5s;
```

## 证书透明（Certificate Transparency）

### 什么是 CT？

证书透明（Certificate Transparency）要求 CA 签发证书时，必须将证书记录到一个公开的日志服务器。

```
没有 CT 的问题：
- CA 被攻击，签发非法证书
- 用户无法知道

有 CT 的问题解决：
- 所有证书都记录在日志中
- 任何人都可以查看
- 域名所有者可以监控
```

### CT 日志服务器

```
常见 CT 日志服务器：
- Google Argon（operated by Google）
- DigiCert Yeti（operated by DigiCert）
- Sectigo Mammoth（operated by Sectigo）

证书必须被提交到至少 2 个 CT 日志才能被信任
```

## 自签名证书

### 创建自签名证书

```bash
# 生成私钥
openssl genrsa -out selfsigned.key 2048

# 生成证书
openssl req -new -x509 -key selfsigned.key -out selfsigned.crt -days 365 \
  -subj "/CN=example.com"

# 合并为 PFX 格式（Java/Kubernetes 常用）
openssl pkcs12 -export -in selfsigned.crt -inkey selfsigned.key \
  -out selfsigned.pfx -name "selfsigned"
```

### 自签名证书的问题

```
1. 不被浏览器信任
   - 需要手动添加信任

2. 无法吊销
   - 没有 CA 支持吊销

3. 没有 CA 保障
   - 无法证明域名所有权

用途：
- 开发测试环境
- 内网服务
- 学习研究
```

## Java 中的证书处理

### 读取证书

```java
import java.io.FileInputStream;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Base64;

public class CertificateReader {
    public static void main(String[] args) throws Exception {
        CertificateFactory cf = CertificateFactory.getInstance("X.509");

        try (FileInputStream fis = new FileInputStream("certificate.crt")) {
            X509Certificate cert = (X509Certificate) cf.generateCertificate(fis);

            System.out.println("主题: " + cert.getSubjectX500Principal());
            System.out.println("颁发者: " + cert.getIssuerX500Principal());
            System.out.println("有效期: " + cert.getNotBefore() + " - " + cert.getNotAfter());
            System.out.println("序列号: " + cert.getSerialNumber());

            // 获取公钥信息
            System.out.println("公钥算法: " + cert.getPublicKey().getAlgorithm());
        }
    }
}
```

### 信任自签名证书

```java
import javax.net.ssl.*;
import java.security.KeyStore;
import java.security.cert.X509Certificate;

// 将证书添加到信任库
public class TrustStoreDemo {
    public static void main(String[] args) throws Exception {
        // 加载证书
        CertificateFactory cf = CertificateFactory.getInstance("X.509");
        FileInputStream fis = new FileInputStream("server.crt");
        X509Certificate cert = (X509Certificate) cf.generateCertificate(fis);
        fis.close();

        // 创建包含证书的 TrustStore
        KeyStore trustStore = KeyStore.getInstance(KeyStore.getDefaultType());
        trustStore.load(null, null);
        trustStore.setCertificateEntry("server", cert);

        // 创建 TrustManagerFactory
        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
            TrustManagerFactory.getDefaultAlgorithm());
        tmf.init(trustStore);

        // 创建 SSLContext
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, tmf.getTrustManagers(), null);

        // 使用 SSLContext
        SSLSocketFactory factory = sslContext.getSocketFactory();
        try (SSLSocket socket = (SSLSocket) factory.createSocket("localhost", 8443)) {
            socket.startHandshake();
            System.out.println("连接成功，协议: " + socket.getSession().getProtocol());
        }
    }
}
```

## 面试追问方向

- 数字证书包含哪些内容？
- 什么是 CA？为什么需要 CA？
- 什么是证书链？如何验证？
- DV、OV、EV 证书有什么区别？
- 什么是证书吊销？如何检查？
- CRL 和 OCSP 有什么区别？
- 什么是 OCSP Stapling？
- 什么是证书透明（CT）？
- 自签名证书有什么问题？什么时候用？
- 如何在 Java 中读取和验证证书？
