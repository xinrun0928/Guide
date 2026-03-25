# 视图解析与视图技术

Controller 执行完毕，返回一个字符串 `"user/list"`，这个字符串是怎么变成用户看到的页面的？

答案就是 **ViewResolver**——视图解析器。

## 视图解析的工作原理

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          视图解析流程                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   Controller 返回 "user/list"                                          │
│            │                                                            │
│            ▼                                                            │
│   DispatcherServlet 调用 ViewResolver                                  │
│            │                                                            │
│            ▼                                                            │
│   ViewResolver 根据配置拼接完整路径                                      │
│            │                                                            │
│            │   例如：prefix + "user/list" + suffix                      │
│            │   = "/WEB-INF/views/" + "user/list" + ".jsp"               │
│            │   = "/WEB-INF/views/user/list.jsp"                         │
│            ▼                                                            │
│   返回 View 对象                                                         │
│            │                                                            │
│            ▼                                                            │
│   View 渲染数据到模板                                                   │
│            │                                                            │
│            ▼                                                            │
│   响应返回给浏览器                                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## ViewResolver 体系

### 接口定义

```java
public interface ViewResolver {
    // 根据视图名解析为 View 对象
    View resolveViewName(String viewName, Locale locale) throws Exception;
}

public interface View {
    // 渲染视图
    void render(@Nullable Map&lt;String, &lt;?&gt; model, 
                 HttpServletRequest request, 
                 HttpServletResponse response) throws Exception;
    
    String getContentType();
}
```

### 常见的 ViewResolver 实现

| ViewResolver | 视图类型 | 配置特点 |
|-------------|---------|---------|
| `InternalResourceViewResolver` | JSP/JSTL | 简单配置，前后缀拼接 |
| `ThymeleafViewResolver` | Thymeleaf 模板 | 配置模板引擎 |
| `FreeMarkerViewResolver` | FreeMarker 模板 | 配置 FreeMarker 配置 |
| `ContentNegotiatingViewResolver` | 内容协商 | 根据 Accept 头选择视图 |
| `BeanNameViewResolver` | Bean 名称 | 直接使用容器中的 View Bean |

## JSP 视图解析

### 配置 InternalResourceViewResolver

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    
    @Override
    public void configureViewResolvers(ViewResolverRegistry registry) {
        // 方式一：简洁配置
        registry.jsp("/WEB-INF/views/", ".jsp");
        
        // 方式二：完整配置
        InternalResourceViewResolver resolver = new InternalResourceViewResolver();
        resolver.setPrefix("/WEB-INF/views/");
        resolver.setSuffix(".jsp");
        resolver.setContentType("text/html;charset=UTF-8");
        // 设置视图顺序（数值越小优先级越高）
        resolver.setOrder(Ordered.HIGHEST_PRECEDENCE);
        registry.viewResolver(resolver);
    }
}
```

### JSP 页面示例

```jsp
&lt;%@ page contentType="text/html;charset=UTF-8" language="java" %&gt;
&lt;%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %&gt;
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
    &lt;title&gt;用户列表&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
    &lt;h1&gt;用户列表&lt;/h1&gt;
    &lt;table&gt;
        &lt;tr&gt;
            &lt;th&gt;ID&lt;/th&gt;
            &lt;th&gt;用户名&lt;/th&gt;
            &lt;th&gt;邮箱&lt;/th&gt;
        &lt;/tr&gt;
        &lt;c:forEach items="${users}" var="user"&gt;
            &lt;tr&gt;
                &lt;td&gt;${user.id}&lt;/td&gt;
                &lt;td&gt;${user.username}&lt;/td&gt;
                &lt;td&gt;${user.email}&lt;/td&gt;
            &lt;/tr&gt;
        &lt;/c:forEach&gt;
    &lt;/table&gt;
&lt;/body&gt;
&lt;/html&gt;
```

## Thymeleaf 视图解析

### 引入依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.boot&lt;/groupId&gt;
    &lt;artifactId&gt;spring-boot-starter-thymeleaf&lt;/artifactId&gt;
&lt;/dependency&gt;
```

### Thymeleaf 配置

```java
@Configuration
public class ThymeleafConfig {
    
    @Bean
    public ITemplateEngine templateEngine(ISpringWebFluxTemplateEngine webFluxEngine) {
        SpringTemplateEngine engine = new SpringTemplateEngine();
        engine.setTemplateResolver(templateResolver());
        // 启用 Spring 5 的文本模板模式（更安全）
        engine.setEnableSpringELCompiler(true);
        return engine;
    }
    
    @Bean
    public ITemplateResolver templateResolver() {
        SpringResourceTemplateResolver resolver = new SpringResourceTemplateResolver();
        resolver.setPrefix("classpath:/templates/");  // 模板目录
        resolver.setSuffix(".html");                   // 模板后缀
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding("UTF-8");
        resolver.setCacheable(false);  // 开发环境禁用缓存
        return resolver;
    }
}
```

### Thymeleaf 模板示例

```html
&lt;!DOCTYPE html&gt;
&lt;html xmlns:th="http://www.thymeleaf.org"&gt;
&lt;head&gt;
    &lt;meta charset="UTF-8"&gt;
    &lt;title th:text="${title}"&gt;用户列表&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
    &lt;h1&gt;用户列表&lt;/h1&gt;
    &lt;table&gt;
        &lt;thead&gt;
            &lt;tr&gt;
                &lt;th&gt;ID&lt;/th&gt;
                &lt;th&gt;用户名&lt;/th&gt;
                &lt;th&gt;邮箱&lt;/th&gt;
                &lt;th&gt;操作&lt;/th&gt;
            &lt;/tr&gt;
        &lt;/thead&gt;
        &lt;tbody&gt;
            &lt;tr th:each="user : ${users}"&gt;
                &lt;td th:text="${user.id}"&gt;1&lt;/td&gt;
                &lt;td th:text="${user.username}"&gt;zhangsan&lt;/td&gt;
                &lt;td th:text="${user.email}"&gt;zhangsan@example.com&lt;/td&gt;
                &lt;td&gt;
                    &lt;a th:href="@{/user/edit/{id}(id=${user.id})}"&gt;编辑&lt;/a&gt;
                    &lt;a th:href="@{/user/delete/{id}(id=${user.id})}"&gt;删除&lt;/a&gt;
                &lt;/td&gt;
            &lt;/tr&gt;
        &lt;/tbody&gt;
    &lt;/table&gt;
    
    &lt;!-- 条件渲染 --&gt;
    &lt;div th:if="${not #lists.isEmpty(users)}"&gt;
        共 &lt;span th:text="${users.size()}"&gt;0&lt;/span&gt; 条记录
    &lt;/div&gt;
    
    &lt;!-- 表单提交 --&gt;
    &lt;form th:action="@{/user/save}" method="post"&gt;
        &lt;input type="text" name="username" th:value="${user?.username}"&gt;
        &lt;button type="submit"&gt;提交&lt;/button&gt;
    &lt;/form&gt;
&lt;/body&gt;
&lt;/html&gt;
```

### Thymeleaf 常用语法

```html
&lt;!-- 文本渲染 --&gt;
&lt;span th:text="${user.name}"&gt;默认值&lt;/span&gt;
&lt;span th:utext="${user.htmlContent}"&gt;HTML 内容（不转义）&lt;/span&gt;

&lt;!-- URL 链接 --&gt;
&lt;a th:href="@{/user/{id}(id=${user.id})}"&gt;查看详情&lt;/a&gt;
&lt;a th:href="@{/user(id=${user.id}, action='delete')}"&gt;删除&lt;/a&gt;

&lt;!-- 条件判断 --&gt;
&lt;div th:if="${user.status == 1}"&gt;正常&lt;/div&gt;
&lt;div th:unless="${user.status == 1}"&gt;禁用&lt;/div&gt;

&lt;!-- 循环 --&gt;
&lt;tr th:each="user, stat : ${users}"&gt;
    &lt;td th:text="${stat.count}"&gt;1&lt;/td&gt;
    &lt;td th:text="${user.name}"&gt;&lt;/td&gt;
&lt;/tr&gt;

&lt;!-- 局部替换 --&gt;
&lt;div th:insert="~{fragment :: footer}"&gt;&lt;/div&gt;
&lt;div th:replace="~{fragment :: footer}"&gt;&lt;/div&gt;

&lt;!-- 内联表达式 --&gt;
&lt;script th:inline="javascript"&gt;
    var name = [[${user.name}]];  // 自动转 JSON
    var url = /*[[@{/api/user}]]*/ '/default/url';
&lt;/script&gt;
```

## FreeMarker 视图解析

### 引入依赖

```xml
&lt;dependency&gt;
    &lt;groupId&gt;org.springframework.boot&lt;/groupId&gt;
    &lt;artifactId&gt;spring-boot-starter-freemarker&lt;/artifactId&gt;
&lt;/dependency&gt;
```

### FreeMarker 配置

```java
@Configuration
public class FreeMarkerConfig {
    
    @Bean
    public FreeMarkerConfigurer freeMarkerConfigurer() {
        FreeMarkerConfigurer configurer = new FreeMarkerConfigurer();
        configurer.setTemplateLoaderPath("/WEB-INF/freemarker/");
        configurer.setDefaultEncoding("UTF-8");
        
        Properties settings = new Properties();
        settings.setProperty("template_update_delay", "0");
        settings.setProperty("default_encoding", "UTF-8");
        configurer.setFreemarkerSettings(settings);
        
        return configurer;
    }
    
    @Bean
    public ViewResolver freeMarkerViewResolver() {
        FreeMarkerViewResolver resolver = new FreeMarkerViewResolver();
        resolver.setSuffix(".ftl");
        resolver.setContentType("text/html;charset=UTF-8");
        resolver.setOrder(Ordered.HIGHEST_PRECEDENCE);
        return resolver;
    }
}
```

### FreeMarker 模板示例

```freemarker
&lt;!DOCTYPE html&gt;
&lt;html&gt;
&lt;head&gt;
    &lt;title&gt;${title}&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
    &lt;h1&gt;用户列表&lt;/h1&gt;
    &lt;table&gt;
        &lt;tr&gt;
            &lt;th&gt;ID&lt;/th&gt;
            &lt;th&gt;用户名&lt;/th&gt;
            &lt;th&gt;邮箱&lt;/th&gt;
        &lt;/tr&gt;
        &lt;#list users as user&gt;
            &lt;tr&gt;
                &lt;td&gt;${user.id}&lt;/td&gt;
                &lt;td&gt;${user.username}&lt;/td&gt;
                &lt;td&gt;${user.email}&lt;/td&gt;
            &lt;/tr&gt;
        &lt;/#list&gt;
    &lt;/table&gt;
    
    &lt;!-- 条件判断 --&gt;
    &lt;#if users?has_content&gt;
        &lt;p&gt;共 ${users?size} 条记录&lt;/p&gt;
    &lt;#else&gt;
        &lt;p&gt;暂无数据&lt;/p&gt;
    &lt;/#if&gt;
    
    &lt;!-- 内建函数 --&gt;
    &lt;p&gt;当前时间: ${now?string('yyyy-MM-dd HH:mm:ss')}&lt;/p&gt;
    &lt;p&gt;数字格式化: ${price?string.currency}&lt;/p&gt;
&lt;/body&gt;
&lt;/html&gt;
```

## 视图技术对比

| 特性 | JSP | Thymeleaf | FreeMarker |
|-----|-----|----------|-----------|
| 学习曲线 | 低 | 中 | 中 |
| 模板语法 | JSTL/EL | HTML 属性 | FreeMarker 语法 |
| 与 HTML 融合 | 一般 | 优秀 | 一般 |
| 处理空值 | 需要 JSTL | 自动转义 | 需要处理 |
| 性能 | 高 | 中 | 高 |
| 生态 | 成熟 | 活跃 | 成熟 |
| 推荐指数 | 旧项目 | **新项目首选** | 中 |

## 内容协商视图解析器

ContentNegotiatingViewResolver 可以根据请求的 Accept 头选择合适的视图：

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    
    @Override
    public void configureContentNegotiation(ContentNegotiationConfigurer configurer) {
        configurer
            // 基于文件扩展名
            .favorParameter(true)
            .parameterName("format")
            // 支持的媒体类型
            .mediaType("html", MediaType.TEXT_HTML)
            .mediaType("json", MediaType.APPLICATION_JSON)
            .mediaType("xml", MediaType.APPLICATION_XML);
    }
}
```

```java
// 请求示例
// GET /user/list.json  返回 JSON
// GET /user/list.xml   返回 XML
// GET /user/list       根据 Accept 头决定
```

## 自定义视图

### 实现 View 接口

```java
@Component("myView")
public class MyCustomView implements View {
    
    @Override
    public void render(@Nullable Map&lt;String, ?&gt; model, 
                       HttpServletRequest request,
                       HttpServletResponse response) throws Exception {
        response.setContentType(getContentType());
        response.getWriter().write("&lt;h1&gt;自定义视图&lt;/h1&gt;");
        for (Map.Entry&lt;String, ?&gt; entry : model.entrySet()) {
            response.getWriter().write("&lt;p&gt;" + entry.getKey() + ": " + entry.getValue() + "&lt;/p&gt;");
        }
    }
    
    @Override
    public String getContentType() {
        return "text/html;charset=UTF-8";
    }
}
```

### 返回自定义视图

```java
@GetMapping("/custom")
public String customView(Model model) {
    model.addAttribute("message", "Hello Custom View");
    return "myView";  // 返回 Bean 名称
}
```

## 视图解析的优先级

如果配置了多个 ViewResolver，它们会按顺序遍历：

```java
@Override
public void configureViewResolvers(ViewResolverRegistry registry) {
    // 先 JSP
    registry.jsp("/WEB-INF/views/", ".jsp");
}
```

```java
@Override
public void extendViewResolvers(List&lt;ViewResolver&gt; resolvers) {
    // 可以手动调整顺序
    resolvers.add(0, myCustomViewResolver);
}
```

ViewResolver 的 `order` 属性决定了优先级，数字越小优先级越高。

## 面试追问

**Q1: forward 和 redirect 在视图解析中的区别？**

```java
// forward：服务器内部转发，不改变 URL
// 视图名前加 "forward:" 前缀
return "forward:/user/list";

// redirect：客户端重定向，改变 URL
// 视图名前加 "redirect:" 前缀
return "redirect:/user/list";
```

**Q2: Model、ModelMap、ModelAndView 的区别？**

| 类型 | 特点 |
|-----|------|
| `Model` | 接口，只提供添加属性的方法 |
| `ModelMap` | 类，实现了 Map 接口，可以当 Map 使用 |
| `ModelAndView` | 同时包含模型数据和视图名 |

```java
// 三种方式效果相同
public String method1(Model model) {
    model.addAttribute("data", "value");
    return "view";
}

public String method2(ModelMap modelMap) {
    modelMap.addAttribute("data", "value");
    return "view";
}

public ModelAndView method3() {
    ModelAndView mav = new ModelAndView("view");
    mav.addObject("data", "value");
    return mav;
}
```

**Q3: Thymeleaf 为什么比 JSP 更适合前后端分离？**

Thymeleaf 使用 HTML 属性（如 `th:text`），模板本身是合法的 HTML 文件，可以直接在浏览器中打开预览。而 JSP 需要服务器渲染才能看到效果。

---

**下节预告**：[异常处理：@ExceptionHandler 与 @ControllerAdvice](/framework/spring/exception-handler) —— 掌握 Spring MVC 的全局异常处理机制。
