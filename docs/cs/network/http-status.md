# HTTP 状态码分类与常见状态码

面试时被问到「HTTP 状态码 304 是什么意思？」你答得上来吗？

HTTP 状态码是服务器对请求的「回应语言」。掌握它，才能读懂网络通信的「潜台词」。

## 状态码分类概览

```
┌─────────────────────────────────────────────────────────────┐
│                    HTTP 状态码分类                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1xx  Informational（信息性）                              │
│     请求已接收，继续处理                                      │
│                                                             │
│  2xx  Success（成功）                                      │
│     请求已成功接收、理解、执行                                  │
│                                                             │
│  3xx  Redirection（重定向）                                 │
│     需要进一步操作才能完成请求                                 │
│                                                             │
│  4xx  Client Error（客户端错误）                             │
│     请求有语法错误或无法完成                                   │
│                                                             │
│  5xx  Server Error（服务器错误）                            │
│     服务器无法完成明显有效的请求                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 1xx：信息性状态码

### 100 Continue

客户端可以继续发送请求体（用于大文件上传前的确认）。

```
客户端 ──── POST /upload ────────────────────────────────> 服务器
          Expect: 100-continue

服务器 ──── 100 Continue ────────────────────────────────> 客户端

客户端 ──── 请求体（实际数据） ───────────────────────────> 服务器
```

### 101 Switching Protocols

服务器同意切换协议（用于 WebSocket 升级）。

```
客户端 ──── Upgrade: websocket ───────────────────────────> 服务器
          Connection: Upgrade

服务器 ──── 101 Switching Protocols ───────────────────────> 客户端

协议切换为 WebSocket
```

### 103 Early Hints

服务器返回部分响应头，让浏览器可以提前加载资源（HTTP/2+）。

```
服务器 ──── 103 Early Hints ───────────────────────────────> 浏览器
          Link: </style.css>; rel=preload; as=style

服务器 ──── 200 OK ───────────────────────────────────────> 浏览器
          <link rel="stylesheet" href="/style.css">
```

## 2xx：成功状态码

### 200 OK（最常用）

请求成功，返回的资源在响应体中。

```
GET /users/123 HTTP/1.1

HTTP/1.1 200 OK
Content-Type: application/json

{"id": 123, "name": "张三"}
```

### 201 Created

资源创建成功，常与 POST 请求一起使用。

```
POST /users HTTP/1.1
Content-Type: application/json

{"name": "李四"}

HTTP/1.1 201 Created
Location: /users/124

{"id": 124, "name": "李四"}
```

### 202 Accepted

请求已接收，但处理尚未完成（异步处理）。

```
POST /api/export HTTP/1.1

HTTP/1.1 202 Accepted
Content-Type: application/json

{"task_id": "abc123", "status": "processing"}
```

### 204 No Content

成功，但无返回内容（用于 DELETE 请求）。

```
DELETE /users/123 HTTP/1.1

HTTP/1.1 204 No Content

（无响应体）
```

### 206 Partial Content

部分内容成功（用于断点续传、范围请求）。

```
GET /large-file.zip HTTP/1.1
Range: bytes=0-1023

HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/1073741824
Content-Length: 1024

[前 1024 字节数据]
```

## 3xx：重定向状态码

### 301 Moved Permanently（永久重定向）

资源已永久移动到新位置，搜索引擎会更新索引。

```
GET /old-page HTTP/1.1

HTTP/1.1 301 Moved Permanently
Location: https://example.com/new-page

浏览器会自动跳转到 new-page
```

### 302 Found（临时重定向）

资源临时在另一个位置，但搜索引擎不会更新索引。

```
GET /sale HTTP/1.1

HTTP/1.1 302 Found
Location: https://example.com/spring-sale

（临时活动页面）
```

### 303 See Other

重定向到另一个资源（用于 POST 重定向到 GET）。

```
POST /api/logout HTTP/1.1

HTTP/1.1 303 See Other
Location: /login

浏览器会发起 GET /login 请求
```

### 304 Not Modified（缓存命中）

资源未修改，可使用缓存（不带响应体）。

```
GET /static/style.css HTTP/1.1
If-None-Match: "abc123"

HTTP/1.1 304 Not Modified
ETag: "abc123"

（浏览器使用本地缓存）
```

### 307 Temporary Redirect（临时重定向）

临时重定向，但请求方法不变（POST 不会变成 GET）。

```
POST /api/submit HTTP/1.1

HTTP/1.1 307 Temporary Redirect
Location: https://other.example.com/submit

（保持 POST 方法）
```

### 308 Permanent Redirect（永久重定向）

永久重定向，但请求方法不变。

## 4xx：客户端错误状态码

### 400 Bad Request（语法错误）

请求有语法错误，服务器无法理解。

```json
POST /api/users HTTP/1.1
Content-Type: application/json

{"name": 123}  // name 应该是字符串，不是数字

HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": "validation_error",
  "message": "name 字段必须是字符串"
}
```

### 401 Unauthorized（未认证）

需要认证信息（未登录）。

```
GET /api/profile HTTP/1.1

HTTP/1.1 401 Unauthorized
WWW-Authenticate: Bearer realm="api"

{"error": "unauthorized", "message": "请登录"}
```

### 403 Forbidden（无权限）

已认证但无权限访问。

```
DELETE /api/users/123 HTTP/1.1
Authorization: Bearer xxx

HTTP/1.1 403 Forbidden

{"error": "forbidden", "message": "无权限删除用户"}
```

### 404 Not Found（资源不存在）

资源不存在。

```
GET /api/users/999 HTTP/1.1

HTTP/1.1 404 Not Found

{"error": "not_found", "message": "用户不存在"}
```

### 405 Method Not Allowed

请求方法不允许。

```
DELETE /api/users HTTP/1.1

HTTP/1.1 405 Method Not Allowed
Allow: GET, POST, PUT, PATCH

{"error": "method_not_allowed", "message": "不支持 DELETE 方法"}
```

### 409 Conflict（冲突）

请求与服务器状态冲突。

```
PUT /api/documents/123 HTTP/1.1
If-Match: "old-version"

{
  "content": "新内容",
  "version": "old-version"  // 冲突
}

HTTP/1.1 409 Conflict

{"error": "version_conflict", "message": "文档已被其他用户修改"}
```

### 410 Gone（永久删除）

资源已永久删除。

```
GET /api/v1/users HTTP/1.1

HTTP/1.1 410 Gone

{"error": "gone", "message": "此 API 版本已弃用"}
```

### 413 Payload Too Large

请求体过大。

```
POST /api/upload HTTP/1.1
Content-Length: 104857600

HTTP/1.1 413 Payload Too Large

{"error": "payload_too_large", "message": "文件大小不能超过 10MB"}
```

### 414 URI Too Long

URL 过长（GET 请求参数过多）。

```
GET /api/search?q=很长很长的查询字符串... HTTP/1.1

HTTP/1.1 414 URI Too Long

{"error": "uri_too_long", "message": "URL 长度不能超过 2048 字符"}
```

### 422 Unprocessable Entity

请求格式正确但语义错误（validation 失败）。

```json
POST /api/users HTTP/1.1

{"email": "invalid-email"}

HTTP/1.1 422 Unprocessable Entity

{
  "error": "validation_error",
  "errors": [
    {"field": "email", "message": "邮箱格式不正确"}
  ]
}
```

### 429 Too Many Requests（限流）

请求过于频繁。

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1742899200

{"error": "rate_limit", "message": "请求过于频繁，请 60 秒后重试"}
```

## 5xx：服务器错误状态码

### 500 Internal Server Error（服务器错误）

通用服务器错误。

```
HTTP/1.1 500 Internal Server Error

{"error": "internal_error", "message": "服务器内部错误"}
```

### 501 Not Implemented

服务器不支持请求的功能。

```
DELETE /api/users/123 HTTP/1.1

HTTP/1.1 501 Not Implemented

{"error": "not_implemented", "message": "DELETE 方法尚未实现"}
```

### 502 Bad Gateway（网关错误）

网关/代理从上游服务器收到无效响应。

```
                    ┌─────────────┐
                    │   网关       │
                    └──────┬──────┘
                           │ 收到无效响应
                           ▼
                    ┌─────────────┐
                    │  上游服务    │
                    │  (502)     │
                    └─────────────┘
```

### 503 Service Unavailable（服务不可用）

服务暂时不可用（维护、过载）。

```
HTTP/1.1 503 Service Unavailable
Retry-After: 300

{"error": "service_unavailable", "message": "服务正在维护中，请稍后重试"}
```

### 504 Gateway Timeout

网关/代理等待上游服务器超时。

```
HTTP/1.1 504 Gateway Timeout

{"error": "gateway_timeout", "message": "上游服务响应超时"}
```

## 常见面试题

### 场景一：页面打开白屏

```
排查步骤：
1. 检查 F12 Network
2. 看有没有 404（资源找不到）
3. 看有没有 500（服务器错误）
4. 看有没有跨域错误（CORS）
```

### 场景二：API 调用失败

```java
// Java 代码中的状态码处理
public void handleResponse(HttpResponse<String> response) {
    int statusCode = response.statusCode();

    if (statusCode >= 200 && statusCode < 300) {
        // 成功
        processData(response.body());
    } else if (statusCode == 400) {
        // 请求参数错误
        handleBadRequest(response.body());
    } else if (statusCode == 401) {
        // 未认证
        redirectToLogin();
    } else if (statusCode == 403) {
        // 无权限
        showAccessDenied();
    } else if (statusCode == 404) {
        // 资源不存在
        handleNotFound();
    } else if (statusCode == 429) {
        // 限流
        handleRateLimit(response);
    } else if (statusCode >= 500) {
        // 服务器错误
        handleServerError(statusCode);
    }
}
```

### 场景三：301 vs 302 vs 307

| 状态码 | 永久/临时 | 方法变化 | 典型场景 |
|--------|----------|----------|----------|
| 301 | 永久 | POST→GET | 域名迁移 |
| 302 | 临时 | POST→GET | 临时维护 |
| 303 | 临时 | POST→GET | POST后重定向 |
| 307 | 临时 | 保持不变 | 临时重定向 |
| 308 | 永久 | 保持不变 | API 版本升级 |

## 面试追问方向

- HTTP 状态码是如何分类的？每个分类代表什么？
- 301 和 302 的区别是什么？什么时候用 307？
- 304 是什么？它在缓存中扮演什么角色？
- 401 和 403 的区别是什么？
- 500、502、503、504 的区别是什么？
- 什么是 Retry-After 头部？
- 什么是 1xx 状态码？什么场景会用到？
- 为什么有时候返回 200 但实际上是错误？
- 什么是 103 Early Hints？
- 如何根据状态码进行错误处理？
