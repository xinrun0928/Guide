# HTTPS：安全浏览的守护者

你在地址栏输入 `https://bank.com`，按回车。

1 秒后，页面显示出来了，旁边还有一把锁。

这 1 秒里，发生了什么？

**HTTPS = HTTP + TLS**。HTTP 是应用层协议，TLS 是加密层。两者结合，才构成了安全的 Web 通信。

## HTTP 的安全问题

HTTP 是明文传输协议，问题很多：

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP 的安全缺陷                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 明文传输                                                │
│     数据在网络中明文传输，任何人都能窃听                       │
│                                                             │
│  2. 不验证身份                                              │
│     你以为访问的是 bank.com，实际可能是钓鱼网站               │
│                                                             │
│  3. 不验证完整性                                             │
│     数据可能被中间人篡改，你收到的内容不是服务器发送的         │
│                                                             │
│  4. 无状态                                                  │
│     每次请求都是独立的，无法建立会话                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## HTTPS 的完整流程

```
┌─────────────────────────────────────────────────────────────┐
│                 HTTPS 完整通信流程                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. DNS 解析                                               │
│     bank.com → 1.2.3.4                                      │
│                                                             │
│  2. TCP 连接（三次握手）                                     │
│                                                             │
│  3. TLS 握手                                               │
│     协商加密参数，验证服务器证书                              │
│                                                             │
│  4. HTTP 请求/响应                                          │
│     通过 TLS 加密的连接传输                                  │
│                                                             │
│  5. TLS 关闭                                               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### TLS 握手的细节

```java
// Java 中 HTTPS 连接的实际流程
public class HTTPSDemo {
    
    public static void main(String[] args) throws Exception {
        // 创建 HTTPS URL 连接
        URL url = new URL("https://bank.com/api/balance");
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        
        // 连接自动完成以下步骤：
        
        // 1. TCP 握手
        // 2. TLS 握手
        //    - ClientHello（客户端支持的所有 TLS 版本和密码套件）
        //    - ServerHello（服务器选择 TLS 1.3，使用 TLS_AES_256_GCM_SHA384）
        //    - 证书（服务器证书链）
        //    - ServerKeyExchange（ECDHE 公钥）
        //    - ServerHelloDone
        //    - ClientKeyExchange（客户端 ECDHE 公钥）
        //    - 双方计算共享密钥
        //    - Finished 消息（验证握手完整性）
        // 3. HTTP 请求
        
        conn.connect();
        
        // 获取响应
        int status = conn.getResponseCode();
        System.out.println("响应状态: " + status);
        
        // 验证证书
        System.out.println("证书主题: " + conn.getServerCertificate());
    }
}
```

## HTTPS 的 Java 配置

### Spring Boot HTTPS 配置

```yaml
# application.yml
server:
  ssl:
    enabled: true
    key-store: classpath:keystore.jks
    key-store-password: ${KEYSTORE_PASSWORD}
    key-store-type: JKS
    key-alias: server
    protocol: TLS
    enabled-protocols: TLSv1.3
    ciphers: TLS_AES_256_GCM_SHA384,TLS_CHACHA20_POLY1305_SHA256
```

### 生成证书

```bash
# 使用 keytool 生成自签名证书
keytool -genkeypair \
    -alias server \
    -keyalg RSA \
    -keysize 2048 \
    -keystore keystore.jks \
    -validity 365 \
    -storepass changeit \
    -keypass changeit \
    -dname "CN=localhost, OU=Dev, O=Example, L=Beijing, ST=Beijing, C=CN"

# 导出证书
keytool -exportcert \
    -alias server \
    -keystore keystore.jks \
    -file server.crt \
    -storepass changeit

# 使用 Let's Encrypt（生产环境）
# certbot --nginx -d example.com -d www.example.com
```

### HTTP 强制跳转 HTTPS

```java
@Configuration
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 强制 HTTPS
            .requiresChannel(channel -> channel
                .anyRequest().requiresSecure()
            )
            // 或使用 Tomcat 配置
            ;
        return http.build();
    }
}
```

```xml
<!-- Tomcat server.xml -->
<Connector port="8080" protocol="HTTP/1.1" 
    redirectPort="8443" />
```

## HTTPS 的性能优化

### 1. TLS 会话复用

```
第一次握手：
ClientHello（Session ID） → ServerHello → 完成握手

后续握手：
ClientHello（相同的 Session ID） → ServerHello → 复用会话密钥
```

```java
// 启用会话复用
System.setProperty("https.sessionCacheSize", "5000");
System.setProperty("https.sessionTimeout", "86400");
```

### 2. OCSP Stapling

服务器预缓存证书状态，减少客户端验证延迟：

```
无 OCSP Stapling：
客户端下载证书 → 查询 OCSP 服务器 → 验证通过

有 OCSP Stapling：
服务器在握手时直接提供 OCSP 响应 → 客户端直接验证
```

```nginx
# Nginx 配置 OCSP Stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 8.8.8.8;
ssl_trusted_certificate /path/to/ca.crt;
```

### 3. HTTP/2 和 HTTP/3

```
HTTP/1.1：
- 队头阻塞
- 并发连接

HTTP/2：
- 多路复用
- 头部压缩
- 服务器推送

HTTP/3（QUIC）：
- 基于 UDP
- 0-RTT 连接
- 更好应对网络切换
```

## 混合内容问题

HTTPS 页面加载 HTTP 资源会破坏安全性：

```html
<!-- 混合内容示例 -->
<html>
<head>
    <!-- 安全：HTTPS -->
    <link rel="stylesheet" href="https://cdn.example.com/style.css">
    
    <!-- ⚠️ 混合内容：HTTP -->
    <script src="http://example.com/script.js"></script>
    
    <!-- 安全：协议相对 URL（已废弃） -->
    <img src="//example.com/image.png">
</head>
```

现代浏览器会阻止危险的混合内容（脚本、iframe），只警告次要内容（图片、CSS）。

## 证书管理

### Let's Encrypt + Certbot

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书（Nginx）
sudo certbot --nginx -d example.com -d www.example.com

# 自动续期
sudo certbot renew --dry-run
```

### 证书监控

```java
/**
 * 证书过期监控
 */
@Service
public class CertificateMonitor {
    
    @Scheduled(fixedRate = 86400000)  // 每天检查
    public void checkCertificates() {
        List<String> domains = List.of("example.com", "api.example.com");
        
        for (String domain : domains) {
            try {
                CertificateInfo info = getCertificateInfo(domain);
                
                // 证书过期前 30 天预警
                long daysUntilExpiry = info.getDaysUntilExpiry();
                if (daysUntilExpiry < 30) {
                    sendAlert(domain, daysUntilExpiry);
                }
                
                // 证书已过期
                if (daysUntilExpiry < 0) {
                    sendCriticalAlert(domain);
                }
            } catch (Exception e) {
                sendErrorAlert(domain, e);
            }
        }
    }
    
    private CertificateInfo getCertificateInfo(String domain) throws Exception {
        URL url = new URL("https://" + domain);
        HttpsURLConnection conn = (HttpsURLConnection) url.openConnection();
        conn.connect();
        
        Certificate[] certs = conn.getServerCertificates();
        X509Certificate x509 = (X509Certificate) certs[0];
        
        return new CertificateInfo(
            domain,
            x509.getSubjectX500Principal().getName(),
            x509.getNotBefore(),
            x509.getNotAfter(),
            ChronoUnit.DAYS.between(LocalDate.now(), x509.getNotAfter().toInstant()
                .atZone(ZoneId.systemDefault()).toLocalDate())
        );
    }
}
```

## HTTPS 调试

### OpenSSL 命令

```bash
# 查看证书详情
openssl s_client -connect example.com:443 -showcerts

# 检查 TLS 版本
openssl s_client -connect example.com:443 -tls1_3

# 检查证书链
openssl s_client -connect example.com:443 -showcerts 2>/dev/null | \
    openssl x509 -noout -text

# 检查 OCSP Stapling
openssl s_client -connect example.com:443 -status

# 测试握手时间
time openssl s_client -connect example.com:443 </dev/null
```

### Java 调试

```java
// 启用 TLS 调试
System.setProperty("javax.net.debug", "ssl:handshake");

// 或启动参数
// -Djavax.net.debug=ssl:handshake
```

## 面试追问方向

1. **HTTPS 为什么安全？** —— TLS 加密传输 + 证书验证身份 + HMAC 验证完整性
2. **HTTP 和 HTTPS 的区别？** —— 端口不同（80 vs 443）、HTTPS 需要证书、有 TLS 层
3. **HTTPS 握手需要多长时间？** —— TLS 1.3 是 1-RTT，约 100-300ms
4. **证书链验证失败的原因？** —— 根 CA 不被信任、证书过期、中间 CA 缺失
5. **为什么 HTTPS 比 HTTP 慢？** —— TLS 握手延迟，但现在 TLS 1.3 已经很快，差距可忽略

> "HTTPS 是现代互联网的标准配置。理解它的工作原理，才能在性能和安全之间找到最佳平衡。"
