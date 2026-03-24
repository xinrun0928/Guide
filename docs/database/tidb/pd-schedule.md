# PD 调度策略：数据分布的智能大脑

你的 TiDB 集群跑了一段时间，问题开始出现：

- 明明是新扩容的节点，Region 数量却很少
- 某些 TiKV 节点 CPU 90%，其他节点却很空闲
- 每天的业务高峰期，总有那么几个 Region 的 Leader 响应慢

这一切的背后，都是 **PD 调度** 在起作用。

PD（Placement Driver）是 TiDB 集群的调度中心，它决定了数据如何分布、Leader 在哪里、热点如何处理。理解 PD 调度，是运维 TiDB 的必修课。

## PD 的核心职责

PD 不只是一个「调度器」，它承担着多个关键角色：

```java
// PD 的三大职责
public class PlacementDriver {
    // 1. 集群拓扑管理
    // 知道每个 TiKV 节点的位置（机架、机房、AZ）
    // 知道每个 Region 的副本分布
    public ClusterTopology getTopology();

    // 2. 数据调度
    // 决定 Region 在哪里、Leader 在哪里
    // 负载均衡、热点分散、故障恢复
    public void scheduleRegions();

    // 3. 时间戳分配（TSO）
    // 分布式事务需要全局唯一的时间戳
    // PD 生成的 TSO 是所有事务的基准
    public Timestamp getTSO();
}
```

## 调度的核心概念

### 调度操作（Operator）

PD 通过 **Operator** 来执行调度操作：

```java
// Operator 的几种类型
public class Operators {
    // 1. 添加副本
    AddPeerOperator:
        - 在目标节点创建一个新副本
        - 数据通过 Raft 同步
        - 用于故障恢复、容量扩展

    // 2. 移除副本
    RemovePeerOperator:
        - 优雅移除副本
        - 先停止写入该副本
        - 再删除数据

    // 3. 迁移 Leader
    TransferLeaderOperator:
        - 把 Leader 从一个节点迁移到另一个节点
        - 用于负载均衡
        - 迁移过程对写入有短暂影响

    // 4. 分裂 Region
    SplitRegionOperator:
        - 将大 Region 分裂成两个小 Region
        - 用于容量管理

    // 5. 合并 Region
    MergeRegionOperator:
        - 将两个小 Region 合并
        - 用于负载均衡
        - 必须是相邻的 Region
}
```

### 调度器（Scheduler）

PD 内置了多种调度器，每个调度器负责特定场景：

```java
// PD 内置调度器
public class Schedulers {
    // 1. Leader 负载均衡器
    // 目标：每个节点的 Leader 数量大致相等
    // 问题：写入热点
    public class LeaderBalanceScheduler implements Scheduler {
        public double getInfluence(Store store) {
            return store.getLeaderCount();  // 以 Leader 数量为指标
        }
    }

    // 2. Region 负载均衡器
    // 目标：每个节点的 Region 数量大致相等
    // 问题：容量不均
    public class RegionBalanceScheduler implements Scheduler {
        public double getInfluence(Store store) {
            return store.getRegionCount();  // 以 Region 数量为指标
        }
    }

    // 3. 热点调度器
    // 目标：分散热点 Region 的负载
    // 问题：热点
    public class HotRegionScheduler implements Scheduler {
        public void detectHotRegions() {
            // 统计每个 Region 的 QPS
            // 如果热点，触发 Leader 迁移或分裂
        }
    }

    // 4. 副本调度器
    // 目标：保证副本数量和分布
    // 问题：故障恢复
    public class ReplicaScheduler implements Scheduler {
        public void handleDownPeer(Peer peer) {
            // 检测到副本下线
            // 添加新副本到合适位置
        }
    }
}
```

## 调度参数调优

PD 的调度行为可以通过参数精细控制：

```bash
# 查看当前调度配置
pd-ctl config show

# 调度器开关
pd-ctl config set enable-updater true
pd-ctl config set enable-leader-scheduler true
pd-ctl config set enable-region-scheduler true
pd-ctl config set enable-hot-region-scheduler true

# 调度速度控制
pd-ctl config set leader-schedule-limit 4        # Leader 调度并发数
pd-ctl config set region-schedule-limit 2048      # Region 调度并发数
pd-ctl config set hot-region-schedule-limit 4     # 热点调度并发数
pd-ctl config set replica-schedule-limit 2048     # 副本调度并发数

# 调度权重
pd-ctl config set leader-weight 1.0      # Leader 调度权重
pd-ctl config set region-weight 1.0      # Region 调度权重
pd-ctl config set hot-region-weight 1.0   # 热点调度权重

# 调度容忍度
pd-ctl config set max-pending-down-peer 3          # 最大待处理下线副本数
pd-ctl config set max-store-down-time 30m          # 节点下线容忍时间
```

| 参数 | 默认值 | 说明 | 调整建议 |
|-----|-------|------|---------|
| leader-schedule-limit | 4 | Leader 迁移并发数 | 热点严重可调大 |
| region-schedule-limit | 2048 | Region 调度并发数 | 扩容后可调大 |
| hot-region-schedule-limit | 4 | 热点调度并发数 | 热点明显可调大 |
| max-store-down-time | 30m | 节点下线容忍时间 | 可根据网络情况调整 |

## Label 与拓扑调度

通过 Label 可以实现机房、机架级别的容灾：

```bash
# 为 TiKV 节点打 Label
tiup cluster edit-config tidb-cluster
# 在 tikv_servers 下添加
tikv_servers:
- host: 192.168.1.1
  port: 20160
  config:
    server.labels: zone=z1, rack=r1, host=node1
- host: 192.168.1.2
  port: 20160
  config:
    server.labels: zone=z2, rack=r1, host=node2
```

```bash
# 配置副本 Placement Rules
pd-ctl config set placement-rules-rule-match label:zone,count=3
pd-ctl config set placement-rules-range-label zone

# 这样数据副本会分布在 3 个不同的 zone
```

```java
// PD 根据 Label 调度副本
public class LabelScheduler {
    // 副本分布规则
    public List&lt;Store&gt; chooseStoresForReplica(int replicaCount, Region region) {
        // 选择 3 个不同 zone 的节点
        // 如果 zone 不足，尝试不同 rack
        // 如果 rack 也不足，选择不同 host
        List&lt;Store&gt; candidates = filterByLabelConstraints(
            region,
            "zone", 3,     // 至少 3 个不同 zone
            "rack", 2      // 至少 2 个不同 rack
        );
        return candidates;
    }
}
```

## 常见调度场景

### 场景一：新节点加入

新节点加入后，PD 会自动将 Region 迁移过来：

```bash
# 观察调度过程
pd-ctl region --write-flow ORDER BY write_bytes DESC LIMIT 10

# 查看调度 operator
pd-ctl operator show

# 期望看到的 operator：
# - AddPeer: 添加新副本到新节点
# - RemovePeer: 移除旧节点的多余副本
```

### 场景二：节点故障

节点宕机后，PD 会等待 `max-store-down-time` 时间，然后开始修复：

```bash
# 查看故障节点
pd-ctl store | grep -i "slow\|offline"

# PD 自动补副本
# 如果配置了 3 副本，故障节点上的副本会被补齐
# 新副本会创建在其他健康节点上
```

### 场景三：热点 Region

```bash
# 查看热点 Region
pd-ctl region --hot read
pd-ctl region --hot write

# 手动迁移 Leader
pd-ctl operator add transfer-leader region <region_id> to store <store_id>
```

## 调度监控

Grafana PD 面板的关键指标：

```
PD Dashboard → Scheduler
├── scheduler-is-operating  # 正在执行的调度操作
├── scheduler-instances     # 各调度器状态
└── operator-collect-duration # 调度生成耗时

PD Dashboard → Cluster
├── Region health           # Region 健康状态
├── Store status           # 各节点状态
└── Storage capacity       # 存储容量
```

## 面试追问

**Q: PD 调度的最小单位是什么？**

是 Region。PD 调度的是 Region，不是数据行。Region 是 TiKV 的数据分片单位。

**Q: 调度会影响业务吗？**

会有短暂影响。Leader 迁移时，该 Region 会有约百毫秒级的不可用。PD 会在低峰期执行调度，尽量减少影响。

**Q: 如何关闭 PD 调度？**

```bash
# 临时关闭所有调度
pd-ctl config set enable-updater false
pd-ctl config set enable-placement-rules false

# 恢复调度
pd-ctl config set enable-updater true
```

---

## 总结

PD 调度是 TiDB 自动化运维的核心。它通过持续监控集群状态，自动生成调度操作，保持数据均匀分布、服务高可用。

理解 PD 调度原理，学会调参和监控，是 TiDB 运维的必备技能。
