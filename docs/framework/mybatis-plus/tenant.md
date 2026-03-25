# 多租户：SaaS 系统的数据隔离之道

你有没有想过，一个 SaaS 系统，如何让多个企业的数据互不干扰？

企业 A 登录后，只能看到自己的数据；
企业 B 登录后，也只能看到自己的数据。

MyBatis Plus 的**多租户插件**，就是来解决这个问题的——**让每个租户的数据自动隔离**。

## 什么是多租户？

```
┌─────────────────────────────────────────────────────────────────┐
│                      多租户架构示意                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    SaaS 应用层                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌───────────────────────────┼───────────────────────────┐   │
│  │                    MyBatis Plus 层                     │   │
│  │                    (租户隔离)                            │   │
│  │  ┌─────────────────────────────────────────────────┐   │   │
│  │  │           TenantLineInnerInterceptor            │   │   │
│  │  │   自动注入 tenant_id 条件                        │   │   │
│  │  └─────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────┘   │
│                              │                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    数据库层                               │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │   │
│  │  │Tenant A │ │Tenant B │ │Tenant C │ │Tenant D │ ...   │   │
│  │  │ 数据    │ │ 数据    │ │ 数据    │ │ 数据    │        │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 两种多租户实现方式

### 方式一：共享表（行级隔离）

所有租户共享一张表，通过 `tenant_id` 字段区分。

```sql
CREATE TABLE orders (
    id BIGINT PRIMARY KEY,
    tenant_id BIGINT NOT NULL,  -- 租户 ID
    order_no VARCHAR(50),
    amount DECIMAL(10,2),
    ...
    INDEX idx_tenant_id (tenant_id)
);
```

### 方式二：独立表（表级隔离）

每个租户有独立的表，数据完全隔离。

```sql
-- 企业 A 的订单表
orders_tenant_a

-- 企业 B 的订单表
orders_tenant_b
```

**MyBatis Plus 的多租户插件支持方式一**。

## MyBatis Plus 配置多租户

### 1. 实现 TenantLineHandler

```java
@Component
public class MyTenantLineHandler implements TenantLineHandler {

    @Override
    public Expression getTenantId() {
        // 从上下文获取当前租户 ID
        Long tenantId = TenantContextHolder.getTenantId();
        return new LongValue(tenantId);
    }

    @Override
    public String getTenantIdColumn() {
        // 租户 ID 字段名
        return "tenant_id";
    }

    @Override
    public boolean ignoreTable(String tableName) {
        // 忽略某些表（不需要租户隔离的表）
        return "sys_config".equals(tableName)
            || "system_log".equals(tableName);
    }
}
```

### 2. 配置多租户插件

```java
@Configuration
public class MyBatisPlusConfig {

    @Bean
    public MybatisPlusInterceptor mybatisPlusInterceptor() {
        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

        // 添加多租户插件
        interceptor.addInnerInterceptor(new TenantLineInnerInterceptor(
            new MyTenantLineHandler()
        ));

        return interceptor;
    }
}
```

### 3. 配置数据源

```yaml
spring:
  datasource:
    driver-class-name: com.mysql.cj.jdbc.Driver
    url: jdbc:mysql://localhost:3306/saas_demo?useUnicode=true&characterEncoding=utf-8
    username: root
    password: root
```

## TenantLineHandler 详解

### 核心方法

```java
public interface TenantLineHandler {

    /**
     * 获取租户 ID 表达式
     * @return 租户 ID
     */
    Expression getTenantId();

    /**
     * 获取租户字段名
     * @return 字段名
     */
    default String getTenantIdColumn() {
        return "tenant_id";
    }

    /**
     * 判断是否忽略表
     * @param tableName 表名
     * @return true 忽略，false 不忽略
     */
    default boolean ignoreTable(String tableName) {
        return false;
    }
}
```

### 租户上下文 Holder

```java
public class TenantContextHolder {

    private static final ThreadLocal&lt;Long&gt; CONTEXT = new ThreadLocal&lt;&gt;();

    public static void setTenantId(Long tenantId) {
        CONTEXT.set(tenantId);
    }

    public static Long getTenantId() {
        return CONTEXT.get();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}
```

## 多租户插件的执行效果

### 查询操作

```java
// 查询自动加上 tenant_id 条件
List&lt;Order&gt; orders = orderMapper.selectList(null);
// 生成的 SQL: SELECT * FROM orders WHERE tenant_id = ?

// 带条件的查询
LambdaQueryWrapper&lt;Order&gt; wrapper = new QueryWrapper&lt;&gt;().lambda();
wrapper.eq(Order::getStatus, 1);
List&lt;Order&gt; orders = orderMapper.selectList(wrapper);
// 生成的 SQL: SELECT * FROM orders WHERE tenant_id = ? AND status = 1
```

### 插入操作

```java
// 插入时自动带上 tenant_id
Order order = new Order();
order.setOrderNo("ORDER001");
order.setAmount(new BigDecimal("100"));
orderMapper.insert(order);
// 生成的 SQL: INSERT INTO orders (tenant_id, order_no, amount) VALUES (?, 'ORDER001', 100)
```

### 更新操作

```java
// 更新时自动带上 tenant_id 条件
Order update = new Order();
update.setId(1L);
update.setAmount(new BigDecimal("200"));
orderMapper.updateById(update);
// 生成的 SQL: UPDATE orders SET amount = ? WHERE tenant_id = ? AND id = ?
```

### 删除操作

```java
// 删除时自动带上 tenant_id 条件
orderMapper.deleteById(1L);
// 生成的 SQL: DELETE FROM orders WHERE tenant_id = ? AND id = ?
```

## 高级配置

### 1. 动态租户 ID

```java
@Component
public class DynamicTenantHandler implements TenantLineHandler {

    @Override
    public Expression getTenantId() {
        // 从请求头获取
        HttpServletRequest request = ((ServletRequestAttributes)
            RequestContextHolder.getRequestAttributes()).getRequest();
        String tenantId = request.getHeader("X-Tenant-ID");
        return new LongValue(Long.parseLong(tenantId));
    }

    @Override
    public boolean ignoreTable(String tableName) {
        // 忽略系统表
        return ignoreTables.contains(tableName);
    }
}
```

### 2. 超级管理员模式

```java
@Component
public class SuperAdminTenantHandler implements TenantLineHandler {

    @Override
    public Expression getTenantId() {
        // 如果是超级管理员，不限制租户
        if (isSuperAdmin()) {
            return null;  // 返回 null 表示不过滤
        }
        return new LongValue(getCurrentTenantId());
    }

    private boolean isSuperAdmin() {
        // 判断是否是超级管理员
        return false;
    }
}
```

### 3. 多租户 + 其他插件

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();

    // 1. 多租户插件（先执行）
    interceptor.addInnerInterceptor(new TenantLineInnerInterceptor(
        new MyTenantLineHandler()
    ));

    // 2. 分页插件
    interceptor.addInnerInterceptor(new PaginationInnerInterceptor());

    // 3. 乐观锁插件
    interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());

    // 4. 逻辑删除插件
    interceptor.addInnerInterceptor(new LogicDeleteInnerInterceptor());

    return interceptor;
}
```

## 常见问题

### 问题一：跨租户查询

```java
// 场景：超级管理员需要查看所有租户的数据
// 方式一：创建不带租户条件的 Mapper
@Mapper
public interface AdminOrderMapper extends BaseMapper&lt;Order&gt; {
    // 不使用多租户插件的 Mapper
}

// 方式二：使用 XML 手动编写 SQL
@Select("SELECT * FROM orders WHERE status = #{status}")
List&lt;Order&gt; selectAllByStatus(Integer status);

// 方式三：使用 @InterceptorIgnore
@InterceptorIgnore(tenantLine = "true")
List&lt;Order&gt; selectAll();
```

### 问题二：租户 ID 字段为 null

```java
@Override
public Expression getTenantId() {
    Long tenantId = TenantContextHolder.getTenantId();
    if (tenantId == null) {
        throw new BizException("租户 ID 不能为空");
        // 或者返回默认值
        // return new LongValue(0L);
    }
    return new LongValue(tenantId);
}
```

### 问题三：关联查询

```java
// 多表关联查询时，插件会自动处理
@Select("SELECT o.*, u.name as user_name FROM orders o " +
       "LEFT JOIN user u ON o.user_id = u.id")
List&lt;OrderVO&gt; selectOrderWithUser();
// 生成的 SQL:
// SELECT o.*, u.name as user_name
// FROM orders o
// LEFT JOIN user u ON o.user_id = u.id AND u.tenant_id = o.tenant_id
// WHERE o.tenant_id = ?
```

### 问题四：性能问题

```sql
-- 给 tenant_id 字段加索引
ALTER TABLE orders ADD INDEX idx_tenant_id (tenant_id);

-- 如果表很大，考虑分库分表
-- 或者按租户 ID 分区
```

## 实战案例

### 完整的租户配置

```java
// 1. 实体类
@Data
@TableName("orders")
public class Order {

    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("tenant_id")
    private Long tenantId;  // 租户 ID

    private String orderNo;

    private BigDecimal amount;

    private Integer status;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createTime;
}

// 2. 自动填充处理
@Component
public class TenantMetaObjectHandler implements MetaObjectHandler {

    @Override
    public void insertFill(MetaObject metaObject) {
        // 自动填充租户 ID
        Long tenantId = TenantContextHolder.getTenantId();
        if (tenantId != null) {
            this.strictInsertFill(metaObject, "tenantId", Long.class, tenantId);
        }
    }
}

// 3. 过滤器设置租户 ID
@Component
@Order(1)
public class TenantFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws Exception {
        String tenantId = request.getHeader("X-Tenant-ID");
        if (tenantId != null) {
            TenantContextHolder.setTenantId(Long.parseLong(tenantId));
        }
        try {
            chain.doFilter(request, response);
        } finally {
            TenantContextHolder.clear();
        }
    }
}
```

### 测试验证

```java
@Test
public void testTenantIsolation() {
    // 租户 A 查询
    TenantContextHolder.setTenantId(1L);
    List&lt;Order&gt; ordersA = orderMapper.selectList(null);
    System.out.println("租户 A 订单数: " + ordersA.size());

    // 租户 B 查询
    TenantContextHolder.setTenantId(2L);
    List&lt;Order&gt; ordersB = orderMapper.selectList(null);
    System.out.println("租户 B 订单数: " + ordersB.size());

    // 租户 A 插入
    Order order = new Order();
    order.setOrderNo("ORDER_A_001");
    order.setAmount(new BigDecimal("100"));
    orderMapper.insert(order);

    // 再次查询租户 A
    TenantContextHolder.setTenantId(1L);
    List&lt;Order&gt; ordersA2 = orderMapper.selectList(null);
    System.out.println("租户 A 订单数: " + ordersA2.size());  // 应该 +1
}
```

---

## 面试高频问题

### Q1：MyBatis Plus 多租户的实现原理？

通过 `TenantLineInnerInterceptor` 拦截 SQL，自动在 SELECT、INSERT、UPDATE、DELETE 语句中添加 `tenant_id` 条件。

### Q2：多租户隔离的方式有哪些？

| 方式 | 优点 | 缺点 |
|-----|------|------|
| 共享表（行级隔离） | 成本低、运维简单 | 查询性能略低 |
| 独立表（表级隔离） | 隔离性强 | 成本高、运维复杂 |
| 独立数据库 | 隔离最强 | 成本最高 |

### Q3：如何实现跨租户查询？

1. 创建不带多租户插件的 Mapper
2. 使用 XML 手写 SQL
3. 使用 `@InterceptorIgnore` 注解

---

## 最佳实践

1. **统一租户 ID 管理**：通过 Filter/Interceptor 设置租户上下文
2. **忽略系统表**：配置 `ignoreTable` 排除系统表
3. **超级管理员**：提供超级管理员模式，查看所有租户数据
4. **性能优化**：给 `tenant_id` 字段加索引
5. **数据隔离**：插入时必须填充 `tenant_id`

---

## 思考题

一个电商 SaaS 平台，有以下表结构：

```sql
orders (订单)
order_items (订单明细)
products (商品)
users (用户)
```

1. 哪些表需要租户隔离？
2. 哪些表不需要租户隔离？
3. 如果商品需要共享（所有租户看到相同的商品），如何实现？

提示：关联查询时，MyBatis Plus 会自动处理关联表的租户隔离。

下一节，我们学习 [SQL 性能分析](/framework/mybatis-plus/sql-analyze)，让你的 SQL 无处遁形。
