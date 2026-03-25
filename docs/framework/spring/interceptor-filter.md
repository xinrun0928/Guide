# HandlerInterceptor 与 Filter 对比

工作中，你可能会遇到这样的困惑：
- 登录校验应该用 Filter 还是 Interceptor？
- 请求日志记录用哪个更合适？
- 统一异常处理用 Filter 还是 @ExceptionHandler？

要回答这些问题，首先得理解两者的区别。

## 先看一个场景

假设我们要实现一个登录拦截功能，需求是：
- `/api/**` 路径下的请求需要登录才能访问
- 未登录返回 401

用两种方式实现，你看看区别在哪里：

### 方式一：Filter 实现

```java
// 方式一：Filter（Servlet 规范）
@WebFilter(urlPatterns = "/api/**")
public class LoginFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest req = (HttpServletRequest) request;
        HttpServletResponse resp = (HttpServletResponse) response;
        
        String token = req.getHeader("Authorization");
        if (token == null || !validateToken(token)) {
            resp.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            resp.getWriter().write("{\"error\": \"未登录\"}");
            return;
        }
        
        chain.doFilter(request, response);  // 继续执行
    }
}
```

### 方式二：Interceptor 实现

```java
// 方式二：Interceptor（Spring MVC 组件）
@Component
public class LoginInterceptor implements HandlerInterceptor {
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response,
                            Object handler) throws Exception {
        String token = request.getHeader("Authorization");
        if (token == null || !validateToken(token)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.getWriter().write("{\"error\": \"未登录\"}");
            return false;  // 返回 false，拦截请求
        }
        return true;  // 返回 true，继续执行
    }
}
```

看起来很像，但区别很大。

## 核心区别

| 维度 | Filter | HandlerInterceptor |
|-----|--------|-------------------|
| **所属规范** | Servlet 规范 | Spring MVC 组件 |
| **执行位置** | DispatcherServlet **之前** | DispatcherServlet **内部** |
| **配置方式** | `@WebFilter` 或 `FilterRegistrationBean` | 实现 `WebMvcConfigurer` 或 XML 配置 |
| **参数** | 只能拿到 `ServletRequest/Response` | 额外拿到 `Handler`（Controller 方法信息） |
| **依赖 Spring** | 不依赖 Spring IOC | 依赖 Spring 容器（可注入 Bean） |
| **使用场景** | 字符编码过滤、安全过滤（如 XSS、CSRF） | 登录校验、权限校验、审计日志 |
| **异常处理** | 必须在 Filter 内部 try-catch | 可以交给 `@ExceptionHandler` |

## 执行顺序对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         请求处理顺序图                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. Filter 1                                                           │
│  2. Filter 2                                                           │
│  3. Filter 3                                                           │
│         │                                                               │
│         ▼                                                               │
│  4. DispatcherServlet                                                  │
│         │                                                               │
│         ▼                                                               │
│  5. HandlerInterceptor.preHandle()                                     │
│         │                                                               │
│         ▼                                                               │
│  6. Controller 执行                                                     │
│         │                                                               │
│         ▼                                                               │
│  7. HandlerInterceptor.postHandle()                                    │
│         │                                                               │
│         ▼                                                               │
│  8. View 渲染                                                           │
│         │                                                               │
│         ▼                                                               │
│  9. HandlerInterceptor.afterCompletion()                                │
│         │                                                               │
│  ┌──────┴──────┐                                                        │
│  │              │                                                        │
│  ▼              ▼                                                        │
│ 正常返回        异常发生                                                  │
│              ▼                                                           │
│         @ExceptionHandler 处理                                            │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Filter 的三个时机

```java
public interface Filter {
    // 初始化时机（在服务器启动时调用一次）
    default void init(FilterConfig filterConfig) throws ServletException {}
    
    // 处理请求的时机
    void doFilter(ServletRequest request, ServletResponse response,
                  FilterChain chain) throws IOException, ServletException;
    
    // 销毁时机（在服务器关闭时调用一次）
    default void destroy() {}
}
```

### Interceptor 的三个时机

```java
public interface HandlerInterceptor {
    // Controller 执行之前
    default boolean preHandle(HttpServletRequest request, 
                               HttpServletResponse response,
                               Object handler) throws Exception {
        return true;
    }
    
    // Controller 执行之后，视图渲染之前
    default void postHandle(HttpServletRequest request, 
                            HttpServletResponse response,
                            Object handler,
                            ModelAndView modelAndView) throws Exception {
    }
    
    // 视图渲染之后（无论成功或异常都会执行）
    default void afterCompletion(HttpServletRequest request, 
                                  HttpServletResponse response,
                                  Object handler,
                                  Exception ex) throws Exception {
    }
}
```

## 典型使用场景

### Filter 适用场景

#### 1. 字符编码过滤

```java
// 字符编码过滤器（Spring Boot 已自动配置）
@WebFilter(urlPatterns = "/*")
public class CharacterEncodingFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        request.setCharacterEncoding("UTF-8");
        response.setCharacterEncoding("UTF-8");
        chain.doFilter(request, response);
    }
}
```

#### 2. XSS 攻击防护

```java
@WebFilter(urlPatterns = "/*")
public class XssFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        // 包装请求，对参数进行 XSS 过滤
        chain.doFilter(new XssHttpServletRequestWrapper((HttpServletRequest) request), 
                       response);
    }
}

// 包装器实现
public class XssHttpServletRequestWrapper extends HttpServletRequestWrapper {
    
    public XssHttpServletRequestWrapper(HttpServletRequest request) {
        super(request);
    }
    
    @Override
    public String getParameter(String name) {
        String value = super.getParameter(name);
        return XssUtils.escape(value);  // XSS 转义
    }
}
```

#### 3. CORS 跨域处理

```java
// CORS 过滤器（Spring Boot 也可以用 CorsFilter）
@WebFilter(urlPatterns = "/*")
public class CorsFilter implements Filter {
    
    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletResponse resp = (HttpServletResponse) response;
        resp.setHeader("Access-Control-Allow-Origin", "*");
        resp.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
        resp.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        resp.setHeader("Access-Control-Max-Age", "3600");
        
        chain.doFilter(request, response);
    }
}
```

### Interceptor 适用场景

#### 1. 登录状态校验

```java
@Component
public class AuthInterceptor implements HandlerInterceptor {
    
    @Autowired
    private UserService userService;
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                            HttpServletResponse response,
                            Object handler) throws Exception {
        String token = request.getHeader("Authorization");
        if (token == null || !userService.validateToken(token)) {
            response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\": 401, \"message\": \"请先登录\"}");
            return false;
        }
        return true;
    }
}
```

#### 2. 获取当前登录用户

```java
@Component
public class CurrentUserInterceptor implements HandlerInterceptor {
    
    @Override
    public void preHandle(HttpServletRequest request, 
                         HttpServletResponse response,
                         Object handler) throws Exception {
        String token = request.getHeader("Authorization");
        if (token != null) {
            User currentUser = userService.getCurrentUser(token);
            // 存到 ThreadLocal，供 Controller 使用
            UserContext.set(currentUser);
        }
    }
    
    @Override
    public void afterCompletion(HttpServletRequest request, 
                               HttpServletResponse response,
                               Object handler, Exception ex) {
        // 清理 ThreadLocal，防止内存泄漏
        UserContext.clear();
    }
}

// Controller 中使用
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping("/info")
    public Result&lt;User&gt; getCurrentUser() {
        User user = UserContext.get();  // 从 ThreadLocal 获取
        return Result.success(user);
    }
}
```

#### 3. 性能日志记录

```java
@Component
public class PerformanceInterceptor implements HandlerInterceptor {
    
    private static final Logger log = LoggerFactory.getLogger(PerformanceInterceptor.class);
    private static final ThreadLocal&lt;Long&gt; startTime = new ThreadLocal&lt;&gt;();
    
    @Override
    public boolean preHandle(HttpServletRequest request, 
                             HttpServletResponse response,
                             Object handler) throws Exception {
        startTime.set(System.currentTimeMillis());
        return true;
    }
    
    @Override
    public void postHandle(HttpServletRequest request, 
                          HttpServletResponse response,
                          Object handler,
                          ModelAndView modelAndView) throws Exception {
        long elapsed = System.currentTimeMillis() - startTime.get();
        String uri = request.getRequestURI();
        String method = handler instanceof HandlerMethod 
            ? ((HandlerMethod) handler).getShortLogMessage() 
            : handler.toString();
        
        log.info("请求: {} {} 耗时: {}ms", method, uri, elapsed);
        
        // 慢请求告警
        if (elapsed &gt; 3000) {
            log.warn("慢请求告警: {} 耗时 {}ms", uri, elapsed);
        }
    }
    
    @Override
    public void afterCompletion(HttpServletRequest request, 
                               HttpServletResponse response,
                               Object handler, Exception ex) {
        startTime.remove();  // 清理 ThreadLocal
    }
}
```

## 配置方式

### Filter 配置

```java
// Spring Boot 方式
@Configuration
public class FilterConfig {
    
    @Bean
    public FilterRegistrationBean&lt;LoginFilter&gt; loginFilter() {
        FilterRegistrationBean&lt;LoginFilter&gt; registration = new FilterRegistrationBean&lt;&gt;();
        registration.setFilter(new LoginFilter());
        registration.addUrlPatterns("/api/*");
        registration.setOrder(1);  // 执行顺序，数字越小越先执行
        return registration;
    }
}
```

### Interceptor 配置

```java
// 实现 WebMvcConfigurer
@Configuration
public class WebConfig implements WebMvcConfigurer {
    
    @Autowired
    private AuthInterceptor authInterceptor;
    
    @Autowired
    private PerformanceInterceptor performanceInterceptor;
    
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(performanceInterceptor)
            .addPathPatterns("/**")  // 拦截所有请求
            .excludePathPatterns("/static/**", "/favicon.ico");  // 排除静态资源
        
        registry.addInterceptor(authInterceptor)
            .addPathPatterns("/api/**")  // 只拦截 /api/** 路径
            .excludePathPatterns("/api/login", "/api/register");  // 排除登录和注册
    }
}
```

## 完整执行流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         完整请求处理流程                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  请求 ──► Filter 1.doFilter()                                           │
│                │                                                        │
│                ▼                                                        │
│          Filter 2.doFilter()                                           │
│                │                                                        │
│                ▼                                                        │
│          Filter 3.doFilter()                                            │
│                │                                                        │
│                ▼                                                        │
│          DispatcherServlet.service()                                    │
│                │                                                        │
│                ▼                                                        │
│          HandlerInterceptor.preHandle() ──► false ──► 返回 403          │
│                │                     │                                 │
│                │ (返回 true)          │                                 │
│                ▼                                                        │
│          Controller 方法执行                                             │
│                │                                                        │
│                ▼                                                        │
│          HandlerInterceptor.postHandle()                                 │
│                │                                                        │
│                ▼                                                        │
│          View 渲染（如果有）                                              │
│                │                                                        │
│                ▼                                                        │
│          异常处理（如果有）                                               │
│                │                                                        │
│                ▼                                                        │
│          HandlerInterceptor.afterCompletion()                            │
│                │                                                        │
│                ▼                                                        │
│          Filter 3.doFilter() 继续执行（如果有 FilterChain 后续 Filter）   │
│                │                                                        │
│                ▼                                                        │
│          Filter 2.doFilter() 继续执行                                    │
│                │                                                        │
│                ▼                                                        │
│          Filter 1.doFilter() 继续执行                                    │
│                │                                                        │
│                ▼                                                        │
│          响应返回                                                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 面试追问

**Q1: Filter 和 Interceptor 都能做登录校验，选哪个？**

优先选 **Interceptor**，因为：
1. Interceptor 可以拿到 Controller 方法信息（`HandlerMethod`），知道是哪个方法被调用
2. Interceptor 可以操作 ModelAndView
3. Interceptor 可以利用 Spring 的依赖注入

但如果要做全局安全过滤（不只是 Spring MVC，比如静态资源也过滤），用 **Filter**。

**Q2: Interceptor 的 preHandle 返回 false 后，会发生什么？**

- Controller 不会执行
- postHandle 不会执行
- afterCompletion **会执行**（注意这个坑！）

这意味着如果 preHandle 中打开了资源（如数据库连接），必须在 afterCompletion 中关闭。

**Q3: 拦截器和过滤器哪个性能更好？**

性能差异不大，但如果请求不需要 Spring MVC 处理（如静态资源），Filter 会在 DispatcherServlet 之前拦截，可以更早结束请求。

**Q4: 如何在 Interceptor 中获取 Controller 的方法名？**

```java
@Override
public boolean preHandle(HttpServletRequest request, 
                        HttpServletResponse response,
                        Object handler) throws Exception {
    if (handler instanceof HandlerMethod) {
        HandlerMethod handlerMethod = (HandlerMethod) handler;
        String methodName = handlerMethod.getMethod().getName();  // 方法名
        String className = handlerMethod.getBeanType().getSimpleName();  // 类名
        Class&lt;?&gt;[] paramTypes = handlerMethod.getMethod().getParameterTypes();  // 参数类型
    }
    return true;
}
```

---

**下节预告**：[参数绑定：@RequestParam、@RequestBody、@PathVariable](/framework/spring/param-binding) —— 深入理解 Spring MVC 如何将 HTTP 请求参数绑定到 Controller 方法参数。
