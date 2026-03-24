# ARP 欺骗：局域网中的隐形陷阱

你在公司局域网中，访问银行网站，一切正常。

但公司网络管理员可以监视你所有的网络流量。

这不是因为他在你的电脑上装了监控软件，而是因为**ARP 协议的天生缺陷**。

**ARP 欺骗（ARP Spoofing）**，是局域网中最经典的内网攻击方式。

## ARP 协议基础

### 什么是 ARP

ARP（Address Resolution Protocol，地址解析协议）用于将 IP 地址转换为 MAC 地址：

```
IP 地址：网络中用于路由寻址（你家的门牌号）
MAC 地址：网卡物理地址（你家的钢筋水泥）

当你要访问同一局域网内的 192.168.1.100 时：
- 需要知道它的 MAC 地址才能发送数据帧
- ARP 就是用来查询 IP 对应的 MAC 地址的协议
```

### ARP 工作流程

```
正常 ARP 解析：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  主机 A（想知道 192.168.1.100 的 MAC）                      │
│      │                                                      │
│      │ ARP Request（广播）：                                │
│      │ 「谁是 192.168.1.100？告诉我 192.168.1.1」          │
│      ▼                                                      │
│  广播到局域网所有主机                                         │
│      │                                                      │
│      ▼                                                      │
│  主机 B（192.168.1.100）回复：                               │
│      │ ARP Reply：                                         │
│      │ 「192.168.1.100 的 MAC 是 AA:BB:CC:DD:EE:FF」      │
│      │                                                      │
│  主机 A 缓存结果                                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ARP 表

每台主机都维护一个 ARP 缓存表：

```bash
# Windows 查看 ARP 表
arp -a

# Linux 查看 ARP 表
ip neigh show

# 示例输出：
# ? (192.168.1.1) at 00:11:22:33:44:55 [ether] on eth0
# ? (192.168.1.100) at aa:bb:cc:dd:ee:ff [ether] on eth0
```

## ARP 欺骗的原理

### 攻击原理

ARP 协议**不验证响应**！主机收到 ARP Reply 后，会无条件更新缓存：

```
攻击流程：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  攻击者（MAC: XX:XX:XX:XX:XX:XX）                          │
│      │                                                      │
│      │ ARP Reply（广播）：                                  │
│      │ 「网关 192.168.1.1 的 MAC 是 XX:XX:XX:XX:XX:XX」  │
│      │ （真实 MAC 是 AA:BB:CC:DD:EE:FF）                   │
│      ▼                                                      │
│  广播到局域网所有主机                                         │
│      │                                                      │
│      ▼                                                      │
│  所有主机的 ARP 表被更新：                                    │
│  192.168.1.1 → XX:XX:XX:XX:XX:XX（攻击者 MAC）            │
│                                                             │
│  结果：所有流量先到攻击者，再转发到网关                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 中间人攻击（MITM）

```
正常通信：
用户 → 网关

被 ARP 欺骗后：
用户 → 攻击者 → 网关
     ↑
     攻击者可以：
     - 窃听所有流量
     - 篡改数据
     - 注入恶意内容
```

## ARP 欺骗的工具

### arpspoof（Linux）

```bash
# 欺骗目标：告诉 victim 说网关 MAC 是攻击者的 MAC
arpspoof -i eth0 -t 192.168.1.100 192.168.1.1

# 同时欺骗网关：告诉网关说 victim MAC 也是攻击者的 MAC
arpspoof -i eth0 -t 192.168.1.1 192.168.1.100

# 开启 IP 转发（使流量通过）
echo 1 > /proc/sys/net/ipv4/ip_forward
```

### Ettercap

```bash
# 图形界面
ettercap -G

# 命令行
ettercap -T -Q -M arp:remote /192.168.1.1-254//
```

### driftnet（流量嗅探）

```bash
# 捕获图片
driftnet -i eth0

# 捕获指定类型
driftnet -i eth0 -a -d /tmp/captured/
```

## Java 检测 ARP 欺骗

```java
import java.io.*;
import java.util.*;
import java.util.regex.*;

public class ARPDetector {
    
    private static final Pattern ARP_PATTERN = Pattern.compile(
        "(\\S+)\\s+.*?at\\s+([0-9a-fA-F:]+)"
    );
    
    /**
     * 扫描 ARP 表，检测异常
     */
    public List<ARPAlert> detectARPSpoofing() {
        List<ARPAlert> alerts = new ArrayList<>();
        
        // 1. 获取当前 ARP 表
        Map<String, String> arpTable = getARPTable();
        
        // 2. 获取网关信息
        String gatewayIP = getGatewayIP();
        String expectedGatewayMAC = getGatewayMAC();
        
        // 3. 检测 ARP 表异常
        for (Map.Entry<String, String> entry : arpTable.entrySet()) {
            String ip = entry.getKey();
            String mac = entry.getValue();
            
            // 如果是网关 IP，但 MAC 不匹配
            if (ip.equals(gatewayIP) && !mac.equalsIgnoreCase(expectedGatewayMAC)) {
                alerts.add(new ARPAlert(
                    AlertType.ARP_SPOOFING,
                    ip,
                    expectedGatewayMAC,
                    mac,
                    "检测到可能的 ARP 欺骗攻击"
                ));
            }
            
            // 检测重复 MAC（可能有多个 IP 被欺骗到同一 MAC）
            long count = arpTable.values().stream()
                .filter(m -> m.equalsIgnoreCase(mac))
                .count();
            
            if (count > 1) {
                alerts.add(new ARPAlert(
                    AlertType.DUPLICATE_MAC,
                    ip,
                    null,
                    mac,
                    "同一 MAC 地址对应多个 IP，可能存在 ARP 欺骗"
                ));
            }
        }
        
        // 4. 检测频繁变化的 ARP 条目
        detectArpFlux(alerts);
        
        return alerts;
    }
    
    /**
     * 获取 ARP 表
     */
    private Map<String, String> getARPTable() {
        Map<String, String> arpTable = new HashMap<>();
        
        try {
            Process process = Runtime.getRuntime().exec("arp -a");
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );
            
            String line;
            while ((line = reader.readLine()) != null) {
                Matcher matcher = ARP_PATTERN.matcher(line);
                if (matcher.find()) {
                    String ip = matcher.group(1);
                    String mac = matcher.group(2);
                    arpTable.put(ip, mac);
                }
            }
        } catch (IOException e) {
            // 处理异常
        }
        
        return arpTable;
    }
    
    /**
     * 检测 ARP flux（频繁变化的 ARP 条目）
     */
    private void detectArpFlux(List<ARPAlert> alerts) {
        // 记录历史 ARP 变化
        // 如果某个 IP 的 MAC 在短时间内多次变化，说明可能存在攻击
    }
    
    /**
     * 防御：静态 ARP 绑定
     */
    public void addStaticARP(String ip, String mac) {
        try {
            // Linux
            Runtime.getRuntime().exec("arp -s " + ip + " " + mac);
            
            // Windows
            // Runtime.getRuntime().exec("arp -s " + ip + " " + mac);
        } catch (IOException e) {
            // 处理异常
        }
    }
    
    public enum AlertType {
        ARP_SPOOFING,
        DUPLICATE_MAC,
        ARP_FLUX
    }
    
    public record ARPAlert(
        AlertType type,
        String ip,
        String expectedMAC,
        String actualMAC,
        String message
    ) {}
}
```

## ARP 欺骗的防御

### 1. 静态 ARP 绑定

```bash
# Linux 静态绑定
# /etc/ethers 或手动添加
arp -s 192.168.1.1 00:11:22:33:44:55

# Windows 静态绑定
arp -s 192.168.1.1 00-11-22-33-44-55

# 自动脚本
#!/bin/bash
GATEWAY_IP="192.168.1.1"
GATEWAY_MAC="00:11:22:33:44:55"
arp -s $GATEWAY_IP $GATEWAY_MAC
chmod +x /etc/init.d/arp-static
update-rc.d arp-static defaults
```

### 2. 启用交换机的 ARP 检测

```
企业级交换机配置：
1. Dynamic ARP Inspection (DAI)
   - 检查 ARP Reply 的 MAC-IP 对应关系
   - 与 DHCP Snooping 绑定表对比
   - 不匹配则丢弃

2. DHCP Snooping
   - 记录可信端口的 DHCP 分配
   - 生成 IP-MAC-VLAN 绑定表

3. Port Security
   - 限制每个端口的 MAC 地址数量
   - 违规时关闭端口
```

```bash
# Cisco 交换机配置
# 启用 DHCP Snooping
ip dhcp snooping vlan 10
ip dhcp snooping

# 启用 DAI
ip arp inspection vlan 10
interface GigabitEthernet0/1
    ip dhcp snooping trust
    ip arp inspection trust
```

### 3. 使用 VLAN 隔离

```
合理划分子网：
VLAN 10：办公区
VLAN 20：服务器区
VLAN 30：访客区

限制 VLAN 间路由，加强监控
```

### 4. IDS/IPS 检测

```bash
# Snort 规则检测 ARP 欺骗
# 检测同一个 MAC 对应多个 IP 的 ARP Reply
alert arp any any -> any any (msg:"ARP Spoofing Detection"; 
    content:"<spoofed_ip>"; 
    sid:1000001; rev:1;)

# 检测 ARP 请求频率异常
alert arp any any -> any any (msg:"ARP Flooding"; 
    threshold:type threshold, track by_src, count 50, seconds 1; 
    sid:1000002; rev:1;)
```

## 面试追问方向

1. **ARP 欺骗为什么能成功？** —— ARP 协议不验证响应，无条件更新缓存
2. **ARP 和 DNS 欺骗的区别？** —— ARP 欺骗局域网内的 MAC-IP 映射，DNS 欺骗修改域名解析结果
3. **如何检测 ARP 欺骗？** —— 监控 ARP 表变化、检测重复 MAC、使用 IDS
4. **为什么企业网络需要防范 ARP 欺骗？** —— 内网攻击比外网攻击更容易绕过防火墙
5. **静态 ARP 绑定的局限性？** —— 维护成本高，无法自动适应网络变化

> "ARP 欺骗利用了协议的信任机制。在网络安全中，永远不要假设网络是可信的。"
