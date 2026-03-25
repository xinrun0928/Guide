# 拦截器与过滤器：请求处理的利器

你有没有想过，一个请求从发起到响应，都经历了什么？

```
浏览器 → Nginx → Tomcat → Filter → Interceptor → Controller → Interceptor → Filter → 浏览器
```

过滤器（Filter）和拦截器（Interceptor）是处理请求的重要环节。

这一节，我们来深入理解它们的区别和使用场景。

## Filter vs Interceptor vs AOP

```
┌─────────────────────────────────────────────────────────────────┐
│                    Spring 请求处理流程                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                      Servlet 容器                         │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │                    Filter（过滤器）                 │ │   │
│  │  │   ├── 初始化参数                                  │ │   │
│  │  │   ├── 编码处理                                    │ │   │
│  │  │   ├── 安全校验                                    │ │   │
│  │  │   ├── CORS                                       │ │   │
│  │  │   └── 请求日志                                    │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                    │
│                              ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  Spring MVC                                │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │                 Interceptor（拦截器）               │ │   │
│  │  │   ├── 登录验证                                    │ │   │
│  │  │   ├── 权限校验                                    │ │   │
│  │  │   ├── 性能监控                                    │ │   │
│  │  │   └── 参数绑定                                    │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  │  ┌──────────────────────────────────────────────────┐ │   │
│  │  │                 Controller                        │ │   │
│  │  │   └── 业务处理                                    │ │   │
│  │  └──────────────────────────────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Filter（过滤器）

### 基本概念

Filter 是 Servlet 规范的一部分，工作在 Servlet 容器层，可以拦截所有请求。

### 实现方式

#### 方式一：实现 Filter 接口

```java
@Component
@Order(1)
public class LogFilter implements Filter {

    @Override
    public void init(FilterConfig filterConfig) throws ServletException {
        // 初始化
        System.out.println("LogFilter 初始化");
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        long startTime = System.currentTimeMillis();

        // 放行
        chain.doFilter(request, response);

        long endTime = System.currentTimeMillis();

        // 记录日志
        System.out.println(httpRequest.getRequestURI() + " 耗时: " + (endTime - startTime) + "ms");
    }

    @Override
    public void destroy() {
        // 销毁
        System.out.println("LogFilter 销毁");
    }
}
```

#### 方式二：@WebFilter 注解（Servlet 3.0+）

```java
@WebFilter(urlPatterns = "/api/*", filterName = "authFilter")
public class AuthFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;

        // 验证逻辑
        if (validateToken(httpRequest)) {
            chain.doFilter(request, response);
        } else {
            HttpServletResponse httpResponse = (HttpServletResponse) response;
            httpResponse.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        }
    }
}
```

需要配合 `@ServletComponentScan` 使用：

```java
@SpringBootApplication
@ServletComponentScan("com.example.filter")
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
```

### Filter 链执行顺序

```
请求 → Filter1.doFilter() → Filter2.doFilter() → ... → Servlet
       ↑                              ↑
       │                              │
       │        Filter2 处理完成        │
       │                              │
       │        Filter1 处理完成        │
响应 ← ───────────────────────────────┘
```

- `@Order` 注解决定顺序，值越小越先执行
- Filter 链的执行顺序与 `@Order` 顺序相反

## Interceptor（拦截器）

### 基本概念

Interceptor 是 Spring MVC 提供的功能，只能拦截 Controller 请求。

### 实现方式

#### 实现 HandlerInterceptor 接口

```java
@Component
public class LoginInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                            Object handler) throws Exception {
        // Controller 执行前调用
        // 返回 true：继续执行
        // 返回 false：中断请求

        String token = request.getHeader("Authorization");
        if (validateToken(token)) {
            return true;
        }

        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        return false;
    }

    @Override
    public void postHandle(HttpServletRequest request, HttpServletResponse response,
                           Object handler, ModelAndView modelAndView) throws Exception {
        // Controller 执行后，视图渲染前调用
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) throws Exception {
        // 请求完成后调用（无论是否异常）
    }
}
```

#### 注册拦截器

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Autowired
    private LoginInterceptor loginInterceptor;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(loginInterceptor)
                .addPathPatterns("/api/**")           // 拦截的路径
                .excludePathPatterns("/api/login",    // 排除的路径
                                     "/api/public/**",
                                     "/api/health");
    }
}
```

### Interceptor 执行流程

```
请求 → preHandle() ──→ Controller ──→ postHandle() ──→ afterCompletion()
          │              (执行)           │                │
          │               │               │                │
          ▼               ▼               ▼                ▼
      返回 true        执行完毕         视图渲染前        请求完成
      继续执行
```

## Filter vs Interceptor 对比

| 维度 | Filter | Interceptor |
|-----|--------|-------------|
| 归属 | Servlet 规范 | Spring MVC |
| 作用范围 | 所有请求 | Controller 请求 |
| 实现 | 实现 Filter 接口 | 实现 HandlerInterceptor |
| 依赖 | Servlet API | Spring 容器 |
| 执行顺序 | @Order | addInterceptors 顺序 |
| 参数 | FilterConfig | HandlerMethod |

## 实战案例

### 案例一：请求日志

```java
@Component
@Order(1)
public class RequestLogFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;

        long startTime = System.currentTimeMillis();

        try {
            chain.doFilter(request, response);
        } finally {
            long cost = System.currentTimeMillis() - startTime;
            System.out.println(String.format("[%s] %s %s - %dms",
                httpRequest.getMethod(),
                httpRequest.getRequestURI(),
                httpRequest.getQueryString(),
                cost));
        }
    }
}
```

### 案例二：登录验证

```java
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                            Object handler) throws Exception {
        String token = request.getHeader("Authorization");

        if (StringUtils.isBlank(token)) {
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"msg\":\"未登录\"}");
            return false;
        }

        // 验证 token
        User user = jwtUtil.validateToken(token);
        if (user == null) {
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write("{\"code\":401,\"msg\":\"token无效\"}");
            return false;
        }

        // 将用户信息存入 request
        request.setAttribute("currentUser", user);
        return true;
    }
}
```

### 案例三：性能监控

```java
@Component
public class PerformanceInterceptor implements HandlerInterceptor {

    private static final ThreadLocal<Long> START_TIME = new ThreadLocal<>();

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                            Object handler) throws Exception {
        START_TIME.set(System.currentTimeMillis());
        return true;
    }

    @Override
    public void postHandle(HttpServletRequest request, HttpServletResponse response,
                           Object handler, ModelAndView modelAndView) throws Exception {
        long cost = System.currentTimeMillis() - START_TIME.get();
        System.out.println("处理耗时: " + cost + "ms");

        if (cost > 3000) {
            System.out.println("警告：请求处理超过 3 秒！");
        }
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) throws Exception {
        START_TIME.remove();
    }
}
```

## 注意事项

### Filter 中获取 Spring Bean

```java
@Component
@Order(1)
public class SpringAwareFilter implements Filter {

    @Autowired
    private SomeService someService;

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                        FilterChain chain) throws IOException, ServletException {
        // 直接使用 @Autowired 注入的 Bean
        someService.doSomething();
        chain.doFilter(request, response);
    }
}
```

### Interceptor 中获取请求参数

```java
@Override
public boolean preHandle(HttpServletRequest request, HttpServletResponse response,
                        Object handler) throws Exception {
    // GET 参数
    String id = request.getParameter("id");

    // POST 参数（需要先读取 Body）
    ContentCachingRequestWrapper wrappedRequest = new ContentCachingRequestWrapper(request);

    // 或者使用 @RequestBody 之前拦截
    return true;
}
```

### Filter 和 Interceptor 混用

```java
// Filter1 → Filter2 → Interceptor1 → Controller
//        ←        ←          ←
// Filter 可以处理所有请求，包括静态资源
// Interceptor 只处理 Controller 请求
```

---

## 面试高频问题

### Q1：Filter 和 Interceptor 的区别？

Filter 是 Servlet 规范，作用于所有请求；Interceptor 是 Spring MVC，作用于 Controller 请求。

### Q2：执行顺序？

Filter 链由 `@Order` 控制，先执行的 Filter 后响应回来；Interceptor 的 `preHandle` 正序，`postHandle` 和 `afterCompletion` 逆序。

### Q3：如何选择？

需要处理所有请求用 Filter（编码、CORS、日志）；只需处理 Controller 请求用 Interceptor（登录、权限、性能监控）。

---

## 最佳实践

1. **编码处理用 Filter**：在所有请求进入前处理
2. **登录验证用 Interceptor**：在 Controller 前验证
3. **日志记录用 Filter**：记录所有请求
4. **性能监控用 Interceptor**：针对 Controller 请求监控
5. **注意线程安全**：使用 ThreadLocal 存储请求级数据

---

## 思考题

如果你需要在 Filter 中获取登录用户信息，Filter 在 Interceptor 之前执行，应该怎么设计？

下一节，我们学习 [WebSocket 整合](/framework/springboot/websocket)，实现实时通信。
