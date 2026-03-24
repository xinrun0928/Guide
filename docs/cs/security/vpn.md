# VPN：虚拟专线的安全之道

你在咖啡店用公共 WiFi 访问公司内网。

公共 WiFi 不安全，黑客可以窃听你的流量。

但你发现所有流量都是加密的，访问公司内网和应用跟在办公室一样。

这就是 **VPN（Virtual Private Network，虚拟专用网络）**。

## VPN 的工作原理

```
┌─────────────────────────────────────────────────────────────┐
│                    VPN 工作原理                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  无 VPN（通过公共网络）：                                    │
│  你的电脑 ──── 公网 ──── 公司服务器                         │
│       │                   ↑                                │
│       └─────── 明文流量 ──────┘                            │
│            （被窃听风险）                                     │
│                                                             │
│  有 VPN（建立加密隧道）：                                    │
│  你的电脑 ──[加密隧道]── VPN 服务器 ─── 公司服务器          │
│       │                                                         │
│       └──── 所有流量加密 ──────┘                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## VPN 的类型

### 1. 远程访问 VPN（Remote Access VPN）

个人用户远程连接公司网络：

```
个人电脑 ──[VPN 隧道]── VPN 服务器 ── 公司内网
                          │
                          └── 使用 IPsec 或 SSL VPN
```

### 2. 站点到站点 VPN（Site-to-Site VPN）

连接两个网络：

```
总部网络 ──[VPN 隧道]── 分支网络
    │                         │
    └── 整个网络通过 VPN 通信 ──┘

常用于：
- 企业总部与分支机构
- 企业与云服务商（Cloud VPN）
```

### 3. SSL VPN

基于浏览器的 VPN，不需要客户端软件：

```
用户浏览器 ── HTTPS ── SSL VPN 网关 ── 公司内网
      │
      └── 通过 Web 门户访问内部应用
```

## 主流 VPN 协议

### IPsec

最通用的 VPN 协议，工作在网络层：

```bash
# IPsec/L2TP 配置示例（Linux）
# 安装
sudo apt install strongswan xl2tpd

# /etc/ipsec.conf
config setup
    conn %default
        ikelifetime=8h
        keylife=1h
        rekeymargin=3m
        authby=secret

conn myvpn
    authby=secret
    auto=add
    keyexchange=ikev1
    type=transport
    left=%any
    right=vpn.example.com
    leftprotoport=17/1701
    rightprotoport=17/1701
    forceencaps=yes
```

### WireGuard

新一代 VPN 协议，更简单、更安全、更快：

```bash
# 安装 WireGuard
sudo apt install wireguard

# 生成密钥对
wg genkey | tee privatekey | wg pubkey > publickey

# 服务器配置（/etc/wireguard/wg0.conf）
[Interface]
Address = 10.0.0.1/24
ListenPort = 51820
PrivateKey = <服务器私钥>
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostUp = iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
PostDown = iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

# 客户端配置
[Interface]
Address = 10.0.0.2/24
PrivateKey = <客户端私钥>
DNS = 8.8.8.8

[Peer]
PublicKey = <服务器公钥>
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0  # 路由所有流量通过 VPN
PersistentKeepalive = 25

# 启动
sudo wg-quick up wg0
sudo systemctl enable wg-quick@wg0
```

### OpenVPN

开源 SSL VPN 实现：

```bash
# 安装
sudo apt install openvpn easy-rsa

# 生成证书
make-cadir /etc/openvpn/easy-rsa
cd /etc/openvpn/easy-rsa
./easyrsa init-pki
./easyrsa build-ca
./easyrsa gen-dh
./easyrsa build-server-full server nopass
./easyrsa build-client client

# 服务器配置
cp /usr/share/doc/openvpn/examples/sample-config-files/server.conf \
    /etc/openvpn/

# 编辑 /etc/openvpn/server.conf
port 1194
proto udp
dev tun
ca ca.crt
cert server.crt
key server.key
dh dh.pem
auth SHA256
tls-crypt ta.key
server 10.8.0.0 255.255.255.0
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 8.8.8.8"
```

## Java VPN 监控

```java
@Service
public class VPNMonitor {
    
    /**
     * 检查 VPN 连接状态
     */
    public VPNConnectionStatus checkStatus() {
        // 检查 WireGuard
        try {
            Process process = Runtime.getRuntime().exec("wg show");
            String output = process.inputStreamReader().lines()
                .collect(Collectors.joining("\n"));
            
            if (output.contains("interface:")) {
                return parseWireGuardStatus(output);
            }
        } catch (IOException ignored) {}
        
        // 检查 OpenVPN
        try {
            Process process = Runtime.getRuntime().exec("systemctl status openvpn");
            // 解析状态
        } catch (IOException ignored) {}
        
        return new VPNConnectionStatus(false, null, null);
    }
    
    /**
     * 获取 VPN 统计
     */
    public VPNStats getStats(String interfaceName) {
        try {
            // 读取 /sys/class/net/<interface>/statistics/
            String path = "/sys/class/net/" + interfaceName + "/statistics/";
            
            long rxBytes = Long.parseLong(readFile(path + "rx_bytes"));
            long txBytes = Long.parseLong(readFile(path + "tx_bytes"));
            long rxPackets = Long.parseLong(readFile(path + "rx_packets"));
            long txPackets = Long.parseLong(readFile(path + "tx_packets"));
            
            return new VPNStats(rxBytes, txBytes, rxPackets, txPackets);
            
        } catch (IOException e) {
            return null;
        }
    }
    
    public record VPNConnectionStatus(
        boolean connected,
        String interfaceName,
        String clientIP
    ) {}
    
    public record VPNStats(
        long rxBytes,
        long txBytes,
        long rxPackets,
        long txPackets
    ) {}
}
```

## VPN 安全考虑

### 1. 强加密算法

```bash
# WireGuard 使用现代加密
# - Curve25519（密钥交换）
# - ChaCha20-Poly1305（加密+认证）
# - BLAKE2s（哈希）
# - SipHash24（哈希表）

# IPsec 使用强加密套件
ike=aes256gcm16-prfsha512-curve25519!
esp=aes256gcm16-prfsha512!
```

### 2. 证书认证

```bash
# 使用证书而非预共享密钥
authby=pubkey
cert server.crt
key server.key
ca ca.crt

# 验证客户端证书
remote-cert-tls client
```

### 3. 访问控制

```nginx
# VPN 网关的访问控制
# 只允许特定用户组访问特定资源

# 使用 LDAP 验证用户
plugin /usr/lib/openvpn/plugin/auth/ldap.so /etc/openvpn/auth/ldap.conf
```

### 4. 日志审计

```java
@Service
public class VPNAuditLogger {
    
    @Autowired
    private AuditLogRepository auditLogRepository;
    
    /**
     * 记录 VPN 连接事件
     */
    public void logConnection(String username, String clientIP, 
                              boolean success, String reason) {
        AuditLog log = new AuditLog();
        log.setEventType("VPN_CONNECTION");
        log.setUsername(username);
        log.setSourceIP(clientIP);
        log.setSuccess(success);
        log.setReason(reason);
        log.setTimestamp(LocalDateTime.now());
        
        auditLogRepository.save(log);
    }
    
    /**
     * 定期报告
     */
    public VPNReport generateReport(LocalDateTime start, LocalDateTime end) {
        List<AuditLog> logs = auditLogRepository
            .findByEventTypeAndTimestampBetween("VPN_CONNECTION", start, end);
        
        return new VPNReport(
            logs.stream().filter(AuditLog::isSuccess).count(),
            logs.stream().filter(l -> !l.isSuccess()).count(),
            logs.stream().map(AuditLog::getSourceIP).distinct().count(),
            logs
        );
    }
}
```

## VPN vs 零信任

| | VPN | 零信任 |
|--|-----|-------|
| 连接方式 | 全量隧道或分组隧道 | 始终验证，按需访问 |
| 信任模型 | 网络边界内默认信任 | 永不信任，始终验证 |
| 性能 | 所有流量通过 VPN | 直连就近接入 |
| 适用场景 | 远程办公 | 云原生、多云环境 |

现代安全趋势是**零信任替代 VPN**，但 VPN 仍然是重要的过渡方案。

## 面试追问方向

1. **VPN 和代理的区别？** —— VPN 加密整个设备流量，代理只代理特定应用
2. **隧道模式和传输模式的区别？** —— 隧道模式加密整个 IP 包，传输模式只加密 Payload
3. **WireGuard 为什么更快？** —— 极简代码，内核模块，现代加密算法
4. **VPN 对性能的影响？** —— 加密/解密开销，隧道延迟，额外跳数
5. **SSL VPN 和 IPsec VPN 的选择？** —— SSL VPN 更适合远程访问，IPsec 更适合站点到站点

> "VPN 是远程访问的安全方案。但在云原生时代，零信任架构正在成为新的标准。"
