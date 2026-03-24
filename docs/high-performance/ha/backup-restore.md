# 数据备份与恢复：全量备份、增量备份、RTO 与 RPO

你一定见过这样的新闻：某公司数据库被删除，所有数据丢失，业务完全中断。

这种灾难本可以避免——只需要做好备份。

但备份不是简单的「复制数据」，而是一整套策略：什么时候备份？备份到哪里？如何恢复？恢复需要多长时间？

今天我们就来聊聊数据备份与恢复的实践。

## 备份的基本概念

### RPO 与 RTO

评估备份策略的两个核心指标：

- **RPO（Recovery Point Objective）**：恢复点目标，允许丢失多长时间的数据
- **RTO（Recovery Time Objective）**：恢复时间目标，系统中断后多久能恢复

```
备份时间线：
T1 ───── T2 ───── T3 ───── T4 ───── T5 ───── 现在
  │        │        │        │        │
  ▼        ▼        ▼        ▼        ▼
 备份1   备份2    备份3    备份4    备份5

如果 T5 时发生故障：
- 最多丢失 T4 到 T5 之间的数据（RPO）
- 恢复需要的时间（RTO）
```

| 业务场景 | RPO | RTO |
|---------|-----|-----|
| 核心交易系统 | 接近 0 | 分钟级 |
| 电商订单 | 15 分钟 | 小时级 |
| 日志分析 | 小时级 | 小时级 |
| 归档数据 | 天级 | 天级 |

### 备份类型

| 类型 | 说明 | 优点 | 缺点 |
|------|------|------|------|
| 全量备份 | 备份所有数据 | 恢复简单 | 备份时间长，占用空间大 |
| 增量备份 | 备份自上次备份以来的变化 | 备份快，空间小 | 恢复复杂，需要多个备份 |
| 差异备份 | 备份自上次全量备份以来的变化 | 平衡方案 | 比增量备份占用更多空间 |

```
备份示意：
全量备份 ─────▶ 增量备份 ─────▶ 增量备份 ─────▶ 增量备份
   │              │              │              │
   ▼              ▼              ▼              ▼
  所有数据      变化部分       变化部分       变化部分

恢复时：
1. 应用全量备份
2. 依次应用增量备份

对比：
- 增量备份：备份快，恢复慢（需要多个备份文件）
- 差异备份：备份慢，恢复快（只需要全量 + 差异）
```

## MySQL 备份

### 1. mysqldump 全量备份

```bash
# 全量备份
mysqldump -h localhost -u root -p \
    --single-transaction \    # 使用事务保证一致性
    --master-data=2 \         # 记录备份时的 binlog 位置
    --all-databases \         # 备份所有数据库
    --routines \              # 备份存储过程
    --triggers \              # 备份触发器
    --events \                # 备份事件
    > backup_full_$(date +%Y%m%d).sql

# 压缩备份
mysqldump -h localhost -u root -p \
    --single-transaction \
    --all-databases | gzip > backup_full_$(date +%Y%m%d).sql.gz
```

### 2. xtrabackup 备份

XtraBackup 是 Percona 开发的开源备份工具，支持在线热备份，性能优于 mysqldump。

```bash
# 全量备份
xtrabackup --backup \
    --target-dir=/backup/full_$(date +%Y%m%d) \
    --user=root \
    --password=xxx

# 增量备份
xtrabackup --backup \
    --target-dir=/backup/incr_$(date +%Y%m%d) \
    --incremental-basedir=/backup/full_20240101 \
    --user=root \
    --password=xxx

# 备份并压缩
xtrabackup --backup \
    --target-dir=/backup/full_$(date +%Y%m%d) \
    --compress \
    --user=root \
    --password=xxx
```

### 3. Java 实现备份脚本

```java
@Service
public class MySQLBackupService {

    private static final String BACKUP_DIR = "/data/backup/mysql";
    private static final String MYSQL_HOST = "localhost";
    private static final String MYSQL_USER = "root";
    private static final String MYSQL_PASSWORD = "xxx";

    /**
     * 执行全量备份
     */
    public BackupResult fullBackup() {
        String backupFile = BACKUP_DIR + "/full_" + LocalDate.now() + ".sql";
        String command = String.format(
            "mysqldump -h %s -u %s -p%s --single-transaction " +
            "--master-data=2 --all-databases > %s",
            MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, backupFile
        );

        return executeBackup(backupFile, command);
    }

    /**
     * 执行增量备份（基于 binlog）
     */
    public BackupResult incrementalBackup(String fromPosition) {
        String backupFile = BACKUP_DIR + "/incr_" + LocalDateTime.now() + ".log";
        String command = String.format(
            "mysqlbinlog --start-position=%s " +
            "--raw --to-be-logs --result-file=%s mysql-bin.???",
            fromPosition, backupFile
        );

        return executeBackup(backupFile, command);
    }

    private BackupResult executeBackup(String file, String command) {
        long start = System.currentTimeMillis();

        try {
            Process process = Runtime.getRuntime().exec(
                new String[]{"bash", "-c", command}
            );

            int exitCode = process.waitFor();
            long duration = System.currentTimeMillis() - start;

            if (exitCode == 0) {
                // 压缩
                compressFile(file);

                return BackupResult.builder()
                    .success(true)
                    .file(file + ".gz")
                    .startTime(start)
                    .duration(duration)
                    .build();
            } else {
                return BackupResult.builder()
                    .success(false)
                    .errorMessage(readError(process.getErrorStream()))
                    .build();
            }
        } catch (Exception e) {
            return BackupResult.builder()
                .success(false)
                .errorMessage(e.getMessage())
                .build();
        }
    }

    private void compressFile(String file) {
        // 使用 GZIP 压缩
    }
}
```

### 4. 备份策略配置

```java
@Configuration
public class BackupConfiguration {

    @Scheduled(cron = "0 2 * * * ?")  // 每天凌晨 2 点
    public void dailyFullBackup() {
        backupService.fullBackup();
    }

    @Scheduled(cron = "0 */4 * * * ?")  // 每 4 小时增量备份
    public void incrementalBackup() {
        String lastPosition = getLastBinlogPosition();
        backupService.incrementalBackup(lastPosition);
    }
}
```

## 数据恢复

### 1. 全量恢复

```bash
# 恢复全量备份
mysql -h localhost -u root -p &lt; backup_full_20240101.sql

# 使用 xtrabackup 恢复
xtrabackup --prepare --target-dir=/backup/full_20240101
xtrabackup --copy-back --target-dir=/backup/full_20240101
```

### 2. 基于时间点的恢复（PITR）

```bash
# 1. 恢复全量备份
mysql -h localhost -u root -p &lt; backup_full_20240101.sql

# 2. 应用 binlog 到指定时间点
mysqlbinlog mysql-bin.000001 --stop-datetime="2024-01-01 12:00:00" | mysql

# 或者从指定位置恢复
mysqlbinlog mysql-bin.000001 --start-position=123 --stop-position=456 | mysql
```

### 3. Java 恢复服务

```java
@Service
public class DataRecoveryService {

    @Autowired
    private BackupService backupService;
    @Autowired
    private MySQLService mysqlService;

    /**
     * 恢复到指定时间点
     */
    public RecoveryResult recoverToPointInTime(LocalDateTime targetTime) {
        log.info("开始恢复到时间点: {}", targetTime);

        // 1. 找到最近的完整备份
        BackupFile fullBackup = backupService.findNearestFullBackup(targetTime);
        if (fullBackup == null) {
            return RecoveryResult.failed("没有可用的备份");
        }

        // 2. 恢复全量备份
        log.info("恢复全量备份: {}", fullBackup.getFile());
        mysqlService.restore(fullBackup.getFile());

        // 3. 应用增量备份
        List&lt;BackupFile&gt; incrementalBackups =
            backupService.findIncrementalBackupsAfter(fullBackup.getTime(), targetTime);

        for (BackupFile incr : incrementalBackups) {
            log.info("应用增量备份: {}", incr.getFile());
            mysqlService.applyBinlog(incr.getFile());
        }

        // 4. 恢复到精确时间点
        mysqlService.applyBinlogTo(targetTime);

        return RecoveryResult.builder()
            .success(true)
            .recoveredTo(targetTime)
            .backupUsed(fullBackup)
            .build();
    }

    /**
     * 恢复到指定备份
     */
    public RecoveryResult recoverToBackup(String backupId) {
        BackupFile backup = backupService.getBackup(backupId);
        if (backup == null) {
            return RecoveryResult.failed("备份不存在");
        }

        mysqlService.restore(backup.getFile());

        return RecoveryResult.builder()
            .success(true)
            .recoveredTo(backup.getTime())
            .backupUsed(backup)
            .build();
    }
}
```

## Redis 备份

### 1. RDB 快照备份

```bash
# 手动触发 RDB 备份
redis-cli BGSAVE

# 配置自动备份
# redis.conf
save 900 1      # 900秒内至少1个key变化则保存
save 300 10     # 300秒内至少10个key变化则保存
save 60 10000   # 60秒内至少10000个key变化则保存
```

### 2. AOF 持久化

```bash
# redis.conf 配置
appendonly yes
appendfsync everysec   # 每秒同步，最多丢失1秒数据
# appendfsync always   # 每次写操作同步，最安全但最慢
# appendfsync no       # 操作系统决定，性能最好但可能丢失更多数据
```

### 3. Java 实现 Redis 备份

```java
@Service
public class RedisBackupService {

    @Autowired
    private RedisTemplate&lt;String, Object&gt; redisTemplate;

    /**
     * 触发 RDB 备份
     */
    public boolean triggerRdbBackup() {
        try {
            redisTemplate.execute(new RedisCallback&lt;Object&gt;() {
                @Override
                public Object doInRedis(RedisConnection connection) throws DataAccessException {
                    connection.serverCommands().bgSave();
                    return null;
                }
            });
            return true;
        } catch (Exception e) {
            log.error("Redis RDB 备份失败: {}", e.getMessage());
            return false;
        }
    }

    /**
     * 获取最近的 RDB 文件
     */
    public File getLatestRdbFile() {
        String rdbPath = redisProperties.getDir() + "/dump.rdb";
        File rdbFile = new File(rdbPath);

        if (rdbFile.exists()) {
            // 复制到备份目录
            String backupPath = backupDir + "/redis_" + LocalDate.now() + ".rdb";
            try {
                Files.copy(rdbFile.toPath(), new File(backupPath).toPath());
                return new File(backupPath);
            } catch (IOException e) {
                log.error("Redis RDB 复制失败: {}", e.getMessage());
            }
        }

        return null;
    }

    /**
     * 恢复 Redis 数据
     */
    public void restore(File backupFile) {
        // 1. 停止 Redis
        redisService.stop();

        // 2. 替换 RDB 文件
        String rdbPath = redisProperties.getDir() + "/dump.rdb";
        try {
            Files.copy(backupFile.toPath(), new File(rdbPath).toPath());
        } catch (IOException e) {
            throw new RuntimeException("Redis RDB 文件复制失败", e);
        }

        // 3. 启动 Redis
        redisService.start();
    }
}
```

## 备份存储

### 1. 本地存储

适用于小规模数据，作为第一层备份。

```java
@Configuration
public class LocalBackupStorage {

    private static final String LOCAL_BACKUP_DIR = "/data/backup";

    @Bean
    public File localBackupDir() {
        File dir = new File(LOCAL_BACKUP_DIR);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }
}
```

### 2. 云对象存储

适用于大规模数据，支持跨地域备份。

```java
@Configuration
public class CloudBackupStorage {

    @Autowired
    private CloudStorageConfig config;

    /**
     * 上传到云存储
     */
    public void uploadToCloud(String localFile, String remotePath) {
        OSS ossClient = new OSSClientBuilder().build(
            config.getEndpoint(),
            config.getAccessKeyId(),
            config.getAccessKeySecret()
        );

        ossClient.putObject(config.getBucket(), remotePath, new File(localFile));
        ossClient.shutdown();

        log.info("备份文件已上传到云存储: {}", remotePath);
    }

    /**
     * 从云存储下载
     */
    public File downloadFromCloud(String remotePath) {
        OSS ossClient = new OSSClientBuilder().build(
            config.getEndpoint(),
            config.getAccessKeyId(),
            config.getAccessKeySecret()
        );

        String localFile = LOCAL_BACKUP_DIR + "/" + remotePath;
        ossClient.getObject(
            new GetObjectRequest(config.getBucket(), remotePath),
            new File(localFile)
        );
        ossClient.shutdown();

        return new File(localFile);
    }

    /**
     * 定期清理过期备份
     */
    public void cleanupExpiredBackups() {
        // 删除本地过期备份
        LocalDateTime expireDate = LocalDateTime.now().minusDays(30);
        for (File file : localBackupDir.listFiles()) {
            if (file.lastModified() &lt; expireDate.toInstant(ZoneOffset.UTC).toEpochMilli()) {
                file.delete();
                log.info("删除过期备份: {}", file.getName());
            }
        }

        // 删除云端过期备份
        cleanCloudExpiredBackups();
    }
}
```

### 3. 备份生命周期管理

```java
@Service
public class BackupLifecycleManager {

    @Autowired
    private BackupRepository backupRepository;
    @Autowired
    private CloudStorageService cloudStorage;

    /**
     * 管理备份生命周期
     */
    @Scheduled(cron = "0 0 3 * * ?")  // 每天凌晨 3 点
    public void manageBackupLifecycle() {
        List&lt;BackupRecord&gt; backups = backupRepository.findAll();

        for (BackupRecord backup : backups) {
            // 删除超过 90 天的备份
            if (backup.getCreatedAt().isBefore(LocalDateTime.now().minusDays(90))) {
                deleteBackup(backup);
            }
            // 超过 7 天的备份移到冷存储
            else if (backup.getCreatedAt().isBefore(LocalDateTime.now().minusDays(7))
                     && !backup.isInColdStorage()) {
                moveToColdStorage(backup);
            }
        }
    }

    private void deleteBackup(BackupRecord backup) {
        // 从云存储删除
        cloudStorage.delete(backup.getCloudPath());
        // 从本地删除
        new File(backup.getLocalPath()).delete();
        // 删除记录
        backupRepository.delete(backup);

        log.info("备份已删除: {}", backup.getId());
    }

    private void moveToColdStorage(BackupRecord backup) {
        // 移动到低频访问存储
        cloudStorage.moveToArchive(backup.getCloudPath());
        backup.setInColdStorage(true);
        backupRepository.save(backup);

        log.info("备份已移至冷存储: {}", backup.getId());
    }
}
```

## 备份验证

### 1. 定期验证备份

```java
@Service
public class BackupVerificationService {

    @Autowired
    private BackupRepository backupRepository;
    @Autowired
    private TestEnvironment testEnv;

    /**
     * 定期验证备份完整性
     */
    @Scheduled(cron = "0 0 4 * * ?")  // 每天凌晨 4 点
    public void verifyBackups() {
        List&lt;BackupRecord&gt; recentBackups = backupRepository.findRecentBackups(7);

        for (BackupRecord backup : recentBackups) {
            verifyBackup(backup);
        }
    }

    private void verifyBackup(BackupRecord backup) {
        try {
            // 1. 检查文件是否存在且完整
            if (!isFileValid(backup)) {
                markBackupFailed(backup, "文件不存在或损坏");
                return;
            }

            // 2. 在测试环境恢复备份
            RecoveryResult result = testEnv.restore(backup);
            if (!result.isSuccess()) {
                markBackupFailed(backup, "恢复失败: " + result.getErrorMessage());
                return;
            }

            // 3. 验证数据完整性
            if (!verifyDataIntegrity(result)) {
                markBackupFailed(backup, "数据完整性验证失败");
                return;
            }

            // 4. 标记验证通过
            markBackupVerified(backup);

        } catch (Exception e) {
            log.error("备份验证异常: {}", backup.getId(), e);
            markBackupFailed(backup, e.getMessage());
        }
    }

    private boolean verifyDataIntegrity(RecoveryResult result) {
        // 验证表数量
        int tableCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM information_schema.tables",
            Integer.class
        );
        if (tableCount == 0) {
            return false;
        }

        // 验证关键数据
        Long userCount = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM users",
            Long.class
        );

        return userCount != null && userCount >= 0;
    }
}
```

### 2. 备份监控告警

```java
@Service
public class BackupMonitorService {

    @Autowired
    private AlertManager alertManager;

    @Scheduled(fixedRate = 3600000)  // 每小时检查
    public void checkBackupHealth() {
        // 检查最近备份
        BackupRecord lastBackup = backupRepository.findLastSuccessfulBackup();
        if (lastBackup == null) {
            alertManager.send(createAlert("无有效备份"));
            return;
        }

        // 检查备份是否超时
        Duration sinceLastBackup = Duration.between(
            lastBackup.getCreatedAt(),
            LocalDateTime.now()
        );

        if (sinceLastBackup.toHours() > 25) {
            alertManager.send(createAlert(
                "备份超时: 最后一次备份在 " + sinceLastBackup.toHours() + " 小时前"
            ));
        }

        // 检查备份大小是否异常
        if (lastBackup.getSize() &lt; getExpectedMinSize()) {
            alertManager.send(createAlert(
                "备份大小异常: " + lastBackup.getSize() + " bytes"
            ));
        }
    }
}
```

---

**思考题：**

1. 如果你的数据库每天产生 100GB 数据，你会选择什么样的备份策略？如何平衡 RPO 和备份成本？

2. 备份数据的安全性如何保证？如果备份文件被黑客获取，会有什么风险？如何加密备份数据？

3. 如何验证备份的可用性？仅仅检查文件存在是不够的，还需要验证什么？

4. 假设发生灾难需要恢复数据，你如何在 RTO 和业务中断时间之间平衡？是否有「部分恢复」的策略？
