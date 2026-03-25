# 文件上传与下载实现

文件上传是 Web 开发中的常见需求，但很多新手第一次配置时都会遇到各种问题：

- 上传的文件为什么是空的？
- 文件大小超出了限制怎么办？
- 如何防止用户上传恶意文件？

今天，我们来彻底搞定文件上传与下载。

## 文件上传原理

文件上传基于 HTTP 的 `multipart/form-data` 协议：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      multipart/form-data 请求结构                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Content-Type: multipart/form-data; boundary=----WebKitFormBoundary    │
│                                                                         │
│  ------WebKitFormBoundary                                               │
│  Content-Disposition: form-data; name="username"                       │
│                                                                         │
│  zhangsan                                                               │
│  ------WebKitFormBoundary                                               │
│  Content-Disposition: form-data; name="file"; filename="photo.jpg"     │
│  Content-Type: image/jpeg                                               │
│                                                                         │
│  [文件二进制内容...]                                                     │
│  ------WebKitFormBoundary--                                             │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Spring MVC 文件上传配置

### 引入依赖

```xml
&lt;!-- Spring Boot 默认已包含，无需额外引入 --&gt;
&lt;!-- 如果使用原生 Spring，需要引入 --&gt;
&lt;dependency&gt;
    &lt;groupId&gt;commons-fileupload&lt;/groupId&gt;
    &lt;artifactId&gt;commons-fileupload&lt;/artifactId&gt;
    &lt;version&gt;1.5&lt;/version&gt;
&lt;/dependency&gt;
```

### 配置 MultipartResolver

Spring Boot 会自动配置，但如果需要自定义配置：

```java
@Configuration
public class MultipartConfig {
    
    @Bean
    public MultipartResolver multipartResolver() {
        CommonsMultipartResolver resolver = new CommonsMultipartResolver();
        // 最大文件大小
        resolver.setMaxUploadSize(10 * 1024 * 1024);  // 10MB
        // 最大请求大小（包含所有文件）
        resolver.setMaxUploadSizePerFile(5 * 1024 * 1024);  // 单个文件最大 5MB
        // 内存缓冲区大小，超过这个值会写到临时目录
        resolver.setMaxInMemorySize(1024 * 1024);  // 1MB
        // 编码
        resolver.setDefaultEncoding("UTF-8");
        // 临时目录
        resolver.setUploadTempDir(new FileSystemResource("/tmp/uploads"));
        return resolver;
    }
}
```

### application.yml 配置

```yaml
spring:
  servlet:
    multipart:
      enabled: true
      max-file-size: 10MB        # 单个文件最大大小
      max-request-size: 50MB     # 整个请求最大大小
      file-size-threshold: 1MB   # 超过这个值写到磁盘
      location: /tmp/uploads     # 临时文件目录
```

## 单文件上传

### 基本实现

```java
@RestController
@RequestMapping("/api/files")
public class FileController {
    
    @PostMapping("/upload")
    public Result&lt;String&gt; upload(@RequestParam("file") MultipartFile file) {
        // 1. 检查文件是否为空
        if (file.isEmpty()) {
            return Result.error(400, "请选择文件");
        }
        
        // 2. 检查文件大小
        if (file.getSize() &gt; 10 * 1024 * 1024) {
            return Result.error(400, "文件大小不能超过 10MB");
        }
        
        // 3. 检查文件类型
        String contentType = file.getContentType();
        if (contentType == null || !contentType.startsWith("image/")) {
            return Result.error(400, "只能上传图片文件");
        }
        
        // 4. 生成文件名
        String originalFilename = file.getOriginalFilename();
        String extension = originalFilename.substring(originalFilename.lastIndexOf("."));
        String newFilename = UUID.randomUUID().toString() + extension;
        
        // 5. 保存文件
        String uploadPath = "/var/uploads/" + newFilename;
        try {
            file.transferTo(new File(uploadPath));
        } catch (IOException e) {
            return Result.error(500, "文件保存失败");
        }
        
        return Result.success("/files/" + newFilename);
    }
}
```

### 前端调用示例

```html
&lt;form id="uploadForm" enctype="multipart/form-data"&gt;
    &lt;input type="file" name="file" id="fileInput"&gt;
    &lt;button type="submit"&gt;上传&lt;/button&gt;
&lt;/form&gt;

&lt;script&gt;
document.getElementById('uploadForm').addEventListener('submit', async (e) =&gt; {
    e.preventDefault();
    
    const formData = new FormData();
    const file = document.getElementById('fileInput').files[0];
    formData.append('file', file);
    
    const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData
    });
    
    const result = await response.json();
    console.log(result);
});
&lt;/script&gt;
```

## 多文件上传

### 固定数量

```java
@PostMapping("/upload/multiple")
public Result&lt;List&lt;String&gt;&gt; uploadMultiple(
    @RequestParam("files") MultipartFile[] files) {
    
    List&lt;String&gt; urls = new ArrayList&lt;&gt;();
    
    for (MultipartFile file : files) {
        if (!file.isEmpty()) {
            String url = saveFile(file);
            urls.add(url);
        }
    }
    
    return Result.success(urls);
}
```

### 不定数量

```java
@PostMapping("/upload/dynamic")
public Result&lt;List&lt;String&gt;&gt; uploadDynamic(List&lt;MultipartFile&gt; files) {
    // Spring 会自动收集所有同名的 multipart 文件
    // 或者使用 MultipartFile[] files
    List&lt;String&gt; urls = new ArrayList&lt;&gt;();
    
    for (MultipartFile file : files) {
        String url = saveFile(file);
        urls.add(url);
    }
    
    return Result.success(urls);
}
```

### Ajax 多文件上传

```javascript
async function uploadMultiple() {
    const files = document.getElementById('fileInput').files;
    const formData = new FormData();
    
    for (let i = 0; i &lt; files.length; i++) {
        formData.append('files', files[i]);
    }
    
    const response = await fetch('/api/files/upload/multiple', {
        method: 'POST',
        body: formData
    });
    
    return await response.json();
}
```

## 文件上传进阶

### 使用对象存储

```java
@Service
public class OssFileService {
    
    @Autowired
    private OssClient ossClient;
    
    public String upload(MultipartFile file) {
        try {
            // 1. 校验
            validateFile(file);
            
            // 2. 生成路径
            String extension = getExtension(file.getOriginalFilename());
            String key = "uploads/" + LocalDate.now() + "/" 
                       + UUID.randomUUID().toString() + extension;
            
            // 3. 上传到 OSS
            ossClient.putObject(key, file.getInputStream());
            
            // 4. 返回 URL
            return ossClient.getUrl(key);
        } catch (IOException e) {
            throw new RuntimeException("上传失败", e);
        }
    }
    
    private void validateFile(MultipartFile file) {
        if (file.isEmpty()) {
            throw new BusinessException(400, "文件不能为空");
        }
        
        // 文件大小校验
        if (file.getSize() &gt; 10 * 1024 * 1024) {
            throw new BusinessException(400, "文件大小不能超过 10MB");
        }
        
        // 文件类型校验
        String contentType = file.getContentType();
        List&lt;String&gt; allowedTypes = Arrays.asList(
            "image/jpeg", "image/png", "image/gif", "image/webp"
        );
        if (!allowedTypes.contains(contentType)) {
            throw new BusinessException(400, "不支持的文件类型");
        }
        
        // 扩展名校验（防止绕过 Content-Type）
        String originalFilename = file.getOriginalFilename();
        String extension = getExtension(originalFilename).toLowerCase();
        List&lt;String&gt; allowedExtensions = Arrays.asList(
            "jpg", "jpeg", "png", "gif", "webp"
        );
        if (!allowedExtensions.contains(extension)) {
            throw new BusinessException(400, "不支持的文件扩展名");
        }
    }
    
    private String getExtension(String filename) {
        if (filename == null || !filename.contains(".")) {
            return "";
        }
        return filename.substring(filename.lastIndexOf("."));
    }
}
```

### 进度监控

```java
@PostMapping("/upload/progress")
public Result&lt;String&gt; uploadWithProgress(
    @RequestParam("file") MultipartFile file,
    HttpServletRequest request) {
    
    // 使用 Session 存储上传进度
    HttpSession session = request.getSession();
    ProgressListener progressListener = new ProgressListener() {
        private long bytesRead = 0;
        private long contentLength = 0;
        
        @Override
        public void started() {
            session.setAttribute("uploadProgress", 0);
        }
        
        @Override
        public void update(long bytesRead, long contentLength, boolean done) {
            this.bytesRead = bytesRead;
            this.contentLength = contentLength;
            int percent = (int) (bytesRead * 100 / contentLength);
            session.setAttribute("uploadProgress", percent);
        }
        
        @Override
        public void finished() {
            session.setAttribute("uploadProgress", 100);
        }
    };
    
    // 使用自定义 CommonsMultipartFile
    CommonsMultipartFile cFile = (CommonsMultipartFile) file;
    cFile.getFileItem().setProgressListener(progressListener);
    
    // 保存文件...
    return Result.success(saveFile(file));
}
```

```javascript
// 前端轮询获取进度
async function getUploadProgress() {
    const response = await fetch('/api/upload/progress');
    const data = await response.json();
    document.getElementById('progress').style.width = data.progress + '%';
}
```

## 文件下载

### 基本实现

```java
@GetMapping("/download/{filename}")
public ResponseEntity&lt;Resource&gt; download(@PathVariable String filename) {
    // 1. 获取文件
    String uploadPath = "/var/uploads/" + filename;
    File file = new File(uploadPath);
    
    if (!file.exists()) {
        return ResponseEntity.notFound().build();
    }
    
    // 2. 创建 Resource
    Resource resource = new FileSystemResource(file);
    
    // 3. 构建响应
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(HttpHeaders.CONTENT_DISPOSITION, 
               "attachment; filename=\"" + filename + "\"")
        .body(resource);
}
```

### 支持中文文件名

```java
@GetMapping("/download/{filename}")
public ResponseEntity&lt;Resource&gt; download(@PathVariable String filename) 
    throws UnsupportedEncodingException {
    
    File file = new File("/var/uploads/" + filename);
    if (!file.exists()) {
        return ResponseEntity.notFound().build();
    }
    
    Resource resource = new FileSystemResource(file);
    
    // URL 编码中文文件名
    String encodedFilename = URLEncoder.encode(filename, "UTF-8");
    // Firefox 不支持星号，需要特殊处理
    String disposition = "attachment; filename=\"" + encodedFilename + "\"" 
        + "; filename*=UTF-8''" + encodedFilename;
    
    return ResponseEntity.ok()
        .contentType(MediaType.APPLICATION_OCTET_STREAM)
        .header(HttpHeaders.CONTENT_DISPOSITION, disposition)
        .body(resource);
}
```

### 流式下载（大文件）

```java
@GetMapping("/download/stream/{filename}")
public void downloadStream(@PathVariable String filename, 
                          HttpServletResponse response) {
    File file = new File("/var/uploads/" + filename);
    if (!file.exists()) {
        response.setStatus(404);
        return;
    }
    
    response.setContentType("application/octet-stream");
    response.setHeader(HttpHeaders.CONTENT_DISPOSITION, 
                      "attachment; filename=\"" + filename + "\"");
    response.setContentLengthLong(file.length());
    
    try (InputStream inputStream = new FileInputStream(file);
         OutputStream outputStream = response.getOutputStream()) {
        
        byte[] buffer = new byte[4096];
        int bytesRead;
        while ((bytesRead = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, bytesRead);
        }
        outputStream.flush();
    } catch (IOException e) {
        log.error("下载失败", e);
    }
}
```

### 从数据库下载

```java
@GetMapping("/download/db/{fileId}")
public ResponseEntity&lt;byte[]&gt; downloadFromDb(@PathVariable Long fileId) {
    FileEntity file = fileService.findById(fileId);
    
    if (file == null) {
        return ResponseEntity.notFound().build();
    }
    
    HttpHeaders headers = new HttpHeaders();
    headers.setContentType(MediaType.parseMediaType(file.getContentType()));
    headers.setContentDispositionFormData("attachment", file.getOriginalFilename());
    headers.setContentLength(file.getContent().length);
    
    return new ResponseEntity&lt;&gt;(file.getContent(), headers, HttpStatus.OK);
}
```

## 文件删除

```java
@DeleteMapping("/{filename}")
public Result&lt;Void&gt; delete(@PathVariable String filename) {
    String filePath = "/var/uploads/" + filename;
    File file = new File(filePath);
    
    if (file.exists() && file.delete()) {
        return Result.success(null);
    }
    
    return Result.error(404, "文件不存在");
}
```

## 常见问题

### 问题一：文件上传为空

检查点：
1. Form 是否有 `enctype="multipart/form-data"`
2. `@RequestParam` 的名称是否与 input 的 name 一致
3. Spring MVC 的 `MultipartResolver` 是否正确配置

### 问题二：文件大小超限

默认最大文件大小是 1MB，需要在配置中调整：

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 50MB
      max-request-size: 100MB
```

### 问题三：临时文件清理

Spring MVC 处理完上传请求后会自动清理临时文件，但如果异常发生，可能需要手动清理：

```java
@PreDestroy
public void cleanup() {
    // 清理过期的临时文件
    File tempDir = new File(System.getProperty("java.io.tmpdir"));
    File[] oldFiles = tempDir.listFiles((dir, name) -&gt; 
        name.startsWith("upload_") 
        &amp;&amp; System.currentTimeMillis() - dir.lastModified() &gt; 86400000
    );
    if (oldFiles != null) {
        for (File f : oldFiles) {
            f.delete();
        }
    }
}
```

## 面试追问

**Q1: 文件上传的原理是什么？**

文件上传使用 `multipart/form-data` 编码方式，将文件分成多个部分（part）发送。Spring MVC 通过 `MultipartResolver` 解析这个请求，将每个 part 转换为 `MultipartFile` 对象。

**Q2: 如何防止用户上传恶意文件？**

- 检查 Content-Type（可被绕过）
- 检查文件扩展名
- 检查文件魔数（文件头，如 `0xFF 0xD8 0xFF` 是 JPEG）
- 上传到独立的文件服务器，不与应用程序同域
- 对上传的文件进行病毒扫描

**Q3: 断点续传怎么实现？**

前端分片上传，后端合并：

```java
@PostMapping("/upload/chunk")
public Result&lt;String&gt; uploadChunk(
    @RequestParam("file") MultipartFile chunk,
    @RequestParam("chunkNumber") int chunkNumber,
    @RequestParam("totalChunks") int totalChunks,
    @RequestParam("fileId") String fileId) {
    
    // 保存分片
    String chunkPath = "/var/chunks/" + fileId + "/" + chunkNumber;
    chunk.transferTo(new File(chunkPath));
    
    // 检查是否所有分片都上传完成
    if (isAllChunksUploaded(fileId, totalChunks)) {
        // 合并分片
        mergeChunks(fileId, totalChunks);
    }
    
    return Result.success("分片 " + chunkNumber + " 上传完成");
}
```

---

**下节预告**：[RESTful API 设计规范](/framework/spring/restful) —— 掌握 RESTful API 的设计原则和最佳实践。
