# 乐观锁与悲观锁：两种并发控制的哲学

面试官问：「你们项目里用的是乐观锁还是悲观锁？」

你说：「嗯... 都有用？」

面试官眉毛一挑：「能具体说说区别和使用场景吗？」

你又沉默了。

乐观锁和悲观锁是两种截然不同的并发控制策略，理解它们的区别是面试必备技能。

---

## 悲观锁：先下手为强

**核心思想**：并发冲突是大概率事件，我先锁住，用完再放。

```sql
-- 悲观锁示例
SELECT * FROM orders WHERE id = 1 FOR UPDATE;  -- 先锁住
-- 其他事务想操作这条记录？等！
UPDATE orders SET status = 'paid' WHERE id = 1;  -- 我先改
COMMIT;  -- 改完了，释放锁
```

### 特点

- **提前加锁**：操作数据前就获取锁
- **阻塞等待**：获取不到锁就等待
- **适合写多场景**：高并发写入时，悲观锁能有效防止冲突

### 实现方式

```sql
-- 方式一：SELECT ... FOR UPDATE
BEGIN;
SELECT * FROM orders WHERE id = 1 FOR UPDATE;
-- 锁定这一行
UPDATE orders SET status = 'paid' WHERE id = 1;
COMMIT;

-- 方式二：直接 UPDATE（InnoDB 会自动加排他锁）
BEGIN;
UPDATE orders SET status = 'paid' WHERE id = 1;
COMMIT;
```

### 优点

- 数据一致性高
- 不会出现更新丢失
- 适合并发写入场景

### 缺点

- 并发性能差（锁等待）
- 容易产生死锁
- 锁的范围和时间长，影响吞吐

---

## 乐观锁：相信世界是美好的

**核心思想**：并发冲突是小概率事件，我先操作，提交时检查有没有冲突。

```sql
-- 乐观锁示例：用一个版本号字段
UPDATE orders
SET status = 'paid', version = version + 1
WHERE id = 1 AND version = 5;  -- 检查版本号

-- 如果 version 不是 5，说明有人改过了，更新失败
-- 业务层决定：重试？还是报错？
```

### 特点

- **不提前加锁**：直接操作数据
- **提交时检查**：通过版本号或时间戳检测冲突
- **适合读多场景**：并发写入少时，性能更好

### 实现方式

```sql
-- 方式一：版本号
ALTER TABLE orders ADD COLUMN version INT DEFAULT 0;
UPDATE orders
SET status = 'paid', version = version + 1
WHERE id = 1 AND version = 5;
-- 影响行数为 0，说明有冲突

-- 方式二：时间戳
ALTER TABLE orders ADD COLUMN update_time DATETIME;
UPDATE orders
SET status = 'paid', update_time = NOW()
WHERE id = 1 AND update_time = '2024-01-01 10:00:00';
```

### Java 实现示例

```java
public class OptimisticLockDemo {
    public boolean updateOrder(long orderId, String newStatus) {
        // 1. 读取当前版本
        Order order = orderMapper.selectById(orderId);
        int currentVersion = order.getVersion();

        // 2. 更新时检查版本
        int rows = orderMapper.updateWithVersion(
            orderId,
            newStatus,
            currentVersion  // 条件：版本号必须是当前版本
        );

        // 3. 如果更新失败（rows=0），说明有冲突
        if (rows == 0) {
            // 可以重试或抛异常
            throw new OptimisticLockException("数据已被其他事务修改");
        }
        return true;
    }
}

@Mapper
public interface OrderMapper {
    @Update("<script>" +
        "UPDATE orders SET status = #{status}, version = version + 1 " +
        "WHERE id = #{id} AND version = #{version}" +
        "</script>")
    int updateWithVersion(@Param("id") long id,
                          @Param("status") String status,
                          @Param("version") int version);
}
```

### 优点

- 不阻塞，性能好
- 无死锁风险
- 吞吐量大

### 缺点

- 冲突时需要重试
- 成功率依赖冲突概率
- 不适合写多场景

---

## 对比总结

| 特性 | 悲观锁 | 乐观锁 |
|------|--------|--------|
| 策略 | 预防冲突 | 解决冲突 |
| 加锁时机 | 操作前加锁 | 提交时检查 |
| 阻塞情况 | 阻塞等待 | 不阻塞 |
| 适用场景 | 写多、高冲突 | 读多、低冲突 |
| 并发性能 | 较差 | 较好 |
| 实现复杂度 | 简单 | 稍复杂 |
| 冲突处理 | 无（锁保证） | 重试 |

---

## 场景选择

### 选择悲观锁的场景

```java
// 场景：库存扣减
public boolean deductStock悲观(long productId, int count) {
    // 必须串行执行，防止超卖
    try {
        // 悲观锁：直接锁定行
        Stock stock = stockMapper.selectForUpdate(productId);
        if (stock.getCount() >= count) {
            stockMapper.updateCount(productId, stock.getCount() - count);
            return true;
        }
        return false;
    } finally {
        // 锁会自动释放
    }
}
```

### 选择乐观锁的场景

```java
// 场景：用户信息更新
public boolean updateUser乐观(long userId, String newName) {
    for (int i = 0; i < 3; i++) {
        User user = userMapper.selectById(userId);
        int rows = userMapper.updateWithVersion(
            userId, newName, user.getVersion()
        );
        if (rows > 0) {
            return true;  // 更新成功
        }
        // 冲突，稍后重试
        Thread.sleep(10);
    }
    return false;  // 重试次数用完
}
```

### 混合使用

实际项目中，往往是两种锁混合使用：

```java
public class HybridLockDemo {
    /**
     * 混合使用：乐观锁 + 悲观锁
     */
    public boolean processOrder(long orderId) {
        // 1. 先用乐观锁：快速判断能不能操作
        Order order = orderMapper.selectById(orderId);
        if (!order.canProcess()) {
            return false;  // 不能处理，快速返回
        }

        // 2. 再用悲观锁：确保数据一致性
        try {
            order = orderMapper.selectForUpdate(orderId);
            if (order.canProcess()) {
                orderMapper.updateStatus(orderId, "processed");
                return true;
            }
            return false;
        } finally {
            // 悲观锁释放
        }
    }
}
```

---

## 面试场景

**面试官：** 乐观锁和悲观锁的区别是什么？

**你：** 悲观锁是先获取锁再操作，冲突时阻塞等待；乐观锁是先操作再检查，冲突时重试。悲观锁适合高并发写入，乐观锁适合读多写少。

**面试官：** 乐观锁怎么实现？

**你：** 通常用版本号或时间戳。更新时检查版本号是否变化，如果变了说明有冲突，需要重试或报错。

**面试官：** 乐观锁的重试次数怎么定？

**你：** 要根据业务场景定。库存扣减这种实时性要求高的，重试 2-3 次就够了；数据合并类业务，可以多试几次。同时要设置最大重试次数，防止无限循环。

---

## 一句话总结

悲观锁：**先锁后干**，适合写多冲突多；乐观锁：**先干后查**，适合读多冲突少。选择哪种，取决于你对并发冲突概率的判断。
