# HTTP 方法：GET、POST、PUT、DELETE、HEAD、OPTIONS

当你用浏览器打开网页时，背后发生了什么？

你可能没意识到，但每次操作都对应着不同的 HTTP 方法：GET 获取页面，POST 提交表单，PUT 更新资源，DELETE 删除数据...

理解这些方法，是理解 RESTful API 设计的基础。

## HTTP 方法全景

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP 方法分类                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  安全方法（只读，不会修改服务器状态）                          │
│  ├─ GET      读取资源                                       │
│  ├─ HEAD     读取资源头部（无响应体）                        │
│  └─ OPTIONS  查询支持的通信选项                              │
│                                                             │
│  非安全方法（会修改服务器状态）                                │
│  ├─ POST     创建资源                                       │
│  ├─ PUT      完整更新资源                                   │
│  ├─ PATCH    部分更新资源                                   │
│  ├─ DELETE   删除资源                                       │
│  └─ TRACE    诊断（回显请求，用于调试）                       │
│                                                             │
│  扩展方法                                                   │
│  ├─ CONNECT  建立隧道（用于代理）                           │
│  └─ MOVE     WebDAV 扩展                                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## GET：获取资源

### 特点

```
1. 只读取数据，不修改服务器状态
2. 参数通过 URL 传递
3. 可以被缓存
4. 幂等的（多次 GET 同一资源，结果相同）
5. 长度受 URL 限制（约 2KB）
```

### 示例

```
GET /users/123 HTTP/1.1
Host: api.example.com
Accept: application/json

响应：
HTTP/1.1 200 OK
Content-Type: application/json

{
  "id": 123,
  "name": "张三",
  "email": "zhangsan@example.com"
}
```

### URL 带参数

```
GET /search?q=java&page=1&size=20 HTTP/1.1
Host: www.example.com

URL 参数会被编码：
/search?q=java&page=1&q=%E4%B8%AD%E6%96%87
```

## POST：创建资源

### 特点

```
1. 用于创建新资源
2. 参数通过请求体传递
3. 通常不是幂等的（多次 POST 可能创建多个资源）
4. 不应该被缓存
5. 长度无限制
```

### 示例

```
POST /users HTTP/1.1
Host: api.example.com
Content-Type: application/json
Content-Length: 45

{
  "name": "李四",
  "email": "lisi@example.com"
}

响应：
HTTP/1.1 201 Created
Location: /users/124

{
  "id": 124,
  "name": "李四",
  "email": "lisi@example.com"
}
```

### POST 的其他用途

POST 不只是用于创建资源，还可以用于：

```bash
# 登录
POST /login
# 提交表单
POST /submit
# 执行动作
POST /api/notify
# 上传文件
POST /upload
```

## PUT：完整更新资源

### 特点

```
1. 用于完整更新资源（替换整个资源）
2. 幂等的（多次 PUT 同一资源，结果相同）
3. 参数通过请求体传递
```

### 示例

```
PUT /users/123 HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "name": "张三-更新",
  "email": "zhangsan-new@example.com"
}

响应：
HTTP/1.1 200 OK

{
  "id": 123,
  "name": "张三-更新",
  "email": "zhangsan-new@example.com"
}
```

### PUT vs POST

```
PUT 通常用于更新/替换：
PUT /users/123  →  更新 ID=123 的资源（幂等）
POST /users     →  创建新资源（可能创建多个，非幂等）
```

## PATCH：部分更新资源

### 特点

```
1. 用于部分更新资源（只更新指定字段）
2. 不是幂等的
3. 参数通过请求体传递
```

### 示例

```
PATCH /users/123 HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "email": "zhangsan-updated@example.com"
}

响应：
HTTP/1.1 200 OK

{
  "id": 123,
  "name": "张三",           ← 保持不变
  "email": "zhangsan-updated@example.com"  ← 更新了
}
```

### PATCH 的格式

PATCH 请求体格式有多种：

```
1. JSON Merge Patch (RFC 7396)
   Content-Type: application/merge-patch+json
   {"email": "new@example.com"}

2. JSON Patch (RFC 6902)
   Content-Type: application/json-patch+json
   [{"op": "replace", "path": "/email", "value": "new@example.com"}]
```

## DELETE：删除资源

### 特点

```
1. 用于删除资源
2. 幂等的（多次 DELETE 同一资源，结果都是资源不存在）
3. 请求体通常为空
```

### 示例

```
DELETE /users/123 HTTP/1.1
Host: api.example.com

响应：
HTTP/1.1 204 No Content

（无响应体）
```

### 删除不存在资源的响应

```
DELETE /users/999 HTTP/1.1

响应：
HTTP/1.1 404 Not Found

或者幂等设计：
HTTP/1.1 204 No Content
```

## HEAD：获取头部

### 特点

```
1. 与 GET 类似，但不返回响应体
2. 只获取资源的元信息
3. 用于检查资源是否存在、大小、类型等
4. 幂等的
```

### 示例

```
HEAD /large-file.zip HTTP/1.1
Host: download.example.com

响应：
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Length: 1073741824
Last-Modified: Mon, 23 Mar 2026 10:00:00 GMT
ETag: "abc123"

（响应体为空，只返回头部信息）
```

### 常见用途

```bash
# 检查文件是否存在
curl -I https://example.com/resource

# 检查资源是否被修改（用于缓存验证）
curl -I -H "If-None-Match: \"abc123\"" https://example.com/resource
```

## OPTIONS：查询支持的选项

### 特点

```
1. 查询服务器支持的 HTTP 方法
2. 查询跨域支持
3. 幂等的
```

### 示例

```
OPTIONS /api/users HTTP/1.1
Host: api.example.com

响应：
HTTP/1.1 200 OK
Allow: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Origin: *
Content-Length: 0
```

### CORS 预检请求

浏览器在发送跨域请求前，会先发送 OPTIONS 预检请求：

```
浏览器 ──── OPTIONS /api/users ────────────────────────────────> 服务器
Origin: https://other-site.com

服务器 ──── 200 OK ───────────────────────────────────────────── 浏览器
Access-Control-Allow-Origin: https://other-site.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE
Access-Control-Allow-Headers: Content-Type, Authorization

浏览器 ──── POST /api/users ─────────────────────────────────────> 服务器
Origin: https://other-site.com
```

## RESTful API 设计规范

### 资源命名

```
# 资源是名词，复数形式
GET    /users          ← 获取用户列表
GET    /users/123      ← 获取 ID=123 的用户
POST   /users          ← 创建用户
PUT    /users/123      ← 完整更新用户
PATCH  /users/123      ← 部分更新用户
DELETE /users/123      ← 删除用户

# 嵌套资源
GET    /users/123/orders       ← 获取用户 123 的订单
GET    /users/123/orders/456  ← 获取用户 123 的订单 456
```

### 错误处理

```
正确：
GET /users/999

响应：
HTTP/1.1 404 Not Found
Content-Type: application/json

{
  "error": "not_found",
  "message": "用户不存在"
}

错误（用状态码 200 表示错误）：
HTTP/1.1 200 OK
{
  "code": 404,
  "message": "用户不存在"
}
```

## Java 代码示例

```java
import java.net.URI;
import java.net.http.*;

public class HttpMethodsDemo {
    private final HttpClient client = HttpClient.newHttpClient();

    // GET 请求
    public String get(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .GET()
            .build();

        return client.send(request,
            HttpResponse.BodyHandlers.ofString()).body();
    }

    // POST 请求
    public String post(String url, String jsonBody) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        return client.send(request,
            HttpResponse.BodyHandlers.ofString()).body();
    }

    // PUT 请求
    public String put(String url, String jsonBody) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Content-Type", "application/json")
            .PUT(HttpRequest.BodyPublishers.ofString(jsonBody))
            .build();

        return client.send(request,
            HttpResponse.BodyHandlers.ofString()).body();
    }

    // PATCH 请求
    public String patch(String url, String jsonBody) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .method("PATCH", HttpRequest.BodyPublishers.ofString(jsonBody))
            .header("Content-Type", "application/json")
            .build();

        return client.send(request,
            HttpResponse.BodyHandlers.ofString()).body();
    }

    // DELETE 请求
    public void delete(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .DELETE()
            .build();

        client.send(request, HttpResponse.BodyHandlers.ofString());
    }

    // HEAD 请求
    public void head(String url) throws Exception {
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .method("HEAD", HttpRequest.BodyPublishers.noBody())
            .build();

        HttpResponse<Void> response = client.send(request,
            HttpResponse.BodyHandlers.discarding());

        System.out.println("Content-Length: " +
            response.headers().firstValue("Content-Length").orElse("N/A"));
    }
}
```

## 幂等性对比

```
┌─────────────────────────────────────────────────────────────┐
│                      HTTP 方法幂等性                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  方法      │ 幂等  │ 安全   │ 说明                          │
│ ─────────┼──────┼──────┼─────────────────────────────     │
│  GET     │  ✓   │  ✓   │ 只读，多次读取结果相同             │
│  HEAD    │  ✓   │  ✓   │ 只读头部，不返回 body             │
│  OPTIONS │  ✓   │  ✓   │ 查询支持的方法                    │
│  PUT     │  ✓   │  ✗   │ 替换资源，幂等                   │
│  DELETE  │  ✓   │  ✗   │ 删除资源，幂等                   │
│  POST    │  ✗   │  ✗   │ 创建资源，非幂等                 │
│  PATCH   │  ✗   │  ✗   │ 部分更新，非幂等                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 面试追问方向

- GET 和 POST 的区别是什么？
- PUT 和 PATCH 的区别是什么？
- 什么是幂等性？哪些方法是幂等的？
- 什么是 RESTful API？RESTful API 设计的规范是什么？
- DELETE 删除一个已存在的资源，应该返回什么状态码？
- PUT 和 POST 的区别是什么？
- OPTIONS 方法的作用是什么？什么时候会用到？
- CORS 预检请求是什么？用到了哪些 HTTP 方法？
- 什么是安全方法？什么是幂等方法？
- HTTP 方法的大小写有要求吗？
