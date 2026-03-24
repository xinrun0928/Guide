# AOF 重写机制与 Rewrite

你的 AOF 文件已经有 10GB 了。

里面记录了 1000 万次操作，但有效数据可能只有 100MB。

怎么办？

**AOF 重写**来救场。

## 为什么要 AOF 重写？

### AOF 文件膨胀的原因

```
初始状态：
SET name "张三"          → 有效数据
SET age 25              → 有效数据

多次覆盖后：
SET age 26              → 有效数据
SET age 27              → 有效数据
SET age 28              → 有效数据
SET age 29              → 有效数据
...（1000 次覆盖）
```

最终文件中：
- **历史 SET age 命令**：无用，但占空间
- **最终 SET age 命令**：有效

AOF 重写就是**只保留最终状态**，生成最小的命令序列。

### 重写前后的对比

```bash
# 重写前（假设有 10000 条 age 赋值命令）
文件大小：50MB

# 重写后（只保留最终状态）
SET name "张三"
SET age 25
SET city "北京"
文件大小：100KB
```

## AOF 重写的触发条件

### 自动触发

```bash
# redis.conf

# 文件增长百分比达到 100% 时触发重写
auto-aof-rewrite-percentage 100

# 文件至少达到 64MB 才触发重写（避免频繁重写小文件）
auto-aof-rewrite-min-size 64mb
```

触发时机：

```
上次重写文件大小 = 100MB
当前文件大小 = 200MB（增长 100%）
触发重写！
```

### 手动触发

```bash
redis-cli BGREWRITEAOF
```

## AOF 重写的原理

### COW（Copy-On-Write）机制

和 RDB 类似，AOF 重写也是通过 **fork 子进程** 实现的：

```
┌─────────────────────────────────────────────────────────────────┐
│                         主进程                                   │
│                                                                 │
│   数据区域 ──→ [Key1=张三][Key2=25][Key3=北京][Key4...]        │
│               ↑                                                 │
│               └── 共享内存页                                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ fork()
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       子进程（AOF 重写进程）                      │
│                                                                 │
│   遍历内存数据，生成最小命令序列                                  │
│   写入临时文件：temp-rewriteaof-bg-{pid}.aof                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 重写期间的增量处理

问题来了：子进程重写期间，主进程还在接收新命令，这些命令也会改变数据。

如果不处理，重写后的 AOF 会丢失重写期间的数据。

**解决方案：AOF 重写缓冲区**

```
┌─────────────────────────────────────────────────────────────────┐
│                    AOF 重写缓冲区                                │
│                                                                 │
│   [主进程新写入的命令...]                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 重写完成
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      合并写入                                    │
│                                                                 │
│   临时文件 + AOF 重写缓冲区 → appendonly.aof                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 重写流程详解

```java
/**
 * AOF 重写完整流程：
 * 
 * 1. 主进程 fork 子进程（COW 机制）
 * 2. 子进程遍历内存，生成最小命令序列
 *    - 对每个 key，只记录最终状态
 *    - 写入临时文件
 * 3. 主进程创建 AOF 重写缓冲区
 *    - 接收新的写命令
 * 4. 子进程完成重写，通知主进程
 * 5. 主进程：
 *    - 将 AOF 重写缓冲区的内容追加到临时文件
 *    - 原子性地用临时文件替换原 AOF 文件
 * 6. 重写完成
 */
```

## AOF 重写的优化

### Redis 4.0：混合持久化

Redis 4.0 引入了 **AOF+RDB 混合持久化**：

```bash
aof-use-rdb-preamble yes
```

混合模式下，重写后的 AOF 文件：

```
┌─────────────────────────────────────────────────────────────────┐
│                       混合 AOF 文件                              │
│                                                                 │
│   [RDB 二进制格式]  │  [AOF 文本格式]                           │
│   (重写时的数据快照)  │  (重写期间的增量命令)                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**优势**：
1. **恢复更快**：先用 RDB 快速加载数据
2. **文件更小**：利用 RDB 二进制紧凑的特点

### Redis 7.0：Multi-Part AOF

Redis 7.0 进一步优化，引入了 **Multi-Part AOF**：

```
appendonly/
├── appendonly.aof.1.incr.aof    # 增量 AOF 文件
├── appendonly.aof.1.base.aof    # 基础 AOF 文件（RDB 格式）
└── appendonly.aof.manifest      # 清单文件
```

- **base**：基础文件，包含历史数据快照
- **incr**：增量文件，包含后续增量命令
- **manifest**：管理多个文件

## AOF 重写的配置调优

```bash
# redis.conf

# 自动重写配置
auto-aof-rewrite-percentage 100   # 增长百分比
auto-aof-rewrite-min-size 64mb   # 最小文件大小

# 是否在重写失败时停止写入
aof-rewrite-incremental-fsync yes  # yes: 边重写边刷盘，防止缓冲过大

# 混合持久化（Redis 4.0+）
aof-use-rdb-preamble yes
```

### 配置建议

| 场景 | 配置建议 |
|-----|---------|
| 数据量大 | 调大 `auto-aof-rewrite-min-size`（如 512mb），减少重写频率 |
| 数据变化频繁 | 调大百分比（如 200%），避免频繁重写 |
| 追求数据安全 | 降低触发阈值（如 50%），更频繁重写 |

## 监控 AOF 重写

### INFO 命令

```bash
redis-cli INFO persistence | grep aof
```

输出：

```
aof_enabled:1
aof_current_size:1073741824           # 当前 AOF 文件大小
aof_base_size:536870912                # 上次重写后的文件大小
aof_pending_rewrite:0                  # 是否有重写任务待执行
aof_current_rewrite_rate_limit_bytes:0  # 当前重写速率限制
aof_last_write_status:ok               # 上次写入状态
aof_last_write_buf_sizes:0,0           # 写缓冲大小
```

### 日志监控

Redis 日志会打印重写信息：

```
* Background AOF rewrite started, pid 12345
* Background AOF rewrite terminated with success
* Background AOF rewrite scheduled
```

## AOF 重写的问题与解决

### 问题 1：重写期间的内存压力

**现象**：重写期间 Redis 内存暴涨。

**原因**：COW 机制 + AOF 重写缓冲区 + 子进程本身。

**解决**：
```bash
# 确保机器有足够的可用内存
# 预留 50% 的内存余量
```

### 问题 2：重写失败

**现象**：Redis 日志显示重写失败。

**原因**：
- 磁盘空间不足
- AOF 文件损坏
- 权限问题

**解决**：
```bash
# 检查磁盘空间
df -h

# 检查 Redis 日志
tail -f /var/log/redis/redis.log
```

### 问题 3：重写频繁触发

**现象**：AOF 文件持续增长，重写不生效。

**原因**：
- 写入量太大
- 阈值设置不当

**解决**：
```bash
# 调大触发阈值
auto-aof-rewrite-percentage 200
auto-aof-rewrite-min-size 256mb
```

## Java 客户端操作

```java
import redis.clients.jedis.Jedis;

public class RedisAofRewriteDemo {
    public static void main(String[] args) {
        try (Jedis jedis = new Jedis("localhost", 6379)) {
            
            // 手动触发 AOF 重写
            String rewriteResult = jedis.bgrewriteaof();
            System.out.println("重写任务: " + rewriteResult);
            
            // 检查重写状态
            String pending = jedis.info("persistence").split("\r?\n")
                .stream()
                .filter(line -> line.startsWith("aof_pending_rewrite"))
                .findFirst()
                .orElse("");
            System.out.println("重写状态: " + pending);
            
            // 配置查询
            String minSize = jedis.configGet("auto-aof-rewrite-min-size").get(1);
            String percent = jedis.configGet("auto-aof-rewrite-percentage").get(1);
            System.out.println("最小文件大小: " + minSize);
            System.out.println("增长百分比: " + percent);
        }
    }
}
```

## AOF 重写与 RDB 的对比

| 维度 | AOF 重写 | RDB 快照 |
|-----|---------|---------|
| 触发方式 | 自动 + 手动 | 自动 + 手动 |
| 原理 | 遍历内存生成最小命令 | fork + COW 拍快照 |
| 阻塞 | 非阻塞（子进程） | 非阻塞（子进程） |
| 产物 | 紧凑的 AOF 文件 | dump.rdb 文件 |
| 频率 | 取决于文件增长 | 取决于写操作数量 |

## 总结

AOF 重写是解决 AOF 文件膨胀的关键机制：

- **目的**：压缩冗余命令，减小文件体积
- **原理**：fork 子进程 + COW + AOF 重写缓冲区
- **触发**：自动（根据配置）或手动
- **优化**：Redis 4.0 混合持久化，7.0 多部分 AOF

## 留给你的问题

AOF 重写缓冲区是存在哪里的？为什么需要这个缓冲区？

提示：考虑 fork 前后的数据一致性问题。
