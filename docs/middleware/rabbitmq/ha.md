# RabbitMQ 高可用与负载均衡

集群搭好了，三个节点稳稳当当。

但新问题来了：

- 客户端怎么知道连哪个节点？
- 生产者该连哪个节点？
- 消费者该连哪个节点？
- 某个节点挂了怎么办？

今天就聊聊 RabbitMQ 的高可用和负载均衡。

## 一、客户端连接策略

### 1. 静态配置（不推荐）

最简单的方式，直接配置所有节点地址：

```java
// 硬编码所有节点（不推荐，生产环境别这么干）
List&lt;String&gt; addresses = Arrays.asList(
    "192.168.1.101:5672",
    "192.168.1.102:5672",
    "192.168.1.103:5672"
);

ConnectionFactory factory = new ConnectionFactory();
factory.setUsername("guest");
factory.setPassword("guest");
factory.setAutomaticRecoveryEnabled(true);  // 启用自动恢复

// 轮询尝试连接
Address[] addressArray = addresses.stream()
    .map(addr -> {
        String[] parts = addr.split(":");
        return new Address(parts[0], Integer.parseInt(parts[1]));
    })
    .toArray(Address[]::new);

Connection connection = factory.newConnection(addressArray);
```

问题：需要维护节点列表，节点变更时所有客户端都要改配置。

### 2. 负载均衡器方案（推荐）

使用负载均衡器（LB）作为入口，客户端只连 LB：

```
                        ┌─────────────────────────────────────────┐
                        │          负载均衡器 (VIP/Nginx)           │
                        │                                          │
                        │   192.168.1.100:5672                      │
                        └──────────────────┬──────────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌─────────────┐        ┌─────────────┐        ┌─────────────┐
            │   Node A    │        │   Node B    │        │   Node C    │
            │             │        │             │        │             │
            │  AMQP 5672  │        │  AMQP 5672  │        │  AMQP 5672  │
            └─────────────┘        └─────────────┘        └─────────────┘
```

**优点**：客户端简单，只需要配置一个地址
**缺点**：LB 是单点，需要 Keepalived 做高可用

### 3. 客户端负载均衡（高级）

一些客户端库支持智能的客户端负载均衡，可以自动发现可用节点：

```java
// Spring Boot + RabbitMQ 客户端支持自动发现
spring:
  rabbitmq:
    addresses: rabbitmq1:5672,rabbitmq2:5672,rabbitmq3:5672
    # 或者使用 DNS 轮询
    addresses: rabbitmq-cluster.local:5672

    # 启用拓扑更新（队列变更时自动同步）
    topology-recovery: true

    # 自动恢复
    connection-timeout: 10000
```

```java
// Java 客户端的自动恢复机制
ConnectionFactory factory = new ConnectionFactory();
factory.setUsername("guest");
factory.setPassword("guest");

// 启用自动恢复
factory.setAutomaticRecoveryEnabled(true);

// 恢复间隔（默认 5 秒）
factory.setNetworkRecoveryInterval(5000);

// 拓扑恢复（队列、交换机、绑定关系自动恢复）
factory.setTopologyRecoveryEnabled(true);
```

## 二、Keepalived + HAProxy 高可用方案

### 架构设计

```
                                    ┌─────────────────┐
                                    │   Keepalived    │
                                    │  (虚拟 IP)       │
                                    │  192.168.1.100   │
                                    └────────┬────────┘
                                             │
                    ┌────────────────────────┼────────────────────────┐
                    │                        │                        │
                    ▼                        ▼                        ▼
            ┌─────────────┐          ┌─────────────┐          ┌─────────────┐
            │   HAProxy   │          │   HAProxy   │          │             │
            │   Node 1    │          │   Node 2    │          │             │
            │  (备机)     │          │  (主机)     │          │             │
            └─────────────┘          └─────────────┘          │             │
                                                                 ▼             ▼
                                                        ┌─────────────┐  ┌─────────────┐
                                                        │   RabbitMQ  │  │   RabbitMQ  │
                                                        │   Node A    │  │   Node B    │
                                                        └─────────────┘  └─────────────┘
                                                        ┌─────────────┐  ┌─────────────┐
                                                        │   RabbitMQ  │  │   RabbitMQ  │
                                                        │   Node C    │  │             │
                                                        └─────────────┘  └─────────────┘
```

### HAProxy 配置

```haproxy
# /etc/haproxy/haproxy.cfg

listen rabbitmq_cluster
    bind 0.0.0.0:5672
    mode tcp
    balance roundrobin

    # RabbitMQ 节点
    server rabbit1 192.168.1.101:5672 check inter 5000 rise 2 fall 3
    server rabbit2 192.168.1.102:5672 check inter 5000 rise 2 fall 3
    server rabbit3 192.168.1.103:5672 check inter 5000 rise 2 fall 3

    # 健康检查
    option tcpchk
    tcp-check send PING\r\n
    tcp-check expect +OK

    # 连接超时
    timeout client 3h
    timeout server 3h

# 管理界面负载均衡
listen rabbitmq_admin
    bind 0.0.0.0:15672
    mode http
    balance roundrobin

    server rabbit1 192.168.1.101:15672 check
    server rabbit2 192.168.1.102:15672 check
    server rabbit3 192.168.1.103:15672 check
```

### Keepalived 配置

```keepalived
# /etc/keepalived/keepalived.conf

vrrp_instance VI_1 {
    state BACKUP
    interface eth0
    virtual_router_id 51
    priority 100
    advert_int 1

    # 主机配置（priority 更高）
    # priority 150
    # state MASTER

    nopreempt  # 非抢占模式

    virtual_ipaddress {
        192.168.1.100  # 虚拟 IP
    }

    track_script {
        chk_haproxy
    }
}

vrrp_script chk_haproxy {
    script "killall -0 haproxy"
    interval 2
    weight 2
}
```

## 三、Federation 插件：跨集群消息同步

### 什么是 Federation？

Federation 是 RabbitMQ 的插件，用于在不同集群之间同步消息，适合异地多活场景。

```
                    ┌─────────────────┐
                    │   北京集群        │
                    │                  │
                    │  Exchange ────▶│ ────▶ 队列
                    └────────┬────────┘
                             │
                      Federation Link
                             │
                             ▼
                    ┌─────────────────┐
                    │   上海集群        │
                    │                  │
                    │  Exchange        │
                    └─────────────────┘
```

### Federation 配置

```bash
# 1. 启用 Federation 插件（所有节点）
rabbitmq-plugins enable rabbitmq_federation
rabbitmq-plugins enable rabbitmq_federation_management

# 2. 上游配置
rabbitmqctl set_parameter federation-upstream my_upstream \
    '{"uri":"amqp://user:pass@rabbitmq-bj.example.com:5672","prefetch-count":1000}'

# 3. 创建 Federation 策略
rabbitmqctl set_policy federation-all "^federation\." \
    '{"federation-upstream-set":"all"}' \
    --priority 1 \
    --apply-to exchanges
```

## 四、Shovel 插件：消息直连转发

### 什么是 Shovel？

Shovel 是另一个插件，用于将消息从一个节点"铲"到另一个节点。与 Federation 的区别是，Shovel 是单向的、更轻量。

```
┌─────────────┐                              ┌─────────────┐
│  Cluster A  │         Shovel              │  Cluster B  │
│             │ ◀─────────────────────────── │             │
│  Queue ────▶│        消息转发              │  Queue      │
│             │                              │             │
└─────────────┘                              └─────────────┘
```

### Shovel 配置

```bash
# 1. 启用 Shovel 插件
rabbitmq-plugins enable rabbitmq_shovel
rabbitmq-plugins enable rabbitmq_shovel_management

# 2. 配置 Shovel
rabbitmqctl set_parameter shovel my_shovel \
'{"src-uri":"amqp://user:pass@cluster-a:5672",\
  "src-queue":"order-queue",\
  "dest-uri":"amqp://user:pass@cluster-b:5672",\
  "dest-queue":"order-queue-backup"}'
```

## 五、客户端高可用最佳实践

### 生产者高可用

```java
public class ReliableProducer {

    private final ConnectionFactory factory;
    private Connection connection;
    private Channel channel;

    public ReliableProducer() {
        factory = new ConnectionFactory();
        factory.setUsername("guest");
        factory.setPassword("guest");

        // 配置多个地址
        factory.setHost("192.168.1.100");  // 负载均衡器地址
        factory.setPort(5672);

        // 启用自动恢复
        factory.setAutomaticRecoveryEnabled(true);
        factory.setNetworkRecoveryInterval(5000);
        factory.setTopologyRecoveryEnabled(true);
    }

    public void ensureConnection() throws Exception {
        if (connection == null || !connection.isOpen()) {
            synchronized (this) {
                if (connection == null || !connection.isOpen()) {
                    connection = factory.newConnection();
                    channel = connection.createChannel();

                    // 开启 Confirm 模式
                    channel.confirmSelect();
                }
            }
        }
    }

    public void sendMessage(String message) throws Exception {
        ensureConnection();

        // 持久化 + Confirm
        channel.basicPublish(
            "exchange",
            "routingKey",
            MessageProperties.PERSISTENT_TEXT_PLAIN,
            message.getBytes()
        );

        // 等待确认（可选）
        channel.waitForConfirmsOrDie(5, TimeUnit.SECONDS);
    }
}
```

### 消费者高可用

```java
public class ReliableConsumer {

    private final ConnectionFactory factory;

    public ReliableConsumer() {
        factory = new ConnectionFactory();
        factory.setUsername("guest");
        factory.setPassword("guest");
        factory.setHost("192.168.1.100");
        factory.setPort(5672);

        // 自动恢复
        factory.setAutomaticRecoveryEnabled(true);
        factory.setNetworkRecoveryInterval(5000);

        // prefetch 控制
        factory.setRequestedHeartbeat(60);
        factory.setRequestedFrameMax(100000);
    }

    public void startConsuming() throws Exception {
        Connection connection = factory.newConnection();
        Channel channel = connection.createChannel();

        // prefetch = 10，平衡吞吐和负载
        channel.basicQos(10);

        // 手动确认
        channel.basicConsume("queue", false, (consumerTag, delivery) -> {
            try {
                processMessage(delivery);
                channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
            } catch (Exception e) {
                // 处理失败，重新入队
                channel.basicNack(delivery.getEnvelope().getDeliveryTag(), false, true);
            }
        }, consumerTag -> {
            // 消费者取消回调
            System.out.println("消费者被取消: " + consumerTag);
        });

        // 添加连接监听器
        ((RecoverableConnection) connection).addRecoveryListener(
            new RecoveryListener() {
                @Override
                public void onRecovery(RecoverableConnection connection) {
                    System.out.println("连接恢复成功");
                }

                @Override
                public void onRecoveryStarted(RecoverableConnection connection) {
                    System.out.println("连接开始恢复");
                }
            }
        );
    }
}
```

### Spring Boot 高可用配置

```yaml
spring:
  rabbitmq:
    # 多个节点地址，逗号分隔
    addresses: 192.168.1.100:5672,192.168.1.101:5672,192.168.1.102:5672

    # 用户名密码
    username: guest
    password: guest

    # 连接配置
    connection-timeout: 10000
    requested-heartbeat: 60

    # 自动恢复
    publisher-confirm-type: correlated
    publisher-returns: true

    # 消费者配置
    listener:
      simple:
        acknowledge-mode: manual
        prefetch: 10
        concurrency: 3
        max-concurrency: 10
        retry:
          enabled: true
          initial-interval: 1000
          max-attempts: 3
          multiplier: 2
```

## 六、高可用方案选择

| 方案 | 适用场景 | 复杂度 | 推荐度 |
|------|---------|--------|--------|
| 客户端直连多节点 | 小规模，简单场景 | 低 | 中 |
| HAProxy + Keepalived | 生产环境主选 | 中 | 高 |
| Federation | 异地多活 | 高 | 中 |
| Shovel | 消息迁移 | 中 | 中 |

## 七、监控与告警

高可用不只是搭建集群，还要监控集群状态：

```bash
# 查看集群健康状态
rabbitmqctl cluster_status

# 查看队列状态
rabbitmqctl list_queues name messages consumers

# 查看连接状态
rabbitmqctl list_connections user peer_host state

# 查看内存使用
rabbitmqctl status | grep memory

# 查看磁盘空间
rabbitmqctl status | grep disk
```

监控指标：

| 指标 | 告警阈值 | 说明 |
|------|---------|------|
| 内存使用 | > 70% | 内存不足可能导致节点崩溃 |
| 磁盘空间 | < 2GB | 持久化需要磁盘空间 |
| 队列堆积 | > 10000 | 消费能力不足 |
| 连接数 | > 1000 | 资源耗尽 |
| 节点存活 | - | 节点离线告警 |

## 八、面试追问

### HAProxy 和 Nginx 都能做负载均衡，选哪个？

| 特性 | HAProxy | Nginx |
|------|---------|-------|
| 协议支持 | AMQP (TCP) | HTTP 为主 |
| 负载均衡算法 | 丰富 | 一般 |
| 健康检查 | 强大 | 基础 |
| 管理界面 | 命令行 | 配置文件 |
| 推荐场景 | RabbitMQ | API 网关 |

对于 RabbitMQ 这类 TCP 协议，推荐使用 HAProxy。

### 仲裁队列需要配合负载均衡器吗？

不需要。仲裁队列本身通过 Raft 协议保证高可用，客户端可以直连任意节点。

但为了简化客户端配置，仍然建议使用负载均衡器，让客户端只需配置一个入口地址。

---

下一个问题留给你：

我们已经聊完了 RabbitMQ 的核心概念、架构、可靠性和高可用。但在消息队列领域，还有一个重量级选手——Kafka。

Kafka 和 RabbitMQ 有什么区别？什么场景该选哪个？

这可能是面试中被问得最多的问题之一。下一节——[RabbitMQ 与 Kafka 对比与选型](/middleware/rabbitmq/kafka-compare)会详细讲解。
