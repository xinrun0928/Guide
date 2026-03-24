# Seata SAGA 模式：长事务编排

想象一个场景：

你买了一辆车，需要同时办理车牌、保险、贷款。

这三个业务，每一个都是独立的服务。

如果贷款失败了，车牌和保险已经办好了，**怎么处理？**

SAGA 模式，就是来解决这种「长事务」的。

## SAGA 的起源

1987 年，数据库领域发表了著名的 SAGA 论文。

作者提出了一个观点：

> 长事务不应该是 ACID 事务，应该被分解成多个子事务，每个子事务都有对应的补偿操作。

这个观点，在分布式系统时代焕发了新的生命力。

## SAGA 的核心思想

SAGA 的核心是**编排**（Choreography）：

```
SAGA 执行流程：

1. 正向执行：Service A → Service B → Service C → ... → Success
2. 出错了：Service C → Service B → Service A → Rollback
```

```
对比 TCC：
- TCC：每个参与者独立实现 Try/Confirm/Cancel
- SAGA：编排器统一管理正向和补偿流程
```

## 正向编排 vs 反向补偿

### 正向编排

正向执行按照预先定义的顺序，依次调用各个服务。

```java
/**
 * SAGA 状态机配置示例
 *
 * 这是一个「订单-支付-发货」的业务流程
 */
public class OrderSagaStateMachine {

    /**
     * 定义 SAGA 状态机
     */
    public static StateMachine buildStateMachine() {
        return StateMachineBuilder.builder()
            .name("order-saga")

            // 起点：创建订单
            .startedState(new ServiceTask("createOrder")
                .service("orderService", "create")
                .onSuccess("payOrder")
                .onError("compensateOrder"))

            // 支付订单
            .state(new ServiceTask("payOrder")
                .service("paymentService", "pay")
                .onSuccess("shipOrder")
                .onError("compensateOrder"))

            // 发货
            .state(new ServiceTask("shipOrder")
                .service("logisticsService", "ship")
                .onSuccess("finish")
                .onError("compensateOrder"))

            // 补偿：取消订单
            .state(new CompensationTask("compensateOrder")
                .service("orderService", "cancel"))

            // 补偿：退款
            .state(new CompensationTask("refundPayment")
                .service("paymentService", "refund"))

            .build();
    }
}
```

```json
/**
 * SAGA 状态机的 JSON 配置
 *
 * Seata SAGA 支持通过 JSON 配置定义业务流程
 */
{
  "Name": "orderSaga",
  "Comment": "订单流程",
  "StartState": "CreateOrder",
  "States": {
    "CreateOrder": {
      "Type": "ServiceTask",
      "ServiceName": "orderService",
      "ServiceMethod": "create",
      "CompensateState": "CancelOrder",
      "Next": "PayOrder",
      "Status": {
        "Success": 1,
        "Fail": 2
      }
    },
    "PayOrder": {
      "Type": "ServiceTask",
      "ServiceName": "paymentService",
      "ServiceMethod": "pay",
      "CompensateState": "RefundPayment",
      "Next": "ShipOrder"
    },
    "ShipOrder": {
      "Type": "ServiceTask",
      "ServiceName": "logisticsService",
      "ServiceMethod": "ship",
      "CompensateState": "CancelShip",
      "Next": "Finish"
    },
    "CancelOrder": {
      "Type": "CompensationTask",
      "ServiceName": "orderService",
      "ServiceMethod": "cancel"
    },
    "RefundPayment": {
      "Type": "CompensationTask",
      "ServiceName": "paymentService",
      "ServiceMethod": "refund"
    },
    "Finish": {
      "Type": "Succeed"
    }
  }
}
```

### 反向补偿

当正向执行失败时，按照相反的顺序执行补偿操作。

```java
/**
 * SAGA 补偿执行器
 */
public class SAGACompensationExecutor {

    @Autowired
    private StateMachineEngine stateMachineEngine;

    /**
     * 当流程失败时，自动执行补偿
     */
    public void handleFailure(String sagaInstanceId) {
        // Seata TC 会自动按照状态机的定义
        // 从失败的节点开始，逆序执行补偿任务

        // 例如：如果 ShipOrder 失败
        // 补偿顺序：CancelShip → RefundPayment → CancelOrder

        SagaInstance instance = stateMachineEngine.getSagaInstance(sagaInstanceId);

        // 打印补偿流程
        for (Task task : instance.getCompensationTasks()) {
            log.info("执行补偿任务：{}", task.getName());
            task.execute();
        }
    }
}
```

## SAGA vs TCC：核心区别

| 维度 | SAGA | TCC |
|------|------|-----|
| 资源锁定 | 不锁定资源 | Try 阶段锁定资源 |
| 补偿方式 | 补偿事务（反向操作） | 回滚事务（恢复原状） |
| 适用场景 | 长事务、流程编排 | 短事务、资源操作 |
| 一致性 | 最终一致性 | 强一致性 |

## SAGA 的局限性

SAGA 模式不是银弹，它有以下局限：

### 1. 不支持脏读

SAGA 模式不保证隔离性。

如果用户 A 在 SAGA 执行过程中查询订单状态，可能看到「支付成功但未发货」的中间状态。

**解决方案**：在应用层面加锁，或者接受最终一致性。

### 2. 补偿逻辑复杂

每个正向操作都需要对应的补偿操作。

如果正向操作是「发送短信」，补偿操作应该是「撤销短信」——但短信无法撤销。

**解决方案**：设计幂等的正向操作，或者记录日志而非真正执行。

### 3. 补偿可能失败

补偿操作本身也可能失败。

**解决方案**：Seata SAGA 提供自动补偿重试机制，但需要确保补偿操作幂等。

## SAGA 的适用场景

**适合 SAGA 的场景：**

1. **长事务**：流程跨越多个系统，耗时较长
2. **业务流程编排**：有明确的状态流转
3. **无需实时一致性**：可以接受最终一致性

**不适合 SAGA 的场景：**

1. **强一致性要求**：如金融转账
2. **短事务**：TCC/AT 更适合
3. **并发控制**：SAGA 模式不提供锁机制

## 面试追问方向

**追问 1：SAGA 如何保证补偿的幂等性？**

Seata SAGA 通过状态机管理补偿流程：
1. 每个任务执行前，先检查是否已执行
2. 使用分支 ID 作为幂等键
3. 补偿重试机制确保最终成功

**追问 2：SAGA 和 TCC 的性能差异？**

SAGA 性能更高，因为：
- 不需要锁定资源
- 补偿操作是异步的
- 没有全局锁竞争

但代价是，SAGA 的补偿逻辑更复杂，且不保证强一致性。

**追问 3：如何设计 SAGA 的补偿逻辑？**

设计原则：
1. **补偿必须能恢复正向操作的结果**
2. **补偿必须幂等**
3. **补偿尽量简单，避免引入新问题**

## 总结

SAGA 模式的核心思想：

1. **化整为零**：把长事务分解成多个子事务
2. **正向补偿**：正向执行 + 反向补偿
3. **最终一致**：不追求强一致性，接受最终一致

SAGA 适合的场景：
- 业务流程复杂、涉及多个服务
- 事务时间跨度长
- 对实时一致性要求不高
