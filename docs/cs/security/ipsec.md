# IPsec：网络层的安全盾牌

两家公司需要安全通信。

他们分布在不同城市，网络之间没有专线。

传统的方案是租用 VPN，但数据在公网上传输，安全性堪忧。

**IPsec** 提供了一种在 IP 层加密通信的方案，让任何 IP 通信都可以变得安全。

## IPsec 是什么

IPsec（Internet Protocol Security）是工作在网络层的 VPN 协议套件：

```
┌─────────────────────────────────────────────────────────────┐
│                    IPsec 协议栈                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  应用层（HTTP、SMTP、FTP...）                               │
│      │                                                      │
│      ▼                                                      │
│  ───────────────────────────────────────────────────────── │
│  传输层（TCP、UDP）                                         │
│      │                                                      │
│      ▼                                                      │
│  ───────────────────────────────────────────────────────── │
│  IPsec 层                                                   │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ AH（Authentication Header）     - 认证，不加密         │ │
│  │ ESP（Encapsulating Security Payload） - 加密+认证      │ │
│  └──────────────────────────────────────────────────────┘ │
│      │                                                      │
│      ▼                                                      │
│  IP 层                                                      │
│      │                                                      │
│      ▼                                                      │
│  数据链路层                                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## IPsec 的两大协议

### 1. AH（Authentication Header）

提供数据完整性和源认证：

```
┌─────────────────────────────────────────────────────────────┐
│                    AH 头部                                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────┬────────────┬────────────┬────────────────┐ │
│  │ Next Header│  Payload   │   SPI      │   Sequence     │ │
│  │ (4 字节)   │  Length    │ (4 字节)   │   Number      │ │
│  │            │ (4 字节)   │            │   (4 字节)     │ │
│  ├────────────┴────────────┴────────────┴────────────────┤ │
│  │              Authentication Data（可变）              │ │
│  │              (ICV - Integrity Check Value)             │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                             │
└─────────────────────────────────────────────────────────────┘

- 验证整个 IP 包（除可变字段）
- 不加密数据
- 不提供机密性
```

### 2. ESP（Encapsulating Security Payload）

提供加密和认证：

```
┌─────────────────────────────────────────────────────────────┐
│                    ESP 头部（传输模式）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  原始 IP 头                                                 │
│  ┌──────────┬──────────────────┬────────────────┐          │
│  │   ESP    │   ESP Payload    │   ESP          │          │
│  │   Header │   (加密)         │   Trailer      │          │
│  │ SPI + Seq│   + ESP Auth     │   + Auth Data  │          │
│  └──────────┴──────────────────┴────────────────┘          │
│                                                             │
│  ┌──────────┬──────────────────┬────────────────┐          │
│  │ 新 IP 头  │   ESP Header    │   加密数据     │          │
│  │ (可选)    │   SPI + Seq     │   ESP Trailer  │          │
│  └──────────┴──────────────────┴────────────────┘          │
│                      │                                      │
│                      ▼                                      │
│               ESP Authentication                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

- 加密 Payload
- 可选认证
- 支持传输模式和隧道模式
```

## IPsec 的两种模式

### 1. 传输模式（Transport Mode）

保留原始 IP 头，只加密 Payload：

```
传输模式：
┌────────┬──────────────────────────────┐
│ 原 IP  │  TCP/UDP  │   数据（加密）   │
└────────┴─────────────┬────────────────┘
                      │
                      ▼
┌────────┬─────────────┬────────────────┬────────────────┐
│ 原 IP  │ ESP 头      │ TCP/UDP+数据   │ ESP 尾+认证   │
└────────┴─────────────┴────────────────┴────────────────┘
        │                                        │
        └─────────────── 传输模式 ───────────────┘

适用：端到端加密（如两台服务器之间）
```

### 2. 隧道模式（Tunnel Mode）

整个原始 IP 包被加密，作为新 IP 包的 Payload：

```
隧道模式：
┌────────┬──────────────────────────────┐
│ 原 IP  │   TCP   │      数据           │
└────────┴─────────┴──────────────────────┘
                │
                ▼
┌────────┬─────────────┬────────────────┬────────────────┐
│ 新 IP  │ ESP 头      │ 原 IP + TCP    │ ESP 尾+认证   │
│ 头     │             │ + 数据（加密）  │               │
└────────┴─────────────┴────────────────┴────────────────┘
        │
        └─────────────── 隧道模式 ───────────────┘

适用：网关到网关、网关到主机（如 VPN）
```

## IKE：密钥交换

IPsec 使用 IKE（Internet Key Exchange）进行密钥协商：

### IKEv2 握手过程

```
┌─────────────────────────────────────────────────────────────┐
│                 IKEv2 握手（4 条消息）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  发起方                             响应方                  │
│                                                             │
│  │──── IKE_SA_INIT ──────────────────────────────────────▶││
│  │    Ni, SAi1, KEi        ←──────────────────────────────│││
│  │                           Nr, SAr1, KEr, 证书请求      ││
│  │◀─── IKE_SA_INIT ───────────────────────────────────────││
│  │    （协商加密算法，交换 DH 公钥）                        ││
│  │                           （双方计算 SKEYSEED）        ││
│  │                                                             │
│  │──── AUTH ──────────────────────────────────────────────▶││
│  │    认证数据, IDi         ←──────────────────────────────│││
│  │                           认证数据, IDr                  │││
│  │◀─── AUTH ───────────────────────────────────────────────││
│  │    （验证双方身份）                                      ││
│  │                                                             │
│  │──── CREATE_CHILD_SA ────────────────────────────────▶│││
│  │    SA, Ni, KEi            ←──────────────────────────────│││
│  │                           SA, Nr, KEr                   │││
│  │◀─── CREATE_CHILD_SA ──────────────────────────────────│││
│  │    （创建 CHILD_SA：IPsec SA）                          ││
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### IKEv2 的可靠性改进

| IKEv1 | IKEv2 |
|-------|-------|
| 6-9 条消息 | 4 条消息 |
| 复杂的状态机 | 简化的状态机 |
| 一个 DH 交换 | 两个并行 DH 交换 |
| NAT-T 复杂 | NAT-T 透明支持 |
| 移动性支持差 | MOBIKE 支持移动 |

## Linux IPsec 配置

### 使用 strongSwan

```bash
# 安装
sudo apt install strongswan strongswan-pki

# 配置 /etc/ipsec.conf
config setup
    charondebug="all"
    uniqueids=never

conn %default
    ikelifetime=1h
    keylife=20m
    rekeymargin=3m
    keyingtries=3
    keyexchange=ikev2
    authby=secret

conn myvpn
    left=203.0.113.10          # 本端公网 IP
    leftsubnet=10.0.0.0/24     # 本端内网
    right=198.51.100.20        # 远端公网 IP
    rightsubnet=192.168.0.0/24  # 远端内网
    auto=start
    type=tunnel
    ike=aes256-sha256-modp2048
    esp=aes256-sha256-modp2048
```

### 预共享密钥配置

```bash
# /etc/ipsec.secrets
# 本端 IP         远端 IP    : PSK "your-preshared-key-here"

203.0.113.10 198.51.100.20 : PSK "X9k3mL#p8@vQ2nF$"
```

### 证书认证配置

```bash
# 生成 CA
mkdir -p /etc/ipsec.d/{cacerts,certs,private}

# 生成 CA 证书
openssl genrsa -out /etc/ipsec.d/private/ca.key 4096
openssl req -x509 -new -nodes -key /etc/ipsec.d/private/ca.key \
    -sha256 -days 3650 -out /etc/ipsec.d/cacerts/ca.crt \
    -subj "/CN=VPN CA"

# 生成服务器证书
openssl genrsa -out /etc/ipsec.d/private/server.key 2048
openssl req -new -key /etc/ipsec.d/private/server.key \
    -out server.csr -subj "/CN=203.0.113.10"
openssl x509 -req -in server.csr -CA /etc/ipsec.d/cacerts/ca.crt \
    -CAkey /etc/ipsec.d/private/ca.key -CAcreateserial \
    -out /etc/ipsec.d/certs/server.crt -days 365 -sha256
```

### 验证 IPsec 连接

```bash
# 启动 IPsec
sudo ipsec start
sudo ipsec status

# 查看 SA（Security Association）
sudo ipsec statusall
sudo ip xfrm state

# 查看策略
sudo ip xfrm policy

# 查看详细日志
sudo ipsec up myvpn   # 建立连接
sudo ipsec down myvpn # 断开连接
```

## Java IPsec 应用

```java
/**
 * IPsec 监控服务
 */
@Service
public class IPsecMonitor {
    
    /**
     * 检查 IPsec 连接状态
     */
    public IPsecStatus checkStatus() {
        try {
            Process process = Runtime.getRuntime().exec("ipsec statusall");
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream())
            );
            
            StringBuilder output = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
            
            return parseStatus(output.toString());
            
        } catch (IOException e) {
            return new IPsecStatus(false, null, "检查失败: " + e.getMessage());
        }
    }
    
    /**
     * 获取 IPsec 统计信息
     */
    public IPsecStats getStats() {
        try {
            Process process = Runtime.getRuntime().exec("ip -s xfrm state");
            // 解析输出获取统计数据
            return parseStats(process);
        } catch (IOException e) {
            return null;
        }
    }
    
    public record IPsecStatus(
        boolean connected,
        String tunnelName,
        String message
    ) {}
    
    public record IPsecStats(
        long bytesIn,
        long bytesOut,
        long packetsIn,
        long packetsOut
    ) {}
}
```

## 面试追问方向

1. **IPsec 和 TLS 的区别？** —— IPsec 在网络层（加密 IP 包），TLS 在应用层（加密应用数据）
2. **AH 和 ESP 的区别？** —— AH 只认证不加密，ESP 加密并可选认证
3. **传输模式和隧道模式的区别？** —— 传输模式保留原始 IP 头，隧道模式整个 IP 包加密
4. **IKEv1 和 IKEv2 的区别？** —— IKEv2 更高效，消息更少，支持 MOBIKE
5. **IPsec 可以和 NAT 一起用吗？** —— 可以，但需要 NAT-T（NAT Traversal）

> "IPsec 是网络层安全的标准。理解它的工作模式和安全机制，是设计企业 VPN 的基础。"
