# 参数绑定：@RequestParam、@RequestBody、@PathVariable

你有没有遇到过这种情况：接口参数明明对得上，却总是拿不到值？

```java
// 前端传了 id=123，后端却拿不到
@GetMapping("/user")
public User getUser(Long id) {  // id 可能是 null！
    return userService.findById(id);
}
```

问题出在哪里？Spring MVC 的参数绑定，远比你想象的复杂。

## 参数绑定的本质

当请求到达 Controller 方法时，Spring MVC 需要做两件事：

1. **读取数据**：从请求中提取参数（Query String、Path Variable、Request Body 等）
2. **类型转换**：将字符串转换为方法参数需要的类型（int、Date、User 等）

这个过程就是「参数绑定」。

## 常见的绑定注解

| 注解 | 数据来源 | 使用场景 |
|-----|---------|---------|
| `@RequestParam` | Query String / Form Data | 单个请求参数 |
| `@PathVariable` | URL 路径 | RESTful 路径参数 |
| `@RequestHeader` | HTTP 请求头 | 获取请求头信息 |
| `@RequestAttribute` | 请求属性 | 获取 `request.setAttribute()` 的值 |
| `@RequestBody` | Request Body | JSON/XML 请求体 |
| `@ModelAttribute` | Model 数据 | 绑定表单数据到对象 |

## @RequestParam：绑定请求参数

### 基本用法

```java
// 请求: GET /search?keyword=Spring&amp;page=1&amp;size=10
@GetMapping("/search")
public PageResult search(
    @RequestParam String keyword,
    @RequestParam(defaultValue = "1") int page,
    @RequestParam(defaultValue = "10") int size
) {
    return searchService.search(keyword, page, size);
}
```

### 关键属性

```java
@RequestParam(value = "page", defaultValue = "1", required = false)
```

- `value`：参数名（默认取方法参数名，但编译时可能丢失，需要加 `-parameters`）
- `defaultValue`：默认值
- `required`：是否必需（默认 true）

### 绑定数组或列表

```java
// 请求: GET /search?tag=java&amp;tag=spring&amp;tag=mysql
@GetMapping("/search")
public List&lt;Article&gt; search(@RequestParam List&lt;String&gt; tags) {
    return articleService.searchByTags(tags);
}

// 请求: GET /export?format=pdf&amp;format=excel
@GetMapping("/export")
public void export(@RequestParam String[] format) {
    for (String f : format) {
        // 处理每种格式
    }
}
```

### 绑定 Map

```java
// 请求: GET /search?name=xxx&amp;age=25&amp;city=beijing
@GetMapping("/search")
public Map&lt;String, Object&gt; search(@RequestParam Map&lt;String, String&gt; params) {
    // params = {name: "xxx", age: "25", city: "beijing"}
    return params;
}
```

## @PathVariable：绑定路径参数

### 基本用法

```java
// 请求: GET /user/123
@GetMapping("/user/{id}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
}

// 请求: GET /user/123/order/456
@GetMapping("/user/{userId}/order/{orderId}")
public Order getOrder(@PathVariable Long userId, @PathVariable Long orderId) {
    return orderService.findOrder(userId, orderId);
}
```

### 绑定到 Map

```java
// 请求: GET /user/123/order/456
@GetMapping("/user/{userId}/order/{orderId}")
public Order getOrder(@PathVariable Map&lt;String, String&gt; pathVars) {
    // pathVars = {userId: "123", orderId: "456"}
    String userId = pathVars.get("userId");
    String orderId = pathVars.get("orderId");
    return orderService.findOrder(Long.valueOf(userId), Long.valueOf(orderId));
}
```

### 正则表达式约束

```java
// 只匹配数字
@GetMapping("/user/{id:[0-9]+}")
public User getUser(@PathVariable Long id) {
    return userService.findById(id);
}

// 匹配特定格式
@GetMapping("/order/{orderId:[A-Z]{2}[0-9]{8}}")
public Order getOrder(@PathVariable String orderId) {
    return orderService.findByOrderId(orderId);
}
```

## @RequestBody：绑定请求体

### 基本用法

```java
// 请求: POST /user  Body: {"name": "张三", "email": "zhangsan@example.com"}
@PostMapping("/user")
public User createUser(@RequestBody CreateUserRequest request) {
    return userService.createUser(request);
}

// CreateUserRequest 必须是 POJO 或 Map
public class CreateUserRequest {
    private String name;
    private String email;
    // getters and setters
}
```

### 支持的类型

```java
// 1. POJO 对象
@PostMapping("/user")
public User createUser(@RequestBody User user) { ... }

// 2. Map（接收任意 JSON）
@PostMapping("/data")
public Map&lt;String, Object&gt; receive(@RequestBody Map&lt;String, Object&gt; data) { ... }

// 3. List&lt;POJO&gt;（批量操作）
@PostMapping("/users/batch")
public List&lt;User&gt; createUsers(@RequestBody List&lt;User&gt; users) { ... }

// 4. String（接收原始文本）
@PostMapping("/text")
public String receiveText(@RequestBody String text) { ... }
```

### 日期类型处理

默认情况下，Jackson 不认识 `yyyy-MM-dd` 格式的日期，需要配置：

```java
// 全局配置
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void configureMessageConverters(List&lt;HttpMessageConverter&lt;?&gt;&gt; converters) {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        builder.dateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss"));
        converters.add(new MappingJackson2HttpMessageConverter(builder.build()));
    }
}
```

或使用注解：

```java
public class CreateUserRequest {
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss", timezone = "GMT+8")
    private Date createTime;
}
```

## 复杂场景

### 混合使用

```java
// 请求: PUT /user/123?action=update
@PutMapping("/user/{id}")
public Result&lt;User&gt; updateUser(
    @PathVariable Long id,           // URL 路径参数
    @RequestParam String action,     // Query String
    @RequestBody UserUpdateRequest request  // Request Body
) {
    return userService.updateUser(id, action, request);
}
```

### 同时接收表单和 JSON

```java
// 表单数据
@PostMapping("/form")
public String handleForm(@RequestParam String name, 
                         @RequestParam String email) {
    return "ok";
}

// JSON 数据
@PostMapping("/json")
public String handleJson(@RequestBody Map&lt;String, String&gt; data) {
    return "ok";
}
```

### 文件上传

```java
// 单文件上传
@PostMapping("/upload")
public String upload(@RequestParam("file") MultipartFile file) {
    return file.getOriginalFilename();
}

// 多文件上传
@PostMapping("/upload/multiple")
public String uploadMultiple(@RequestParam("files") MultipartFile[] files) {
    return "上传了 " + files.length + " 个文件";
}
```

## 参数转换原理

### 自定义 Converter

```java
// 将字符串转换为 LocalDate
@Component
public class StringToLocalDateConverter implements Converter&lt;String, LocalDate&gt; {
    private final DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    
    @Override
    public LocalDate convert(String source) {
        return LocalDate.parse(source, formatter);
    }
}
```

### 配置全局 Converter

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {
    @Override
    public void addFormatters(FormatterRegistry registry) {
        registry.addConverter(new StringToLocalDateConverter());
    }
}
```

### FormattingConversionService

Spring MVC 使用 `FormattingConversionService` 来处理类型转换，它整合了 Converter 和 Formatter：

```
┌─────────────────────────────────────────────────────────────────┐
│               FormattingConversionService                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐     ┌─────────────────┐                   │
│  │  Converter      │     │  Formatter      │                   │
│  │  (类型转换)      │     │  (格式化)        │                   │
│  └────────┬────────┘     └────────┬────────┘                   │
│           │                       │                            │
│           └───────────┬────────────┘                            │
│                       ▼                                           │
│              GenericConversionService                            │
│                       │                                           │
│                       ▼                                           │
│            FormattingConversionService                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 常见问题

### 问题一：参数取不到值

```java
// 原因：编译时没有保留参数名
// 解决：pom.xml 配置编译器参数
&lt;plugin&gt;
    &lt;groupId&gt;org.apache.maven.plugins&lt;/groupId&gt;
    &lt;artifactId&gt;maven-compiler-plugin&lt;/artifactId&gt;
    &lt;configuration&gt;
        &lt;compilerArgs&gt;
            &lt;arg&gt;-parameters&lt;/arg&gt;
        &lt;/compilerArgs&gt;
    &lt;/configuration&gt;
&lt;/plugin&gt;
```

### 问题二：日期格式不统一

```java
// 全局统一配置日期格式
@Configuration
public class WebConfig {
    @Bean
    public Jackson2ObjectMapperBuilder jacksonBuilder() {
        Jackson2ObjectMapperBuilder builder = new Jackson2ObjectMapperBuilder();
        builder.dateFormat(new SimpleDateFormat("yyyy-MM-dd"));
        builder.serializaDatesUsing(DateFormat.class, new SimpleDateFormat("yyyy-MM-dd"));
        return builder;
    }
}
```

### 问题三：405 Method Not Allowed

通常是 POST 接口用了 GET 方法，或反过来。检查 `@GetMapping`/`@PostMapping` 是否正确。

## 面试追问

**Q1: @RequestParam 和 @ModelAttribute 的区别？**

- `@RequestParam` 绑定单个请求参数
- `@ModelAttribute` 绑定整个表单或 model 数据到对象

```java
// @ModelAttribute 示例
@PostMapping("/user")
public String createUser(@ModelAttribute("user") User user) { ... }

// 等价于
@PostMapping("/user")
public String createUser(User user) { ... }
```

**Q2: 什么情况下 @RequestBody 会失效？**

- 请求的 Content-Type 不是 `application/json`（默认只处理 JSON）
- 参数类型不匹配（JSON 无法反序列化）
- 方法参数有多个 `@RequestBody`

**Q3: 参数绑定的优先级是怎样的？**

从高到低：@PathVariable > @RequestParam > @RequestBody > ModelAttribute

---

**下节预告**：[视图解析与视图技术](/framework/spring/view-resolver) —— 了解 ViewResolver 如何将视图名转换为真正的视图，以及 Thymeleaf、JSP 等模板引擎的集成方式。
