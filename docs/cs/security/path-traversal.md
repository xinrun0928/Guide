# 路径遍历：目录深处的陷阱

你的图片查看功能这样实现：

```java
@GetMapping("/images")
public ResponseEntity<Resource> getImage(@RequestParam String name) {
    Path path = Paths.get("/var/images/" + name);
    return ResponseEntity.ok(new FileSystemResource(path));
}
```

正常输入：`logo.png` → `/var/images/logo.png`

恶意输入：`../../../etc/passwd` → `/etc/passwd`

服务器返回了系统密码文件。

这就是**路径遍历（Path Traversal）**——利用路径中的 `../` 跳出预期目录。

## 路径遍历的原理

### 攻击原理

```
正常访问：
/var/images/logo.png

路径遍历：
/var/images/../../../etc/passwd
= /var/images/../  → /var/
= /var/../  → /
= /etc/passwd
```

### URL 编码的绕过

```bash
# 基础
../ -> ../

# URL 编码
..%252f -> ../
%2e%2e%2f -> ../
%2e%2e/ -> ../

# 双 URL 编码
%252e%252e%252f -> ../

# Unicode 编码
..%c0%af -> ../
..%e0%80%af -> ../

# 混合
....// -> ../
```

### 不同操作系统的路径

```
Unix: /
Windows: \ 或 /
Mac: :

常见敏感路径：
/etc/passwd
/etc/shadow
/var/log/
C:\Windows\System32\config\SAM
C:\boot.ini
```

## 路径遍历的常见场景

```
┌─────────────────────────────────────────────────────────────┐
│                    常见路径遍历场景                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 文件下载                                                 │
│     download?file=report.pdf                                │
│                                                             │
│  2. 文件查看                                                 │
│     view?path=/images/photo.jpg                             │
│                                                             │
│  3. 静态资源                                                 │
│     /static/../../../etc/passwd                            │
│                                                             │
│  4. 日志读取                                                 │
│     /logs/../../../var/log/messages                        │
│                                                             │
│  5. 备份文件                                                 │
│     /backup/../../../etc/shadow                            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 路径遍历防御

### 1. 路径规范化检查

```java
@Service
public class SafeFileService {
    
    private static final String BASE_DIR = "/var/uploads";
    
    /**
     * 安全地获取文件
     */
    public Path getSafePath(String filename) {
        // 1. 规范化基础目录
        Path basePath = Paths.get(BASE_DIR).toAbsolutePath().normalize();
        
        // 2. 规范化用户请求的路径
        Path requestedPath = basePath.resolve(filename).normalize();
        
        // 3. 确保请求路径在基础目录内
        if (!requestedPath.startsWith(basePath)) {
            throw new SecurityException("非法路径访问");
        }
        
        // 4. 检查文件是否存在且是文件（不是目录）
        if (!Files.exists(requestedPath) || !Files.isRegularFile(requestedPath)) {
            throw new FileNotFoundException("文件不存在");
        }
        
        return requestedPath;
    }
}
```

### 2. 文件名白名单

```java
@Service
public class SafeFileService {
    
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
        ".jpg", ".jpeg", ".png", ".gif", ".webp",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx"
    );
    
    /**
     * 验证文件名
     */
    public ValidationResult validateFilename(String filename) {
        // 1. 禁止空文件名
        if (filename == null || filename.isEmpty()) {
            return ValidationResult.invalid("文件名不能为空");
        }
        
        // 2. 检查路径分隔符
        if (filename.contains("/") || filename.contains("\\")) {
            return ValidationResult.invalid("文件名不能包含路径");
        }
        
        // 3. 检查遍历序列
        if (filename.contains("..")) {
            return ValidationResult.invalid("文件名不能包含 ..");
        }
        
        // 4. 检查危险字符
        if (filename.matches(".*[<>:\"'|?*].*")) {
            return ValidationResult.invalid("文件名包含非法字符");
        }
        
        // 5. 检查扩展名白名单
        String lowerName = filename.toLowerCase();
        if (!lowerName.matches(".*\\.(jpg|jpeg|png|gif|webp|pdf|doc|docx|xls|xlsx)")) {
            return ValidationResult.invalid("文件类型不允许");
        }
        
        // 6. 检查文件名长度
        if (filename.length() > 255) {
            return ValidationResult.invalid("文件名过长");
        }
        
        return ValidationResult.valid();
    }
}
```

### 3. 使用 Content-Disposition

```java
@RestController
public class FileController {
    
    @Autowired
    private SafeFileService fileService;
    
    @GetMapping("/download")
    public ResponseEntity<Resource> download(@RequestParam String filename) {
        try {
            // 验证文件名
            ValidationResult result = fileService.validateFilename(filename);
            if (!result.isValid()) {
                return ResponseEntity.badRequest().build();
            }
            
            // 获取安全路径
            Path filePath = fileService.getSafePath(filename);
            
            // 设置下载响应头
            String displayName = filePath.getFileName().toString();
            String encodedName = URLEncoder.encode(displayName, StandardCharsets.UTF_8)
                .replace("+", "%20");
            
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + encodedName + "\"")
                .body(new FileSystemResource(filePath));
                
        } catch (SecurityException | FileNotFoundException e) {
            return ResponseEntity.notFound().build();
        }
    }
}
```

### 4. Spring Security 配置

```java
@Configuration
@EnableWebSecurity
public class SecurityConfig {
    
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁止路径遍历的请求
            .requestMatchers("/static/**").permitAll()
            .requestMatchers("/files/**").authenticated();
        
        return http.build();
    }
}
```

## Zip Slip 漏洞

路径遍历不仅限于 URL 参数，还可能在解压文件时发生：

```java
// ❌ 危险：Zip Slip 漏洞
public void extractZip(Path zipFile, Path targetDir) throws IOException {
    try (ZipFile zip = new ZipFile(zipFile.toFile())) {
        Enumeration<ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            Path entryPath = targetDir.resolve(entry.getName());
            
            // ⚠️ 没有检查 entryPath 是否在 targetDir 内
            // 如果 entry.getName() 是 "../../../etc/passwd"
            // 就会被解压到 /etc/passwd
            
            Files.createDirectories(entryPath.getParent());
            Files.copy(zip.getInputStream(entry), entryPath);
        }
    }
}

// ✅ 安全：验证解压路径
public void safeExtractZip(Path zipFile, Path targetDir) throws IOException {
    Path normalizedTarget = targetDir.toAbsolutePath().normalize();
    
    try (ZipFile zip = new ZipFile(zipFile.toFile())) {
        Enumeration<ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            
            // 规范化条目路径
            Path entryPath = normalizedTarget.resolve(entry.getName()).normalize();
            
            // 确保解压路径在目标目录内
            if (!entryPath.startsWith(normalizedTarget)) {
                throw new SecurityException(
                    "Zip Slip attack detected: " + entry.getName());
            }
            
            if (entry.isDirectory()) {
                Files.createDirectories(entryPath);
            } else {
                Files.createDirectories(entryPath.getParent());
                Files.copy(zip.getInputStream(entry), entryPath);
            }
        }
    }
}
```

## 检测路径遍历

```bash
# 手动测试

# 1. 基础遍历
?file=../../etc/passwd
?path=../../../boot.ini

# 2. URL 编码
?file=..%252f..%252fetc%252fpasswd
?file=%2e%2e%2f%2e%2e%2fetc%2fpasswd

# 3. 双编码
?file=%252e%252e%252f%252e%252e%252fetc%252fpasswd

# 4. Null 字节注入
?file=../../etc/passwd%00.jpg

# 5. 混合斜杠
?file=....//....//etc/passwd
?file=..\/..\/..\/etc/passwd
```

## 面试追问方向

1. **路径遍历和文件上传的区别？** —— 路径遍历访问已存在的文件，文件上传上传恶意文件
2. **为什么还要检查文件名？** —— 规范化可能被绕过，双重检查更安全
3. **Null 字节注入是什么？** —— `%00` 可能截断文件类型检查，但现代 Java 已修复
4. **Zip Slip 漏洞是什么？** —— Zip 文件中包含 `../` 路径，解压时会跳出目标目录
5. **如何彻底防止路径遍历？** —— 白名单文件名 + 路径规范化检查 + 边界验证

> "路径遍历是看似简单却危险的漏洞。每一次文件操作，都应该验证路径不会跳出预期范围。"
