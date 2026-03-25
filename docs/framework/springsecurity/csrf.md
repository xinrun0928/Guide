# CSRF 防护机制与 Token 校验

你有没有想过这个问题：为什么登录成功后，再打开一个标签页访问同一个网站，还需要重新登录？

这背后就有 CSRF 防护的影子。

CSRF（跨站请求伪造）是 Web 安全中最常见也最容易被忽视的漏洞之一。今天，我们就来深入了解 Spring Security 是如何防护 CSRF 攻击的。

---

## CSRF 攻击原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CSRF 攻击原理                                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  假设用户在银行网站登录，访问余额转账页面                               │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 银行网站：https://bank.example.com                              │   │
│  │                                                                  │   │
│  │ 正常的转账请求：                                                │   │
│  │ POST /transfer?to=张三&amount=1000                             │   │
│  │                                                                  │   │
│  │ 请求会携带 Cookie：JSESSIONID=xxx                                │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  攻击者诱使受害者访问恶意网站                                         │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 恶意网站：https://evil.com                                     │   │
│  │                                                                  │   │
│  │ &lt;html&gt;                                                          │   │
│  │   &lt;body&gt;                                                         │   │
│  │     &lt;form action="https://bank.example.com/transfer"          │   │
│  │          method="POST"&gt;                                          │   │
│  │       &lt;input name="to" value="攻击者账户"&gt;                      │   │
│  │       &lt;input name="amount" value="10000"&gt;                        │   │
│  │     &lt;/form&gt;                                                       │   │
│  │     &lt;script&gt;document.forms[0].submit();&lt;/script&gt;              │   │
│  │   &lt;/body&gt;                                                        │   │
│  │ &lt;/html&gt;                                                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  攻击流程：                                                            │
│                                                                          │
│  1. 用户登录银行网站，获取有效 Session                                │
│  2. 用户被诱骗访问恶意网站                                            │
│  3. 恶意网站自动提交表单（利用用户已登录的 Cookie）                    │
│  4. 银行网站收到请求，Cookie 有效，执行转账操作                       │
│  5. 用户毫不知情，钱已经被转走了                                       │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 为什么 Cookie 不能防止 CSRF？

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     Cookie 自动携带的问题                               │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Cookie 的机制：                                                       │
│                                                                          │
│  浏览器在发送请求时，会自动携带对应域名的 Cookie                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 恶意网站发送请求到 bank.example.com                               │   │
│  │                                                                  │   │
│  │ 请求会自动携带：Cookie: JSESSIONID=xxx                           │   │
│  │                                                                  │   │
│  │ 银行网站验证 Cookie 有效，就会处理请求                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  问题：Cookie 只验证「请求是否来自浏览器」，不验证「请求是否来自网站」   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ 恶意网站的请求：                                                 │   │
│  │   来源：https://evil.com                                         │   │
│  │   目标：https://bank.example.com/transfer                        │   │
│  │   Cookie：有效 ✓                                                │   │
│  │   身份：未知 ✗                                                  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## CSRF 防护原理

### 核心思想

CSRF 攻击成功的原因是：**恶意网站可以伪造请求，但无法获取用户网站的身份凭证（Cookie）**。

防护方法：**在表单中添加一个只有当前网站知道的随机 Token，恶意网站无法伪造这个 Token**。

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         CSRF Token 防护原理                             │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  正常请求流程：                                                        │
│                                                                          │
│  1. 用户访问银行网站，银行网站生成 CSRF Token                           │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ &lt;form action="/transfer" method="POST"&gt;                           │   │
│  │   &lt;input name="to" value="张三"&gt;                                │   │
│  │   &lt;input name="amount" value="1000"&gt;                            │   │
│  │   &lt;input type="hidden"                                           │   │
│  │        name="_csrf"                                              │   │
│  │        value="abc123xyz"&gt;  ← CSRF Token                         │   │
│  │ &lt;/form&gt;                                                          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  2. 用户提交表单，请求携带 Token                                       │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ POST /transfer                                                   │   │
│  │ Cookie: JSESSIONID=xxx                                            │   │
│  │ _csrf: abc123xyz                                                 │   │
│  │ to: 张三                                                         │   │
│  │ amount: 1000                                                     │   │
│  │                                                                  │   │
│  │ 银行网站验证：Cookie 有效 ✓ + Token 有效 ✓ = 处理请求             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ────────────────────────────────────────────────────────────────────  │
│                                                                          │
│  恶意网站伪造请求：                                                    │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ POST /transfer                                                   │   │
│  │ Cookie: JSESSIONID=xxx  ← 可以自动携带                           │   │
│  │ _csrf: ????         ← 恶意网站不知道 Token，无法伪造             │   │
│  │                                                                  │   │
│  │ 银行网站验证：Cookie 有效 ✓ + Token 无效 ✗ = 拒绝请求             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Spring Security CSRF 配置

### 1. 默认配置（启用 CSRF）

Spring Security 6.x 默认启用 CSRF 防护：

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
            // 默认启用 CSRF，不需要显式配置
            // .csrf(csrf -> csrf.enable())
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
}
```

### 2. 禁用 CSRF

某些场景下可以禁用 CSRF（如纯 API 服务）：

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
            // 禁用 CSRF（仅适用于 API 场景）
            .csrf(csrf -> csrf.disable())
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
}
```

### 3. 自定义 CSRF 配置

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
            .csrf(csrf -> csrf
                // 自定义 Token 存储方式
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                
                // 自定义请求匹配器（哪些请求需要 CSRF 验证）
                .ignoringRequestMatchers("/api/public/**", "/webhook/**")
                
                // 自定义 Cookie 配置
                .cookieHttpOnly(false)
            )
            .formLogin(Customizer.withDefaults());
        
        return http.build();
    }
}
```

---

## CSRF Token 的使用

### 1. 表单提交（Thymeleaf）

```html
&lt;!-- Thymeleaf 自动添加 CSRF Token --&gt;
&lt;form th:action="@{/transfer}" th:method="post"&gt;
    &lt;!-- Thymeleaf 会自动添加 _csrf hidden 字段 --&gt;
    &lt;input type="text" name="to" /&gt;
    &lt;input type="number" name="amount" /&gt;
    &lt;button type="submit"&gt;转账&lt;/button&gt;
&lt;/form&gt;

&lt;!-- 生成的 HTML --&gt;
&lt;form action="/transfer" method="post"&gt;
    &lt;input type="hidden" name="_csrf" value="abc123xyz" /&gt;
    &lt;input type="text" name="to" /&gt;
    &lt;input type="number" name="amount" /&gt;
    &lt;button type="submit"&gt;转账&lt;/button&gt;
&lt;/form&gt;
```

### 2. AJAX 请求

```javascript
// 方式一：从 Cookie 中读取 Token
function getCsrfToken() {
    const name = 'XSRF-TOKEN';
    let cookieValue = null;
    document.cookie.split(';').forEach(cookie => {
        const [key, value] = cookie.trim().split('=');
        if (key === name) {
            cookieValue = decodeURIComponent(value);
        }
    });
    return cookieValue;
}

// 方式二：从 meta 标签中读取（推荐）
// 在 HTML 中添加：
// &lt;meta name="_csrf" content="${_csrf.token}" /&gt;
// &lt;meta name="_csrf_header" content="${_csrf.headerName}" /&gt;

function getCsrfToken() {
    return document.querySelector('meta[name="_csrf"]').content;
}

function getCsrfHeader() {
    return document.querySelector('meta[name="_csrf_header"]').content;
}

// AJAX 请求示例
async function transfer(to, amount) {
    const token = getCsrfToken();
    const header = getCsrfHeader();
    
    const response = await fetch('/transfer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            [header]: token  // 将 Token 放在请求头中
        },
        body: JSON.stringify({ to, amount })
    });
    
    return response.json();
}
```

### 3. Spring MVC 获取 Token

```java
@Controller
public class TransferController {
    
    // 方式一：通过 CsrfToken 参数
    @PostMapping("/transfer")
    public String transfer(@RequestParam String to,
                          @RequestParam BigDecimal amount,
                          CsrfToken csrfToken) {
        // 使用 CsrfToken
        log.info("CSRF Token: {}", csrfToken.getToken());
        // ...
        return "success";
    }
    
    // 方式二：通过 HttpServletRequest
    @PostMapping("/transfer2")
    public String transfer2(HttpServletRequest request) {
        CsrfToken csrf = (CsrfToken) request.getAttribute(
            "_csrf");
        log.info("Token: {}", csrf.getToken());
        // ...
        return "success";
    }
}
```

---

## CookieCsrfTokenRepository

### 工作原理

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    CookieCsrfTokenRepository 原理                       │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  响应流程：                                                            │
│                                                                          │
│  1. 服务器生成 CSRF Token                                              │
│  2. 服务器通过 Cookie 返回给浏览器                                     │
│                                                                          │
│  Set-Cookie: XSRF-TOKEN=abc123xyz; Path=/                             │
│                                                                          │
│  3. 浏览器保存 Cookie                                                  │
│  4. 浏览器发送请求 时，自动携带 Cookie                                  │
│                                                                          │
│  Cookie: XSRF-TOKEN=abc123xyz                                          │
│                                                                          │
│  5. 服务器从 Cookie 中读取 Token，与请求参数/头中的 Token 比较          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 配置示例

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                // 将 Token 存储在 Cookie 中
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                
                // 设置 Cookie 名称
                // 默认是 XSRF-TOKEN
                
                // 设置 Header 名称
                // 默认是 X-XSRF-TOKEN
            );
        
        return http.build();
    }
}
```

### 前端配合

```javascript
// 读取 Cookie 中的 Token
function getXsrfToken() {
    const cookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('XSRF-TOKEN='));
    
    return cookie ? cookie.split('=')[1] : null;
}

// AJAX 请求时放在 Header 中
fetch('/api/data', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-XSRF-TOKEN': getXsrfToken()
    },
    body: JSON.stringify({ data: 'value' })
});
```

---

## 常见问题

### 问题一：前后端分离项目如何处理 CSRF？

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                // 禁用 CSRF（JWT 场景）
                .disable()
            )
            // 或使用自定义 Token 验证逻辑
            .csrf(csrf -> csrf
                .csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                .csrfTokenRequestAttribute("_csrf")
            );
        
        return http.build();
    }
}
```

### 问题二：微服务之间调用如何处理 CSRF？

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf
                // 微服务内部调用忽略 CSRF
                .ignoringRequestMatchers("/internal/**")
            );
        
        return http.build();
    }
}
```

### 问题三：CSRF Token 过期了怎么办？

```java
// 前后端约定好返回特定错误码，前端刷新页面重新获取 Token
@ExceptionHandler(CsrfException.class)
public Result&lt;Void&gt; handleCsrfException(CsrfException e) {
    return Result.fail(403, "CSRF Token 无效，请刷新页面后重试");
}
```

---

## 面试追问方向

| 问题 | 考察点 | 延伸阅读 |
|-----|--------|---------|
| 什么是 CSRF 攻击？原理是什么？ | 概念理解 | 本篇 |
| Cookie 为什么不安全？ | 原理理解 | 本篇 |
| CSRF Token 是如何工作的？ | 原理理解 | 本篇 |
| 什么场景下可以禁用 CSRF？ | 实战理解 | 本篇 |
| 前后端分离项目如何处理 CSRF？ | 实战能力 | 本篇 |

---

## 总结

CSRF 防护的核心要点：

1. **攻击原理**：恶意网站伪造用户请求，利用 Cookie 身份凭证
2. **防护思想**：在表单中添加随机 Token，恶意网站无法伪造
3. **Spring Security**：默认启用 CSRF 防护
4. **Token 存储**：Cookie 或 Session
5. **AJAX 处理**：从 Cookie/Header 中获取 Token

CSRF 和 XSS 往往配合使用，防护需要系统性的安全设计。

---

## 下一步

- 想了解 XSS 防护？→ [XSS 防护](/framework/springsecurity/xss)
- 想了解 CORS 配置？→ [CORS 跨域与 Security 配置](/framework/springsecurity/cors)
- 想了解微服务安全？→ [Gateway 统一鉴权中心](/framework/springsecurity/gateway-auth)
