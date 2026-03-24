# 数据库备份与恢复：数据安全的最后防线

你有没有遇到过这种情况：

运维人员在凌晨执行了一个 `DROP TABLE` 脚本，然后发现删错了表。

如果没有任何备份，那一刻，积攒了多年的数据就这样灰飞烟灭。

这不是在吓唬你，而是真实发生在无数企业中的惨剧。而**备份**，就是数据库的「后悔药」。

## 备份的类型

### 从备份范围划分

**全量备份（Full Backup）**

备份整个数据库的所有数据。

```bash
# 使用 dmrman 进行全量备份
./dmrman
RMAN> BACKUP DATABASE '/data/dmdbms/DAMENG/dm.ini' FULL BACKUPSET '/backup/full_db_20240324';
```

**增量备份（Incremental Backup）**

只备份自上次备份以来变化的数据。

```bash
# 增量备份
RMAN> BACKUP INCREMENTAL DATABASE '/data/dmdbms/DAMENG/dm.ini' 
       INCREMENT WITH BACKUPSET '/backup/incre_20240324';
```

**差异备份（Differential Backup）**

只备份自上次全量备份以来变化的数据。

```bash
# 差异备份
RMAN> BACKUP DATABASE '/data/dmdbms/DAMENG/dm.ini'
       DIFFERENTIAL BACKUPSET '/backup/diff_20240324';
```

### 从备份方式划分

| 备份方式 | 优点 | 缺点 | 适用场景 |
|---------|------|------|---------|
| 物理备份 | 速度快，恢复快 | 占用空间大 | 大型数据库紧急恢复 |
| 逻辑备份 | 可选择性恢复，灵活性高 | 速度慢 | 小型数据库，定期备份 |

```sql
-- 逻辑备份（使用 dexp/dexpdp）
-- 导出整个数据库
$ dexp SYSDBA/SYSDBA@localhost:5236 FILE=full.dmp LOG=full.log

-- 只导出特定表
$ dexp SYSDBA/SYSDBA@localhost:5236 TABLES=orders,customers FILE=tables.dmp

-- 只导出数据结构
$ dexp SYSDBA/SYSDBA@localhost:5236 FILE=schema.dmp ROWS=N
```

## 达梦备份工具

### dmrman：命令行备份工具

```bash
# 基本操作
./dmrman
RMAN> BACKUP DATABASE '/data/dmdbms/DAMENG/dm.ini' FULL BACKUPSET '/backup/full';

# 检查备份集
RMAN> BACKUP CHECK BACKUPSET '/backup/full';

# 列出备份集
RMAN> LIST BACKUPSET '/backup/full';

# 删除过期备份
RMAN> REMOVE BACKUPSET '/backup/old' DELETE;
```

### SQL 命令备份

```sql
-- 创建备份集
BACKUP DATABASE FULL BACKUPSET '/backup/full_20240324';

-- 备份指定表空间
BACKUP TABLESPACE MAIN FULL BACKUPSET '/backup/ts_main';

-- 备份归档日志
BACKUP ARCHIVE LOG ALL BACKUPSET '/backup/arch_all';
```

## 恢复操作

### 完全恢复

```bash
# 恢复整个数据库
./dmrman
RMAN> RESTORE DATABASE '/data/dmdbms/DAMENG/dm.ini' FROM BACKUPSET '/backup/full';
RMAN> RECOVER DATABASE '/data/dmdbms/DAMENG/dm.ini' FROM BACKUPSET '/backup/full';
RMAN> RECOVER DATABASE '/data/dmdbms/DAMENG/dm.ini' UPDATE DB_MAGIC;
```

### 基于时间点的恢复（PITR）

```sql
-- 恢复到指定时间点
RECOVER DATABASE '/data/dmdbms/DAMENG/dm.ini'
WITH BACKUPSET '/backup/full'
UNTIL TIME '2024-03-24 10:30:00';
```

```java
// Java 应用中执行时间点恢复（慎用！）
public class PitrRecovery {

    public void recoverToPointInTime() {
        // 模拟时间点恢复的场景
        // 场景：误删除数据，需要恢复到删除操作之前

        // 1. 确认误操作的时间点
        String wrongTime = "2024-03-24 09:45:00";

        // 2. 执行时间点恢复
        String sql = String.format(
            "RECOVER DATABASE '%s' UNTIL TIME '%s'",
            "/data/dmdbms/DAMENG/dm.ini",
            wrongTime
        );

        // 3. 注意：这会丢失 09:45 之后的所有数据
        // 执行前务必确认！
    }
}
```

### 表级恢复

```sql
-- 从备份中提取特定表的数据
RESTORE TABLE orders FROM BACKUPSET '/backup/full' WHERE order_date >= '2024-01-01';
```

## 备份策略设计

### 3-2-1 备份原则

```
3 份数据副本（原始数据 + 2 份备份）
2 种不同介质（磁盘 + 磁带/云存储）
1 份异地备份（防止本地灾难）
```

### 推荐备份策略

| 环境 | 备份策略 | 说明 |
|-----|---------|------|
| 生产库 | 全量每天 + 增量每小时 | 最大程度保护数据 |
| 测试库 | 全量每周 | 测试环境数据可重建 |
| 备库 | 实时归档 + 定期全量 | 主库故障时可切换 |

```bash
# 示例备份脚本
#!/bin/bash
# backup.sh - 每日备份脚本

DATE=$(date +%Y%m%d)
BACKUP_DIR=/backup/daily
LOG_DIR=/backup/logs

# 全量备份（周日）
if [ $(date +%w) -eq 0 ]; then
    echo "执行全量备份..."
    ./dmrman cmd="BACKUP DATABASE '/data/dmdbms/DAMENG/dm.ini' FULL BACKUPSET '${BACKUP_DIR}/full_${DATE}'"
fi

# 增量备份（每天）
echo "执行增量备份..."
./dmrman cmd="BACKUP DATABASE '/data/dmdbms/DAMENG/dm.ini' INCREMENT WITH BACKUPSET '${BACKUP_DIR}/incre_${DATE}'"

# 清理 7 天前的备份
find ${BACKUP_DIR} -name "*.bak" -mtime +7 -delete

echo "备份完成: ${DATE}"
```

## 备份的验证与测试

备份了不等于高枕无忧，必须定期验证备份是否可用。

```sql
-- 验证备份集完整性
RESTORE DATABASE '/tmp/test_restore/dm.ini'
FROM BACKUPSET '/backup/full_20240324'
WITH BACKUPINFO '/backup/full_20240324/backup_info.txt'
NOKEEP;

-- 执行检查点，确保备份可恢复
CHECKPOINT(10);
```

```java
// 定期恢复演练
public class BackupDrill {

    public void performDrill() {
        // 1. 在测试环境恢复备份
        String testDbPath = "/test/dmdbms/DAMENG";
        executeRestore(testDbPath, "/backup/latest");

        // 2. 验证数据完整性
        int recordCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM orders", Integer.class);
        int expectedMin = getExpectedMinRecordCount();

        if (recordCount < expectedMin) {
            throw new RuntimeException("备份恢复失败：数据量异常");
        }

        // 3. 验证核心业务查询
        validateCoreQueries();

        System.out.println("恢复演练成功！");
    }
}
```

## 面试追问方向

- 全量备份和增量备份各有什么优缺点？如何设计备份策略？
- 备份过程中可以执行 DML 操作吗？
- 如何验证备份是否可用？

---

## 一句话总结

备份是数据库的「保险」，宁可不用，不能没有。记住 3-2-1 原则，定期演练恢复，让备份真正成为数据的最后防线。
