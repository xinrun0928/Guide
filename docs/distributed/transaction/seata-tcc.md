# Seata TCC 模式：Try-Confirm-Cancel 三阶段

分布式事务里，有一句名言：

**「世界上没有免费的午餐。」**

想要强一致性，就要付出代价。

TCC 模式，就是用业务层面的「预留-确认-取消」三步，来换取分布式事务的一致性。

## TCC 的核心思想

TCC 是 Try-Confirm-Cancel 的缩写。

它的核心思想是：**在业务层面实现分布式事务，而不是依赖数据库的 ACID。**

```
TCC 三阶段：

Try（预留）：预留资源，锁定业务资源（不提交）
Confirm（确认）：确认执行，使用 Try 阶段预留的资源
Cancel（取消）：取消执行，释放 Try 阶段预留的资源
```

```
对比 AT 模式：
- AT 模式：数据库层面自动解析 SQL、自动记录镜像、自动回滚
- TCC 模式：业务层面手动实现预留、确认、取消
```

## Try-Confirm-Cancel 三阶段详解

### 阶段一：Try（预留）

Try 阶段的核心是**预留资源**，但不真正执行业务操作。

```java
/**
 * TCC 模式的 Try 接口
 *
 * 预留资源：冻结库存、预扣余额
 */
@LocalTCC
public interface InventoryTccService {

    /**
     * Try：冻结库存
     *
     * status = 1 表示预扣（冻结）
     *
     * @param businessKey  业务唯一键
     * @param productId    商品 ID
     * @param count        扣减数量
     */
    @TwoPhaseBusinessAction(
        name = "inventoryTcc",
        commitMethod = "confirm",
        rollbackMethod = "cancel"
    )
    boolean tryDecreaseStock(
        @BusinessActionContextParameter(paramName = "productId") Long productId,
        @BusinessActionContextParameter(paramName = "count") Integer count
    );

    /**
     * Confirm：确认扣减
     *
     * status = 2 表示确认扣减（真正扣减）
     */
    boolean confirm(BusinessActionContext context);

    /**
     * Cancel：取消扣减
     *
     * status = 0 表示释放（恢复库存）
     */
    boolean cancel(BusinessActionContext context);
}
```

```java
/**
 * TCC 实现类
 */
@Service
public class InventoryTccServiceImpl implements InventoryTccService {

    @Autowired
    private InventoryDao inventoryDao;

    @Override
    @Transactional
    public boolean tryDecreaseStock(Long productId, Integer count) {
        // 1. 检查库存是否充足
        Inventory inventory = inventoryDao.selectByProductId(productId);
        if (inventory.getStock() < count) {
            return false; // 库存不足，Try 失败
        }

        // 2. 冻结库存（预留资源）
        // 冻结数量 = 可用数量 - 本次扣减数量
        int frozen = inventory.getFrozen() + count;
        int available = inventory.getStock() - count;

        inventoryDao.updateFrozen(productId, frozen, available);

        return true; // Try 成功
    }

    @Override
    @Transactional
    public boolean confirm(BusinessActionContext context) {
        Long productId = (Long) context.getActionContext("productId");
        Integer count = (Integer) context.getActionContext("count");

        // 确认扣减：将冻结数量转为已售数量
        inventoryDao.confirmDecrease(productId, count);

        return true;
    }

    @Override
    @Transactional
    public boolean cancel(BusinessActionContext context) {
        Long productId = (Long) context.getActionContext("productId");
        Integer count = (Integer) context.getActionContext("count");

        // 取消扣减：释放冻结数量
        inventoryDao.cancelDecrease(productId, count);

        return true;
    }
}
```

### 阶段二：Confirm（确认）

当全局事务的所有分支都 Try 成功后，进入 Confirm 阶段。

```java
@Override
@Transactional
public boolean confirm(BusinessActionContext context) {
    // 只有 Try 成功的才会进入 Confirm
    // 所以这里可以安全地执行真正的扣减

    Long productId = (Long) context.getActionContext("productId");
    Integer count = (Integer) context.getActionContext("count");

    // 确认扣减：将冻结数量转为已售数量
    // UPDATE inventory SET frozen = frozen - ?, sold = sold + ? WHERE product_id = ?
    inventoryDao.confirmDecrease(productId, count);

    return true;
}
```

### 阶段三：Cancel（取消）

当全局事务的任意一个分支 Try 失败，进入 Cancel 阶段。

```java
@Override
@Transactional
public boolean cancel(BusinessActionContext context) {
    // 释放 Try 阶段预留的资源
    Long productId = (Long) context.getActionContext("productId");
    Integer count = (Integer) context.getActionContext("count");

    // 取消扣减：恢复冻结数量
    // UPDATE inventory SET frozen = frozen - ? WHERE product_id = ?
    inventoryDao.cancelDecrease(productId, count);

    return true;
}
```

## TCC vs AT：选择指南

| 维度 | TCC | AT |
|------|-----|-----|
| 侵入性 | 高（需要业务实现三个方法） | 低（只需加注解） |
| 性能 | 高（无全局锁） | 中等（有全局锁） |
| 一致性 | 强一致性 | 最终一致性 |
| 适用场景 | 库存、资金等资源敏感场景 | 普通业务场景 |

## TCC 的三大问题

TCC 模式虽然灵活，但有三个著名的问题：

1. **空回滚**：Try 未执行，Cancel 被调用了
2. **幂等**：Confirm/Cancel 重复执行
3. **悬挂**：Cancel 比 Confirm 先执行

这些问题会在 tcc-problem.md 中详细讲解。

## 面试追问方向

**追问 1：TCC 和 AT 的性能差异在哪里？**

TCC 性能更高的原因：
- Try 阶段只是预留资源，不执行业务写操作
- 无需像 AT 那样记录前后镜像

AT 模式性能损耗：
- 需要解析 SQL
- 需要记录前后镜像（两次数据库查询）
- 需要维护全局锁

**追问 2：TCC 的 Try 失败后，Confirm 会被调用吗？**

不会。

Seata TC 在收到 Try 失败的通知后，会直接触发 Cancel，不会进入 Confirm 阶段。

**追问 3：TCC 的 Cancel 失败怎么办？**

Cancel 失败后，Seata 会**不断重试**。

所以 TCC 的 Cancel 方法必须是**幂等**的——无论执行多少次，效果都一样。

## 总结

TCC 模式的核心特点：

1. **业务可控**：Try/Confirm/Cancel 都是业务方法，完全可控
2. **性能高**：无全局锁，无 SQL 解析
3. **侵入性大**：需要为每个业务实现三个方法
4. **需要处理三大问题**：空回滚、幂等、悬挂

TCC 适合的场景：**库存扣减、资金转账**等资源敏感的业务。
