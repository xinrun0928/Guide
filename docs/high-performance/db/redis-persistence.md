# Redis 持久化策略选择：RDB vs AOF vs 混合持久化

你的 Redis 突然宕机了。

没有持久化：1000 万用户数据，全部丢失。运维同学连夜恢复，客户疯狂投诉。

只用了 RDB：最后一次 RDB 是 1 小时前，丢失了 1 小时的数据。业务方：为什么不能更实时？

只用了 AOF：每次写操作都要落盘，性能下降 50%。产品经理：为什么 Redis 变慢了？

**这三种持久化方式，到底该怎么选？**

## 三种持久化方式简介

### RDB：定时快照

RDB（Redis Database）是 Redis 定时生成数据快照的二进制文件。

```
时间轴：
T1 --- T2 --- T3 --- T4 --- T5
|     |     |     |     |
快照  快照  快照  快照  快照
```

**优点**：
- 文件紧凑，适合备份和灾难恢复
- 恢复速度快（加载二进制文件）
- 适合做数据冷备

**缺点**：
- 可能丢失最后一次快照后的数据
- fork() 子进程时可能阻塞 Redis（数据量大时明显）

### AOF：日志追加

AOF（Append Only File）记录每次写操作命令。

```
时间轴：
T1: SET key1 value1
T2: INCR counter
T3: HSET user name "Tom"
T4: DEL key1
```

**优点**：
- 数据安全性更高（可配置 fsync 策略）
- 写入性能比 RDB 高

**缺点**：
- 文件比 RDB 大（存储的是命令，不是数据）
- 恢复速度慢（需要重放所有命令）
- 存在日志重写（rewrite）开销

### 混合持久化：RDB + AOF

Redis 4.0 引入了混合持久化，结合两者的优点：

```
时间轴：
AOF 文件：
[ RDB 格式的二进制数据 ][ AOF 命令日志 ]
```

**优点**：
- 恢复时先加载 RDB 部分（快速）
- 增量部分用 AOF 命令（实时）
- 兼顾性能和数据安全

**缺点**：
- AOF 文件格式不兼容旧版本 Redis
- 配置复杂度增加

## 深入理解：fsync 策略

AOF 的核心配置是 `appendfsync`：

| 策略 | 含义 | 性能 | 数据安全 |
|---|---|---|---|
| `always` | 每个写命令都 fsync | 最慢 | 最安全 |
| `everysec` | 每秒 fsync 一次 | 较快 | 可能丢 1 秒数据 |
| `no` | 由操作系统决定 | 最快 | 最多丢一个写入周期 |

```bash
# 查看当前配置
redis-cli CONFIG GET appendfsync

# 修改配置
redis-cli CONFIG SET appendfsync everysec
```

**建议**：
- 高性能场景：`everysec`
- 数据绝对安全：`always`
- 性能优先：`no`（但不推荐）

## 配置实战

### 方案一：仅 RDB

```bash
# redis.conf
save 900 1       # 900秒内至少1个key变化则触发bgsave
save 300 10      # 300秒内至少10个key变化则触发bgsave
save 60 10000    # 60秒内至少10000个key变化则触发bgsave

stop-writes-on-bgsave-error yes   # bgsave失败时停止写入
rdbcompression yes                # 压缩RDB文件
rdbchecksum yes                   # 开启RDB校验
```

**适用场景**：
- 可以接受少量数据丢失
- 对性能要求极高
- 数据可以从其他来源恢复

### 方案二：仅 AOF

```bash
# redis.conf
appendonly yes                    # 开启AOF
appendfilename "appendonly.aof"  # AOF文件名

# AOF重写配置
auto-aof-rewrite-percentage 100   # 文件比上次重写后大一倍时触发重写
auto-aof-rewrite-min-size 64mb    # 文件达到64MB时触发重写

# AOF重写策略
aof-load-truncated yes           # 截断不完整的AOF文件时继续启动
aof-use-rdb-preamble yes         # 开启混合持久化
```

**适用场景**：
- 数据安全性要求高
- 写多读少的场景
- 可以接受稍高的延迟

### 方案三：混合持久化（推荐）

```bash
# redis.conf
# RDB 配置
save 900 1
save 300 10
save 60 10000

# AOF 配置
appendonly yes
appendfilename "appendonly.aof"

# 混合持久化（关键配置）
aof-use-rdb-preamble yes         # Redis 4.0+ 支持

# AOF 重写配置
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
```

**为什么混合持久化是最佳选择**：

```java
// 测试：对比不同持久化方式的恢复时间
public class PersistenceComparison {
    
    // 场景：1000万条数据，RDB 10MB，AOF 500MB
    // 纯 AOF 恢复：重放 500MB 命令，约 10-30 分钟
    // 混合持久化恢复：加载 RDB 10MB（秒级）+ 重放增量 AOF（秒级）
    
    // 混合持久化的 AOF 文件结构：
    // [ RDB 二进制数据 ][ AOF 命令日志 ]
    // 前半部分是 RDB 格式，可快速加载
    // 后半部分是 AOF 命令，记录 RDB 之后的增量修改
}
```

## 生产环境配置建议

### 高性能场景

```bash
# redis.conf
# 持久化配置
save 3600 1 3600秒内有1个key变化就生成RDB
rdbcompression yes
rdbchecksum yes

# AOF 配置（性能优先）
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes

# 关闭 AOF 重写（手动触发）
# auto-aof-rewrite-percentage 0
```

### 高可用场景

```bash
# redis.conf
# 持久化配置
save 900 1
save 300 10
save 60 10000

# AOF 配置（安全优先）
appendonly yes
appendfsync always         # 每个写操作都落盘
aof-use-rdb-preamble yes

# 开启 AOF 校验
aof-load-truncated no     # 发现不完整的 AOF 文件时报错
```

### 平衡场景（推荐）

```bash
# redis.conf
# RDB 配置
save 900 1
save 300 10
save 60 10000

# AOF 配置
appendonly yes
appendfsync everysec       # 每秒落盘一次
aof-use-rdb-preamble yes  # 开启混合持久化

# AOF 重写配置
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
```

## 监控与运维

### 监控持久化状态

```bash
# 查看 RDB 状态
redis-cli INFO persistence
# rdb_changes_since_last_save: 0
# rdb_bgsave_in_progress: 0
# rdb_last_save_time: 1677654321
# rdb_last_bgsave_status: ok
# rdb_last_bgsave_time_sec: -1
# rdb_current_bgsave_time_sec: -1

# 查看 AOF 状态
redis-cli INFO persistence
# aof_enabled: 1
# aofrewrite_in_progress: 0
# aof_current_size: 12345678
# aof_base_size: 12345678
# aof_pending_rewrite: 0
# aof_last_write_status: ok
```

### 手动触发持久化

```bash
# 手动触发 RDB（阻塞）
redis-cli SAVE

# 手动触发 RDB（非阻塞）
redis-cli BGSAVE

# 手动触发 AOF 重写
redis-cli BGREWRITEAOF
```

### 恢复数据

```bash
# 如果 Redis 开启了混合持久化
# 只需要保证 AOF 文件存在即可
# Redis 启动时会自动识别并恢复

# 手动恢复
redis-server /path/to/appendonly.aof
```

## 常见问题

### Q1：RDB 和 AOF 可以同时使用吗？

可以。而且推荐同时使用：RDB 做定期备份，AOF 做实时持久化。

### Q2：RDB 的 fork() 阻塞问题如何解决？

当 Redis 数据量大时，BGSAVE 的 fork() 操作可能导致短暂阻塞。解决方案：

1. 使用低内存配置（但影响性能）
2. 使用更快的磁盘（SSD）
3. 降低 save 频率，减少 fork 次数
4. 使用 Redis Cluster 分散数据

### Q3：AOF 文件过大怎么办？

使用 AOF 重写（BGREWRITEAOF）压缩文件：

```bash
# 触发重写
redis-cli BGREWRITEAOF

# 配置自动重写
# auto-aof-rewrite-percentage 100  # 文件大小是上次重写后的 100% 时触发
# auto-aof-rewrite-min-size 64mb  # 文件达到 64MB 时触发
```

### Q4：混合持久化的 AOF 文件如何查看？

```bash
# 使用 redis-cli 查看 AOF 文件
# 注意：混合持久化的 AOF 文件前半部分是二进制，后半部分是文本
# 直接 cat 会看到乱码，这是正常的

# 使用 redis-check-aof 检查文件完整性
redis-cli --raw DEBUG "OBJECT" "ENCODING" "key"
```

## 总结

三种持久化方式各有优劣：

| 方式 | 优点 | 缺点 | 适用场景 |
|---|---|---|---|
| RDB | 恢复快、文件小 | 可能丢数据、fork 阻塞 | 备份、冷备 |
| AOF | 数据安全 | 文件大、恢复慢 | 高安全场景 |
| 混合 | 兼顾两者 | 配置复杂 | **大多数场景** |

**推荐配置**：

```bash
# 高性能 + 数据安全
save 900 1
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
```

---

## 留给你的问题

假设你的业务有以下特点：

- Redis 存储用户会话数据
- 数据量：1 亿条，每条数据 TTL 约 24 小时
- 业务要求：Redis 崩溃后，最多接受丢失 10 分钟的数据
- 性能要求：P99 延迟 < 10ms

请思考：

1. 根据这些特点，你会选择哪种持久化策略？为什么？
2. 如果选择 `appendfsync everysec`，10 分钟的数据大概会丢失多少？如何减少数据丢失？
3. 如果业务允许的延迟更宽松（P99 < 50ms），你有什么优化手段？
4. 如果 Redis 的 AOF 文件损坏（如机器突然断电），如何恢复数据？

这道题的关键在于理解持久化策略对性能和可靠性的影响，以及如何根据业务需求做出权衡。
