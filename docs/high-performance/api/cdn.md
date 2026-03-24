# CDN 加速与静态资源缓存

你有没有遇到过这种情况：

- 服务器在美国，访问用户在中国，网页加载要 3 秒
- 静态资源变更后，用户还是看到旧版本
- 网站突然被刷流量，服务器差点挂掉

这些问题，**CDN 可以一并解决**。

CDN 不是银弹，但它是互联网基础设施中最重要的性能优化手段之一。全球 80% 以上的流量都经过 CDN 分发——它几乎无处不在，只是你感知不到。

---

## 一、CDN 是什么？

### 1.1 工作原理

CDN（Content Delivery Network，内容分发网络）的核心思想是：**把内容放到离用户更近的地方。**

```java
public class CdnPrinciple {

    public static void main(String[] args) {
        System.out.println("========== 无 CDN vs 有 CDN ==========");
        System.out.println();

        System.out.println("┌─────────────────────────────────────────────────┐");
        System.out.println("│                   无 CDN                         │");
        System.out.println("│                                                 │");
        System.out.println("│    用户 ──────────────────► 服务器               │");
        System.out.println("│           (跨地域, 100ms+)                       │");
        System.out.println("│                                                 │");
        System.out.println("│    问题:                                         │");
        System.out.println("│    - 延迟高                                      │");
        System.out.println("│    - 服务器压力大                                │");
        System.out.println("│    - 单点故障风险                                │");
        System.out.println("└─────────────────────────────────────────────────┘");
        System.out.println();

        System.out.println("┌─────────────────────────────────────────────────┐");
        System.out.println("│                   有 CDN                         │");
        System.out.println("│                                                 │");
        System.out.println("│    用户 ──► 边缘节点(近) ──► 源站(远)            │");
        System.out.println("│              10ms                  100ms         │");
        System.out.println("│                                                 │");
        System.out.println("│    优势:                                         │");
        System.out.println("│    - 延迟低                                      │");
        System.out.println("│    - 减轻源站压力                                │");
        System.out.println("│    - 高可用                                      │");
        System.out.println("└─────────────────────────────────────────────────┘");
    }
}
```

### 1.2 CDN 访问流程

```java
public class CdnAccessFlow {

    public static void main(String[] args) {
        System.out.println("========== CDN 请求流程 ==========");
        System.out.println();

        System.out.println("1. DNS 解析 (0ms)");
        System.out.println("   用户请求 static.example.com");
        System.out.println("   DNS 返回: 最近的 CDN 边缘节点 IP");
        System.out.println();

        System.out.println("2. 就近访问 (10-50ms)");
        System.out.println("   用户直接访问 CDN 边缘节点");
        System.out.println();

        System.out.println("3. 缓存命中判断 (1ms)");
        System.out.println("   CDN 节点检查: 该资源是否在缓存中?");
        System.out.println("   ↓");
        System.out.println("   ├─ 命中 → 直接返回 (总计 11-51ms)");
        System.out.println("   │");
        System.out.println("   └─ 未命中 → 回源获取 (100-300ms+)");
        System.out.println("       ↓");
        System.out.println("       1. CDN 向源站请求资源");
        System.out.println("       2. 源站返回资源");
        System.out.println("       3. CDN 缓存资源");
        System.out.println("       4. CDN 返回资源给用户");
    }
}
```

---

## 二、CDN 缓存策略

### 2.1 缓存 Key 设计

```java
/**
 * CDN 缓存 Key 设计原则
 */
public class CacheKeyDesign {

    public static void main(String[] args) {
        System.out.println("========== 缓存 Key 设计 ==========");
        System.out.println();

        System.out.println("CDN 缓存 Key = URL 路径 + 查询参数");
        System.out.println();

        System.out.println("示例:");
        System.out.println("  https://cdn.example.com/js/app.js?v=1.2.3");
        System.out.println("  → 缓存 Key: /js/app.js?v=1.2.3");
        System.out.println();

        System.out.println("常见问题:");
        System.out.println("  ❌ 动态参数导致缓存失效");
        System.out.println("     https://cdn.example.com/api/users?_t=123");
        System.out.println("     https://cdn.example.com/api/users?_t=456");
        System.out.println("     → 两个 Key，缓存无法复用");
        System.out.println();

        System.out.println("  ✅ 合理设计参数");
        System.out.println("     - 静态资源: ?v=版本号 (用于更新)");
        System.out.println("     - 动态资源: ?w=宽&h=高 (图片尺寸)");
        System.out.println("     - 移除时间戳: ?_t=xxx");
    }
}

/**
 * 图片处理 URL 生成
 */
public class ImageUrlGenerator {

    private static final String CDN_DOMAIN = "https://cdn.example.com";

    /**
     * 生成不同尺寸的图片 URL
     */
    public String generateImageUrl(String originalPath, int width, int height) {
        // CDN 会自动处理图片缩放
        return String.format("%s%s?imageMogr2/thumbnail/%dx%d",
                CDN_DOMAIN, originalPath, width, height);
    }

    /**
     * 生成带版本号的静态资源 URL
     */
    public String generateStaticUrl(String path, String version) {
        return String.format("%s%s?v=%s", CDN_DOMAIN, path, version);
    }
}
```

### 2.2 缓存过期策略

```java
/**
 * 缓存过期策略配置
 */
public class CacheExpirationStrategy {

    public static void main(String[] args) {
        System.out.println("========== 缓存过期策略 ==========");
        System.out.println();

        System.out.println("资源类型              │  建议缓存时间  │  说明");
        System.out.println("─────────────────────┼──────────────┼────────────────────");
        System.out.println("HTML 页面            │  no-cache    │  几乎不缓存");
        System.out.println("JS/CSS (带版本号)     │  1年         │  长期缓存，更新版本号");
        System.out.println("图片 (用户上传)       │  7-30天      │  变化少");
        System.out.println("图片 (商品图)         │  1-7天       │  可能更新");
        System.out.println("API 响应 (公共)       │  1-5分钟     │  短时缓存");
        System.out.println("API 响应 (用户私有)    │  no-cache    │  不缓存");
    }
}

/**
 * HTTP 缓存响应头设置
 */
public class CacheHeadersConfig {

    public static void main(String[] args) {
        System.out.println("========== 缓存响应头 ==========");
        System.out.println();

        System.out.println("1. Cache-Control: max-age=31536000");
        System.out.println("   含义: 缓存有效期 1 年");
        System.out.println();

        System.out.println("2. Expires: Sat, 24 Mar 2027 00:00:00 GMT");
        System.out.println("   含义: 具体过期时间点");
        System.out.println("   注意: 与 Cache-Control 冲突时，优先使用 Cache-Control");
        System.out.println();

        System.out.println("3. ETag: \"abc123\"");
        System.out.println("   含义: 资源版本标识");
        System.out.println("   用途: 验证资源是否变化");
        System.out.println();

        System.out.println("4. Last-Modified: Sat, 24 Mar 2024 00:00:00 GMT");
        System.out.println("   含义: 资源最后修改时间");
        System.out.println("   用途: 配合 If-Modified-Since 验证");
    }
}
```

### 2.3 Java 设置缓存头

```java
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;

public class CacheControlFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String path = httpRequest.getRequestURI();

        if (isStaticResource(path)) {
            // 静态资源: 长期缓存
            httpResponse.setHeader("Cache-Control", "public, max-age=31536000, immutable");
            httpResponse.setHeader("Expires", getFutureDate());
            httpResponse.setHeader("ETag", generateEtag(path));
        } else if (isPublicApi(path)) {
            // 公共 API: 短期缓存
            httpResponse.setHeader("Cache-Control", "public, max-age=300");
        } else {
            // 私有内容: 不缓存
            httpResponse.setHeader("Cache-Control", "no-store");
        }

        chain.doFilter(request, response);
    }

    private boolean isStaticResource(String path) {
        return path.endsWith(".js") ||
               path.endsWith(".css") ||
               path.endsWith(".png") ||
               path.endsWith(".jpg") ||
               path.endsWith(".woff2");
    }

    private boolean isPublicApi(String path) {
        // 判断是否为可缓存的公共 API
        return path.startsWith("/api/public/");
    }

    private String generateEtag(String path) {
        // 实际应基于文件内容或版本号生成
        return "\"" + Integer.toHexString(path.hashCode()) + "\"";
    }

    private String getFutureDate() {
        // 一年后的日期
        return "Sat, 24 Mar 2027 00:00:00 GMT";
    }
}
```

---

## 三、资源版本管理

### 3.1 基于版本号的缓存更新

```java
/**
 * 静态资源版本管理
 */
public class VersionedResourceManager {

    private static final String CDN_DOMAIN = "https://cdn.example.com";

    /**
     * 方式一: URL 路径版本
     * /v1.0.0/js/app.js
     * /v1.1.0/js/app.js
     */
    public String versionedPath(String resource, String version) {
        return String.format("%s/v%s%s", CDN_DOMAIN, version, resource);
    }

    /**
     * 方式二: 查询参数版本
     * /js/app.js?v=1.0.0
     */
    public String versionedQuery(String resource, String version) {
        return String.format("%s%s?v=%s", CDN_DOMAIN, resource, version);
    }

    /**
     * 方式三: 内容 Hash (推荐)
     * /js/app.a1b2c3d4.js
     * 文件内容变化 → Hash 变化 → 缓存自动失效
     */
    public String contentHashPath(String resource, byte[] content) {
        String hash = md5(content).substring(0, 8);
        String baseName = resource.replace(".js", "." + hash + ".js");
        return CDN_DOMAIN + baseName;
    }

    private String md5(byte[] content) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(content);
            StringBuilder sb = new StringBuilder();
            for (byte b : digest) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

### 3.2 HTML 引用版本化资源

```java
import java.util.regex.*;

public class HtmlResourceVersioning {

    /**
     * 自动替换 HTML 中的资源引用为版本化 URL
     */
    public String processHtml(String html, ResourceManifest manifest) {
        // 替换 JS 引用
        html = replaceScriptSrc(html, manifest);

        // 替换 CSS 引用
        html = replaceLinkHref(html, manifest);

        // 替换图片引用
        html = replaceImageSrc(html, manifest);

        return html;
    }

    private String replaceScriptSrc(String html, ResourceManifest manifest) {
        Pattern pattern = Pattern.compile("&lt;script src=\"(/js/[^\"]+)\"&gt;&lt;/script&gt;");
        Matcher matcher = pattern.matcher(html);
        StringBuffer sb = new StringBuffer();

        while (matcher.find()) {
            String original = matcher.group(1);
            String versioned = manifest.getVersionedPath(original);
            matcher.appendReplacement(sb, "&lt;script src=\"" + versioned + "\"&gt;&lt;/script&gt;");
        }

        matcher.appendTail(sb);
        return sb.toString();
    }
}

/**
 * 资源清单
 */
public class ResourceManifest {

    private Map&lt;String, String&gt; manifest = new HashMap&lt;&gt;();

    public ResourceManifest() {
        // 实际应从构建产物读取
        manifest.put("/js/app.js", "/js/app.a1b2c3d4.js");
        manifest.put("/css/main.css", "/css/main.e5f6g7h8.css");
    }

    public String getVersionedPath(String original) {
        return manifest.getOrDefault(original, original);
    }
}
```

---

## 四、CDN 配置实战

### 4.1 Nginx 源站配置

```nginx
server {
    listen 80;
    server_name origin.example.com;

    # 关闭源站的压缩，让 CDN 节点处理
    gzip off;

    location / {
        # 添加 CDN 需要的响应头
        add_header Cache-Control 'public, max-age=86400';
        add_header X-Cache-Status $upstream_cache_status;

        proxy_pass http://backend;
    }

    # 静态资源
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 1y;
        add_header Cache-Control 'public, max-age=31536000, immutable';

        # 允许 CDN 访问
        allow all;
    }
}
```

### 4.2 缓存刷新策略

```java
/**
 * CDN 缓存刷新策略
 */
public class CacheRefreshStrategy {

    public static void main(String[] args) {
        System.out.println("========== 缓存刷新策略 ==========");
        System.out.println();

        System.out.println("1. 被动刷新 (推荐):");
        System.out.println("   - 设置合理的缓存时间");
        System.out.println("   - 版本号/Hash 变化时，URL 变化");
        System.out.println("   - 新 URL 自然不会被缓存");
        System.out.println();

        System.out.println("2. 主动刷新:");
        System.out.println("   - CDN 提供 API 调用刷新");
        System.out.println("   - 发布新版本时主动刷新");
        System.out.println("   - 适合紧急修复");
        System.out.println();

        System.out.println("3. 灰度刷新:");
        System.out.println("   - 先刷新少数节点");
        System.out.println("   - 验证无误后全量刷新");
        System.out.println("   - 适合重要资源");
    }
}

/**
 * 调用 CDN API 刷新缓存
 */
public class CdnRefreshClient {

    private final CloseableHttpClient httpClient;

    public void refreshUrls(List&lt;String&gt; urls) {
        String refreshUrl = "https://api.cdn-provider.com/v2/cache/refresh";

        HttpPost request = new HttpPost(refreshUrl);
        request.setHeader("Authorization", "Bearer " + getToken());

        String json = String.format("{\"urls\": %s}", urls);
        request.setEntity(new StringEntity(json, ContentType.APPLICATION_JSON));

        try (CloseableHttpResponse response = httpClient.execute(request)) {
            int statusCode = response.getStatusLine().getStatusCode();
            if (statusCode != 200) {
                throw new RuntimeException("CDN 刷新失败: " + statusCode);
            }
        } catch (Exception e) {
            throw new RuntimeException("CDN 刷新异常", e);
        }
    }

    private String getToken() {
        return ""; // 从配置获取
    }
}
```

---

## 五、CORS 与 CDN

### 5.1 跨域资源共享配置

```java
/**
 * CDN CORS 配置
 */
public class CorsConfiguration {

    public static void main(String[] args) {
        System.out.println("========== CDN CORS 配置 ==========");
        System.out.println();

        System.out.println("场景: API 在 a.com，静态资源在 cdn.a.com");
        System.out.println();

        System.out.println("需要的响应头:");
        System.out.println("  Access-Control-Allow-Origin: https://a.com");
        System.out.println("  Access-Control-Allow-Methods: GET, POST, OPTIONS");
        System.out.println("  Access-Control-Allow-Headers: Content-Type");
        System.out.println("  Access-Control-Max-Age: 86400  (预检结果缓存 1 天)");
        System.out.println();

        System.out.println("⚠️ 注意事项:");
        System.out.println("  - 不要设置 Access-Control-Allow-Origin: *");
        System.out.println("  - Cookie 不能在跨域场景下传递");
        System.out.println("  - 预检请求会增加延迟");
    }
}
```

### 5.2 CDN 防盗链

```java
/**
 * CDN 防盗链配置
 */
public class AntiHotlinkingConfig {

    public static void main(String[] args) {
        System.out.println("========== CDN 防盗链方案 ==========");
        System.out.println();

        System.out.println("1. Referer 校验:");
        System.out.println("   检查请求头中的 Referer");
        System.out.println("   配置白名单域名");
        System.out.println();

        System.out.println("2. URL 签名 (推荐):");
        System.out.println("   用户请求: /path/file.jpg?sign=xxx&t=1234567890");
        System.out.println("   签名 = MD5(密钥 + 路径 + 过期时间)");
        System.out.println("   CDN 验证签名和有效期");
        System.out.println("   优点: 无法伪造，安全性高");
        System.out.println();

        System.out.println("3. IP 黑名单:");
        System.out.println("   封禁异常 IP");
        System.out.println("   配合 CC 防护使用");
    }
}

/**
 * URL 签名生成
 */
public class UrlSigner {

    private static final String SECRET_KEY = "your-secret-key";

    public String signUrl(String path, long expireTime) {
        String stringToSign = path + expireTime;
        String signature = hmacSha256(stringToSign, SECRET_KEY);

        return String.format("%s?sign=%s&t=%d",
                path, signature, expireTime);
    }

    private String hmacSha256(String data, String key) {
        try {
            javax.crypto.Mac mac = javax.crypto.Mac.getInstance("HmacSHA256");
            javax.crypto.spec.SecretKeySpec spec =
                    new javax.crypto.spec.SecretKeySpec(key.getBytes(), "HmacSHA256");
            mac.init(spec);
            byte[] hash = mac.doFinal(data.getBytes());
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```

---

## 六、性能监控

### 6.1 CDN 命中率监控

```java
/**
 * CDN 命中率监控
 */
public class CdnHitRateMonitoring {

    public static void main(String[] args) {
        System.out.println("========== CDN 命中率分析 ==========");
        System.out.println();

        System.out.println("命中类型:");
        System.out.println("  HIT: CDN 缓存命中，直接返回");
        System.out.println("  MISS: 缓存未命中，回源获取");
        System.out.println("  EXPIRED: 缓存过期，回源验证");
        System.out.println("  STALE: 使用过期缓存，同时回源");
        System.out.println("  ERROR: CDN 节点异常");
        System.out.println();

        System.out.println("优化方向:");
        System.out.println("  1. 提高缓存命中率 (HIT)");
        System.out.println("     - 增加缓存时间");
        System.out.println("     - 减少版本号变化");
        System.out.println("  2. 减少 EXPIRED");
        System.out.println("     - 使用 stale-while-revalidate");
        System.out.println("  3. 监控 ERROR 率");
        System.out.println("     - 设置告警");
        System.out.println("     - 准备降级方案");
    }
}
```

### 6.2 监控指标定义

```java
public class CdnMetricsDefinition {

    public static void main(String[] args) {
        System.out.println("========== CDN 关键指标 ==========");
        System.out.println();

        System.out.println("┌──────────────────┬────────────────────────────────────┐");
        System.out.println("│     指标         │           说明                      │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ 缓存命中率       │ HIT / TOTAL × 100%                │");
        System.out.println("│                  │ 目标: > 95%                         │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ 回源率           │ MISS / TOTAL × 100%               │");
        System.out.println("│                  │ 目标: < 5%                          │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ 平均响应时间     │ CDN 节点到用户的平均时间             │");
        System.out.println("│                  │ 目标: < 50ms                        │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ 回源响应时间     │ CDN 到源站的响应时间                 │");
        System.out.println("│                  │ 目标: < 100ms                       │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ 带宽峰值         │ 突发流量处理能力                     │");
        System.out.println("│                  │ 需预留 20-30% 余量                   │");
        System.out.println("├──────────────────┼────────────────────────────────────┤");
        System.out.println("│ HTTP 错误率      │ 4xx + 5xx / TOTAL                   │");
        System.out.println("│                  │ 目标: < 0.1%                         │");
        System.out.println("└──────────────────┴────────────────────────────────────┘");
    }
}
```

---

## 留给你的问题

CDN 是性能优化的利器，但也是一把双刃剑。

**你的网站/应用现在用 CDN 了吗？缓存命中率是多少？如果还没有用 CDN，可能的原因是什么？**

还有一个值得思考的问题：CDN 缓存虽然快，但当源站出问题时，CDN 上的过期缓存可能让问题更难排查。**你有什么办法在享受 CDN 加速的同时，保证缓存的一致性？**
