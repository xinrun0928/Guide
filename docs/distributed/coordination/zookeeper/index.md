# 分布式协调服务

在分布式系统中，有一个经典的问题：

多个节点如何协同？谁来当 leader？节点之间如何感知彼此的存在？

**分布式协调服务，就是来解决这些问题的。**

ZooKeeper、etcd、Nacos，是三个最主流的解决方案。


## 模块速览

分布式协调服务分为三个部分：ZooKeeper、etcd、Nacos。

| 章节 | 篇数 | 核心内容 |
|------|------|----------|
| [ZooKeeper](/distributed/zookeeper/data-model) | 8 篇 | 数据模型、Watch、Session、Leader 选举、ACL、应用场景 |
| [etcd](/distributed/etcd/architecture) | 3 篇 | 架构原理、Raft + MVCC、Kubernetes 应用 |
| [Nacos](/distributed/nacos/architecture) | 5 篇 | 注册中心、配置中心、集群部署、临时/持久实例 |


## 三者对比

| 维度 | ZooKeeper | etcd | Nacos |
|------|-----------|------|-------|
| 一致性协议 | ZAB | Raft | Raft |
| 数据模型 | ZNode 树 | Key-Value | Key-Value |
| Watch 机制 | 一次性触发 | 持续监听 | 持续监听 |
| 生态 | 大数据（Hadoop、Kafka） | Kubernetes | Spring Cloud |
| 适用场景 | 配置管理、分布式锁 | 服务发现、配置中心 | 注册中心、配置中心 |


## ZooKeeper 的核心能力

```
ZooKeeper 的三大核心能力：

1. 数据模型：树形结构的 ZNode
   ├── 持久节点：永久存在
   ├── 临时节点：会话结束后自动删除
   ├── 顺序节点：自动编号
   └── 版本号：乐观锁支持

2. Watch 机制：事件驱动
   ├── 一次性触发
   └── 事件类型：创建、删除、修改、孩子变化

3. 选举机制：FastLeaderElection
   ├── 要素：Epoch、zxid、ServerID
   └── 选出的 Leader 拥有最新数据
```


## Nacos 的双模式

Nacos 同时支持**注册中心**和**配置中心**两种模式：

```
注册中心：
├─ 服务注册 / 注销
├─ 服务发现
├─ 健康检查：心跳机制
└─ 临时实例 vs 持久实例

配置中心：
├─ 配置管理：热更新
├─ 命名空间隔离
├─ 配置监听：变更推送
└─ 多配置共享
```


## 面试高频问题

### Q1：ZooKeeper 和 etcd 的区别？

> 「从设计目标看，ZooKeeper 是通用的分布式协调服务，etcd 专注于服务发现和配置管理。
> 从协议看，两者都用一致性协议，但 etcd 是纯 Raft，ZooKeeper 是 ZAB。
> 从生态看，etcd 是 Kubernetes 的存储后端，ZooKeeper 是大数据生态的核心组件。」

### Q2：Nacos 和 Eureka 的区别？

> 「Eureka 已经停止维护，Nacos 是更全面的替代方案。
> Nacos 支持注册中心和配置中心，Eureka 只支持注册中心。
> Nacos 支持一致性协议（AP + CP），Eureka 只支持 AP。
> Nacos 有更活跃的社区和更完善的功能。」


## 延伸阅读

分布式协调服务的选择建议：

- **Spring Cloud + 微服务**：选 Nacos（生态最完善）
- **Kubernetes 生态**：选 etcd（K8s 深度集成）
- **大数据生态**：选 ZooKeeper（久经生产验证）
- **通用场景**：都可以，关键看团队熟悉度
