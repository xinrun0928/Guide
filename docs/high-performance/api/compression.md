# 接口响应压缩：GZIP、Br、Zstd

你有没有遇到过这种情况：

- 接口返回的数据量不大，但用户抱怨加载慢
- 网络带宽充足，但接口响应时间就是上不去
- 换了更快的服务器，性能却没有明显提升

**问题可能不在服务端，而在网络传输。**

如果你的接口返回 500KB 的 JSON，开启压缩后可能变成 50KB。传输时间从 200ms 降到 20ms。这不是优化，这是**降维打击**。

---

## 一、压缩为什么有效？

### 1.1 数据压缩的原理

```java
/**
 * 理解压缩效果
 */
public class CompressionUnderstanding {

    public static void main(String[] args) throws Exception {
        System.out.println("========== 为什么压缩有效？==========");
        System.out.println();

        // JSON 数据通常包含大量重复的模式
        String json = """
            {
              "users": [
                {"id": 1, "name": "张三", "email": "zhangsan@example.com"},
                {"id": 2, "name": "李四", "email": "lisi@example.com"},
                {"id": 3, "name": "王五", "email": "wangwu@example.com"}
              ]
            }
            """;

        System.out.println("原始 JSON:");
        System.out.println(json);
        System.out.printf("原始大小: %d bytes%n%n", json.getBytes().length);

        // 分析重复模式
        System.out.println("重复模式分析:");
        System.out.println("  - \"id\": 出现 3 次");
        System.out.println("  - \"name\": 出现 3 次");
        System.out.println("  - \"email\": 出现 3 次");
        System.out.println("  - \"example.com\": 出现 3 次");
        System.out.println("  - 冒号、逗号、花括号: 大量重复");
        System.out.println();

        System.out.println("压缩原理:");
        System.out.println("  用短编码替代长重复字符串");
        System.out.println("  'id' → 1, 'name' → 2, 'email' → 3...");
        System.out.println("  压缩后: [2][1][3][张][三][zhangsan][ex]...");
    }
}
```

### 1.2 压缩比的影响因素

```java
public class CompressionFactors {

    public static void main(String[] args) {
        System.out.println("========== 压缩比影响因素 ==========");
        System.out.println();

        System.out.println("高压缩比（>70%）:");
        System.out.println("  ✅ 重复文本多（如 JSON、XML、HTML）");
        System.out.println("  ✅ 数据有规律（如日志、配置）");
        System.out.println("  ✅ 包含长字符串（如 URL、邮箱）");
        System.out.println();

        System.out.println("低压缩比（&lt;30%）:");
        System.out.println("  ❌ 已压缩数据（如图片、PDF、ZIP）");
        System.out.println("  ❌ 随机数据（如加密内容）");
        System.out.println("  ❌ 极短响应（压缩头开销占比大）");
        System.out.println();

        System.out.println("判断标准:");
        System.out.println("  响应 > 1KB → 值得压缩");
        System.out.println("  响应 > 10KB → 必须压缩");
        System.out.println("  响应 &lt; 500B → 压缩可能适得其反");
    }
}
```

---

## 二、GZIP 压缩

### 2.1 GZIP 工作原理

GZIP 是最通用的压缩算法，基于 DEFLATE 算法（LZ77 + Huffman 编码）：

```java
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.zip.GZIPOutputStream;
import java.util.zip.GZIPInputStream;
import java.util.zip.Deflater;

public class GzipImplementation {

    /**
     * GZIP 压缩
     */
    public byte[] compress(String data) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (GZIPOutputStream gzip = new GZIPOutputStream(baos)) {
            gzip.write(data.getBytes("UTF-8"));
        }
        return baos.toByteArray();
    }

    /**
     * GZIP 解压
     */
    public String decompress(byte[] compressed) throws IOException {
        ByteArrayInputStream bais = new ByteArrayInputStream(compressed);
        ByteArrayOutputStream baos = new ByteArrayOutputStream();

        try (GZIPInputStream gzip = new GZIPInputStream(bais)) {
            byte[] buffer = new byte[1024];
            int len;
            while ((len = gzip.read(buffer)) > 0) {
                baos.write(buffer, 0, len);
            }
        }

        return baos.toString("UTF-8");
    }

    public static void main(String[] args) throws IOException {
        System.out.println("========== GZIP 压缩级别 ==========");
        System.out.println();

        String testData = "测试数据".repeat(1000);

        for (int level = 1; level <= 9; level++) {
            byte[] compressed = compressWithLevel(testData, level);
            System.out.printf("级别 %d: %d bytes (%.1f%%)%n",
                    level,
                    compressed.length,
                    (1 - (double) compressed.length / testData.length()) * 100);
        }

        System.out.println();
        System.out.println("推荐: 级别 6（默认）");
        System.out.println("原因: 压缩效果与性能的平衡点");
    }

    private static byte[] compressWithLevel(String data, int level) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        Deflater deflater = new Deflater(level);
        deflater.setInput(data.getBytes("UTF-8"));
        deflater.finish();

        byte[] buffer = new byte[1024];
        while (!deflater.finished()) {
            int count = deflater.deflate(buffer);
            baos.write(buffer, 0, count);
        }
        deflater.end();

        return baos.toByteArray();
    }
}
```

### 2.2 Spring Boot 启用 GZIP

```java
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.embedded.netty.NettyConfigUtils;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.netty.http.client.HttpClient;
import reactor.netty.http.client.HttpClientRequest;

@Configuration
public class GzipConfig {

    // 服务端配置
    @Bean
    public ConfigurableEmbeddedServletContainer containerFactory() {
        TomcatServletWebServerFactory factory = new TomcatServletWebServerFactory();
        factory.setProtocol("org.apache.coyote.http11.Http11Nio2Protocol");
        return factory;
    }
}
```

```yaml
# application.yml
server:
  compression:
    enabled: true              # 启用压缩
    mime-types: text/html,text/xml,text/plain,text/css,text/javascript,application/javascript,application/json,application/xml
    min-response-size: 1024    # 最小压缩阈值: 1KB
```

### 2.3 Nginx GZIP 配置

```nginx
http {
    gzip on;                           # 启用 gzip
    gzip_vary on;                      # 添加 Vary: Accept-Encoding
    gzip_proxied any;                 # 代理请求也压缩
    gzip_comp_level 6;                # 压缩级别 1-9
    gzip_min_length 1024;             # 最小压缩大小
    gzip_buffers 16 8k;               # 缓冲
    gzip_http_version 1.1;             # HTTP 版本
    gzip_types                        # 需要压缩的类型
        text/plain
        text/css
        text/xml
        application/json
        application/javascript
        application/xml
        application/xml+rss
        application/atom+xml
        image/svg+xml
        application/x-javascript
        application/vnd.ms-fontobject
        application/x-font-ttf
        font/opentype;
    gzip_disable "MSIE [1-6]\.";       # 禁用 IE6 压缩
}
```

---

## 三、Brotli (Br) 压缩

### 3.1 Brotli vs GZIP

Brotli 是 Google 2015 年推出的新压缩算法，相比 GZIP 有更好的压缩率：

```java
public class BrotliVsGzip {

    public static void main(String[] args) {
        System.out.println("========== Brotli vs GZIP ==========");
        System.out.println();

        System.out.println("压缩率对比:");
        System.out.println("┌─────────────┬────────┬────────┬────────┐");
        System.out.println("│   内容类型   │  GZIP  │ Brotli │  提升  │");
        System.out.println("├─────────────┼────────┼────────┼────────┤");
        System.out.println("│ HTML        │  72%   │  78%   │  +6%   │");
        System.out.println("│ CSS         │  68%   │  75%   │  +7%   │");
        System.out.println("│ JavaScript  │  62%   │  71%   │  +9%   │");
        System.out.println("│ JSON        │  65%   │  73%   │  +8%   │");
        System.out.println("│ 图片(PNG)   │   5%   │   8%   │  +3%   │");
        System.out.println("└─────────────┴────────┴────────┴────────┘");
        System.out.println();

        System.out.println("性能对比:");
        System.out.println("  GZIP: 压缩速度 ≈ 解压速度 (均衡)");
        System.out.println("  Brotli: 压缩速度较慢，解压速度相当");
        System.out.println();

        System.out.println("浏览器支持 (2024+):");
        System.out.println("  Chrome, Firefox, Safari, Edge 全支持");
        System.out.println("  可作为 GZIP 的增强选择");
    }
}
```

### 3.2 Nginx 启用 Brotli

```nginx
http {
    # 需要编译 brotli 模块
    # ngx_brotli 模块: https://github.com/google/ngx_brotli

    brotli on;
    brotli_vary on;
    brotli_comp_level 6;
    brotli_types
        text/plain
        text/css
        text/xml
        application/json
        application/javascript
        application/xml
        application/xml+rss
        application/atom+xml
        image/svg+xml
        application/x-javascript
        application/vnd.ms-fontobject
        application/x-font-ttf
        font/opentype;
}
```

### 3.3 内容协商（同时支持 GZIP 和 Brotli）

```java
/**
 * Spring Boot 实现多压缩算法支持
 */
@Configuration
public class MultiCompressionConfig {

    @Bean
    public WebClient webClient() {
        return WebClient.builder()
                // 客户端支持多种压缩格式
                .clientConnector(new ReactorClientHttpConnector(
                        HttpClient.create()
                                .compress(true) // 自动解压响应
                ))
                .build();
    }
}
```

---

## 四、Zstd 压缩

### 4.1 Zstd 简介

Zstd（Zstandard）是 Facebook 2016 年开源的压缩算法，主打**超高压缩速度**：

```java
public class ZstdFeatures {

    public static void main(String[] args) {
        System.out.println("========== Zstd 特性 ==========");
        System.out.println();

        System.out.println("性能对比 ( benchmark 数据):");
        System.out.println("┌─────────────┬────────────┬────────────┬────────────┐");
        System.out.println("│   算法      │  压缩速度   │  解压速度   │  压缩比    │");
        System.out.println("├─────────────┼────────────┼────────────┼────────────┤");
        System.out.println("│ GZIP (6)    │  30 MB/s   │  90 MB/s   │  2.5:1    │");
        System.out.println("│ Brotli (6)  │  20 MB/s   │  250 MB/s  │  2.8:1    │");
        System.out.println("│ Zstd (3)    │  200 MB/s  │  400 MB/s  │  2.5:1    │");
        System.out.println("│ Zstd (19)   │  20 MB/s   │  350 MB/s  │  3.2:1    │");
        System.out.println("└─────────────┴────────────┴────────────┴────────────┘");
        System.out.println();

        System.out.println("Zstd 优势:");
        System.out.println("  ✅ 超快的压缩/解压速度");
        System.out.println("  ✅ 可调节压缩级别 (1-22)");
        System.out.println("  ✅ 支持流式压缩");
        System.out.println("  ✅ 渐进式字典学习");
        System.out.println("  ✅ 良好的稳定性");
    }
}
```

### 4.2 Java 使用 Zstd

```java
import com.github.luben.zstd.Zstd;
import com.github.luben.zstd.ZstdInputStream;
import com.github.luben.zstd.ZstdOutputStream;

public class ZstdUsage {

    /**
     * Zstd 压缩
     */
    public byte[] compress(byte[] data) {
        // 压缩
        byte[] compressed = Zstd.compress(data, 3); // 级别 1-22
        return compressed;
    }

    /**
     * Zstd 解压
     */
    public byte[] decompress(byte[] compressed, int originalSize) {
        byte[] decompressed = Zstd.decompress(compressed, originalSize);
        return decompressed;
    }

    /**
     * 流式压缩（适合大文件）
     */
    public void compressStreaming(InputStream in, OutputStream out) throws IOException {
        try (ZstdOutputStream zstdOut = new ZstdOutputStream(out)) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = in.read(buffer)) > 0) {
                zstdOut.write(buffer, 0, len);
            }
        }
    }

    public static void main(String[] args) {
        System.out.println("Zstd-Java 库: github.com/luben/zstd-jni");
        System.out.println();
        System.out.println("Maven 依赖:");
        System.out.println("&lt;dependency&gt;");
        System.out.println("    &lt;groupId&gt;com.github.luben&lt;/groupId&gt;");
        System.out.println("    &lt;artifactId&gt;zstd-jni&lt;/artifactId&gt;");
        System.out.println("    &lt;version&gt;1.5.5-6&lt;/version&gt;");
        System.out.println("&lt;/dependency&gt;");
    }
}
```

---

## 五、压缩策略选择

### 5.1 算法对比

| 特性 | GZIP | Brotli | Zstd |
|-----|------|--------|------|
| 压缩率 | ★★★☆☆ | ★★★★☆ | ★★★★☆ |
| 压缩速度 | ★★★☆☆ | ★★☆☆☆ | ★★★★★ |
| 解压速度 | ★★★☆☆ | ★★★★☆ | ★★★★★ |
| 浏览器支持 | 100% | 95%+ | 90%+ |
| CPU 开销 | 中等 | 较高 | 低 |
| 成熟度 | 极高 | 高 | 高 |

### 5.2 选择建议

```java
public class CompressionStrategy {

    public static void main(String[] args) {
        System.out.println("========== 压缩策略选择 ==========");
        System.out.println();

        System.out.println("📌 Web 静态资源:");
        System.out.println("   首选: Brotli (最佳压缩率)");
        System.out.println("   降级: GZIP");
        System.out.println();

        System.out.println("📌 API 响应 (JSON/XML):");
        System.out.println("   首选: GZIP (兼容性最好)");
        System.out.println("   升级: Brotli");
        System.out.println("   高性能: Zstd");
        System.out.println();

        System.out.println("📌 大文件/流式数据:");
        System.out.println("   首选: Zstd (解压速度快)");
        System.out.println();

        System.out.println("📌 消息队列/内部传输:");
        System.out.println("   首选: Zstd");
        System.out.println("   备选: LZ4 (超快速度)");
        System.out.println();

        System.out.println("📌 日志存储:");
        System.out.println("   首选: Zstd (压缩比 + 速度平衡)");
        System.out.println("   大数据量: LZ4 (纯速度)");
    }
}
```

---

## 六、实战配置

### 6.1 HTTP API 压缩配置

```java
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.util.zip.GZIPOutputStream;

/**
 * 手动实现响应压缩
 */
public class GzipResponseFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response,
                         FilterChain chain) throws IOException, ServletException {
        HttpServletRequest httpRequest = (HttpServletRequest) request;
        HttpServletResponse httpResponse = (HttpServletResponse) response;

        String acceptEncoding = httpRequest.getHeader("Accept-Encoding");
        if (acceptEncoding == null || !acceptEncoding.contains("gzip")) {
            chain.doFilter(request, response);
            return;
        }

        // 使用包装类包装响应
        GzipHttpServletResponseWrapper wrappedResponse =
                new GzipHttpServletResponseWrapper(httpResponse);
        chain.doFilter(request, wrappedResponse);
        wrappedResponse.close();
    }

    public static class GzipHttpServletResponseWrapper
            extends HttpServletResponseWrapper {

        private GzipServletOutputStream gzipOutputStream;

        public GzipHttpServletResponseWrapper(HttpServletResponse response)
                throws IOException {
            super(response);
        }

        @Override
        public ServletOutputStream getOutputStream() throws IOException {
            if (gzipOutputStream == null) {
                gzipOutputStream = new GzipServletOutputStream(
                        getResponse().getOutputStream()
                );
            }
            return gzipOutputStream;
        }

        @Override
        public void setContentType(String type) {
            getResponse().setContentType(type);
        }

        public void close() throws IOException {
            if (gzipOutputStream != null) {
                gzipOutputStream.close();
            }
        }
    }
}
```

### 6.2 监控压缩效果

```java
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;

public class CompressionMonitoring {

    private final Timer uncompressedSize;
    private final Timer compressedSize;
    private final MeterRegistry registry;

    public CompressionMonitoring(MeterRegistry registry) {
        this.registry = registry;
        this.uncompressedSize = Timer.builder("api.response.size")
                .tag("type", "uncompressed")
                .register(registry);
        this.compressedSize = Timer.builder("api.response.size")
                .tag("type", "compressed")
                .register(registry);
    }

    public void recordResponse(int uncompressedBytes, int compressedBytes) {
        registry.counter("api.compression.bytes",
                "type", "uncompressed").increment(uncompressedBytes);
        registry.counter("api.compression.bytes",
                "type", "compressed").increment(compressedBytes);
    }

    public double getCompressionRatio() {
        double uncompressed =
                registry.counter("api.compression.bytes",
                        "type", "uncompressed").count();
        double compressed =
                registry.counter("api.compression.bytes",
                        "type", "compressed").count();
        return (1 - compressed / uncompressed) * 100;
    }
}
```

---

## 留给你的问题

压缩虽好，但也有代价：

1. **CPU 开销**：压缩/解压需要消耗 CPU 资源
2. **延迟增加**：虽然传输快了，但压缩本身需要时间
3. **复杂度增加**：需要维护多种压缩算法

**如果你的接口 CPU 使用率已经很高，开启压缩可能让情况更糟。你有什么办法在开启压缩的同时，控制 CPU 开销？**

提示：可以考虑使用硬件加速，或者动态选择是否压缩。
