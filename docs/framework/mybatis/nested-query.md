# 嵌套查询 vs 嵌套结果：N+1 问题的本质与解决

你有没有数过，一个「查询用户及其订单」的接口，可能触发多少次数据库查询？

100 个用户 × 2 次查询（用户 + 订单）= 200 次？

如果再查订单的商品呢？再查商品的库存呢？

这就是传说中的 **N+1 查询问题**——MyBatis 最容易踩的坑之一。

## 什么是 N+1 问题？

先看一个常见场景：查询所有用户，每个用户要显示他的订单列表。

### 第一种写法：嵌套查询

```xml
<!-- UserMapper.xml -->
<resultMap id="UserWithOrdersMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <!-- 嵌套查询 -->
    <collection property="orders"
                ofType="Order"
                column="id"
                select="com.example.mapper.OrderMapper.findByUserId"/>
</resultMap>

<select id="findAllUsers" resultMap="UserWithOrdersMap">
    SELECT id, name FROM user
</select>

<!-- OrderMapper.xml -->
<select id="findByUserId" resultType="Order">
    SELECT * FROM orders WHERE user_id = #{userId}
</select>
```

执行流程：

```
第 1 次：SELECT * FROM user                    -- 查询所有用户（1 次）
第 2 次：SELECT * FROM orders WHERE user_id=1  -- 查用户 1 的订单
第 3 次：SELECT * FROM orders WHERE user_id=2  -- 查用户 2 的订单
...（每个用户都触发一次查询）
第 N+1 次：SELECT * FROM orders WHERE user_id=N
```

**100 个用户 = 101 次 SQL！**

### N+1 问题的危害

| 指标 | 单次查询 | N+1 查询（100条） |
|-----|---------|------------------|
| SQL 执行次数 | 1 | 101 |
| 数据库往返 | 1 | 101 |
| 连接时间消耗 | 1x | 101x |
| 网络延迟 | 1x | 101x |

## 解决方案一：嵌套结果

一次 JOIN 查询，把所有数据都查出来：

```xml
<resultMap id="UserWithOrdersMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
        <result property="totalAmount" column="total_amount"/>
    </collection>
</resultMap>

<select id="findAllUsersWithOrders" resultMap="UserWithOrdersMap">
    SELECT u.id, u.name,
           o.id as order_id, o.order_no, o.total_amount
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
</select>
```

执行流程：

```
第 1 次：SELECT ... FROM user LEFT JOIN orders ...  -- 1 次 SQL，JOIN 查询
```

**100 个用户 = 1 次 SQL！**

### 嵌套结果的限制

嵌套结果虽然高效，但有代价：

```sql
-- 如果 user 表有 100 条，orders 表有 1000 条
-- 一次 JOIN 可能返回 1000 行（笛卡尔积）

-- 如果还有 order_items 表...
SELECT * FROM user u
LEFT JOIN orders o ON u.id = o.user_id
LEFT JOIN order_items i ON o.id = i.order_id
-- 数据量可能爆炸
```

## 解决方案二：分步查询 + 延迟加载

嵌套查询的问题是没必要的查询太多了。但如果**按需加载**呢？

```java
// 使用时：只查用户，不查订单
List&lt;User&gt; users = userMapper.findAll();  // 1 次 SQL

// 只有真正需要订单时，才加载
for (User user : users) {
    if (needOrders) {
        List&lt;Order&gt; orders = user.getOrders();  // 触发查询
    }
}
```

配置延迟加载：

```yaml
mybatis:
  configuration:
    lazy-loading-enabled: true
    aggressive-lazy-loading: false  # 关闭积极加载
```

```xml
<!-- 全局设置延迟加载策略 -->
<settings>
    <setting name="lazyLoadingEnabled" value="true"/>
    <setting name="aggressiveLazyLoading" value="false"/>
</settings>
```

### 延迟加载的触发时机

```java
User user = userMapper.findById(1L);

// 这些操作会触发延迟加载
user.getOrders();           // 访问关联对象
user.getOrders().size();    // 调用关联对象的方法
user.getOrders().get(0);    // 访问关联对象的元素
```

### 关闭延迟加载的场景

```java
User user = userMapper.findById(1L);
// JSON 序列化时，即使不访问 getOrders()，也可能触发延迟加载
// 因为很多 JSON 库会遍历对象的所有属性
```

**解决方案**：序列化前手动初始化，或配置 JSON 库跳过延迟加载属性。

## 解决方案三：批量嵌套查询

既然 N+1 是因为「逐个查询」，那改成「批量查询」不就行了？

### 自定义批量查询

```java
// UserMapper.java
List&lt;User&gt; findAllWithOrders();

// UserMapper.xml
<select id="findAllWithOrders" resultMap="UserWithOrdersMap">
    SELECT u.id, u.name,
           o.id as order_id, o.order_no, o.total_amount
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
</select>
```

### 利用 MyBatis 的 column 多列传递

```xml
<resultMap id="UserWithOrdersMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <!-- 传递多个列给嵌套查询 -->
    <collection property="orders"
                ofType="Order"
                select="com.example.mapper.OrderMapper.findByUserIdBatch"
                column="{userId=id, userName=name}"/>
</resultMap>

<!-- OrderMapper -->
<select id="findByUserIdBatch" resultType="Order">
    SELECT * FROM orders WHERE user_id = #{userId}
</select>
```

## 解决方案四：按需加载的 N+1

在实际业务中，并不是所有场景都需要完整的数据。可以考虑**分级加载**：

```java
// L1：只查主实体
User user = userMapper.findById(id);  // 1 次 SQL

// L2：只查第一层关联（订单列表）
if (needOrders) {
    List&lt;Order&gt; orders = orderMapper.findByUserId(user.getId());  // 1 次 SQL
}

// L3：按需查第二层关联（订单商品）
for (Order order : orders) {
    if (needItems) {
        List&lt;OrderItem&gt; items = itemMapper.findByOrderId(order.getId());  // N 次 SQL
    }
}
```

## 三种方案对比

| 方案 | SQL 次数 | 内存占用 | 适用场景 |
|-----|---------|---------|---------|
| 嵌套查询 | N+1 | 低 | 单个对象+关联对象 |
| 嵌套结果 | 1 | 高（可能有重复数据） | 数据量适中的关联查询 |
| 延迟加载 | 按需 | 低 | 关联数据量大、不一定需要 |

## 实战建议

### 1. 先评估数据量

```java
// 如果用户数量可控（&lt;100），用嵌套结果
List&lt;User&gt; users = userMapper.findAllUsersWithOrders();  // 一次 JOIN

// 如果订单数量巨大，用延迟加载
User user = userMapper.findById(id);
List&lt;Order&gt; orders = orderMapper.findByUserId(user.getId());
```

### 2. 设置合理的 fetchSize

```xml
<select id="findAllUsersWithOrders" fetchSize="100" resultMap="...">
    SELECT ...
</select>
```

### 3. 监控 SQL 执行

```java
// 使用 MyBatis-Plus 的 SQL 分析
@Bean
public PerformanceInterceptor performanceInterceptor() {
    PerformanceInterceptor interceptor = new PerformanceInterceptor();
    interceptor.setMaxTime(1000);  // 超过 1 秒的 SQL 打印日志
    return interceptor;
}
```

## 常见问题

### 问题 1：嵌套结果后数据变多

```sql
-- 假设 user 表 10 条，orders 表 100 条（每个用户 10 个订单）
-- JOIN 后返回 100 行

-- 但 Java 中只想要 10 个 User 对象
-- MyBatis 会自动根据 id 去重
```

### 问题 2：延迟加载不生效

```java
// 错误：JSON 序列化可能触发所有延迟加载属性
JSON.toJSONString(user);

// 解决：配置 Jackson 忽略延迟加载属性
objectMapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
```

### 问题 3：嵌套查询参数传递

```xml
<!-- 如果嵌套查询需要多个参数 -->
<collection property="orders"
           column="{userId=user_id, status=status}"
           select="com.example.mapper.OrderMapper.findByCondition"/>
```

---

## 面试高频问题

### Q1：什么是 N+1 问题？

N+1 问题是指在查询主对象后，对每个主对象都发起一次关联查询，导致 SQL 执行次数为 N+1。

### Q2：如何解决 N+1 问题？

1. 使用嵌套结果（一次 JOIN）
2. 使用批量查询
3. 使用延迟加载 + 按需加载
4. 使用 MyBatis-Plus 的 eager 模式

### Q3：嵌套查询和嵌套结果各有什么优缺点？

- **嵌套查询**：SQL 次数多，但单次查询数据量小，适合关联数据量大的场景
- **嵌套结果**：SQL 次数少，但数据量大时内存压力大，可能有重复数据

### Q4：延迟加载的原理？

MyBatis 使用代理对象（Javassist 或 CGLIB）包装关联对象，在访问关联属性时触发代理逻辑，发起实际查询。

---

## 最佳实践总结

1. **小数据量关联**：用嵌套结果，一次查询搞定
2. **大数据量关联**：用延迟加载 + 按需加载
3. **中间量级**：考虑批量嵌套查询
4. **监控 SQL**：生产环境务必开启 SQL 日志
5. **避免全量加载**：JSON 序列化前评估是否需要关联数据

---

## 思考题

假设一个系统有：
- 1000 个用户
- 每个用户平均 10 个订单
- 每个订单平均 5 个商品

如果用嵌套查询方式查询所有用户的完整信息（用户 → 订单 → 商品），会执行多少次 SQL？

有没有办法把 SQL 次数控制在 10 次以内？

下一节，我们看 [动态 SQL](/framework/mybatis/dynamic-sql)，学习如何根据条件动态生成 SQL。
