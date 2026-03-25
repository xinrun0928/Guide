# resultMap 配置详解：复杂映射的艺术

你有没有遇到过这种情况：数据库里的列名是 `user_id`、`order_no`、`create_time`，但 Java 实体里的属性是 `userId`、`orderNo`、`createTime`。

或者，一个订单里要嵌套用户信息，用户里又要嵌套地址列表——这种多层级嵌套怎么映射？

这一节，我们把 MyBatis 的 resultMap 彻底讲透。

## 为什么需要 resultMap？

先看两种场景：

**场景一：列名与属性名不一致**

```sql
-- 数据库列名
user_id, user_name, user_email

-- Java 属性名
id, name, email
```

**场景二：复杂对象关系**

```java
public class Order {
    private Long id;
    private String orderNo;
    private User user;           // 一对一：订单属于某个用户
    private List&lt;OrderItem&gt; items;  // 一对多：订单包含多个商品
}
```

`resultType` 的自动映射解决不了这些场景，必须用 `resultMap`。

## resultMap 基础结构

```xml
<resultMap id="BaseResultMap" type="com.example.entity.User">
    <!-- id 标签：标识主键，用于：
         1. 提升缓存命中率
         2. 嵌套结果时识别同一对象
    -->
    <id property="id" column="user_id"/>

    <!-- result 标签：普通字段映射 -->
    <result property="name" column="user_name"/>
    <result property="email" column="user_email"/>
    <result property="status" column="user_status"/>
    <result property="createTime" column="create_time"/>
</resultMap>
```

### id vs result

| 标签 | 用途 | 注意事项 |
|-----|------|---------|
| `id` | 标识主键列 | 必须使用，保证对象唯一性 |
| `result` | 普通列映射 | 仅处理非主键列 |

> **面试加分点**：很多人不知道为什么要用 `id` 而不只是用 `result`。原因是：在嵌套结果映射时，如果只用 `result`，MyBatis 无法判断两条记录是否指向同一个对象，可能产生重复对象。

## association：一对一关联

### 嵌套查询方式（N+1 问题源）

```xml
<!-- UserMapper.xml -->
<resultMap id="OrderResultMap" type="Order">
    <id property="id" column="id"/>
    <result property="orderNo" column="order_no"/>
    <result property="userId" column="user_id"/>

    <!--
        property: Java 属性名
        column: 传递给嵌套查询的参数列
        select: 调用的另一个查询的 statement id
    -->
    <association property="user"
                 column="user_id"
                 select="com.example.mapper.UserMapper.findById"/>
</resultMap>

<select id="findOrderById" resultMap="OrderResultMap">
    SELECT id, order_no, user_id FROM orders WHERE id = #{id}
</select>
```

执行流程：

```
查询订单
    │
    ├── 查 orders 表
    │
    └── 发现有 association，发起嵌套查询
              │
              └── 根据 user_id 查 user 表
```

### 嵌套结果方式（推荐）

```xml
<resultMap id="OrderWithUserResultMap" type="Order">
    <id property="id" column="id"/>

    <result property="orderNo" column="order_no"/>
    <result property="userId" column="user_id"/>

    <!--
        嵌套结果方式：通过 nested resultMap 直接映射
        javaType: 指定关联对象的类型
    -->
    <association property="user" javaType="User">
        <id property="id" column="user_id"/>
        <result property="name" column="user_name"/>
        <result property="email" column="user_email"/>
    </association>
</resultMap>

<select id="findOrderWithUser" resultMap="OrderWithUserResultMap">
    SELECT o.id, o.order_no, o.user_id,
           u.name as user_name, u.email as user_email
    FROM orders o
    LEFT JOIN user u ON o.user_id = u.id
    WHERE o.id = #{id}
</select>
```

### 分步查询 + 延迟加载

```java
@Configuration
public class MyBatisConfig {
    @Bean
    public SqlSessionFactory sqlSessionFactory(...) throws Exception {
        SqlSessionFactoryBean factoryBean = new SqlSessionFactoryBean();
        // 开启延迟加载
        factoryBean.setConfiguration(mybatisConfiguration());
        return factoryBean.getObject();
    }

    @Bean
    public Configuration mybatisConfiguration() {
        Configuration config = new Configuration();
        // 开启延迟加载（默认 false）
        config.setLazyLoadingEnabled(true);
        // 关闭积极的延迟加载（默认为 true，会加载所有关联对象）
        config.setAggressiveLazyLoading(false);
        return config;
    }
}
```

```java
// 使用时：只有真正访问关联对象时，才会发起查询
Order order = orderMapper.findOrderById(1L);

// 这时才发起查询获取 user
User user = order.getUser();
```

## collection：一对多关联

### 嵌套查询方式

```xml
<resultMap id="UserWithOrdersResultMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <!--
        property: Java 属性名
        ofType: 集合中元素的类型
        select: 调用的查询
        column: 传递给嵌套查询的参数
    -->
    <collection property="orders"
                ofType="Order"
                column="id"
                select="com.example.mapper.OrderMapper.findByUserId"/>
</resultMap>

<select id="findUserWithOrders" resultMap="UserWithOrdersResultMap">
    SELECT id, name FROM user WHERE id = #{id}
</select>
```

### 嵌套结果方式（推荐）

```xml
<resultMap id="UserWithOrdersResultMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
        <result property="totalAmount" column="total_amount"/>
    </collection>
</resultMap>

<select id="findUserWithOrders" resultMap="UserWithOrdersResultMap">
    SELECT u.id, u.name,
           o.id as order_id, o.order_no, o.total_amount
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{id}
</select>
```

## 嵌套结果的高级用法

### 多层嵌套

```java
public class User {
    private Long id;
    private String name;
    private List&lt;Order&gt; orders;
}

public class Order {
    private Long id;
    private String orderNo;
    private List&lt;OrderItem&gt; items;
}

public class OrderItem {
    private Long id;
    private String productName;
    private Integer quantity;
}
```

```xml
<resultMap id="UserWithOrdersMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>

    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>

        <!-- 再嵌套一层 -->
        <collection property="items" ofType="OrderItem">
            <id property="id" column="item_id"/>
            <result property="productName" column="product_name"/>
            <result property="quantity" column="quantity"/>
        </collection>
    </collection>
</resultMap>
```

### 使用 autoMapping 简化

```xml
<resultMap id="UserWithOrdersMap" type="User" autoMapping="true">
    <id property="id" column="id"/>

    <collection property="orders" ofType="Order" autoMapping="true">
        <id property="id" column="order_id"/>

        <!-- 对于映射规则的列，手动指定 -->
        <result property="userId" column="user_id"/>
    </collection>
</resultMap>
```

## discriminator：鉴别器映射

根据某列的值，选择不同的 resultMap：

```xml
<resultMap id="VehicleResultMap" type="Vehicle">
    <id property="id" column="id"/>
    <result property="ownerName" column="owner_name"/>

    <!--
        discriminator：根据某个列的值，决定使用哪个 resultMap
        column: 判断依据的列
        javaType: 该列的 Java 类型
    -->
    <discriminator column="vehicle_type" javaType="string">
        <!-- 如果是 car 类型，使用 CarResultMap -->
        <case value="car" resultMap="CarResultMap"/>
        <!-- 如果是 truck 类型，使用 TruckResultMap -->
        <case value="truck" resultMap="TruckResultMap"/>
    </discriminator>
</resultMap>

<resultMap id="CarResultMap" type="Car" extends="VehicleResultMap">
    <result property="doorCount" column="door_count"/>
    <result property="roofType" column="roof_type"/>
</resultMap>

<resultMap id="TruckResultMap" type="Truck" extends="VehicleResultMap">
    <result property="loadCapacity" column="load_capacity"/>
    <result property="axleCount" column="axle_count"/>
</resultMap>
```

## resultMap 继承

```xml
<!-- 基础 resultMap -->
<resultMap id="BaseResultMap" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>
    <result property="email" column="email"/>
    <result property="status" column="status"/>
    <result property="createTime" column="create_time"/>
</resultMap>

<!-- 继承后扩展 -->
<resultMap id="UserWithOrdersMap" type="User" extends="BaseResultMap">
    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
    </collection>
</resultMap>

<!-- 再继承 -->
<resultMap id="UserFullMap" type="User" extends="UserWithOrdersMap">
    <collection property="addresses" ofType="Address">
        <id property="id" column="address_id"/>
        <result property="detail" column="address_detail"/>
    </collection>
</resultMap>
```

## 常见问题与解决方案

### 1. 列名重复导致数据覆盖

```sql
-- 如果两个表有相同列名
SELECT u.id, o.id FROM user u, orders o

-- 必须使用别名区分
SELECT u.id as user_id, o.id as order_id
```

```xml
<resultMap id="ResultMap" type="Order">
    <id property="id" column="order_id"/>
    <result property="userId" column="user_id"/>
</resultMap>
```

### 2. 嵌套查询 N+1 问题

```java
// 问题代码：100 个订单，每个订单查一次用户 = 101 次查询
List&lt;Order&gt; orders = orderMapper.findAll();
for (Order order : orders) {
    // 每次循环都触发嵌套查询
    User user = order.getUser();
}
```

**解决方案**：使用嵌套结果，一次 JOIN 查询搞定：

```xml
<select id="findAllOrdersWithUsers" resultMap="OrderWithUserResultMap">
    SELECT o.id, o.order_no, o.user_id,
           u.name as user_name
    FROM orders o
    LEFT JOIN user u ON o.user_id = u.id
</select>
```

### 3. 延迟加载不生效

```yaml
# Spring Boot 配置
mybatis:
  configuration:
    lazy-loading-enabled: true
    aggressive-lazy-loading: false  # 关闭积极加载
```

---

## 面试高频问题

### Q1：association 和 collection 的区别？

- `association`：一对一关系，如订单-用户
- `collection`：一对多关系，如用户-订单列表

### Q2：嵌套查询和嵌套结果的区别？

| 方式 | SQL 执行次数 | 适用场景 | N+1 问题 |
|-----|-------------|---------|---------|
| 嵌套查询 | N+1（先查主表，再查关联） | 关联对象数据量大 | 有 |
| 嵌套结果 | 1（一次 JOIN） | 数据量适中 | 无 |

### Q3：resultMap 的 autoMapping 是什么？

开启后，MyBatis 会自动映射列名到属性名（需开启驼峰映射），只需为需要特殊处理的列定义映射规则。

---

## 最佳实践

1. **使用嵌套结果代替嵌套查询**：减少 SQL 执行次数
2. **合理使用延迟加载**：关联数据量大时开启
3. **主键必须用 id 标签**：保证对象唯一性和缓存正确性
4. **复杂映射封装成公共 resultMap**：通过继承复用

---

## 思考题

一个用户有 1000 个订单，订单里平均有 5 个商品。如果用嵌套查询方式查询一个用户的所有订单和商品，最少要执行多少次 SQL？

下一节，我们看 [嵌套查询详解](/framework/mybatis/nested-query)，分析 N+1 问题的本质与解决方案。
