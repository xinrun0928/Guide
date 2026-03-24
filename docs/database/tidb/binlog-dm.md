# Binlog 与 DM：数据同步的双生子

你有两个 TiDB 集群：一个是线上生产库，一个是数据分析库。

需求很简单：把生产库的数据同步到分析库。

但数据同步不只是一个「复制」动作——你需要考虑：
- 增量同步（新增数据怎么同步？）
- 格式转换（MySQL Binlog → TiDB 能认吗？）
- 断点续传（同步中断了怎么办？）

这就是 **TiDB Binlog** 和 **DM（Data Migration）** 要解决的问题。

## Binlog：TiDB 的变更日志

TiDB Binlog 是 TiDB 产生的变更日志，用于将数据同步到下游系统。

```java
// TiDB Binlog 格式
public class TiDBBinlog {
    // Binlog 包含两种类型：
    // 1. Prewrite: 事务预提交阶段
    // 2. Commit: 事务提交阶段

    // 示例：
    // INSERT INTO orders VALUES (1, 'Alice', 100)
    // Binlog:
    // {
    //     type: INSERT,
    //     schema: myapp,
    //     table: orders,
    //     row: [1, "Alice", 100]
    // }
}
```

### 开启 Binlog

```bash
# 在 TiDB 配置中开启
tiup cluster edit-config tidb-cluster
# 添加：
# server_configs:
#   tidb:
#     binlog.enable: true
#     binlog.strategy: hash

# 重启 TiDB
tiup cluster reload tidb-cluster -R tidb
```

### Binlog 输出方式

| 方式 | 说明 | 适用场景 |
|-----|------|---------|
| Kafka | 输出到 Kafka | 大规模同步、需要缓冲 |
| File | 输出到文件 | 小规模同步、直接消费 |

```bash
# 配置 Kafka 输出
tiup cluster edit-config tidb-cluster
# 添加：
# pump:
#   addrs: ["192.168.1.1:8250"]
#   kafka-addrs: "192.168.1.10:9092"
#   kafka-topic: "tidb-binlog"
```

## DM：TiDB 数据迁移工具

DM（Data Migration）是 PingCAP 官方提供的数据同步工具，支持从 MySQL 迁移到 TiDB。

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│    MySQL     │────▶│     DM       │────▶│    TiDB     │
│  (源数据库)   │     │ (同步组件)    │     │ (目标数据库)  │
└──────────────┘     └──────────────┘     └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   checkpoint  │
                    │   (断点存储)   │
                    └──────────────┘
```

### DM 架构

```java
// DM 核心组件
public class DMArchitecture {
    // 1. MySQL Master
    // 读取 Binlog

    // 2. Relay Log（可选）
    // 下载 Binlog 到本地

    // 3. Source
    // 管理上游 MySQL 连接

    // 4. Task
    // 数据同步任务

    // 5. Worker
    // 实际执行同步的工作进程

    // 6. Pump
    // TiDB 端的 Binlog 输出组件
}
```

### DM 同步流程

```bash
# 1. 准备 MySQL 源配置
cat > source.yaml <<EOF
source-id: mysql-source
from:
  host: 192.168.1.100
  port: 3306
  user: dm_user
  password: "your_password"
EOF

# 2. 配置同步任务
cat > task.yaml <<EOF
name: myapp-sync
task-mode: all                    # 全量 + 增量
is-sharding: false                # 非分库分表场景

mysql-instances:
  - source-id: mysql-source
    block-allow-list: "myapp"     # 同步的库表

tidb-instances:
  - host: 192.168.1.200
    port: 4000
    user: root
    password: "your_password"

syncers:
  sync-mode: table                # 表模式
  checkpoint:                     # 断点配置
    type: mysql
    host: 192.168.1.200
    port: 4000
    user: root
    database: dm_checkpoint
EOF

# 3. 创建 Source
dmctl operate-source create source.yaml

# 4. 创建 Task
dmctl create-task task.yaml

# 5. 查看同步状态
dmctl query-status
```

## 全量同步 + 增量同步

DM 支持「先全量，后增量」的同步模式：

```java
// DM 同步阶段
public class DMSyncPhases {
    // 阶段 1: 全量同步（dump）
    // 使用 mydumper 导出全量数据
    // 使用 loader 导入 TiDB
    public void fullSync() {
        // mydumper: 导出
        // mydumper -h 192.168.1.100 -P 3306 -u root -B myapp -T orders,users -t 8 -o /data/dump/

        // loader: 导入
        // loader -h 192.168.1.200 -u root -d myapp -t 8 -d /data/dump/
    }

    // 阶段 2: 增量同步（sync）
    // 读取 Binlog，持续同步增量数据
    public void incrementalSync() {
        // 1. 记录全量同步完成时的 Binlog 位置
        position = getBinlogPosition();

        // 2. 从该位置开始读取 Binlog
        binlogReader.start(position);

        // 3. 解析并应用变更
        for (event : binlogReader) {
            applyToTiDB(event);
        }
    }

    // 阶段 3: 断点续传
    // 定期保存同步位置
    public void saveCheckpoint() {
        // 定期保存：
        // - Binlog 文件名
        // - Binlog 位置
        // - 已同步的表和行数
        checkpoint.save(position);
    }
}
```

### 全量同步工具

| 工具 | 用途 | 特点 |
|-----|------|------|
| Dumpling | 数据导出 | TiDB 官方，支持表并发 |
| mydumper | 数据导出 | MySQL 生态，性能好 |
| Loader | 数据导入 | TiDB 官方，断点续传 |
| Lightning | 快速导入 | TiDB 官方，极速导入 |

```bash
# 使用 Dumpling 导出
dumpling -h 192.168.1.100 -P 3306 -u root \
    -B myapp -T orders,users \
    -t 8 -F 256MB \
    -o /data/dump/

# 使用 Lightning 导入
tidb-lightning -config lightning.toml
```

## 分库分表同步

DM 的强大之处在于支持分库分表合并：

```bash
# 场景：4 个 MySQL 分库（order_0, order_1, order_2, order_3）
# 目标：合并到 TiDB 的 order 表

cat > shard-task.yaml <<EOF
name: shard-sync
task-mode: all

mysql-instances:
  - source-id: mysql-source
    schema-pattern: "order_*"       # 匹配分库
    table-pattern: "order_*"
    rules:
      - schema-pattern: "order_*"
        table-pattern: "order_*"
        target-schema: "myapp"
        target-table: "orders"

tidb-instances:
  - host: 192.168.1.200
    port: 4000
EOF
```

```java
// 分库分表合并逻辑
public class ShardMerge {
    // 分库分表场景下，DM 需要：
    // 1. 路由：将 order_0.order_1 → myapp.orders
    // 2. 合并：多个分片的数据合并到一张表
    // 3. 去重：处理分片键冲突

    public void syncShardTables() {
        // 每个分片一个 Worker
        for (String shard : shards) {
            Worker worker = new Worker(shard);
            worker.start();
        }

        // DM 自动处理：
        // - 分片间的数据同步顺序
        // - 主键/唯一键冲突
        // - DDL 变更同步
    }
}
```

## 数据校验

同步完成后，需要验证数据一致性：

```bash
# 使用 sync-diff-inspector 校验
cat > diff.yaml <<EOF
checkers:
  - table-count            # 检查表数量
  - data-consistency        # 检查数据一致性

target-connections:
  host: 192.168.1.200
  port: 4000
  user: root
  database: myapp

sources:
  - host: 192.168.1.100
    port: 3306
    user: root
    database: myapp

tables:
  - target-schema: "myapp"
    target-table: "orders"
    source-schema: "myapp"
    source-table: "orders"
EOF

# 执行校验
sync-diff-inspector --config diff.yaml
```

## 面试追问

**Q: TiDB Binlog 和 MySQL Binlog 有什么区别？**

格式不同。TiDB Binlog 是 TiDB 自己设计的格式，MySQL Binlog 有 Row/Statement/Mixed 三种格式。DM 工具负责格式转换。

**Q: 同步延迟怎么监控？**

```bash
# 查看 DM 同步延迟
dmctl query-status

# 延迟指标：
# - binlog-pos: 当前同步位置
# - last-binlog-pos: 最后同步的 Binlog 位置
# - total-events: 已同步的事件数
```

**Q: 同步中断了怎么办？**

DM 有 checkpoint 机制。重启后会自动从上次保存的位置继续同步，不需要手动处理。

---

## 总结

TiDB Binlog 和 DM 构成了完整的数据同步解决方案：
- **Binlog**：TiDB 的变更日志输出
- **DM**：从 MySQL 到 TiDB 的数据迁移

全量 + 增量的同步模式，既能保证数据完整性，又能持续同步新数据。
