# 备份与恢复：数据安全的最后防线

数据库最怕什么？

不是慢查询，不是性能问题，而是——**数据丢了**。

硬件故障、人为误操作、勒索病毒......任何一种情况，都可能让你的业务陷入绝境。

**备份，是数据库安全的最后一道防线。**

TiDB 提供了 BR（Backup & Restore）工具，让备份恢复变得简单高效。

## 备份策略概述

TiDB 支持两种备份方式：

| 方式 | 原理 | 适用场景 |
|-----|------|---------|
| 全量备份 | 一次性导出所有数据 | 数据初始化、灾备 |
| 增量备份 | 记录变更日志（Binlog） | 持续同步、Point-in-Time Recovery |

```java
// TiDB 备份架构
public class TiDBBackup {
    // 全量备份：BR 工具
    public class BR {
        // BR 直接读取 TiKV 的 SST 文件
        // 不经过 SQL 层，效率极高
        public void fullBackup() {
            // 1. 获取备份时间点（TSO）
            long backupTs = pd.getCurrentTSO();

            // 2. 扫描所有 Region
            // 3. 并发读取每个 Region 的数据
            // 4. 生成备份文件（SST 格式）

            // 备份速度：可达 1GB/s+
        }
    }

    // 增量备份：Binlog
    public class BinlogBackup {
        // 记录从某个时间点开始的变更
        public void incrementalBackup(long fromTs) {
            // 1. 读取 Binlog
            // 2. 过滤 fromTs 之后的变更
            // 3. 保存到文件
        }
    }
}
```

## BR 全量备份

### 基本操作

```bash
# 备份整个集群
br backup full \
    --pd 192.168.1.1:2379 \
    --storage "s3://my-bucket/tidb-backup/20240101" \
    --ratelimit 128 \
    --log-file backup.log

# 备份单个数据库
br backup db \
    --pd 192.168.1.1:2379 \
    --db myapp \
    --storage "s3://my-bucket/tidb-backup/myapp" \
    --ratelimit 64

# 备份单个表
br backup table \
    --pd 192.168.1.1:2379 \
    --db myapp \
    --table orders \
    --storage "s3://my-bucket/tidb-backup/orders" \
    --ratelimit 64
```

### 备份原理

```java
// BR 备份流程
public class BRBackup {
    public void backup(String storagePath) {
        // 1. 获取备份时间点
        long backupTs = pd.getCurrentTSO();

        // 2. Region 调度
        // 让 Leader 分布更均匀，减少备份窗口
        RegionHelper.rebalance();

        // 3. 并发备份
        List&lt;Future&lt;BackupResult&gt;&gt; futures = new ArrayList&lt;&gt;();
        for (Region region : allRegions) {
            futures.add(executor.submit(() -> backupRegion(region)));
        }

        // 4. 等待所有 Region 完成
        waitForCompletion(futures);

        // 5. 生成备份元信息
        writeBackupMeta(backupTs, regionResults);
    }

    private BackupResult backupRegion(Region region) {
        // 每个 Region 的备份：
        // 1. Leader 节点执行备份
        // 2. 读取该 Region 的所有 Key-Value
        // 3. 生成 SST 文件
        // 4. 上传到存储
        return region.backupToSST();
    }
}
```

### 备份选项

```bash
# 限速（避免影响业务）
--ratelimit 128  # MB/s

# 并发数
--concurrency 4  # 默认 4，可调大

# 日志级别
--log-level info

# 备份文件加密
--crypter.secret my-secret-key
```

## BR 全量恢复

```bash
# 恢复到新集群
br restore full \
    --pd 192.168.1.2:2379 \
    --storage "s3://my-bucket/tidb-backup/20240101" \
    --ratelimit 128 \
    --log-file restore.log

# 恢复单个数据库
br restore db \
    --pd 192.168.1.2:2379 \
    --db myapp \
    --storage "s3://my-bucket/tidb-backup/myapp" \
    --ratelimit 64

# 恢复单个表
br restore table \
    --pd 192.168.1.2:2379 \
    --db myapp \
    --table orders \
    --storage "s3://my-bucket/tidb-backup/orders" \
    --ratelimit 64
```

```java
// BR 恢复流程
public class BRRestore {
    public void restore(String storagePath) {
        // 1. 读取备份元信息
        BackupMeta meta = readBackupMeta(storagePath);

        // 2. 清理目标数据（可选）
        // 根据 --barrier 检查点避免重复恢复

        // 3. 并发恢复
        for (RegionBackup backup : meta.getRegions()) {
            executor.submit(() -> restoreRegion(backup));
        }

        // 4. 等待所有 Region 完成
        waitForCompletion();

        // 5. 校验恢复结果
        verifyRestore();
    }
}
```

## Point-in-Time Recovery（PITR）

当数据库发生误操作时，我们需要恢复到「误操作之前」的某个时间点。

PITR = 全量备份 + 增量 Binlog 恢复

```bash
# 1. 恢复到某个时间点
# 先恢复全量备份
br restore full \
    --pd 192.168.1.2:2379 \
    --storage "s3://my-bucket/tidb-backup/20240101-full"

# 再应用增量 Binlog
br restore point \
    --pd 192.168.1.2:2379 \
    --storage "s3://my-bucket/tidb-backup/binlog" \
    --restored-ts 2024-01-01T15:30:00+08:00
```

```java
// PITR 原理
public class PITR {
    public void restoreToPoint(String targetTs) {
        // 1. 恢复最近的全量备份
        BRRestore.restoreFull(latestBackup);

        // 2. 找出全量备份之后、目标时间之前的 Binlog 文件
        List&lt;BinlogFile&gt; binlogs = findBinlogs(
            latestBackup.getBackupTs(),
            targetTs
        );

        // 3. 按顺序应用 Binlog
        for (BinlogFile file : binlogs) {
            // 跳过 targetTs 之后的变更
            applyBinlogUntil(file, targetTs);
        }

        // 4. 恢复完成
    }
}
```

## 备份存储方案

| 存储类型 | 说明 | 适用场景 |
|---------|------|---------|
| 本地磁盘 | 最快 | 测试环境 |
| S3/兼容S3 | 云存储 | 生产环境、跨区域灾备 |
| HDFS | 大数据生态 | 有 HDFS 集群 |
| GCS/Azure Blob | 云存储 | 对应云平台 |

```bash
# S3 配置
export AWS_ACCESS_KEY_ID=xxx
export AWS_SECRET_ACCESS_KEY=xxx
export AWS_DEFAULT_REGION=us-west-2

br backup full \
    --storage "s3://my-bucket/tidb-backup/" \
    --s3.endpoint "https://s3.amazonaws.com"
```

## 备份最佳实践

### 备份策略设计

```bash
# 推荐备份策略
# 全量：每天凌晨 2 点
# 增量：每小时一次
# 保留：最近 7 天全量 + 最近 30 天增量

# crontab 配置
0 2 * * * /usr/bin/br backup full ...
0 * * * * /usr/bin/br backup incr ...
```

### 备份监控

```bash
# 查看备份状态
br decode --field="end-version" --tiup-word "s3://..."

# Grafana 监控
# - Backup: 备份进度、速率
# - Restore: 恢复进度
# - Storage: 备份文件大小
```

### 恢复演练

```bash
# 定期进行恢复演练
# 1. 恢复到测试环境
br restore full \
    --pd 192.168.1.100:2379 \
    --storage "s3://my-bucket/tidb-backup/..."

# 2. 验证数据完整性
sync-diff-inspector --config diff.yaml

# 3. 记录恢复时间（RTO）
```

## 面试追问

**Q: BR 备份对业务有影响吗？**

BR 直接读取 TiKV 的 SST 文件，对业务影响很小。但建议在业务低峰期执行全量备份。

**Q: 备份可以加密吗？**

可以。BR 支持 AES-256 加密：

```bash
br backup full \
    --crypter.aes-256-iv=xxx \
    --crypter.secret=xxx
```

**Q: 可以备份到多个存储吗？**

可以。你可以使用 BR 备份到多个目标，或者手动复制备份文件到不同存储。

---

## 总结

备份是数据安全的最后防线。TiDB 的 BR 工具让备份恢复变得高效简单：

- **全量备份**：一次性导出所有数据，备份速度快
- **增量备份**：结合 Binlog 实现持续保护
- **PITR**：恢复到任意时间点
- **加密存储**：保障备份数据安全

记住备份原则：**多备份，多演练，多存储**。
