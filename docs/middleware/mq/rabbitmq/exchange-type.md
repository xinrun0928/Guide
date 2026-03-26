# RabbitMQ 交换机类型：Direct、Fanout、Topic、Headers

上回说到，交换机是 RabbitMQ 的分拣中心。

但你可能有个疑问：分拣中心是怎么决定消息去哪个队列的？靠什么规则？

这就要说到交换机的四种类型了。它们各有各的性格——有的精确到骨子里，有的豪放到全部广播，有的灵活到支持通配符，还有的看心情（看消息头）。

## 一、Direct Exchange：精确匹配，只走一条路

Direct 是最简单、最常用的交换机类型。它的规则很简单：**路由键完全相等，消息就送到对应的队列**。

```
Direct Exchange 工作流程：

路由键 "order.created" ──┬── 绑定键 "order.created" ──→ Queue A
                          │
                          └── 绑定键 "order.paid" ──→ Queue B (不匹配)

只有绑定键和路由键完全相等，消息才会被送达。
```

```java
// 声明 Direct 交换机
channel.exchangeDeclare("order.exchange", "direct", true);

// 绑定队列，指定精确的路由键
channel.queueBind("email.queue", "order.exchange", "order.created");
channel.queueBind("sms.queue", "order.exchange", "order.paid");
```

### 典型场景

Direct 交换机适合**一对一的精确路由**：

- 订单创建 → 发送邮件
- 订单支付 → 发送短信
- 订单发货 → 更新物流系统

每个路由键对应一个特定的处理逻辑，消息不会同时被多个消费者处理。

## 二、Fanout Exchange：广播消息，所有队列都收到

Fanout 是最"博爱"的交换机。它**完全忽略路由键**，把消息复制一份，投递给所有绑定到它的队列。

```
Fanout Exchange 工作流程：

                    ┌──────────────┐
                    │   Exchange   │
                    │   (fanout)   │
                    └──────┬───────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
     ┌─────────┐      ┌─────────┐      ┌─────────┐
     │ Queue A │      │ Queue B │      │ Queue C │
     └─────────┘      └─────────┘      └─────────┘

消息被复制 N 份，每个队列都收到完整的消息副本。
```

```java
// 声明 Fanout 交换机
channel.exchangeDeclare("notification.exchange", "fanout", true);

// 绑定多个队列
channel.queueBind("email.queue", "notification.exchange", "");
channel.queueBind("sms.queue", "notification.exchange", "");
channel.queueBind("push.queue", "notification.exchange", "");
```

### 典型场景

Fanout 交换机适合**一对多的广播通知**：

- 系统通知 → 同时发邮件、短信、推送
- 数据同步 → 同时更新缓存、搜索引擎、日志系统
- 事件驱动 → 触发多个下游系统的业务流程

所有消费者都能收到相同的消息，各自独立处理。

## 三、Topic Exchange：模糊匹配，灵活路由

Topic 是最灵活的交换机类型。它使用**通配符匹配**规则：

| 通配符 | 含义 | 示例 |
|-------|------|------|
| `*` | 精确匹配一个词 | `order.*` 匹配 `order.created`、`order.paid` |
| `#` | 匹配零个或多个词 | `order.#` 匹配 `order`、`order.created`、`order.created.v2` |

路由键由点号分隔的单词组成，`*` 匹配一个单词，`#` 匹配零个或多个单词。

```
Topic Exchange 工作流程：

路由键 "order.created" ─┬── "order.*" ──→ Queue A ✓
                         ├── "*.created" ──→ Queue B ✓
                         └── "order.#" ──→ Queue C ✓

路由键 "order" ─┬── "order.*" ──→ Queue A ✗ (需要精确一个词)
                └── "order.#" ──→ Queue C ✓ (# 可以匹配 0 个词)
```

```java
// 声明 Topic 交换机
channel.exchangeDeclare("trading.exchange", "topic", true);

// 绑定队列，支持通配符
// Queue A: 处理所有订单相关消息
channel.queueBind("order.queue", "trading.exchange", "order.*");
// Queue B: 处理所有创建类消息
channel.queueBind("created.queue", "trading.exchange", "#.created");
// Queue C: 处理股票交易消息
channel.queueBind("stock.queue", "trading.exchange", "stock.#");
```

### 典型场景

Topic 交换机适合**灵活的消息分类和路由**：

- 电商平台：根据 `商品类目.操作类型` 路由
- 日志系统：根据 `系统.环境.级别` 路由
- 物联网：根据 `设备类型.事件类型.地区` 路由

## 四、Headers Exchange：看消息头，不看路由键

Headers 是最"有个性"的交换机。它**完全忽略路由键**，根据消息头的属性来匹配。

```java
// 声明 Headers 交换机
channel.exchangeDeclare("headers.exchange", "headers", true);

// 绑定时指定消息头匹配规则
Map&lt;String, Object&gt; args = new HashMap&lt;&gt;();
args.put("x-match", "all");  // all: 所有属性都匹配  any: 任一属性匹配
args.put("format", "pdf");
args.put("type", "report");
channel.queueBind("pdf.queue", "headers.exchange", "", args);

// 发送消息时设置消息头
Map&lt;String, Object&gt; headers = new HashMap&lt;&gt;();
headers.put("format", "pdf");
headers.put("type", "report");
channel.basicPublish("headers.exchange", "",
    new AMQP.BasicProperties.Builder().headers(headers).build(),
    message.getBytes());
```

### x-match 的两种模式

| 模式 | 含义 | 匹配条件 |
|------|------|---------|
| `x-match: all` | 所有属性都匹配 | headers 中所有 key-value 都与绑定参数一致 |
| `x-match: any` | 任一属性匹配 | headers 中任意一个 key-value 与绑定参数一致 |

### 典型场景

Headers 交换机适合**多维度、复杂条件的消息路由**：

- 根据内容类型和编码格式路由
- 根据消息来源和优先级路由
- 根据多个业务属性组合路由

但实际上，Headers 交换机用得很少，因为它的性能比 Topic 差，而且路由逻辑不够直观。

## 五、四种交换机对比

| 类型 | 路由规则 | 路由键作用 | 典型场景 |
|------|---------|-----------|---------|
| Direct | 精确匹配 | 必须完全相等 | 精确路由、一对一 |
| Fanout | 无视路由键 | 忽略 | 广播通知、一对多 |
| Topic | 通配符匹配 | 支持 `*` 和 `#` | 灵活分类、多对一 |
| Headers | 消息头匹配 | 忽略 | 多维度路由、复杂条件 |

## 六、面试追问

### Fanout 和 Topic 都能实现一对多，有什么区别？

表面上看，`order.*` 和广播好像差不多。但关键区别在于：

- **Fanout**：所有绑定队列都收到相同消息，**无法选择性接收**
- **Topic**：可以根据通配符规则**选择性接收**消息

如果用 Topic 实现广播，只要绑定键写成 `#` 就行。但更准确地说，Fanout 的性能比 Topic 更好（不需要匹配计算），所以纯粹广播场景用 Fanout 更合适。

### 如果没有队列能匹配路由键，消息会怎样？

默认情况下，消息会**直接丢弃**。

但可以通过设置 `Mandatory` 参数，让 RabbitMQ 告诉你消息没被路由到任何队列，然后你可以用 `ReturnListener` 捕获这些消息做补救。

```java
// 开启 Mandatory，消息无法路由时回调
channel.addReturnListener((replyCode, replyText, exchange, routingKey, properties, body) -> {
    // 消息没有找到对应的队列，在这里做补救处理
    System.out.println("消息未路由成功: " + routingKey);
});

channel.basicPublish("exchange", "no.match.key", true, null, message.getBytes());
// 第二个参数 true 表示启用 Mandatory
```

## 七、实际选择建议

```
                        ┌─────────────────────────┐
                        │    消息路由场景          │
                        └────────────┬────────────┘
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
        精确匹配？              一对多广播？           模糊匹配？
              │                      │                      │
              ▼                      ▼                      ▼
        ┌──────────┐          ┌──────────┐          ┌──────────┐
        │  Direct  │          │  Fanout  │          │   Topic  │
        └──────────┘          └──────────┘          └──────────┘
```

---

下一个问题留给你：

想象这个场景：消费者处理消息失败了，业务逻辑抛出了异常。这条消息该怎么处理？

是直接丢弃？还是重新放回队列？还是发送到另一个队列专门处理？

消息处理失败后的命运，正是下一节要讨论的——[消费端确认机制](/middleware/rabbitmq/consumer-ack)。
