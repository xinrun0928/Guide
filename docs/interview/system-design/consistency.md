# 如何保证系统的一致性

用户下单后，库存扣了，但订单没创建成功。

用户充值了，但余额没增加。

用户发消息了，但对方没收到。

这些问题的根源都是：**数据不一致**。

今天我们就来聊聊如何保证系统的一致性。

## 场景切入

分布式系统的一致性问题，本质上是由「分布」引起的：

```
单机系统：数据都在一个地方，不存在一致性问题
分布式系统：数据分散在多个节点，需要考虑一致性
```

**CAP 理论**告诉我们：一致性（Consistency）、可用性（Availability）、分区容错性（Partition Tolerance），三者只能选其二。

## 一致性的级别

### 1. 强一致性（Strong Consistency）

写入后立即可读，所有节点数据一致。

**代表**：ZooKeeper、etcd、两阶段提交

### 2. 弱一致性（Weak Consistency）

写入后，不保证立即可读，也不保证最终一致。

**代表**：DNS 系统

### 3. 最终一致性（Eventual Consistency）

写入后，不保证立即可读，但最终会一致。

**代表**：Cassandra、DynamoDB、大多数 NoSQL

## 分布式事务

分布式系统中最经典的一致性问题：**跨服务的数据一致**。

### 方案一：两阶段提交（2PC）

```
阶段一：准备阶段（Prepare）
- 协调者向所有参与者发送 Prepare 请求
- 参与者检查是否可以提交，并锁定资源
- 参与者返回 Prepared 或 Abort

阶段二：提交阶段（Commit）
- 如果所有参与者都 Prepared，协调者发送 Commit
- 如果任何一个参与者 Abort，协调者发送 Rollback
```

```java
public class TwoPhaseCommit {
    private final Coordinator coordinator;
    private final List<Participant> participants;

    public boolean commit(Transaction transaction) {
        // 阶段一：准备
        boolean allPrepared = true;
        for (Participant participant : participants) {
            boolean prepared = participant.prepare(transaction);
            if (!prepared) {
                allPrepared = false;
                break;
            }
        }

        // 阶段二：提交或回滚
        if (allPrepared) {
            for (Participant participant : participants) {
                participant.commit(transaction);
            }
            return true;
        } else {
            for (Participant participant : participants) {
                participant.rollback(transaction);
            }
            return false;
        }
    }
}
```

**问题**：
1. 同步阻塞：参与者锁定资源等待协调者
2. 单点问题：协调者挂了整个事务无法推进
3. 数据不一致：部分提交成功但协调者崩溃

### 方案二：TCC（Try-Confirm-Cancel）

```
Try：预留资源
Confirm：确认执行
Cancel：取消执行
```

```java
public class TCCOrderService {

    // 预留资源阶段
    public void tryCreateOrder(Order order) {
        // 预留库存
        inventoryService.tryDeduct(order.getItems());
        // 预留余额
        accountService.tryFreeze(order.getUserId(), order.getTotalAmount());
    }

    // 确认执行阶段
    public void confirmCreateOrder(Order order) {
        // 真正扣减库存
        inventoryService.confirmDeduct(order.getItems());
        // 真正扣减余额
        accountService.confirmDeduct(order.getUserId(), order.getTotalAmount());
        // 创建订单
        orderDao.save(order);
    }

    // 取消执行阶段
    public void cancelCreateOrder(Order order) {
        // 释放库存预留
        inventoryService.cancelFreeze(order.getItems());
        // 释放余额预留
        accountService.cancelFreeze(order.getUserId(), order.getTotalAmount());
    }
}
```

**问题**：
1. 代码侵入性强：需要实现 try/confirm/cancel 三个方法
2. 资源预留：预留操作增加复杂度

### 方案三：本地消息表 + 消息队列

```java
public class LocalMessageService {
    private final OrderDao orderDao;
    private final MessageDao messageDao;
    private final MQService mqService;

    public void createOrder(Order order) {
        // 1. 创建订单
        orderDao.save(order);

        // 2. 创建本地消息（同一事务）
        Message message = new Message(order.getId(), "create_order");
        messageDao.save(message); // 与订单在同一事务

        // 3. 发送消息到 MQ（失败重试）
        mqService.send("order:create", order);
    }

    // 后台任务扫描未发送的消息
    @Scheduled(fixedRate = 5000)
    public void resendPendingMessages() {
        List<Message> pendingMessages = messageDao.findPending();

        for (Message message : pendingMessages) {
            try {
                mqService.send("order:create", message.getPayload());
                message.setStatus(MessageStatus.SENT);
                messageDao.update(message);
            } catch (Exception e) {
                message.setRetryCount(message.getRetryCount() + 1);
                messageDao.update(message);
            }
        }
    }
}
```

### 方案四：Saga 模式

Saga 模式把长事务拆分为多个本地事务，每个本地事务都有对应的补偿事务。

```
A → B → C → D → E → ...

如果某一步失败，则反向执行补偿：
... → E_compensation → D_compensation → C_compensation → B_compensation → A_compensation
```

```java
public class SagaOrchestrator {
    private final List<SagaStep> steps;

    public void execute(SagaContext context) {
        List<SagaStepResult> completedSteps = new ArrayList<>();

        try {
            for (SagaStep step : steps) {
                SagaStepResult result = step.execute(context);
                completedSteps.add(result);
            }
        } catch (Exception e) {
            // 补偿已完成的步骤
            for (int i = completedSteps.size() - 1; i >= 0; i--) {
                completedSteps.get(i).compensate();
            }
        }
    }
}
```

## 缓存一致性

缓存和数据库的一致性是另一个常见问题。

### Cache-Aside 模式

```
读：Cache → 命中 → 返回
    Cache → 未命中 → DB → 写入 Cache → 返回

写：DB → 删除 Cache（不是更新）
```

```java
public class CacheAsideService {
    private final Cache cache;
    private final Dao dao;

    public Object read(String key) {
        Object value = cache.get(key);
        if (value != null) {
            return value;
        }

        value = dao.findByKey(key);
        cache.put(key, value);
        return value;
    }

    public void write(String key, Object value) {
        dao.update(key, value);
        cache.evict(key); // 删除缓存，而不是更新
    }
}
```

### 为什么删除而不是更新？

```java
// 如果更新缓存，并发情况下可能导致数据不一致：

// T1：线程 A 更新 DB（value = 1）
// T2：线程 B 更新 DB（value = 2）
// T3：线程 A 写入缓存（value = 1）← 错误，应该写入 2
// T4：线程 B 写入缓存（value = 2）

// 最终数据库是 2，但缓存是 1

// 删除缓存则不会产生这个问题
```

## 最终一致性实践

大多数业务场景不需要强一致性，最终一致性足够。

### 1. 异步对账

```java
@Scheduled(cron = "0 0 2 * * ?") // 每天凌晨 2 点
public void reconcile() {
    // 对账：比对系统 A 和系统 B 的数据
    List<ReconcileItem> items = reconcileDao.findMismatched();

    for (ReconcileItem item : items) {
        log.error("对账不一致: {}", item);
        alertService.alert(item);
    }
}
```

### 2. 消息幂等

```java
public class IdempotentConsumer {
    private final RedisTemplate redis;

    public void handleMessage(Message message) {
        String key = "msg:processed:" + message.getId();

        // SETNX 保证幂等
        if (Boolean.TRUE.equals(redis.setIfAbsent(key, "1", Duration.ofDays(1)))) {
            processMessage(message);
        }
    }
}
```

## 面试追问

### 追问一：分布式事务和分布式锁的区别？

**分布式事务**：保证多个操作要么都成功，要么都失败

**分布式锁**：保证同一个资源同一时刻只有一个访问者

### 追问二：如何选择一致性级别？

1. **金融交易**：强一致性（2PC/TCC）
2. **电商订单**：最终一致性（Saga/本地消息）
3. **社交 Feed**：弱一致性（异步写入）

### 追问三：如何处理分布式事务中的死锁？

1. **超时机制**：设置事务超时时间
2. **死锁检测**：定期检测死锁并回滚
3. **资源排序**：按固定顺序获取资源

## 总结

一致性的核心要点：

1. **强一致性代价高**：2PC、TCC 实现复杂，性能损耗大
2. **最终一致性更实用**：大多数场景最终一致即可
3. **业务补偿机制**：无法回滚时，用补偿事务
4. **幂等设计**：重复操作不影响结果
5. **对账机制**：定期检查不一致并修复

**没有完美的方案，只有适合场景的选择**。
