# HTTP 协议：请求结构与响应结构

你每天都在用 HTTP：浏览网页、调用 API、加载图片。但你真的了解 HTTP 报文的结构吗？

理解 HTTP 的请求和响应结构，是理解整个 Web 技术的基石。

## HTTP 是什么？

HTTP（HyperText Transfer Protocol）是**应用层协议**，用于 Web 浏览器和服务器之间的通信。

它的设计理念是**无状态**（每个请求都是独立的）和**可扩展**（通过头部传递任意元数据）。

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP 通信模型                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   客户端                              服务器                 │
│      │                                  ▲                   │
│      │ ──────── HTTP 请求 ──────────────│                   │
│      │                                  │                   │
│      │ ◀────────── HTTP 响应 ────────── │                   │
│      │                                  │                   │
│                                                             │
│   浏览器、App、爬虫、服务器            响应 HTML、JSON、图片   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## HTTP 请求结构

HTTP 请求由三部分组成：**请求行、请求头、请求体**。

### 完整结构

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP 请求                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  请求行                                                      │
│  GET /path/to/resource HTTP/1.1                            │
│  ↑ 方法      ↑ 路径           ↑ 协议版本                      │
│                                                             │
│  ─────────────────────────────────────────────────────     │
│                                                             │
│  请求头（Headers）                                           │
│  Host: www.example.com                                      │
│  User-Agent: Mozilla/5.0 ...                                │
│  Accept: text/html                                          │
│  Accept-Language: zh-CN,zh;q=0.9                           │
│  Accept-Encoding: gzip, deflate, br                         │
│  Connection: keep-alive                                     │
│                                                             │
│  ─────────────────────────────────────────────────────     │
│                                                             │
│  空行（分隔请求头和请求体）                                   │
│                                                             │
│  请求体（Body，可选）                                        │
│  username=admin&password=123456                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 请求行

```
请求方法 空格 路径 空格 协议版本 CRLF

GET /index.html HTTP/1.1
↑       ↑        ↑
方法    路径     协议版本

支持的协议版本：HTTP/0.9, HTTP/1.0, HTTP/1.1, HTTP/2, HTTP/3
```

### 请求头

请求头以 `Key: Value` 格式，每行一个，用于传递请求的元信息。

```
Host: www.example.com              ← 必须，指定服务器域名
User-Agent: ...                   ← 客户端信息
Accept: text/html                 ← 客户端能接收的内容类型
Accept-Language: zh-CN            ← 期望的语言
Accept-Encoding: gzip             ← 支持的压缩方式
Cookie: session=abc123            ← Cookie 数据
Referer: https://google.com       ← 请求来源
Origin: https://example.com       ← 跨域请求来源
Authorization: Bearer xxx         ← 认证信息
Content-Type: application/json    ← 请求体类型
Content-Length: 1234              ← 请求体长度
```

### 请求体

请求体用于 POST、PUT 等方法传递数据。GET、DELETE 通常没有请求体。

```
POST /login HTTP/1.1
Host: www.example.com
Content-Type: application/x-www-form-urlencoded
Content-Length: 31

username=admin&password=123456
```

## HTTP 响应结构

HTTP 响应由三部分组成：**状态行、响应头、响应体**。

### 完整结构

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP 响应                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  状态行                                                      │
│  HTTP/1.1 200 OK                                            │
│  ↑ 协议版本 ↑ 状态码   ↑ 状态描述                           │
│                                                             │
│  ─────────────────────────────────────────────────────     │
│                                                             │
│  响应头（Headers）                                           │
│  Date: Tue, 24 Mar 2026 12:00:00 GMT                       │
│  Server: Apache/2.4.1                                       │
│  Content-Type: text/html; charset=utf-8                     │
│  Content-Length: 1234                                       │
│  Connection: keep-alive                                     │
│  Set-Cookie: session=xyz789; HttpOnly                      │
│  Cache-Control: max-age=3600                                │
│                                                             │
│  ─────────────────────────────────────────────────────     │
│                                                             │
│  空行（分隔响应头和响应体）                                   │
│                                                             │
│  响应体（Body）                                              │
│  <!DOCTYPE html>                                           │
│  <html>                                                     │
│  ...                                                        │
│  </html>                                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 状态行

```
协议版本 空格 状态码 空格 状态描述 CRLF

HTTP/1.1 200 OK
↑        ↑    ↑     ↑
版本     码   文字描述

常见状态码：
200 OK                  ← 成功
301 Moved Permanently   ← 永久重定向
302 Found              ← 临时重定向
304 Not Modified       ← 缓存命中
400 Bad Request        ← 请求错误
401 Unauthorized        ← 未认证
403 Forbidden          ← 无权限
404 Not Found          ← 资源不存在
500 Internal Error     ← 服务器错误
```

### 响应头

```
Date: Tue, 24 Mar 2026 12:00:00 GMT      ← 服务器时间
Server: nginx/1.24.0                     ← 服务器软件
Content-Type: text/html; charset=utf-8   ← 内容类型
Content-Length: 1234                      ← 内容长度
Content-Encoding: gzip                    ← 压缩方式
Content-Language: zh-CN                  ← 语言
Content-Encoding: br                      ← Brotli 压缩
Last-Modified: Mon, 23 Mar 2026 00:00:00 GMT ← 资源最后修改时间
ETag: "abc123"                           ← 资源版本标识
Cache-Control: max-age=3600              ← 缓存控制
Set-Cookie: session=xyz789; HttpOnly; Secure ← 设置 Cookie
Location: https://new.example.com         ← 重定向目标
Access-Control-Allow-Origin: *            ← CORS 允许来源
```

### 响应体

响应体是实际返回的内容，可以是 HTML、JSON、图片等。

```
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 58

{"code":200,"message":"success","data":{"name":"张三"}}
```

## 实际抓包分析

### Chrome 开发者工具查看

```
Network 面板 → 选择请求 → Headers 标签
```

### curl 命令模拟

```bash
# 发送 GET 请求
curl -v https://api.example.com/users/1

# 发送 POST 请求
curl -X POST https://api.example.com/users \
  -H "Content-Type: application/json" \
  -d '{"name":"张三","age":18}'

# 发送带认证的请求
curl -H "Authorization: Bearer xxx" \
  https://api.example.com/profile
```

### 完整请求示例

```
$ curl -v https://httpbin.org/get

> GET /get HTTP/1.1
> Host: httpbin.org
> User-Agent: curl/7.88.1
> Accept: */*

< HTTP/1.1 200 OK
< date: Tue, 24 Mar 2026 12:00:00 GMT
< content-type: application/json
< content-length: 321
< connection: keep-alive
< server: gunicorn/19.9.0
<
{
  "args": {},
  "headers": {
    "Accept": "*/*",
    "Host": "httpbin.org",
    "User-Agent": "curl/7.88.1"
  },
  "origin": "203.0.113.1",
  "url": "https://httpbin.org/get"
}
```

## Java 代码示例

### 使用 HttpURLConnection 发送请求

```java
import java.io.*;
import java.net.*;

public class HttpRequestDemo {
    public static void main(String[] args) {
        try {
            // 创建连接
            URL url = new URL("https://api.example.com/users/1");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();

            // 设置请求方法
            conn.setRequestMethod("GET");

            // 设置请求头
            conn.setRequestProperty("Accept", "application/json");
            conn.setRequestProperty("User-Agent", "Java HttpClient/1.0");

            // 获取响应码
            int responseCode = conn.getResponseCode();
            System.out.println("响应码: " + responseCode);

            // 读取响应体
            if (responseCode == 200) {
                try (BufferedReader reader = new BufferedReader(
                        new InputStreamReader(conn.getInputStream()))) {
                    String line;
                    StringBuilder response = new StringBuilder();
                    while ((line = reader.readLine()) != null) {
                        response.append(line);
                    }
                    System.out.println("响应内容: " + response);
                }
            }

            // 获取响应头
            System.out.println("Content-Type: " +
                conn.getHeaderField("Content-Type"));

        } catch (IOException e) {
            e.printStackTrace();
        }
    }
}
```

### 使用 HttpClient（Java 11+）

```java
import java.net.URI;
import java.net.http.*;

public class HttpClientDemo {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        // GET 请求
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.example.com/users/1"))
            .header("Accept", "application/json")
            .build();

        HttpResponse<String> response = client.send(request,
            HttpResponse.BodyHandlers.ofString());

        System.out.println("状态码: " + response.statusCode());
        System.out.println("响应内容: " + response.body());

        // 打印响应头
        response.headers().forEach((name, values) ->
            System.out.println(name + ": " + values));
    }
}
```

### 发送 POST 请求

```java
import java.net.URI;
import java.net.http.*;
import java.util.*;

public class HttpPostDemo {
    public static void main(String[] args) throws Exception {
        HttpClient client = HttpClient.newHttpClient();

        // JSON 请求体
        String jsonBody = """
            {
                "name": "张三",
                "age": 18
            }
            """;

        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create("https://api.example.com/users"))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        HttpResponse<String> response = client.send(request,
            HttpResponse.BodyHandlers.ofString());

        System.out.println("状态码: " + response.statusCode());
        System.out.println("响应内容: " + response.body());
    }
}
```

## 常见面试问题

### Q1: GET 和 POST 的区别是什么？

| 区别 | GET | POST |
|------|-----|------|
| 语义 | 获取资源 | 提交数据 |
| 参数位置 | URL 查询参数 | 请求体 |
| 长度限制 | 受 URL 长度限制（约 2KB） | 通常无限制 |
| 缓存 | 可缓存 | 通常不缓存 |
| 幂等性 | 幂等 | 非幂等 |
| 安全性 | 参数在 URL 中，不安全 | 参数在请求体中，较安全 |

### Q2: HTTP 和 HTTPS 的区别？

```
HTTP：
- 明文传输
- 端口 80
- 无加密

HTTPS：
- 加密传输（TLS）
- 端口 443
- 需证书
```

### Q3: 什么是 Keep-Alive？

HTTP/1.1 默认使用 Keep-Alive，TCP 连接在响应后不立即关闭，可以复用发送多个请求。

```
无 Keep-Alive：
连接 ──── 请求1 ────> 关闭 ──── 重新连接 ────> 请求2 ────> 关闭

有 Keep-Alive：
连接 ──── 请求1 ────> 请求2 ────> 请求3 ────> 关闭
         连接复用，节省握手时间
```

## 面试追问方向

- HTTP 请求由哪几部分组成？
- HTTP 响应由哪几部分组成？
- GET 和 POST 的区别是什么？
- HTTP 常见的状态码有哪些？3xx、4xx、5xx 分别代表什么？
- 什么是 Keep-Alive？和 Connection: close 有什么区别？
- Content-Type 有哪些常用值？
- 如何在 Java 中发送 HTTP 请求？
- HTTP/1.1 和 HTTP/2 有什么区别？
- 什么是队头阻塞问题？
- HTTP 头部的 Accept 和 Content-Type 有什么区别？
