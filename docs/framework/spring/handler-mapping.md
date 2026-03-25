# HandlerMapping 与 HandlerAdapter

想象一下：你要寄一个快递，快递员需要知道两个信息：
1. 这个快递送到哪里（地址）？
2. 这个快递用什么方式送（飞机、火车、汽车）？

在 Spring MVC 中：
- **HandlerMapping** 就是「地址本」，告诉系统「这个请求该由谁处理」
- **HandlerAdapter** 就是「交通工具」，告诉系统「用什么方式处理」

## HandlerMapping：请求的「地址本」

### 接口定义

```java
public interface HandlerMapping {
    // 根据请求获取处理器执行链
    HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception;
}
```

返回的 `HandlerExecutionChain` 包含：
- 处理器对象（Controller）
- 拦截器列表

### HandlerExecutionChain

```java
public class HandlerExecutionChain {
    private final Object handler;  // 处理器，可能是 Controller 或 HandlerMethod
    private final List&lt;HandlerInterceptor&gt; interceptorList = new ArrayList&lt;&gt;();
    
    // 关键方法
    boolean applyPreHandle(HttpServletRequest, HttpServletResponse) throws Exception;
    void applyPostHandle(HttpServletRequest, HttpServletResponse, ModelAndView) throws Exception;
    void triggerAfterCompletion(HttpServletRequest, HttpServletResponse, Exception ex);
}
```

### 多种 HandlerMapping 实现

| 实现类 | 工作方式 | 使用场景 |
|-------|---------|---------|
| `RequestMappingHandlerMapping` | 扫描 `@RequestMapping` | **最常用**，基于注解的 URL 映射 |
| `BeanNameUrlHandlerMapping` | Bean 名称作为 URL | 简单的 Controller |
| `SimpleUrlHandlerMapping` | 配置文件定义映射 | 需要显式配置的旧项目 |
| `ControllerClassNameHandlerMapping` | 类名自动映射 | RESTful API |

### RequestMappingHandlerMapping：注解驱动的映射

这是最常用的实现，它会扫描所有 `@Controller` 和 `@RequestMapping` 注解：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping("/{id}")
    public User getUser(@PathVariable Long id) { ... }
    
    @PostMapping
    public User createUser(@RequestBody User user) { ... }
    
    @PutMapping("/{id}")
    public User updateUser(@PathVariable Long id, @RequestBody User user) { ... }
    
    @DeleteMapping("/{id}")
    public void deleteUser(@PathVariable Long id) { ... }
}
```

RequestMappingInfo 封装了映射信息：

```java
// RequestMappingInfo 封装了 @RequestMapping 的所有属性
public class RequestMappingInfo {
    private PatternsRequestCondition patternsCondition;  // URL 模式
    private RequestMethodsRequestCondition methodsCondition;  // HTTP 方法
    private ParamsRequestCondition paramsCondition;  // 请求参数
    private HeadersRequestCondition headersCondition;  // 请求头
    private ConsumesRequestCondition consumesCondition;  // 请求 Content-Type
    private ProducesRequestCondition producesCondition;  // 响应 Content-Type
    // ...
}
```

### BeanNameUrlHandlerMapping：简单场景

```xml
<!-- Spring XML 配置方式 -->
&lt;bean name="/hello" class="com.example.HelloController"/&gt;
&lt;bean name="/user/list" class="com.example.UserListController"/&gt;
```

```java
// Spring Boot 配置方式
@Configuration
public class WebConfig {
    @Bean("/simple")
    public Controller simpleController() {
        return (request, response) -&gt; {
            response.getWriter().write("Hello");
            return null;
        };
    }
}
```

### SimpleUrlHandlerMapping：显式配置

```java
@Configuration
public class UrlConfig {
    @Bean
    public SimpleUrlHandlerMapping handlerMapping() {
        SimpleUrlHandlerMapping mapping = new SimpleUrlHandlerMapping();
        Map&lt;String, Object&gt; urlMap = new HashMap&lt;&gt;();
        urlMap.put("/static/**", staticResourceHttpRequestHandler());
        urlMap.put("/favicon.ico", faviconRequestHandler());
        mapping.setUrlMap(urlMap);
        return mapping;
    }
    
    @Bean
    public StaticResourceHttpRequestHandler staticResourceHttpRequestHandler() {
        return new StaticResourceHttpRequestHandler();
    }
}
```

## HandlerAdapter：处理器的「适配器」

### 为什么需要 HandlerAdapter？

Controller 可以有多种写法：

```java
// 方式一：注解方式（最常用）
@Controller
public class AnnotatedController {
    @RequestMapping("/test")
    public String test() { return "test"; }
}

// 方式二：实现 Controller 接口
public class LegacyController implements Controller {
    @Override
    public ModelAndView handleRequest(HttpServletRequest request, 
                                       HttpServletResponse response) {
        return new ModelAndView("legacy");
    }
}

// 方式三：实现 HttpRequestHandler 接口
public class HttpHandlerController implements HttpRequestHandler {
    @Override
    public void handleRequest(HttpServletRequest request, 
                               HttpServletResponse response) {
        // 直接写入响应，无返回值
        response.getWriter().write("handled");
    }
}
```

HandlerAdapter 就是为了统一这些不同的处理方式。

### 接口定义

```java
public interface HandlerAdapter {
    // 判断是否支持这个处理器
    boolean supports(Object handler);
    
    // 执行处理器，返回 ModelAndView
    ModelAndView handle(HttpServletRequest request, 
                        HttpServletResponse response, 
                        Object handler) throws Exception;
}
```

### 四种内置 HandlerAdapter

| Adapter | 支持类型 | handle() 返回值 |
|---------|---------|----------------|
| `RequestMappingHandlerAdapter` | `@RequestMapping` 方法 | `ModelAndView` |
| `HttpRequestHandlerAdapter` | `HttpRequestHandler` | `null`（直接写响应） |
| `SimpleControllerHandlerAdapter` | `Controller` 接口 | `ModelAndView` |
| `HandlerFunctionAdapter` | 函数式 `HandlerFunction` | `ServerResponse` |

### RequestMappingHandlerAdapter：处理注解方法

这是最常用的适配器，处理 `@RequestMapping` 系列注解：

```java
// 核心调用链
public class RequestMappingHandlerAdapter extends AbstractHandlerMethodAdapter 
    implements BeanFactoryAware, InitializingBean {

    @Override
    protected ModelAndView handleInternal(HttpServletRequest request,
                                          HttpServletResponse response,
                                          HandlerMethod handlerMethod) throws Exception {
        
        // 1. 检查请求方法是否支持（GET/POST 等）
        if (getSessionAttributesHandler(handlerMethod).hasSessionAttributes() {
            checkRequiredAttributes(handlerMethod);
        }
        
        // 2. 执行处理器方法
        // 这里会处理参数绑定、返回值处理等
        Object result = invokeHandlerMethod(request, response, handlerMethod);
        
        // 3. 返回 ModelAndView
        return getModelAndView(mavContainer, getDataBinderFactory(handlerMethod), 
                               mavContainer.getModel());
    }
}
```

### SimpleControllerHandlerAdapter：处理 Controller 接口

```java
public class SimpleControllerHandlerAdapter implements HandlerAdapter {
    
    @Override
    public boolean supports(Object handler) {
        return (handler instanceof Controller);
    }

    @Override
    public ModelAndView handle(HttpServletRequest request,
                                HttpServletResponse response,
                                Object handler) throws Exception {
        // 直接调用 Controller 的 handleRequest 方法
        return ((Controller) handler).handleRequest(request, response);
    }
}
```

### HttpRequestHandlerAdapter：处理 HttpRequestHandler

```java
public class HttpRequestHandlerAdapter implements HandlerAdapter {
    
    @Override
    public boolean supports(Object handler) {
        return (handler instanceof HttpRequestHandler);
    }

    @Override
    public ModelAndView handle(HttpServletRequest request,
                               HttpServletResponse response,
                               Object handler) throws Exception {
        // 调用 handleRequest，但不返回 ModelAndView
        // 响应内容直接在方法内写入
        ((HttpRequestHandler) handler).handleRequest(request, response);
        return null;
    }
}
```

## 两者的配合流程

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      HandlerMapping + HandlerAdapter                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  请求: GET /api/users/123                                               │
│                                                                         │
│      │                                                                  │
│      ▼                                                                  │
│  ┌─────────────────────────────────────┐                               │
│  │  DispatcherServlet                  │                               │
│  │                                     │                               │
│  │  1. getHandler(request)             │                               │
│  └──────────────┬──────────────────────┘                               │
│                 │                                                        │
│                 ▼                                                        │
│  ┌─────────────────────────────────────┐                               │
│  │  HandlerMapping 遍历                │                               │
│  │                                     │                               │
│  │  RequestMappingHandlerMapping        │ ◄── 匹配 /api/users/{id}      │
│  │    └─&gt; 返回 HandlerExecutionChain    │                               │
│  │        (包含 UserController.getUser())│                               │
│  │                                     │                               │
│  └──────────────┬──────────────────────┘                               │
│                 │                                                        │
│                 ▼                                                        │
│  ┌─────────────────────────────────────┐                               │
│  │  DispatcherServlet                  │                               │
│  │                                     │                               │
│  │  2. getHandlerAdapter(handler)       │                               │
│  └──────────────┬──────────────────────┘                               │
│                 │                                                        │
│                 ▼                                                        │
│  ┌─────────────────────────────────────┐                               │
│  │  HandlerAdapter 遍历                 │                               │
│  │                                     │                               │
│  │  RequestMappingHandlerAdapter        │ ◄── supports(UserController) │
│  │    └─&gt; 返回 HandlerAdapter           │                               │
│  │                                     │                               │
│  └──────────────┬──────────────────────┘                               │
│                 │                                                        │
│                 ▼                                                        │
│  ┌─────────────────────────────────────┐                               │
│  │  DispatcherServlet                  │                               │
│  │                                     │                               │
│  │  3. adapter.handle(request, response, handler)                       │
│  │     └─&gt; 返回 ModelAndView            │                               │
│  │                                     │                               │
│  └─────────────────────────────────────┘                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 自定义 HandlerMapping

场景：需要基于请求头、参数等条件路由到不同的处理器。

```java
// 自定义 HandlerMapping：基于 API 版本
public class VersionBasedHandlerMapping implements HandlerMapping {
    
    @Override
    public HandlerExecutionChain getHandler(HttpServletRequest request) {
        String acceptHeader = request.getHeader("Accept");
        String path = request.getRequestURI();
        
        Object handler = null;
        if (acceptHeader != null && acceptHeader.contains("application/vnd.api.v2+json")) {
            handler = handlerV2Map.get(path);  // v2 版本处理器
        } else {
            handler = handlerV1Map.get(path);  // v1 版本处理器
        }
        
        return handler != null ? new HandlerExecutionChain(handler) : null;
    }
}
```

## 自定义 HandlerAdapter

场景：需要支持新的处理器类型。

```java
// 自定义 HandlerAdapter：支持 Lambda 表达式作为处理器
public class LambdaHandlerAdapter implements HandlerAdapter {
    
    @Override
    public boolean supports(Object handler) {
        return handler instanceof HandlerFunction;
    }

    @Override
    public ModelAndView handle(HttpServletRequest request,
                               HttpServletResponse response,
                               Object handler) throws Exception {
        HandlerFunction&lt;?&gt; function = (HandlerFunction&lt;?&gt;) handler;
        Object result = function.handle(request);
        
        // 将结果转换为 ModelAndView
        ModelAndView mav = new ModelAndView();
        mav.addObject("result", result);
        mav.setViewName("result");
        return mav;
    }
}
```

## 面试追问

**Q1: 为什么不把所有 Controller 写成一个类，而是分开写？**

分离的好处：
- 按业务模块组织，代码更清晰
- 单一职责原则
- 便于权限控制（不同 Controller 可能需要不同权限）
- 减少单个文件的大小

**Q2: HandlerMapping 和 HandlerAdapter 的顺序重要吗？**

重要。在 `DispatcherServlet` 中，它们是按顺序遍历的：
- HandlerMapping 找到**第一个**匹配的
- HandlerAdapter 找到**第一个**支持的

如果定义了多个，需要注意 `@Order` 注解或实现 `Ordered` 接口。

**Q3: Spring 5 的函数式 Web 编程是什么？**

Spring 5 引入了函数式路由，使用 `RouterFunction` 和 `HandlerFunction`：

```java
@Configuration
public class FunctionalWebConfig {
    
    @Bean
    public RouterFunction&lt;ServerResponse&gt; userRouter() {
        return route()
            .GET("/functional/users/{id}", request -&gt; {
                Long id = Long.valueOf(request.pathVariable("id"));
                return ServerResponse.ok().body(User.findById(id));
            })
            .POST("/functional/users", request -&gt; {
                User user = request.body(User.class);
                return ServerResponse.ok().body(User.create(user));
            })
            .build();
    }
}
```

---

**下节预告**：[HandlerInterceptor 与 Filter 对比](/framework/spring/interceptor-filter) —— 理解拦截器和过滤器的区别，以及各自的使用场景。
