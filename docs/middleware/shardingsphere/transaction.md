# ShardingSphere 分布式事务：XA 与 BASE 柔性事务

用户下单，扣减库存，扣减余额。

三个操作，分布在三个不同的分片。

**如果第二个操作成功了，第三个操作失败了怎么办？**

在没有分布式事务的场景下，数据库回滚只能影响它自己那一个分片。用户余额扣了，订单却没创建——这笔账怎么算？

分布式事务的核心矛盾：**性能和一致性不可兼得**。

ShardingSphere 提供了两种解决思路：XA 的强一致性，和 BASE 的最终一致性。

## 先理解CAP定理

在聊具体实现之前，我们需要理解 CAP 定理：

- **C（Consistency）**：强一致性，所有节点在同一时刻看到相同的数据
- **A（Availability）**：可用性，每个请求都能在有限时间内得到响应
- **P（Partition Tolerance）**：分区容错，系统在网络分区时仍能运行

CAP 定理告诉我们：**三者只能选其二**。

对于分布式数据库：

- **CP 系统**：优先保证一致性，牺牲可用性（ZooKeeper、HBase）
- **AP 系统**：优先保证可用性，牺牲一致性（Cassandra、Eureka）

MySQL 主从集群是典型的 AP 系统——允许从库暂时不一致。

## 强一致性方案：XA 事务

### XA 是什么？

XA（eXtended Architecture）是 **X/Open** 组织定义的分布式事务标准。

它把事务分为两阶段：

**第一阶段：准备阶段（Prepare）**

```
事务管理器（TM）向所有参与者（RM）发送 Prepare 请求
每个 RM 锁定资源，执行操作，但不提交
如果所有 RM 都返回「可以提交」，进入第二阶段
```

**第二阶段：提交阶段（Commit）**

```
TM 向所有 RM 发送 Commit 请求
所有 RM 正式提交事务
```

```
      TM（事务管理器）
        /    |    \
      /      |      \
    RM1     RM2     RM3
  (ds_0)   (ds_1)   (ds_2)
```

### XA 在 ShardingSphere 中的实现

ShardingSphere 支持两种 XA 模式：

| 模式 | 底层实现 | 特点 |
|-----|--------|------|
| XA 核心（Atomikos） | Atomikos | 社区默认，依赖少 |
| XA Narayana | JBoss Narayana | 功能更全，但包更大 |

```yaml
rules:
- !TRANSACTION
  defaultType: XA
  providerType: Atomikos
```

```java
// 代码层面，无需修改
@Transactional
public void createOrder(Order order) {
    // XA 事务自动管理
    orderMapper.insert(order);        // 写 ds_0
    stockMapper.deduct(order.getSkuId()); // 写 ds_1
    balanceMapper.deduct(order.getUserId(), order.getAmount()); // 写 ds_2
}
```

ShardingSphere 自动完成两阶段提交：

1. **Prepare**：在三个分片上执行操作，预提交
2. **Commit**：全部成功则提交，任一失败则回滚

### XA 的问题

XA 看起来很美好，但有两个致命问题：

**问题一：性能损耗大**

两阶段提交意味着**锁的时间翻倍**。在 Prepare 阶段，所有资源都被锁定，其他事务无法修改。

在高并发场景下，XA 可能导致数据库吞吐量下降 50% 甚至更多。

**问题二：单点故障**

事务管理器是中心节点。如果 TM 在 Prepare 之后、Commit 之前崩溃：

```
TM: Prepare 成功 ✓
TM: 崩溃！
RM1: 锁住了，等待 Commit
RM2: 锁住了，等待 Commit
RM3: 锁住了，等待 Commit
```

这就是著名的**协调者崩溃**问题。

解决方法是**日志恢复**：TM 在发送 Prepare 前，先把事务状态写入磁盘。恢复后读取日志，继续完成未完成的事务。

### XA 配置参数调优

```yaml
props:
  # XA 核心配置
  xa-core-impl: atomikos
  xa-lost-connection-detect-mode: on-abnormal
  xa-retry-interval: 100
  xa-default-timeout: 30000
  
  # 连接池配置（影响 XA 性能）
  max-pool-size: 100
  min-pool-size: 10
  connection-timeout: 30000
```

关键参数说明：

| 参数 | 说明 | 建议值 |
|-----|------|-------|
| `xa-default-timeout` | XA 全局超时时间 | 30-60秒 |
| `xa-retry-interval` | 重试间隔 | 100ms |
| `max-pool-size` | 最大连接数 | 根据并发量调 |

## 最终一致性方案：BASE 柔性事务

### BASE 理论

与 CAP 的「全有或全无」不同，BASE 理论提出了一种**妥协**：

- **Basically Available**：基本可用，允许偶尔失败
- **Soft state**：软状态，数据可以暂时不一致
- **Eventually consistent**：最终一致性，数据最终会达到一致

类比：**微信红包**。你发红包，朋友立刻看到「服务异常」，但几秒后刷新，红包已经发出。这就是最终一致性——不需要即时反馈，但最终结果是正确的。

### ShardingSphere 的 BASE 实现

ShardingSphere 实现了 **Seata 的 AT 模式**（ Automatic Transaction）：

```yaml
rules:
- !TRANSACTION
  defaultType: BASE
  providerType: Seata
```

**AT 模式的工作原理：**

```
第一步：执行 SQL（自动）
       ↓
  解析 SQL，生成「前镜像」（执行前的数据快照）
       ↓
  执行 SQL
       ↓
  生成「后镜像」（执行后的数据快照）
       ↓
  生成 UNDO LOG（用于回滚）
       ↓
  注册分支事务
       ↓
  TC（事务协调者）异步同步
```

### Seata AT 模式的核心机制

**undolog 表结构：**

```sql
CREATE TABLE `undo_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `branch_id` bigint NOT NULL,
  `xid` varchar(100) NOT NULL,
  `context` varchar(128) NOT NULL,
  `rollback_info` longblob NOT NULL,
  `log_status` int NOT NULL,
  `log_created` datetime NOT NULL,
  `log_modified` datetime NOT NULL,
  UNIQUE KEY `ux_undo_log` (`xid`,`branch_id`)
);
```

**回滚流程：**

```
事务失败，需要回滚
       ↓
  读取 undo_log，获取「前镜像」
       ↓
  构造反向 SQL
       ↓
  执行反向 SQL，恢复数据
       ↓
  删除 undo_log
```

### 对比 XA 和 BASE

| 维度 | XA | BASE (Seata AT) |
|-----|----|----------------|
| 一致性 | 强一致 | 最终一致 |
| 性能 | 较低（全局锁） | 较高（本地事务 + 补偿） |
| 隔离级别 | 可串行化 | 读已提交（RC） |
| 代码侵入 | 无 | 无（自动处理） |
| 故障恢复 | 依赖日志 | 依赖 undo_log |
| 适用场景 | 金融、订单 | 高并发互联网业务 |

**性能数据对比（理论值）：**

```
单库：10000 TPS

XA 分库（3分片）：3000 TPS（性能损失 70%）
BASE 分库（3分片）：7000 TPS（性能损失 30%）
```

##Saga 模式：更轻量的选择

除了 XA 和 AT，ShardingSphere 还支持 **Saga 模式**，适用于长事务场景。

### 什么是 Saga？

Saga 将一个长事务拆分为多个**子事务**，每个子事务都有**正向操作**和**补偿操作**。

```
T1: 创建订单 (正向)          T1c: 取消订单 (补偿)
T2: 扣减库存 (正向)          T2c: 恢复库存 (补偿)
T3: 扣减余额 (正向)          T3c: 退还余额 (补偿)
```

**执行顺序：**

```
T1 执行 → T2 执行 → T3 执行 → 成功

T1 执行 → T2 执行 → T3 失败
      ↓
T3c 执行 → T2c 执行 → T1c 执行 → 回滚完成
```

### Saga 配置

```yaml
rules:
- !TRANSACTION
  defaultType: BASE
  providerType: Seata

- !SAGA
  properties:
    saga-json-parser: jackson
    default-journal-group: saga_default
  machines:
    - name: order_machine
      getType:
        type: AVG
      postTypes:
        stock_machine:
          type: SERVICE
          simple: com.example.StockService
        balance_machine:
          type: SERVICE
          simple: com.example.BalanceService
```

### Saga vs AT

| 维度 | Saga | AT (BASE) |
|-----|------|----------|
| 回滚方式 | 补偿（正向+逆向） | undo_log 自动回滚 |
| 代码量 | 多（需要写补偿逻辑） | 少（自动处理） |
| 并发性能 | 高 | 中 |
| 适用场景 | 长流程、多服务 | 短事务、单分片 |
| 支持程度 | 需要业务配合 | 自动处理 |

## 本地事务 + 最大努力送达

除了 XA 和 BASE，ShardingSphere 还支持一种**最简单但最不可靠**的模式：**LOCAL 事务 + 消息补偿**。

```yaml
rules:
- !TRANSACTION
  defaultType: LOCAL  # 本地事务，无分布式保证
```

这种方式本质上是**不管控**，把失败处理交给业务：

1. 执行业务操作
2. 如果失败，记录到消息表/重试表
3. 后台任务定期扫描失败记录，重试

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        orderMapper.insert(order);
        
        // 扣库存失败，抛出异常
        boolean success = stockService.deduct(order.getSkuId());
        if (!success) {
            throw new BusinessException("库存不足");
        }
        
        // 扣余额失败，同样抛异常
        balanceService.deduct(order.getUserId(), order.getAmount());
    }
}
```

**问题：单库本地事务，无法保证跨库一致性。**

这种模式只适合**不需要跨库事务**的场景。

## 实战：如何选择事务模式？

### 选择决策树

```
业务场景是什么？
├── 金融、支付、订单核心链路
│         └── 一致性要求极高 → XA
│
├── 高并发互联网业务（商品查询、用户操作）
│         └── 允许短暂不一致 → BASE (Seata AT)
│
├── 长流程业务（下单 → 支付 → 发货 → 收货）
│         └── Saga + 最终一致性
│
└── 单库操作，无跨库场景
          └── 本地事务即可
```

### 混合使用

实际项目中，可以**混合使用**不同事务模式：

```java
// XA 事务：订单核心链路
@ShardingSphereTransactionType(value = "XA")
@Transactional
public void createOrder(Order order) {
    orderMapper.insert(order);
    stockService.deduct(order.getSkuId());
    balanceService.deduct(order.getUserId(), order.getAmount());
}

// BASE 事务：日志、消息等辅助链路
@ShardingSphereTransactionType(value = "BASE")
public void sendNotification(Order order) {
    notificationService.send(order);
}
```

### 避坑指南

| 坑 | 解决方案 |
|---|---------|
| XA 锁超时 | 减小事务粒度，加快执行速度 |
| BASE 数据脏读 | 避免在事务内读取其他事务修改的数据 |
| Saga 补偿遗漏 | 设计补偿任务监控 + 告警 |
| 长事务 | 拆分为多个短事务 + Saga 编排 |

## 面试追问

- **分布式事务和本地事务的本质区别是什么？** 本地事务由单一资源管理器控制，分布式事务需要协调多个资源管理器。
- **Seata AT 模式的隔离性如何保证？** 通过全局锁和 MVCC（多版本并发控制），但隔离级别是 RC（读已提交）。
- **如果 Seata TC（协调者）挂了怎么办？** Seata Server 支持集群部署，使用 session 存储（如 Redis、数据库）保证协调者高可用。
- **如何保证 Saga 补偿一定执行？** 需要补偿任务表 + 定时任务 + 告警兜底。

## 写在最后

分布式事务没有银弹，只有trade-off。

- **XA**：选择一致性，放弃部分性能和可用性
- **BASE**：选择可用性，接受短暂的不一致
- **Saga**：选择性能，接受复杂的状态机编排

理解业务场景，比理解技术更重要。

下篇文章，我们来聊聊分布式 ID 生成——分库分表后，主键怎么生成？
