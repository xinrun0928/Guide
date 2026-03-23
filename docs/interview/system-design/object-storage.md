# 对象存储系统设计


## 场景切入：一张照片的旅程

你用手机拍了张照片，点击上传。

1 秒后，照片出现在了朋友圈。

这张照片去哪了？

它没有存在你手机的内存里，也没有存在微信的数据库里。

它存在**对象存储系统**里——一个专门存储「文件」的系统。

今天，我们来聊聊对象存储的设计。


## 需求分析：对象存储和文件系统的区别？

很多人会把对象存储当成「网盘」，其实两者有很大区别：

| 维度 | 文件系统 | 对象存储 |
|---|---|---|
| 接口 | POSIX（读、写、打开、关闭） | HTTP API（PUT、GET、DELETE） |
| 存储单位 | 文件 | 对象（文件 + 元数据） |
| 规模 | 单机或少量节点 | 海量（EB 级别） |
| 访问方式 | 挂载到本地 | 通过 API 访问 |
| 特点 | 强一致性、支持目录 | 高吞吐、无目录概念 |

**对象存储的核心特点**：

- **海量**：支持万亿级对象
- **高可用**：数据多副本，自动恢复
- **低成本**：使用廉价硬盘，支持冷热分层
- **简单接口**：只有 PUT、GET、DELETE


## 容量估算

假设设计一个日活 1 亿用户的图片存储系统：

| 指标 | 数值 |
|---|---|
| 日活用户 | 1 亿 |
| 平均每天上传图片 | 5 张/人 |
| 平均图片大小 | 500KB |
| 日新增存储 | 250TB |
| 峰值 QPS | 10 万/秒 |
| 存储总量（3年） | 270PB |

这个规模，远超传统文件系统和数据库的承载能力。


## 核心设计：整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      对象存储系统                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌───────────┐    ┌───────────┐    ┌───────────┐           │
│  │  API 网关  │───▶│ 元数据服务 │───▶│  存储节点  │           │
│  │ (Nginx)  │    │ (Metadata) │    │ (Chunks)  │           │
│  └───────────┘    └───────────┘    └───────────┘           │
│        │                                  │                  │
│        │         ┌───────────┐           │                  │
│        └────────▶│  索引服务  │◀──────────┘                  │
│                  │ (Index)   │                              │
│                  └───────────┘                              │
└─────────────────────────────────────────────────────────────┘
```


## 核心设计：数据组织

### 对象命名

每个对象都有一个唯一 ID（Object Key），通常用 UUID 或业务 ID。

```
bucket_name/object_key
例如：user-photos/2024/01/avatar_12345.jpg
```

**为什么用 Key 而不是路径？**

因为对象存储没有目录概念，`/` 只是 Key 的一部分。

```java
public class ObjectKey {

    /**
     * 生成对象 Key
     * 策略：业务标识 + 时间 + 哈希 + 文件扩展名
     * 好处：方便查询、按时间归档、避免冲突
     */
    public static String generate(String bucket, String userId, String filename) {
        String timestamp = LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);
        String uuid = UUID.randomUUID().toString().replace("-", "").substring(0, 8);
        String extension = getExtension(filename);

        return String.format("%s/%s/%s/%s.%s",
            bucket, userId, timestamp, uuid, extension);
    }

    private static String getExtension(String filename) {
        int lastDot = filename.lastIndexOf('.');
        return lastDot &gt; 0 ? filename.substring(lastDot + 1) : "";
    }
}
```

### 分片存储

大文件不能直接存，因为网络传输慢、失败率高。

**解决方案：分片上传**

```java
public class MultipartUploader {

    private final OSSClient ossClient;

    /**
     * 初始化分片上传
     * 返回 uploadId，后续操作都依赖这个 ID
     */
    public String initMultipartUpload(String bucket, String objectKey) {
        InitiateMultipartUploadRequest request =
            new InitiateMultipartUploadRequest(bucket, objectKey);
        InitiateMultipartUploadResult result = ossClient.initiateMultipartUpload(request);
        return result.getUploadId();
    }

    /**
     * 上传分片
     * 策略：每个分片 5MB，并行上传
     */
    public UploadPartResult uploadPart(String bucket, String objectKey,
                                        String uploadId, int partNumber, byte[] data) {
        UploadPartRequest request = new UploadPartRequest();
        request.setBucketName(bucket);
        request.setKey(objectKey);
        request.setUploadId(uploadId);
        request.setPartNumber(partNumber);
        request.setInputStream(new ByteArrayInputStream(data));
        request.setPartSize(data.length);

        UploadPartResult result = ossClient.uploadPart(request);

        return new UploadPartResult(partNumber, result.getETag());
    }

    /**
     * 完成分片上传
     * 合并所有分片，生成最终文件
     */
    public void completeMultipartUpload(String bucket, String objectKey,
                                        String uploadId, List&lt;PartETag&gt; partETags) {
        CompleteMultipartUploadRequest request = new CompleteMultipartUploadRequest();
        request.setBucketName(bucket);
        request.setKey(objectKey);
        request.setUploadId(uploadId);
        request.setPartETags(partETags);

        ossClient.completeMultipartUpload(request);
    }
}
```


## 核心设计：元数据管理

对象存储需要存储每个对象的元数据：大小、创建时间、存储位置、ACL 等。

**挑战**：万亿级对象，元数据服务如何扛住？

### 方案一：关系型数据库

```java
public class ObjectMetadataDao {

    private final JdbcTemplate jdbcTemplate;

    /**
     * 存储对象元数据
     */
    public void insert(ObjectMetadata metadata) {
        String sql = "INSERT INTO object_metadata (bucket, object_key, size, " +
            "storage_class, created_at, checksum) VALUES (?, ?, ?, ?, ?, ?)";
        jdbcTemplate.update(sql,
            metadata.getBucket(),
            metadata.getObjectKey(),
            metadata.getSize(),
            metadata.getStorageClass(),
            metadata.getCreatedAt(),
            metadata.getChecksum()
        );
    }

    /**
     * 查询对象元数据
     */
    public ObjectMetadata find(String bucket, String objectKey) {
        String sql = "SELECT * FROM object_metadata WHERE bucket = ? AND object_key = ?";
        return jdbcTemplate.queryForObject(sql, new ObjectMetadataRowMapper(), bucket, objectKey);
    }
}
```

### 方案二：分布式元数据服务

如果对象数量太大，单机数据库扛不住，需要分布式方案。

常见选择：

| 方案 | 特点 |
|---|---|
| TiDB | MySQL 协议，水平扩展 |
| CockroachDB | PostgreSQL 协议，强一致 |
| DynamoDB | AWS 自研，亚毫秒延迟 |
| 自研 KV | 根据业务定制 |


## 核心设计：高可用与数据可靠

对象存储的核心承诺：**数据不丢、不坏**。

### 多副本策略

```java
public class ReplicationManager {

    private final StorageNode[] nodes;
    private final int replicationFactor = 3;

    /**
     * 写入数据：复制到多个节点
     * 策略：数据分片 + 副本，确保任意 2 个节点故障不丢数据
     */
    public void write(String objectKey, byte[] data) {
        // 1. 数据分片（可选，大文件场景）
        List&lt;byte[]&gt; chunks = splitIntoChunks(data);

        // 2. 复制到多个节点
        for (byte[] chunk : chunks) {
            List&lt;StorageNode&gt; targetNodes = selectNodes(replicationFactor);
            for (StorageNode node : targetNodes) {
                node.write(objectKey, chunk);
            }
        }
    }

    /**
     * 读取数据：优先读取最快的节点
     */
    public byte[] read(String objectKey) {
        List&lt;StorageNode&gt; candidateNodes = findNodes(objectKey);

        // 并行读取，返回最快的
        List&lt;Future&lt;byte[]&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (StorageNode node : candidateNodes) {
            futures.add(executor.submit(() -&gt; node.read(objectKey)));
        }

        for (Future&lt;byte[]&gt; future : futures) {
            try {
                return future.get(1, TimeUnit.SECONDS); // 1 秒超时
            } catch (Exception e) {
                // 忽略，继续等下一个
            }
        }

        throw new StorageException("无法读取数据：所有副本都失败");
    }

    /**
     * 选择存储节点
     * 策略：一致性哈希 + 虚拟节点，减少数据倾斜
     */
    private List&lt;StorageNode&gt; selectNodes(int count) {
        // 使用一致性哈希选择节点
        List&lt;StorageNode&gt; selected = new ArrayList&lt;&gt;();
        String hashKey = objectKey; // 可以加随机 salt 实现负载均衡
        for (int i = 0; i &lt; count; i++) {
            StorageNode node = consistentHash.getNode(hashKey + ":" + i);
            selected.add(node);
        }
        return selected;
    }
}
```

### 数据修复

节点故障会导致副本数不足，需要后台任务自动修复。

```java
public class DataRepairService {

    private final ReplicationManager replicationManager;
    private final HealthChecker healthChecker;

    /**
     * 后台任务：检查副本数，不足则修复
     */
    @Scheduled(fixedDelay = 60000) // 每分钟检查一次
    public void checkAndRepair() {
        List&lt;ObjectKey&gt; underReplicated = findUnderReplicatedObjects();

        for (ObjectKey objectKey : underReplicated) {
            try {
                // 从现有副本恢复数据到新节点
                byte[] data = replicationManager.read(objectKey);
                replicationManager.repair(objectKey, data);
                log.info("修复成功: {}", objectKey);
            } catch (Exception e) {
                log.error("修复失败: {}", objectKey, e);
                alert("数据修复失败: " + objectKey);
            }
        }
    }

    /**
     * 查找副本数不足的对象
     */
    private List&lt;ObjectKey&gt; findUnderReplicatedObjects() {
        // 查询元数据，找出副本数 < 3 的对象
        return metadataDao.findUnderReplicated(3);
    }
}
```


## 核心设计：访问控制

### 签名认证

对象存储的 URL 通常是公开的，但需要签名验证权限。

```java
public class SignedUrlGenerator {

    private final String secretKey;

    /**
     * 生成带签名的 URL
     * 策略：URL 中包含过期时间，签名验证合法性
     */
    public String generateSignedUrl(String bucket, String objectKey, long expireSeconds) {
        // 1. 计算过期时间
        long expireTime = System.currentTimeMillis() / 1000 + expireSeconds;

        // 2. 构造签名内容
        String stringToSign = "GET\n" + objectKey + "\n" + expireTime;

        // 3. 计算签名
        String signature = calculateSignature(stringToSign);

        // 4. 拼接 URL
        return String.format("https://%s.%s/%s?expire=%d&amp;signature=%s",
            bucket, ENDPOINT, objectKey, expireTime, signature);
    }

    /**
     * 验证签名
     */
    public boolean verifySignature(String objectKey, long expireTime, String signature) {
        // 1. 检查过期
        if (System.currentTimeMillis() / 1000 &gt; expireTime) {
            return false;
        }

        // 2. 重新计算签名，比对
        String stringToSign = "GET\n" + objectKey + "\n" + expireTime;
        String expectedSignature = calculateSignature(stringToSign);

        return expectedSignature.equals(signature);
    }

    private String calculateSignature(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA1");
            mac.init(new SecretKeySpec(secretKey.getBytes(), "HmacSHA1"));
            byte[] signature = mac.doFinal(data.getBytes());
            return Base64.getEncoder().encodeToString(signature);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
```


## 延伸问题

### Q1：对象存储如何实现成本优化？

| 策略 | 说明 |
|---|---|
| 冷热分层 | 热数据用 SSD，冷数据用 HDD/磁带 |
| 数据压缩 | 重复数据去重、压缩存储 |
| 生命周期 | 自动归档、删除过期数据 |
| 多租户 | 共享资源，按量计费 |

### Q2：如何防止数据被删？

1. **多版本**：开启版本控制，删除变成版本归档
2. **回收站**：删除的文件放到回收站，过期才真正删除
3. **权限控制**：删除操作需要多重确认
4. **审计日志**：所有删除操作都有记录

### Q3：有哪些开源对象存储方案？

| 方案 | 特点 |
|---|---|
| MinIO | S3 兼容，性能高 |
| Ceph RGW | 兼容 S3 和 Swift |
| OpenStack Swift | 纯 Swift API |
| HDFS | Hadoop 生态，与计算紧耦合 |


## 总结

对象存储的核心设计：

| 组件 | 作用 |
|---|---|
| 分片上传 | 支持大文件、并行传输 |
| 元数据服务 | 管理对象信息 |
| 多副本存储 | 保证数据可靠 |
| 数据修复 | 自动恢复损坏副本 |
| 签名认证 | 控制访问权限 |

记住：**对象存储的本质是「存得多、存得稳」。**

存得多靠分布式，存得稳靠多副本。不要为了优化牺牲可靠性——用户的数据，比什么都重要。
