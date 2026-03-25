# 异常处理：@ExceptionHandler 与 @ControllerAdvice

你有没有遇到过这种情况：接口抛了个异常，前端收到的响应却是一个陌生的 HTML 页面，而不是 JSON？

这通常是因为异常没有被正确处理。

Spring MVC 提供了强大的异常处理机制，让我们来一探究竟。

## 异常处理的流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         异常处理流程                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Controller 方法执行                                                     │
│         │                                                               │
│         ▼                                                               │
│  ┌──────────────────┐                                                   │
│  │  正常执行？       │──是──► 返回 ModelAndView                         │
│  └────────┬─────────┘                                                   │
│           │否                                                           │
│           ▼                                                             │
│  ┌──────────────────┐                                                   │
│  │  抛出异常        │                                                   │
│  └────────┬─────────┘                                                   │
│           ▼                                                             │
│  DispatcherServlet 捕获异常                                              │
│         │                                                               │
│         ▼                                                               │
│  HandlerExceptionResolver 处理                                           │
│         │                                                               │
│         ▼                                                             │
│  返回 ModelAndView（或统一响应格式）                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## HandlerExceptionResolver 体系

### 接口定义

```java
public interface HandlerExceptionResolver {
    // 处理异常，返回 ModelAndView（如果返回 null 说明不处理，继续找下一个）
    ModelAndView resolveException(HttpServletRequest request,
                                   HttpServletResponse response,
                                   Object handler,
                                   Exception ex);
}
```

### 内置实现

| 实现类 | 处理异常类型 | 优先级 |
|-------|-------------|--------|
| `ExceptionHandlerExceptionResolver` | @ExceptionHandler 注解 | 最高 |
| `ResponseStatusExceptionResolver` | @ResponseStatus 注解 | 中 |
| `DefaultHandlerExceptionResolver` | Spring MVC 标准异常（如 404、405） | 低 |
| `HandlerExceptionResolverComposite` | 组合多个 Resolver | - |

## @ExceptionHandler：方法级异常处理

### 基本用法

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) {
        User user = userService.findById(id);
        if (user == null) {
            throw new UserNotFoundException("用户不存在: " + id);
        }
        return user;
    }
    
    // 处理 UserNotFoundException
    @ExceptionHandler(UserNotFoundException.class)
    public Result&lt;?&gt; handleUserNotFound(UserNotFoundException e) {
        return Result.error(404, e.getMessage());
    }
    
    // 处理所有 Exception
    @ExceptionHandler(Exception.class)
    public Result&lt;?&gt; handleException(Exception e) {
        log.error("系统异常", e);
        return Result.error(500, "系统繁忙，请稍后重试");
    }
}
```

### 异常处理方法签名

```java
@ExceptionHandler 标注的方法支持多种参数组合：

// 1. 只接收异常对象
@ExceptionHandler(BusinessException.class)
public void handle(BusinessException e) { ... }

// 2. 接收异常 + HttpServletRequest
@ExceptionHandler(BusinessException.class)
public void handle(BusinessException e, HttpServletRequest request) {
    String uri = request.getRequestURI();
    // ...
}

// 3. 接收异常 + HttpServletResponse
@ExceptionHandler(BusinessException.class)
public void handle(BusinessException e, HttpServletResponse response) throws IOException {
    response.sendError(400);
}

// 4. 接收异常 + @RequestAttribute 或 @SessionAttribute
@ExceptionHandler(BusinessException.class)
public void handle(BusinessException e, 
                   @RequestAttribute("traceId") String traceId) {
    // ...
}

// 返回值可以是：
// - void（直接操作 response）
// - String（视图名）
// - ModelAndView
// - @ResponseBody 标注的对象（JSON 响应）
```

### 异常处理优先级

```java
@RestController
public class UserController {
    
    // 精确匹配：UserNotFoundException
    @ExceptionHandler(UserNotFoundException.class)
    public Result&lt;?&gt; handleNotFound(UserNotFoundException e) {
        return Result.error(404, e.getMessage());
    }
    
    // 模糊匹配：所有 RuntimeException
    @ExceptionHandler(RuntimeException.class)
    public Result&lt;?&gt; handleRuntime(RuntimeException e) {
        return Result.error(400, e.getMessage());
    }
    
    // 最通用：所有 Exception
    @ExceptionHandler(Exception.class)
    public Result&lt;?&gt; handleException(Exception e) {
        return Result.error(500, "系统错误");
    }
}
```

## @ControllerAdvice：全局异常处理

`@ExceptionHandler` 只能处理单个 Controller 中的异常。如果想统一处理所有 Controller 的异常，需要 `@ControllerAdvice`。

### 基本结构

```java
// 全局异常处理器
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(BusinessException.class)
    public Result&lt;?&gt; handleBusinessException(BusinessException e) {
        return Result.error(e.getCode(), e.getMessage());
    }
    
    @ExceptionHandler(Exception.class)
    public Result&lt;?&gt; handleException(Exception e) {
        return Result.error(500, "系统异常");
    }
}
```

### 限定处理范围

```java
// 1. 只处理特定包下的 Controller
@RestControllerAdvice(basePackages = "com.example.controller")
public class PackageExceptionHandler { ... }

// 2. 只处理特定注解标注的 Controller
@RestControllerAdvice(annotations = RestController.class)
public class AnnotatedExceptionHandler { ... }

// 3. 只处理特定类型的 Controller
@RestControllerAdvice(assignableTypes = {UserController.class, OrderController.class})
public class SpecificExceptionHandler { ... }
```

### 完整示例

```java
@RestControllerAdvice(
    basePackages = "com.example.api",
    annotations = RestController.class
)
public class ApiExceptionHandler {
    
    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    
    // 业务异常
    @ExceptionHandler(BusinessException.class)
    public Result&lt;?&gt; handleBusiness(BusinessException e) {
        log.warn("业务异常: {}", e.getMessage());
        return Result.error(e.getCode(), e.getMessage());
    }
    
    // 参数校验异常
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result&lt;?&gt; handleValidation(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldErrors().stream()
            .map(error -&gt; error.getField() + ": " + error.getDefaultMessage())
            .collect(Collectors.joining(", "));
        return Result.error(400, "参数校验失败: " + message);
    }
    
    // 拦截异常（权限不足）
    @ExceptionHandler(AccessDeniedException.class)
    public Result&lt;?&gt; handleAccessDenied(AccessDeniedException e) {
        return Result.error(403, "权限不足");
    }
    
    // 参数类型不匹配
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public Result&lt;?&gt; handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        String message = String.format("参数 '%s' 类型错误，期望 %s",
            e.getName(), 
            e.getRequiredType().getSimpleName());
        return Result.error(400, message);
    }
    
    // 404 异常
    @ExceptionHandler(NoHandlerFoundException.class)
    public Result&lt;?&gt; handleNotFound(NoHandlerFoundException e) {
        return Result.error(404, "接口不存在: " + e.getRequestURL());
    }
    
    // 默认异常
    @ExceptionHandler(Exception.class)
    public Result&lt;?&gt; handleException(Exception e) {
        log.error("系统异常", e);
        return Result.error(500, "系统繁忙，请稍后重试");
    }
}
```

## @ResponseStatus：自定义响应状态

### 注解方式

```java
// 方式一：注解在异常类上
@ResponseStatus(code = HttpStatus.NOT_FOUND, reason = "资源未找到")
public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}

// 方式二：注解在 Controller 方法上
@PostMapping("/user")
@ResponseStatus(HttpStatus.CREATED)  // 返回 201 Created
public User createUser(@RequestBody User user) {
    return userService.create(user);
}
```

### 自定义异常类

```java
// 统一异常基类
public class BusinessException extends RuntimeException {
    private final int code;
    
    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }
    
    public int getCode() { return code; }
}

// 具体异常
public class UserNotFoundException extends BusinessException {
    public UserNotFoundException(Long userId) {
        super(404, "用户不存在: " + userId);
    }
}

public class InvalidParameterException extends BusinessException {
    public InvalidParameterException(String paramName) {
        super(400, "无效参数: " + paramName);
    }
}
```

## 处理不同类型的响应

### 返回 JSON

```java
// 默认返回 JSON（@RestControllerAdvice 包含 @ResponseBody）
@ExceptionHandler(BusinessException.class)
public Result&lt;?&gt; handleBusiness(BusinessException e) {
    return Result.error(e.getCode(), e.getMessage());
}
```

### 返回视图

```java
// 返回视图（使用 @ControllerAdvice 而非 @RestControllerAdvice）
@ControllerAdvice
public class ViewExceptionHandler {
    
    @ExceptionHandler(BusinessException.class)
    public ModelAndView handleBusiness(BusinessException e) {
        ModelAndView mav = new ModelAndView("error/business");
        mav.addObject("code", e.getCode());
        mav.addObject("message", e.getMessage());
        return mav;
    }
    
    @ExceptionHandler(Exception.class)
    public ModelAndView handleException(Exception e) {
        ModelAndView mav = new ModelAndView("error/500");
        mav.addObject("message", e.getMessage());
        return mav;
    }
}
```

### 返回 HTTP 错误

```java
@ExceptionHandler(BusinessException.class)
public void handle(HttpServletResponse response, BusinessException e) throws IOException {
    response.setStatus(e.getCode());
    response.setContentType("application/json");
    response.getWriter().write("{\"code\":" + e.getCode() + ",\"message\":\"" + e.getMessage() + "\"}");
}
```

## 统一响应格式

```java
// 统一响应类
public class Result&lt;T&gt; {
    private int code;
    private String message;
    private T data;
    private long timestamp;
    
    public static &lt;T&gt; Result&lt;T&gt; success(T data) {
        Result&lt;T&gt; result = new Result&lt;&gt;();
        result.setCode(200);
        result.setMessage("success");
        result.setData(data);
        result.setTimestamp(System.currentTimeMillis());
        return result;
    }
    
    public static &lt;T&gt; Result&lt;T&gt; error(int code, String message) {
        Result&lt;T&gt; result = new Result&lt;&gt;();
        result.setCode(code);
        result.setMessage(message);
        result.setTimestamp(System.currentTimeMillis());
        return result;
    }
}
```

## Spring MVC 标准异常映射

`DefaultHandlerExceptionResolver` 会自动处理 Spring MVC 的标准异常：

| 异常 | HTTP 状态码 |
|-----|------------|
| `HttpRequestMethodNotSupportedException` | 405 |
| `HttpMediaTypeNotSupportedException` | 415 |
| `HttpMediaTypeNotAcceptableException` | 406 |
| `MissingPathVariableException` | 500 |
| `MissingServletRequestParameterException` | 400 |
| `NoHandlerFoundException` | 404 |
| `AsyncRequestTimeoutException` | 503 |

需要在配置中启用 404 异常抛出：

```yaml
# application.yml
spring:
  mvc:
    throw-exception-if-no-handler-found: true
  web:
    resources:
      add-mappings: false  # 禁用静态资源映射
```

## 异常处理顺序

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         异常处理顺序                                      │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. @ControllerAdvice 中的 @ExceptionHandler（按方法声明顺序匹配）        │
│         │                                                               │
│         ▼                                                               │
│  2. Controller 中的 @ExceptionHandler                                   │
│         │                                                               │
│         ▼                                                               │
│  3. @ResponseStatus 注解的异常                                          │
│         │                                                               │
│         ▼                                                               │
│  4. DefaultHandlerExceptionResolver（Spring 标准异常）                   │
│         │                                                               │
│         ▼                                                               │
│  5. 最后兜底：Tomcat 默认错误页面                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试追问

**Q1: @ExceptionHandler 和 @ControllerAdvice 的区别？**

- `@ExceptionHandler`：处理单个 Controller 中的异常
- `@ControllerAdvice`：全局异常处理，可以处理所有 Controller 的异常

`@ControllerAdvice` 底层就是多个 `@ExceptionHandler` 的集合。

**Q2: 如何实现异常日志记录和报警？**

```java
@ExceptionHandler(Exception.class)
public Result&lt;?&gt; handleException(Exception e) {
    // 记录日志
    log.error("系统异常", e);
    
    // 发送告警（可以用钉钉、企微等）
    alertService.sendAlert("系统异常", e.getMessage(), e);
    
    return Result.error(500, "系统繁忙");
}
```

**Q3: 如何获取原始请求路径用于日志？**

```java
@ExceptionHandler(Exception.class)
public Result&lt;?&gt; handleException(Exception e, HttpServletRequest request) {
    String uri = request.getRequestURI();
    String method = request.getMethod();
    String queryString = request.getQueryString();
    
    log.error("请求 {} {} 异常: {}", method, uri, e.getMessage());
    return Result.error(500, "系统错误");
}
```

**Q4: 为什么有时候异常处理不生效？**

常见原因：
1. 异常在 Filter 中抛出（不在 Controller 层）
2. 异常被 try-catch 吞掉了
3. 异步方法抛出的异常无法被 @ExceptionHandler 捕获

---

**下节预告**：[文件上传与下载实现](/framework/spring/file-upload) —— 掌握 Spring MVC 的文件上传配置和 MultipartFile 的使用。
