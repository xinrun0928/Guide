# 读写分离：让数据库扛住海量请求

你的系统用户从 1 万增长到 100 万，数据库已经顶不住了。

CPU 100%、内存爆满、响应时间从 50ms 飙升到 2 秒。

怎么办？**读写分离**是最直接的解决方案。

---

## 什么是读写分离？

读写分离是主从复制的应用场景：将读操作和写操作分散到不同的服务器上。

```
┌─────────────────────────────────────────────────────────────┐
│                      读写分离架构                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      ┌─────────────┐                        │
│                      │  Application │                        │
│                      │   Service   │                        │
│                      └──────┬──────┘                        │
│                             │                               │
│              ┌─────────────┴─────────────┐                  │
│              ↓                           ↓                  │
│      ┌─────────────┐             ┌─────────────┐            │
│      │    Write    │             │    Read     │            │
│      │   (写操作)   │             │   (读操作)   │            │
│      └──────┬──────┘             └──────┬──────┘            │
│             │                           │                    │
│             ↓                           ↓                    │
│      ┌─────────────┐             ┌─────────────┐            │
│      │   Master    │             │   Slave     │            │
│      │  (主库)     │  ───复制──→  │  (从库)     │            │
│      └─────────────┘             └─────────────┘            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 为什么要读写分离？

### 问题：单库性能瓶颈

```sql
-- 数据库 QPS 达到瓶颈
-- CPU 100%、内存爆满
-- 响应时间飙升
```

### 解决：分散压力

- 写操作只到主库（少量）
- 读操作分散到多个从库（大量）

```
场景假设：
- 写操作：10%
- 读操作：90%

结果：
- 主库：承担 10% 的写请求
- 从库：承担 90% 的读请求，分散到多个从库
```

---

## 读写分离的实现方式

### 方式一：客户端路由（应用层）

应用代码自己决定访问主库还是从库。

```java
@Configuration
public class DataSourceConfig {
    @Bean
    public DataSource masterDataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:mysql://master:3306/guide")
            .build();
    }

    @Bean
    public DataSource slave1DataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:mysql://slave1:3306/guide")
            .build();
    }

    @Bean
    public DataSource slave2DataSource() {
        return DataSourceBuilder.create()
            .url("jdbc:mysql://slave2:3306/guide")
            .build();
    }
}

@Component
public class RoutingDataSource extends AbstractRoutingDataSource {
    private static final ThreadLocal&lt;Boolean&gt; READ_ONLY = new ThreadLocal&lt;&gt;();

    public static void setReadOnly(boolean readOnly) {
        READ_ONLY.set(readOnly);
    }

    @Override
    protected Object determineCurrentLookupKey() {
        Boolean readOnly = READ_ONLY.get();
        return (readOnly != null && readOnly) ? "slave" : "master";
    }
}
```

### 方式二：中间件路由

使用 MySQL Proxy、ShardingSphere-Proxy 等中间件。

```
客户端 → MySQL Proxy → 自动路由
              ↓
         自动判断：写 → Master，读 → Slave
```

### 方式三：Spring DataSource 路由

```java
@Service
public class OrderService {
    @Autowired
    private JdbcTemplate jdbcTemplate;

    /**
     * 写入（走主库）
     */
    public void createOrder(Order order) {
        RoutingDataSource.setReadOnly(false);
        try {
            jdbcTemplate.update("INSERT INTO orders ...", order.toParams());
        } finally {
            RoutingDataSource.clear();
        }
    }

    /**
     * 读取（走从库）
     */
    public List&lt;Order&gt; listOrders() {
        RoutingDataSource.setReadOnly(true);
        try {
            return jdbcTemplate.query(
                "SELECT * FROM orders WHERE status = ?",
                new Object[]{"pending"},
                (rs, rowNum) -> mapOrder(rs)
            );
        } finally {
            RoutingDataSource.clear();
        }
    }
}
```

---

## 读写分离的问题

### 问题一：主从延迟

刚写入主库的数据，立即读从库可能读不到。

```java
// 问题场景
orderService.createOrder(order);  // 写入主库
orderService.getOrder(order.getId());  // 读从库，可能没有（延迟中）

// 解决方案
public Order createAndGet(Order order) {
    createOrder(order);  // 写主库
    return getFromMaster(order.getId());  // 读主库
}
```

### 问题二：数据一致性

如果允许短暂不一致，可以直接读从库；如果必须强一致，读主库。

```java
// 场景一：允许短暂延迟
public List&lt;Product&gt; listProducts() {
    return productService.listFromSlave();  // 读从库
}

// 场景二：必须强一致
public Order getOrderDetail(long orderId) {
    return orderService.getFromMaster(orderId);  // 读主库
}
```

### 问题三：事务中的读写

事务中的读写都在同一个连接，主从切换可能导致问题。

```java
@Transactional
public void processOrder() {
    // 事务中，不能切换数据源
    Order order = orderMapper.selectById(orderId);  // 读主库
    // ...
}
```

---

## 读写分离的注意事项

### 注意事项一：避免长事务

长事务会占用主库连接，导致主从延迟加大。

### 注意事项二：从库隔离

从库只做简单查询，复杂分析放到专门的 OLAP 库。

### 注意事项三：监控延迟

```sql
SHOW SLAVE STATUS\G
-- Seconds_Behind_Master 监控延迟
```

### 注意事项四：健康检查

定期检查主从状态，及时处理故障节点。

---

## 架构演进

### 阶段一：一主一从

```
Master → Slave
```

最基础的读写分离架构。

### 阶段二：一主多从

```
Master → Slave1
       → Slave2
       → Slave3
```

读操作分散到多个从库，提高并发能力。

### 阶段三：双主模式

```
Master1 ←→ Master2
   ↓           ↓
 Slave1    Slave2
```

两个主库互相同步，都可以接受写操作。

---

## Java 代码：完整的读写分离实现

```java
@Component
public class RoutingDataSource extends AbstractRoutingDataSource {
    private static final ThreadLocal&lt;DataSourceType&gt; DATASOURCE = new ThreadLocal&lt;&gt;();

    public enum DataSourceType {
        MASTER, SLAVE
    }

    public static void setMaster() {
        DATASOURCE.set(DataSourceType.MASTER);
    }

    public static void setSlave() {
        DATASOURCE.set(DataSourceType.SLAVE);
    }

    public static void clear() {
        DATASOURCE.remove();
    }

    @Override
    protected Object determineCurrentLookupKey() {
        DataSourceType type = DATASOURCE.get();
        if (type == DataSourceType.SLAVE) {
            return "slave";
        }
        return "master";
    }
}

// 注解方式
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface ReadOnly {
}

// AOP 处理
@Aspect
@Component
public class ReadOnlyInterceptor {
    @Around("@annotation(ReadOnly)")
    public Object around(ProceedingJoinPoint point) {
        RoutingDataSource.setSlave();
        try {
            return point.proceed();
        } finally {
            RoutingDataSource.clear();
        }
    }
}

// 使用示例
@Service
public class OrderService {
    @ReadOnly
    public List&lt;Order&gt; listOrders() {
        return orderMapper.selectAll();
    }

    public void createOrder(Order order) {
        orderMapper.insert(order);
    }
}
```

---

## 面试追问方向

- 读写分离的原理是什么？
- 如何解决主从延迟问题？
- 什么场景下不能用读写分离？
- 读写分离和分库分表有什么区别？

> 读写分离适合读多写少的场景，通过分散压力提高性能。但主从延迟是必须解决的问题，核心原则是：写入后立即读取要读主库，允许延迟的读取才读从库。
