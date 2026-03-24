# HTTP 连接复用：Keep-Alive 与 HTTP/2 多路复用

你有没有想过这个问题：

访问一个网页，浏览器需要请求 HTML、CSS、JS、图片等几十个资源。如果每个资源都单独建立 TCP 连接，光三次握手就要浪费多少时间？

答案是：对于一个包含 50 个资源的网页，单TCP连接复用 vs 50 个独立连接，耗时差距可能高达 **3-5 秒**。

这就是 HTTP 连接复用的价值所在。

---

## 一、TCP 连接的代价

在深入讨论之前，我们先量化一下建立 TCP 连接的成本：

```java
/**
 * 估算不同 RTT 下的连接建立耗时
 * 假设：三次握手(1.5 RTT) + TLS握手(1-2 RTT) + HTTP请求(0.5 RTT)
 */
public class ConnectionCostCalculator {

    public static void main(String[] args) {
        int[] rtts = {10, 50, 100, 200}; // 毫秒
        int resourceCount = 50;

        System.out.println("========== 单连接复用 vs 多连接 ==========");
        System.out.printf("资源数量: %d%n%n", resourceCount);

        for (int rtt : rtts) {
            // 复用连接：只建立一次连接
            long reusedTime = (int)(rtt * 3.5); // 1次连接

            // 独立连接：每个资源都建立连接
            long separateTime = (int)(rtt * 3.5) * resourceCount;

            System.out.printf("RTT = %d ms:%n", rtt);
            System.out.printf("  复用连接: %d ms%n", reusedTime);
            System.out.printf("  独立连接: %d ms%n", separateTime);
            System.out.printf("  时间节省: %.1f%%%n%n", (1 - (double) reusedTime / separateTime) * 100);
        }
    }
}
```

输出示例：

```
RTT = 10 ms:
  复用连接: 35 ms
  独立连接: 1750 ms
  时间节省: 98.0%

RTT = 100 ms:
  复用连接: 350 ms
  独立连接: 17500 ms
  时间节省: 98.0%
```

**结论：网络延迟越高，连接复用的收益越大。**

---

## 二、HTTP/1.1 Keep-Alive

### 2.1 原理

HTTP/1.0 时代，每个 HTTP 请求都要建立一个新的 TCP 连接，请求结束后立即关闭。这造成了严重的资源浪费。

HTTP/1.1 引入了 **Keep-Alive** 机制：在一次 TCP 连接上，可以发送多个 HTTP 请求，避免重复建立连接的开销。

```
# 请求头中声明
Connection: keep-alive

# 服务器响应
Connection: keep-alive
Keep-Alive: timeout=5, max=1000
```

### 2.2 Keep-Alive 的局限

Keep-Alive 虽然解决了连接复用问题，但存在一个致命缺陷：**队头阻塞（Head-of-Line Blocking）**。

```java
/**
 * 模拟队头阻塞问题
 */
public class HOLBlockingSimulation {

    public static void main(String[] args) {
        System.out.println("========== HTTP/1.1 Keep-Alive 队头阻塞 ==========");
        System.out.println();
        System.out.println("假设页面需要加载: HTML + 3个CSS + 5个JS + 10张图片");
        System.out.println();

        // 模拟各资源的大小和响应时间
        Map&lt;String, Integer&gt; resources = new LinkedHashMap&lt;&gt;();
        resources.put("index.html", 50);    // 50ms
        resources.put("main.css", 30);     // 30ms
        resources.put("vendor.css", 40);   // 40ms
        resources.put("theme.css", 20);    // 20ms
        resources.put("app.js", 100);      // 100ms
        resources.put("vendor.js", 150);   // 150ms
        resources.put("chunk1.js", 80);    // 80ms
        resources.put("chunk2.js", 60);    // 60ms
        resources.put("chunk3.js", 70);    // 70ms

        System.out.println("加载顺序 (因为Keep-Alive，同一时刻只能处理1个请求):");
        int totalTime = 0;
        for (Map.Entry&lt;String, Integer&gt; entry : resources.entrySet()) {
            totalTime += entry.getValue();
            System.out.printf("  %s: %dms (累计: %dms)%n",
                    entry.getKey(), entry.getValue(), totalTime);
        }
        System.out.println();
        System.out.printf("总耗时: %d ms%n", totalTime);
        System.out.println();
        System.out.println("问题：即使浏览器能并发下载，但同一TCP连接上只能串行处理！");
        System.out.println("      小资源要等大资源处理完才能开始。");
    }
}
```

**队头阻塞的本质**：一个连接，同一时刻只能处理一个请求。只有等前一个请求完全响应后，才能开始处理下一个请求。

### 2.3 浏览器端的 workaround

为了绕过 Keep-Alive 的队头阻塞，浏览器普遍采用**多域名分片**策略：

```
原本:   www.example.com  -> 6个并发连接

优化后:
  static1.example.com -> 6个并发连接
  static2.example.com -> 6个并发连接
  static3.example.com -> 6个并发连接
  ...
```

这种方案本质上是**用更多的 TCP 连接来换取并发能力**，但代价是更多的 TCP 握手开销和服务器资源消耗。

---

## 三、HTTP/2 多路复用

### 3.1 核心思想

HTTP/2 引入的 **多路复用（Multiplexing）**，从根本上解决了队头阻塞问题：

- **一个 TCP 连接**上，可以同时并行传输**多个请求和响应**
- 请求和响应交织在一起，不再需要排队等待
- 任何一个帧的丢失，只影响该帧对应的流，不会阻塞其他流

```
HTTP/1.1 Keep-Alive (单连接串行):
┌────────┐    ┌────────┐    ┌────────┐
│Req 1   │    │Req 2   │    │Req 3   │
│Resp 1  │ -> │Resp 2  │ -> │Resp 3  │ -> ...
└────────┘    └────────┘    └────────┘

HTTP/2 多路复用 (单连接并行):
┌────────────────────────────────────┐
│Req 1  ────────────────────────────>│
│Req 2  ────────────────────────────>│
│Req 3  ────────────────────────────>│
│Resp 1 <────────────────────────────│
│Resp 2 <────────────────────────────│
│Resp 3 <────────────────────────────│
└────────────────────────────────────┘
```

### 3.2 帧与流机制

HTTP/2 的数据传输基于**帧（Frame）**和**流（Stream）**：

```java
/**
 * HTTP/2 帧结构简化示意
 */
public class Http2FrameStructure {

    // HTTP/2 帧结构
    // +-----------------------------------------------+
    // |                 Length (24 bits)              |
    // +---------------+---------------+---------------+
    // |   Type (8)    |   Flags (8)   |
    // +-+-------------+---------------+-------------------------------+
    // |R|                 Stream Identifier (31 bits)                  |
    // +-+-------------------------------------------------------------+

    public static final int FRAME_HEADER_SIZE = 9;

    public static void main(String[] args) {
        // 帧类型
        System.out.println("HTTP/2 帧类型:");
        System.out.println("  0x0: DATA          - 传输应用数据");
        System.out.println("  0x1: HEADERS        - 头部帧");
        System.out.println("  0x2: PRIORITY       - 优先级设置");
        System.out.println("  0x3: RST_STREAM     - 流重置");
        System.out.println("  0x4: SETTINGS       - 连接参数");
        System.out.println("  0x5: PING           - 心跳检测");
        System.out.println("  0x7: GOAWAY         - 连接关闭");
        System.out.println("  0x9: WINDOW_UPDATE  - 流量控制");
        System.out.println();

        // Stream ID 的奇偶性
        System.out.println("Stream ID 规则:");
        System.out.println("  - 奇数: 客户端发起的流");
        System.out.println("  - 偶数: 服务器发起的流");
        System.out.println("  - 0: 连接控制流");
    }
}
```

### 3.3 性能对比实测

```java
import io.netty.handler.codec.http2.*;
import io.netty.channel.nio.NioEventLoopGroup;

/**
 * HTTP/2 vs HTTP/1.1 性能对比
 */
public class Http2PerformanceTest {

    public static void main(String[] args) throws Exception {
        System.out.println("========== HTTP/1.1 vs HTTP/2 性能对比 ==========");
        System.out.println();

        int totalRequests = 100;
        int concurrentUsers = 10;

        // HTTP/1.1 Keep-Alive
        simulateHttp1Connection(totalRequests, concurrentUsers);

        System.out.println();

        // HTTP/2 Multiplexing
        simulateHttp2Connection(totalRequests, concurrentUsers);
    }

    private static void simulateHttp1Connection(int total, int concurrent) {
        long start = System.nanoTime();

        // HTTP/1.1 需要多个连接
        int connections = Math.min(concurrent, total);
        int requestsPerConn = total / connections;

        // 串行化影响：队头阻塞
        long totalTime = 0;
        for (int i = 0; i < total; i++) {
            totalTime += 50; // 每个请求50ms
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("HTTP/1.1 Keep-Alive:");
        System.out.printf("  连接数: %d%n", connections);
        System.out.printf("  总耗时: ~%d ms (含队头阻塞)%n", totalTime / connections);
    }

    private static void simulateHttp2Connection(int total, int concurrent) {
        // HTTP/2 单连接多路复用
        long start = System.nanoTime();

        // 所有请求复用单一连接，真正并行
        long maxTime = 0;
        for (int i = 0; i < total; i++) {
            maxTime = Math.max(maxTime, 50L); // 取最大值而非累加
        }

        long elapsed = System.nanoTime() - start;
        System.out.println("HTTP/2 Multiplexing:");
        System.out.printf("  连接数: 1%n");
        System.out.printf("  总耗时: ~%d ms (真正并行)%n", maxTime);
    }
}
```

---

## 四、Keep-Alive 与 HTTP/2 如何选择？

### 4.1 对比表

| 特性 | HTTP/1.1 Keep-Alive | HTTP/2 多路复用 |
|-----|---------------------|-----------------|
| TCP 连接数 | 多个（通常 6-8 个/域名） | 单连接 |
| 并发能力 | 受连接数限制 | 真正并行 |
| 队头阻塞 | 有 | 无 |
| Header 压缩 | 无（每次都重复发送） | HPACK 算法压缩 |
| 服务器资源 | 占用较多 | 占用较少 |
| 兼容性 | 所有浏览器/服务器 | 现代浏览器/服务器 |
| 适用场景 | 简单接口、静态资源 | 复杂页面、API 服务 |

### 4.2 迁移建议

```java
/**
 * 服务器配置：同时支持 HTTP/1.1 和 HTTP/2
 */
public class HttpServerConfig {

    public static void main(String[] args) {
        System.out.println("========== HTTP/2 迁移检查清单 ==========");
        System.out.println();

        System.out.println("1. 服务器要求:");
        System.out.println("   [ ] Nginx 1.13+ 或 Apache 2.4.17+");
        System.out.println("   [ ] 启用了 TLS (HTTPS)");
        System.out.println();

        System.out.println("2. 客户端要求:");
        System.out.println("   [ ] 浏览器支持 HTTP/2");
        System.out.println("   [ ] API 客户端使用 HTTP/2 库");
        System.out.println();

        System.out.println("3. 降级策略:");
        System.out.println("   [ ] 配置 ALPN 协商，自动降级");
        System.out.println("   [ ] 监控 HTTP/2 连接错误率");
        System.out.println();

        System.out.println("4. 监控指标:");
        System.out.println("   [ ] HTTP/2 请求占比");
        System.out.println("   [ ] 连接建立时间");
        System.out.println("   [ ] 请求并发度");
    }
}
```

---

## 五、实战配置

### 5.1 Nginx 配置

```nginx
server {
    listen 443 ssl http2;  # 启用 HTTP/2

    # Keep-Alive 配置
    keepalive_timeout 65;
    keepalive_requests 1000;

    # HPACK 压缩（HTTP/2 内置）
    # 无需额外配置

    location /api/ {
        proxy_pass http://backend;
        proxy_http_version 1.1;  # 上游也要用 HTTP/1.1 Keep-Alive
        proxy_set_header Connection "";
    }
}
```

### 5.2 Spring Boot 客户端配置

```java
import org.apache.http.impl.client.HttpClients;
import org.apache.http.impl.client.CloseableHttpClient;

@Configuration
public class HttpClientConfig {

    @Bean
    public CloseableHttpClient httpClient() {
        return HttpClients.custom()
                // HTTP/2 配置
                .setVersion(HttpVersion.HTTP_2)
                .setProtocolUpgradeHandler(...)
                // Keep-Alive 降级配置
                .setRoutePlanner(defaultRouteStrategy -> {
                    // 根据目标服务器能力选择 HTTP/1.1 或 HTTP/2
                    return new HttpRoute(defaultRouteStrategy.getRoute());
                })
                .build();
    }
}
```

---

## 六、性能优化建议

1. **优先升级到 HTTP/2**：多路复用能显著提升页面加载速度，尤其是资源丰富的页面
2. **保持短连接池**：对于高频低延迟场景，HTTP/1.1 Keep-Alive 仍然有效
3. **减少域名分片**：HTTP/2 下不需要多个域名来增加并发连接数
4. **合并小文件**：HTTP/2 下文件合并的收益降低，反而影响缓存效率
5. **监控连接复用率**：`Connection: keep-alive` 复用手数过低说明配置有问题

---

## 留给你的问题

HTTP/2 多路复用听起来很美好，但有一个前提：**一个 TCP 连接上传输的所有流共享拥塞窗口**。

当某个流丢包时，所有流都要等待重传。这意味着什么？

**在丢包率较高的网络环境下（如移动网络），HTTP/2 的多路复用反而可能比 HTTP/1.1 的多连接更慢。你觉得这个问题该怎么解决？**

提示：HTTP/3 给出了答案。
