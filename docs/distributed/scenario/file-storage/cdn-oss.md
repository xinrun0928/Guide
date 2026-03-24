# CDN + OSS 分发加速架构设计

你有没有想过，为什么你打开一个网站的图片，只需要几百毫秒？

但那个图片可能存在几千公里外的服务器上。

答案就是——**CDN**。

## CDN 的工作原理

CDN 的核心是**就近访问**。

```
用户在北京 ──→ 请求图片
                    │
                    ▼
         ┌─────────────────────┐
         │   北京 CDN 边缘节点   │──→ 缓存命中，直接返回
         └─────────────────────┘
                    │ 缓存未命中
                    ▼
         ┌─────────────────────┐
         │        OSS 源站      │
         └─────────────────────┘
```

用户请求图片时，DNS 会解析到离用户最近的 CDN 节点。如果 CDN 节点有缓存，直接返回；如果没有，CDN 去 OSS 源站获取，返回给用户的同时缓存起来。

### CDN 的缓存策略

- **强制刷新**：URL 参数变化（如 `?v=1.0.0`），CDN 认为是一个新文件
- **协商缓存**：Last-Modified / ETag，CDN 和源站确认文件是否变化

## CDN + OSS 架构

```
┌─────────────────────────────────────────────────────────┐
│                      用户请求                            │
└─────────────────────────┬───────────────────────────────┘
                          │ DNS 解析
                          ▼
              ┌───────────────────────┐
              │     CDN 边缘节点        │
              │   (全国/全球分布)        │
              └───────────┬───────────┘
                          │ 缓存未命中
                          ▼
              ┌───────────────────────┐
              │      OSS 存储          │
              │  (静态资源: 图片/视频)   │
              └───────────────────────┘
```

### 架构优势

1. **加速访问**：用户就近访问 CDN 节点，速度更快
2. **减轻源站压力**：CDN 承担大部分流量，OSS 压力大大降低
3. **可用性提升**：OSS 故障时，CDN 缓存可以继续提供服务

## 缓存失效策略

CDN 缓存失效是个老大难问题——**更新文件后，CDN 节点可能还在用旧缓存**。

### 方案一：URL 版本化

最简单、最有效的方案：

```java
// 错误做法：同一个 URL 替换内容
<img src="/images/logo.png" />

// 正确做法：URL 带版本号
<img src="/images/logo.png?v=1.0.0" />
```

版本号可以是：

- 文件内容的 MD5：`/images/logo.png?md5=abc123`
- 部署时间：`/images/logo.png?v=202311011200`
- 递增版本号：`/images/logo.png?v=100`

### 方案二：CDN 控制台刷新

手动刷新缓存：

- **URL 刷新**：刷新指定的 URL
- **目录刷新**：刷新目录下所有文件
- **预热**：提前将文件推送到 CDN 节点

### 方案三：Cache-Control

通过 HTTP 响应头控制缓存时间：

```java
response.setHeader("Cache-Control", "max-age=31536000");  // 缓存 1 年
```

但这个方案的问题是：缓存期内无法更新文件。

## 回源带宽 vs 访问带宽

理解 CDN 成本的关键概念：

- **访问带宽**：用户从 CDN 下载的带宽（CDN 向用户收费）
- **回源带宽**：CDN 向 OSS 回源获取内容的带宽（OSS 向 CDN 收费）

CDN 节省的主要是**访问带宽**。如果缓存命中率足够高，回源带宽可以很低。

## CDN + OSS Java 实现

### 上传文件

```java
@Service
public class FileService {

    @Autowired
    private OSS ossClient;

    @Autowired
    private StringRedisTemplate redisTemplate;

    private static final String BUCKET_NAME = "my-app";

    // 上传文件到 OSS
    public String uploadFile(MultipartFile file) throws Exception {
        // 1. 生成文件名（带时间戳和随机数，避免冲突）
        String originalFilename = file.getOriginalFilename();
        String extension = originalFilename.substring(originalFilename.lastIndexOf("."));
        String filename = UUID.randomUUID().toString() + "-" + System.currentTimeMillis() + extension;

        // 2. 上传到 OSS
        ossClient.putObject(BUCKET_NAME, filename, file.getInputStream(),
            new ObjectMetadata());

        // 3. 生成 CDN URL
        String cdnUrl = getCdnUrl(filename);

        return cdnUrl;
    }

    private String getCdnUrl(String filename) {
        String pattern = redisTemplate.opsForValue().get("cdn:url:pattern");
        return String.format(pattern, filename);
    }
}
```

### 生成带签名的 URL

有时候需要临时授权访问私有文件：

```java
// 生成带签名的 CDN URL，有效期 1 小时
public String getSignedUrl(String filename) {
    Date expiration = new Date(System.currentTimeMillis() + 3600 * 1000);
    URL url = ossClient.generatePresignedUrl(BUCKET_NAME, filename, expiration);
    return url.toString();
}
```

## 面试追问方向

- CDN 缓存命中率怎么计算？（答：HIT 次数 / 总请求次数）
- 如何提高 CDN 缓存命中率？（答：URL 版本化、合理设置缓存时间、减少不必要刷新）
- 回源带宽过高怎么排查？（答：缓存命中率低，需要检查缓存配置）
- 如何实现私有文件的安全访问？（答：签名 URL + 短期有效期）

## 小结

CDN + OSS 是静态资源分发的标准架构：

1. **OSS 作为源站**：存放所有静态资源
2. **CDN 加速分发**：用户就近访问，提高速度
3. **缓存失效**：URL 版本化是最佳实践
4. **成本控制**：提高缓存命中率，降低回源带宽

理解 CDN 的关键是：**它是用户和源站之间的缓存层，让用户更快到达，让源站压力更小**。
