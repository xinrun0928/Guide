# 计算机安全面试高频问题汇总

> 「面试时问的安全问题，80% 都来自真实的安全事件。」

安全面试不是考验你背了多少 CVE，而是考察你对安全原理的理解深度和实战经验。下面整理了高频面试问题，按主题分类，每道题都给出了参考答案要点。

## 密码学基础

### Q1：对称加密和非对称加密的区别？

| 特性 | 对称加密 | 非对称加密 |
|-----|---------|-----------|
| 密钥 | 同一密钥加密解密 | 公钥加密、私钥解密 |
| 速度 | 快（10-100 倍于非对称） | 慢 |
| 密钥数量 | n×(n-1)/2（两两不同需 n² 密钥） | n×2（每人只需一对密钥） |
| 典型算法 | AES、DES、SM4 | RSA、ECC、SM2 |
| 用途 | 数据加密 | 密钥交换、数字签名 |

**追问**：HTTPS 用的什么加密体系？

> TLS 1.2 使用 RSA 或 DH/ECDH 进行密钥交换，用 AES 等进行数据加密，是混合加密体系。

### Q2：AES 加密的原理？

AES（Advanced Encryption Standard）是目前最广泛使用的对称加密算法。

```java
// AES 关键概念
public class AesPrinciples {
    // 密钥长度：128、192、256 位
    int[] keyLengths = {128, 192, 256};
    
    // 分组长度：固定 128 位（16 字节）
    int blockSize = 128;
    
    // 加密轮数
    int[] rounds = {10, 12, 14};  // 对应 128、192、256 位密钥
    
    // 四种操作（每轮）
    void aesRounds() {
        // 1. SubBytes：字节替换（非线性）
        // 2. ShiftRows：行移位
        // 3. MixColumns：列混淆
        // 4. AddRoundKey：轮密钥加
    }
}
```

**追问**：AES 的 ECB 模式为什么不安全？

> ECB 模式下，相同的明文块产生相同的密文块，攻击者可以通过对比找出相同的明文块，从而推断出数据结构。典型攻击：加密图像时，密文仍然能看出原始图像的轮廓。

### Q3：RSA 的原理？大数分解为什么安全？

```java
// RSA 原理
public class RsaPrinciples {
    // 密钥生成
    void keyGeneration() {
        // 1. 选两个大素数 p 和 q
        // 2. 计算 n = p × q
        // 3. 计算 φ(n) = (p-1) × (q-1)
        // 4. 选公钥 e，满足 1 < e < φ(n)，且 gcd(e, φ(n)) = 1
        // 5. 计算私钥 d，满足 e × d ≡ 1 (mod φ(n))
        // 6. 公钥 (n, e)，私钥 (n, d)
    }
    
    // 加解密
    void encryptDecrypt() {
        // 加密：c = m^e mod n
        // 解密：m = c^d mod n
    }
}
```

**追问**：RSA 2048 位对应多少位 AES？

> RSA 2048 位安全性大约相当于 AES 112-128 位。通常 RSA 2048 用于短期安全，长期（10 年以上）建议 RSA 3072 或 ECC 256 位以上。

### Q4：Hash 和加密的区别？

| 特性 | Hash（哈希） | 加密 |
|-----|------------|------|
| 可逆性 | 不可逆 | 可逆（用密钥） |
| 输入长度 | 任意长度 | 有限（受密钥限制） |
| 输出长度 | 固定长度（MD5 128 位） | 与输入相关 |
| 用途 | 完整性校验、密码存储 | 机密性保护 |
| 碰撞 | 存在碰撞 | 理论上无碰撞 |

**追问**：MD5 算出来的哈希值是固定长度，但输入是无限的，这个怎么理解？

> 这就是抽屉原理（鸽巢原理）：n 个抽屉放 n+1 个苹果，至少有一个抽屉有两个苹果。MD5 输出只有 128 位，当输入超过 2^128 时，必然有碰撞。但 2^128 是个巨大的数，实际碰撞很难找到。

### Q5：数字签名的工作原理？

```java
// 数字签名过程
public class DigitalSignature {
    // 发送方
    void sign(String message, PrivateKey privateKey) {
        // 1. 对消息计算 Hash
        String hash = hash(message);
        
        // 2. 用私钥加密 Hash
        String signature = encrypt(hash, privateKey);
        
        // 3. 发送消息 + 签名
        send(message, signature);
    }
    
    // 接收方
    boolean verify(String message, String signature, PublicKey publicKey) {
        // 1. 用公钥解密签名，得到 Hash1
        String hash1 = decrypt(signature, publicKey);
        
        // 2. 对消息计算 Hash，得到 Hash2
        String hash2 = hash(message);
        
        // 3. 比较 Hash1 和 Hash2
        return hash1.equals(hash2);
    }
}
```

**追问**：数字签名解决了什么问题？

> **认证**：确认消息确实来自声称的发送者；**完整性**：消息未被篡改；**不可否认**：发送者无法否认发送过该消息。

## Web 安全

### Q6：XSS 的三种类型？

| 类型 | 原理 | 危害 | 防御 |
|-----|------|------|------|
| 反射型 | URL 参数直接拼接到页面 | 窃取 Cookie、钓鱼 | 输入过滤、输出编码 |
| 存储型 | 恶意代码存入数据库 | 持久化攻击、蠕虫传播 | 输入过滤、输出编码 |
| DOM 型 | JS 动态解析用户输入 | 绕过部分防护 | 避免危险的 DOM 操作 |

```java
// 反射型 XSS 示例
// URL: https://example.com/search?q=<script>alert(1)</script>
// 后端直接把 q 参数输出到页面，未转义

// 存储型 XSS 示例
// 用户评论存入数据库，评论内容包含 <script>
// 其他用户访问时触发

// DOM 型 XSS 示例
// JavaScript: document.write(location.search)
// URL 参数直接写入页面
```

**追问**：Cookie 的 HttpOnly 和 Secure 是什么？

> **HttpOnly**：JS 无法读取 Cookie，防止 XSS 盗取 Cookie；**Secure**：Cookie 只能通过 HTTPS 传输，防止中间人攻击。

### Q7：CSRF 的原理和防御？

```java
// CSRF 攻击原理
public class CsrfAttack {
    // 攻击条件
    void attackPrerequisites() {
        // 1. 用户已登录目标网站
        // 2. 用户访问恶意网站
        // 3. 目标网站无 CSRF 防护
    }
    
    // 攻击方式
    void attackMethod() {
        // 恶意网站包含：
        // <img src="https://bank.com/transfer?to=hacker&amount=10000">
        // 浏览器自动携带 Cookie 发送请求
    }
}

// CSRF 防御
public class CsrfDefense {
    // 1. CSRF Token
    void csrfToken() {
        // 服务端生成随机 Token，表单和 Session 各存一份
        // 提交时校验 Token 一致性
    }
    
    // 2. 双重 Cookie
    void doubleCookie() {
        // 服务端将 Cookie 复制到自定义 Header
        // 提交时校验两者是否一致
    }
    
    // 3. SameSite Cookie
    void sameSiteCookie() {
        // Cookie 增加 SameSite 属性
        // SameSite=Strict：完全不携带
        // SameSite=Lax：导航请求携带（GET）
        // SameSite=None：跨站携带（需 Secure）
    }
}
```

**追问**：CSRF 和 XSS 的区别？

> XSS 是偷用户的权限（获取 Cookie），CSRF 是让用户「帮忙」执行操作（利用用户已认证的身份）。XSS 攻击的是客户端，CSRF 攻击的是服务端。

### Q8：SQL 注入的原理和防御？

```java
// SQL 注入原理
public class SqlInjection {
    // 漏洞代码
    void vulnerable() {
        String sql = "SELECT * FROM users WHERE name='" + username + "'";
        // 用户输入：admin' OR '1'='1
        // SQL 变成：SELECT * FROM users WHERE name='admin' OR '1'='1'
    }
    
    // SQL 注入类型
    String[] injectionTypes = {
        "联合查询注入（UNION）",
        "布尔盲注",
        "时间盲注",
        "报错注入",
        "堆叠注入"
    };
}

// SQL 注入防御
public class SqlInjectionDefense {
    // 1. 参数化查询
    void parameterizedQuery() {
        // PreparedStatement 是预处理语句
        // 参数被当作数据处理，不会被执行
    }
    
    // 2. 存储过程
    void storedProcedure() {
        // 存储过程使用参数化调用
        // 但存储过程内部也可能动态拼接 SQL
    }
    
    // 3. 白名单过滤
    void whitelistFilter() {
        // 限制输入只能包含特定字符
        // 限制输入长度
    }
    
    // 4. 最小权限原则
    void leastPrivilege() {
        // 数据库账户只授予必要的权限
        // 避免应用账户有 DBA 权限
    }
}
```

**追问**：MyBatis 的 `${}` 和 `#{}` 有什么区别？

> `#{}` 使用参数化查询，安全；`${}` 直接字符串拼接，不安全。在能使用 `#{}` 的场景下，尽量使用 `#{}`。必须使用 `${}` 的场景（如动态表名），需要严格过滤输入。

### Q9：文件上传漏洞的防御？

```java
// 文件上传安全
public class FileUploadSecurity {
    // 1. 文件类型检查（多层验证）
    void fileTypeValidation() {
        // 检查扩展名（可伪造）
        String ext = getExtension(filename);
        if (!isAllowedExtension(ext)) {
            throw new SecurityException();
        }
        
        // 检查 MIME 类型（可伪造）
        String mimeType = file.getContentType();
        
        // 检查文件头（Magic Number）- 最可靠
        byte[] header = getFileHeader(file.getInputStream());
        if (!isValidImageHeader(header)) {
            throw new SecurityException();
        }
    }
    
    // 2. 文件名处理
    void filenameHandling() {
        // 禁止使用用户提供的文件名
        // 生成随机文件名
        String newFilename = UUID.randomUUID() + getExtension(originalFilename);
    }
    
    // 3. 存储位置
    void storageLocation() {
        // 上传到非 web 目录
        String uploadDir = "/var/app/uploads/";  // 非 webroot
        // 或使用对象存储（OSS、S3）
    }
    
    // 4. 权限控制
    void permissionControl() {
        // 上传目录禁止执行
        // Nginx 配置：location /uploads { alias /var/app/uploads; }
        // 或直接返回 403
    }
}
```

### Q10：SSRF 的原理和防御？

```java
// SSRF 攻击原理
public class SsrfAttack {
    // 漏洞代码
    void vulnerable(String url) {
        // 服务端请求用户提供的 URL
        String response = httpClient.get(url);
        // 用户可以指定内网地址
        // 攻击内网服务、读取本地文件
    }
    
    // 攻击场景
    String[] attackScenarios = {
        "访问内网服务：http://192.168.1.1/admin",
        "读取本地文件：file:///etc/passwd",
        "探测内网端口：dict://127.0.0.1:6379",
        "攻击内网数据库"
    };
}

// SSRF 防御
public class SsrfDefense {
    // 1. URL 白名单
    void urlWhitelist() {
        Set<String> allowedHosts = {"api.example.com"};
        if (!allowedHosts.contains(getHost(url))) {
            throw new SecurityException();
        }
    }
    
    // 2. 协议限制
    void protocolRestriction() {
        // 只允许 HTTP/HTTPS
        // 禁止 file://、dict://、gopher:// 等
    }
    
    // 3. 内网地址禁止
    void blockPrivateAddresses() {
        if (isPrivateIp(url) || isLocalhost(url)) {
            throw new SecurityException();
        }
    }
}
```

## 网络安全

### Q11：HTTPS 的工作原理？

```
HTTPS 工作流程：

1. TCP 三次握手
2. TLS 握手
   a. 客户端发送 ClientHello（支持的加密套件、随机数）
   b. 服务器发送 ServerHello（选择的加密套件、随机数）
   c. 服务器发送证书
   d. （可选）密钥交换
   e. 双方计算会话密钥
3. 加密 HTTP 通信
```

**追问**：为什么 HTTPS 还需要 CA 证书？

> 防止中间人攻击。如果客户端直接拿到服务器的公钥，攻击者可以替换成自己的公钥。CA 证书由可信的证书颁发机构签名，客户端验证证书有效性，从而确认真实拿到服务器的公钥。

**追问**：TLS 1.2 和 TLS 1.3 的区别？

> TLS 1.3 简化了握手过程，从 2-RTT 变成 1-RTT（第一次通信即可加密）；废弃了不安全的加密算法（如 3DES、RC4）；支持 0-RTT 恢复。

### Q12：对称加密和非对称加密如何结合使用？

```java
// 混合加密体系
public class HybridEncryption {
    // TLS 中的应用
    void tlsEncryption() {
        // 1. 密钥交换：使用非对称加密（RSA/DH/ECDH）
        //    客户端用服务器公钥加密会话密钥
        //    服务器用自己的私钥解密
        //    或使用 DH/ECDH 协商出会话密钥
        
        // 2. 数据传输：使用对称加密（AES）
        //    用会话密钥加密实际数据
        //    对称加密速度快，适合大量数据传输
    }
    
    // 为什么这样设计？
    void whyHybrid() {
        // 非对称加密慢，但安全（密钥交换安全）
        // 对称加密快，但密钥交换不安全
        // 两者结合：非对称加密保护对称密钥，对称加密保护数据
    }
}
```

### Q13：DNS 劫持的原理和防御？

| 类型 | 原理 | 防御 |
|-----|------|------|
| DNS 缓存投毒 | 伪造 DNS 响应，污染缓存 | DNSSEC |
| DNS 欺骗 | ARP 欺骗 + 伪造 DNS 服务器 | HTTPS（不依赖 DNS） |
| 路由劫持 | 路由层面重定向 | BGP 安全 |

**追问**：DoH 和 DoT 是什么？

> **DoT（DNS over TLS）**：DNS 查询通过 TLS 加密传输，端口 853；**DoH（DNS over HTTPS）**：DNS 查询封装在 HTTPS 请求中，端口 443。两者都防止 DNS 污染和中间人攻击。

### Q14：Cookie 和 Session 的区别？

| 特性 | Cookie | Session |
|-----|--------|--------|
| 存储位置 | 客户端（浏览器） | 服务器端 |
| 安全性 | 较低（可被篡改） | 较高 |
| 存储容量 | 单个 Cookie 4KB | 理论上无限制 |
| 性能 | 无服务器开销 | 有服务器开销 |
| 跨域 | 不支持（可设 domain） | 不支持 |

```java
// Session 工作原理
public class SessionMechanism {
    // 1. 创建 Session
    void createSession(HttpServletRequest request) {
        HttpSession session = request.getSession();
        session.setAttribute("user", currentUser);
        String sessionId = session.getId();
        // 将 sessionId 写入 Cookie
        response.addCookie(new Cookie("JSESSIONID", sessionId));
    }
    
    // 2. 验证 Session
    void validateSession(HttpServletRequest request) {
        // 1. 从 Cookie 获取 JSESSIONID
        // 2. 从服务器查找对应 Session
        // 3. 检查 Session 是否过期
        // 4. 获取 Session 中的用户信息
    }
}
```

## 系统安全

### Q15：缓冲区溢出攻击的原理？

```c
// 缓冲区溢出原理
void vulnerable_function(char *input) {
    char buffer[64];  // 分配 64 字节栈空间
    
    // 没有边界检查
    strcpy(buffer, input);  // input 超过 64 字节会覆盖其他数据
    
    // 栈结构（简化）
    // 高地址 → [返回地址][保存的EBP][buffer[63]]...[buffer[0]] ← 低地址
    //           ↑ 可以被溢出覆盖
}
```

**追问**：如何防护缓冲区溢出？

> **栈保护（Stack Canary）**：在返回地址前放置哨兵值，函数返回前检查；**DEP（Data Execution Prevention）**：栈内存标记为不可执行；**ASLR（Address Space Layout Randomization）**：随机化内存地址，攻击者不知道 shellcode 地址；**SafeSEH / SEHOP**：保护异常处理结构。

### Q16：什么是 Rootkit？

```java
// Rootkit 分类
public class RootkitTypes {
    // 用户态 Rootkit
    void userModeRootkit() {
        // 替换系统程序（ps、ls、netstat）
        // 修改动态链接库（LD_PRELOAD）
        // Hook 系统调用
    }
    
    // 内核态 Rootkit
    void kernelModeRootkit() {
        // 加载内核模块
        // 修改内核数据结构
        // 更难检测，权限更高
    }
    
    // 固件 Rootkit
    void firmwareRootkit() {
        // 感染 BIOS/UEFI
        // 感染网卡、硬盘固件
        // 极难检测和清除
    }
}
```

### Q17：什么是越权访问？

```java
// 越权访问类型
public class BrokenAccessControl {
    // 水平越权
    // 用户 A 和用户 B 是同级用户，用户 A 访问了用户 B 的数据
    void horizontalPrivilegeEscalation() {
        // URL: /order/12345
        // 用户 A 访问用户 B 的订单
        
        // 防御：检查订单归属
        if (!order.belongsTo(currentUser)) {
            throw new SecurityException();
        }
    }
    
    // 垂直越权
    // 普通用户访问了管理员才能访问的功能
    void verticalPrivilegeEscalation() {
        // URL: /admin/deleteUser?id=100
        // 普通用户直接访问管理员接口
        
        // 防御：
        // 1. 服务端校验权限
        // 2. 不要依赖前端控制
    }
}
```

## 安全运维

### Q18：渗透测试和红队演练的区别？

| 维度 | 渗透测试 | 红队演练 |
|-----|---------|---------|
| 目标 | 发现漏洞，修复问题 | 评估防御能力，提升检测率 |
| 范围 | 明确授权范围 | 可以是整个组织 |
| 时间 | 短期（1-2 周） | 长期（数周-数月） |
| 手段 | 标准攻击手法 | APT 级别，社工、物理都可以 |
| 产出 | 漏洞报告 | 红蓝对抗报告，防守方评分 |

**追问**：什么是 APT 攻击？

> APT（Advanced Persistent Threat）是高级持续性威胁，通常由国家级攻击组织发起。特征：**高级**：使用 0day 漏洞、社工等高级手法；**持续**：长期潜伏，持续渗透；**威胁**：有明确目标，窃取数据或破坏系统。

### Q19：如何防止拖库？

```java
// 拖库防护措施
public class AntiDataBreach {
    // 1. 密码加密存储
    void passwordStorage() {
        // 禁止明文存储
        // 使用 bcrypt、PBKDF2 等慢哈希
        // 加盐（Salt）防止彩虹表攻击
    }
    
    // 2. 最小权限原则
    void leastPrivilege() {
        // 应用账户不能有 DBA 权限
        // 分离数据库账户（读/写/管理）
    }
    
    // 3. 数据库安全配置
    void dbSecurity() {
        // 禁止数据库服务对外网开放
        // 限制管理接口访问
        // 启用审计日志
    }
    
    // 4. 数据加密
    void dataEncryption() {
        // 敏感字段加密存储
        // 加密备份
    }
    
    // 5. 入侵检测
    void intrusionDetection() {
        // 数据库审计
        // 异常查询告警
        // 异常时间操作告警
    }
}
```

### Q20：WAF 是如何工作的？

```java
// WAF 工作原理
public class WafWorking {
    // 部署方式
    enum DeploymentMode {
        // 直连模式：串接在网络中
        INLINE,
        
        // 旁路模式：通过代理或镜像流量检测
        PASSIVE,
        
        // 云 WAF：DNS 解析到云端，再回源
        CLOUD
    }
    
    // 检测方式
    void detection() {
        // 1. 规则匹配：正则、关键字匹配
        // 2. 语义分析：理解 SQL、JS 语义
        // 3. 机器学习：识别异常行为
        // 4. 白名单：信任的请求直接放行
    }
    
    // 防护能力
    String[] protectionCapabilities = {
        "SQL 注入检测",
        "XSS 检测",
        "CSRF 防护",
        "文件上传防护",
        "扫描器防护",
        "CC 防护"
    };
}
```

**追问**：WAF 能完全防护 Web 攻击吗？

> 不能。WAF 基于规则和模式匹配，无法防护业务逻辑漏洞、0day 漏洞、加密流量中的攻击。WAF 是纵深防御的一环，不是银弹。

## 安全意识题

### Q21：如何设计一个安全的登录系统？

```java
// 安全登录系统设计
public class SecureLoginSystem {
    // 1. 密码策略
    void passwordPolicy() {
        // 长度：至少 8 位
        // 复杂度：字母+数字+特殊字符
        // 禁止常见弱密码
        // 定期更换（可配置）
    }
    
    // 2. 认证因素
    void multiFactor() {
        // 静态密码（Something you know）
        // 动态验证码（Something you have）
        // 生物识别（Something you are）
        
        // 重要系统建议双因素认证
    }
    
    // 3. 暴力破解防护
    void bruteForceProtection() {
        // 验证码（图形验证码、滑块）
        // 登录失败次数限制
        // IP 黑名单
        // 账户锁定
    }
    
    // 4. 会话管理
    void sessionManagement() {
        // Session ID 随机生成
        // HTTPS 传输
        // HttpOnly、Secure 标志
        // 定期过期
        // 单一登录（踢掉之前的会话）
    }
    
    // 5. 日志审计
    void auditLogging() {
        // 记录所有登录尝试
        // 记录登录 IP、地理位置
        // 异常登录告警
    }
}
```

### Q22：如何应对 0day 漏洞？

```java
// 0day 应急响应
public class ZeroDayResponse {
    // 0day = 漏洞被发现但未修复的窗口期
    
    void response() {
        // 1. 确认漏洞（ POC 验证）
        // 2. 评估影响范围
        // 3. 临时防护（WAF 规则、IP 封锁）
        // 4. 监控攻击迹象
        // 5. 等待官方补丁
        // 6. 验证补丁有效性
    }
    
    // 长期措施
    void longTerm() {
        // 纵深防御（多层防护）
        // 最小权限原则
        // 入侵检测能力
        // 快速应急响应能力
    }
}
```


## 面试技巧

### 回答问题的 STAR 法则

面试时回答技术问题，推荐使用 STAR 法则：

- **S（Situation）**：场景 - 这个问题是在什么情况下遇到的？
- **T（Task）**：任务 - 你负责什么？
- **A（Action）**：行动 - 你做了什么？
- **R（Result）**：结果 - 结果如何？学到了什么？

**示例**：

> 「在我之前的工作中（Situation），我发现我们的系统经常遭受 SQL 注入攻击（Task）。我分析了所有用户输入点，引入了参数化查询，并使用 MyBatis 的 `#{}` 替代了所有 `${}`（Action）。之后一年内没有再发生 SQL 注入导致的数据泄露（Result）。」

### 展示实战经验

面试官更看重的是：

1. **真实经历**：你真正处理过的安全事件
2. **思考深度**：不仅知道怎么做，还知道为什么
3. **举一反三**：从一个漏洞想到一整类问题
4. **持续学习**：关注安全动态，学习新技术

### 诚实回答

面对不会的问题：

- 不要瞎猜，但可以说「我的理解是...，可能需要进一步验证」
- 可以说「这个点我不太熟悉，但我知道相关的概念...」
- 展示学习能力比假装全懂更有价值


> 安全是一场没有终点的马拉松。保持好奇心，持续学习，你会在这个领域走得更远。
