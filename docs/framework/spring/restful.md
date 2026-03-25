# RESTful API 设计规范

你有没有见过这样的接口：

```
GET /api/getUser?id=1
POST /api/createUser
POST /api/updateUser
GET /api/deleteUser?id=1
```

这不是 RESTful，这是「REST 风格的 CRUD」——看起来像 REST，但其实没有理解 REST 的精髓。

真正的 RESTful API 应该是什么样的？让我们一起来探索。

## 什么是 REST

REST（Representational State Transfer）是一种软件架构风格，不是标准或协议。它的核心思想是：

> **将所有内容抽象为资源，资源通过 URI 标识，通过 HTTP 动词操作资源。**

关键词是「资源」和「动词」。

## RESTful 设计六大原则

| 原则 | 说明 |
|-----|------|
| 1. 客户端-服务器分离 | 客户端和服务器独立发展，互不影响 |
| 2. 无状态 | 服务器不保存客户端状态，每次请求包含所有信息 |
| 3. 可缓存 | 响应可以被缓存，提高性能 |
| 4. 分层系统 | 允许中间层（网关、负载均衡）存在 |
| 5. 统一接口 | 资源通过 URI 标识，操作通过 HTTP 方法 |
| 6. 按需代码（可选） | 服务器可以发送可执行代码给客户端 |

## 资源命名

### 核心规则

**资源使用名词，不是动词。**

```java
// 错误：使用动词
GET  /api/getUser?id=1
POST /api/createUser
POST /api/updateUser
GET  /api/deleteUser?id=1

// 正确：使用名词
GET    /api/users/1       // 获取用户
POST   /api/users         // 创建用户
PUT    /api/users/1       // 更新用户
DELETE /api/users/1       // 删除用户
```

### 复数还是单数？

业界没有统一标准，但推荐使用**复数**：

```java
// 推荐：复数形式
GET /api/users      // 获取用户列表
GET /api/users/1    // 获取单个用户

// 也可以：单数形式（用于全局操作）
POST /api/user/login
POST /api/user/logout
```

### 层级结构

```java
// 用户下的订单
GET /api/users/1/orders

// 订单下的商品
GET /api/users/1/orders/100/items
```

### 查询参数 vs 路径参数

```java
// 路径参数：用于标识特定资源
GET /api/users/1           // 获取 ID 为 1 的用户
GET /api/orders/100        // 获取订单号 100

// 查询参数：用于过滤、排序、分页
GET /api/users?status=active&amp;page=1&amp;size=20
GET /api/users?sort=createdAt,desc&amp;fields=id,name,email
```

## HTTP 方法

| 方法 | 语义 | 幂等性 | 安全性 | 典型用途 |
|-----|------|-------|-------|---------|
| GET | 查询 | 幂等 | 安全 | 获取资源 |
| POST | 创建 | 非幂等 | 不安全 | 创建资源 |
| PUT | 完整更新 | 幂等 | 不安全 | 更新资源（全部字段） |
| PATCH | 部分更新 | 非幂等 | 不安全 | 更新资源（部分字段） |
| DELETE | 删除 | 幂等 | 不安全 | 删除资源 |
| HEAD | 获取元数据 | 幂等 | 安全 | 检查资源是否存在 |
| OPTIONS | 获取支持的方法 | 幂等 | 安全 | CORS 预检 |

### GET - 资源查询

```java
// 获取所有用户
GET /api/users

// 获取单个用户
GET /api/users/123

// 获取用户下的订单
GET /api/users/123/orders

// 搜索用户（复杂查询用查询参数）
GET /api/users?username=张三&amp;age_gt=18
```

### POST - 创建资源

```java
// 创建用户
POST /api/users
Content-Type: application/json

{
    "username": "zhangsan",
    "email": "zhangsan@example.com",
    "password": "123456"
}

// 返回 201 Created
// Location: /api/users/124
```

### PUT - 完整更新

```java
// 完整更新用户（所有字段）
PUT /api/users/123
Content-Type: application/json

{
    "username": "zhangsan_updated",
    "email": "zhangsan_new@example.com",
    "password": "654321",
    "age": 25,
    "status": "active"
}
```

### PATCH - 部分更新

```java
// 部分更新（只更新需要的字段）
PATCH /api/users/123
Content-Type: application/json

{
    "email": "new_email@example.com"
}

// 或者
PATCH /api/users/123
Content-Type: application/json

{
    "op": "replace",
    "path": "/email",
    "value": "new_email@example.com"
}
```

### DELETE - 删除资源

```java
// 删除用户
DELETE /api/users/123

// 返回 204 No Content
```

## 状态码

### 2xx - 成功

| 状态码 | 含义 | 使用场景 |
|-------|------|---------|
| 200 OK | 成功 | GET、PUT、PATCH 成功 |
| 201 Created | 已创建 | POST 创建新资源成功 |
| 202 Accepted | 已接受 | 异步操作，请求已接受但未完成 |
| 204 No Content | 无内容 | DELETE 成功，无返回内容 |

### 3xx - 重定向

| 状态码 | 含义 | 使用场景 |
|-------|------|---------|
| 301 Moved Permanently | 永久重定向 | 资源已迁移到新地址 |
| 302 Found | 临时重定向 | 临时跳转到其他 URI |
| 304 Not Modified | 未修改 | 使用缓存，节省带宽 |

### 4xx - 客户端错误

| 状态码 | 含义 | 使用场景 |
|-------|------|---------|
| 400 Bad Request | 错误请求 | 参数错误、格式错误 |
| 401 Unauthorized | 未认证 | 未登录或 Token 过期 |
| 403 Forbidden | 禁止访问 | 已登录但无权限 |
| 404 Not Found | 未找到 | 资源不存在 |
| 405 Method Not Allowed | 方法不允许 | HTTP 方法不支持 |
| 409 Conflict | 冲突 | 资源状态冲突，如重复创建 |
| 422 Unprocessable Entity | 无法处理的实体 | 语义错误，如校验失败 |
| 429 Too Many Requests | 请求过多 | 限流触发 |

### 5xx - 服务器错误

| 状态码 | 含义 | 使用场景 |
|-------|------|---------|
| 500 Internal Server Error | 服务器内部错误 | 未预期的异常 |
| 502 Bad Gateway | 网关错误 | 上游服务异常 |
| 503 Service Unavailable | 服务不可用 | 维护或过载 |
| 504 Gateway Timeout | 网关超时 | 上游服务响应超时 |

## 统一响应格式

### 成功响应

```json
{
    "code": 200,
    "message": "success",
    "data": {
        "id": 123,
        "username": "zhangsan",
        "email": "zhangsan@example.com"
    },
    "timestamp": 1699000000000
}
```

### 列表响应（带分页）

```json
{
    "code": 200,
    "message": "success",
    "data": {
        "list": [
            {"id": 1, "username": "user1"},
            {"id": 2, "username": "user2"}
        ],
        "pagination": {
            "page": 1,
            "size": 20,
            "total": 100,
            "totalPages": 5
        }
    }
}
```

### 错误响应

```json
{
    "code": 400,
    "message": "参数校验失败",
    "errors": [
        {"field": "email", "message": "邮箱格式不正确"},
        {"field": "password", "message": "密码长度不能少于 6 位"}
    ],
    "timestamp": 1699000000000,
    "traceId": "abc123"
}
```

## Spring MVC 实现

### Controller 示例

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @Autowired
    private UserService userService;
    
    // 获取用户列表
    @GetMapping
    public Result&lt;PageResult&lt;UserVO&gt;&gt; list(
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(required = false) String status) {
        
        PageResult&lt;UserVO&gt; result = userService.list(page, size, status);
        return Result.success(result);
    }
    
    // 获取单个用户
    @GetMapping("/{id}")
    public Result&lt;UserVO&gt; getById(@PathVariable Long id) {
        UserVO user = userService.findById(id);
        if (user == null) {
            return Result.error(404, "用户不存在");
        }
        return Result.success(user);
    }
    
    // 创建用户
    @PostMapping
    public Result&lt;UserVO&gt; create(@RequestBody @Valid CreateUserRequest request) {
        UserVO user = userService.create(request);
        return Result.success(user)
            .withStatus(HttpStatus.CREATED)
            .withHeader("Location", "/api/users/" + user.getId());
    }
    
    // 完整更新用户
    @PutMapping("/{id}")
    public Result&lt;UserVO&gt; update(@PathVariable Long id,
                                   @RequestBody @Valid UpdateUserRequest request) {
        UserVO user = userService.update(id, request);
        return Result.success(user);
    }
    
    // 部分更新用户
    @PatchMapping("/{id}")
    public Result&lt;UserVO&gt; patch(@PathVariable Long id,
                                 @RequestBody UpdateUserRequest request) {
        UserVO user = userService.patch(id, request);
        return Result.success(user);
    }
    
    // 删除用户
    @DeleteMapping("/{id}")
    public Result&lt;Void&gt; delete(@PathVariable Long id) {
        userService.delete(id);
        return Result.success(null).withStatus(HttpStatus.NO_CONTENT);
    }
}
```

### 请求对象

```java
// 创建用户请求
public class CreateUserRequest {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 3, max = 20, message = "用户名长度为 3-20 位")
    private String username;
    
    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;
    
    @NotBlank(message = "密码不能为空")
    @Size(min = 6, message = "密码长度不能少于 6 位")
    private String password;
    
    private Integer age;
    
    private MultipartFile avatar;
}

// 更新用户请求
public class UpdateUserRequest {
    @Size(min = 3, max = 20, message = "用户名长度为 3-20 位")
    private String username;
    
    @Email(message = "邮箱格式不正确")
    private String email;
    
    private Integer age;
    
    private String status;
}
```

## 高级特性

### 批量操作

```java
// 批量创建
POST /api/users/batch
[
    {"username": "user1", "email": "user1@example.com"},
    {"username": "user2", "email": "user2@example.com"}
]

// 批量更新
PUT /api/users/batch
[
    {"id": 1, "status": "active"},
    {"id": 2, "status": "inactive"}
]

// 批量删除
DELETE /api/users/batch?ids=1,2,3
```

### 关联资源操作

```java
// 获取用户的所有订单
GET /api/users/{userId}/orders

// 为用户添加订单
POST /api/users/{userId}/orders

// 获取用户的指定订单
GET /api/users/{userId}/orders/{orderId}
```

### HATEOAS（超媒体）

返回资源的同时，提供相关链接：

```json
{
    "id": 1,
    "username": "zhangsan",
    "_links": {
        "self": {"href": "/api/users/1"},
        "orders": {"href": "/api/users/1/orders"},
        "profile": {"href": "/api/users/1/profile"}
    }
}
```

Spring HATEOAS 使用：

```java
@GetMapping("/{id}")
public EntityModel&lt;UserVO&gt; getUser(@PathVariable Long id) {
    UserVO user = userService.findById(id);
    
    return EntityModel.of(user,
        linkTo(methodOn(UserController.class).getUser(id)).withSelfRel(),
        linkTo(methodOn(UserController.class).getOrders(id)).withRel("orders")
    );
}
```

## 版本管理

### URL 版本

```java
// v1 版本
GET /api/v1/users

// v2 版本（接口不兼容时）
GET /api/v2/users
```

### Header 版本

```java
// 请求头
GET /api/users
Accept: application/vnd.api.v2+json
```

## RESTful 反模式

| 反模式 | 问题 | 正确做法 |
|-------|------|---------|
| `/getUser` | 路径中包含动词 | 使用 HTTP GET 方法 |
| `/users?action=delete` | 用查询参数做操作 | 使用 DELETE 方法 |
| `/users/123/update` | 路径中包含动词 | 使用 PUT/PATCH 方法 |
| 所有请求都返回 200 | 不区分成功失败 | 使用正确的状态码 |
| 不返回 Location 头 | 创建资源后无法获取 URI | 返回 201 并带 Location |
| 暴露内部错误信息 | 安全风险 | 日志记录内部错误，外部返回通用信息 |

## 面试追问

**Q1: PUT 和 PATCH 的区别？**

- **PUT**：完整更新，需要提供所有字段
- **PATCH**：部分更新，只更新提供的字段

```java
// PUT 请求需要包含所有字段
PUT /api/users/123
{"username": "new", "email": "new@example.com", "age": 25, "status": "active"}

// PATCH 请求只需要包含要更新的字段
PATCH /api/users/123
{"email": "new@example.com"}
```

**Q2: RESTful 的缺点？**

- 不适合需要长时间运行的操作（如视频处理）
- 不适合需要实时通信的场景（如聊天）
- 复杂查询使用 URL 可能过长

**Q3: 如何处理 API 限流？**

```java
// 返回 429 Too Many Requests
// 并带上重试时间
HTTP/1.1 429 Too Many Requests
Retry-After: 60
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699000060
```

---

**下节预告**：[Spring 配置类 @Configuration 与 @Bean](/framework/spring/configuration) —— 深入理解 Java 配置类的原理和使用方式。
