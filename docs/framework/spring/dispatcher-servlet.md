# DispatcherServlet 源码解析

你知道吗？DispatcherServlet 的核心方法 `doDispatch()` 只有区区几百行代码，却撑起了整个 Spring MVC 的请求处理。

今天，我们从源码层面，深入理解这个「前端控制器」是如何工作的。

## DispatcherServlet 的继承链

```java
// 继承链从上到下：Servlet 接口 → HttpServlet → HttpServletBean → FrameworkServlet → DispatcherServlet
public class DispatcherServlet extends FrameworkServlet {
    // 核心入口
}

// 抽象类，继承 HttpServletBean，实现了模板方法 init()
public abstract class FrameworkServlet extends HttpServletBean {
    // 初始化 Spring MVC 容器
    // 处理 HTTP 方法分发（doGet/doPost/... → processRequest()）
}

// 抽象类，为 Servlet 提供 Bean 初始化能力
public abstract class HttpServletBean extends HttpServlet {
    // 从 init-param 读取配置，创建 BeanWrapper
}
```

## 初始化：创建九大组件

DispatcherServlet 初始化时，会调用 `initStrategies()` 方法，创建九大组件：

```java
// DispatcherServlet.java 核心源码（略有简化）
public class DispatcherServlet extends FrameworkServlet {
    
    // 九大组件（关键字段）
    private MultipartResolver multipartResolver;
    private LocaleResolver localeResolver;
    private ThemeResolver themeResolver;
    private List&lt;HandlerMapping&gt; handlerMappings;
    private List&lt;HandlerAdapter&gt; handlerAdapters;
    private List&lt;HandlerExceptionResolver&gt; handlerExceptionResolvers;
    private RequestToViewNameTranslator viewNameTranslator;
    private FlashMapManager flashMapManager;
    private List&lt;ViewResolver&gt; viewResolvers;

    @Override
    protected void initStrategies(ApplicationContext context) {
        // 1. 文件上传解析器
        initMultipartResolver(context);
        // 2. 国际化解析器
        initLocaleResolver(context);
        // 3. 主题解析器
        initThemeResolver(context);
        // 4. 处理器映射器
        initHandlerMappings(context);
        // 5. 处理器适配器
        initHandlerAdapters(context);
        // 6. 异常处理器
        initHandlerExceptionResolvers(context);
        // 7. 视图名翻译器
        initRequestToViewNameTranslator(context);
        // 8. FlashMap 管理器
        initFlashMapManager(context);
        // 9. 视图解析器
        initViewResolvers(context);
    }

    private void initHandlerMappings(ApplicationContext context) {
        // 从容器中获取所有 HandlerMapping
        // 按 @Order 排序
        // 如果容器中没有，使用默认配置
    }
}
```

## doDispatch：核心方法

`doDispatch()` 是处理请求的核心方法。让我们分段解析：

### 第一步：获取处理器

```java
protected void doDispatch(HttpServletRequest request, HttpServletResponse response) throws Exception {
    HttpServletRequest processedRequest = request;
    
    // 1. 获取处理器（Controller 方法）
    HandlerExecutionChain mappedHandler = null;
    
    // determineHandlerMapping() 遍历所有 HandlerMapping，找到能处理该请求的
    mappedHandler = getHandler(processedRequest);
    
    if (mappedHandler == null) {
        // 没有找到处理器，返回 404
        noHandlerFound(processedRequest, response);
        return;
    }
}
```

```java
// getHandler() 源码
protected HandlerExecutionChain getHandler(HttpServletRequest request) throws Exception {
    // 遍历所有 HandlerMapping
    for (HandlerMapping mapping : this.handlerMappings) {
        // getHandler() 返回 HandlerExecutionChain（包含处理器 + 拦截器）
        HandlerExecutionChain handler = mapping.getHandler(request);
        if (handler != null) {
            return handler;
        }
    }
    return null;
}
```

### 第二步：获取适配器

```java
// 2. 获取处理器适配器
HandlerAdapter ha = getHandlerAdapter(mappedHandler.getHandler());
```

```java
// getHandlerAdapter() 源码
protected HandlerAdapter getHandlerAdapter(Object handler) throws ServletException {
    // 遍历所有 HandlerAdapter，找到支持该处理器的适配器
    for (HandlerAdapter adapter : this.handlerAdapters) {
        if (adapter.supports(handler)) {
            return adapter;
        }
    }
    throw new ServletException("No adapter for handler [" + handler + "]");
}
```

### 第三步：执行拦截器前置处理

```java
// 3. 执行拦截器的 preHandle()
if (!mappedHandler.applyPreHandle(processedRequest, response)) {
    return;  // 拦截器返回 false，请求被拦截
}
```

```java
// HandlerExecutionChain.applyPreHandle() 源码
boolean applyPreHandle(HttpServletRequest request, HttpServletResponse response) throws Exception {
    for (int i = 0; i &lt; this.interceptorList.size(); i++) {
        HandlerInterceptor interceptor = this.interceptorList.get(i);
        if (!interceptor.preHandle(request, response, this.handler)) {
            // 记录日志
            this.interceptorList.get(i).afterCompletion(request, response, this.handler, null);
            return false;
        }
        this.interceptorIndex = i;
    }
    return true;
}
```

### 第四步：执行处理器

```java
// 4. 执行 Controller 方法，返回 ModelAndView
ModelAndView mv = ha.handle(processedRequest, response, mappedHandler.getHandler());
```

这一步会执行 Controller 方法：

```java
// RequestMappingHandlerAdapter.handleInternal() 核心流程

// 4.1 调用 @RequestMapping 标注的方法
Object result = invocableMethod.invoke();

// 4.2 处理返回值
// 根据 @ResponseStatus、MediaType 等注解决定如何处理
// 最终返回 ModelAndView
```

### 第五步：执行拦截器后置处理

```java
// 5. 执行拦截器的 postHandle()
mappedHandler.applyPostHandle(processedRequest, response, mv);
```

```java
// HandlerExecutionChain.applyPostHandle() 源码
void applyPostHandle(HttpServletRequest request, HttpServletResponse response, 
                     @Nullable ModelAndView mav) throws Exception {
    // 逆序执行，与 preHandle 顺序相反
    for (int i = this.interceptorList.size() - 1; i &gt;= 0; i--) {
        HandlerInterceptor interceptor = this.interceptorList.get(i);
        interceptor.postHandle(request, response, this.handler, mav);
    }
}
```

### 第六步：处理异常

```java
// 6. 处理异常（如果有的话）
processDispatchResult(processedRequest, response, mappedHandler, mv, exception);
```

### 第七步：渲染视图

```java
private void processDispatchResult(HttpServletRequest request, 
                                    HttpServletResponse response,
                                    HandlerExecutionChain mappedHandler,
                                    ModelAndView mv,
                                    Exception exception) throws Exception {
    
    // 1. 如果有异常，走异常处理流程
    if (exception != null) {
        if (mv == null) {
            mv = processHandlerException(request, response, handler, exception);
        }
    }
    
    // 2. 如果没有视图，跳过渲染
    if (mv == null) {
        return;
    }
    
    // 3. 解析视图名，得到 View 对象
    if (mv.hasView()) {
        // 用户已经设置了 View
    } else {
        // 根据视图名解析
        mv.setViewName(getDefaultViews().applyDefaultViewName(request, mv));
    }
    
    // 4. 渲染视图
    if (mv != null) {
        render(mv, request, response);
    }
}
```

### 第八步：渲染视图源码

```java
protected void render(ModelAndView mv, HttpServletRequest request, 
                      HttpServletResponse response) throws Exception {
    
    // 1. 确定 Locale（国际化）
    Locale locale = this.localeResolver.resolveLocale(request);
    
    // 2. 获取 View 对象
    View view;
    if (mv.hasView()) {
        view = mv.getView();
    } else {
        // 视图名为空，使用请求路径作为视图名
        String viewName = mv.getViewName();
        view = resolveViewName(viewName, mv.getModel(), locale, request);
    }
    
    // 3. View 渲染（填充数据到模板）
    view.render(mv.getModelInternal(), request, response);
}
```

### 第九步：执行拦截器完成后处理

```java
// 10. 执行拦截器的 afterCompletion()
// 注意：无论成功还是异常，都会执行
mappedHandler.triggerAfterCompletion(request, response, null);
```

## 完整流程图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         doDispatch() 完整流程                            │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  请求进入                                                               │
│      │                                                                 │
│      ▼                                                                 │
│  ┌──────────────────────┐                                              │
│  │  getHandler()        │ ◄── 遍历 HandlerMapping，找到 Controller     │
│  │  获取处理器           │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  getHandlerAdapter() │ ◄── 找到支持该处理器的 HandlerAdapter        │
│  │  获取适配器           │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  applyPreHandle()    │ ◄── 拦截器前置处理，返回 false 则中断        │
│  │  拦截器 preHandle    │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  ha.handle()         │ ◄── 执行 Controller 方法，返回 ModelAndView  │
│  │  执行处理器           │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  applyPostHandle()   │ ◄── 拦截器后置处理                            │
│  │  拦截器 postHandle   │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  processDispatch    │ ◄── 处理异常、解析视图、渲染页面              │
│  │  Result()            │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│  ┌──────────────────────┐                                              │
│  │  triggerAfter        │ ◄── 拦截器完成处理（无论成功或异常都执行）   │
│  │  Completion()        │                                              │
│  └──────────┬───────────┘                                              │
│             │                                                          │
│             ▼                                                          │
│      响应返回                                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 关键设计思想

### 1. 策略模式

HandlerMapping、HandlerAdapter、ViewResolver 都是接口，具体实现可插拔。这种设计让你可以：
- 自定义 HandlerMapping 实现 URL 路由规则
- 自定义 ViewResolver 支持新的模板引擎

### 2. 责任链模式

拦截器组成了责任链，`applyPreHandle` 和 `applyPostHandle` 依次调用：

```java
// preHandle 正序执行
interceptor1.preHandle() → interceptor2.preHandle() → controller

// postHandle 逆序执行
controller → interceptor2.postHandle() → interceptor1.postHandle()

// afterCompletion 逆序执行（即使前面有异常）
controller（异常） → interceptor2.afterCompletion() → interceptor1.afterCompletion()
```

### 3. 适配器模式

HandlerAdapter 解决了 Controller 写法多样的问题，新增 Controller 类型只需要新增适配器即可。

## 面试追问

**Q1: 拦截器的 preHandle 返回 false 会怎样？**

请求会被中断，不会执行 Controller 和 postHandle，但 **afterCompletion 会执行**（因为需要清理资源）。典型场景：登录拦截、Token 校验。

**Q2: 为什么 postHandle 不常用？**

因为 postHandle 在视图渲染**之前**执行，如果发生异常，postHandle 不会执行。而 afterCompletion 在**渲染之后**执行，无论成功与否都会执行，适合做日志记录、资源清理。

**Q3: DispatcherServlet 如何保证线程安全？**

DispatcherServlet 本身是单例，其核心方法使用 `HttpServletRequest` 和 `HttpServletResponse` 作为方法参数，这些对象是线程局部的（ThreadLocal），所以是安全的。但 **Controller 如果有实例变量，则需要注意线程安全**。

---

**下节预告**：[HandlerMapping 与 HandlerAdapter](/framework/spring/handler-mapping) —— 深入理解这两种组件的多种实现，以及它们如何配合工作。
