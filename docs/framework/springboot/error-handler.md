# Spring Boot 异常处理

你有没有遇到过这种情况：代码抛了异常，返回给前端的是一个看不懂的错误页面？

这是因为你没有正确配置异常处理。

Spring Boot 提供了一套完整的异常处理机制，让你可以优雅地处理各种异常，返回用户友好的错误信息。

## 默认异常处理

Spring Boot 默认提供了一个「白标错误页面」（Whitelabel Error Page）：

```html
<h1>Whitelabel Error Page</h1>
<p>This application has no explicit mapping for /error, so you are seeing this.</p>
```

这个页面既不美观，也没有返回有意义的信息。我们需要自定义异常处理。

## 全局异常处理：@ControllerAdvice

### 基础用法

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @ExceptionHandler(Exception.class)
    public Result&lt;Void&gt; handleException(Exception e) {
        return Result.fail(500, "服务器内部错误");
    }
    
    @ExceptionHandler(BusinessException.class)
    public Result&lt;Void&gt; handleBusinessException(BusinessException e) {
        return Result.fail(e.getCode(), e.getMessage());
    }
    
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result&lt;Void&gt; handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldError().getDefaultMessage();
        return Result.fail(400, message);
    }
}
```

### 统一响应格式

```java
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
    
    public static &lt;T&gt; Result&lt;T&gt; fail(int code, String message) {
        Result&lt;T&gt; result = new Result&lt;&gt;();
        result.setCode(code);
        result.setMessage(message);
        result.setTimestamp(System.currentTimeMillis());
        return result;
    }
}
```

## 异常分类处理

### 业务异常

```java
public class BusinessException extends RuntimeException {
    private final int code;
    
    public BusinessException(int code, String message) {
        super(message);
        this.code = code;
    }
    
    public int getCode() {
        return code;
    }
}
```

```java
@Service
public class UserService {
    
    public User findById(Long id) {
        User user = userRepository.findById(id)
            .orElseThrow(() -> new BusinessException(404, "用户不存在"));
        return user;
    }
}
```

### 参数校验异常

```java
@PostMapping("/user")
public Result&lt;Void&gt; createUser(@Valid @RequestBody UserRequest request) {
    // @Valid 触发校验，异常由 GlobalExceptionHandler 处理
    userService.create(request);
    return Result.success(null);
}
```

```java
@RestControllerAdvice
public class ValidationExceptionHandler {
    
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public Result&lt;Void&gt; handleValidationException(MethodArgumentNotValidException e) {
        StringBuilder message = new StringBuilder();
        for (FieldError error : e.getBindingResult().getFieldErrors()) {
            message.append(error.getField())
                   .append(": ")
                   .append(error.getDefaultMessage())
                   .append("; ");
        }
        return Result.fail(400, message.toString());
    }
    
    @ExceptionHandler(ConstraintViolationException.class)
    public Result&lt;Void&gt; handleConstraintViolation(ConstraintViolationException e) {
        String message = e.getConstraintViolations().stream()
            .map(ConstraintViolation::getMessage)
            .collect(Collectors.joining("; "));
        return Result.fail(400, message);
    }
}
```

### 404 异常

```java
@RestControllerAdvice
public class NotFoundExceptionHandler {
    
    @ExceptionHandler(NoHandlerFoundException.class)
    public Result&lt;Void&gt; handleNoHandlerFoundException(NoHandlerFoundException e) {
        return Result.fail(404, "接口不存在: " + e.getRequestURL());
    }
    
    @ExceptionHandler(NoResourceFoundException.class)
    public Result&lt;Void&gt; handleNoResourceFoundException(NoResourceFoundException e) {
        return Result.fail(404, "资源不存在: " + e.getResourcePath());
    }
}
```

需要开启 `spring.mvc.throw-exception-if-no-handler-found=true` 和 `spring.web.resources.add-mappings=false`。

## @ExceptionHandler 详解

### 指定异常类型

```java
@ExceptionHandler(value = {BusinessException.class, ValidationException.class})
public Result&lt;Void&gt; handleException(Exception e) {
    // ...
}
```

### 获取异常信息

```java
@ExceptionHandler(Exception.class)
public Result&lt;Void&gt; handleException(Exception e, HttpServletRequest request) {
    String uri = request.getRequestURI();
    String message = e.getMessage();
    log.error("Request {} failed: {}", uri, message, e);
    return Result.fail(500, message);
}
```

### 返回不同视图

如果是 Thymeleaf 等模板引擎，可以返回 ModelAndView：

```java
@ExceptionHandler(Exception.class)
public ModelAndView handleException(Exception e) {
    ModelAndView mav = new ModelAndView("error");
    mav.addObject("message", e.getMessage());
    mav.addObject("exception", e);
    return mav;
}
```

## ErrorController

对于非 Controller 层抛出的异常，需要通过 ErrorController 处理。

### 实现 ErrorController

```java
@RestController
public class CustomErrorController implements ErrorAttributes, ErrorController {
    
    private static final String ERROR_PATH = "/error";
    
    @Autowired
    private ErrorAttributes errorAttributes;
    
    @Override
    public String getErrorPath() {
        return ERROR_PATH;
    }
    
    @RequestMapping(ERROR_PATH)
    public Result&lt;Void&gt; error(HttpServletRequest request) {
        Integer status = (Integer) request.getAttribute("jakarta.servlet.error.status_code");
        String message = (String) request.getAttribute("jakarta.servlet.error.message");
        String path = (String) request.getAttribute("jakarta.servlet.error.request_uri");
        
        if (message == null || message.isEmpty()) {
            message = "Unknown error";
        }
        
        return Result.fail(status != null ? status : 500, message);
    }
}
```

### 自定义错误页面

```yaml
server:
  error:
    path: /error
    include-message: always
    include-binding-errors: always
    include-exception: true
    include-stacktrace: never
```

## 异常处理流程

```
请求进入
    ↓
Controller 方法执行
    ↓
抛出异常？
    ↓ 是
@ControllerAdvice @ExceptionHandler 处理
    ↓
返回统一响应格式
    ↓
请求进入
    ↓
无 Handler 处理
    ↓
ErrorController 处理
    ↓
返回错误页面/响应
```

## 注解详解

### @ResponseStatus

直接标注异常类，指定 HTTP 状态码：

```java
@ResponseStatus(HttpStatus.NOT_FOUND)
public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) {
        super(message);
    }
}
```

### @Status

配合 @ExceptionHandler 使用：

```java
@ExceptionHandler(ResourceNotFoundException.class)
@ResponseStatus(HttpStatus.NOT_FOUND)
public void handleNotFound(ResourceNotFoundException e) {
    // Spring Boot 会自动返回 404 状态码
}
```

## 生产环境异常处理

### 区分环境

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    @Value("${spring.profiles.active}")
    private String profile;
    
    @ExceptionHandler(Exception.class)
    public Result&lt;Void&gt; handleException(Exception e) {
        if ("dev".equals(profile)) {
            // 开发环境：返回详细信息
            Map&lt;String, Object&gt; details = new HashMap&lt;&gt;();
            details.put("message", e.getMessage());
            details.put("stackTrace", Arrays.stream(e.getStackTrace())
                .map(StackTraceElement::toString)
                .limit(10)
                .collect(Collectors.toList()));
            return Result.fail(500, "开发环境错误", details);
        } else {
            // 生产环境：只返回简要信息
            return Result.fail(500, "服务器内部错误");
        }
    }
}
```

### 日志记录

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    
    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);
    
    @ExceptionHandler(Exception.class)
    public Result&lt;Void&gt; handleException(Exception e, HttpServletRequest request) {
        // 记录完整异常信息
        log.error("Request {} failed", request.getRequestURI(), e);
        
        // 记录关键信息
        String message = String.format("请求 %s 失败: %s", 
            request.getRequestURI(), e.getMessage());
        log.error(message);
        
        return Result.fail(500, "服务器内部错误");
    }
}
```

## 常见异常处理场景

### 文件上传异常

```java
@ExceptionHandler(MaxUploadSizeExceededException.class)
public Result&lt;Void&gt; handleMaxUploadSizeExceeded(MaxUploadSizeExceededException e) {
    return Result.fail(413, "文件大小超过限制，最大支持 " + MAX_FILE_SIZE + "MB");
}

@ExceptionHandler(IOException.class)
public Result&lt;Void&gt; handleIOException(IOException e) {
    if (e instanceof DiskSpaceExhaustedException) {
        return Result.fail(507, "存储空间不足");
    }
    return Result.fail(500, "文件上传失败");
}
```

### 数据库异常

```java
@ExceptionHandler(DataAccessException.class)
public Result&lt;Void&gt; handleDataAccessException(DataAccessException e) {
    if (e.getRootCause() instanceof DataIntegrityViolationException) {
        return Result.fail(400, "数据保存失败，可能违反数据完整性约束");
    }
    if (e.getRootCause() instanceof DuplicateKeyException) {
        return Result.fail(400, "数据已存在，违反唯一性约束");
    }
    return Result.fail(500, "数据库操作失败");
}
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| @ControllerAdvice 和 @RestControllerAdvice 的区别？ | 注解作用 |
| @ExceptionHandler 的执行顺序？ | 异常处理流程 |
| @ExceptionHandler 和 ErrorController 的区别？ | 异常处理层次 |
| 如何区分处理不同类型的异常？ | 异常分类 |
| 如何在异常处理中记录日志？ | 生产实践 |

---

> 好的异常处理，不是让用户看到「服务器错误」四个字，而是让用户知道发生了什么、该怎么做。同时，异常信息也要记录下来，方便排查。
