# Redis 监控：INFO、MONITOR、redis-cli stats

你的 Redis 突然变慢了。

告警邮件塞满邮箱。

作为运维，你的第一步是什么？

**监控**。

## Redis 监控体系

```
┌─────────────────────────────────────────────────────────────────┐
│                     Redis 监控体系                               │
│                                                                 │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐     │
│   │    INFO      │   │   MONITOR     │   │  redis-cli    │     │
│   │  运行时统计   │   │   实时命令    │   │   诊断工具    │     │
│   └───────────────┘   └───────────────┘   └───────────────┘     │
│                                                                 │
│   ┌───────────────┐   ┌───────────────┐   ┌───────────────┐     │
│   │    SLOWLOG   │   │    LATENCY    │   │   PUBLISH/    │     │
│   │   慢查询日志  │   │    延迟分析    │   │  SUBSCRIBE    │     │
│   └───────────────┘   └───────────────┘   └───────────────┘     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## INFO 命令：运行时统计

### INFO 分类

```bash
# INFO 命令支持多种分类
redis-cli INFO                    # 所有信息
redis-cli INFO server             # 服务器信息
redis-cli INFO clients           # 客户端信息
redis-cli INFO memory           # 内存信息
redis-cli INFO persistence      # 持久化信息
redis-cli INFO stats            # 运行时统计
redis-cli INFO replication      # 主从复制
redis-cli INFO cpu              # CPU 使用
redis-cli INFO commandstats     # 命令统计
redis-cli INFO latencystats     # 延迟统计
redis-cli INFO sentinel         # Sentinel（如果适用）
```

### 核心指标解读

#### 1. Server 信息

```bash
redis-cli INFO server
```

```
# Server
redis_version:7.0.11           # Redis 版本
redis_mode:cluster             # 运行模式（standalone/cluster/sentinel）
os:Linux 5.4.0 x86_64           # 操作系统
arch_bits:64                   # 架构
uptime_in_seconds:3600         # 运行时间（秒）
uptime_in_days:0                # 运行时间（天）
```

#### 2. Memory 信息

```bash
redis-cli INFO memory
```

```
# Memory
used_memory:1048576            # Redis 分配内存（字节）
used_memory_human:1.00M       # 可读格式
used_memory_peak:2097152     # 峰值内存
used_memory_peak_human:2.00M
used_memory_rss:2097152       # 物理内存占用
used_memory_rss_human:2.00M
mem_fragmentation_ratio:2.00   # 内存碎片率
mem_allocator:jemalloc-5.2.1  # 内存分配器

# 分析指标
内存碎片率 > 1.5 → 需要关注
used_memory_peak / used_memory > 1.5 → 可能内存泄漏
```

#### 3. Stats 信息

```bash
redis-cli INFO stats
```

```
# Stats
total_connections_received:1000     # 累计连接数
total_commands_processed:5000000    # 累计执行命令数
instantaneous_ops_per_sec:1000      # 每秒命令数（QPS）
total_net_input_bytes:100000000     # 累计输入流量
total_net_output_bytes:200000000   # 累计输出流量
instantaneous_input_kbps:10.0       # 每秒输入（KB）
instantaneous_output_kbps:20.0      # 每秒输出（KB）

# 统计
keyspace_hits:4000000               # 缓存命中
keyspace_misses:1000000            # 缓存未命中
keyspace_hitrate:80.00%            # 命中率

# 淘汰
evicted_keys:0                     # 淘汰的 key 数量
expired_keys:5000                 # 过期的 key 数量

# 阻塞
blocked_clients:0                   # 阻塞的客户端数
```

#### 4. CPU 信息

```bash
redis-cli INFO cpu
```

```
# CPU
used_cpu_sys:100.5                 # 系统 CPU 使用
used_cpu_user:200.3                # 用户 CPU 使用
used_cpu_sys_children:0.0          # 后台进程系统 CPU
used_cpu_user_children:0.0          # 后台进程用户 CPU
```

### Java 获取 INFO

```java
import redis.clients.jedis.Jedis;

/**
 * INFO 命令使用
 */
public class InfoDemo {
    
    private Jedis jedis;
    
    /**
     * 获取各项统计
     */
    public void getStats() {
        // 获取所有信息
        String all = jedis.info();
        System.out.println(all);
        
        // 获取指定分类
        String memory = jedis.info("memory");
        String stats = jedis.info("stats");
        String replication = jedis.info("replication");
        
        // 解析关键指标
        parseMemoryInfo(memory);
        parseStatsInfo(stats);
    }
    
    /**
     * 解析内存信息
     */
    private void parseMemoryInfo(String info) {
        String[] lines = info.split("\n");
        Map<String, String> map = new HashMap<>();
        
        for (String line : lines) {
            if (line.contains(":")) {
                String[] parts = line.split(":");
                map.put(parts[0], parts[1]);
            }
        }
        
        System.out.println("当前内存: " + map.get("used_memory_human"));
        System.out.println("峰值内存: " + map.get("used_memory_peak_human"));
        System.out.println("碎片率: " + map.get("mem_fragmentation_ratio"));
    }
    
    /**
     * 解析统计信息
     */
    private void parseStatsInfo(String info) {
        String[] lines = info.split("\n");
        Map<String, String> map = new HashMap<>();
        
        for (String line : lines) {
            if (line.contains(":")) {
                String[] parts = line.split(":");
                map.put(parts[0], parts[1]);
            }
        }
        
        System.out.println("QPS: " + map.get("instantaneous_ops_per_sec"));
        System.out.println("命中率: " + map.get("keyspace_hitrate"));
        System.out.println("淘汰数: " + map.get("evicted_keys"));
    }
}
```

## MONITOR 命令：实时命令监控

### 使用方法

```bash
# 启动监控（会看到所有命令）
redis-cli MONITOR

# 输出示例
1609459200.123456 [0 127.0.0.1:54321] "GET" "user:1001"
1609459200.234567 [0 127.0.0.1:54322] "SET" "key:123" "value"
1609459200.345678 [0 127.0.0.1:54323] "HGETALL" "hash:456"
```

### MONITOR 的问题

MONITOR 会影响性能，生产环境慎用！

```java
/**
 * MONITOR 性能影响
 * 
 * MONITOR 原理：
 * 1. 主线程将每个命令发送给 MONITOR 客户端
 * 2. 如果 MONITOR 客户端处理慢，会阻塞主线程
 * 3. 高 QPS 下，MONITOR 可能导致 Redis 卡顿
 */
public class MonitorCaution {
    
    /**
     * 生产环境替代方案：使用 CLIENT LIST 监控
     */
    public void monitorAlternative() {
        // 查看所有客户端
        String clients = jedis.clientList();
        
        // 查看阻塞的客户端
        String blocked = jedis.clientList();
        // 解析 flags 中包含 N 的客户端
        
        // 查看最近执行的命令（用 INFO commandstats）
        String commandstats = jedis.info("commandstats");
        System.out.println(commandstats);
    }
}
```

### MONITOR 分析脚本

```bash
#!/bin/bash
# monitor-analyze.sh

# 监控 10 秒，统计命令频率
redis-cli MONITOR | head -n 1000 | \
    awk '{print $4}' | \
    sort | uniq -c | sort -rn | head -n 20
```

## redis-cli stats：性能诊断

### 延迟测试

```bash
# 测试 Redis 延迟
redis-cli --latency
# 或
redis-cli --latency-history

# 输出示例
1) 1) (integer) 1
   2) (integer) 1
   3) "Fri Jun 15 10:23:45 UTC 2024"
   4) (integer) 1
   5) (float) 0.001000000032
   6) "Pong"

# 测试采样延迟
redis-cli --latency-history
# 多次采样，统计延迟分布
```

### 延迟分布

```bash
# 查看延迟分布（需要开启 latency monitor）
redis-cli CONFIG SET latency-monitor-threshold 100

# 查看延迟历史
redis-cli LATENCY HISTORY
```

### 慢日志

```bash
# 查看慢日志
redis-cli SLOWLOG GET 10

# 查看慢日志数量
redis-cli SLOWLOG LEN

# 清空慢日志
redis-cli SLOWLOG RESET
```

## 命令统计

### COMMANDSTATS

```bash
# 查看命令执行统计
redis-cli INFO commandstats
```

```
# Commandstats
cmdstat_get:calls=1000000,usec=100000,usec_per_call=0.10
cmdstat_set:calls=500000,usec=750000,usec_per_call=1.50
cmdstat_hgetall:calls=100000,usec=5000000,usec_per_call=50.00
```

### 解析命令统计

```java
/**
 * 命令统计分析
 */
public class CommandStatsAnalysis {
    
    /**
     * 找出最慢的命令
     */
    public void findSlowCommands() {
        String stats = jedis.info("commandstats");
        
        List<CommandStat> slowCommands = new ArrayList<>();
        String[] lines = stats.split("\n");
        
        for (String line : lines) {
            if (line.startsWith("cmdstat_")) {
                // 解析命令统计
                CommandStat stat = parseCommandStat(line);
                slowCommands.add(stat);
            }
        }
        
        // 按平均耗时排序
        slowCommands.sort((a, b) -> 
            Double.compare(b.getAvgUsec(), a.getAvgUsec()));
        
        // 输出 Top 10
        System.out.println("最慢的 10 个命令：");
        for (int i = 0; i < 10 && i < slowCommands.size(); i++) {
            System.out.println(slowCommands.get(i));
        }
    }
    
    private CommandStat parseCommandStat(String line) {
        // 解析 "cmdstat_get:calls=1000,usec=5000,usec_per_call=5.00"
        // ...
        return null;
    }
}
```

## CLIENT 命令

### 客户端管理

```bash
# 查看所有客户端
redis-cli CLIENT LIST

# 输出示例
id=5 addr=127.0.0.1:54321 fd=8 name= age=123 idle=0 flags=N 
db=0 sub=0 psub=0 multi=-1 qbuf=0 qbuf-free=0
```

### 字段解释

| 字段 | 说明 |
|-----|------|
| id | 客户端 ID |
| addr | 客户端地址 |
| fd | 文件描述符 |
| name | 客户端名称（CLIENT SETNAME） |
| age | 连接时长（秒） |
| idle | 空闲时长（秒） |
| flags | 标志（N=普通，O=监控，S=从节点） |
| db | 选择的数据库 |
| cmd | 最后执行的命令 |

### 断开连接

```bash
# 按地址断开
redis-cli CLIENT KILL ADDR 127.0.0.1:54321

# 按类型断开
redis-cli CLIENT KILL TYPE normal

# 断开所有空闲连接
redis-cli CLIENT KILL IDLE 3600
```

## 数据库管理

### DBSIZE

```bash
# 查看 key 数量
redis-cli DBSIZE
```

### 键空间统计

```bash
redis-cli INFO keyspace
```

```
# Keyspace
db0:keys=1000000,expires=500000,avg_ttl=3600000
db1:keys=100,expires=0,avg_ttl=0
```

## 监控最佳实践

### 1. 关键指标监控

```yaml
# Prometheus + Redis Exporter
groups:
  - name: redis_essential_metrics
    rules:
      # 连接数
      - alert: RedisHighConnections
        expr: redis_connected_clients > 10000
        for: 5m
        
      # 内存使用
      - alert: RedisHighMemory
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.9
        for: 5m
        
      # QPS
      - alert: RedisLowQPS
        expr: rate(redis_commands_processed_total[5m]) < 100
        for: 5m
        
      # 命中率
      - alert: RedisLowHitRate
        expr: redis_keyspace_hits / (redis_keyspace_hits + redis_keyspace_misses) < 0.5
        for: 5m
        
      # 淘汰
      - alert: RedisHighEviction
        expr: rate(redis_evicted_keys_total[5m]) > 100
        for: 5m
```

### 2. 健康检查脚本

```java
/**
 * Redis 健康检查
 */
public class RedisHealthCheck {
    
    private Jedis jedis;
    
    public HealthResult check() {
        HealthResult result = new HealthResult();
        
        try {
            // PING
            String ping = jedis.ping();
            result.setPing(ping.equals("PONG"));
            
            // INFO stats
            String stats = jedis.info("stats");
            result.setQps(getQPS(stats));
            
            // INFO memory
            String memory = jedis.info("memory");
            result.setMemory(getMemoryUsage(memory));
            
            // 连接数
            String clients = jedis.info("clients");
            result.setConnectedClients(getConnectedClients(clients));
            
        } catch (Exception e) {
            result.setHealthy(false);
            result.setError(e.getMessage());
        }
        
        return result;
    }
}
```

## 总结

Redis 监控工具：

| 工具 | 用途 | 生产环境可用 |
|-----|------|-------------|
| INFO | 运行时统计 | ✅ |
| MONITOR | 实时命令 | ❌ 慎用 |
| SLOWLOG | 慢查询 | ✅ |
| CLIENT LIST | 客户端管理 | ✅ |
| LATENCY | 延迟分析 | ✅ |
| COMMANDSTATS | 命令统计 | ✅ |

## 留给你的问题

MONITOR 命令可以实时看到所有命令，但它会影响 Redis 性能。

**有没有办法在不执行 MONITOR 的情况下，统计过去一段时间内各命令的执行频率？提示：关注 COMMANDSTATS。**
