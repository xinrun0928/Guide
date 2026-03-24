# DNS 负载均衡与智能 DNS

你打开浏览器，输入 `www.taobao.com`，回车。

**0.001 秒**：DNS 服务器返回了 IP 地址

**问题来了**：返回的是哪个 IP？为什么有时候是上海机房的地址，有时候是北京机房的？

这就是 DNS 负载均衡在发挥作用。

## DNS 基础回顾

### DNS 查询流程

```
用户浏览器 → 本地 DNS 缓存 → 递归 DNS 服务器 → 权威 DNS 服务器
```

1. 浏览器先检查本地缓存
2. 没有则询问操作系统 DNS 缓存
3. 没有则询问配置的递归 DNS（通常是你的 ISP 提供）
4. 递归 DNS 向权威 DNS 查询
5. 权威 DNS 返回结果，一路缓存回来

### DNS 记录类型

| 类型 | 作用 | 示例 |
|------|------|------|
| A | 域名 → IPv4 | `www.example.com → 1.2.3.4` |
| AAAA | 域名 → IPv6 | `www.example.com → 2404:xxx` |
| CNAME | 域名 → 域名 | `www.example.com → origin.example.com` |
| MX | 邮件交换 | `example.com → mail.example.com` |
| TXT | 文本记录 | 用于验证、SPF 等 |
| NS | 域名服务器 | `example.com → ns1.dns.com` |

## DNS 负载均衡原理

### 简单轮询

最基础的 DNS 负载均衡就是配置多个 A 记录：

```
www.example.com.  300  IN  A  1.2.3.4
www.example.com.  300  IN  A  1.2.3.5
www.example.com.  300  IN  A  1.2.3.6
```

DNS 服务器收到查询时，轮流返回这些 IP：

```
第一次查询 → 1.2.3.4
第二次查询 → 1.2.3.5
第三次查询 → 1.2.3.6
第四次查询 → 1.2.3.4
```

### DNS 轮询的问题

1. **无法感知后端状态**：即使某台服务器挂了，DNS 还是会返回它的 IP
2. **缓存导致分布不均**：LocalDNS 可能缓存结果，导致某个 IP 被过度使用
3. **无健康检查**：DNS 服务器不知道后端服务器的健康状况
4. **TTL 困境**：TTL 太高影响故障转移，TTL 太低增加 DNS 查询压力

## 智能 DNS

智能 DNS 在返回 IP 之前，会根据一些策略选择最优的 IP。

### 按地理位置选择

```
北京用户 → www.example.com → 1.2.3.4 (北京机房)
上海用户 → www.example.com → 5.6.7.8 (上海机房)
广州用户 → www.example.com → 9.10.11.12 (广州机房)
```

实现方式：DNS 服务器根据请求来源的 IP 段判断用户地理位置。

### 常见实现

1. **权威 DNS（自建）**：BIND9、DNSMasq + GeoIP 插件
2. **商业 DNS 服务**：DNSPod、阿里云 DNS、AWS Route 53、Cloudflare
3. **CDN 联动**：DNS 返回 CDN 边缘节点 IP

### 阿里云 DNS 配置示例

```yaml
# 假设使用阿里云 DNS SDK
# 实际通过控制台或 API 配置

# 记录配置
Record:
  - Domain: example.com
    Type: A
    Value: 1.2.3.4
    Line: telecom      # 电信线路
    Region: CN-Beijing
    
  - Domain: example.com
    Type: A
    Value: 5.6.7.8
    Line: telecom
    Region: CN-Shanghai
    
  - Domain: example.com
    Type: A
    Value: 9.10.11.12
    Line: unicom      # 联通线路
    Region: CN-Guangzhou
```

### Route 53 路由策略

AWS Route 53 支持多种路由策略：

#### 1. 简单路由（Simple）

多个 IP 轮询返回，无健康检查。

#### 2. 加权路由（Weighted）

```json
{
  "Name": "www.example.com",
  "Type": "A",
  "SetIdentifier": "us-west-1",
  "Weight": 70,
  "HealthCheckId": "Z1234567890ABC"
}
```

适合：灰度发布、金丝雀部署。

#### 3. 延迟路由（Latency）

```json
{
  "Name": "www.example.com",
  "Type": "A",
  "SetIdentifier": "eu-west-1",
  "Region": "eu-west-1",
  "EvaluateTargetHealth": true
}
```

Route 53 基于全球延迟数据库，选择用户到各区域延迟最低的节点。

#### 4. 地理位置路由（Geolocation）

```json
{
  "Name": "www.example.com",
  "Type": "A",
  "SetIdentifier": "eu-west-1",
  "GeoLocation": {
    "CountryCode": "DE"
  },
  "Records": ["5.6.7.8"]
}
```

#### 5. 故障转移路由（Failover）

```json
{
  "Name": "www.example.com",
  "Type": "A",
  "SetIdentifier": "primary",
  "Weight": 1,
  "HealthCheckId": "Z1234567890ABC",
  "Failover": "PRIMARY"
}
```

配合健康检查，主节点挂了自动切换到备用节点。

## DNS 健康检查

### 工作原理

```
DNS 服务器 ──定期──→ 健康检查 ──→ 后端服务器
              │
              ▼ (异常)
         自动摘除故障 IP
```

### 健康检查配置

```yaml
# 以阿里云 DNS 为例
HealthCheck:
  - Id: hc-001
    Type: HTTPS
    Host: www.example.com
    Uri: /health
    Interval: 30s
    Timeout: 5s
    FailureThreshold: 3
    Sensors:
      - Asia-Pacific
      - North-America
      - Europe
```

### DNS + Keepalived 组合

```
用户请求
    │
    ▼
DNS 解析（智能选择）
    │
    ▼
┌─────────────────┐
│  VIP (192.168.x.x) │
└────────┬────────┘
         │
         ▼
    Nginx 集群 (Keepalived)
         │
         ▼
    后端服务集群
```

## DNS 缓存问题与优化

### 缓存导致的问题

1. **故障转移慢**：DNS TTL 1 小时，主节点挂了，用户 1 小时内还会打到故障节点
2. **更新生效慢**：服务器 IP 变更，用户可能几小时后才感知到
3. **LocalDNS 劫持**：某些 ISP 忽略 TTL，导致用户拿到过期 IP

### 优化策略

#### 1. 设置合理的 TTL

```bash
# 生产环境：正常情况下 TTL 设为 300-600 秒
www.example.com.  600  IN  A  1.2.3.4

# 故障期间：临时降为 60 秒
www.example.com.  60  IN  A  1.2.3.4
```

#### 2. 降低 TTL 后立即恢复

```bash
# 变更前 24 小时，TTL 改为 60 秒
# 执行变更
# 变更后，TTL 改回 600 秒
```

#### 3. 使用备用域名

```
正常：www.example.com → 主 IP
故障：backup.example.com → 备用 IP
```

#### 4. 客户端降级策略

```java
public class DnsResolver {
    private static final String PRIMARY_DOMAIN = "www.example.com";
    private static final String BACKUP_DOMAIN = "backup.example.com";
    private static final String BACKUP_IP = "1.2.3.99";

    public String resolve() {
        try {
            InetAddress[] addresses = InetAddress.getAllByName(PRIMARY_DOMAIN);
            // 选择第一个可用的地址
            for (InetAddress addr : addresses) {
                if (isReachable(addr)) {
                    return addr.getHostAddress();
                }
            }
        } catch (UnknownHostException e) {
            // DNS 解析失败
        }

        // 降级到备用地址
        return BACKUP_IP;
    }

    private boolean isReachable(InetAddress addr) {
        try {
            return addr.isReachable(3000);  // 3 秒超时
        } catch (IOException e) {
            return false;
        }
    }
}
```

## DNS 预解析

浏览器可以提前解析域名，减少用户等待：

```html
<!-- 在 HTML head 中添加 -->
<link rel="dns-prefetch" href="//www.example.com">
<link rel="dns-prefetch" href="//static.example.com">
<link rel="dns-prefetch" href="//cdn.example.com">
```

```html
<!-- 预连接到关键域名 -->
<link rel="preconnect" href="https://www.example.com" crossorigin>
```

## 完整架构示例

```
┌─────────────────────────────────────────────────────────────────┐
│                           用户请求                                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      DNS 智能解析                                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. 按地理位置返回最近节点 IP                             │   │
│  │  2. 按运营商（电信/联通/移动）返回最优链路                │   │
│  │  3. 配合健康检查，摘除故障节点                           │   │
│  │  4. 主节点故障时自动切换到备用节点                       │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   CDN 边缘节点         │
                    │   (就近接入)           │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   L4 负载均衡          │
                    │   (海量并发)           │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Nginx 七层负载均衡    │
                    │   (精细路由)            │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   微服务网关            │
                    │   (限流、鉴权)          │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   后端服务集群          │
                    └───────────────────────┘
```

---

**思考题：**

假设你的业务部署在北京和上海两个机房，使用 DNS 智能解析让用户就近访问。

某天凌晨，北京机房发生了火灾，虽然启动了备用电源，但网络设备受损，预计需要 4 小时恢复。

问题：
1. DNS 需要多长时间才能将所有用户流量切换到上海机房？考虑 LocalDNS 缓存的影响。
2. 在这 4 小时内，北京的用户体验会怎样？有什么技术手段可以改善？
3. 如果北京机房的服务器只是「假死」（进程卡住但网络正常），DNS 健康检查可能检测不出来，怎么处理？
4. 长期来看，你有什么更好的架构方案来应对这种单机房灾难？

提示：考虑 Anycast IP、多活架构、客户端容错等。
