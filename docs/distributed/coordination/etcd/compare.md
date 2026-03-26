# etcd vs ZooKeeper vs Consul 对比

你有没有想过这个问题：

选型分布式协调服务时，etcd、ZooKeeper、Consul 三个选哪个？

有人说 etcd 是 Kubernetes 的标配，ZooKeeper 太老了，Consul 是全能的。

但 ZooKeeper 真的老了吗？Consul 又真的全能吗？

今天，我们来做一场全方位对比。

## 三者横向对比表

| 维度 | etcd | ZooKeeper | Consul |
|------|------|-----------|--------|
| 一致性协议 | Raft | ZAB | Raft + Gossip |
| 数据模型 | key-value | ZNode 树 | key-value |
| API | gRPC + HTTP | 私有协议 | HTTP + DNS |
| 服务发现 | 支持 | 不直接支持 | 原生支持 |
| 健康检查 | 支持 | 不支持 | 原生支持 |
| 多数据中心 | 不支持 | 不支持 | 原生支持 |
| ACL | RBAC | ACL | ACL + Intents |
| 成熟度 | 8+ 年 | 15+ 年 | 7+ 年 |
| 典型用户 | K8s、Cloud Foundry | Kafka、Hadoop | Nomad、Traefik |
| 客户端语言 | Go/Java/Python | Java/C/Python | Go/Java/Python |

## Consul：服务发现的「全能选手」

Consul 是 HashiCorp 的产品，设计理念是**「服务网格」**——一个组件解决多个问题。

### Consul 的核心特性

1. **服务发现 + 健康检查**
2. **KV 存储**
3. **多数据中心支持**
4. **DNS 查询**
5. **UI 控制台**

```bash
# Consul 服务注册
consul services register \
    -name=user-service \
    -address=192.168.1.1 \
    -port=8080 \
    -check=http://192.168.1.1:8080/health \
    -interval=10s
```

```bash
# DNS 查询服务
dig @127.0.0.1 -p 8600 user-service.service.consul
# 返回：192.168.1.1 (服务 IP)
```

### Consul 的 Raft + Gossip 混合协议

Consul 使用 **Raft** 做一致性存储，使用 **Gossip 协议**做服务发现。

```text
Raft 集群（3-5 节点）：
- 负责 KV 数据的强一致性写入
- 适合少量关键配置

Gossip 网络（所有节点）：
- 负责服务注册信息的快速传播
- 支持多数据中心
- 适合大量服务实例
```

**这种设计让 Consul 在服务发现场景下性能更好**。

## ZooKeeper：久经沙场的老将

ZooKeeper 的优势在于**成熟稳定**。

### ZooKeeper 的护城河

1. **Kafka**：Kafka 2.8 之前完全依赖 ZooKeeper
2. **Hadoop 生态**：Hive、HBase、Storm 都用 ZooKeeper
3. **Curator 库**：丰富的分布式原语实现

```java
// Curator 分布式锁
InterProcessMutex lock = new InterProcessMutex(client, "/locks/order");
try {
    if (lock.acquire(10, TimeUnit.SECONDS)) {
        // 临界区代码
    }
} finally {
    lock.release();
}
```

### ZooKeeper 的局限

1. 没有原生服务发现能力
2. 健康检查需要自己实现
3. 没有多数据中心支持
4. 运维相对复杂

## etcd：Kubernetes 的标配

etcd 是为 Kubernetes 量身定制的。

### etcd 的优势

1. **Kubernetes 深度集成**：API Server 直接操作 etcd
2. **gRPC API**：多语言支持好
3. **MVCC + 持续 Watch**：适合 K8s 的 watch 模式
4. **运维简单**：和 K8s 一起部署

```bash
# etcd 集群部署（静态配置）
etcd --name=etcd-1 \
    --initial-cluster="etcd-1=192.168.1.1:2380,etcd-2=192.168.1.2:2380" \
    --initial-cluster-state=new \
    --listen-client-urls=http://192.168.1.1:2379 \
    --initial-advertise-peer-urls=http://192.168.1.1:2380
```

### etcd 的局限

1. 不适合大数据量（建议 < 8GB）
2. 没有原生健康检查
3. 没有多数据中心支持

## 选型建议

### 选 Consul 的场景

- **微服务 + 服务发现**：需要健康检查、DNS 查询
- **多数据中心**：需要跨地域服务发现
- **Consul Connect**：需要服务网格能力
- **动态配置 + KV 存储**：需要简单 KV 能力

### 选 ZooKeeper 的场景

- **Kafka/Hadoop 生态**：必须用 ZooKeeper
- **金融交易系统**：需要极高可靠性
- **Java 技术栈 + Curator**：需要丰富的分布式原语
- **分布式锁、选举**：需要成熟稳定的实现

### 选 etcd 的场景

- **Kubernetes 生态**：别想了，用 etcd
- **Cloud Foundry**：官方支持
- **需要 MVCC + 历史版本**：需要 Watch 历史
- **Go 技术栈**：etcd 官方客户端是 Go 写的

## 总结

三个组件各有侧重，没有绝对的好坏：

- **Consul**：服务发现 + 健康检查 + 多数据中心
- **ZooKeeper**：高可靠 + 成熟生态 + 分布式协调
- **etcd**：K8s 标配 + MVCC + 轻量级 KV

选对场景，才能发挥最大价值。

**面试追问方向：**
- Consul 的 Gossip 协议是怎么工作的？
- ZooKeeper 的 ZAB 和 etcd 的 Raft 有什么区别？
- 为什么 Kubernetes 不用 Consul 做存储后端？
- Consul 的健康检查有哪几种类型？