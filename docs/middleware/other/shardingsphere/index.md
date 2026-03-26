# ShardingSphere：让分库分表对业务透明

凌晨 3 点，你被生产环境的报警短信惊醒——订单服务数据库连接数飙升，CPU 打满，所有请求超时。

你快速排查：数据量太大，单库已经扛不住了。老板丢过来一句话：「上分库分表吧，下个月 GMV 要翻倍。」

你打开 ShardingSphere 官网，发现它提供了两种部署模式、多种分片策略、还有分布式事务...光文档就有几百页。

**从哪里开始？**

别慌。这篇文章给你一张全局地图，告诉你 ShardingSphere 能解决什么问题、怎么解决、什么时候用。

---

## 什么是 ShardingSphere？

ShardingSphere 是一款分布式数据库生态系统，核心目标只有一个：**让分库分表对业务透明**。

没有 ShardingSphere 之前，你要手动管理多个数据源，在代码里写「如果 user_id % 2 == 0 用 ds_0，否则用 ds_1」。这种硬编码不仅维护成本高，还很容易出错。

ShardingSphere 做的事情，就是把这些分片逻辑抽离出来，让你的代码只需要操作逻辑表，剩下的路由、聚合、分布式事务，都交给它处理。

```
业务代码（写 SELECT * FROM t_order）
            ↓
ShardingSphere（自动路由、聚合）
            ↓
多个真实数据源（t_order_0, t_order_1...）
```

---

## 两种部署模式

ShardingSphere 提供两种部署模式，适合不同的场景：

### Sharding-JDBC：嵌入应用进程

它就是一个增强版的 JDBC 驱动，运行在应用进程内，没有额外网络跳转。

```java
// 业务代码完全不感知分片
DataSource dataSource = new ShardingDataSource(config);
Connection conn = dataSource.getConnection();
// 正常写 SQL，ShardingSphere 自动路由
PreparedStatement ps = conn.prepareStatement(
    "SELECT * FROM t_order WHERE user_id = ?"
);
```

**优点**：零运维成本、性能损耗低、对 Java 应用透明

**缺点**：语言绑定（必须是 Java）、升级影响业务

### Sharding-Proxy：独立部署代理层

它模拟成一个 MySQL 服务器，应用连接它就像连接普通 MySQL 一样，不需要任何特殊依赖。

```yaml
# docker-compose 简化示例
services:
  proxy:
    image: shardingsphere/shardingsphere-proxy
    ports:
      - "3307:3307"
    volumes:
      - ./conf:/opt/shardingsphere-proxy/conf
```

**优点**：多语言友好、资源隔离、热更新配置

**缺点**：额外网络跳转、运维复杂度增加

### 怎么选？

| 对比维度 | Sharding-JDBC | Sharding-Proxy |
|---------|---------------|----------------|
| 部署形态 | 库（嵌入应用） | 服务（独立进程） |
| 适用语言 | Java/JVM | 任意支持 MySQL 协议 |
| 运维成本 | 低 | 高 |
| 性能损耗 | 低 | 中等 |
| 配置热更新 | 不支持 | 支持 |

简单来说：**Java 小团队选 JDBC，多语言大团队选 Proxy**。

---

## 核心能力一览

ShardingSphere 不只是分库分表，它是一个完整的数据库中间件生态：

| 能力 | 说明 | 解决的问题 |
|-----|------|----------|
| 数据分片 | 水平拆分/垂直拆分 | 单库数据量过大 |
| 读写分离 | 主从复制、负载均衡 | 读多写少场景 |
| 分布式事务 | XA / BASE | 跨库事务一致性 |
| 分布式ID | 雪花算法等 | 分片后 ID 生成 |
| 编排治理 | 配置管理、监控 | 集群运维 |

---

## 内容导航

### 基础入门

- [架构解析：Sharding-JDBC vs Sharding-Proxy](/middleware/shardingsphere/architecture)
  两种部署模式的深度对比，选型不再迷茫

### 核心能力

- [数据分片：分片键与分片算法](/middleware/shardingsphere/sharding)
  如何选择分片键？哈希分片 vs 范围分片怎么选？

- [读写分离：让读请求分流](/middleware/shardingsphere/read-write)
  主从复制、延迟感知、负载均衡策略

- [分布式事务：跨库操作如何保证一致性](/middleware/shardingsphere/transaction)
  XA 两阶段提交 vs Seata AT 模式，哪个更适合你？

- [分布式ID：分片后的 ID 怎么生成](/middleware/shardingsphere/distributed-id)
  雪花算法、UUID、数据库号段...优缺点分析

### 运维治理

- [编排治理：配置管理与监控](/middleware/shardingsphere/governance)
  规则热更新、集群管理、运维最佳实践

---

## 典型应用场景

### 场景一：订单表分库分表

用户量破千万，单月订单量过亿，一张表根本存不下。

```java
// ShardingSphere 自动处理分片
// 你只需要写：SELECT * FROM t_order WHERE user_id = ?
// ShardingSphere 会根据 user_id 自动路由到对应的分片
```

**关键点**：分片键的选择决定了查询效率。user_id 作为分片键，所有按用户查询的 SQL 都能精准路由到单个分片。

### 场景二：读写分离 + 分库分表组合

大促期间，写流量集中在主库，读流量分散到多个从库。

```yaml
# 配置示例
rules:
  - !READWRITE_SPLITTING
    dataSources:
      ds_master:
        writeDataSourceName: ds_0
        readDataSources:
          - ds_0_r
          - ds_1_r
```

**关键点**：读写分离解决读性能，分库分表解决写性能，两者可以叠加使用。

---

## 写在最后

选 ShardingSphere 还是其他方案，没有标准答案。

但有一个判断原则：**技术选型是为了解决问题，不是为了炫技**。

如果你的团队小、业务简单、数据量还没到天花板，先别急着上分库分表——加索引、优化查询、读写分离，可能就够了。

但如果数据量真的到了天花板，ShardingSphere 是目前生态最完整、文档最详尽的选择。

下篇文章，我们来聊聊数据分片的具体策略，看看怎么选择分片键和分片算法。
