# ShardingSphere 编排治理：配置中心与注册中心集成

凌晨 2 点，你在处理生产故障。

问题是：某个从库宕机了，需要紧急把它从读写分离配置中摘除。

你打开服务器，登录，修改配置文件，重启 ShardingSphere-Proxy...

**等等，如果这个配置改动需要同步到 20 个节点呢？**

手动一台台改？等到天亮也改不完。

这就是「编排治理」的价值：**让配置管理从体力活变成自动化**。

ShardingSphere 的编排治理模块，把配置中心（Configuration Center）和注册中心（Registry Center）结合，让分布式环境下的配置变更、实例发现、服务监控变得简单。

## 核心概念

### 配置中心 vs 注册中心

很多人容易混淆这两个概念：

| 类型 | 职责 | 存储内容 |
|-----|------|---------|
| 配置中心 | 管理配置元数据 | 分片规则、数据源、算法参数 |
| 注册中心 | 管理实例生命周期 | 节点列表、状态、健康检查 |

```
配置中心：
  /shardingsphere/rule-schema/global/
    ├── data-sources.yaml       # 数据源配置
    ├── rule-config.yaml        # 分片规则
    └── sharding-algorithm.yaml # 算法配置

注册中心：
  /shardingsphere/proxy/nodes/
    ├── proxy_1                 # 实例 1
    ├── proxy_2                 # 实例 2
    └── proxy_3                 # 实例 3
```

### ShardingSphere 支持的中间件

```yaml
# ZooKeeper（Apache ZooKeeper）
registryCenter:
  type: ZooKeeper
  serverLists: zk-host:2181
  namespace: shardingsphere
  props:
    baseSleepTimeMilliseconds: 1000
    maxRetries: 3

# etcd
registryCenter:
  type: Etcd
  serverLists: http://etcd-host:2379
  props:
    connectionTimeout: 3000

# Nacos（推荐）
registryCenter:
  type: Nacos
  serverLists: nacos-host:8848
  namespace: sharding
  props:
    group: ShardingSphere
    timeout: 30000
```

## ZooKeeper 集成

ZooKeeper 是 ShardingSphere 最早支持的注册中心，也是最成熟的方案。

### 为什么用 ZooKeeper？

- **高可用**：Paxos 算法保证集群一致性，任何节点宕机不影响服务
- **临时节点**：实例断开连接后，临时节点自动删除（自动摘除故障节点）
- **Watch 机制**：配置变更实时推送到所有客户端

### 配置示例

```yaml
registry:
  type: ZooKeeper
  serverLists: 10.0.0.1:2181,10.0.0.2:2181,10.0.0.3:2181
  namespace: shardingsphere
  props:
    baseSleepTimeMilliseconds: 1000
    maxRetries: 3
    maxSleepTimeMilliseconds: 3000
    operationTimeoutMilliseconds: 3000

configCenter:
  type: ZooKeeper
  serverLists: 10.0.0.1:2181,10.0.0.2:2181,10.0.0.3:2181
  namespace: shardingsphere
  props:
    baseSleepTimeMilliseconds: 1000
    maxRetries: 3

overwrite: false  # true: 本地覆盖 ZK；false: ZK 覆盖本地
```

### ZooKeeper 节点结构

```
/shardingsphere/
├── schema/
│   └── ds_0/
│       ├── dataSources/
│       │   └── master/
│       │       ├── username/
│       │       ├── password/
│       │       └── url/
│       ├── rule/
│       │   └── sharding/
│       │       ├── tables/
│       │       └── bindingTables/
│       └── schemaName/
├── rule/
│   ├── schema_versions/
│   ├── rule_versions/
│   └── schema_config/
├── metadata/
│   └── ds_0/
│       └── schemas/
│           └── ds/
│               └── tables/
└── instance/
    └── online/
        └── proxy_10.0.0.1:3307/
```

**节点说明：**

| 路径 | 类型 | 说明 |
|-----|------|------|
| `/schema/` | 持久化 | 分片规则配置 |
| `/rule/` | 持久化 | 规则版本管理 |
| `/metadata/` | 持久化 | 表结构元数据 |
| `/instance/online/` | 临时 | 在线 Proxy 实例 |

### 故障自动转移

当某个 ShardingSphere-Proxy 宕机时：

```
1. Proxy 实例断开连接
2. ZooKeeper 检测到 Session 超时
3. 删除临时节点 /instance/online/proxy_*
4. Watch 机制通知其他节点
5. 其他 Proxy 更新实例列表，不再路由到故障节点
```

这就是**注册中心的核心价值**——实例管理自动化。

## Nacos 集成（推荐）

相比 ZooKeeper，Nacos 的配置管理界面更友好，运维成本更低。

### 为什么选 Nacos？

| 对比维度 | ZooKeeper | Nacos |
|---------|-----------|-------|
| 配置界面 | 无（命令行操作） | Web 控制台 |
| 学习成本 | 高 | 低 |
| 多环境隔离 | 通过路径隔离 | Namespace + Group |
| 配置推送 | Watch | 消息推送 + 异步轮询 |
| 运维 | 复杂 | 简单（自带管理界面） |

### 配置示例

```yaml
registry:
  type: Nacos
  serverLists: nacos-host:8848
  namespace: sharding
  props:
    group: ShardingSphere
    timeout: 30000

configCenter:
  type: Nacos
  serverLists: nacos-host:8848
  namespace: sharding
  props:
    group: ShardingSphere
    timeout: 30000
```

### Nacos 命名空间隔离

```yaml
# 不同环境使用不同 namespace
dev:
  namespace: sharding-dev
test:
  namespace: sharding-test
prod:
  namespace: sharding-prod
```

### Nacos 控制台配置

在 Nacos 控制台创建配置：

```
Data ID: shardingsphere
Group: ShardingSphere
Namespace: sharding-prod
```

配置内容：

```yaml
schemaName: ds_0

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
    
rules:
- !SHARDING
  tables:
    t_order:
      actualDataNodes: ds_${0..1}.t_order_${0..15}
      tableStrategy:
        standard:
          shardingColumn: user_id
          shardingAlgorithmName: t_order_inline
          
  shardingAlgorithms:
    t_order_inline:
      type: INLINE
      props:
        algorithm-expression: t_order_${user_id % 16}
```

## 配置热更新

这是编排治理最强大的功能：**修改配置不需要重启 ShardingSphere-Proxy**。

### 更新流程

```
1. 在配置中心（Nacos/ZooKeeper）修改配置
2. 配置中心通知 ShardingSphere-Proxy
3. Proxy 重新加载配置
4. 新请求使用新配置
5. 旧请求使用旧配置（等待完成）
```

### 示例：动态修改分片规则

**修改前（Nacos 控制台）：**

```yaml
tables:
  t_order:
    actualDataNodes: ds_0.t_order_${0..7}
```

**修改后（添加新分片）：**

```yaml
tables:
  t_order:
    actualDataNodes: ds_0.t_order_${0..15}  # 8 → 16 张表
```

**不需要重启 Proxy：**

1. 在 Nacos 修改配置
2. 所有 Proxy 实例自动感知变更
3. 新查询路由到新分片
4. 旧数据通过数据迁移工具迁移到新分片

### 热更新限制

热更新虽然方便，但有些配置变更**必须重启**：

| 配置类型 | 是否支持热更新 |
|---------|--------------|
| 分片算法参数 | ✅ 支持 |
| 数据源连接信息 | ✅ 支持 |
| 新增/删除分片表 | ❌ 需重启 |
| 规则类型的变更（如加读写分离） | ❌ 需重启 |

## 服务治理能力

### 1. 实例健康检查

```yaml
props:
  # Proxy 健康检查间隔
  proxy.health-check.enabled: true
  proxy.health-check.interval: 30000
```

ShardingSphere-Proxy 会定期检查后端数据库连接：

1. 发送 SELECT 1
2. 如果超时或失败，标记为不健康
3. 后续请求不再路由到该节点

### 2. 熔断机制

当某个从库响应超时或错误率过高时，自动熔断：

```yaml
props:
  # 熔断配置
  proxy熔断.enabled: true
  proxy熔断.maximum-pool-size: 10
  proxy熔断.minimum-half-connection-time: 60000
```

### 3. 配置元数据同步

ShardingSphere-Proxy 会将表结构元数据同步到注册中心：

```yaml
metadata:
  ds_0:
    # 自动同步表结构
    tables:
      t_order:
        columns:
          order_id: bigint
          user_id: bigint
          amount: decimal
        indexes:
          primary:
            - order_id
```

这样其他服务可以查询 ShardingSphere 的元数据，了解分片情况。

## 监控集成

### Prometheus + Grafana

ShardingSphere-Proxy 内置 Prometheus 监控指标：

```yaml
props:
  metrics-enabled: true
  prometheus-port: 9090
```

**暴露的指标：**

| 指标名 | 类型 | 说明 |
|-------|------|------|
| `shardingsphere_proxy_execute_count_total` | Counter | SQL 执行总数 |
| `shardingsphere_proxy_execute_latency_millis` | Histogram | SQL 执行延迟 |
| `shardingsphere_proxy_connection_total` | Gauge | 当前连接数 |
| `shardingsphere_proxy_request_total` | Counter | 请求总数 |

**Grafana Dashboard 配置：**

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'shardingsphere-proxy'
    static_configs:
      - targets: ['proxy-1:9090', 'proxy-2:9090', 'proxy-3:9090']
```

### OpenTelemetry

ShardingSphere 也支持 OpenTelemetry 标准：

```yaml
props:
  observability-cases-enabled: true
  otel-service-name: shardingsphere-proxy
  otel-endpoint: http://otel-collector:4317
```

## 实战：生产环境配置

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    Nacos 集群                            │
│   ┌─────────────────────────────────────────────────┐   │
│   │  Namespace: sharding-prod                       │   │
│   │  Group: ShardingSphere                           │   │
│   │                                                  │   │
│   │  /sharding/rule-schema/ds_0/                    │   │
│   │  /sharding/metadata/                            │   │
│   │  /sharding/instance/online/                      │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                              │
    ┌─────┴─────┐                  ┌─────┴─────┐
    │ Proxy 1  │                  │ Proxy 2   │
    │ Port 3307│                  │ Port 3307 │
    └─────────┘                  └─────────┘
          │                              │
    ┌─────┴─────┐                  ┌─────┴─────┐
    │ MySQL 集群│                  │ MySQL 集群│
    │ (分片)   │                  │ (分片)    │
    └─────────┘                  └─────────┘
```

### 完整配置

```yaml
# bootstrap.yml (ShardingSphere-Proxy 配置)

registry:
  type: Nacos
  serverLists: nacos-1:8848,nacos-2:8848,nacos-3:8848
  namespace: sharding-prod
  props:
    group: ShardingSphere
    timeout: 30000
    accessLogging: true

configCenter:
  type: Nacos
  serverLists: nacos-1:8848,nacos-2:8848,nacos-3:8848
  namespace: sharding-prod
  props:
    group: ShardingSphere

props:
  # 性能调优
  max-connections-size-per-query: 1
  acceptor-size: 16
  worker-thread: 100
  
  # 监控
  metrics-enabled: true
  prometheus-port: 9090
  
  # 健康检查
  proxy.health-check.enabled: true
  proxy.health-check.interval: 30000
  
  # 连接池
  proxy HikariPool-name: ShardingSphere-Proxy

overwrite: false  # 生产环境使用 ZK/Nacos 配置，不使用本地
```

## 常见问题

### Q1: ZooKeeper vs Nacos 怎么选？

| 场景 | 推荐 |
|-----|------|
| 已有 ZooKeeper 集群 | ZooKeeper |
| 新项目、追求运维简单 | Nacos |
| 需要配置界面 | Nacos |
| 超大规模集群（几百个 Proxy） | ZooKeeper（更成熟） |

### Q2: 多环境如何隔离？

推荐方案：每个环境独立部署一套注册中心。

```
dev 环境: ZooKeeper-dev 或 Nacos-dev
test 环境: ZooKeeper-test 或 Nacos-test
prod 环境: ZooKeeper-prod 或 Nacos-prod
```

### Q3: 配置中心故障了怎么办？

ShardingSphere-Proxy 会缓存本地配置：

```yaml
props:
  # 本地缓存路径
  local-cache-enabled: true
```

当配置中心不可用时，使用本地缓存继续服务。

## 面试追问

- **ZooKeeper 的 Watch 机制原理是什么？** 客户端向 ZooKeeper 注册 Watch，服务端在数据变更时通知客户端。但 Watch 是一次性的，需要重新注册。
- **Nacos 配置变更是推还是拉？** 两者结合。配置变更时服务端推送变更事件，但也有定时轮询兜底。
- **如果 Nacos 集群有节点挂了怎么办？** Nacos 集群有多数派投票机制（N/2+1），少数节点故障不影响整体服务。

## 写在最后

编排治理是 ShardingSphere 的高级特性，在小规模场景下可能感知不强。

但当你有几十个分片节点、需要频繁变更配置、对服务可用性要求高时，配置中心和注册中心就是必需品。

**建议：** 如果你的项目打算在生产环境使用 ShardingSphere，从一开始就接入 Nacos 或 ZooKeeper。前期的投入会在后期获得回报。

## 后续学习

ShardingSphere 文档系列到这里就告一段落了。建议你进一步了解：

- [分库分表中间件对比](/middleware/overview)：ShardingSphere vs MyCAT vs Vitess
- [MySQL 主从复制原理](/database/mysql/index)：理解读写分离的底层
- [分布式事务实战](/distributed/transaction)：深入 Seata 的 AT 模式

祝你分库分表之路顺畅。
