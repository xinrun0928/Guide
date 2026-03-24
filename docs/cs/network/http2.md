# HTTP/2：多路复用、Header 压缩、服务器推送

HTTP/1.1 用了 20 多年，但它的队头阻塞问题始终无法根治。

直到 2015 年，HTTP/2 的出现才真正解决了这些问题。

## HTTP/2 的设计目标

HTTP/2 的设计者列出了几个目标：

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP/2 设计目标                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 减少页面加载延迟                                         │
│  2. 解决 HTTP 队头阻塞问题                                    │
│  3. 简化页面应用部署                                         │
│  4. 保持与 HTTP/1.1 的兼容性                                  │
│  5. 改善网络和路径的公平性                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 二进制分帧（Binary Framing）

### 为什么用二进制？

HTTP/1.x 是文本协议，解析简单但效率低：

```
HTTP/1.1 文本解析：
GET / HTTP/1.1\r\n
Host: example.com\r\n
\r\n

问题：需要逐行解析，还要处理 \r\n
```

HTTP/2 引入二进制帧：

```
HTTP/2 帧结构：
┌─────────────────────────────────────────────────────────────┐
│                    帧头部（9 字节）                          │
├──────────┬──────────┬──────────┬───────────────────────────┤
│ Length   │  Type    │  Flags   │      Stream ID            │
│ 24 位    │  8 位    │   8 位   │         31 位              │
├──────────┴──────────┴──────────┴───────────────────────────┤
│                        帧负载                               │
└─────────────────────────────────────────────────────────────┘
```

### 帧类型

| 类型 | 值 | 说明 |
|------|-----|------|
| DATA | 0x0 | 传输数据 |
| HEADERS | 0x1 | 传输头部 |
| SETTINGS | 0x4 | 连接参数 |
| PING | 0x6 | 心跳检测 |
| GOAWAY | 0x7 | 关闭连接 |
| WINDOW_UPDATE | 0x8 | 流量控制 |
| CONTINUATION | 0x9 | 继续头部 |

## 多路复用（Multiplexing）

### HTTP/1.1 的困境

```
问题：一个页面需要加载 index.html + 3 个 CSS + 5 个 JS + 8 张图片

HTTP/1.1 只能开 6 个并发连接：
连接 1: index.html ────────────────────────────>
连接 2: style1.css ────────> style2.css ──────> style3.css ──>
连接 3: app.js ────────────────────────────────────────────>
...
（串行！慢！）

队头阻塞：
CSS 请求 1 ─────────> (卡住)
CSS 请求 2 ─> (等) (等)
JS 请求 3 ────> (等) (等) (等)
```

### HTTP/2 的解决方案

```
HTTP/2 多路复用：所有资源共用一个连接

连接（TCP）───────────────────────────────────────────►
  │
  ├── Stream 1: index.html ────────────────────────>
  │
  ├── Stream 2: style1.css ────────────>
  │            style2.css ────────>
  │            style3.css ───────────>
  │
  ├── Stream 3: app.js ───────────────────────────────>
  │
  ├── Stream 4: image1.webp ──────────────>
  │            image2.webp ────────────>
  │            ...
  │
帧交错：
[HEADERS 1][DATA 2][HEADERS 3][DATA 1][DATA 4]...
```

### 为什么没有队头阻塞？

```
TCP 队头阻塞：
帧1 ──────────────────────────────> 帧1 <─────────────────
帧2 ─────────────> 帧2 <─────────── （等待帧1）
帧3 ─────> 帧3 < ──────────────── （等待帧1）

HTTP/2 Stream 独立：
Stream 1 ───────────> 帧1 ────────────────> Stream 1 完成
Stream 2 ──────> 帧2 ──> 帧2 <──── Stream 2 完成（不等待帧1）
Stream 3 ─> 帧3 < ─────────────────────── Stream 3 完成（不等待帧1）
```

每个 Stream 独立编号，丢失只影响本 Stream。

## Header 压缩（HPACK）

### 问题：HTTP/1.1 头部重复

```
第 1 个请求：
GET / HTTP/1.1
Host: api.example.com
User-Agent: Mozilla/5.0 (Windows NT 10.0)
Accept: text/html,application/xhtml+xml
Accept-Language: zh-CN,zh;q=0.9
Accept-Encoding: gzip, deflate, br
Cookie: _ga=GA1.2.123456789.1234567890; _gid=GA1.2.987654321

第 2 个请求（cookie 变了，其他几乎一样）：
GET /style.css HTTP/1.1
Host: api.example.com
User-Agent: Mozilla/5.0 (Windows NT 10.0)
Accept: text/css
Accept-Language: zh-CN,zh;q=0.9
Accept-Encoding: gzip, deflate, br
Cookie: _ga=GA1.2.123456789.1234567890; _gid=GA1.2.987654321
（大量重复！）
```

### HPACK 解决方案

```
HPACK 使用三个机制：

1. 静态表：常用 header 的预定义索引
2. 动态表：本次连接中出现过的 header
3. 哈夫曼编码：高频字符用更少的位表示
```

### HPACK 编码示例

```
传统（HTTP/1.1）：
:method: GET
:path: /api/users
:scheme: https
accept: application/json
authorization: Bearer xxx

HPACK 编码后（bytes）：
03                                          ← 静态表索引 3 = GET
80                                          ← 动态表索引 128 = 新项
C8                                          ← 哈夫曼编码的路径

体积减少 50%-90%
```

### HPACK 头部列表

```
静态表（部分）：
┌──────┬──────────────────────┐
│ 索引 │ Header               │
├──────┼──────────────────────┤
│  1   │ :authority           │
│  2   │ :method GET          │
│  3   │ :method POST         │
│  4   │ :path /              │
│  5   │ :path /index.html    │
│  6   │ :scheme https        │
│  7   │ :scheme http         │
│  8   │ :status 200          │
│  9   │ :status 204          │
│  ... │ ...                   │
└──────┴──────────────────────┘
```

## 服务器推送（Server Push）

### 传统模式

```
浏览器 ──── GET /index.html ──────────────────────────────> 服务器
服务器 ──── HTML ────────────────────────────────────────> 浏览器

浏览器解析 HTML，发现需要 style.css
浏览器 ──── GET /style.css ──────────────────────────────> 服务器
服务器 ──── CSS ────────────────────────────────────────> 浏览器

浏览器解析 CSS，发现需要 logo.png
浏览器 ──── GET /logo.png ──────────────────────────────> 服务器
服务器 ──── 图片 ────────────────────────────────────────> 浏览器

问题：每个资源都要额外请求（往返延迟累加）
```

### HTTP/2 推送模式

```
服务器知道 index.html 需要 style.css 和 logo.png
主动推送这些资源

浏览器 ──── GET /index.html ──────────────────────────────> 服务器
服务器 ──── PUSH_PROMISE /style.css ───────────────────> 浏览器
服务器 ──── PUSH_PROMISE /logo.png ───────────────────> 浏览器
服务器 ──── HTML 响应 ─────────────────────────────────> 浏览器
服务器 ──── CSS 响应（已推送，无需请求）────────────────> 浏览器
服务器 ──── 图片响应（已推送，无需请求）────────────────> 浏览器

节省：2 次 RTT
```

### Push 流程

```bash
# 1. 服务器发送 PUSH_PROMISE 帧
PUSH_PROMISE 帧：
Stream ID: 2（偶数，服务端发起的流）
:method: GET
:path: /style.css

# 2. 服务器发送响应
HEADERS 帧 (Stream 2) + DATA 帧 (Stream 2)

# 3. 浏览器使用缓存
浏览器检查缓存，发现有 style.css，不再请求
```

## 流控制（Flow Control）

### 为什么需要流控制？

```
服务端推送可能把客户端淹没：
- 服务端推送大量数据
- 客户端处理不过来
- 内存溢出
```

### HTTP/2 流控制机制

```
1. 每 Stream 有独立的窗口
2. 接收方控制窗口大小
3. WINDOW_UPDATE 帧调整窗口

客户端 ──── GET /video ──────────────────────────────────> 服务器
服务器 ──── DATA (1MB) ─────────────────────────────────> 客户端
服务器 ──── DATA (1MB) ─────────────────────────────────> 客户端
客户端 ──── WINDOW_UPDATE (窗口减半) ───────────────────> 服务器
服务器停止发送，等待窗口恢复
```

## SETTINGS 帧：连接参数

```
SETTINGS 帧在连接建立时发送：
- SETTINGS_MAX_CONCURRENT_STREAMS：最大并发流数
- SETTINGS_INITIAL_WINDOW_SIZE：初始窗口大小
- SETTINGS_HEADER_TABLE_SIZE：HPACK 表大小
- SETTINGS_ENABLE_PUSH：是否启用服务器推送
```

## Java 代码示例

### OkHttp 支持 HTTP/2

```java
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

public class Http2Client {
    public static void main(String[] args) throws Exception {
        OkHttpClient client = new OkHttpClient.Builder()
            .protocols(java.util.Arrays.asList(
                okhttp3.Protocol.HTTP_2,
                okhttp3.Protocol.HTTP_1_1))
            .build();

        Request request = new Request.Builder()
            .url("https://http2.golang.org/serverpush")
            .build();

        try (Response response = client.newCall(request).execute()) {
            System.out.println("Protocol: " + response.protocol());
            System.out.println("Response: " + response.body().string());
        }
    }
}
```

### 检查服务器是否支持 HTTP/2

```bash
# 使用 curl
curl -I --http2 https://www.example.com

# 使用 nghttp
nghttp -nv https://www.example.com

# 查看响应头
# ALPN 协议协商会告诉我们支持 HTTP/2
```

## HTTP/2 的问题

### TCP 队头阻塞

```
HTTP/2 的 Stream 是独立的，但底层的 TCP 还是有序的。

Stream 1 ──────────────────────────────> 帧1
Stream 2 ─────────> 帧2 <─────────────── 丢失！
Stream 3 ──> 帧3 < ────────────────────── 等待帧2
Stream 4 ──────────────────────────────── 等待帧2

TCP 层丢包，所有 Stream 都要等！
```

这就是为什么需要 HTTP/3——基于 UDP 的 QUIC 不受 TCP 队头阻塞影响。

## HTTP/2 vs HTTP/1.1 性能对比

| 指标 | HTTP/1.1 | HTTP/2 | 改善 |
|------|----------|--------|------|
| 并发 | 6 连接 | 无限流 | ✓ |
| 队头阻塞 | 严重 | 轻（TCP层） | ~ |
| 头部开销 | 大 | 小（HPACK） | ✓✓ |
| 服务器推送 | 无 | 有 | ✓✓ |
| 延迟 | 高 | 低 | ✓✓ |

## 面试追问方向

- HTTP/2 的二进制分帧是什么原理？
- HTTP/2 的多路复用和 HTTP/1.1 的管道化有什么区别？
- 什么是 HPACK？如何压缩头部？
- HTTP/2 的服务器推送是如何工作的？
- 什么是 PUSH_PROMISE 帧？
- HTTP/2 的流控制机制是什么？
- HTTP/2 还有哪些问题没有解决？
- 为什么 HTTP/2 仍然存在队头阻塞问题？
- 如何在 Nginx 中启用 HTTP/2？
- HTTP/2 的 SETTINGS 帧有什么作用？
