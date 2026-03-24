# MinIO 分布式对象存储架构与 S3 兼容

你有没有想过，你的图片、视频、文档，这些「非结构化数据」存在哪？

存在数据库？太浪费。存在本地文件系统？分布式环境下访问不了。

你需要的是——**对象存储**。

## 对象存储 vs 文件系统

很多人把对象存储和文件系统混为一谈，其实它们是完全不同的东西。

| 维度 | 文件系统 | 对象存储 |
|-----|---------|---------|
| 组织方式 | 目录树 | 扁平的 key-value |
| 访问方式 | POSIX 接口 | REST API |
| 特点 | 支持目录层级、文件追加 | 无法追加，只能整体替换 |
| 扩展性 | 单机有上限 | 天然分布式 |
| 适用场景 | 数据库、日志、代码 | 图片、视频、备份 |

### 对象存储的特点

**桶（Bucket）+ 对象（Object）**：

```
Bucket: my-app-assets
Object: /images/avatar/user123.jpg
Object: /videos/course/001.mp4
```

对象存储把「目录」变成了对象的属性（如 `images/` 前缀），而不是真正的层级结构。

## MinIO 的架构

MinIO 是一款高性能的开源对象存储，**与 AWS S3 完全兼容**。

### 纠删码（Erasure Coding）

MinIO 的核心是纠删码机制——**数据切片 + 冗余存储**。

```java
假设：
- 数据文件：10MB
- 纠删码配置：4 数据块 + 4 校验块（共 8 块）
- 每个块大小：2.5MB

存储时：
原始文件 → 分成 4 个数据块 → 计算 4 个校验块 → 8 个块分散到 8 个节点

读取时：
读取任意 4 个块 → 就能恢复原始文件
```

这意味着：**可以容忍最多 4 个节点故障，数据不丢失、服务不中断。**

### 分布式 Hash

MinIO 使用一致性哈希将数据分布到不同节点：

- 新增节点时，只迁移少量数据
- 节点故障时，故障节点的数据被重新分布
- 数据均匀分布，没有热点

## MinIO 的适用场景

**私有云存储**：不想用 AWS S3，但又想兼容 S3 API 的业务。

**大数据存储**：Hadoop、Spark 等大数据组件可以直连 MinIO。

**备份归档**：冷数据长期存储，支持多版本。

**CDN 源站**：作为 CDN 的回源存储。

## MinIO vs FastDFS

| 对比 | MinIO | FastDFS |
|-----|-------|--------|
| 类型 | 对象存储 | 文件存储 |
| 协议 | S3 兼容 | 自定义协议 |
| 文件大小 | 单文件无限制 | 建议 4GB 以下 |
| 目录支持 | 无目录概念 | 无目录概念 |
| 适用规模 | 海量文件 | 中小规模 |
| 生态 | S3 生态丰富 | 社区较小 |
| Java SDK | AWS SDK for Java | FastDFS Java Client |

## MinIO Java SDK

```java
// 引入依赖
// <dependency>
//     <groupId>io.minio</groupId>
//     <artifactId>minio</artifactId>
//     <version>8.5.7</version>
// </dependency>

@Configuration
public class MinioConfig {
    @Bean
    public MinioClient minioClient() {
        return MinioClient.builder()
            .endpoint("http://localhost:9000")
            .credentials("minioadmin", "minioadmin")
            .build();
    }
}

@Service
public class FileService {

    @Autowired
    private MinioClient minioClient;

    @Autowired
    private ObjectMapper objectMapper;

    private static final String BUCKET_NAME = "my-app";

    public String uploadFile(MultipartFile file) throws Exception {
        // 1. 检查 bucket 是否存在
        boolean bucketExists = minioClient.bucketExists(
            BucketExistsArgs.builder().bucket(BUCKET_NAME).build());
        if (!bucketExists) {
            minioClient.makeBucket(MakeBucketArgs.builder().bucket(BUCKET_NAME).build());
        }

        // 2. 生成文件名
        String filename = UUID.randomUUID().toString() + "-" + file.getOriginalFilename();

        // 3. 上传
        minioClient.putObject(
            PutObjectArgs.builder()
                .bucket(BUCKET_NAME)
                .object(filename)
                .stream(file.getInputStream(), file.getSize(), -1)
                .contentType(file.getContentType())
                .build());

        return filename;
    }

    public String getFileUrl(String filename) {
        return minioClient.getPresignedObjectUrl(
            GetPresignedObjectUrlArgs.builder()
                .bucket(BUCKET_NAME)
                .object(filename)
                .expiry(24 * 60 * 60)  // 有效期 24 小时
                .build());
    }

    public void deleteFile(String filename) {
        minioClient.removeObject(
            RemoveObjectArgs.builder()
                .bucket(BUCKET_NAME)
                .object(filename)
                .build());
    }
}
```

## S3 兼容性

MinIO 完全兼容 S3 API，这意味着：

1. **AWS SDK 无缝切换**：可以用 AWS 官方 SDK 访问 MinIO
2. **S3 工具兼容**：s3cmd、rclone 等工具可以直接使用
3. **未来可迁移**：如果以后要迁移到 AWS S3，代码无需改动

```java
// 切换到 AWS S3 只需改 endpoint
AmazonS3 s3 = AmazonS3ClientBuilder.standard()
    .withEndpoint("http://localhost:9000")
    .withCredentials(new AWSStaticCredentialsProvider(
        new BasicAWSCredentials("minioadmin", "minioadmin")))
    .withPathStyleAccessEnabled(true)  // MinIO 需要这个
    .build();
```

## 面试追问方向

- 纠删码的原理是什么？（答：数据分片+校验块，任意 N 个块可恢复）
- MinIO 和 HDFS 的区别？（答：MinIO 是对象存储，HDFS 是分布式文件系统；MinIO 兼容 S3，HDFS 不兼容）
- 纠删码的性能如何？（答：写入时需要计算校验块，有一定 CPU 开销；读取时如果节点正常，性能很好）
- MinIO 如何保证数据安全？（答：纠删码容错 + 存储加密 + 传输加密）

## 小结

对象存储是存储非结构化数据的最佳选择：

1. **海量**：天然分布式，容量无上限
2. **高可用**：纠删码机制，节点故障不影响服务
3. **生态好**：S3 兼容，工具丰富
4. **成本低**：可以用普通服务器，不需要专业存储设备

MinIO 是私有云对象存储的首选，兼容 S3 意味着你永远不会被困在一个平台上。
