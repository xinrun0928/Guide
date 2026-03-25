# Spring 事务传播行为 7 种详解

你知道吗？当一个事务方法调用另一个事务方法时，它们是在同一个事务中运行，还是各自独立？

这就是**事务传播行为**要解决的问题。

## 为什么需要传播行为？

假设有这样的场景：

```java
@Service
public class OrderService {
    @Transactional
    public void createOrder(Order order) {
        // 创建订单
        orderMapper.insert(order);
        // 调用库存服务
        inventoryService.reduceStock(order.getProductId());
    }
}

@Service
public class InventoryService {
    @Transactional
    public void reduceStock(Long productId) {
        // 扣减库存
        inventoryMapper.reduce(productId);
        if (/* 库存不足 */) {
            throw new RuntimeException("库存不足");
        }
    }
}
```

当 `createOrder` 调用 `reduceStock` 时：

- 如果 `reduceStock` 出错，`createOrder` 应该回滚吗？
- 如果 `createOrder` 和 `reduceStock` 各自在独立的事务中运行会怎样？

**事务传播行为**决定了这些问题的答案。

## 七种传播行为一览

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         七种事务传播行为                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  REQUIRED（默认）         → 有就用，没有就创建                        │
│  REQUIRES_NEW            → 总是创建新事务                             │
│  SUPPORTS               → 有就用，没有就不管                          │
│  NOT_SUPPORTED          → 不使用事务                                 │
│  MANDATORY              → 必须在事务中运行                           │
│  NEVER                  → 必须在非事务中运行                         │
│  NESTED                  → 嵌套事务（保存点）                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 详细解析

### 1. REQUIRED（默认）

**规则**：如果当前有事务，就加入；如果没有，就创建新事务。

```java
@Service
public class A {
    @Transactional
    public void methodA() {
        // 开启事务 T1
        b.methodB();  // 加入事务 T1
    }
}

@Service
public class B {
    @Transactional(propagation = Propagation.REQUIRED)
    public void methodB() {
        // 加入事务 T1
        // A 和 B 在同一个事务中
    }
}
```

**场景**：大多数业务场景使用此默认值。

### 2. REQUIRES_NEW

**规则**：总是创建新事务，挂起当前事务。

```java
@Service
public class A {
    @Transactional
    public void methodA() {
        // 开启事务 T1
        b.methodB();  // 事务 T1 挂起
        // 创建新事务 T2
    }
}

@Service
public class B {
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void methodB() {
        // 在独立事务 T2 中运行
        // T2 提交或回滚不影响 T1
    }
}
```

**特点**：
- A 的事务 T1 被挂起
- B 创建新事务 T2
- T1 和 T2 完全独立

**使用场景**：
- 日志记录（无论业务成功与否，日志都应该记录）
- 审计功能（需要独立记录）

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        orderMapper.insert(order);
        // 即使这里抛异常，日志也应该记录
        auditLogService.log("创建订单");
    }
}

@Service
public class AuditLogService {
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String message) {
        // 在独立事务中记录日志
        auditMapper.insert(message);
    }
}
```

### 3. SUPPORTS

**规则**：如果当前有事务，就加入；如果没有，就以非事务方式运行。

```java
// 场景一：调用方有事务
@Service
public class A {
    @Transactional
    public void methodA() {
        b.methodB();  // 加入事务 T1
    }
}

// 场景二：调用方没有事务
@Service
public class C {
    public void methodC() {
        b.methodB();  // 以非事务方式运行
    }
}

@Service
public class B {
    @Transactional(propagation = Propagation.SUPPORTS)
    public void methodB() {
        // 可能加入事务，也可能没有
    }
}
```

**使用场景**：
- 可选的事务操作
- 对事务没有强制要求的方法

### 4. NOT_SUPPORTED

**规则**：以非事务方式运行，挂起当前事务。

```java
@Service
public class A {
    @Transactional
    public void methodA() {
        // 开启事务 T1
        b.methodB();  // 事务 T1 挂起
        // 以非事务方式运行
    }
}

@Service
public class B {
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void methodB() {
        // 以非事务方式运行
        // 不受事务 T1 影响
    }
}
```

**使用场景**：
- 发送通知（不需要事务保证）
- 不支持事务的第三方调用

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        orderMapper.insert(order);
        // 发送通知不需要事务
        notificationService.sendNotify(order);
    }
}

@Service
public class NotificationService {
    
    @Transactional(propagation = Propagation.NOT_SUPPORTED)
    public void sendNotify(Order order) {
        // 即使失败也不影响订单创建
    }
}
```

### 5. MANDATORY

**规则**：必须在事务中运行，否则抛异常。

```java
@Service
public class B {
    @Transactional(propagation = Propagation.MANDATORY)
    public void methodB() {
        // 必须在事务中运行
    }
}

// 错误用法
@Service
public class C {
    public void methodC() {
        b.methodB();  // 抛异常：No existing transaction found
    }
}
```

**使用场景**：
- 强制要求在事务中执行的方法
- 防止被误用在非事务场景

```java
@Service
public class InventoryService {
    
    // 强制要求在事务中运行
    @Transactional(propagation = Propagation.MANDATORY)
    public void reduceStock(Long productId) {
        inventoryMapper.reduce(productId);
    }
}
```

### 6. NEVER

**规则**：必须在非事务中运行，否则抛异常。

```java
@Service
public class B {
    @Transactional(propagation = Propagation.NEVER)
    public void methodB() {
        // 必须在非事务中运行
    }
}

// 错误用法
@Service
public class A {
    @Transactional
    public void methodA() {
        b.methodB();  // 抛异常：Existing transaction found
    }
}
```

**使用场景**：
- 确保不使用事务的方法
- 与不支持事务的资源交互

### 7. NESTED（嵌套事务）

**规则**：如果有当前事务，就在嵌套事务中运行；如果没有，就创建新事务。

```java
@Service
public class A {
    @Transactional
    public void methodA() {
        // 开启事务 T1
        b.methodB();  // 创建嵌套事务（保存点 S1）
        throw new RuntimeException("A 出错");  // 回滚到保存点 S1
    }
}

@Service
public class B {
    @Transactional(propagation = Propagation.NESTED)
    public void methodB() {
        // 在嵌套事务中运行
        // 可以独立回滚到保存点
    }
}
```

**特点**：
- 使用数据库的保存点（savepoint）实现
- 嵌套事务可以独立回滚，不影响外层事务
- 外层事务回滚，嵌套事务也会回滚

**使用场景**：
- 部分操作需要回滚，部分需要提交

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        // 创建订单
        orderMapper.insert(order);
        
        try {
            // 扣减库存 - 如果失败，只回滚这部分
            inventoryService.reduceStock(order.getProductId());
        } catch (StockException e) {
            // 库存不足，但订单还是创建了
            // 可以记录警告或发送通知
        }
        
        // 发送通知 - 如果失败，不影响订单
        try {
            notificationService.sendNotify(order);
        } catch (Exception e) {
            // 记录日志即可
        }
    }
}

@Service
public class InventoryService {
    
    @Transactional(propagation = Propagation.NESTED)
    public void reduceStock(Long productId) {
        inventoryMapper.reduce(productId);
    }
}
```

## 对比总结

| 传播行为 | 有事务时 | 无事务时 | 特点 |
|---------|---------|---------|------|
| **REQUIRED** | 加入 | 创建新事务 | **默认**，最常用 |
| **REQUIRES_NEW** | 挂起，创建新事务 | 创建新事务 | 事务完全独立 |
| **SUPPORTS** | 加入 | 非事务运行 | 可选事务 |
| **NOT_SUPPORTED** | 挂起 | 非事务运行 | 不使用事务 |
| **MANDATORY** | 加入 | 抛异常 | 强制事务 |
| **NEVER** | 抛异常 | 非事务运行 | 强制非事务 |
| **NESTED** | 嵌套（保存点）| 创建新事务 | 部分回滚 |

## 实际案例

### 案例一：订单创建与库存扣减

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        // 1. 创建订单
        orderMapper.insert(order);
        
        // 2. 扣减库存（必须和订单在同一事务）
        inventoryService.reduceStock(order.getProductId(), order.getQuantity());
        
        // 3. 扣减余额（必须和订单在同一事务）
        accountService.reduceBalance(order.getUserId(), order.getAmount());
    }
}

@Service
public class InventoryService {
    
    @Transactional(propagation = Propagation.REQUIRED)  // 默认值
    public void reduceStock(Long productId, Integer quantity) {
        // 如果失败，整个订单创建回滚
    }
}
```

### 案例二：订单创建与日志记录

```java
@Service
public class OrderService {
    
    @Transactional
    public void createOrder(Order order) {
        orderMapper.insert(order);
        
        // 日志需要独立事务，避免日志失败影响业务
        auditLogService.log("创建订单: " + order.getId());
    }
}

@Service
public class AuditLogService {
    
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void log(String message) {
        // 即使失败也不影响订单创建
    }
}
```

### 案例三：可选的事务方法

```java
@Service
public class ReportService {
    
    @Transactional(propagation = Propagation.SUPPORTS)
    public List&lt;Order&gt; generateReport() {
        // 有事务时使用事务，无事务时直接查询
        // 通常用于只读操作
    }
}
```

## 面试核心问题

### Q1：七种传播行为是什么？

| 传播行为 | 说明 |
|---------|-----|
| REQUIRED | 有就用，没有创建 |
| REQUIRES_NEW | 总是创建新事务 |
| SUPPORTS | 有就用，没有不管 |
| NOT_SUPPORTED | 不使用事务 |
| MANDATORY | 必须在事务中 |
| NEVER | 必须在非事务中 |
| NESTED | 嵌套事务（保存点）|

### Q2：REQUIRED 和 REQUIRES_NEW 的区别？

- **REQUIRED**：加入当前事务，共享事务
- **REQUIRES_NEW**：挂起当前事务，创建完全独立的新事务

### Q3：NESTED 和 REQUIRED 的区别？

- **REQUIRED**：完全在同一个事务中，一个回滚全部回滚
- **NESTED**：使用保存点，可以部分回滚

### Q4：什么场景下用 REQUIRES_NEW？

- 日志记录（无论业务成功与否都要记录）
- 审计功能（需要独立记录）
- 发送通知（不需要事务保证）

## 总结

```
┌────────────────────────────────────────────────────────────┐
│                    事务传播行为选择指南                     │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  REQUIRED   → 大部分场景，默认选择                         │
│  REQUIRES_NEW → 需要独立事务的操作                       │
│  SUPPORTS   → 可选的事务                                 │
│  NOT_SUPPORTED → 不需要事务的操作                       │
│  MANDATORY  → 强制要求事务                             │
│  NEVER      → 强制非事务                               │
│  NESTED      → 需要部分回滚的场景                       │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

---

**下节预告**：[Spring 事务失效场景与解决方案](/framework/spring/transaction-fail) —— 盘点 @Transactional 失效的各种场景及解决方案。
