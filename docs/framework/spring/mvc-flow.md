# Spring MVC 请求处理流程

你有没有想过：当你输入 `http://localhost:8080/api/users/123` 并回车时，Spring MVC 内部到底发生了什么？

从敲下回车键到看到页面返回，可能只有几十毫秒。但这几十毫秒里，Spring MVC 经历了什么？

## 一个请求的「旅行」

让我们先看一张总览图，了解请求在 Spring MVC 中的完整旅程：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Spring MVC 请求处理流程                           │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   1. 客户端请求                                                           │
│           │                                                              │
│           ▼                                                              │
│   2. DispatcherServlet（前端控制器）                                        │
│           │                                                              │
│           ▼                                                              │
│   3. HandlerMapping 找到处理器（Controller）                                │
│           │                                                              │
│           ▼                                                              │
│   4. HandlerAdapter 执行处理器                                             │
│           │                                                              │
│           ▼                                                              │
│   5. 执行 Controller 方法                                                │
│           │                                                              │
│           ▼                                                              │
│   6. 返回 ModelAndView                                                   │
│           │                                                              │
│           ▼                                                              │
│   7. ViewResolver 解析视图                                               │
│           │                                                              │
│           ▼                                                              │
│   8. 渲染 View（模板引擎/JSP）                                            │
│           │                                                              │
│           ▼                                                              │
│   9. 响应返回客户端                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 核心组件详解

### 1. DispatcherServlet：请求的「入口」

`DispatcherServlet` 是 Spring MVC 的前端控制器，所有的请求都从它开始。它本质上是一个 `HttpServlet`，遵循 Servlet 规范。

```java
// DispatcherServlet 继承链
public class DispatcherServlet extends FrameworkServlet {
    // 核心方法 doDispatch()
}

public abstract class FrameworkServlet extends HttpServletBean {
    // 实现了 HttpServlet 的 doGet/doPost 等方法
    // 最终都调用 processRequest()
}

public abstract class HttpServletBean extends HttpServlet {
    // 初始化 Spring 容器
}
```

### 2. HandlerMapping：请求的「导航仪」

`HandlerMapping` 负责根据请求找到对应的 Controller 方法。就像地图导航一样，告诉 DispatcherServlet：「这个请求应该由哪个方法来处理」。

Spring MVC 提供了多种 HandlerMapping 实现：

| 实现类 | 适用场景 |
|-------|---------|
| `RequestMappingHandlerMapping` | 基于 `@RequestMapping` 注解（最常用） |
| `BeanNameUrlHandlerMapping` | 将 Bean 名称作为 URL |
| `SimpleUrlHandlerMapping` | 通过配置文件定义 URL 映射 |
| `ControllerClassNameHandlerMapping` | 根据控制器类名自动映射 |

```java
// RequestMappingHandlerMapping 工作原理
// 它会扫描所有带 @Controller/@RestController 的类
// 收集所有 @RequestMapping 注解的方法
// 建立 URL -> HandlerMethod 的映射

// 例如：
@RestController
@RequestMapping("/api/users")
public class UserController {
    
    @GetMapping("/{id}")  // 映射到 /api/users/{id}
    public User getUser(@PathVariable Long id) {
        return userService.findById(id);
    }
}
```

### 3. HandlerAdapter：处理器的「适配器」

为什么需要 HandlerAdapter？

因为 Controller 有多种写法：
- 基于 `@Controller/@RequestMapping` 的类
- 实现 `Controller` 接口的类
- 实现 `HttpRequestHandler` 接口的类

HandlerAdapter 就像电源适配器一样，屏蔽了这些差异，提供统一的调用方式。

```java
// HandlerAdapter 接口
public interface HandlerAdapter {
    // 判断是否支持这个处理器
    boolean supports(Object handler);
    
    // 执行处理器，返回 ModelAndView
    ModelAndView handle(HttpServletRequest request, 
                        HttpServletResponse response, 
                        Object handler) throws Exception;
}
```

Spring MVC 内置的 HandlerAdapter：

| Adapter | 支持类型 |
|---------|---------|
| `RequestMappingHandlerAdapter` | `@RequestMapping` 注解的方法 |
| `HttpRequestHandlerAdapter` | 实现 `HttpRequestHandler` 接口 |
| `SimpleControllerHandlerAdapter` | 实现 `Controller` 接口 |
| `HandlerFunctionAdapter` | Spring 5 的函数式 Web 处理 |

### 4. ViewResolver：视图的「翻译官」

Controller 返回的视图名（如 `"user/list"`），需要 ViewResolver 翻译成真正的视图对象。

```java
// 常见的 ViewResolver 实现

// 1. InternalResourceViewResolver - JSP 视图
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void configureViewResolvers(ViewResolverRegistry registry) {
        registry.jsp("/WEB-INF/views/", ".jsp");
    }
}

// 2. ThymeleafViewResolver - Thymeleaf 模板
@Configuration
public class ThymeleafConfig {
    @Bean
    public ViewResolver viewResolver(ITemplateEngine templateEngine) {
        ThymeleafViewResolver resolver = new ThymeleafViewResolver();
        resolver.setTemplateEngine(templateEngine);
        resolver.setPrefix("/templates/");
        resolver.setSuffix(".html");
        return resolver;
    }
}
```

### 5. View：视图的「渲染器」

View 负责真正渲染页面，将 Model 数据填充到模板中。

```java
// View 接口
public interface View {
    // 渲染视图
    void render(@Nullable Map&lt;String, &lt;?&gt; model, 
                HttpServletRequest request, 
                HttpServletResponse response) throws Exception;
    
    String getContentType();
}
```

## 完整流程时序图

```
┌─────────┐     ┌─────────────────┐     ┌─────────────────┐
│  浏览器  │     │ DispatcherServlet│     │ HandlerMapping  │
└────┬────┘     └────────┬────────┘     └────────┬────────┘
     │                   │                        │
     │  1. HTTP请求       │                        │
     │───────────────────►│                        │
     │                   │                        │
     │                   │  2. getHandler()       │
     │                   │────────────────────────►
     │                   │                        │
     │                   │  3. 返回 HandlerMethod │
     │                   │◄────────────────────────
     │                   │                        │
     │                   │  4. getHandlerAdapter() │
     │                   │────────────────────────►│
     │                   │                        │
     │                   │  5. 返回 HandlerAdapter│
     │                   │◄────────────────────────
     │                   │                        │
     │                   │  6. handle() 执行     │
     │                   │◄───────────────────────
     │                   │                        │
     │                   │  7. ModelAndView       │
     │                   │───────────────────────►
     │                   │                        │
     │                   │                        ▼
     │                   │              ┌─────────────────┐
     │                   │              │   ViewResolver   │
     │                   │              └────────┬────────┘
     │                   │                       │
     │                   │  8. resolveViewName() │
     │                   │◄──────────────────────
     │                   │                       │
     │                   │  9. 返回 View 对象     │
     │                   │───────────────────────
     │                   │                       │
     │                   │  10. view.render()    │
     │                   │◄──────────────────────
     │                   │                       │
     │  11. HTTP响应      │                       │
     │◄───────────────────│                       │
     │                   │                       │
```

## 流程中的关键点

### 请求到达后的第一件事：九宫格初始化

DispatcherServlet 初始化时会创建一个「九宫格」——9 个默认组件：

```java
// DispatcherServlet.properties 中的默认配置
org.springframework.web.servlet.HandlerMapping=
    org.springframework.web.servlet.handler.BeanNameUrlHandlerMapping,
    org.springframework.web.servlet.servlet.mvc.MethodMapHandlerMapping,
    org.springframework.web.servlet.function.RouterFunctionMapping,
    org.springframework.web.servlet.handler.SimpleUrlHandlerMapping,
    org.springframework.web.servlet.mvc.annotation.RequestMappingHandlerMapping,
    org.springframework.web.servlet.function.support.HandlerFunctionAdapter

org.springframework.web.servlet.HandlerAdapter=
    org.springframework.web.servlet.servlet.http.HttpRequestHandlerAdapter,
    org.springframework.web.servlet.servlet.mvc.SimpleControllerHandlerAdapter,
    org.springframework.web.servlet.function.support.HandlerFunctionAdapter,
    org.springframework.web.servlet.mvc.annotation.RequestMappingHandlerAdapter

org.springframework.web.servlet.HandlerExceptionResolver=
    org.springframework.web.servlet.mvc.method.annotation.ExceptionHandlerExceptionResolver,
    org.springframework.web.servlet.mvc.method.annotation.ResponseStatusExceptionResolver,
    org.springframework.web.servlet.handler.HandlerExceptionResolverComposite

org.springframework.web.servlet.ViewResolver=
    org.springframework.web.servlet.view.InternalResourceViewResolver

// ... 还有其他组件
```

### LocaleResolver：处理国际化

每个请求还会关联一个 `LocaleResolver`，用于处理多语言：

```java
// 常见的 LocaleResolver
// 1. AcceptHeaderLocaleResolver - 从请求头 Accept-Language 读取
// 2. SessionLocaleResolver - 从 Session 中获取
// 3. CookieLocaleResolver - 从 Cookie 中获取
// 4. FixedLocaleResolver - 固定语言
```

### MultipartResolver：处理文件上传

如果请求是 multipart 类型（文件上传），会由 `MultipartResolver` 处理：

```java
// 配置 MultipartResolver
@Bean
public MultipartResolver multipartResolver() {
    CommonsMultipartResolver resolver = new CommonsMultipartResolver();
    resolver.setMaxUploadSize(10 * 1024 * 1024);  // 10MB
    resolver.setDefaultEncoding("UTF-8");
    return resolver;
}
```

## 面试追问

**Q1: DispatcherServlet 是单例还是多例？**

单例。整个应用只有一个 DispatcherServlet 实例，但 Controller 是单例（默认）或多例（@Scope("prototype")）取决于配置。

**Q2: Spring MVC 的九大组件是什么？**

1. HandlerMapping - 处理器映射
2. HandlerAdapter - 处理器适配器
3. HandlerExceptionResolver - 异常处理器
4. ViewResolver - 视图解析器
5. RequestToViewNameTranslator - 请求到视图名的转换器
6. LocaleResolver - 国际化解析器
7. ThemeResolver - 主题解析器
8. MultipartResolver - 文件上传解析器
9. FlashMapManager - 重定向数据管理器

**Q3: 为什么要先 HandlerMapping 再 HandlerAdapter？**

HandlerMapping 找到「谁来处理」，HandlerAdapter 知道「怎么处理」。这是一种解耦设计，方便扩展新的处理器类型。

---

**下节预告**：[DispatcherServlet 源码解析](/framework/spring/dispatcher-servlet) —— 深入 doDispatch() 方法，理解 Spring MVC 的核心执行逻辑。
