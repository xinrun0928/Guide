# ShardingSphere 读写分离配置

数据库的读请求占 80%，写请求只有 20%，但所有请求都打在同一个库上。

老板说：「给主库加几个从库，分担一下读压力。」

你架设好 MySQL 主从复制，配置完 ShardingSphere 的读写分离。

**但问题来了：**

- 刚写入的数据，从库还没同步完成，查询返回空——**读写延迟问题**
- 从库 down 了，请求全打到主库——**故障转移问题**
- 所有查询都路由到从库，主库空闲——**负载不均问题**

这些问题怎么解决？我们先从读写分离的基本配置说起。

## 读写分离的本质

读写分离的核心思想很简单：**写操作走主库，读操作走从库**。

在 MySQL 主从架构下：

```
主库 (Master) ← 复制 ← 从库 (Slave1), 从库 (Slave2), ...
  ↓                      ↓        ↓
 写                      读       读
```

ShardingSphere 的读写分离，就是帮你自动完成这个路由。

```java
// 读写分离配置
ReadWriteSplittingRuleConfiguration config = new ReadWriteSplittingRuleConfiguration();

ReadQueryLoadBalanceAlgorithmConfiguration loadBalance = 
    new ReadQueryLoadBalanceAlgorithmConfiguration("ROUND_ROBIN");

config.getDataSourceRuleConfigurations().add(
    new ReadwriteSplittingDataSourceRuleConfiguration(
        "ds_master",           // 逻辑数据源名
        "master",              // 主库名称
        Arrays.asList("slave0", "slave1"),  // 从库列表
        loadBalance            // 负载均衡算法
    )
);
```

## 配置详解

### 一、最基础的配置

```yaml
dataSources:
  master:
    url: jdbc:mysql://master:3306/ds?serverTimezone=UTC
    username: root
    password: 
    connectionPoolClassName: com.zaxxer.hikari.HikariDataSource
    
  slave0:
    url: jdbc:mysql://slave0:3306/ds?serverTimezone=UTC
    username: root
    password: 
    
  slave1:
    url: jdbc:mysql://slave1:3306/ds?serverTimezone=UTC
    username: root
    password: 

rules:
- !READWRITE_SPLITTING
  dataSources:
    ds_0:
      type: Static
      props:
        master-data-source-name: master
        slave-data-source-names: slave0,slave1
```

### 二、负载均衡策略

当有多个从库时，读请求如何分配？ShardingSphere 提供了三种策略：

**1. 轮询策略（RoundRobin）**

```yaml
props:
  sql-show: true
  
readwrite_splitting:
  dataSources:
    ds_0:
      type: Static
      props:
        master-data-source-name: master
        slave-data-source-names: slave0,slave1
      loadBalancerName: roundRobin
      
  loadBalancers:
    roundRobin:
      type: ROUND_ROBIN
```

请求轮流分发到 slave0 → slave1 → slave0 → slave1...

**2. 随机策略（Random）**

```yaml
loadBalancers:
  random:
    type: RANDOM
```

适合从库配置不一致的场景。

**3. 权重策略（Weight）**

```yaml
loadBalancers:
  weight:
    type: WEIGHT
    props:
      slave0: 5   # slave0 承担 50% 读请求
      slave1: 5   # slave1 承担 50% 读请求
```

如果某个从库性能更强，可以给它分配更高权重：

```yaml
props:
  slave0: 8   # 性能强的从库
  slave1: 2   # 性能弱的从库
```

**4. 最少连接策略**

这是 ShardingSphere 5.x 支持的策略，请求会被路由到当前活跃连接数最少的从库。

### 三、事务内的读写分离

这是最容易踩坑的地方。

```java
@Transactional
public void createOrder(Order order) {
    // 写操作 → 主库
    orderMapper.insert(order);
    
    // 读操作？在事务内，同样走主库！
    // 因为主从同步有延迟，如果读从库可能读到旧数据
    // 造成事务内数据不一致
    Order saved = orderMapper.selectById(order.getId());
}
```

**问题分析：**

MySQL 主从复制是**异步**的。在事务 T1 中：

1. T1 在主库写入数据
2. T1 在同一事务内读取数据
3. 如果路由到从库，从库可能还没同步完成

结果：刚写入的数据，读不到。

**ShardingSphere 的解决策略：**

| 策略 | 说明 |
|-----|------|
| `LOCAL`（默认） | 事务内的读请求强制走主库 |
| `MASTER` | 所有读请求都走主库（最安全，但主库压力大） |
| `SLAVE` | 所有读请求都走从库（可能有延迟） |

```yaml
rules:
- !READWRITE_SPLITTING
  dataSources:
    ds_0:
      type: Static
      props:
        master-data-source-name: master
        slave-data-source-names: slave0,slave1
      transactionType: LOCAL  # 事务内强制主库
```

### 四、强制主库路由

有些场景必须走主库，即使不在事务内：

```java
@Service
public class OrderService {

    @ShardingSphereType(value = "MASTER_ONLY")
    public Order getOrder(Long orderId) {
        // 这个方法的所有查询都走主库
        return orderMapper.selectById(orderId);
    }
}
```

或者通过 Hint 强制路由：

```java
HintManager manager = HintManager.getInstance();
manager.setWriteRouteOnly();  // 强制写库
try {
    Order order = orderMapper.selectById(orderId);
} finally {
    manager.close();
}
```

## 读写分离 + 数据分片

很多实际场景需要同时使用读写分离和数据分片。

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    ShardingSphere                        │
│                                                         │
│  逻辑表 t_order                                          │
│                                                         │
└─────────────────────┬───────────────────────────────────┘
                      │
           ┌──────────┴──────────┐
           │   读写分离路由      │
           └──────────┬──────────┘
                      │
         ┌────────────┴────────────┐
         │                         │
    ┌────┴────┐              ┌─────┴─────┐
    │  主库   │              │   从库    │
    │ master │              │  slave0  │
    └────┬────┘              └─────┬─────┘
         │                         │
    ┌────┴────┐              ┌─────┴─────┐
    │ds_0     │              │ds_1       │
    │t_order_0│              │t_order_0  │
    │t_order_1│              │t_order_1  │
    └─────────┘              └───────────┘
```

### 配置示例

```yaml
# 数据源配置
dataSources:
  ds_0_master:
    url: jdbc:mysql://master0:3306/ds?serverTimezone=UTC
  ds_0_slave0:
    url: jdbc:mysql://slave0:3306/ds?serverTimezone=UTC
  ds_0_slave1:
    url: jdbc:mysql://slave1:3306/ds?serverTimezone=UTC
  ds_1_master:
    url: jdbc:mysql://master1:3306/ds?serverTimezone=UTC
  ds_1_slave0:
    url: jdbc:mysql://slave2:3306/ds?serverTimezone=UTC
  ds_1_slave1:
    url: jdbc:mysql://slave3:3306/ds?serverTimezone=UTC

rules:
# 分片规则
- !SHARDING
  tables:
    t_order:
      actualDataNodes: ds_${0..1}_${['master', 'slave0', 'slave1']}.t_order_${0..15}
      databaseStrategy:
        standard:
          shardingColumn: user_id
          shardingAlgorithmName: database_inline
      tableStrategy:
        standard:
          shardingColumn: user_id
          shardingAlgorithmName: table_inline
      
# 读写分离规则
- !READWRITE_SPLITTING
  dataSources:
    ds_0:
      type: Static
      props:
        master-data-source-name: ds_0_master
        slave-data-source-names: ds_0_slave0,ds_0_slave1
      loadBalancerName: roundRobin
    ds_1:
      type: Static
      props:
        master-data-source-name: ds_1_master
        slave-data-source-names: ds_1_slave0,ds_1_slave1
      loadBalancerName: roundRobin
```

这个配置的含义：

- 2 个分片（ds_0, ds_1），每个分片 16 张表（t_order_0 到 t_order_15）
- 每个分片有 1 主 2 从，读请求自动分发到从库
- 写请求路由到主库，读请求轮询分发到从库

## 主从延迟问题处理

主从延迟是读写分离永恒的话题。

### 延迟来源

```
主库执行写 → binlog → IO 线程 → 从库 relay log → SQL 线程执行
                    ↑
                  这里的延迟可能从几毫秒到几秒不等
```

### 解决方案

**方案一：读主库（最简单）**

对实时性要求高的场景，直接读主库：

```yaml
rules:
- !READWRITE_SPLITTING
  dataSources:
    ds_0:
      type: Static
      props:
        # 强制主库读
        read-strategy: MASTER
```

适合：订单状态查询、支付结果查询等。

**方案二：应用层延迟确认**

应用写入后，等待一小段时间再读取：

```java
public void createOrder(Order order) {
    orderMapper.insert(order);
    
    // 强制写主库
    HintManager.getInstance().setWriteRouteOnly();
    
    // 延迟 500ms，等待主从同步
    Thread.sleep(500);
    
    return orderMapper.selectById(order.getId());
}
```

这只适合对延迟不敏感、又不想全部走主库的场景。

**方案三：半同步复制**

MySQL 5.7+ 支持半同步复制，只有从库确认接收后，主库才返回成功：

```sql
-- 主库安装插件
INSTALL PLUGIN rpl_semi_sync_master SONAME 'semisync_master.so';
SET GLOBAL rpl_semi_sync_master_enabled = 1;

-- 从库安装插件
INSTALL PLUGIN rpl_semi_sync_slave SONAME 'semisync_slave.so';
SET GLOBAL rpl_semi_sync_slave_enabled = 1;
```

延迟可以从异步的几百毫秒降到几毫秒级别。

**方案四：GTID + 多源复制**

使用 GTID（Global Transaction ID）追踪主从同步状态，从库延迟可监控、可告警。

### 延迟监控

```sql
-- 查看从库延迟
SHOW SLAVE STATUS\G
```

关键字段：

| 字段 | 说明 |
|-----|------|
| `Seconds_Behind_Master` | 延迟秒数（最直观） |
| `Read_Master_Log_Pos` | 已读取的主库 binlog 位置 |
| `Relay_Master_Log_File` | 从库正在执行的 relay log |
| `Exec_Master_Log_Pos` | 已执行到的主库位置 |

## 故障转移

当某个从库宕机时，ShardingSphere 需要自动跳过故障节点。

```java
// 配置故障转移
ReadwriteSplittingDataSourceRuleConfiguration dataSource = 
    new ReadwriteSplittingDataSourceRuleConfiguration(
        "ds_0",
        "master",
        Arrays.asList("slave0", "slave1"),
        new RandomLoadBalanceAlgorithm()
);

// 健康检查配置（Proxy 模式支持）
config.getProps().setProperty("read-write-splitting.health-check.enabled", "true");
config.getProps().setProperty("read-write-splitting.health-check.interval", "30000");
```

**Proxy 模式的自动故障转移：**

ShardingSphere-Proxy 内置了连接检测：

1. 定时 Ping 从库
2. 如果从库无响应，标记为不可用
3. 后续请求不再路由到该从库
4. 从库恢复后，重新加入可用列表

## 总结：读写分离最佳实践

| 场景 | 策略 |
|-----|------|
| 高一致性需求（订单、支付） | 读主库 |
| 读多写少（商品、用户资料） | 读写分离 |
| 统计报表 | 读从库 + 允许延迟 |
| 实时监控 | 读主库 |

读写分离不是银弹，它解决的是**读性能问题**，而不是**单点故障问题**。

如果你的主库已经到瓶颈，光靠读写分离解决不了问题——你需要分库分表。

## 面试追问

- **主从复制延迟怎么监控？** 可以用 Prometheus + MySQL Exporter，或者在 ShardingSphere Proxy 层集成监控。
- **如果从库超过主库会发生什么？** 不会发生，从库永远落后于主库（异步复制）。
- **ShardingSphere 如何判断 SQL 是读还是写？** 解析 SQL 类型，SELECT 为读，其他为写。但 SELECT...FOR UPDATE 这种要谨慎处理。

下篇文章，我们来聊聊分布式事务——分库分表后，如何保证跨库的事务一致性？
