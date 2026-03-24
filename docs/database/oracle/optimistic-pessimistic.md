# Oracle 乐观锁与悲观锁：并发控制的双剑客

你有没有遇到过这种纠结：

用乐观锁还是悲观锁？

乐观锁说：最后再检查冲突。
悲观锁说：先把锁拿了再说。

选错了，系统卡死；选对了，性能飞起。

今天，彻底搞懂这两种锁策略。

---

## 为什么需要锁策略？

并发环境下，数据可能被多个事务同时修改：

```
时间线：
─────────────────────────────────────────────────────►

事务A:  读取库存=100     计算-1=99       写入99
事务B:       读取库存=100     计算-1=99       写入99

结果：库存从100变成99，实际扣减了2次！
```

锁策略就是来解决这个问题的。

---

## 悲观锁（Pessimistic Locking）

### 核心思想

**先锁定再操作**：假设并发冲突一定会发生，所以在读取数据时就加锁。

```sql
-- 悲观锁：SELECT FOR UPDATE
SELECT stock INTO v_stock 
FROM inventory 
WHERE product_id = 100 
FOR UPDATE;  -- 锁定这行

-- 检查库存
IF v_stock >= v_quantity THEN
    -- 更新库存
    UPDATE inventory SET stock = stock - v_quantity WHERE product_id = 100;
    COMMIT;
ELSE
    ROLLBACK;
    -- 库存不足
END IF;
```

### 悲观锁的 Java 实现

```java
public class InventoryService {
    
    public boolean purchaseWithPessimisticLock(
            Connection conn, long productId, int quantity) throws SQLException {
        
        try {
            conn.setAutoCommit(false);
            
            // 1. 锁定并读取库存
            String lockSql = """
                SELECT stock FROM inventory 
                WHERE product_id = ? 
                FOR UPDATE
                """;
            
            try (PreparedStatement ps = conn.prepareStatement(lockSql)) {
                ps.setLong(1, productId);
                ResultSet rs = ps.executeQuery();
                
                if (!rs.next()) {
                    conn.rollback();
                    return false;  // 产品不存在
                }
                
                int stock = rs.getInt("stock");
                
                // 2. 检查库存
                if (stock < quantity) {
                    conn.rollback();
                    return false;  // 库存不足
                }
                
                // 3. 更新库存
                String updateSql = """
                    UPDATE inventory 
                    SET stock = stock - ? 
                    WHERE product_id = ?
                    """;
                
                try (PreparedStatement ups = conn.prepareStatement(updateSql)) {
                    ups.setInt(1, quantity);
                    ups.setLong(2, productId);
                    ups.executeUpdate();
                }
            }
            
            conn.commit();
            return true;
            
        } catch (SQLException e) {
            conn.rollback();
            throw e;
        }
    }
}
```

### 悲观锁的特点

| 特点 | 说明 |
|-----|------|
| 锁获取时机 | 读取数据时立即加锁 |
| 冲突处理 | 阻塞等待 |
| 适用场景 | 冲突频繁、数据一致性要求高 |
| 性能影响 | 锁持有时间长，并发能力下降 |
| 死锁风险 | 存在（需要统一加锁顺序） |

### 悲观锁的变体

```sql
-- NOWAIT：不等待锁
SELECT stock FROM inventory WHERE product_id = 100 FOR UPDATE NOWAIT;
-- 锁被占用时立即报错 ORA-00054

-- WAIT n：等待 n 秒
SELECT stock FROM inventory WHERE product_id = 100 FOR UPDATE WAIT 10;
-- 等待超过 10 秒后报错

-- SKIP LOCKED：跳过已锁定的行（Oracle 12c+）
SELECT * FROM task_queue WHERE status = 'PENDING' 
FOR UPDATE SKIP LOCKED;
-- 已锁定的行被跳过，不等待
```

---

## 乐观锁（Optimistic Locking）

### 核心思想

**最后再检查冲突**：假设并发冲突很少发生，读取数据时不加锁，更新时检查数据是否被修改。

```sql
-- 乐观锁：使用版本号
-- 读取数据（包含版本号）
SELECT stock, version INTO v_stock, v_version
FROM inventory 
WHERE product_id = 100;

-- 计算新库存
v_new_stock := v_stock - v_quantity;

-- 更新（带版本检查）
UPDATE inventory 
SET stock = v_new_stock, 
    version = version + 1
WHERE product_id = 100 
  AND version = v_version;  -- 版本匹配才更新

-- 检查影响行数
IF SQL%ROWCOUNT = 0 THEN
    -- 版本不匹配，说明数据被修改过，重试
    ROLLBACK;
ELSE
    COMMIT;
END IF;
```

### 乐观锁的 Java 实现

```java
public class InventoryService {
    
    public boolean purchaseWithOptimisticLock(
            Connection conn, long productId, int quantity, int expectedVersion) 
            throws SQLException {
        
        String sql = """
            UPDATE inventory 
            SET stock = stock - ?,
                version = version + 1
            WHERE product_id = ?
              AND version = ?
              AND stock >= ?
            """;
        
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setInt(1, quantity);
            ps.setLong(2, productId);
            ps.setInt(3, expectedVersion);
            ps.setInt(4, quantity);
            
            int rows = ps.executeUpdate();
            return rows > 0;
        }
    }
    
    // 带重试的乐观锁
    public boolean purchaseWithRetry(
            Connection conn, long productId, int quantity, int maxRetries) 
            throws SQLException {
        
        int retries = 0;
        while (retries < maxRetries) {
            // 获取当前版本
            int currentVersion = getCurrentVersion(conn, productId);
            
            // 尝试更新
            if (purchaseWithOptimisticLock(conn, productId, quantity, currentVersion)) {
                return true;  // 成功
            }
            
            retries++;
            if (retries < maxRetries) {
                try {
                    Thread.sleep(50 * retries);  // 指数退避
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        
        return false;  // 重试次数用尽
    }
    
    private int getCurrentVersion(Connection conn, long productId) throws SQLException {
        String sql = "SELECT version FROM inventory WHERE product_id = ?";
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, productId);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return rs.getInt("version");
            }
            throw new SQLException("Product not found: " + productId);
        }
    }
}
```

### 乐观锁的特点

| 特点 | 说明 |
|-----|------|
| 锁获取时机 | 更新时才检查 |
| 冲突处理 | 失败后重试 |
| 适用场景 | 冲突较少、数据一致性要求高 |
| 性能影响 | 无阻塞，并发能力强 |
| 死锁风险 | 低 |

---

## 性能对比

### 并发性能对比

```
并发度
   ↑
   │    ╭─── 乐观锁
   │   ╱
   │  ╱
   │ ╱
   │╱
   └───────────────────────────► 数据冲突率
```

| 场景 | 推荐策略 | 原因 |
|-----|---------|------|
| 冲突率 < 5% | 乐观锁 | 几乎无阻塞，并发能力最强 |
| 冲突率 5-20% | 乐观锁（加重试） | 偶尔重试，性能可接受 |
| 冲突率 > 20% | 悲观锁 | 乐观锁重试开销大 |
| 冲突率 > 50% | 悲观锁 | 乐观锁几乎不可用 |

### 锁等待时间对比

```java
// 悲观锁：锁等待时间 = 锁持有时间
// 悲观锁场景：
// 1. 读取数据：立即获取锁
// 2. 业务处理：锁持有中
// 3. 写入数据：释放锁
// 总等待时间 = 业务处理时间

// 乐观锁：等待时间 = 重试次数 × 每次操作时间
// 乐观锁场景：
// 1. 读取数据：无锁
// 2. 业务处理：无锁
// 3. 写入数据：检查版本
//    - 成功：无等待
//    - 失败：重试（可能多次）
```

---

## 实际场景选择

### 场景一：库存扣减

```java
// 推荐：悲观锁（冲突频繁）
public class InventoryService {
    
    @Transactional
    public void purchase(long productId, int quantity) {
        // 悲观锁：确保数据一致性
        Inventory inv = inventoryRepository.findByIdForUpdate(productId);
        if (inv.getStock() < quantity) {
            throw new InsufficientStockException();
        }
        inv.setStock(inv.getStock() - quantity);
        inventoryRepository.save(inv);
    }
}
```

### 场景二：用户资料更新

```java
// 推荐：乐观锁（冲突极少）
public class UserService {
    
    @Transactional
    public void updateUser(Long userId, UserUpdateRequest request) {
        // 乐观锁：读取当前版本
        User user = userRepository.findById(userId);
        
        // 修改数据
        user.setName(request.getName());
        user.setEmail(request.getEmail());
        
        // 乐观锁更新（版本检查）
        int rows = userRepository.updateWithOptimisticLock(user);
        if (rows == 0) {
            throw new OptimisticLockException("用户数据已被修改");
        }
    }
}
```

### 场景三：订单状态流转

```java
// 推荐：悲观锁（状态流转必须串行）
public class OrderService {
    
    @Transactional
    public void processOrder(long orderId) {
        // 悲观锁：锁定订单
        Order order = orderRepository.findByIdForUpdate(orderId);
        
        // 状态检查
        if (order.getStatus() != OrderStatus.PENDING) {
            throw new InvalidOrderStatusException();
        }
        
        // 状态流转
        order.setStatus(OrderStatus.PROCESSING);
        orderRepository.save(order);
    }
}
```

### 场景四：计数器更新

```java
// 推荐：乐观锁（计数器冲突概率低）
public class CounterService {
    
    public void increment(String counterName, int delta) {
        int maxRetries = 3;
        int retries = 0;
        
        while (retries < maxRetries) {
            Counter counter = counterRepository.findByName(counterName);
            int newValue = counter.getValue() + delta;
            
            int rows = counterRepository.updateValue(
                counterName, counter.getVersion(), newValue);
            
            if (rows > 0) {
                return;
            }
            retries++;
        }
        
        throw new ConcurrentModificationException("计数器更新失败");
    }
}
```

---

## 混合策略

有时候可以结合两种策略：

```java
public class SmartInventoryService {
    
    // 热点商品使用悲观锁（冲突多）
    @Transactional
    public void purchaseHotItem(long productId, int quantity) {
        Inventory inv = inventoryRepository.findByIdForUpdate(productId);
        // ... 悲观锁处理
    }
    
    // 普通商品使用乐观锁（冲突少）
    public void purchaseNormalItem(long productId, int quantity) {
        int maxRetries = 3;
        int retries = 0;
        
        while (retries < maxRetries) {
            Inventory inv = inventoryRepository.findById(productId);
            
            if (inv.getStock() < quantity) {
                throw new InsufficientStockException();
            }
            
            int rows = inventoryRepository.updateWithOptimisticLock(
                productId, inv.getVersion(), inv.getStock() - quantity);
            
            if (rows > 0) {
                return;
            }
            retries++;
        }
        
        throw new ConcurrentModificationException();
    }
}
```

---

## 面试高频问题

### Q1: 乐观锁和悲观锁的区别？

悲观锁在读取数据时就加锁，假设并发冲突一定发生；乐观锁在更新时才检查冲突，假设并发冲突很少发生。悲观锁适合冲突频繁的场景，乐观锁适合冲突较少的场景。

### Q2: 乐观锁怎么实现？

常用方法：版本号（version）、时间戳（timestamp）、或计算更新前后的值是否变化。更新时 WHERE 条件包含版本号，如果影响行数为 0 说明版本已变化。

### Q3: 乐观锁重试次数用完了怎么办？

重试次数用完后应该抛出明确的异常（如 OptimisticLockException），让调用方决定如何处理：显示错误给用户、放入重试队列、或人工干预。

### Q4: 什么时候选择悲观锁？

高并发写场景（如库存扣减）、状态流转必须串行的场景、长时间计算后更新的场景。

---

## 总结

| 特性 | 乐观锁 | 悲观锁 |
|-----|--------|--------|
| 锁时机 | 更新时检查 | 读取时加锁 |
| 冲突处理 | 重试 | 等待 |
| 并发能力 | 高 | 低 |
| 死锁风险 | 低 | 存在 |
| 适用场景 | 冲突少 | 冲突多 |
| 实现复杂度 | 稍高 | 简单 |

没有最好的锁策略，只有最适合场景的策略。

---

## 下一步

- [Oracle 锁机制](/database/oracle/lock)：锁的内部实现
- [Oracle SQL 优化](/database/oracle/sql-tuning)：慢查询调优
