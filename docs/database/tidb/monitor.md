# TiDB 监控体系：洞察集群的每一个角落

你的 TiDB 集群正在运行。

但你怎么知道它「健康」？CPU 低就是健康吗？QPS 高就是正常吗？

**监控，是运维的眼睛。**

TiDB 内置了完整的监控体系，基于 Prometheus + Grafana，让你可以实时洞察集群的每一个角落。

## 监控架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        监控架构                                  │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ TiDB     │  │ TiKV     │  │ PD       │  │ TiFlash  │        │
│  │ Server   │  │          │  │          │  │          │        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │               │
│       │ metrics     │ metrics     │ metrics     │ metrics        │
│       ▼             ▼             ▼             ▼               │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Prometheus                                │ │
│  │                   (指标收集存储)                              │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Grafana                                   │ │
│  │                   (可视化展示)                                │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

```java
// TiDB 监控指标暴露
public class MetricsExporter {
    // TiDB 组件通过 HTTP 接口暴露指标
    // TiDB Server:  http://tidb-server:10080/metrics
    // TiKV:         http://tikv-server:20180/metrics
    // PD:           http://pd-server:2379/metrics

    // 常用指标类型
    // - Counter: 累计值（请求数、错误数）
    // - Gauge: 当前值（连接数、CPU使用率）
    // - Histogram: 分布（延迟）
    // - Summary: 分位数（延迟）
}
```

## 核心监控面板

### TiDB Server 面板

```
TiDB Dashboard → Queries Overview
├── QPS: 每秒查询数
├── Duration: 查询延迟（p999/p99/p95/avg）
├── Failed Queries: 失败查询
├── Connection Count: 连接数
└── Transaction Duration: 事务延迟

TiDB Dashboard → Instance Performance
├── CPU: 各 TiDB Server CPU 使用率
├── Memory: 内存使用
├── KV Request Duration: KV 请求延迟
└── TiDB Cache Hit Rate: 缓存命中率
```

```java
// TiDB Server 关键指标
public class TiDBMetrics {
    // 查询性能
    Histogram queryDuration;          // 查询耗时分布
    Counter queryTotal;              // 查询总数
    Counter queryError;              // 查询错误数

    // 连接管理
    Gauge connectionCount;            // 当前连接数
    Gauge connectionIdleCount;       // 空闲连接数

    // KV 操作
    Histogram kvRequestDuration;     // KV 请求延迟
    Counter kvRequestError;          // KV 请求错误

    // DDL 操作
    Gauge ddlJobCount;               // DDL 任务数
    Gauge addIndexProgress;          // 索引构建进度
}
```

### TiKV 面板

```
TiKV Dashboard → Cluster
├── Store Size: 各节点存储容量
├── Available Size: 可用容量
├── Region Count: Region 数量分布
└── Leader Count: Leader 数量分布

TiKV Dashboard → Errors
├── Server Message Errors: 服务消息错误
├── Storage Errors: 存储错误
├── Scheduler Errors: 调度器错误
└── Raft Message Errors: Raft 消息错误

TiKV Dashboard → Thread CPU
├── RocksDB CPU: RocksDB 线程 CPU
├── raftstore CPU: Raft 存储线程 CPU
├── apply CPU: 数据应用线程 CPU
└── grpc CPU: gRPC 线程 CPU
```

```java
// TiKV 关键指标
public class TiKVMetrics {
    // 存储容量
    Gauge storeSize;                 // 存储总量
    Gauge availableSize;             // 可用容量

    // Region 分布
    Gauge regionCount;               // Region 数量
    Gauge leaderCount;               // Leader 数量

    // I/O 性能
    Histogram raftstoreDuration;      // Raft 存储延迟
    Histogram applyDuration;          // 日志应用延迟
    Histogram gcDuration;            // GC 延迟

    // RocksDB 指标
    Gauge rocksdbNumKeys;            // Key 数量
    Gauge rocksdbSize;               // 数据大小
    Gauge compactionPending;        // 待压缩任务
}
```

### PD 面板

```
PD Dashboard → Cluster
├── Store Count: TiKV 节点数
├── Region Count: Region 总数
├── Leader Balance: Leader 分布均衡度
└── Region Balance: Region 分布均衡度

PD Dashboard → Scheduler
├── Scheduler Pending: 待执行调度
├── Scheduler In-progress: 执行中调度
└── Operator Duration: 调度操作耗时

PD Dashboard → TSO
├── TSO Wait Duration: 获取 TSO 等待时间
└── TSO RPC Duration: TSO RPC 耗时
```

```java
// PD 关键指标
public class PDMetrics {
    // 集群状态
    Gauge storeCount;                // TiKV 节点数
    Gauge regionCount;               // Region 总数

    // 调度状态
    Gauge schedulerPending;          // 待执行调度数
    Gauge operatorPending;          // 进行中调度数
    Histogram operatorDuration;       // 调度耗时

    // TSO 性能
    Histogram tsoWaitDuration;        // TSO 等待延迟
    Histogram tsoRpcDuration;         // TSO RPC 延迟
}
```

## TiDB Dashboard

TiDB Dashboard 是官方提供的 Web 界面，集成了大量运维功能：

```bash
# 访问 TiDB Dashboard
http://192.168.1.1:2379/dashboard

# 或通过 tiup 访问
tiup cluster dashboard tidb-cluster
```

### Key Visualizer

用于分析热点 Region：

```java
// Key Visualizer 展示：
// - Region 分布热力图
// - 读写流量分布
// - Key 范围与 Region 映射

// 热力图颜色含义：
// - 绿色：正常
// - 黄色：较热
// - 红色：热点
// - 蓝色：冷数据
```

### SQL 语句分析

```sql
-- 查看当前正在执行的 SQL
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_PROCESSLIST;

-- 查看 Top SQL
SELECT
    QUERY,
    SUM(LATENCY) as total_latency,
    COUNT(*) as exec_count,
    AVG(LATENCY) as avg_latency
FROM INFORMATION_SCHEMA.CLUSTER_STATEMENTS_SUMMARY
GROUP BY QUERY
ORDER BY total_latency DESC
LIMIT 10;
```

### 集群诊断

```sql
-- 一键诊断
SELECT * FROM DIAGNOSE RESULT();

-- 健康检查
SELECT * FROM information_schema.tidb_cluster_load;

-- Region 诊断
SELECT * FROM information_schema.tikv_region_peers
WHERE peer_state != 'normal';
```

## 告警规则

TiDB 有一套完整的告警规则：

| 告警级别 | 说明 | 处理方式 |
|---------|------|---------|
| Critical | 严重故障 | 立即处理 |
| Warning | 需要关注 | 尽快处理 |
| Info | 信息提示 | 观察 |

### 常见告警

```bash
# TiKV 告警
TiKV_memory_in_use_too_high      # 内存使用过高
TiKV_raft_log_gc_too_slow       # Raft 日志 GC 过慢
TiKV_scheduler_too_busy          # 调度器繁忙
TiKV_region_unavailable          # Region 不可用

# PD 告警
PD_cluster_all_metrics_stable   # 集群不稳定
PD_etcd_network_latency          # etcd 网络延迟高
PD_leader_checkpoint_lag         # Leader 检查点滞后

# TiDB Server 告警
TiDB_query_duration_high         # 查询延迟过高
TiDB_connection_count_high       # 连接数过高
TiDB_server_panic                # TiDB Server 崩溃
```

### 告警配置

```yaml
# alertmanager 配置（通过 Prometheus AlertManager）
groups:
  - name: tidb
    rules:
      - alert: TiKV_memory_in_use_too_high
        expr: tikv_memory_in_use / tikv_memory_capacity > 0.9
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: TiKV 内存使用过高
          description: "TiKV {{ $labels.instance }} 内存使用超过 90%"
```

## 面试追问

**Q: 如何快速定位慢查询？**

1. TiDB Dashboard → Top SQL：查看耗时最长的 SQL
2. `EXPLAIN ANALYZE`：分析具体执行计划
3. `INFORMATION_SCHEMA.CLUSTER_PROCESSLIST`：查看正在执行的查询

**Q: Region 不均衡怎么处理？**

1. Grafana PD 面板：查看 Region 分布
2. `pd-ctl store`：查看各节点 Region 数量
3. 调整调度参数或手动触发调度

**Q: 监控数据可以长期保存吗？**

可以。Prometheus 支持远程存储，如 Thanos、VictoriaMetrics，可以将监控数据保存到对象存储。

---

## 总结

TiDB 的监控体系非常完善：

- **TiDB Dashboard**：Web 界面，集成诊断工具
- **Grafana 面板**：各组件详细监控
- **Prometheus**：指标收集存储
- **AlertManager**：告警通知

学会使用监控，才能真正掌控 TiDB 集群。
