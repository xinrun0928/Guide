# TiDB 集群扩缩容：弹性伸缩的艺术

凌晨 3 点，业务高峰即将来临。

你的 TiDB 集群 CPU 已经 70%，按这个趋势，很快就要撑不住。怎么办？

加机器。但问题是：传统数据库加机器是个大工程——数据迁移、分片重分配、服务中断......

**TiDB 的答案是：在线扩缩容，一行命令，数据自动迁移，业务零中断。**

## TiDB 的弹性伸缩原理

TiDB 的扩缩容之所以能如此丝滑，源于它的核心设计：

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   存储层（TiKV）           计算层（TiDB Server）         │
│                                                         │
│  ┌─────────────┐        ┌─────────────┐                │
│  │   TiKV 1   │        │  TiDB Srv 1 │                │
│  │  96MB Region │        │  SQL 处理   │                │
│  └─────────────┘        └─────────────┘                │
│           ↕                      ↕                       │
│  ┌─────────────┐        ┌─────────────┐                │
│  │   TiKV 2   │        │  TiDB Srv 2 │                │
│  │  96MB Region │        │  SQL 处理   │                │
│  └─────────────┘        └─────────────┘                │
│           ↕                      ↕                       │
│  ┌─────────────┐        ┌─────────────┐                │
│  │   TiKV 3   │        │  TiDB Srv 3 │                │
│  │  96MB Region │        │  SQL 处理   │                │
│  └─────────────┘        └─────────────┘                │
│                                                         │
│              ↑ 扩缩容时：                                │
│              │ - TiKV：Region 自动迁移                  │
│              │ - TiDB Server：注册/注销到 PD             │
│              │ - 无需数据重分布、无需服务重启              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**关键点：TiKV 的扩缩容移动的是 Region（数据分片），而不是整表数据。**

## TiKV 扩容

### 操作步骤

```bash
# 1. 准备新机器，安装 TiKV
tiup cluster scale-out tidb-cluster scale-out-tikv.yaml

# scale-out-tikv.yaml 内容：
# tikv_servers:
# - host: 192.168.1.100
#   port: 20160
#   status_port: 20180
#   deploy_dir: /data/tikv
#   data_dir: /data/tikv/data

# 2. 查看节点状态
tiup cluster display tidb-cluster

# 3. 等待数据均衡
# PD 会自动将 Region 迁移到新节点
watch -n 5 'pd-ctl store | grep "region_num"'
```

### 扩容原理

```java
// TiKV 扩容的数据迁移过程
public class TiKVScaleOut {
    public void onNewNodeJoin(Store newStore) {
        // 1. 新 TiKV 向 PD 注册
        pd.registerStore(newStore);

        // 2. PD 发现新节点容量富余
        // 3. PD 生成 AddPeer Operator
        //    - 在新节点创建一个 Region 副本
        //    - 数据通过 Raft 同步
        // 4. 旧节点对应的 Region 数量减少
        // 5. 最终达到均衡

        // 均衡指标：每个节点的 Region 数量大致相等
    }
}
```

### 扩容时间估算

| 集群规模 | Region 数量 | 预计均衡时间 |
|---------|------------|-------------|
| 3 → 5 节点 | 10000 | 5-10 分钟 |
| 5 → 10 节点 | 50000 | 20-40 分钟 |
| 10 → 20 节点 | 100000 | 1-2 小时 |

时间取决于：
- 数据量大小
- 网络带宽
- 磁盘 I/O 性能
- 调度参数（`region-schedule-limit`）

## TiKV 缩容

### 操作步骤

```bash
# 1. 缩容前，先标记节点为 offline
pd-ctl store delete <store_id>

# 2. 查看该节点 Region 迁移进度
pd-ctl store <store_id>

# 3. 等待所有 Region 迁移完成
# 迁移完成标志：Region 数量为 0

# 4. 执行缩容
tiup cluster scale-in tidb-cluster -N 192.168.1.100:20160
```

### 缩容原理

```java
// TiKV 缩容的数据迁移过程
public class TiKVScaleIn {
    public void removeNode(Store store) {
        // 1. 标记节点为 "Offline"
        // 该节点不再接收新的写入请求

        // 2. PD 生成 RemovePeer Operator
        //    - 在其他节点创建新副本
        //    - 数据同步完成后，删除该节点副本

        // 3. 等待该节点所有 Region 迁移完成
        while (store.getRegionCount() > 0) {
            sleep(5);
        }

        // 4. 确认节点可以安全下线
        // 5. 物理删除该 TiKV 进程
    }
}
```

### 缩容注意事项

```bash
# 不要同时缩容太多节点
# 建议：每次最多下线 1 个节点（3 副本集群）

# 检查是否有单副本 Region
pd-ctl region --state abnormal

# 如果有单副本 Region，先修复
pd-ctl operator add add-peer <region_id> <store_id>
```

## TiDB Server 扩缩容

TiDB Server 是无状态的，扩缩容更加简单：

```bash
# 扩容 TiDB Server
tiup cluster scale-out tidb-cluster scale-out-tidb.yaml

# scale-out-tidb.yaml 内容：
# tidb_servers:
# - host: 192.168.1.100
#   port: 4000
#   status_port: 10080

# 缩容 TiDB Server
tiup cluster scale-in tidb-cluster -N 192.168.1.100:4000
```

```java
// TiDB Server 的扩缩容原理
public class TiDBServerScale {
    // 扩容
    public void onNewServerJoin(TiDBServer server) {
        // 1. 启动新 TiDB Server
        // 2. 新 Server 向 PD 注册
        pd.registerServer(server);

        // 3. 客户端通过负载均衡自动发现新节点
        // 4. 业务流量自动分散到新节点
        // 无需任何配置修改！
    }

    // 缩容
    public void removeServer(TiDBServer server) {
        // 1. 从负载均衡器移除该节点
        // 2. 等待现有连接处理完毕
        // 3. 优雅关闭该 TiDB Server
        // 4. 从 PD 注销
        pd.unregisterServer(server);
    }
}
```

## PD 扩缩容

PD 负责集群元信息，需要特殊处理：

```bash
# PD 扩容（必须使用 replicate 配置）
tiup cluster scale-out tidb-cluster scale-out-pd.yaml

# PD 缩容
# PD 必须至少保留 1 个节点（集群至少 1 个 PD）
# 如果有 3 个 PD，最多只能缩容到 1 个
tiup cluster scale-in tidb-cluster -N 192.168.1.100:2379
```

```java
// PD 扩容的特殊性
public class PDScale {
    public void addPDNode(PD newPd) {
        // 1. 新 PD 加入 etcd 集群
        // 2. 数据同步
        // 3. 成为 Leader 候选
        // 4. 集群自动选举新 Leader

        // 注意：PD 通过 etcd 实现高可用
        // etcd 集群要求奇数节点（1/3/5/7...）
    }
}
```

## TiFlash 扩缩容

TiFlash 是列式存储，扩缩容有特殊考虑：

```bash
# 扩容 TiFlash
tiup cluster scale-out tidb-cluster scale-out-tiflash.yaml

# TiFlash 扩容后需要等待数据同步
# 可以通过 Grafana 查看 TiFlash 同步进度

# 缩容 TiFlash
# 先确保有足够的 TiKV 副本支撑
pd-ctl store | grep -i tiflash
# 确认后缩容
tiup cluster scale-in tidb-cluster -N 192.168.1.100:9000
```

## 扩缩容最佳实践

### 扩容最佳实践

```bash
# 1. 扩容前检查集群健康
tiup cluster health tidb-cluster

# 2. 分批次扩容，不要一次加太多
# 建议：每次增加 1-2 个节点

# 3. 监控扩容过程
# - Grafana TiKV: Store size、Region count
# - Grafana PD: Operator、Scheduler
# - Grafana TiDB: Query duration
```

### 缩容最佳实践

```bash
# 1. 缩容前检查数据分布
pd-ctl store <store_id>

# 2. 等待数据完全迁移
# Region count 降到 0 才算完成

# 3. 检查是否有问题 Region
pd-ctl region --state abnormal

# 4. 保留足够副本
# 3 副本集群至少保留 3 个 TiKV
# 5 副本集群至少保留 3 个 TiKV

# 5. 分批次缩容
# 建议：每次缩容 1 个节点，等待均衡后再缩容下一个
```

## 面试追问

**Q: 扩容时数据会自动均衡吗？**

是的。PD 的调度器会自动将 Region 迁移到新节点，实现负载均衡。但均衡需要时间，不是瞬间完成。

**Q: 缩容时服务会中断吗？**

不会。PD 会先等待 Region 完全迁移，再关闭节点。整个过程对业务透明。

**Q: 可以缩容到单节点吗？**

不建议。TiDB 是分布式数据库，单节点无法保证高可用和生产使用。最低配置建议：
- TiKV：至少 3 节点（3 副本）
- TiDB Server：至少 2 节点（高可用）
- PD：至少 3 节点（etcd 高可用）

---

## 总结

TiDB 的扩缩容机制让它成为真正的云原生数据库。存储层通过 Region 迁移实现弹性伸缩，计算层通过无状态设计实现快速扩缩。

记住扩容原则：**分批扩容，监控均衡**。
记住缩容原则：**先迁数据，后下节点**。
