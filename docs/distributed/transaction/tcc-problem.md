# TCC 空回滚、悬挂、幂等问题

TCC 模式有三个著名的问题：

1. **空回滚**：Try 没执行，Cancel 反而执行了
2. **幂等**：Confirm/Cancel 重复执行
3. **悬挂**：Cancel 先于 Confirm 执行

**这是 TCC 模式最容易被问到的面试题。**

## 问题一：空回滚

### 什么是空回滚

空回滚是指：**Try 方法没有执行成功，但 Cancel 方法被执行了。**

```
场景：

1. 分支事务开始，向 TC 注册分支
2. TC 通知 RM 执行 Try
3. 网络问题：TC 通知没送达
4. TC 误以为 Try 失败，触发 Cancel
5. Cancel 执行了，但 Try 从未真正执行

结果：空回滚
```

### 空回滚的危害

```java
/**
 * 空回滚示例
 */
public class InventoryTccServiceImpl implements InventoryTccService {
    
    @Override
    public boolean tryDecreaseStock(Long productId, Integer count) {
        // 网络问题，这里没执行到
        // 但 Cancel 已经被调用了
        return false;
    }
    
    @Override
    public boolean cancel(BusinessActionContext context) {
        // 空回滚！
        // 没有预留资源，却执行了释放
        
        // 错误的逻辑：
        // inventoryService.restoreFrozen(productId, count);
        
        return true;
    }
}
```

### 空回滚的解决方案

核心思路：**让 Cancel 知道 Try 是否真正执行过。**

```
方案：记录 Try 的执行状态

1. 在 Try 执行前，向数据库插入一条记录
2. Cancel 执行时，检查这条记录是否存在
3. 如果不存在，说明 Try 没执行过，是空回滚
```

```java
/**
 * 空回滚解决方案：记录 Try 执行状态
 */
public class TccActionRecord {
    
    // TCC 记录表
    @TableName("tcc_record")
    public class TccRecord {
        @TableId
        private Long id;
        private String xid;              // 全局事务 ID
        private Long branchId;           // 分支事务 ID
        private String actionName;       // TCC Action 名称
        private String status;          // 状态：TRY/PENDING/CONFIRM/CANCEL
        private Integer tryTime;        // Try 执行时间
        private Integer confirmTime;    // Confirm 执行时间
        private Integer cancelTime;      // Cancel 执行时间
    }
    
    @Autowired
    private TccRecordDao tccRecordDao;
    
    /**
     * Try 方法
     */
    public boolean tryDecreaseStock(Long productId, Integer count) {
        // 1. 记录 Try 状态
        TccRecord record = new TccRecord();
        record.setXid(RootContext.getXID());
        record.setBranchId(getBranchId());
        record.setActionName("inventoryTcc");
        record.setStatus("TRYING");
        record.setTryTime(System.currentTimeMillis());
        
        // 使用唯一键防止重复记录
        try {
            tccRecordDao.insert(record);
        } catch (DuplicateKeyException e) {
            // 已经存在，说明 Try 已经执行过，跳过
            return true;
        }
        
        // 2. 执行 Try 逻辑
        // 冻结库存
        inventoryService.freezeStock(productId, count);
        
        return true;
    }
    
    /**
     * Cancel 方法：检查 Try 是否执行过
     */
    public boolean cancel(BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 查询 Try 执行记录
        TccRecord record = tccRecordDao.selectByXidAndBranchId(xid, branchId);
        
        if (record == null) {
            // Try 记录不存在，是空回滚
            // 记录日志，但不执行任何操作
            log.warn("空回滚检测：xid={}, branchId={}", xid, branchId);
            return true; // 返回成功，但不做任何操作
        }
        
        if ("CONFIRMED".equals(record.getStatus())) {
            // Try 已经确认过了，不能取消
            log.error("异常：Confirm 已执行，不能 Cancel");
            return false;
        }
        
        // 2. 执行 Cancel 逻辑
        // 恢复冻结的库存
        inventoryService.unfreezeStock(productId, count);
        
        // 3. 更新状态
        record.setStatus("CANCELLED");
        record.setCancelTime(System.currentTimeMillis());
        tccRecordDao.updateById(record);
        
        return true;
    }
}
```

## 问题二：幂等

### 什么是幂等性问题

幂等性问题是指：**Try/Confirm/Cancel 方法被重复执行，导致数据错误。**

```
场景：

1. Confirm 方法第一次执行成功了
2. 由于网络问题，TC 没有收到响应
3. TC 重试 Confirm
4. Confirm 第二次执行了

结果：数据被多扣了一次
```

### 幂等的解决方案

核心思路：**用唯一键 + 状态机保证幂等。**

```java
/**
 * 幂等解决方案：状态机 + 唯一键
 */
public class IdempotentTccService {
    
    /**
     * Confirm 方法：幂等实现
     */
    public boolean confirm(BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 检查是否已经 Confirm 过
        // 使用 ON DUPLICATE KEY UPDATE 实现幂等
        String sql = """
            INSERT INTO tcc_record (xid, branch_id, action_name, status, confirm_time)
            VALUES (?, ?, ?, 'CONFIRMED', ?)
            ON DUPLICATE KEY UPDATE
            status = CASE 
                WHEN status = 'CONFIRMED' THEN 'CONFIRMED'  -- 已 Confirm，跳过
                WHEN status = 'TRYING' THEN 'CONFIRMED'     -- Try 中，更新为 Confirm
                ELSE status
            END,
            confirm_time = IF(status != 'CONFIRMED', ?, confirm_time)
            """;
        
        int affectedRows = jdbcTemplate.update(sql,
            xid, branchId, actionName, 
            System.currentTimeMillis(),
            System.currentTimeMillis()
        );
        
        if (affectedRows == 0) {
            // 没有记录，可能 Try 没执行
            log.warn("Confirm 异常：没有 Try 记录");
            return false;
        }
        
        // 2. 执行 Confirm 逻辑
        // 确认扣减库存
        inventoryService.confirmDecrease(productId, count);
        
        return true;
    }
}
```

## 问题三：悬挂

### 什么是悬挂

悬挂是指：**Cancel 方法先于 Confirm 方法执行了。**

```
场景：

1. 分支事务开始
2. Try 执行成功
3. 网络问题：Confirm 通知没送达 TC
4. TC 触发 Cancel
5. Cancel 执行了
6. 之后 Confirm 又执行了

结果：库存被恢复了一次，又被扣了一次
```

### 悬挂的解决方案

核心思路：**Cancel 执行前，检查 Confirm 是否已经执行过。**

```java
/**
 * 悬挂解决方案：检查 Confirm 状态
 */
public class PreventHangingService {
    
    /**
     * Cancel 方法：防止悬挂
     */
    public boolean cancel(BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 查询状态
        TccRecord record = tccRecordDao.selectByXidAndBranchId(xid, branchId);
        
        if (record == null) {
            // 没有 Try 记录，是空回滚（详见空回滚处理）
            return handleEmptyRollback(context);
        }
        
        // 2. 检查是否已经 Confirm
        if ("CONFIRMED".equals(record.getStatus())) {
            // Confirm 已经执行过了，不能 Cancel
            log.error("悬挂检测：Confirm 已执行，不能 Cancel");
            return false;
        }
        
        if ("CANCELLED".equals(record.getStatus())) {
            // 已经被 Cancel 过了，幂等返回
            return true;
        }
        
        // 3. 执行 Cancel
        inventoryService.unfreezeStock(productId, count);
        
        // 4. 更新状态
        record.setStatus("CANCELLED");
        record.setCancelTime(System.currentTimeMillis());
        tccRecordDao.updateById(record);
        
        return true;
    }
}
```

## 综合解决方案

三个问题的综合解决思路：

```
1. 空回滚：Cancel 前检查 Try 记录
2. 幂等：使用唯一键 + 状态机
3. 悬挂：Cancel 前检查 Confirm 状态
```

```java
/**
 * TCC 幂等框架
 */
public abstract class IdempotentTccAction<T> {
    
    @Autowired
    private TccRecordDao tccRecordDao;
    
    /**
     * Try 方法模板
     */
    public boolean tryExecute(T args, BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 检查是否已经执行过（幂等）
        TccRecord existing = tccRecordDao.selectByXidAndBranchId(xid, branchId);
        if (existing != null) {
            if ("CONFIRMED".equals(existing.getStatus())) {
                return true; // 已确认，跳过
            }
            if ("CANCELLED".equals(existing.getStatus())) {
                return false; // 已取消
            }
        }
        
        // 2. 执行 Try
        boolean success = doTry(args);
        
        // 3. 记录状态
        if (success) {
            saveRecord(xid, branchId, "TRYING");
        }
        
        return success;
    }
    
    /**
     * Confirm 方法模板
     */
    public boolean confirmExecute(BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 检查状态（幂等 + 防悬挂）
        TccRecord record = tccRecordDao.selectByXidAndBranchId(xid, branchId);
        
        if (record == null) {
            // 没有 Try 记录，创建记录
            saveRecord(xid, branchId, "CONFIRMED");
        } else if ("CONFIRMED".equals(record.getStatus())) {
            // 已经 Confirm 过，幂等返回
            return true;
        } else if ("CANCELLED".equals(record.getStatus())) {
            // 已经被 Cancel，不能 Confirm
            log.error("Confirm 异常：已被 Cancel");
            return false;
        }
        
        // 2. 执行 Confirm
        boolean success = doConfirm(context);
        
        // 3. 更新状态
        if (success) {
            updateRecordStatus(xid, branchId, "CONFIRMED");
        }
        
        return success;
    }
    
    /**
     * Cancel 方法模板
     */
    public boolean cancelExecute(BusinessActionContext context) {
        String xid = context.getXid();
        Long branchId = context.getBranchId();
        
        // 1. 检查状态（幂等 + 防悬挂）
        TccRecord record = tccRecordDao.selectByXidAndBranchId(xid, branchId);
        
        if (record == null) {
            // 空回滚：Try 记录不存在
            log.warn("空回滚检测：xid={}, branchId={}", xid, branchId);
            return true; // 返回成功，但不做任何操作
        }
        
        if ("CONFIRMED".equals(record.getStatus())) {
            // 防悬挂：已经 Confirm，不能 Cancel
            log.error("悬挂检测：Confirm 已执行，不能 Cancel");
            return false;
        }
        
        if ("CANCELLED".equals(record.getStatus())) {
            // 已经 Cancel 过，幂等返回
            return true;
        }
        
        // 2. 执行 Cancel
        boolean success = doCancel(context);
        
        // 3. 更新状态
        if (success) {
            updateRecordStatus(xid, branchId, "CANCELLED");
        }
        
        return success;
    }
    
    // 子类实现
    protected abstract boolean doTry(T args);
    protected abstract boolean doConfirm(BusinessActionContext context);
    protected abstract boolean doCancel(BusinessActionContext context);
}
```

## 面试追问方向

**追问 1：TCC 三个问题中，哪个最严重？**

分析：
- **空回滚**：最常见，但危害相对小（只影响本次事务）
- **幂等**：最严重，可能导致数据不一致
- **悬挂**：最隐蔽，最难排查

**推荐回答**：
> 幂等问题最严重，因为它可能导致数据不一致。比如 Confirm 重复执行，库存被多扣了。
> 
> 空回滚和悬挂相对好处理，只要在 Cancel 中加检查即可。

**追问 2：Seata 框架有没有内置解决这三个问题？**

Seata TCC 的内置支持：
- **幂等**：TC 会记录分支状态，重复调用会收到同样的结果
- **空回滚**：需要业务自己处理，框架不保证
- **悬挂**：需要业务自己处理，框架不保证

**追问 3：TCC 和 AT 模式，哪个更复杂？**

TCC 更复杂，原因：
1. 需要业务实现三个方法
2. 需要处理三大问题
3. 补偿逻辑需要精心设计

AT 模式虽然有全局锁的性能损耗，但框架会自动处理大部分问题。

## 总结

TCC 三大问题的解决方案：

1. **空回滚**：记录 Try 执行状态，Cancel 前检查
2. **幂等**：唯一键 + 状态机
3. **悬挂**：Cancel 前检查 Confirm 状态

这三个问题本质上是**分布式系统的三大挑战**（重复、丢失、乱序）在 TCC 模式下的具体体现。

理解了这些问题，就理解了分布式事务的一半。
