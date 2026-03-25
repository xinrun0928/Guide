# CORS 跨域与 Security 配置

你有没有遇到过这种情况：前端开发时，接口明明通了，但浏览器报「跨域错误」？

这就是 CORS（跨域资源共享）的问题。

今天，我们就来深入了解 CORS 机制以及如何在 Spring Security 中正确配置。

---

## 什么是同源策略？

### 源的定义

```
源的组成：
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│  源 (Origin) = 协议 + 域名 + 端口                                       │
│                                                                          │
│  示例：                                                                 │
│  https://example.com:443                                               │
│  ├──协议──┘              ├域名─┤        ├─端口─┘                        │
│                                                                          │
│  http://example.com ≠ https://example.com（协议不同）                  │
│  https://api.example.com ≠ https://www.example.com（域名不同）          │
│  https://example.com:8080 ≠ https://example.com:443（端口不同）        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 同源策略的限制

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         同源策略的限制                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  同源策略 (Same-Origin Policy) 是浏览器的安全机制                      │
│                                                                          │
│  限制行为：                                                            │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. 无法读取其他源的 Cookie、LocalStorage                         │   │
│  │ 2. 无法发送 AJAX 请求到其他源（这就是跨域限制）                   │   │
│  │ 3. 无法操作其他源的 DOM                                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  不限制行为：                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 1. 页面跳转（&lt;a&gt;、location.href）可以跳到任何源                 │   │
│  │ 2. 嵌入外部资源（&lt;script&gt;、&lt;img&gt;、&lt;link&gt; 等）可以加载任意源        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 为什么需要 CORS？

### 跨域请求的场景

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         跨域请求的场景                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  场景一：前后端分离                                                    │
│                                                                          │
│  前端：http://localhost:3000  ← Vue/React 开发服务器                  │
│  后端：http://localhost:8080  ← Spring Boot API                        │
│                                                                          │
│  跨域：localhost:3000 → localhost:8080（端口不同）                     │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  场景二：微服务架构                                                    │
│                                                                          │
│  网关：https://api.example.com                                         │
│  用户服务：http://user-service:8081                                    │
│  订单服务：http://order-service:8082                                    │
│                                                                          │
│  跨域：api.example.com → user-service（域名不同）                       │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  场景三：第三方 API 调用                                               │
│                                                                          │
│  我的网站：https://myapp.com                                           │
│  第三方 API：https://api.thirdparty.com                                │
│                                                                          │
│  跨域：myapp.com → thirdparty.com                                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## CORS 机制详解

### 简单请求 vs 预检请求

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CORS 请求类型                                   │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  简单请求（Simple Request）：                                          │
│                                                                          │
│  同时满足：                                                            │
│  1. HTTP 方法：GET、POST、HEAD                                        │
│  2. Content-Type：application/x-www-form-urlencoded、                   │
│                  multipart/form-data、text/plain                        │
│  3. 无自定义 Header                                                    │
│                                                                          │
│  流程：                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 浏览器 ──► 发送请求（带 Origin 头）                            │   │
│  │           │                                                      │   │
│  │           ▼                                                      │   │
│  │ 服务器 ──► 响应（带 Access-Control-Allow-Origin 头）            │   │
│  │           │                                                      │   │
│  │           ▼                                                      │   │
│  │ 浏览器 ──► 检查是否允许，阻断或放行                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  预检请求（Preflight Request）：                                        │
│                                                                          │
│  触发条件（满足任一）：                                                │
│  1. PUT、DELETE、CONNECT、OPTIONS、TRACE、PATCH 方法                   │
│  2. Content-Type 非简单类型（如 application/json）                     │
│  3. 发送自定义 Header（如 X-Custom-Header）                            │
│                                                                          │
│  流程：                                                                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 浏览器 ──► 发送 OPTIONS 预检请求                                 │   │
│  │           │                                                      │   │
│  │           ▼                                                      │   │
│  │ 服务器 ──► 响应允许的来源、方法、Header 等                       │   │
│  │           │                                                      │   │
│  │           ▼                                                      │   │
│  │ 浏览器 ──► 检查预检结果                                          │   │
│  │           │                                                      │   │
│  │           ▼                                                      │   │
│  │ 浏览器 ──► 发送真实请求                                           │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### CORS 响应头

| Header | 说明 | 示例 |
|--------|------|------|
| Access-Control-Allow-Origin | 允许的来源 | `https://example.com` 或 `*` |
| Access-Control-Allow-Methods | 允许的方法 | `GET, POST, PUT, DELETE` |
| Access-Control-Allow-Headers | 允许的请求头 | `Content-Type, X-Custom-Header` |
| Access-Control-Allow-Credentials | 是否允许携带凭证 | `true` |
| Access-Control-Max-Age | 预检结果缓存时间 | `3600`（秒） |
| Access-Control-Expose-Headers | 允许前端访问的响应头 | `X-Total-Count` |

---

## Spring Security CORS 配置

### 1. 基本配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .anyRequest().authenticated()
            )
            // 启用 CORS
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        // 允许的来源（生产环境应指定具体域名）
        configuration.setAllowedOrigins(Arrays.asList(
            "http://localhost:3000",
            "https://example.com"
        ));
        
        // 允许的方法
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        
        // 允许的请求头
        configuration.setAllowedHeaders(Arrays.asList("*"));
        
        // 是否允许携带凭证（Cookie）
        configuration.setAllowCredentials(true);
        
        // 预检请求缓存时间
        configuration.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        
        return source;
    }
}
```

### 2. 使用 @CrossOrigin 注解

```java
@RestController
@RequestMapping("/api")
public class UserController {
    
    // 单个方法级别配置
    @CrossOrigin(origins = "http://localhost:3000")
    @GetMapping("/users")
    public List&lt;User&gt; getUsers() {
        return userService.findAll();
    }
    
    // 整个 Controller 级别配置
    @CrossOrigin(
        origins = {"http://localhost:3000", "https://example.com"},
        allowedHeaders = {"Content-Type", "Authorization"},
        exposedHeaders = {"X-Total-Count"},
        methods = {RequestMethod.GET, RequestMethod.POST},
        maxAge = 3600
    )
    @RestController
    @RequestMapping("/api")
    public static class ConfiguredUserController {
        // ...
    }
}
```

### 3. 全局 CORS 配置

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {
    
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
            .allowedOrigins("http://localhost:3000")
            .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
            .allowedHeaders("*")
            .allowCredentials(true)
            .maxAge(3600);
    }
}
```

---

## 常见问题

### 问题一：credentials 为 true 时，origin 不能是 *

```java
// ❌ 错误配置
configuration.setAllowedOrigins(Arrays.asList("*"));
configuration.setAllowCredentials(true);

// ✅ 正确配置
configuration.setAllowedOriginPatterns(Arrays.asList("http://localhost:*"));
configuration.setAllowCredentials(true);

// 或
configuration.setAllowedOrigins(Arrays.asList("https://example.com"));
configuration.setAllowCredentials(true);
```

### 问题二：预检请求被拦截

```java
// 确保 Spring Security 放行 OPTIONS 请求
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                // 放行预检请求
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
                .anyRequest().authenticated()
            )
            .cors(Customizer.withDefaults())
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
}
```

### 问题三：Cookie 跨域

```java
// 前端配置
fetch('/api/data', {
    method: 'GET',
    credentials: 'include'  // 发送 Cookie
});

// 后端配置
configuration.setAllowCredentials(true);
configuration.setAllowedOriginPatterns(Arrays.asList("http://localhost:*"));
```

---

## 完整配置示例

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()  // 放行预检
                .anyRequest().authenticated()
            )
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable());  // API 场景可禁用
        
        return http.build();
    }
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        
        // 生产环境建议使用具体域名，不使用 *
        configuration.setAllowedOriginPatterns(Arrays.asList(
            "http://localhost:*",
            "https://*.example.com"
        ));
        
        configuration.setAllowedMethods(Arrays.asList(
            "GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"
        ));
        
        configuration.setAllowedHeaders(Arrays.asList(
            "Authorization",
            "Content-Type",
            "X-Requested-With",
            "Accept",
            "Origin",
            "Access-Control-Request-Method",
            "Access-Control-Request-Headers"
        ));
        
        configuration.setExposedHeaders(Arrays.asList(
            "Access-Control-Allow-Origin",
            "Access-Control-Allow-Credentials",
            "X-Total-Count"
        ));
        
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        
        return source;
    }
}
```

---

## 微服务 CORS 配置

```java
@Configuration
@EnableWebSecurity
public class MicroserviceSecurityConfig {
    
    @Value("${cors.allowed-origins}")
    private String allowedOrigins;
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 网关层通常不需要认证
            .authorizeHttpRequests(auth -> auth.anyRequest().permitAll())
            .cors(cors -> cors.configurationSource(corsConfigurationSource()))
            .csrf(csrf -> csrf.disable());
        
        return http.build();
    }
    
    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration config = new CorsConfiguration();
        config.setAllowedOriginPatterns(Arrays.asList(allowedOrigins.split(",")));
        config.setAllowedMethods(Arrays.asList("*"));
        config.setAllowedHeaders(Arrays.asList("*"));
        config.setAllowCredentials(true);
        config.setMaxAge(3600L);
        
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 什么是同源策略？ | 概念理解 | 本篇 |
| 简单请求和预检请求的区别？ | 原理理解 | 本篇 |
| 为什么 credentials 为 true 时 origin 不能是 *？ | 原理理解 | 本篇 |
| 如何配置 CORS？ | 实战能力 | 本篇 |
| CORS 和 JSONP 的区别？ | 对比理解 | JSONP |

---

## 总结

CORS 配置的核心要点：

1. **同源策略**：浏览器的安全机制，限制跨域请求
2. **CORS 机制**：服务器通过响应头告诉浏览器是否允许跨域
3. **预检请求**：复杂请求需要先发 OPTIONS 探测
4. **Spring Security 配置**：通过 `CorsConfigurationSource` 统一配置
5. **credentials**：携带 Cookie 时 origin 不能是 *

CORS 是前后端分离架构必须掌握的知识。

---

## 下一步

- 想了解 XSS 防护？→ [XSS 防护](/framework/springsecurity/xss)
- 想了解微服务安全？→ [Gateway 统一鉴权中心](/framework/springsecurity/gateway-auth)
- 想了解 CSRF 防护？→ [CSRF 防护机制](/framework/springsecurity/csrf)
