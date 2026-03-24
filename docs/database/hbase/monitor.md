# HBase 监控与运维：让集群健康运行

HBase 集群的运维是一门艺术。

今天我们来看看监控指标和常见运维操作。

---

## 核心监控指标

### 1. RegionServer 指标

```java
// 监控 RegionServer 指标
public class RegionServerMonitor {
    public void monitor(Admin admin) {
        ClusterStatus status = admin.getClusterStatus();

        for (ServerName server : status.getServers()) {
            ServerMetrics metrics = status.getServerLoad(server);

            // 请求量
            long readRequests = metrics.getReadRequestCount();
            long writeRequests = metrics.getWriteRequestCount();

            // 内存
            long memStoreSize = metrics.getMemStoreSize();
            long heapSize = metrics.getHeapSize();

            // 文件
            int storeFileCount = metrics.getStoreFiles();
            long storeFileSize = metrics.getStoreFileSize();

            // 告警
            if (memStoreSize > heapSize * 0.5) {
                alert("MemStore 内存使用超过 50%");
            }

            if (storeFileCount > 100) {
                alert("StoreFile 数量过多，可能需要 Major Compaction");
            }
        }
    }
}
```

### 2. Region 指标

```java
// 监控 Region 指标
public class RegionMonitor {
    public void monitorRegion(Admin admin) {
        for (ServerName server : admin.getClusterStatus().getServers()) {
            ServerMetrics serverMetrics =
                admin.getClusterStatus().getServerLoad(server);

            for (Map.Entry&lt;byte[], RegionMetrics&gt; entry :
                    serverMetrics.getRegionMetrics().entrySet()) {
                RegionMetrics regionMetrics = entry.getValue();

                // 请求量
                long readRequests = regionMetrics.getReadRequestCount();
                long writeRequests = regionMetrics.getWriteRequestCount();

                // 大小
                long memStoreSize = regionMetrics.getMemStoreSize();
                long storeFileSize = regionMetrics.getStoreFileSize();

                // Compaction 状态
                int compactionsCompleted =
                    regionMetrics.getCompactionsCompleted();
                int compactionsPending =
                    regionMetrics.getCompactionsPending();

                // 热点检测
                if (writeRequests > threshold) {
                    alert("Hotspot Region: " +
                        Bytes.toString(entry.getKey()));
                }
            }
        }
    }
}
```

---

## Ganglia / Prometheus / Grafana

### Prometheus 配置

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'hbase-region'
    metrics_path: '/jmx'
    static_configs:
      - targets: ['region-server-1:16030', 'region-server-2:16030']

  - job_name: 'hbase-master'
    metrics_path: '/jmx'
    static_configs:
      - targets: ['master:16010']
```

### Grafana Dashboard

```
常用 Dashboard 面板：

1. 集群概览
   - RegionServer 数量
   - Region 数量
   - 总请求量
   - 集群健康状态

2. RegionServer 详情
   - 每个 RegionServer 的请求量
   - 内存使用
   - StoreFile 数量
   - 读写延迟

3. 表级别
   - 每个表的请求量
   - 每个表的存储大小
   - Region 分布
```

---

## 常用运维操作

### 1. 平衡负载

```bash
# 开启自动均衡
hbase shell
> balance_switch true

# 手动触发均衡
> balancer
```

### 2. Major Compaction

```bash
# 对整个表执行 Major Compaction
hbase shell
> major_compact 't_user'

# 对特定 Region 执行
> major_compact 'region_name'

# 只压缩特定列族
> major_compact 't_user', 'info'
```

### 3. 清理过快照

```bash
# 删除超过 30 天的快照
hbase shell
> delete_snapshots '.*_.*', 30
```

### 4. Region 手动分裂

```bash
# 按指定 key 分裂
hbase shell
> split 'region_name', 'split_key'

# 自动寻找分裂点
> split 'table_name'
```

### 5. Region 迁移

```bash
# 迁移 Region 到指定服务器
hbase shell
> move 'region_encoded_name', 'target_server_name'
```

---

## 常见问题排查

### 1. 写入延迟高

```
可能原因：
- MemStore 达到上限，触发 Flush
- HFile 过多，Compaction 压力大
- 热点 Region

排查命令：
> status 'simple'
> stats 'regions'
> compaction 'region_name'
```

### 2. 读取延迟高

```
可能原因：
- BlockCache 命中率低
- HFile 过多
- 热点 Region
- 网络问题

排查命令：
> scan 't_user', {LIMIT => 10}
> get 't_user', 'row_key'
```

### 3. RegionServer 崩溃

```
可能原因：
- OOM
- GC 时间过长
- 网络问题
- 磁盘故障

排查步骤：
1. 查看 RegionServer 日志
2. 检查 GC 日志
3. 检查磁盘健康
4. 检查网络连通性
```

---

## 自动化运维

### 1. 健康检查脚本

```java
// 健康检查
public class HealthCheck {
    public void check() {
        List&lt;String&gt; issues = new ArrayList&lt;&gt;();

        // 检查 RegionServer 数量
        if (regionServerCount < 3) {
            issues.add("RegionServer 数量少于 3");
        }

        // 检查 Master 状态
        if (!masterActive) {
            issues.add("Master 未激活");
        }

        // 检查快照保留
        if (snapshotCount < minSnapshots) {
            issues.add("快照数量不足");
        }

        if (!issues.isEmpty()) {
            alert("HBase 健康检查失败: " + issues);
        }
    }
}
```

### 2. 自动告警

```java
// 告警触发条件
public class AlertConfig {
    // RegionServer 内存使用 > 80%
    public static final float HEAP_USAGE_THRESHOLD = 0.8f;

    // StoreFile 数量 > 50
    public static final int STORE_FILE_THRESHOLD = 50;

    // 写入延迟 > 100ms
    public static final long WRITE_LATENCY_THRESHOLD = 100;

    // 读取延迟 > 50ms
    public static final long READ_LATENCY_THRESHOLD = 50;
}
```

---

## 面试追问方向

- HBase 的监控指标有哪些是必须关注的？
- 如何设计一个 HBase 的运维告警系统？

下一节，我们来了解 HBase 的故障排查。
