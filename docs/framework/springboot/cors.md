# 跨域配置：让前端后端不再「隔阂」

你有没有遇到过这种报错？

```javascript
Access to fetch at 'http://localhost:8080/api/user' from origin 'http://localhost:3000' has been blocked by CORS policy
```

前端在 localhost:3000，后端在 localhost:8080，浏览器告诉你：不行！

这就是 CORS 问题——浏览器的同源策略导致的。

这一节，我们来彻底解决 Spring Boot 中的跨域问题。

## 什么是 CORS？

CORS（Cross-Origin Resource Sharing）即跨域资源共享，是一种 W3C 标准。

浏览器出于安全考虑，默认只允许同源请求。

```
┌─────────────────────────────────────────────────────────────────┐
│                    同源策略示意                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  源 = 协议 + 域名 + 端口                                        │
│                                                                 │
│  http://localhost:8080  ← 当前页面                               │
│                                                                 │
│  ┌────────────────┬────────────────────────────────────────┐  │
│  │     URL        │               结果                       │  │
│  ├────────────────┼────────────────────────────────────────┤  │
│  │ 同源            │ ✅ 允许                                │  │
│  │ /api/user      │                                        │  │
│  ├────────────────┼────────────────────────────────────────┤  │
│  │ 跨域            │ ❌ 浏览器阻止                           │  │
│  │ :3000/api/user │                                        │  │
│  ├────────────────┼────────────────────────────────────────┤  │
│  │ 跨域            │ ❌ 浏览器阻止                           │  │
│  │ :8081/api/user │                                        │  │
│  └────────────────┴────────────────────────────────────────┘  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Spring Boot 跨域解决方案

### 方案一：@CrossOrigin 注解（单个 Controller）

```java
@RestController
@RequestMapping("/api")
public class UserController {

    /**
     * 允许来自 http://localhost:3000 的请求
     */
    @CrossOrigin(origins = "http://localhost:3000")
    @GetMapping("/user/{id}")
    public User getUser(@PathVariable Long id) {
        return userService.getById(id);
    }

    /**
     * 允许所有来源
     */
    @CrossOrigin(origins = "*")
    @GetMapping("/users")
    public List<User> getUsers() {
        return userService.list();
    }
}
```

### 方案二：WebMvcConfigurer（全局配置）

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")  // 所有路径
                .allowedOrigins("http://localhost:3000")  // 允许的来源
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")  // 允许的方法
                .allowedHeaders("*")  // 允许的请求头
                .exposedHeaders("Authorization")  // 允许前端访问的响应头
                .allowCredentials(true)  // 是否允许携带凭证
                .maxAge(3600);  // 预检请求缓存时间（秒）
    }
}
```

### 方案三：Filter 方式（更灵活）

```java
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CorsFilter implements Filter {

    @Override
    public void doFilter(ServletRequest servletRequest, ServletResponse servletResponse,
                       FilterChain filterChain) throws IOException, ServletException {
        HttpServletResponse response = (HttpServletResponse) servletResponse;
        HttpServletRequest request = (HttpServletRequest) servletRequest;

        // 设置允许的来源
        response.setHeader("Access-Control-Allow-Origin", request.getHeader("Origin"));
        // 设置允许的方法
        response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
        // 设置允许的请求头
        response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With");
        // 设置允许携带凭证
        response.setHeader("Access-Control-Allow-Credentials", "true");
        // 设置预检请求缓存时间
        response.setHeader("Access-Control-Max-Age", "3600");

        filterChain.doFilter(servletRequest, servletResponse);
    }
}
```

### 方案四：Spring Security 整合（配合安全框架）

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF（API 通常不需要）
            .csrf(csrf -> csrf.disable())
            // 配置跨域
            .cors(cors -> cors.configurationSource(corsConfigurationSource()));

        return http.build();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(Arrays.asList("http://localhost:3000"));
        configuration.setAllowedMethods(Arrays.asList("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(Arrays.asList("*"));
        configuration.setAllowCredentials(true);
        configuration.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
```

## CORS 响应头详解

| 响应头 | 说明 | 示例 |
|-----|------|-----|
| `Access-Control-Allow-Origin` | 允许的来源 | `http://localhost:3000` 或 `*` |
| `Access-Control-Allow-Methods` | 允许的方法 | `GET, POST, PUT, DELETE` |
| `Access-Control-Allow-Headers` | 允许的请求头 | `Authorization, Content-Type` |
| `Access-Control-Expose-Headers` | 前端可访问的响应头 | `Authorization` |
| `Access-Control-Allow-Credentials` | 是否允许携带凭证 | `true` |
| `Access-Control-Max-Age` | 预检请求缓存时间 | `3600` |

## 预检请求（Preflight Request）

浏览器在发送跨域请求前，会先发送一个 OPTIONS 请求（预检请求）：

```
浏览器                         服务器
  │                              │
  │  OPTIONS /api/user          │
  │  Origin: http://localhost:3000
  │  Access-Control-Request-Method: POST
  │  Access-Control-Request-Headers: Content-Type │
  │ ─────────────────────────────►│
  │                              │
  │  ◄─────────────────────────────
  │  200 OK
  │  Access-Control-Allow-Origin: http://localhost:3000
  │  Access-Control-Allow-Methods: GET, POST
  │  Access-Control-Allow-Headers: Content-Type
  │ ──────────────────────────────►│
  │                              │
  │  POST /api/user             │
  │  Origin: http://localhost:3000
  │  Content-Type: application/json
  │ ─────────────────────────────►│
  │                              │
  │  ◄─────────────────────────────
  │  200 OK
  │  Access-Control-Allow-Origin: http://localhost:3000
  │ ──────────────────────────────►│
```

## 生产环境配置

### 支持多来源

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")  // 支持通配符模式
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
```

### 动态配置来源

```java
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    @Value("${cors.allowed-origins}")
    private List<String> allowedOrigins;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins.toArray(new String[0]))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
```

```yaml
cors:
  allowed-origins:
    - http://localhost:3000
    - http://localhost:8080
    - https://example.com
```

## 常见问题

### 问题一：OPTIONS 请求 404

```java
// 如果 Spring Security 阻止了 OPTIONS 请求
// 需要在 SecurityConfig 中放行
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .csrf(csrf -> csrf.disable())
        .authorizeHttpRequests(auth -> auth
            // 放行 OPTIONS 请求
            .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()
            .anyRequest().authenticated()
        );
    return http.build();
}
```

### 问题二：allowCredentials=true 时不允许 origins=*

```java
// 错误：credentials 为 true 时，不能使用 *
configuration.setAllowedOrigins(Arrays.asList("*"));  // ❌

// 正确：使用具体来源或配置源模式
configuration.setAllowedOriginPatterns(Arrays.asList("*"));  // ✅
configuration.setAllowedOrigins(Arrays.asList("http://localhost:3000"));  // ✅
```

### 问题三：自定义请求头不生效

```javascript
// 前端发送自定义请求头
fetch('/api/user', {
  headers: {
    'Authorization': 'Bearer xxx',
    'X-Custom-Header': 'value'
  }
})

// 后端需要允许这个请求头
response.setHeader("Access-Control-Allow-Headers", "Authorization, X-Custom-Header");

// 或者允许所有请求头
response.setHeader("Access-Control-Allow-Headers", "*");
```

## Nginx 跨域配置

```nginx
location /api/ {
    # 允许跨域
    add_header 'Access-Control-Allow-Origin' '$http_origin' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Authorization, Content-Type' always;

    # 处理 OPTIONS 预检请求
    if ($request_method = 'OPTIONS') {
        add_header 'Access-Control-Max-Age' 3600;
        add_header 'Content-Type' 'text/plain charset=UTF-8';
        add_header 'Content-Length' 0;
        return 204;
    }

    # 代理到后端服务
    proxy_pass http://backend;
}
```

---

## 面试高频问题

### Q1：什么是跨域？为什么存在跨域限制？

浏览器出于安全考虑，采用同源策略，限制来自不同源的脚本对当前源的资源访问。

### Q2：跨域请求和同域请求的区别？

同域请求浏览器不拦截，跨域请求浏览器会先发送 OPTIONS 预检请求，根据服务器响应决定是否发送实际请求。

### Q3：解决跨域的方式有哪些？

1. 后端设置 CORS 响应头
2. JSONP（仅支持 GET）
3. 代理转发
4. WebSocket

---

## 最佳实践

1. **生产环境不要使用 `*`**：明确允许的来源
2. **只允许必要的 HTTP 方法**：减少攻击面
3. **配置 `Access-Control-Allow-Credentials`**：如需携带 Cookie
4. **处理 OPTIONS 请求**：确保预检请求能正常响应
5. **Nginx 层也可配置**：统一管理跨域

---

## 思考题

前端在 http://example.com，后端 API 在 https://api.example.com，虽然是同一个域名但协议不同，算不算跨域？

下一节，我们学习 [拦截器与过滤器](/framework/springboot/interceptor-filter)，掌握请求处理的利器。
