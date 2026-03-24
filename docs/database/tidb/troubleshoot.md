# TiDB 故障排查：从现象到根因

凌晨 2 点，告警响了。

你的 TiDB 集群出现了问题：
- 写入延迟飙升
- 查询超时
- 部分节点连接不上

怎么办？

**故障排查的第一步，是从纷繁复杂的现象中找到线索。**

## 排查思路

TiDB 故障排查有一个通用的思路框架：

```
1. 确定现象：什么出问题了？
   ├── 写入慢？
   ├── 读取慢？
   ├── 连接失败？
   └── 服务不可用？

2. 缩小范围：问题出在哪个组件？
   ├── TiDB Server？
   ├── PD？
   └── TiKV？

3. 收集证据：查看监控和日志
   ├── Grafana 面板
   ├── 日志文件
   └── 诊断接口

4. 定位根因：找到问题源头
   ├── 配置问题？
   ├── 资源瓶颈？
   ├── 代码 bug？
   └── 网络故障？

5. 解决问题：采取行动
   ├── 调整参数
   ├── 扩容
   ├── 修复数据
   └── 回滚变更
```

## 常见故障与排查

### 故障一：写入延迟高

**现象**：INSERT/UPDATE 操作耗时明显增加

**排查步骤**：

```bash
# 1. 查看 TiDB Server 监控
# - KV Request Duration
# - Transaction Duration

# 2. 查看 TiKV 监控
# - Raft store duration
# - Apply duration
# - gRPC duration

# 3. 查看 PD 监控
# - TSO Wait Duration
# - Scheduler pending count

# 4. 查看日志
grep "slow" /tidb-deploy/log/tidb*.log
grep "error" /tikv-deploy/log/tikv*.log
```

```java
// 写入延迟高的常见原因
public class WriteLatencyHigh {
    // 1. TiKV Raft 写入慢
    //    - 磁盘 I/O 繁忙
    //    - 网络延迟
    //    - Region 分裂
    public void checkRaftLatency() {
        // 查看 Grafana TiKV → Raft Propose
        // - Propose log duration: 提议日志延迟
        // - Apply log duration: 应用日志延迟
        // - Commit log duration: 提交日志延迟
    }

    // 2. 两阶段提交慢
    //    - 跨 Region 写入
    //    - 网络抖动
    public void check2PCLatency() {
        // TiDB 日志中的 Prewrite/Commit 耗时
    }

    // 3. GC 导致
    //    - MVCC 版本过多
    //    - RocksDB compaction 繁忙
    public void checkGCLatency() {
        // Grafana TiKV → GC
        // - GC Duration
        // - GC Keys
    }
}
```

**解决方案**：

```bash
# 1. 如果是热点 Region
pd-ctl operator add transfer-leader region <id> to store <new_store>

# 2. 如果是 GC 问题，调整 GC 参数
SET GLOBAL tidb_gc_life_time = "12h";

# 3. 如果是 Raft 瓶颈，考虑扩容
```

### 故障二：查询超时

**现象**：SELECT 操作超时，客户端返回 `ERROR 2013`

**排查步骤**：

```bash
# 1. 查看 TiDB Server 日志
grep "timeout" /tidb-deploy/log/tidb*.log
grep "ERROR" /tidb-deploy/log/tidb*.log

# 2. 查看执行计划
EXPLAIN ANALYZE <slow_query>;

# 3. 查看 TiKV 扫描延迟
# Grafana → TiKV → Raft → `read index` duration
```

```sql
-- 查看当前正在执行的查询
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_PROCESSLIST
WHERE Time > 10;

-- 查看 Top SQL
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_STATEMENTS_SUMMARY
ORDER BY SUM_LATENCY DESC
LIMIT 10;

-- 终止慢查询
KILL TIDB <process_id>;
```

**解决方案**：

```sql
-- 1. 添加索引
ALTER TABLE orders ADD INDEX idx_status (status);

-- 2. 调整执行计划
SELECT /*+ USE_INDEX(t orders idx_status) */ * FROM orders WHERE status = 'completed';

-- 3. 优化 SQL
-- - 避免 SELECT *
-- - 避免大表 JOIN
-- - 使用分区表
```

### 故障三：连接数打满

**现象**：新连接无法建立，客户端报 `Too many connections`

**排查步骤**：

```bash
# 1. 查看连接数
SHOW PROCESSLIST;

# Grafana → TiDB → Connection Count

# 2. 查看最大连接数配置
SHOW VARIABLES LIKE 'max_connections';
SHOW VARIABLES LIKE 'tidb_max_connections';
```

```java
// 连接数打满的原因
public class ConnectionExhausted {
    // 1. 慢查询占用连接
    //    - 查询耗时过长
    //    - 连接池配置不合理
    public void checkSlowQueries() {
        // 查看 PROCESSLIST 中 Time 最大的查询
        // 终止慢查询：KILL TIDB <id>
    }

    // 2. 连接泄漏
    //    - 应用没有正确关闭连接
    //    - 事务未提交/回滚
    public void checkConnectionLeak() {
        // 查看 Connections vs Active Connections
        // 如果 Active 远小于 Connections，可能是连接泄漏
    }

    // 3. 连接池配置过小
    public void checkPoolConfig() {
        // 应用层连接池配置
        // HikariCP: maximum-pool-size
        // Druid: max-active
    }
}
```

**解决方案**：

```bash
# 1. 临时增加连接数
SET GLOBAL tidb_max_connections = 5000;

# 2. 如果是业务洪峰，考虑扩容 TiDB Server
tiup cluster scale-out tidb-cluster scale-out-tidb.yaml

# 3. 应用层优化
# - 检查连接池配置
# - 避免长事务
# - 增加熔断降级机制
```

### 故障四：Region 不可用

**现象**：部分数据无法访问，返回 `region is unavailable`

**排查步骤**：

```bash
# 1. 查看异常 Region
pd-ctl region --state abnormal

# 2. 查看 TiKV 节点状态
pd-ctl store

# 3. 查看 Region 健康度
pd-ctl region <region_id>
```

```java
// Region 不可用的原因
public class RegionUnavailable {
    // 1. 副本下线
    //    - TiKV 节点宕机
    //    - 网络分区
    public void checkReplicaDown() {
        // Grafana → TiKV → Raft → Store heartbeat
        // 查看是否有心跳中断
    }

    // 2. Raft 多数派故障
    //    - 3 副本集群中 2 个节点故障
    //    - 需要修复故障节点
    public void checkQuorumLoss() {
        // pd-ctl region --state miss-peer
        // 查看缺失的副本
    }

    // 3. 调度过载
    //    - Region 分裂/合并频繁
    //    - 调度器繁忙
    public void checkSchedulerOverload() {
        // Grafana → PD → Scheduler
        // 查看 pending 操作数
    }
}
```

**解决方案**：

```bash
# 1. 修复故障节点
tiup cluster restart tidb-cluster -N 192.168.1.1:20160

# 2. 如果节点无法恢复，手动补副本
pd-ctl operator add add-peer <region_id> <store_id>

# 3. 如果 Region 数据损坏，需要从备份恢复
```

### 故障五：PD Leader 丢失

**现象**：集群不可用，无法获取 TSO

**排查步骤**：

```bash
# 1. 查看 PD 节点状态
pd-ctl member

# 2. 查看 PD 日志
grep "leader" /pd-deploy/log/pd*.log
```

```java
// PD Leader 丢失的原因
public class PDLeaderLost {
    // 1. PD 节点宕机
    //    - 检查服务器状态
    //    - 重启 PD 进程
    public void checkPDHealth() {
        // pd-ctl member
        // 查看各 PD 节点状态
    }

    // 2. etcd 选主失败
    //    - 网络分区
    //    - 磁盘 I/O 繁忙
    public void checkEtcdHealth() {
        // 查看 etcd 日志
        // 检查网络连通性
    }
}
```

**解决方案**：

```bash
# 1. 重启 PD 进程
tiup cluster restart tidb-cluster -R pd

# 2. 如果无法恢复，考虑重建 PD
# 备份 etcd 数据后重建
```

## 常用诊断命令

```bash
# 集群健康检查
tiup cluster health tidb-cluster

# 查看组件状态
tiup cluster display tidb-cluster

# 查看配置
tiup cluster edit-config tidb-cluster

# 查看日志
tiup cluster logs tidb-cluster

# 集群诊断
tiup cluster diagnose tidb-cluster
```

```sql
-- TiDB 诊断 SQL
-- 查看集群信息
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_INFO;

-- 查看存储信息
SELECT * FROM INFORMATION_SCHEMA.TIKV_STORE_STATUS;

-- 查看 Region 信息
SELECT * FROM INFORMATION_SCHEMA.TIKV_REGION_PEERS;

-- 查看配置
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_CONFIG;

-- 查看变量
SELECT * FROM INFORMATION_SCHEMA.CLUSTER_VARIABLES;
```

## 面试追问

**Q: 如何避免生产故障？**

1. **变更管理**：所有变更走审批流程
2. **灰度发布**：先在测试环境验证
3. **监控告警**：提前发现问题
4. **容量规划**：提前预估资源需求
5. **定期演练**：恢复演练保证预案有效

**Q: 故障恢复后需要注意什么？**

1. 确认所有指标恢复正常
2. 检查是否有数据丢失
3. 分析故障根因
4. 制定改进措施
5. 更新运维文档

**Q: 有哪些常见的预防措施？**

1. 配置合理的告警阈值
2. 定期检查磁盘容量
3. 监控慢查询
4. 定期备份
5. 保持组件版本更新

---

## 总结

故障排查是运维的必备技能。TiDB 的分布式架构让排查稍显复杂，但只要掌握了正确的思路和方法，就能快速定位问题。

记住排查口诀：**一看监控，二查日志，三用命令，四问社区**。
