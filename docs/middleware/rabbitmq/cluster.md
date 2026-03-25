# RabbitMQ 集群模式：普通集群 vs 镜像集群 vs 仲裁队列

你的系统越做越大，单节点 RabbitMQ 已经扛不住了。

每天百万级别的消息量，让你不得不考虑集群部署。

但集群怎么搭？节点之间数据怎么同步？某个节点挂了怎么办？

今天就聊聊 RabbitMQ 的三种集群模式。

## 一、集群的基本概念

### 为什么要集群？

| 目的 | 说明 |
|------|------|
| 高可用 | 单点故障时自动切换 |
| 高吞吐 | 多节点分担负载 |
| 容量扩展 | 存储空间可以横向扩展 |
| 低延迟 | 消费者可以连接就近节点 |

### RabbitMQ 集群的两种模式

```
┌─────────────────────────────────────────────────────────────────┐
│                        RabbitMQ 集群                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │
│   │   Node A    │  │   Node B    │  │   Node C    │          │
│   │              │  │              │  │              │          │
│   │  Exchange    │  │  Exchange    │  │  Exchange    │          │
│   │  Queue 1     │  │  Queue 2     │  │  Queue 3     │          │
│   │  Queue 2     │  │              │  │              │          │
│   │              │  │              │  │              │          │
│   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘          │
│          │                 │                 │                  │
│          └─────────────────┼─────────────────┘                  │
│                            │                                    │
│                     Erlang Cookie                               │
│                     (集群认证密钥)                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

RabbitMQ 集群基于 Erlang 的分布式特性，通过 **Erlang Cookie** 进行节点间认证。

## 二、普通集群（Classic Cluster）

### 工作原理

普通集群模式下，队列只存在于一个节点上，其他节点只保存队列的元数据（名称、属性、绑定关系等）。

```
普通集群（Queue 只在一个节点上）：

                    ┌────────────────────────────────────────────┐
                    │                   集群                      │
                    └────────────────────────────────────────────┘
                                       │
       ┌──────────────────────────────┼──────────────────────────────┐
       │                              │                              │
       ▼                              ▼                              ▼
┌─────────────┐              ┌─────────────┐              ┌─────────────┐
│   Node A    │              │   Node B    │              │   Node C    │
│              │              │              │              │              │
│ Exchange     │              │ Exchange     │              │ Exchange     │
│ Queue 1 (主) │              │ Queue 1 (元数据)             │ Queue 1 (元数据)             │
│              │◀── 客户端连接 ─│              │              │              │
└─────────────┘              └─────────────┘              └─────────────┘
       │
       │ 如果消费者连接 Node B 或 Node C
       │ 消息会从 Node A 拉取到对应节点，再投递给消费者
       ▼
消息跨节点传输，需要额外网络开销
```

### 配置普通集群

```bash
# 1. 准备三台服务器，配置相同的 Erlang Cookie
# Cookie 文件位置: /var/lib/rabbitmq/.erlang.cookie

# 2. Node A 启动
rabbitmq-server -detached

# 3. Node B 加入集群
rabbitmqctl stop_app
rabbitmqctl join_cluster --ram rabbit@nodeA  # --ram 表示内存节点
rabbitmqctl start_app

# 4. Node C 加入集群
rabbitmqctl stop_app
rabbitmqctl join_cluster --disc rabbit@nodeA  # --disc 表示磁盘节点
rabbitmqctl start_app

# 5. 查看集群状态
rabbitmqctl cluster_status
```

### 普通集群的特点

| 特性 | 说明 |
|------|------|
| 数据同步 | 只同步元数据，队列数据不同步 |
| 队列位置 | 队列只存在于创建它的节点上 |
| 高可用 | 节点挂了，队列不可用 |
| 适用场景 | 水平扩展消费者，提高吞吐 |

### 普通集群的问题

```
问题场景：Node A 挂了

                    ┌────────────────────────────────────────────┐
                    │                   集群                      │
                    └────────────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
┌─────────────┐              ┌─────────────┐              ┌─────────────┐
│   Node A     │              │   Node B    │              │   Node C    │
│   (挂了!)    │              │              │              │              │
│              │              │ Exchange     │              │ Exchange     │
│              │              │ Queue 1 (元数据)              │ Queue 1 (元数据)              │
│              │              │              │              │              │
└─────────────┘              └─────────────┘              └─────────────┘
                                    │                               │
                                    │ Queue 1 不可用！             │
                                    ▼                               ▼
                            消息堆积，无法消费              消费者报错
```

**核心问题**：队列数据只存在 Node A 上，Node A 挂了，队列就不可用了。

## 三、镜像集群（Mirrored Cluster）

### 工作原理

镜像集群解决了普通集群的问题。队列会在所有节点上创建镜像，消息会自动同步到所有镜像节点。

```
镜像集群（Queue 在所有节点上都有副本）：

                    ┌────────────────────────────────────────────┐
                    │                   集群                      │
                    └────────────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
┌─────────────┐              ┌─────────────┐              ┌─────────────┐
│   Node A    │              │   Node B    │              │   Node C    │
│              │              │              │              │              │
│ Exchange     │              │ Exchange     │              │ Exchange     │
│ Queue 1 (主) │              │ Queue 1 (从) │              │ Queue 1 (从) │
│              │◀── 同步 ────▶│              │◀── 同步 ────▶│              │
└─────────────┘              └─────────────┘              └─────────────┘
       │                               ▲                               ▲
       │            主从同步           │            主从同步            │
       └───────────────────────────────┼───────────────────────────────┘
                                        │
                                 任意节点可访问
```

### 配置镜像集群

镜像集群通过 **Policy（策略）** 配置：

```bash
# 方式一：命令行配置
rabbitmqctl set_policy ha-all "^order\." \
    '{"ha-mode":"all","ha-sync-mode":"automatic"}' \
    --priority 1 \
    --apply-to queues

# 方式二：管理界面配置
# Admin → Policies → Add / Update a policy
```

### 镜像集群参数说明

| 参数 | 值 | 说明 |
|------|---|------|
| ha-mode | all/exactly/nodes | 镜像模式：全部节点/指定数量/指定节点 |
| ha-sync-mode | manual/automatic | 同步模式：手动/自动 |
| ha-promote-on-shutdown | always/when-synced | 节点关闭时是否提升从节点 |
| ha-params | 数量 | 当 ha-mode=exactly 时指定数量 |

```bash
# 示例：order 开头队列镜像到所有节点，自动同步
rabbitmqctl set_policy order-mirror "^order\." \
    '{"ha-mode":"all","ha-sync-mode":"automatic"}'
```

### 镜像集群的特点

| 特性 | 说明 |
|------|------|
| 数据同步 | 消息同步到所有镜像节点 |
| 主节点 | 只有一个主节点（master），接收读写 |
| 故障转移 | 主节点挂了，从节点自动提升 |
| 一致性 | 强一致，数据不丢失 |

### 镜像集群的问题

```
问题一：网络分区（脑裂）

                    ┌────────────────────────────────────────────┐
                    │              网络分区                        │
                    └────────────────────────────────────────────┘
                           │                    │
                ┌──────────┴──┐              ┌─┴──────────┐
                │  分区 A     │              │  分区 B    │
                └─────────────┘              └───────────┘
                       │                            │
                       ▼                            ▼
               ┌─────────────┐              ┌─────────────┐
               │ Node A (主) │              │ Node B (主) │
               │ Node C      │              │ Node C      │
               └─────────────┘              └─────────────┘
                      │                            │
                      │  两个主节点！               │
                      │  数据可能不一致              │
                      ▼                            ▼
               客户端 A 写入              客户端 B 写入
               可能丢失                     可能丢失

问题二：镜像延迟
所有消息都要同步到所有镜像，网络延迟增加，吞吐量下降。
```

## 四、仲裁队列（Quorum Queue）

### 为什么需要仲裁队列？

镜像集群虽然解决了高可用问题，但有几个致命缺陷：

1. **网络分区风险**：网络分裂时可能丢消息
2. **同步性能差**：每次写入都要同步所有镜像
3. **配置复杂**：需要仔细规划镜像策略
4. **行为不一致**：不同场景下行为不同

RabbitMQ 3.8 引入了**仲裁队列**，用 Raft 共识算法重新实现高可用队列。

### 仲裁队列的工作原理

```
仲裁队列（Raft 共识算法）：

                    ┌────────────────────────────────────────────┐
                    │              共识组                        │
                    └────────────────────────────────────────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
┌─────────────┐              ┌─────────────┐              ┌─────────────┐
│   Node A    │              │   Node B    │              │   Node C    │
│              │              │              │              │              │
│  Leader      │◀── Raft ────▶│  Follower   │◀── Raft ────▶│  Follower   │
│  (写入必须)  │              │              │              │              │
└─────────────┘              └─────────────┘              └─────────────┘
       ▲                               │                               │
       │                               │                               │
       │                    大多数节点确认后                             │
       │                    写入成功                                   │
       └───────────────────────────┘
```

### 声明仲裁队列

```java
// 方式一：Java API
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-queue-type", "quorum");  // 关键：声明为仲裁队列
args.put("x-quorum-initial-group-size", 3);  // 初始节点数

channel.queueDeclare("order.queue", true, false, false, args);

// 方式二：命令行
rabbitmqadmin declare queue name=order.queue durable=true arguments='{"x-queue-type":"quorum"}'
```

### 仲裁队列 vs 镜像队列

| 特性 | 镜像队列 | 仲裁队列 |
|------|---------|---------|
| 共识算法 | 无 | Raft |
| 数据一致性 | 弱一致 | 强一致 |
| 网络分区 | 可能丢消息 | 不丢消息 |
| 写入性能 | 较快 | 稍慢（需要多数节点确认） |
| 磁盘使用 | 较低 | 较高 |
| 最小节点数 | 1 | 3 |
| 配置复杂度 | 高 | 低 |
| 删除策略 | 复杂 | 简单（仅 leader 可删除） |

```java
// 仲裁队列不支持的功能（注意兼容性问题）
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-queue-type", "quorum");

// 仲裁队列不支持以下参数
// x-message-ttl（队列级别）- 使用消息本身 TTL
// x-expires - 使用 x-queue-ttl
// x-max-length - 使用 x-max-length-bytes
// x-overflow - 不支持 drop-head
```

### Spring Boot 配置仲裁队列

```yaml
spring:
  rabbitmq:
    queue:
      type: quorum  # 全局设置为仲裁队列
```

```java
// 单队列设置为仲裁队列
@Bean
public Queue orderQueue() {
    return QueueBuilder.durable("order.queue")
        .withArgument("x-queue-type", "quorum")
        .build();
}
```

## 五、集群模式选择指南

```
                        ┌─────────────────────────┐
                        │    需要高可用吗？         │
                        └───────────┬─────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                   是                                否
                    │                               │
                    ▼                               ▼
        ┌───────────────────────┐       ┌───────────────────────┐
        │   数据一致性要求高吗？   │       │    普通集群            │
        └───────────┬───────────┘       │   (扩展消费者)          │
                    │                   └───────────────────────┘
          ┌─────────┴─────────┐
          │                   │
         是                   否
          │                   │
          ▼                   ▼
  ┌─────────────┐    ┌─────────────────┐
  │  仲裁队列    │    │   镜像队列       │
  │ (Quorum)    │    │ (Classic Mirrored)│
  │  推荐选择    │    │  已不推荐使用    │
  └─────────────┘    └─────────────────┘
```

## 六、集群配置完整示例

```bash
# 1. 配置 hosts 文件（所有节点）
echo "192.168.1.101 rabbitmq1" >> /etc/hosts
echo "192.168.1.102 rabbitmq2" >> /etc/hosts
echo "192.168.1.103 rabbitmq3" >> /etc/hosts

# 2. 同步 Erlang Cookie（所有节点相同）
scp /var/lib/rabbitmq/.erlang.cookie rabbit@rabbitmq2:/var/lib/rabbitmq/
scp /var/lib/rabbitmq/.erlang.cookie rabbit@rabbitmq3:/var/lib/rabbitmq/

# 3. 启动所有节点
ssh rabbitmq1 "rabbitmq-server -detached"
ssh rabbitmq2 "rabbitmq-server -detached"
ssh rabbitmq3 "rabbitmq-server -detached"

# 4. 组建集群
ssh rabbitmq2 "rabbitmqctl stop_app && rabbitmqctl join_cluster --disc rabbit@rabbitmq1 && rabbitmqctl start_app"
ssh rabbitmq3 "rabbitmqctl stop_app && rabbitmqctl join_cluster --disc rabbit@rabbitmq1 && rabbitmqctl start_app"

# 5. 配置仲裁队列策略
rabbitmqctl set_policy ha "^ha\." '{"ha-mode":"quorum"}' --priority 1 --apply-to queues

# 6. 开启管理界面
rabbitmq-plugins enable rabbitmq_management

# 7. 配置负载均衡（可选）
# 使用 HAProxy 或 Nginx 将请求分发到多个节点
```

## 七、面试追问

### 仲裁队列为什么需要至少 3 个节点？

仲裁队列使用 Raft 共识算法，需要**多数节点**（过半数）确认才能写入。

- 2 节点：多数 = 2，但 1 节点挂了就没有多数了
- 3 节点：多数 = 2，容忍 1 节点故障
- 5 节点：多数 = 3，容忍 2 节点故障

所以 Raft 要求**奇数个节点**，最少 3 个。

### 普通集群的队列可以跨节点访问吗？

可以，但有性能损耗。

假设队列在 Node A，消费者连接 Node B：

1. 消费者从 Node B 拉取消息
2. Node B 向 Node A 发起内部请求
3. Node A 把消息复制到 Node B
4. Node B 把消息投递给消费者

这就是**经典的"傻队列"问题**。所以普通集群适合的场景是：队列在哪，消费者的连接就在哪。

---

下一个问题留给你：

集群搭好了，但客户端怎么知道连哪个节点？如果某个节点挂了，客户端怎么自动切换？

这涉及到客户端负载均衡和服务发现的问题。下一节——[RabbitMQ 高可用与负载均衡](/middleware/rabbitmq/ha)会详细讲解。
