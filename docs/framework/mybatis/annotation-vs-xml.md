# MyBatis 注解方式 vs XML 方式对比

MyBatis 提供了两种定义 SQL 的方式：

- **注解方式**：SQL 直接写在 Java 接口方法上
- **XML 方式**：SQL 写在独立的 XML 文件中

选哪个？

这是一个老生常谈的问题，但答案并不是非此即彼。

## 快速对比

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MyBatis SQL 定义方式                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  注解方式：                        XML 方式：                          │
│  ┌─────────────────────┐           ┌─────────────────────────────┐      │
│  │ @Select("...")     │           │ <select id="..." resultMap │      │
│  │ @Insert("...")     │           │   <result.../>              │      │
│  │ @Update("...")     │           │ </select>                   │      │
│  │ @Delete("...")     │           └─────────────────────────────┘      │
│  │ @Results({...})    │                                              │
│  └─────────────────────┘                                              │
│                                                                         │
│  代码在一起                      代码分离                               │
│  简单 SQL 方便                   复杂 SQL 清晰                         │
│  动态 SQL 困难                   动态 SQL 强大                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 注解方式

### 基本 CRUD

```java
@Mapper
public interface UserMapper {
    
    @Select("SELECT * FROM user WHERE id = #{id}")
    User selectById(Long id);
    
    @Insert("INSERT INTO user (name, email, age) VALUES (#{name}, #{email}, #{age})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);
    
    @Update("UPDATE user SET name = #{name}, email = #{email} WHERE id = #{id}")
    int update(User user);
    
    @Delete("DELETE FROM user WHERE id = #{id}")
    int delete(Long id);
}
```

### 动态 SQL（注解方式）

使用 `<script>` 标签包裹动态 SQL：

```java
@Mapper
public interface UserMapper {
    
    // 动态条件查询
    @Select("<script>" +
            "SELECT * FROM user WHERE 1=1" +
            "<if test='name != null'> AND name LIKE CONCAT('%', #{name}, '%')</if>" +
            "<if test='age != null'> AND age = #{age}</if>" +
            "<if test='status != null'> AND status = #{status}</if>" +
            "</script>")
    List<User> selectByConditions(User user);
    
    // 动态插入
    @Insert("<script>" +
            "INSERT INTO user" +
            "<trim prefix='(' suffix=')' suffixOverrides=','>" +
            "<if test='name != null'>name,</if>" +
            "<if test='email != null'>email,</if>" +
            "<if test='age != null'>age,</if>" +
            "</trim>" +
            "VALUES" +
            "<trim prefix='(' suffix=')' suffixOverrides=','>" +
            "<if test='name != null'>#{name},</if>" +
            "<if test='email != null'>#{email},</if>" +
            "<if test='age != null'>#{age},</if>" +
            "</trim>" +
            "</script>")
    int insertSelective(User user);
    
    // 批量操作
    @Insert("<script>" +
            "INSERT INTO user (name, email) VALUES" +
            "<foreach collection='list' item='item' separator=','>" +
            "(#{item.name}, #{item.email})" +
            "</foreach>" +
            "</script>")
    int batchInsert(@Param("list") List<User> users);
}
```

### 结果映射

```java
@Mapper
public interface UserMapper {
    
    // 使用 @Results 指定映射
    @Select("SELECT * FROM user WHERE id = #{id}")
    @Results({
        @Result(property = "id", column = "id"),
        @Result(property = "name", column = "user_name"),
        @Result(property = "email", column = "email"),
        @Result(property = "createTime", column = "create_time")
    })
    User selectById(Long id);
    
    // 一对一关联
    @Select("SELECT u.*, o.id as order_id, o.order_no " +
            "FROM user u LEFT JOIN orders o ON u.id = o.user_id " +
            "WHERE u.id = #{id}")
    @Results({
        @Result(property = "id", column = "id"),
        @Result(property = "name", column = "user_name"),
        @Result(property = "order", one = @One(select = "com.example.mapper.OrderMapper.selectById"),
                column = "order_id")
    })
    User selectUserWithOrder(Long id);
    
    // 一对多关联
    @Select("SELECT * FROM user WHERE id = #{id}")
    @Results({
        @Result(property = "id", column = "id"),
        @Result(property = "orders", many = @Many(select = "com.example.mapper.OrderMapper.selectByUserId"),
                column = "id")
    })
    User selectUserWithOrders(Long id);
}
```

## XML 方式

### 基本 CRUD

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.example.mapper.UserMapper">
    
    <select id="selectById" resultType="User">
        SELECT * FROM user WHERE id = #{id}
    </select>
    
    <insert id="insert" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO user (name, email, age) VALUES (#{name}, #{email}, #{age})
    </insert>
    
    <update id="update">
        UPDATE user
        <set>
            <if test="name != null">name = #{name},</if>
            <if test="email != null">email = #{email},</if>
        </set>
        WHERE id = #{id}
    </update>
    
    <delete id="delete">
        DELETE FROM user WHERE id = #{id}
    </delete>
    
</mapper>
```

### 动态 SQL

```xml
<mapper namespace="com.example.mapper.UserMapper">
    
    <!-- 条件查询 -->
    <select id="selectByConditions" resultType="User">
        SELECT * FROM user
        <where>
            <if test="name != null">
                AND name LIKE CONCAT('%', #{name}, '%')
            </if>
            <if test="age != null">
                AND age = #{age}
            </if>
            <if test="status != null">
                AND status = #{status}
            </if>
        </where>
        <if test="orderBy != null">
            ORDER BY ${orderBy}
        </if>
    </select>
    
    <!-- 批量插入 -->
    <insert id="batchInsert" useGeneratedKeys="true" keyProperty="id">
        INSERT INTO user (name, email, age) VALUES
        <foreach collection="list" item="item" separator=",">
            (#{item.name}, #{item.email}, #{item.age})
        </foreach>
    </insert>
    
    <!-- 批量更新 -->
    <update id="batchUpdate">
        <foreach collection="list" item="item" separator=";">
            UPDATE user
            <set>
                <if test="item.name != null">name = #{item.name},</if>
                <if test="item.status != null">status = #{item.status},</if>
            </set>
            WHERE id = #{item.id}
        </foreach>
    </update>
    
    <!-- choose 实现多条件单选 -->
    <select id="selectByStatus" resultType="User">
        SELECT * FROM user
        <choose>
            <when test="status == 1">WHERE status = 1</when>
            <when test="status == 0">WHERE status = 0</when>
            <otherwise>WHERE status IN (0, 1)</otherwise>
        </choose>
    </select>
    
</mapper>
```

### 关联查询

```xml
<mapper namespace="com.example.mapper.UserMapper">
    
    <!-- 一对一 association -->
    <resultMap id="UserWithOrderMap" type="User">
        <id property="id" column="id"/>
        <result property="name" column="user_name"/>
        <association property="order" column="order_id"
                    javaType="Order">
            <id property="id" column="order_id"/>
            <result property="orderNo" column="order_no"/>
        </association>
    </resultMap>
    
    <select id="selectUserWithOrder" resultMap="UserWithOrderMap">
        SELECT u.id, u.name as user_name, o.id as order_id, o.order_no
        FROM user u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.id = #{id}
    </select>
    
    <!-- 一对多 collection -->
    <resultMap id="UserWithOrdersMap" type="User">
        <id property="id" column="id"/>
        <result property="name" column="user_name"/>
        <collection property="orders" ofType="Order" column="id"
                   select="com.example.mapper.OrderMapper.selectByUserId"/>
    </resultMap>
    
    <select id="selectUserWithOrders" resultMap="UserWithOrdersMap">
        SELECT * FROM user WHERE id = #{id}
    </select>
    
</mapper>
```

## 详细对比

### 1. SQL 复杂度

| SQL 类型 | 注解方式 | XML 方式 |
|---------|---------|---------|
| 简单 CRUD | ✅ 方便 | ✅ 也可以 |
| 条件查询 | ⚠️ 可用 script | ✅ 清晰 |
| 动态 SQL | ⚠️ 可用 script | ✅ 强大 |
| 多表关联 | ⚠️ 可用注解 | ✅ 清晰 |
| 批量操作 | ⚠️ 可用 script | ✅ 清晰 |
| SQL 复用 | ❌ 困难 | ✅ include |

### 2. 可维护性

| 维度 | 注解方式 | XML 方式 |
|-----|---------|---------|
| 代码集中 | ✅ 一个类搞定 | ❌ 需要两个文件 |
| SQL 调整 | ⚠️ 需要改代码 | ✅ 只需改 XML |
| 代码审查 | ⚠️ SQL 和代码混在一起 | ✅ SQL 独立 |
| 版本控制 | ⚠️ 和 Java 文件一起 | ✅ 可以独立管理 |

### 3. 性能

性能上**没有区别**。MyBatis 会在启动时解析注解或 XML，生成相同的 SQL 信息。

### 4. 适用场景

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         选择建议                                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  选择注解方式：                                                          │
│  ✅ 简单 CRUD 操作                                                      │
│  ✅ SQL 逻辑简单，不常修改                                              │
│  ✅ 小型项目或微服务                                                    │
│  ✅ 团队熟悉注解方式                                                    │
│                                                                         │
│  选择 XML 方式：                                                         │
│  ✅ 复杂动态 SQL                                                       │
│  ✅ SQL 经常需要调整                                                    │
│  ✅ 需要复用 SQL 片段                                                   │
│  ✅ 大型项目，SQL 量大                                                  │
│  ✅ 需要精细控制 SQL                                                    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 混用策略

最佳实践：**简单 SQL 用注解，复杂 SQL 用 XML**

```java
@Mapper
public interface UserMapper {
    
    // 简单 SQL 用注解
    @Select("SELECT * FROM user WHERE id = #{id}")
    User selectById(Long id);
    
    @Insert("INSERT INTO user (name, email) VALUES (#{name}, #{email})")
    @Options(useGeneratedKeys = true, keyProperty = "id")
    int insert(User user);
    
    // 复杂 SQL 引用 XML
    List<User> selectByConditions(UserQuery query);
    
    // 批量操作
    int batchUpdate(List<User> users);
}
```

对应的 XML 文件：

```xml
<mapper namespace="com.example.mapper.UserMapper">
    
    <select id="selectByConditions" resultType="User">
        <!-- 复杂条件查询 -->
    </select>
    
    <update id="batchUpdate">
        <!-- 批量更新 -->
    </update>
    
</mapper>
```

## 常见问题

### 1. 注解方式如何实现 SQL 复用？

```java
// 使用 @SelectProvider
@SelectProvider(type = UserSqlProvider.class, method = "buildSelectSql")
List<User> selectByConditions(UserQuery query);

// SQL Provider 类
public class UserSqlProvider {
    public String buildSelectSql(UserQuery query) {
        return new SQL() {{
            SELECT("*");
            FROM("user");
            if (query.getName() != null) {
                WHERE("name LIKE CONCAT('%', #{name}, '%')");
            }
            if (query.getAge() != null) {
                WHERE("age = #{age}");
            }
        }}.toString();
    }
}
```

### 2. XML 中如何引用注解定义的 SQL？

```xml
<!-- 在 XML 中引用 -->
<select id="selectWithCount" resultType="map">
    SELECT u.*,
           (<include refid="com.example.mapper.UserMapper.selectCount"/>) as user_count
    FROM user u
</select>
```

### 3. 注解和 XML 同时存在？

**XML 会覆盖注解**，MyBatis 会优先使用 XML 中定义的 SQL。

---

## 面试追问

**Q1: MyBatis 中 #{} 和 ${} 的区别？**

答：

- `#{}`：**预编译**，使用占位符，防止 SQL 注入
- `${}`：**直接拼接**，不预编译，有 SQL 注入风险

```java
// #{}：生成 PreparedStatement 参数
SELECT * FROM user WHERE id = ?  // 安全

// ${}：直接替换
SELECT * FROM user ORDER BY ${columnName}  // 可能被注入
```

**最佳实践**：能用 `#{}` 就用 `#{}`，只有在需要 SQL 片段拼接（如 ORDER BY 字段名）时才用 `${}`。

**Q2: 注解方式能完全替代 XML 吗？**

答：不能。注解方式的动态 SQL 支持较弱，复杂场景（如多表关联、复杂动态查询）用 XML 更清晰。

**Q3: MyBatis 的 SQL 执行流程是什么？**

答：

```
SqlSessionFactoryBuilder
    ↓
SqlSessionFactory（解析 XML/注解）
    ↓
SqlSession（执行 SQL）
    ↓
Executor（执行器）
    ↓
StatementHandler（SQL 语句处理器）
    ↓
ParameterHandler（参数处理）
    ↓
ResultSetHandler（结果处理）
```

---

## 总结

| 场景 | 推荐方式 |
|-----|---------|
| 单表简单 CRUD | 注解 |
| 动态条件查询 | XML |
| 多表关联查询 | XML |
| 批量操作 | XML |
| SQL 复杂但不常改 | 注解 + Provider |
| SQL 简单但常改 | XML |

> **没有最好的方式，只有最适合的方式**。根据团队情况和项目特点选择即可。
