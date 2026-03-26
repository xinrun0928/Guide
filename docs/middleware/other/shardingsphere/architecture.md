# ShardingSphere 架构：Sharding-JDBC vs Sharding-Proxy

凌晨 3 点，你被生产环境的报警短信惊醒——订单服务数据库连接数飙升，CPU 打满，所有请求超时。

你快速排查：数据量太大，单库已经扛不住了。老板丢过来一句话：「上分库分表吧，下个月 GMV 要翻倍。」

你打开 ShardingSphere 官网，发现它提供了两种部署模式：Sharding-JDBC 和 Sharding-Proxy。

**该怎么选？**

很多人会告诉你「看场景」，但具体怎么判断？先别急着选，我们把这两个东西的本质弄清楚。

## ShardingSphere 是什么？

在深入对比之前，先说清楚 ShardingSphere 的定位。

ShardingSphere 是一款分布式数据库生态系统，它的核心目标只有一个：**让分库分表对业务透明**。

没有 ShardingSphere 之前，你要手动管理多个数据源，在代码里写「如果 user_id % 2 == 0 用 ds_0，否则用 ds_1」。这种硬编码不仅维护成本高，还很容易出错。

ShardingSphere 做的事情，就是把这些分片逻辑抽离出来，让你的代码只需要操作逻辑表，剩下的路由、聚合、分布式事务，都交给它处理。

现在的 ShardingSphere 生态非常完整：

| 组件 | 作用 |
|-----|------|
| ShardingSphere-JDBC | Java 客户端分片，嵌入应用进程 |
| ShardingSphere-Proxy | 独立部署的代理层，MySQL/PostgreSQL 协议 |
| ShardingSphere-Sidecar | Kubernetes 生态，暂无生产级实现 |
| ShardingSphere-Operator | K8s  Operator 管理 Proxy |

我们重点聊前两种，它们是实际生产中使用最多的模式。

## Sharding-JDBC：轻量级方案

Sharding-JDBC 的设计理念很直接——**它就是一个增强版的 JDBC 驱动**。

### 工作原理

当你配置好 Sharding-JDBC 后，你的应用层依然使用原来的 DataSource，但这个 DataSource 已经被 ShardingSphere 包装过了。

```
应用代码 → ShardingSphere-JDBC → 改写 SQL → 根据分片规则路由 → 真实数据源
```

它的核心流程分为四步：

1. **SQL 解析**：解析你写的 SQL，提取分片键、条件等信息
2. **路由计算**：根据分片规则，决定这条 SQL 应该发往哪个数据源/表
3. **SQL 改写**：如果涉及跨分片查询，需要改写 SQL（比如补全逻辑表名）
4. **结果归并**：将多个数据源返回的结果聚合，返回给应用

### 优势

Sharding-JDBC 的优点很明显：

```java
// 业务代码完全不感知分片
DataSource dataSource = new ShardingDataSource(config);
Connection conn = dataSource.getConnection();
// 正常写 SQL，ShardingSphere 自动路由
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM t_order WHERE user_id = ?"
);
```

**零运维成本**：没有额外进程，不需要额外部署。你的应用就是一切。

**性能损耗低**：因为它运行在应用进程内，没有额外的网络跳转，延迟可以忽略不计。

**完全透明**：对你的代码来说，分片是透明的。你还是写 `SELECT * FROM t_order`，ShardingSphere 自动帮你路由到对应的分片表。

### 劣势

但硬币的另一面：

**语言绑定**：必须是 Java（或者 JVM 系语言）。Go、Python、Node.js 只能用 Sharding-Proxy。

**占用应用资源**：Sharding-JDBC 运行在应用进程中，会消耗 CPU 和内存。如果你的应用已经达到资源瓶颈，再加一层会雪上加霜。

**升级影响业务**：每次升级 ShardingSphere 版本，都需要重新部署应用。这意味着生产环境的变更风险更高。

## Sharding-Proxy：独立部署方案

Sharding-Proxy 的定位是**数据库协议的代理层**。

它模拟成一个 MySQL（或者 PostgreSQL）服务器，你的应用连接它，就像连接普通的 MySQL 一样，不需要任何特殊依赖。

```
应用代码 → MySQL 协议 → ShardingSphere-Proxy → 根据分片规则路由 → 真实数据源
```

### 部署架构

Sharding-Proxy 需要单独部署，通常配合 ZooKeeper 或 etcd 使用：

```yaml
# docker-compose 简化示例
version: '3.8'
services:
  proxy:
    image: shardingsphere/shardingsphere-proxy
    ports:
      - "3307:3307"
    environment:
      - JVM_OPTS=-Xmx2g
    volumes:
      - ./conf:/opt/shardingsphere-proxy/conf
    depends_on:
      - zookeeper
      
  zookeeper:
    image: zookeeper:3.8
    ports:
      - "2181:2181"
```

### 优势

**多语言友好**：只要你的语言支持 MySQL/PostgreSQL 客户端，就可以使用 ShardingSphere 的分片能力。Java、Go、Python、C++ 都可以。

**资源隔离**：Proxy 独立部署，不占用应用进程资源。即使 Proxy 负载高，也不影响应用本身的性能。

**热更新配置**：配合配置中心，可以动态修改分片规则而不重启应用。

**集中管理**：所有分片逻辑在 Proxy 层统一处理，方便运维人员管理和监控。

### 劣势

**额外网络跳转**：应用 → Proxy → 数据库，多了一跳。在高并发低延迟场景下，这可能是瓶颈。

**运维复杂度**：需要额外部署和运维 Proxy 进程、ZooKeeper/etcd 集群。

**连接数开销**：Proxy 需要维护与后端数据库的连接池，连接数管理更复杂。

## 核心对比

说了这么多，我们直接上对比表格：

| 对比维度 | Sharding-JDBC | Sharding-Proxy |
|---------|---------------|----------------|
| 部署形态 | 库（嵌入应用） | 服务（独立进程） |
| 适用语言 | Java/JVM | 任意支持 MySQL 协议 |
| 运维成本 | 低（无额外组件） | 高（Proxy + ZooKeeper） |
| 性能损耗 | 低（无网络跳转） | 中等（多一跳） |
| 配置热更新 | 不支持（需重启） | 支持（配合配置中心） |
| 连接池 | 复用应用连接池 | Proxy 独立维护 |
| 事务支持 | 本地事务 + XA | 本地事务 + XA + BASE |
| 适用场景 | Java 应用、数据量中等 | 多语言、数据量大、运维成熟 |

## 选型决策树

面对这两个选项，很多人会纠结。我给出一个决策树：

```
数据量 < 1000万/单库？
├── 是 → 先别分库分表，加索引、优化查询
└── 否 → 继续判断

技术栈是 Java？
├── 是 → 数据量 < 5000万，运维能力弱？
│         ├── 是 → Sharding-JDBC
│         └── 否 → Sharding-Proxy
└── 否 → Sharding-Proxy（唯一选择）
```

但这个决策树不是绝对的。来看几个典型场景：

**场景一：单体 Java 应用，团队小**

选 Sharding-JDBC。不想增加运维负担，就用这个方案。用法简单，改动小，见效快。

**场景二：微服务架构，多语言团队**

选 Sharding-Proxy。所有服务统一连接 Proxy，不管你是 Java 还是 Go，都能享受分片能力。

**场景三：数据量巨大，需要极致性能**

选 Sharding-JDBC + 薄 Proxy 层。你可以在应用层直接用 Sharding-JDBC，对于非 Java 服务，再加一层薄 Proxy 做协议转换。

**场景四：需要动态修改分片规则**

选 Sharding-Proxy。配合 Nacos/Apollo 等配置中心，可以实现规则的热更新，不用重启任何服务。

## 混合架构：鱼和熊掌兼得

实际上，很多成熟团队会选择混合部署：

```
                    ┌─────────────┐
                    │  Java Web  │
                    │ Sharding-JDBC │
                    └──────┬──────┘
                           │ 直连
                           ▼
┌──────────────────────────────────────────┐
│              ShardingSphere               │
│                  Proxy                    │
└──────┬─────────────────────────┬─────────┘
       │                         │
       ▼                         ▼
   ┌───────┐                 ┌───────┐
   │ ds_0  │                 │ ds_1  │
   │t_order│                 │t_order│
   │t_user │                 │t_user │
   └───────┘                 └───────┘
```

- Java 服务直连 Proxy，使用 Sharding-JDBC 减少一跳
- Go/Python 服务通过 Proxy 使用分片能力
- 统一的管理界面和配置

## 面试追问

如果你在面试中被问到这个问题，可以这样展开：

面试官可能会继续追问：

- **ShardingSphere 的 SQL 兼容性如何？** 这个问题很大，可以从支持的 SQL 类型（SELECT/INSERT/UPDATE/DELETE）、不支持的场景（跨分片的 JOIN、子查询、聚合）来回答。
- **Sharding-JDBC 怎么实现分片键的自动路由？** 需要了解 ShardingSphere 的路由引擎流程：SQL 解析 → 提取分片键 → 条件路由/笛卡尔积路由/全路由。
- **如果分片键不在 SQL 条件中怎么办？** 这是一个很常见的痛点，需要走全路由，性能很差。解决方案是让分片键尽量出现在查询条件中，或者设计冗余分片键。

## 写在最后

选 Sharding-JDBC 还是 Sharding-Proxy，没有标准答案。

但有一个判断原则：**技术选型是为了解决问题，不是为了炫技**。

如果你的团队小、业务简单、数据量还没到天花板，Sharding-JDBC 是更务实的选择。

如果你的团队大、架构复杂、多语言协作是常态，Sharding-Proxy 的运维成本是值得的。

下篇文章，我们来聊聊 ShardingSphere 的数据分片策略，看看怎么选择分片键和分片算法。
