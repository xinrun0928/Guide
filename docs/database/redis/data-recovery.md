# 数据恢复流程与优先顺序

Redis 宕机了，数据还在内存里吗？

不，内存数据全丢了。

现在的问题是：**怎么从持久化文件里恢复数据？**

## Redis 的数据恢复流程

### 启动顺序

Redis 启动时会按这个顺序加载数据：

```
┌─────────────────────────────────────────────────────────────────┐
│                        Redis 启动                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Step 1: 检查 AOF                             │
│                                                                 │
│   appendonly yes ?                                              │
│   │                                                              │
│   ├─ YES → 存在 appendonly.aof ?                               │
│   │         ├─ YES → 加载 AOF 文件                              │
│   │         │          ├─ 成功 → 完成 ✓                         │
│   │         │          └─ 失败 → 尝试修复 or 报错                 │
│   │         │                                                     │
│   │         └─ NO → 检查 RDB                                      │
│   │                    ├─ YES → 加载 RDB 文件                     │
│   │                    └─ NO → 空实例 ✓                           │
│   │                                                                     │
│   └─ NO → 检查 RDB                                                │
│             ├─ YES → 加载 RDB 文件                                │
│             └─ NO → 空实例 ✓                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 加载优先级

Redis 加载数据的优先级：

```
┌─────────────────────────────────────────────────────────────────┐
│                         加载优先级                                │
│                                                                 │
│   AOF 开启时：                                                   │
│   1. appendonly.aof (优先)                                       │
│   2. dump.rdb (如果 AOF 不存在或损坏)                            │
│                                                                 │
│   AOF 关闭时：                                                   │
│   1. dump.rdb                                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**为什么 AOF 优先？**

因为 AOF 的数据更实时。AOF 记录了最新写入的命令，而 RDB 只是某个时刻的快照。

## 各种场景下的数据恢复

### 场景一：正常关机

```bash
# 执行 SHUTDOWN
redis-cli SHUTDOWN
```

**恢复流程**：
1. Redis 执行 SAVE（阻塞式快照）
2. 生成 dump.rdb
3. 关闭前会等待 AOF 刷盘完成（如果开启）

**数据丢失**：无

### 场景二：宕机（未开启持久化）

```bash
# redis.conf
save ""              # 关闭 RDB
appendonly no        # 关闭 AOF
```

**后果**：
- 无持久化文件
- 内存数据全部丢失
- Redis 重启后是空实例

**建议**：生产环境必须开启持久化！

### 场景三：宕机（仅 RDB）

```bash
# redis.conf
save 60 1000
appendonly no
```

**恢复流程**：
1. 检查 appendonly.aof → 不存在
2. 加载 dump.rdb
3. 恢复所有快照数据

**数据丢失**：上次快照到宕机之间的数据

### 场景四：宕机（仅 AOF）

```bash
# redis.conf
save ""
appendonly yes
appendfsync everysec
```

**恢复流程**：
1. 检查 appendonly.aof → 存在
2. 加载 appendonly.aof
3. 重放所有写命令
4. 恢复数据

**数据丢失**：最多丢失 1 秒数据（everysec 策略）

### 场景五：宕机（RDB + AOF 混合）

```bash
# redis.conf
save 300 10
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes   # 开启混合持久化
```

**恢复流程**：
1. 检查 appendonly.aof → 存在
2. 检测到是混合格式（RDB 头 + AOF）
3. 加载 RDB 部分（快速）
4. 追加 AOF 部分（增量重放）
5. 恢复完整数据

**数据丢失**：最多丢失 1 秒数据

### 场景六：AOF 文件损坏

```bash
# AOF 文件损坏
aof_load_truncated yes  # 默认
```

**恢复流程**：
1. 尝试加载 AOF
2. 发现损坏，跳过错误行
3. 尽可能恢复可用数据

**后果**：
- 部分数据可能丢失
- 需要人工修复

### 场景七：Redis 升级（数据迁移）

```bash
# 旧版本 Redis 生成的数据
# 迁移到新版本 Redis
```

Redis 版本间通常向下兼容，可以直接迁移 RDB/AOF 文件。

## 数据恢复命令详解

### SAVE 和 BGSAVE

```bash
# 阻塞式保存（不推荐）
redis-cli SAVE

# 非阻塞式保存（推荐）
redis-cli BGSAVE
```

### BGREWRITEAOF

```bash
# 手动触发 AOF 重写
redis-cli BGREWRITEAOF
```

### LASTSAVE

```bash
# 查看上次成功保存的时间戳
redis-cli LASTSAVE
# 返回：1700000000

# 转换为可读时间
date -d @1700000000
# 返回：2023-11-15 10:00:00
```

## 数据恢复的 Java 实现

```java
import redis.clients.jedis.Jedis;
import java.io.File;
import java.io.IOException;

public class RedisRecoveryDemo {
    
    /**
     * 监控 Redis 持久化状态
     */
    public void monitorPersistence() {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            String info = jedis.info("persistence");
            System.out.println("=== 持久化状态 ===");
            System.out.println(info);
        }
    }
    
    /**
     * 检查数据完整性
     */
    public boolean checkRDBIntegrity(String rdbPath) {
        File rdbFile = new File(rdbPath);
        if (!rdbFile.exists()) {
            System.out.println("RDB 文件不存在");
            return false;
        }
        
        // Redis 自带检查工具
        // redis-cli --rdb dump.rdb --loglevel verbose
        ProcessBuilder pb = new ProcessBuilder(
            "redis-cli", "--rdb", rdbPath, "--loglevel", "verbose"
        );
        try {
            Process process = pb.start();
            int exitCode = process.waitFor();
            return exitCode == 0;
        } catch (IOException | InterruptedException e) {
            e.printStackTrace();
            return false;
        }
    }
    
    /**
     * 检查 AOF 完整性
     */
    public boolean checkAOFIntegrity(String aofPath) {
        File aofFile = new File(aofPath);
        if (!aofFile.exists()) {
            System.out.println("AOF 文件不存在");
            return false;
        }
        
        // Redis 自带检查工具
        // redis-check-aof --fix appendonly.aof
        ProcessBuilder pb = new ProcessBuilder(
            "redis-cli", "--aof", aofPath
        );
        try {
            Process process = pb.start();
            int exitCode = process.waitFor();
            return exitCode == 0;
        } catch (IOException | InterruptedException e) {
            e.printStackTrace();
            return false;
        }
    }
    
    /**
     * 手动触发持久化
     */
    public void triggerSave() {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            // 记录当前时间
            long before = System.currentTimeMillis();
            
            // 非阻塞保存
            jedis.bgSave();
            
            // 轮询检查是否完成
            while (true) {
                String lastSave = jedis.info("persistence");
                // 解析 last_save_time
                if (/* 检查 last_save_time 已更新 */) {
                    System.out.println("SAVE 完成");
                    break;
                }
                try {
                    Thread.sleep(100);
                } catch (InterruptedException e) {
                    e.printStackTrace();
                }
            }
        }
    }
}
```

## 故障恢复最佳实践

### 1. 定期备份

```bash
#!/bin/bash
# 每天凌晨备份 Redis 数据

BACKUP_DIR="/backup/redis"
DATE=$(date +%Y%m%d)

# 创建备份目录
mkdir -p $BACKUP_DIR

# 复制 RDB 文件
cp /var/lib/redis/dump.rdb $BACKUP_DIR/dump-$DATE.rdb

# 复制 AOF 文件
cp /var/lib/redis/appendonly.aof $BACKUP_DIR/appendonly-$DATE.aof

# 保留最近 7 天的备份
find $BACKUP_DIR -name "*.rdb" -mtime +7 -delete
find $BACKUP_DIR -name "*.aof" -mtime +7 -delete
```

### 2. 监控持久化状态

```bash
# 使用 Redis INFO 监控
redis-cli INFO persistence | grep -E "rdb_last_bgsave|aof_last_write"

# 使用 Redis Sentinel 自动故障转移
# 主节点宕机后，从节点自动提升为主节点
```

### 3. 数据恢复步骤

当需要恢复数据时，按以下步骤操作：

```bash
# Step 1: 停止 Redis
redis-cli SHUTDOWN

# Step 2: 备份当前数据文件
mv /var/lib/redis/dump.rdb /var/lib/redis/dump.rdb.bak
mv /var/lib/redis/appendonly.aof /var/lib/redis/appendonly.aof.bak

# Step 3: 恢复备份文件
cp /backup/redis/dump-20240115.rdb /var/lib/redis/dump.rdb
cp /backup/redis/appendonly-20240115.aof /var/lib/redis/appendonly.aof

# Step 4: 启动 Redis
redis-server /etc/redis/redis.conf

# Step 5: 验证数据
redis-cli KEYS "*"
redis-cli INFO persistence
```

### 4. AOF 损坏的修复

```bash
# Step 1: 备份损坏的文件
cp /var/lib/redis/appendonly.aof /var/lib/redis/appendonly.aof.bak

# Step 2: 尝试修复
redis-check-aof --fix /var/lib/redis/appendonly.aof

# Step 3: 检查修复结果
redis-check-aof /var/lib/redis/appendonly.aof

# Step 4: 启动 Redis
redis-server /etc/redis/redis.conf
```

## 常见问题与解决

### Q1：Redis 启动失败，日志显示 "Aborting loading ..."

**原因**：AOF 文件损坏，无法解析。

**解决**：
```bash
redis-check-aof --fix appendonly.aof
# 或者关闭 AOF，用 RDB 恢复
```

### Q2：RDB 和 AOF 都有，用哪个恢复？

**答案**：优先用 AOF（数据更完整）。如果 AOF 损坏或不存在，用 RDB。

### Q3：如何减少数据丢失？

**方案**：
1. 开启混合持久化
2. 使用 AOF always 策略
3. 配置主从复制
4. 定期人工触发 SAVE

### Q4：从节点需要持久化吗？

**答案**：建议开启。从节点开启持久化后，即使主从全部宕机，也能从从节点的持久化文件恢复数据。

## 总结

Redis 数据恢复的核心要点：

| 场景 | 恢复方式 | 数据丢失 |
|-----|---------|---------|
| 正常关机 | 自动保存 | 无 |
| 仅 RDB | 加载 dump.rdb | 取决于快照间隔 |
| 仅 AOF | 重放 appendonly.aof | 最多 1 秒 |
| 混合持久化 | 加载混合文件 | 最多 1 秒 |
| AOF 损坏 | 修复 or RDB | 部分数据 |

## 留给你的问题

假设你的 Redis 开启了主从复制，主节点宕机了，从节点会自动切换为主节点。

**问题来了：原来的主节点恢复后，它会重新成为主节点吗？还是需要人工介入？**

提示：考虑 Sentinel 和 Cluster 的不同行为。
