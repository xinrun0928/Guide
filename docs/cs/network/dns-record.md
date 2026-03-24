# DNS 记录类型：A、CNAME、MX、NS、TXT

当你管理一个域名时，你需要在 DNS 中添加各种记录。

A 记录、CNAME、MX、NS、TXT... 它们各自有什么用？有什么区别？

这篇文章帮你彻底搞清楚。

## DNS 记录基础

### 记录结构

```
┌─────────────────────────────────────────────────────────────┐
│                    DNS 记录结构                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  类型（Type）    │  名称（Name）   │  值（Value）          │
│  A              │  www           │  192.168.1.1         │
│  CNAME          │  blog          │  example.com          │
│  MX             │  @             │  10 mail.example.com  │
│  NS             │  @             │  ns1.example.com      │
│  TXT            │  @             │  "v=spf1 ..."         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 常用记录类型

| 类型 | 全称 | 用途 | 必填 |
|------|------|------|------|
| A | Address | IPv4 地址 | 是 |
| AAAA | - | IPv6 地址 | 建议 |
| CNAME | Canonical Name | 别名 | 否 |
| MX | Mail Exchange | 邮件服务器 | 邮件必填 |
| NS | Name Server | DNS 服务器 | 是 |
| TXT | Text | 文本记录 | 建议 |
| SOA | Start of Authority | 主服务器信息 | 是 |
| CAA | Certification Authority Authorization | CA 授权 | 建议 |

## A 记录：IPv4 地址

### 作用

将域名指向一个 IPv4 地址。

```
www.example.com → 192.168.1.1
```

### 使用场景

- 绝大多数网站
- 任何需要 IP 地址的服务
- IPv4 环境下访问网站

### 配置示例

```
记录类型：A
主机记录：www
记录值：192.168.1.1
TTL：3600（1小时）
```

### 常见配置

```
# 主域名
@    →  192.168.1.1

# 子域名
www  →  192.168.1.1
api   →  192.168.1.2
blog  →  192.168.1.3

# 二级子域名
mail.admin →  192.168.1.10
```

## AAAA 记录：IPv6 地址

### 作用

将域名指向一个 IPv6 地址。

```
www.example.com → 2001:db8::1
```

### 配置示例

```
记录类型：AAAA
主机记录：www
记录值：2001:db8::1
TTL：3600
```

## CNAME 记录：别名

### 作用

将域名指向另一个域名。

```
blog.example.com → example.com
```

### 工作原理

```
用户访问 blog.example.com
DNS 查询 blog.example.com
发现是 CNAME → 指向 example.com
再查询 example.com（通常是 A 记录）
返回 IP 地址
```

### CNAME vs A 记录

```
直接用 A 记录：
blog.example.com → 192.168.1.1
（直接返回 IP）

用 CNAME：
blog.example.com → example.com
example.com → 192.168.1.1
（多一次查询）
```

### 何时使用 CNAME

```
适合的场景：
1. CDN 域名
   cdn.example.com → xxx.cdnprovider.com

2. 第三方服务
   store.example.com → mystore.shopify.com

3. 同一服务多个子域名
   www.example.com → example.com

不适合的场景：
1. 主域名（@）通常不建议用 CNAME
   - @ 表示 example.com 本身
   - MX、NS 记录需要直接指向 IP
   - 部分 DNS 服务不允许 @ 使用 CNAME

2. 根域名不能使用 CNAME（RFC 1912）
```

### 配置示例

```
# CDN
cdn.example.com → cdn.cloudflare.com

# 第三方服务
store.example.com → mystore.myshopify.com

# 统一跳转
www.example.com → example.com
```

## MX 记录：邮件交换

### 作用

指定处理邮件的服务器。

```
example.com → mail.example.com
example.com → mail2.example.com
```

### 优先级

MX 记录有优先级数值（0-65535），**数值越小优先级越高**。

```
10 mail.example.com      ← 高优先级
20 mail2.example.com    ← 低优先级
```

邮件服务器会优先尝试连接高优先级服务器，失败后尝试低优先级服务器。

### 配置示例

```
记录类型：MX
主机记录：@（表示主域名）
记录值：10 mail.example.com
TTL：3600
```

### 常见配置

```
# 主邮件服务器
@  →  10 mail.example.com

# 备用邮件服务器
@  →  20 mail2.example.com

# Google Workspace
@  →  1 aspmx.l.google.com
@  →  5 alt1.aspmx.l.google.com
@  →  5 alt2.aspmx.l.google.com
@  →  10 alt3.aspmx.l.google.com
@  →  10 alt4.aspmx.l.google.com
```

### MX 的注意事项

```
1. 记录值必须是域名，不能是 IP
2. MX 记录指向的域名必须有 A 记录
3. 邮件服务器应该有备份
4. 优先级数值只是相对关系，不影响实际优先级
```

## NS 记录：域名服务器

### 作用

指定域名的 DNS 服务器。

```
example.com → ns1.example.com
example.com → ns2.example.com
```

### 什么时候修改 NS

```
需要修改 NS 的场景：
1. 换 DNS 服务商
   从 DNSPod 换到 Cloudflare

2. 使用域名注册商的默认 DNS
   换到第三方 DNS

不需要修改 NS 的场景：
1. 添加 A 记录
2. 添加 CNAME 记录
3. 修改 MX 记录
```

### 配置示例

```
记录类型：NS
主机记录：@
记录值：ns1.cloudflare.com
TTL：86400（24小时）
```

### NS 与其他记录的关系

```
NS 记录指向 DNS 服务器
DNS 服务器负责解析以下记录：
- A、AAAA
- CNAME
- MX
- TXT
- ...

如果 NS 记录错了，整个域名都解析不了！
```

## TXT 记录：文本信息

### 作用

存储任意文本信息，常用于验证和配置。

### SPF 记录：邮件发送者验证

```
v=spf1 include:_spf.example.com ~all

含义：
v=spf1           → 使用 SPF 版本 1
include:_spf...  → 允许这个域名的邮件服务器发送
~all             → 其他来源的邮件标记为软失败（建议）
-all             → 其他来源的邮件直接拒绝
```

### DKIM 记录：邮件签名

```
v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3...;

公钥信息，用于验证邮件签名
```

### DMARC 记录：邮件策略

```
v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com

p=quarantine  → 可疑邮件放到垃圾箱
p=reject      → 直接拒绝
rua=          → 汇总报告发送地址
```

### Google Workspace 验证

```
# TXT 记录
google-site-verification=xxxxxxx

# 证明你拥有这个域名
```

### 配置示例

```
# SPF
记录类型：TXT
主机记录：@
记录值：v=spf1 include:_spf.example.com ~all
TTL：3600

# DKIM
记录类型：TXT
主机记录：google._domainkey
记录值：v=DKIM1; k=rsa; p=公钥内容...
TTL：3600
```

## SOA 记录：权威信息

### 作用

提供 DNS 区域的基本信息。

```
@  IN  SOA  ns1.example.com.  admin.example.com. (
        2026032401  ; Serial（序列号，用于判断是否更新）
        7200        ; Refresh（刷新时间）
        3600        ; Retry（重试时间）
        1209600     ; Expire（过期时间）
        86400 )     ; Minimum TTL（最小 TTL）
```

### 字段说明

| 字段 | 用途 |
|------|------|
| Serial | 每次修改记录，序列号+1 |
| Refresh | 从服务器多久检查更新 |
| Retry | 刷新失败后多久重试 |
| Expire | 主服务器不可用时，从服务器保留数据多久 |
| Minimum | 否定缓存时间（其他 DNS 缓存失败结果的时间） |

## CAA 记录：CA 授权

### 作用

指定哪些证书颁发机构可以为你的域名签发证书。

```
# 只允许 Let's Encrypt
0 issue "letsencrypt.org"

# 禁止所有 CA
0 issue ";"

# 允许多个 CA
0 issue "letsencrypt.org"
0 issuewild "digicert.com"
```

### 重要性

CAA 是防止未授权证书的重要手段。

## 其他记录类型

### PTR 记录：反向解析

```
反向 DNS：将 IP 指向域名
1.1.168.192.in-addr.arpa → www.example.com

常用于：
- 邮件服务器验证
- 日志分析
```

### SRV 记录：服务定位

```
指定特定服务的位置

_ldap._tcp.example.com → 0 5 389 ldap.example.com

格式：
_service._protocol.domain.  TTL  SRV  priority weight port target
```

### 常见用途

```
SIP（VoIP 电话）
_sip._tcp.example.com

XMPP（即时通讯）
_xmpp-client._tcp.example.com

游戏服务器
_game._tcp.example.com
```

## dig 命令查看记录

```bash
# 查看所有记录
dig example.com ANY

# 查看 A 记录
dig example.com A

# 查看 MX 记录
dig example.com MX

# 查看 NS 记录
dig example.com NS

# 查看 TXT 记录
dig example.com TXT

# 查看 CAA 记录
dig example.com CAA

# 反向查询
dig -x 192.168.1.1
```

## 配置优先级

### 解析顺序

```
域名查询顺序：
1. 先查缓存
2. 没有缓存，向 DNS 服务器查询
3. DNS 服务器按照记录类型查询

同一条记录的配置顺序：
1. A 记录
2. CNAME 记录
3. 其他记录
```

### 冲突问题

```
A 记录和 CNAME 记录冲突：
不能同时为同一主机设置 A 和 CNAME

解决方法：
- 使用 CNAME 时，删除 A 记录
- 使用 A 记录时，删除 CNAME 记录
```

## 面试追问方向

- DNS 有哪些常见记录类型？各自的用途是什么？
- A 记录和 CNAME 记录的区别是什么？
- MX 记录的优先级是怎么工作的？
- 什么是 SPF、DKIM、DMARC？
- 什么时候需要修改 NS 记录？
- 为什么根域名不建议使用 CNAME？
- SOA 记录包含哪些信息？Serial 是干什么的？
- 什么是 CAA 记录？
- dig 命令如何查询特定类型的记录？
- DNS 记录的 TTL 是干什么的？
