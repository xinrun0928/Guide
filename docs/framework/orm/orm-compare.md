# ORM 框架对比：JPA/Hibernate vs MyBatis

每次聊到 ORM 框架，总有人问：Hibernate 和 MyBatis 哪个好？

这个问题没有标准答案——**脱离业务场景谈技术选型，都是耍流氓**。

这一节，我们深入对比这些框架的特点，帮你做出合理的选择。

## 核心区别一览

| 维度 | Hibernate / JPA | MyBatis |
|-----|-----------------|---------|
| SQL 控制 | 框架生成 | 开发者编写 |
| 学习成本 | 较高 | 中等 |
| 开发效率 | 高 | 中等 |
| SQL 灵活性 | 低 | 高 |
| 性能调优 | 困难 | 容易 |
| 数据库无关性 | 强 | 弱 |
| 缓存支持 | 内置（复杂） | 简单 |
| 适用场景 | 快速开发 | 复杂查询 |

## Hibernate/JPA：全自动 ORM 的代表

### 工作方式

```
┌─────────────────────────────────────────────────────────────────┐
│                      Hibernate 执行流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Java 对象操作                                                   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Hibernate                             │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │              Session / EntityManager              │   │   │
│  │   │                                                 │   │   │
│  │   │   Hibernate 根据对象状态自动生成 SQL             │   │   │
│  │   │   save()     →  INSERT                          │   │   │
│  │   │   update()   →  UPDATE                          │   │   │
│  │   │   delete()   →  DELETE                          │   │   │
│  │   │   get()      →  SELECT                           │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  数据库                                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 代码示例

```java
// 实体类
@Entity
@Table(name = "user")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "name")
    private String name;

    private Integer age;

    private String email;
}

// Repository
public interface UserRepository extends JpaRepository&lt;User, Long&gt; {
}

// CRUD 操作 - 几乎不用写 SQL
@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;

    // 查询
    public User findById(Long id) {
        return userRepository.findById(id).orElse(null);
    }

    // 复杂查询 - 使用方法名约定
    public List&lt;User&gt; findByNameAndAge(String name, Integer age) {
        return userRepository.findByNameAndAge(name, age);
    }

    // 保存
    public User save(User user) {
        return userRepository.save(user);
    }

    // 删除
    public void delete(Long id) {
        userRepository.deleteById(id);
    }
}
```

### 优点

1. **开发效率极高**：不需要写 SQL
2. **代码简洁**：CRUD 都是一行
3. **对象化操作**：符合 OOP 思维
4. **数据库无关**：换数据库改动小
5. **丰富的缓存**：一级缓存、二级缓存、查询缓存

### 缺点

1. **SQL 不透明**：框架生成的 SQL 难以优化
2. **复杂查询困难**：联表、子查询实现复杂
3. **学习曲线陡峭**：Hibernate 的概念很多
4. **性能调优困难**：难以干预 SQL 生成
5. **内存占用高**：一级缓存、二级缓存占用内存

## MyBatis：半自动 ORM 的代表

### 工作方式

```
┌─────────────────────────────────────────────────────────────────┐
│                      MyBatis 执行流程                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Java 方法调用                                                   │
│       │                                                         │
│       ▼                                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    MyBatis                               │   │
│  │   ┌─────────────────────────────────────────────────┐   │   │
│  │   │              Mapper 接口 + XML/注解               │   │   │
│  │   │                                                 │   │   │
│  │   │   开发者编写 SQL                                  │   │   │
│  │   │   MyBatis 执行 SQL 并映射结果                    │   │   │
│  │   └─────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────┘   │
│       │                                                         │
│       ▼                                                         │
│  数据库                                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 代码示例

```java
// Mapper 接口
public interface UserMapper {
    User findById(Long id);
    List&lt;User&gt; findByNameAndAge(String name, Integer age);
    int insert(User user);
    int update(User user);
    int delete(Long id);
}

// XML 映射
<mapper namespace="com.example.mapper.UserMapper">
    <select id="findById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>

    <select id="findByNameAndAge" resultType="User">
        SELECT * FROM user
        WHERE name = #{name} AND age = #{age}
    </select>

    <insert id="insert" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO user (name, age, email) VALUES (#{name}, #{age}, #{email})
    </insert>
</mapper>

// Service 调用
@Service
public class UserService {
    @Autowired
    private UserMapper userMapper;

    public User findById(Long id) {
        return userMapper.findById(id);
    }
}
```

### 优点

1. **SQL 完全可控**：可以深度优化
2. **复杂查询容易**：SQL 随便写
3. **学习曲线平缓**：上手快
4. **性能调优简单**：直接看 SQL
5. **轻量级**：没有 Hibernate 那么重

### 缺点

1. **需要手写 SQL**：开发效率略低
2. **代码量较多**：比 Hibernate 多一些
3. **数据库有关**：SQL 可能需要改
4. **缓存支持弱**：需要配合其他工具

## 深度对比

### 1. 复杂查询

**Hibernate/JPA**：

```java
// JPQL - 相对 SQL 简化，但有限制
@Query("SELECT u FROM User u WHERE u.name LIKE %:name%")
List&lt;User&gt; searchByName(@Param("name") String name);

// Criteria API - 类型安全，但复杂
CriteriaBuilder cb = em.getCriteriaBuilder();
CriteriaQuery&lt;User&gt; query = cb.createQuery(User.class);
Root&lt;User&gt; user = query.from(User.class);
query.where(cb.like(user.get("name"), "%" + name + "%"));
```

**MyBatis**：

```xml
<!-- 直接写 SQL，想要什么就写什么 -->
<select id="searchByName" resultType="User">
    SELECT u.*, d.name as dept_name
    FROM user u
    LEFT JOIN dept d ON u.dept_id = d.id
    WHERE u.name LIKE CONCAT('%', #{name}, '%')
    AND u.status = 1
    ORDER BY u.create_time DESC
</select>
```

### 2. 关联查询

**Hibernate/JPA**：

```java
// 方式一：JOIN FETCH
@Query("SELECT u FROM User u LEFT JOIN FETCH u.orders WHERE u.id = :id")
User findByIdWithOrders(@Param("id") Long id);

// 方式二：Entity 映射
@Entity
public class User {
    @OneToMany(mappedBy = "user", fetch = FetchType.LAZY)
    private List&lt;Order&gt; orders;
}
```

**MyBatis**：

```xml
<!-- resultMap 嵌套 -->
<resultMap id="UserWithOrders" type="User">
    <id property="id" column="id"/>
    <result property="name" column="name"/>
    <collection property="orders" ofType="Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
    </collection>
</resultMap>
```

### 3. 性能调优

**Hibernate/JPA**：

```java
// 抓取策略
@OneToMany(mappedBy = "user", fetch = FetchType.LAZY)

// 二级缓存配置
@Cache(usage = CacheConcurrencyStrategy.READ_WRITE)

// 批量操作
@BatchSize(size = 100)
private List&lt;Order&gt; orders;
```

**MyBatis**：

```xml
<!-- 直接优化 SQL -->
<select id="findById" resultType="User">
    SELECT id, name, email
    FROM user
    WHERE id = #{id}
</select>
```

### 4. 分页

**Hibernate/JPA**：

```java
// 自动处理
Page&lt;User&gt; findAll(Pageable pageable);
```

**MyBatis**：

```java
// 需要手动或配合 PageHelper
Page&lt;User&gt; page = new Page&lt;&gt;(1, 10);
userMapper.selectPage(page, null);
```

## 选择建议

### 选 Hibernate/JPA 当：

- 项目以 CRUD 为主，查询简单
- 需要快速开发，快速交付
- 团队对 SQL 掌握较弱
- 需要强数据库无关性
- 适合：内部管理系统、简单 Web 应用

### 选 MyBatis 当：

- 查询复杂，需要手写大量 SQL
- 对性能要求高，需要深度优化
- 项目有 DBA，SQL 有专门优化
- 需要处理遗留数据库
- 适合：电商后台、报表系统、数据密集型应用

### 混用也可以：

```java
// 简单 CRUD 用 JPA
public interface UserRepository extends JpaRepository&lt;User, Long&gt; {
}

// 复杂查询用 MyBatis
public interface OrderMapper {
    List&lt;OrderVO&gt; complexOrderQuery(OrderQuery query);
}
```

## 面试高频问题

### Q1：Hibernate 和 MyBatis 的区别？

| 维度 | Hibernate | MyBatis |
|-----|-----------|---------|
| SQL | 框架生成 | 手动编写 |
| 学习曲线 | 陡峭 | 平缓 |
| 开发效率 | 高 | 中等 |
| 灵活性 | 低 | 高 |
| 性能调优 | 难 | 易 |

### Q2：JPA 和 Hibernate 的关系？

JPA（Java Persistence API）是 Java 持久化规范，Hibernate 是 JPA 的实现。Spring Data JPA 是对 JPA 的封装。

### Q3：MyBatis 和 Hibernate 各自的适用场景？

- Hibernate：快速开发、简单 CRUD、数据库无关性强
- MyBatis：复杂查询、性能敏感、需要深度 SQL 优化

---

## 思考题

一个项目刚开始，需求不确定，迭代很快。你会选 Hibernate 还是 MyBatis？为什么？

如果项目稳定后，查询变得很复杂呢？
