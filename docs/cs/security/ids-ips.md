# IDS/IPS：网络威胁的侦察兵

你的网络正在被扫描。

攻击者用工具探测你的服务器，寻找开放的端口和漏洞。

如果网络中有监控设备，它会立即发现这个异常流量，并发出警报——甚至自动阻断连接。

这就是 **IDS/IPS（入侵检测/防御系统）**。

## IDS vs IPS 的区别

```
┌─────────────────────────────────────────────────────────────┐
│                    IDS vs IPS                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  IDS（Intrusion Detection System，入侵检测系统）             │
│  - 被动监控，发现威胁后告警                                  │
│  - 不阻断流量                                               │
│  - 部署：旁路监听                                           │
│                                                             │
│  ┌──────────────────────────────────────────────────┐     │
│  │   交换机 ──[镜像口]── IDS ── 监控服务器           │     │
│  └──────────────────────────────────────────────────┘     │
│                                                             │
│  IPS（Intrusion Prevention System，入侵防御系统）           │
│  - 主动阻断，发现威胁后自动拦截                              │
│  - 串联部署                                                │
│  - 存在误阻断风险                                          │
│                                                             │
│  ┌──────────────────────────────────────────────────┐     │
│  │   路由器 ──[串联]── IPS ── 服务器                 │     │
│  └──────────────────────────────────────────────────┘     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## IDS/IPS 的检测方法

### 1. 签名检测（Signature-based）

基于已知攻击模式的特征库：

```
┌─────────────────────────────────────────────────────────────┐
│                    签名检测                                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Snort 签名示例：                                           │
│                                                             │
│  alert tcp any any -> $HOME_NET 22 (                    │
│      msg:"SSH Brute Force Attempt";                       │
│      content:"SSH-2.0-";                                  │
│      nocase;                                              │
│      threshold:type threshold, track by_src, count 5, \    │
│                 seconds 60;                               │
│      sid:1000001;                                        │
│      rev:1;                                              │
│  )                                                        │
│                                                             │
│  检测逻辑：                                                │
│  - 协议：TCP                                              │
│  - 目标端口：22（SSH）                                     │
│  - 内容：包含 "SSH-2.0-"                                 │
│  - 阈值：60 秒内同一来源 5 次                              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 异常检测（Anomaly-based）

基于正常行为基线，检测偏差：

```
正常行为基线：
- 访问频率：平均 10 次/分钟
- 访问时间：工作时间
- 访问路径：符合业务逻辑
- 数据量：正常响应大小

异常行为：
- 突然 1000 次/分钟
- 凌晨 3 点访问
- 扫描所有端口
- 返回异常大的数据
```

### 3. 状态协议分析（Stateful Protocol Analysis）

验证协议是否符合 RFC 标准：

```
HTTP 协议分析：
正常请求：
GET /index.html HTTP/1.1\r\n
Host: example.com\r\n
\r\n

异常请求：
GET /../../etc/passwd HTTP/1.1\r\n
```

## 主流 IDS/IPS 系统

### 1. Snort

最流行的开源 IDS：

```bash
# 安装
sudo apt install snort

# /etc/snort/snort.conf
ipvar HOME_NET 192.168.1.0/24
ipvar EXTERNAL_NET !$HOME_NET

# 输出配置
output alert_fast: /var/log/snort/alert

# 添加自定义规则 /etc/snort/rules/local.rules
# 检测 SSH 暴力破解
alert tcp any any -> $HOME_NET 22 (msg:"SSH Brute Force"; \
    flags:S; threshold:type threshold, track by_src, count 5, seconds 60; \
    sid:1000001; rev:1;)

# 检测 SQL 注入
alert tcp $EXTERNAL_NET any -> $HOME_NET any (msg:"SQL Injection Attempt"; \
    content:"SELECT"; nocase; content:"FROM"; nocase; nocase; \
    sid:1000002; rev:1;)

# 检测 XSS
alert tcp $EXTERNAL_NET any -> $HOME_NET any (msg:"XSS Attack"; \
    content:"<script"; nocase; \
    sid:1000003; rev:1;)

# 检测可疑 ICMP
alert icmp $EXTERNAL_NET any -> $HOME_NET any (msg:"Large ICMP Packet"; \
    dsize:>1000; \
    sid:1000004; rev:1;)
```

### 2. Suricata

高性能 IDS/IPS，支持多线程：

```bash
# 安装
sudo apt install suricata

# /etc/suricata/suricata.yaml
vars:
  address-groups:
    HOME_NET: "[192.168.1.0/24]"
    EXTERNAL_NET: "!$HOME_NET"

outputs:
  - fast:
      enabled: yes
      filename: /var/log/suricata/fast.log
      append: yes

# 运行
sudo suricata -c /etc/suricata/suricata.yaml -i eth0
```

### 3. Zeek（formerly Bro）

网络分析框架，更侧重于监控和分析：

```bash
# 安装
sudo apt install bro

# /etc/bro/node.cfg
[zeek]
type=standalone
host=localhost
interface=eth0

# 常用分析脚本
# 检测恶意软件通信
@load frameworks/files/known-hashes
# 检测 SSH 暴力破解
@load policy/protocols/ssh/detect-bruteforcing
# 检测心跳
@load policy/protocols/ssl/heartbleed
```

## Java IDS 集成

```java
@Service
public class IDSIntegrationService {
    
    @Autowired
    private AlertService alertService;
    
    /**
     * 处理 Snort 告警
     */
    public void processSnortAlert(String alertLine) {
        // Snort fast.log 格式：
        // [Classification: Attempted Information Leak] [Priority: 2] {TCP} 1.2.3.4:12345 -> 5.6.7.8:22
        
        SnortAlert alert = parseSnortAlert(alertLine);
        
        if (alert != null) {
            // 1. 分类告警
            AlertSeverity severity = classifyAlert(alert);
            
            // 2. 关联分析
            List<RelatedAlert> related = findRelatedAlerts(alert);
            
            // 3. 自动响应
            if (severity == AlertSeverity.HIGH) {
                autoBlockIP(alert.getSourceIP());
            }
            
            // 4. 发送告警
            alertService.sendAlert(Alert.builder()
                .source("Snort")
                .severity(severity)
                .sourceIP(alert.getSourceIP())
                .destPort(alert.getDestPort())
                .signature(alert.getSignature())
                .message(alert.getMessage())
                .relatedAlerts(related)
                .build());
        }
    }
    
    /**
     * 自动封禁恶意 IP
     */
    private void autoBlockIP(String ip) {
        try {
            // 添加到防火墙黑名单
            Process process = Runtime.getRuntime().exec(
                "iptables -A INPUT -s " + ip + " -j DROP"
            );
            
            // 记录封禁
            BlockedIP blocked = new BlockedIP();
            blocked.setIP(ip);
            blocked.setReason("IDS auto-block");
            blocked.setBlockedAt(LocalDateTime.now());
            blocked.setExpiresAt(LocalDateTime.now().plusHours(24));
            blockedIPRepository.save(blocked);
            
            log.info("Auto-blocked IP: {}", ip);
            
        } catch (IOException e) {
            log.error("Failed to block IP: {}", ip, e);
        }
    }
}
```

## 检测常见攻击

### 1. 检测扫描

```bash
# Snort 规则检测端口扫描
alert tcp $EXTERNAL_NET any -> $HOME_NET any (msg:"Port Scan"; \
    flags:SF,12; \
    detection_filter: track by_src, count 20, seconds 10; \
    sid:1000100; rev:1;)

# 检测 SYN Flood
alert tcp any any -> $HOME_NET any (msg:"SYN Flood"; \
    flags:S; \
    detection_filter: track by_dst, count 1000, seconds 1; \
    sid:1000101; rev:1;)
```

### 2. 检测 Web 攻击

```bash
# 检测 SQL 注入特征
alert tcp $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (msg:"SQL Injection"; \
    flow:to_server,established; \
    content:"SELECT"; http_uri; nocase; \
    content:"FROM"; http_uri; nocase; \
    pcre:"/(union|select|insert|update|delete)\s+/iU"; \
    sid:1000200; rev:1;)

# 检测命令注入
alert tcp $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (msg:"Command Injection"; \
    content:"|3b|"; http_uri; content:"cat"; http_uri; nocase; \
    sid:1000201; rev:1;)

# 检测路径遍历
alert tcp $EXTERNAL_NET any -> $HOME_NET $HTTP_PORTS (msg:"Path Traversal"; \
    content:".."; http_uri; \
    sid:1000202; rev:1;)
```

### 3. 检测恶意软件

```bash
# 检测已知恶意软件通信
alert tcp any any -> $HOME_NET any (msg:"Malware C2 Communication"; \
    content:"|00 00 00|"; depth:3; \
    byte_jump:0,0,relative,little,align 2; \
    content:"|DE AD BE EF|"; \
    sid:1000300; rev:1;)
```

## SIEM 集成

IDS 通常与 SIEM（安全信息和事件管理）集成：

```java
@Service
public class SIEMIntegrationService {
    
    /**
     * 转发告警到 SIEM
     */
    public void forwardToSIEM(SecurityAlert alert) {
        // 1. 格式化告警（CEF、LEEF 等格式）
        String cefEvent = formatCEF(alert);
        
        // 2. 发送到 SIEM
        HttpClient client = HttpClient.newHttpClient();
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(siemEndpoint))
            .header("Authorization", "Bearer " + siemApiKey)
            .header("Content-Type", "text/plain")
            .POST(HttpRequest.BodyPublishers.ofString(cefEvent))
            .build();
        
        try {
            client.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (Exception e) {
            log.error("Failed to forward to SIEM", e);
        }
    }
    
    /**
     * CEF 格式转换
     */
    private String formatCEF(SecurityAlert alert) {
        return String.format(
            "CEF:0|Security|IDS|%s|%d|%s|%d|src=%s dst=%s dpt=%s",
            "1.0",
            alert.getSignatureId(),
            alert.getMessage(),
            alert.getSeverity(),
            alert.getSourceIP(),
            alert.getDestIP(),
            alert.getDestPort()
        );
    }
}
```

## 面试追问方向

1. **IDS 和 IPS 的区别？** —— IDS 只监控不阻断，IPS 串联部署可阻断
2. **签名检测和异常检测的区别？** —— 签名检测基于已知攻击，异常检测基于行为基线
3. **IDS 旁路部署的优势？** —— 不影响正常流量，IDS 故障不影响业务
4. **如何减少 IDS 误报？** —— 调优阈值、调整规则、关联分析
5. **NIDS 和 HIDS 的区别？** —— NIDS 监控网络流量，HIDS 监控主机活动

> "IDS/IPS 是网络安全的眼睛和拳头。检测是防御的基础，而准确、及时的检测是有效防御的前提。"
