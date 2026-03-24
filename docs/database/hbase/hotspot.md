# HBase 热点 Region：分布式系统的阿喀琉斯之踵

分布式系统最怕什么？热点。

一个节点扛不住，其他节点却在闲着。

这就是热点的本质：负载不均衡。

---

## 热点的成因

### 1. 顺序 RowKey

```
错误示例：自增 ID 作为 RowKey
RowKey: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10...

问题：
- 数据按 RowKey 排序
- 新数据总是写入最大的 RowKey
- 所有新写入都打到最后一个 Region
- RegionServer-3 负载 100%，其他空闲
```

### 2. 时间序列 RowKey

```
错误示例：时间戳作为 RowKey
RowKey: 2024-03-15 10:00:00, 2024-03-15 10:00:01...

问题：
- 监控系统产生的数据都是最近的
- 所有写入都打到最新的 Region
- 热点 Region 无法分散
```

### 3. 单一业务标识

```
错误示例：用户 ID 作为 RowKey
RowKey: user_001, user_002, user_003...

问题：
- 如果某用户是超级大 V
- 所有关于他的数据都打到同一个 Region
- 其他 Region 负载不均
```

---

## 热点的危害

```
┌─────────────────────────────────────────────────────────────┐
│                    热点的危害                                    │
│                                                             │
│  性能下降：                                                  │
│  - RegionServer CPU 100%                                     │
│  - 写入队列堆积                                               │
│  - 延迟飙升                                                  │
│                                                             │
│  系统不稳定：                                                │
│  - 热点 Region 的 RegionServer 频繁 GC                      │
│  - 可能触发 OOM                                               │
│  - 极端情况下导致整个集群不可用                                │
│                                                             │
│  资源浪费：                                                  │
│  - 其他 RegionServer 负载很低                                │
│  - 整体资源利用率不足 20%                                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 热点检测

### 1. HBase Web UI

```
访问 RegionServer 的 Web UI：
http://region-server:16030

查看 Tables → Region Distribution：
- 每个 Region 的请求量
- 每个 Region 的 MemStore 大小
- 每个 Region 的 HFile 大小
```

### 2. RegionServer Metrics

```java
// 监控 RegionServer 指标
public class HotspotDetector {
    public void detectHotspot(Admin admin) throws IOException {
        ClusterStatus status = admin.getClusterStatus();

        for (ServerName server : status.getServers()) {
            ServerMetrics metrics = status.getServerLoad(server);
            // Region 数量
            int regionCount = metrics.getRegionMetrics().size();

            // 读写请求量
            for (Map&lt;byte[], RegionMetrics&gt; region :
                    metrics.getRegionMetrics().entrySet()) {
                long readCount = region.getValue().getReadRequestCount();
                long writeCount = region.getValue().getWriteRequestCount();

                if (writeCount > threshold) {
                    System.out.println("Hotspot Region detected: " +
                        Bytes.toString(region.getKey()));
                }
            }
        }
    }
}
```

### 3. 写入监控

```java
// 监控写入延迟
public class WriteLatencyMonitor {
    private final Connection connection;

    public void monitorWriteLatency() throws IOException {
        Table table = connection.getTable(TableName.valueOf("t_user"));

        // 记录每次写入的延迟
        long start = System.currentTimeMillis();
        table.put(put);
        long latency = System.currentTimeMillis() - start;

        if (latency > 100) {  // 超过 100ms 告警
            alert("High write latency: " + latency + "ms");
        }
    }
}
```

---

## 热点解决方案

### 方案一：哈希打散

```java
// 哈希打散 RowKey
public class HashRowKeyDesign {
    public static String designRowKey(String userId, long timestamp) {
        // 哈希前缀 + 原始 ID + 时间戳
        String hash = MD5(userId).substring(0, 4);
        return hash + "_" + userId + "_" + timestamp;
    }
    // 优点：数据分散到不同 Region
    // 缺点：相邻时间的数据可能不在同一 Region
}
```

### 方案二：盐值前缀

```java
// 盐值前缀
public class SaltingRowKeyDesign {
    private static final int SALT_BUCKETS = 10;

    public static String designRowKey(String userId, long timestamp) {
        // 随机前缀
        int salt = new Random().nextInt(SALT_BUCKETS);
        return salt + "_" + userId + "_" + timestamp;
    }
    // 优点：写入分散
    // 缺点：读取需要扫描多个 Region
}
```

### 方案三：时间桶反转

```java
// 时间桶反转（适合时间序列数据）
public class ReversedTimeRowKeyDesign {
    public static String designRowKey(String metric, long timestamp) {
        // Long.MAX_VALUE - timestamp 作为前缀
        // 时间越大，RowKey 越小
        // 新数据写入 Region 的开头
        long reversedTime = Long.MAX_VALUE - timestamp;
        return metric + "_" + reversedTime;
    }
    // 优点：时间倒序，最近的数据在前
    // 缺点：查询方式需要改变
}
```

### 方案四：预分区 + 哈希

```java
// 预分区 + 哈希
public class PreSplitTableDesign {
    public static byte[][] createSplitKeys() {
        // 创建 10 个分区
        byte[][] splits = new byte[9][];
        for (int i = 1; i < 10; i++) {
            // 分区键：00_, 11_, 22_, ...
            splits[i-1] = Bytes.toBytes(String.format("%02d_", i * 11));
        }
        return splits;
    }
}
```

---

## 热点修复

### 1. 手动分裂热点 Region

```bash
# 识别热点 Region
hbase shell
> split 'table_name, row_key_to_split_at'

# 强制分裂
> split 'region_name', 'split_key'
```

### 2. 负载均衡

```java
// 手动触发负载均衡
public void triggerLoadBalance(Admin admin) throws IOException {
    // 查看当前分布
    admin.balanceSwitch(true);

    // 触发均衡
    admin.loadBalancer().balanceCluster(clusterStatus);
}
```

### 3. Region 迁移

```java
// 迁移 Region 到其他节点
public void moveRegion(Admin admin, RegionInfo region, ServerName targetServer)
        throws IOException {
    admin.move(region.getEncodedNameAsBytes(),
              targetServer.getServerName().getBytes());
}
```

---

## 实战案例

### 案例：消息系统

```
问题：用户的消息都按 userId 存储
      大 V 用户的消息量是普通用户的 1000 倍

方案：
1. RowKey: hash(userId) + "_" + userId + "_" + timestamp
2. 预分区 100 个 Region
3. 使用多个列族区分消息类型

效果：
- 数据分散到 100 个 Region
- 大 V 的消息分散到不同 Region
- 热点消失
```

---

## 面试追问方向

- 如何设计一个热点检测系统？
- 除了 RowKey 设计，还有什么方法解决热点？

下一节，我们来了解 HBase 的协处理器。
