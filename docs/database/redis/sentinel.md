# 哨兵（Sentinel）机制：故障检测与自动切换

凌晨 2 点，Redis 主节点宕机了。

你的应用开始报错：无法连接 Redis。

用户开始投诉。

而你，正在被窝里睡觉。

……

如果你部署了 **Redis Sentinel（哨兵）**，这一切都可以自动化处理。

## 什么是 Sentinel？

Sentinel 是 Redis 的**高可用解决方案**：监控主从架构，发现主节点故障后，自动进行**故障转移**，让从节点晋升为主节点。

```
┌─────────────────────────────────────────────────────────────────┐
│                        正常状态                                   │
│                                                                 │
│   ┌───────────────┐                                             │
│   │   Sentinel    │ ←─── 监控 ───→ ┌─────────────┐              │
│   │   (哨兵集群)   │              │    主节点    │              │
│   └───────────────┘              └──────┬──────┘              │
│          ▲                               │                       │
│          │ 监控和配置更新                 │ 复制                  │
│          ▼                               ▼                       │
│   ┌───────────────┐              ┌─────────────┐               │
│   │   应用客户端   │              │   从节点1    │               │
│   └──────┬───────┘              └─────────────┘               │
│          │                                                      │
│          │ 订阅 failover 事件                                    │
└──────────┼──────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        故障转移后                                 │
│                                                                 │
│   ┌───────────────┐                                             │
│   │   Sentinel    │                                             │
│   └──────┬───────┘                                              │
│          │                                                       │
│          ▼                                                       │
│   ┌─────────────┐ ←──────────────────────────┐                   │
│   │   从节点1    │ ←──── 选举为新主 ────────┘                   │
│   │  (新主节点)  │                                               │
│   └──────┬──────┘                                               │
│          │ 复制                                                  │
│          ▼                                                       │
│   ┌─────────────┐                                                │
│   │   从节点2    │                                                │
│   └─────────────┘                                                │
│                                                                 │
│   ┌─────────────┐                                                │
│   │   原主节点    │ ←─── (等待恢复)                              │
│   └─────────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Sentinel 的核心功能

| 功能 | 说明 |
|-----|------|
| **监控** | 持续监控主从节点的存活状态 |
| **通知** | 故障时通知管理员（邮件、短信等） |
| **自动故障转移** | 主节点宕机时，自动选举从节点晋升 |
| **配置提供** | 客户端订阅获取当前主节点地址 |

## Sentinel 部署架构

### 最小配置：3 个 Sentinel

```
                    ┌───────────────┐
                    │  Sentinel 1  │
                    └───────┬───────┘
                            │
┌─────────────┐             │             ┌─────────────┐
│    主节点    │◀───────────┼─────────────│   从节点1   │
└──────┬──────┘             │             └─────────────┘
       │                    │
       │             ┌──────▼───────┐
       └─────────────│  Sentinel 2  │
                     └───────┬───────┘
                             │
                     ┌───────▼───────┐
                     │  Sentinel 3  │
                     └───────────────┘
```

**为什么至少 3 个？**

Sentinel 需要**过半数投票**才能执行故障转移：
- 1 个 Sentinel：无法达成多数
- 2 个 Sentinel：需要 2 票，但只有 2 个，宕机 1 个就无法投票
- 3 个 Sentinel：需要 2 票，宕机 1 个仍可投票

## Sentinel 的工作原理

### 1. 故障检测

Sentinel 每秒向主从节点发送 **PING**：

```bash
# Sentinel 配置
sentinel monitor mymaster 127.0.0.1 6379 2
```

| 响应 | 判定 |
|-----|------|
| +PONG | 节点正常 |
| -LOADING | 节点正在加载数据，可恢复 |
| -MASTERDOWN | 节点宕机 |

如果主节点在 `down-after-milliseconds` 时间内没有响应，Sentinel 标记该节点为 **主观下线（SDOWN）**。

### 2. 客观下线（ODOWN）

如果 Sentinel 集群中，**达到配置的 quorum 数量**的 Sentinel 都认为主节点下线，则标记为**客观下线（ODOWN）**。

```bash
sentinel monitor mymaster 127.0.0.1 6379 2
#                                    ↑
#                              需要 2 个 Sentinel 认为下线
```

### 3. 选举领导者

多个 Sentinel 需要选出一个**领导者**来执行故障转移：

```
┌─────────────────────────────────────────────────────────────────┐
│                       Sentinel 选举                              │
│                                                                 │
│   Sentinel A (优先级 100) ──┐                                  │
│   Sentinel B (优先级 80)  ──┼── 竞争成为领导者                   │
│   Sentinel C (优先级 80)  ──┘                                  │
│                                                                 │
│   选举方式：向其他 Sentinel 发送消息，票数最多的成为领导者       │
│                                                                 │
│   结果：Sentinel A 成为领导者，执行故障转移                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

选举规则：
1. 先看运行ID（越小越优先）
2. 再看优先级（优先级越高越优先）
3. 最后看复制偏移量（偏移量越大越优先）

### 4. 故障转移

领导者 Sentinel 执行故障转移：

```
Step 1: 在从节点中选择一个新主节点
        - 优先级高的
        - 复制偏移量大的
        - 运行ID最小的

Step 2: 向其他从节点发送 SLAVEOF 命令
        - 让它们复制新主节点

Step 3: 修改旧主节点为从节点
        - 等它恢复后，重新加入集群
```

## Sentinel 配置详解

### 主配置文件

```bash
# sentinel.conf

# ==================== 基本配置 ====================
# Sentinel 监听的端口
port 26379

# 日志文件
logfile /var/log/redis/sentinel.log

# 工作目录
dir /tmp

# ==================== 监控配置 ====================
# 监控主节点
# 格式：sentinel monitor <master-name> <ip> <port> <quorum>
sentinel monitor mymaster 127.0.0.1 6379 2

# 主观下线时间（毫秒）
sentinel down-after-milliseconds mymaster 30000

# 故障转移超时
sentinel failover-timeout mymaster 180000

# 主节点密码（如果有）
sentinel auth-pass mymaster <password>

# ==================== 并行复制 ====================
# 故障转移时，同时同步新主节点的最大从节点数
sentinel parallel-syncs mymaster 1

# ==================== 通知配置 ====================
# 故障转移时发送通知
sentinel notification-script mymaster /var/redis/notify.sh

# 故障转移后执行脚本
sentinel client-reconfig-script mymaster /var/redis/reconfig.sh
```

### 从节点配置

```bash
# 从节点需要知道主节点密码
replicaof 127.0.0.1 6379
masterauth <password>

# 从节点优先级（Sentinel 选举新主时会参考）
replica-priority 100
```

## Java 客户端集成

### 使用 Jedis

```java
import redis.clients.jedis.Jedis;
import redis.clients.jedis.JedisPool;
import redis.clients.jedis.JedisPoolConfig;
import redis.clients.jedis.JedisSentinelPool;
import java.util.HashSet;
import java.util.Set;

public class RedisSentinelDemo {
    
    private JedisSentinelPool sentinelPool;
    
    /**
     * 初始化 Sentinel 连接池
     */
    public void init() {
        // Sentinel 节点地址
        Set&lt;String&gt; sentinels = new HashSet&lt;&gt;();
        sentinels.add("127.0.0.1:26379");
        sentinels.add("127.0.0.1:26380");
        sentinels.add("127.0.0.1:26381");
        
        // 连接池配置
        JedisPoolConfig poolConfig = new JedisPoolConfig();
        poolConfig.setMaxTotal(100);
        poolConfig.setMaxIdle(20);
        poolConfig.setMinIdle(5);
        
        // 初始化 Sentinel 连接池
        sentinelPool = new JedisSentinelPool(
            "mymaster",      // master 名称（与配置一致）
            sentinels,
            poolConfig,
            2000,            // 连接超时
            "password",      // 如果有密码
            "master"         // 客户端名称
        );
    }
    
    /**
     * 获取连接
     */
    public Jedis getResource() {
        return sentinelPool.getResource();
    }
    
    /**
     * 监控 Sentinel 状态
     */
    public void monitor() {
        // 获取当前主节点信息
        String masterAddr = sentinelPool.getCurrentHostMaster().getHost() + ":" 
            + sentinelPool.getCurrentHostMaster().getPort();
        System.out.println("当前主节点: " + masterAddr);
        
        // 获取连接池信息
        System.out.println("活跃连接: " + sentinelPool.getNumActive());
        System.out.println("空闲连接: " + sentinelPool.getNumIdle());
    }
    
    public static void main(String[] args) {
        RedisSentinelDemo demo = new RedisSentinelDemo();
        demo.init();
        
        try (Jedis jedis = demo.getResource()) {
            jedis.set("key", "value");
            System.out.println("写入成功: " + jedis.get("key"));
        }
        
        demo.monitor();
    }
}
```

### 使用 Lettuce（Spring Boot）

```yaml
# application.yml
spring:
  redis:
    sentinel:
      master: mymaster
      nodes: 127.0.0.1:26379,127.0.0.1:26380,127.0.0.1:26381
      password: your-password
```

```java
// Spring Boot 会自动配置 JedisSentinelPool 或 LettuceConnectionFactory
@Autowired
private StringRedisTemplate template;

public void test() {
    template.opsForValue().set("key", "value");
    String result = template.opsForValue().get("key");
    System.out.println(result);
}
```

## Sentinel 的故障转移流程

```
┌─────────────────────────────────────────────────────────────────┐
│                     Sentinel 故障检测流程                         │
│                                                                 │
│  1. Sentinel 发送 PING                                          │
│     ↓                                                            │
│  2. 主节点无响应（超过 down-after-milliseconds）                  │
│     ↓                                                            │
│  3. Sentinel 标记主节点为「主观下线」                            │
│     ↓                                                            │
│  4. Sentinel 向其他 Sentinel 询问                                │
│     ↓                                                            │
│  5. 达到 quorum 数量的 Sentinel 都认为下线                       │
│     ↓                                                            │
│  6. 标记主节点为「客观下线」                                     │
│     ↓                                                            │
│  7. Sentinel 选举领导者                                          │
│     ↓                                                            │
│  8. 领导者执行故障转移                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Sentinel 的常见问题

### 问题 1：Sentinel 数量配置不当

```bash
# 错误：quorum 设置为 1
sentinel monitor mymaster 127.0.0.1 6379 1
# 风险：一个 Sentinel 误判就会触发故障转移

# 正确：quorum = Sentinel数量 / 2 + 1
# 3 个 Sentinel → quorum = 2
# 5 个 Sentinel → quorum = 3
```

### 问题 2：主节点密码变更

```bash
# 如果主节点密码变更，需要更新所有 Sentinel 配置
sentinel auth-pass mymaster <new-password>
```

### 问题 3：网络分区脑裂

网络分区导致主节点和 Sentinel 分隔，可能触发错误的故障转移。详见后续章节。

## 面试追问方向

| 问题 | 考察点 |
|-----|-------|
| Sentinel 如何判断主节点宕机？ | 主观下线 + 客观下线 |
| 为什么 Sentinel 要用奇数个？ | quorum 投票机制 |
| Sentinel 选举领导者的规则？ | 优先级、偏移量、运行ID |
| Sentinel 和 Cluster 的区别？ | 数据分片 vs 高可用 |

## 总结

Sentinel 是 Redis 高可用的核心组件：

- **监控**：检测主从节点存活状态
- **通知**：故障时通知管理员
- **自动故障转移**：主节点宕机时自动选举新主
- **配置提供**：客户端获取当前主节点地址

## 留给你的问题

Sentinel 完成了故障转移，从节点晋升为新主节点。

**问题：原来的主节点恢复后，Sentinel 会怎么处理它？它是会成为新主节点的从节点，还是一个独立的节点？为什么这样设计？**
