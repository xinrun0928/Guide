# RabbitMQ 核心概念：Exchange、Queue、Binding、RouteKey

你有没有遇到过这种情况：线上消息丢了，你查了半天日志，发现消息根本没到队列——它卡在了某个叫"交换机"的东西里。

但等等，消息不是应该直接扔进队列吗？为什么要有个"交换机"？

这是理解 RabbitMQ 的第一个门槛。搞懂这个概念，后面的东西都会变得清晰起来。

## 一、消息队列的"邮局模型"

把 RabbitMQ 想象成一个邮局系统：

- **Producer（生产者）**：寄件人，把信扔进邮局的收件口
- **Exchange（交换机）**：邮局的分拣中心，决定信该往哪走
- **Queue（队列）**：邮筒，存放等待被取走的信件
- **Consumer（消费者）**：收件人，从邮筒取信
- **Binding（绑定）**：分拣规则，告诉分拣中心"哪种信该往哪个邮筒扔"
- **RouteKey（路由键）**：信封上的地址标签，分拣中心根据它决定路由

```java
// 生产者发送消息到交换机
channel.basicPublish(
    "exchange.name",  // 交换机名称
    "order.created",  // 路由键
    null,
    message.getBytes()
);
```

所以消息的流转路径是：**Producer → Exchange → Binding → Queue → Consumer**

关键问题来了：交换机是怎么知道把消息送到哪个队列的？

## 二、Exchange：消息的分发中心

Exchange 是 RabbitMQ 的核心组件，它负责接收生产者发送的消息，然后根据规则决定把消息送到哪里。

Exchange 本身不存储消息（除了特殊的 Headers Exchange），它只是做路由决策。

```java
// 声明交换机
channel.exchangeDeclare(
    "order.exchange",  // 交换机名称
    "direct",          // 交换机类型
    true,              // 是否持久化
    false,             // 是否自动删除
    null               // 其他参数
);
```

Exchange 有四个核心属性：

| 属性 | 说明 |
|-----|------|
| Name | 交换机名称，唯一标识 |
| Type | 交换机类型（direct/fanout/topic/headers） |
| Durable | 是否持久化，重启后是否存在 |
| Auto Delete | 所有绑定队列解绑后是否自动删除 |

## 三、Queue：消息的终点站

Queue 是消息真正存储的地方，消费者从这里取消息。

Queue 有几个重要特性：

```java
// 声明队列
channel.queueDeclare(
    "order.queue",  // 队列名称
    true,           // 是否持久化
    false,          // 是否独占（只允许一个消费者）
    false,          // 是否自动删除
    null            // 其他参数（TTL、死信队列等）
);
```

### 排他队列的坑

如果声明了 `exclusive=true`，这个队列只允许当前连接使用，其他连接无法访问。

很多人踩过这个坑：在开发环境声明了一个独占队列，连接断了一下，队列直接被删了。

```java
// 独占队列只允许当前连接使用
channel.queueDeclare("temp.queue", true, true, false, null);
// 连接断开后，队列自动删除
```

### 队列的持久化

Queue 本身可以持久化，但光持久化队列不够——消息和交换机也需要持久化。这三个东西组合在一起，才能保证消息不丢。后面的[消息持久化](/middleware/rabbitmq/persistence)会详细讲解。

## 四、Binding：交换机和队列的"接线图"

Binding 是连接 Exchange 和 Queue 的桥梁，告诉交换机："满足这个条件的消息，请送到这个队列"。

```java
// 将队列绑定到交换机，并指定路由键
channel.queueBind(
    "order.queue",       // 队列名称
    "order.exchange",    // 交换机名称
    "order.created"       // 路由键
);
```

一个 Exchange 可以绑定多个 Queue，一个 Queue 也可以绑定到多个 Exchange。这就像：

- 一个快递柜（Queue）可以接收多家快递公司（Exchange）的包裹
- 一家快递公司（Exchange）可以把不同类型的包裹（路由键）送到不同的快递柜（Queue）

## 五、RouteKey：消息的"地址标签"

RouteKey 是生产者发送消息时指定的路由键，Exchange 根据它来决定把消息送到哪个队列。

```
路由键格式示例：
order.created     → 订单创建事件
order.paid        → 订单支付事件
order.cancelled   → 订单取消事件
```

需要注意的是，RouteKey 的匹配规则取决于 Exchange 类型：

- **Direct Exchange**：精确匹配，路由键必须完全相等
- **Topic Exchange**：支持通配符匹配
- **Fanout Exchange**：忽略路由键，广播到所有绑定队列
- **Headers Exchange**：根据消息头匹配

不同 Exchange 类型的详细规则，在[交换机类型](/middleware/rabbitmq/exchange-type)会详细讲解。

## 六、四者关系图解

```
                    ┌─────────────────────────────────────┐
                    │            Exchange                 │
                    │   (分拣中心，决定消息去哪儿)          │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    │              │              │
              Binding          Binding          Binding
           (binding key)   (binding key)   (binding key)
           "order.*"       "payment.*"     "*.created"
                    │              │              │
                    ▼              ▼              ▼
              ┌─────────┐   ┌─────────┐   ┌─────────┐
              │ Queue 1 │   │ Queue 2 │   │ Queue 3 │
              │ order.* │   │payment.*│   │ *.created│
              └────┬────┘   └────┬────┘   └────┬────┘
                   │              │              │
                   └──────────────┴──────────────┘
                                  │
                            Consumer
                         (消费者，从队列取消息)
```

## 七、实际代码演示

完整的创建和绑定流程：

```java
public void setupOrderSystem() throws Exception {
    // 1. 声明交换机
    channel.exchangeDeclare("order.exchange", "topic", true);

    // 2. 声明队列
    channel.queueDeclare("order.queue", true, false, false, null);
    channel.queueDeclare("payment.queue", true, false, false, null);
    channel.queueDeclare("notification.queue", true, false, false, null);

    // 3. 绑定队列到交换机
    // 订单相关消息
    channel.queueBind("order.queue", "order.exchange", "order.*");
    // 支付相关消息
    channel.queueBind("payment.queue", "order.exchange", "payment.*");
    // 所有创建类消息（用来发通知）
    channel.queueBind("notification.queue", "order.exchange", "*.created");
}

// 生产者发送消息
public void sendOrderCreated(String orderId) throws Exception {
    String message = "订单创建: " + orderId;
    // 路由键决定了消息会被哪些队列接收
    channel.basicPublish("order.exchange", "order.created", null, message.getBytes());
}
```

运行这个代码后，`order.created` 消息会被投放到：

1. `order.queue`（匹配 `order.*`）
2. `notification.queue`（匹配 `*.created`）

## 八、面试追问

Exchange 和 Queue 之间的 Binding 是单向的吗？

是的，Binding 是单向的——从 Exchange 到 Queue。如果你需要双向通信，需要建立两个 Binding。

一个 Queue 能绑定到多个 Exchange 吗？

可以。一个队列可以同时接收来自多个交换机的消息，这在解耦和多元化消费场景下非常有用。

---

下一个问题留给你：

如果生产者发送了一条消息，但没有任何队列能匹配上这条消息的路由键，消息会怎么样？

它会直接消失，还是会被保存起来？这个问题的答案，涉及到 RabbitMQ 的一个重要机制—— Mandatory 模式。下一节我们讲[交换机类型](/middleware/rabbitmq/exchange-type)时会深入探讨。
