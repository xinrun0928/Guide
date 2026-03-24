# MySQL 分布式锁实现：唯一索引与悲观锁

当 Redis 锁让你不放心时，你最后的选择往往是 MySQL。

不是因为 MySQL 性能更好——恰恰相反，MySQL 是所有分布式锁方案中性能最差的。

但它有一个无可替代的优点：**可靠**。

MySQL 有事务，有 ACID，有持久化。锁存在数据库里，不会因为进程崩溃而丢失。

这就是为什么金融交易、库存扣减这些强一致性场景，很多人首选 MySQL 分布式锁。

## 方案一：唯一索引（最常用）

### 原理

利用 MySQL 的**唯一索引冲突**来实现互斥。

```sql
CREATE TABLE distributed_lock (
    lock_name VARCHAR(64) NOT NULL PRIMARY KEY,
    owner VARCHAR(64) NOT NULL,
    expire_time DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_lock_name (lock_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
```

获取锁时插入一条记录：

```sql
INSERT INTO distributed_lock (lock_name, owner, expire_time)
VALUES ('order:lock:123', 'client-001', DATE_ADD(NOW(), INTERVAL 30 SECOND))
ON DUPLICATE KEY UPDATE lock_name = lock_name;
```

如果 `lock_name` 已经存在，`INSERT` 会失败——这就是「获取锁失败」。

### 释放锁

```sql
DELETE FROM distributed_lock
WHERE lock_name = 'order:lock:123' AND owner = 'client-001';
```

必须同时验证 `owner`，否则会误删别人的锁。

### Java 实现

```java
public class MySQLDistributedLock implements AutoCloseable {
    
    private final DataSource dataSource;
    private final String lockName;
    private final String owner;
    private final int expireSeconds;
    private Connection connection;
    
    public MySQLDistributedLock(DataSource dataSource, String lockName, int expireSeconds) {
        this.dataSource = dataSource;
        this.lockName = lockName;
        this.owner = UUID.randomUUID().toString();
        this.expireSeconds = expireSeconds;
    }
    
    /**
     * 尝试获取锁
     */
    public boolean tryLock() {
        try {
            connection = dataSource.getConnection();
            connection.setAutoCommit(false);  // 关闭自动提交
            
            String sql = 
                "INSERT INTO distributed_lock (lock_name, owner, expire_time) " +
                "VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND)) " +
                "ON DUPLICATE KEY UPDATE lock_name = lock_name";
            
            PreparedStatement ps = connection.prepareStatement(sql);
            ps.setString(1, lockName);
            ps.setString(2, owner);
            ps.setInt(3, expireSeconds);
            
            int result = ps.executeUpdate();
            connection.commit();
            
            return result == 1;
            
        } catch (SQLException e) {
            rollbackQuietly();
            return false;
        }
    }
    
    /**
     * 阻塞获取锁
     */
    public boolean lock(long timeout, TimeUnit unit) {
        long deadline = System.currentTimeMillis() + unit.toMillis(timeout);
        
        while (System.currentTimeMillis() < deadline) {
            if (tryLock()) {
                return true;
            }
            try {
                Thread.sleep(50);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return false;
    }
    
    /**
     * 释放锁（只释放自己持有的锁）
     */
    public void unlock() {
        String sql = "DELETE FROM distributed_lock WHERE lock_name = ? AND owner = ?";
        
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setString(1, lockName);
            ps.setString(2, owner);
            ps.executeUpdate();
        } catch (SQLException e) {
            // 忽略异常
        } finally {
            closeQuietly();
        }
    }
    
    /**
     * 检查并续期锁
     * 业务执行时间可能超过 expireSeconds，需要续期
     */
    public boolean extend(int additionalSeconds) {
        String sql = 
            "UPDATE distributed_lock SET expire_time = DATE_ADD(NOW(), INTERVAL ? SECOND) " +
            "WHERE lock_name = ? AND owner = ? AND expire_time > NOW()";
        
        try (PreparedStatement ps = connection.prepareStatement(sql)) {
            ps.setInt(1, additionalSeconds);
            ps.setString(2, lockName);
            ps.setString(3, owner);
            
            int result = ps.executeUpdate();
            return result == 1;
        } catch (SQLException e) {
            return false;
        }
    }
    
    @Override
    public void close() {
        unlock();
    }
    
    private void rollbackQuietly() {
        if (connection != null) {
            try {
                connection.rollback();
            } catch (SQLException ignored) {
            }
        }
    }
    
    private void closeQuietly() {
        if (connection != null) {
            try {
                connection.close();
            } catch (SQLException ignored) {
            }
        }
    }
}
```

### 使用示例

```java
public class OrderService {
    
    private final DataSource dataSource;
    
    public void createOrder(Long orderId) {
        try (MySQLDistributedLock lock = 
                new MySQLDistributedLock(dataSource, "order:lock:" + orderId, 30)) {
            
            if (lock.lock(10, TimeUnit.SECONDS)) {
                // 检查并续期
                lock.extend(30);
                
                // 执行业务逻辑
                doCreateOrder(orderId);
            } else {
                throw new RuntimeException("系统繁忙，请稍后重试");
            }
        }
    }
}
```

## 方案二：悲观锁（SELECT FOR UPDATE）

### 原理

使用 `SELECT ... FOR UPDATE` 获取排他锁：

```sql
BEGIN;

SELECT * FROM distributed_lock 
WHERE lock_name = 'order:lock:123' 
FOR UPDATE;

-- 业务逻辑...

UPDATE distributed_lock 
SET expire_time = DATE_ADD(NOW(), INTERVAL 30 SECOND)
WHERE lock_name = 'order:lock:123';

COMMIT;
```

`FOR UPDATE` 会在行上加排他锁，阻止其他事务读取或修改这行数据。

### 适用场景

悲观锁适合**在事务中需要长时间持有锁**的场景：

```java
public void transfer(String fromAccount, String toAccount, BigDecimal amount) {
    connection.setAutoCommit(false);
    
    try {
        // 锁定两个账户
        String sql = "SELECT * FROM account WHERE account_id IN (?, ?) FOR UPDATE";
        PreparedStatement ps = connection.prepareStatement(sql);
        ps.setString(1, fromAccount);
        ps.setString(2, toAccount);
        ResultSet rs = ps.executeQuery();
        
        // 按顺序锁定，避免死锁
        if (fromAccount.compareTo(toAccount) > 0) {
            // 如果 fromAccount > toAccount，先锁 toAccount
            ps.setString(1, toAccount);
            ps.setString(2, fromAccount);
            rs = ps.executeQuery();
        }
        
        // 执行转账
        deductBalance(fromAccount, amount);
        addBalance(toAccount, amount);
        
        connection.commit();
        
    } catch (SQLException e) {
        connection.rollback();
        throw new RuntimeException("转账失败", e);
    }
}
```

### 注意事项

1. **必须在事务中使用**：`FOR UPDATE` 只在事务中有效
2. **避免死锁**：多个事务按相同顺序获取锁
3. **及时释放**：事务时间过长会阻塞其他操作

## MySQL 锁的优缺点

### 优点

| 优点 | 说明 |
|------|------|
| 可靠性高 | MySQL 天然支持事务和持久化，锁不会丢失 |
| 实现简单 | 基于唯一索引，几行 SQL 搞定 |
| 功能丰富 | 支持公平锁、可重入（需要额外实现） |
| 运维友好 | 有成熟的管理工具和监控体系 |

### 缺点

| 缺点 | 说明 |
|------|------|
| 性能差 | 需要磁盘 I/O，比 Redis 慢 10-100 倍 |
| 数据库是单点 | 虽然可以主从，但锁还是在主库 |
| 占用数据库资源 | 连接数、存储空间 |
| 网络依赖 | 应用和数据库之间网络抖动会影响锁 |

## MySQL 锁 vs Redis 锁

| 维度 | MySQL 锁 | Redis 锁 |
|------|----------|----------|
| 性能 | 低（毫秒级） | 高（微秒级） |
| 可靠性 | 高 | 中 |
| 实现复杂度 | 低 | 中（Redisson 封装后低） |
| 锁丢失风险 | 低 | 中（主从切换时可能丢失） |
| 适用场景 | 强一致性、低并发 | 高性能、中等可靠性 |

## 方案三：防死锁的增强方案

基础方案有个问题：**如果持有锁的客户端崩溃了，锁会一直存在**。

解决方法是**定期清理过期锁**：

```sql
-- 定时任务执行
DELETE FROM distributed_lock 
WHERE expire_time < NOW();

-- 或者在获取锁时清理
DELETE FROM distributed_lock 
WHERE lock_name = ? AND expire_time < NOW();

INSERT INTO distributed_lock (lock_name, owner, expire_time)
VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND));
```

或者在插入前先清理：

```java
public boolean tryLock() {
    // 先清理过期锁
    String deleteSql = "DELETE FROM distributed_lock WHERE lock_name = ? AND expire_time < NOW()";
    PreparedStatement deletePs = connection.prepareStatement(deleteSql);
    deletePs.setString(1, lockName);
    deletePs.executeUpdate();
    
    // 再尝试插入
    String insertSql = "INSERT INTO distributed_lock (lock_name, owner, expire_time) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))";
    // ...
}
```

## 面试追问方向

- MySQL 分布式锁和 Redis 分布式锁的区别是什么？
- 为什么 MySQL 锁的性能比 Redis 差？
- `SELECT FOR UPDATE` 和唯一索引锁有什么区别？
- 如何防止 MySQL 锁的死锁问题？
- MySQL 锁的 owner 字段有什么用？

## 总结

MySQL 分布式锁是**强可靠性场景**的首选：

- **唯一索引方案**：简单直接，利用插入冲突实现互斥
- **悲观锁方案**：适合在事务中长时间持有锁的场景
- **关键点**：必须验证 owner，防止误删别人的锁

性能不如 Redis，但胜在可靠。如果你的业务**不允许任何锁丢失**，选 MySQL。

一个常见的误解是「用了 MySQL 就万事大吉」。实际上，MySQL 锁也需要合理设置过期时间、定期清理过期锁、避免长事务——这些管理工作一样都不能少。
