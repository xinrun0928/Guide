# Spring Boot 静态资源配置

你有没有遇到过这种情况：把 CSS/JS/图片放到 `src/main/resources/static` 目录下，访问时却 404 了？

这很可能是静态资源路径配置的问题。

今天，我们彻底搞懂 Spring Boot 的静态资源配置。

## 静态资源目录

Spring Boot 默认从以下位置查找静态资源：

```
classpath:/META-INF/resources/
classpath:/resources/
classpath:/static/       ← 最常用
classpath:/public/
```

访问方式：`http://localhost:8080/xxx`

例如，`src/main/resources/static/css/style.css` 访问路径是 `/css/style.css`。

## 自定义静态资源路径

### 方式一：application.yml

```yaml
spring:
  web:
    resources:
      static-locations:
        - classpath:/static/
        - classpath:/public/
        - classpath:/resources/
        - file:/var/www/static/  # 支持外部目录
```

### 方式二：实现 WebMvcConfigurer

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/static/**")
            .addResourceLocations("classpath:/static/", "file:/var/www/static/")
            .setCacheControl(CacheControl.maxAge(Duration.ofDays(30)));
    }
}
```

## 静态资源与动态请求的优先级

### 默认优先级

```
1. Controller 处理的请求（最高）
2. 静态资源 Handler（/static/** 等）
3. 默认 Servlet Handler（最低）
```

### 问题场景

如果同时存在：
- Controller: `@GetMapping("/index")`
- 静态文件: `/static/index.html`

**Controller 优先**，不会返回静态文件。

### 调整优先级

如果希望静态文件优先，可以设置：

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void configureDefaultServletHandling(DefaultServletHandlerConfigurer configurer) {
        configurer.enable();  // 启用默认 Servlet
    }
}
```

## WebJars

WebJars 是把前端库打包成 JAR 的方式，方便依赖管理。

### 引入依赖

```xml
<dependency>
    <groupId>org.webjars</groupId>
    <artifactId>jquery</artifactId>
    <version>3.6.0</version>
</dependency>
<dependency>
    <groupId>org.webjars</groupId>
    <artifactId>bootstrap</artifactId>
    <version>5.2.0</version>
</dependency>
```

### 使用 WebJars

```html
<link rel="stylesheet" href="/webjars/bootstrap/5.2.0/css/bootstrap.min.css"/>
<script src="/webjars/jquery/3.6.0/jquery.min.js"></script>
```

### WebJars 访问路径

访问路径格式：`/webjars/{库名}/{版本号}/...`

例如：`/webjars/bootstrap/5.2.0/css/bootstrap.min.css`

### 自定义 WebJars 路径

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/webjars/**")
            .addResourceLocations("/webjars/")
            .resourceChain(false)
            .addResolver(new VersionResourceResolver()
                .addContentVersionStrategy("/**"));
    }
}
```

## 静态资源缓存控制

### 设置 Cache-Control

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/static/**")
            .addResourceLocations("classpath:/static/")
            .setCacheControl(CacheControl.maxAge(30, TimeUnit.DAYS));
    }
}
```

### application.yml 配置

```yaml
spring:
  web:
    resources:
      cache:
        cachecontrol:
          max-age: 86400  # 1天
        period: 86400
```

## 静态资源版本管理

### VersionResourceResolver

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/static/**")
            .addResourceLocations("classpath:/static/")
            .resourceChain(true)
            .addResolver(new VersionResourceResolver()
                .addContentVersionStrategy("/**"))
            .addTransformer(new AppCacheManifestTransformer());
    }
}
```

### Thymeleaf 引用版本化资源

```html
<script th:src="@{/static/js/app.js(v=${T(java.time.Instant).now().toEpochMilli()})}"></script>
```

### 版本化文件名

将文件名改为带版本的格式：

```
static/
├── js/
│   └── app-v1.0.0.js
└── css/
    └── style-v1.0.0.css
```

## 欢迎页面

### 配置欢迎页面

```yaml
spring:
  web:
    resources:
      static-locations:
        - classpath:/static/
  mvc:
    static-path-pattern: /**
```

### 欢迎页面文件

Spring Boot 会按顺序查找：

```
src/main/resources/static/index.html
src/main/resources/public/index.html
src/main/resources/resources/index.html
src/main/resources/META-INF/resources/index.html
```

### 自定义欢迎页面

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/")
            .setViewName("forward:/index.html");
    }
}
```

## Favicon

### 自定义 Favicon

将 `favicon.ico` 放在以下位置：

```
src/main/resources/static/favicon.ico
src/main/resources/public/favicon.ico
```

### 禁用 Favicon

```yaml
spring:
  web:
    resources:
      favicon:
        enabled: false
```

### 自定义 Favicon 路径

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/favicon.ico")
            .addResourceLocations("classpath:/static/icons/")
            .setCacheControl(CacheControl.maxAge(7, TimeUnit.DAYS));
    }
}
```

## CORS 与静态资源

如果静态资源需要跨域访问：

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addResourceHandler("/static/**")
            .addCorsMappings("/api/**")
            .allowedOrigins("http://example.com")
            .allowedMethods("GET", "POST")
            .maxAge(3600);
    }
}
```

## 完整配置示例

```java
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {
    
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 静态资源
        registry.addResourceHandler("/static/**")
            .addResourceLocations("classpath:/static/", "file:/var/www/static/")
            .setCacheControl(CacheControl.maxAge(30, TimeUnit.DAYS))
            .resourceChain(true)
            .addResolver(new VersionResourceResolver()
                .addContentVersionStrategy("/**"));
        
        // WebJars
        registry.addResourceHandler("/webjars/**")
            .addResourceLocations("/webjars/")
            .setCacheControl(CacheControl.maxAge(365, TimeUnit.DAYS));
        
        // 外部文件
        registry.addResourceHandler("/uploads/**")
            .addResourceLocations("file:/var/www/uploads/")
            .setCacheControl(CacheControl.maxAge(7, TimeUnit.DAYS));
    }
    
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addViewController("/").setViewName("forward:/index.html");
    }
}
```

## 面试追问方向

| 问题 | 考察点 |
|-----|-----|
| Spring Boot 默认的静态资源目录有哪些？ | 默认配置 |
| 如何自定义静态资源路径？ | 配置方法 |
| 静态资源和 Controller 同时存在时，谁优先？ | 请求处理优先级 |
| WebJars 是什么？ | 前端资源管理 |
| 如何控制静态资源的缓存？ | 性能优化 |

---

> 静态资源配置虽然简单，但涉及的内容不少：路径配置、缓存控制、版本管理、欢迎页面……掌握这些，你就能应对各种前端资源管理场景。
