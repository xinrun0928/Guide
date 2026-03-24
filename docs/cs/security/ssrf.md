# SSRF：服务器端请求伪造

你的图片上传功能需要用户输入图片 URL。

正常流程：用户输入 `https://example.com/avatar.jpg`，服务器下载图片。

攻击者输入：`http://169.254.169.254/latest/meta-data/`（AWS 元数据服务）

服务器向这个内部地址发起了请求，返回了 AWS 访问密钥。

这就是 **SSRF（Server-Side Request Forgery，服务器端请求伪造）**——服务器被攻击者操控去访问本不该访问的地址。

## SSRF 的原理

SSRF 和 CSRF 有点类似，但关键区别在于：

```
CSRF：攻击者在用户浏览器中伪造请求
     用户浏览器 → 银行服务器（带着用户 Cookie）

SSRF：攻击者让服务器代替自己去访问目标
     攻击者 → 服务器 → 内部服务/敏感资源
```

攻击者利用服务器的信任关系，绕过防火墙，访问本不应该暴露的内部资源。

## SSRF 的攻击场景

### 1. 访问云服务元数据

```java
// 漏洞代码：用户输入 URL，服务器请求
@RestController
public class ImageController {
    
    @PostMapping("/upload-from-url")
    public Result uploadFromUrl(@RequestParam String imageUrl) {
        try {
            // 服务器请求用户提供的 URL
            RestTemplate rest = new RestTemplate();
            ResponseEntity<byte[]> response = rest.getForEntity(imageUrl, byte[].class);
            
            // 保存图片
            String fileName = saveImage(response.getBody());
            return Result.success(fileName);
        } catch (Exception e) {
            return Result.error("图片获取失败");
        }
    }
}
```

```
攻击者输入：
http://169.254.169.254/latest/meta-data/iam/security-credentials/

AWS EC2 元数据服务返回：
{
    "AccessKeyId": "ASIA...",
    "SecretAccessKey": "..."
}

攻击者获取了 AWS 访问密钥！
```

### 2. 扫描内网端口

```
攻击者无法直接访问企业内部网络，但可以通过服务器：

http://internal-crm.company.local/admin
http://192.168.1.100:22  （探测 SSH）
http://192.168.1.100:3306 （探测 MySQL）
http://localhost:6379      （探测 Redis）
```

### 3. 读取本地文件

```
file:// 协议（部分实现支持）：
file:///etc/passwd
file:///C:/Windows/System32/drivers/etc/hosts

gopher:// 协议（Redis 等）：
gopher://127.0.0.1:6379/_SET%20key%20value
```

### 4. 攻击内部服务

```java
// 内网服务请求
String url = "http://192.168.1.100:8080/admin/delete?id=1";
// 通过服务器攻击内网管理接口
```

## SSRF 的危害

```
┌─────────────────────────────────────────────────────────────┐
│                    SSRF 能做什么                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 云服务密钥窃取                                           │
│     AWS、GCP、Azure 元数据服务                                │
│                                                             │
│  2. 内网探测                                                 │
│     扫描端口、服务、拓扑结构                                  │
│                                                             │
│  3. 读取敏感文件                                             │
│     file:// 读取配置文件、密钥                                │
│                                                             │
│  4. 攻击内部服务                                             │
│     Redis 未授权访问、MySQL、SMTP                            │
│                                                             │
│  5. 绕过防火墙                                              │
│     从可信服务器发起攻击                                      │
│                                                             │
│  6. DoS 攻击                                                │
│     让服务器请求大量资源                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## SSRF 防御

### 1. URL 验证

```java
@Service
public class SafeUrlValidator {
    
    private static final Set<String> ALLOWED_SCHEMES = Set.of("http", "https");
    private static final Set<String> BLOCKED_HOSTS = Set.of(
        "169.254.169.254",  // AWS 元数据
        "metadata.google.internal",  // GCP 元数据
        "100.100.100.200",  // 阿里云元数据
        "localhost",
        "127.0.0.1",
        "0.0.0.0"
    );
    
    /**
     * 验证 URL 是否安全
     */
    public ValidationResult validate(String urlString) {
        try {
            URL url = new URL(urlString);
            
            // 1. 检查协议
            String protocol = url.getProtocol().toLowerCase();
            if (!ALLOWED_SCHEMES.contains(protocol)) {
                return ValidationResult.invalid("只允许 HTTP/HTTPS");
            }
            
            // 2. 检查主机
            String host = url.getHost().toLowerCase();
            if (isBlockedHost(host)) {
                return ValidationResult.invalid("不允许访问此地址");
            }
            
            // 3. 解析 IP 并检查私有地址
            InetAddress address = InetAddress.getByName(host);
            if (isPrivateIp(address)) {
                return ValidationResult.invalid("不允许访问内网地址");
            }
            
            // 4. DNS Rebinding 防护：延迟解析
            // 第一次解析返回合法 IP，建立连接时再次解析
            Thread.sleep(100);  // 延迟解析
            
            return ValidationResult.valid();
            
        } catch (MalformedURLException e) {
            return ValidationResult.invalid("无效的 URL");
        } catch (UnknownHostException e) {
            return ValidationResult.invalid("无法解析的域名");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return ValidationResult.invalid("请求超时");
        }
    }
    
    private boolean isBlockedHost(String host) {
        // 检查精确匹配
        if (BLOCKED_HOSTS.contains(host)) {
            return true;
        }
        
        // 检查域名后缀（防止绕过）
        for (String blocked : BLOCKED_HOSTS) {
            if (host.endsWith(blocked)) {
                return true;
            }
        }
        
        return false;
    }
    
    private boolean isPrivateIp(InetAddress address) {
        // 检查私有 IP 范围
        // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
        return address.isSiteLocalAddress() 
            || address.isLoopbackAddress()
            || address.isLinkLocalAddress();
    }
}
```

### 2. 使用 SafeHttpClient

```java
@Configuration
public class HttpClientConfig {
    
    @Bean
    public CloseableHttpClient safeHttpClient() throws Exception {
        // 创建受限的 HTTP 客户端
        RequestConfig config = RequestConfig.custom()
            .setConnectTimeout(5000)  // 连接超时
            .setSocketTimeout(5000)    // 读取超时
            .setMaxRedirects(0)        // 禁止重定向（防止绕过）
            .build();
        
        return HttpClients.custom()
            .setDefaultRequestConfig(config)
            .setSSLContext(createRestrictedSSL())  // HTTPS 验证
            .build();
    }
    
    private SSLContext createRestrictedSSL() throws NoSuchAlgorithmException {
        // 严格的 SSL 配置
        SSLContext sslContext = SSLContexts.custom()
            .loadTrustMaterial(new TrustStrategy() {
                @Override
                public boolean isTrusted(X509Certificate[] chain, String authType) 
                        throws CertificateException {
                    // 验证证书链
                    return true;
                }
            })
            .build();
        return sslContext;
    }
}
```

### 3. URL 白名单

```java
@Service
public class ImageUploadService {
    
    @Autowired
    private SafeUrlValidator urlValidator;
    
    private static final Set<String> ALLOWED_IMAGE_DOMAINS = Set.of(
        "cdn.example.com",
        "static.example.com"
    );
    
    public String uploadFromUrl(String imageUrl) {
        // 验证 URL
        ValidationResult result = urlValidator.validate(imageUrl);
        if (!result.isValid()) {
            throw new SecurityException("URL 不安全: " + result.getMessage());
        }
        
        URL url = new URL(imageUrl);
        
        // 白名单域名验证
        if (!ALLOWED_IMAGE_DOMAINS.contains(url.getHost())) {
            throw new SecurityException("只允许从指定域名上传图片");
        }
        
        // 下载并处理
        return downloadAndSave(imageUrl);
    }
}
```

### 4. 禁用危险协议

```java
@Configuration
public class RestTemplateConfig {
    
    @Bean
    public RestTemplate restTemplate() {
        RestTemplate template = new RestTemplate();
        
        // 禁用不需要的协议
        List<ClientHttpRequestFactory> factories = new ArrayList<>();
        
        // 只保留 HTTP/HTTPS
        factories.add(new SimpleClientHttpRequestFactory());
        
        return template;
    }
}
```

## 云服务元数据防护

```java
/**
 * AWS EC2 元数据访问防护
 */
@Configuration
public class AwsMetadataProtection {
    
    @PostConstruct
    public void disableMetadataEndpoint() {
        // 如果应用运行在 EC2，设置 EC2_METADATA_DISABLED
        // 或使用 IAM Role 最小权限
    }
    
    // 使用带限制的 HTTP 客户端
    @Bean
    public AWS4Signer awsSigner() {
        // 限制可访问的服务和操作
        return new AWS4Signer() {
            @Override
            protected void processRequestHeaders(HttpRequest request, 
                                                  Map<String, String> headers) {
                // 移除可能的 X-aws-ec2-metadata-token
                headers.remove("X-aws-ec2-metadata-token");
            }
        };
    }
}
```

## 检测 SSRF 漏洞

```bash
# 使用 Burp Suite Scanner 检测 SSRF
# 或手动测试：

# 1. 内网地址探测
http://localhost/admin
http://127.0.0.1:22
http://192.168.1.1

# 2. 云服务元数据
http://169.254.169.254/latest/meta-data/
http://metadata.google.internal/

# 3. 协议利用
file:///etc/passwd
gopher://127.0.0.1:6379/_INFO
dict://127.0.0.1:6379/INFO
```

## 面试追问方向

1. **SSRF 和 CSRF 的区别？** —— SSRF 让服务器发请求，CSRF 让浏览器发请求；SSRF 利用服务器信任，CSRF 利用用户信任
2. **SSRF 为什么能访问云服务元数据？** —— 元数据服务只对服务器可见（169.254.x.x），SSRF 绕过了防火墙
3. **DNS Rebinding 攻击是什么？** —— 第一次 DNS 返回合法 IP，第二次返回内网 IP；需要延迟解析或双重验证
4. **如何防护 AWS 元数据访问？** —— 使用 IMDSv2（需要 token）、限制 IAM 权限、网络隔离
5. **URL 验证有哪些注意点？** —— 协议白名单、IP 黑名单（私有地址）、DNS 解析验证、禁止重定向

> "SSRF 是云原生时代的高危漏洞。理解它的攻击面和防御手段，是保护云基础设施的关键。"
