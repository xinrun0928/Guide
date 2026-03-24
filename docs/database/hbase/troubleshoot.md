# HBase 故障排查：从现象到根因

HBase 集群出问题了？

别慌，按这个套路来。

---

## 常见故障与排查

### 1. RegionServer 无法启动

```
症状：
- RegionServer 进程消失
- HBase Web UI 显示 RegionServer 离线
- 请求报 "Region is not online"

排查步骤：
1. 检查 RegionServer 日志
2. 检查 GC 日志
3. 检查磁盘空间
4. 检查网络
5. 检查 ZooKeeper 连接
```

```bash
# 查看 RegionServer 日志
tail -n 500 /var/log/hbase/hbase-hbase-regionserver-*.log

# 查看 GC 日志
tail -n 200 /var/log/hbase/gc-*.log

# 检查磁盘空间
df -h

# 检查 ZooKeeper 连接
hbase zkcli -server zk-server:2181
> ls /hbase/rs
```

### 2. 写入延迟高

```
症状：
- Put 操作延迟超过 100ms
- 写入队列堆积

排查流程：
┌─────────────────────────────────────────────────────────────┐
│                    写入延迟排查流程                            │
│                                                             │
│  1. 检查 RegionServer 负载                                  │
│     ├─ 每个 RegionServer 的请求量                            │
│     └─ MemStore 大小                                       │
│                                                             │
│  2. 检查 Compaction 状态                                    │
│     ├─ Minor Compaction 是否堆积                            │
│     └─ Major Compaction 是否频繁                            │
│                                                             │
│  3. 检查热点 Region                                        │
│     ├─ 哪些 Region 请求量最高                             │
│     └─ 是否需要预分区或手动分裂                             │
│                                                             │
│  4. 检查网络                                               │
│     └─ RegionServer 和 DataNode 之间的网络                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

```java
// 排查热点 Region
public void checkHotspotRegion(Admin admin) {
    ClusterStatus status = admin.getClusterStatus();

    Map&lt;String, Long&gt; regionRequests = new HashMap&lt;&gt;();

    for (ServerName server : status.getServers()) {
        ServerMetrics metrics = status.getServerLoad(server);

        for (Map.Entry&lt;byte[], RegionMetrics&gt; entry :
                metrics.getRegionMetrics().entrySet()) {
            long requests = entry.getValue().getWriteRequestCount();
            String regionName = Bytes.toString(entry.getKey());
            regionRequests.put(regionName, requests);
        }
    }

    // 排序找出请求量最高的 Region
    regionRequests.entrySet().stream()
        .sorted(Map.Entry.&lt;String, Long&gt;comparingByValue().reversed())
        .limit(10)
        .forEach(e -> System.out.println(e.getKey() + ": " + e.getValue()));
}
```

### 3. 读取延迟高

```
症状：
- Get/Scan 操作延迟超过 50ms
- BlockCache 命中率低

排查步骤：
1. 检查 BlockCache 命中率
2. 检查 StoreFile 数量
3. 检查 Bloom Filter 配置
4. 检查网络
```

```java
// 检查 BlockCache 命中率
public void checkBlockCacheHitRatio(Admin admin) {
    for (ServerName server : admin.getClusterStatus().getServers()) {
        ServerMetrics metrics = admin.getClusterStatus().getServerLoad(server);

        long blockCacheHit = metrics.getBlockCacheHitCount();
        long blockCacheMiss = metrics.getBlockCacheMissCount();
        double hitRatio = (double) blockCacheHit /
                         (blockCacheHit + blockCacheMiss);

        System.out.println(server + ": BlockCache 命中率 = " +
            String.format("%.2f%%", hitRatio * 100));

        if (hitRatio < 0.8) {
            alert("BlockCache 命中率过低: " + server);
        }
    }
}
```

### 4. 集群不可用

```
症状：
- 所有请求超时
- HBase Web UI 无法访问

排查步骤：
1. 检查 ZooKeeper 状态
2. 检查 Master 是否正常
3. 检查 Region 分布
4. 检查 HDFS 状态
```

```bash
# 检查 ZooKeeper
zkCli.sh -server zk-server:2181
> get /hbase/master

# 检查 HDFS
hdfs dfsadmin -report

# 查看 Region 分布
hbase shell
> count 't_user', INTERVAL => 1000
> get_splits 't_user'
```

---

## GC 问题排查

```
症状：
- RegionServer 进程被 OOM Killer 杀掉
- Full GC 频繁
- 延迟毛刺

排查步骤：
1. 查看 GC 日志
2. 分析 GC 类型
3. 调整 JVM 参数
```

```bash
# 分析 GC 日志
# 使用 GCEasy 或 GCViewer 工具分析

# 常用 JVM 参数调整
# hbase-env.sh
export HBASE_OPTS="-Xms8g -Xmx8g -XX:+UseG1GC \
    -XX:MaxGCPauseMillis=200 \
    -XX:+PrintGCDetails \
    -XX:+PrintGCDateStamps \
    -Xloggc:/var/log/hbase/gc.log"
```

---

## 网络问题排查

```bash
# 检查网络连通性
ping region-server-1

# 检查网络延迟
hbase org.apache.hadoop.hbase.util.NetworkTools \
    -t 10 region-server-1

# 检查端口
telnet region-server-1 16020
telnet region-server-1 16030
```

---

## 数据问题排查

### 数据不一致

```java
// 检查数据一致性
public void checkConsistency(Admin admin) {
    for (TableName tableName : admin.listTableNames()) {
        if (tableName.isSystemTable()) continue;

        admin.checkScanConsistency(tableName);
    }
}
```

### Region 状态异常

```bash
# 查看 Region 状态
hbase shell
> get 'hbase:meta', 'table_name,,1234567890'

# 修复 Region
> hbck -fix
```

---

## 面试追问方向

- HBase 的延迟毛刺通常是什么原因导致的？
- 如何判断 HBase 集群是否需要扩容？

下一节，我们来了解 HBase 的应用与生态。
