# MyBatis 面试高频问题汇总

MyBatis 是 Java 后端面试的必考内容。

这一节，我们来汇总那些**高频面试题**，并给出回答思路。

---

## 一、核心概念

### Q1: MyBatis 是什么？它和 Hibernate 的区别？

**考察点**：基本概念

**参考答案**：

MyBatis 是一款优秀的持久层框架，它支持定制化 SQL、存储过程以及高级映射。

| 维度 | MyBatis | Hibernate |
|-----|---------|-----------|
| 类型 | 半自动 ORM | 全自动 ORM |
| SQL 控制 | 开发者编写 | 框架生成 |
| 学习曲线 | 平缓 | 陡峭 |
| 性能 | 优异 | 一般 |
| 灵活度 | 高 | 低 |
| 国内生态 | 极好 | 一般 |

**回答示例**：

> MyBatis 是半自动 ORM 框架，SQL 由开发者编写，控制粒度细，适合复杂查询和性能优化；Hibernate 是全自动 ORM，屏蔽 SQL，适合快速开发但 SQL 不透明。国内项目 MyBatis 用得更广泛。

### Q2: MyBatis 的工作流程？

**考察点**：核心原理

**参考答案**：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MyBatis 执行流程                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  1. 加载配置 → MyBatis-config.xml + Mapper XML/注解                    │
│  2. 构建 SqlSessionFactory                                               │
│  3. 打开 SqlSession                                                     │
│  4. 获取 Mapper（动态代理）                                             │
│  5. 执行 SQL                                                            │
│  6. 一级缓存（SqlSession 级别）                                         │
│  7. 二级缓存（Mapper 级别）                                             │
│  8. 返回结果                                                            │
│  9. 关闭 SqlSession                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、缓存机制

### Q3: MyBatis 一级缓存和二级缓存的区别？

**考察点**：缓存机制

**参考答案**：

| 缓存级别 | 作用域 | 存储 | 生命周期 | 默认 |
|---------|--------|------|---------|------|
| 一级缓存 | SqlSession | 内存 | SqlSession 生命周期 | 开启 |
| 二级缓存 | Mapper | 磁盘/内存 | 全局 | 关闭 |

**一级缓存原理**：

```java
// 第一次查询
User user = userMapper.selectById(1L);  // 查数据库，存入一级缓存

// 第二次查询（同一 SqlSession）
User user2 = userMapper.selectById(1L);  // 直接从一级缓存取
```

**二级缓存开启**：

```xml
<!-- Mapper XML 中开启 -->
<cache eviction="FIFO" flushInterval="60000" size="512" readOnly="true"/>

<!-- 或使用注解 -->
@CacheNamespace
public interface UserMapper {}
```

### Q4: 缓存什么时候会失效？

**参考答案**：

**一级缓存失效**：

1. SqlSession 关闭或提交
2. 执行了增删改操作（`insert/update/delete`）
3. 调用 `clearCache()` 或 `commit()`

**二级缓存失效**：

1. 增删改操作
2. `flushCache = true` 的查询
3. 缓存刷新间隔到期

---

## 三、动态 SQL

### Q5: MyBatis 有哪些动态 SQL 标签？

**考察点**：动态 SQL

**参考答案**：

| 标签 | 说明 |
|-----|------|
| `<if>` | 条件判断 |
| `<choose>/<when>/<otherwise>` | 多条件单选 |
| `<where>` | 智能 WHERE 条件 |
| `<set>` | 智能 SET 更新 |
| `<trim>` | 自定义前后缀处理 |
| `<foreach>` | 遍历（批量操作） |
| `<bind>` | 定义变量 |

**示例**：

```xml
<select id="selectByConditions" resultType="User">
    SELECT * FROM user
    <where>
        <if test="name != null">
            AND name LIKE CONCAT('%', #{name}, '%')
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </where>
</select>
```

### Q6: #{} 和 ${} 的区别？

**考察点**：SQL 注入

**参考答案**：

| 特性 | `#{}` | `${}` |
|-----|-------|-------|
| 原理 | 预编译，参数绑定 | 字符串替换 |
| SQL 注入 | 安全 | 危险 |
| 使用场景 | 普通参数 | 动态表名/列名 |

```java
// #{} 安全
SELECT * FROM user WHERE id = #{id}
// 生成：SELECT * FROM user WHERE id = ?

// ${} 危险
SELECT * FROM user ORDER BY ${columnName}
// 直接替换，可能被注入
```

---

## 四、关联查询

### Q7: MyBatis 如何处理一对一和一对多关联？

**考察点**：结果映射

**参考答案**：

**一对一（association）**：

```xml
<resultMap id="UserWithOrderMap" type="User">
    <association property="order" javaType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
    </association>
</resultMap>
```

**一对多（collection）**：

```xml
<resultMap id="UserWithOrdersMap" type="User">
    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
    </collection>
</resultMap>
```

### Q8: association 的延迟加载是什么？

**参考答案**：

```xml
<!-- 全局开启延迟加载 -->
<settings>
    <setting name="lazyLoadingEnabled" value="true"/>
    <setting name="aggressiveLazyLoading" value="false"/>
</settings>

<!-- 嵌套查询（延迟加载） -->
<association property="dept" column="dept_id"
            select="com.example.mapper.DeptMapper.selectById"/>
```

只有访问关联对象的属性时，才会触发额外查询。

---

## 五、插件机制

### Q9: MyBatis 插件机制原理？

**考察点**：插件/拦截器

**参考答案**：

MyBatis 插件基于**拦截器链**，四大对象都可以被拦截：

```
Executor（执行器）→ StatementHandler（SQL 语句处理器）
    ↓
ParameterHandler（参数处理器）
    ↓
ResultSetHandler（结果处理器）
```

**插件编写**：

```java
@Intercepts({
    @Signature(type = StatementHandler.class, method = "query",
              args = {Statement.class, ResultHandler.class})
})
public class MyPlugin implements Interceptor {
    
    @Override
    public Object intercept(Invocation invocation) throws Throwable {
        // 拦截逻辑
        return invocation.proceed();
    }
}
```

**使用分页插件**：

```java
@Bean
public MybatisPlusInterceptor mybatisPlusInterceptor() {
    MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();
    interceptor.addInnerInterceptor(new PaginationInnerInterceptor());
    return interceptor;
}
```

---

## 六、核心组件

### Q10: SqlSessionFactoryBuilder、SqlSessionFactory、SqlSession 的关系？

**考察点**：核心组件

**参考答案**：

```
SqlSessionFactoryBuilder → SqlSessionFactory → SqlSession
       （临时）            （全局单例）        （线程不安全）
       
- SqlSessionFactoryBuilder：用完即弃
- SqlSessionFactory：全局唯一，线程安全
- SqlSession：一次请求创建一个，线程不安全
```

### Q11: Mapper 代理机制原理？

**参考答案**：

MyBatis 通过 **JDK 动态代理**，为 Mapper 接口生成代理对象。

```java
// 获取 Mapper
UserMapper mapper = sqlSession.getMapper(UserMapper.class);

// 内部实现
public <T> T getMapper(Class<T> type) {
    return Proxy.newProxyInstance(
        type.getClassLoader(),
        new Class[]{type},
        (proxy, method, args) -> {
            // 执行 SQL
            return executor.query(mappedStatement, args);
        }
    );
}
```

---

## 七、事务管理

### Q12: MyBatis 如何管理事务？

**参考答案**：

```java
// 方式一：手动管理
SqlSession sqlSession = factory.openSession();
try {
    UserMapper mapper = sqlSession.getMapper(UserMapper.class);
    mapper.insert(user);
    sqlSession.commit();
} catch (Exception e) {
    sqlSession.rollback();
} finally {
    sqlSession.close();
}

// 方式二：Spring 集成
@Transactional
public void transfer(Long fromId, Long toId, BigDecimal amount) {
    // Spring 自动管理事务
}
```

---

## 八、常见问题

### Q13: MyBatis 为什么适合复杂查询？

**参考答案**：

1. SQL 完全可控，可写任意复杂查询
2. 动态 SQL 支持强大
3. 可以手动优化 SQL 性能
4. 支持存储过程

### Q14: MyBatis 的 N+1 问题？

**参考答案**：

```xml
<!-- N+1 问题：查 N 个用户，触发 N+1 次查询 -->
<collection property="orders" select="selectByUserId" column="id"/>

<!-- 解决方案：使用 JOIN 查询 -->
<resultMap id="UserWithOrdersMap" type="User">
    <id property="id" column="id"/>
    <collection property="orders" resultMap="OrderResultMap"/>
</resultMap>
```

---

## 九、面试高频场景

### 场景一：手写 MyBatis 执行流程

```java
// 伪代码
InputStream inputStream = Resources.getResourceAsStream("mybatis-config.xml");
SqlSessionFactory factory = new SqlSessionFactoryBuilder().build(inputStream);
SqlSession sqlSession = factory.openSession();
UserMapper mapper = sqlSession.getMapper(UserMapper.class);
User user = mapper.selectById(1L);
sqlSession.close();
```

### 场景二：分页查询实现

```java
// MyBatis 分页插件
PageHelper.startPage(pageNum, pageSize);
List<User> users = userMapper.selectList();
PageInfo<User> pageInfo = new PageInfo<>(users);
```

### 场景三：批量插入优化

```xml
<insert id="batchInsert">
    INSERT INTO user (name, email) VALUES
    <foreach collection="list" item="item" separator=",">
        (#{item.name}, #{item.email})
    </foreach>
</insert>
```

---

## 十、总结

### 面试高频知识点

| 优先级 | 知识点 | 出现频率 |
|-------|--------|---------|
| ⭐⭐⭐⭐⭐ | #{} vs ${} | 极高 |
| ⭐⭐⭐⭐⭐ | 一级缓存 vs 二级缓存 | 极高 |
| ⭐⭐⭐⭐ | 动态 SQL 标签 | 高 |
| ⭐⭐⭐⭐ | 关联查询（association/collection） | 高 |
| ⭐⭐⭐⭐ | 插件机制原理 | 高 |
| ⭐⭐⭐⭐ | 执行流程 | 高 |
| ⭐⭐⭐ | 延迟加载 | 中 |
| ⭐⭐⭐ | 缓存失效场景 | 中 |
| ⭐⭐⭐ | Mapper 代理原理 | 中 |

### 回答技巧

1. **概念题**：先给定义，再给例子
2. **原理题**：画流程图，说核心源码
3. **对比题**：表格对比，最后给建议
4. **实战题**：给代码示例

---

## 相关文档

- [MyBatis 总览](/framework/mybatis/index)
- [MyBatis 架构](/framework/mybatis/architecture)
- [MyBatis 缓存机制](/framework/mybatis/cache)
- [MyBatis 动态 SQL](/framework/mybatis/dynamic-sql)
- [MyBatis Plus](/framework/mybatis-plus/index)
