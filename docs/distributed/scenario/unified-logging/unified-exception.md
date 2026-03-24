# 微服务统一异常处理：全局异常码 + 标准化响应体

你有没有遇到过这种情况：

微服务 A 返回 `{"code": 0, "msg": "成功"}`

微服务 B 返回 `{"status": "ok", "message": "操作成功"}`

微服务 C 返回 `{"success": true, "errorMsg": ""}`

你的前端需要为每个服务写不同的解析逻辑。

这就是微服务异常处理的痛点：**各服务返回格式不统一**。

## 统一响应体结构

```java
@Data
public class ApiResponse&lt;T&gt; {
    private int code;          // 业务状态码
    private String message;    // 状态描述
    private T data;           // 响应数据
    private String traceId;   // 链路追踪 ID

    public static &lt;T&gt; ApiResponse&lt;T&gt; success(T data) {
        ApiResponse&lt;T&gt; response = new ApiResponse&lt;&gt;();
        response.setCode(200);
        response.setMessage("success");
        response.setData(data);
        response.setTraceId(Tracer.getTraceId());
        return response;
    }

    public static &lt;T&gt; ApiResponse&lt;T&gt; error(int code, String message) {
        ApiResponse&lt;T&gt; response = new ApiResponse&lt;&gt;();
        response.setCode(code);
        response.setMessage(message);
        response.setTraceId(Tracer.getTraceId());
        return response;
    }
}
```

## 全局异常码设计

```java
public interface ErrorCode {
    // 系统级异常（1xxx）
    int SYSTEM_ERROR = 1001;      // 系统异常
    int PARAM_ERROR = 1002;        // 参数错误
    int UNAUTHORIZED = 1003;       // 未授权
    int FORBIDDEN = 1004;          // 禁止访问

    // 业务级异常（2xxx）
    int USER_NOT_FOUND = 2001;     // 用户不存在
    int ORDER_NOT_FOUND = 2002;    // 订单不存在
    int STOCK_NOT_ENOUGH = 2003;   // 库存不足
}
```

## 全局异常处理器

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ApiResponse&lt;Void&gt; handleBusinessException(BusinessException e) {
        return ApiResponse.error(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse&lt;Void&gt; handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getFieldError().getDefaultMessage();
        return ApiResponse.error(ErrorCode.PARAM_ERROR, message);
    }

    @ExceptionHandler(Exception.class)
    public ApiResponse&lt;Void&gt; handleException(Exception e) {
        // 记录异常日志
        log.error("系统异常", e);
        return ApiResponse.error(ErrorCode.SYSTEM_ERROR, "系统异常，请稍后重试");
    }
}
```

## 跨服务异常传递

当一个微服务调用另一个微服务时，异常信息如何传递？

```java
@FeignClient(name = "user-service")
public interface UserClient {

    @GetMapping("/user/{id}")
    ApiResponse&lt;User&gt; getUser(@PathVariable Long id);
}
```

### Feign 拦截器

```java
@Component
public class FeignErrorDecoder implements ErrorDecoder {

    @Override
    public Exception decode(String methodKey, Response response) {
        try {
            if (response.status() >= 400) {
                String body = IOUtils.toString(response.body().asInputStream());
                ApiResponse&lt;?&gt; apiResponse = objectMapper.readValue(body, ApiResponse.class);
                return new BusinessException(apiResponse.getCode(), apiResponse.getMessage());
            }
        } catch (Exception e) {
            log.error("解析响应失败", e);
        }
        return new BusinessException(ErrorCode.SYSTEM_ERROR, "服务调用失败");
    }
}
```

## 面试追问方向

- 为什么需要统一的异常码？（答：前端统一解析、微服务间通信、日志分析）
- 如何设计异常码体系？（答：分层设计、系统级 + 业务级、预留扩展空间）
- 全局异常处理器能捕获异步异常吗？（答：不能，需要用 CompletableFuture.exceptionally()）
- 异常信息中放什么？（答：错误码、用户友好信息、TraceId）

## 小结

微服务异常处理需要统一标准：

1. **统一响应体**：所有服务返回相同格式
2. **全局异常处理器**：集中处理各类异常
3. **跨服务异常传递**：Feign 拦截器解码异常
4. **链路追踪**：异常信息带上 TraceId

统一异常处理是微服务间通信的基础。
