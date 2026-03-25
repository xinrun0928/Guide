# 乐观锁：让并发更新不再成为噩梦

你有没有遇到过这种情况：

两个运营同时编辑同一个商品价格，一个改成了 99 元，一个改成了 100 元。

保存后，价格是 100 元——那 99 元的修改去哪了？

这就是典型的**并发更新丢失**问题。MyBatis Plus 的**乐观锁**插件，就是来解决这个问题的。

## 并发更新的问题

### 问题场景

```
┌─────────────────────────────────────────────────────────────────┐
│                    并发更新丢失问题                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  运营 A                    运营 B                                │
│     │                         │                                  │
│     ├─ 读取商品: price=80 ───┤                                  │
│     │                         ├─ 读取商品: price=80 ───┤          │
│     │                         │                          │       │
│     ├─ 修改: price=99         ├─ 修改: price=100        │       │
│     │                         │                          │       │
│     └─ 保存: price=99 ────────┘                          │       │
│                                 └─ 保存: price=100 ────┘          │
│                                                                 │
│  结果：price=100，A 的修改丢失了！                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 问题本质

```
读取数据 → 修改内存 → 保存数据

如果多个线程同时执行：
线程1: 读取 (price=80)
线程1: 修改内存 (price=99)
线程2: 读取 (price=80)    ← 线程2读取的仍是旧值
线程2: 修改内存 (price=100)
线程1: 保存 (price=99)
线程2: 保存 (price=100)  ← 覆盖了线程1的修改
```

## 乐观锁 vs 悲观锁

### 悲观锁

假设数据一定会被并发修改，先加锁再操作。

```sql
SELECT * FROM product WHERE id = 1 FOR UPDATE;  -- 加锁
-- 修改...
UPDATE product SET price = 99 WHERE id = 1;     -- 释放锁
```

**特点**：并发时排队，安全性高，但性能较低。

### 乐观锁

假设数据不会被并发修改，不加锁。如果发现被修改了，则重试或报错。

```sql
-- 读取时记录版本号
SELECT * FROM product WHERE id = 1;  -- version = 1

-- 更新时检查版本号
UPDATE product
SET price = 99, version = version + 1
WHERE id = 1 AND version = 1;       -- version 必须等于读取时的值
```

**特点**：并发性能高，但更新失败需要重试。

```
┌─────────────────────────────────────────────────────────────────┐
│                    乐观锁 vs 悲观锁                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  乐观锁                                                          │
│  ├── 原理：版本号对比                                             │
│  ├── 适用：冲突概率低的场景                                       │
│  └── 优点：并发性能高                                            │
│                                                                 │
│  悲观锁                                                          │
│  ├── 原理：数据库行锁                                            │
│  ├── 适用：冲突概率高的场景                                      │
│  └── 优点：简单直接                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## MyBatis Plus 配置乐观锁

### 1. 实体类添加版本字段

```java
@Data
@TableName("product")
public class Product {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    private BigDecimal price;

    private Integer stock;

    // 乐观锁版本号
    @Version
    private Integer version;
}
```

### 2. 配置乐观锁插件

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
        // 添加乐观锁插件
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        return interceptor;
    }
}
```

### 3. 全局配置（可选）

```yaml
mybatis-plus:
  global-config:
    db-config:
      # 全局乐观锁字段（默认 version）
      # db-type: mysql
```

## 乐观锁的执行效果

### 更新操作

```java
// 更新时自动带上 version 条件
Product product = new Product();
product.setId(1L);
product.setPrice(new BigDecimal("99"));
product.setVersion(1);  // 读取时的版本号

productMapper.updateById(product);

// 生成的 SQL:
// UPDATE product
// SET price = 99, version = version + 1
// WHERE id = 1 AND version = 1
```

### 更新成功

```
初始数据: id=1, price=80, version=1

线程 A 更新:
  条件: id=1 AND version=1    → 命中，version 变成 2，price=99
  影响行数: 1

线程 B 更新:
  条件: id=1 AND version=1    → 未命中（已被线程 A 更新为 2）
  影响行数: 0

结果: price=99，更新成功
```

### 更新失败（重试）

```java
@Override
public boolean updatePrice(Long productId, BigDecimal newPrice, int maxRetries) {
    for (int i = 0; i < maxRetries; i++) {
        // 1. 读取商品信息和版本号
        Product product = productMapper.selectById(productId);
        if (product == null) {
            return false;
        }

        // 2. 更新
        Product update = new Product();
        update.setId(productId);
        update.setPrice(newPrice);
        update.setVersion(product.getVersion());  // 读取时的版本号

        int rows = productMapper.updateById(update);

        // 3. 判断更新结果
        if (rows > 0) {
            return true;  // 更新成功
        }

        // 4. 更新失败，版本冲突，休息一下再重试
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    return false;  // 重试次数用完，更新失败
}
```

## Service 层封装

### 使用链式更新

```java
@Service
public class ProductServiceImpl extends ServiceImpl&lt;ProductMapper, Product&gt;
        implements ProductService {

    @Override
    public boolean updatePrice(Long productId, BigDecimal newPrice) {
        // 使用链式更新 + Lambda 表达式
        return lambdaUpdate()
            .set(Product::getPrice, newPrice)
            .eq(Product::getId, productId)
            .eq(Product::getVersion, getCurrentVersion(productId))  // 当前版本号
            .update();
    }

    private Integer getCurrentVersion(Long productId) {
        Product product = getById(productId);
        return product == null ? 0 : product.getVersion();
    }
}
```

### 使用乐观锁重试模板

```java
@Component
public class OptimisticLockRetryTemplate {

    @FunctionalInterface
    public interface RetryCallback&lt;T&gt; {
        T callback();
    }

    public &lt;T&gt; T execute(RetryCallback&lt;T&gt; callback, int maxRetries) {
        for (int i = 0; i < maxRetries; i++) {
            try {
                return callback.callback();
            } catch (OptimisticLockException e) {
                if (i == maxRetries - 1) {
                    throw e;
                }
                try {
                    Thread.sleep(50L * (i + 1));  // 递增等待时间
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                }
            }
        }
        throw new RuntimeException("乐观锁重试失败");
    }
}
```

## 乐观锁的高级用法

### 1. 自定义版本号字段名

```java
@TableName("product")
public class Product {

    @Version("optimistic_version")  // 指定字段名
    private Integer optimisticVersion;
}
```

### 2. 支持多种版本号类型

```java
// Integer 版本号
@Version
private Integer version;

// Long 版本号
@Version
private Long version;

// LocalDateTime 版本号（不推荐）
// @Version
// private LocalDateTime version;  // 不支持
```

### 3. 条件更新 + 乐观锁

```java
// 使用 UpdateWrapper 配合乐观锁
LambdaUpdateWrapper&lt;Product&gt; wrapper = new UpdateWrapper&lt;&gt;().lambda();
wrapper.set(Product::getPrice, newPrice)
       .eq(Product::getId, productId)
       .eq(Product::getVersion, currentVersion);  // 乐观锁条件

int rows = productMapper.update(null, wrapper);
if (rows == 0) {
    throw new OptimisticLockException("更新失败，版本冲突");
}
```

## 常见问题

### 问题一：更新失败但没有异常

```java
// 默认情况下，更新失败返回 0，不会抛出异常
int rows = productMapper.updateById(product);
if (rows == 0) {
    // 需要手动判断
    throw new OptimisticLockException("版本冲突");
}
```

### 问题二：insert 时 version 为 null

```java
// insert 时 version 使用默认值（通常是 0 或 1）
// 但如果数据库有触发器或其他逻辑，可能需要额外处理

@Override
public void insertFill(MetaObject metaObject) {
    // 初始化版本号
    this.strictInsertFill(metaObject, "version", Integer.class, 1);
}
```

### 问题三：分布式环境下的乐观锁

```java
// 分布式环境下，可以使用分布式锁配合乐观锁
DistributedLock lock = new DistributedLock("product_lock_" + productId);
try {
    lock.lock();
    // 先获取锁，再执行乐观锁更新
    Product product = productMapper.selectById(productId);
    product.setPrice(newPrice);
    productMapper.updateById(product);
} finally {
    lock.unlock();
}
```

### 问题四：与逻辑删除配合

```java
@Data
@TableName("product")
public class Product {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String name;

    @Version
    private Integer version;

    @TableLogic
    private Integer deleted;
}
```

```java
// 更新时，条件会包含 deleted = 0 和 version = ?
Product update = new Product();
update.setId(productId);
update.setPrice(newPrice);
update.setVersion(currentVersion);

productMapper.updateById(update);
// 生成的 SQL:
// UPDATE product
// SET price = ?, version = version + 1
// WHERE id = ? AND deleted = 0 AND version = ?
```

## 实战案例：库存扣减

```java
@Service
public class StockService {

    @Autowired
    private ProductMapper productMapper;

    /**
     * 扣减库存（乐观锁实现）
     */
    public boolean deductStock(Long productId, int count) {
        for (int i = 0; i < 3; i++) {
            // 1. 查询当前库存
            Product product = productMapper.selectById(productId);
            if (product == null || product.getStock() < count) {
                return false;
            }

            // 2. 扣减库存
            Product update = new Product();
            update.setId(productId);
            update.setStock(product.getStock() - count);
            update.setVersion(product.getVersion());

            // 3. 更新
            int rows = productMapper.updateById(update);
            if (rows > 0) {
                return true;
            }

            // 4. 更新失败，版本冲突，休息后重试
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
        return false;
    }
}
```

---

## 面试高频问题

### Q1：乐观锁的原理？

通过在表中添加 `version` 字段，更新时检查版本号是否变化。如果版本号被其他事务更新过，则更新失败。

### Q2：乐观锁和悲观锁的区别？

| 维度 | 乐观锁 | 悲观锁 |
|-----|---------|---------|
| 实现方式 | 版本号对比 | 数据库行锁 |
| 并发性能 | 高 | 低 |
| 适用场景 | 冲突概率低 | 冲突概率高 |
| 实现复杂度 | 中等 | 简单 |

### Q3：乐观锁更新失败后怎么办？

需要重试，或者返回错误给用户。MyBatis Plus 不会自动重试，需要业务代码处理。

---

## 最佳实践

1. **所有更新操作都加上乐观锁**：防止并发更新
2. **提供重试机制**：更新失败时自动重试，提高成功率
3. **合理的重试间隔**：避免大量重试同时执行
4. **版本号初始化**：插入时初始化为 1 或 0
5. **异常处理**：更新失败要明确提示用户

---

## 思考题

一个秒杀场景，10000 个用户同时抢购 100 个商品。使用乐观锁扣减库存：

1. 每个用户扣减库存都需要重试吗？
2. 如何减少重试次数？
3. 乐观锁在高并发场景下有什么问题？

提示：可以使用 Redis 预扣减，或者分段锁。

下一节，我们学习 [多租户](/framework/mybatis-plus/tenant)，实现 SaaS 系统的数据隔离。
