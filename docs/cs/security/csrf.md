# CSRF：跨越边界的恶意请求

你登录了银行网站，正准备转账。

你打开了一个新标签页，浏览了一会儿网页，然后回到银行页面准备转账。

但你不知道，刚才浏览的某个网页里，有一段隐藏代码，在你打开银行页面的瞬间，悄悄发送了一个转账请求，把你的钱转给了攻击者。

这就是 **CSRF（Cross-Site Request Forgery，跨站请求伪造）**。

## CSRF 的原理

CSRF 的核心是**利用用户已登录的身份，伪造请求**。

```
攻击原理：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  1. 用户登录银行网站 bank.com，浏览器保存 Session Cookie     │
│                                                             │
│  2. 用户访问恶意网站 evil.com                                │
│                                                             │
│  3. evil.com 的页面中隐藏着银行转账请求                      │
│     <img src="https://bank.com/transfer?to=hacker&amount=10000">│
│                                                             │
│  4. 浏览器加载图片时，自动带上 bank.com 的 Cookie            │
│                                                             │
│  5. 银行服务器收到请求，以为是用户发的，执行转账              │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**关键点**：
- 用户已登录银行网站（Cookie 有效）
- 恶意页面构造了请求
- 浏览器自动带上 Cookie
- 服务器无法区分是用户主动还是被伪造的请求

## CSRF vs XSS

很多人搞混 CSRF 和 XSS，它们有本质区别：

| | CSRF | XSS |
|--|------|-----|
| 攻击目标 | 服务器 | 客户端（浏览器） |
| 原理 | 伪造请求 | 注入脚本 |
| 前提 | 用户已登录 | 无需登录 |
| 防护 | 令牌/验证来源 | 输入过滤/输出编码 |
| 危害 | 执行非预期操作 | 偷数据/篡改页面 |

**联系**：XSS 可以用来窃取 CSRF Token，使 CSRF 攻击更容易成功。

## CSRF 的攻击场景

### 1. GET 请求最容易被攻击

```html
<!-- 恶意页面 -->
<img src="https://bank.com/transfer?to=hacker&amount=10000" style="display:none">

<!-- 或者 -->
<script>
    fetch('https://bank.com/transfer?to=hacker&amount=10000');
</script>
```

### 2. POST 请求也可以伪造

```html
<!-- 恶意页面 -->
<form action="https://bank.com/transfer" method="POST" id="csrf-form">
    <input name="to" value="hacker">
    <input name="amount" value="10000">
</form>
<script>
    document.getElementById('csrf-form').submit();
</script>
```

### 3. 自动化攻击框架

```javascript
// 攻击者脚本：自动扫描并利用 CSRF
class CSRFScanner {
    scan() {
        // 1. 爬取页面所有表单
        const forms = document.querySelectorAll('form');
        
        // 2. 提取表单信息
        forms.forEach(form => {
            const action = form.action;
            const method = form.method;
            const inputs = this.extractInputs(form);
            
            // 3. 检查是否有 CSRF 保护
            if (!this.hasCSRFToken(form)) {
                console.log(`发现无保护表单: ${action}`);
            }
        });
    }
}
```

## CSRF 防御：令牌机制

### 1. CSRF Token 原理

```
正常流程：
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│  用户请求页面                                                │
│       ↓                                                     │
│  服务器生成随机 Token，嵌入表单                               │
│       ↓                                                     │
│  <form>
│      <input type="hidden" name="csrf_token" value="abc123"> │
│      ...                                                     │
│  </form>                                                    │
│       ↓                                                     │
│  用户提交表单                                                │
│       ↓                                                     │
│  服务器验证 Token                                           │
│       ↓                                                     │
│  Token 正确 → 处理请求                                       │
│  Token 错误 → 拒绝请求                                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2. Spring Security CSRF Token

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 启用 CSRF 保护
            .csrf(csrf -> csrf
                // Cookie 方式：Token 存在 Cookie 中
                .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                // 或：使用 HTTP 头验证（更适合 SPA）
                // .csrfTokenRepository(new HttpSessionCsrfTokenRepository())
                
                // 禁用 CSRF 的接口
                .ignoringRequestMatchers("/api/public/**", "/health")
            );
        return http.build();
    }
}
```

### 3. 前后端配合

```html
<!-- HTML 表单：自动注入 Token -->
<form action="/api/transfer" method="POST">
    <!-- Spring Security 自动注入 CSRF Token -->
    <input type="hidden" name="_csrf" value="abc123...">
    
    <input name="to" placeholder="收款人">
    <input name="amount" placeholder="金额">
    <button type="submit">转账</button>
</form>
```

```javascript
// AJAX 请求：手动添加 Token
const csrfToken = document.querySelector('meta[name="_csrf"]').content;
const csrfHeader = document.querySelector('meta[name="_csrf_header"]').content;

fetch('/api/transfer', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        [csrfHeader]: csrfToken  // 添加到请求头
    },
    body: JSON.stringify({
        to: 'hacker',
        amount: 10000
    })
});
```

### 4. SPA 的 CSRF 防护

```javascript
// Axios 请求拦截器：自动添加 CSRF Token
axios.interceptors.request.use(config => {
    // 从 Cookie 中读取 CSRF Token
    const token = getCookie('XSRF-TOKEN');
    if (token) {
        // Angular 约定：X-XSRF-TOKEN 头
        config.headers['X-XSRF-TOKEN'] = token;
    }
    return config;
});

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}
```

## 双重提交 Cookie

无状态 API 的 CSRF 防护方案：

```java
/**
 * 双重提交 Cookie CSRF 验证
 */
@Component
public class DoubleSubmitCsrfFilter extends OncePerRequestFilter {
    
    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                   HttpServletResponse response,
                                   FilterChain filterChain) 
            throws ServletException, IOException {
        
        // 只验证有请求体的请求
        if ("POST".equalsIgnoreCase(request.getMethod()) ||
            "PUT".equalsIgnoreCase(request.getMethod()) ||
            "DELETE".equalsIgnoreCase(request.getMethod())) {
            
            String cookieToken = getCookie(request, "csrf_token");
            String headerToken = request.getHeader("X-CSRF-TOKEN");
            
            if (cookieToken == null || !cookieToken.equals(headerToken)) {
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.getWriter().write("CSRF Token 无效");
                return;
            }
        }
        
        filterChain.doFilter(request, response);
    }
    
    private String getCookie(HttpServletRequest request, String name) {
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if (name.equals(cookie.getName())) {
                    return cookie.getValue();
                }
            }
        }
        return null;
    }
}
```

## SameSite Cookie

浏览器原生的 CSRF 防护：

```java
@Configuration
public class CookieConfig {
    
    @Bean
    public ResponseCookie sessionCookie() {
        return ResponseCookie.from("JSESSIONID", sessionId)
            .httpOnly(true)
            .secure(true)  // 只在 HTTPS 发送
            .sameSite("Strict")  // 严格模式：完全禁止跨站请求携带
            .path("/")
            .build();
    }
}
```

```
SameSite 三种模式：

Strict（最严格）：
    ❌ 任何跨站请求都不携带 Cookie
    ✅ 完全防护 CSRF
    ❌ 用户体验差，点击外链直接「登出」

Lax（推荐）：
    ❌ GET 请求不携带（如 <a>, <img> 加载）
    ✅ POST 等请求可携带
    ✅ 平衡安全和体验

None（无限制）：
    ⚠️ 允许跨站请求携带
    ⚠️ 必须配合 Secure（HTTPS）
    ⚠️ 不安全，除非必要不使用
```

## 面试追问方向

1. **CSRF 和 XSS 的区别？** —— CSRF 伪造请求，XSS 注入脚本；CSRF 攻击服务器，XSS 攻击用户
2. **为什么 GET 请求容易被 CSRF？** —— GET 请求可以直接用 img/script 标签发起
3. **SameSite Cookie 能完全替代 CSRF Token 吗？** —— 大部分场景可以，但旧浏览器不支持
4. **登录 CSRF 是什么？** —— 攻击者用自己账号登录，受害者用攻击者账号，后续敏感操作被攻击者监控
5. **SPA 如何处理 CSRF？** —— 双重提交 Cookie 或从后端获取 Token 并验证

> "CSRF 是利用信任的攻击。理解它的原理和防御手段，才能设计出真正安全的 Web 应用。"
