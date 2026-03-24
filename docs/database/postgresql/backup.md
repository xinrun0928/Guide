# PostgreSQL 备份与恢复：pg_dump、pg_basebackup、PITR

数据是公司的命脉。

备份做好了，数据丢了也能恢复。

今天，我们来聊聊 PostgreSQL 的备份与恢复。

## 备份类型

### 逻辑备份 vs 物理备份

| 类型 | 工具 | 特点 |
|------|------|------|
| 逻辑备份 | pg_dump, pg_dumpall | 导出 SQL，跨版本，跨平台 |
| 物理备份 | pg_basebackup, 文件复制 | 完整副本，快，不可跨版本 |
| 增量备份 | WAL 归档 + PITR | 任意时间点恢复 |

### 备份策略选择

```
小数据量（< 100GB）：
└── 每日逻辑备份 + WAL 归档

中等数据量（100GB - 1TB）：
└── 每日物理备份 + WAL 归档

大数据量（> 1TB）：
└── 每日物理备份 + 增量 WAL 备份 + PITR
```

## 逻辑备份

### pg_dump

```bash
# 备份单个数据库
pg_dump -h localhost -U postgres -d mydb -F c -b -v -f /backup/mydb.dump

# 选项说明：
# -F c: 自定义格式（压缩、灵活）
# -F p: 明文 SQL 格式
# -F t: tar 格式
# -b: 包含大对象
# -v: 详细输出

# 备份多个数据库
pg_dump -U postgres -d mydb --schema-only -f /backup/mydb_schema.dump

# 仅备份数据
pg_dump -U postgres -d mydb --data-only -f /backup/mydb_data.dump
```

### pg_dumpall

```bash
# 备份所有数据库（包括全局对象）
pg_dumpall -U postgres -h localhost -f /backup/all_databases.sql

# 仅备份角色和表空间
pg_dumpall -U postgres --roles-only -f /backup/roles.sql
pg_dumpall -U postgres --tablespaces-only -f /backup/tablespaces.sql
```

### 自定义格式备份

```bash
# 创建压缩的并行备份（需要 pg_dump 9.3+）
pg_dump -U postgres -d mydb -F c -j 4 -f /backup/mydb_custom.dump

# -j: 并行度（加快备份速度）
```

## 逻辑恢复

### pg_restore

```bash
# 恢复自定义格式备份
pg_restore -U postgres -d mydb -v /backup/mydb.dump

# 恢复前先创建数据库
createdb -U postgres -h localhost mydb
pg_restore -U postgres -d mydb /backup/mydb.dump

# 仅恢复特定表
pg_restore -U postgres -d mydb -t users /backup/mydb.dump

# 仅恢复数据（跳过 DDL）
pg_restore -U postgres -d mydb --data-only /backup/mydb.dump

# 恢复前删除重建
pg_restore -U postgres -d mydb --clean --if-exists /backup/mydb.dump
```

### 恢复明文 SQL

```bash
# 恢复 SQL 格式备份
psql -U postgres -d mydb -f /backup/all_databases.sql
```

## 物理备份

### pg_basebackup

```bash
# 基本物理备份
pg_basebackup -h localhost -U postgres -D /backup/base -Ft -Pv -z

# 选项说明：
# -D: 目标目录
# -Ft: tar 格式
# -P: 显示进度
# -v: 详细输出
# -z: gzip 压缩
# -Xs: 包含 WAL（流复制模式）

# 使用复制槽
pg_basebackup -h localhost -U postgres -D /backup/base -Ft -Pv -z -X stream -S my_slot

# 查看备份内容
tar -tzf /backup/base/base.tar.gz
```

### 从备份恢复

```bash
# 1. 停止 PostgreSQL
pg_ctl -D /var/lib/postgresql/15/main stop

# 2. 清理现有数据
rm -rf /var/lib/postgresql/15/main/*

# 3. 解压备份
tar -xzf /backup/base/base.tar.gz -C /var/lib/postgresql/15/main

# 4. 恢复权限
chown -R postgres:postgres /var/lib/postgresql/15/main

# 5. 启动 PostgreSQL
pg_ctl -D /var/lib/postgresql/15/main start
```

## PITR（时间点恢复）

### PITR 原理

```
时间线：
T1 (备份) ─── WAL ─── WAL ─── WAL ─── T2 (故障)
                │               │
                ▼               ▼
            恢复点1          恢复点2

通过重放 WAL，可以恢复到任意时间点
```

### 配置 WAL 归档

```ini
# postgresql.conf

# 启用 WAL 归档
wal_level = replica
archive_mode = on

# 归档命令
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'

# 或使用 rsync
archive_command = 'rsync -a %p postgres@backup-server:/archive/%f'

# 保留足够的 WAL
wal_keep_size = 1GB
```

### 连续备份策略

```bash
#!/bin/bash
# /usr/local/bin/backup.sh

BACKUP_DIR=/backup
DATE=$(date +%Y%m%d)
HOST=localhost
DB=mydb

# 创建备份目录
mkdir -p $BACKUP_DIR/$DATE

# 执行物理备份
pg_basebackup -h $HOST -U postgres -D $BACKUP_DIR/$DATE/base -Ft -Pv -z

# 备份配置
cp /etc/postgresql/15/main/postgresql.conf $BACKUP_DIR/$DATE/
cp /etc/postgresql/15/main/pg_hba.conf $BACKUP_DIR/$DATE/

# 清理旧备份（保留 7 天）
find $BACKUP_DIR -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;

echo "Backup completed: $DATE"
```

### 执行 PITR 恢复

```bash
# 1. 停止 PostgreSQL
pg_ctl -D /var/lib/postgresql/15/main stop

# 2. 清理现有数据
rm -rf /var/lib/postgresql/15/main/*

# 3. 解压备份
tar -xzf /backup/base/base.tar.gz -C /var/lib/postgresql/15/main

# 4. 创建恢复配置文件
cat > /var/lib/postgresql/15/main/postgresql.auto.conf << 'EOF'
restore_command = 'gunzip -c /archive/%f > %p'
recovery_target_time = '2026-03-20 15:00:00'
recovery_target_action = 'promote'
EOF

# 5. 创建恢复信号文件
touch /var/lib/postgresql/15/main/recovery.signal

# 6. 启动 PostgreSQL
pg_ctl -D /var/lib/postgresql/15/main start
```

### PITR 恢复配置

```ini
# postgresql.auto.conf

# 从归档恢复
restore_command = 'gunzip -c /archive/%f > %p'

# 或使用 rsync
# restore_command = 'rsync -a postgres@backup-server:/archive/%f %p'

# 恢复到特定时间点
recovery_target_time = '2026-03-20 15:00:00'

# 恢复到特定 LSN
# recovery_target_lsn = '0/7000068'

# 恢复到特定事务 ID
# recovery_target_xid = '12345'

# 恢复后执行的操作
# recovery_target_action = 'pause'  # 暂停等待确认

# 恢复目标名称（配合 recovery.conf 中的名称）
# recovery_target_name = 'daily-backup'
```

## Barman（企业级备份）

### Barman 简介

Barman 是 PostgreSQL 的企业级备份和恢复工具：

```
┌──────────────┐         ┌──────────────┐
│   Barman     │ ←─────── │  PostgreSQL   │
│  (备份服务器) │  备份     │              │
│              │         │              │
│  支持：       │         │              │
│  - 远程备份   │         │              │
│  - WAL 归档   │         │              │
│  - PITR      │         │              │
│  - 压缩      │         │              │
│  - 加密      │         │              │
└──────────────┘         └──────────────┘
```

### Barman 安装配置

```ini
# /etc/barman.conf

[barman]
barman_home = /var/lib/barman
barman_user = barman
log_file = /var/log/barman/barman.log
compression = gzip
last_backup_maximum_age = 1 DAYS

[postgresql-server]
ssh_command = ssh postgres@192.168.1.10
conninfo = host=192.168.1.10 user=postgres dbname=mydb
backup_options = backup_method=postgres
wal_backup_method = postgres
retention_policy = RECOVERY WINDOW OF 7 DAYS
```

### Barman 命令

```bash
# 手动备份
barman backup postgresql-server

# 列出备份
barman list-backups postgresql-server

# 查看备份详情
barman show-backup postgresql-server latest

# 执行 PITR 恢复
barman recover postgresql-server latest /var/lib/postgresql/15/main

# 恢复到特定时间
barman recover postgresql-server latest /var/lib/postgresql/15/main \
    --target-time "2026-03-20 15:00:00"
```

## 验证备份

### 备份完整性检查

```bash
# 检查备份文件
ls -lh /backup/mydb.dump

# 检查备份格式
pg_restore -l /backup/mydb.dump | head -20

# 测试恢复（不实际写入数据库）
pg_restore -d postgres -l /backup/mydb.dump
```

### 定期恢复演练

```bash
#!/bin/bash
# /usr/local/bin/test-restore.sh

TEST_DB=mydb_test
BACKUP=/backup/mydb.dump

# 创建测试数据库
createdb -U postgres $TEST_DB

# 恢复备份到测试数据库
pg_restore -U postgres -d $TEST_DB --clean $BACKUP

# 检查关键数据
psql -U postgres -d $TEST_DB -c "SELECT COUNT(*) FROM users;"

# 清理测试数据库
dropdb -U postgres $TEST_DB

echo "Restore test completed"
```

### 监控备份

```sql
-- 查看备份历史（使用 pg_backup_history 等工具）
SELECT 
    start_time,
    end_time,
    end_lsn - start_lsn AS wal_used,
    (end_time - start_time) AS duration
FROM backup_history
ORDER BY start_time DESC;
```

## 常见问题

### 问题一：备份失败

```bash
# 检查磁盘空间
df -h /backup

# 检查权限
ls -la /backup

# 查看 PostgreSQL 日志
tail -f /var/log/postgresql/postgresql-15-main.log
```

### 问题二：WAL 归档失败

```sql
-- 检查归档状态
SELECT * FROM pg_stat_archiver;

-- 手动测试归档命令
psql -U postgres -c "SELECT pg_switch_wal();"

-- 检查归档目录
ls -la /archive
```

### 问题三：恢复时间过长

```bash
# 使用并行恢复
pg_restore -U postgres -d mydb -j 4 /backup/mydb.dump

# 或使用自定义格式并解压
gunzip -c /backup/mydb.dump | pg_restore -U postgres -d mydb
```

## 面试高频问题

### Q1: PostgreSQL 有哪些备份方式？

**考察点**：备份类型

**参考答案**：
- 逻辑备份：pg_dump（单库）、pg_dumpall（全实例）
- 物理备份：pg_basebackup、文件系统复制
- 增量备份：WAL 归档
- PITR：结合物理备份 + WAL 重放

### Q2: pg_dump 和 pg_basebackup 的区别？

**考察点**：备份原理

**参考答案**：
- pg_dump：逻辑备份，导出 SQL，可跨版本
- pg_basebackup：物理备份，完整副本，只能同版本
- pg_dump 可以选择性备份
- pg_basebackup 必须备份整个实例

### Q3: PITR 是怎么工作的？

**考察点**：PITR 原理

**参考答案**：
1. 物理备份获取数据文件
2. WAL 归档记录所有变更
3. 恢复时，重放 WAL 到指定时间点
4. 可以恢复到任意时间点

### Q4: 如何验证备份的有效性？

**考察点**：备份验证

**参考答案**：
1. 定期演练恢复
2. 检查备份文件完整性
3. 验证关键数据
4. 监控备份成功/失败

## 总结

PostgreSQL 备份方案：

| 方式 | 工具 | 恢复速度 | 数据量 | 场景 |
|------|------|---------|-------|------|
| 逻辑备份 | pg_dump | 慢 | 任意 | 开发、迁移 |
| 物理备份 | pg_basebackup | 快 | 全量 | 日常备份 |
| WAL 归档 | archive_command | 快 | 增量 | PITR |
| Barman | Barman | 自动 | 全部 | 企业级 |

备份最佳实践：
- 3-2-1 原则：3 份副本，2 种介质，1 份异地
- 定期验证备份
- 自动化备份
- 监控备份状态
