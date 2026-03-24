# DDL 分布式执行：TiDB 的在线表变更

你遇到过这种需求吗？

> 线上表结构需要加个字段、创建个索引，但数据量太大，ALTER TABLE 要跑几个小时，期间数据库卡死。

MySQL 的 DDL 是个噩梦——表锁、长事务、阻塞操作，稍有不慎就是生产故障。

**TiDB 的 DDL 走的是完全不同的路线：分布式、在线、非阻塞。**

## TiDB DDL 架构

MySQL 的 DDL 是单线程执行的，DDL 变更期间表被锁住。

TiDB 的 DDL 采用**分布式架构**，多个 TiDB Server 可以并行执行 DDL 任务：

```
┌─────────────────────────────────────────────────────────┐
│                      DDL Owner                           │
│                   (DDL 任务调度器)                         │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │                  DDL Job Queue                       │ │
│  │  Job 1: ADD COLUMN users profile                    │ │
│  │  Job 2: CREATE INDEX idx_email ON users(email)      │ │
│  │  Job 3: MODIFY COLUMN orders amount DECIMAL(12,2)   │ │
│  └─────────────────────────────────────────────────────┘ │
│                         │                                │
│         ┌───────────────┼───────────────┐               │
│         ▼               ▼               ▼                │
│    ┌─────────┐     ┌─────────┐     ┌─────────┐          │
│    │TiDB Srv1│     │TiDB Srv2│     │TiDB Srv3│          │
│    │执行Job1 │     │执行Job2 │     │等待Job  │          │
│    └─────────┘     └─────────┘     └─────────┘          │
└─────────────────────────────────────────────────────────┘
```

DDL Owner 是集群中唯一负责执行 DDL 的节点（通过 etcd 选举）。其他 TiDB Server 监听 DDL 变更，执行对应的 Schema 变更。

## DDL 执行流程

```java
// TiDB DDL 执行流程
public class DDLExecutor {
    public void executeDDL(String sql) {
        // 1. 解析 DDL 语句
        DDLJob job = parser.parseDDL(sql);

        // 2. 添加到 Job Queue
        jobQueue.add(job);

        // 3. DDL Owner 从 Queue 取任务执行
        DDLJob runningJob = owner.takeNextJob();

        // 4. 分布式执行
        for (Table table : affectedTables) {
            // 每个 TiKV 节点独立执行 Schema 变更
            executor.executeOnStorageNodes(table, runningJob);
        }

        // 5. 更新 Schema Version
        schemaVersion.increment();
        // 其他 TiDB Server 监听到版本变更，刷新本地缓存
    }
}
```

**关键是 Schema Version**——每次 DDL 变更都会增加版本号，所有 TiDB Server 通过版本号感知 Schema 变化。

## 在线索引创建

最常用的 DDL 场景——在线创建索引。

MySQL 创建索引需要扫描全表，期间表被锁住。
TiDB 使用 **Add Index 加速器**，在写入数据的同时后台构建索引。

```java
// TiDB 在线索引创建
public class OnlineIndexBuilder {
    // 索引构建分为多个 Reorg Batch
    public void buildIndex(Table table, Index index) {
        // 1. 获取 Schema Version 作为快照点
        long snapshotVer = schemaManager.getVersion();

        // 2. 读取已有数据，构建索引
        // 增量的写入数据会实时追加到索引
        Batch&lt;Row&gt; batch = table.scan(snapshotVer);
        for (Row row : batch) {
            IndexEntry entry = buildIndexEntry(row, index);
            index.addEntry(entry);
        }

        // 3. 增量数据处理
        // 新写入的数据通过 TiKV 的 DDL Handle 实时同步
        ChangeStream changes = kvClient.watchChanges(ddlHandle);
        for (Change c : changes) {
            index.addEntry(buildIndexEntry(c.getRow(), index));
        }
    }
}
```

**「Shadow」列**——TiDB 在索引构建期间，会新增一列记录构建进度，不影响原有表结构。

### 索引构建监控

```sql
-- 查看索引构建进度
SHOW DDL JOBS;

-- 结果示例：
-- Job_ID | DB       | Table  | Type        | SchemaState | Progress
-- 123    | myapp    | orders | add index   | write only | 75%

-- 查看具体索引构建任务
ADMIN SHOW DDL INDEXES FROM orders;
```

## 常见 DDL 操作及耗时

| 操作类型 | TiDB 耗时 | MySQL 耗时 | 说明 |
|---------|----------|-----------|------|
| 添加列 | 秒级 | 分钟~小时 | 在线添加，不锁表 |
| 删除列 | 秒级 | 分钟~小时 | 仅修改 Schema |
| 修改列类型 | 秒级 | 分钟~小时 | 受数据量影响较小 |
| 添加索引 | 取决于数据量 | 小时~天 | 后台并行构建 |
| 删除索引 | 秒级 | 分钟 | 标记删除，后台清理 |
| 重命名表 | 秒级 | 取决于引擎 | 元数据变更 |

## DDL 限制与注意事项

TiDB 的 DDL 虽强，但也有局限：

### 不支持的 DDL

```sql
-- TiDB 不支持的操作：
-- 1. 全文索引（TiFlash 支持）
-- 2. 空间索引
-- 3. 存储过程内的 DDL
-- 4. 触发器内的 DDL
-- 5. 外键约束的级联操作

-- 需要用其他方式替代
```

### DDL 相关的参数调优

```bash
# 调整 DDL 批量处理大小
SET GLOBAL tidb_ddl_reorg_batch_size = 1024;  -- 默认 1024，最大 10240

# 调整 DDL 线程数
SET GLOBAL tidb_ddl_reorg_worker_cnt = 4;  -- 默认 4，可调大

# 调整 DDL 排序内存限制
SET GLOBAL tidb_ddl_error_count_limit = 1024;
```

```java
// DDL 参数的选择
public class DDLTuning {
    // 小表：batch_size 可以大一些
    // 大表：batch_size 建议 1024~2048，避免 OOM

    // 并发控制
    // 机器配置高（64核+）可以增加 worker_cnt
    // 线上环境建议 4~8，避免影响业务

    // 监控指标
    // - add index duration：索引构建总耗时
    // - DDL runtime error：运行时错误
    // - OOM：内存溢出次数
}
```

## Schema Change 的两阶段执行

TiDB 的 Schema 变更是两阶段执行：

```java
// Schema Change 两阶段
public class SchemaChangePhases {
    // 阶段 1: Write Only
    // 新 Schema 开始生效，但旧数据格式仍可读
    // DML 可以正常执行
    public void writeOnlyPhase() {
        schemaManager.updateState(SchemaState.WriteOnly);
        // 写操作：新数据用新格式
        // 读操作：可以读新格式，也可以读旧格式
    }

    // 阶段 2: Public
    // 新 Schema 完全生效
    public void publicPhase() {
        schemaManager.updateState(SchemaState.Public);
        // 所有操作都必须使用新 Schema
        // 旧格式数据已被后台任务转换
    }
}
```

这种设计保证了 DDL 期间业务的连续性——增删改查不受影响。

## 面试追问

**Q: TiDB DDL 为什么这么快？**

因为 TiDB 的 DDL 主要修改元数据（Schema Version），实际数据存储在 TiKV 中，不涉及表级锁。而且 DDL Owner 可以快速获取全局锁，协调多个节点并行执行。

**Q: DDL Owner 挂了怎么办？**

通过 etcd 选举新的 DDL Owner。新 Owner 会从 Job Queue 继续执行未完成的任务。正在进行中的 DDL 需要重新执行。

**Q: 可以在业务高峰期执行 DDL 吗？**

可以但不推荐。TiDB 的 DDL 对在线业务影响小，但大量索引构建会消耗 CPU 和 I/O。建议在业务低峰期执行复杂 DDL。

---

## 总结

TiDB 的分布式 DDL 架构，让表结构变更不再是噩梦。Schema Version 机制保证了多 TiDB Server 间的 Schema 一致性，在线索引构建让大表加索引成为可能。

理解 DDL 的执行流程和限制，有助于你在生产环境中安全地执行 Schema 变更。
