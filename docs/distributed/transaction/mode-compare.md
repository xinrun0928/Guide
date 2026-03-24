# AT vs TCC vs SAGA 对比与选型

分布式事务有五种常见方案：

- XA：数据库层面的强一致
- AT：Seata 的无侵入方案
- TCC：业务层面的强一致
- SAGA：长事务的编排方案
- 可靠消息：最终一致性的异步方案

**没有银弹，每种方案都是权衡。**

## 五种方案横向对比

| 维度 | XA | AT | TCC | SAGA | 可靠消息 |
|------|----|----|-----|------|---------|
| 一致性 | 强一致 | 最终一致 | 强一致 | 最终一致 | 最终一致 |
| 侵入性 | 中等 | 低 | 高 | 中等 | 低 |
| 性能 | 差 | 中 | 高 | 高 | 高 |
| 锁粒度 | 行锁 | 行锁 | 无锁 | 无锁 | 无锁 |
| 事务时长 | 短 | 中 | 短 | 长 | 长 |
| 场景 | 数据库强一致 | 普通业务 | 资源操作 | 流程编排 | 异步解耦 |

## AT 模式：零侵入的折中选择

### 适用场景

```
AT 模式适合：
- 业务代码不想改动
- 数据库直连（不经过代理层）
- 对一致性要求不是极高
- 开发周期紧张
```

### 不适用场景

```
AT 模式不适合：
- 分库分表中间件（ShardingSphere Proxy）
- 多数据库实例（跨库事务）
- 非关系型数据库
- 需要精细控制的场景
```

```java
/**
 * AT 模式示例：业务零侵入
 */
@Service
public class OrderService {
    
    @GlobalTransactional  // 只需要这一个注解
    public void createOrder(Order order) {
        // 1. 扣库存（自动解析 SQL，自动记录镜像）
        inventoryService.decreaseStock(order.getProductId(), order.getCount());
        
        // 2. 创建订单（自动回滚）
        orderDao.insert(order);
        
        // 3. 发送消息（可以配合可靠消息）
        messageService.sendOrderCreated(order);
    }
}
```

## TCC 模式：高性能的代价

### 适用场景

```
TCC 模式适合：
- 库存扣减、资金转账等资源敏感场景
- 需要高性能的分布式事务
- 业务代码可以配合改造
```

### 不适用场景

```
TCC 模式不适合：
- 业务流程复杂、涉及多个服务
- 业务代码不能改造
- 补偿逻辑难以设计
```

```java
/**
 * TCC 模式示例：高性能但侵入性大
 */
@LocalTCC
public interface InventoryTccService {
    
    @TwoPhaseBusinessAction(
        name = "inventory",
        commitMethod = "confirm",
        rollbackMethod = "cancel"
    )
    boolean tryDecreaseStock(
        @BusinessActionContextParameter(paramName = "productId") Long productId,
        @BusinessActionContextParameter(paramName = "count") Integer count
    );
    
    boolean confirm(BusinessActionContext context);
    boolean cancel(BusinessActionContext context);
}
```

## SAGA 模式：长事务的最优解

### 适用场景

```
SAGA 模式适合：
- 业务流程复杂，涉及多个服务
- 事务时间跨度长（分钟级、小时级）
- 对实时一致性要求不高
```

### 不适用场景

```
SAGA 模式不适合：
- 强一致性要求的场景（金融转账）
- 短事务（AT/TCC 更适合）
- 补偿逻辑难以设计
```

```json
/**
 * SAGA 状态机配置：适合长事务
 */
{
  "Name": "orderSaga",
  "States": {
    "CreateOrder": {
      "Type": "ServiceTask",
      "ServiceMethod": "create",
      "CompensateState": "CancelOrder"
    },
    "PayOrder": {
      "Type": "ServiceTask",
      "ServiceMethod": "pay",
      "CompensateState": "RefundPayment"
    },
    "ShipOrder": {
      "Type": "ServiceTask",
      "ServiceMethod": "ship",
      "CompensateState": "CancelShip"
    }
  }
}
```

## 选型决策树

```
                    ┌─────────────────────┐
                    │ 开始                │
                    └──────────┬──────────┘
                               ▼
                    ┌─────────────────────┐
                    │ 业务代码能否改造？    │
                    └──────────┬──────────┘
                       YES     │     NO
                               ▼
                    ┌─────────────────────┐
                    │ 资源敏感吗？        │ ───→ AT 模式
                    │ （库存/资金）        │
                    └──────────┬──────────┘
                       YES     │     NO
                               ▼
                    ┌─────────────────────┐
                    │ 事务时间长吗？       │
                    │ （> 1分钟）          │
                    └──────────┬──────────┘
                       YES     │     NO
                               ▼
                    ┌─────────────────────┐
                    │ 需要强一致吗？       │
                    └──────────┬──────────┘
                       YES     │     NO
                               ▼         ▼
                        TCC   SAGA    可靠消息
```

## 实际案例分析

### 案例一：电商下单

```
场景：用户下单，扣库存 + 创建订单 + 扣余额

推荐方案：TCC + 可靠消息

理由：
- 库存和余额都是资源敏感操作，需要强一致
- 库存扣减使用 TCC，保证不超卖
- 余额扣减使用 TCC，保证不透支
- 发货通知使用可靠消息，不需要强一致
```

```java
@GlobalTransactional
public void createOrder(OrderDTO orderDTO) {
    // 1. TCC 扣库存
    inventoryTccService.tryDecreaseStock(orderDTO.getProductId(), orderDTO.getCount());
    
    // 2. TCC 扣余额
    accountTccService.tryDecreaseBalance(orderDTO.getUserId(), orderDTO.getAmount());
    
    // 3. 创建订单
    Order order = orderDao.create(orderDTO);
    
    // 4. 可靠消息通知发货（异步）
    // 如果这里失败，本地消息表会保证重试
    messageService.sendOrderCreated(order);
}
```

### 案例二：金融转账

```
场景：用户 A 转账给用户 B

推荐方案：TCC

理由：
- 资金是最高敏感资源，必须强一致
- 不允许出现「A 扣了，B 没加」的情况
- TCC 的 Try 阶段可以「冻结」双方余额
```

```java
/**
 * 转账 TCC 实现
 */
public boolean tryTransfer(Long fromUserId, Long toUserId, BigDecimal amount) {
    // 1. 冻结 A 的余额
    Account fromAccount = accountDao.selectByUserId(fromUserId);
    if (fromAccount.getAvailableBalance().compareTo(amount) < 0) {
        return false; // 余额不足
    }
    accountDao.freezeBalance(fromUserId, amount); // 冻结
    
    // 2. 预增加 B 的余额
    accountDao.preAddBalance(toUserId, amount); // 预增加
    
    return true; // Try 成功
}
```

### 案例三：订单处理流水线

```
场景：订单创建 → 支付 → 发货 → 收货 → 完成

推荐方案：SAGA

理由：
- 整个流程可能持续数天
- 不需要强一致，接受最终一致
- 每个步骤都有对应的补偿操作
```

## 面试追问方向

**追问 1：你们系统用的是什么分布式事务方案？为什么？**

回答思路：
1. 介绍系统特点
2. 选择了哪种方案
3. 为什么这么选（权衡了什么）

```
参考回答：
我们系统用 AT + TCC 的混合方案。
- 普通业务（订单创建）：用 AT 模式，开发效率高
- 资源敏感（库存扣减）：用 TCC 模式，性能更好

选择 AT + TCC 的原因：
1. 库存扣减是高频操作，AT 模式的全局锁会成为瓶颈
2. TCC 模式虽然侵入性大，但库存模块可以配合改造
3. 两种方案混用，发挥各自优势
```

**追问 2：如何保证分布式事务的性能？**

性能优化策略：
1. **减少全局锁持有时间**：AT 模式优化 SQL，避免长事务
2. **异步化**：可靠消息异步投递，不阻塞主流程
3. **分库分表**：拆分数据，减少单节点锁竞争
4. **读写分离**：写操作走主库，读操作走从库

**追问 3：分布式事务失败了怎么办？**

分布式事务失败的处理：
1. **自动回滚**：AT/TCC 自动回滚
2. **人工补偿**：SAGA/可靠消息需要人工或定时任务补偿
3. **告警通知**：失败后及时告警

## 总结

分布式事务方案选型建议：

```
1. 普通业务场景：AT 模式（零侵入）
2. 资源敏感场景：TCC 模式（高性能）
3. 长事务场景：SAGA 模式（流程编排）
4. 异步解耦场景：可靠消息（最终一致）
5. 混合场景：组合使用（AT + TCC + 可靠消息）
```

记住：**没有最好的方案，只有最合适的方案。**根据业务特点和技术团队能力，选择最适合的方案。
