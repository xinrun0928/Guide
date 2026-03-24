# MongoDB 数据备份与恢复：mongodump、mongorestore

数据无价，备份先行。

这一篇，我们来全面了解 MongoDB 的备份与恢复机制。

## 备份方式概览

| 方式 | 说明 | 适用场景 |
|-----|------|---------|
| **mongodump** | 逻辑备份，导出 BSON | 小数据量、跨版本迁移 |
| **mongorestore** | 逻辑恢复，导入 BSON | 恢复 mongodump 备份 |
| **文件系统快照** | 直接复制数据文件 | 大数据量、生产环境 |
| **MongoDB Ops Manager** | 企业级备份 | 大规模部署 |
| **Cloud Backup** | 云服务备份 | MongoDB Atlas |

## mongodump：逻辑备份

### 基本用法

```bash
# 备份整个数据库
mongodump --uri="mongodb://localhost:27017/myapp" --out=/backup/mongodump

# 备份到指定目录
mongodump --host localhost --port 27017 --db myapp --out /backup/mongodump

# 备份并压缩
mongodump --host localhost --port 27017 --db myapp --out /backup/mongodump --gzip
```

### 备份选项

```bash
# 备份特定集合
mongodump --db myapp --collection orders --out /backup/mongodump

# 备份多个数据库
mongodump --db myapp --db logs --out /backup/mongodump

# 带认证的备份
mongodump --host localhost --port 27017 \
         --username admin --password password \
         --authenticationDatabase admin \
         --db myapp \
         --out /backup/mongodump

# 备份指定条件的文档
mongodump --db myapp --collection orders \
         --query '{"status": "completed"}' \
         --out /backup/mongodump

# 副本集备份
mongodump --uri="mongodb://mongo1:27017,mongo2:27017/?replicaSet=rs0" \
         --oplog \
         --out /backup/mongodump
```

### 备份输出结构

```bash
/backup/mongodump/
├── myapp/                    # 数据库名
│   ├── orders.metadata.json  # 集合元数据
│   ├── orders.bson          # 集合数据（压缩后为 .gz）
│   ├── users.metadata.json
│   └── users.bson
└── logs/
    └── access.bson
```

### Oplog 备份

```bash
# 使用 oplog 备份（支持 point-in-time 恢复）
mongodump --host localhost --port 27017 \
         --username admin --password password \
         --authenticationDatabase admin \
         --oplog \
         --out /backup/mongodump_with_oplog

# 查看 oplog 备份
ls /backup/mongodump_with_oplog/oplog.bson
```

## mongorestore：逻辑恢复

### 基本用法

```bash
# 恢复整个备份
mongorestore --uri="mongodb://localhost:27017" /backup/mongodump

# 恢复到指定数据库
mongorestore --host localhost --port 27017 \
             --db myapp \
             /backup/mongodump/myapp

# 恢复并压缩数据
mongorestore --host localhost --port 27017 \
             --gzip \
             /backup/mongodump/myapp
```

### 恢复选项

```bash
# 恢复特定集合
mongorestore --host localhost --port 27017 \
             --db myapp --collection orders \
             /backup/mongodump/myapp/orders.bson

# 覆盖现有数据（默认追加）
mongorestore --host localhost --port 27017 \
             --db myapp \
             --drop \          # 先删除现有集合
             /backup/mongodump/myapp

# 恢复并重命名集合
mongorestore --host localhost --port 27017 \
             --nsTarget=myapp.orders_new \
             /backup/mongodump/myapp/orders.bson

# 带认证恢复
mongorestore --host localhost --port 27017 \
             --username admin --password password \
             --authenticationDatabase admin \
             /backup/mongodump
```

### Oplog 恢复（Point-in-Time）

```bash
# 先恢复数据
mongorestore --host localhost --port 27017 \
             --oplogReplay \
             /backup/mongodump_with_oplog

# 恢复到指定时间点
mongorestore --host localhost --port 27017 \
             --oplogReplay \
             --oplogLimit="2024-01-15T10:30:00" \
             /backup/mongodump_with_oplog
```

## 文件系统快照

### LVM 快照备份

```bash
# 1. 刷新 Journal
mongo --quiet --eval "db.adminCommand({fsync: 1})"

# 2. 创建 LVM 快照
lvcreate --size 10G --snapshot --name mongodb_snap /dev/vg00/lv_mongodb

# 3. 挂载快照
mount /dev/vg00/mongodb_snap /mnt/snapshot

# 4. 复制数据
cp -a /mnt/snapshot/data /backup/snapshot

# 5. 卸载快照
umount /mnt/snapshot
lvdelete /dev/vg00/mongodb_snap
```

### 云快照

```bash
# AWS EBS 快照
aws ec2 create-snapshot --volume-id vol-xxxxx --description "MongoDB backup"

# GCP 磁盘快照
gcloud compute disks snapshot DISK_NAME --snapshot-names=mongodb-backup
```

## 副本集备份

### 从从节点备份

```bash
# 连接到从节点（避免影响主节点）
mongodump --host localhost --port 27018 \
         --oplog \
         --out /backup/mongodump
```

### 备份策略

```javascript
// 推荐：副本集备份脚本
// backup.js
const backupDir = "/backup/mongodump";
const date = new Date().toISOString().replace(/[:.]/g, '-');

runProgram("mongodump",
    "--host", "localhost",
    "--port", "27018",  // 从节点
    "--oplog",
    "--out", backupDir + "/" + date
);

print("Backup completed: " + date);
```

## mongosniff/mongoexport（可选）

### mongoexport（JSON/CSV 导出）

```bash
# 导出为 JSON
mongoexport --host localhost --port 27017 \
            --db myapp --collection orders \
            --out /backup/orders.json

# 导出为 CSV
mongoexport --host localhost --port 27017 \
            --db myapp --collection orders \
            --type=csv \
            --fields "_id,userId,amount,status" \
            --out /backup/orders.csv

# 导出特定条件
mongoexport --host localhost --port 27017 \
            --db myapp --collection orders \
            --query '{"status": "completed", "amount": {$gt: 100}}' \
            --out /backup/filtered_orders.json
```

### mongoimport（JSON/CSV 导入）

```bash
# 导入 JSON
mongoimport --host localhost --port 27017 \
            --db myapp --collection orders \
            --file /backup/orders.json

# 导入 CSV
mongoimport --host localhost --port 27017 \
            --db myapp --collection orders \
            --type=csv \
            --headerline \
            --file /backup/orders.csv

# 导入并覆盖
mongoimport --host localhost --port 27017 \
            --db myapp --collection orders \
            --drop \
            --file /backup/orders.json
```

## 定时备份脚本

```bash
#!/bin/bash

# backup.sh - MongoDB 定时备份脚本

# 配置
BACKUP_DIR="/backup/mongodump"
RETENTION_DAYS=7
DB_HOST="localhost"
DB_PORT="27018"  # 从节点
DB_USER="backup"
DB_PASS="password"
AUTH_DB="admin"

# 创建备份目录
DATE=$(date +%Y%m%d_%H%M%S)
CURRENT_BACKUP="$BACKUP_DIR/$DATE"

mkdir -p $CURRENT_BACKUP

# 执行备份
mongodump --host $DB_HOST --port $DB_PORT \
          --username $DB_USER --password $DB_PASS \
          --authenticationDatabase $AUTH_DB \
          --oplog \
          --gzip \
          --out $CURRENT_BACKUP

# 检查备份是否成功
if [ $? -eq 0 ]; then
    echo "Backup completed successfully: $CURRENT_BACKUP"

    # 删除过期备份
    find $BACKUP_DIR -type d -mtime +$RETENTION_DAYS -exec rm -rf {} \;

    # 上传备份到远程存储（可选）
    # rclone copy $CURRENT_BACKUP remote:mongodb-backups/

    echo "Old backups cleaned up"
else
    echo "Backup failed!"
    exit 1
fi
```

### Cron 定时任务

```bash
# 添加定时任务
crontab -e

# 每天凌晨 2 点执行备份
0 2 * * * /path/to/backup.sh >> /var/log/mongodb-backup.log 2>&1

# 每 6 小时执行一次
0 */6 * * * /path/to/backup.sh >> /var/log/mongodb-backup.log 2>&1
```

## 恢复演练

### 定期恢复测试

```bash
# 1. 在测试环境恢复
mongorestore --host test-mongo:27017 \
             --drop \
             /backup/mongodump/20240115_020000

# 2. 验证数据完整性
mongo test-mongo --eval "
    db.orders.count();
    db.orders.findOne();
    db.users.count();
"

# 3. 检查集合索引
mongo test-mongo --eval "
    db.orders.getIndexes();
    db.users.getIndexes();
"
```

### 恢复脚本

```bash
#!/bin/bash

# restore.sh - MongoDB 恢复脚本

# 恢复时间点
TARGET_TIME="2024-01-15T10:30:00"

# 恢复目录
BACKUP_DIR="/backup/mongodump"

# 选择最近的备份
LATEST_BACKUP=$(ls -t $BACKUP_DIR | head -1)

echo "Restoring from: $LATEST_BACKUP"

# 停止应用
# systemctl stop myapp

# 恢复数据
mongorestore --host localhost --port 27017 \
             --oplogReplay \
             --oplogLimit="$TARGET_TIME" \
             "$BACKUP_DIR/$LATEST_BACKUP"

# 检查恢复结果
echo "Restore completed. Verifying..."

# 启动应用
# systemctl start myapp
```

## Java 备份工具

```java
import com.mongodb.client.MongoClient;
import com.mongodb.client.MongoClients;
import java.io.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class MongoBackup {

    public static void main(String[] args) {
        String backupHost = "localhost";
        int backupPort = 27018;  // 从节点
        String backupDir = "/backup/mongodump";

        try {
            // 创建备份目录
            String timestamp = LocalDateTime.now()
                .format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
            String backupPath = backupDir + "/" + timestamp;

            // 执行 mongodump（通过 ProcessBuilder）
            ProcessBuilder pb = new ProcessBuilder(
                "mongodump",
                "--host", backupHost,
                "--port", String.valueOf(backupPort),
                "--oplog",
                "--gzip",
                "--out", backupPath
            );
            pb.inheritIO();
            Process process = pb.start();
            int exitCode = process.waitFor();

            if (exitCode == 0) {
                System.out.println("Backup completed: " + backupPath);
            } else {
                System.err.println("Backup failed with exit code: " + exitCode);
            }

        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
```

## 总结

备份恢复命令速查：

| 操作 | 命令 |
|-----|------|
| 全量备份 | `mongodump --out /backup` |
| 压缩备份 | `mongodump --gzip --out /backup` |
| 带 oplog 备份 | `mongodump --oplog --out /backup` |
| 副本集备份 | `mongodump --host secondary --oplog` |
| 全量恢复 | `mongorestore /backup` |
| 恢复到指定时间 | `mongorestore --oplogReplay --oplogLimit="时间点"` |
| 覆盖恢复 | `mongorestore --drop /backup` |
| 导出 JSON | `mongoexport --out file.json` |
| 导入 JSON | `mongoimport --file file.json` |

**备份策略建议**：
1. 每日全量备份
2. 开启 oplog 支持 point-in-time 恢复
3. 备份上传到异地存储
4. 定期进行恢复演练
5. 从副本集从节点备份，避免影响主节点

---

**下一步，你可以：**

- 了解 [MongoDB vs MySQL vs Redis 选型](/database/mongodb/compare)
- 掌握 [MongoDB 面试高频问题汇总](/database/mongodb/interview-summary)
