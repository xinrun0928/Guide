# 防火墙：网络边界的安全门

你的服务器需要对外提供服务：HTTP、HTTPS、SSH。

但服务器不应该暴露所有端口——SSH 只允许管理员访问，数据库只允许内网访问。

这就是**防火墙**的作用——在网络的边界，根据规则决定哪些流量可以通过。

## 防火墙的类型

```
┌─────────────────────────────────────────────────────────────┐
│                    防火墙类型                                │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 包过滤防火墙（Packet Filter）                            │
│     基于 IP/端口/协议过滤                                    │
│     优点：简单、快速                                        │
│     缺点：无法理解应用层协议                                 │
│                                                             │
│  2. 状态检测防火墙（Stateful Inspection）                    │
│     跟踪连接状态，只有匹配的返回包才放行                     │
│     优点：更智能，性能好                                    │
│     缺点：复杂攻击可能绕过                                   │
│                                                             │
│  3. 应用层网关（Application Layer Gateway）                  │
│     深度检测应用层协议                                       │
│     优点：应用层防护                                        │
│     缺点：性能开销大                                        │
│                                                             │
│  4. NGFW（Next-Generation Firewall）                         │
│     集成 IDS/IPS、应用识别、威胁防护                          │
│     优点：全面防护                                          │
│     缺点：成本高，配置复杂                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Linux 防火墙：iptables/nftables

### iptables 基础

```bash
# 查看当前规则
sudo iptables -L -n -v

# iptables 链
# INPUT：入站流量
# OUTPUT：出站流量
# FORWARD：转发流量

# 基本语法
iptables -A CHAIN -p PROTOCOL --dport PORT -j ACTION
# -A: 添加规则到链
# -p: 协议（tcp, udp, icmp, all）
# --dport: 目标端口
# -j: 动作（ACCEPT, DROP, REJECT, LOG）
```

### 常见配置示例

```bash
# 1. 默认策略：拒绝所有入站
sudo iptables -P INPUT DROP
sudo iptables -P FORWARD DROP
sudo iptables -P OUTPUT ACCEPT

# 2. 允许已建立连接的返回流量
sudo iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# 3. 允许本地回环
sudo iptables -A INPUT -i lo -j ACCEPT

# 4. 允许 SSH（限制来源 IP）
sudo iptables -A INPUT -p tcp --dport 22 -s 10.0.0.0/24 -j ACCEPT

# 5. 允许 HTTP/HTTPS
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# 6. 拒绝 Ping（更安全的方式）
sudo iptables -A INPUT -p icmp --icmp-type echo-request -j DROP

# 7. 限制连接速率（防 DoS）
sudo iptables -A INPUT -p tcp --dport 80 -m limit --limit 25/minute --limit-burst 100 -j ACCEPT

# 8. 记录被拒绝的连接
sudo iptables -A INPUT -m recent --set --rsource --name DROPPED
sudo iptables -A INPUT -m recent --update --seconds 60 --hitcount 11 --rsource --name DROPPED -j LOG --log-prefix "Blocked: "
sudo iptables -A INPUT -m recent --update --seconds 60 --hitcount 11 --rsource --name DROPPED -j DROP
```

### nftables：新一代 Linux 防火墙

```bash
# 安装
sudo apt install nftables

# /etc/nftables.conf

flush ruleset

table inet filter {
    chain input {
        type filter hook input priority 0; policy drop;
        
        # 本地回环
        iif lo accept
        
        # 已建立连接
        ct state established,related accept
        
        # SSH（限制来源）
        ip saddr 10.0.0.0/24 tcp dport 22 accept
        
        # HTTP/HTTPS
        tcp dport { 80, 443 } accept
        
        # Ping
        ip protocol icmp icmp type echo-request accept
        
        # 日志
        counter
    }
    
    chain forward {
        type filter hook forward priority 0; policy drop;
    }
    
    chain output {
        type filter hook output priority 0; policy accept;
    }
}

# 启用服务
sudo systemctl enable nftables
sudo nft -f /etc/nftables.conf
```

## 云防火墙

### AWS 安全组

```bash
# AWS CLI 配置安全组
# 创建安全组
aws ec2 create-security-group \
    --group-name my-security-group \
    --description "My security group" \
    --vpc-id vpc-12345678

# 添加入站规则
aws ec2 authorize-security-group-ingress \
    --group-id sg-12345678 \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0

aws ec2 authorize-security-group-ingress \
    --group-id sg-12345678 \
    --protocol tcp \
    --port 22 \
    --cidr 10.0.0.0/8

# 添加出站规则（默认全开放，可限制）
aws ec2 authorize-security-group-egress \
    --group-id sg-12345678 \
    --protocol tcp \
    --port 443 \
    --cidr 0.0.0.0/0
```

### Java 云防火墙 SDK

```java
import software.amazon.awssdk.services.ec2.*;
import software.amazon.awssdk.services.ec2.model.*;

public class AWSSecurityGroupManager {
    
    private final Ec2Client ec2;
    
    /**
     * 创建带防火墙的服务器
     */
    public String createSecureServer(String vpcId, String subnetId) {
        // 1. 创建安全组
        CreateSecurityGroupRequest sgRequest = CreateSecurityGroupRequest.builder()
            .groupName("app-security-group")
            .description("Application security group")
            .vpcId(vpcId)
            .tagSpecifications(TagSpecification.builder()
                .resourceType("security-group")
                .tags(Tag.builder().key("Name").value("app-sg").build())
                .build())
            .build();
        
        CreateSecurityGroupResponse sgResponse = ec2.createSecurityGroup(sgRequest);
        String securityGroupId = sgResponse.groupId();
        
        // 2. 添加入站规则
        addIngressRules(securityGroupId);
        
        // 3. 创建 EC2 实例
        return launchInstance(securityGroupId, subnetId);
    }
    
    private void addIngressRules(String securityGroupId) {
        // HTTPS from anywhere
        AuthorizeSecurityGroupIngressRequest rule1 = AuthorizeSecurityGroupIngressRequest.builder()
            .groupId(securityGroupId)
            .ipPermissions(IpPermission.builder()
                .ipProtocol("tcp")
                .fromPort(443)
                .toPort(443)
                .ipRanges(IpRange.builder().cidrIp("0.0.0.0/0").build())
                .build())
            .build();
        ec2.authorizeSecurityGroupIngress(rule1);
        
        // SSH from specific IP
        AuthorizeSecurityGroupIngressRequest rule2 = AuthorizeSecurityGroupIngressRequest.builder()
            .groupId(securityGroupId)
            .ipPermissions(IpPermission.builder()
                .ipProtocol("tcp")
                .fromPort(22)
                .toPort(22)
                .ipRanges(IpRange.builder().cidrIp("10.0.0.0/8").build())
                .build())
            .build();
        ec2.authorizeSecurityGroupIngress(rule2);
    }
}
```

## Web 应用防火墙（WAF）

WAF 专门防护 Web 应用，位于防火墙和服务器之间：

```
用户 → 防火墙 → WAF → 应用服务器
           │        │
           │        └── 检测 HTTP/HTTPS 流量
           │            - SQL 注入
           │            - XSS
           │            - CSRF
           │            - 协议攻击
           │
           └── 过滤其他流量
```

### 云 WAF 配置示例

```java
/**
 * 云 WAF 规则配置
 */
public class CloudWAFConfig {
    
    /**
     * 配置 AWS WAF 规则
     */
    public void configureAWSWAF() {
        // 1. 创建 Web ACL
        CreateWebACLRequest aclRequest = CreateWebACLRequest.builder()
            .name("my-web-acl")
            .metricName("myWebACLMetric")
            .defaultAction(Action.builder()
                .type("ALLOW")
                .build())
            .build();
        
        // 2. 添加规则组
        // SQL 注入规则
        // XSS 规则
        // IP 白名单/黑名单
        // 速率限制
    }
    
    /**
     * 配置阿里云 WAF
     */
    public void configureAliWAF() {
        // 1. 添加域名
        // 2. 配置防护规则
        // 3. 设置 CC 防护
        // 4. 配置精准访问控制
    }
}
```

## 防火墙规则最佳实践

### 1. 默认拒绝

```
# 默认策略：拒绝所有
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# 只放行明确需要的
```

### 2. 最小权限

```
# ❌ 错误：开放所有端口
iptables -A INPUT -p tcp -j ACCEPT

# ✅ 正确：只开放需要的端口
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT
```

### 3. 定期审计

```java
@Service
public class FirewallAuditService {
    
    /**
     * 定期审计防火墙规则
     */
    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    public void auditRules() {
        // 1. 导出当前规则
        String currentRules = getCurrentRules();
        
        // 2. 与上次规则对比
        String lastRules = getLastRules();
        
        if (!currentRules.equals(lastRules)) {
            // 3. 检测规则变更
            List<RuleChange> changes = detectChanges(lastRules, currentRules);
            
            // 4. 告警
            alertRuleChanges(changes);
            
            // 5. 记录变更
            saveRuleSnapshot(currentRules);
        }
    }
    
    /**
     * 合规检查
     */
    public ComplianceReport checkCompliance() {
        ComplianceReport report = new ComplianceReport();
        
        // 检查是否默认拒绝
        if (!isDefaultDrop()) {
            report.addFinding("Default policy should be DROP");
        }
        
        // 检查是否有未使用的开放端口
        List<Integer> openPorts = getOpenPorts();
        for (Integer port : openPorts) {
            if (!isPortAuthorized(port)) {
                report.addFinding("Port " + port + " has no justification");
            }
        }
        
        return report;
    }
}
```

## 面试追问方向

1. **包过滤和状态检测的区别？** —— 包过滤只看单个包，状态检测跟踪连接状态
2. **DROP 和 REJECT 的区别？** —— DROP 静默丢弃，REJECT 返回拒绝消息
3. **防火墙和 WAF 的区别？** —— 防火墙在网络层，WAF 在应用层；防火墙通用，WAF 专用于 Web
4. **云防火墙和安全组的区别？** —— 本质相同，云环境的不同实现；都有状态检测
5. **为什么默认策略要用 DROP 而不是 REJECT？** —— DROP 不返回响应，更安全，不泄露端口信息

> "防火墙是网络安全的第一道防线。合理的规则是安全的基础，过度开放的规则是隐患的开始。"
