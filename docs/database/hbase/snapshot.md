# HBase 快照：数据的时光机

误删了表？数据被污染了？

快照就是你的时光机。

---

## 快照是什么？

快照是 HBase 数据的只读副本，不复制数据，只记录数据版本信息。

```
┌─────────────────────────────────────────────────────────────┐
│                    HBase 快照原理                            │
│                                                             │
│  原始数据：                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  HFile 1, HFile 2, HFile 3, HFile 4, HFile 5         │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  创建快照后：                                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Snapshot A 记录：HFile 1, HFile 3, HFile 4          │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Snapshot B 记录：HFile 1, HFile 2, HFile 5          │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  注意：快照不复制数据，只记录 HFile 引用                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 快照操作

### 1. 创建快照

```java
// 创建快照
public class SnapshotOperations {
    private final Admin admin;

    public void createSnapshot(String tableName, String snapshotName)
            throws IOException {
        // 快照名
        SnapshotDescription snapshot =
            SnapshotDescription.newBuilder(snapshotName)
                .withTable(Bytes.toBytes(tableName))
                .build();

        // 执行快照
        admin.takeSnapshot(snapshot);
    }

    // 异步快照
    public void asyncSnapshot(String tableName, String snapshotName)
            throws IOException {
        admin.takeSnapshotAsync(snapshotDescription);
    }
}
```

### 2. 查看快照

```bash
# HBase Shell
> list_snapshots
SNAPSHOT                       TABLE + CREATION TIME
snapshot_20240315              t_user   2024-03-15 10:00:00

> snapshot 't_user', 'snapshot_20240315'
> describe_snapshot 'snapshot_20240315'
```

### 3. 恢复快照

```java
// 从快照恢复表
public void restoreSnapshot(String snapshotName, String tableName)
        throws IOException {
    // 方式 1：恢复原表
    admin.restoreSnapshot(snapshotName);

    // 方式 2：恢复到新表
    admin.restoreSnapshot(snapshotName, tableName + "_restore");
}
```

### 4. 克隆快照

```java
// 克隆快照到新表
public void cloneSnapshot(String snapshotName, String newTableName)
        throws IOException {
    // 从快照创建新表（新表可以独立修改）
    admin.cloneSnapshot(snapshotName, newTableName);
}
```

### 5. 删除快照

```java
// 删除快照
public void deleteSnapshot(String snapshotName) throws IOException {
    admin.deleteSnapshot(snapshotName);
}
```

---

## 快照的用途

### 1. 数据备份

```java
// 定期备份策略
public class BackupScheduler {
    private final Admin admin;

    public void dailyBackup(String tableName) throws IOException {
        String snapshotName = tableName + "_" +
            LocalDate.now().format(DateTimeFormatter.BASIC_ISO_DATE);

        try {
            admin.takeSnapshot(snapshotDescription);

            // 保留最近 7 天快照
            cleanupOldSnapshots(tableName, 7);

        } catch (IOException e) {
            alert("Backup failed: " + e.getMessage());
        }
    }

    private void cleanupOldSnapshots(String tableName, int keepDays)
            throws IOException {
        List&lt;SnapshotDescription&gt; snapshots =
            admin.listSnapshots();

        LocalDate cutoff = LocalDate.now().minusDays(keepDays);

        for (SnapshotDescription snapshot : snapshots) {
            if (snapshot.getName().startsWith(tableName)) {
                LocalDate snapshotDate = parseDate(snapshot.getName());
                if (snapshotDate.isBefore(cutoff)) {
                    admin.deleteSnapshot(snapshot.getName());
                }
            }
        }
    }
}
```

### 2. 数据验证

```java
// 数据验证
public class DataValidation {
    private final Admin admin;

    public void validateData(String tableName, String snapshotName)
            throws IOException {
        // 1. 创建快照
        admin.takeSnapshot(snapshotDescription);

        // 2. 克隆到验证表
        String validateTable = tableName + "_validate";
        admin.cloneSnapshot(snapshotName, validateTable);

        // 3. 在验证表上执行检查
        Table table = connection.getTable(TableName.valueOf(validateTable));

        Scan scan = new Scan();
        int invalidCount = 0;

        try (ResultScanner scanner = table.getScanner(scan)) {
            for (Result result : scanner) {
                if (!isValid(result)) {
                    invalidCount++;
                }
            }
        }

        // 4. 删除验证表
        admin.deleteTable(TableName.valueOf(validateTable));

        if (invalidCount > 0) {
            alert("Found " + invalidCount + " invalid records");
        }
    }
}
```

### 3. 数据迁移

```java
// 数据迁移
public class DataMigration {
    private final Admin admin;

    public void migrateTable(String srcTable, String dstTable)
            throws IOException {
        // 1. 创建快照
        String snapshotName = srcTable + "_migration";
        admin.takeSnapshot(snapshotDescription);

        // 2. 导出到 HDFS
        String exportPath = "hdfs:///migration/" + snapshotName;
        admin.copySnapshotToFileSystem(srcTable, snapshotName, exportPath);

        // 3. 在目标集群恢复
        // hbase org.apache.hadoop.hbase.snapshot.Tool \
        //   -copy-from-snapshot dst-cluster:9100 exportPath snapshotName
    }
}
```

### 4. 快速回滚

```java
// 快速回滚
public class QuickRollback {
    private final Admin admin;

    public void rollback(String tableName) throws IOException {
        // 找到最近的快照
        List&lt;SnapshotDescription&gt; snapshots =
            admin.listSnapshots();

        SnapshotDescription latestSnapshot = snapshots.stream()
            .filter(s -> s.getName().startsWith(tableName))
            .max(Comparator.comparing(SnapshotDescription::getCreationTime))
            .orElseThrow(() -> new IOException("No snapshot found"));

        // 禁用原表
        admin.disableTable(TableName.valueOf(tableName));

        // 用快照恢复
        admin.restoreSnapshot(latestSnapshot.getName());

        // 启用表
        admin.enableTable(TableName.valueOf(tableName));
    }
}
```

---

## ExportSnapshot / ImportSnapshot

```bash
# 导出快照到 HDFS
hbase org.apache.hadoop.hbase.snapshot.ExportSnapshot \
    -snapshot my_snapshot \
    -copy-to hdfs://dest-cluster:8020/hbase/backup \
    -mappers 4

# 从 HDFS 导入快照
hbase org.apache.hadoop.hbase.snapshot.ExportSnapshot \
    -snapshot my_snapshot \
    -copy-from hdfs://src-cluster:8020/hbase/backup \
    -mappers 4
```

---

## 快照配置

```xml
<!-- hbase-site.xml -->
<property>
    <name>hbase.snapshot.enabled</name>
    <value>true</value>
</property>
<property>
    <name>hbase.snapshot.master.timeout</name>
    <value>600000</value>  <!-- 10 分钟 -->
</property>
<property>
    <name>hbase.snapshot.region.timeout</name>
    <value>300000</value>  <!-- 5 分钟 -->
</property>
```

---

## 面试追问方向

- 快照和备份有什么区别？
- 快照会影响性能吗？

下一节，我们来了解 HBase 的监控与运维。
