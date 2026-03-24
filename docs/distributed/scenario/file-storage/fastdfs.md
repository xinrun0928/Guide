# FastDFS 分布式文件系统原理

FastDFS，国产开源的轻量级分布式文件系统。

它的设计目标很简单：**用最少的配置，实现最大规模的分布式文件存储**。

## 设计哲学

FastDFS 的核心理念是三个字——**轻、简、快**。

- **轻**：代码量少，核心代码只有几千行
- **简**：架构简单，只有两种服务器角色
- **快**：追求性能，文件名是哈希生成的，读取速度极快

## 架构组成

FastDFS 只有两种服务器角色：

```
┌─────────────┐         ┌─────────────┐
│   Tracker   │◄────────│   Storage    │
│  (调度器)    │         │  (存储节点)  │
└─────────────┘         └─────────────┘
       │                        │
       │                        │
       ▼                        ▼
  管理元数据              存储文件数据
```

### Tracker Server（调度器）

Tracker 是 FastDFS 的「大脑」：

1. **管理 Storage 节点**：心跳检测节点存活，统计存储空间
2. **负载均衡**：根据节点状态分配上传请求
3. **调度**：返回可用的 Storage 地址给客户端

Tracker 之间是对等的，可以部署多台，通过选举保证高可用。

### Storage Server（存储节点）

Storage 是真正存储文件的地方：

1. **文件存储**：存储文件的二进制数据
2. **文件同步**：多副本之间同步文件
3. **文件管理**：支持上传、下载、删除

Storage 会主动向 Tracker 汇报状态（心跳），告诉 Tracker 自己还活着，还有多少空间。

## 文件寻址流程

FastDFS 的文件 ID 结构是理解它运作方式的关键：

```
group1/M00/00/00/wKgDrVXXXXX.jpg
│      ││ │ │ │
│      ││ │ │ └── 文件名（服务端生成）
│      ││ │ └──── 路径编码（00-FF）
│      ││ └────── 两级目录
│      │└──────── Storage 配置的 store_path 序号
│      └───────── 分组名
└─────────────── 卷（分组）名
```

### 上传流程

```
客户端 ──→ Tracker 询问可用的 Storage
           │
           ▼
     Tracker 调度
           │
           ▼
     返回可用的 Storage 地址
           │
           ▼
客户端 ──→ 直接上传到 Storage
           │
           ▼
      Storage 保存文件
           │
           ▼
      返回 file_id 给客户端
```

关键点：**文件直接上传到 Storage，不经过 Tracker。** Tracker 只负责「指路」，不参与数据传输。

### 下载流程

```
客户端 ──→ Tracker 询问文件所在位置
           │
           ▼
     Tracker 查询元数据
           │
           ▼
     返回 Storage 地址和 file_id
           │
           ▼
客户端 ──→ 直接从 Storage 下载
```

下载同样是直接访问 Storage，不经过 Tracker。

## FastDFS + Nginx

FastDFS 自带的 HTTP 服务性能不好，通常配合 Nginx 使用：

```nginx
server {
    listen 80;
    server_name file.example.com;

    location /group1/M00 {
        ngx_fastdfs_module;
    }
}
```

`ngx_fastdfs_module` 是 FastDFS 官方的 Nginx 模块，它让 Nginx 能够直接访问 FastDFS 的 Storage 节点，代理文件请求。

## FastDFS 的特点

### 优点

1. **轻量级**：核心代码少，部署简单
2. **高吞吐**：文件名是哈希生成的，可以直接定位文件
3. **水平扩展**：增加 Storage 节点即可扩容
4. **支持同步**：多副本之间自动同步

### 局限性

1. **无目录概念**：文件是扁平化存储的
2. **不支持 POSIX**：不能用常规的文件系统接口访问
3. **不适合大文件**：建议单文件 4GB 以下（通过分片可以支持更大）
4. **协议私有**：只能用 FastDFS 客户端访问，不能用 S3 工具

## Java 客户端使用

```java
// 引入 FastDFS Java Client
// <dependency>
//     <groupId>com.github.tobato</groupId>
//     <artifactId>fastdfs-client</artifactId>
//     <version>1.27.3</version>
// </dependency>

@Configuration
@Import(FdfsClientConfig.class)
public class FastDFSConfig {
}

@Service
public class FastDFSService {

    @Autowired
    private FastFileStorageClient storageClient;

    public String upload(MultipartFile file) throws IOException {
        // 获取文件扩展名
        String ext = FilenameUtils.getExtension(file.getOriginalFilename());

        // 上传到 FastDFS
        StorePath storePath = storageClient.uploadFile(
            file.getInputStream(),
            file.getSize(),
            ext,
            null
        );

        // 返回完整路径
        return storePath.getFullPath();
    }

    public void delete(String filePath) {
        storageClient.deleteFile(filePath);
    }
}
```

## FastDFS vs MinIO

| 对比 | FastDFS | MinIO |
|-----|---------|-------|
| 类型 | 文件存储 | 对象存储 |
| 协议 | 自定义 | S3 兼容 |
| 大文件 | 建议 4GB 以下 | 无限制 |
| 目录 | 无 | 无 |
| 生态 | 较小 | S3 生态丰富 |
| 适合场景 | 中小规模文件 | 海量对象存储 |

## 面试追问方向

- FastDFS 的文件 ID 是怎么生成的？（答：Storage 端生成，包含组名、路径、文件名）
- Tracker 挂了怎么办？（答：Tracker 无状态，多台部署，通过选举保证可用）
- FastDFS 如何实现高可用？（答：多 Tracker 集群、多 Storage 分组）
- FastDFS 和 HDFS 的区别？（答：FastDFS 是轻量级文件存储，HDFS 是分布式文件系统；FastDFS 无目录，HDFS 有目录概念）

## 小结

FastDFS 是中小规模分布式文件存储的好选择：

1. **轻量**：代码少，配置简单
2. **高效**：哈希寻址，读取速度快
3. **分布式**：Tracker + Storage 分离架构

但它的局限性也很明显——不适合大文件、协议不通用。如果你的需求是大规模对象存储，MinIO 是更好的选择。

选型之前，先问自己：**我存的是什么？有多大？需要 S3 兼容吗？** 答案不同，选择就不同。
