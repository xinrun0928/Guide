# 文件上传安全：别让上传入口变成后门

你的网站有一个「上传头像」功能。

用户上传图片，服务器保存到 `uploads/avatar/` 目录。

攻击者上传了一个 `shell.php`：

```php
<?php system($_GET['cmd']); ?>
```

然后访问 `https://yoursite.com/uploads/avatar/shell.php?cmd=whoami`

服务器执行了 PHP 代码，返回了命令结果。攻击者拿到了服务器权限。

这就是**文件上传漏洞**——本该存储文件的接口，变成了远程代码执行的入口。

## 文件上传的常见场景

```
┌─────────────────────────────────────────────────────────────┐
│                    常见文件上传场景                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 用户头像上传                                             │
│  2. 文档分享（PDF、Word）                                    │
│  3. 图片分享（相册、帖子）                                    │
│  4. 附件上传（邮件、任务）                                    │
│  5. 备份导入（配置、数据）                                    │
│  6. 模板上传（CMS、主题）                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 文件上传漏洞的原理

### 1. 直接访问上传文件

```
正常流程：
上传文件 → 保存到 Web 目录 → 浏览器直接访问

攻击流程：
上传 shell.php → 保存到 /uploads/ → 访问 shell.php → 代码执行
```

### 2. 文件名解析漏洞

部分服务器会按文件名后缀解析执行：

```
攻击者上传：
evil.php.jpg → 可能被当作 PHP 执行

Nginx 解析漏洞（CVE-2013-4547）：
evil.jpg⏳.php → 被 Nginx 当作 PHP 解析

Apache 解析漏洞：
evil.php.anything → 多个后缀时，从右往左解析，识别为 PHP
```

### 3. 危险的文件类型

| 类型 | 危险 | 说明 |
|------|------|------|
| .php | ⭐⭐⭐⭐⭐ | PHP 代码执行 |
| .jsp | ⭐⭐⭐⭐⭐ | JSP 代码执行 |
| .asp | ⭐⭐⭐⭐⭐ | ASP 代码执行 |
| .exe | ⭐⭐⭐⭐ | 可执行文件 |
| .sh | ⭐⭐⭐⭐ | Shell 脚本 |
| .svg | ⭐⭐⭐ | SVG 可能含 XSS |
| .html | ⭐⭐⭐ | HTML 可能含 XSS |
| .pdf | ⭐⭐⭐ | PDF 可能含 XSS/钓鱼 |

## 文件上传防御

### 1. 文件类型验证

```java
@Service
public class FileUploadService {
    
    // 允许的图片类型（MIME）
    private static final Set<String> ALLOWED_TYPES = Set.of(
        "image/jpeg",
        "image/png",
        "image/gif",
        "image/webp"
    );
    
    // 允许的后缀
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
        ".jpg", ".jpeg", ".png", ".gif", ".webp"
    );
    
    /**
     * 验证文件类型
     */
    public ValidationResult validateFile(MultipartFile file) {
        // 1. 验证文件大小
        if (file.getSize() > 5 * 1024 * 1024) {  // 5MB
            return ValidationResult.invalid("文件大小不能超过 5MB");
        }
        
        // 2. 验证 MIME 类型
        String contentType = file.getContentType();
        if (!ALLOWED_TYPES.contains(contentType)) {
            return ValidationResult.invalid("只允许上传图片文件");
        }
        
        // 3. 验证文件扩展名
        String originalFilename = file.getOriginalFilename();
        String extension = getExtension(originalFilename).toLowerCase();
        if (!ALLOWED_EXTENSIONS.contains("." + extension)) {
            return ValidationResult.invalid("文件扩展名不允许");
        }
        
        // 4. 验证文件内容（魔数检查）
        if (!isValidImageContent(file)) {
            return ValidationResult.invalid("文件内容无效");
        }
        
        return ValidationResult.valid();
    }
    
    /**
     * 验证文件内容（魔数检查）
     */
    private boolean isValidImageContent(MultipartFile file) {
        try {
            byte[] header = new byte[8];
            System.arraycopy(file.getBytes(), 0, header, 0, 8);
            
            // PNG: 89 50 4E 47
            if (header[0] == (byte)0x89 && header[1] == 'P' && 
                header[2] == 'N' && header[3] == 'G') {
                return true;
            }
            
            // JPEG: FF D8 FF
            if (header[0] == (byte)0xFF && header[1] == (byte)0xD8 && 
                header[2] == (byte)0xFF) {
                return true;
            }
            
            // GIF: 47 49 46 38
            if (header[0] == 'G' && header[1] == 'I' && 
                header[2] == 'F' && header[3] == '8') {
                return true;
            }
            
            return false;
        } catch (IOException e) {
            return false;
        }
    }
    
    private String getExtension(String filename) {
        int lastDot = filename.lastIndexOf('.');
        return lastDot > 0 ? filename.substring(lastDot + 1) : "";
    }
}
```

### 2. 安全存储

```java
@Service
public class SecureFileStorage {
    
    @Value("${upload.base-dir:/var/uploads}")
    private String baseDir;
    
    /**
     * 安全保存文件
     */
    public String saveFile(MultipartFile file, Long userId) {
        // 1. 生成随机文件名
        String originalName = file.getOriginalFilename();
        String extension = getExtension(originalName);
        String randomName = UUID.randomUUID().toString() + "." + extension;
        
        // 2. 按用户/日期分目录
        LocalDate today = LocalDate.now();
        String subDir = String.format("%d/%04d/%02d/%02d", 
            userId, today.getYear(), today.getMonthValue(), today.getDayOfMonth());
        
        Path targetDir = Paths.get(baseDir, subDir);
        Files.createDirectories(targetDir);
        
        // 3. 保存文件
        Path targetPath = targetDir.resolve(randomName);
        file.transferTo(targetPath.toFile());
        
        // 4. 返回相对路径（不要返回完整路径）
        return subDir + "/" + randomName;
    }
    
    /**
     * 访问文件（通过控制器，禁止直接访问）
     */
    @GetMapping("/files/{path}")
    public ResponseEntity<Resource> serveFile(@PathVariable String path) {
        Path filePath = Paths.get(baseDir, path);
        
        // 安全检查：防止路径遍历
        if (!filePath.normalize().startsWith(baseDir)) {
            return ResponseEntity.notFound().build();
        }
        
        if (!Files.exists(filePath)) {
            return ResponseEntity.notFound().build();
        }
        
        // 设置正确的 MIME 类型
        String contentType = getContentType(filePath);
        
        return ResponseEntity.ok()
            .contentType(MediaType.parseMediaType(contentType))
            .body(new FileSystemResource(filePath));
    }
    
    private String getContentType(Path filePath) {
        try {
            return Files.probeContentType(filePath);
        } catch (IOException e) {
            return "application/octet-stream";
        }
    }
}
```

### 3. Web 服务器配置

```nginx
# Nginx 配置：禁止执行上传目录的脚本

# 上传目录不解析 PHP
location /uploads/ {
    # 禁止执行任何脚本
    location ~ \.php$ {
        deny all;
    }
    
    # 只允许静态文件
    default_type text/plain;
    add_header X-Content-Type-Options "nosniff";
}

# 或者完全禁止访问 .php 文件
location ~* \.(php|phtml|phps|php7)$ {
    deny all;
}
```

```apache
# Apache .htaccess
<FilesMatch "\.php$">
    Order Deny,Allow
    Deny from all
</FilesMatch>

# 禁止执行上传目录
<Directory "/var/www/uploads">
    Order Deny,All
    Deny from all
</Directory>
```

### 4. 图片安全处理

```java
@Service
public class ImageProcessingService {
    
    /**
     * 安全处理图片：去除元数据、重新编码
     */
    public void processAndSave(MultipartFile file, Path targetPath) 
            throws IOException {
        try {
            BufferedImage image = ImageIO.read(file.getInputStream());
            if (image == null) {
                throw new SecurityException("无法解析图片文件");
            }
            
            // 重新编码图片，去除 EXIF 等元数据
            BufferedImage newImage = new BufferedImage(
                image.getWidth(), image.getHeight(),
                BufferedImage.TYPE_INT_RGB
            );
            
            Graphics2D g = newImage.createGraphics();
            g.drawImage(image, 0, 0, null);
            g.dispose();
            
            // 保存为 PNG 或 JPEG（去除脚本）
            String format = getFormat(targetPath.toString());
            ImageIO.write(newImage, format, targetPath.toFile());
            
        } finally {
            // 确保关闭输入流
            file.getInputStream().close();
        }
    }
    
    /**
     * 验证图片内容不含恶意代码
     */
    public void validateImageContent(byte[] content) {
        String contentStr = new String(content, StandardCharsets.ISO_8859_1);
        
        // 检查是否包含 PHP 标签
        if (contentStr.contains("<?php") || contentStr.contains("<?")) {
            throw new SecurityException("图片包含非法内容");
        }
        
        // 检查是否包含 JavaScript（SVG）
        if (contentStr.contains("<script") || contentStr.contains("javascript:")) {
            throw new SecurityException("图片包含脚本代码");
        }
    }
}
```

## 安全的文件上传完整示例

```java
@RestController
public class FileUploadController {
    
    @Autowired
    private FileUploadService uploadService;
    
    @Autowired
    private SecureFileStorage fileStorage;
    
    @PostMapping("/upload/avatar")
    public Result uploadAvatar(@RequestParam("file") MultipartFile file) {
        // 1. 验证文件
        ValidationResult result = uploadService.validateFile(file);
        if (!result.isValid()) {
            return Result.error(result.getMessage());
        }
        
        // 2. 保存文件
        Long userId = getCurrentUserId();
        String relativePath = fileStorage.saveFile(file, userId);
        
        // 3. 返回访问 URL（通过控制器，不是直接路径）
        String accessUrl = "/api/files/" + relativePath;
        
        return Result.success(Map.of(
            "url", accessUrl,
            "filename", relativePath
        ));
    }
}

@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁止直接访问上传目录
            .authorizeHttpRequests(auth -> auth
                // 文件通过控制器访问，不直接暴露目录
                .requestMatchers("/uploads/**").denyAll()
                .requestMatchers("/files/**").authenticated()
            );
        return http.build();
    }
}
```

## 面试追问方向

1. **文件上传漏洞的根本原因？** —— 服务器信任了用户上传的文件，把它们当作可执行资源
2. **只检查文件扩展名够吗？** —— 不够，扩展名可伪造，需同时检查 MIME 类型和内容
3. **为什么上传目录不能执行脚本？** —— 即使文件名是 .php，上传目录禁止执行 PHP，文件就无法运行
4. **图片处理能防上传漏洞吗？** —— 重新编码图片可以去除恶意代码，但这不是根本解决方案
5. **白名单和黑名单哪个更安全？** —— 白名单更安全，明确允许的文件类型

> "文件上传是业务需求，但也是高危入口。永远不要相信用户上传的文件，把它们当作潜在的恶意代码。"
