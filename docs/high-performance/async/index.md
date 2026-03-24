# 异步与消息处理

你正在设计一个下单系统。

用户下单后，需要做这些操作：

- 扣减库存
- 创建订单
- 发送通知
- 更新统计数据
- 发送短信/邮件

如果全部同步执行，一个订单请求可能要 3 秒才能返回。用户等得不耐烦，页面一直转圈圈。

但实际上，用户真正关心的只有前两步。其他操作，完全可以异步执行，不影响主流程。

**同步调用是性能的天花板，异步是突破这道天花板的钥匙。**

本模块涵盖异步编程、消息队列优化、线程池与并发优化，助你掌握异步处理的精髓。

---

## 模块速览

### 异步编程基础

| 文档 | 简介 |
|-----|-----|
| [同步 vs 异步 vs 回调 vs 事件驱动](/high-performance/async/sync-async) | 四种编程范式的区别与应用场景 |
| [Spring @Async 异步执行](/high-performance/async/spring-async) | Spring 异步编程最佳实践 |
| [CompletableFuture 异步编排](/high-performance/async/completable-future) | Java 8 异步编程利器 |
| [响应式编程入门](/high-performance/async/reactive) | Reactor 与 Flux/Mono |
| [WebFlux 响应式框架](/high-performance/async/webflux) | Spring WebFlux 实战 |

### 消息队列优化

| 文档 | 简介 |
|-----|-----|
| [消息队列选型](/high-performance/async/mq-select) | Kafka vs RabbitMQ vs RocketMQ |
| [Kafka 高吞吐原理](/high-performance/async/kafka-performance) | 顺序写、零拷贝、批量处理 |
| [Kafka 分区与消费者线程数](/high-performance/async/kafka-partition) | 分区规划实战 |
| [RabbitMQ 队列镜像与内存控制](/high-performance/async/rabbitmq-optimize) | 高可用配置 |
| [消息积压处理](/high-performance/async/message-backlog) | 消费者扩容、消息迁移 |
| [消息可靠投递](/high-performance/async/reliable-delivery) | 持久化、消费确认、补偿机制 |
| [顺序消息实现](/high-performance/async/ordered-message) | 分区顺序、哈希路由 |
| [延迟消息实现](/high-performance/async/delay-message) | RocketMQ 延迟等级、RabbitMQ 插件 |

### 线程池与并发优化

| 文档 | 简介 |
|-----|-----|
| [线程池监控](/high-performance/async/threadpool-monitor) | 核心指标采集与告警 |
| [线程池调优经验](/high-performance/async/threadpool-tuning) | IO 密集型 vs CPU 密集型 |
| [ScheduledExecutorService 定时任务](/high-performance/async/scheduled-task) | 定时任务防坑指南 |
| [Disruptor 高性能队列](/high-performance/async/disruptor) | 无锁队列原理 |

---

## 异步的本质

异步编程的核心思想是：**不要让线程等待。**

同步模式下，线程在等待 IO 操作时无所事事，白白浪费 CPU。

```java
// 同步：线程等待 200ms
public String syncGetUser() {
    // 这里线程什么都不做，干等 200ms
    return restTemplate.getForObject(url, String.class);
}

// 异步：线程不等，去做其他事
public CompletableFuture<String> asyncGetUser() {
    return CompletableFuture.supplyAsync(() -> {
        return restTemplate.getForObject(url, String.class);
    });
}
```

异步的优势：

- **提升吞吐量**：线程不等待，可以处理更多请求
- **提升响应速度**：用户无需等待所有操作完成
- **系统解耦**：通过消息队列，实现系统间的松耦合

---

## 消息队列的地位

消息队列是异步架构的核心组件，被誉**分布式系统的缓冲器和连接器**。

### 削峰填谷

```
流量洪峰 ——> 消息队列（缓冲）——> 消费者（匀速处理）
```

双十一零点，订单量瞬间爆发。消息队列作为缓冲层，让下游服务可以匀速处理，避免被打爆。

### 解耦处理

```
订单系统 ——> 消息队列 ——> 库存系统
                    ——> 物流系统
                    ——> 积分系统
                    ——> 通知系统
```

订单系统只需把消息丢进队列，其他系统各取所需，互不干扰。

### 最终一致性

通过消息队列，实现分布式事务的最终一致性，避免分布式锁的高开销。

---

## 消息队列的三大挑战

### 消息丢失

网络抖动、消费者宕机、broker 故障——消息可能在任何环节丢失。

解决方案：

- 生产者确认机制（confirm）
- broker 持久化（刷盘策略）
- 消费者手动确认（ack）

### 消息重复

消费者重启、网络闪断——消息可能被重复消费。

解决方案：

- 业务幂等性设计（如数据库唯一索引）
- 消息去重表

### 消息顺序

分区迁移、网络延迟——消息可能乱序。

解决方案：

- 单分区单消费者
- 消息添加序列号，消费者校验

---

## 学习路径建议

### 入门：理解异步范式

建议从**同步与异步的区别**开始，理解四种编程范式的适用场景。

然后学习 **CompletableFuture**，这是 Java 异步编程的核心工具。

### 进阶：掌握消息队列

深入学习**消息队列选型**和**Kafka 高吞吐原理**。

理解消息队列的三大挑战（丢失、重复、顺序），以及常见的解决方案。

### 高级：线程池调优

学习**线程池调优**和**Disruptor 高性能队列**。

这是高并发场景下的必备技能。理解 IO 密集型和 CPU 密集型的区别，掌握线程池参数配置的艺术。

---

## 延伸思考

异步不是银弹，它也有代价：

- **调试困难**：异步调用的调用链不连续，排查问题更难
- **复杂度增加**：需要处理消息丢失、重复、顺序等问题
- **最终一致性**：无法做到强一致性，需要接受数据延迟

所以，选择同步还是异步，要根据业务场景决定：

| 场景 | 推荐方案 |
|-----|---------|
| 用户等待结果的请求 | 同步 |
| 不需要实时结果的请求 | 异步 |
| 需要系统解耦的请求 | 异步 |
| 对数据一致性要求极高的请求 | 同步 + 分布式事务 |

**好的架构师，不是用最先进的技术，而是用最合适的技术。**

下一模块，我们将探讨 JVM 调优——Java 应用的性能根基。
