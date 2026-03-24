# MariaDB 备份与恢复：XtraBackup 集成

凌晨 3 点，你的数据库服务器硬盘坏了。

运维急得满头大汗：「数据能不能恢复？」

你淡定点开备份脚本：「放心，有全量备份，还有增量备份。」

**数据备份是数据库运维的生命线。MariaDB 的 XtraBackup 是目前最流行的开源备份工具，支持在线热备、增量备份、加密备份。**

---

## 备份概述

### 备份类型

```
┌─────────────────────────────────────────────────────────────┐
│                    备份类型对比                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  全量备份                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐          │
│  │ Day 1   │ │ Day 2   │ │ Day 3   │ │ Day 4   │          │
│  │ 100GB   │ │  5GB    │ │  8GB    │ │  3GB    │          │
│  │  全量   │ │ 增量    │ │ 增量    │ │ 增量    │          │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘          │
│                                                             │
│  增量备份的优势：                                            │
│  - 备份速度快                                              │
│  - 占用空间少                                              │
│  - 恢复时需要先恢复全量，再依次恢复增量                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

| 备份类型 | 优点 | 缺点 | 适用场景 |
|----------|------|------|----------|
| 全量备份 | 恢复简单 | 占用空间大，耗时长 | 定期备份 |
| 增量备份 | 速度快，空间省 | 恢复复杂 | 频繁备份 |
| 差异备份 | 介于两者之间 | - | 定期备份 |

### 备份工具对比

| 工具 | 类型 | 在线备份 | 增量备份 | 锁表 | 压缩 |
|------|------|----------|----------|------|------|
| mysqldump | 逻辑备份 | ✅ | ❌ | 可选 | ✅ |
| mydumper | 逻辑备份 | ✅ | ✅ | 可选 | ✅ |
| XtraBackup | 物理备份 | ✅ | ✅ | 无锁 | ✅ |
| Mariabackup | 物理备份 | ✅ | ✅ | 无锁 | ✅ |

---

## XtraBackup / Mariabackup 安装

### 安装 XtraBackup

```bash
# Ubuntu/Debian
apt update && apt install -y percona-xtrabackup

# CentOS/RHEL
yum install -y percona-xtrabackup-80
```

### 安装 Mariabackup（MariaDB 官方）

```bash
# Ubuntu/Debian
apt update && apt install -y mariadb-backup

# CentOS/RHEL
yum install -y MariaDB-backup
```

---

## 全量备份

### 使用 Mariabackup 备份

```bash
# 创建备份用户
mysql -e "CREATE USER 'backup'@'localhost' IDENTIFIED BY 'backup_pass';"
mysql -e "GRANT BACKUP_ADMIN, PROCESS, RELOAD, LOCK TABLES, REPLICATION CLIENT ON *.* TO 'backup'@'localhost';"
mysql -e "GRANT SELECT ON performance_schema.* TO 'backup'@'localhost';"
mysql -e "FLUSH PRIVILEGES;"

# 创建备份目录
mkdir -p /backup/full
chown -R mysql:mysql /backup

# 执行全量备份
mariabackup --backup \
    --target-dir=/backup/full \
    --user=backup \
    --password=backup_pass
```

### 备份输出

```bash
# 查看备份结果
ls -la /backup/full/

# 典型输出：
# backup-my.cnf
# xtrabackup_checkpoints    ← 备份检查点
# xtrabackup_info
# xtrabackup_logfile        ← 事务日志
# ibdata1                  ← 系统表空间
# mysql/                    ← 数据库目录
# mydb/                    ← 用户数据库
```

### 查看备份信息

```bash
# 查看备份检查点
cat /backup/full/xtrabackup_checkpoints

# 输出示例：
# backup_type = full-backuped
# from_lsn = 0
# to_lsn = 12345678
# last_lsn = 12345678
# compact = 0
# recovered_binlog = 0
```

---

## 增量备份

### 增量备份原理

```
┌─────────────────────────────────────────────────────────────┐
│                    增量备份原理                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  LSN (Log Sequence Number)                                  │
│  │                                                             │
│  ├── LSN 0 ────────────────────────────► LSN 12345678      │
│  │     全量备份包含所有数据                      │           │
│  │                                          │           │
│  │   ───────────────────────────► LSN 12350000              │
│  │        第一次增量备份              │                   │
│  │                                    │                   │
│  │        ────────────────► LSN 12355000                   │
│  │             第二次增量备份    │                          │
│  │                              │                          │
│  │         ──────► LSN 12360000                             │
│  │              第三次增量                               │
│                                                             │
│  恢复时：全量 → 增量1 → 增量2 → 增量3                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 执行增量备份

```bash
# 第一次增量备份
mkdir -p /backup/inc1
mariabackup --backup \
    --target-dir=/backup/inc1 \
    --incremental-basedir=/backup/full \
    --user=backup \
    --password=backup_pass

# 第二次增量备份（基于第一次）
mkdir -p /backup/inc2
mariabackup --backup \
    --target-dir=/backup/inc2 \
    --incremental-basedir=/backup/inc1 \
    --user=backup \
    --password=backup_pass

# 查看增量备份检查点
cat /backup/inc1/xtrabackup_checkpoints
cat /backup/inc2/xtrabackup_checkpoints
```

---

## 数据恢复

### 恢复流程

```
┌─────────────────────────────────────────────────────────────┐
│                    恢复流程                                 │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 停止 MariaDB                                           │
│             │                                                │
│             ▼                                                │
│  2. 准备备份（应用日志）                                    │
│             │                                                │
│             ▼                                                │
│  3. 恢复数据文件                                            │
│             │                                                │
│             ▼                                                │
│  4. 设置权限                                                │
│             │                                                │
│             ▼                                                │
│  5. 启动 MariaDB                                           │
│             │                                                │
│             ▼                                                │
│  6. 验证数据                                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 准备备份（Prepare）

```bash
# 全量备份准备
mariabackup --prepare --target-dir=/backup/full

# 增量备份需要依次准备
mariabackup --prepare --target-dir=/backup/full
mariabackup --prepare --target-dir=/backup/full --incremental-dir=/backup/inc1
mariabackup --prepare --target-dir=/backup/full --incremental-dir=/backup/inc2
```

### 恢复数据

```bash
# 停止 MariaDB
systemctl stop mariadb

# 备份当前数据（以防万一）
mv /var/lib/mysql /var/lib/mysql.bak

# 创建数据目录
mkdir -p /var/lib/mysql

# 恢复数据（使用 --move-back）
mariabackup --move-back --target-dir=/backup/full

# 设置权限
chown -R mysql:mysql /var/lib/mysql

# 启动 MariaDB
systemctl start mariadb
```

---

## Java 备份脚本

### 备份工具类

```java
import java.io.*;
import java.nio.file.*;
import java.time.*;
import java.time.format.*;
import java.util.*;

public class MariaBackupUtil {
    
    private static final String BACKUP_USER = "backup";
    private static final String BACKUP_PASS = "backup_pass";
    private static final String BACKUP_DIR = "/backup";
    private static final String FULL_BACKUP_DIR = BACKUP_DIR + "/full";
    
    private ProcessBuilder pb;
    
    public MariaBackupUtil() {
        pb = new ProcessBuilder();
        pb.redirectErrorStream(true);
    }
    
    // 执行全量备份
    public boolean fullBackup() throws IOException, InterruptedException {
        LocalDateTime now = LocalDateTime.now();
        String backupPath = FULL_BACKUP_DIR + "_" + 
            now.format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss"));
        
        // 创建备份目录
        new File(backupPath).mkdirs();
        
        // 构建命令
        List<String> cmd = Arrays.asList(
            "mariabackup",
            "--backup",
            "--target-dir=" + backupPath,
            "--user=" + BACKUP_USER,
            "--password=" + BACKUP_PASS
        );
        
        return executeCommand(cmd);
    }
    
    // 执行增量备份
    public boolean incrementalBackup(String baseDir, String incDir) 
            throws IOException, InterruptedException {
        new File(incDir).mkdirs();
        
        List<String> cmd = Arrays.asList(
            "mariabackup",
            "--backup",
            "--target-dir=" + incDir,
            "--incremental-basedir=" + baseDir,
            "--user=" + BACKUP_USER,
            "--password=" + BACKUP_PASS
        );
        
        return executeCommand(cmd);
    }
    
    // 准备备份
    public boolean prepareBackup(String backupDir, String... incrementalDirs) 
            throws IOException, InterruptedException {
        // 准备全量
        List<String> cmd = new ArrayList<>(Arrays.asList(
            "mariabackup",
            "--prepare",
            "--target-dir=" + backupDir
        ));
        
        if (!executeCommand(cmd)) {
            return false;
        }
        
        // 依次准备增量
        for (String incDir : incrementalDirs) {
            cmd = new ArrayList<>(Arrays.asList(
                "mariabackup",
                "--prepare",
                "--target-dir=" + backupDir,
                "--incremental-dir=" + incDir
            ));
            if (!executeCommand(cmd)) {
                return false;
            }
        }
        
        return true;
    }
    
    // 恢复备份
    public boolean restoreBackup(String backupDir) 
            throws IOException, InterruptedException {
        // 停止 MariaDB
        executeCommand(Arrays.asList("systemctl", "stop", "mariadb"));
        
        // 备份当前数据
        Path currentData = Paths.get("/var/lib/mysql");
        if (Files.exists(currentData)) {
            Path backupData = Paths.get("/var/lib/mysql.bak_" + 
                LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmmss")));
            Files.move(currentData, backupData);
        }
        
        // 创建数据目录
        Files.createDirectories(currentData);
        
        // 恢复
        List<String> cmd = Arrays.asList(
            "mariabackup",
            "--move-back",
            "--target-dir=" + backupDir
        );
        
        boolean result = executeCommand(cmd);
        
        // 设置权限
        executeCommand(Arrays.asList("chown", "-R", "mysql:mysql", "/var/lib/mysql"));
        
        // 启动 MariaDB
        executeCommand(Arrays.asList("systemctl", "start", "mariadb"));
        
        return result;
    }
    
    private boolean executeCommand(List<String> cmd) throws IOException, InterruptedException {
        pb.command(cmd);
        Process process = pb.start();
        
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println(line);
            }
        }
        
        int exitCode = process.waitFor();
        return exitCode == 0;
    }
}
```

### 备份调度

```java
import java.util.concurrent.*;

public class BackupScheduler {
    
    private final MariaBackupUtil backupUtil;
    private final ScheduledExecutorService scheduler;
    
    public BackupScheduler() {
        this.backupUtil = new MariaBackupUtil();
        this.scheduler = Executors.newScheduledThreadPool(1);
    }
    
    // 每日全量备份（凌晨 2 点）
    public void scheduleDailyFullBackup() {
        Runnable task = () -> {
            try {
                System.out.println("开始全量备份...");
                boolean success = backupUtil.fullBackup();
                if (success) {
                    System.out.println("全量备份成功");
                } else {
                    System.out.println("全量备份失败");
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        };
        
        // 每天凌晨 2 点执行
        scheduler.scheduleAtFixedRate(task, 2, 24, TimeUnit.HOURS);
    }
    
    // 每小时增量备份
    public void scheduleHourlyIncrementalBackup() {
        String lastBackupDir = "/backup/full";  // 需要持久化保存
        
        Runnable task = () -> {
            try {
                String incDir = "/backup/inc_" + 
                    LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd_HHmm"));
                System.out.println("开始增量备份到: " + incDir);
                boolean success = backupUtil.incrementalBackup(lastBackupDir, incDir);
                if (success) {
                    System.out.println("增量备份成功");
                    lastBackupDir = incDir;
                } else {
                    System.out.println("增量备份失败");
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        };
        
        // 每小时执行
        scheduler.scheduleAtFixedRate(task, 0, 1, TimeUnit.HOURS);
    }
}
```

---

## 备份压缩与加密

### 压缩备份

```bash
# 备份时直接压缩
mariabackup --backup \
    --target-dir=/backup/full_compressed \
    --compress \
    --compress-threads=4 \
    --user=backup \
    --password=backup_pass

# 查看压缩效果
du -sh /backup/full
du -sh /backup/full_compressed
```

### 加密备份

```bash
# 生成加密密钥
openssl rand -base64 32 > /backup/encryption_key

# 备份时加密
mariabackup --backup \
    --target-dir=/backup/full_encrypted \
    --encrypt=AES256 \
    --encrypt-key-file=/backup/encryption_key \
    --user=backup \
    --password=backup_pass

# 恢复时解密
mariabackup --decompress \
    --target-dir=/backup/full_encrypted

mariabackup --prepare \
    --target-dir=/backup/full_encrypted

mariabackup --move-back \
    --target-dir=/backup/full_encrypted
```

### 备份保留策略

```bash
# 保留最近 7 天全量备份
find /backup -name "full_*" -type d -mtime +7 -exec rm -rf {} \;

# 保留最近 3 天增量备份
find /backup -name "inc_*" -type d -mtime +3 -exec rm -rf {} \;

# 压缩并打包旧备份
find /backup -name "full_*" -type d -mtime +1 -exec tar -czvf {}.tar.gz {} \;
```

---

## Galera 集群备份

### Galera 节点备份

```bash
# Galera 备份时最好选择 Donor 节点
# 或者使用 SST 用户备份

# 备份（Galera 节点会自动暂停 DDL）
mariabackup --backup \
    --target-dir=/backup/galera_node \
    --user=backup \
    --password=backup_pass

# 或者使用 wsrep_desync 暂停复制
mysql -e "SET GLOBAL wsrep_desync=ON"
# 执行备份
mariabackup --backup \
    --target-dir=/backup/galera_node \
    --user=backup \
    --password=backup_pass
mysql -e "SET GLOBAL wsrep_desync=OFF"
```

---

## 验证备份

### 恢复后验证

```sql
-- 检查数据库完整性
CHECK TABLE users EXTENDED;

-- 检查复制状态
SHOW SLAVE STATUS\G

-- 检查数据一致性
SELECT COUNT(*) FROM users;
SELECT MAX(updated_at) FROM users;

-- 抽样验证
SELECT * FROM users ORDER BY RAND() LIMIT 100;
```

---

## 常见问题与解决

### 问题一：备份失败

```bash
# 错误：xtrabackup failed
# 原因：权限不足、磁盘空间不足、数据库正在执行 DDL

# 解决：
# 1. 检查权限
ls -la /var/lib/mysql
chown -R mysql:mysql /var/lib/mysql

# 2. 检查磁盘空间
df -h

# 3. 如果是 DDL 问题，重试
```

### 问题二：恢复后启动失败

```bash
# 错误：InnoDB 初始化失败
# 解决：
# 1. 检查数据目录权限
chown -R mysql:mysql /var/lib/mysql

# 2. 检查配置文件
cat /etc/mysql/mariadb.conf.d/50-server.cnf

# 3. 查看错误日志
tail -100 /var/log/mysql/error.log
```

### 问题三：备份太大

```bash
# 解决方案：
# 1. 使用压缩
mariabackup --backup --compress --compress-threads=4 ...

# 2. 使用增量备份
mariabackup --backup --incremental-basedir=...

# 3. 排除不需要备份的数据库
mariabackup --backup --exclude-databases="logs,cache" ...
```

---

## 面试追问

### 追问一：mysqldump 和 XtraBackup 的区别？

| 维度 | mysqldump | XtraBackup |
|------|-----------|------------|
| 备份类型 | 逻辑备份 | 物理备份 |
| 备份速度 | 慢 | 快 |
| 恢复速度 | 慢 | 快 |
| 增量备份 | 不支持 | 支持 |
| 锁表 | 需要（可避免） | 无锁 |
| 备份大小 | 小（逻辑） | 大（物理） |
| 适用场景 | 小数据量 | 大数据量 |

### 追问二：如何选择备份策略？

| 数据量 | 推荐策略 |
|--------|----------|
| < 10GB | 每日全量 mysqldump |
| 10GB - 100GB | 每日全量 + 每小时增量 |
| 100GB - 1TB | 每日全量 XtraBackup + 每小时增量 |
| > 1TB | 增量备份 + Galera SST |

### 追问三：如何验证备份有效性？

1. **定期恢复测试**：在测试环境恢复备份
2. **校验和验证**：使用 md5sum 校验备份文件
3. **数据库检查**：`CHECK TABLE` 验证数据完整性
4. **应用层验证**：执行关键查询验证数据

---

## 总结

| 要点 | 说明 |
|------|------|
| **备份工具** | Mariabackup / XtraBackup（物理备份） |
| **备份类型** | 全量备份、增量备份 |
| **备份流程** | 备份 → 准备 → 恢复 |
| **增量原理** | 基于 LSN（Log Sequence Number） |
| **压缩加密** | --compress, --encrypt 支持 |
| **恢复验证** | CHECK TABLE，定期演练 |

**备份是数据库运维最重要的日常工作。再完善的架构也可能出问题，备份是你最后的防线。**

---

## 下一步

- 想了解更多高可用知识？[MariaDB Galera Cluster 节点加入与故障恢复](/database/mariadb/galera-node)
- 想系统复习？[MariaDB 面试高频问题汇总](/database/mariadb/interview-summary)
- 想了解其他数据库？[MySQL 面试高频问题汇总](/database/mysql/interview-summary)
