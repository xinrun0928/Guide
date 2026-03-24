# WAF：Web 应用的守护者

你的网站被扫描器发现了 SQL 注入漏洞。

还没等你修复，攻击者就利用这个漏洞窃取了数据库中的用户数据。

如果你的服务器前面有一道防线，在恶意请求到达应用之前就拦截掉，损失就不会发生。

这道防线就是 **WAF（Web Application Firewall，Web 应用防火墙）**。

## WAF 是什么

WAF 是一种位于 Web 应用和互联网之间的安全设备，通过分析 HTTP/HTTPS 流量来检测和阻止恶意请求。

```
┌─────────────────────────────────────────────────────────────┐
│                    WAF 工作原理                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户请求                                                    │
│      ↓                                                      │
│  ┌─────────────────┐                                        │
│  │     WAF        │ ←─── 检测规则                            │
│  │  拦截恶意请求   │ ←─── 签名匹配                            │
│  │  放行正常请求   │ ←─── 行为分析                            │
│  └─────────────────┘                                        │
│      ↓    ↓                                                  │
│   放行    拦截                                                │
│      ↓                                                      │
│  应用服务器                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## WAF vs 传统防火墙

| | WAF | 传统防火墙 |
|--|-----|-----------|
| 工作层 | 应用层（L7） | 网络层（L3/L4） |
| 检测内容 | HTTP 请求内容、参数、Cookie | IP、端口、协议 |
| 防护对象 | Web 应用漏洞 | 网络层攻击 |
| 例子 | SQL 注入、XSS、CSRF | SYN Flood、端口扫描 |

## WAF 的检测方式

### 1. 签名检测

基于已知攻击模式的特征库：

```
SQL 注入签名：
' OR '1'='1
' UNION SELECT
' OR 1=1--
admin'--
EXEC(@)

XSS 签名：
<script>
javascript:
onerror=
onload=

命令注入签名：
; cat /etc/passwd
| whoami
`whoami`
```

### 2. 规则匹配

基于语法的检测规则：

```yaml
# ModSecurity 规则示例
SecRule ARGS "@rx (\b(union|select|insert|update|delete)\b.*){4,}"
    "id:1001,deny,status:403,msg:'SQL Injection Detected'"

SecRule REQUEST_HEADERS|ARGS "@rx <script[^>]*>"
    "id:1002,deny,status:403,msg:'XSS Detected'"
```

### 3. 行为分析

基于正常行为基线的异常检测：

```
正常用户行为：
- 访问频率：平均 10 次/分钟
- 请求参数：通常 1-5 个
- 访问路径：符合业务逻辑

异常行为：
- 访问频率：突然 1000 次/分钟
- 请求参数：大量特殊字符
- 访问路径：扫描探测
```

## 主流 WAF 产品

### 开源 WAF

| 产品 | 特点 | 部署方式 |
|------|------|---------|
| ModSecurity | 最流行，Apache/Nginx 模块 | 反向代理/嵌入 |
| Coraza | ModSecurity 兼容，Go 实现 | 反向代理 |
| HAProxy WAF | 集成在负载均衡器中 | 反向代理 |

### 云 WAF

| 产品 | 提供商 | 特点 |
|------|-------|------|
| Cloudflare WAF | Cloudflare | 全球 CDN + WAF |
| AWS WAF | AWS | 与 CloudFront 集成 |
| 阿里云 WAF | 阿里云 | 中文规则，DDoS 防护 |
| 腾讯云 WAF | 腾讯云 | BOT 防护 |

### 商业 WAF

| 产品 | 厂商 | 特点 |
|------|------|------|
| Imperva | Imperva | 企业级，机器学习 |
| F5 ASM | F5 | 与 BIG-IP 集成 |
| FortiWeb | Fortinet | 综合安全 |

## ModSecurity 实战

ModSecurity 是最广泛使用的开源 WAF。

### 安装配置

```nginx
# Nginx + ModSecurity 配置

# 安装
# apt install libmodsecurity-dev modsecurity-crs nginx

# nginx.conf
load_module modules/ngx_http_modsecurity_module.so;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/modsecurity/modsecurity.conf;
    include /etc/nginx/modsecurity/crs/crs-setup.conf;
    include /etc/nginx/modsecurity/crs/rules/*.conf;
}
```

### 核心规则

```apache
# modsecurity.conf

# 启用规则引擎
SecRuleEngine On

# 日志配置
SecDebugLog /var/log/modsecurity/debug.log
SecDebugLogLevel 0
SecAuditEngine RelevantOnly
SecAuditLogRelevantStatus "^(?:5|4(?!04))"
SecAuditLogParts ABIJDEFHZ
SecAuditLog /var/log/modsecurity/audit.log

# 请求限制
SecRequestBodyLimit 13107200
SecRequestBodyNoFilesLimit 131072
SecRequestBodyLimitAction Reject

# 响应过滤
SecResponseBodyLimit 524288
SecResponseBodyMimeType text/plain text/html text/xml
SecResponseBodyAccess On
```

### OWASP Core Rule Set（CRS）

OWASP CRS 是通用的 WAF 规则集：

```apache
# crs-setup.conf - 基础配置

# 异常分数模式（推荐）
SecAction \
    "id:900990,\
    phase:1,\
    pass,\
    t:none,\
    setvar:tx.critical_anomaly_score=5,\
    setvar:tx.error_anomaly_score=4,\
    setvar:tx.warning_anomaly_score=3,\
    setvar:tx.notice_anomaly_score=2"

# 排除误报的路径
SecRule REQUEST_URI "@beginsWith /api/health" \
    "id:900300,\
    phase:1,\
    pass,\
    nolog,\
    ctl:ruleEngine=Off"
```

### SQL 注入防护规则

```apache
# SQL 注入检测规则
SecRule REQUEST_COOKIES|REQUEST_HEADERS|ARGS \
    "@rx (?i)(\bunion\b.*\bselect\b|\bunion\b.*\ball\b|\bselect\b.*\bfrom\b|\binsert\b.*\binto\b|\bdelete\b.*\bfrom\b|\bdrop\b.*\btable\b|\bupdate\b.*\bset\b|\bexec\b|\bexecute\b)" \
    "id:942100,\
    phase:2,\
    deny,\
    status:403,\
    msg:'SQL Injection Attack Detected',\
    logdata:'Matched Data: %{MATCHED_VAR} found within %{MATCHED_VAR_NAME}',\
    severity:CRITICAL"

# 检测 OR 注入
SecRule ARGS "@rx (?i)\bor\b.*(?:\d|')" \
    "id:942200,\
    phase:2,\
    deny,\
    status:403,\
    msg:'SQL Injection OR Attack'"
```

### XSS 防护规则

```apache
# XSS 检测规则
SecRule REQUEST_COOKIES|REQUEST_HEADERS|ARGS \
    "@rx (?i)<script[^>]*>|</script>|<[^>]*onerror[^>]*>|<[^>]*onload[^>]*>|<javascript:|onerror\s*=|onload\s*=" \
    "id:941100,\
    phase:2,\
    deny,\
    status:403,\
    msg:'XSS Attack Detected',\
    severity:CRITICAL"
```

## WAF 绕过技术

攻击者会尝试绕过 WAF：

### 1. 大小写混合

```
WAF: 检测 UNION SELECT
Bypass: UniOn SeLeCt
```

```apache
# 规则应使用正则表达式 i 标志
SecRule ARGS "@rx (?i)union\s+select"
```

### 2. 注释混淆

```
WAF: 检测 ' OR '
Bypass: '/**/OR/**/'
```

```apache
# 移除注释后再检测
SecRule REQUEST_ARGS "@rx \bor\b" \
    "id:1001,\
    phase:2,\
    t:none,\
    t:removeComments"
```

### 3. 编码绕过

```
URL 编码：
' -> %27
< -> %3C

双重 URL 编码：
' -> %2527

Unicode 编码：
' -> \u0027
```

### 4. SQL 变量替换

```
WAF: 检测 ' OR '
Bypass: ' || '
```

## WAF 的局限

```
┌─────────────────────────────────────────────────────────────┐
│                    WAF 的局限性                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 不能修复代码漏洞                                         │
│     WAF 只是拦截，不是修复                                   │
│                                                             │
│  2. 可能被绕过                                               │
│     高级攻击者会寻找 WAF 规则的盲区                           │
│                                                             │
│  3. 误报问题                                                 │
│     严格规则会拦截正常请求                                    │
│                                                             │
│  4. 性能开销                                                 │
│     每请求都需检测                                           │
│                                                             │
│  5. 应用层逻辑漏洞                                           │
│     IDOR、业务逻辑漏洞 WAF 无法检测                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## WAF + 代码安全 = 纵深防御

```java
// WAF 是第一道防线，代码安全是最后一道防线

// 1. WAF 拦截明显的攻击
//    ?id=' OR '1'='1  → 403 Forbidden

// 2. 输入验证第二道防线
public User findById(Long id) {
    if (id == null || id <= 0) {
        throw new ValidationException("无效的 ID");
    }
    return userRepository.findById(id).orElse(null);
}

// 3. 参数化查询最终防线
@Query("SELECT u FROM User u WHERE u.id = :id")
Optional<User> findById(@Param("id") Long id);
```

## 面试追问方向

1. **WAF 和防火墙的区别？** —— WAF 工作在应用层，检测 HTTP 内容；防火墙工作在网络层，检测 IP/端口
2. **WAF 能完全防止 SQL 注入吗？** —— 不能，WAF 可被绕过；代码层的参数化查询才是根本
3. **WAF 误报怎么处理？** —— 调整规则、使用白名单模式、排除特定路径
4. **云 WAF 和自建 WAF 的选择？** —— 云 WAF 部署简单、更新快；自建 WAF 可定制、适合敏感数据
5. **Bypass WAF 的常见手法？** —— 大小写混合、注释混淆、编码绕过、协议变异

> "WAF 是 Web 安全的左移防线，但不是银弹。代码安全才是根本，WAF 是额外的保护层。"
