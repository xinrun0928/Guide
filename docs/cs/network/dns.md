# DNS 解析流程与迭代/递归查询

你输入 `www.baidu.com` 后，浏览器是怎么找到百度服务器的 IP 地址的？

答案是 **DNS（Domain Name System）**——互联网的「电话簿」。

理解 DNS 的解析流程，是理解整个互联网运作方式的关键。

## DNS 是什么？

DNS 是一个分布式数据库系统，把人类可读的域名（如 `www.baidu.com`）转换为机器可读的 IP 地址（如 `220.181.38.149`）。

```
没有 DNS：
你：我访问 www.baidu.com
浏览器：IP地址是多少？
你：不知道...

有 DNS：
你：我访问 www.baidu.com
浏览器：DNS 服务器：220.181.38.149
浏览器：谢谢，我这就去访问
```

## DNS 分布式数据库

### 层次结构

```
┌─────────────────────────────────────────────────────────────┐
│                    DNS 层次结构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         根域（.）                          │
│                            │                               │
│          ┌─────────────────┼─────────────────┐           │
│          │                 │                 │           │
│          ▼                 ▼                 ▼           │
│       .com 域           .org 域          .cn 域           │
│          │                 │                 │           │
│    ┌─────┼─────┐      ┌────┼────┐       ┌─────┼─────┐     │
│    │     │     │      │    │    │       │     │     │     │
│    ▼     ▼     ▼      ▼    ▼    ▼       ▼     ▼     ▼     │
│  baidu  google  ...   ...  ...  ...    163  baidu   ...   │
│  .com   .com            .org            .cn   .cn         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 各层 DNS 服务器

```
1. 根域名服务器（Root Server）
   - 全球 13 组，共 1000+ 台服务器
   - 管理顶级域（TLD）服务器信息
   - 例如：a.root-servers.net ~ m.root-servers.net

2. 顶级域服务器（TLD Server）
   - 管理顶级域下的二级域
   - .com、.org、.cn、.io 等
   - 例如：dnspod.com、cloudflare.com 维护 .com

3. 权威域名服务器（Authoritative Server）
   - 存储具体域名的 DNS 记录
   - 如 dns.baidu.com、ns1.google.com
   - 可以是主服务器或从服务器

4. 本地 DNS 服务器（Local/Resolver）
   - 不是 DNS 层次的一部分
   -  ISP 或企业网络提供
   - 负责缓存查询结果
```

## DNS 解析流程

### 递归查询 vs 迭代查询

```
递归查询（Resolver → 其他服务器）：
用户 → Local DNS → 根 DNS → TLD DNS → 权威 DNS
                  ← 返回结果 ←

迭代查询（Resolver 自己查）：
用户 → Local DNS（我去找）
         ↓
      根 DNS（我不知道，但告诉你去问 .com）
         ↓
      TLD DNS（我不知道，但告诉你去问 baidu.com 的服务器）
         ↓
      权威 DNS（我知道！返回结果）
```

### 完整解析流程

```
用户输入 www.baidu.com

┌─────────────────────────────────────────────────────────────┐
│                     步骤 1：检查缓存                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 浏览器 DNS 缓存                                         │
│     检查浏览器是否缓存了该域名                               │
│     Chrome: chrome://net-internals/#dns                    │
│                                                             │
│  2. 操作系统 DNS 缓存                                      │
│     检查系统是否缓存了该域名                                 │
│     Windows: ipconfig /displaydns                          │
│                                                             │
│  3. hosts 文件                                             │
│     检查 /etc/hosts（Linux）或 C:\Windows\System32\...     │
│                                                             │
│  如果都没找到，继续 ↓                                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     步骤 2：查询 Local DNS                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户 ──── 查询 www.baidu.com ────> Local DNS (递归)      │
│                                                             │
│  Local DNS 使用迭代查询找到结果：                            │
│                                                             │
│  Local DNS ──── 查询根服务器 ────> 根服务器               │
│                    返回 .com TLD 服务器地址                   │
│                                                             │
│  Local DNS ──── 查询 .com TLD 服务器 ────> TLD 服务器      │
│                    返回 baidu.com 权威服务器地址              │
│                                                             │
│  Local DNS ──── 查询 baidu.com 权威服务器 ────> 权威服务器 │
│                    返回 220.181.38.149                       │
│                                                             │
│  Local DNS ──── 返回 IP 地址 ────> 用户                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                     步骤 3：缓存结果                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Local DNS 缓存结果，设置 TTL                              │
│                                                             │
│  下次查询时，直接返回缓存（如果未过期）                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## DNS 记录类型

### 常见记录类型

```
A 记录（Address）
  将域名指向 IPv4 地址
  www.example.com → 192.168.1.1

AAAA 记录
  将域名指向 IPv6 地址
  www.example.com → 2001:db8::1

CNAME 记录（Canonical Name）
  将域名指向另一个域名
  www.example.com → example.com

MX 记录（Mail Exchange）
  指定邮件服务器
  example.com → mail.example.com

NS 记录（Name Server）
  指定域名的 DNS 服务器
  example.com → ns1.example.com

TXT 记录
  存储文本信息（SPF、DKIM 验证等）
  example.com → "v=spf1 include:_spf.example.com ~all"

SOA 记录（Start of Authority）
  指定主 DNS 服务器和管理员邮箱
  提供区域传输的基本信息
```

### dig 命令查询

```bash
# 查询 A 记录
dig www.baidu.com

# 输出：
# ; <<>> DiG 9.18.1 <<>> www.baidu.com
# ;; QUESTION SECTION:
# ;www.baidu.com.                 IN      A
# ;; ANSWER SECTION:
# www.baidu.com.          300    IN      A       220.181.38.149
# www.baidu.com.          300    IN      A       220.181.112.244

# 查询 NS 记录
dig ns example.com

# 查询 MX 记录
dig mx example.com

# 指定 DNS 服务器查询
dig @8.8.8.8 www.baidu.com

# 跟踪整个查询过程
dig +trace www.baidu.com
```

## DNS 缓存

### 多级缓存

```
1. 浏览器缓存
   TTL 决定缓存时间
   Chrome 可在 chrome://net-internals/#dns 清除

2. 操作系统缓存
   Windows: ipconfig /flushdns
   macOS: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
   Linux: systemd-resolve --flush-caches

3. Local DNS 缓存
   运营商或企业 DNS 服务器
   缓存 TTL 时间

4. DNS 服务器缓存
   根服务器、TLD 服务器、权威服务器
   不缓存具体记录，但会缓存查询失败的结果
```

### TTL（Time To Live）

```
TTL 决定缓存时间：

记录 TTL = 300 秒（5 分钟）
├─ 第 1 次查询：访问权威服务器
├─ 第 2 次查询（5分钟内）：使用缓存
└─ 5 分钟后：重新访问权威服务器

TTL 过长的问题：
- 更新记录后生效慢
- 全球缓存需要很长时间才能更新

TTL 过短的问题：
- DNS 查询压力大
- 权威服务器压力大
```

## DNS 负载均衡

### 简单轮询

```
dns.baidu.com 有多个 IP：
110.242.68.66
220.181.38.149

DNS 返回时轮换顺序：
第 1 次查询：110.242.68.66
第 2 次查询：220.181.38.149
第 3 次查询：110.242.68.66
...
```

### 地理位置感知

```
用户在北京：
返回北京机房的 IP：10.0.1.1

用户在上海：
返回上海机房的 IP：10.0.2.1

实现方式：
- EDNS Client Subnet（ECS）
- DNS 服务器根据查询来源 IP 返回不同结果
```

### Anycast

```
同一 IP 地址在多个地点广播
数据包自动路由到最近的服务器

常见于：
- CDN（Cloudflare、Akamai）
- DNS 服务（Google Public DNS、Cloudflare DNS）
```

## DNS 安全问题

### DNS 缓存投毒

```
攻击者向 DNS 服务器注入伪造的记录
用户访问 example.com 时被导向恶意网站

防御措施：
- DNS SEC（对记录进行数字签名）
- 随机端口查询
- 检查 DNS 响应来源
```

### DNS 劫持

```
运营商或恶意软件修改 DNS 查询结果
用户访问合法网站时被导向钓鱼网站

防御措施：
- 使用可信的 DNS 服务器
- DNSSEC 验证
- HTTPS（HSTS 预加载列表）
```

### 使用安全的 DNS

```bash
# Google DNS
8.8.8.8
8.8.4.4

# Cloudflare DNS
1.1.1.1
1.0.0.1

# 防止 DNS 劫持
# 在路由器或系统设置中配置可信 DNS
```

## Java 代码示例

### DNS 查询

```java
import java.net.InetAddress;
import java.net.UnknownHostException;

public class DnsLookup {
    public static void main(String[] args) {
        try {
            // 查询域名对应的 IP 地址
            InetAddress[] addresses = InetAddress.getAllByName("www.baidu.com");

            System.out.println("www.baidu.com 的 IP 地址：");
            for (InetAddress address : addresses) {
                System.out.println("  " + address.getHostAddress());
            }

            // 反向查询
            InetAddress address = InetAddress.getByName("220.181.38.149");
            System.out.println("\nIP 反向查询：");
            System.out.println("  " + address.getCanonicalHostName());

        } catch (UnknownHostException e) {
            System.out.println("域名解析失败：" + e.getMessage());
        }
    }
}
```

### 使用 DNS 查询库

```java
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.DatagramChannel;
import java.nio.charset.StandardCharsets;
import java.util.Random;

public class DnsQueryDemo {
    private static final String DNS_SERVER = "8.8.8.8";
    private static final int DNS_PORT = 53;

    public static void main(String[] args) throws Exception {
        // 简化版：使用系统 DNS
        System.out.println("系统 DNS 服务器：");

        // Linux
        // Process process = Runtime.getRuntime().exec("cat /etc/resolv.conf");
        // Windows
        Process process = Runtime.getRuntime().exec("ipconfig /all");

        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.contains("DNS")) {
                    System.out.println(line);
                }
            }
        }
    }
}
```

## 实际应用

### 查看 DNS 解析过程

```bash
# 使用 dig 跟踪 DNS 解析
dig +trace www.baidu.com

# 使用 nslookup
nslookup www.baidu.com

# 使用 host
host -a www.baidu.com

# 查看 TTL
dig +short -t a www.baidu.com

# 跟踪 DNS 传播（多地查询）
# 使用 dnsmap、dnscheck 等工具
```

### 排查 DNS 问题

```bash
# 1. 检查 DNS 配置
cat /etc/resolv.conf

# 2. 测试 DNS 连通性
ping -c 1 8.8.8.8

# 3. 直接查询权威服务器
dig @ns1.baidu.com www.baidu.com

# 4. 检查 hosts 文件
cat /etc/hosts

# 5. 清除本地缓存
# Linux
sudo systemd-resolve --flush-caches
# macOS
sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder
# Windows
ipconfig /flushdns
```

## 面试追问方向

- DNS 是什么？它解决了什么问题？
- DNS 的层次结构是怎样的？
- 什么是递归查询和迭代查询？
- DNS 解析的完整流程是什么？
- DNS 有哪些常见的记录类型？
- 什么是 TTL？为什么重要？
- DNS 缓存有哪些层级？
- 什么是 DNS 负载均衡？
- DNS 有哪些安全问题？如何防御？
- 如何排查 DNS 解析问题？
