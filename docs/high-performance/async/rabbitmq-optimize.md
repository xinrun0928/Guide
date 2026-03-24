# RabbitMQ 队列镜像与内存控制

RabbitMQ 突然 OOM 了，消息全丢了。

你检查配置，发现队列是单节点部署，没有镜像。Master 节点一挂，消息就丢了。

这是 RabbitMQ 最常见的问题之一：**没有配置高可用**。

## RabbitMQ 队列架构

### 队列的两种类型

RabbitMQ 的队列有两种本质不同的实现：

| 类型 | 存储位置 | 持久化 | 高可用 | 性能 |
|------|---------|--------|--------|------|
| 普通队列 | Master 节点内存 | 可选 | 无 | 高 |
| 镜像队列 | 所有节点内存+磁盘 | 必须 | 原生 | 中 |

### 普通队列 vs 镜像队列

```
普通队列（经典队列）：
┌─────────────────────────────────────────┐
│              RabbitMQ Cluster           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │  Node A  │  │  Node B  │  │  Node C  ││
│  │ (Master) │  │          │  │          ││
│  │ [Queue]  │  │          │  │          ││
│  │ 消息存储 │  │  无队列   │  │  无队列   ││
│  └──────────┘  └──────────┘  └──────────┘│
│                                          │
│ 问题：Node A 挂了 → 队列不可用 → 消息丢失   │
└─────────────────────────────────────────┘

镜像队列：
┌─────────────────────────────────────────┐
│              RabbitMQ Cluster           │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐│
│  │  Node A  │  │  Node B  │  │  Node C  ││
│  │(Master)  │  │ (Slave)  │  │ (Slave)  ││
│  │ [Queue]  │  │ [Queue]  │  │ [Queue]  ││
│  │  同步    │  │  同步    │  │  同步    ││
│  └──────────┘  └──────────┘  └──────────┘│
│                                          │
│ 优点：任一节点挂了 → 其他节点继续服务       │
└─────────────────────────────────────────┘
```

## 镜像队列配置

### 策略（Policy）配置

镜像队列通过 **Policy** 来配置，而不是直接定义。

```bash
# 使用 rabbitmqctl 配置镜像策略
rabbitmqctl set_policy ha-all "^orders\." \
    '{"ha-mode":"all","ha-sync-mode":"automatic"}' \
    --priority 1 \
    --apply-to queues

# 解释：
# ha-all：策略名称
# ^orders\.：匹配以 "orders." 开头的队列（正则）
# ha-mode: all：所有节点都是镜像
# ha-sync-mode: automatic：自动同步
```

### ha-mode 三种模式

| 模式 | 含义 | 镜像节点数 | 适用场景 |
|------|------|-----------|---------|
| `all` | 所有节点都是镜像 | 集群全部节点 | 高可靠性优先 |
| `exactly` | 指定数量的镜像 | N 个节点 | 资源受限 |
| `nodes` | 指定特定节点 | 自定义 | 特定节点部署 |

```bash
# 模式一：所有节点镜像
rabbitmqctl set_policy ha-all "^orders\." '{"ha-mode":"all"}'

# 模式二：exactly 模式（3 节点集群，2 个镜像）
rabbitmqctl set_policy ha-exactly "^orders\." '{"ha-mode":"exactly","ha-params":2}'

# 模式三：指定节点镜像
rabbitmqctl set_policy ha-nodes "^orders\." \
    '{"ha-mode":"nodes","ha-params":["rabbit@node1","rabbit@node2"]}'
```

### Java 代码配置策略

```java
@Configuration
public class RabbitMQConfig {
    
    @Autowired
    private CachingConnectionFactory connectionFactory;
    
    @Bean
    public Policy myPolicy() {
        // 方式1：Spring Boot 自动配置
        // 在 application.yml 中配置
        
        // 方式2：Java API 配置
        Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
        args.put("ha-mode", "all");
        args.put("ha-sync-mode", "automatic");  // 自动同步
        args.put("ha-promote-on-shutdown", "always");  // Master 挂了自动提升
        
        Policy policy = Policy.builder()
            .name("ha-all-policy")
            .pattern("^orders\\..*")  // 匹配 orders.xxx 队列
            .definition(args)
            .priority(1)
            .applyTo(Policy.applyTo.QUEUE)
            .build();
        
        return policy;
    }
}
```

```yaml
# application.yml 配置
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: guest
    password: guest
```

```xml
&lt;!-- rabbitmq.conf 配置（需重启） --&gt;
# 在 /etc/rabbitmq/rabbitmq.conf 中添加
# 定义默认镜像策略
# 需要在 Management 界面手动创建，或使用 rabbitmqctl
```

## 内存控制

RabbitMQ 内存管理是生产环境的重点。内存爆了会导致：

1. 队列停止接收消息
2. 连接被关闭
3. 节点不可用

### 内存阈值配置

```bash
# 默认：RabbitMQ 使用 40% 内存后报警，50% 后阻塞
# 可调整
vm_memory_high_watermark.relative = 0.6  # 60% 报警
vm_memory_high_watermark.absolute = 8GB   # 绝对值 8GB
```

### 队列内存限制

```java
// 队列参数设置
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-max-length", 10000);           // 队列最大消息数
args.put("x-max-length-bytes", 1GB);        // 队列最大内存
args.put("x-overflow", "reject-publish");  // 溢出策略：拒绝发布
// 其他选项：drop-head（丢弃旧消息）

// 创建队列
channel.queueDeclare("orders.queue", true, false, false, args);
```

### 惰性队列（Lazy Queue）

对于消息量大但不急着消费的场景，用惰性队列将消息存入磁盘：

```java
// 惰性队列：消息存入磁盘，按需加载到内存
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-queue-mode", "lazy");

channel.queueDeclare("orders.queue", true, false, false, args);
```

```
普通队列 vs 惰性队列：

普通队列：
消息进来 → 存入内存 → 消费时从内存取
内存占用高，访问快

惰性队列：
消息进来 → 存入磁盘 → 消费时从磁盘加载
内存占用低，访问慢（但可控）
```

### 内存监控

```java
// 使用 Management API 监控内存
@RestController
public class RabbitMQMonitor {
    
    @Autowired
    private RabbitMQAdminTemplate adminTemplate;
    
    @GetMapping("/rabbitmq/memory")
    public Map&lt;String, Object&gt; getMemoryInfo() {
        // 获取集群内存使用情况
        Map&lt;String, Object&gt; info = new HashMap&lt;&gt;();
        info.put("memory_used", getMemoryUsage());
        info.put("memory_limit", getMemoryLimit());
        info.put("memory_percent", calculatePercent());
        return info;
    }
    
    @GetMapping("/rabbitmq/queue/{name}")
    public Map&lt;String, Object&gt; getQueueInfo(@PathVariable String name) {
        // 获取队列详情
        return Map.of(
            "messages", getQueueMessageCount(name),
            "messages_ready", getReadyMessageCount(name),
            "messages_unacked", getUnackedCount(name),
            "memory", getQueueMemory(name)
        );
    }
}
```

## 镜像队列的同步机制

### 同步模式

| 同步模式 | 说明 | 延迟 | 一致性 |
|---------|------|------|--------|
| `manual`（默认） | Master 挂了手动同步 | 无延迟同步 | 强一致 |
| `automatic` | 自动同步新 Slave | 同步有延迟 | 最终一致 |

```bash
# 查看队列同步状态
rabbitmqctl list_queues name synchronized_slave_pids

# 手动同步
rabbitmqctl sync_queue "orders.queue"
```

### 脑裂问题与解决方案

RabbitMQ 集群可能出现脑裂（Split-Brain）：

```
脑裂场景：
网络分区 → Node A 和 Node B 互相认为对方挂了
         → 各自选主 → 两个 Master → 数据不一致
```

解决方案：

```bash
# 配置集群分裂处理策略
# 在 rabbitmq.conf 中
cluster_partition_handling = pause_minority
# 或
cluster_partition_handling = autoheal

# pause_minority：少数派节点暂停，等待多数派恢复
# autoheal：自动恢复，牺牲少数派节点
```

## 最佳实践总结

### 1. 高可用配置

```java
// 生产环境配置
@Configuration
public class RabbitMQHAConfig {
    
    @Bean
    public ConnectionFactory connectionFactory() {
        CachingConnectionFactory factory = new CachingConnectionFactory();
        
        // 配置集群地址
        factory.setAddresses("node1:5672,node2:5672,node3:5672");
        factory.setUsername("admin");
        factory.setPassword("password");
        
        // 启用 Publisher Confirms
        factory.setPublisherConfirmType(CachingConnectionFactory.ConfirmType.CORRELATED);
        
        // 启用 Publisher Returns
        factory.setPublisherReturns(true);
        
        return factory;
    }
}
```

### 2. 消息持久化

```java
// 确保消息不丢
public class MessageProducer {
    
    @Autowired
    private RabbitTemplate rabbitTemplate;
    
    public void sendOrder(Order order) {
        rabbitTemplate.convertAndSend(
            "orders.exchange",      // 交换机
            "orders.created",       // routing key
            order,                  // 消息体
            message -&gt; {
                // 持久化消息
                message.getMessageProperties().setDeliveryMode(MessageDeliveryMode.PERSISTENT);
                // 优先级
                message.getMessageProperties().setPriority(order.getPriority());
                return message;
            },
            new CorrelationData(order.getId())  // 用于确认
        );
    }
}
```

### 3. 消费确认

```java
// 确保消息被正确消费后才确认
@RabbitListener(queues = "orders.queue")
public class OrderConsumer {
    
    @RabbitHandler
    public void handleOrder(Order order, Channel channel, @Header(AmqpHeaders.DELIVERY_TAG) long tag) {
        try {
            // 业务处理
            processOrder(order);
            
            // 手动确认
            channel.basicAck(tag, false);
        } catch (Exception e) {
            log.error("处理订单失败", e);
            
            // 处理失败：重新入队或进入死信队列
            channel.basicNack(tag, false, false);  // 不重试，进入 DLX
        }
    }
}
```

### 4. 队列参数配置

```java
@Bean
public Queue ordersQueue() {
    Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
    
    // 死信交换机
    args.put("x-dead-letter-exchange", "orders.dlx");
    args.put("x-dead-letter-routing-key", "orders.dead");
    
    // 队列长度限制
    args.put("x-max-length", 100000);
    args.put("x-overflow", "reject-publish");
    
    return new Queue("orders.queue", true, false, false, args);
}
```

## 总结

RabbitMQ 高可用要点：

| 配置项 | 推荐值 | 说明 |
|--------|--------|------|
| 镜像模式 | `all` | 所有节点镜像 |
| 同步模式 | `automatic` | 自动同步新节点 |
| 分裂处理 | `pause_minority` | 防止脑裂 |
| 内存高水位 | 60% | 报警阈值 |
| 队列模式 | `lazy` | 大队列用惰性队列 |
| 消息持久化 | 必须 | 防止内存数据丢失 |

---

## 留给你的问题

假设你的电商系统使用 RabbitMQ，每天处理 100 万订单：

1. 订单交换机和队列应该怎么配置镜像策略？
2. 如果高峰期队列积压了 50 万消息，内存快不够了，你该怎么办？
3. Master 节点挂了，Slave 节点接管需要多久？这期间消息会怎样？
4. 如果你发现某条消息一直消费失败，进入了死信队列，你如何处理？

思考这些问题，能帮助你设计更健壮的 RabbitMQ 架构。
