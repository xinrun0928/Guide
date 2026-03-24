# DNS 安全：域名系统的攻防战

你输入 `bank.com`，按回车。

浏览器显示银行网站。

但这个 `bank.com` 真的解析到了正确的 IP 吗？

如果 DNS 被劫持，你可能访问的是一个精心伪装的钓鱼网站，而你毫无察觉。

**DNS 安全**，是互联网基础设施安全的核心。

## DNS 的工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    DNS 解析流程                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  浏览器缓存                                                 │
│      │ 没有                                                 │
│      ▼                                                      │
│  系统缓存（/etc/hosts）                                      │
│      │ 没有                                                 │
│      ▼                                                      │
│  递归DNS服务器（你的 ISP 提供）                              │
│      │                                                      │
│      ▼                                                      │
│  ┌─────────────────────────────────────────┐               │
│  │ 根 DNS（.）→ .com DNS → bank.com DNS  │               │
│  └─────────────────────────────────────────┘               │
│      │                                                      │
│      ▼                                                      │
│  返回 IP 地址：1.2.3.4                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## DNS 面临的攻击

### 1. DNS 缓存投毒（Cache Poisoning）

攻击者向递归 DNS 服务器注入错误的 DNS 记录：

```
攻击流程：
1. 攻击者向递归 DNS 服务器发送查询：attacker.com
2. 递归 DNS 向权威 DNS 服务器查询
3. 攻击者抢在权威 DNS 响应之前，伪造响应：
   attacker.com → 1.2.3.4（钓鱼 IP）
4. 递归 DNS 缓存了这个错误记录
5. 所有访问 attacker.com 的请求都被引导到钓鱼网站
```

### 2. DNS 劫持（DNS Hijacking）

直接修改 DNS 服务器的配置：

```
ISP 劫持：
- ISP 修改递归 DNS 返回的结果
- 访问不存在的域名时，返回 ISP 的广告页面
- 透明劫持：用户无感知

恶意劫持：
- 攻击者获取 DNS 服务管理权限
- 修改 DNS 记录指向恶意服务器
```

### 3. DNS 隧道（DNS Tunneling）

利用 DNS 协议传输数据，绕过防火墙：

```
正常 DNS 查询：
Query: api.example.com → Response: 93.184.216.34

DNS 隧道：
Query: cmd.exfiltrated-data.attacker.com → Response: (隐藏数据)
```

### 4. DDoS 攻击

攻击 DNS 服务器使其不可用：

```
DNS 放大攻击：
1. 攻击者发送小查询到开放 DNS 解析器
2. 查询参数包含受害者 IP
3. DNS 解析器返回大响应（约 50 倍放大）
4. 受害者被海量流量淹没
```

## DNSSEC：DNS 安全扩展

DNSSEC 通过数字签名验证 DNS 数据的真实性：

```
┌─────────────────────────────────────────────────────────────┐
│                    DNSSEC 工作原理                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  传统 DNS：                                                  │
│  DNS 服务器返回：bank.com → 1.2.3.4                         │
│  （没有验证！）                                             │
│                                                             │
│  DNSSEC：                                                    │
│  DNS 服务器返回：                                            │
│  - bank.com → 1.2.3.4                                     │
│  - RRSIG：数字签名                                          │
│  （签名可以用公钥验证）                                      │
│                                                             │
│  验证链：                                                    │
│  bank.com 签名 ← KSK 验证 ← .com 签名 ← 根域签名             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### DNSSEC 记录类型

| 记录类型 | 用途 |
|---------|------|
| RRSIG | DNS 记录的签名 |
| DNSKEY | DNSSEC 公钥 |
| DS | 委托签名（Delegation Signer） |
| NSEC/NSEC3 | 证明域名不存在 |

### Java 验证 DNSSEC

```java
import javax.naming.directory.*;
import java.util.Hashtable;

public class DNSSECValidator {
    
    /**
     * 查询 DNSSEC 记录
     */
    public void queryDNSSEC(String domain) throws Exception {
        Hashtable<String, String> env = new Hashtable<>();
        env.put("java.naming.provider.url", "dns://8.8.8.8/" + domain);
        
        DirContext ctx = new InitialDirContext(env);
        
        // 查询 A 记录
        Attributes attrs = ctx.getAttributes("", new String[]{"A"});
        
        // 查询 RRSIG（签名）
        Attributes rrsig = ctx.getAttributes("", new String[]{"RRSIG"});
        
        // 查询 DNSKEY（公钥）
        Attributes dnskey = ctx.getAttributes("", new String[]{"DNSKEY"});
        
        // 验证签名
        verifySignature(attrs, rrsig, dnskey);
    }
    
    private void verifySignature(Attributes data, Attributes rrsig, 
                                  Attributes dnskey) {
        // 1. 从 DNSKEY 获取验证公钥
        // 2. 从 RRSIG 获取签名算法和时间
        // 3. 用公钥验证数据完整性
        // 4. 检查签名是否在有效期内
    }
}
```

## DNS over HTTPS（DoH）

传统 DNS 查询是明文的，DoH 把 DNS 查询封装在 HTTPS 中：

```
传统 DNS（明文）：
Client → UDP 53 → DNS Server
           ↑
         ISP 可以看到所有查询

DNS over HTTPS（加密）：
Client → HTTPS → DNS Server（DoH 提供商）
              ↑
         ISP 只能看到访问了 DoH 提供商，不知道查了什么
```

### DoH 常用端点

| 提供商 | DoH 端点 |
|-------|---------|
| Google | https://dns.google/dns-query |
| Cloudflare | https://cloudflare-dns.com/dns-query |
| Quad9 | https://dns.quad9.net/dns-query |

### Java 使用 DoH

```java
import java.net.http.*;
import java.net.URI;

public class DoHClient {
    
    private static final String DOH_GOOGLE = "https://dns.google/dns-query";
    
    /**
     * DoH 查询
     */
    public String queryDoH(String domain) throws Exception {
        HttpClient client = HttpClient.newHttpClient();
        
        // 构建 DNS 查询请求（DNS wire format）
        byte[] query = buildDNSQuery(domain);
        
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(DOH_GOOGLE))
            .header("Content-Type", "application/dns-message")
            .POST(HttpRequest.BodyPublishers.ofByteArray(query))
            .build();
        
        HttpResponse<byte[]> response = client.send(request, 
            HttpResponse.BodyHandlers.ofByteArray());
        
        return parseDNSResponse(response.body());
    }
    
    private byte[] buildDNSQuery(String domain) {
        // DNS wire format 编码
        // ... 省略实现细节
        return new byte[0];
    }
    
    private String parseDNSResponse(byte[] response) {
        // 解析 DNS wire format 响应
        // ... 省略实现细节
        return null;
    }
}
```

## DNS over TLS（DoT）

DoT 使用 TLS 加密 DNS 查询，端口 853：

```java
import javax.net.ssl.*;
import java.io.*;
import java.net.*;

public class DoTClient {
    
    private static final String DOT_CLOUDFLARE = "1.1.1.1";
    private static final int DOT_PORT = 853;
    
    /**
     * DoT 查询
     */
    public String queryDoT(String domain) throws Exception {
        // 创建 SSL Context
        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, new TrustManager[]{new DefaultTrustManager()}, null);
        
        // 创建 SSLSocket
        SSLSocketFactory factory = sslContext.getSocketFactory();
        try (SSLSocket socket = (SSLSocket) factory.createSocket(DOT_CLOUDFLARE, DOT_PORT)) {
            socket.setEnabledProtocols(new String[]{"TLSv1.3"});
            
            InputStream in = socket.getInputStream();
            OutputStream out = socket.getOutputStream();
            
            // 发送 DNS 查询
            byte[] query = buildDNSQuery(domain);
            out.write(query);
            out.flush();
            
            // 读取响应
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            byte[] buffer = new byte[1024];
            int len;
            while ((len = in.read(buffer)) != -1) {
                baos.write(buffer, 0, len);
                if (len < 1024) break;  // DNS 响应通常不会分片
            }
            
            return parseDNSResponse(baos.toByteArray());
        }
    }
    
    private static class DefaultTrustManager implements X509TrustManager {
        @Override
        public void checkClientTrusted(X509Certificate[] chain, String authType) {}
        
        @Override
        public void checkServerTrusted(X509Certificate[] chain, String authType) {}
        
        @Override
        public X509Certificate[] getAcceptedIssuers() {
            return new X509Certificate[0];
        }
    }
}
```

## DNS 安全最佳实践

### 1. 使用安全的 DNS 服务器

```bash
# /etc/resolv.conf
# 使用可信的 DNS 服务器
nameserver 1.1.1.1      # Cloudflare
nameserver 8.8.8.8      # Google
nameserver 9.9.9.9      # Quad9
```

### 2. 启用 DNSSEC

```bash
# BIND DNS 服务器配置
options {
    dnssec-enable yes;
    dnssec-validation yes;
    dnssec-lookaside auto;
}
```

### 3. 限制 DNS 递归

```
DNS 服务器应该只响应：
- 已授权域名的查询
- 来自授权 IP 的查询

禁止开放递归服务！
```

### 4. DNS 异常监控

```java
@Service
public class DNSMonitor {
    
    @Autowired
    private AlertService alertService;
    
    /**
     * 监控 DNS 解析异常
     */
    public void monitorDNS() {
        // 监控解析时间
        // 监控返回的 IP 是否可信
        // 监控 NXDOMAIN 率
        // 监控来源 IP 分布
    }
}
```

## DNS 安全的面试追问

1. **DNS 缓存投毒的原理？** —— 攻击者伪造 DNS 响应，递归 DNS 服务器缓存了错误的记录
2. **DNSSEC 解决什么问题？** —— 验证 DNS 响应的真实性，防止 DNS 欺骗
3. **DoH 和 DoT 的区别？** —— DoH 用 HTTPS（443 端口），DoT 用 TLS（853 端口）
4. **为什么 DNS 劫持危害大？** —— DNS 是互联网的入口，一旦被劫持，所有流量都可能被导向钓鱼网站
5. **如何防止 DNS 隧道？** —— 限制 DNS 查询长度、监控异常查询模式、使用 DNS 防火墙

> "DNS 是互联网的目录服务。保护 DNS 的安全，就是保护互联网基础设施的安全。"
